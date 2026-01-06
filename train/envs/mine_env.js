// Simple MineEnv: agent must navigate to ore positions and 'dig' them
class MineEnv {
  constructor(opts = {}) {
    this.size = opts.size || 8;
    this.nOres = opts.nOres || 3;
    this.maxSteps = opts.maxSteps || 120;
    this.reset();
  }

  reset() {
    this.agent = { x: 0, y: 0 };
    this.steps = 0;
    this.ores = [];
    while (this.ores.length < this.nOres) {
      const x = Math.floor(Math.random() * this.size);
      const y = Math.floor(Math.random() * this.size);
      if (x === this.agent.x && y === this.agent.y) continue;
      if (!this.ores.some(p => p.x === x && p.y === y)) this.ores.push({ x, y });
    }
    this.dug = 0;
    return this._obs();
  }

  _nearestOre() {
    if (this.ores.length === 0) return null;
    let best = null, bestD = Infinity;
    for (const o of this.ores) {
      const d = Math.abs(o.x - this.agent.x) + Math.abs(o.y - this.agent.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  _obs() {
    const nearest = this._nearestOre();
    const dx = nearest ? (nearest.x - this.agent.x) / this.size : 0;
    const dy = nearest ? (nearest.y - this.agent.y) / this.size : 0;
    return [this.agent.x/this.size, this.agent.y/this.size, dx, dy, (this.nOres-this.dug)/this.nOres, 1 - this.steps/this.maxSteps];
  }

  step(action) {
    // 0=up,1=down,2=left,3=right,4=dig
    this.steps++;
    if (action === 0 && this.agent.y > 0) this.agent.y -= 1;
    if (action === 1 && this.agent.y < this.size-1) this.agent.y += 1;
    if (action === 2 && this.agent.x > 0) this.agent.x -= 1;
    if (action === 3 && this.agent.x < this.size-1) this.agent.x += 1;

    let reward = -0.01;
    let done = false;

    if (action === 4) {
      const idx = this.ores.findIndex(p => p.x === this.agent.x && p.y === this.agent.y);
      if (idx !== -1) {
        this.ores.splice(idx, 1);
        this.dug += 1;
        reward += 1.2; // digging is slightly more rewarded
      } else {
        reward -= 0.05;
      }
    }

    if (this.dug >= this.nOres) done = true;
    if (this.steps >= this.maxSteps) done = true;

    return { obs: this._obs(), reward, done };
  }
}

module.exports = { MineEnv };
