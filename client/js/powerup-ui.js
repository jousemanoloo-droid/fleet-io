// Bounded pools for local AOI orbs/zones. No client collisions or damage.
(function(global) {
  'use strict';
  const I=global.FleetI18n,M=I.m,COLORS={SHIELD:0x20dfff,OVERCLOCK:0x00ff88,TRIPLE:0xff40c0};
  class PowerupUI {
    constructor(scene,state) {
      this.scene=scene;this.C=state;this.orbs=new Map();this.zones=new Map();this.orbPool=[];this.zonePool=[];
      this.packet={powerups:[],environment:[]};this.lastHUD=0;
      this.ring=scene.add.particles(0,0,'fleet-plasma',{emitting:false,lifespan:600,speed:{min:20,max:50},maxAliveParticles:48,scale:{start:.4,end:0},alpha:{start:.6,end:0}});
      this.hud=document.createElement('div');this.hud.className='powerup-hud';this.hud.hidden=true;document.body.append(this.hud);
      this.labels={};for(const type of Object.keys(COLORS)) {const n=document.createElement('span');this.labels[type]=n;this.hud.append(n);}
      this.handlers={welcome:()=>this.reset(),disconnect:()=>this.reset()};
      for(const [event,handler] of Object.entries(this.handlers)) state.socket.on(event,handler);
      scene.events.once('shutdown',()=>this.destroy());
    }
    snapshot(packet) {this.packet={powerups:packet.powerups || [],environment:packet.environment || []};}
    update(now,delta=16) {
      const seen=new Set();
      for(const [id,x,y,type] of this.packet.powerups.slice(0,24)) {
        seen.add(id);let image=this.orbs.get(id);
        if(!image) {image=this.orbPool.pop() || this.scene.add.image(x,y,'energy-core').setDepth(4).setScale(.8);this.orbs.set(id,image);image.setPosition(x,y);}
        const lerp=1-Math.exp(-Math.min(delta,100)/60);
        image.x+=(x-image.x)*lerp;image.y+=(y+Math.sin(now/250)*5-image.y)*lerp;
        image.setTint(COLORS[type] || 0xffffff).setVisible(this.scene._effectVisible(image.x,image.y,40));image.rotation=now/700;
      }
      for(const [id,image] of this.orbs) if(!seen.has(id)) {image.setVisible(false);this.orbs.delete(id);this.orbPool.push(image);}
      seen.clear();
      for(const [id,x,y,radius,type] of this.packet.environment.slice(0,3)) {
        seen.add(id);let zone=this.zones.get(id);
        if(!zone) {
          zone=this.zonePool.pop() || this.scene.add.graphics().setDepth(-3);zone.clear();
          const color=type==='BLACK_HOLE'?0x9840ff:0xffaa30;
          zone.fillStyle(color,.08).fillCircle(0,0,radius).lineStyle(3,color,.65).strokeCircle(0,0,radius);
          if(type==='BLACK_HOLE') zone.fillStyle(0x030108,.95).fillCircle(0,0,75);
          zone.setPosition(x,y);this.zones.set(id,zone);
        }
        zone.setAlpha(.7+Math.sin(now/350)*.15).setVisible(this.scene._effectVisible(x,y,radius));
        if(zone.visible && now-(zone._emitAt || 0)>=100) {
          zone._emitAt=now;const angle=now/400;
          this.ring.setParticleTint(type==='BLACK_HOLE'?0x9840ff:0xffaa30).emitParticleAt(x+Math.cos(angle)*radius,y+Math.sin(angle)*radius,1);
        }
      }
      for(const [id,zone] of this.zones) if(!seen.has(id)) {zone.setVisible(false);this.zones.delete(id);this.zonePool.push(zone);}
      if(now-this.lastHUD<250)return;this.lastHUD=now;
      const me=this.C.playerStates.get(this.C.myId), fields={SHIELD:'powerShieldRemaining',OVERCLOCK:'powerOverclockRemaining',TRIPLE:'powerTripleRemaining'};
      this.hud.hidden=!me || this.C.dead || this.C.menuOpen;
      for(const [type,field] of Object.entries(fields)) {
        const seconds=Math.ceil((me?.[field] || 0)/1000),node=this.labels[type];node.hidden=!seconds;
        I.render(node,M('power.'+type,{seconds}));
      }
    }
    reset() {
      for(const image of this.orbs.values()) {image.setVisible(false);this.orbPool.push(image);}this.orbs.clear();
      for(const zone of this.zones.values()) {zone.setVisible(false);this.zonePool.push(zone);}this.zones.clear();
      this.packet={powerups:[],environment:[]};this.hud.hidden=true;
      this.ring.killAll();
    }
    destroy() {
      this.reset();for(const [event,handler] of Object.entries(this.handlers)) this.C.socket.off(event,handler);
      for(const obj of [...this.orbPool,...this.zonePool]) obj.destroy();this.orbPool=[];this.zonePool=[];
      this.ring.destroy();
      for(const node of Object.values(this.labels)) I.unbind(node);this.hud.remove();
    }
  }
  global.FleetPowerupUI=PowerupUI;
})(window);
