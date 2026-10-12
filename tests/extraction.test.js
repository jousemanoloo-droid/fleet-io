'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {GameRoom}=require('../server/gameRoom'),{Player}=require('../server/entities');
const {Accounts}=require('../server/accounts'),X=require('../server/extractionInventory'),N=require('../client/js/network');
const Classes=require('../server/shipClasses'),RPG=require('../server/rpg'),Progression=require('../client/js/progression');
function fixture(t,file) {
  const emitted=[],io={to:id=>({emit:(name,data)=>emitted.push({id,name,data}),volatile:{emit(){}}})};
  const room=new GameRoom({roomId:'extraction',type:'public',maxPlayers:4,io});
  const accounts=new Accounts({secret:'s'.repeat(32),file}),socket={id:'p',emit:(name,data)=>emitted.push({id:'p',name,data})};
  const account=accounts.open(socket),p=new Player('p','Pilot');room.placePlayer(p);room.players.set(p.id,p);
  room.extraction.attach(p,accounts.extractionBinding(p.id));
  t.after(()=>{
    room.destroy();accounts.destroy();
    if(file){const target=path.resolve(path.dirname(file));assert.ok(target.startsWith(path.resolve('artifacts')+path.sep+'extraction-test-'));fs.rmSync(target,{recursive:true,force:true});}
  });return {room,accounts,p,emitted,account};
}
function disk(t) {
  const dir=fs.mkdtempSync(path.resolve('artifacts/extraction-test-'));
  return path.join(dir,'accounts.json');
}
test('schema rejects negatives, floats, absurd counts, unknown resources and prototype keys',()=>{
  for(const items of [{titanium_scrap:-1},{titanium_scrap:1.5},{titanium_scrap:999999},{unknown:2},[],JSON.parse('{"__proto__":4}')])assert.equal(X.validateItems(items,200),null);
  assert.equal(X.validateStash({capacity:201,items:{},revision:0}),null);
  assert.equal(X.validateStash({capacity:200,items:{quantum_crystal:67},revision:0}),null);
  assert.deepEqual(X.validateStash({capacity:200,items:{titanium_scrap:14,quantum_crystal:2},revision:1}).items,{titanium_scrap:14,quantum_crystal:2});
});
test('collection is authoritative, enforces each ship capacity and leaves full stacks on the ground',t=>{
  const {room,p,emitted}=fixture(t);
  for(const [type,capacity]of Object.entries(X.CAPACITIES)){
    p.shipClass=type==='starter'?null:type;p.inRunInventory={};
    assert.equal(room.extraction.collect(p,'titanium_scrap',capacity),true);
    assert.equal(room.extraction.collect(p,'titanium_scrap',1),false);assert.equal(X.weight(p.inRunInventory),capacity);
  }
  const id=room.extraction.drop(p.x,p.y,'titanium_scrap',2);room.extraction.update();room.extraction.update();
  assert.ok(room.extraction.resources.has(id));assert.equal(emitted.at(-1).name,'inventory:update');
  assert.equal(room.extraction.collect(p,'titanium_scrap',-100),false);
  p.hp=0;assert.equal(room.extraction.collect(p,'titanium_scrap',1),false);
});
test('lethal damage wipes cargo once with exact loss; stash and rewarded respawn are independent',t=>{
  const {room,p,accounts,emitted}=fixture(t);accounts.sessions.get(p.id).record.state.secureStash.items={titanium_scrap:25};
  room.extraction.collect(p,'titanium_scrap',14);room.extraction.collect(p,'quantum_crystal',2);
  p.spawnProtectionUntil=0;p.takeDamage(10000);p.die();
  const wipes=emitted.filter(e=>e.name==='player:wipe-inventory');
  assert.equal(wipes.length,1);assert.deepEqual(wipes[0].data.lost,{titanium_scrap:14,quantum_crystal:2});
  assert.deepEqual(p.inRunInventory,{});assert.deepEqual(p.secureStash.items,{titanium_scrap:25});
  p.respawn(true,room.players,room.world,room.obstacles);assert.deepEqual(p.inRunInventory,{});assert.deepEqual(p.secureStash.items,{titanium_scrap:25});
});
test('abandonment clears cargo and all player bindings immediately',t=>{
  const {room,p,accounts,emitted}=fixture(t);room.extraction.collect(p,'titanium_scrap',20);
  accounts.sessions.get(p.id).record.state.secureStash.items={quantum_crystal:2};
  room.removeHuman(p.id);
  assert.deepEqual(p.inRunInventory,{});assert.equal(room.extraction.bindings.size,0);assert.equal(p.extractionInventory,null);
  assert.equal(emitted.find(e=>e.name==='player:wipe-inventory').data.reason,'abandon');
  assert.deepEqual(accounts.sessions.get(p.id).record.state.secureStash.items,{quantum_crystal:2});
});
test('successful extraction persists exactly once and survives reload',t=>{
  const file=disk(t),{room,p,accounts,account}=fixture(t,file);
  room.extraction.collect(p,'titanium_scrap',14);room.extraction.collect(p,'quantum_crystal',2);
  assert.equal(room.extraction.completeExtraction(p).ok,true);assert.deepEqual(p.inRunInventory,{});
  assert.equal(room.extraction.completeExtraction(p).ok,false);
  const reloaded=new Accounts({secret:'s'.repeat(32),file});
  assert.deepEqual(reloaded.open({id:'new',emit(){}},account.token).state.secureStash.items,{titanium_scrap:14,quantum_crystal:2});reloaded.destroy();
});
test('full stash, absent persistence and disk errors never delete or duplicate run cargo',t=>{
  const {room,p,accounts}=fixture(t);room.extraction.collect(p,'titanium_scrap',10);
  assert.equal(room.extraction.completeExtraction(p).error,'extraction.persistence');assert.equal(p.inRunInventory.titanium_scrap,10);
  const s=accounts.sessions.get(p.id).record.state;s.secureStash.items={titanium_scrap:200};
  assert.equal(room.extraction.completeExtraction(p).error,'extraction.stashFull');assert.equal(p.inRunInventory.titanium_scrap,10);
  s.secureStash.items={};accounts.file='unused';const flush=accounts.flush;accounts.flush=()=>{accounts.storageError='simulated I/O failure';};
  assert.equal(room.extraction.completeExtraction(p).ok,false);assert.equal(p.inRunInventory.titanium_scrap,10);
  assert.deepEqual(accounts.sessions.get(p.id).record.state.secureStash.items,{});
  accounts.file=null;accounts.flush=flush;
});
test('stash enlargement uses server prices, caps capacity and ignores forged contents',t=>{
  const {p,accounts}=fixture(t),s=accounts.sessions.get(p.id).record.state;s.coins=1000;
  assert.equal(accounts.action(p.id,{action:'upgradeStash',price:-1,capacity:999999,items:{titanium_scrap:999999}}).ok,true);
  assert.equal(s.coins,0);assert.equal(s.secureStash.capacity,300);assert.deepEqual(s.secureStash.items,{});
  assert.equal(accounts.action(p.id,{action:'upgradeStash'}).ok,false);
  assert.equal(accounts.action(p.id,{action:'extract',items:{titanium_scrap:999999}}).ok,false);
});
test('changing to a smaller hold is rejected; timeout selects an eligible class without freezing',t=>{
  const {p}=fixture(t);p.inRunInventory={titanium_scrap:50};RPG.addXP(p,Progression.thresholdXP(10));
  assert.equal(Classes.choose(p,'hunter',10),false);assert.equal(p.evolutionPending,10);
  Classes.tick(p,1/30,p.evolutionExpiresAt);assert.equal(p.shipClass,'battleship');assert.equal(p.evolutionPending,0);
});
test('resources have bounded lifetime/count and retain network deltas across loss of a packet',t=>{
  const {room,p}=fixture(t);p.x=p.y=3900;
  for(let i=0;i<200;i++)room.extraction.drop(100,100,'titanium_scrap',1);assert.equal(room.extraction.resources.size,128);
  assert.equal(room.extraction.drop(0,0,'alien_tech_core',160),null);
  const base={v:2,t:1,keyframe:1,roomId:'r',p:[],s:[],b:[],o:[],resources:room.extraction.snapshot()};
  room.extraction.resources.delete(room.extraction.resources.keys().next().value);
  const next={...base,t:3,keyframe:undefined,resources:room.extraction.snapshot()},decoder=new N.Decoder();decoder.receive(base);
  assert.deepEqual(decoder.receive(N.delta(base,next)).resources,next.resources);
  room.extraction.now=()=>Date.now()+60001;room.extraction.update();room.extraction.update();assert.equal(room.extraction.resources.size,0);
});

test('two extraction commits compete for final stash space without overflow or partial loss',t=>{
  const file=disk(t),{room,p,accounts}=fixture(t,file);
  const s=accounts.sessions.get(p.id).record.state;s.secureStash.items={titanium_scrap:190};
  room.extraction.collect(p,'titanium_scrap',10);assert.equal(room.extraction.completeExtraction(p).ok,true);
  room.extraction.collect(p,'titanium_scrap',1);assert.equal(room.extraction.completeExtraction(p).error,'extraction.stashFull');
  assert.equal(p.inRunInventory.titanium_scrap,1);assert.equal(p.secureStash.items.titanium_scrap,200);
});

test('corrupt stored stash is repaired without erasing the valid wallet',t=>{
  const file=disk(t),{accounts,p}=fixture(t,file);const record=accounts.sessions.get(p.id).record;
  record.state.coins=150;record.state.secureStash={capacity:200,items:{titanium_scrap:-500},revision:0};accounts.flush();
  const loaded=new Accounts({secret:'s'.repeat(32),file});
  assert.equal(loaded.records.get(record.id).state.coins,150);assert.deepEqual(loaded.records.get(record.id).state.secureStash,X.emptyStash());loaded.destroy();
});

test('stash UI ignores stale inventories, removes modal listeners and reuses bounded resource sprites',()=>{
  const listeners=new Map(),domListeners=new Map(),bindings=new Set(),locales=new Set();
  const on=(map,name,fn)=>{const set=map.get(name)||new Set();set.add(fn);map.set(name,set);};
  const off=(map,name,fn)=>{map.get(name)?.delete(fn);if(!map.get(name)?.size)map.delete(name);};
  let document,objects=0,destroyed=0;
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.isConnected=true;}
    append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
    after(...nodes){const i=this.parent.children.indexOf(this);for(const n of nodes)n.parent=this.parent;this.parent.children.splice(i+1,0,...nodes);}
    setAttribute(key,value){this[key]=value;}
    querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()]);}
    querySelector(tag){return this.querySelectorAll().find(n=>n.tag===tag);}
    replaceChildren(){for(const n of this.querySelectorAll())n.isConnected=false;this.children=[];}
    remove(){this.replaceChildren();this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
    focus(){document.activeElement=this;}
  }
  const body=new Node('body'),nodes={'singleplayer-btn':new Node('button'),'death-summary':new Node('p')};body.append(...Object.values(nodes));
  document={body,activeElement:nodes['singleplayer-btn'],createElement:tag=>new Node(tag),getElementById:id=>nodes[id],addEventListener:(n,f)=>on(domListeners,n,f),removeEventListener:(n,f)=>off(domListeners,n,f)};
  const socket={on:(n,f)=>on(listeners,n,f),off:(n,f)=>off(listeners,n,f)};
  const economy={state:{coins:0,secureStash:X.emptyStash()},accountReady:true,persistent:true,
    storage:{getItem:()=>'{malformed',removeItem(){this.removed=true;}},request:async()=>({ok:false})};
  const window={FleetExtractionRules:X,FleetI18n:{m:key=>key,t:key=>key,render:(node,m)=>{bindings.add(node);node.textContent=String(m);},unbind:node=>bindings.delete(node),subscribe:fn=>{locales.add(fn);return()=>locales.delete(fn);}},AdManager:{gameplayStop(){}}};
  vm.runInNewContext(fs.readFileSync('client/js/stash-ui.js','utf8'),{window,document});
  const C={socket,myId:'p',room:{roomId:'r'},joined:true,dead:false,playerStates:new Map([['p',{hp:100,deathId:0}]])};
  const image=()=>{objects++;const n={};for(const key of ['setDepth','setScale','setPosition','setTint','setVisible'])n[key]=()=>n;n.destroy=()=>destroyed++;return n;};
  const scene={_features:{economy},events:{once(){}},add:{image}};
  const ui=new window.FleetStashUI(scene,C,()=>{});assert.equal(economy.storage.removed,true);
  const data={roomId:'r',playerId:'p',deathId:0,motionRevision:1,revision:1,items:{titanium_scrap:14},used:14,capacity:60};
  ui.receive(data);assert.equal(ui.used,14);
  ui.receive({...data,roomId:'old',items:{titanium_scrap:40},used:40});assert.equal(ui.used,14);
  ui.receive({...data,revision:0,items:{},used:0});assert.equal(ui.used,14);
  const stableBindings=bindings.size;
  for(let i=0;i<40;i++){ui.open();assert.equal(listeners.get('accountState').size,1);ui.close();assert.equal(listeners.has('accountState'),false);assert.equal(domListeners.size,0);assert.equal(bindings.size,stableBindings);}
  for(let batch=0;batch<40;batch++)ui.snapshot({resources:Array.from({length:128},(_,i)=>['res'+batch+'_'+i,100,100,'titanium_scrap',1])});
  assert.equal(objects,128);assert.equal(ui.sprites.size,128);
  ui.receive({...data,deathId:1,revision:2,items:{},used:0,lost:{titanium_scrap:14}},true);assert.equal(ui.used,0);
  ui.destroy();assert.equal(listeners.size,0);assert.equal(domListeners.size,0);assert.equal(locales.size,0);assert.equal(bindings.size,0);assert.equal(objects,destroyed);
});
