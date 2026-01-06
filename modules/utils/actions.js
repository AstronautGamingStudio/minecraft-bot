async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function digBlock(bot, block, maxTime = 20000) {
  if (!block) return false;
  const start = Date.now();
  try {
    while (Date.now() - start < maxTime) {
      if (bot._taskStopRequested) return false;
      if (!bot.blockAt(block.position) || bot.blockAt(block.position).name === 'air') return true;
      try {
        await bot.dig(block, true);
      } catch (e) {
        // if dig failed, try to equip a pickaxe and retry
        try {
          const pick = bot.inventory.items().find(i => i.name && i.name.includes('pickaxe'));
          if (pick) await bot.equip(pick, 'hand');
        } catch (e2) {}
      }
      await sleep(300);
    }
  } catch (e) { /* swallow */ }
  return bot.blockAt(block.position) && bot.blockAt(block.position).name === 'air';
}

async function placeBlock(bot, positionBlock, blockItem, maxAttempts = 4) {
  if (!positionBlock || !blockItem) return false;
  for (let i = 0; i < maxAttempts; i++) {
    if (bot._taskStopRequested) return false;
    try {
      await bot.equip(blockItem, 'hand');
      await bot.placeBlock(positionBlock, { x: 0, y: 1, z: 0 });
      return true;
    } catch (e) {
      await sleep(400);
    }
  }
  return false;
}

module.exports = { digBlock, placeBlock };
