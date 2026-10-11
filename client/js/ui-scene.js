// The overlay camera never inherits world scroll, shake, post FX, or FOV.
(function (global) {
  'use strict';
  class UIScene extends Phaser.Scene {
    constructor() { super('UIScene'); }
    create() {
      this.cameras.main.setScroll(0, 0).setZoom(1);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      if (!this.textures.exists('escape-vignette')) {
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createRadialGradient(256, 256, 90, 256, 256, 340);
        gradient.addColorStop(0, 'rgba(180,0,15,0)'); gradient.addColorStop(1, 'rgba(240,0,30,1)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
        this.textures.addCanvas('escape-vignette', canvas);
      }
      this.lowHpVignette = this.add.image(0, 0, 'escape-vignette').setOrigin(.5).setScrollFactor(0).setDepth(90).setAlpha(0);
      this.resizeOverlay = () => {
        this.lowHpVignette.setPosition(this.scale.width / 2, this.scale.height / 2)
          .setDisplaySize(this.scale.width, this.scale.height);
      };
      this.resizeOverlay();
      this.scale.on('resize', this.resizeOverlay);
      this.game.events.on('camera_zoom_updated', this.resizeOverlay);
      this.events.once('shutdown', () => {
        this.scale.off('resize', this.resizeOverlay);
        this.game.events.off('camera_zoom_updated', this.resizeOverlay);
      });
      this.game.events.emit('fleet_ui_ready', this);
      this.scene.launch('GameScene');
    }
  }
  global.FleetUIScene = UIScene;
})(window);
