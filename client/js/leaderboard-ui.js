// Compact global/UTC/clan boards. DOM textContent only; no player HTML.
(function(global) {
  'use strict';
  const I=global.FleetI18n,M=I.m;
  class LeaderboardUI {
    constructor(scene,C) {
      this.C=C;this.revision=-1;this.mode='global';this.data={global:[],daily:[],clans:[]};
      this.rows=document.getElementById('lb-rows');this.controls=document.createElement('div');this.controls.className='rank-tabs';
      if(!this.rows)return;
      this.root=document.getElementById('leaderboard');this.buttons={};this.collapsed=global.innerWidth<=700;this.roomRank=-1;
      this.root?.classList.toggle?.('collapsed',this.collapsed);
      for(const mode of ['global','daily','clans']) {
        const button=document.createElement('button');button.type='button';button.className='feature-button tab-'+(mode==='clans'?'clan':mode);I.render(button,M('rank.'+mode));
        button.setAttribute?.('role','tab');button.onclick=()=>this.renderLeaderboard(mode);this.controls.append(button);this.buttons[mode]=button;
      }
      this.controls.setAttribute?.('role','tablist');
      this.rows.before(this.controls);
      this.toggle=document.createElement('button');this.toggle.id='btn-toggle-leaderboard';this.toggle.type='button';this.toggle.className='rank-toggle';
      this.caption=document.createElement('span');this.chevron=document.createElement('span');this.toggle.append(this.caption,this.chevron);
      this.toggle.onclick=()=>{this.collapsed=!this.collapsed;this.root?.classList.toggle?.('collapsed',this.collapsed);this.content?.setAttribute?.('inert',this.collapsed?'':'');
        if(!this.collapsed)this.content?.removeAttribute?.('inert');this.updateToggle();};
      if(this.root && this.root!==this.rows){
        this.content=document.createElement('div');this.content.className='rank-content';this.content.id='leaderboard-content';
        this.meta=this.root.querySelector('.lb-meta');if(this.meta)this.content.append(this.meta);this.content.append(this.controls,this.rows);this.root.append(this.toggle,this.content);
      }
      this.toggle.setAttribute?.('aria-controls','leaderboard-content');this.updateToggle();
      this.handler=data=>this.receive(data);this.disconnected=()=>{this.revision=-1;this.roomRank=-1;this.data={global:[],daily:[],clans:[]};this.render();};
      C.socket.on('leaderboards',this.handler);C.socket.on('disconnect',this.disconnected);
      this.resetRoom=()=>{this.authoritativeRoomRank=null;this.roomRank=-1;this.rankTick=-1;this.updateToggle();};
      this.rankHandler=d=>{
        if(d?.roomId!==C.room?.roomId || d.playerId!==C.myId || !Number.isSafeInteger(d.rank) || d.rank<1 || d.rank>4000 ||
          !Number.isSafeInteger(d.tick) || d.tick<(this.rankTick || -1))return;
        this.authoritativeRoomRank=d.rank;this.rankTick=d.tick;this.roomRank=d.rank-1;this.updateToggle();
      };
      C.socket.on('room:rank',this.rankHandler);C.socket.on('welcome',this.resetRoom);
      this.unsubscribe=I.subscribe(()=>this.render());scene.events.once('shutdown',()=>this.destroy());
      this.render();
    }
    receive(data) {
      if(data?.v!==1 || !Number.isSafeInteger(data.revision) || data.revision<this.revision)return;
      for(const mode of ['global','daily','clans'])if(!Array.isArray(data[mode]) || data[mode].length>10)return;
      if(![...data.global,...data.daily].every(r=>Array.isArray(r) && typeof r[0]==='string' && typeof r[1]==='string' && (r[3]===null || typeof r[3]==='string' && /^[A-Z0-9]{2,8}$/.test(r[3])) && Number.isSafeInteger(r[4]) && r[4]>=0))return;
      if(!data.clans.every(r=>Array.isArray(r) && typeof r[0]==='string' && /^[A-Z0-9]{2,8}$/.test(r[0]) && Number.isSafeInteger(r[1]) && r[1]>=0 && Number.isSafeInteger(r[2]) && r[2]>=0))return;
      this.revision=data.revision;this.data=data;this.render();
    }
    clear() {for(const node of this.rows.querySelectorAll('*')) I.unbind(node);this.rows.replaceChildren();}
    roomRanking(players){this.roomRank=this.authoritativeRoomRank?this.authoritativeRoomRank-1:(players || []).findIndex(p=>p.id===this.C.myId);this.updateToggle();}
    updateToggle(){I.render(this.caption,M('rank.roomPosition',{rank:this.roomRank>=0?this.roomRank+1:'—'}));this.chevron.textContent=this.collapsed?'▼':'▲';this.toggle.setAttribute?.('aria-expanded',String(!this.collapsed));}
    renderLeaderboard(type){if(!['global','daily','clans'].includes(type))return;this.mode=type;this.render();}
    render() {
      if(!this.rows)return;
      this.clear();
      for(const [mode,button]of Object.entries(this.buttons)){
        button.classList.toggle?.('active',mode===this.mode);button.setAttribute?.('aria-selected',String(mode===this.mode));
      }
      this.updateToggle();const rows=this.data[this.mode] || [];
      for(let i=0;i<rows.length;i++) {
        const r=rows[i],node=document.createElement('div');node.className='rank-row';
        const name=document.createElement('strong'),description=document.createElement('small'),score=document.createElement('span');
        if(this.mode==='clans') {name.textContent=`${i+1}. [${r[0]}]`;I.render(description,M('rank.members',{members:r[2]}));score.textContent=String(r[1]);}
        else {
          name.textContent=`${i+1}. ${r[3]?'['+r[3]+'] ':''}${r[1]}`;
          I.render(description,M(['hunter','battleship','carrier','stealth'].includes(r[2])?'class.'+r[2]:'rank.starter'));
          score.textContent=String(r[4]);if(r[0]===this.C.myId)node.classList.add('me');
        }
        node.append(name,score,description);this.rows.append(node);
      }
      if(!rows.length) {const label=document.createElement('small');I.render(label,M(this.revision<0?'rank.loading':this.mode==='daily'?'rank.emptyDaily':'rank.empty'));this.rows.append(label);}
    }
    destroy() {
      if(!this.rows)return;
      this.C.socket.off('leaderboards',this.handler);this.C.socket.off('disconnect',this.disconnected);this.unsubscribe();this.clear();
      this.C.socket.off('room:rank',this.rankHandler);this.C.socket.off('welcome',this.resetRoom);
      for(const n of this.controls.querySelectorAll('*')){I.unbind(n);n.onclick=null;}this.controls.remove();
      I.unbind(this.caption);this.toggle.onclick=null;this.toggle.remove();
      if(this.content){if(this.meta)this.root.append(this.meta);this.root.append(this.rows);this.content.remove();}this.root?.classList.remove?.('collapsed');
    }
  }
  global.FleetLeaderboardUI=LeaderboardUI;
})(window);
