module.exports = {
  async run(bot, args = [], options = {}) {
    bot._taskStopRequested = false;
    bot.chat('Starting empire orchestration: mine -> collect -> build');
    // auto-load per-task specialist model if available
    try {
      const manager = require('../models/manager');
      const pm = manager.bestFor('empire');
      if (pm) {
        try { require('../policy/nn_policy').loadModel(pm); bot.chat('Loaded specialist model for empire.'); } catch (e) {}
      }
    } catch (e) {}
    try {
      const mine = require('./mine');
      await mine.run(bot, ['auto']);
    } catch (e) { bot.chat('Mine step failed: ' + e.message); }
    try {
      const collect = require('./collect');
      await collect.run(bot, ['any']);
    } catch (e) { bot.chat('Collect step failed: ' + e.message); }
    try {
      const build = require('./build');
      await build.run(bot, ['house']);
    } catch (e) { bot.chat('Build step failed: ' + e.message); }

    bot.chat('Empire orchestration finished');
  }
};
