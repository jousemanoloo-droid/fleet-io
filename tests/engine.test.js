'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Ballistics = require('../client/js/ballistics');
const Network = require('../client/js/network');
const { Player } = require('../server/entities');
const { GameRoom } = require('../server/gameRoom');
const { updateCombat } = require('../server/combat');

test('shots inherit inertia even above base bullet speed and spawn outside fused hulls', () => {
  const player = {x:1000,y:1000,vx:40,vy:-8,radius:44};
  const shot = Ballistics.launch(player,player,{x:1400,y:1000,vx:40,vy:-8});
  assert.equal(shot.vx,55); assert.equal(shot.vy,-8); assert.equal(shot.x,1059);
  assert.ok(Math.hypot(shot.x-player.x,shot.y-player.y)>player.radius);
  const orbit = Ballistics.launch(player,{x:1072,y:1000},{x:1400,y:1000,vx:40,vy:-8},0,8);
  assert.equal(orbit.x,1095);
});

test('authoritative shots carry unique sequence/life, scaled muzzle and packed velocities', () => {
  const room = new GameRoom({roomId:'physics',type:'private',io:{to:()=>({emit(){}})},maxPlayers:4});
  room.obstacles.clear();
  const a = new Player('a','A'), b = new Player('b','B');
  Object.assign(a,{x:1000,y:1000,vx:40,vy:0,radius:44,level:40});
  Object.assign(b,{x:1400,y:1000,vx:40,vy:0});
  room.players.set(a.id,a);room.players.set(b.id,b);
  updateCombat(room,1);
  const shots=[...room.projectiles.values()].filter(s=>s.ownerId==='a');
  assert.equal(shots.length,4); assert.ok(shots.every(s=>s.vx===55 && s.deathId===a.deathId));
  assert.equal(new Set(shots.map(s=>s.fireSeq)).size,4);
  const decoded = Network.player(Network.packPlayer(a));
  assert.equal(decoded.radius,44); assert.equal(decoded.fireSeq,4);
  room.destroy();
});

test('sector snapshots cull distant objects, retain ranking and rebase safely across a boundary', () => {
  const packets=[], io={to:id=>({emit:(event,data)=>packets.push({id,event,data}),volatile:{emit:(event,data)=>packets.push({id,event,data})}})};
  const room = new GameRoom({roomId:'interest',type:'private',io,maxPlayers:4});
  room.obstacles.clear();room.scraps.clear();
  const a=new Player('a','A'), b=new Player('b','B');
  Object.assign(a,{x:999,y:500}); Object.assign(b,{x:3500,y:3500,score:999});
  room.players.set('a',a);room.players.set('b',b);
  room.spawnScrap(1200,500);room.spawnScrap(3200,3200);
  room.loop.tickCount=1;room.loop._broadcastState();
  const decoder=new Network.Decoder();const first=packets.find(p=>p.id==='a').data;
  assert.deepEqual(first.p.map(p=>p[0]),['a']);assert.equal(first.s.length,1);
  assert.equal(first.leaderboard[0].id,'b');decoder.receive(first);
  a.x=1001;room.loop.tickCount=2;room.loop._broadcastState();
  const next=packets.filter(p=>p.id==='a').at(-1).data;
  assert.equal(next.keyframe,2);assert.equal(next.aoi,'1:0');assert.ok(decoder.receive(next));
  room.loop.tickCount=3;room.loop._broadcastState();
  const delta=packets.filter(p=>p.id==='a').at(-1).data;
  assert.equal(delta.v,3);assert.ok(decoder.receive(delta));
  room.players.delete('b');room.loop.tickCount=4;room.loop._broadcastState();
  assert.equal(room.loop.clientFrames.has('b'),false);room.destroy();assert.equal(room.loop.clientFrames.size,0);
});

test('malformed snapshots and unknown delta entities are discarded without poisoning next baseline', () => {
  const decoder=new Network.Decoder();
  assert.equal(decoder.receive(null),null);
  assert.equal(decoder.receive({v:2,t:1,p:[[1,NaN,0]],s:[],b:[],o:[]}),null);
  const valid={v:2,t:1,keyframe:1,roomId:'r',p:[],s:[],b:[],o:[]};
  assert.ok(decoder.receive(valid));
  assert.equal(decoder.receive({v:3,t:2,base:1,roomId:'r',p:[[['missing',null,[1,4]]],[]],s:[[],[]],b:[[],[]],o:[[],[]]}),null);
  assert.ok(decoder.receive({...valid,t:3,keyframe:3}));
});

function poolFixture() {
  let created=0;
  const scene={_laserSprites:new Map(),events:{once(){}},_obstacles:[],_effectVisible:()=>true,
    physics:{add:{group:()=>({create:()=>{
      created++;const sprite={body:{enable:true,stop(){}},x:0,y:0};
      for(const name of ['setDepth','setScale','setBlendMode','setActive','setVisible','setTint']) sprite[name]=()=>sprite;
      sprite.setPosition=(x,y)=>{sprite.x=x;sprite.y=y;return sprite;};return sprite;
    }})}}};
  const window={FleetBallistics:Ballistics},C={myId:'a',joined:true,dead:false,menuOpen:false,tick:0,playerStates:new Map(),renderState:new Map()};
  vm.runInNewContext(fs.readFileSync('client/js/projectiles.js','utf8'),{window,Phaser:{BlendModes:{ADD:1}}});
  const pool=new window.FleetProjectiles(scene,C);return {pool,C,scene,count:()=>created};
}

test('400 slots recycle thousands of shots, adopt predicted ids and correct only errors above 20px', () => {
  const {pool,count,scene}=poolFixture();assert.equal(count(),400);
  const predicted=pool.acquire('local:0:1');Object.assign(predicted,{x:100,y:100,seen:1,predicted:true,expires:400});
  const shot={id:'server1',ownerId:'a',sourceId:'a',deathId:0,fireSeq:1,x:105,y:100,vx:15,vy:0,c:1,rotation:0};
  pool.snapshot([shot],null,2);assert.equal(pool.active.get('server1'),predicted);assert.equal(predicted.x,100);
  pool.snapshot([{...shot,x:140}],null,3);assert.equal(predicted.x,100);assert.equal(predicted.correctionX,40);
  pool.update(4,1000/120);assert.ok(predicted.x>100&&predicted.x<140);
  pool.reset();
  for(let cycle=0;cycle<1000;cycle++){
    for(let i=0;i<400;i++) assert.ok(pool.acquire(`${cycle}:${i}`));
    assert.equal(pool.acquire('overflow'),null);pool.reset();
  }
  assert.equal(count(),400);assert.equal(scene._laserSprites.size,0);assert.equal(pool.free.length,400);
});

test('auto fire predicts immediately, advances by delta and unconfirmed shots expire', () => {
  const {pool,C,scene}=poolFixture();
  const me={id:'a',hp:100,deathId:0,chassis:1,radius:18,color:1,vx:30,vy:0,fireCooldown:400};
  C.playerStates.set('a',me);C.renderState.set('a',{x:100,y:100,vx:30,vy:0});
  scene._obstacles=[{x:400,y:100,vx:30,vy:0}];
  pool.update(1,1000/60);assert.equal(pool.active.size,1);
  const slot=[...pool.active.values()][0];assert.ok(slot.x>133);
  C.dead=true;pool.update(352,16);assert.equal(pool.active.size,0);
});

test('overlay vignette stays at viewport dimensions at zoom 0.4 and releases resize listeners', () => {
  const {EventEmitter}=require('node:events');const events=new EventEmitter(),scale=new EventEmitter();scale.width=1280;scale.height=720;
  const window={};vm.runInNewContext(fs.readFileSync('client/js/ui-scene.js','utf8'),{
    window,Phaser:{Scene:class{}},document:{createElement:()=>({getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){}})})}});
  const ui=new window.FleetUIScene();let shutdown;
  const image={setOrigin(){return this;},setScrollFactor(){return this;},setDepth(){return this;},setAlpha(){return this;},
    setPosition(x,y){this.x=x;this.y=y;return this;},setDisplaySize(w,h){this.w=w;this.h=h;return this;}};
  Object.assign(ui,{cameras:{main:{setScroll(){return this;},setZoom(){return this;}}},textures:{exists:()=>true},add:{image:()=>image},
    scale,game:{events},scene:{launch(){}},events:{once:(name,fn)=>{shutdown=fn;}}});
  ui.create();events.emit('camera_zoom_updated',.4);assert.equal(image.w,1280);assert.equal(image.h,720);assert.equal(image.x,640);
  scale.width=720;scale.height=1280;scale.emit('resize');assert.equal(image.x,360);assert.equal(image.y,640);
  shutdown();assert.equal(scale.listenerCount('resize'),0);assert.equal(events.listenerCount('camera_zoom_updated'),0);
});

test('combined ship trail variants share a 25-particle lifetime quota and offscreen ships emit nothing', () => {
  const window={FleetI18n:require('../client/js/i18n')(require('../client/js/translations'))};
  vm.runInNewContext(fs.readFileSync('client/js/game-scene.js','utf8'),{window,Phaser:{Scene:class{}}});
  const scene=Object.create(window.FleetGame.GameScene.prototype);scene._trailQuotas=new Map();scene._effectVisible=()=>true;
  let emitted=0;const emitter={emitParticleAt:()=>emitted++};
  for(let i=0;i<100;i++) scene._emitShipTrail(emitter,'pilot',100,100,2,1000);
  assert.equal(emitted,25);scene._emitShipTrail(emitter,'pilot',100,100,1,1399);assert.equal(emitted,25);
  scene._emitShipTrail(emitter,'pilot',100,100,1,1400);assert.equal(emitted,26);
  scene._effectVisible=()=>false;scene._emitShipTrail(emitter,'hidden',5000,5000,10,1500);
  assert.equal(scene._trailQuotas.has('hidden'),false);assert.equal(emitted,26);
});

test('GPU effects reduce below 50 FPS and recover only after the hysteresis interval', () => {
  const window={FleetI18n:require('../client/js/i18n')(require('../client/js/translations'))};
  vm.runInNewContext(fs.readFileSync('client/js/cyber.js','utf8'),{window,document:{hidden:false},
    Phaser:{Renderer:{WebGL:{Pipelines:{PostFXPipeline:class{}}}}}});
  const cyber=Object.create(window.FleetCyber.Cyber.prototype);let removed=0,added=0;
  const camera={postFX:{remove(){removed++;},addBloom(){added++;return {}; }},removePostPipeline(){removed++;},setPostPipeline(){},getPostPipeline(){return {};} };
  cyber.scene={game:{},cameras:{main:camera}};
  for(let i=0;i<80;i++) cyber.adaptQuality(i*25,25);
  assert.equal(cyber.reducedFX,true);assert.equal(removed,2);
  for(let i=0;i<121;i++) cyber.adaptQuality(4000+i*1000/60,1000/60);
  assert.equal(added,0);
  for(let i=0;i<121;i++) cyber.adaptQuality(25000+i*1000/60,1000/60);
  assert.equal(added,1);assert.equal(cyber.reducedFX,false);
});
