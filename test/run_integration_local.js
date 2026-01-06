#!/usr/bin/env node
// Launches a local PaperMC server via test/dev_server.js and runs the integration_tasks.js test.

const path = require('path');
const { spawn } = require('child_process');
const dev = require('./dev_server');

async function run() {
  // start server
  console.log('Starting local dev server...');
  if (!await dev.checkJava()) { console.error('Java not found. Install Java and try again.'); process.exit(2); }

  if (!require('fs').existsSync(path.resolve(__dirname, 'server', 'paper.jar'))) {
    console.log('Downloading paper jar (this may take a minute)...');
    await dev.downloadPaper();
  }

  const serverProc = dev.launchServer();

  // Wait until server is ready by listening to stdout for Done message
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not become ready in time')), 120000);
    const onData = (d) => {
      const s = d.toString();
      if (/Done \(.*\)! For help, type \"help\"/i.test(s)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);
    serverProc.on('exit', (code) => { clearTimeout(timeout); reject(new Error('Server exited prematurely: ' + code)); });
  });

  // Run integration tests against localhost:25565
  console.log('Running integration tests...');
  const env = Object.assign({}, process.env, { MC_TEST_HOST: '127.0.0.1', MC_TEST_PORT: '25565', MC_TEST_USERNAME: 'LocalTestBot' });
  const testProc = spawn(process.execPath, [require.resolve('./integration_tasks.js')], { env, stdio: 'inherit' });

  testProc.on('exit', (code) => {
    console.log('Integration tests finished with code', code);
    console.log('Stopping server...');
    try { serverProc.kill(); } catch (e) {}
    process.exit(code || 0);
  });
}

run().catch(err => { console.error(err); process.exit(2); });