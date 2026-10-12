// Modelo compartido: velocidades en píxeles por tick de 30 Hz.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetMovement = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const STEP_MS = 1000 / 30;
  const BASE_SPEED = 7.5; // 225 px/s a 30 Hz, compartido con el servidor.
  const BASE_ACCELERATION = 0.75;
  function step(p, target, world = { width: 4000, height: 4000 }, obstacles = []) {
    if (p.evolutionPending) { p.vx = p.vy = 0; return; }
    const dt = 1 / 30;
    // Retirar el impulso aplicado en el paso previo antes de limitar el motor.
    p.vx -= p.kickAppliedX || 0; p.vy -= p.kickAppliedY || 0;
    if ((p.comboCount || 0) > 0) {
      p.comboTimer -= dt;
      if (p.comboTimer <= 1e-7) { p.comboCount--; p.comboTimer = p.comboCount ? 2 : 0; }
    }
    p.fireRateMultiplier = 1 - (p.comboCount || 0) * .05;
    const synergy = p.moveSpeedMultiplier = (1 + (p.comboCount || 0) * 0.03) * ((p.overdriveRemaining || 0) > 0 ? 1.35 : 1) * ((p.powerOverclockRemaining || 0)>0?1.5:1);
    p.powerOverclockRemaining=Math.max(0,(p.powerOverclockRemaining || 0)-STEP_MS);
    const dx = target.tx - p.x, dy = target.ty - p.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 2) {
      // Compensar la fricción y conservar la respuesta al mejorar la velocidad.
      const acceleration = BASE_ACCELERATION * ((p.maxSpeed || BASE_SPEED) / BASE_SPEED) * (p.speedMultiplier || 1) * synergy * ((p.slingshotRemaining || 0) > 0 ? 2 : 1);
      p.vx += dx / distance * acceleration;
      p.vy += dy / distance * acceleration;
    }
    p.vx *= 0.92; p.vy *= 0.92;
    const speed = Math.hypot(p.vx, p.vy);
    const cap = (p.maxSpeed || BASE_SPEED) * (p.levelUpPending ? 0.3 : 1) *
      (p.dashing ? 2.8 : 1) * (p.slowed ? 0.35 : 1) * (p.boosted ? 1.1 : 1) * (p.speedMultiplier || 1) * synergy * ((p.slingshotRemaining || 0) > 0 ? 2 : 1);
    if (speed > cap) { p.vx *= cap / speed; p.vy *= cap / speed; }
    if (p.gravityWell && p.gravityWell[2] > 0) {
      const [x,y] = p.gravityWell, distance = Math.hypot(x-p.x,y-p.y);
      if (distance <= 500 && distance > 0) {
        const force = Math.min(900,Math.max(50,12000/((distance+10)**2)));
        // Motor y proyectiles usan px/tick: convertir la aceleración px/s².
        p.vx += (x-p.x)/distance * force * dt / 30;
        p.vy += (y-p.y)/distance * force * dt / 30;
      }
      p.gravityWell = [x,y,Math.max(0,p.gravityWell[2]-STEP_MS)];
    }
    p.kickAppliedX = p.kickX || 0; p.kickAppliedY = p.kickY || 0;
    p.vx += p.kickAppliedX; p.vy += p.kickAppliedY;
    p.kickX = Math.abs(p.kickAppliedX) < .01 ? 0 : p.kickAppliedX * .9;
    p.kickY = Math.abs(p.kickAppliedY) < .01 ? 0 : p.kickAppliedY * .9;
    p.overdriveRemaining = Math.max(0, (p.overdriveRemaining || 0) - STEP_MS);
    p.slingshotRemaining = Math.max(0,(p.slingshotRemaining || 0)-STEP_MS);
    p.teleportRemaining = Math.max(0,(p.teleportRemaining || 0)-STEP_MS);
    const radius = p.radius || 18;
    p.x = Math.max(radius, Math.min(world.width - radius, p.x + p.vx));
    p.y = Math.max(radius, Math.min(world.height - radius, p.y + p.vy));
    for (const o of obstacles) {
      const ox = p.x - o.x, oy = p.y - o.y, d = Math.hypot(ox, oy), r = radius + o.radius;
      if (d < r) {
        const nx = d > 0 ? ox / d : 1, ny = d > 0 ? oy / d : 0;
        p.x = o.x + nx * r; p.y = o.y + ny * r;
        p.vx *= 0.5; p.vy *= 0.5;
        for (const key of ['kickX','kickY','kickAppliedX','kickAppliedY']) p[key]=(p[key] || 0)*.5;
      }
    }
    if (Math.hypot(p.vx, p.vy) > 0.05) p.rotation = Math.atan2(p.vy, p.vx);
    return p;
  }
  return { STEP_MS, BASE_SPEED, BASE_ACCELERATION, step };
});
