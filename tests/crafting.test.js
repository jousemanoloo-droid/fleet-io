'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Accounts}=require('../server/accounts'),{Player}=require('../server/entities'),{GameRoom}=require('../server/gameRoom');
const Recipes=require('../server/craftingRecipes'),{applyPassives}=require('../server/blackMarket'),Classes=require('../server/shipClasses');
const Resources=require('../server/resourceTypes'),X=require('../client/js/extraction-rules');
function fixture(t,{durable=true}={}) {
  const dir=durable?fs.mkdtempSync(path.resolve('artifacts/crafting-test-')):null,events=[];
  const accounts=new Accounts({secret:'c'.repeat(32),file:dir?path.join(dir,'wallet.json'):null});
  const account=accounts.open({id:'p',emit:(n,d)=>events.push({id:'p',n,d})});
  const session=accounts.sessions.get('p');session.record.state.coins=1234;
  session.record.state.secureStash={schemaVersion:2,capacity:300,revision:0,items:{titanium_scrap:75,quantum_crystal:20,alien_tech_core:7,dark_matter_shard:4}};
  t.after(()=>{accounts.destroy();if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve('artifacts')+path.sep+'crafting-test-'));fs.rmSync(dir,{recursive:true,force:true});}});
  return {accounts,session,account,events,craft:id=>accounts.blackMarket.request('p',{recipeId:id})};
}

test('all recipes are immutable, use canonical resources and have exact requested costs',()=>{
  assert.equal(Object.keys(Recipes.RECIPES).length,3);
  assert.deepEqual(Recipes.RECIPES.void_stalker.materials,{titanium_scrap:25,quantum_crystal:8,alien_tech_core:2});
  assert.deepEqual(Recipes.RECIPES.reinforced_shield.materials,{titanium_scrap:50,quantum_crystal:12});
  assert.deepEqual(Recipes.RECIPES.quantum_thruster.materials,{alien_tech_core:5,dark_matter_shard:4});
  for(const r of Object.values(Recipes.RECIPES)){assert.ok(Object.isFrozen(r.materials));for(const [id,n]of Object.entries(r.materials)){assert.ok(Resources.RESOURCES[id]);assert.ok(Number.isSafeInteger(n) && n>0);}}
});

test('malformed requests, fake prices/materials, prototype IDs and absent sessions cannot mutate a wallet',t=>{
  const {accounts,session}=fixture(t),before=JSON.stringify(session.record.state);
  for(const packet of [null,42,'void_stalker',[],{},Object.create({recipeId:'void_stalker'}), {recipeId:'__proto__'}, {recipeId:{}}, {recipeId:'unknown'},
    {recipeId:'void_stalker',materials:{}},{recipeId:'void_stalker',price:0},{recipeId:'void_stalker',crafted:['void_stalker']}]){
    assert.equal(accounts.blackMarket.request('p',packet).ok,false);assert.equal(JSON.stringify(session.record.state),before);
  }
  assert.equal(accounts.blackMarket.request('unknown',{recipeId:'void_stalker'}).ok,false);
});

test('fabrication consumes stash atomically, leaves coins/run inventory untouched, and persists all three unlocks',t=>{
  const {accounts,session,account,craft}=fixture(t),p=new Player('p','Pilot');p.alive=false;p.hp=0;p.inRunInventory={titanium_scrap:10};
  for(const id of Object.keys(Recipes.RECIPES))assert.equal(accounts.blackMarket.request('p',{recipeId:id},{player:p}).ok,true);
  assert.deepEqual(session.record.state.secureStash.items,{});assert.equal(session.record.state.secureStash.revision,3);
  assert.deepEqual(session.record.state.crafted,Object.keys(Recipes.RECIPES));assert.equal(session.record.state.coins,1234);
  assert.equal(p.inRunInventory.titanium_scrap,10);assert.ok(session.record.state.skins.includes('void_stalker'));
  const reload=new Accounts({secret:'c'.repeat(32),file:accounts.file});
  const restored=reload.open({id:'q',emit(){}},account.token);assert.deepEqual(restored.state.crafted,session.record.state.crafted);reload.destroy();
  assert.equal(craft('void_stalker').alreadyOwned,true);
});

test('insufficient stash or an active run is rejected even when the player carries enough material',t=>{
  const {accounts,session,craft}=fixture(t),p=new Player('p','Pilot');
  assert.equal(accounts.blackMarket.request('p',{recipeId:'void_stalker'},{player:p}).error,'craft.inRun');
  session.record.state.secureStash.items={titanium_scrap:25,quantum_crystal:7,alien_tech_core:2};
  p.inRunInventory={quantum_crystal:1};assert.equal(craft('void_stalker').error,'craft.materials');
  assert.deepEqual(session.record.state.crafted,[]);assert.equal(session.record.state.secureStash.items.quantum_crystal,7);
});

test('lost acknowledgements, duplicate requests and two tabs unlock once and charge once',t=>{
  const {accounts,session,account,events,craft}=fixture(t);accounts.open({id:'peer',emit:(n,d)=>events.push({id:'peer',n,d})},account.token);
  const first=craft('void_stalker');assert.equal(first.ok,true);
  for(let i=0;i<30;i++)assert.equal(accounts.blackMarket.request(i%2?'peer':'p',{recipeId:'void_stalker'}).alreadyOwned,true);
  assert.equal(session.record.state.secureStash.items.titanium_scrap,50);assert.equal(session.record.revision,1);
  assert.equal(events.filter(e=>e.n==='accountState').length,2);
});

test('competing recipes cannot overdraw shared stash materials across sessions',t=>{
  const {accounts,session,account}=fixture(t);accounts.open({id:'peer',emit(){}},account.token);
  session.record.state.secureStash.items={titanium_scrap:50,quantum_crystal:12,alien_tech_core:2};
  assert.equal(accounts.blackMarket.request('p',{recipeId:'void_stalker'}).ok,true);
  assert.equal(accounts.blackMarket.request('peer',{recipeId:'reinforced_shield'}).error,'craft.materials');
  assert.deepEqual(session.record.state.crafted,['void_stalker']);assert.equal(session.record.state.secureStash.items.titanium_scrap,25);
});

test('missing disk, failed writes and thrown persistence roll back both materials and ownership',t=>{
  const {accounts,session,craft}=fixture(t,{durable:false});assert.equal(craft('void_stalker').error,'extraction.persistence');
  const before=session.record.state,flush=accounts.flush;accounts.file='unused';
  accounts.flush=()=>{accounts.storageError='disk failure';};assert.equal(craft('void_stalker').ok,false);assert.equal(session.record.state,before);
  accounts.storageError=null;accounts.flush=()=>{throw Error('I/O');};assert.equal(craft('void_stalker').ok,false);assert.equal(session.record.state,before);
  accounts.file=null;accounts.flush=flush;
});

test('crafted skin cannot be bought or equipped before crafting; ownership survives reload',t=>{
  const {accounts,session,account,craft}=fixture(t);
  assert.equal(accounts.action('p',{action:'buy',type:'skins',id:'void_stalker'}).ok,false);craft('void_stalker');
  assert.equal(accounts.action('p',{action:'buy',type:'skins',id:'void_stalker'}).ok,true);
  const p=new Player('p','Pilot');accounts.loadout('p',p);assert.equal(p.skin,'void_stalker');assert.equal(session.record.state.coins,1234);
  accounts.flush();const reload=new Accounts({secret:'c'.repeat(32),file:accounts.file});
  assert.equal(reload.open({id:'q',emit(){}},account.token).state.equipped.skin,'void_stalker');reload.destroy();
});

test('corrupt stored unlock lists are sanitized without granting an uncrafted skin or breaking older accounts',t=>{
  const {accounts,session,account}=fixture(t);session.record.state.crafted=['__proto__','reinforced_shield','reinforced_shield',{},123];
  session.record.state.skins.push('void_stalker');accounts.flush();
  const reload=new Accounts({secret:'c'.repeat(32),file:accounts.file}),state=reload.open({id:'q',emit(){}},account.token).state;
  assert.deepEqual(state.crafted,['reinforced_shield']);assert.ok(!state.skins.includes('void_stalker'));assert.equal(state.coins,1234);reload.destroy();
});

test('reinforced base shield is idempotent and scales through class changes without multiplying tactical points',()=>{
  const p=new Player('p','Pilot');applyPassives(p,['reinforced_shield']);assert.equal(p.maxHp,115);assert.equal(p.hp,115);
  for(let i=0;i<40;i++)applyPassives(p,['reinforced_shield']);assert.equal(p.maxHp,115);
  p.attributePoints=2;require('../server/rpg').allocate(p,'shield',2);assert.equal(p.maxHp,215);
  Classes.apply(p,'hunter',1);applyPassives(p,['reinforced_shield']);assert.equal(p.maxHp,215*Classes.definition('hunter').hp);
  Classes.apply(p,'battleship',2);applyPassives(p,['reinforced_shield']);assert.ok(Math.abs(p.maxHp-215*Classes.definition('battleship').hp)<1e-8);
  p.hp=p.maxHp/2;applyPassives(p,['reinforced_shield']);assert.equal(p.hp,p.maxHp/2);
});

test('free/rewarded respawns retain permanent modules without shield stacking or tactical regressions',()=>{
  const p=new Player('p','Pilot');applyPassives(p,['reinforced_shield','quantum_thruster']);
  for(const rewarded of [true,true,false,false]){
    p.die();p.respawn(rewarded,new Map(),{width:4000,height:4000});applyPassives(p,p.permanentUpgrades);
    assert.equal(p.maxHp,115);assert.equal(p.hp,115);assert.equal(p.extractionDuration,3000);
  }
});

test('modules become effective only on the next spawn, and clients never install them with cosmetics',t=>{
  const {accounts,session,craft}=fixture(t),p=new Player('p','Pilot');accounts.preparePlayer('p',p);
  craft('reinforced_shield');craft('quantum_thruster');accounts.loadout('p',p);
  assert.equal(p.maxHp,100);assert.equal(p.extractionDuration,4000);
  p.die();p.respawn(false,new Map());accounts.preparePlayer('p',p);assert.equal(p.maxHp,115);assert.equal(p.extractionDuration,3000);
  assert.deepEqual(session.record.state.crafted,['reinforced_shield','quantum_thruster']);
});

test('quantum thruster finishes after three authoritative seconds and default ships still need four',t=>{
  const {accounts}=fixture(t),io={to:()=>({emit(){},volatile:{emit(){}}})},room=new GameRoom({roomId:'craft-exit',type:'public',maxPlayers:2,io});
  t.after(()=>room.destroy());const p=new Player('p','Pilot');room.players.set(p.id,p);room.extraction.attach(p,accounts.extractionBinding(p.id));
  accounts.sessions.get('p').record.state.secureStash.items={};accounts.sessions.get('p').record.state.crafted=['quantum_thruster'];accounts.preparePlayer('p',p);
  room.extraction.collect(p,'titanium_scrap',1);let now=0,wins=0;room.playerExtraction.now=room.extractionGates.now=()=>now;
  room.extractionGates.gates.set('exit',{id:'exit',x:p.x,y:p.y,radius:120,expires:45000});room.playerExtraction.attach(p,()=>{wins++;room.removeHuman('p');});
  for(let i=0;i<90;i++){now+=1000/30;room.playerExtraction.update();}assert.equal(wins,0);
  now+=1000/30;room.playerExtraction.update();assert.equal(wins,1);assert.equal(accounts.sessions.get('p').record.state.secureStash.items.titanium_scrap,1);
});

test('socket handler applies crafted modules at spawn and rejects forged cost packages through the safe boundary',t=>{
  let connect;const handlers={},express=()=>({use(){},disable(){},get(){}});express.static=()=>{};
  class IO{on(n,f){if(n==='connection')connect=f;}to(){return {emit(){},volatile:{emit(){}}};}emit(){}}
  const context={require:n=>n==='express'?express:n==='http'?{createServer:()=>({listen(){}})}:n==='socket.io'?{Server:IO}:n.startsWith('./')?require('../server/'+n.slice(2)):require(n),__dirname:path.resolve('server'),process:{env:{},on(){}},console};
  vm.runInNewContext(fs.readFileSync('server/server.js','utf8')+'\nglobalThis.rooms=roomManager;globalThis.wallets=accounts;',context);
  t.after(()=>{context.rooms.destroy();context.wallets.destroy();});
  connect({id:'p',join(){},leave(){},emit(){},on:(n,f)=>handlers[n]=f});handlers.accountOpen({},()=>{});
  context.wallets.sessions.get('p').record.state.crafted=['reinforced_shield','quantum_thruster'];
  handlers.join({name:'Pilot'});const room=context.rooms.current('p');room.loop.stop();const p=room.players.get('p');assert.equal(p.maxHp,115);assert.equal(p.extractionDuration,3000);
  let ack;handlers['craft:request']({recipeId:'void_stalker',materials:{}},r=>ack=r);assert.equal(ack.ok,false);
  handlers['craft:request']({recipeId:'void_stalker'},r=>ack=r);assert.equal(ack.error,'craft.inRun');
  p.die();handlers.requestRespawn({roomId:room.roomId,deathId:p.deathId},()=>{});assert.equal(p.maxHp,115);
});

test('client crafting waits for the authoritative account, never trusts local unlocks, and drops old-connection acknowledgements',async()=>{
  const callbacks=[],socket={id:'connection-1',connected:true,on(){},off(){},timeout(){return this;},emit:(event,data,ack)=>callbacks.push({event,data,ack})};
  const storage={getItem:()=>null,setItem(){}};
  const window={FleetCraftingRecipes:Recipes,FleetExtractionRules:X,performance:{now:()=>0}};
  vm.runInNewContext(fs.readFileSync('client/js/economy.js','utf8'),{window});
  const economy=new window.FleetEconomy.Economy(storage);
  assert.equal(await economy.craft('void_stalker'),null);economy.bindAccount(socket);economy.accountReady=true;
  const pending=economy.craft('void_stalker');assert.deepEqual(JSON.parse(JSON.stringify(callbacks[0].data)),{recipeId:'void_stalker'});assert.equal(callbacks[0].event,'craft:request');
  assert.equal(economy.state.crafted.length,0);
  const result={ok:true,revision:1,persistent:true,utc:100,token:'guest',state:{...economy.state,crafted:['void_stalker'],secureStash:X.emptyStash()}};
  callbacks[0].ack(null,result);assert.equal((await pending).ok,true);assert.deepEqual([...economy.state.crafted],['void_stalker']);
  const stale=economy.craft('quantum_thruster');socket.id='connection-2';callbacks[1].ack(null,{...result,revision:2,state:{...result.state,crafted:['void_stalker','quantum_thruster']}});
  assert.equal(await stale,null);assert.deepEqual([...economy.state.crafted],['void_stalker']);economy.destroy();
});

test('extraction HUD accepts server durations of three/four seconds and rejects client-style shortcuts',()=>{
  const window={FleetI18n:{m:k=>k}};
  vm.runInNewContext(fs.readFileSync('client/js/extraction-hud.js','utf8'),{window,performance:{now:()=>100}});
  const ui=Object.create(window.FleetExtractionHUD.prototype);ui.accept=()=>true;
  ui.progress({duration:3000,elapsed:1000});assert.equal(ui.channel.duration,3000);
  for(const duration of [0,1,1000,2999,4001,Infinity])ui.progress({duration,elapsed:0});assert.equal(ui.channel.duration,3000);
  ui.progress({duration:4000,elapsed:0});assert.equal(ui.channel.duration,4000);
});

test('workshop cleans listeners/translations across repeated modal cycles and ignores confirmations after close',async()=>{
  const listeners=new Map(),domListeners=new Map(),bindings=new Set(),locales=new Set();let resolveCraft;
  const on=(map,n,f)=>{if(!map.has(n))map.set(n,new Set());map.get(n).add(f);},off=(map,n,f)=>{map.get(n)?.delete(f);if(!map.get(n)?.size)map.delete(n);};
  class Node{constructor(tag){this.tag=tag;this.children=[];this.style={};this.classList={add(){},remove(){}};}append(...nodes){this.children.push(...nodes);}after(){}setAttribute(){}querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()]);}querySelector(tag){return this.querySelectorAll().find(n=>n.tag===tag);}replaceChildren(){this.children=[];}remove(){}focus(){}}
  const document={body:new Node('body'),createElement:tag=>new Node(tag),getElementById:()=>new Node('button'),addEventListener:(n,f)=>on(domListeners,n,f),removeEventListener:(n,f)=>off(domListeners,n,f)};
  const socket={on:(n,f)=>on(listeners,n,f),off:(n,f)=>off(listeners,n,f)};
  const economy={accountReady:true,persistent:true,state:{secureStash:{capacity:300,revision:0,items:{titanium_scrap:75,quantum_crystal:20,alien_tech_core:7,dark_matter_shard:4}},crafted:[],equipped:{skin:'default'}},request:async()=>null,
    craft:()=>new Promise(resolve=>resolveCraft=resolve)};
  const window={FleetCraftingRecipes:Recipes,FleetExtractionRules:X,FleetI18n:{m:k=>k,render:(n,m)=>{bindings.add(n);n.textContent=m;},unbind:n=>bindings.delete(n),subscribe:f=>{locales.add(f);return()=>locales.delete(f);}}};
  vm.runInNewContext(fs.readFileSync('client/js/crafting-ui.js','utf8'),{window,document});
  const C={socket,joined:false,dead:false},scene={_features:{economy},events:{once(){}}},ui=new window.FleetCraftingUI(scene,C,()=>{});
  const baseline=bindings.size;
  for(let i=0;i<40;i++){ui.open();assert.equal(listeners.get('accountState').size,1);assert.equal(ui.panel.querySelectorAll().filter(n=>n.className==='craft-enough').length,7);ui.close();assert.equal(listeners.has('accountState'),false);assert.equal(domListeners.size,0);assert.equal(bindings.size,baseline);}
  ui.open();const pending=ui.fabricate('void_stalker');assert.equal(ui.pending,true);ui.close();ui.open();
  resolveCraft({ok:true,crafted:'void_stalker'});await pending;assert.equal(ui.message,null);assert.equal(ui.pending,false);
  ui.destroy();ui.destroy();assert.equal(listeners.size,0);assert.equal(domListeners.size,0);assert.equal(bindings.size,0);assert.equal(locales.size,0);
});
