'use strict';
const SKINS=['default','alien','gold','chrome','cyber','void','solar','starlight','void_stalker'];
const TRAILS=['cyan','orange','purple'];
const LASERS={blue:0x20dfff,green:0x00ff88,red:0xff3366,rainbow:0xcc66ff};
function apply(player,data) {
  if (!data || typeof data!=='object') return;
  if (SKINS.includes(data.skin)) player.equippedSkin=player.skin=data.skin;
  if (TRAILS.includes(data.trail)) player.equippedTrail=player.trail=data.trail;
  if (typeof data.laser==='string' && Object.hasOwn(LASERS,data.laser)) player.laserStyle=data.laser;
}
const laserColor = (player,tick=0) => player.laserStyle==='rainbow'
  ? [0xff3366,0xffcc33,0x00ff88,0x20dfff,0xcc66ff][Math.floor(tick/3)%5] : LASERS[player.laserStyle] || LASERS.blue;
module.exports={apply,laserColor};
