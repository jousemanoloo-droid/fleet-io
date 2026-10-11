// UI competitiva: todos los resultados y cooldowns proceden del servidor.
(function(global) {
  'use strict';
  class Competitive {
    constructor(scene,C) {
      this.scene=scene; this.C=C; this.pods=new Map(); this.arrows=new Map(); this.handlers={};
      this.textures();
      this.zone=scene.add.graphics().setPosition(0,0).setDepth(0);
      this.zone.fillStyle(0x00ffff,.12).fillCircle(0,0,400).lineStyle(3,0x00ffff,.8).strokeCircle(0,0,400);
      this.zonePulse=scene.add.graphics().setPosition(0,0).setDepth(0);
      this.zonePulse.lineStyle(2,0x00ffff,.6).strokeCircle(0,0,400);
      scene.tweens.add({targets:this.zonePulse,scale:1.08,alpha:.15,duration:1700,yoyo:true,repeat:-1});
      this.skull=scene.add.image(0,0,'pvp-skull').setDepth(18).setVisible(false);
      scene.tweens.add({targets:this.skull,alpha:.35,duration:500,yoyo:true,repeat:-1});
      this.banner=document.createElement('div'); this.banner.className='koth-banner'; this.banner.hidden=true;
      this.buff=document.createElement('div'); this.buff.className='pvp-buff'; this.buff.hidden=true;
      document.body.append(this.banner,this.buff);
      this.spark=scene.add.particles(0,0,'fleet-plasma',{emitting:false,lifespan:300,speed:{min:80,max:230},
        scale:{start:.45,end:0},alpha:{start:1,end:0},tint:0x00ffff,blendMode:'ADD',maxParticles:96}).setDepth(15);
      const on=(event,fn) => { const handler=d => { if(event==='welcome'||event==='disconnect'||d?.roomId===C.room?.roomId) fn(d); }; this.handlers[event]=handler; C.socket.on(event,handler); };
      on('welcome',()=>this.reset()); on('disconnect',()=>this.reset());
      on('NEMESIS_ASSIGNED',d=>scene._retention?.notify(`☠ NEMESIS: ${d.username}`,6000));
      on('NEMESIS_DESTROYED',d=>scene._retention?.notify(`${d.killerName} DESTROYED ${d.victimName} · REVENGE!`,6000));
      on('KOTH_LEADER_UPDATE',d=>this.leader=d.socketId ? d:null);
      on('POD_DESTROYED',d=>{ this.removePod(d.id); if(d.buffType) scene._retention?.notify(`${d.killerName} CLAIMED ${d.buffType.replaceAll('_',' ')}!`,6000); });
      on('PARRY_REFLECTED',d=>this.reflect(d));
      scene.events.once('shutdown',()=>this.destroy());
    }
    textures() {
      const make=(key,size,draw)=>{ if(this.scene.textures.exists(key))return; const g=this.scene.make.graphics({x:0,y:0},false); draw(g,size/2);g.generateTexture(key,size,size);g.destroy(); };
      make('pvp-skull',32,(g,c)=>{g.fillStyle(0xff4568).fillCircle(c,12,10).fillRect(10,15,12,12);g.fillStyle(0x050915).fillCircle(12,11,3).fillCircle(20,11,3).fillTriangle(16,15,13,20,19,20);g.lineStyle(2,0xff4568).lineBetween(5,27,27,5).lineBetween(5,5,27,27);});
      make('supply-pod',80,(g,c)=>{g.fillStyle(0x00ffff,.12).fillCircle(c,c,39);g.fillStyle(0x101c35).fillRoundedRect(15,15,50,50,7);g.lineStyle(3,0x00ffff).strokeRoundedRect(15,15,50,50,7);g.fillStyle(0xffd454).fillRect(34,21,12,38).fillRect(21,34,38,12);});
    }
    snapshot(snap) {
      this.data=snap.competitive || {pods:[],leader:null}; this.leader=this.data.leader;
    }
    arrow(id,target,label,color) {
      let node=this.arrows.get(id); if(!node){node=document.createElement('div');node.className='world-indicator';node.append(document.createElement('span'),document.createElement('small'));document.body.append(node);this.arrows.set(id,node);}
      const cam=this.scene.cameras.main,w=this.scene.scale.width,h=this.scene.scale.height;
      const x=(target.x-cam.scrollX)*cam.zoom,y=(target.y-cam.scrollY)*cam.zoom;
      const dx=x-w/2,dy=y-h/2,f=Math.min((w/2-65)/Math.max(1,Math.abs(dx)),(h/2-75)/Math.max(1,Math.abs(dy)));
      node.hidden=f>=1||this.C.dead||this.C.menuOpen;
      node.style.left=`${w/2+dx*f}px`;node.style.top=`${h/2+dy*f}px`;node.style.color=color;
      node.firstChild.textContent='➤';node.firstChild.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;
      const me=this.C.renderState.get(this.C.myId);
      node.lastChild.textContent=`${label} · ${Math.floor(Math.hypot(target.x-(me?.x||0),target.y-(me?.y||0))/10)} m`;
    }
    reflect(d) {
      const now=performance.now();
      if(!this.scene._effectVisible(d.x,d.y)||now-(this.lastReflectFX||-Infinity)<40)return;
      this.lastReflectFX=now;
      this.spark.emitParticleAt(d.x,d.y,18);this.scene._features.ring(d.x,d.y,75,0x00ffff,300);
      const f=this.scene._features;
      if(f.muted||this.scene.sound?.mute||global.AdManager?.busy||this.voices>=4)return;
      try {
        const Audio=global.AudioContext||global.webkitAudioContext;if(!Audio)return;f.audio ||= new Audio();const c=f.audio;c.resume().catch(()=>{});
        const o=c.createOscillator(),gain=c.createGain();this.voices=(this.voices||0)+1;o.type='square';o.frequency.setValueAtTime(1100,c.currentTime);o.frequency.exponentialRampToValueAtTime(220,c.currentTime+.12);
        gain.gain.setValueAtTime(.025,c.currentTime);gain.gain.exponentialRampToValueAtTime(.001,c.currentTime+.12);o.connect(gain);gain.connect(c.destination);o.start();o.stop(c.currentTime+.13);o.onended=()=>{this.voices--;o.disconnect();gain.disconnect();};
      }catch{/* El audio no participa en la simulación. */}
    }
    update(now) {
      const C=this.C,me=C.playerStates.get(C.myId); const active=C.joined&&!C.dead&&!C.menuOpen;
      this.zone.setVisible(active);this.zonePulse.setVisible(active);
      const nemesis=me?.nemesisId&&C.playerStates.get(me.nemesisId);const pos=nemesis?.hp>0&&C.renderState.get(nemesis.id);
      this.skull.setVisible(!!pos&&active&&this.scene._effectVisible(pos.x,pos.y,0));
      if(pos&&active){this.skull.setPosition(pos.x,pos.y-40);this.arrow('nemesis',pos,`NEMESIS ${nemesis.name}`,'#ff4568');}else this.removeArrow('nemesis');
      this.banner.hidden=!active;this.banner.textContent=this.leader?`ZONE KING: ${this.leader.username} (${this.leader.time}s)`:'ZONE KING: —';
      this.buff.hidden=!active||!me?.supplyBuff;this.buff.textContent=me?.supplyBuff?`${me.supplyBuff.replaceAll('_',' ')} · ${Math.ceil(me.supplyRemaining/1000)}s`:'';
      const seen=new Set();
      for(const [id,x,y,hp,max] of this.data?.pods||[]) {
        seen.add(id);let pod=this.pods.get(id);
        if(!pod){const image=this.scene.add.image(x,y,'supply-pod').setDepth(4);const bar=this.scene.add.graphics().setDepth(5);pod={image,bar};this.pods.set(id,pod);}
        pod.image.setPosition(x,y).setScale(1+Math.sin(now/200)*.04).setVisible(active&&this.scene._effectVisible(x,y));
        pod.bar.clear().setPosition(x,y-48).setVisible(pod.image.visible);pod.bar.fillStyle(0x102239).fillRect(-32,0,64,6).fillStyle(0x00ffff).fillRect(-32,0,64*Math.max(0,hp/max),6);
        this.arrow(id,{x,y},`SUPPLY ${Math.ceil(hp)} HP`,'#00ffff');
      }
      for(const id of this.pods.keys())if(!seen.has(id))this.removePod(id);
    }
    removeArrow(id){this.arrows.get(id)?.remove();this.arrows.delete(id);}
    removePod(id){const p=this.pods.get(id);p?.image.destroy();p?.bar.destroy();this.pods.delete(id);this.removeArrow(id);}
    reset(){this.data=null;this.leader=null;this.skull.setVisible(false);this.banner.hidden=this.buff.hidden=true;this.zone.setVisible(false);this.zonePulse.setVisible(false);for(const id of this.pods.keys())this.removePod(id);for(const id of this.arrows.keys())this.removeArrow(id);}
    destroy(){this.reset();for(const [name,fn]of Object.entries(this.handlers))this.C.socket.off(name,fn);for(const obj of [this.zone,this.zonePulse,this.skull,this.spark]){this.scene.tweens.killTweensOf(obj);obj.destroy();}this.banner.remove();this.buff.remove();}
  }
  global.FleetCompetitive={Competitive};
})(window);
