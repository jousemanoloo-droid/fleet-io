'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Accounts}=require('../server/accounts');
const {register}=require('../server/socketSafety');
const {GameRoom}=require('../server/gameRoom');
const {Player}=require('../server/entities');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

const socket=id=>({id,emit(){}});
test('wallet rejects forged tokens, balances and purchases; reconnect preserves ownership',()=>{
  let now=Date.UTC(2026,9,12);const a=new Accounts({secret:'test'.repeat(8),now:()=>now});
  const s=socket('one'),initial=a.open(s,'forged.123');
  assert.equal(initial.state.coins,0);
  assert.equal(a.action(s.id,{action:'buy',type:'skins',id:'gold',coins:999999}).ok,false);
  assert.equal(a.action(s.id,{action:'buy',type:Object.create(null),id:'gold'}).ok,false);
  assert.equal(a.action(s.id,{action:'title',id:'Space Pirate'}).ok,false);
  a.action(s.id,{action:'streak',utc:now+86400000*100});
  assert.equal(a.snapshot(a.sessions.get(s.id)).state.coins,100);
  assert.equal(a.action(s.id,{action:'streak'}).ok,false);
  now+=86400000;
  assert.equal(a.action(s.id,{action:'streak'}).ok,true);
  assert.equal(a.sessions.get(s.id).record.state.coins,250);
  a.close(s.id);const next=a.open(socket('two'),initial.token);
  assert.equal(next.state.coins,250);assert.equal(next.state.retention.streak,2);
  assert.equal(a.open(socket('attacker'),initial.token.slice(0,-1)+'z').state.coins,0);
  a.destroy();
});
test('wallet counts actual survival, kills and receipts once, even after death and repeated acknowledgements',()=>{
  const a=new Accounts({secret:'test'.repeat(8)}),s=socket('p');a.open(s);
  const p=new Player('p','Pilot');p.matchStartedAt=Date.now()-10000;p.sessionKills=2;
  p.coinRewards=[{id:'room:1',coins:100}];
  a.observe(s.id,p,true);assert.equal(a.sessions.get(s.id).record.state.coins,210);
  p.die();a.observe(s.id,p,true);a.observe(s.id,p,true);
  assert.equal(a.sessions.get(s.id).record.state.coins,210,'deathId increment cannot duplicate the same life');
  p.deathState={...p.deathState,survivedMs:10000};p.matchStartedAt-=86400000;
  // A frozen death duration takes precedence over the still-advancing clock.
  a.sessions.get(s.id).baseline.life=p.matchStartedAt;
  a.observe(s.id,p,true);assert.equal(a.sessions.get(s.id).record.state.coins,210);
  a.endLife(s.id);assert.equal(a.sessions.get(s.id).baseline,null);a.destroy();
});
test('ad tickets are one-use, expire, enforce cooldown and bind revives to a particular room and life',()=>{
  let now=100000;const a=new Accounts({secret:'test'.repeat(8),now:()=>now}),s=socket('p');a.open(s);
  const ad=a.action(s.id,{action:'startAd'});
  assert.ok(ad.ticket);assert.equal(ad.state.coins,0);
  assert.equal(a.action(s.id,{action:'finishAd',id:'old-ticket'}).ok,false);
  assert.equal(a.sessions.get(s.id).ticket.id,ad.ticket,'a late callback cannot cancel a newer ad');
  assert.equal(a.action(s.id,{action:'finishAd',id:ad.ticket}).state.coins,500);
  assert.equal(a.action(s.id,{action:'finishAd',id:ad.ticket}).ok,false);
  assert.equal(a.action(s.id,{action:'startAd'}).ok,false);
  now+=30000;
  const ctx={room:{roomId:'room'},player:{alive:false,deathId:2,deathState:{}}};
  const revive=a.action(s.id,{action:'startAd',purpose:'revive',roomId:'room',deathId:2},ctx);
  a.action(s.id,{action:'finishAd',id:revive.ticket},ctx);
  assert.equal(a.sessions.get(s.id).record.state.coins,500,'revive never grants garage credits');
  assert.equal(a.consumeRevive(s.id,'room',2),true);assert.equal(a.consumeRevive(s.id,'room',2),false);
  now+=30000;const expired=a.action(s.id,{action:'startAd'});now+=150001;
  assert.equal(a.action(s.id,{action:'finishAd',id:expired.ticket}).ok,false);
  assert.equal(a.sessions.get(s.id).record.state.coins,500);a.destroy();
});
test('authoritative wallet file roundtrips and corrupted files fail closed',()=>{
  const dir=fs.mkdtempSync(path.join(__dirname,'../artifacts/fleet-audit-')),file=path.join(dir,'economy.json');
  try {
    const a=new Accounts({secret:'test'.repeat(8),file}),s=socket('p'),opened=a.open(s);a.action(s.id,{action:'streak'});a.destroy();
    const b=new Accounts({secret:'test'.repeat(8),file});assert.equal(b.open(socket('q'),opened.token).state.coins,100);b.destroy();
    fs.writeFileSync(file,'corrupt');assert.throws(()=>new Accounts({secret:'test'.repeat(8),file}));
  } finally {
    const target=path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(__dirname,'../artifacts')+path.sep+'fleet-audit-'));
    fs.rmSync(target,{recursive:true,force:true});
  }
});
test('socket boundary rejects primitive/array floods and isolates synchronous and async exceptions',async()=>{
  let now=0,calls=0,failures=0;const handlers={};
  const on=register({on:(n,f)=>handlers[n]=f},console,()=>now);
  on('action',d=>{calls++;if(d.throw)throw Error('bad');if(d.reject)return Promise.reject(Error('bad'));});
  const ack=r=>{if(!r.ok)failures++;};
  handlers.action([],ack);handlers.action('payload',ack);handlers.action({throw:true},ack);handlers.action({reject:true},ack);
  await new Promise(r=>setImmediate(r));assert.equal(failures,4);
  for(let i=0;i<1000;i++)handlers.action({},ack);assert.ok(calls<=180);
  now=1000;handlers.action({},ack);assert.ok(calls<=181);
});
test('disconnect immediately releases projectile sources, boss contributors and snapshot baselines',()=>{
  const io={to:()=>({emit(){},volatile:{emit(){}}})};
  const r=new GameRoom({roomId:'audit',type:'public',maxPlayers:2,io});
  const p=r.addHuman('p','Pilot');r.loop.stop();r.events.spawnBoss();
  r.events.boss.damageMap.set(p.id,10);r.loop.clientFrames.set(p.id,{old:true});
  r.projectiles.set('reflected',{ownerId:'other',sourceId:p.id});
  r.removeHuman(p.id);assert.equal(r.projectiles.size,0);assert.equal(r.events.boss.damageMap.size,0);assert.equal(r.loop.clientFrames.size,0);
  r.destroy();assert.equal(r.players.size,0);assert.equal(r.loop.keyframe,null);
});

test('fifty socket lifecycle cycles leave no scene or manager subscriptions',()=>{
  const vm=require('node:vm'),Network=require('../client/js/network');
  const I=require('../client/js/i18n')(require('../client/js/translations'));
  const listeners=new Map(),managerListeners=new Map();let disconnected=0;
  const emitter=map=>({on:(event,fn)=>{const list=map.get(event)||new Set();list.add(fn);map.set(event,list);},off:(event,fn)=>{map.get(event)?.delete(fn);if(!map.get(event)?.size)map.delete(event);}});
  const socket={...emitter(listeners),io:emitter(managerListeners),disconnect:()=>disconnected++};
  const window={FleetNetwork:{...Network,connect:()=>socket},FleetI18n:I};
  const context={window,Phaser:{Scene:class {}},document:{readyState:'loading',addEventListener(){}},performance};
  const src=fs.readFileSync(path.join(__dirname,'../client/js/game-scene.js'),'utf8').replace('  async function bootPhaser()', '  window.TestGameScene=GameScene;\n  async function bootPhaser()');
  vm.runInNewContext(src,context);
  for(let i=0;i<50;i++) {
    const scene=new window.TestGameScene();scene._setupSocket();assert.ok(listeners.size>10);
    scene._disposeSocket();scene._disposeSocket();assert.equal(listeners.size,0);assert.equal(managerListeners.size,0);
  }
  assert.equal(disconnected,50);
});

test('pooled broad phase preserves every swept collision for short and extreme-speed shots',()=>{
  const {CombatGrid}=require('../server/combatGrid'),{segmentHit}=require('../server/combat');
  const grid=new CombatGrid();let seed=87;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const players=Array.from({length:40},(_,i)=>({id:'p'+i,x:rand()*4000,y:rand()*4000,alive:true,radius:15+rand()*35,drones:[]}));
  for(let pass=0;pass<20;pass++) {
    grid.rebuild(players);
    for(let shot=0;shot<100;shot++) {
      const x=rand()*4000,y=rand()*4000,endX=x+(rand()-.5)*12000,endY=y+(rand()-.5)*12000;
      const candidates=new Set();grid.visit(x,y,endX,endY,t=>candidates.add(t.id));
      for(const p of players)if(segmentHit(x,y,endX,endY,p,p.radius+3)!==null)assert.ok(candidates.has(p.id));
    }
    grid.clear();assert.equal(grid.cells.size,0);assert.ok(grid.free.length<=40);
  }
});

test('gem deltas tolerate dropped packets and reconstruct the existing world renderer contract',()=>{
  const N=require('../client/js/network');
  const base={v:2,t:1,keyframe:1,roomId:'r',p:[],s:[],b:[],o:[],w:{boss:null},gems:[['a',100,100,20,0],['b',200,200,20,5]]};
  const d=new N.Decoder();assert.equal(d.receive(base).w.g.length,2);
  const current={...base,t:3,keyframe:undefined,gems:[['a',110,110,20,0],['c',300,300,40,0]]};
  const packet=N.delta(base,current),decoded=d.receive(packet);
  assert.deepEqual(decoded.w.g,current.gems);assert.deepEqual(base.gems,[['a',100,100,20,0],['b',200,200,20,5]]);
});

test('owning every mutation cannot freeze a player at levels 50 or 60',()=>{
  const r=new GameRoom({roomId:'mutations',type:'public',maxPlayers:1,io:{to:()=>({emit(){}})}});
  const p=new Player('p','Pilot');r.players.set(p.id,p);
  p.mutations=['plasma_thrusters','quantum_magnet','nano_armor','heavy_swarm'];
  for(const level of [50,60]) {p.level=level;p.levelUpPending=p.invulnerable=true;p.upgradeOptions=[];r.loop._flushProgression();assert.equal(p.levelUpPending,false);assert.equal(p.invulnerable,false);}
  r.destroy();
});

test('nested deltas reconstruct primitive changes without mutating the reliable baseline',()=>{
  const N=require('../client/js/network'),p=new Player('p','Pilot');p.addDrone('escort');
  const base={v:2,t:1,keyframe:1,roomId:'r',p:[N.packPlayer(p)],s:[],b:[],o:[]};
  const original=JSON.stringify(base);p.drones[0].x+=5;p.attributes.damage=2;
  const next={...base,t:3,keyframe:undefined,p:[N.packPlayer(p)]},packet=N.delta(base,next),d=new N.Decoder();
  d.receive(base);const result=d.receive(packet);
  assert.equal(result.p[0].attributes.damage,2);assert.equal(result.p[0].drones[0].x,Math.round(p.drones[0].x));assert.equal(JSON.stringify(base),original);
  const bad=JSON.parse(JSON.stringify(packet));bad.p[0][0][3]=[[['__proto__','polluted'],true]];
  assert.equal(d.receive(bad),null);assert.equal({}.polluted,undefined);
});
