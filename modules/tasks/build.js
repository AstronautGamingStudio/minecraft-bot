const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear } = require('mineflayer-pathfinder').goals;

function chooseBuildingBlock(bot) {
  // Prefer wooden planks or dirt as a fallback
  const prefer = ['oak_planks', 'spruce_planks', 'dirt', 'cobblestone', 'stone'];
  const inv = bot.inventory.items();
  for (const name of prefer) {
    const it = inv.find(i => i.name && i.name.includes(name));
    if (it) return it;
  }
  return null;
}

async function placeBlockAt(bot, referenceBlock, offset, blockItem) {
  // offset: {x,y,z} relative to referenceBlock.position
  const pos = referenceBlock.position.offset(offset.x, offset.y, offset.z);
  // Need a neighboring face to place against; use referenceBlock for simplicity
  try {
    const actions = require('../utils/actions');
    await actions.placeBlock(bot, referenceBlock, blockItem);
  } catch (e) {
    // Fallback: use bot.blockAt to find a neighbor
    const neighbor = bot.blockAt(pos.offset(0, -1, 0));
    if (neighbor) {
      try { const actions = require('../utils/actions'); await actions.placeBlock(bot, neighbor, blockItem); } catch (err) { throw err; }
    } else throw e;
  }
}

module.exports = {
  async run(bot, args = [], options = {}) {
    const blueprint = args[0] || 'house';
    bot.chat(`Starting build task for blueprint: ${blueprint}`);

    try { bot.loadPlugin(pathfinder); } catch (e) {}
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    if (bot.pathfinder && bot.pathfinder.setMovements) bot.pathfinder.setMovements(defaultMove);
    const nav = require('../utils/nav');

    // Choose a block from inventory or try to withdraw from nearby chests
    let blockItem = chooseBuildingBlock(bot);
    if (!blockItem) {
      bot.chat('No suitable building blocks in inventory; searching nearby chests for building blocks...');
      const withdraw = async (names, needed = 8) => {
        const blocks = bot.findBlocks({ matching: (b) => b && b.name && names.some(n => b.name.includes(n)), maxDistance: 128, count: 512 });
        let remaining = needed;
        for (const pos of blocks) {
          const block = bot.blockAt(pos);
          if (!block) continue;
          try {
            const chest = await bot.openChest(block);
            const items = chest.containerItems();
            for (const want of names) {
              let found = items.find(i => i && i.name && i.name.includes(want));
              while (found && remaining > 0) {
                const take = Math.min(remaining, found.count);
                try {
                  await chest.withdraw(found.type, null, take);
                  remaining -= take;
                  // refresh inventory and chest items
                  const updated = chest.containerItems();
                  found = updated.find(i => i && i.name && i.name.includes(want));
                } catch (err) { break; }
              }
              if (remaining <= 0) { await chest.close(); return bot.inventory.items().find(i => i && i.name && names.some(n => i.name.includes(n))); }
            }
            await chest.close();
          } catch (err) { /* can't open this chest */ }
        }
        // final attempt: return whichever preferred item we have now
        return bot.inventory.items().find(i => i.name && names.some(n => i.name.includes(n)));
      };

      blockItem = await withdraw(['planks','dirt','cobblestone','stone'], 16);
      if (!blockItem) { bot.chat('Could not find building blocks in nearby chests. Bring materials and try again.'); return; }
      bot.chat('Withdrew blocks from nearby chest: ' + blockItem.name);
    }

    bot._taskStopRequested = false;
    bot.chat(`Using block: ${blockItem.name}. Finding a nearby flat area to build a small 3x3 house.`);
    // auto-load per-task specialist model if available
    try {
      const manager = require('../models/manager');
      const pm = manager.bestFor('build');
      if (pm) {
        try { require('../policy/nn_policy').loadModel(pm); bot.chat('Loaded specialist model for build.'); } catch (e) {}
      }
    } catch (e) {}
    // Simple strategy: find block under bot (ground) and build around it
    const groundBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (!groundBlock) { bot.chat('No ground block found under bot. Move to a safe flat area and try again.'); return; }

    // Define a 3x3 area centered on bot, build walls one block high and a roof
    const cx = Math.floor(bot.entity.position.x);
    const cz = Math.floor(bot.entity.position.z);
    const baseY = groundBlock.position.y + 1;

    // Place perimeter (3x3)
    const positions = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue; // leave center as door space
        positions.push({x: cx+dx, y: baseY, z: cz+dz});
      }
    }

    // Ensure we are close enough to place each block; path to adjacent positions
    for (const pos of positions) {
      if (bot._taskStopRequested) { bot.chat('Build task stopped by user'); break; }
      const goal = new GoalNear(pos.x, pos.y, pos.z, 1);
      try {
        const ok = await nav.goto(bot, pos, 1);
        if (!ok) { bot.chat('Failed to path to placement spot (no route).'); continue; }
      } catch (e) { bot.chat('Failed to path to placement spot: ' + e.message); continue; }

      // If no block in inventory, try chests nearby (not implemented here)
      const it = bot.inventory.items().find(i => i.type === blockItem.type);
      if (!it) { bot.chat('Out of building blocks while building.'); return; }

      try {
        await bot.equip(it, 'hand');
        // Find block to place against: use the block below the target
        const below = bot.blockAt({x: pos.x, y: pos.y-1, z: pos.z});
        if (!below) { bot.chat('No supporting block for placement at '+JSON.stringify(pos)); continue; }
        const actions = require('../utils/actions');
        const ok = await actions.placeBlock(bot, below, it);
        if (!ok) bot.chat('Placement failed at '+JSON.stringify(pos));
      } catch (err) {
        bot.chat('Placement failed at '+JSON.stringify(pos)+': ' + err.message);
      }
    }

    // Roof: place 3x3 on y+1
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const pos = {x: cx+dx, y: baseY+1, z: cz+dz};
        const goal = new GoalNear(pos.x, pos.y, pos.z, 1);
        try { const ok = await nav.goto(bot, pos, 1); if (!ok) continue; } catch (e) { continue; }
        const it = bot.inventory.items().find(i => i.type === blockItem.type);
        if (!it) { bot.chat('Out of building blocks while roofing.'); return; }
        try { await bot.equip(it, 'hand'); const below = bot.blockAt({x: pos.x, y: pos.y-1, z: pos.z}); if (!below) continue; const actions = require('../utils/actions'); await actions.placeBlock(bot, below, it); } catch (err) { continue; }
      }
    }

    bot.chat('Build task finished (simple house).');
  }
};
