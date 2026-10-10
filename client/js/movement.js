// Modelo compartido: velocidades en píxeles por tick de 30 Hz.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetMovement = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const STEP_MS = 1000 / 30;
  function step(p, target, world = { width: 4000, height: 4000 }, obstacles = []) {
    const dx = target.tx - p.x, dy = target.ty - p.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 2) {
      p.vx += dx / distance * 0.35;
      p.vy += dy / distance * 0.35;
    }
    p.vx *= 0.92; p.vy *= 0.92;
    const speed = Math.hypot(p.vx, p.vy);
    const cap = (p.maxSpeed || 4.5) * (p.levelUpPending ? 0.3 : 1) *
      (p.dashing ? 2.8 : 1) * (p.slowed ? 0.35 : 1) * (p.boosted ? 1.1 : 1);
    if (speed > cap) { p.vx *= cap / speed; p.vy *= cap / speed; }
    const radius = p.radius || 18;
    p.x = Math.max(radius, Math.min(world.width - radius, p.x + p.vx));
    p.y = Math.max(radius, Math.min(world.height - radius, p.y + p.vy));
    for (const o of obstacles) {
      const ox = p.x - o.x, oy = p.y - o.y, d = Math.hypot(ox, oy), r = radius + o.radius;
      if (d < r) {
        const nx = d > 0 ? ox / d : 1, ny = d > 0 ? oy / d : 0;
        p.x = o.x + nx * r; p.y = o.y + ny * r;
        p.vx *= 0.5; p.vy *= 0.5;
      }
    }
    if (Math.hypot(p.vx, p.vy) > 0.05) p.rotation = Math.atan2(p.vy, p.vx);
    return p;
  }
  return { STEP_MS, step };
});
