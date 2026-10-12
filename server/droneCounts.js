'use strict';
function activeDroneCount(player){
  if(!player.alive || player.hp<=0)return 0;
  let count=0;for(const list of [player.drones,player.tacticalDrones,player.orbitalDrones])for(const d of list || [])if(d.health!==0 && d.hp!==0)count++;
  return count;
}
module.exports={activeDroneCount};
