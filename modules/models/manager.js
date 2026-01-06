const fs = require('fs');
const path = require('path');

const MODELS_ROOT = path.resolve(__dirname, '..', '..', 'models');
if (!fs.existsSync(MODELS_ROOT)) fs.mkdirSync(MODELS_ROOT, { recursive: true });

function _taskDir(task) {
  const d = path.join(MODELS_ROOT, task);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function _savesDir() {
  const d = path.join(MODELS_ROOT, 'saves');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function saveCandidate(task, jsonObj, score = 0) {
  const dir = _taskDir(task);
  const ts = Date.now();
  const fname = `${ts}-${Math.round((score||0)*10000)}.json`;
  const full = path.join(dir, fname);
  fs.writeFileSync(full, JSON.stringify(jsonObj));
  // create a labeled numbered copy: best-<task>-<n>.json
  try {
    const keep = parseInt(process.env.LABELED_KEEP || '5');
    const labelPrefix = `best-${task}`;
    const existing = fs.readdirSync(dir).filter(f => f.startsWith(labelPrefix) && f.endsWith('.json'));
    const next = existing.length + 1;
    const labeled = path.join(dir, `${labelPrefix}-${next}.json`);
    try { fs.copyFileSync(full, labeled); } catch (e) { }
    // prune older labeled files beyond keep
    const labeledAll = fs.readdirSync(dir).filter(f => f.startsWith(labelPrefix) && f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a,b)=>b.m-a.m);
    for (let i = keep; i < labeledAll.length; i++) { try { fs.unlinkSync(path.join(dir, labeledAll[i].f)); } catch (e) {} }
  } catch (e) {}
  return full;
}

function bestFor(task) {
  const dir = _taskDir(task);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  let best = null; let bestScore = -Infinity;
  for (const f of files) {
    const m = f.match(/^(\d+)-(\d+)\.json$/);
    if (!m) continue;
    const score = parseInt(m[2], 10) / 10000;
    if (score > bestScore) { bestScore = score; best = path.join(dir, f); }
  }
  return best;
}

function _averageJson(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (typeof a === 'number' && typeof b === 'number') return (a + b) / 2;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((v, i) => _averageJson(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const out = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) out[k] = _averageJson(a[k], b[k]);
    return out;
  }
  return a; // fallback
}

function _weightedAverageJson(cands, weights) {
  // cands: array of json objects, weights: same-length array of positive numbers
  const total = weights.reduce((s,w)=>s+(w||0), 0) || 1;
  function recur(vals, ws) {
    // vals: array of values at same key from each candidate
    const types = vals.map(v => (v === null || v === undefined) ? 'null' : typeof v);
    // if all numbers
    if (types.every(t => t === 'number')) {
      let s = 0;
      for (let i = 0; i < vals.length; i++) s += (vals[i]||0) * (ws[i]||0);
      return s / total;
    }
    // arrays of same length
    if (vals.every(v => Array.isArray(v))) {
      const len = Math.max(...vals.map(a=>a.length));
      const out = [];
      for (let j = 0; j < len; j++) {
        const sub = vals.map(v => (v && v[j]!==undefined) ? v[j] : null);
        out[j] = recur(sub, ws);
      }
      return out;
    }
    // objects
    if (vals.every(v => v && typeof v === 'object' && !Array.isArray(v))) {
      const keys = new Set(); vals.forEach(v=>Object.keys(v).forEach(k=>keys.add(k)));
      const out = {};
      for (const k of keys) {
        const sub = vals.map(v => (v && v[k] !== undefined) ? v[k] : null);
        out[k] = recur(sub, ws);
      }
      return out;
    }
    // fallback: take first non-null
    for (const v of vals) if (v !== null && v !== undefined) return v;
    return vals[0];
  }
  return recur(cands, weights);
}

function combineTop(task, topN = 3) {
  const dir = _taskDir(task);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const parsed = files.map(f => {
    const m = f.match(/^(\d+)-(\d+)\.json$/);
    if (!m) return null;
    return { f: path.join(dir, f), score: parseInt(m[2], 10) / 10000 };
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
  const top = parsed.slice(0, topN);
  if (!top.length) return null;
  const candidates = [];
  for (const t of top) {
    try { const j = JSON.parse(fs.readFileSync(t.f, 'utf8')); candidates.push(j); } catch (e) {}
  }
  if (!candidates.length) return null;
  // use score-weighted average when scores are available
  const weights = top.slice(0, candidates.length).map(t => t.score || 1);
  let combined = _weightedAverageJson(candidates, weights);
  // Ensure combined model JSON has at least desired number of input nodes
  try {
    const desiredInputs = parseInt(process.env.MODEL_INPUTS || '10');
    if (typeof combined === 'object' && Array.isArray(combined.nodes)) {
      const modelInputCount = combined.nodes.filter(n => n.type === 'input').length;
      if (modelInputCount < desiredInputs) {
        const nodes = combined.nodes.slice();
        const connections = Array.isArray(combined.connections) ? combined.connections.slice() : (combined.connections || []);
        const maxId = nodes.reduce((m, n) => Math.max(m, (typeof n.id === 'number' ? n.id : -1)), -1);
        const addCount = desiredInputs - modelInputCount;
        const newIds = [];
        for (let k = 0; k < addCount; k++) {
          const nid = maxId + 1 + k;
          newIds.push(nid);
          nodes.push({ id: nid, type: 'input', bias: 0, squash: 'LOGISTIC' });
        }
        for (const nid of newIds) {
          for (const target of nodes) {
            if (target.type && target.type !== 'input') {
              connections.push({ from: nid, to: target.id, weight: (Math.random() * 0.2) - 0.1 });
            }
          }
        }
        combined.nodes = nodes;
        combined.connections = connections;
      }
    }
  } catch (e) {}
  const outName = `combined-${task}-${Date.now()}.json`;
  const outPath = path.join(dir, outName);
  fs.writeFileSync(outPath, JSON.stringify(combined));
  return outPath;
}

function pruneGlobal(keep = 5) {
  try {
    const tasks = fs.readdirSync(MODELS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).filter(n => n !== 'saves');
    for (const t of tasks) {
      const dir = path.join(MODELS_ROOT, t);
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const parsed = files.map(f => {
        const m = f.match(/^(\d+)-(\d+)\.json$/);
        const score = m ? parseInt(m[2], 10) / 10000 : 0;
        return { f: path.join(dir, f), score };
      }).sort((a,b) => b.score - a.score);
      const toKeep = parsed.slice(0, keep).map(p=>p.f);
      for (const p of parsed.slice(keep)) {
        try { fs.unlinkSync(p.f); } catch (e) {}
      }
    }
  } catch (e) { /* ignore */ }
}

function registerBot(bot, category = 'generic') {
  try {
    if (!bot) return;
    if (!bot._modelManagerRegistered) {
      bot._modelManagerRegistered = true;
      if (!bot._stats) bot._stats = { kills: 0, blocksMined: 0, itemsCollected: 0, attacks: 0 };
      // ensure episode log exists
      bot._episodeLog = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] };
      const savesDir = _savesDir();
      const writeSave = (reason) => {
        try {
          const snap = {
            ts: Date.now(),
            reason: reason || 'exit',
            category,
            pos: bot.entity && bot.entity.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
            health: bot.health || 0,
            food: bot.food || 0,
            inventory: (bot.inventory && typeof bot.inventory.items === 'function') ? bot.inventory.items().map(i => ({ id: i.type, name: i.name, count: i.count })) : [],
            stats: bot._stats || {},
            planLog: bot._planLog || [],
            episodeLog: bot._episodeLog || {}
          };
          const fname = `${category}-${Date.now()}.json`;
          fs.writeFileSync(path.join(savesDir, fname), JSON.stringify(snap));
        } catch (e) { /* ignore save errors */ }
      };
      bot.on('end', () => writeSave('end'));
      try { bot.on('kicked', () => writeSave('kicked')); } catch (e) {}
      try { bot.on('error', () => writeSave('error')); } catch (e) {}

      // Periodic partial episode flush to saves to avoid huge in-memory logs
      try {
        const flushMs = parseInt(process.env.EPISODE_FLUSH_MS || '60000');
        const keep = parseInt(process.env.EPISODE_FLUSH_KEEP || '50');
        const botId = bot.username || ('bot-' + Date.now());
        bot._episodeFlushHandler = setInterval(() => {
          try {
            const episode = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] };
            const trimTo = (arr, n) => { if (!Array.isArray(arr)) return arr; if (arr.length > n) return arr.slice(arr.length - n); return arr; };
            const episodeSafe = {
              inputs: trimTo(episode.inputs, 500),
              outputs: trimTo(episode.outputs, 500),
              actions: trimTo(episode.actions, 500),
              planLog: trimTo(episode.planLog || [], 500),
              truncated: (episode.inputs && episode.inputs.length > 500) || (episode.outputs && episode.outputs.length > 500) || (episode.actions && episode.actions.length > 500)
            };
            const fname = `epis-${category}-${botId}-${Date.now()}.json`;
            fs.writeFileSync(path.join(savesDir, fname), JSON.stringify({ ts: Date.now(), category, episode: episodeSafe }));
            // cleanup older episodic flush files beyond keep
            const all = fs.readdirSync(savesDir).filter(f => f.startsWith(`epis-${category}-${botId}-`)).map(f => ({ f, m: fs.statSync(path.join(savesDir, f)).mtimeMs })).sort((a,b)=>b.m - a.m);
            for (let i = keep; i < all.length; i++) {
              try { fs.unlinkSync(path.join(savesDir, all[i].f)); } catch (e) {}
            }
          } catch (e) {}
        }, flushMs);
        // clear interval on disconnect
        const clearFlush = () => { try { if (bot._episodeFlushHandler) clearInterval(bot._episodeFlushHandler); bot._episodeFlushHandler = null; } catch (e) {} };
        bot.on('end', clearFlush);
        try { bot.on('kicked', clearFlush); } catch (e) {}
        try { bot.on('error', clearFlush); } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}
}

function writeSnapshot(bot, reason, category = 'generic') {
  try {
    if (!bot) return null;
    const savesDir = _savesDir();
    // prepare environment snapshot and include episode log (trim if excessively large)
    const episode = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] };
    const trimTo = (arr, n) => { if (!Array.isArray(arr)) return arr; if (arr.length > n) return arr.slice(arr.length - n); return arr; };
    const episodeSafe = {
      inputs: trimTo(episode.inputs, 2000),
      outputs: trimTo(episode.outputs, 2000),
      actions: trimTo(episode.actions, 2000),
      planLog: trimTo(episode.planLog || [], 2000),
      truncated: (episode.inputs && episode.inputs.length > 2000) || (episode.outputs && episode.outputs.length > 2000) || (episode.actions && episode.actions.length > 2000)
    };

    const snap = {
      ts: Date.now(),
      reason: reason || 'manual',
      category,
      pos: bot.entity && bot.entity.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
      health: bot.health || 0,
      food: bot.food || 0,
      inventory: (bot.inventory && typeof bot.inventory.items === 'function') ? bot.inventory.items().map(i => ({ id: i.type, name: i.name, count: i.count })) : [],
      stats: bot._stats || {},
      planLog: bot._planLog || [],
      episodeLog: episodeSafe,
      nearbyEntities: Object.values(bot.entities || {}).map(e => ({ id: e.id, type: e.type, name: e.name, pos: e.position, health: e.metadata && e.metadata.health }))
    };
    const fname = `${category}-${Date.now()}.json`;
    const out = path.join(savesDir, fname);
    fs.writeFileSync(out, JSON.stringify(snap));
    return out;
  } catch (e) { return null; }
}

function mergeSavesAndPrune(keepPerCategory = 3) {
  const savesDir = _savesDir();
  if (!fs.existsSync(savesDir)) return;
  const files = fs.readdirSync(savesDir).filter(f => f.endsWith('.json'));
  const byCat = {};
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(savesDir, f), 'utf8'));
      const cat = j.category || 'generic';
      if (!byCat[cat]) byCat[cat] = [];
      // compute a heuristic score from stats
      let score = 0;
      if (j.stats) score += (j.stats.kills || 0) * 2 + (j.stats.blocksMined || 0) + (j.stats.itemsCollected || 0);
      // fallback to health+inventory as weak score
      if (score === 0) score = (j.health || 0) + ((j.inventory && j.inventory.length) || 0) * 0.1;
      byCat[cat].push({ path: path.join(savesDir, f), score, data: j });
    } catch (e) {}
  }
  // For each category produce a merged snapshot and promote best to models/<category>/
  const mergedPerCat = [];
  for (const cat of Object.keys(byCat)) {
    const arr = byCat[cat].sort((a,b)=>b.score-a.score);
    // delete lower ones beyond keepPerCategory in saves dir
    for (let i = keepPerCategory; i < arr.length; i++) {
      try { fs.unlinkSync(arr[i].path); } catch (e) {}
    }
    if (!arr.length) continue;
    // merge top few (up to keepPerCategory) into one representative
    const topSlice = arr.slice(0, keepPerCategory).map(x => x.data);
    let merged = topSlice[0];
    for (let i = 1; i < topSlice.length; i++) merged = _averageJson(merged, topSlice[i]);
    // compute representative score
    const repScore = arr[0].score || 0;
    // save merged snapshot into models/<cat>/ as merged candidate
    try {
      const outPath = saveCandidate(cat, merged, repScore);
      mergedPerCat.push({ cat, path: outPath, score: repScore, data: merged });
    } catch (e) {}
  }

  // Create an all-around combined snapshot from per-category merged entries
  if (mergedPerCat.length) {
    const toCombine = mergedPerCat.map(m => m.data);
    let combined = toCombine[0];
    for (let i = 1; i < toCombine.length; i++) combined = _averageJson(combined, toCombine[i]);
    const outPath = path.join(MODELS_ROOT, `best-all-${Date.now()}.json`);
    try { fs.writeFileSync(outPath, JSON.stringify(combined)); } catch (e) {}
    // also create a numbered labeled best-all copy
    try {
      const keep = parseInt(process.env.LABELED_KEEP || '5');
      const labelPrefix = `best-all`;
      const existing = fs.readdirSync(MODELS_ROOT).filter(f => f.startsWith(labelPrefix) && f.endsWith('.json'));
      const next = existing.length + 1;
      const labeled = path.join(MODELS_ROOT, `${labelPrefix}-${next}.json`);
      try { fs.copyFileSync(outPath, labeled); } catch (e) {}
      const labeledAll = fs.readdirSync(MODELS_ROOT).filter(f => f.startsWith(labelPrefix) && f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(MODELS_ROOT, f)).mtimeMs })).sort((a,b)=>b.m-a.m);
      for (let i = keep; i < labeledAll.length; i++) { try { fs.unlinkSync(path.join(MODELS_ROOT, labeledAll[i].f)); } catch (e) {} }
    } catch (e) {}

    // Optionally trigger a light fine-tune using the trainer if enabled
    try {
      if (process.env.ENABLE_FINE_TUNE === '1') {
        const { spawn } = require('child_process');
        const trainer = path.resolve(__dirname, '..', '..', 'train', 'neuroevolve.js');
        const env = Object.assign({}, process.env, { GENERATIONS: '6', TASKS: Object.keys(byCat).join(','), CONTINUOUS: '0' });
        const p = spawn(process.execPath, [trainer], { env, stdio: ['ignore','pipe','pipe'] });
        p.stdout.on('data', d => console.log('[fine-tune] ' + d.toString()));
        p.stderr.on('data', d => console.error('[fine-tune] ' + d.toString()));
        p.on('exit', (code) => {
          console.log('Fine-tune completed with code', code);
          try {
            // After fine-tune, look for trainer outputs (best-latest.json or best-final.json) and promote
            const candidateFiles = fs.readdirSync(MODELS_ROOT).filter(f => f.startsWith('best-latest') || f.startsWith('best-final') || f.startsWith('best-gen'));
            if (candidateFiles.length) {
              // move the newest candidate into models root as best-all and prune older best-all files
              const newest = candidateFiles.map(f => ({ f, m: fs.statSync(path.join(MODELS_ROOT, f)).mtimeMs })).sort((a,b)=>b.m-a.m)[0].f;
              const src = path.join(MODELS_ROOT, newest);
              const dest = path.join(MODELS_ROOT, `best-all-finetuned-${Date.now()}.json`);
              try { fs.copyFileSync(src, dest); console.log('Promoted fine-tuned model to', dest); } catch (e) {}
              // cleanup older best-all files, keep only latest
              try {
                const allBest = fs.readdirSync(MODELS_ROOT).filter(f => f.startsWith('best-all-') || f.startsWith('best-all-finetuned-')).map(f => ({ f, m: fs.statSync(path.join(MODELS_ROOT, f)).mtimeMs })).sort((a,b)=>b.m-a.m);
                for (let i = 1; i < allBest.length; i++) { try { fs.unlinkSync(path.join(MODELS_ROOT, allBest[i].f)); } catch (e) {} }
              } catch (e) {}
            }
          } catch (e) { console.warn('Post fine-tune promotion failed', e.message); }
        });
      }
    } catch (e) {}

    // Prune per-task model directories to keep only top N promoted candidates
    try {
      const keepPerTask = parseInt(process.env.MERGE_KEEP_PER_TASK || '1');
      const tasks = fs.readdirSync(MODELS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).filter(n => n !== 'saves');
      for (const t of tasks) {
        const dir = path.join(MODELS_ROOT, t);
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        const parsed = files.map(f => {
          const m = f.match(/-(\d+)\.json$/);
          const score = m ? parseInt(m[1], 10)/10000 : 0;
          return { f: path.join(dir, f), score };
        }).sort((a,b)=>b.score-a.score);
        for (let i = keepPerTask; i < parsed.length; i++) { try { fs.unlinkSync(parsed[i].f); } catch (e) {} }
      }
    } catch (e) {}

    return outPath;
  }
  return null;
}

module.exports = { saveCandidate, bestFor, combineTop, pruneGlobal, registerBot, mergeSavesAndPrune, writeSnapshot };
