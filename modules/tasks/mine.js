const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock } = require('mineflayer-pathfinder').goals;

async function chooseAutoTarget(bot) {
  const prefer = ['coal_ore','iron_ore','stone','deepslate_coal_ore','deepslate_iron_ore'];
  for (const name of prefer) {
    const blk = bot.findBlock({ matching: (b) => b && b.name === name, maxDistance: 64 });
    if (blk) return blk;
  }
  // fallback: nearest solid block
  return bot.findBlock({ matching: (b)=>b && b.name && b.name !== 'air', maxDistance: 64 });
}

module.exports = {
  async run(bot, args = [], options = {}) {
    let blockName = args[0] || 'auto';
    const amount = parseInt(args[1]) || 1;
    bot._taskStopRequested = false;
    bot.chat(`Starting mine task for: ${blockName} amount=${amount}`);
    // auto-load per-task specialist model if available
    try {
      const manager = require('../models/manager');
      const pm = manager.bestFor('mine');
      if (pm) {
        try { require('../policy/nn_policy').loadModel(pm); bot.chat('Loaded specialist model for mining.'); } catch (e) {}
      }
    } catch (e) {}

    try { bot.loadPlugin(pathfinder); } catch (e) {}
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(defaultMove);
    const nav = require('../utils/nav');

    let targetBlock = null;
    if (blockName === 'auto') {
      targetBlock = await chooseAutoTarget(bot);
      if (!targetBlock) { bot.chat('No auto target found nearby'); return; }
      blockName = targetBlock.name;
    } else {
      targetBlock = bot.findBlock({ matching: (b) => b && b.name && b.name.includes(blockName), maxDistance: 64 });
      if (!targetBlock) { bot.chat(`No block matching ${blockName} found nearby`); return; }
    }

    bot.chat(`Target block: ${targetBlock.name} at ${targetBlock.position}`);

    // navigate adjacent to the block
    const goal = new GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
    try {
      const ok = await nav.goto(bot, targetBlock.position, 2);
      if (!ok) { bot.chat('Failed to path to block (no route).'); return; }
    } catch (err) {
      bot.chat('Failed to path to block: ' + err.message);
      return;
    }

    // Mine `amount` blocks of this type (re-acquire targets each loop)
    const actions = require('../utils/actions');
    let done = 0;
    for (let i = 0; i < amount; i++) {
      if (bot._taskStopRequested) { bot.chat('Mine task stopped by user'); break; }
      // (re)find nearest matching block
      let blk = null;
      if (blockName === 'auto') blk = await chooseAutoTarget(bot);
      else blk = bot.findBlock({ matching: (b) => b && b.name && b.name.includes(blockName), maxDistance: 64 });
      if (!blk) { bot.chat(`No more blocks matching ${blockName} found nearby`); break; }
      try {
        const ok = await nav.goto(bot, blk.position, 2);
        if (!ok) { bot.chat('Failed to reach block, skipping'); continue; }
        // equip tool if needed
        const isPick = /ore|stone|deepslate/.test(blk.name);
        if (isPick) {
          const pick = bot.inventory.items().find(i => i.name && i.name.includes('pickaxe'));
          if (pick) await bot.equip(pick, 'hand');
          else {
            try {
              const tools = require('../utils/tools');
              const found = await tools.findToolInChests(bot);
              if (found) await bot.equip(found, 'hand');
            } catch (e) {}
          }
        }
        const success = await actions.digBlock(bot, blk, 20000);
        if (success) { done++; bot.chat(`Dug ${done}/${amount}: ${blk.name}`); }
        else bot.chat('Failed to dig block within timeout');
      } catch (err) { bot.chat('Dig error: ' + (err.message || err)); }
      await new Promise(r => setTimeout(r, 400));
    }
    bot.chat(`Mine task finished, dug ${done} blocks.`);
  }
};
