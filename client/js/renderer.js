// RAF sigue el refresco del monitor; target orienta el reloj, no promete FPS.
(function (global) {
  'use strict';
  function config(parent, scenes) {
    return {
      type: Phaser.WEBGL, parent: 'game',
      width: parent.clientWidth || global.innerWidth,
      height: parent.clientHeight || global.innerHeight,
      backgroundColor: '#000000',
      scale: { mode: Phaser.Scale.RESIZE, parent: 'game', autoCenter: Phaser.Scale.CENTER_BOTH },
      physics: { default: 'arcade', arcade: { debug: false, fps: 30 } },
      scene: scenes,
      fps: { target: 120, smoothStep: true, forceSetTimeOut: false },
      render: { antialias: true, pixelArt: false, powerPreference: 'high-performance' },
    };
  }
  function metrics(scene, now) {
    const node = document.getElementById('fleet-debug');
    if (!node) return;
    scene._metricFrames = (scene._metricFrames || 0) + 1;
    scene._metricAt ??= now;
    if (now - scene._metricAt < 1000) return;
    node.textContent = `${Math.round(scene._metricFrames * 1000 / (now - scene._metricAt))} FPS · WebGL · red 30 Hz`;
    scene._metricAt = now; scene._metricFrames = 0;
  }
  function installMetrics() {
    if (!new URLSearchParams(global.location.search).has('debug')) return;
    const node = document.createElement('div');
    node.id = 'fleet-debug';
    node.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:9999;color:#88efff;background:#071321dd;padding:8px;font:12px monospace;pointer-events:none';
    node.textContent = 'Midiendo FPS…';
    document.body.append(node);
  }
  global.FleetRenderer = { config, metrics, installMetrics };
})(window);
