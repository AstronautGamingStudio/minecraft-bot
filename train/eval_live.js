#!/usr/bin/env node
const mineflayer = require('mineflayer');
const policy = require('../modules/policy/nn_policy');
const adapter = require('../modules/policy/live_adapter');

const argv = process.argv.slice(2);
const host = argv[0] || 'localhost';
const port = argv[1] ? parseInt(argv[1]) : undefined;
const username = argv[2] || 'EvalBot';
const model = argv[3] || 'models/best-latest.json';

async function runEval() {
  if (!model) throw new Error('Provide model path');
  policy.loadModel(model);

  console.log('Connecting to', host, port || '(default) as', username);
  const bot = mineflayer.createBot({ host, port, username });

  bot.on('spawn', async () => {
    console.log('Bot spawned, starting model-driven collect for a brief demo');
    try {
      await adapter.runCollect(bot, { stepDelay: 600, maxSteps: 400 });
      console.log('Eval run completed');
      process.exit(0);
    } catch (e) {
      console.error('Eval error:', e.message);
      process.exit(2);
    }
  });

  bot.on('error', (err) => console.error('Bot error:', err));
}

if (require.main === module) runEval().catch(e=>{ console.error(e); process.exit(1); });

module.exports = { runEval };
