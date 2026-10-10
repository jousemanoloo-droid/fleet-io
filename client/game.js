// Punto de entrada estable; módulos y escena viven en client/js/.
(function () {
  'use strict';
  const boot = () => window.FleetGame.boot().catch(error => {
    console.error('No se pudo iniciar FLEET.IO:', error);
    const status = document.getElementById('status');
    if (status) status.textContent = 'No se pudo iniciar WebGL. Revisa la consola del navegador.';
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
