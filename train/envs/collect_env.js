// Simple gridworld CollectEnv for neuroevolution training
// Agent moves in a grid, tries to collect items

class CollectEnv {
  constructor(opts = {}) {
    this.size = opts.size || 8; // grid size
    this.nItems = opts.nItems || 3;
    this.maxSteps = opts.maxSteps || 100;
    // simulated state hooks for training variety
    this.health = typeof opts.health === 'number' ? opts.health : 1;
    this.food = typeof opts.food === 'number' ? opts.food : 1;
    this.mobNear = typeof opts.mobNear === 'number' ? opts.mobNear : 0;
    this.invFrac = typeof opts.invFrac === 'number' ? opts.invFrac : 0;
    this.reset();
  }

  reset() {
    this.agent = { x: Math.floor(this.size/2), y: Math.floor(this.size/2) };
    this.steps = 0;
    // place items at random positions (avoid agent pos)
    this.items = [];
    while (this.items.length < this.nItems) {
      const x = Math.floor(Math.random() * this.size);
      const y = Math.floor(Math.random() * this.size);
      if (x === this.agent.x && y === this.agent.y) continue;
      if (!this.items.some(p => p.x === x && p.y === y)) this.items.push({ x, y });
    }
    this.collected = 0;
    return this._obs();
  }

  _obs() {
    // Observation vector (normalized): agent x,y; nearest item dx,dy; #items left / nItems; steps left / maxSteps
    // plus simple simulated health, food, nearby-mob indicator, and inventory fullness
    const nearest = this._nearestItem();
    const dx = nearest ? (nearest.x - this.agent.x) / this.size : 0;
    const dy = nearest ? (nearest.y - this.agent.y) / this.size : 0;
    // Simulated health and food (1.0 full) - trainer can vary these via env options later
    const health = (typeof this.health === 'number') ? Math.max(0, Math.min(1, this.health)) : 1;
    const food = (typeof this.food === 'number') ? Math.max(0, Math.min(1, this.food)) : 1;
    // simple mobNear simulation: 0..1
    const mobNear = (typeof this.mobNear === 'number') ? Math.max(0, Math.min(1, this.mobNear)) : 0;
    // inventory fullness fraction
    const invFrac = (typeof this.invFrac === 'number') ? Math.max(0, Math.min(1, this.invFrac)) : 0;
    return [
      this.agent.x / this.size,
      this.agent.y / this.size,
      dx,
      dy,
      (this.nItems - this.collected) / this.nItems,
      1 - this.steps / this.maxSteps,
      health,
      food,
      mobNear,
      invFrac
    ];
  }

  _nearestItem() {
    if (this.items.length === 0) return null;
    let best = null;
    let bestD = Infinity;
    for (const it of this.items) {
      const d = Math.abs(it.x - this.agent.x) + Math.abs(it.y - this.agent.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  step(action) {
    // actions: 0=up,1=down,2=left,3=right,4=pick
    this.steps++;
    if (action === 0 && this.agent.y > 0) this.agent.y -= 1;
    if (action === 1 && this.agent.y < this.size-1) this.agent.y += 1;
    if (action === 2 && this.agent.x > 0) this.agent.x -= 1;
    if (action === 3 && this.agent.x < this.size-1) this.agent.x += 1;

    let reward = -0.01; // small step penalty to encourage speed
    let done = false;

    if (action === 4) {
      // try to pick any item at current position
      const idx = this.items.findIndex(p => p.x === this.agent.x && p.y === this.agent.y);
      if (idx !== -1) {
        this.items.splice(idx, 1);
        this.collected += 1;
        reward += 1.0; // reward for collecting
      } else {
        reward -= 0.1; // slight penalty for useless pick
      }
    }

    if (this.collected >= this.nItems) done = true;
    if (this.steps >= this.maxSteps) done = true;

    return { obs: this._obs(), reward, done };
  }
}

module.exports = { CollectEnv };
