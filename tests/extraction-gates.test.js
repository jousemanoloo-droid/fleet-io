'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {GameRoom}=require('../server/gameRoom'),{Player}=require('../server/entities'),{Accounts}=require('../server/accounts');
const {ExtractionGates,GATE_LIFETIME}=require('../server/extractionGates');

function fixture(t,{durable=true,type='public'}={}) {
  let time=0;const events=[],io={to:id=>({emit:(event,data)=>events.push({id,event,data}),volatile:{emit(){}}})};
  const dir=durable?fs.mkdtempSync(path.resolve('artifacts/extraction-gates-test-')):null;
  const accounts=new Accounts({secret:'g'.repeat(32),file:dir?path.join(dir,'wallet.json'):null});
  const account=accounts.open({id:'p',emit(){}}),room=new GameRoom({roomId:'gate-room',type,maxPlayers:4,botCount:0,io});
  room.loop.stop();room.players.clear();room.obstacles.clear();
  const p=new Player('p','Pilot');p.x=p.targetX=1000;p.y=p.targetY=1000;room.players.set(p.id,p);
  room.extraction.attach(p,accounts.extractionBinding(p.id));room.extraction.collect(p,'titanium_scrap',10);
  room.extractionGates.now=room.playerExtraction.now=()=>time;
  room.extractionGates.gates.set('exit_test',{id:'exit_test',x:1000,y:1000,radius:120,expires:45000});
  room.playerExtraction.attach(p,packet=>{events.push({id:p.id,event:'extraction:success',data:packet});room.removeHuman(p.id);if(type==='singleplayer')room.destroy();});
  function step(n=1){for(let i=0;i<n;i++){time+=1000/30;room.extractionGates.update();room.playerExtraction.update();}}
  t.after(()=>{
    room.destroy();accounts.destroy();
    if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve('artifacts')+path.sep+'extraction-gates-test-'));fs.rmSync(dir,{recursive:true,force:true});}
  });
  return {room,p,accounts,account,events,step,get time(){return time;},set time(n){time=n;}};
}

test('gates spawn on a 2–4 minute schedule, cap at two, collapse after 45s and stay in their room',()=>{
  let time=0;const events=[],room={roomId:'r',world:{width:4000,height:4000},obstacles:new Map(),io:{to:id=>({emit:(event,data)=>events.push({id,event,data})})}};
  const gates=new ExtractionGates(room,{now:()=>time,random:()=>.25});assert.equal(gates.nextSpawn,150000);
  gates.update();assert.equal(gates.gates.size,0);time=150000;gates.update();assert.equal(gates.gates.size,1);
  gates.spawn(99);assert.ok(gates.gates.size<=2);for(const g of gates.gates.values()){assert.ok(g.x>=180 && g.x<=3820);assert.equal(g.radius,120);}
  assert.equal(events.find(e=>e.event==='extraction:opened').id,'r');
  time+=GATE_LIFETIME;gates.update();assert.equal(gates.gates.size,0);assert.deepEqual(events.at(-1).data.gates,[]);
  gates.destroy();assert.equal(gates.room,null);
});

test('four continuous simulated seconds commit once, empty cargo and evacuate without a death',t=>{
  const f=fixture(t);f.step();f.step(119);assert.equal(f.events.some(e=>e.event==='extraction:success'),false);
  f.step();const win=f.events.filter(e=>e.event==='extraction:success');assert.equal(win.length,1);
  assert.deepEqual(win[0].data.extracted,{titanium_scrap:10});assert.deepEqual(f.p.inRunInventory,{});
  assert.equal(f.room.players.size,0);assert.equal(f.room.playerExtraction.members.size,0);assert.equal(f.room.extraction.bindings.size,0);
  assert.equal(f.p.deathId,0);assert.equal(f.events.some(e=>e.event==='player:wipe-inventory'),false);
  const reloaded=new Accounts({secret:'g'.repeat(32),file:f.accounts.file});
  assert.equal(reloaded.open({id:'other',emit(){}},f.account.token).state.secureStash.items.titanium_scrap,10);reloaded.destroy();
  f.step(20);assert.equal(f.events.filter(e=>e.event==='extraction:success').length,1);
});

test('an accepted enemy hit on the final tick cancels; protection that blocks damage does not',t=>{
  const f=fixture(t);f.step(120);f.p.spawnProtectionUntil=Date.now()+5000;
  assert.equal(f.p.takeDamage(1,new Player('enemy','Enemy')),false);assert.equal(f.room.playerExtraction.channels.size,1);
  f.p.spawnProtectionUntil=0;assert.equal(f.p.takeDamage(1,new Player('enemy','Enemy')),true);f.step();
  assert.equal(f.room.playerExtraction.channels.size,0);assert.equal(f.events.at(-1).data.reason,'damage');
  assert.equal(f.p.inRunInventory.titanium_scrap,10);assert.equal(f.events.some(e=>e.event==='extraction:success'),false);
});

for(const reason of ['exit','collapse','teleport','evolution','stall','death'])test(reason+' invalidates the channel without depositing loot',t=>{
  const f=fixture(t);f.step(100);
  if(reason==='exit')f.p.x=1121;
  if(reason==='collapse')f.room.extractionGates.gates.clear();
  if(reason==='teleport')f.p.motionRevision++;
  if(reason==='evolution')f.p.evolutionPending=10;
  if(reason==='stall')f.time+=5000;
  if(reason==='death')f.p.die();
  f.step();assert.equal(f.room.playerExtraction.channels.size,0);
  assert.equal(f.events.some(e=>e.event==='extraction:success'),false);
  assert.deepEqual(f.accounts.sessions.get('p').record.state.secureStash.items,{});
});

test('absent persistence or a full stash preserves cargo and never evacuates',t=>{
  const f=fixture(t,{durable:false});f.step(121);assert.equal(f.p.inRunInventory.titanium_scrap,10);
  assert.equal(f.room.players.has('p'),true);assert.equal(f.events.at(-1).data.reason,'extraction.persistence');
  f.accounts.sessions.get('p').record.state.secureStash.items={titanium_scrap:200};f.step(181);
  assert.equal(f.p.inRunInventory.titanium_scrap,10);assert.equal(f.events.at(-1).data.reason,'extraction.stashFull');
});

test('disconnection cleans channels and stale player references, and a reused ID cannot inherit progress',t=>{
  const f=fixture(t);f.step(80);f.room.removeHuman('p');
  assert.equal(f.room.playerExtraction.channels.size,0);assert.equal(f.room.playerExtraction.members.size,0);
  assert.equal(f.p.playerExtraction,null);assert.deepEqual(f.p.inRunInventory,{});
  const other=new Player('p','Reconnected');f.room.players.set('p',other);f.step();assert.equal(f.events.some(e=>e.event==='extraction:success'),false);
});

test('single-player evacuation can destroy the room inside the simulation without crashing',t=>{
  const f=fixture(t,{type:'singleplayer'});f.step(120);f.time+=1000/30;
  assert.doesNotThrow(()=>f.room.loop._tick());assert.equal(f.room.destroyed,true);assert.equal(f.events.some(e=>e.event==='extraction:success'),true);
  assert.doesNotThrow(()=>f.room.loop._tick());
});

test('channel progress is unicast at most 5Hz and every event has room/life/motion/revision identity',t=>{
  const f=fixture(t);f.step(90);const updates=f.events.filter(e=>e.event==='extraction:progress');assert.ok(updates.length<=16);
  for(const [i,e]of updates.entries()) {assert.equal(e.id,'p');assert.equal(e.data.roomId,'gate-room');assert.equal(e.data.deathId,0);assert.equal(e.data.motionRevision,0);if(i)assert.ok(e.data.revision>updates[i-1].data.revision);}
});

test('server exposes no extraction completion RPC and its callback removes real room membership',t=>{
  let connection;const handlers={},emitted=[];
  const express=()=>({use(){},disable(){},get(){}});express.static=()=>{};
  class IO{on(n,f){if(n==='connection')connection=f;}to(){return {emit(){},volatile:{emit(){}}};}emit(){}}
  const context={require:n=>n==='express'?express:n==='http'?{createServer:()=>({listen(){}})}:n==='socket.io'?{Server:IO}:n.startsWith('./')?require('../server/'+n.slice(2)):require(n),
    __dirname:path.resolve('server'),process:{env:{},on(){}},console};
  vm.runInNewContext(fs.readFileSync('server/server.js','utf8')+'\nglobalThis.rooms=roomManager;globalThis.wallets=accounts;',context);
  t.after(()=>{context.rooms.destroy();context.wallets.destroy();});
  const socket={id:'p',join(){},leave(){},emit:(n,d)=>emitted.push([n,d]),on:(n,f)=>handlers[n]=f};connection(socket);
  handlers.join({name:'Pilot'});const room=context.rooms.current('p'),p=room.players.get('p');room.loop.stop();
  for(const n of ['extraction:success','extraction:finish','completeExtraction','requestExtraction'])assert.equal(handlers[n],undefined);
  // Substitute only the durable binding, not eligibility, time or the completion RPC.
  let stash={capacity:200,items:{},revision:0},commits=0;
  room.extraction.attach(p,{read:()=>({secureStash:stash}),commit:items=>{commits++;stash.items={...items};return {ok:true};},notify(){}});
  room.extraction.collect(p,'titanium_scrap',10);let time=0;room.playerExtraction.now=room.extractionGates.now=()=>time;
  room.extractionGates.gates.set('exit',{id:'exit',x:p.x,y:p.y,radius:120,expires:45000});
  for(let i=0;i<121;i++){time+=1000/30;room.playerExtraction.update();}
  assert.equal(commits,1);assert.equal(context.rooms.current('p'),undefined);assert.ok(emitted.some(e=>e[0]==='extraction:success'));
});

test('extraction transitions to menu before overlay hooks, so CrazyGames never restarts gameplay during victory',()=>{
  let starts=0,stops=0;const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{classList:{add(){},remove(){}},style:{}});return nodes.get(id);},querySelector:()=>null};
  const window={FleetI18n:require('../client/js/i18n')(require('../client/js/translations')),AdManager:{gameplayStart:()=>starts++,gameplayStop:()=>stops++}};
  const source=fs.readFileSync('client/js/game-scene.js','utf8').replace('window.FleetGame = { boot: bootPhaser','window.FleetGame = { C, boot: bootPhaser');
  vm.runInNewContext(source,{window,document,Phaser:{Scene:class{}},performance:{now:()=>0}});
  const {C,GameScene}=window.FleetGame;C.joined=C.connected=true;C.menuOpen=false;C._drones=6;
  const scene=Object.create(GameScene.prototype);scene._projectileStates=new Map();scene._playerSprites=new Map();scene._decoder={reset(){}};
  scene._classUI={close:()=>window.FleetGame.trackGameplay()};scene._features={blocking:true,settle(){},close:()=>window.FleetGame.trackGameplay()};
  scene._finishExtraction();assert.equal(starts,0);assert.ok(stops>0);assert.equal(C.joined,false);assert.equal(C.menuOpen,true);assert.equal(C._drones,0);
});

test('client gate rendering uses a bounded pool, rejects stale/forged packets and destroys its listeners',()=>{
  const listeners=new Map(),bindings=new Set(),locales=new Set();let now=0,created=0,destroyed=0,finished=0;
  class Node{constructor(){this.children=[];this.classList={add(){},remove(){}};}append(...n){this.children.push(...n);}setAttribute(){}remove(){this.removed=true;}focus(){}}
  const document={createElement:()=>new Node(),body:new Node()};
  const socket={on:(n,f)=>listeners.set(n,f),off:(n,f)=>{assert.equal(listeners.get(n),f);listeners.delete(n);}};
  const window={FleetExtractionRules:require('../client/js/extraction-rules'),FleetI18n:{m:k=>k,t:k=>k,render:(n,m)=>{bindings.add(n);n.textContent=m;},unbind:n=>bindings.delete(n),subscribe:f=>{locales.add(f);return()=>locales.delete(f);}}};
  const obj=()=>{created++;const o={};for(const n of ['setDepth','clear','fillStyle','fillCircle','lineStyle','strokeCircle','arc','strokePath','setPosition','setVisible','setAlpha','emitParticleAt','killAll'])o[n]=()=>o;o.destroy=()=>destroyed++;return o;};
  const C={socket,world:{width:4000,height:4000},joined:true,dead:false,room:{roomId:'r'},myId:'p',playerStates:new Map([['p',{deathId:0,motionRevision:0}]]),renderState:new Map([['p',{x:500,y:500}]])};
  const scene={add:{graphics:obj,particles:obj},events:{once(){}},cameras:{main:{worldView:{contains:()=>false}}},_effectVisible:()=>true,_finishExtraction(){finished++;C.joined=false;}};
  vm.runInNewContext(fs.readFileSync('client/js/extraction-hud.js','utf8'),{window,document,performance:{now:()=>now}});
  const ui=new window.FleetExtractionHUD(scene,C);
  for(let i=0;i<100;i++){ui.receiveGates({roomId:'r',gates:[0,1].map(n=>({id:'g'+i+'_'+n,x:500,y:500,radius:120,remaining:45000}))});now+=100;ui.update(now);}
  assert.equal(created,3);assert.equal(ui.visuals.size,2);
  const packet={roomId:'r',playerId:'p',deathId:0,motionRevision:0,revision:1,duration:4000,elapsed:1000};ui.progress(packet);assert.equal(ui.channel.elapsed,1000);
  ui.progress({...packet,roomId:'old',revision:2,elapsed:3000});assert.equal(ui.channel.elapsed,1000);
  ui.cancel({...packet,revision:2,reason:'damage'});ui.progress(packet);assert.equal(ui.channel,null);
  ui.success({...packet,revision:3,extracted:{unknown:100}});assert.equal(finished,0);
  ui.success({...packet,revision:3,extracted:{titanium_scrap:10}});ui.success({...packet,revision:4,extracted:{titanium_scrap:10}});assert.equal(finished,1);
  ui.destroy();ui.destroy();assert.equal(listeners.size,0);assert.equal(bindings.size,0);assert.equal(locales.size,0);assert.equal(created,destroyed);
});
