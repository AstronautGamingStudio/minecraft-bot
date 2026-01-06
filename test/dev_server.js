#!/usr/bin/env node
// Downloads a PaperMC server jar, writes eula.txt=true, and launches the server in test/server
// Exits when server process exits. Requires Java (check via `java -version`).

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const fetch = require('node-fetch');

const SERVER_DIR = path.resolve(__dirname, 'server');
const JAR_PATH = path.join(SERVER_DIR, 'paper.jar');

async function checkJava() {
  return new Promise((resolve) => {
    const p = spawn('java', ['-version']);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0 || code === null));
  });
}

async function downloadPaper() {
  // Query Paper API to get latest version and build
  const versionsRes = await fetch('https://api.papermc.io/v2/projects/paper');
  const versionsJson = await versionsRes.json();
  const versions = versionsJson.versions;
  const version = versions[versions.length-1];
  const buildsRes = await fetch(`https://api.papermc.io/v2/projects/paper/versions/${version}`);
  const buildsJson = await buildsRes.json();
  const build = buildsJson.builds[buildsJson.builds.length-1];
  const downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${build}/downloads/paper-${version}-${build}.jar`;

  console.log('Downloading PaperMC', version, 'build', build);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error('Failed to download paper jar: ' + res.status);
  const data = await res.buffer();
  fs.mkdirSync(SERVER_DIR, { recursive: true });
  fs.writeFileSync(JAR_PATH, data);
  console.log('Saved paper.jar to', JAR_PATH);
}

function launchServer() {
  // write eula
  fs.writeFileSync(path.join(SERVER_DIR, 'eula.txt'), 'eula=true\n');
  const proc = spawn('java', ['-Xmx1024M', '-jar', JAR_PATH, 'nogui'], { cwd: SERVER_DIR });
  proc.stdout.on('data', d => { process.stdout.write('[server] ' + d.toString()); });
  proc.stderr.on('data', d => { process.stderr.write('[server] ' + d.toString()); });
  return proc;
}

async function main() {
  const hasJava = await checkJava();
  if (!hasJava) { console.error('Java not found in PATH. Please install Java (JRE/JDK) to run the server.'); process.exit(2); }
  if (!fs.existsSync(JAR_PATH)) {
    try { await downloadPaper(); } catch (e) { console.error('Failed to download server jar:', e.message); process.exit(2); }
  }

  const proc = launchServer();

  // Wait for Done message in stdout to consider server ready
  let ready = false;
  const onData = (d) => {
    const s = d.toString();
    if (!ready && /Done \(.*\)! For help, type "help"/i.test(s)) {
      ready = true;
      console.log('Server reported ready.');
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('exit', (code) => { console.log('Server process exited', code); process.exit(code || 0); });
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(2); });

module.exports = { checkJava, downloadPaper, launchServer };