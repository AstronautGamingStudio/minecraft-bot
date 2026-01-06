const fs = require('fs');
const path = require('path');
const CONFIG_PATH = path.resolve(__dirname, 'bot.config.json');

function load() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { persistModel: null, autoWatch: false, autoStartModel: false };
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Object.assign({ persistModel: null, autoWatch: false, autoStartModel: false }, cfg);
  } catch (e) { return { persistModel: null, autoWatch: false, autoStartModel: false }; }
}

function save(cfg) {
  const merged = Object.assign({ persistModel: null, autoWatch: false, autoStartModel: false, authAutoRefresh: false }, cfg);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

module.exports = { load, save, path: CONFIG_PATH };
