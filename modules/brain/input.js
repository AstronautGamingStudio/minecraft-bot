const { GoalNear } = require('mineflayer-pathfinder').goals;

function _nearestEntity(bot, filterFn) {
  const ents = Object.values(bot.entities || {}).filter(filterFn);
  if (!ents.length) return null;
  ents.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
  return ents[0];
}

function buildObservation(bot, opts = {}) {
  // Mirror previous live_adapter observation construction in one place
  const startTime = opts.startTime || Date.now();
  if (!bot || !bot.entity || !bot.entity.position) return null;
  const items = Object.values(bot.entities).filter(e => e.type === 'object');
  let nearest = null; let bestD = Infinity;
  for (const it of items) {
    const d = bot.entity.position.distanceTo(it.position);
    if (d < bestD) { bestD = d; nearest = it; }
  }

  const mobs = Object.values(bot.entities).filter(e => e.type === 'mob');
  let nearestMobD = Infinity;
  for (const m of mobs) {
    const d = bot.entity.position.distanceTo(m.position);
    if (d < nearestMobD) nearestMobD = d;
  }

  const radius = opts.radius || 32;
  const ax = bot.entity.position.x / radius;
  const az = bot.entity.position.z / radius;
  const dx = nearest ? (nearest.position.x - bot.entity.position.x) / radius : 0;
  const dz = nearest ? (nearest.position.z - bot.entity.position.z) / radius : 0;
  const itemsLeft = items.length > 0 ? 1 : 0;
  const timeFrac = Math.min(1, (Date.now() - startTime) / (opts.timeout || 60000));

  const health = (typeof bot.health === 'number') ? Math.min(20, bot.health) / 20 : 1;
  const food = (typeof bot.food === 'number') ? Math.min(20, bot.food) / 20 : 1;
  const mobNear = nearestMobD < 10 ? 1 - Math.min(1, nearestMobD / 10) : 0;
  let invFrac = 0;
  try {
    const invItems = bot.inventory && typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    const maxSlots = (bot.inventory && bot.inventory.slots && bot.inventory.slots.length) ? bot.inventory.slots.length : 36;
    invFrac = Math.min(1, invItems.length / maxSlots);
  } catch (e) { invFrac = 0; }

  const obs = [ax, az, dx, dz, itemsLeft, 1 - timeFrac, health, food, mobNear, invFrac];

  try {
    bot._episodeLog = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] };
    const entry = {
      ts: Date.now(),
      obs,
      context: {
        pos: bot.entity && bot.entity.position ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } : null,
        nearestEntity: nearest ? { id: nearest.id, type: nearest.type, name: nearest.name, pos: nearest.position } : null,
        nearestMobDistance: nearestMobD === Infinity ? null : nearestMobD
      }
    };
    bot._episodeLog.inputs.push(entry);
    // simple guard to prevent unbounded memory growth
    if (bot._episodeLog.inputs.length > 10000) bot._episodeLog.inputs.splice(0, 2000);
  } catch (e) {}

  return obs;
}

module.exports = { buildObservation, _nearestEntity };
