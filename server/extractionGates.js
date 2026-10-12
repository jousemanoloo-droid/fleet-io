'use strict';
const {performance}=require('node:perf_hooks');
const GATE_RADIUS=120, GATE_LIFETIME=45000;

// One bounded scheduler per room, driven by the existing simulation tick.
class ExtractionGates {
  constructor(room,{now=()=>performance.now(),random=Math.random}={}) {
    this.room=room;this.now=now;this.random=random;this.gates=new Map();this.sequence=0;
    this.nextSpawn=this.now()+this.interval();this.lastSync=-Infinity;
  }
  interval(){return 120000+this.random()*120000;}
  emit(event,data,target=this.room.roomId){
    try{this.room.io.to(target).emit(event,{...data,roomId:this.room.roomId});}catch{}
  }
  snapshot(){const now=this.now();return [...this.gates.values()].map(g=>({id:g.id,x:g.x,y:g.y,radius:g.radius,remaining:Math.max(0,g.expires-now)}));}
  sync(target){this.emit('extraction:gates',{gates:this.snapshot()},target);}
  spawn(count=1+Math.floor(this.random()*2)) {
    const now=this.now(),world=this.room.world;
    for(let n=0;n<Math.min(2,count) && this.gates.size<2;n++) {
      let position;
      for(let attempt=0;attempt<32;attempt++) {
        const x=180+this.random()*Math.max(0,world.width-360),y=180+this.random()*Math.max(0,world.height-360);
        if([...this.room.obstacles.values()].some(o=>Math.hypot(x-o.x,y-o.y)<o.radius+GATE_RADIUS+30) ||
          [...this.gates.values()].some(g=>Math.hypot(x-g.x,y-g.y)<800))continue;
        position={x,y};break;
      }
      if(!position)continue;
      const gate={id:'exit_'+ ++this.sequence,...position,radius:GATE_RADIUS,expires:now+GATE_LIFETIME};
      this.gates.set(gate.id,gate);
      this.emit('extraction:opened',{id:gate.id,x:Math.round(gate.x),y:Math.round(gate.y)});
    }
    this.sync();this.lastSync=now;
  }
  update() {
    const now=this.now();
    for(const [id,g]of this.gates)if(now>=g.expires)this.gates.delete(id);
    if(now>=this.nextSpawn){this.spawn();this.nextSpawn=now+this.interval();}
    if(now-this.lastSync>=2000){this.lastSync=now;this.sync();}
  }
  containing(player) {
    const now=this.now();
    for(const g of this.gates.values())if(now<g.expires && (player.x-g.x)**2+(player.y-g.y)**2<=g.radius**2)return g;
    return null;
  }
  destroy(){this.gates.clear();this.room=null;}
}
module.exports={ExtractionGates,GATE_RADIUS,GATE_LIFETIME};
