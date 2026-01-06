// Basic smoke test: ensure each task module exports an async run function
const fs = require('fs');
const path = require('path');
const tasks = ['collect','mine','build','pvp','empire','speedrun'];
let ok = true;
for (const t of tasks) {
  const modPath = path.resolve(__dirname, '..', 'modules', 'tasks', t + '.js');
  if (!fs.existsSync(modPath)) {
    console.error('Missing task module:', t);
    ok = false; continue;
  }
  const mod = require(modPath);
  if (!mod.run || typeof mod.run !== 'function') {
    console.error('Task module does not export run():', t);
    ok = false; continue;
  }
  console.log('Task module ok:', t);
}
process.exit(ok ? 0 : 2);