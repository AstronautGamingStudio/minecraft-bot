const fs = require('fs');
const path = require('path');
const neataptic = require('neataptic');
const { CollectEnv } = require('./envs/collect_env');
const { MineEnv } = require('./envs/mine_env');
const { BuildEnv } = require('./envs/build_env');
const { PvPEnv } = require('./envs/pvp_env');
const modelManager = require('../modules/models/manager');

// Config (tweakable via CLI args)
const POP_SIZE = parseInt(process.env.POP_SIZE || 40);
const INPUTS = 10; // observation vector expanded to include health, food, mobNear, invFrac
const OUTPUTS = 5; // up,down,left,right,interact
const GENERATIONS = parseInt(process.env.GENERATIONS || 60);
const EPISODES = parseInt(process.env.EPISODES || 4);
const TASKS = (process.env.TASKS || 'collect').split(',').map(t=>t.trim());
const MODELS_DIR = path.resolve(__dirname, '..', 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

// Simple CLI flag parsing for simulated environment params
const rawArgs = process.argv.slice(2);
function parseFlag(name) {
  const prefix = `--${name}=`;
  for (const a of rawArgs) if (a.startsWith(prefix)) return a.slice(prefix.length);
  return undefined;
}
const simOptions = {};
const h = parseFlag('health'); if (h !== undefined) simOptions.health = parseFloat(h);
const f = parseFlag('food'); if (f !== undefined) simOptions.food = parseFloat(f);
const m = parseFlag('mob'); if (m !== undefined) simOptions.mobNear = parseFloat(m);
const inv = parseFlag('inv'); if (inv !== undefined) simOptions.invFrac = parseFloat(inv);

let stopRequested = false;
let sigintCount = 0;
process.on('SIGINT', () => {
  sigintCount += 1;
  console.log('SIGINT received');
  if (sigintCount === 1) {
    // request stop; trainer loop will save checkpoints at next gen
    stopRequested = true;
    console.log('Stopping after current generation (press Ctrl-C again to force).');
  } else {
    console.log('Force exit');
    process.exit(2);
  }
});

function _makeEnv(taskName, opts = {}) {
  if (taskName === 'collect') return new CollectEnv(Object.assign({ size: 8, nItems: 3, maxSteps: 80 }, opts));
  if (taskName === 'mine') return new MineEnv(Object.assign({ size: 8, nOres: 3, maxSteps: 100 }, opts));
  if (taskName === 'build') return new BuildEnv(Object.assign({ size: 8, nBlocks: 4, maxSteps: 90 }, opts));
  if (taskName === 'pvp') return new PvPEnv(Object.assign({ size: 8, maxSteps: 120 }, opts));
  throw new Error('Unknown task: ' + taskName);
}

function evaluateNetwork(network) {
  // Multi-task evaluation: return overall average and per-task scores
  const per = {};
  for (const taskName of TASKS) {
  const env = _makeEnv(taskName, simOptions);
    let epTotal = 0;
    for (let ep = 0; ep < EPISODES; ep++) {
      let obs = env.reset();
      let done = false; let epReward = 0;
      while (!done) {
        const out = network.activate(obs);
        const action = out.indexOf(Math.max(...out));
        const { obs: nextObs, reward, done: d } = env.step(action);
        obs = nextObs; epReward += reward; done = d;
      }
      epTotal += epReward;
    }
    per[taskName] = epTotal / EPISODES;
  }
  const keys = Object.keys(per);
  const overall = keys.reduce((s,k)=>s+per[k],0)/keys.length;
  return { overall, per };
}

async function run() {
  console.log('Neuroevolution trainer (collect) starting');

  const neat = new neataptic.Neat(INPUTS, OUTPUTS, null, {
    popsize: POP_SIZE,
    mutation: neataptic.methods.mutation.FFW,
    mutationRate: 0.3
  });

  let bestEver = { score: -Infinity, json: null };
  // At start, if a best-latest exists, try to seed population with it
  const seedPath = path.join(MODELS_DIR, 'best-latest.json');
  if (fs.existsSync(seedPath)) {
    try {
      const seedJson = JSON.parse(fs.readFileSync(seedPath));
      // detect seed input size
      let seedInput = null;
      try { if (Array.isArray(seedJson.nodes)) seedInput = seedJson.nodes.filter(n => n.type === 'input').length; } catch (e) { seedInput = null; }
      if (seedInput && seedInput !== INPUTS) {
        if (seedInput < INPUTS) {
          // attempt simple conversion: add extra isolated input nodes to JSON so network accepts larger obs
          const mod = JSON.parse(JSON.stringify(seedJson));
          const nodes = mod.nodes || [];
          const maxId = nodes.reduce((m,n)=> Math.max(m, (typeof n.id==='number'?n.id: -1)), -1);
          for (let k = 0; k < (INPUTS - seedInput); k++) {
            nodes.push({ id: maxId + 1 + k, type: 'input', bias: 0, squash: 'LOGISTIC' });
          }
          mod.nodes = nodes;
          try {
            const seedNet2 = neataptic.Network.fromJSON(mod);
            neat.population.sort((a,b)=> a.score - b.score);
            for (let i = 0; i < Math.min(3, neat.population.length); i++) {
              neat.population[i] = seedNet2.clone ? seedNet2.clone() : neataptic.Network.fromJSON(mod);
            }
            console.log('  Seeded population from previous best (auto-converted inputs)');
          } catch (e) {
            console.warn('  Auto-conversion of seed failed, skipping seed:', e.message);
          }
        } else {
          console.warn('  Seed model expects more inputs than trainer (skipping seed).');
        }
      } else {
        try {
          const seedNet = neataptic.Network.fromJSON(seedJson);
          neat.population.sort((a,b)=> a.score - b.score);
          for (let i = 0; i < Math.min(3, neat.population.length); i++) {
            neat.population[i] = neataptic.Network.fromJSON(seedJson);
          }
          console.log('  Seeded population from previous best');
        } catch (e) { console.warn('  Failed to seed from best-latest', e); }
      }
    } catch (e) { console.warn('  Failed to seed from best-latest', e); }
  }

  // At start, if a full-population checkpoint exists, restore it to resume training exactly
  const fullCheckpointPath = path.join(MODELS_DIR, 'checkpoint-full-latest.json');
  let genStart = 0;
  if (fs.existsSync(fullCheckpointPath)) {
    try {
      const ck = JSON.parse(fs.readFileSync(fullCheckpointPath));
      if (ck && Array.isArray(ck.population)) {
        neat.population = ck.population.map(j => neataptic.Network.fromJSON(j));
        genStart = (ck.gen || 0) + 1;
        console.log('Resumed population from full checkpoint at gen', ck.gen);
      }
    } catch (e) { console.warn('Failed to load full checkpoint:', e.message); }
  }

  // Continuous mode option: if CONTINUOUS=1, keep evolving until SIGINT
  const continuous = (process.env.CONTINUOUS === '1' || process.env.CONTINUOUS === 'true');
  let gen = genStart;
  while (!stopRequested && (continuous || gen < GENERATIONS)) {
    console.log(`Generation ${gen+1}${continuous ? ' (continuous)' : `/${GENERATIONS}`}`);

    // Evaluate population and record per-task scores
    for (let i = 0; i < neat.population.length; i++) {
      const genome = neat.population[i];
      const res = evaluateNetwork(genome);
      genome.score = res.overall;
      genome._perTask = res.per;
    }

    // Find best in this generation
    neat.sort(); // sorts by score desc
    const best = neat.population[0];
    console.log(`  Best gen ${gen}: ${best.score.toFixed(4)}`);

    if (best.score > bestEver.score) {
      bestEver = { score: best.score, json: best.toJSON() };
      fs.writeFileSync(path.join(MODELS_DIR, `best-gen-${gen}.json`), JSON.stringify(bestEver.json));
      fs.writeFileSync(path.join(MODELS_DIR, `best-latest.json`), JSON.stringify(bestEver.json));
      fs.appendFileSync(path.join(MODELS_DIR, `fitness.log`), `${Date.now()},${gen},${best.score}\n`);
      console.log('  New best -> saved');
    }

    // Save per-task bests via model manager
    try {
      for (const taskName of TASKS) {
        const top = neat.population.reduce((acc, g) => {
          const score = g._perTask && g._perTask[taskName] ? g._perTask[taskName] : 0;
          if (!acc || score > acc.score) return { score, json: g.toJSON() };
          return acc;
        }, null);
        if (top && top.score) {
          const existingPath = modelManager.bestFor(taskName);
          let existingScore = -Infinity;
          if (existingPath) {
            const m = existingPath.match(/-(\d+)\.json$/);
            if (m) existingScore = parseInt(m[1],10)/10000;
          }
          if (top.score > existingScore) {
            modelManager.saveCandidate(taskName, top.json, top.score);
            console.log(`  Saved new per-task best for ${taskName} score=${top.score}`);
          }
        }
      }
    } catch (e) { console.warn('Per-task save failed:', e.message); }

    // Save compact checkpoint and a full-population checkpoint for resume
    fs.writeFileSync(path.join(MODELS_DIR, `checkpoint-gen-${gen}.json`), JSON.stringify({ gen, timestamp: Date.now(), best: best.score }));
    try {
      const popJson = neat.population.map(g => (g.toJSON ? g.toJSON() : g));
      fs.writeFileSync(path.join(MODELS_DIR, `checkpoint-full-gen-${gen}.json`), JSON.stringify({ gen, population: popJson, best: best.score }));
      fs.writeFileSync(path.join(MODELS_DIR, `checkpoint-full-latest.json`), JSON.stringify({ gen, population: popJson, best: best.score }));
      try { modelManager.pruneGlobal(); } catch (e) {}
    } catch (e) { console.warn('Failed to write full checkpoint:', e.message); }

    // Evolve to next generation
    neat.evolve();
    gen += 1;
  }

  // Save final best if not saved
  if (bestEver.json) fs.writeFileSync(path.join(MODELS_DIR, `best-final.json`), JSON.stringify(bestEver.json));
  console.log('Training finished. Models are in models/');
}

if (require.main === module) {
  run().catch(err => console.error(err));
}

module.exports = { run };
