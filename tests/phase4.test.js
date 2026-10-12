'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Clans,normalizeTag}=require('../server/clans'),{Leaderboard}=require('../server/leaderboard');
const {RoomManager}=require('../server/roomManager'),{Player}=require('../server/entities'),Network=require('../client/js/network');
test('clan tags normalize safely and reject injection, offensive words, excessive length and non-strings',()=>{
  assert.equal(normalizeTag('[ace]'),'ACE');assert.equal(normalizeTag(' vortex '),'VORTEX');
  for(const tag of ['<svg>','ACE;DROP','FUCK','N4ZI','ABCDEFGHI',{},null,'__proto__','A'])assert.equal(normalizeTag(tag),null);
});
test('clan membership is exclusive, capacity checks are atomic and empty groups disappear',()=>{
  const clans=new Clans({maxClans:2,maxMembers:1});
  assert.equal(clans.join('a','ACE').ok,true);assert.equal(clans.join('b','VORTEX').ok,true);
  assert.equal(clans.join('b','ACE').ok,false);assert.equal(clans.tag('b'),'VORTEX');
  assert.equal(clans.join('c','XYZ').ok,false);
  clans.leave('a');assert.equal(clans.clans.has('ACE'),false);
  assert.equal(clans.join('b','ACE').ok,true);assert.equal(clans.clans.has('VORTEX'),false);
  const p=new Player('b','B');p.score=500;
  assert.deepEqual(clans.ranking([p]),[['ACE',500,1]]);clans.destroy();assert.equal(clans.memberships.size,0);
});
test('global/daily boards aggregate rooms, retain best scores, skip bots and broadcast only changed compact rows',t=>{
  const packets=[],io={emit:(event,data)=>packets.push([event,data])},clans=new Clans();
  const a=new Player('a','A'),b=new Player('b','B'),bot=new Player('bot','Bot');
  Object.assign(a,{score:100,shipClass:'hunter'});b.score=300;bot.score=999;bot.isBot=true;clans.join('a','ACE');
  const rooms={rooms:new Map([['r1',{players:new Map([['a',a],['bot',bot]])}],['r2',{players:new Map([['b',b]])}]])};
  const board=new Leaderboard(io,rooms,clans);t.after(()=>board.destroy());
  assert.equal(board.update(100000),true);assert.equal(board.update(100001),false);
  assert.equal(packets.length,1);assert.deepEqual(packets[0][1].global.map(row=>row[0]),['b','a']);
  assert.deepEqual(packets[0][1].global[1],['a','A','hunter','ACE',100]);
  a.score=500;board.update(101000);assert.equal(board.snapshot().global[0][0],'a');
  a.score=0;board.update(102000);assert.equal(board.snapshot().global[0][4],500);
  rooms.rooms.clear();board.update(86400001);assert.deepEqual(board.snapshot().daily,[]);assert.equal(board.snapshot().global.length,2);
});
test('historical board storage stays bounded under many disconnected identities',t=>{
  const board=new Leaderboard({emit() {}},{rooms:new Map()},new Clans(),{maxRecords:10});t.after(()=>board.destroy());
  for(let i=0;i<1000;i++)board.observe({id:'p'+i,name:'P',score:i,alive:true},0);
  assert.equal(board.global.size,10);assert.equal(board.daily.size,10);assert.equal(board.snapshot().global[0][4],999);
});
test('private prefixed codes join the same instance, empty rooms sweep all indexes and clan tags survive transfer',t=>{
  const io={emit() {},to:()=>({emit() {},volatile:{emit() {}}})},manager=new RoomManager(io);t.after(()=>manager.destroy());
  const socket={id:'p',join() {},leave() {}};manager.clans.join('p','ACE');
  const room=manager.create('private');manager.transfer(socket,room,'P');
  assert.equal(manager.findRoom(room.info().code,'friend'),room);assert.match(room.info().code,/^FLEET-[A-Z2-9]{6}$/);
  assert.equal(room.players.get('p').clanTag,'ACE');
  manager.leave(socket);manager.sweep(room.emptySince+60000);
  assert.equal(manager.rooms.size,0);assert.equal(manager.codes.size,0);assert.equal(manager.memberships.size,0);
  assert.equal(room.destroyed,true);
});
test('clan tags roundtrip multiplayer snapshots and unchanged legacy rankings do not repeat in deltas',()=>{
  const p=new Player('p','P');p.clanTag='ACE';assert.equal(Network.player(Network.packPlayer(p)).clanTag,'ACE');
  const base={v:2,t:1,keyframe:1,roomId:'r',p:[],s:[],b:[],o:[],leaderboard:[{id:'p',name:'P',score:5}]};
  const packet=Network.delta(base,{...base,t:2,keyframe:undefined});assert.equal(packet.leaderboard,undefined);
  const decoder=new Network.Decoder();decoder.receive(base);assert.deepEqual(decoder.receive(packet).leaderboard,base.leaderboard);
});
test('leaderboard UI uses text, rejects stale packets and releases bindings/listeners after repeated updates',()=>{
  const fs=require('node:fs'),vm=require('node:vm');const handlers=new Map(),bindings=new Set();let unsubscribed=0;
  class Node {
    constructor() {this.children=[];this.classList={add() {}};}
    append(...nodes) {this.children.push(...nodes);} before() {} remove() {} replaceChildren() {this.children=[];}
    querySelectorAll() {return this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);}
  }
  const rows=new Node(),window={FleetI18n:{m:k=>k,render:n=>bindings.add(n),unbind:n=>bindings.delete(n),subscribe:()=>()=>{unsubscribed++;}}};
  const C={myId:'p',socket:{on:(event,fn)=>handlers.set(event,fn),off:event=>handlers.delete(event)}};
  vm.runInNewContext(fs.readFileSync('client/js/leaderboard-ui.js','utf8'),{window,document:{createElement:()=>new Node(),getElementById:()=>rows}});
  const ui=new window.FleetLeaderboardUI({events:{once() {}}},C);
  for(let revision=1;revision<=100;revision++)ui.receive({v:1,revision,global:[['p','<svg>','hunter','ACE',revision]],daily:[],clans:[['ACE',revision,1]]});
  assert.equal(rows.children.length,1);assert.equal(rows.children[0].children[0].textContent,'1. [ACE] <svg>');
  ui.receive({v:1,revision:1,global:[],daily:[],clans:[]});assert.equal(rows.children.length,1);
  assert.ok(bindings.size<=5);ui.destroy();assert.equal(bindings.size,0);assert.equal(handlers.size,0);assert.equal(unsubscribed,1);
});
test('clan UI discards old acknowledgements after reconnect',()=>{
  const fs=require('node:fs'),vm=require('node:vm');let ack,tag=null;const handlers=new Map();
  const window={FleetI18n:{m:k=>k,error:k=>k},AdManager:{busy:false}};
  vm.runInNewContext(fs.readFileSync('client/js/clan-ui.js','utf8'),{window});
  const ui=Object.create(window.FleetClanUI.prototype);
  Object.assign(ui,{C:{connected:true,socket:{timeout() {return this;},emit(event,data,callback) {ack=callback;},off:e=>handlers.delete(e)}},generation:0,status:{},refresh() {},destroyed:false});
  window.FleetI18n.render=()=>{};
  ui.request('joinClan','ACE');ui.generation++;ack(null,{ok:true,tag:'ACE'});assert.equal(ui.tag,undefined);
  ui.pending=false;window.localStorage={setItem:(key,value)=>{tag=value;}};
  ui.request('joinClan','ACE');ack(null,{ok:true,tag:'ACE'});assert.equal(ui.tag,'ACE');assert.equal(tag,'ACE');
});
