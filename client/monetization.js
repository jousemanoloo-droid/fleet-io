// CrazyGames SDK v3 + simulación fuera del portal. Independiente de Phaser.
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
    constructor() {
      this.adapter = null;
      this.sdk = null;
      this.mode = 'initializing';
      this.busy = false;
      this._initialized = false;
      this._wantsGameplay = false;
      this._reportedGameplay = false;
      this._hooks = {};
      this.ready = this._initialize();
    }

    async _initialize() {
      const sdk = global.CrazyGames?.SDK;
      let timer;
      try {
        if (sdk) {
          // Un SDK que no responde no debe bloquear el arranque local.
          await Promise.race([
            sdk.init(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('SDK initialization timeout')), 8000);
            }),
          ]);
          if (sdk.environment === 'crazygames') {
            this.sdk = sdk;
            this.mode = 'crazygames';
          }
        }
      } catch (error) {
        // No convertir un fallo del SDK en una recompensa simulada en el portal.
        let portal = false;
        try { portal = sdk?.environment === 'crazygames'; } catch { /* SDK no inicializado */ }
        if (portal) this.mode = 'unavailable';
        this.initializationError = error;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (this.mode === 'initializing') this.mode = 'simulation';
      this._initialized = true;
      this._syncGameplay();
      return this.mode;
    }

    setGameHooks(hooks = {}) { this._hooks = hooks; }

    gameplayStart() { this._wantsGameplay = true; this._syncGameplay(); }
    gameplayStop() { this._wantsGameplay = false; this._syncGameplay(); }

    _syncGameplay() {
      if (!this._initialized) return;
      const playing = this._wantsGameplay && !this.busy;
      if (playing === this._reportedGameplay) return;
      try {
        if (this.sdk) this.sdk.game[playing ? 'gameplayStart' : 'gameplayStop']();
        this._reportedGameplay = playing;
      } catch { /* Un fallo de telemetría no debe romper el juego. */ }
    }

    _requestCrazyAd(type, onStarted) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve(true);
        };
        const callbacks = {
          adStarted: () => {
            if (!settled) {
              try { onStarted(); } catch (error) { finish(error); }
            }
          },
          adFinished: () => finish(),
          adError: error => finish(error || new Error('Anuncio no disponible')),
        };
        try {
          // La resolución de requestAd NO concede reward: solo adFinished.
          const result = this.sdk.ad.requestAd(type, callbacks);
          if (result?.catch) result.catch(error => finish(error || new Error('Error de anuncio')));
        } catch (error) { finish(error); }
      });
    }

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
      this._syncGameplay();
      let started = false;
      const onStarted = () => {
        if (started) return;
        started = true;
        this._hooks.onAdStarted?.();
      };
      try {
        if (this.adapter) { onStarted(); return (await this.adapter[method]()) === true; }
        await this.ready;
        if (this.mode === 'unavailable') throw this.initializationError;
        if (this.sdk) {
          return await this._requestCrazyAd(method === 'showRewardedAd' ? 'rewarded' : 'midgame', onStarted);
        }
        onStarted();
        return await new SimulatedAdAdapter()[method]();
      } finally {
        this.busy = false;
        try { if (started) this._hooks.onAdEnded?.(); }
        finally { this._syncGameplay(); }
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

    async showInterstitialAd(callback) {
      let completed = false, error;
      try { completed = await this._show('showInterstitialAd'); }
      catch (failure) { error = failure; }
      callback?.(completed, error);
      return completed;
    }
  }

  global.AdManager = new AdManager();
})(window);
