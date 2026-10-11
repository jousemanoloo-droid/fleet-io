// Presentación de peligros: pools acotados; nunca modifica daño ni velocidades.
(function(global){
  'use strict';
  class Hazards {
    constructor(scene,C){
      this.scene=scene;this.C=C;this.data={wormholePairs:[],supernova:null};this.handlers={};
      this.plasmaGlow=new Map();this.portals=new Map();this.trails=new Map();this.fxSeen=new Set();this.lastRing=this.lastTrail=0;
      this.textures();
      this.rings=scene.add.particles(0,0,'fleet-plasma',{emitting:false,lifespan:500,speed:{min:5,max:30},
        scale:{start:.32,end:0},alpha:{start:.8,end:0},tint:0xa96dff,blendMode:'ADD',maxParticles:160}).setDepth(2);
      this.trail=scene.add.particles(0,0,'fleet-plasma',{emitting:false,lifespan:200,speed:{min:10,max:60},
        scale:{start:.5,end:0},alpha:{start:1,end:0},tint:0x88faff,blendMode:'ADD',maxParticles:240}).setDepth(9);
      this.wave=scene.add.graphics().setDepth(14).setVisible(false);
      this.warning=scene.add.graphics().setDepth(0).setVisible(false);
      this.dark=Array.from({length:48},()=>scene.add.image(0,0,'xp-gem').setTint(0x8954df).setScale(.5).setDepth(1).setVisible(false));
      this.chain=document.createElement('div');this.chain.className='kill-chain';this.chain.hidden=true;document.body.append(this.chain);
      const on=(event,fn)=>{const h=d=>{if(event==='welcome'||event==='disconnect'||d?.roomId===C.room?.roomId)fn(d);};this.handlers[event]=h;C.socket.on(event,h);};
      on('welcome',()=>this.reset());on('disconnect',()=>this.reset());
      on('WORMHOLE_TRAVERSE',d=>this.traverse(d));
      on('SUPERNOVA_WARN',()=>scene._retention?.notify('SUPERNOVA · COLAPSO EN 5 s',5000,2));
      on('SUPERNOVA_ACTIVE',()=>scene._retention?.notify('SUPERNOVA · EVITA EL NÚCLEO',4000));
      on('PLASMA_EXPLOSION',d=>this.explosion(d));
      on('COMBO_UPDATE',d=>this.combo(d));
      scene.events.once('shutdown',()=>this.destroy());
    }
    textures(){
      if(!this.scene.textures.exists('plasma-rock-glow')){
        const glow=this.scene.make.graphics({x:0,y:0},false);
        glow.fillStyle(0xff2345,.08).fillCircle(40,40,39).lineStyle(3,0xff3554,.8).strokeCircle(40,40,32);
        glow.lineStyle(1,0xffb3c2,.7).strokeCircle(40,40,28);glow.generateTexture('plasma-rock-glow',80,80);glow.destroy();
      }
      if(this.scene.textures.exists('wormhole-spiral'))return;
      const g=this.scene.make.graphics({x:0,y:0},false);
      g.fillStyle(0x6535ac,.12).fillCircle(64,64,63).fillStyle(0x050818).fillCircle(64,64,43);
      for(let arm=0;arm<3;arm++){
        const points=[];for(let i=0;i<=50;i++){const a=i/50*Math.PI*3+arm*Math.PI*2/3,r=8+i;points.push({x:64+Math.cos(a)*r,y:64+Math.sin(a)*r});}
        g.lineStyle(3,arm===0?0x99eeff:0xb07aff,.85).strokePoints(points,false);
      }
      g.lineStyle(2,0x9578ff,.7).strokeCircle(64,64,60);g.generateTexture('wormhole-spiral',128,128);g.destroy();
    }
    snapshot(snap){this.data=snap.hazards||{wormholePairs:[],supernova:null};this.receivedAt=performance.now();}
    traverse(d){
      const now=performance.now(),key=`${d.entityType}:${d.entityId}`;
      if(this.trails.size>=32&&!this.trails.has(key))this.trails.delete(this.trails.keys().next().value);
      this.trails.set(key,{id:d.entityId,type:d.entityType,until:now+1000,x:d.targetX,y:d.targetY});
      if(d.entityType==='player'&&d.player){
        const prev=this.C.playerStates.get(d.entityId);
        if((d.motionRevision||0)<(prev?.motionRevision||0)||d.player.deathId!==prev?.deathId)return;
        this.C.playerStates.set(d.entityId,d.player);
        const pos={...d.player,drones:[...(d.player.drones||[]),...(d.player.orbitalDrones||[]),...(d.player.tacticalDrones||[])],t:now,motionRevision:d.motionRevision};
        this.C._prevStates?.set(d.entityId,[pos]);this.C.renderState.set(d.entityId,{...pos});
        if(d.entityId===this.C.myId){
          this.scene._prediction?.reset(d.player);this.C.targetWorld.x=d.targetX;this.C.targetWorld.y=d.targetY;
          const sprite=this.scene._playerSprites.get(d.entityId);sprite?.setPosition(d.targetX,d.targetY);
          this.scene.cameras.main.centerOn(d.targetX,d.targetY);
        }
      }else if(d.entityType==='bullet'){
        const queue=this.scene._projectileStates.get(d.entityId),last=queue?.at(-1);
        if(last&&(d.motionRevision||0)>=(last.motionRevision||0))this.scene._projectileStates.set(d.entityId,[{...last,x:d.targetX,y:d.targetY,t:now,motionRevision:d.motionRevision}]);
      }
    }
    combo(d){
      if(d.comboCount>(this.lastCombo||0)){
        this.chain.classList.remove('chain-bounce');void this.chain.offsetWidth;this.chain.classList.add('chain-bounce');
      }
      this.lastCombo=d.comboCount;
    }
    explosion(d){
      if(this.fxSeen.has(d.id))return;this.fxSeen.add(d.id);if(this.fxSeen.size>64)this.fxSeen.delete(this.fxSeen.values().next().value);
      const now=performance.now();if(!this.scene._effectVisible(d.x,d.y,300)||now-(this.lastBlast||-Infinity)<80)return;
      this.lastBlast=now;this.scene.tweens.killTweensOf(this.wave);
      this.wave.clear().lineStyle(5,0xff5a38,.9).strokeCircle(0,0,d.radius).setPosition(d.x,d.y).setScale(.05).setAlpha(1).setVisible(true);
      this.scene.tweens.add({targets:this.wave,scale:1,alpha:0,duration:550,onComplete:()=>this.wave.setVisible(false)});
      this.scene.cameras.main.flash(70,255,75,30);this.rings.emitParticleAt(d.x,d.y,18);this.explosionSound();
    }
    explosionSound(){
      const f=this.scene._features;if(f.muted||this.scene.sound?.mute||global.AdManager?.busy||(this.voices||0)>=2)return;
      try{const Audio=global.AudioContext||global.webkitAudioContext;if(!Audio)return;f.audio ||= new Audio();const c=f.audio;c.resume().catch(()=>{});
        const o=c.createOscillator(),gain=c.createGain();this.voices=(this.voices||0)+1;o.type='sawtooth';o.frequency.setValueAtTime(90,c.currentTime);o.frequency.exponentialRampToValueAtTime(25,c.currentTime+.35);
        gain.gain.setValueAtTime(.05,c.currentTime);gain.gain.exponentialRampToValueAtTime(.001,c.currentTime+.35);o.connect(gain);gain.connect(c.destination);o.start();o.stop(c.currentTime+.36);
        o.onended=()=>{this.voices--;o.disconnect();gain.disconnect();};
      }catch{/* El audio puede estar bloqueado por el navegador. */}
    }
    update(now){
      const active=this.C.joined&&!this.C.menuOpen&&!this.C.dead,seen=new Set();
      const rocks=new Set();
      for(const rock of this.scene._obstacles)if(rock.volatile){
        rocks.add(rock.id);let glow=this.plasmaGlow.get(rock.id);
        if(!glow){glow=this.scene.add.image(rock.x,rock.y,'plasma-rock-glow').setDepth(2);this.plasmaGlow.set(rock.id,glow);}
        glow.setPosition(rock.x,rock.y).setAlpha(.65+Math.sin(now/200)*.25).setVisible(active&&this.scene._effectVisible(rock.x,rock.y,60));
      }
      for(const [id,glow]of this.plasmaGlow)if(!rocks.has(id)){glow.destroy();this.plasmaGlow.delete(id);}
      for(const pair of this.data.wormholePairs||[])for(const [id,x,y]of [[pair.idA,pair.xA,pair.yA],[pair.idB,pair.xB,pair.yB]]){
        seen.add(id);let sprite=this.portals.get(id);if(!sprite){sprite=this.scene.add.image(x,y,'wormhole-spiral').setDepth(1);this.portals.set(id,sprite);}
        sprite.setVisible(active&&this.scene._effectVisible(x,y,90)).setRotation(now/600);
        if(sprite.visible&&now-this.lastRing>=70){const a=now/250+(id.endsWith('B')?Math.PI:0);this.rings.emitParticleAt(x+Math.cos(a)*60,y+Math.sin(a)*60,1);}
      }
      if(now-this.lastRing>=70)this.lastRing=now;
      for(const [id,sprite]of this.portals)if(!seen.has(id)){sprite.destroy();this.portals.delete(id);}
      for(const [key,t]of this.trails){
        const pos=t.type==='player'?this.C.renderState.get(t.id):this.scene._laserSprites.get(t.id);
        if(now>=t.until||(t.seen&&!pos)){this.trails.delete(key);continue;}
        if(pos)t.seen=true;
        if(pos&&active&&now-this.lastTrail>=30&&this.scene._effectVisible(pos.x,pos.y))this.trail.emitParticleAt(pos.x,pos.y,2);
      }
      if(now-this.lastTrail>=30)this.lastTrail=now;
      const nova=this.data.supernova,valid=nova&&nova.remaining-(now-this.receivedAt)>0;
      const visible=active&&valid&&this.scene._effectVisible(nova.x,nova.y,500);
      this.warning.setVisible(!!visible);
      if(visible){
        this.warning.setPosition(nova.x,nova.y);
        if(this.novaKey!==`${nova.started}:${nova.phase}`){
          this.novaKey=`${nova.started}:${nova.phase}`;this.scene.tweens.killTweensOf(this.warning);
          this.warning.clear().setPosition(nova.x,nova.y).setScale(1).setAlpha(.1);
          const color=nova.phase==='WARNING'?0xff3348:0x803cc7;
          this.warning.fillStyle(color,.5).fillCircle(0,0,500).lineStyle(4,color,.9).strokeCircle(0,0,500);
          if(nova.phase==='WARNING')this.scene.tweens.add({targets:this.warning,alpha:.5,duration:600,yoyo:true,repeat:-1});else this.warning.setAlpha(.35);
        }
      }else if(this.novaKey){this.scene.tweens.killTweensOf(this.warning);this.novaKey=null;}
      for(let i=0;i<this.dark.length;i++){
        const p=this.dark[i];p.setVisible(!!visible&&nova.phase==='ACTIVE');if(!p.visible)continue;
        const t=(now/1100+i/this.dark.length)%1,r=500*(1-t),a=i*2.39996+t*1.5;
        p.setPosition(nova.x+Math.cos(a)*r,nova.y+Math.sin(a)*r).setAlpha(Math.sin(t*Math.PI)).setRotation(a);
      }
      const me=this.C.playerStates.get(this.C.myId),count=me?.comboCount||0;
      this.combo({comboCount:count});this.chain.hidden=!active||!count;this.chain.textContent=`KILL CHAIN x${count}!`;
    }
    reset(){
      this.data={wormholePairs:[],supernova:null};this.trails.clear();this.fxSeen.clear();this.lastCombo=0;this.chain.hidden=true;
      for(const glow of this.plasmaGlow.values())glow.destroy();this.plasmaGlow.clear();
      this.scene.tweens.killTweensOf(this.wave);this.scene.tweens.killTweensOf(this.warning);this.wave.setVisible(false);this.warning.setVisible(false);this.novaKey=null;
      for(const sprite of this.portals.values())sprite.destroy();this.portals.clear();for(const p of this.dark)p.setVisible(false);
      this.rings.killAll();this.trail.killAll();
    }
    destroy(){this.reset();for(const [event,h]of Object.entries(this.handlers))this.C.socket.off(event,h);for(const obj of [this.wave,this.warning,this.rings,this.trail,...this.dark])obj.destroy();this.chain.remove();}
  }
  global.FleetHazards={Hazards};
})(window);
