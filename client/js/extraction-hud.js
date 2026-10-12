// Presentation only: time, eligibility, damage and the durable reward belong to Node.
(function(global){
  'use strict';
  const I=global.FleetI18n,M=I.m;
  class ExtractionHUD {
    constructor(scene,C) {
      this.scene=scene;this.C=C;this.socket=C.socket;this.gates=new Map();this.visuals=new Map();this.pool=[];
      this.revision=-1;this.channel=null;this.lastRender=-Infinity;this.destroyed=false;
      this.hud=document.createElement('div');this.hud.className='extraction-hud';this.hud.hidden=true;
      this.notice=document.createElement('p');this.radar=document.createElement('div');this.label=document.createElement('p');
      this.bar=document.createElement('progress');this.bar.max=1;this.bar.value=0;
      this.hud.append(this.notice,this.radar,this.label,this.bar);document.body.append(this.hud);
      this.modal=document.createElement('div');this.modal.className='feature-modal extraction-victory hidden';
      this.modal.setAttribute('role','dialog');this.modal.setAttribute('aria-modal','true');
      const panel=document.createElement('div');panel.className='feature-panel';this.title=document.createElement('h2');
      this.loot=document.createElement('p');this.closeButton=document.createElement('button');this.closeButton.className='feature-button';
      this.closeButton.type='button';this.closeButton.onclick=()=>this.close();
      panel.append(this.title,this.loot,this.closeButton);this.modal.append(panel);document.body.append(this.modal);
      I.render(this.title,M('exit.success'));I.render(this.closeButton,M('exit.menu'));
      this.particles=scene.add.particles(0,0,'fleet-plasma',{emitting:false,lifespan:650,speed:{min:8,max:30},maxAliveParticles:48,
        tint:0x40ffda,scale:{start:.45,end:0},alpha:{start:.65,end:0}}).setDepth(3);
      this.handlers={welcome:()=>this.reset(),disconnect:()=>this.reset(),
        'extraction:gates':data=>this.receiveGates(data),
        'extraction:opened':data=>{if(data?.roomId===C.room?.roomId && Number.isFinite(data.x) && Number.isFinite(data.y))this.alert(M('exit.opened',{x:data.x,y:data.y}));},
        'extraction:progress':data=>this.progress(data),'extraction:cancelled':data=>this.cancel(data),
        'extraction:success':data=>this.success(data)};
      for(const [event,fn]of Object.entries(this.handlers))this.socket.on(event,fn);
      this.locale=I.subscribe(()=>{this.lastRender=-Infinity;this.renderLoot();});
      scene.events.once('shutdown',()=>this.destroy());
    }
    accept(data) {
      const me=this.C.playerStates.get(this.C.myId);
      if(this.destroyed || !this.C.joined || data?.roomId!==this.C.room?.roomId || data.playerId!==this.C.myId ||
        data.deathId!==me?.deathId || data.motionRevision!==(me?.motionRevision || 0) ||
        !Number.isSafeInteger(data.revision) || data.revision<=this.revision)return false;
      this.revision=data.revision;return true;
    }
    receiveGates(data) {
      if(this.destroyed || data?.roomId!==this.C.room?.roomId || !Array.isArray(data.gates) || data.gates.length>2)return;
      const now=performance.now(),next=new Map();
      for(const g of data.gates){
        if(typeof g?.id!=='string' || g.id.length>48 || ![g.x,g.y,g.radius,g.remaining].every(Number.isFinite) ||
          g.x<0 || g.x>this.C.world.width || g.y<0 || g.y>this.C.world.height || g.radius!==120 || g.remaining<0 || g.remaining>45000)return;
        next.set(g.id,{...g,expires:now+g.remaining});
      }
      this.gates=next;
      for(const [id,v]of this.visuals)if(!next.has(id)){v.setVisible(false);this.visuals.delete(id);this.pool.push(v);}
      for(const g of next.values())if(!this.visuals.has(g.id)){
        const v=this.pool.pop() || this.scene.add.graphics().setDepth(2);
        v.clear().fillStyle(0x40ffda,.08).fillCircle(0,0,g.radius).lineStyle(3,0x40ffda,.8).strokeCircle(0,0,g.radius)
          .lineStyle(2,0x9988ff,.8).arc(0,0,80,0,Math.PI*1.65).strokePath();
        v.setPosition(g.x,g.y);this.visuals.set(g.id,v);
      }
    }
    alert(message){I.render(this.notice,message);this.noticeUntil=performance.now()+6000;}
    progress(data) {
      if(![3000,4000].includes(data?.duration) || !Number.isFinite(data.elapsed) || data.elapsed<0 || data.elapsed>data.duration || !this.accept(data))return;
      this.channel={...data,received:performance.now()};
    }
    cancel(data) {
      if(!this.accept(data))return;this.channel=null;
      const reason=['damage','left','state','interrupted','extraction.empty','extraction.stashFull','extraction.persistence'].includes(data.reason)?data.reason:'state';
      this.alert(M('exit.cancel.'+reason));this.hud.classList.add('extraction-cancelled');this.cancelUntil=performance.now()+1800;
    }
    success(data) {
      const valid=global.FleetExtractionRules.validateItems(data?.extracted,120);
      if(!valid || !valid.used || !this.accept(data))return;
      this.extracted=valid.items;
      const pos=this.C.renderState.get(this.C.myId);if(pos)this.particles.emitParticleAt(pos.x,pos.y,40);
      this.scene._finishExtraction();this.channel=null;this.hud.hidden=true;
      this.modal.classList.remove('hidden');this.renderLoot();this.closeButton.focus();
    }
    renderLoot(){if(this.extracted)I.render(this.loot,Object.entries(this.extracted).map(([id,n])=>n+' '+I.t('extraction.resource.'+id)).join(' · '));}
    close(){this.modal.classList.add('hidden');this.extracted=null;}
    update(now) {
      for(const [id,v]of this.visuals){
        const g=this.gates.get(id);v.setVisible(this.C.joined && now<g.expires && this.scene._effectVisible(g.x,g.y,g.radius));
        v.rotation=now/1400;v.setAlpha(.75+Math.sin(now/300)*.2);
        if(v.visible && now-(v._emitAt || 0)>100){v._emitAt=now;this.particles.emitParticleAt(g.x+Math.cos(now/300)*85,g.y+Math.sin(now/300)*85,1);}
      }
      if(now-this.lastRender<100)return;this.lastRender=now;
      this.notice.hidden=now>=(this.noticeUntil || 0);
      this.hud.hidden=!this.C.joined || this.C.dead || !this.gates.size && !this.channel && this.notice.hidden;
      if(now>=(this.cancelUntil || 0))this.hud.classList.remove('extraction-cancelled');
      if(this.C.dead || !this.C.joined)this.channel=null;
      const me=this.C.renderState.get(this.C.myId),camera=this.scene.cameras.main;
      const lines=[];
      for(const g of this.gates.values())if(me && now<g.expires){
        const onScreen=camera.worldView.contains(g.x,g.y),angle=Math.atan2(g.y-me.y,g.x-me.x);
        const arrow=onScreen?'◎':['→','↘','↓','↙','←','↖','↑','↗'][(Math.round(angle/(Math.PI/4))+8)%8];
        lines.push(arrow+' '+I.t('exit.radar',{distance:Math.round(Math.hypot(g.x-me.x,g.y-me.y)),seconds:Math.ceil((g.expires-now)/1000)}));
      }
      I.render(this.radar,lines.join(' · '));this.label.hidden=this.bar.hidden=!this.channel;
      if(this.channel){
        // Never display completion before the server's success event.
        const duration=this.channel.duration,elapsed=Math.min(duration-50,this.channel.elapsed+Math.min(250,Math.max(0,now-this.channel.received)));
        this.bar.value=elapsed/duration;I.render(this.label,M('exit.progress',{seconds:Math.max(1,Math.ceil((duration-elapsed)/1000))}));
      }
    }
    reset(){this.channel=null;this.revision=-1;this.gates.clear();for(const v of this.visuals.values()){v.setVisible(false);this.pool.push(v);}this.visuals.clear();this.hud.hidden=true;this.noticeUntil=0;this.particles.killAll();this.close();}
    destroy(){
      if(this.destroyed)return;this.reset();this.destroyed=true;
      for(const [event,fn]of Object.entries(this.handlers))this.socket.off(event,fn);this.locale();
      for(const v of this.pool)v.destroy();this.pool=[];this.particles.destroy();this.closeButton.onclick=null;
      for(const n of [this.notice,this.radar,this.label,this.title,this.loot,this.closeButton])I.unbind(n);
      this.hud.remove();this.modal.remove();
    }
  }
  global.FleetExtractionHUD=ExtractionHUD;
})(window);
