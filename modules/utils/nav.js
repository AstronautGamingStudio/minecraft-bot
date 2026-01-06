const Vec3 = require('vec3');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function goto(bot, target, range = 1, timeout = 30000, options = {}) {
  // target can be a Vec3-like {x,y,z} or a block/entity with position
  let pos = null;
  if (!target) return false;
  if (target.position) pos = target.position;
  else if (typeof target.x === 'number' && typeof target.y === 'number' && typeof target.z === 'number') pos = new Vec3(target.x, target.y, target.z);
  else return false;

  // Try pathfinder first when available
  try {
    if (bot.pathfinder && bot.pathfinder.goto) {
      const goals = require('mineflayer-pathfinder').goals;
      const GoalNear = goals.GoalNear;
      const goal = new GoalNear(pos.x, pos.y, pos.z, range);
      await bot.pathfinder.goto(goal, { timeout });
      return true;
    }
  } catch (err) {
    // pathfinder failed — fall through to manual movement
  }

  // Manual fallback: look at target and walk forward until within range or timeout
  const start = Date.now();
  try {
    const actions = require('../utils/actions');
    // whitelist of safe diggable block name fragments (configurable via DIG_WHITELIST env var)
    const DEFAULT_WHITELIST = ['dirt','grass','cobblestone','stone','planks','log','sand','gravel','wood'];
    const WHITELIST = (process.env.DIG_WHITELIST ? process.env.DIG_WHITELIST.split(',') : DEFAULT_WHITELIST).map(s => s.trim().toLowerCase()).filter(Boolean);
    let lastPos = bot.entity.position.clone();
    let stuckCount = 0;
    while (Date.now() - start < timeout) {
      if (bot._taskStopRequested) return false;
      try { await bot.lookAt(pos); } catch (e) {}
      try { bot.setControlState('forward', true); } catch (e) {}
      await sleep(300);
      try { bot.setControlState('forward', false); } catch (e) {}

      const dist = bot.entity.position.distanceTo(pos);
      if (dist <= range) break;

      // detect stuck: if position hasn't changed significantly
      if (bot.entity.position.distanceTo(lastPos) < 0.3) {
        stuckCount++;
      } else {
        stuckCount = 0;
      }
      lastPos = bot.entity.position.clone();

      if (stuckCount >= 4) {
        // attempt to dig a blocking block in front of the bot before other maneuvers
          try {
            const dir = pos.minus(bot.entity.position).normalize();
            const probe = bot.entity.position.offset(Math.round(dir.x), 0, Math.round(dir.z));
            const block = bot.blockAt(probe);
            if (block && block.name && block.name !== 'air') {
              const name = (block.name || '').toLowerCase();
              // only attempt to dig if in whitelist and not dangerous, unless aggressive dig enabled
              const dangerous = /lava|bedrock|fire|portal|lava_cauldron/.test(name);
              const ok = WHITELIST.some(w => name.includes(w));
              const allowAggressive = (options.allowDig !== undefined) ? !!options.allowDig : true; // default to allow digging
              if ((!dangerous) && (ok || allowAggressive)) {
                try {
                  const dug = await actions.digBlock(bot, block, 5000);
                  if (dug) { stuckCount = 0; continue; }
                } catch (e) {}
              }
              // if digging didn't work or not permitted, try building a step over the blocking block
              try {
                const above = bot.blockAt(probe.offset(0,1,0));
                if ((!above || above.name === 'air') && !dangerous) {
                  // find a placeable block in inventory
                  const placePref = ['dirt','cobblestone','stone','planks','sand','gravel'];
                  const invBlock = bot.inventory.items().find(i => i.name && placePref.some(p => i.name.includes(p)));
                  if (invBlock) {
                    const placed = await actions.placeBlock(bot, block, invBlock);
                    if (placed) { stuckCount = 0; continue; }
                  }
                }
              } catch (e) {}
            }
          } catch (e) {}

        // fallback unstuck maneuvers: jump + random strafe
        try { bot.setControlState('jump', true); } catch (e) {}
        try { bot.setControlState(Math.random() > 0.5 ? 'left' : 'right', true); } catch (e) {}
        await sleep(600);
        try { bot.setControlState('jump', false); bot.setControlState('left', false); bot.setControlState('right', false); } catch (e) {}
        stuckCount = 0;
      }
    }
  } finally {
    try { bot.setControlState('forward', false); } catch (e) {}
  }

  return bot.entity && bot.entity.position.distanceTo(pos) <= range;
}

module.exports = { goto };
