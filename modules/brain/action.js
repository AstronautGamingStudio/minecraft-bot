const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear } = require('mineflayer-pathfinder').goals;

async function ensurePathfinder(bot) {
  try { bot.loadPlugin(pathfinder); } catch (e) {}
  const mcData = require('minecraft-data')(bot.version || '1.16.4');
  const defaultMove = new Movements(bot, mcData);
  if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(defaultMove);
}

function gotoWithTimeout(bot, goal, ms) {
  return Promise.race([
    bot.pathfinder.goto(goal),
    new Promise((_, rej) => setTimeout(() => rej(new Error('path timeout')), ms))
  ]);
}

async function performAction(bot, action, opts = {}) {
  // actions: 0=up,1=down,2=left,3=right, >=4=interact
  await ensurePathfinder(bot);
  const pathTimeout = opts.pathTimeout || 8000;
  // record action intent
  try { bot._episodeLog = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] }; } catch (e) {}
  const actionEntry = { type: 'move' , action, tsStart: Date.now(), params: { opts } , result: null };
  bot._episodeLog.actions.push(actionEntry);

  if (action >= 0 && action <= 3) {
    const stepSize = opts.stepSize || 1;
    const tx = Math.round(bot.entity.position.x) + (action === 2 ? -stepSize : (action === 3 ? stepSize : 0));
    const tz = Math.round(bot.entity.position.z) + (action === 0 ? -stepSize : (action === 1 ? stepSize : 0));
    const ty = Math.round(bot.entity.position.y);
    const goal = new GoalNear(tx, ty, tz, 0.8);
    try {
      await gotoWithTimeout(bot, goal, pathTimeout);
      actionEntry.result = { ok: true };
    } catch (e) {
      actionEntry.result = { ok: false, err: e && e.message };
      console.warn('Action movement failed:', e.message);
    }
  } else {
    // interact/pick
    const items = Object.values(bot.entities).filter(e => e.type === 'object');
    const near = items.find(it => bot.entity.position.distanceTo(it.position) < 1.5);
    if (near) {
      await new Promise(r => setTimeout(r, 300));
      return;
    }
    try {
      const radiusBlocks = opts.radiusBlocks || 8;
      const chestBlock = bot.findBlock({
        matching: b => b && (b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'barrel'),
        maxDistance: radiusBlocks
      });
          if (chestBlock) {
        const chest = await bot.openChest(chestBlock);
        try {
          const itemsIn = chest.containerItems();
          for (let i = 0; i < itemsIn.length; i++) {
            const item = itemsIn[i];
            if (item && item.type) {
              await chest.withdraw(i, Math.min(item.count, 64));
                  actionEntry.result = { ok: true, took: { name: item.name, count: item.count } };
                  console.log(`Took ${item.name} x${item.count}`);
              break;
            }
          }
        } finally { chest.close(); }
      }
    } catch (e) { actionEntry.result = { ok: false, err: e && e.message }; console.warn('Action interact failed:', e.message); }
  }
  // simple size guard for actions
  try { if (bot._episodeLog.actions.length > 10000) bot._episodeLog.actions.splice(0, 2000); } catch (e) {}
}

async function performDig(bot, block, opts = {}) {
  if (!block) return false;
  // ensure pathfinder and nav helper available
  try { await ensurePathfinder(bot); } catch (e) {}
  const nav = require('../utils/nav');
  const actions = require('../utils/actions');
  const timeout = opts.timeout || 20000;
  // Try to navigate within 1 block of target (allows above/below/diagonal dig)
  const digEntry = { type: 'dig', block: block ? { name: block.name, pos: block.position } : null, tsStart: Date.now(), result: null };
  try { bot._episodeLog = bot._episodeLog || { inputs: [], outputs: [], actions: [], planLog: bot._planLog || [] }; bot._episodeLog.actions.push(digEntry); } catch (e) {}
  try {
    const botY = Math.round(bot.entity.position.y);
    const blkY = Math.round(block.position.y);
    // Try to find a reachable adjacent standing position from which to dig the target
    const adjOffsets = [
      {x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1},
      {x:1,y:1,z:0},{x:-1,y:1,z:0},{x:0,y:1,z:1},{x:0,y:1,z:-1},
      {x:0,y:-1,z:0},{x:0,y:0,z:0}
    ];
    let moved = false;
    for (const off of adjOffsets) {
      const targetPos = { x: block.position.x + off.x, y: block.position.y + off.y, z: block.position.z + off.z };
      try {
        const ok = await nav.goto(bot, targetPos, 0.9, 9000, { allowDig: true });
        if (ok) { moved = true; break; }
      } catch (e) {}
    }
    if (!moved) {
      // fallback: try to goto near the block general position
      try { await nav.goto(bot, block.position, 1.5); } catch (e) {}
      // as last resort, try small local unstuck maneuvers
      try {
        bot.setControlState('back', true); await new Promise(r=>setTimeout(r,200)); bot.setControlState('back', false);
      } catch (e) {}
    }
  } catch (e) {
    // ignore nav errors, attempt dig anyway
  }
  // equip appropriate tool if possible
  try {
    const isPick = /ore|stone|deepslate/.test(block.name);
    if (isPick) {
      const pick = bot.inventory.items().find(i => i.name && i.name.includes('pickaxe'));
      if (pick) await bot.equip(pick, 'hand');
    }
  } catch (e) {}
  // use existing dig helper which retries and respects _taskStopRequested
  try {
    const res = await actions.digBlock(bot, block, timeout);
    if (res) {
      try { bot._stats = bot._stats || {}; bot._stats.blocksMined = (bot._stats.blocksMined||0) + 1; } catch (e) {}
      digEntry.result = { ok: true, mined: { name: block.name } };
    } else {
      digEntry.result = { ok: false };
    }
    digEntry.tsEnd = Date.now();
    // size guard
    try { if (bot._episodeLog && bot._episodeLog.actions && bot._episodeLog.actions.length > 10000) bot._episodeLog.actions.splice(0,2000); } catch (e) {}
    return res;
  } catch (e) {
    digEntry.result = { ok: false, err: e && (e.message || e) };
    digEntry.tsEnd = Date.now();
    console.warn('performDig failed:', e.message || e);
    return false;
  }
}

module.exports = { performAction, performDig };
