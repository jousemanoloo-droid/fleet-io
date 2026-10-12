// UI de escena: el cliente presenta el inventario confirmado por Node.
(function(global){
  'use strict';
  const R=global.FleetExtractionRules,I=global.FleetI18n,M=I.m;
  class StashUI {
    constructor(scene,C,track) {
      this.scene=scene;this.C=C;this.track=track;this.socket=C.socket;
      this.economy=scene._features.economy;this.items={};this.used=0;this.capacity=R.CAPACITIES.starter;
      this.life=-1;this.revision=-1;this.motion=-1;this.lost={};this.sprites=new Map();this.free=[];this.pool=[];
      this.opened=false;this.pending=false;this.destroyed=false;
      this.menuButton=this.button(M('extraction.menu'),()=>this.open());
      document.getElementById('singleplayer-btn')?.after(this.menuButton);
      this.menuWarning=document.createElement('p');this.menuWarning.className='stash-warning';this.menuButton.after(this.menuWarning);
      this.cargoHUD=global.FleetCargoHUD?new global.FleetCargoHUD():null;
      this.hud=this.cargoHUD?.element || document.createElement('div');
      if(!this.cargoHUD){this.hud.className='cargo-hud';document.body.append(this.hud);}
      global.FleetCargoHUD?.generateTextures(scene);
      this.loss=document.createElement('p');this.loss.className='cargo-loss';
      document.getElementById('death-summary')?.after(this.loss);
      // Estas suscripciones son del HUD de la escena, no del modal.
      this.handlers={
        'inventory:update':data=>this.receive(data),
        'player:wipe-inventory':data=>this.receive(data,true),
        welcome:()=>this.reset(),disconnect:()=>this.reset(),
      };
      for(const [name,fn]of Object.entries(this.handlers))this.socket.on(name,fn);
      this.locale=I.subscribe(()=>{this.renderHUD();if(this.opened)this.render();});
      this.cleanUntrustedCache();this.renderHUD();this.refreshMenu();
      scene.events.once('shutdown',()=>this.destroy());
    }
    cleanUntrustedCache() {
      // Un guardado local no acredita propiedad. Se retira incluso si parece válido.
      try {
        const value=this.economy.storage?.getItem('fleet_io_stash');
        if(value!==null && value!==undefined){
          if(value.length<=8192)try{R.validateStash(JSON.parse(value));}catch{}
          this.economy.storage?.removeItem('fleet_io_stash');
        }
      }catch{ /* Un iframe sin almacenamiento sigue funcionando con datos del socket. */ }
    }
    button(label,action) {
      const button=document.createElement('button');button.className='feature-button';button.type='button';
      I.render(button,label);button.onclick=action;return button;
    }
    reset() {
      this.life=this.revision=this.motion=-1;this.items={};this.used=0;this.lost={};
      this.close(false);this.releaseAll();this.renderHUD();
    }
    receive(data,wiped=false) {
      if(this.destroyed || data?.roomId!==this.C.room?.roomId || data.playerId!==this.C.myId ||
        !Number.isSafeInteger(data.deathId) || !Number.isSafeInteger(data.revision) || data.revision<0 ||
        !Number.isSafeInteger(data.motionRevision) || !Object.values(R.CAPACITIES).includes(data.capacity))return;
      const me=this.C.playerStates.get(this.C.myId);
      if(data.deathId<(me?.deathId ?? -1) || data.deathId<this.life ||
        data.deathId===this.life && (data.revision<this.revision || data.motionRevision<this.motion))return;
      const valid=R.validateItems(data.items,data.capacity),lost=wiped?R.validateItems(data.lost,R.MAX_STASH):null;
      if(!valid || data.used!==valid.used || wiped && !lost)return;
      this.life=data.deathId;this.motion=data.motionRevision;this.revision=data.revision;
      this.items=valid.items;this.used=valid.used;this.capacity=data.capacity;
      if(wiped){this.lost=lost.items;this.close(false);global.AdManager?.gameplayStop?.();}
      else if(me?.hp>0 || !this.C.dead)this.lost={};
      this.renderHUD();
      if(this.opened)this.render();
    }
    renderHUD() {
      if(this.cargoHUD)this.cargoHUD.update(this.used,this.capacity,this.C.joined && !this.C.dead);
      else I.render(this.hud,M('extraction.cargo',{used:this.used,capacity:this.capacity}));
      this.hud.hidden=!this.C.joined || this.C.dead;
      const parts=Object.entries(this.lost).map(([id,count])=>count+' '+I.t('extraction.resource.'+id));
      I.render(this.loss,parts.length?M('extraction.lost',{items:parts.join(', ')}):'');
    }
    refreshMenu() {
      const stash=R.validateStash(this.economy.state.secureStash);
      this.menuWarning.hidden=!this.economy.accountReady || !stash || R.weight(stash.items)<stash.capacity;
      I.render(this.menuWarning,M('extraction.fullStart'));
    }
    open() {
      if(this.destroyed || global.AdManager?.busy || this.C.mutationsOpen || this.C.evolutionPaused)return;
      if(this.opened)return;
      this.opened=true;this.focus=document.activeElement;
      this.modal=document.createElement('div');this.modal.className='feature-modal stash-modal';
      this.modal.setAttribute('role','dialog');this.modal.setAttribute('aria-modal','true');I.render(this.modal,M('extraction.menu'),'@aria-label');
      this.panel=document.createElement('div');this.panel.className='feature-panel stash-panel';this.modal.append(this.panel);document.body.append(this.modal);
      // El listener de cuenta y Escape existen solamente mientras el modal esté abierto.
      this.accountChanged=()=>{if(!this.destroyed && this.opened)this.render();};
      this.socket.on('accountState',this.accountChanged);
      this.escape=event=>{if(event.key==='Escape')this.close();};document.addEventListener('keydown',this.escape);
      this.render();this.track();this.panel.querySelector('button')?.focus();
      // Refrescar también si otra pestaña ha extraído usando el mismo perfil.
      const generation=this.modalGeneration=(this.modalGeneration || 0)+1;
      this.economy.request('readStash').then(()=>{
        if(!this.destroyed && this.opened && generation===this.modalGeneration)this.render();
      }).catch(()=>{});
    }
    clear(node) {if(!node)return;for(const n of [node,...node.querySelectorAll('*')])I.unbind(n);node.replaceChildren();}
    render() {
      if(!this.opened || this.destroyed)return;
      this.clear(this.panel);
      const stash=R.validateStash(this.economy.state.secureStash),ready=this.economy.accountReady && !!stash;
      const title=document.createElement('h2');I.render(title,M('extraction.menu'));this.panel.append(title);
      const description=document.createElement('p');I.render(description,M('extraction.explain'));this.panel.append(description);
      if(ready){
        const used=R.weight(stash.items),capacity=document.createElement('p');
        I.render(capacity,M('extraction.space',{used,capacity:stash.capacity,free:stash.capacity-used}));this.panel.append(capacity);
        const grid=document.createElement('div');grid.className='stash-grid';
        for(const [id,rule]of Object.entries(R.RESOURCES)){
          const card=document.createElement('div');card.className='stash-resource';
          const icon=document.createElement('span');icon.className='stash-icon';icon.textContent=rule.icon;icon.style.color='#'+rule.color.toString(16).padStart(6,'0');
          const name=document.createElement('strong');I.render(name,M('extraction.resource.'+id));
          const count=document.createElement('span');count.textContent=String(stash.items[id] || 0);
          const weight=document.createElement('small');I.render(weight,M('extraction.weight',{weight:rule.weight}));
          const value=document.createElement('small');I.render(value,M('cargo.value',{credits:rule.baseCredits,rarity:M('cargo.rarity.'+rule.rarity)}));
          const quantity=stash.items[id] || 0;
          const sell=this.button(M('cargo.sell',{quantity,credits:quantity*rule.baseCredits}),async()=>{
            if(this.pending)return;this.pending=true;sell.disabled=true;
            try{const result=await this.economy.request('sellResource',{resource:id,quantity});this.message=M(result?.ok?'cargo.sold':'extraction.failed',result?.ok?{credits:result.credits}:{});}
            catch{this.message=M('extraction.failed');}
            finally{this.pending=false;if(!this.destroyed && this.opened)this.render();}
          });sell.disabled=this.pending || !quantity || !this.economy.persistent;
          card.append(icon,name,count,weight,value,sell);grid.append(card);
        }
        this.panel.append(grid);
        const notice=document.createElement('p');notice.className='stash-warning';
        I.render(notice,used>=stash.capacity?M('extraction.full'):this.used>this.capacity?M('extraction.overload'):M('extraction.runEmpty'));
        this.panel.append(notice);
        const price=R.upgradeCost(stash);
        const upgrade=this.button(M('extraction.upgrade',{capacity:R.STASH_STEP,credits:price}),async()=>{
          if(this.pending)return;this.pending=true;upgrade.disabled=true;
          try {const result=await this.economy.request('upgradeStash');this.message=M(result?.ok?'extraction.upgraded':'extraction.failed');}
          catch{this.message=M('extraction.failed');}
          finally{this.pending=false;if(!this.destroyed && this.opened)this.render();}
        });
        upgrade.disabled=this.pending || stash.capacity>=R.MAX_STASH || this.economy.state.coins<price;this.panel.append(upgrade);
      }else {const waiting=document.createElement('p');I.render(waiting,M('extraction.wait'));this.panel.append(waiting);}
      if(!this.economy.persistent){const n=document.createElement('p');I.render(n,M('extraction.persistence'));this.panel.append(n);}
      const status=document.createElement('p');I.render(status,this.message || '');this.panel.append(status);
      this.panel.append(this.button(M('continue'),()=>this.close()));
    }
    close(track=true) {
      if(!this.opened)return;
      this.opened=false;this.socket.off('accountState',this.accountChanged);document.removeEventListener('keydown',this.escape);
      this.clear(this.panel);I.unbind(this.modal);this.modal.remove();this.modal=this.panel=null;
      this.accountChanged=this.escape=null;
      if(track)this.track();if(this.focus?.isConnected)this.focus.focus();this.focus=null;
    }
    snapshot(snap) {
      // Un pool acotado comparte la textura de plasma existente, sin cuerpos físicos.
      const present=new Set(),validRows=[];
      const resources=Array.isArray(snap.resources) && snap.resources.length<=128?snap.resources:[];
      for(const row of resources){
        if(!Array.isArray(row))continue;
        const [id,x,y,type]=row;
        if(typeof id!=='string' || !Number.isFinite(x) || !Number.isFinite(y) || typeof type!=='string' || !Object.hasOwn(R.RESOURCES,type))continue;
        present.add(id);validRows.push(row);
      }
      // Liberar los IDs retirados ANTES de adquirir otros: evita un frame vacío
      // cuando cambia toda la región y el pool está al límite de capacidad.
      for(const [id,image]of this.sprites)if(!present.has(id)){image.setVisible(false);this.sprites.delete(id);this.free.push(image);}
      for(const [id,x,y,type]of validRows){
        let image=this.sprites.get(id);
        if(!image){
          image=this.free.pop();
          if(!image && this.pool.length<128){image=this.scene.add.image(0,0,'fleet-plasma').setDepth(6).setScale(1.5);this.pool.push(image);}
          if(!image)continue;this.sprites.set(id,image);
        }
        const key='fleet-resource-'+type,custom=this.scene.textures?.exists?.(key);
        image.setTexture?.(custom?key:'fleet-plasma');
        image.setPosition(x,y-6).setTint(custom?0xffffff:R.RESOURCES[type].color).setVisible(true);
        image.setScale(R.RESOURCES[type].rarity==='legendary'?1.15:0.85);
      }
      this.hud.hidden=!this.C.joined || this.C.dead;
    }
    releaseAll() {for(const image of this.sprites.values()){image.setVisible(false);this.free.push(image);}this.sprites.clear();}
    destroy() {
      if(this.destroyed)return;this.destroyed=true;this.close(false);
      for(const [name,fn]of Object.entries(this.handlers))this.socket.off(name,fn);this.locale();
      for(const image of this.pool)image.destroy();this.pool.length=this.free.length=0;this.sprites.clear();
      this.cargoHUD?.destroy();
      for(const node of [this.menuButton,this.menuWarning,...(this.cargoHUD?[]:[this.hud]),this.loss]){I.unbind(node);node.remove();}
    }
  }
  global.FleetStashUI=StashUI;
})(window);
