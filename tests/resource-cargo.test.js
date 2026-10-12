'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Types=require('../server/resourceTypes'),Limits=require('../server/shipCargoLimits'),Rules=require('../client/js/extraction-rules');
const {Accounts}=require('../server/accounts'),{GameRoom}=require('../server/gameRoom'),{Player}=require('../server/entities');
const {EnvironmentEvents}=require('../server/environmentEvents');

function profile(t){
  const dir=fs.mkdtempSync(path.resolve('artifacts/resource-test-')),file=path.join(dir,'accounts.json');
  const accounts=new Accounts({secret:'r'.repeat(32),file}),socket={id:'p',emit(){}},opened=accounts.open(socket);
  t.after(()=>{accounts.destroy();const target=path.resolve(dir);assert.ok(target.startsWith(path.resolve('artifacts')+path.sep+'resource-test-'));fs.rmSync(target,{recursive:true,force:true});});
  return {accounts,file,opened,s:accounts.sessions.get('p')};
}
test('resource definitions and all cargo volumes use a single strict catalogue',()=>{
  assert.deepEqual(Object.keys(Types.RESOURCES),['titanium_scrap','quantum_crystal','alien_tech_core','dark_matter_shard']);
  assert.deepEqual(Object.values(Types.RESOURCES).map(r=>r.weight),[1,3,8,15]);
  assert.deepEqual(Limits.CAPACITIES,{starter:60,hunter:30,battleship:120,carrier:75,stealth:40});
  assert.equal(Rules.RESOURCES,Types.RESOURCES);
  assert.equal(Rules.weight({titanium_scrap:3,quantum_crystal:2,alien_tech_core:1,dark_matter_shard:1}),32);
  assert.equal(Types.isResource('__proto__'),false);assert.equal(Types.isResource(Object.create(null)),false);
});
test('saved phase-one materials migrate once without importing old IDs into live pickups',t=>{
  const {accounts,s,file,opened}=profile(t);
  s.record.state.secureStash={capacity:200,items:{titanium:14,plasma_core:2,alien_relig:1},revision:3};accounts.flush();
  const restored=new Accounts({secret:'r'.repeat(32),file});
  const stash=restored.open({id:'q',emit(){}},opened.token).state.secureStash;
  assert.deepEqual(stash.items,{titanium_scrap:14,quantum_crystal:2,alien_tech_core:1});assert.equal(stash.revision,3);assert.equal(stash.schemaVersion,2);
  assert.deepEqual(Rules.migrateStash(stash),stash);assert.equal(Rules.validateItems({titanium:1},200),null);restored.destroy();
});
test('sale consumes owned stash materials and credits only the server price; repeated full sale fails',t=>{
  const {accounts,s,file,opened}=profile(t);
  s.record.state.secureStash.items={quantum_crystal:2};
  const result=accounts.action('p',{action:'sellResource',resource:'quantum_crystal',quantity:2,price:999999});
  assert.equal(result.ok,true);assert.equal(result.credits,150);assert.equal(s.record.state.coins,150);assert.deepEqual(s.record.state.secureStash.items,{});
  assert.equal(accounts.action('p',{action:'sellResource',resource:'quantum_crystal',quantity:2}).ok,false);assert.equal(s.record.state.coins,150);
  for(const quantity of [0,-1,1.1,Infinity,1000000])assert.equal(accounts.action('p',{action:'sellResource',resource:'dark_matter_shard',quantity}).ok,false);
  assert.equal(accounts.action('p',{action:'sellResource',resource:'__proto__',quantity:1}).ok,false);
  const restored=new Accounts({secret:'r'.repeat(32),file});assert.equal(restored.open({id:'q',emit(){}},opened.token).state.coins,150);restored.destroy();
});
test('sale write failure rolls back both currency and material quantities',t=>{
  const {accounts,s}=profile(t);s.record.state.secureStash.items={alien_tech_core:1};
  const flush=accounts.flush;accounts.flush=()=>{accounts.storageError='disk failure';};
  assert.equal(accounts.action('p',{action:'sellResource',resource:'alien_tech_core',quantity:1}).ok,false);
  assert.equal(s.record.state.coins,0);assert.equal(s.record.state.secureStash.items.alien_tech_core,1);accounts.flush=flush;
});
test('normal/special asteroids, ships, bosses and black holes have distinct authoritative loot sources',()=>{
  const drops=[],inventory={drop:(x,y,id,quantity)=>{drops.push({id,quantity});return 'drop'+drops.length;}};
  const rock={x:100,y:100,maxHp:100};
  Types.asteroidLoot(inventory,rock,()=>0);assert.ok(drops.every(d=>d.id==='titanium_scrap'));
  drops.length=0;Types.asteroidLoot(inventory,{...rock,gold:true,maxHp:300},()=>0.44);assert.ok(drops.some(d=>d.id==='quantum_crystal'));
  drops.length=0;Types.asteroidLoot(inventory,{...rock,gold:true},()=>0.46);assert.ok(!drops.some(d=>d.id==='quantum_crystal'));
  drops.length=0;Types.shipLoot(inventory,{x:100,y:100,id:'victim',level:45,maxHp:500,deathState:{drones:12}},{id:'killer'});
  assert.equal(drops.reduce((a,d)=>a+d.quantity,0),12);assert.ok(drops.every(d=>d.id==='titanium_scrap'));
  drops.length=0;Types.globalBossLoot(inventory,{x:100,y:100,maxHp:12000});assert.equal(drops.filter(d=>d.id==='alien_tech_core').reduce((a,d)=>a+d.quantity,0),2);
  assert.ok(!drops.some(d=>d.id==='dark_matter_shard'));
  drops.length=0;Types.blackHoleLoot(inventory,{x:100,y:100,type:'BLACK_HOLE'},()=>0.02);assert.deepEqual(drops,[{id:'dark_matter_shard',quantity:1}]);
  drops.length=0;Types.blackHoleLoot(inventory,{x:100,y:100,type:'BLACK_HOLE'},()=>0.03);assert.equal(drops.length,0);
  Types.blackHoleLoot(inventory,{x:100,y:100,type:'RADIATION'},()=>0);assert.equal(drops.length,0);
});
test('black-hole expiry rolls once and destruction of the room never awards legendary loot',()=>{
  let rolls=0;const room={world:{width:4000,height:4000},players:new Map(),extraction:{drop(){rolls++;}}};
  const e=new EnvironmentEvents(room,0);e.nextSpawn=Infinity;e.spawn('BLACK_HOLE',0,{x:1000,y:1000});
  const random=Math.random;Math.random=()=>0;
  try{e.update(30000);e.update(30001);assert.equal(rolls,1);e.spawn('BLACK_HOLE',40000);e.destroy();assert.equal(rolls,1);}finally{Math.random=random;}
});
test('hunter reaches exactly 30 volume and excess loot remains available to another player',t=>{
  const {accounts}=profile(t),io={to:()=>({emit(){}})},room=new GameRoom({roomId:'cargo',type:'public',maxPlayers:2,io});
  t.after(()=>room.destroy());const p=new Player('p','Pilot');room.placePlayer(p);room.players.set(p.id,p);room.extraction.attach(p,accounts.extractionBinding(p.id));p.shipClass='hunter';
  assert.equal(room.extraction.collect(p,'dark_matter_shard',2),true);assert.equal(Rules.weight(p.inRunInventory),30);
  const id=room.extraction.drop(p.x,p.y,'titanium_scrap',1);room.extraction.update();room.extraction.update();assert.ok(room.extraction.resources.has(id));
  accounts.open({id:'q',emit(){}});const q=new Player('q','Other');q.x=p.x;q.y=p.y;room.players.set(q.id,q);room.extraction.attach(q,accounts.extractionBinding(q.id));
  room.extraction.update();room.extraction.update();assert.equal(room.extraction.resources.has(id),false);assert.equal(q.inRunInventory.titanium_scrap,1);
});
test('cargo HUD thresholds, invalid values and cleanup are independent of the render loop',()=>{
  const bindings=new Set();
  class Node{constructor(){this.style={};this.children=[];this.attributes={};}append(...n){this.children.push(...n);}setAttribute(k,v){this.attributes[k]=v;}remove(){this.removed=true;}}
  const window={FleetI18n:{m:k=>k,render:n=>bindings.add(n),unbind:n=>bindings.delete(n)}};
  vm.runInNewContext(fs.readFileSync('client/js/cargo-hud.js','utf8'),{window,document:{createElement:()=>new Node(),body:{append(){}}}});
  const HUD=window.FleetCargoHUD,hud=new HUD();
  for(const [used,status]of [[69,'normal'],[70,'warning'],[89,'warning'],[90,'danger'],[99,'danger'],[100,'full']]){assert.equal(HUD.status(used,100),status);assert.equal(hud.update(used,100),true);assert.ok(hud.element.className.endsWith(status));}
  assert.equal(hud.fill.style.width,'100%');assert.equal(hud.meter.attributes['aria-valuenow'],'100');
  for(const [u,c]of [[-1,100],[101,100],[Infinity,100],[1,0],[0.5,100]])assert.equal(hud.update(u,c),false);
  hud.destroy();assert.equal(bindings.size,0);assert.equal(hud.element.removed,true);
});
