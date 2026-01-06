const Vec3 = require('vec3');

async function findNearbyCraftingTable(bot, maxDistance = 8) {
  try {
    const block = bot.findBlock({ matching: b => b && (b.name === 'crafting_table'), maxDistance });
    return block;
  } catch (e) { return null; }
}

async function craftItem(bot, itemName, quantity = 1) {
  // Try to craft `itemName` using inventory or a nearby crafting table
  try {
    const mcData = require('minecraft-data')(bot.version || '1.16.4');
    const item = mcData.itemsByName[itemName];
    if (!item) throw new Error('Unknown item: ' + itemName);
    // find recipes for this item
    const recipes = bot.recipesFor(item.id, null, 1) || [];
    if (!recipes.length) throw new Error('No recipe available for ' + itemName);

    // prefer non-table recipes (2x2) when possible
    let chosen = recipes[0];
    for (const r of recipes) {
      if (!r.inputs.some(i => i.name === 'crafting_table')) { chosen = r; break; }
    }

    // If chosen recipe requires a workbench (table), find or place one
    let tableBlock = null;
    if (chosen && chosen.requires && chosen.requires.includes('crafting_table')) {
      tableBlock = await findNearbyCraftingTable(bot, 8);
      if (!tableBlock) {
        // try to craft a crafting table first (needs 4 planks)
        try {
          const plankCandidates = ['oak_planks','spruce_planks','birch_planks','jungle_planks','acacia_planks','dark_oak_planks'];
          let plankItem = null;
          for (const p of plankCandidates) {
            const it = bot.inventory.items().find(ii => ii.name && ii.name.includes('planks') && ii.name.includes(p.split('_')[0]));
            if (it) { plankItem = it; break; }
          }
          // simpler: try any planks
          if (!plankItem) plankItem = bot.inventory.items().find(ii => ii.name && ii.name.includes('planks'));
          if (plankItem) {
            // craft crafting_table via inventory 2x2 if possible
            const tableId = mcData.itemsByName.crafting_table.id;
            const recipesForTable = bot.recipesFor(tableId) || [];
            if (recipesForTable.length) {
              await bot.craft(recipesForTable[0], 1, null);
              // try find table again
              tableBlock = await findNearbyCraftingTable(bot, 6);
            }
          }
        } catch (e) {}
      }
    }

    // perform craft
    if (tableBlock) {
      await bot.craft(chosen, quantity, tableBlock);
    } else {
      await bot.craft(chosen, quantity, null);
    }
    return true;
  } catch (e) {
    console.warn('craftItem failed:', e.message || e);
    return false;
  }
}

async function ensureTool(bot, toolName) {
  // If tool exists in inventory, equip it; otherwise attempt to craft
  try {
    const has = bot.inventory.items().find(i => i.name && i.name.includes(toolName));
    if (has) {
      // check durability and enchantments
      try {
        const durOk = checkDurability(has);
        if (!durOk) {
          // attempt repair: if enchanted prefer anvil, otherwise craft replacement
          const enchanted = has.nbt || (has.extra && has.extra.enchantments) || (has.enchantments && has.enchantments.length);
          if (enchanted) {
            const rep = await attemptAnvilRepair(bot, has);
            if (!rep) {
              // fallback to crafting replacement (may lose enchants)
              await craftReplacement(bot, toolName);
            }
          } else {
            const rep = await craftReplacement(bot, toolName);
            if (!rep) {
              // try to equip current if crafting failed
              try { await bot.equip(has, 'hand'); } catch (e) {}
            }
          }
        } else {
          try { await bot.equip(has, 'hand'); } catch (e) {}
        }
      } catch (e) { try { await bot.equip(has, 'hand'); } catch (e2) {} }
      return true;
    }
    // map generic tool requests to concrete recipes & tier pipeline
    const mapping = {
      pickaxe: ['netherite_pickaxe','diamond_pickaxe','iron_pickaxe','stone_pickaxe','wooden_pickaxe'],
      axe: ['netherite_axe','diamond_axe','iron_axe','stone_axe','wooden_axe'],
      shovel: ['netherite_shovel','diamond_shovel','iron_shovel','stone_shovel','wooden_shovel'],
      sword: ['netherite_sword','diamond_sword','iron_sword','stone_sword','wooden_sword'],
      hoe: ['netherite_hoe','diamond_hoe','iron_hoe','stone_hoe','wooden_hoe']
    };
    // normalize
    let key = toolName.toLowerCase();
    if (key.includes('pick')) key = 'pickaxe';
    else if (key.includes('axe')) key = 'axe';
    else if (key.includes('shovel') || key.includes('spade')) key = 'shovel';
    else if (key.includes('sword')) key = 'sword';
    else if (key.includes('hoe')) key = 'hoe';

    if (mapping[key]) {
      for (const t of mapping[key]) {
        try {
          const ok = await craftItem(bot, t, 1);
          if (ok) {
            // equip if crafted into inventory
            const got = bot.inventory.items().find(i => i.name && i.name.includes(t.replace(/_/g,' ')) || (i && i.name && i.name.includes(t)));
            if (got) try { await bot.equip(got, 'hand'); } catch (e) {}
            return true;
          }
        } catch (e) {}
      }
    }
    // fallback: try direct craft call for the given name
    try { const ok2 = await craftItem(bot, toolName, 1); if (ok2) return true; } catch (e) {}
  } catch (e) {}
  return false;
}

// checkDurability: returns true if item durability above threshold (20%) or unknown
function checkDurability(item) {
  try {
    if (!item || typeof item.durability === 'undefined') return true; // unknown, assume ok
    const max = item.maxDurability || item.maxDamage || 0;
    const cur = item.durability || (item.maxDurability ? (item.maxDurability - item.damage) : null);
    if (!max || cur === null) return true;
    const pct = (cur / max);
    return pct > 0.2; // keep if more than 20% remaining
  } catch (e) { return true; }
}

async function craftReplacement(bot, toolName) {
  try {
    // attempt pipeline craft from mapping order (reuse mapping from ensureTool)
    const mapping = {
      pickaxe: ['wooden_pickaxe','stone_pickaxe','iron_pickaxe','diamond_pickaxe','netherite_pickaxe'],
      axe: ['wooden_axe','stone_axe','iron_axe','diamond_axe','netherite_axe'],
      shovel: ['wooden_shovel','stone_shovel','iron_shovel','diamond_shovel','netherite_shovel'],
      sword: ['wooden_sword','stone_sword','iron_sword','diamond_sword','netherite_sword'],
      hoe: ['wooden_hoe','stone_hoe','iron_hoe','diamond_hoe','netherite_hoe']
    };
    let key = toolName.toLowerCase();
    if (key.includes('pick')) key = 'pickaxe'; else if (key.includes('axe')) key = 'axe'; else if (key.includes('shovel')) key = 'shovel'; else if (key.includes('sword')) key = 'sword'; else if (key.includes('hoe')) key = 'hoe';
    if (mapping[key]) {
      for (const t of mapping[key]) {
        try {
          const ok = await craftItem(bot, t, 1);
          if (ok) return true;
        } catch (e) {}
      }
    }
    // last attempt: direct craft
    try { return await craftItem(bot, toolName, 1); } catch (e) { return false; }
  } catch (e) { return false; }
}

async function attemptAnvilRepair(bot, item) {
  try {
    // Try to find nearby anvil
    const anvil = bot.findBlock({ matching: b => b && b.name && b.name.includes('anvil'), maxDistance: 10 });
    if (!anvil) {
      // try to craft an anvil if we have iron blocks and ingots
      try {
        const crafted = await craftItem(bot, 'anvil', 1);
        if (crafted) {
          // try to place anvil near bot
          const placeBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0));
          if (placeBlock) {
            const invAnvil = bot.inventory.items().find(i => i.name && i.name.includes('anvil'));
            if (invAnvil) {
              try { await bot.equip(invAnvil, 'hand'); await require('../utils/actions').placeBlock(bot, placeBlock, invAnvil); } catch (e) {}
              // re-find anvil
              const a2 = bot.findBlock({ matching: b => b && b.name && b.name.includes('anvil'), maxDistance: 6 });
              if (a2) {
                return await useAnvilRepair(bot, a2, item);
              }
            }
          }
        }
      } catch (e) {}
      return false;
    }
    return await useAnvilRepair(bot, anvil, item);
  } catch (e) { console.warn('attemptAnvilRepair failed', e.message); return false; }
}

async function useAnvilRepair(bot, anvilBlock, item) {
  try {
    if (!anvilBlock) return false;
    // open anvil if available (best-effort, some mineflayer versions support openAnvil)
    if (typeof bot.openAnvil === 'function') {
      const anvil = await bot.openAnvil(anvilBlock);
      try {
        // Find a similar item in inventory to combine
        const same = bot.inventory.items().find(i => i.name === item.name && i.count > 0 && i !== item);
        if (same) {
          // attempt repair by placing both items in anvil slots
          await anvil.putInput(same.type, 1);
          await anvil.putInput(item.type, 1);
          // take result
          try { await anvil.takeOutput(0); } catch (e) {}
          anvil.close();
          return true;
        }
      } catch (e) { try { anvil.close(); } catch (e2) {} }
    }
    // fallback: cannot use anvil programmatically — return false so caller can craft replacement
    return false;
  } catch (e) { console.warn('useAnvilRepair failed', e.message); return false; }
}

module.exports = { craftItem, ensureTool, findNearbyCraftingTable };
