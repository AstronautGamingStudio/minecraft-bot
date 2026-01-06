const { run } = require('../neuroevolve');
const fs = require('fs');
const path = require('path');

// Run a short train session and assert that fitness improves over time
(async function test() {
  console.log('Starting short test training (fast).');
  process.env.GENERATIONS = '8';
  process.env.POP_SIZE = '20';
  process.env.EPISODES = '2';
  process.env.TASKS = 'collect,mine';

  const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models');
  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

  // remove previous logs to clearly capture this run
  const logPath = path.join(MODELS_DIR, 'fitness.log');
  try { fs.unlinkSync(logPath); } catch (e) {}

  await run();

  // After running, check fitness.log for improvement trend
  const log = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(l=>({ t: l.split(',')[0], gen: parseInt(l.split(',')[1]), score: parseFloat(l.split(',')[2]) }));
  console.log('Fitness entries:', log.length);
  if (log.length < 2) { console.error('Not enough entries to judge improvement'); process.exit(1); }

  const first = log[0].score; const last = log[log.length-1].score;
  console.log(`First best score: ${first}, Last best score: ${last}`);
  if (last >= first) {
    console.log('Test passed: best score improved or stayed equal (ok)');
    process.exit(0);
  } else {
    console.error('Test failed: best score decreased');
    process.exit(2);
  }
})();
