'use strict';
// Explicit local QA fixture: production/Docker never import this preload.
if(process.env.NODE_ENV!=='development')throw Error('Polish QA requires development mode');
const {WorldEvents}=require('../server/worldEvents'),Classes=require('../server/shipClasses');
const update=WorldEvents.prototype.update;
WorldEvents.prototype.update=function(now=Date.now()){
  const p=[...this.room.players.values()].find(p=>!p.isBot && p.extractionInventory);
  if(p && !this.polishStarted){
    this.polishStarted=true;
    for(const [id,bot]of this.room.players)if(bot.isBot){this.room.swarm.release(bot);this.room.players.delete(id);}
    p.x=p.targetX=2000;p.y=p.targetY=2000;p.vx=p.vy=0;p.inputQueue.length=0;
    p.level=10;p.totalXp=require('../client/js/progression').thresholdXP(10);p.classChoices=['carrier'];Classes.apply(p,'carrier',1);
    p.spawnProtectionUntil=now+90000;
    this.room.obstacles.clear();this.room.obstacles.set('qa-rock',{id:'qa-rock',x:2300,y:2000,radius:35,hp:200,maxHp:200});
    this.room.extraction.collect(p,'titanium_scrap',25);this.room.extraction.collect(p,'quantum_crystal',8);this.room.extraction.collect(p,'alien_tech_core',2);
    const clock=this.room.extractionGates.now();this.room.extractionGates.gates.set('qa-exit',{id:'qa-exit',x:2000,y:2000,radius:120,expires:clock+45000});
    this.room.extractionGates.sync();
  }
  // Keep the QA ship stationary while the real gate validates every simulation tick.
  // This avoids incidental pointer movement when the menu button disappears.
  if(p && this.polishStarted){p.x=p.targetX=2000;p.y=p.targetY=2000;p.vx=p.vy=0;p.inputQueue.length=0;}
  update.call(this,now);
};
