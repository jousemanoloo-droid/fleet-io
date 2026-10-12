// Scene-owned garage. Native ads are requested only through AdManager.
(function(global) {
  'use strict';
  const I=global.FleetI18n,M=I.m,Q=global.FleetDailyQuests;
  class GarageUI {
    constructor(features) {
      this.features=features; this.economy=features.economy; this.opened=false; this.pending=false; this.destroyed=false;
      this.modal=document.createElement('div'); this.modal.className='feature-modal hidden';
      this.modal.setAttribute('role','dialog'); this.modal.setAttribute('aria-modal','true');
      this.panel=document.createElement('div'); this.panel.className='feature-panel garage-panel';
      this.modal.append(this.panel); document.body.append(this.modal);
      // Nonblocking welcome card: never covers Play or the loading screen.
      this.card=document.createElement('div'); this.card.className='daily-welcome hidden'; (document.getElementById('overlay') || document.body).append(this.card);
      this.lastUI=0;
    }
    button(message,click) {const n=document.createElement('button');n.className='feature-button';I.render(n,message);n.onclick=click;return n;}
    clear(node) {for(const child of [node,...node.querySelectorAll('*')]) I.unbind(child);node.replaceChildren();}
    open() {
      if(global.AdManager?.busy || this.features.C.evolutionPaused || this.features.C.mutationsOpen) return;
      this.opened=true; this.modal.classList.remove('hidden'); this.features.track(); this.render();
    }
    close() {if(this.pending) return;this.opened=false;this.modal.classList.add('hidden');this.clear(this.panel);this.features.track();}
    render() {
      const focus=document.activeElement?.dataset?.garageKey;
      this.economy.load(); this.clear(this.panel);
      const title=document.createElement('h2'); I.render(title,M('garage.title',{credits:this.economy.state.coins})); this.panel.append(title);
      const equipped={skins:'skin',trails:'trail',effects:'killEffect',lasers:'laser'};
      for(const type of Object.keys(equipped)) {
        const label=document.createElement('h3'); I.render(label,M('garage.'+type));this.panel.append(label);
        const grid=document.createElement('div'); grid.className='feature-grid';this.panel.append(grid);
        for(const item of global.FleetEconomy.CATALOG[type]) {
          const owned=this.economy.state[type].includes(item.id),selected=this.economy.state.equipped[equipped[type]]===item.id;
          const card=document.createElement('div');card.className='feature-card';
          const name=document.createElement('strong');I.render(name,M(item.nameKey));
          const preview=document.createElement('div');preview.className='garage-preview';
          const colors={alien:'#77ff99',gold:'#ffd260',starlight:'#e8c8ff',void_stalker:'#c97aff',green:'#00ff88',red:'#ff3366',rainbow:'#cc66ff'};
          preview.style.borderColor=colors[item.id] || '#00d4ff'; preview.style.color=preview.style.borderColor;
          if(type==='skins') {const img=document.createElement('img');const tier=this.features.me?.chassis || 1;img.src=this.features.scene.textures.getBase64('ship-blue-'+tier);img.alt='';img.style.filter=({gold:'sepia(1) saturate(4)',alien:'hue-rotate(80deg)',chrome:'grayscale(1)',starlight:'hue-rotate(100deg) brightness(1.3)',void_stalker:'hue-rotate(65deg) saturate(1.6)'}[item.id] || 'none');preview.append(img);}
          else preview.textContent=type==='lasers'?'━━━━━━':'✦ ✧ ✦';
          const buy=this.button(selected?M('shop.equipped'):owned?M('shop.equip'):item.exclusive?M('garage.exclusive'):M('garage.buy',{credits:item.price}),async()=>{
            if(await this.economy.buy(type,item.id) && !this.destroyed) {this.features.currency();this.features.loadout();this.render();}
          });
          buy.disabled=selected || this.pending || !owned && (item.exclusive || this.economy.state.coins<item.price) || this.economy.remote && !this.economy.accountReady;
          buy.dataset.garageKey=type+'-'+item.id;
          card.append(name,preview,buy);grid.append(card);
        }
      }
      for(const title of [null,...this.economy.state.titles]) {
        const button=this.button(title?M('title.'+title):M('cosmetic.noTitle'),async()=>{
          if(this.economy.remote) await this.economy.equipTitle(title);
          else {this.economy.state.equipped.title=title;this.economy.save();}
          if(!this.destroyed){this.features.loadout();this.render();}
        });button.disabled=this.pending || this.economy.state.equipped.title===title;this.panel.append(button);
      }
      this.adButton=this.button(M('garage.ad'),()=>this.rewarded());this.panel.append(this.adButton);
      if(!this.economy.persistent) {const notice=document.createElement('p');I.render(notice,M('shop.storage'));this.panel.append(notice);}
      this.status=document.createElement('p');I.render(this.status,this.message || (!global.AdManager?.canShowAds()?M('garage.unavailable'):''));this.panel.append(this.status);
      this.daily(this.panel);
      this.panel.append(this.button(M('continue'),()=>this.close()));
      if(this.features.scene._stashUI)this.panel.append(this.button(M('extraction.menu'),()=>{this.close();this.features.scene._stashUI.open();}));
      this.updateAd();
      if(typeof focus==='string' && /^[a-zA-Z0-9_-]+$/.test(focus)) this.panel.querySelector('[data-garage-key="'+focus+'"]')?.focus();
    }
    updateAd() {
      if(!this.adButton) return;
      const now=this.economy.utcNow(), seconds=now===null?0:Math.ceil(Math.max(0,this.economy.state.adReadyAt-now)/1000);
      this.adButton.disabled=this.pending || now===null || seconds>0 || !global.AdManager?.canShowAds();
      I.render(this.adButton,seconds>0?M('garage.wait',{seconds}):M('garage.ad'));
    }
    async rewarded() {
      const now=this.economy.utcNow();
      if(this.pending || now===null || now<this.economy.state.adReadyAt || !global.AdManager?.canShowAds()) return;
      this.pending=true; this.message=M('ad.playing'); this.render();
      const id='garage-ad-'+(global.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
      const ticket=await Promise.resolve(this.economy.reserveAd(id)).catch(()=>false);
      if(!ticket) {this.pending=false;this.message=M('garage.waitSync');this.render();return;}
      try {
        await global.AdManager.showRewardedAd(async()=>{
          const awarded=await this.economy.rewardAd(this.economy.remote?ticket:id);
          this.message=M(awarded?'garage.adSuccess':'garage.waitSync');
        },async()=>{if(this.economy.remote)await this.economy.request('cancelAd',{id:ticket});this.message=M('ad.failure');});
      } catch {this.message=M('ad.failure');}
      finally {
        this.economy.releaseAd(id);
        this.pending=false;
        if(!this.destroyed) {this.features.currency();if(this.opened) this.render();}
      }
    }
    daily(parent) {
      const now=this.economy.utcNow();
      const title=document.createElement('h3');I.render(title,M('quests.title'));parent.append(title);
      const schedule=document.createElement('p');I.render(schedule,M('streak.schedule'));parent.append(schedule);
      if(now===null) {const n=document.createElement('p');I.render(n,M('quests.clock'));parent.append(n);return;}
      const oldDay=this.economy.state.retention?.day,r=Q.ensure(this.economy.state,now);
      if(oldDay!==r.day) this.economy.save();
      const claim=this.button(M('streak.claim',{day:r.lastClaimDay===r.day?r.streak:(r.lastClaimDay===r.day-1?r.streak%7+1:1)}),async()=>{
        await this.economy.claimStreak();if(this.destroyed)return;this.features.currency();this.card.classList.add('hidden');if(this.opened)this.render();
      });claim.disabled=r.lastClaimDay>=r.day || this.pending;parent.append(claim);
      for(const q of r.quests) {
        const n=this.button(M('quests.'+q.id,{progress:q.progress,target:q.target,credits:q.reward}),async()=>{
          await this.economy.claimQuest(q.id);if(this.destroyed)return;this.features.currency();this.render();
        });n.disabled=q.claimed || q.progress<q.target || this.pending;parent.append(n);
      }
    }
    clockReady() {
      if(this.destroyed) return;
      const now=this.economy.utcNow(); if(now===null) return;
      const r=Q.ensure(this.economy.state,now);this.economy.save();
      this.clear(this.card);
      this.card.classList.add('hidden');
      if(r.lastClaimDay<r.day) {
        const title=document.createElement('strong');I.render(title,M('streak.welcome'));
        this.card.append(title,this.button(M('streak.open'),()=>{this.open();this.card.classList.add('hidden');}),this.button(M('streak.dismiss'),()=>this.card.classList.add('hidden')));
        this.card.classList.remove('hidden');
      }
      if(this.opened) this.render();
    }
    update(now) {
      if(now-this.lastUI<1000) return;this.lastUI=now;
      if(this.opened) {if(this.pending)this.updateAd();else this.render();}
    }
    destroy() {this.destroyed=true;this.opened=false;this.clear(this.panel);this.clear(this.card);this.modal.remove();this.card.remove();}
  }
  global.FleetGarageUI=GarageUI;
})(window);
