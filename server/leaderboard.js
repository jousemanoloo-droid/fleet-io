'use strict';
// Best session scores since process start, and best observations per UTC day.
// Bounded records, no external account identity inferred from a display name.
class Leaderboard {
  constructor(io,rooms,clans,{maxRecords=1000}={}) {
    this.io=io;this.rooms=rooms;this.clans=clans;this.maxRecords=maxRecords;
    this.global=new Map();this.daily=new Map();this.day=Math.floor(Date.now()/86400000);this.last='';this.revision=0;
    this.timer=setInterval(()=>this.update(),1000);this.timer.unref();
  }
  observe(p,now=Date.now()) {
    if(!p || p.isBot)return;
    const score=Math.max(0,Math.floor(p.deathState?.score ?? p.score ?? 0));if(!Number.isSafeInteger(score))return;
    const row=[p.id,p.name,p.shipClass || 'starter',this.clans.tag(p.id),score];
    const currentDay=Math.floor(now/86400000);
    if(currentDay!==this.day) {this.daily.clear();this.day=currentDay;}
    this.record(this.global,row);
    const achievedAt=p.deathState?p.matchStartedAt+p.deathState.survivedMs:now;
    if(Math.floor(achievedAt/86400000)===this.day)this.record(this.daily,row);
  }
  record(map,row) {
    const old=map.get(row[0]);map.set(row[0],[...row.slice(0,4),Math.max(row[4],old?.[4] || 0)]);
    if(!this.batch && map.size>this.maxRecords) {
      let worst;for(const [id,r] of map)if(!worst || r[4]<worst[1])worst=[id,r[4]];
      map.delete(worst[0]);
    }
  }
  players() {return [...this.rooms.rooms.values()].flatMap(room=>[...room.players.values()].filter(p=>!p.isBot));}
  top(map) {return [...map.values()].sort((a,b)=>b[4]-a[4] || a[0].localeCompare(b[0])).slice(0,10);}
  snapshot() {return {v:1,revision:this.revision,day:this.day,global:this.top(this.global),daily:this.top(this.daily),clans:this.clans.ranking(this.players())};}
  update(now=Date.now()) {
    const day=Math.floor(now/86400000);if(day!==this.day) {this.day=day;this.daily.clear();}
    // Batch trimming avoids an O(players × retained records) minimum search
    // when the number of active pilots exceeds the historical record cap.
    this.batch=true;
    try {for(const p of this.players())this.observe(p,now);}finally {this.batch=false;}
    for(const map of [this.global,this.daily])if(map.size>this.maxRecords) {
      const keep=new Set([...map.values()].sort((a,b)=>b[4]-a[4] || a[0].localeCompare(b[0])).slice(0,this.maxRecords).map(row=>row[0]));
      for(const id of map.keys())if(!keep.has(id))map.delete(id);
    }
    const data=this.snapshot(),fingerprint=JSON.stringify([data.day,data.global,data.daily,data.clans]);
    if(fingerprint===this.last)return false;
    this.last=fingerprint;data.revision=++this.revision;this.io.emit?.('leaderboards',data);return true;
  }
  destroy() {clearInterval(this.timer);this.global.clear();this.daily.clear();this.rooms=this.clans=this.io=null;}
}
module.exports={Leaderboard};
