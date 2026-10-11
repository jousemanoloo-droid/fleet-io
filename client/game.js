// Punto de entrada estable; módulos y escena viven en client/js/.
(function () {
  'use strict';
  const I = window.FleetI18n, M = I.m;
  const boot = () => window.FleetGame.boot().catch(error => {
    console.error('Unable to start FLEET.IO:', error);
    const status = document.getElementById('status');
    if (status) I.render(status, M('status.webgl'));
    const loadingMessage = document.querySelector('#game-loading span');
    if (loadingMessage) I.render(loadingMessage, M('status.webgl'));
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
