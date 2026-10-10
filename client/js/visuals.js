// Texturas horneadas al arrancar: ningún fuselaje se redibuja en el render loop.
(function (global) {
  'use strict';
  function textures(scene) {
    const make = (key, width, height, draw) => {
      if (scene.textures.exists(key)) return;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      draw(g); g.generateTexture(key, width, height); g.destroy();
    };
    for (const [team, neon] of [['blue', 0x20dfff], ['red', 0xff406e]]) {
      for (const tier of [1, 2, 3, 4]) make('ship-' + team + '-' + tier, 96, 80, g => {
        const polygon = points => points.map(([x, y]) => ({ x, y }));
        const wings = polygon([[12, 8], [48, 24], [85, 40], [48, 56], [12, 72], [23, 48], [23, 32]]);
        g.fillStyle(0x071321).fillPoints(wings, true);
        g.lineStyle(2, neon, 0.85).strokePoints(wings, true);
        g.fillStyle(0x354963).fillPoints(polygon([[22, 16], [50, 29], [35, 34], [18, 30]]), true);
        g.fillPoints(polygon([[22, 64], [50, 51], [35, 46], [18, 50]]), true);
        g.fillStyle(0x16283f).fillPoints(polygon([[13, 32], [58, 26], [91, 40], [58, 54], [13, 48]]), true);
        g.lineStyle(1, 0x88a6c5, 0.8).lineBetween(28, 35, 76, 35);
        g.lineBetween(28, 45, 76, 45);
        g.fillStyle(neon, 0.18).fillEllipse(57, 40, 34, 20);
        g.fillStyle(neon).fillPoints(polygon([[43, 34], [61, 33], [73, 40], [61, 47], [43, 46]]), true);
        g.fillStyle(0xd9ffff).fillPoints(polygon([[49, 35], [61, 35], [67, 39], [50, 39]]), true);
        g.fillStyle(0x060b17).fillRect(12, 30, 12, 8).fillRect(12, 42, 12, 8);
        g.fillStyle(neon).fillRect(11, 31, 4, 6).fillRect(11, 43, 4, 6);
        // El chasis modifica la silueta y sus hardpoints, no solo el tamaño.
        if (tier >= 2) {
          g.fillStyle(0x344d68).fillPoints(polygon([[12, 5], [59, 21], [34, 29], [8, 23]]), true);
          g.fillPoints(polygon([[12, 75], [59, 59], [34, 51], [8, 57]]), true);
          g.lineStyle(2, neon, 0.9).lineBetween(12, 6, 58, 21).lineBetween(12, 74, 58, 59);
        }
        if (tier >= 3) {
          g.fillStyle(0x596c86).fillRoundedRect(17, 23, 25, 12, 3).fillRoundedRect(17, 45, 25, 12, 3);
          g.fillStyle(0x20dfff, 0.8).fillRect(19, 25, 18, 3).fillRect(19, 52, 18, 3);
          g.lineStyle(2, 0xb8cadd, 0.7).lineBetween(40, 30, 66, 30).lineBetween(40, 50, 66, 50);
        }
        if (tier === 4) {
          g.fillStyle(0x3b526d).fillRoundedRect(6, 17, 16, 46, 5);
          g.fillStyle(neon, 0.5).fillRect(8, 22, 5, 36);
        }
        for (const offset of tier === 4 ? [-15, -5, 5, 15] : tier >= 2 ? [-5, 5] : [0]) {
          g.fillStyle(0x9eafc3).fillRect(70, 38 + offset, 24, tier >= 3 ? 5 : 3);
          g.fillStyle(neon).fillRect(89, 38 + offset, 5, tier >= 3 ? 5 : 3);
        }
      });
    }
    make('fleet-shield', 96, 96, g => {
      g.lineStyle(2, 0x20dfff, 0.22).strokeCircle(48, 48, 40);
      g.lineStyle(1, 0x88ffff, 0.5).strokeCircle(48, 48, 36);
    });
    make('fleet-crown', 48, 32, g => {
      const points = [[4, 9], [14, 18], [24, 3], [34, 18], [44, 9], [39, 27], [9, 27]].map(([x, y]) => ({ x, y }));
      g.fillStyle(0xffce50).fillPoints(points, true);
      g.lineStyle(2, 0xfff1a0).strokePoints(points, true);
      g.fillStyle(0xff7a37).fillCircle(24, 21, 3);
    });
    make('fleet-scrap', 24, 24, g => {
      g.fillStyle(0xffffff, 0.13).fillCircle(12, 12, 11);
      g.fillStyle(0xffffff).fillPoints([{ x: 12, y: 4 }, { x: 20, y: 12 },
        { x: 12, y: 20 }, { x: 4, y: 12 }], true);
      g.fillStyle(0x172b43).fillRect(9, 9, 6, 6);
    });
    make('fleet-laser', 48, 16, g => {
      g.fillStyle(0xffffff, 0.08).fillRoundedRect(0, 0, 48, 16, 8);
      g.fillStyle(0xffffff, 0.25).fillRoundedRect(3, 4, 42, 8, 4);
      g.fillStyle(0xffffff).fillRoundedRect(8, 6, 32, 4, 2);
    });
    make('fleet-asteroid', 128, 128, g => {
      const points = Array.from({ length: 12 }, (_, i) => {
        const angle = i / 12 * Math.PI * 2, r = i % 3 === 0 ? 58 : 62;
        return { x: 64 + Math.cos(angle) * r, y: 64 + Math.sin(angle) * r };
      });
      g.fillStyle(0x152338).fillPoints(points, true);
      g.lineStyle(2, 0x536a86, 0.7).strokePoints(points, true);
      g.fillStyle(0x080f20, 0.65).fillCircle(45, 52, 15).fillCircle(80, 78, 20);
      g.lineStyle(1, 0x859bbb, 0.25).strokeCircle(42, 49, 16);
    });
    for (let layer = 0; layer < 3; layer++) {
      make('fleet-stars-' + layer, 512, 512, g => {
        // PRNG fijo: textura consistente al recargar y repetible para QA.
        let seed = 301 + layer;
        const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        for (let i = 0; i < 85 - layer * 22; i++) {
          g.fillStyle(layer === 0 ? 0x526c9f : 0xc8e6ff, 0.3 + random() * 0.5);
          g.fillCircle(random() * 512, random() * 512, 0.5 + layer * 0.45);
        }
      });
    }
    if (!scene.textures.exists('fleet-nebula')) {
      const texture = scene.textures.createCanvas('fleet-nebula', 512, 512);
      const ctx = texture.context;
      for (const [x, y, color] of [[140, 180, 'rgba(77,34,128,0.3)'], [360, 350, 'rgba(18,65,116,0.3)']]) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 235);
        gradient.addColorStop(0, color); gradient.addColorStop(1, 'rgba(3,4,12,0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
      }
      texture.refresh();
    }
  }
  function background(scene) {
    const layers = [['fleet-nebula', 0.04], ['fleet-stars-0', 0.1],
      ['fleet-stars-1', 0.2], ['fleet-stars-2', 0.3]].map(([key, factor], i) => {
      const sprite = scene.add.tileSprite(0, 0, scene.scale.width, scene.scale.height, key)
        .setOrigin(0).setScrollFactor(0).setDepth(-10 + i);
      return { sprite, factor };
    });
    const resize = size => layers.forEach(({ sprite }) => sprite.setSize(size.width, size.height));
    scene.scale.on('resize', resize);
    scene.events.once('shutdown', () => scene.scale.off('resize', resize));
    return layers;
  }
  global.FleetVisuals = { textures, background };
})(window);
