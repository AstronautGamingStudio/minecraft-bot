// Simple PvPEnv: agent must chase and 'attack' a moving target
class PvPEnv {
  constructor(opts = {}) {
    this.size = opts.size || 8;
    this.maxSteps = opts.maxSteps || 120;
    this.reset();
  }

  reset() {
    this.agent = { x: 0, y: 0 };
    this.target = { x: this.size-1, y: this.size-1 };
    this.steps = 0;
    this.damage = 0;
    return this._obs();
  }

  _obs() {
    const dx = (this.target.x - this.agent.x)/this.size;
    const dy = (this.target.y - this.agent.y)/this.size;
    return [this.agent.x/this.size, this.agent.y/this.size, dx, dy, this.damage/10, 1 - this.steps/this.maxSteps];
  }

  step(action) {
    // actions: 0=up,1=down,2=left,3=right,4=attack
    this.steps++;
    if (action === 0 && this.agent.y > 0) this.agent.y -= 1;
    if (action === 1 && this.agent.y < this.size-1) this.agent.y += 1;
    if (action === 2 && this.agent.x > 0) this.agent.x -= 1;
    if (action === 3 && this.agent.x < this.size-1) this.agent.x += 1;

    // target moves randomly
    this.target.x += (Math.random() > 0.5 ? 1 : -1);
    this.target.y += (Math.random() > 0.5 ? 1 : -1);
    this.target.x = Math.max(0, Math.min(this.size-1, this.target.x));
    this.target.y = Math.max(0, Math.min(this.size-1, this.target.y));

    let reward = -0.01; let done = false;
    if (action === 4) {
      const dist = Math.abs(this.target.x - this.agent.x) + Math.abs(this.target.y - this.agent.y);
      if (dist <= 1) { this.damage += 1; reward += 1.5; }
      else reward -= 0.1;
    }

    if (this.damage >= 5) done = true; // succeeded in 'defeating' the target
    if (this.steps >= this.maxSteps) done = true;

    return { obs: this._obs(), reward, done };
  }
}

module.exports = { PvPEnv };
