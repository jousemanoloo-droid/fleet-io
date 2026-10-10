// Adaptador independiente de Phaser. Ningún SDK ni anuncio real se carga aquí.
(function (global) {
  'use strict';

  class SimulatedAdAdapter {
    showRewardedAd() { return this._show(3); }
    showInterstitialAd() { return this._show(1); }

    _show(seconds) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'ad-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Anuncio de demostración');
        const panel = document.createElement('div');
        panel.className = 'panel';
        const label = document.createElement('p');
        const cancel = document.createElement('button');
        cancel.className = 'btn death-secondary';
        cancel.textContent = 'Cancelar anuncio';
        panel.append(label, cancel);
        overlay.append(panel);
        document.body.append(overlay);
        let remaining = seconds;
        label.textContent = `Anuncio simulado · ${remaining}s`;
        const finish = (completed) => {
          clearInterval(timer);
          overlay.remove();
          resolve(completed);
        };
        const timer = setInterval(() => {
          remaining--;
          label.textContent = `Anuncio simulado · ${remaining}s`;
          if (remaining <= 0) finish(true);
        }, 1000);
        cancel.onclick = () => finish(false);
        cancel.focus();
      });
    }
  }

  class AdManager {
    constructor(adapter) { this.adapter = adapter; this.busy = false; }

    // Un wrapper de CrazyGames, Poki o un proveedor de anuncios recompensados
    // debe convertir sus callbacks a Promise<boolean>: true SOLO al completar.
    // Los anuncios display de AdSense no implican una recompensa por sí solos.
    setAdapter(adapter) {
      if (this.busy) throw new Error('Hay un anuncio en curso');
      if (!adapter || typeof adapter.showRewardedAd !== 'function' ||
          typeof adapter.showInterstitialAd !== 'function') {
        throw new TypeError('Adaptador de anuncios inválido');
      }
      this.adapter = adapter;
    }

    async _show(method) {
      if (this.busy) throw new Error('Hay un anuncio en curso');
      this.busy = true;
      try {
        return (await this.adapter[method]()) === true;
      } finally {
        this.busy = false;
      }
    }

    async showRewardedAd(onSuccess, onFailure) {
      let completed;
      try { completed = await this._show('showRewardedAd'); }
      catch (error) { onFailure?.(error); return false; }
      if (completed) onSuccess?.();
      else onFailure?.(new Error('Anuncio cancelado o no disponible'));
      return completed;
    }

    async showInterstitialAd() {
      try { return await this._show('showInterstitialAd'); }
      catch { return false; }
    }
  }

  global.AdManager = new AdManager(new SimulatedAdAdapter());
})(window);
