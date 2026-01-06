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
    // Save manager stub: disabled per user request. All functions are no-ops or safe fallbacks.
    function saveCandidate() { return null; }
    function bestFor() { return null; }
    function combineTop() { return null; }
    function pruneGlobal() { /* no-op */ }
    function revampSaveSystem() { /* no-op */ }

    module.exports = { saveCandidate, bestFor, combineTop, pruneGlobal, revampSaveSystem };
      try { if (fs.existsSync(chkPath)) candidates.push(JSON.parse(fs.readFileSync(chkPath,'utf8'))); } catch (e) {}
      if (candidates.length) {
        let combined = candidates[0];
        for (let i = 1; i < candidates.length; i++) combined = _averageJson(combined, candidates[i]);
        mergedPerGen.push(combined);
      }
      // remove originals for storage savings
      try { if (fs.existsSync(bestPath)) fs.unlinkSync(bestPath); } catch (e) {}
      try { if (fs.existsSync(chkPath)) fs.unlinkSync(chkPath); } catch (e) {}
    }
    if (mergedPerGen.length) {
      let final = mergedPerGen[0];
      for (let i = 1; i < mergedPerGen.length; i++) final = _averageJson(final, mergedPerGen[i]);
      const outName = `revamped-merged-${Date.now()}.json`;
      fs.writeFileSync(path.join(MODELS_ROOT, outName), JSON.stringify(final));
    }
  } catch (e) {
    // ignore errors during revamp
  }
}

module.exports = { saveCandidate, bestFor, combineTop, pruneGlobal, revampSaveSystem };
