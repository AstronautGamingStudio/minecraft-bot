module.exports = {
  async run(bot, args = [], options = {}) {
    bot._taskStopRequested = false;
    bot.chat('Starting speedrun orchestration (experimental)');
    // auto-load per-task specialist model if available
    try {
      const manager = require('../models/manager');
      const pm = manager.bestFor('speedrun');
      if (pm) {
        try { require('../policy/nn_policy').loadModel(pm); bot.chat('Loaded specialist model for speedrun.'); } catch (e) {}
      }
    } catch (e) {}

    // Step 1: gather basic resources (wood/stone/iron/food)
    try {
      await require('./empire').run(bot, []);
      bot.chat('Basic resource gathering complete. Checking for obsidian for nether portal...');
    } catch (e) { bot.chat('Resource gathering step failed: '+e.message); }

    // Step 2: check inventory for obsidian
    const inv = bot.inventory.items();
    const obs = inv.find(i => i.name && i.name.includes('obsidian'));
    if (!obs || obs.count < 10) {
      bot.chat('Not enough obsidian found to build a portal automatically. I can continue to gather but need help mining obsidian (diamond/ netherite pickaxe required).');
      bot.chat('Speedrun step paused — gather obsidian or provide a diamond pickaxe in inventory and re-run `!speedrun` to attempt portal build.');
      return;
    }

    bot.chat('Sufficient obsidian found — attempting to construct a simple nether portal (temporary, may fail in some servers)');

    // Attempt to place portal and enter it
    try {
      // reuse existing portal placement logic
      const centerX = Math.round(bot.entity.position.x) + 2;
      const centerZ = Math.round(bot.entity.position.z);
      const baseY = Math.round(bot.entity.position.y);
      const placements = [];
      for (let y=0;y<5;y++) {
        for (let x=0;x<4;x++) {
          if (x === 0 || x === 3 || y === 0 || y === 4) placements.push({x: centerX + x, y: baseY + y, z: centerZ});
        }
      }

      let placed = 0;
      for (const pos of placements) {
        if (placed >= 10) break;
        try { const nav = require('../utils/nav'); await nav.goto(bot, {x: pos.x, y: pos.y, z: pos.z}, 1.5, 30000, { allowDig: true }); } catch (e) {}
        const it = bot.inventory.items().find(i => i.name && i.name.includes('obsidian'));
        if (!it) break;
        try { await bot.equip(it, 'hand'); const below = bot.blockAt({x: pos.x, y: pos.y-1, z: pos.z}); if (!below) continue; const actions = require('../utils/actions'); await actions.placeBlock(bot, below, it); placed++; } catch (e) {}
      }

      if (placed >= 10) {
        bot.chat('Placed portal frame; try lighting it with flint & steel or fire and then enter it.');
      } else {
        bot.chat('Could not place full portal frame automatically; placed '+placed+' blocks. Manual finishing required.');
      }

      // If portal seems placed, attempt to light and enter if we have flint & steel
      const fns = bot.inventory.items().find(i => i.name && i.name.includes('flint_and_steel'));
      if (placed >= 10 && fns) {
        try { await bot.equip(fns, 'hand'); await bot.activateItem(); bot.chat('Tried lighting portal...'); } catch (e) { bot.chat('Failed to light portal: '+e.message); }

        // Try to step into portal area and wait for dimension change
        try {
          const nav = require('../utils/nav');
          await nav.goto(bot, {x: centerX+1, y: baseY+1, z: centerZ}, 1.5, 30000, { allowDig: true });
          bot.chat('Stepping into portal to enter Nether (if active)');
        } catch (e) { bot.chat('Failed to step into portal: '+e.message); }

        // wait for dimension change event (client uses 'respawn' or 'dimension' events depending on protocol)
        let entered = false;
        const onRespawn = () => { entered = true; bot.chat('Entered a new dimension (respawn event observed)'); };
        bot.on('respawn', onRespawn);
        await new Promise(r => setTimeout(r, 5000));
        bot.removeListener('respawn', onRespawn);

        if (entered) {
          bot.chat('Nether entry detected — commencing basic nether scout');
          // Simple nether scout: run around for a short time and attempt to find nether fortress blocks
          const start = Date.now();
          while (Date.now() - start < 60_000) {
                if (bot._taskStopRequested) { bot.chat('Speedrun scouting stopped'); break; }
            // wander randomly
                const rx = Math.round(bot.entity.position.x + (Math.random()*10-5));
                const rz = Math.round(bot.entity.position.z + (Math.random()*10-5));
                try { const nav = require('../utils/nav'); await nav.goto(bot, {x: rx, y: bot.entity.position.y, z: rz}, 3, 30000, { allowDig: true }); } catch (e) {}
            // scan for nether bricks nearby
            const nb = bot.findBlock({ matching: (b) => b && b.name && b.name.includes('nether_brick'), maxDistance: 24 });
            if (nb) {
              bot.chat('Potential nether fortress structure detected nearby — engaging with pvp module to clear threats.');
              try { await require('./pvp').run(bot, ['nearest'], { duration: 15000 }); } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 500));
          }
          bot.chat('Basic nether scouting complete — return to overworld (manual or via portal).');
        } else {
          bot.chat('Portal did not activate or dimension change not observed.');
        }
      }
    } catch (e) {
      bot.chat('Portal construction failed: '+e.message);
    }    // Attempt to place 10 obsidian blocks in portal shape centered near bot
    try {
      const centerX = Math.round(bot.entity.position.x) + 2;
      const centerZ = Math.round(bot.entity.position.z);
      const baseY = Math.round(bot.entity.position.y);
      // 4x5 frame (place a minimal 4x5 rectangle leaving corners as optional)
      const placements = [];
      for (let y=0;y<5;y++) {
        for (let x=0;x<4;x++) {
          // frame positions
          if (x === 0 || x === 3 || y === 0 || y === 4) placements.push({x: centerX + x, y: baseY + y, z: centerZ});
        }
      }

      // Attempt to place up to 10 obsidian blocks from inventory
      let placed = 0;
      for (const pos of placements) {
        if (placed >= 10) break;
        // Try to navigate near block and place
        try {
          const nav = require('../utils/nav');
          await nav.goto(bot, {x: pos.x, y: pos.y, z: pos.z}, 1.5, 30000, { allowDig: true });
        } catch (e) { /* ignore path failures */ }
        const it = bot.inventory.items().find(i => i.name && i.name.includes('obsidian'));
          if (!it) break;
        try {
          await bot.equip(it, 'hand');
          const below = bot.blockAt({x: pos.x, y: pos.y-1, z: pos.z});
          if (!below) continue;
          const actions = require('../utils/actions');
          await actions.placeBlock(bot, below, it);
          placed++;
        } catch (e) { /* ignore placement errors */ }
      }

      if (placed >= 10) {
        bot.chat('Placed portal frame; try lighting it with flint & steel or fire and then enter it.');
      } else {
        bot.chat('Could not place full portal frame automatically; placed '+placed+' blocks. Manual finishing required.');
      }
    } catch (e) {
      bot.chat('Portal construction failed: '+e.message);
    }
  }
};
