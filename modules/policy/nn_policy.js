const fs = require('fs');
const path = require('path');
const neataptic = require('neataptic');

let loadedNetwork = null;
let watcher = null;

function loadModel(modelPath) {
  if (!fs.existsSync(modelPath)) throw new Error('Model not found: ' + modelPath);
  const json = JSON.parse(fs.readFileSync(modelPath));
  loadedNetwork = neataptic.Network.fromJSON(json);
  console.log('Model loaded:', modelPath);
}

function available() { return !!loadedNetwork; }

function act(observation) {
  if (!loadedNetwork) throw new Error('No model loaded');
  const out = loadedNetwork.activate(observation);
  const action = out.indexOf(Math.max(...out));
  return action; // 0..4 mapping to collect env actions
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

module.exports = { loadModel, act, available, startWatch, stopWatch };
