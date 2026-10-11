// Fixture opt-in para QA visual. Solo se precarga con `preview --events`;
// el entrypoint de producción y Docker jamás importan este archivo.
'use strict';
const { WorldEvents } = require('../server/worldEvents');
const { Player } = require('../server/entities');
const update = WorldEvents.prototype.update;
WorldEvents.prototype.update = function (now = Date.now()) {
  const human = [...this.room.players.values()].find(p => !p.isBot);
  if (human && !this.previewStarted) {
    this.previewStarted = now; human.x = human.y = human.targetX = human.targetY = 2000;
    human.spawnProtectionUntil = now + 60000;
    this.award(human, 5000, 'visual-test');
    this.scatter(2080, 2000, 70, 20, 24, now);
    const coreId = this.id('core'); this.cores.set(coreId, { id: coreId, ownerId: human.id,
      x: 3500, y: 3500, xp: 500, expires: now + 45000 });
    const rival = new Player('preview-rival', 'QA Bounty');
    rival.x = rival.targetX = 2600; rival.y = rival.targetY = 2300; rival.level = 40;
    rival.spawnProtectionUntil = now + 60000; this.room.players.set(rival.id, rival);
    this.nextMeteor = now + 15000; this.nextBoss = now + 1000;
  }
  update.call(this, now);
  if (this.boss && !this.previewBossPlaced) {
    this.previewBossPlaced = true; this.boss.x = 2250; this.boss.y = 2050;
    this.boss.hp = this.boss.maxHp = 300;
  }
  if (human && this.previewStarted && now - this.previewStarted > 5000 && !this.previewEffects) {
    this.previewEffects = true;
    ['FROST_SHATTER', 'BLACK_HOLE', 'NEON_GRAFFITI'].forEach((effect, i) => this.emit('death_fx', {
      id: `preview:${i}`, effect, x: human.x + 120 + i * 75, y: human.y + 100 }));
  }
};
