// Solo QA opt-in: nunca importado por npm start/Docker.
'use strict';
const {Competitive}=require('../server/competitive');
const {Player}=require('../server/entities');
const update=Competitive.prototype.update;
Competitive.prototype.update=function(now=Date.now()){
  const human=[...this.room.players.values()].find(p=>!p.isBot);
  if(human&&!this.qaStarted){
    this.qaStarted=now;human.x=human.targetX=200;human.y=human.targetY=200;
    human.spawnProtectionUntil=now+60000;
    const rival=new Player('qa-nemesis','QA Nemesis');rival.x=rival.targetX=320;rival.y=rival.targetY=230;rival.spawnProtectionUntil=now+60000;rival.competitive=this;
    this.room.players.set(rival.id,rival);human.nemesisId=rival.id;this.respawn(human,now);
    const pod=this.spawnPod();if(pod){pod.x=850;pod.y=60;}
    human.supplyBuff='MIRROR_SHIELD';human.supplyUntil=now+15000;
  }
  update.call(this,now);
};
