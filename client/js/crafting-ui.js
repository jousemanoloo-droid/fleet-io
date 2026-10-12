// Scene-owned workshop. Only server account snapshots supply materials and unlocks.
(function(global){
  'use strict';
  const I=global.FleetI18n,M=I.m,R=global.FleetCraftingRecipes,X=global.FleetExtractionRules;
  class CraftingUI {
    constructor(scene,C,track) {
      this.scene=scene;this.C=C;this.track=track;this.socket=C.socket;this.economy=scene._features.economy;
      this.opened=false;this.pending=false;this.generation=0;this.destroyed=false;
      this.menu=this.button(M('craft.menu'),()=>this.open());document.getElementById('singleplayer-btn')?.after(this.menu);
      this.reset=()=>this.close();this.socket.on('welcome',this.reset);this.socket.on('disconnect',this.reset);
      this.locale=I.subscribe(()=>{if(this.opened)this.render();});scene.events.once('shutdown',()=>this.destroy());
    }
    button(message,action){const n=document.createElement('button');n.type='button';n.className='feature-button';I.render(n,message);n.onclick=action;return n;}
    clear(node){if(!node)return;for(const n of [node,...node.querySelectorAll('*')]){I.unbind(n);n.onclick=null;}node.replaceChildren();}
    open() {
      if(this.destroyed || this.opened || global.AdManager?.busy || this.C.evolutionPaused || this.C.mutationsOpen)return;
      this.opened=true;this.generation++;this.message=null;this.focus=document.activeElement;
      this.modal=document.createElement('div');this.modal.className='feature-modal crafting-modal';
      this.modal.setAttribute('role','dialog');this.modal.setAttribute('aria-modal','true');I.render(this.modal,M('craft.menu'),'@aria-label');
      this.panel=document.createElement('div');this.panel.className='feature-panel crafting-panel';this.modal.append(this.panel);document.body.append(this.modal);
      this.accountChanged=()=>{if(this.opened)this.render();};this.socket.on('accountState',this.accountChanged);
      this.escape=e=>{if(e.key==='Escape')this.close();};document.addEventListener('keydown',this.escape);
      this.render();this.track();this.panel.querySelector('button')?.focus();
      const generation=this.generation;
      this.economy.request('readStash').then(()=>{if(!this.destroyed && this.opened && generation===this.generation)this.render();}).catch(()=>{});
    }
    render() {
      if(!this.opened || this.destroyed)return;this.clear(this.panel);
      const stash=X.validateStash(this.economy.state.secureStash),owned=R.sanitize(this.economy.state.crafted);
      const ready=this.economy.accountReady && this.economy.persistent && !!stash,inRun=this.C.joined && !this.C.dead;
      const title=document.createElement('h2');I.render(title,M('craft.menu'));this.panel.append(title);
      const info=document.createElement('p');I.render(info,M('craft.explain'));this.panel.append(info);
      const warning=document.createElement('p');warning.className='stash-warning';
      I.render(warning,inRun?M('craft.inRun'):!this.economy.persistent?M('extraction.persistence'):!ready?M('extraction.wait'):'');this.panel.append(warning);
      const grid=document.createElement('div');grid.className='crafting-grid';this.panel.append(grid);
      for(const recipe of Object.values(R.RECIPES)){
        const unlocked=owned.includes(recipe.id),enough=!!stash && Object.entries(recipe.materials).every(([id,n])=>(stash.items[id] || 0)>=n);
        const card=document.createElement('article');card.className='crafting-card '+recipe.rarity+(unlocked?' crafting-owned':'');
        const icon=document.createElement('span');icon.className='crafting-icon';icon.textContent=recipe.icon;
        const name=document.createElement('h3');I.render(name,M('craft.'+recipe.id+'.name'));
        const rarity=document.createElement('small');I.render(rarity,M('cargo.rarity.'+recipe.rarity));
        const desc=document.createElement('p');I.render(desc,M('craft.'+recipe.id+'.desc'));
        const materials=document.createElement('ul');
        for(const [id,n]of Object.entries(recipe.materials)){
          const row=document.createElement('li'),have=stash?.items[id] || 0;row.className=have>=n?'craft-enough':'craft-missing';
          I.render(row,M('craft.material',{name:M(id==='alien_tech_core'?'craft.plasmaCore':'extraction.resource.'+id),have,need:n}));materials.append(row);
        }
        const craft=this.button(M(unlocked?'craft.owned':this.pending?'craft.pending':'craft.make'),()=>this.fabricate(recipe.id));
        craft.disabled=unlocked || this.pending || !ready || !enough || inRun;
        card.append(icon,name,rarity,desc,materials,craft);
        if(unlocked && recipe.kind==='skin'){
          const equipped=this.economy.state.equipped.skin===recipe.id;
          const equip=this.button(M(equipped?'shop.equipped':'shop.equip'),()=>this.equip(recipe.id));equip.disabled=equipped || this.pending || !ready;card.append(equip);
        }
        grid.append(card);
      }
      const status=document.createElement('p');status.className='crafting-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');I.render(status,this.message || '');this.panel.append(status);
      if(this.scene._stashUI)this.panel.append(this.button(M('craft.sell'),()=>{this.close();this.scene._stashUI.open();}));
      this.panel.append(this.button(M('continue'),()=>this.close()));
    }
    async fabricate(id) {
      if(this.pending || !this.opened || this.destroyed)return;
      this.pending=true;const generation=this.generation;this.panel.classList.remove('crafting-success');this.render();
      try {
        const result=await this.economy.craft(id);
        if(!this.destroyed && this.opened && generation===this.generation){
          const key=result?.ok?'craft.success':['craft.invalid','craft.materials','craft.inRun'].includes(result?.error)?result.error:'craft.failed';
          this.message=M(key,{name:M('craft.'+id+'.name')});
          if(result?.ok && !result.alreadyOwned)this.panel.classList.add('crafting-success');
        }
      }catch{if(!this.destroyed && generation===this.generation)this.message=M('craft.failed');}
      finally{this.pending=false;if(!this.destroyed && this.opened)this.render();}
    }
    async equip(id) {
      if(this.pending || this.destroyed)return;this.pending=true;this.render();
      try{await this.economy.buy('skins',id);if(!this.destroyed)this.scene._features.loadout();}
      catch{}finally{this.pending=false;if(!this.destroyed && this.opened)this.render();}
    }
    close(track=true) {
      if(!this.opened)return;this.opened=false;this.generation++;
      this.socket.off('accountState',this.accountChanged);document.removeEventListener('keydown',this.escape);
      this.clear(this.panel);I.unbind(this.modal);this.modal.remove();this.panel=this.modal=null;
      this.accountChanged=this.escape=null;if(track)this.track();if(this.focus?.isConnected)this.focus.focus();this.focus=null;
    }
    destroy(){
      if(this.destroyed)return;this.close(false);this.destroyed=true;this.generation++;
      this.socket.off('welcome',this.reset);this.socket.off('disconnect',this.reset);this.locale();
      I.unbind(this.menu);this.menu.onclick=null;this.menu.remove();
    }
  }
  global.FleetCraftingUI=CraftingUI;
})(window);
