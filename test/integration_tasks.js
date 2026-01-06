// Integration test: connects to a local Minecraft server (provide MC_TEST_HOST and MC_TEST_PORT env vars)
// and runs a sequence of tasks to ensure they operate without throwing. This is a lightweight integration smoke test.

const mineflayer = require('mineflayer');
const tasks = require('../modules/tasks');

async function run() {
  const host = process.env.MC_TEST_HOST || null;
  const port = process.env.MC_TEST_PORT ? parseInt(process.env.MC_TEST_PORT) : null;
  const username = process.env.MC_TEST_USERNAME || 'TestBot';
  if (!host || !port) {
    console.log('MC_TEST_HOST/PORT not set — skipping integration test. To run, set env and ensure a local server is running.');
    process.exit(0);
  }

  console.log('Connecting to test server', host, port);
  const bot = mineflayer.createBot({ host, port, username });

  bot.once('spawn', async () => {
    console.log('Bot spawned in integration test');
    try {
      // Run mine
      console.log('Running mine auto');
      await require('../modules/tasks/mine').run(bot, ['auto']);
      // Run collect
      console.log('Running collect any');
      await require('../modules/tasks/collect').run(bot, ['any']);
      // Run build
      console.log('Running build house');
      await require('../modules/tasks/build').run(bot, ['house']);
      // PVP (short)
      console.log('Running pvp (short)');
      await require('../modules/tasks/pvp').run(bot, ['nearest'], { duration: 10000 });
      // Empire
      console.log('Running empire');
      await require('../modules/tasks/empire').run(bot, []);
      // Speedrun (check it doesn't crash)
      console.log('Running speedrun (dry)');
      await require('../modules/tasks/speedrun').run(bot, []);

      console.log('Integration test tasks completed successfully');
      process.exit(0);
    } catch (err) {
      console.error('Integration test failed:', err.message || err);
      process.exit(2);
    } finally {
      try { bot.quit(); } catch (e) {}
    }
  });

  bot.on('error', (err) => { console.error('Bot error:', err.message || err); });
}

run().catch(err => { console.error(err); process.exit(2); });