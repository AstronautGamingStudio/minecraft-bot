const { pathfinder, Movements } = require('mineflayer-pathfinder');
const { GoalNear } = require('mineflayer-pathfinder').goals;
const policy = require('./nn_policy');

// Safe runtime model-controlled collect loop. Runs until stopped or timeout.
module.exports = {
  async runCollect(bot, opts = {}) {
    bot.loadPlugin(pathfinder);
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    const maxSteps = opts.maxSteps || 200;
    const stepDelay = opts.stepDelay || 500; // ms between model steps
    const pathTimeout = opts.pathTimeout || 8000; // ms to wait for path

    if (bot._modelController && bot._modelController.running) {
      throw new Error('Model controller already running');
    }

    // allow external override of policy params
    if (typeof opts.epsilon === 'number' && policy.setConfig) policy.setConfig({ epsilon: opts.epsilon });

    let stopRequested = false;
    bot._modelController = { running: true, stop: () => { stopRequested = true; } };

    const startTime = Date.now();

    const buildObservation = () => {
      // Map richer world info into observation vector
      const pos = bot.entity ? bot.entity.position : null;
      if (!pos) return null;
      // find nearest item entity
      const items = Object.values(bot.entities).filter(e => e.type === 'object');
      let nearest = null; let bestD = Infinity;
      for (const it of items) {
        const d = bot.entity.position.distanceTo(it.position);
        if (d < bestD) { bestD = d; nearest = it; }
      }

      // nearest mob (hostile) distance
      const mobs = Object.values(bot.entities).filter(e => e.type === 'mob');
      let nearestMobD = Infinity;
      for (const m of mobs) {
        const d = bot.entity.position.distanceTo(m.position);
        if (d < nearestMobD) nearestMobD = d;
      }

      const radius = 32; // normalization radius
      const ax = bot.entity.position.x / radius;
      const az = bot.entity.position.z / radius;
      const dx = nearest ? (nearest.position.x - bot.entity.position.x) / radius : 0;
      const dz = nearest ? (nearest.position.z - bot.entity.position.z) / radius : 0;
      const itemsLeft = items.length > 0 ? 1 : 0;
      const timeFrac = Math.min(1, (Date.now() - startTime) / (opts.timeout || 60000));

      // health and food scaled to [0,1]
      const health = bot.health ? Math.min(20, bot.health) / 20 : 1;
      const food = bot.food ? Math.min(20, bot.food) / 20 : 1;
      const mobNear = nearestMobD < 10 ? 1 - Math.min(1, nearestMobD / 10) : 0;
      // inventory fullness fraction (0..1)
      let invFrac = 0;
      try {
        const invItems = bot.inventory && typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
        const maxSlots = (bot.inventory && bot.inventory.slots && bot.inventory.slots.length) ? bot.inventory.slots.length : 36;
        invFrac = Math.min(1, invItems.length / maxSlots);
      } catch (e) { invFrac = 0; }

      // observation: keep compatible prefix but add extras to match training env
      return [ax, az, dx, dz, itemsLeft, 1 - timeFrac, health, food, mobNear, invFrac];
    };

    const gotoWithTimeout = (goal, ms) => {
      return Promise.race([
        bot.pathfinder.goto(goal),
        new Promise((_, rej) => setTimeout(() => rej(new Error('path timeout')), ms))
      ]);
    };

    try {
      let steps = 0;
      while (!stopRequested && steps < maxSteps) {
        const obs = buildObservation();
        if (!obs) break;

        // Policy.act will fallback to heuristic if no model is loaded
        const action = policy.act(obs); // 0..N-1

        if (action >= 0 && action <= 3) {
          // compute a small waypoint relative to current pos
          const stepSize = 1; // blocks
          const tx = Math.round(bot.entity.position.x) + (action === 2 ? -stepSize : (action === 3 ? stepSize : 0));
          const tz = Math.round(bot.entity.position.z) + (action === 0 ? -stepSize : (action === 1 ? stepSize : 0));
          const ty = Math.round(bot.entity.position.y);
          const goal = new GoalNear(tx, ty, tz, 0.8);
          try {
            await gotoWithTimeout(goal, pathTimeout);
          } catch (e) {
            console.warn('Path error:', e.message);
          }
        } else if (action >= 4) {
          // interact/pick: if an item entity is very close, pickup is automatic
          const items = Object.values(bot.entities).filter(e => e.type === 'object');
          const near = items.find(it => bot.entity.position.distanceTo(it.position) < 1.5);
          if (near) {
            // stay nearby briefly to allow pickup
            await new Promise(r => setTimeout(r, 300));
          } else {
            try {
              const radiusBlocks = 8;
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
                      console.log(`Took ${item.name} x${item.count}`);
                      break;
                    }
                  }
                } finally { chest.close(); }
              }
            } catch (e) {
              console.warn('Chest interaction failed:', e.message);
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
