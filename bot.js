#!/usr/bin/env node
const mineflayer = require('mineflayer');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const eq = process.argv.find(a => a.startsWith(name + '='));
  if (eq) return eq.split('=')[1];
  return undefined;
}

const host = getArg('--host') || getArg('--server') || 'localhost';
const port = getArg('--port') ? parseInt(getArg('--port')) : undefined;
const username = getArg('--username') || getArg('--user') || 'Bot';
const password = getArg('--password') || undefined;
const version = getArg('--version') || undefined;

const options = { host, username };
if (port) options.port = port;
if (password) options.password = password;
if (version) options.version = version;

// Support reading saved auth tokens from auth/auth.json (optional)
try {
  const authPath = require('path').resolve(__dirname, 'auth.json');
  if (require('fs').existsSync(authPath)) {
    const saved = JSON.parse(require('fs').readFileSync(authPath, 'utf8'));
    if (saved.method === 'microsoft') {
      options.auth = 'microsoft';
      if (saved.mcAccessToken) {
        options.accessToken = saved.mcAccessToken;
        console.log('Using Minecraft access token from auth/auth.json (mcAccessToken).');
      } else if (saved.accessToken) {
        options.accessToken = saved.accessToken;
        console.log('Using Microsoft access token from auth/auth.json (may require XSTS exchange).');
      } else {
        console.log('auth/auth.json exists with method=microsoft but no access or mcAccessToken found; run `npm run auth:device` to obtain tokens.');
      }
      if (saved.profile && saved.profile.name) options.username = saved.profile.name;
    } else if (saved.method === 'mojang') {
      options.auth = 'mojang';
      if (saved.username) options.username = saved.username;
      if (saved.password) options.password = saved.password;
      console.log('Using Mojang credentials from auth/auth.json');
    }
  }
} catch (e) { console.warn('Failed to load auth/auth.json:', e.message); }

// Wrap bot creation so we can reconnect when auth changes on disk
const config = require('./config');
const { spawn } = require('child_process');

let bot = null;
const authFilePath = require('path').resolve(__dirname, 'auth.json');
let reconnecting = false;

function buildOptionsFromArgsAndAuth() {
  const opts = Object.assign({}, options);
  try {
    if (require('fs').existsSync(authFilePath)) {
      const saved = JSON.parse(require('fs').readFileSync(authFilePath, 'utf8'));
      if (saved.method === 'microsoft') {
        opts.auth = 'microsoft';
        if (saved.mcAccessToken) {
          opts.accessToken = saved.mcAccessToken;
          console.log('Using Minecraft access token from auth/auth.json (mcAccessToken).');
        } else if (saved.accessToken) {
          opts.accessToken = saved.accessToken;
          console.log('Using Microsoft access token from auth/auth.json (may require XSTS exchange).');
        }
        if (saved.profile && saved.profile.name) opts.username = saved.profile.name;
      } else if (saved.method === 'mojang') {
        opts.auth = 'mojang';
        if (saved.username) opts.username = saved.username;
        if (saved.password) opts.password = saved.password;
        console.log('Using Mojang credentials from auth/auth.json');
      }
    }
  } catch (e) { console.warn('Failed to load auth/auth.json:', e.message); }
  return opts;
}

function startBot() {
  const startOptions = buildOptionsFromArgsAndAuth();
  console.log('Connecting with options:', Object.assign({}, startOptions, { password: startOptions.password ? '****' : undefined }));

  bot = mineflayer.createBot(startOptions);

  // Protect against accidental quits: only allow quit/end when bot._allowQuit === true
  try {
    bot._allowQuit = false;
    if (typeof bot.quit === 'function') {
      bot._origQuit = bot.quit.bind(bot);
      bot.quit = function(msg) {
        if (bot._allowQuit) return bot._origQuit(msg);
        console.log('Blocked quit call (not allowed):', msg);
      };
    }
    if (typeof bot.end === 'function') {
      bot._origEnd = bot.end.bind(bot);
      bot.end = function() {
        if (bot._allowQuit) return bot._origEnd();
        console.log('Blocked end call (not allowed)');
      };
    }
  } catch (e) {}

  // Rate-limited chat queue to avoid chat-spam kicks (runtime-configurable)
  try {
    bot._chatQueue = [];
    bot._chatBusy = false;
    bot._chatHistory = []; // {msg, ts}
    // pull persisted chat settings from config if present
    const cfgChat = (config.load && config.load().chat) || {};
    bot._chatMinMs = parseInt(process.env.CHAT_MIN_MS || cfgChat.minMs || '1200');
    bot._chatWindowMs = parseInt(process.env.CHAT_WINDOW_MS || cfgChat.windowMs || '30000');
    bot._chatMaxPerWindow = parseInt(process.env.CHAT_MAX_PER_WINDOW || cfgChat.maxPerWindow || '6');

    bot._enqueueChat = function (message) {
      if (!message || typeof message !== 'string') return;
      const msg = message.trim(); if (!msg) return;
      const now = Date.now();
      if (bot._chatHistory.some(h => h.msg === msg && (now - h.ts) < bot._chatWindowMs)) return;
      bot._chatHistory = bot._chatHistory.filter(h => (now - h.ts) < bot._chatWindowMs);
      if (bot._chatHistory.length >= bot._chatMaxPerWindow) return; // drop to avoid kick
      bot._chatHistory.push({ msg, ts: now });
      const lastQueued = bot._chatQueue.length ? bot._chatQueue[bot._chatQueue.length - 1] : null;
      if (lastQueued === msg) return;
      bot._chatQueue.push(msg);
      if (!bot._chatBusy) bot._processChatQueue();
    };

    bot._processChatQueue = function () {
      if (bot._chatQueue.length === 0) { bot._chatBusy = false; return; }
      bot._chatBusy = true;
      const next = bot._chatQueue.shift();
      try {
        if (!bot._rawChat && typeof bot.chat === 'function') bot._rawChat = bot.chat.bind(bot);
        if (bot._rawChat) bot._rawChat(next);
      } catch (e) {}
      const jitter = Math.floor(Math.random()*400);
      setTimeout(() => bot._processChatQueue(), bot._chatMinMs + jitter);
    };
    // override chat to enqueue messages
    if (typeof bot.chat === 'function') {
      if (!bot._rawChat) bot._rawChat = bot.chat.bind(bot);
      bot.chat = function (message) { bot._enqueueChat(message); };
    } else {
      bot.chat = function (message) { bot._enqueueChat(message); };
    }
  } catch (e) { console.warn('Failed to setup chat queue:', e && e.message); }

  bot.on('spawn', () => {
    console.log(`✅ Connected as ${bot.username}`);
    // clear reconnect flag on successful spawn
    reconnecting = false;
    try { bot.chat('Hello! I am a simple bot.'); } catch (e) { /* may fail on headless servers */ }

    // Auto-defend: if health drops and a hostile is nearby, engage PvP task automatically
    try {
      bot._lastHealth = bot.health;
      bot.on('health', () => {
        try {
          const prev = bot._lastHealth || bot.health;
          if (bot.health < prev) {
            // damage observed — prefer the last known attacker if available, otherwise nearest hostile
            let attacker = null;
            try {
              const logic = require('./modules/brain/logic');
              attacker = logic.getLastAttacker(bot) || logic.getNearestHostile(bot);
            } catch (e) {}
            if (attacker) {
              try { bot.chat('Under attack by ' + (attacker.username || attacker.name || attacker.type) + ' — engaging attacker.'); } catch (e) {}
              try {
                const p = require('./modules/tasks/pvp').run(bot, [attacker], { duration: 60000 });
                if (p && p.catch) p.catch(err => console.warn('PvP task failed:', err && (err.message || err)));
              } catch (e) { console.warn('Failed to launch PvP task:', e && e.message); }
            } else {
              try { bot.chat('Damage observed but no attacker identified.'); } catch (e) {}
            }
          }
        } catch (e) {}
        bot._lastHealth = bot.health;
      });
    } catch (e) { /* ignore health listener errors */ }

    // initialize global logic hostile tracker
    try { const logic = require('./modules/brain/logic'); logic.init(bot); } catch (e) {}

    // register bot with model manager to enable snapshot saves on exit
    try { const manager = require('./modules/models/manager'); manager.registerBot(bot, 'generic'); } catch (e) {}

    // Console stdin chat bridge
    try {
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (data) => {
        const msg = data.toString().trim();
        if (!msg || !bot) return;
        try { bot.chat(msg); } catch (e) { console.warn('Failed to send chat:', e.message); }
      });
    } catch (e) { /* ignore stdin setup errors */ }

    // Auto-load persisted model if present
    try {
      const cfg = config.load();
      if (cfg && cfg.persistModel) {
        const policy = require('./modules/policy/nn_policy');
        try {
          policy.loadModel(cfg.persistModel);
          bot.chat('Persisted model loaded: ' + cfg.persistModel);
          if (cfg.autoWatch) { policy.startWatch(cfg.persistModel); bot.chat('Watching model file for updates.'); }
          if (cfg.autoStartModel) {
            try {
              const adapter = require('./modules/policy/live_adapter');
              adapter.runCollect(bot, { stepDelay: 700, maxSteps: 60000 }).catch(err => { console.error('Auto-start model error:', err); });
              bot.chat('Auto-started model controller');
            } catch (e) { bot.chat('Failed to autostart model: '+e.message); }
          }
        } catch (e) {
          console.warn('Failed to load persisted model:', e.message);
        }
      }

      // Optionally start auth autorefresh loop if configured and refresh token available
      if (cfg && cfg.authAutoRefresh) {
        try {
          const refresher = require('./auth/refresh_tokens');
          // simple loop: refresh every 20 minutes
          setInterval(() => {
            refresher.refresh().then(() => console.log('Auth refreshed (autoloop)')).catch(e => console.warn('Auto-refresh failed', e.message));
          }, (process.env.AUTH_REFRESH_MINUTES ? parseInt(process.env.AUTH_REFRESH_MINUTES) : 20) * 60 * 1000);
          console.log('Auth autorefresh loop started');
        } catch (e) { console.warn('Failed to start auth autorefresh:', e.message); }
      }
    } catch (e) { console.warn('Config load failed:', e.message); }

    // Register bot with model manager to save snapshot on exit
    try {
      const manager = require('./modules/models/manager');
      manager.registerBot(bot, 'generic');
    } catch (e) { /* ignore */ }
  });

  // aggressive dig toggle (disabled by default unless env set)
  bot._aggressiveDig = (process.env.ALLOW_AGGRESSIVE_DIG === '1' || process.env.ALLOW_AGGRESSIVE_DIG === 'true') || false;

  const { tasks } = require('./bot-commands');

  bot.on('chat', async (username, message) => {
    console.log(`<${username}> ${message}`);
    if (!bot || username === bot.username) return;

    // Auto-respond to greetings
    if (/^(!)?(hello|hi|hey)/i.test(message)) {
      try { bot.chat(`Hi ${username}!`); } catch (e) { /* ignore */ }
    }

    // Command handling: commands start with '!'
    if (message.startsWith('!')) {
      const parts = message.slice(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      try {
        if (tasks[cmd]) {
          // clear any previous stop request and run
          bot._taskStopRequested = false;
          await tasks[cmd].run(bot, args, {});
        } else if (cmd === 'train') {
          const sub = args[0];
          if (sub === 'start') {
            try { bot.chat('Starting local trainer (background).'); } catch (e) {}
            try { const ok = startTrainer(); bot.chat(ok ? 'Trainer started' : 'Trainer already running'); } catch (e) { console.error(e); bot.chat('Failed to start trainer: '+(e.message||e)); }
          } else if (sub === 'status') {
            try { bot.chat('Trainer status: ' + (trainerProc ? 'running' : 'stopped')); } catch (e) {}
          } else if (sub === 'stop') {
            try { const ok = stopTrainer(); bot.chat(ok ? 'Trainer stop requested' : 'Trainer was not running'); } catch (e) { bot.chat('Failed to stop trainer: '+(e.message||e)); }
          } else {
            try { bot.chat('Usage: !train start|status|stop'); } catch (e) {}
          }
        } else if (cmd === 'loadmodel' || cmd === 'load' || cmd === 'l') {
          const target = args[0] || 'models/best-latest.json';
          try {
            const policy = require('./modules/policy/nn_policy');
            policy.loadModel(target);
            bot.chat(`Model loaded: ${target}`);
          } catch (err) {
            bot.chat(`Failed to load model: ${err.message}`);
          }
        } else if (cmd === 'watchmodel' || cmd === 'watch' || cmd === 'w') {
          const action = args[0];
          const policy = require('./modules/policy/nn_policy');
          const target = args[1] || 'models/best-latest.json';
          if (action === 'start' || action === 's') {
            try { policy.startWatch(target); bot.chat(`Watching model file: ${target}`); } catch (e) { bot.chat('Watch error: '+e.message); }
          } else if (action === 'stop' || action === 'x') {
            policy.stopWatch(); bot.chat('Stopped watching models');
          } else {
            bot.chat('Usage: !watch start|stop [path]');
          }
        } else if (cmd === 'learn') {
          const action = args[0];
          try {
            if (action === 'start') {
              const started = startTrainer();
              const mw = startModelWatcher(true);
              bot.chat(started ? 'Learn started: trainer running and autodeploy enabled.' : 'Learn: trainer already running');
            } else if (action === 'stop') {
              const stopped = stopTrainer();
              stopModelWatcher();
              bot.chat(stopped ? 'Learn stopped and autodeploy disabled.' : 'Learn: trainer not running');
            } else if (action === 'status') {
              bot.chat('Learn status: trainer ' + (trainerProc ? 'running' : 'stopped') + ', modelWatcher ' + (modelWatcher ? 'enabled' : 'disabled'));
            } else {
              bot.chat('Usage: !learn start|stop|status');
            }
          } catch (e) { bot.chat('Learn command failed: ' + e.message); }
        } else if (cmd === 'persistmodel' || cmd === 'persist' || cmd === 'p') {
          const sub = args[0];
          const cfg = config.load();
          if (sub === 'set') {
            const target = args[1];
            const auto = args[2] === 'watch';
            const autostart = args[2] === 'autostart' || args[3] === 'autostart';
            cfg.persistModel = target;
            cfg.autoWatch = !!auto;
            cfg.autoStartModel = !!autostart;
            config.save(cfg);
            bot.chat(`Persisted model set to ${target} (autoWatch=${auto}, autoStart=${autostart})`);
          } else if (sub === 'clear') {
            cfg.persistModel = null; cfg.autoWatch = false; cfg.autoStartModel = false; config.save(cfg);
            bot.chat('Persisted model cleared');
          } else if (sub === 'status') {
            bot.chat('Persist model: ' + (cfg.persistModel || 'none') + ' autoWatch: ' + !!cfg.autoWatch + ' autoStart: ' + !!cfg.autoStartModel);
          } else {
            bot.chat('Usage: !persist set <path> [watch] [autostart]|clear|status');
          }
        } else if (cmd === 'stopcollect' || cmd === 'stopc') {
          if (bot._modelController && bot._modelController.running) {
            bot._modelController.stop();
            bot.chat('Model collect stop requested');
          } else {
            bot.chat('No model collect controller running');
          }
        } else if (cmd === 'end' || cmd === 'stopall' || cmd === 'stop') {
          bot._taskStopRequested = true;
          try { if (bot._modelController && bot._modelController.running) bot._modelController.stop(); } catch (e) {}
          try { stopTrainer(); } catch (e) {}
          try { stopModelWatcher(); } catch (e) {}
          bot.chat('Stop requested: attempting to cancel running tasks and controllers.');
        } else if (cmd === 'auth') {
          const sub = args[0];
          if (sub === 'refresh') {
            const refresher = require('./auth/refresh_tokens');
            refresher.refresh().then(saved => bot.chat('Auth refreshed.')).catch(e => bot.chat('Refresh failed: '+e.message));
          } else if (sub === 'status') {
            try { const saved = require('./auth.json'); bot.chat('Auth status: method='+saved.method+' profile='+(saved.profile && saved.profile.name)); } catch (e) { bot.chat('No auth.json present'); }
          } else if (sub === 'autorefresh') {
            const action = args[1];
            const cfg = config.load();
            if (action === 'start') { cfg.authAutoRefresh = true; config.save(cfg); bot.chat('Auth autorefresh enabled'); } else if (action === 'stop') { cfg.authAutoRefresh = false; config.save(cfg); bot.chat('Auth autorefresh disabled'); } else { bot.chat('Usage: !auth refresh|status|autorefresh start|stop'); }
          } else {
            bot.chat('Usage: !auth refresh|status|autorefresh start|stop');
          }
        } else if (cmd === 'aggressivedig' || cmd === 'aggressivediggs' || cmd === 'aggressived') {
          const val = (args[0] || '').toLowerCase();
          if (val === 'on' || val === 'true' || val === '1') {
            bot._aggressiveDig = true;
            bot.chat('Aggressive dig enabled — bot may dig non-whitelisted blocks when stuck.');
          } else if (val === 'off' || val === 'false' || val === '0') {
            bot._aggressiveDig = false;
            bot.chat('Aggressive dig disabled — bot will only dig safe whitelisted blocks.');
          } else {
            bot.chat('Usage: !aggressivedig on|off — current: ' + (bot._aggressiveDig ? 'on' : 'off'));
          }
        } else if (cmd === 'clean') {
          try {
            const manager = require('./modules/models/manager');
            const path = require('path'); const fs = require('fs');
            const MODELS_ROOT = path.resolve(__dirname, 'models');
            // merge old generation checkpoints and prune global checkpoints first
            try { if (args.includes('fine')) process.env.ENABLE_FINE_TUNE = '1'; } catch (e) {}
            try { if (typeof manager.mergeSavesAndPrune === 'function') manager.mergeSavesAndPrune(10); } catch (e) {}
            try { if (typeof manager.pruneGlobal === 'function') manager.pruneGlobal(10); } catch (e) {}
            // For each task directory, combine top candidates and keep only newest N files
            const TARGET_PER_TASK = parseInt(process.env.CLEAN_TARGET_PER_TASK || '10');
            if (fs.existsSync(MODELS_ROOT)) {
              const items = fs.readdirSync(MODELS_ROOT);
              for (const it of items) {
                const d = path.join(MODELS_ROOT, it);
                try {
                  if (!fs.lstatSync(d).isDirectory()) continue;
                  const files = fs.readdirSync(d).filter(f => f.endsWith('.json'));
                  if (files.length <= TARGET_PER_TASK) continue;
                  // attempt to combine top few to create a new candidate
                  try { manager.combineTop(it, 3); } catch (e) {}
                  // re-list and keep newest TARGET_PER_TASK files (favor combined/latest)
                  const all = fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => ({ f, m: fs.statSync(path.join(d,f)).mtimeMs })).sort((a,b)=>b.m - a.m);
                  for (let i = TARGET_PER_TASK; i < all.length; i++) {
                    try { fs.unlinkSync(path.join(d, all[i].f)); } catch (e) {}
                  }
                } catch (e) {}
              }
            }
            bot.chat('Clean completed: pruned and combined model saves (target per task: '+TARGET_PER_TASK+').');
          } catch (e) { bot.chat('Clean failed: ' + (e && e.message)); }
        } else if (cmd === 'merge') {
          try {
            const manager = require('./modules/models/manager');
            const keep = parseInt(args[0]) || 3;
            const fine = args[1] === 'fine' || args.includes('fine');
            if (fine) process.env.ENABLE_FINE_TUNE = '1';
            const out = manager.mergeSavesAndPrune(keep);
            bot.chat('Merge completed: ' + (out || 'no merged output'));
          } catch (e) { bot.chat('Merge failed: ' + (e && e.message)); }
        } else if (cmd === 'leave') {
          // save snapshot and gracefully disconnect
          try {
            const manager = require('./modules/models/manager');
            manager.writeSnapshot(bot, 'leave', 'manual');
          } catch (e) {}
          try {
            // allow explicit leave
            bot._allowQuit = true;
            if (bot._origQuit) bot._origQuit('Leaving'); else try { bot.quit('Leaving'); } catch (e) {}
            bot._allowQuit = false;
          } catch (e) { try { bot.end(); } catch (e2) {} }
        } else {
          bot.chat(`Unknown command: ${cmd}`);
        }
      } catch (err) {
        console.error('Command handling error:', err);
      }
    }
  });

  bot.on('message', (jsonMsg) => {
    try {
      console.log('Message:', jsonMsg.toString());
    } catch (err) {
      console.log('Message event received');
    }
  });

  bot.on('kicked', (reason) => {
    try {
      console.log('Kicked:', reason);
      try { const manager = require('./modules/models/manager'); manager.writeSnapshot(bot, 'kicked'); } catch (e) {}
      try { bot._episodeLog = bot._episodeLog || { inputs:[], outputs:[], actions:[], planLog:[] }; bot._episodeLog.kicks = bot._episodeLog.kicks || []; bot._episodeLog.kicks.push({ ts: Date.now(), reason }); } catch (e) {}
      // simple heuristic: if reason indicates spam or chat, reduce chat rate and persist
      const r = (reason || '').toLowerCase();
      if (r.includes('spam') || r.includes('chat') || r.includes('flood')) {
        try {
          // adjust runtime chat params
          bot._chatMaxPerWindow = Math.max(1, (bot._chatMaxPerWindow || 6) - 1);
          bot._chatMinMs = (bot._chatMinMs || 1200) + 500;
          // persist to config
          try {
            const cfg = config.load(); cfg.chat = cfg.chat || {}; cfg.chat.maxPerWindow = bot._chatMaxPerWindow; cfg.chat.minMs = bot._chatMinMs; cfg.chat.windowMs = bot._chatWindowMs || cfg.chat.windowMs || 30000; config.save(cfg);
          } catch (e) {}
        } catch (e) {}
      }
    } catch (e) { console.log('Kicked handler error', e); }
    try {
      if (!bot._allowQuit && !reconnecting) {
        reconnecting = true;
        console.log('Auto-reconnect scheduled after kick');
        setTimeout(() => {
          try { startBot(); } catch (e) { console.warn('Auto-reconnect failed:', e && e.message); reconnecting = false; }
        }, 3000);
      }
    } catch (e) {}
  });
  bot.on('error', (err) => console.error('Error:', err));
  bot.on('end', () => {
    console.log('Disconnected');
    try {
      if (!bot._allowQuit && !reconnecting) {
        reconnecting = true;
        console.log('Auto-reconnect scheduled after disconnect');
        setTimeout(() => {
          try { startBot(); } catch (e) { console.warn('Auto-reconnect failed:', e && e.message); reconnecting = false; }
        }, 1500);
      }
    } catch (e) {}
  });
}

// Start first bot instance
startBot();

// Watch auth.json for changes and try to reconnect when it changes (apply refreshed tokens)
const fs = require('fs');
fs.watchFile(authFilePath, { interval: 5000 }, (curr, prev) => {
  if (curr.mtime > prev.mtime) {
    console.log('auth.json changed on disk — reloading auth tokens and reconnecting.');
    try {
      if (bot) {
        console.log('Reconnecting bot to apply updated auth tokens...');
        try {
          // allow reconnect quit
          if (bot) { bot._allowQuit = true; if (bot._origQuit) bot._origQuit('Reconnecting with refreshed auth'); else try { bot.quit('Reconnecting with refreshed auth'); } catch (e2) {} bot._allowQuit = false; }
        } catch (e) { try { bot.end(); } catch (e2) {} }
        setTimeout(() => { startBot(); }, 1500);
      } else {
        startBot();
      }
    } catch (e) { console.warn('Failed to reload auth.json during watch:', e.message); }
  }
});

// Trainer process management for `!learn`
let trainerProc = null;
function startTrainer() {
  if (trainerProc) return false;
  const env = Object.assign({}, process.env, { CONTINUOUS: '1' });
  trainerProc = spawn(process.execPath, [require.resolve('./train/neuroevolve.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  trainerProc.stdout.on('data', d => process.stdout.write('[trainer] ' + d.toString()));
  trainerProc.stderr.on('data', d => process.stderr.write('[trainer] ' + d.toString()));
  trainerProc.on('exit', (code) => { console.log('Trainer exited', code); trainerProc = null; });
  return true;
}
function stopTrainer() {
  if (!trainerProc) return false;
  try { trainerProc.kill('SIGINT'); } catch (e) { try { trainerProc.kill(); } catch (e2) {} }
  trainerProc = null;
  return true;
}

// Model watcher for autodeploying improved models
let modelWatcher = null;
let modelController = null;
function startModelWatcher(deployOnChange = true) {
  const modelPath = require('path').resolve(__dirname, 'models', 'best-latest.json');
  try { if (modelWatcher) modelWatcher.close(); } catch (e) {}
  if (!require('fs').existsSync(modelPath)) return false;
  modelWatcher = require('fs').watchFile(modelPath, { interval: 3000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      console.log('Model file changed — auto-reloading model');
      try {
        const policy = require('./modules/policy/nn_policy');
        policy.loadModel(modelPath);
        if (deployOnChange) {
          try {
            const adapter = require('./modules/policy/live_adapter');
            if (modelController && modelController.running) { modelController.stop(); }
            modelController = adapter.runCollect(bot, { stepDelay: 600, maxSteps: 60000 });
            // modelController is a Promise; attach catch
            modelController.catch(e => console.warn('Model controller error:', e.message));
            console.log('Auto-started live controller for new model');
            // start per-task watchers to autoload per-task bests
            try { if (policy.startAllTaskWatches) policy.startAllTaskWatches(); } catch (e) { console.warn('Failed to start per-task watchers:', e.message); }
          } catch (e) { console.warn('Failed to autodeploy model controller:', e.message); }
        }
      } catch (e) { console.warn('Auto-reload model failed:', e.message); }
    }
  });
  console.log('Started watching model for autodeploy:', modelPath);
  return true;
}
function stopModelWatcher() { try { if (modelWatcher) require('fs').unwatchFile(require('path').resolve(__dirname, 'models', 'best-latest.json')); modelWatcher = null; } catch (e) {} try { stopAllTaskWatchers(); } catch (e) {} }
function stopAllTaskWatchers() { try { const policy = require('./modules/policy/nn_policy'); if (policy.stopAllTaskWatches) policy.stopAllTaskWatches(); } catch (e) { console.warn('Failed to stop per-task watchers', e.message); } }

// Ensure snapshot on process signals
try {
  const manager = require('./modules/models/manager');
  process.on('SIGINT', () => {
    try { if (bot) manager.writeSnapshot(bot, 'SIGINT'); } catch (e) {}
    try { manager.mergeSavesAndPrune(3); } catch (e) {}
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    try { if (bot) manager.writeSnapshot(bot, 'SIGTERM'); } catch (e) {}
    try { manager.mergeSavesAndPrune(3); } catch (e) {}
    process.exit(0);
  });
  process.on('exit', (code) => { try { if (bot) manager.writeSnapshot(bot, 'exit'); } catch (e) {} });
} catch (e) {}

