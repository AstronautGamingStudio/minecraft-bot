const fs = require('fs');
const path = require('path');
const neataptic = require('neataptic');

let loadedNetwork = null;
let watcher = null;
let taskWatchers = {};
let config = { epsilon: 0.05, outputs: 5, inputs: 10 };

function loadModel(modelPath) {
  if (!fs.existsSync(modelPath)) throw new Error('Model not found: ' + modelPath);
  const json = JSON.parse(fs.readFileSync(modelPath));
  // detect model input size from JSON (count input nodes if available)
  let modelInputSize = null;
  try {
    if (Array.isArray(json.nodes)) {
      modelInputSize = json.nodes.filter(n => n.type === 'input').length;
    } else if (typeof json.input === 'number') {
      modelInputSize = json.input;
    }
  } catch (e) { modelInputSize = null; }

  // If JSON model has fewer inputs than current config, attempt to auto-convert by
  // adding isolated input nodes and small random outgoing connections so new inputs can influence the net.
  if (typeof modelInputSize === 'number' && modelInputSize < config.inputs) {
    try {
      const nodes = Array.isArray(json.nodes) ? json.nodes.slice() : [];
      const connections = Array.isArray(json.connections) ? json.connections.slice() : [];
      const maxId = nodes.reduce((m, n) => Math.max(m, (typeof n.id === 'number' ? n.id : -1)), -1);
      const addCount = config.inputs - modelInputSize;
      const newIds = [];
      for (let k = 0; k < addCount; k++) {
        const nid = maxId + 1 + k;
        newIds.push(nid);
        nodes.push({ id: nid, type: 'input', bias: 0, squash: 'LOGISTIC' });
      }
      // connect new inputs to all non-input nodes with small random weights
      for (const nid of newIds) {
        for (const target of nodes) {
          if (target.type && target.type !== 'input') {
            connections.push({ from: nid, to: target.id, weight: (Math.random() * 0.2) - 0.1 });
          }
        }
      }
      json.nodes = nodes;
      json.connections = connections;
      // save a converted copy for inspection
      try {
        const outPath = path.join(path.dirname(modelPath), `converted-${path.basename(modelPath)}`);
        fs.writeFileSync(outPath, JSON.stringify(json));
        console.log('Saved converted model to', outPath);
      } catch (e) { /* ignore save errors */ }
    } catch (e) { console.warn('Model auto-conversion failed:', e.message); }
  }

  loadedNetwork = neataptic.Network.fromJSON(json);
  // attach detected input size for runtime observation mapping
  loadedNetwork._modelInputSize = modelInputSize;
  console.log('Model loaded:', modelPath, 'modelInputSize=', modelInputSize);
}

function available() { return !!loadedNetwork; }

function softmax(arr) {
  const max = Math.max(...arr);
  const exps = arr.map(v => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(e => e / sum);
}

function randomAction() {
  return Math.floor(Math.random() * config.outputs);
}

function act(observation) {
  // Returns action index 0..outputs-1. Uses epsilon-greedy when model present,
  // otherwise falls back to a simple heuristic based on observation shape
  if (loadedNetwork) {
    if (Math.random() < config.epsilon) return randomAction();
    // If model expects a different input size, map/truncate/pad observation
    let obs = observation;
    const midx = loadedNetwork._modelInputSize;
    if (typeof midx === 'number' && midx !== observation.length) {
      if (observation.length > midx) {
        // truncate extra features (keep prefix); this is a cheap compatibility mapping
        obs = observation.slice(0, midx);
      } else {
        // pad with zeros
        obs = observation.concat(Array(midx - observation.length).fill(0));
      }
    }
    const out = loadedNetwork.activate(obs);
    // choose argmax
    const action = out.indexOf(Math.max(...out));
    return action;
  }
  // fallback heuristic: obs = [ax, az, dx, dz, itemsLeft, remaining]
  return heuristicAct(observation);
}

function predictProbs(observation) {
  if (!loadedNetwork) throw new Error('No model loaded');
  const out = loadedNetwork.activate(observation);
  return softmax(out);
}

function heuristicAct(observation) {
  if (!observation || observation.length < 6) return randomAction();
  const [ax, az, dx, dz, itemsLeft] = observation;
  // If item is very close (dx,dz near zero) -> interact/pick (last action)
  const dist = Math.hypot(dx, dz);
  if (itemsLeft > 0 && dist < 0.15) return config.outputs - 1;
  // Prefer moving along the larger axis towards the item
  if (Math.abs(dx) > Math.abs(dz)) {
    return dx < 0 ? 2 : 3; // left or right
  } else {
    return dz < 0 ? 0 : 1; // up (north) or down (south) in sim mapping
  }
}

function setConfig(opts = {}) {
  if (typeof opts.epsilon === 'number') config.epsilon = Math.max(0, Math.min(1, opts.epsilon));
  if (typeof opts.outputs === 'number') config.outputs = opts.outputs;
}

function startWatch(modelPath) {
  stopWatch();
  watcher = fs.watch(modelPath, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      try {
        loadModel(modelPath);
        console.log('Auto-reloaded model due to file change');
      } catch (e) {
        console.warn('Auto-reload failed:', e.message);
      }
    }
  });
  console.log('Started watching model:', modelPath);
}

function stopWatch() {
  if (watcher) { watcher.close(); watcher = null; console.log('Stopped model watch'); }
}

function loadBestForTask(task) {
  try {
    const manager = require('../models/manager');
    const best = manager.bestFor(task);
    if (best) {
      loadModel(best);
      console.log('Loaded per-task best for', task, best);
      return true;
    }
  } catch (e) { console.warn('loadBestForTask failed:', e.message); }
  return false;
}

function startTaskWatch(task) {
  stopTaskWatch(task);
  try {
    const dir = require('path').resolve(__dirname, '..', '..', 'models', task);
    if (!fs.existsSync(dir)) return false;
    const w = fs.watch(dir, (ev, fname) => {
      if (!fname) return;
      // on any new/changed file, load best candidate
      try { loadBestForTask(task); } catch (e) { console.warn('task watch load failed', e.message); }
    });
    taskWatchers[task] = w;
    console.log('Started task watcher for', task);
    // attempt initial load
    loadBestForTask(task);
    return true;
  } catch (e) { console.warn('startTaskWatch failed:', e.message); return false; }
}

function stopTaskWatch(task) {
  try {
    if (taskWatchers[task]) { taskWatchers[task].close(); delete taskWatchers[task]; console.log('Stopped task watcher for', task); }
  } catch (e) {}
}

function startAllTaskWatches() {
  try {
    const MODELS_ROOT = require('path').resolve(__dirname, '..', '..', 'models');
    if (!fs.existsSync(MODELS_ROOT)) return false;
    const items = fs.readdirSync(MODELS_ROOT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).filter(n => n !== 'saves');
    for (const t of items) startTaskWatch(t);
    return true;
  } catch (e) { console.warn('startAllTaskWatches failed', e.message); return false; }
}

function stopAllTaskWatches() {
  try { Object.keys(taskWatchers).forEach(t => stopTaskWatch(t)); return true; } catch (e) { return false; }
}

module.exports = { loadModel, act, available, startWatch, stopWatch, predictProbs, setConfig };
