async function findToolInChests(bot, prefer = ['netherite_pickaxe','diamond_pickaxe','iron_pickaxe','stone_pickaxe','wooden_pickaxe'], maxDistance = 64) {
  // look for items in inventory first
  for (const name of prefer) {
    const it = bot.inventory.items().find(i => i && i.name && i.name.includes(name.replace('_',' ')) || (i && i.name && i.name.includes(name)) );
    if (it) return it;
  }
  // scan nearby chests for tools
  try {
    const chests = bot.findBlocks({ matching: (b) => b && b.name && (b.name.includes('chest')||b.name.includes('barrel')), maxDistance, count: 64 });
    for (const pos of chests) {
      const block = bot.blockAt(pos);
      if (!block) continue;
      try {
        const chest = await bot.openChest(block);
        const items = chest.containerItems();
        for (const name of prefer) {
          const found = items.find(i => i && i.name && (i.name.includes(name.replace('_',' ')) || i.name.includes(name)));
          if (found) {
            await chest.withdraw(found.type, null, 1);
            await chest.close();
            return bot.inventory.items().find(i => i.type === found.type);
          }
        }
        await chest.close();
      } catch (e) { /* ignore */ }
    }
  } catch (e) {}
  return null;
}

module.exports = { findToolInChests };
