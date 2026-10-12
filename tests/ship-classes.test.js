'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {Player} = require('../server/entities');
const Classes = require('../server/shipClasses'), RPG = require('../server/rpg');
const Progression = require('../client/js/progression'), Movement = require('../client/js/movement');
const Network = require('../client/js/network'), {updateCombat} = require('../server/combat');
function pilot(id='p') { const p=new Player(id,id); p.x=p.y=p.targetX=p.targetY=2000; return p; }
function unlock(p,level=10) { RPG.addXP(p,Progression.thresholdXP(level)-p.totalXp); p.levelUpPending=false; p.invulnerable=false; }
function room(...ps) {return {players:new Map(ps.map(p=>[p.id,p])), obstacles:new Map(), projectiles:new Map(), uidCounter:1, world:{width:4000,height:4000}};}

test('server evolution queues 10/25/45, rejects forged and replayed choices, and does not stack class modifiers', () => {
  const p=pilot(); unlock(p,45);
  assert.equal(p.evolutionPending,10);
  for (const [id,level] of [['__proto__',10],['hunter',25],['hunter',NaN],[{},10],[Object.create(null),10]]) assert.equal(Classes.choose(p,id,level),false);
  assert.equal(Classes.choose(p,'hunter',10),true); assert.equal(p.maxSpeed,9.75); assert.equal(p.maxHp,80);
  assert.equal(Classes.choose(p,'hunter',10),false);
  assert.equal(Classes.choose(p,'battleship',25),true); assert.equal(p.maxSpeed,5.625); assert.equal(p.maxHp,250);
  assert.equal(Classes.choose(p,'stealth',45),true); assert.equal(p.maxHp,100); assert.equal(p.classRank,3);
  assert.equal(p.evolutionPending,0); assert.equal(p.classChoices.length,3);
});
test('selection freezes shared physics, prevents damage and expires without per-player timers', () => {
  const p=pilot(); unlock(p); p.vx=8;
  Movement.step(p,{tx:3000,ty:2000}); assert.equal(p.x,2000); assert.equal(p.vx,0);
  p.takeDamage(500); assert.equal(p.hp,100);
  Classes.tick(p,1/30,p.evolutionExpiresAt); assert.equal(p.shipClass,'hunter'); assert.equal(p.evolutionPending,0);
});
test('five tactical upgrades validate costs/caps and regeneration uses elapsed time', () => {
  const p=pilot(); p.attributePoints=5;
  for(const key of ['speed','fireRate','damage','regen','vision']) assert.equal(RPG.allocate(p,key),true);
  assert.equal(p.attributePoints,0); assert.equal(RPG.allocate(p,'regen'),false);
  assert.equal(RPG.allocate(p,Object.create(null)),false);
  p.hp=50; Classes.tick(p,.5,5000); assert.equal(p.hp,52);
  p.lastDamageAt=5000; Classes.tick(p,.5,5500); assert.equal(p.hp,52);
  Classes.tick(p,100,9000); assert.equal(p.hp,100);
});
test('stealth is server-gated, lasts four seconds, stops firing and has a twelve-second cooldown', () => {
  const p=pilot(), target=pilot('target'); target.x+=200;
  assert.equal(RPG.activate(p,'cloak',room(p,target),1000),false);
  unlock(p); Classes.choose(p,'stealth',10);
  assert.equal(RPG.activate(p,'cloak',room(p,target),1000),true);
  assert.equal(p.cloakUntil,5000); assert.equal(p.abilityReady.cloak,13000);
  assert.equal(RPG.activate(p,'cloak',room(p,target),5001),false);
  p.cloakUntil=Date.now()+4000; const r=room(p,target); target.nextFireTick=9999;
  updateCombat(r,1); assert.equal(r.projectiles.size,0);
  p.cloakUntil=0; updateCombat(r,2); assert.equal(r.projectiles.size,1);
});
test('carrier pools autonomous drones, pursues targets and releases them on class change/death', () => {
  const p=pilot(), target=pilot('target'); target.x+=200; unlock(p,25);
  Classes.choose(p,'carrier',10); Classes.choose(p,'carrier',25); RPG.orbit(p);
  assert.equal(p.orbitalDrones.length,4); const first=p.orbitalDrones[0];
  p.carrierTarget=target;
  for(let i=0;i<60;i++) RPG.orbit(p);
  assert.equal(p.orbitalDrones[0],first); assert.ok(p.orbitalDrones[0].x > p.x+100);
  unlock(p,45); Classes.choose(p,'hunter',45); assert.equal(p.orbitalDrones.length,0);
  p.die(); assert.equal(p.carrierTarget,null); assert.equal(p.cloakUntil,0);
});
test('heavy cannon splash damages nearby enemies but never its owner', () => {
  const p=pilot(), victim=pilot('v'), secondary=pilot('s'); victim.x+=100; secondary.x+=110; secondary.y+=40;
  unlock(p); Classes.choose(p,'battleship',10); p.nextFireTick=9999; victim.nextFireTick=secondary.nextFireTick=9999;
  const r=room(p,victim,secondary);
  r.projectiles.set('heavy',{id:'heavy',ownerId:p.id,x:2060,y:2000,vx:50,vy:0,damage:40,splash:120,ttl:2,hitIds:new Set()});
  updateCombat(r,1); assert.equal(victim.hp,60); assert.ok(secondary.hp<100); assert.equal(p.hp,250);
});
test('compact snapshots preserve class, upgrades, selection and cloak without server clock assumptions', () => {
  const p=pilot(); unlock(p,25); Classes.choose(p,'stealth',10); p.attributes.regen=3; p.attributes.vision=4;
  const n=Network.player(Network.packPlayer(p));
  assert.equal(n.shipClass,'stealth'); assert.equal(n.evolutionPending,25); assert.equal(n.classRank,1);
  assert.equal(n.attributes.regen,3); assert.equal(n.attributes.vision,4); assert.ok(n.evolutionRemaining>0);
});
test('rewarded respawn rolls class rank back to retained XP; free respawn clears match upgrades', () => {
  const p=pilot(); unlock(p,45);
  Classes.choose(p,'hunter',10); Classes.choose(p,'carrier',25); Classes.choose(p,'battleship',45);
  p.attributes.vision=2; p.die(); p.respawn(true,new Map([[p.id,p]]));
  assert.ok(p.level<45); assert.equal(p.shipClass,'carrier'); assert.equal(p.classRank,2);
  assert.equal(p.attributes.vision,2);
  p.die(); p.respawn(false,new Map([[p.id,p]]));
  assert.equal(p.shipClass,null); assert.equal(p.level,1); assert.equal(p.attributes.vision,0); assert.equal(p.maxSpeed,Movement.BASE_SPEED);
});

test('evolution UI releases translation bindings and ignores acknowledgements from closed lives', () => {
  const fs=require('node:fs'),vm=require('node:vm'); const bindings=new Map(),roots=[];
  class Node {
    constructor(tag) {this.tag=tag;this.children=[]; this.classList={add() {},remove() {}};}
    append(...nodes) {this.children.push(...nodes);}
    replaceChildren() {this.children=[];}
    querySelectorAll(selector) {const nodes=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);return selector==='*'?nodes:nodes.filter(n=>n.tag===selector);}
    querySelector(selector) {return this.querySelectorAll(selector)[0];}
    setAttribute() {} focus() {} remove() {roots.splice(roots.indexOf(this),1);}
  }
  let ack, shutdown, reconciled=0, stopped=0;
  const C={connected:true,joined:true,dead:false,myId:'p',room:{roomId:'r'},socket:{timeout() {return this;},emit(event,data,cb) {assert.equal(event,'chooseShipClass'); ack=cb;}}};
  const window={FleetI18n:{m:key=>key,render:(n,m)=>bindings.set(n,m),unbind:n=>bindings.delete(n)},FleetShipClasses:Classes,
    FleetGame:{trackGameplay() {}},AdManager:{gameplayStop() {stopped++;}}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../client/js/class-ui.js'),'utf8'),{
    window, document:{createElement:tag=>new Node(tag),body:{append:n=>roots.push(n)}}
  });
  const ui=new window.FleetClassUI({events:{once(event,fn) {shutdown=fn;}},_syncLocalState() {reconciled++;}},C);
  for(let life=1;life<=100;life++) {
    ui.sync({hp:100,deathId:life,evolutionPending:10}); assert.equal(C.evolutionPaused,true);
    assert.equal(ui.panel.querySelectorAll('button').length,4);
    ui.choose('hunter'); ui.close();
    ack(null,{ok:true,player:{}}); assert.equal(reconciled,0);
    assert.equal(C.evolutionPaused,false); assert.equal(bindings.size,0); assert.equal(roots.length,1);
  }
  shutdown(); assert.equal(roots.length,0); assert.equal(bindings.size,0); assert.equal(stopped,1);
  assert.equal(ui.C,null);
});
