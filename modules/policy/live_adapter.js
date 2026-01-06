const policy = require('./nn_policy');
const input = require('../brain/input');
const logic = require('../brain/logic');
const action = require('../brain/action');
let pathfinder, Movements;
try { ({ pathfinder, Movements } = require('mineflayer-pathfinder')); } catch (e) { /* optional */ }


// Safe runtime model-controlled collect loop. Runs until stopped or timeout.
module.exports = {
  async runCollect(bot, opts = {}) {
    try { if (pathfinder) bot.loadPlugin(pathfinder); } catch (e) {}
    try {
      if (typeof Movements === 'function') {
        const defaultMove = new Movements(bot);
        if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(defaultMove);
      }
    } catch (e) { console.warn('live_adapter: failed to set pathfinder movements', e && e.message); }

    const maxSteps = opts.maxSteps || 200;
    const stepDelay = opts.stepDelay || 500; // ms between model steps
    const pathTimeout = opts.pathTimeout || 8000; // ms to wait for path

    if (bot._modelController && bot._modelController.running) {
      throw new Error('Model controller already running');
    }

    // allow external override of policy params
    if (typeof opts.epsilon === 'number' && policy.setConfig) policy.setConfig({ epsilon: opts.epsilon });

    let stopRequested = false;
    bot._modelController = { running: true, stop: () => { stopRequested = true; } };

    const startTime = Date.now();

    try {
      let steps = 0;
      while (!stopRequested && steps < maxSteps) {
        const obs = input.buildObservation(bot, { startTime, timeout: opts.timeout });
        if (!obs) break;
        const actIdx = logic.decide(bot, obs, { epsilon: opts.epsilon });
        await action.performAction(bot, actIdx, { pathTimeout, radiusBlocks: opts.radiusBlocks, stepSize: opts.stepSize });

        steps++;
        await new Promise(r => setTimeout(r, stepDelay));
      }
    } finally {
      bot._modelController.running = false;
      bot._modelController = null;
    }
    return;
  }
};
