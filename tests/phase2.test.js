'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Q=require('../client/js/daily-quests');
const {Player}=require('../server/entities'), Network=require('../client/js/network');
function fixture(seed={}) {
  const map=new Map(Object.entries(seed));let local=Date.UTC(2026,9,11,12), mono=0;
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  const window={localStorage:storage,FleetDailyQuests:Q,performance:{now:()=>mono}};
  vm.runInNewContext(fs.readFileSync('client/js/economy.js','utf8'),{window});
  const e=new window.FleetEconomy.Economy(storage,()=>local); e.setServerTime(local);
  return {e,window,storage,map,advance:ms=>{mono+=ms;},setLocal:ms=>{local=ms;}};
}
test('UTC streak ignores client wall-clock changes, claims once per day and grants exclusive day-seven skin',()=>{
  const f=fixture(); assert.equal(f.e.buy('skins','starlight'),false);
  assert.equal(Q.claimStreak(f.e),true);assert.equal(f.e.state.coins,100);
  f.setLocal(Date.UTC(2039,1,1));assert.equal(Q.claimStreak(f.e),false);
  for(let day=2;day<=7;day++) {f.advance(Q.DAY);assert.equal(Q.claimStreak(f.e),true);assert.equal(Q.claimStreak(f.e),false);}
  assert.equal(f.e.state.coins,1400);assert.ok(f.e.state.skins.includes('starlight'));
  assert.equal(f.e.buy('skins','starlight'),true);
  f.advance(Q.DAY*2);assert.equal(Q.claimStreak(f.e),true);assert.equal(f.e.state.retention.streak,1);
});
test('daily missions are unique, reproducible on reload and bounded; each reward claims only once',()=>{
  const f=fixture(),r=Q.ensure(f.e.state,f.e.utcNow());f.e.save();
  assert.equal(new Set(r.quests.map(q=>q.id)).size,3);
  const restored=new f.window.FleetEconomy.Economy(f.storage);restored.setServerTime(f.e.utcNow());
  assert.deepEqual(Q.ensure(restored.state,restored.utcNow()).quests.map(q=>q.id),r.quests.map(q=>q.id));
  Q.advance(r,{kills:100,score:5000,seconds:1000},'hunter');
  Q.advance(r,{},'carrier');Q.advance(r,{},'stealth');f.e.save();
  const expected=r.quests.reduce((sum,q)=>sum+q.reward,0);
  for(const q of r.quests) {assert.equal(Q.claimQuest(f.e,q.id),true);assert.equal(Q.claimQuest(f.e,q.id),false);}
  assert.equal(f.e.state.coins,expected);
  f.advance(Q.DAY);const next=Q.ensure(f.e.state,f.e.utcNow());assert.ok(next.quests.every(q=>q.progress===0 && !q.claimed));
});
test('server-derived gameplay watermarks prevent duplicate kills, survival and score progression across reload',()=>{
  const f=fixture();f.e.recordPlay('room:p:0',{kills:0,seconds:0,score:0},true);
  assert.equal(f.e.recordPlay('room:p:0',{kills:2,seconds:20,score:100}),120);
  assert.equal(f.e.recordPlay('room:p:0',{kills:2,seconds:20,score:100}),0);
  const restored=new f.window.FleetEconomy.Economy(f.storage);
  assert.equal(restored.recordPlay('room:p:0',{kills:2,seconds:20,score:100}),0);
  assert.equal(restored.recordPlay('room:p:0',{kills:1,seconds:10,score:50}),0);
  restored.recordPlay('room:p:1',{kills:2,seconds:0,score:50},true);
  assert.equal(restored.recordPlay('room:p:1',{kills:3,seconds:10,score:60}),60);
  assert.equal(restored.state.coins,180);
});
test('credit reward is idempotent, adds exactly 500 and enforces 30 seconds with a monotonic clock',()=>{
  const f=fixture();assert.equal(f.e.rewardAd('ad-a'),true);assert.equal(f.e.state.coins,500);
  assert.equal(f.e.rewardAd('ad-a'),false);assert.equal(f.e.rewardAd('ad-b'),false);
  f.setLocal(Date.UTC(2040,1,1));assert.equal(f.e.rewardAd('ad-b'),false);
  f.advance(30000);assert.equal(f.e.rewardAd('ad-b'),true);assert.equal(f.e.state.coins,1000);
});
test('failed ad attempts keep their cooldown, while only the reserved completed ad can reward during it',()=>{
  const f=fixture();assert.equal(f.e.reserveAd('failed'),true);f.e.releaseAd('failed');
  assert.equal(f.e.reserveAd('retry'),false);assert.equal(f.e.state.coins,0);
  f.advance(30000);assert.equal(f.e.reserveAd('complete'),true);
  assert.equal(f.e.rewardAd('other'),false);assert.equal(f.e.rewardAd('complete'),true);
  assert.equal(f.e.rewardAd('complete'),false);f.e.releaseAd('complete');assert.equal(f.e.state.coins,500);
});
test('invalid saves and prototype keys cannot crash the economy or equip locked items',()=>{
  const f=fixture({'fleet_io_economy_state':JSON.stringify({coins:-10,skins:[{},'bogus'],play:42,retention:{day:'bad',quests:[null]},equipped:{skin:'alien'}})});
  assert.equal(f.e.state.coins,0);assert.equal(f.e.state.equipped.skin,'default');
  assert.equal(f.e.buy('__proto__','alien'),false);assert.equal(f.e.buy('skins','bogus'),false);
  assert.equal(f.e.creditBatch(null),0);
  assert.equal(f.e.credit('constructor:1',10),10);assert.equal(f.e.credit('constructor:1',10),0);
  assert.equal(f.e.recordPlay('__proto__',{kills:0,seconds:1,score:0}),1);
  assert.equal(f.e.recordPlay('__proto__',{kills:0,seconds:1,score:0}),0);
});
test('CrazyGames SDK data is the sole save source on the portal and supports existing balances',()=>{
  const map=new Map([['fleet_io_economy_state',JSON.stringify({coins:800,lasers:['blue','green'],equipped:{laser:'green'}})]]);
  const window={FleetDailyQuests:Q,AdManager:{sdk:{data:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}}},
    localStorage:{getItem() {assert.fail('must not load a separate local balance');},setItem() {assert.fail('must not write a separate local balance');}}};
  vm.runInNewContext(fs.readFileSync('client/js/economy.js','utf8'),{window});
  const e=new window.FleetEconomy.Economy();assert.equal(e.state.coins,800);assert.equal(e.state.equipped.laser,'green');
  assert.equal(e.buy('lasers','red'),true);assert.equal(e.state.coins,300);
  assert.equal(JSON.parse(map.get('fleet_io_economy_state')).equipped.laser,'red');
});
test('cosmetics validate spawn inputs and laser style/session kills roundtrip snapshots',()=>{
  const Cosmetics=require('../server/cosmetics');const p=new Player('p','p');
  Cosmetics.apply(p,{skin:'starlight',trail:'purple',laser:'rainbow'});p.sessionKills=10;
  const n=Network.player(Network.packPlayer(p));assert.equal(n.skin,'starlight');assert.equal(n.laserStyle,'rainbow');assert.equal(n.sessionKills,10);
  Cosmetics.apply(p,{skin:'bad',laser:'__proto__'});assert.equal(p.laserStyle,'rainbow');
  assert.notEqual(Cosmetics.laserColor(p,0),Cosmetics.laserColor(p,3));
});
test('garage awards only through the success callback; errors, thrown SDK and double-clicks release lock without rewards',async()=>{
  const window={FleetI18n:{m:k=>k},FleetDailyQuests:Q};
  vm.runInNewContext(fs.readFileSync('client/js/garage-ui.js','utf8'),{window});
  let rewards=0,resolve,success;const ui=Object.create(window.FleetGarageUI.prototype);
  Object.assign(ui,{economy:{state:{adReadyAt:0},utcNow:()=>10000,reserveAd:()=>true,releaseAd() {},rewardAd:()=>{rewards++;return true;}},features:{currency() {}},render() {},opened:true});
  window.AdManager={canShowAds:()=>true,showRewardedAd:async(ok,fail)=>{success=ok;return new Promise(r=>{resolve=()=>{fail();r(false);};});}};
  const pending=ui.rewarded();await ui.rewarded();assert.equal(rewards,0);assert.equal(ui.pending,true);
  resolve();await pending;assert.equal(ui.pending,false);assert.equal(rewards,0);
  window.AdManager.showRewardedAd=async()=>{throw Error('SDK failure');};await ui.rewarded();assert.equal(ui.pending,false);assert.equal(rewards,0);
  window.AdManager.showRewardedAd=async ok=>{ok();return true;};await ui.rewarded();assert.equal(rewards,1);
});
test('garage rebuild/close cleanup releases all generated UI bindings without global listeners or intervals',()=>{
  const f=fixture(),bindings=new Map(),roots=[];
  class Node {
    constructor(tag) {this.tag=tag;this.children=[];this.style={};this.dataset={};this.classList={add() {},remove() {}};}
    append(...nodes) {this.children.push(...nodes);}
    replaceChildren() {this.children=[];}
    querySelectorAll(selector) {const all=this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);return selector==='*'?all:all.filter(n=>n.tag===selector);}
    querySelector(selector) {return this.querySelectorAll(selector)[0];}
    setAttribute() {} focus() {} remove() {const i=roots.indexOf(this);if(i>=0)roots.splice(i,1);}
  }
  const overlay=new Node('div');
  Object.assign(f.window,{FleetI18n:{m:k=>k,render:(n,m)=>bindings.set(n,m),unbind:n=>bindings.delete(n)},AdManager:{canShowAds:()=>false}});
  vm.runInNewContext(fs.readFileSync('client/js/garage-ui.js','utf8'),{window:f.window,document:{activeElement:null,createElement:tag=>new Node(tag),getElementById:()=>overlay,body:{append:n=>roots.push(n)}}});
  const garage=new f.window.FleetGarageUI({economy:f.e,C:{},track() {},scene:{textures:{getBase64:()=>''}},currency() {},loadout() {}});
  for(let i=0;i<100;i++) {garage.open();assert.ok(bindings.size>0);garage.close();assert.equal(bindings.size,0);assert.equal(roots.length,1);}
  garage.destroy();assert.equal(bindings.size,0);assert.equal(roots.length,0);
});
