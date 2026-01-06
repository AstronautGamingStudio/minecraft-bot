const fs = require('fs');
const path = require('path');
const neataptic = require('neataptic');

let loadedNetwork = null;
let watcher = null;
let config = { epsilon: 0.05, outputs: 5 };

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

module.exports = { loadModel, act, available, startWatch, stopWatch, predictProbs, setConfig };
