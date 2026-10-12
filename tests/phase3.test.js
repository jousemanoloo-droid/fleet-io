'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Player}=require('../server/entities'),{Powerups}=require('../server/powerups'),{EnvironmentEvents}=require('../server/environmentEvents');
const {WorldEvents}=require('../server/worldEvents'),RPG=require('../server/rpg'),Classes=require('../server/shipClasses');
const Movement=require('../client/js/movement'),Rules=require('../client/js/ship-classes'),Network=require('../client/js/network');
function fixture(now=0) {
  const p=new Player('p','p');p.x=p.y=p.targetX=p.targetY=2000;
  const room={roomId:'r',world:{width:4000,height:4000},players:new Map([['p',p]]),projectiles:new Map(),obstacles:new Map(),io:{to:()=>({emit() {}})}};
  room.events=new WorldEvents(room,now,now);room.powerups=new Powerups(room,now);room.environment=new EnvironmentEvents(room,now);
  return {p,room};
}
test('boss uses a bounded 3–5 minute schedule, random in-bounds spawn and expires without orphaned bullets',()=>{
  const {room}=fixture();const m=room.events.bossManager;
  assert.ok(m.nextSpawn>=180000 && m.nextSpawn<=300000);
  m.update([],m.nextSpawn);assert.ok(m.boss);assert.ok(m.boss.x>=200 && m.boss.x<=3800);
  const id=m.boss.id;m.updateBoss([{x:m.boss.x+150,y:m.boss.y}],1000);assert.equal(room.projectiles.size,24);
  room.projectiles.set('reflected',{id:'reflected',ownerId:'p',sourceId:id});
  room.projectiles.set('unrelated',{id:'unrelated',ownerId:'p'});
  m.nextSpawn=1000000000;m.update([],m.boss.expires);
  assert.equal(m.boss,null);assert.deepEqual([...room.projectiles.keys()],['unrelated']);
});
test('boss damage ledger rejects invalid damage and grants proportional credit/XP plus exactly three rare drops once',()=>{
  const {p,room}=fixture();const q=new Player('q','q');room.players.set(q.id,q);room.events.spawnBoss();
  room.events.bossHit(NaN,p);room.events.bossHit(Infinity,p);assert.equal(room.events.boss.hp,12000);
  room.events.bossHit(3000,p);room.events.bossHit(9000,q);
  assert.equal(p.totalXp,1500);assert.equal(q.totalXp,4500);
  assert.equal(p.coinRewards.reduce((n,r)=>n+r.coins,0),750);assert.equal(room.powerups.orbs.size,3);
  room.events.bossHit(9000,q);assert.equal(q.totalXp,4500);assert.equal(room.projectiles.size,0);
});
test('powerup collection is server-only and single-owner; exact durations expire, immunity includes hazards',t=>{
  let now=0;t.mock.method(Date,'now',()=>now);
  const {p,room}=fixture();const other=new Player('q','q');other.x=other.y=2000;room.players.set(other.id,other);
  room.powerups.drop(2000,2000,1,now);room.powerups.update(now);
  assert.equal(p.powerShieldUntil,5000);assert.equal(other.powerShieldUntil,0);
  p.takeDamage(1000);assert.equal(p.hp,100);
  now=5000;p.takeDamage(10);assert.equal(p.hp,90);
  for(const type of ['OVERCLOCK','TRIPLE']) {
    room.powerups.drop(2000,2000,1,now);[...room.powerups.orbs.values()][0].type=type;room.powerups.update(now);
  }
  assert.equal(p.powerOverclockUntil,13000);assert.equal(p.powerTripleUntil,13000);
  assert.equal(RPG.cooldown(p),400/1.5);
  assert.deepEqual(Rules.offsets(p.toNetwork()),[-10,0,10]);
  const state={...p.toNetwork(),x:2000,y:2000,vx:0,vy:0};for(let i=0;i<30;i++)Movement.step(state,{tx:3000,ty:2000});
  assert.ok(Math.hypot(state.vx,state.vy)>Movement.BASE_SPEED);
  now=13000;assert.equal(RPG.cooldown(p),400);assert.deepEqual(Rules.offsets(p.toNetwork()),[0]);
  p.die();assert.equal(p.powerShieldUntil,0);assert.equal(p.powerTripleUntil,0);
});
test('server environment applies pull/core damage, blocks regeneration and expires radiation',t=>{
  let now=5000;t.mock.method(Date,'now',()=>now);
  const {p,room}=fixture();p.hp=50;
  room.environment.spawn('RADIATION',now,{x:2000,y:2000});room.environment.update(now);
  Classes.tick(p,1,now);assert.equal(p.hp,50);assert.equal(p.radiation,true);
  room.environment.spawn('BLACK_HOLE',now,{x:2050,y:2000});room.environment.update(now);
  assert.ok(p.vx>0);assert.ok(p.hp<50);
  now+=30000;room.environment.update(now);assert.equal(room.environment.zones.size,0);assert.equal(p.radiation,false);
});
test('orbs/zones stay bounded and snapshots roundtrip compressed world deltas across lost packets',()=>{
  const {room}=fixture();for(let i=0;i<30;i++)room.powerups.drop(100,100,3,0);
  for(let i=0;i<10;i++)room.environment.spawn('RADIATION',0,{x:2000,y:2000});
  assert.equal(room.powerups.orbs.size,24);assert.equal(room.environment.zones.size,3);
  const base={v:2,t:1,keyframe:1,roomId:'r',p:[],s:[],b:[],o:[],powerups:room.powerups.snapshot(0),environment:room.environment.snapshot(0)};
  const decoder=new Network.Decoder();decoder.receive(base);
  const same=Network.delta(base,{...base,t:2,keyframe:undefined});assert.deepEqual(same.powerups,[[],[]]);
  room.powerups.orbs.delete(room.powerups.orbs.keys().next().value);
  const next={...base,t:3,keyframe:undefined,powerups:room.powerups.snapshot(1000)};
  assert.deepEqual(decoder.receive(Network.delta(base,next)).powerups,next.powerups);
  room.powerups.update(45000);room.environment.destroy();room.powerups.destroy();room.events.destroy();
  assert.equal(room.powerups.orbs.size,0);assert.equal(room.environment.zones.size,0);
});
test('client world pools remain bounded across repeated events and release scene listeners/particles on shutdown',()=>{
  const fs=require('node:fs'),vm=require('node:vm');let objects=0,destroyed=0;const bindings=new Set(),handlers=new Map();
  const object=()=>{
    objects++;const node={x:0,y:0,visible:false,setPosition(x,y) {this.x=x;this.y=y;return this;},setVisible(v) {this.visible=v;return this;},destroy() {destroyed++;}};
    const proxy=new Proxy(node,{get:(target,key)=>key in target?target[key]:()=>proxy});return proxy;
  };
  class Node {append() {} remove() {} }
  const window={FleetI18n:{m:k=>k,render:n=>bindings.add(n),unbind:n=>bindings.delete(n)}};
  vm.runInNewContext(fs.readFileSync('client/js/powerup-ui.js','utf8'),{window,document:{createElement:()=>new Node(),body:{append() {}}}});
  const C={playerStates:new Map([['p',{powerShieldRemaining:1000}]]),myId:'p',socket:{on:(e,h)=>handlers.set(e,h),off:e=>handlers.delete(e)}};
  const scene={add:{image:object,graphics:object,particles:object},events:{once() {}},_effectVisible:()=>true};
  const ui=new window.FleetPowerupUI(scene,C);
  for(let batch=0;batch<50;batch++) {
    ui.snapshot({powerups:Array.from({length:24},(_,i)=>['orb'+batch+'_'+i,100,100,'SHIELD']),environment:Array.from({length:3},(_,i)=>['z'+batch+'_'+i,200,200,450,'BLACK_HOLE'])});
    ui.update(1000+batch*300);
    assert.equal(ui.orbs.size,24);assert.equal(ui.zones.size,3);
    assert.ok(objects<=55);
  }
  ui.destroy();assert.equal(handlers.size,0);assert.equal(bindings.size,0);assert.equal(objects,destroyed);
});
