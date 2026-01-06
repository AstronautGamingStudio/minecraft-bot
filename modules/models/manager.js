const fs = require('fs');
const path = require('path');

const MODELS_ROOT = path.resolve(__dirname, '..', '..', 'models');
if (!fs.existsSync(MODELS_ROOT)) fs.mkdirSync(MODELS_ROOT, { recursive: true });

function _taskDir(task) {
  const d = path.join(MODELS_ROOT, task);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function saveCandidate(task, jsonObj, score) {
  const dir = _taskDir(task);
  const ts = Date.now();
  const fname = `${ts}-${Math.round((score||0)*10000)}.json`;
  const full = path.join(dir, fname);
  fs.writeFileSync(full, JSON.stringify(jsonObj));
  // prune: keep top N by score (encoded in filename)
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  const parsed = files.map(f => {
    const m = f.match(/^(\d+)-(\d+)\.json$/);
    if (!m) return { f, score: 0 };
    return { f, score: parseInt(m[2],10)/10000 };
  }).sort((a,b)=>b.score - a.score);
  const KEEP = parseInt(process.env.MODELS_KEEP || '5');
  for (let i = KEEP; i < parsed.length; i++) {
    try { fs.unlinkSync(path.join(dir, parsed[i].f)); } catch (e) {}
  }
  return full;
}

function bestFor(task) {
  const dir = _taskDir(task);
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  if (!files.length) return null;
  const parsed = files.map(f => {
    const m = f.match(/^(\d+)-(\d+)\.json$/);
    if (!m) return null;
    return { f, score: parseInt(m[2],10)/10000 };
  }).filter(Boolean).sort((a,b)=>b.score - a.score);
  if (!parsed.length) return null;
  return path.join(dir, parsed[0].f);
}

function _averageJson(a, b) {
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((v,i)=>_averageJson(v,b[i]));
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const keys = Object.keys(a).filter(k=>b.hasOwnProperty(k));
    const out = {};
    for (const k of keys) out[k] = _averageJson(a[k], b[k]);
    return out;
  }
  if (typeof a === 'number' && typeof b === 'number') return (a+b)/2;
  return a; // fallback
}

function combineTop(task, keep = 2) {
  const dir = _taskDir(task);
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.json'));
  if (files.length < 2) return null;
  const parsed = files.map(f => {
    const m = f.match(/^(\d+)-(\d+)\.json$/);
    if (!m) return null;
    return { f, score: parseInt(m[2],10)/10000 };
  }).filter(Boolean).sort((a,b)=>b.score - a.score);
  const top = parsed.slice(0, keep).map(p => JSON.parse(fs.readFileSync(path.join(dir,p.f),'utf8')));
  let combined = top[0];
  for (let i = 1; i < top.length; i++) combined = _averageJson(combined, top[i]);
  const outName = `combined-${Date.now()}.json`;
  const outPath = path.join(dir, outName);
  fs.writeFileSync(outPath, JSON.stringify(combined));
  return outPath;
}

function pruneGlobal(keep = parseInt(process.env.MODELS_KEEP_GLOBAL || '8')) {
  // Use models/fitness.log to pick top generations and remove other best-gen/checkpoint-full-gen files
  try {
    const fitnessLog = path.join(MODELS_ROOT, 'fitness.log');
    if (!fs.existsSync(fitnessLog)) return;
    const lines = fs.readFileSync(fitnessLog, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    const entries = lines.map(l => {
      const parts = l.split(','); // timestamp,gen,score
      return { gen: parseInt(parts[1],10), score: parseFloat(parts[2]) };
    }).filter(e => !isNaN(e.gen) && !isNaN(e.score));
    // pick top `keep` gen numbers by score
    const top = entries.sort((a,b)=>b.score - a.score).slice(0, keep).map(e => e.gen);
    const files = fs.readdirSync(MODELS_ROOT).filter(f => /best-gen-\d+\.json$/.test(f) || /checkpoint-full-gen-\d+\.json$/.test(f));
    for (const f of files) {
      const m = f.match(/(best-gen|checkpoint-full-gen)-(\d+)\.json$/);
      if (!m) continue;
      const gen = parseInt(m[2], 10);
      if (!top.includes(gen)) {
        try { fs.unlinkSync(path.join(MODELS_ROOT, f)); } catch (e) {}
      }
    }
  } catch (e) {
    // ignore
  }
}

function mergeAndPruneGenerations(keep = parseInt(process.env.MODELS_KEEP_GLOBAL || '8')) {
  try {
    const fitnessLog = path.join(MODELS_ROOT, 'fitness.log');
    if (!fs.existsSync(fitnessLog)) return;
    const lines = fs.readFileSync(fitnessLog, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    const entries = lines.map(l => {
      const parts = l.split(','); // timestamp,gen,score
      return { gen: parseInt(parts[1],10), score: parseFloat(parts[2]) };
    }).filter(e => !isNaN(e.gen) && !isNaN(e.score));
    const top = entries.sort((a,b)=>b.score - a.score).slice(0, keep).map(e => e.gen);
    // gather gens to merge (those not in top)
    const gensToMerge = Array.from(new Set(entries.map(e => e.gen))).filter(g => !top.includes(g));
    if (!gensToMerge.length) return;
    const mergedList = [];
    for (const gen of gensToMerge) {
      const candidates = [];
      const best = path.join(MODELS_ROOT, `best-gen-${gen}.json`);
      const chk = path.join(MODELS_ROOT, `checkpoint-full-gen-${gen}.json`);
      try { if (fs.existsSync(best)) candidates.push(JSON.parse(fs.readFileSync(best,'utf8'))); } catch (e) {}
      try { if (fs.existsSync(chk)) candidates.push(JSON.parse(fs.readFileSync(chk,'utf8'))); } catch (e) {}
      if (!candidates.length) continue;
      // average all candidates for this gen
      let combined = candidates[0];
      for (let i = 1; i < candidates.length; i++) combined = _averageJson(combined, candidates[i]);
      mergedList.push(combined);
      // delete originals for this gen
      try { if (fs.existsSync(best)) fs.unlinkSync(best); } catch (e) {}
      try { if (fs.existsSync(chk)) fs.unlinkSync(chk); } catch (e) {}
    }
    if (mergedList.length) {
      // average merged gens into one consolidated file to preserve some information
      let final = mergedList[0];
      for (let i = 1; i < mergedList.length; i++) final = _averageJson(final, mergedList[i]);
      const outName = `merged-oldgens-${Date.now()}.json`;
      fs.writeFileSync(path.join(MODELS_ROOT, outName), JSON.stringify(final));
    }
  } catch (e) {
    // ignore errors during merge/prune
  }
}

module.exports = { saveCandidate, bestFor, combineTop, pruneGlobal, mergeAndPruneGenerations };
