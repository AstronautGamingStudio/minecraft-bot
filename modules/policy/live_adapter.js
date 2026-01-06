const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear } = require('mineflayer-pathfinder').goals;
const policy = require('./nn_policy');

// Safe runtime model-controlled collect loop. Runs until stopped or timeout.
module.exports = {
  async runCollect(bot, opts = {}) {
    if (!policy.available()) {
      throw new Error('No policy loaded');
    }
    bot.loadPlugin(pathfinder);
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    const maxSteps = opts.maxSteps || 200;
    const stepDelay = opts.stepDelay || 600; // ms between model steps

    if (bot._modelController && bot._modelController.running) {
      throw new Error('Model controller already running');
    }

    let stopRequested = false;
    bot._modelController = { running: true, stop: () => { stopRequested = true; } };

    const startTime = Date.now();

    const buildObservation = () => {
      // Map limited world info into 6-element observation like the sim
      const pos = bot.entity ? bot.entity.position : null;
      if (!pos) return null;
      // find nearest item entity
      const items = Object.values(bot.entities).filter(e => e.type === 'object');
      let nearest = null; let bestD = Infinity;
      for (const it of items) {
        const d = bot.entity.position.distanceTo(it.position);
        if (d < bestD) { bestD = d; nearest = it; }
      }
      const radius = 32; // normalization radius
      const ax = bot.entity.position.x / radius;
      const az = bot.entity.position.z / radius;
      const dx = nearest ? (nearest.position.x - bot.entity.position.x) / radius : 0;
      const dz = nearest ? (nearest.position.z - bot.entity.position.z) / radius : 0;
      // simple items left estimate: 1 if any items nearby else 0
      const itemsLeft = items.length > 0 ? 1 : 0;
      const timeFrac = Math.min(1, (Date.now() - startTime) / (opts.timeout || 60000));
      return [ax, az, dx, dz, itemsLeft, 1 - timeFrac];
    };

    try {
      let steps = 0;
      while (!stopRequested && steps < maxSteps) {
        const obs = buildObservation();
        if (!obs) break;
        const action = policy.act(obs); // 0..4

        if (action === 0 || action === 1 || action === 2 || action === 3) {
          // compute a small waypoint relative to current pos
          const stepSize = 1; // blocks
          const tx = Math.round(bot.entity.position.x) + (action === 2 ? -stepSize : (action === 3 ? stepSize : 0));
          const tz = Math.round(bot.entity.position.z) + (action === 0 ? -stepSize : (action === 1 ? stepSize : 0));
          const ty = Math.round(bot.entity.position.y);
          const goal = new GoalNear(tx, ty, tz, 0.8);
          try {
            await bot.pathfinder.goto(goal);
          } catch (e) {
            // path failed, continue
            bot.chat('Path error: ' + e.message);
          }
        } else if (action === 4) {
          // interact/pick: if an item entity is very close, we're fine (pickup auto), otherwise look for containers
          const items = Object.values(bot.entities).filter(e => e.type === 'object');
          const near = items.find(it => bot.entity.position.distanceTo(it.position) < 1.5);
          if (near) {
            bot.chat('Attempting pickup (near item)');
            // pickup occurs automatically when in range
          } else {
            bot.chat('Interact action: searching for nearby containers');
            try {
              // look for nearby chests (within radius)
              const radiusBlocks = 8;
              const chestBlock = bot.findBlock({
                matching: b => b && (b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'barrel'),
                maxDistance: radiusBlocks
              });
              if (chestBlock) {
                bot.chat('Found chest nearby, attempting to open');
                const chest = await bot.openChest(chestBlock);
                try {
                  for (let i = 0; i < chest.containerItems().length; i++) {
                    const item = chest.containerItems()[i];
                    if (item && item.type) {
                      await chest.withdraw(i, Math.min(item.count, 64));
                      bot.chat(`Took ${item.name} x${item.count}`);
                      break;
                    }
                  }
                } finally { chest.close(); }
              } else {
                bot.chat('No chest found nearby');
              }
            } catch (e) {
              bot.chat('Chest interaction failed: ' + e.message);
            }
          }
        }

        steps++;
        await new Promise(r => setTimeout(r, stepDelay));
      }
    } finally {
      bot._modelController.running = false;
      bot._modelController = null;
    }
    return;
  }
};
