'use strict';
// Actual authoritative simulation + snapshot encoding. No WebGL/FPS claims.
const {GameRoom}=require('../server/gameRoom');
const {Bot}=require('../server/bot');
const {Accounts}=require('../server/accounts');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks');
let packets=0,bytes=0,seed=12345;
const random=Math.random,wallNow=Date.now;
let time=Date.UTC(2026,9,12);
Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
Date.now=()=>time;
const emit=(event,data)=>{if(event==='gameState'){packets++;bytes+=Buffer.byteLength(JSON.stringify(data));}};
const io={to:()=>({emit,volatile:{emit}})};
const accounts=new Accounts({secret:'stress-test'.repeat(4),now:()=>time});
const makeRoom=index=>{
  const r=new GameRoom({roomId:'stress-'+index,type:'public',maxPlayers:30,io});
  for(let i=0;i<30;i++) {
    const p=new Bot('pilot-'+index+'-'+i,'Pilot '+i,i);r.placePlayer(p);
    p.isBot=i>=20; r.players.set(p.id,p);
    for(let d=0;d<12;d++)p.addDrone('escort-'+d);
    if(!p.isBot){accounts.open({id:p.id,emit() {}});accounts.beginLife(p.id,p);p.account={observe:f=>accounts.observe(p.id,p,f)};}
  }
  r.events.spawnBoss();r.environment.spawn('BLACK_HOLE');r.environment.spawn('RADIATION');
  return r;
};
const times=[],peak={projectiles:0,gems:0,powerups:0,scraps:0};
let result;
try {
  const rooms=Array.from({length:4},(_,i)=>makeRoom(i));
  const started=performance.now(),steps=1800;
  for(let step=0;step<steps;step++) {
    time+=1000/30;const start=performance.now();
    for(const r of rooms) {
      for(const p of r.players.values())if(!p.isBot) {
        if(!p.alive){p.respawn(false,r.players,r.world,r.obstacles);accounts.beginLife(p.id,p);}
        if(p.evolutionPending)require('../server/shipClasses').choose(p,'hunter',p.evolutionPending);
        if(p.levelUpPending){p.applyUpgrade(p.upgradeOptions[0] || 'nano_armor');p.upgradeOptions=[];}
        if(step%30===0)p.setTarget(100+Math.random()*3800,100+Math.random()*3800);
      }
      r.loop._tick();
      peak.projectiles=Math.max(peak.projectiles,r.projectiles.size);
      peak.gems=Math.max(peak.gems,r.events.gems.size);peak.scraps=Math.max(peak.scraps,r.scraps.size);
      peak.powerups=Math.max(peak.powerups,r.powerups.orbs.size);
      assert.ok(r.projectiles.size<=240);assert.ok(r.events.gems.size<=360);assert.ok(r.powerups.orbs.size<=24);
      assert.ok(r.loop.clientFrames.size<=20);
    }
    times.push(performance.now()-start);
    if(step%300===299)console.log(JSON.stringify({progress:step+1,total:steps,p95SampleMs:times.at(-1)}));
  }
  const elapsed=performance.now()-started;
  for(const r of rooms){for(const p of r.players.values())accounts.close(p.id);r.destroy();assert.equal(r.players.size,0);assert.equal(r.projectiles.size,0);assert.equal(r.loop.clientFrames.size,0);}
  rooms.length=0;global.gc?.();const before=process.memoryUsage().heapUsed;
  for(let i=0;i<200;i++) {
    const r=new GameRoom({roomId:'cycle-'+i,type:'singleplayer',maxPlayers:1,io});
    for(let tick=0;tick<10;tick++){time+=1000/30;r.loop._tick();}
    r.destroy();assert.equal(r.players.size,0);assert.equal(r.projectiles.size,0);assert.equal(r.loop.clientFrames.size,0);
  }
  global.gc?.();const after=process.memoryUsage().heapUsed;
  times.sort((a,b)=>a-b);
  result={passed:true,integrityPassed:true,realtimeP95BudgetMet:times[Math.floor(times.length*.95)]<=1000/30,simulationAverageTickMs:elapsed/steps,node:process.version,rooms:4,players:120,networkObservers:80,escorts:1440,
    simulatedSeconds:steps/30,roomTicks:steps*4,roomLifecycleCycles:200,elapsedMs:Math.round(elapsed),
    aggregateTickMs:{p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],p99:times[Math.floor(times.length*.99)],max:times.at(-1)},
    heapAfterCleanupBytes:after,heapGrowthAfter200CyclesBytes:after-before,gcAvailable:!!global.gc,packets,encodedBytes:bytes,peak,
    limitations:['No real sockets, TLS, Render hardware, WebGL or browser frames measured.','Four-room duration measures all four simulations together, including JSON encoding.','Synthetic seeded workload; does not certify arbitrary device FPS or distributed deployment.']};
  assert.ok(after-before<8*1024*1024,'retained heap growth exceeds 8 MiB safety bound');
} finally {accounts.destroy();Date.now=wallNow;Math.random=random;}
const file=path.resolve('artifacts/stress-audit-results.json');fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

