const policy = require('../policy/nn_policy');

// Simple hostile tracker for combat signalling
const hostileMap = new Map(); // entityId -> timestamp
let lastHealth = null;
const recentActionMap = new Map(); // entityId -> timestamp of recent swing/hurt
let lastAttackerId = null;

function init(bot) {
  try {
    lastHealth = bot.health || null;
    bot.on('health', () => {
      const cur = bot.health || 0;
      if (lastHealth !== null && cur < lastHealth) {
        // bot was hurt — mark nearby mobs as hostile
        const nearby = Object.values(bot.entities).filter(e => e.type === 'mob' && e.position && bot.entity && bot.entity.position.distanceTo(e.position) < 12);
        const now = Date.now();
        for (const m of nearby) hostileMap.set(m.id, now);
      }
      lastHealth = cur;
    });
    // track entities swinging arms (possible attackers)
    try {
      bot.on('entitySwingArm', (entity) => {
        try { if (entity && entity.id) recentActionMap.set(entity.id, Date.now()); } catch (e) {}
      });
    } catch (e) {}
    // track entity hurt events to identify attackers when bot is hurt
    try {
      bot.on('entityHurt', (entity) => {
        try {
          if (!bot.entity) return;
          // if the hurt entity is the bot itself, attempt to find recent attacker
          if (entity && entity.id === bot.entity.id) {
            const now = Date.now();
            // prefer recent actors within 4s
            let best = null; let bestT = 0;
            for (const [id, ts] of recentActionMap.entries()) {
              if (now - ts < 4000 && ts > bestT) { bestT = ts; best = id; }
            }
            if (best) {
              lastAttackerId = best;
              hostileMap.set(best, now);
            }
          }
        } catch (e) {}
      });
    } catch (e) {}
  } catch (e) {}
}

function getNearestHostile(bot, maxAgeMs = 20000) {
  const now = Date.now();
  let best = null; let bestD = Infinity;
  for (const [id, ts] of hostileMap.entries()) {
    if (now - ts > maxAgeMs) { hostileMap.delete(id); continue; }
    const ent = bot.entities[id];
    if (!ent || !ent.position) continue;
    const d = bot.entity.position.distanceTo(ent.position);
    if (d < bestD) { bestD = d; best = ent; }
  }
  return best;
}

function getLastAttacker(bot, maxAgeMs = 10000) {
  try {
    if (!lastAttackerId) return null;
    const now = Date.now();
    const ts = recentActionMap.get(lastAttackerId) || 0;
    if (now - ts > maxAgeMs) return null;
    const ent = bot.entities[lastAttackerId];
    return ent || null;
  } catch (e) { return null; }
}

// Decision layer: receives an observation and returns an action index.
function decide(bot, observation, opts = {}) {
  // allow per-decision epsilon override via opts
  if (opts.epsilon !== undefined && policy.setConfig) policy.setConfig({ epsilon: opts.epsilon });
  // policy.act already handles fallback to heuristic if no model loaded
  let probs = null;
  try { if (policy.predictProbs) probs = policy.predictProbs(observation); } catch (e) { probs = null; }
  const action = policy.act(observation);
  // record output
  try {
    bot._episodeLog = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] };
    bot._episodeLog.outputs.push({ ts: Date.now(), observation, probs, action });
    if (bot._episodeLog.outputs.length > 10000) bot._episodeLog.outputs.splice(0, 2000);
  } catch (e) {}
  return action;
}

function predictProbs(observation) {
  if (policy.predictProbs) return policy.predictProbs(observation);
  return null;
}

async function planAndExecute(bot, steps = [], opts = {}) {
  // steps: [{type:'goto'|'dig'|'interact'|'attack'|'wait', target:..., info:...}, ...]
  bot._planLog = bot._planLog || [];
  const actionModule = require('./action');
  const results = [];
  for (const s of steps) {
    const entry = { step: s, ts: Date.now(), ok: false, reason: null };
    try {
      if (s.type === 'craft') {
        const craft = require('./crafting');
        const item = s.item || (s.target && s.target.name) || s.info;
        const qty = s.qty || 1;
        const ok = await craft.craftItem(bot, item, qty);
        entry.ok = !!ok; if (!ok) entry.reason = 'craftFailed';
      } else
      if (s.type === 'goto') {
        // use nav to goto
        const nav = require('../utils/nav');
        const ok = await nav.goto(bot, s.target, s.range || 1.2);
        entry.ok = !!ok; if (!ok) entry.reason = 'noPath';
      } else if (s.type === 'dig') {
        const res = await actionModule.performDig(bot, s.target, { timeout: s.timeout || 20000 });
        entry.ok = !!res; if (!res) entry.reason = 'digFailed';
      } else if (s.type === 'interact') {
        await actionModule.performAction(bot, 4, {});
        entry.ok = true;
      } else if (s.type === 'attack') {
        try { await bot.attack(s.target, true); entry.ok = true; try { bot._stats = bot._stats || {}; bot._stats.attacks = (bot._stats.attacks||0)+1; } catch(e){} } catch (e) { entry.ok = false; entry.reason = 'attackFailed'; }
      } else if (s.type === 'wait') {
        const ms = s.ms || 500;
        await new Promise(r => setTimeout(r, ms));
        entry.ok = true;
      } else {
        entry.reason = 'unknownStep';
      }
    } catch (e) { entry.ok = false; entry.reason = e && e.message; }
    bot._planLog.push(entry);
    results.push(entry);
    if (!entry.ok && opts.stopOnFail) break;
  }
  return results;
}

module.exports = { init, getNearestHostile, getLastAttacker, decide, predictProbs, planAndExecute };
