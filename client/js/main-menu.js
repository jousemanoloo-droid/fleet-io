// Adopt the original modal buttons: their identity and click handlers never change.
(function(global){
  'use strict';const I=global.FleetI18n,M=I.m;
  class MainMenu {
    constructor(scene,C){
      this.scene=scene;this.C=C;this.panel=document.getElementById('menu-quick-access');this.labels=[];
      const buttons=[scene._clanUI?.button,scene._stashUI?.menuButton,scene._craftingUI?.menu,scene._features?.menuShopButton];
      for(let i=0;i<buttons.length;i++){
        const button=buttons[i];if(!button || !this.panel)continue;
        const card=document.createElement('div');card.className='quick-access-card';
        const icon=document.createElement('span');icon.className='quick-access-icon';icon.textContent=['⬡','▣','⚙','✧'][i];icon.setAttribute('aria-hidden','true');
        const status=document.createElement('small');status.className='quick-access-status';status.setAttribute('aria-live','polite');
        button.classList.add('quick-access-button');card.append(icon,button,status);this.panel.append(card);this.labels[i]=status;
      }
      this.refresh=()=>this.render();for(const event of ['accountState','clanState','welcome','disconnect'])C.socket.on(event,this.refresh);
      this.locale=I.subscribe(this.refresh);this.render();scene.events.once('shutdown',()=>this.destroy());
    }
    render(){
      const economy=this.scene._features?.economy,state=economy?.state || {},R=global.FleetExtractionRules;
      const stash=R?.validateStash(state.secureStash),recipes=global.FleetCraftingRecipes;
      const available=economy?.accountReady && stash?Object.values(recipes?.RECIPES || {}).filter(r=>
        !recipes.sanitize(state.crafted).includes(r.id) && Object.entries(r.materials).every(([id,n])=>(stash.items[id] || 0)>=n)).length:null;
      const skin=global.FleetEconomy?.CATALOG.skins.find(s=>s.id===state.equipped?.skin);
      const messages=[this.scene._clanUI?.tag?'['+this.scene._clanUI.tag+']':M('clan.none'),
        economy?.accountReady && stash?M('main.stash',{used:R.weight(stash.items),capacity:stash.capacity}):M('main.wait'),
        available===null?M('main.wait'):M('main.recipes',{count:available}),skin?M(skin.nameKey):M('main.wait')];
      for(let i=0;i<this.labels.length;i++)if(this.labels[i])I.render(this.labels[i],messages[i]);
    }
    destroy(){for(const e of ['accountState','clanState','welcome','disconnect'])this.C.socket.off(e,this.refresh);this.locale();for(const n of this.labels)if(n)I.unbind(n);this.panel?.replaceChildren();}
  }
  global.FleetMainMenu=MainMenu;
})(window);
