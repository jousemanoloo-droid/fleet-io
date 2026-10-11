// CrazyGames SDK v3; simulation is restricted to localhost / 127.0.0.1.
(function (global) {
  'use strict';
  const I = window.FleetI18n, M = I.m;

  class SimulatedAdAdapter {
    showRewardedAd() { return this._show(3); }
    showInterstitialAd() { return this._show(1); }

    _show(seconds) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'ad-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        I.render(overlay, M('ad.title'), '@aria-label');
        const panel = document.createElement('div');
        panel.className = 'panel';
        const label = document.createElement('p');
        const cancel = document.createElement('button');
        cancel.className = 'btn death-secondary';
        I.render(cancel, M('ad.cancel'));
        panel.append(label, cancel);
        overlay.append(panel);
        document.body.append(overlay);
        let remaining = seconds;
        I.render(label, M('ad.simulated', { seconds: remaining }));
        const finish = (completed) => {
          clearInterval(timer);
          [overlay, label, cancel].forEach(node => I.unbind(node));
          overlay.remove();
          resolve(completed);
        };
        const timer = setInterval(() => {
          remaining--;
          I.render(label, M('ad.simulated', { seconds: remaining }));
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
      this._loadingRequested = true; this._loadingStarted = false; this._loadingStopped = false;
      this._loadingTimer = null; this._loadingTimedOut = false;
      this.adsDisabled = false; this.adblock = false; this.retryAt = 0;
      this.ready = this._initialize();
    }

    async _initialize() {
      // An iframe is NOT proof of CrazyGames monetization. Only SDK.environment is.
      // Simulation is explicitly restricted to loopback, never public hosting.
      const local = ['localhost', '127.0.0.1'].includes(global.location?.hostname);
      const sdk = global.CrazyGames?.SDK;
      let timer;
      try {
        if (!sdk) throw new Error('CrazyGames SDK is unavailable');
        await Promise.race([sdk.init(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('SDK initialization timeout')), 8000);
        })]);
        if (sdk.environment === 'crazygames') {
          this.sdk = sdk; this.mode = 'crazygames';
        } else if (local) this.mode = 'simulation';
        else throw new Error('CrazyGames ads are unavailable in this environment');
      } catch (error) {
        this.mode = local ? 'simulation' : 'unavailable'; this.initializationError = error;
      } finally { if (timer) clearTimeout(timer); }
      this._initialized = true;
      this._syncLoading(); this._syncGameplay();
      // Detection failure must not prevent ordinary play or fabricate a reward.
      if (this.sdk?.ad?.hasAdblock) {
        Promise.resolve().then(() => this.sdk.ad.hasAdblock()).then(value => { this.adblock = value === true; }).catch(() => {});
      }
      return this.mode;
    }

    loadingStart() { this._loadingRequested = true; this._syncLoading(); }
    loadingStop() {
      this._loadingRequested = false;
      if (this._loadingTimer !== null) clearTimeout(this._loadingTimer);
      this._loadingTimer = null;
      this._syncLoading();
    }
    _syncLoading() {
      if (!this._initialized || !this.sdk) return;
      try {
        if (!this._loadingStarted) {
          this.sdk.game.loadingStart(); this._loadingStarted = true;
          if (this._loadingRequested) this._loadingTimer = setTimeout(() => {
            this._loadingTimedOut = true;
            this.loadingStop();
            this._hooks.onLoadingTimeout?.();
          }, 8000);
          this._loadingTimer?.unref?.(); // Does not keep Node-based SDK tests alive.
        }
        if (!this._loadingRequested && !this._loadingStopped) {
          this.sdk.game.loadingStop(); this._loadingStopped = true;
        }
      } catch (error) { global.console?.warn('FLEET.IO: SDK loading telemetry failed', error); }
    }
    canShowAds() {
      return this._initialized && (this.mode === 'crazygames' || this.mode === 'simulation') &&
        !this.adsDisabled && !this.adblock && Date.now() >= this.retryAt;
    }
    _adFailure(error) {
      const code = error?.code;
      if (code === 'adsDisabledBasicLaunch') this.adsDisabled = true;
      if (code === 'adblock') this.adblock = true;
      if (code === 'unfilled' || code === 'adCooldown') this.retryAt = Date.now() + 120000;
      return error || new Error('Advertisement unavailable');
    }

    setGameHooks(hooks = {}) {
      this._hooks = hooks;
      if (this._loadingTimedOut) this._hooks.onLoadingTimeout?.();
    }

    gameplayStart() {
      // An active game is also proof that initial loading has completed.
      this.loadingStop();
      this._wantsGameplay = true; this._syncGameplay();
    }
    gameplayStop() { this._wantsGameplay = false; this._syncGameplay(); }

    _syncGameplay() {
      if (!this._initialized) return;
      const playing = this._wantsGameplay && !this.busy;
      if (playing === this._reportedGameplay) return;
      try {
        if (this.sdk) this.sdk.game[playing ? 'gameplayStart' : 'gameplayStop']();
        this._reportedGameplay = playing;
      } catch (error) { global.console?.warn('FLEET.IO: SDK gameplay telemetry failed', error); }
    }

    _requestCrazyAd(type, onStarted) {
      return new Promise((resolve, reject) => {
        let settled = false, timer;
        const finish = error => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (error) reject(this._adFailure(error));
          else resolve(true);
        };
        const callbacks = {
          adStarted: () => {
            if (!settled) {
              clearTimeout(timer); timer = setTimeout(() => finish(new Error('Advertisement completion timeout')), 120000);
              try { onStarted(); } catch (error) { finish(error); }
            }
          },
          adFinished: () => finish(),
          adError: error => finish(error || new Error('Anuncio no disponible')),
        };
        timer = setTimeout(() => finish(new Error('Advertisement start timeout')), 12000);
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
      if (!['localhost','127.0.0.1'].includes(global.location?.hostname)) throw new Error('Adapter overrides are local-only');
      if (!adapter || typeof adapter.showRewardedAd !== 'function' ||
          typeof adapter.showInterstitialAd !== 'function') {
        throw new TypeError('Invalid advertising adapter');
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
        if (!this.canShowAds()) throw this.initializationError || new Error('Advertisements unavailable');
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
