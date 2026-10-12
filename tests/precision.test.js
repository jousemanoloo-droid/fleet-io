'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Rules=require('../client/js/ship-classes'),Ballistics=require('../client/js/ballistics');
const {Player}=require('../server/entities'),{DroneSwarm}=require('../server/swarm'),N=require('../client/js/network');
const {activeDroneCount}=require('../server/droneCounts');

test('all ship muzzles use the same texture tip, scale and rotation matrix as their rendered cannon',()=>{
  for(const shipClass of [null,'hunter','battleship','carrier','stealth'])for(const theta of [0,Math.PI/2,Math.PI,Math.PI*1.75]){
    const p={x:100,y:200,rotation:theta,shipClass,chassis:Rules.definition(shipClass)?.texture || 4};
    Rules.guns(p).forEach((gun,index)=>{
      const point=Rules.muzzle(p,index),scale=Rules.renderScale(p);
      assert.ok(Math.abs(point.x-(100+(gun.x*Math.cos(theta)-gun.y*Math.sin(theta))*scale))<1e-10);
      assert.ok(Math.abs(point.y-(200+(gun.x*Math.sin(theta)+gun.y*Math.cos(theta))*scale))<1e-10);
      const shot=Ballistics.launch(p,point,{x:300,y:200});assert.equal(shot.x,point.x);assert.equal(shot.y,point.y);
    });
  }
  assert.equal(Rules.pattern({shipClass:'hunter'}).length,2);assert.equal(Rules.pattern({shipClass:'battleship'}).length,1);
  assert.equal(Rules.pattern({shipClass:'hunter',powerTripleRemaining:500}).length,3);
});

function swarm(){
  const room={roomId:'r',world:{width:4000,height:4000},players:new Map(),impacts:[],io:{to:()=>({emit(){}})}};
  const owner=new Player('p','Pilot');owner.x=owner.y=2000;room.players.set(owner.id,owner);
  const manager=new DroneSwarm(room);owner.swarm=manager;manager.prepare(owner);
  return {room,owner,manager};
}

test('swarm acquires nearest living ship regardless of player heading and follows moving targets',()=>{
  const {room,owner,manager}=swarm();owner.rotation=0;
  const enemy=new Player('enemy','Enemy');enemy.x=1800;enemy.y=2000;room.players.set(enemy.id,enemy);
  const far=new Player('far','Far');far.x=2400;far.y=2000;room.players.set(far.id,far);
  manager.update(1/30,1000);assert.equal(manager.trigger(owner,1000),true);
  assert.ok(owner.tacticalDrones.every(d=>d.state==='ATTACK_SWARM' && d.targetId==='enemy'));
  const d=owner.tacticalDrones[0];manager.update(1/30,1033);assert.ok(d.vx<0);
  enemy.y=1750;manager.update(1/30,1066);assert.ok(d.vy<0);
});

test('swarm ignores dead/invisible/protected ships, locks bosses and attributes boss hits server-side',()=>{
  const {room,owner,manager}=swarm(),dead=new Player('dead','Dead');dead.x=owner.x;dead.y=owner.y;dead.alive=false;room.players.set(dead.id,dead);
  let hits=0;const boss={id:'boss',x:2020,y:2000,radius:100,hp:1500,alive:true};room.events={boss,bossHit:(n,p)=>{assert.equal(n,75);assert.equal(p,owner);hits++;}};
  assert.equal(manager.acquireTarget(owner,1000),boss);manager.trigger(owner,1000);manager.update(1/30,1033);assert.ok(hits>0);
  assert.ok(owner.tacticalDrones.every(d=>d.targetId===null));
});

test('without targets every drone sweeps defensively near its owner and returns after six seconds',()=>{
  const {room,owner,manager}=swarm();owner.addDrone('earned');owner.orbitalDrones.push({id:'orbital',x:2000,y:2000,autonomous:true});
  manager.trigger(owner,1000);const drones=[...owner.drones,...owner.tacticalDrones,...owner.orbitalDrones];
  assert.ok(drones.every(d=>d.state==='DEFENSIVE_SWEEP' && d.targetId===null));
  for(let i=0;i<180;i++){manager.update(1/30,1000+i*1000/30);for(const d of drones)assert.ok(Math.hypot(d.x-owner.x,d.y-owner.y)<=131);}
  manager.update(1/30,7033);assert.ok(drones.every(d=>d.state!=='DEFENSIVE_SWEEP'));
  owner.die();manager.prepare(owner);assert.ok(owner.tacticalDrones.every(d=>d.targetId===null));manager.destroy();
});

test('snapshot count includes escorts, tactical and carrier drones and transmits swarm state without stale ids',()=>{
  const {owner}=swarm();owner.addDrone('earned');owner.orbitalDrones.push({id:'orbital',x:1,y:2,autonomous:true,state:'ATTACK_SWARM',attackTimer:2000});
  assert.equal(activeDroneCount(owner),4);const packet=N.player(N.packPlayer(owner));assert.equal(packet.activeDroneCount,4);assert.equal(packet.orbitalDrones[0].state,'ATTACK_SWARM');
  owner.drones.splice(0,1);assert.equal(N.player(N.packPlayer(owner)).activeDroneCount,3);owner.die();assert.equal(N.player(N.packPlayer(owner)).activeDroneCount,0);
});

test('drone HUD accepts authoritative zero, preserves its DOM identity and rejects malformed counts',()=>{
  const node={textContent:'3'},window={FleetI18n:{render:(n,t)=>n.textContent=t}};
  vm.runInNewContext(fs.readFileSync('client/js/hud-ui.js','utf8'),{window,document:{getElementById:()=>node}});
  for(const n of [4,0,2]){assert.equal(window.FleetHUDUI.updateDroneCount(n),true);assert.equal(node.textContent,String(n));}
  for(const n of [-1,65,Infinity,1.5,'2'])assert.equal(window.FleetHUDUI.updateDroneCount(n),false);
});

function dom(){
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.classes=new Set();this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v),toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)};}
    append(...nodes){for(const n of nodes){n.parent?.children.splice(n.parent.children.indexOf(n),1);n.parent=this;this.children.push(n);}}
    before(...nodes){if(this.parent)this.parent.append(...nodes);}after(){}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
    querySelectorAll(){return this.children.flatMap(n=>[n,...n.querySelectorAll()]);}querySelector(selector){return this.querySelectorAll().find(n=>n.className===selector.slice(1));}
    replaceChildren(){this.children=[];}remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);}
  }
  const root=new Node('div'),rows=new Node('div'),meta=new Node('div');meta.className='lb-meta';root.append(meta,rows);
  return {Node,root,rows,document:{createElement:t=>new Node(t),getElementById:id=>id==='lb-rows'?rows:id==='leaderboard'?root:null}};
}

test('leaderboard tabs render each category instantly, expose active state, collapse and restore original HUD nodes',()=>{
  const {document,rows,root,Node}=dom(),handlers=new Map(),bindings=new Set();
  const window={FleetI18n:{m:k=>k,render:(n,m)=>{n.textContent=m;bindings.add(n);},unbind:n=>bindings.delete(n),subscribe:()=>()=>{}}};
  const C={myId:'p',socket:{on:(n,f)=>handlers.set(n,f),off:n=>handlers.delete(n)}};
  vm.runInNewContext(fs.readFileSync('client/js/leaderboard-ui.js','utf8'),{window,document});
  const ui=new window.FleetLeaderboardUI({events:{once(){}}},C);
  ui.receive({v:1,revision:1,global:[['p','Global','hunter',null,100]],daily:[['d','Daily','stealth',null,50]],clans:[['ACE',20,1]]});
  for(const mode of ['global','daily','clans']){ui.buttons[mode].onclick();assert.equal(ui.mode,mode);assert.equal(ui.buttons[mode].attributes['aria-selected'],'true');assert.ok(ui.buttons[mode].classes.has('active'));}
  assert.ok(rows.children[0].children[0].textContent.includes('ACE'));
  ui.toggle.onclick();assert.equal(ui.toggle.attributes['aria-expanded'],'false');assert.ok(root.classes.has('collapsed'));
  ui.toggle.onclick();assert.equal(ui.toggle.attributes['aria-expanded'],'true');assert.equal(ui.content.attributes.inert,undefined);
  ui.receive({v:1,revision:2,global:[],daily:[],clans:[]});ui.renderLeaderboard('daily');assert.equal(rows.children[0].textContent,'rank.emptyDaily');
  ui.destroy();assert.equal(bindings.size,0);assert.equal(handlers.size,0);assert.ok(root.querySelector('.lb-meta'));
});

test('quick-access adopts the four original buttons without replacing their IDs or click handlers',()=>{
  const {document,root,Node}=dom(),panel=new Node('div');document.getElementById=()=>panel;
  const buttons=Array.from({length:4},(_,i)=>{const n=new Node('button');n.id='original-'+i;n.onclick=()=>i;return n;});
  const window={FleetI18n:{m:k=>k,render(){},unbind(){},subscribe:()=>()=>{}},FleetExtractionRules:require('../client/js/extraction-rules'),FleetCraftingRecipes:require('../client/js/crafting-recipes')};
  const handlers=new Map(),scene={_clanUI:{button:buttons[0]},_stashUI:{menuButton:buttons[1]},_craftingUI:{menu:buttons[2]},_features:{menuShopButton:buttons[3],economy:{state:{},accountReady:false}},events:{once(){}}};
  const C={socket:{on:(n,f)=>handlers.set(n,f),off:n=>handlers.delete(n)}};
  vm.runInNewContext(fs.readFileSync('client/js/main-menu.js','utf8'),{window,document});
  const menu=new window.FleetMainMenu(scene,C);assert.equal(panel.children.length,4);
  for(let i=0;i<4;i++){assert.equal(panel.children[i].children[1],buttons[i]);assert.equal(buttons[i].id,'original-'+i);assert.equal(buttons[i].onclick(),i);}
  menu.destroy();assert.equal(handlers.size,0);
});
