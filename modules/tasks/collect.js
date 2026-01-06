const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear, GoalBlock } = require('mineflayer-pathfinder').goals;
const { available } = require('../policy/nn_policy');

async function findNearestDroppedItem(bot, itemName) {
  const ents = Object.values(bot.entities).filter(e => e.type === 'object' && e.objectType === 'Item');
  if (!ents.length) return null;
  // Try to match by item name when possible
  for (const e of ents) {
    try {
      const stack = e.metadata && (e.metadata[10] || e.metadata[2] || {});
      const name = stack && (stack.item || stack.name || '').toString();
      if (!itemName || (name && name.includes(itemName))) return e;
    } catch (err) {
      // ignore parse errors
    }
  }
  // fallback: nearest dropped item
  ents.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
  return ents[0];
}

async function findContainerWithItem(bot, itemName, maxDistance = 48) {
  const containers = bot.findBlocks({
    matching: (b) => b && b.name && (b.name.includes('chest') || b.name.includes('barrel') || b.name.includes('shulker_box')),
    maxDistance,
    count: 40
  }).map(pos => bot.blockAt(pos)).filter(Boolean);

  for (const block of containers) {
    try {
      const chest = await bot.openChest(block);
      const items = chest.containerItems();
      if (items.some(i => i && i.name && i.name.includes(itemName))) {
        await chest.close();
        return block;
      }
      await chest.close();
    } catch (err) {
      // ignore open errors
    }
  }
  return null;
}

module.exports = {
  async run(bot, args = [], options = {}) {
    const itemName = args[0];
    const amount = parseInt(args[1]) || 1;
    bot._taskStopRequested = false;
    bot.chat(`Starting collect task for: ${itemName || 'any item'} amount=${amount}`);
    // auto-load per-task specialist model if available
    try {
      const manager = require('../models/manager');
      const pm = manager.bestFor('collect');
      if (pm) {
        try { require('../policy/nn_policy').loadModel(pm); bot.chat('Loaded specialist model for collect.'); } catch (e) {}
      }
    } catch (e) {}

    // Model-controlled path (unchanged)
    if (available() && args[0] === 'model') {
      bot.chat('Starting live model-controlled collect loop (supervised demo). Use !stopcollect to stop.');
      const adapter = require('../policy/live_adapter');
      adapter.runCollect(bot, { stepDelay: 700, maxSteps: 300 }).catch(err => {
        console.error('Model collect error:', err);
        bot.chat('Model controller error: ' + err.message);
      });
      return;
    }

    // Ensure pathfinder plugin loaded
    try { bot.loadPlugin(pathfinder); } catch (e) {}
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(defaultMove);
    const nav = require('../utils/nav');

    // If an item name is provided, prefer containers (chests/barrels) that contain the item
    if (itemName) {
      bot.chat(`Searching for containers with '${itemName}'...`);
      const containerBlock = await findContainerWithItem(bot, itemName);
      if (containerBlock) {
        bot.chat(`Found container at ${containerBlock.position}. Navigating...`);
        const goal = new GoalNear(containerBlock.position.x, containerBlock.position.y, containerBlock.position.z, 2);
        try {
          const ok = await nav.goto(bot, containerBlock.position, 2);
          if (!ok) { bot.chat('Failed to path to container (no route).'); return; }
        } catch (err) { bot.chat('Failed to path to container: ' + err.message); return; }

        try {
          const chest = await bot.openChest(containerBlock);
          const items = chest.containerItems();
          const target = items.find(i => i && i.name && i.name.includes(itemName));
          if (target) {
            const withdrawn = chest.withdraw(target.type, null, 1);
            await withdrawn;
            bot.chat(`Withdrew one ${target.name} from chest.`);
          } else {
            bot.chat('Item not found on open (race condition)');
          }
          await chest.close();
          return;
        } catch (err) {
          bot.chat('Failed to open container: ' + err.message);
          return;
        }
      }
    }

    // Fallback: try to pick up `amount` dropped items
    const targetName = itemName;
    const actions = require('../utils/actions');
    let collected = 0;
    const start = Date.now();
    while (collected < amount && Date.now() - start < (options.timeout || 120000)) {
      if (bot._taskStopRequested) { bot.chat('Collect task stopped by user'); break; }
      const dropped = await findNearestDroppedItem(bot, targetName);
      if (!dropped) { bot.chat('No matching dropped items nearby.'); break; }
      bot.chat(`Found dropped item at ${dropped.position}. Navigating...`);
      try {
        const ok = await nav.goto(bot, dropped.position, 1);
        if (!ok) { bot.chat('Failed to reach dropped item (no route).'); break; }
        // wait a short time for pickup
        await new Promise(r => setTimeout(r, 700));
        // recount inventory for item
        const invCount = bot.inventory.items().reduce((s, it) => {
          if (!targetName) return s; if (it && it.name && it.name.includes(targetName)) return s + it.count; return s; }, 0);
        if (invCount > 0) collected = invCount; else collected++;
        bot.chat(`Collected ${collected}/${amount}`);
      } catch (err) { bot.chat('Collect error: ' + err.message); break; }
      await new Promise(r => setTimeout(r, 300));
    }
    bot.chat(`Collect task finished, collected ${collected} items.`);
  }
};
