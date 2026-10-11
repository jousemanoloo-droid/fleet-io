// Fixture visual explícita; nunca se importa desde el entrypoint de producción.
'use strict';
const {Hazards}=require('../server/hazards');
const update=Hazards.prototype.update;
Hazards.prototype.update=function(now=Date.now()){
 const p=[...this.room.players.values()].find(p=>!p.isBot);
 if(p&&!this.qaStart){
  this.qaStart=now;p.x=p.targetX=830;p.y=p.targetY=700;p.spawnProtectionUntil=now+60000;
  this.startNova(now);this.supernova.x=1150;this.supernova.y=900;
  for(let i=0;i<4;i++)this.kill(p);
  for(let i=0;i<2;i++)this.room.obstacles.set(`qa-plasma:${i}`,{id:`qa-plasma:${i}`,x:1000+i*160,y:580,radius:30,hp:200,maxHp:200,volatile:true});
 }
 update.call(this,now);
 if(p&&now-this.qaStart>3500&&!this.qaTraverse){
  this.qaTraverse=true;p.x=p.y=700;p.vx=5;p.vy=0;this.traverse(p,'player',null,now);
  this.supernova.x=3500;this.supernova.y=3450;
 }
 if(p&&now-this.qaStart>7000&&!this.qaBlast){this.qaBlast=true;const rock=this.room.obstacles.get('qa-plasma:0');if(rock)this.explode(rock,p,now);}
};
