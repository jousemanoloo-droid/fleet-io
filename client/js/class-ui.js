// Scene-owned evolution UI. No global DOM/key/socket listeners or timers.
(function(global) {
  'use strict';
  const I = global.FleetI18n, M = I.m;
  class ClassUI {
    constructor(scene, state) {
      this.scene = scene; this.C = state; this.generation = 0; this.key = null;
      this.modal = document.createElement('div'); this.modal.className = 'feature-modal hidden';
      this.modal.setAttribute('role','dialog'); this.modal.setAttribute('aria-modal','true');
      this.panel = document.createElement('div'); this.panel.className = 'panel';
      this.modal.append(this.panel); document.body.append(this.modal);
      scene.events.once('shutdown', () => this.destroy());
    }
    clear() {
      for (const node of [this.panel, ...this.panel.querySelectorAll('*')]) I.unbind(node);
      this.panel.replaceChildren(); this.generation++; this.key = null; this.error = null;
    }
    close() {
      this.me = null;
      if (this.key === null) return;
      this.clear(); this.modal.classList.add('hidden'); this.C.evolutionPaused = false;
      global.FleetGame.trackGameplay();
    }
    sync(me) {
      this.me = me;
      if (!me?.evolutionPending || me.hp <= 0 || !this.C.joined || !this.C.connected) { this.close(); return; }
      if (this.C.mutationsOpen || this.C.menuOpen) { this.close(); return; }
      const key = `${this.C.room?.roomId}:${me.deathId}:${me.evolutionPending}`;
      if (this.key === key) return;
      this.clear(); this.key = key; this.C.evolutionPaused = true;
      this.modal.classList.remove('hidden'); global.FleetGame.trackGameplay();
      const heading = document.createElement('h2'); I.render(heading, M('class.title',{level:me.evolutionPending}));
      const hint = document.createElement('p'); I.render(hint,M('class.hint'));
      const grid = document.createElement('div'); grid.className = 'feature-grid';
      this.panel.append(heading,hint,grid);
      for (const id of Object.keys(global.FleetShipClasses.CLASSES)) {
        const card = document.createElement('div'); card.className = 'feature-card';
        const description = document.createElement('p'); I.render(description,M('class.'+id+'.desc'));
        const cargoCapacity=global.FleetExtractionRules?.capacity(id);
        if(cargoCapacity){
          const cargo=document.createElement('small');I.render(cargo,M('cargo.classLimit',{capacity:cargoCapacity}));card.append(cargo);
        }
        const button = document.createElement('button'); button.className = 'btn'; I.render(button,M('class.'+id));
        if(cargoCapacity && (this.scene._stashUI?.used || 0)>cargoCapacity)button.disabled=true;
        button.onclick = () => this.choose(id); card.append(description,button); grid.append(card);
      }
      grid.querySelector('button')?.focus();
    }
    choose(id) {
      if (!this.C.connected || this.C.dead || global.AdManager?.busy) return;
      const generation = this.generation, playerId = this.C.myId;
      const {roomId} = this.C.room, deathId = this.me.deathId, milestone = this.me.evolutionPending;
      for (const button of this.panel.querySelectorAll('button')) button.disabled = true;
      this.C.socket.timeout(8000).emit('chooseShipClass',{roomId,deathId,milestone,classId:id},(error,result) => {
        if (this.generation !== generation || this.C.myId !== playerId || this.C.room?.roomId !== roomId || this.C.dead) return;
        if (!error && result?.ok) { this.close(); this.scene._syncLocalState(result.player); }
        else {
          for (const button of this.panel.querySelectorAll('button')) button.disabled = false;
          if (!this.error) this.error = document.createElement('p');
          I.render(this.error,M('error.classChoice')); this.panel.append(this.error);
        }
      });
    }
    destroy() {
      this.clear(); this.C.evolutionPaused = false;
      global.AdManager?.gameplayStop?.();
      this.modal.remove(); this.scene = this.C = this.me = this.error = null;
    }
  }
  global.FleetClassUI = ClassUI;
})(window);
