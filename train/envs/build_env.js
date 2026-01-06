// Simple BuildEnv: agent must move to target build locations and 'place' blocks
class BuildEnv {
  constructor(opts = {}) {
    this.size = opts.size || 8;
    this.nBlocks = opts.nBlocks || 4;
    this.maxSteps = opts.maxSteps || 100;
    this.reset();
  }

  reset() {
    this.agent = { x: Math.floor(this.size/2), y: Math.floor(this.size/2) };
    this.steps = 0;
    this.targets = [];
    while (this.targets.length < this.nBlocks) {
      const x = Math.floor(Math.random() * this.size);
      const y = Math.floor(Math.random() * this.size);
      if (x === this.agent.x && y === this.agent.y) continue;
      if (!this.targets.some(p => p.x === x && p.y === y)) this.targets.push({ x, y, placed: false });
    }
    this.placed = 0;
    return this._obs();
  }

  _nextTarget() {
    return this.targets.find(t => !t.placed) || null;
  }

  _obs() {
    const t = this._nextTarget();
    const dx = t ? (t.x - this.agent.x) / this.size : 0;
    const dy = t ? (t.y - this.agent.y) / this.size : 0;
    return [this.agent.x/this.size, this.agent.y/this.size, dx, dy, (this.nBlocks-this.placed)/this.nBlocks, 1 - this.steps/this.maxSteps];
  }

  step(action) {
    // actions: 0=up,1=down,2=left,3=right,4=place
    this.steps++;
    if (action === 0 && this.agent.y > 0) this.agent.y -= 1;
    if (action === 1 && this.agent.y < this.size-1) this.agent.y += 1;
    if (action === 2 && this.agent.x > 0) this.agent.x -= 1;
    if (action === 3 && this.agent.x < this.size-1) this.agent.x += 1;

    let reward = -0.01;
    let done = false;

    if (action === 4) {
      const idx = this.targets.findIndex(t => t.x === this.agent.x && t.y === this.agent.y && !t.placed);
      if (idx !== -1) {
        this.targets[idx].placed = true;
        this.placed += 1;
        reward += 1.0;
      } else {
        reward -= 0.05;
      }
    }

    if (this.placed >= this.nBlocks) done = true;
    if (this.steps >= this.maxSteps) done = true;

    return { obs: this._obs(), reward, done };
  }
}

module.exports = { BuildEnv };
