'use strict';
const { segmentHit } = require('./combat');
const RPG = require('./rpg');
// Geometría global inmutable; cooldowns, peligros y cadenas pertenecen a cada sala.
const wormholePairs = Object.freeze([
  Object.freeze({ idA:'w1_A', idB:'w1_B', xA:700,yA:700,xB:3300,yB:3300,radius:60 }),
  Object.freeze({ idA:'w2_A', idB:'w2_B', xA:700,yA:3300,xB:3300,yB:700,radius:60 }),
]);
class Hazards {
  constructor(room, now=Date.now()) {
    this.room=room; this.wormholePairs=wormholePairs;
    this._nodes=wormholePairs.flatMap(p=>[{id:p.idA,x:p.xA,y:p.yA,targetX:p.xB,targetY:p.yB,radius:p.radius},{id:p.idB,x:p.xB,y:p.yB,targetX:p.xA,targetY:p.yA,radius:p.radius}]); this.teleportCooldowns=new Map();this.teleportExitLocks=new Map();
    this.chains=new Map(); this.supernova=null; this.nextNova=now+180000;
    this.nextPlasma=now+30000; this.sequence=0;
  }
  emit(event,data,target) { this.room.io?.to(target||this.room.roomId).emit(event,{...data,roomId:this.room.roomId}); }
  nodes() { return this._nodes; }
  portalHit(e,type,x=e.x+e.vx,y=e.y+e.vy,now=Date.now()) {
    const key=`${type}:${e.id}`, exit=this.teleportExitLocks.get(key);
    if(exit&&Math.hypot(e.x-exit.x,e.y-exit.y)>exit.radius)this.teleportExitLocks.delete(key);
    if(now<(this.teleportCooldowns.get(key)||0)||this.teleportExitLocks.has(key))return null;
    let first=null;
    for(const node of this.nodes()) {
      const fraction=segmentHit(e.x,e.y,x,y,node,node.radius);
      if(fraction!==null&&(!first||fraction<first.fraction))first={...node,fraction};
    }
    return first;
  }
  traverse(e,type='player',node=null,now=Date.now()) {
    if(type==='player'&&!e.alive)return false;
    if(!node)node=this.portalHit(e,type,e.x,e.y,now);
    if(!node||now<(this.teleportCooldowns.get(`${type}:${e.id}`)||0))return false;
    const dx=node.targetX-e.x,dy=node.targetY-e.y;
    e.x=node.targetX;e.y=node.targetY;
    e.vx*=type==='bullet'?1.25:2;e.vy*=type==='bullet'?1.25:2;
    e.motionRevision=(e.motionRevision||0)+1;
    this.teleportCooldowns.set(`${type}:${e.id}`,now+500);
    this.teleportExitLocks.set(`${type}:${e.id}`,{x:e.x,y:e.y,radius:node.radius});
    if(type==='bullet')e.damage*=1.25;
    else {
      e.slingshotRemaining=1000;e.teleportRemaining=500;
      for(const key of ['kickX','kickY','kickAppliedX','kickAppliedY'])e[key]=(e[key]||0)*2;
      e.targetX=Math.max(0,Math.min(this.room.world.width,e.targetX+dx));
      e.targetY=Math.max(0,Math.min(this.room.world.height,e.targetY+dy));
      e.inputSeq=Math.max(e.inputSeq,e.inputQueue.at(-1)?.seq||0);e.inputQueue.length=0;
      for(const d of [...e.drones,...e.orbitalDrones,...(e.tacticalDrones || [])]){d.x+=dx;d.y+=dy;}
    }
    this.emit('WORMHOLE_TRAVERSE',{entityId:e.id,entityType:type,targetX:e.x,targetY:e.y,
      motionRevision:e.motionRevision,player:type==='player'?e.toNetwork():undefined});
    return true;
  }
  startNova(now=Date.now()) {
    const w=this.room.world;let x,y;
    for(let i=0;i<64;i++){
      x=550+Math.random()*(w.width-1100);y=550+Math.random()*(w.height-1100);
      if(Math.hypot(x-w.width/2,y-w.height/2)>=650)break;
      if(i===63){x=550;y=550;}
    }
    this.supernova={x,y,radius:500,phase:'WARNING',started:now,until:now+5000};
    this.emit('SUPERNOVA_WARN',{x,y,radius:500});
  }
  update(now=Date.now()) {
    // Asteroides y pods reciben desplazamiento inercial en el mismo tick.
    for(const e of [...this.room.obstacles.values(),...(this.room.competitive?.pods.values()||[])]) {
      if(!e.vx&&!e.vy)continue;
      e.x=Math.max(e.radius,Math.min(this.room.world.width-e.radius,e.x+(e.vx||0)));
      e.y=Math.max(e.radius,Math.min(this.room.world.height-e.radius,e.y+(e.vy||0)));
      e.vx=Math.abs(e.vx||0)<.01?0:e.vx*.9;e.vy=Math.abs(e.vy||0)<.01?0:e.vy*.9;
    }
    const aliveKeys=new Set([...this.room.players.values()].filter(p=>p.alive).map(p=>`player:${p.id}`));
    for(const id of this.room.projectiles.keys())aliveKeys.add(`bullet:${id}`);
    for(const [key,until]of this.teleportCooldowns)if(now>=until||!aliveKeys.has(key))this.teleportCooldowns.delete(key);
    for(const key of this.teleportExitLocks.keys())if(!aliveKeys.has(key))this.teleportExitLocks.delete(key);
    if(now>=this.nextNova){this.nextNova+=(Math.floor((now-this.nextNova)/180000)+1)*180000;if(!this.supernova)this.startNova(now);}
    const nova=this.supernova;
    if(nova) {
      const elapsed=now-nova.started;
      if(elapsed>=17000){this.supernova=null;this.emit('SUPERNOVA_END',{});}
      else if(elapsed>=15000&&nova.phase!=='DISSIPATE') {
        nova.phase='DISSIPATE';nova.until=nova.started+17000;
        this.repel(nova.x,nova.y,500,600);this.emit('SUPERNOVA_DISSIPATE',{x:nova.x,y:nova.y,radius:500});
      } else if(elapsed>=5000&&elapsed<15000&&nova.phase!=='ACTIVE') {
        nova.phase='ACTIVE';nova.until=nova.started+15000;this.emit('SUPERNOVA_ACTIVE',{x:nova.x,y:nova.y,radius:500});
      }
    }
    for(const p of this.room.players.values()) {
      p.gravityWell=this.supernova?.phase==='ACTIVE'?[this.supernova.x,this.supernova.y,Math.max(0,this.supernova.until-now)]:null;
      if(p.alive&&p.gravityWell&&Math.hypot(p.x-p.gravityWell[0],p.y-p.gravityWell[1])<=80)p.takeDamage(40/30);
    }
    // Las reacciones usan deadlines del tick, sin callbacks ni timers huérfanos.
    for(const [id,chain]of this.chains)if(now>=chain.at){this.chains.delete(id);const rock=this.room.obstacles.get(id);if(rock)this.explode(rock,this.room.players.get(chain.ownerId),now);}
    if(now>=this.nextPlasma){this.nextPlasma=now+30000;this.seedPlasma();}
  }
  seedPlasma() {
    // Mantener libres ambas salidas, incluso para los asteroides normales iniciales.
    for(const rock of this.room.obstacles.values()) {
      if(!this.nodes().some(n=>Math.hypot(rock.x-n.x,rock.y-n.y)<rock.radius+85))continue;
      let moved=false;
      for(let i=0;i<64;i++) {
        const x=120+Math.random()*(this.room.world.width-240),y=120+Math.random()*(this.room.world.height-240);
        if(this.nodes().some(n=>Math.hypot(x-n.x,y-n.y)<rock.radius+85))continue;
        rock.x=x;rock.y=y;moved=true;break;
      }
      if(!moved)this.room.obstacles.delete(rock.id);
    }
    let count=[...this.room.obstacles.values()].filter(o=>o.volatile).length;
    for(let attempt=0;count<8&&attempt<128;attempt++) {
      const x=120+Math.random()*(this.room.world.width-240),y=120+Math.random()*(this.room.world.height-240);
      if(this.nodes().some(n=>Math.hypot(x-n.x,y-n.y)<140)||[...this.room.obstacles.values()].some(o=>Math.hypot(x-o.x,y-o.y)<o.radius+65))continue;
      const id=`plasma:${++this.sequence}`;this.room.obstacles.set(id,{id,x,y,radius:30,hp:200,maxHp:200,volatile:true});count++;
    }
  }
  grid() {
    const cells=new Map();
    const add=(entity,kind)=>{const key=`${Math.floor(entity.x/300)},${Math.floor(entity.y/300)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push({entity,kind});};
    for(const p of this.room.players.values())if(p.alive){add(p,'player');for(const d of [...p.drones,...(p.tacticalDrones||[])])add(d,'drone');}
    for(const b of this.room.projectiles.values())add(b,'bullet');
    for(const o of this.room.obstacles.values())add(o,'rock');
    for(const p of this.room.competitive?.pods.values()||[])add(p,'pod');
    if(this.room.events?.boss)add(this.room.events.boss,'boss');
    return cells;
  }
  nearby(x,y,radius) {
    const grid=this.grid(),result=[];
    for(let gx=Math.floor((x-radius)/300);gx<=Math.floor((x+radius)/300);gx++)
      for(let gy=Math.floor((y-radius)/300);gy<=Math.floor((y+radius)/300);gy++)
        for(const item of grid.get(`${gx},${gy}`)||[])if(Math.hypot(item.entity.x-x,item.entity.y-y)<=radius)result.push(item);
    return result;
  }
  impulse(e,kind,x,y,speed) {
    const angle=Math.atan2(e.y-y,e.x-x),dx=Math.cos(angle)*speed/30,dy=Math.sin(angle)*speed/30;
    e.vx=(e.vx||0)+dx;e.vy=(e.vy||0)+dy;
    if(kind==='boss'||kind==='drone'){e.hazardKickX=(e.hazardKickX||0)+dx;e.hazardKickY=(e.hazardKickY||0)+dy;}
    if(kind==='player'){e.kickX=(e.kickX||0)+dx;e.kickY=(e.kickY||0)+dy;e.kickAppliedX=(e.kickAppliedX||0)+dx;e.kickAppliedY=(e.kickAppliedY||0)+dy;}
  }
  repel(x,y,radius,speed) {for(const {entity,kind}of this.nearby(x,y,radius))this.impulse(entity,kind,x,y,speed);}
  asteroidHit(rock,damage,attacker,now=Date.now()) {
    if(!this.room.obstacles.has(rock.id)||!Number.isFinite(damage)||damage<=0)return;
    rock.hp=Math.max(0,rock.hp-damage);if(!rock.hp)this.explode(rock,attacker,now);
  }
  explode(rock,attacker,now=Date.now()) {
    if(!this.room.obstacles.delete(rock.id))return;
    this.chains.delete(rock.id);
    this.emit('PLASMA_EXPLOSION',{id:rock.id,x:rock.x,y:rock.y,radius:300});
    for(const {entity:e,kind}of this.nearby(rock.x,rock.y,300)) {
      const factor=Math.max(0,1-Math.hypot(e.x-rock.x,e.y-rock.y)/300);if(!factor)continue;
      this.impulse(e,kind,rock.x,rock.y,800*factor);
      if(kind==='player')e.takeDamage(150*factor,attacker);
      else if(kind==='rock'&&e.volatile) {if(!this.chains.has(e.id))this.chains.set(e.id,{at:now+100,ownerId:attacker?.id});}
      else if(kind==='rock')this.room.events.asteroidHit(e,150*factor,attacker);
      else if(kind==='pod')this.room.competitive.hitPod(e,150*factor,attacker);
      else if(kind==='boss'&&attacker)this.room.events.bossHit(150*factor,attacker);
      else if(kind==='drone')for(const p of this.room.players.values()){const index=p.drones.indexOf(e);if(index>=0){p.drones.splice(index,1);break;}const tactical=p.tacticalDrones?.indexOf(e)??-1;if(tactical>=0){e.state='RETURNING';e.attackTimer=0;break;}}
    }
  }
  kill(p) {
    if(!p?.alive)return;
    p.comboCount=Math.min((p.comboCount||0)+1,5);p.comboTimer=10;p._lastCombo=p.comboCount;
    p.fireRateMultiplier=1-p.comboCount*.05;p.moveSpeedMultiplier=1+p.comboCount*.03;
    this.emit('COMBO_UPDATE',{comboCount:p.comboCount,comboTimer:p.comboTimer},p.id);
  }
  combo(p) {if(p._lastCombo!==p.comboCount){p._lastCombo=p.comboCount;this.emit('COMBO_UPDATE',{comboCount:p.comboCount,comboTimer:p.comboTimer},p.id);}}
  remove(id) {this.teleportCooldowns.delete(`player:${id}`);this.teleportExitLocks.delete(`player:${id}`);for(const chain of this.chains.values())if(chain.ownerId===id)chain.ownerId=null;}
  snapshot(now=Date.now()) {return {wormholePairs:this.wormholePairs,supernova:this.supernova?{...this.supernova,remaining:Math.max(0,this.supernova.until-now)}:null};}
  destroy() {this.teleportCooldowns.clear();this.teleportExitLocks.clear();this.chains.clear();this.supernova=null;}
}
module.exports={Hazards,wormholePairs};
