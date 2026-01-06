let PVP = null;
try {
  PVP = require('mineflayer-pvp').plugin;
} catch (err) {
  // Optional dependency missing — PvP will fall back to a basic combat loop
}
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear } = require('mineflayer-pathfinder').goals;

module.exports = {
  async run(bot, args = [], options = {}) {
    const choice = args[0] || 'nearest';
    bot._taskStopRequested = false;
    bot.chat(`Starting PvP task: ${choice}`);
    // auto-load per-task specialist model if available
    try {
      const manager = require('../models/manager');
      const pm = manager.bestFor('pvp');
      if (pm) {
        try { require('../policy/nn_policy').loadModel(pm); bot.chat('Loaded specialist model for pvp.'); } catch (e) {}
      }
    } catch (e) {}

    // Attach pvp plugin if available
    if (PVP) {
      try { bot.loadPlugin(PVP); } catch (e) { /* ignore */ }
    }

    // find a target
      let targetEntity = null;
      // initialize hostile tracking
      const logic = require('../brain/logic');
      try { logic.init(bot); } catch (e) {}
      if (choice && typeof choice === 'object' && choice.id) {
        // caller passed an entity directly
        targetEntity = choice;
      } else if (choice === 'nearest') {
        // prefer recent hostiles (things that attacked us)
        const hostile = logic.getNearestHostile(bot);
        if (hostile) targetEntity = hostile;
        else {
          const entities = Object.values(bot.entities).filter(e => e.type === 'mob' || e.type === 'player');
          // prefer non-friends and non-awaiting players
          let sorted = entities.filter(e => e !== bot.entity && e.position).sort((a,b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position));
          targetEntity = sorted[0];
        }
      } else {
        targetEntity = Object.values(bot.entities).find(e => e.username === choice || (e.metadata && e.metadata.name && e.metadata.name.includes(choice)));
      }

    if (!targetEntity) { bot.chat('No target found for PvP.'); return; }

    bot.chat('Target selected: ' + (targetEntity.username || targetEntity.type));

    // Better combat: choose best weapon (axe or sword) and attempt flanking patterns
    try { bot.loadPlugin(pathfinder); } catch (e) {}
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    try {
      if (bot.pathfinder && bot.pathfinder.setMovements) {
        bot.pathfinder.setMovements(defaultMove);
      } else {
        console.warn('PvP: pathfinder not available — skipping setMovements');
      }
    } catch (e) {
      console.warn('PvP: error while setting pathfinder movements:', e && e.message);
    }

    // Choose best weapon available (axe or sword) and attempt flanking patterns; support shield, bow, and potions
    // Weapons preference
    const preferWeapon = ['netherite_sword','diamond_sword','iron_sword','stone_sword','wooden_sword','diamond_axe','iron_axe','stone_axe'];
    let weapon = bot.inventory.items().find(i => i.name && preferWeapon.some(w => i.name.includes(w.replace('_',' ')) || i.name.includes(w)));
    if (!weapon) weapon = bot.inventory.items().find(i => i.name && i.name.includes('sword'));

    // Shields: equip to off-hand if present
    const shield = bot.inventory.items().find(i => i.name && i.name.includes('shield'));
    if (shield) {
      try { await bot.equip(shield, 'off-hand'); } catch (e) { /* ignore */ }
    }

    // Bow & arrows
    const bow = bot.inventory.items().find(i => i.name && i.name.includes('bow'));
    const arrows = bot.inventory.items().find(i => i.name && i.name.includes('arrow'));

    if (weapon) await bot.equip(weapon, 'hand');

    // Potions: healing or regeneration splash
    const potion = bot.inventory.items().find(i => i.name && (i.name.includes('potion') || i.name.includes('splash')) && (i.name.includes('healing') || i.name.includes('regeneration')));

    let running = true;
    const attackLoop = async () => {
      while (running) {
        if (bot._taskStopRequested) { running = false; bot.chat('PvP task stopped by user'); break; }
        try {
          if (!bot.entities[targetEntity.id]) { bot.chat('Target no longer present'); break; }
          const tpos = targetEntity.position;

          // If target is far and we have a bow+arrows use ranged bursts
          const dist = bot.entity.position.distanceTo(tpos);
          if (bow && arrows && dist > 7) {
            // equip bow and attempt a ranged burst
            try { await bot.equip(bow, 'hand'); } catch (e) {}
            // aim and use
            await bot.lookAt(targetEntity.position.offset(0, 1.5, 0));
            bot.activateItem();
            await new Promise(r => setTimeout(r, 700));
            bot.deactivateItem();
            // re-equip melee weapon
            if (weapon) await bot.equip(weapon, 'hand');
            await new Promise(r => setTimeout(r, 600));
            continue;
          }

          // Compute a flanking position for close combat
          const dx = tpos.x - bot.entity.position.x;
          const dz = tpos.z - bot.entity.position.z;
          const angle = Math.atan2(dz, dx);
          const flankAngle = angle + (Math.random() > 0.5 ? 0.6 : -0.6);
          const radius = 2.2;
          const fx = Math.round(tpos.x + Math.cos(flankAngle) * radius);
          const fz = Math.round(tpos.z + Math.sin(flankAngle) * radius);
          const goal = new GoalNear(fx, tpos.y, fz, 1.2);
          try {
            const nav = require('../utils/nav');
            const ok = await nav.goto(bot, { x: fx, y: tpos.y, z: fz }, 1.2);
            if (!ok) { /* continue with next loop */ }
          } catch (e) { /* ignore */ }

          // Use potion if low and we have one
          if (bot.health < 6 && potion) {
            try { await bot.equip(potion, 'hand'); await bot.activateItem(); await new Promise(r=>setTimeout(r, 600)); bot.deactivateItem(); } catch (e) {}
          }

          // If shield is equipped, raise it while approaching
          if (shield) {
            try { await bot.activateItem(); } catch (e) {}
          }

          // short attack burst
          const burst = 3;
          for (let i=0;i<burst;i++) {
            if (!bot.entities[targetEntity.id]) break;
            try { await bot.attack(targetEntity, true); try { bot._stats = bot._stats || {}; bot._stats.attacks = (bot._stats.attacks||0)+1; } catch(e){} } catch (e) { /* ignore */ }
            await new Promise(r => setTimeout(r, 300));
          }

          // if target disappeared after our burst, count as kill
          if (!bot.entities[targetEntity.id]) {
            try { bot._stats = bot._stats || {}; bot._stats.kills = (bot._stats.kills||0)+1; } catch(e){}
          }

          // Drop shield usage
          if (shield) try { bot.deactivateItem(); } catch (e) {}

          // If low health, back away and try to regen
          if (bot.health < 8) {
            bot.chat('Low health, retreating');
            await bot.setControlState('sprint', true);
            await bot.setControlState('back', true);
            await new Promise(r=>setTimeout(r, 800));
            await bot.setControlState('back', false);
            await bot.setControlState('sprint', false);
            await new Promise(r=>setTimeout(r, 2000));
          }
        } catch (err) {
          console.error('PvP loop error:', err.message || err);
        }
        await new Promise(r => setTimeout(r, 400));
      }
    };

    attackLoop();
    const duration = options.duration || 60 * 1000;
    setTimeout(() => { running = false; bot.chat('PvP task ended'); }, duration);
  }
};
