'use strict';
// Reusable broad phase: each ship/escort occupies one bucket. Swept segments
// query every crossed bucket, including high-speed reflected shots.
class CombatGrid {
  constructor() {this.cells=new Map();this.free=[];}
  clear() {for(const bucket of this.cells.values()){bucket.length=0;this.free.push(bucket);}this.cells.clear();}
  rebuild(players) {
    this.clear();this.padding=0;this.minX=this.minY=Infinity;this.maxX=this.maxY=-Infinity;
    const add=(target,p,radius)=>{
      const x=Math.floor(target.x/256),y=Math.floor(target.y/256),key=x+','+y;
      let bucket=this.cells.get(key);if(!bucket){bucket=this.free.pop() || [];this.cells.set(key,bucket);}
      bucket.push(target,p,radius);this.padding=Math.max(this.padding,radius+3);
      this.minX=Math.min(this.minX,x);this.minY=Math.min(this.minY,y);this.maxX=Math.max(this.maxX,x);this.maxY=Math.max(this.maxY,y);
    };
    for(const p of players)if(p.alive){add(p,p,p.radius);for(const d of p.drones)add(d,p,8);}
  }
  visit(x,y,endX,endY,callback) {
    const minX=Math.max(this.minX,Math.floor((Math.min(x,endX)-this.padding)/256)),maxX=Math.min(this.maxX,Math.floor((Math.max(x,endX)+this.padding)/256));
    const minY=Math.max(this.minY,Math.floor((Math.min(y,endY)-this.padding)/256)),maxY=Math.min(this.maxY,Math.floor((Math.max(y,endY)+this.padding)/256));
    for(let gx=minX;gx<=maxX;gx++)for(let gy=minY;gy<=maxY;gy++) {
      const bucket=this.cells.get(gx+','+gy);if(!bucket)continue;
      for(let i=0;i<bucket.length;i+=3)callback(bucket[i],bucket[i+1],bucket[i+2]);
    }
  }
}
module.exports={CombatGrid};
