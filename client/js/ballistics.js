// Shared ballistics: positions in pixels, velocities in pixels per 30 Hz tick.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetBallistics = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const BASE_SPEED = 15;
  function launch(player, origin, target, offset = 0, radius = player.radius || 18) {
    const time = Math.hypot(target.x - origin.x, target.y - origin.y) / BASE_SPEED;
    const angle = Math.atan2(target.y + ((target.vy || 0) - (player.vy || 0)) * time - origin.y,
      target.x + ((target.vx || 0) - (player.vx || 0)) * time - origin.x);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: origin.x + cos * (radius + 15) - sin * offset,
      y: origin.y + sin * (radius + 15) + cos * offset,
      vx: cos * BASE_SPEED + (player.vx || 0), vy: sin * BASE_SPEED + (player.vy || 0), rotation: angle };
  }
  return { BASE_SPEED, launch };
});
