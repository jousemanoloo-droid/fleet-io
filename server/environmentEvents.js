'use strict';
// All force/damage is evaluated on Node, never by client zone collision checks.
class EnvironmentEvents {
  constructor(room,now=Date.now()) {this.room=room;this.zones=new Map();this.nextSpawn=now+45000;this.sequence=0;}
  spawn(type,now=Date.now(),position) {
    if(!['BLACK_HOLE','RADIATION'].includes(type) || this.zones.size>=3)return;
    const id=`zone_${++this.sequence}`,x=position?.x??600+Math.random()*(this.room.world.width-1200),y=position?.y??600+Math.random()*(this.room.world.height-1200);
    this.zones.set(id,{id,type,x,y,radius:type==='BLACK_HOLE'?450:550,expires:now+30000});return id;
  }
  update(now=Date.now(),dt=1/30) {
    if(now>=this.nextSpawn) {this.nextSpawn=now+60000;this.spawn(Math.random()<.5?'BLACK_HOLE':'RADIATION',now);}
    for(const [id,z] of this.zones)if(now>=z.expires){
      this.zones.delete(id); // Primero eliminar: una disipación solo tira loot una vez.
      require('./resourceTypes').blackHoleLoot(this.room.extraction,z);
    }
    for(const p of this.room.players.values()) {
      p.radiation=false;
      if(!p.alive || p.evolutionPending)continue;
      for(const z of this.zones.values()) {
        const dx=z.x-p.x,dy=z.y-p.y,distance=Math.hypot(dx,dy);
        if(distance>z.radius)continue;
        if(z.type==='RADIATION') {p.radiation=true;continue;}
        const force=Math.min(900,Math.max(80,180000/(distance+20)**2));
        if(distance>0) {p.vx+=dx/distance*force*dt/30;p.vy+=dy/distance*force*dt/30;}
        if(distance<=75)p.takeDamage(35*dt);
      }
    }
  }
  snapshot(now=Date.now()) {return [...this.zones.values()].map(z=>[z.id,Math.round(z.x),Math.round(z.y),z.radius,z.type,Math.ceil(Math.max(0,z.expires-now)/1000)*1000]);}
  destroy() {this.zones.clear();this.room=null;}
}
module.exports={EnvironmentEvents};
