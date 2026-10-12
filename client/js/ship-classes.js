// Shared immutable balance rules. Only the server is allowed to apply them.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FleetShipClasses = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const MILESTONES = Object.freeze([10, 25, 45]);
  const CLASSES = Object.freeze({
    hunter: Object.freeze({speed:1.3, hp:.8, cooldown:.7, damage:1, texture:2, radius:20, offsets:Object.freeze([-5,5])}),
    battleship: Object.freeze({speed:.75, hp:2.5, cooldown:1.6, damage:2.2, texture:4, radius:36, splash:120, offsets:Object.freeze([0])}),
    carrier: Object.freeze({speed:.9, hp:1.15, cooldown:1.1, damage:.85, texture:3, radius:30, offsets:Object.freeze([0])}),
    stealth: Object.freeze({speed:1.1, hp:1, cooldown:1, damage:1.1, texture:1, radius:18, offsets:Object.freeze([0])})
  });
  const definition = id => typeof id === 'string' && Object.hasOwn(CLASSES, id) ? CLASSES[id] : null;
  const triple = Object.freeze([-10,0,10]);
  const offsets = p => p.powerTripleRemaining>0 ? triple : definition(p.shipClass)?.offsets || (p.chassis === 4 ? [-15,-5,5,15] : p.chassis >= 2 ? [-5,5] : [0]);
  const points=ys=>Object.freeze(ys.map(y=>Object.freeze({x:46,y})));
  const gunOffsets=Object.freeze({hunter:points([-8,8]),battleship:points([0]),carrier:points([0]),stealth:points([0]),
    1:points([0]),2:points([-8,8]),3:points([-8,8]),4:points([-15,-5,5,15])});
  const guns=p=>gunOffsets[p.shipClass] || gunOffsets[p.chassis] || gunOffsets[1];
  const renderScale=p=>p.chassis===4?.85:p.chassis===3?.7:p.chassis===2?.6:.55;
  function muzzle(p,index=0,scale=renderScale(p)){
    const g=guns(p)[index%guns(p).length],angle=p.rotation || 0,c=Math.cos(angle),s=Math.sin(angle);
    return {x:p.x+(g.x*c-g.y*s)*scale,y:p.y+(g.x*s+g.y*c)*scale,muzzle:true,main:true};
  }
  const pattern=p=>p.powerTripleRemaining>0?[{gun:0,spread:-.06},{gun:guns(p).length>1?1:0,spread:0},{gun:0,spread:.06}]:guns(p).map((g,gun)=>({gun,spread:0}));
  return {MILESTONES, CLASSES, definition, offsets,gunOffsets,guns,muzzle,pattern,renderScale};
});
