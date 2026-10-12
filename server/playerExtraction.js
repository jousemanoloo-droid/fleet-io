'use strict';
const {performance}=require('node:perf_hooks');
const CHANNEL_MS=4000;

// No socket requests can start or finish this state machine. It runs after damage.
class PlayerExtraction {
  constructor(room,{now=()=>performance.now()}={}) {
    this.room=room;this.now=now;this.channels=new Map();this.members=new Map();this.revision=0;
  }
  attach(player,onSuccess) {
    this.remove(player);this.members.set(player.id,{player,onSuccess,readyAt:0});player.playerExtraction=this;
  }
  packet(player,data) {
    return {roomId:this.room.roomId,playerId:player.id,deathId:player.deathId,motionRevision:player.motionRevision || 0,revision:++this.revision,...data};
  }
  emit(event,player,data){try{this.room.io.to(player.id).emit(event,this.packet(player,data));}catch{}}
  cancel(player,reason='left') {
    if(!player || !this.channels.delete(player.id))return;
    this.emit('extraction:cancelled',player,{reason});
  }
  damage(player) {
    this.cancel(player,'damage');
    const member=this.members.get(player.id);if(member)member.readyAt=this.now()+1000;
  }
  remove(player) {
    if(!player)return;
    this.cancel(player,'left');this.members.delete(player.id);player.playerExtraction=null;
  }
  update(dt=1/30) {
    const now=this.now(),room=this.room;
    if(!room || room.destroyed)return;
    for(const member of this.members.values()) {
      const p=member.player,gate=this.room.extractionGates.containing(p);
      if(room.players.get(p.id)!==p){this.remove(p);continue;}
      const valid=this.room.players.get(p.id)===p && p.alive && p.hp>0 && !p.isBot &&
        !p.levelUpPending && !p.evolutionPending && typeof member.onSuccess==='function';
      let channel=this.channels.get(p.id);
      if(channel && (!valid || !gate || gate.id!==channel.gateId || p.deathId!==channel.deathId ||
        (p.motionRevision || 0)!==channel.motion || now-channel.lastTick>250)) {
        this.cancel(p,!valid?'state':!gate?'left':now-channel.lastTick>250?'interrupted':'state');
        member.readyAt=now+1000;continue;
      }
      if(!valid || !gate || now<member.readyAt)continue;
      if(!Object.values(p.inRunInventory || {}).some(n=>n>0)){this.cancel(p,'extraction.empty');continue;}
      if(!channel) {
        channel={gateId:gate.id,deathId:p.deathId,motion:p.motionRevision || 0,elapsed:0,lastTick:now,lastEmit:now,
          duration:p.extractionDuration===3000?3000:CHANNEL_MS};
        this.channels.set(p.id,channel);this.emit('extraction:progress',p,{gateId:gate.id,elapsed:0,duration:channel.duration});continue;
      }
      channel.lastTick=now;
      // A stalled server or a clock jump cannot skip combat checks for four seconds.
      channel.elapsed+=Math.max(0,Math.min(Number.isFinite(dt)?dt:0,1/30))*1000;
      if(channel.elapsed+1e-6>=channel.duration) {
        this.channels.delete(p.id);member.readyAt=now+2000;
        const result=this.room.extraction.completeExtraction(p);
        if(!result.ok){this.emit('extraction:cancelled',p,{reason:result.error || 'extraction.persistence'});continue;}
        // Commit is durable at this point. Evacuation must never award or wipe again.
        const packet=this.packet(p,{gateId:gate.id,extracted:result.extracted});
        try{member.onSuccess(packet);}catch(error){console.error('Extraction evacuation failed:',error.message);}finally{
          // Even a disconnected transport must leave no active ship or callback behind.
          if(room.players.get(p.id)===p)room.removeHuman(p.id);
          this.remove(p);
        }
      }else if(now-channel.lastEmit>=200){
        channel.lastEmit=now;this.emit('extraction:progress',p,{gateId:gate.id,elapsed:channel.elapsed,duration:channel.duration});
      }
    }
  }
  destroy(){for(const m of this.members.values())this.remove(m.player);this.channels.clear();this.members.clear();this.room=null;}
}
module.exports={PlayerExtraction,CHANNEL_MS};
