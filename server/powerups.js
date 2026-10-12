'use strict';
const TYPES=Object.freeze({SHIELD:{field:'powerShieldUntil',duration:5000},OVERCLOCK:{field:'powerOverclockUntil',duration:8000},TRIPLE:{field:'powerTripleUntil',duration:8000}});
class Powerups {
  constructor(room,now=Date.now()) {this.room=room;this.orbs=new Map();this.nextSpawn=now+15000;this.sequence=0;}
  drop(x,y,count=1,now=Date.now()) {
    for(let i=0;i<Math.min(3,count) && this.orbs.size<24;i++) {
      const type=Object.keys(TYPES)[i%3],id=`orb_${++this.sequence}`;
      const angle=i*2.39996;
      this.orbs.set(id,{id,type,x:Math.max(25,Math.min(this.room.world.width-25,x+Math.cos(angle)*35*i)),y:Math.max(25,Math.min(this.room.world.height-25,y+Math.sin(angle)*35*i)),expires:now+45000});
    }
  }
  update(now=Date.now()) {
    if(now>=this.nextSpawn) {
      this.nextSpawn=now+20000;
      const type=Object.keys(TYPES)[Math.floor(Math.random()*3)];
      const before=this.sequence;
      this.drop(80+Math.random()*(this.room.world.width-160),80+Math.random()*(this.room.world.height-160),1,now);
      const last=this.orbs.get(`orb_${this.sequence}`);if(this.sequence>before && last)last.type=type;
    }
    for(const [id,orb] of this.orbs) {
      if(now>=orb.expires) {this.orbs.delete(id);continue;}
      for(const p of this.room.players.values()) {
        if(!p.alive || p.hp<=0 || p.levelUpPending || p.evolutionPending || Math.hypot(p.x-orb.x,p.y-orb.y)>p.radius+14) continue;
        p[TYPES[orb.type].field]=now+TYPES[orb.type].duration;
        this.orbs.delete(id);break; // Exactly one authoritative collector.
      }
    }
  }
  snapshot(now=Date.now()) {return [...this.orbs.values()].map(o=>[o.id,Math.round(o.x),Math.round(o.y),o.type,Math.ceil(Math.max(0,o.expires-now)/1000)*1000]);}
  destroy() {this.orbs.clear();this.room=null;}
}
module.exports={Powerups,TYPES};
