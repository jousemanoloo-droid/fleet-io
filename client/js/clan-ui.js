(function(global) {
  'use strict';
  const I=global.FleetI18n,M=I.m;
  class ClanUI {
    constructor(scene,C) {
      this.C=C;this.pending=false;this.destroyed=false;this.tag=null;this.generation=0;
      try {this.preferred=global.localStorage.getItem('fleet_io_clan');}catch {this.preferred=null;}
      if(typeof this.preferred!=='string' || !/^[A-Z0-9]{2,8}$/.test(this.preferred))this.preferred=null;
      this.button=document.createElement('button');this.button.className='feature-button';I.render(this.button,M('clan.menu'));this.button.onclick=()=>this.open();
      document.getElementById('singleplayer-btn').after(this.button);
      this.modal=document.createElement('div');this.modal.className='feature-modal hidden';this.modal.setAttribute('role','dialog');this.modal.setAttribute('aria-modal','true');
      const panel=document.createElement('div');panel.className='feature-panel';
      const title=document.createElement('h2');I.render(title,M('clan.title'));
      this.input=document.createElement('input');this.input.maxLength=10;I.render(this.input,M('clan.placeholder'),'@placeholder');I.render(this.input,M('clan.title'),'@aria-label');
      this.status=document.createElement('p');
      this.join=document.createElement('button');this.join.className='feature-button';I.render(this.join,M('clan.join'));this.join.onclick=()=>this.request('joinClan',this.input.value);
      this.leave=document.createElement('button');this.leave.className='feature-button';I.render(this.leave,M('clan.leave'));this.leave.onclick=()=>this.request('leaveClan');
      const close=document.createElement('button');close.className='feature-button';I.render(close,M('continue'));close.onclick=()=>this.close();
      panel.append(title,this.input,this.join,this.leave,this.status,close);this.modal.append(panel);document.body.append(this.modal);
      this.handlers={
        clanState:data=>{this.tag=typeof data?.tag==='string'?data.tag:null;this.refresh();},
        connect:()=>{if(this.preferred)this.request('joinClan',this.preferred);},
        disconnect:()=>{this.generation++;this.pending=false;this.tag=null;this.close();this.refresh();}
      };
      for(const [event,handler]of Object.entries(this.handlers))C.socket.on(event,handler);
      if(C.connected && this.preferred)this.request('joinClan',this.preferred);
      scene.events.once('shutdown',()=>this.destroy());
    }
    open() {
      if(global.AdManager?.busy || this.C.evolutionPaused || this.C.mutationsOpen)return;
      this.modal.classList.remove('hidden');global.FleetGame.trackGameplay();this.refresh();this.input.focus();
    }
    close() {this.modal.classList.add('hidden');global.FleetGame.trackGameplay();}
    refresh() {
      this.join.disabled=this.leave.disabled=this.pending || !this.C.connected;
      I.render(this.button,this.tag?M('clan.current',{tag:this.tag}):M('clan.menu'));
      if(!this.pending)I.render(this.status,this.tag?M('clan.current',{tag:this.tag}):M('clan.none'));
    }
    request(event,tag) {
      if(this.pending || !this.C.connected || global.AdManager?.busy)return;
      this.pending=true;this.refresh();I.render(this.status,M('clan.pending'));
      const generation=++this.generation;
      this.C.socket.timeout(8000).emit(event,{tag},(error,result)=>{
        if(this.destroyed || generation!==this.generation)return;
        this.pending=false;
        if(error || !result?.ok) {this.refresh();I.render(this.status,I.error(result?.error,'error.clanConnection'));return;}
        this.tag=result.tag;this.preferred=this.tag;
        try {if(this.tag)global.localStorage.setItem('fleet_io_clan',this.tag);else global.localStorage.removeItem('fleet_io_clan');}catch {}
        this.refresh();
      });
    }
    destroy() {
      this.destroyed=true;for(const [event,handler]of Object.entries(this.handlers))this.C.socket.off(event,handler);
      for(const node of [this.button,...this.modal.querySelectorAll('*')])I.unbind(node);
      this.button.remove();this.modal.remove();
    }
  }
  global.FleetClanUI=ClanUI;
})(window);
