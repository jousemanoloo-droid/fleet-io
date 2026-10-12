// Predicción a paso fijo + replay de entradas aún no confirmadas por el servidor.
(function (global) {
  'use strict';
  class PredictedPlayer {
    constructor(state) { this.reset(state); }
    reset(state) {
      this.state = { ...state, vx: state.vx || 0, vy: state.vy || 0 };
      this.pending = []; this.accumulator = 0;
      this.offsetX = this.offsetY = 0;
    }
    reconcile(server, world, obstacles) {
      if (server.hp <= 0) return;
      if ((server.motionRevision || 0) < (this.state.motionRevision || 0)) return;
      if ((server.motionRevision || 0) !== (this.state.motionRevision || 0)) { this.reset(server); return; }
      this.pending = this.pending.filter(input => input.seq > (server.inputSeq || 0));
      const replay = { ...server };
      for (const input of this.pending) {
        global.FleetMovement.step(replay, input, world, obstacles);
        if (replay.revengeRemaining > 0) {
          replay.revengeRemaining = Math.max(0,replay.revengeRemaining-global.FleetMovement.STEP_MS);
          if (!replay.revengeRemaining) replay.speedMultiplier=1;
        }
      }
      const dx = this.state.x - replay.x, dy = this.state.y - replay.y;
      // Rebasar SIEMPRE la simulación, también para errores pequeños. Esperar a
      // acumular 15 px producía correcciones periódicas en forma de dientes de sierra.
      // El offset conserva la posición visible mientras se corrige la simulación.
      this.offsetX += dx; this.offsetY += dy;
      this.state.x = replay.x; this.state.y = replay.y;
      this.state.vx = replay.vx; this.state.vy = replay.vy;
      this.state.maxSpeed = server.maxSpeed;
      this.state.levelUpPending = server.levelUpPending;
      this.state.evolutionPending = server.evolutionPending;
      this.state.powerOverclockRemaining = replay.powerOverclockRemaining;
      this.state.dashing = !!server.dashing;
      this.state.slowed = !!server.slowed;
      this.state.boosted = !!server.boosted;
      this.state.speedMultiplier = replay.speedMultiplier || 1;
      this.state.revengeRemaining = replay.revengeRemaining || 0;
      for (const key of ['overdriveRemaining','comboCount','comboTimer','slingshotRemaining','teleportRemaining','kickX','kickY','kickAppliedX','kickAppliedY','gravityWell']) this.state[key]=replay[key];
    }
    advance(delta, target, world, obstacles, send) {
      const model = global.FleetMovement;
      this.accumulator += Math.min(100, Math.max(0, delta));
      while (this.accumulator + 1e-7 >= model.STEP_MS) {
        const input = send(target);
        if (input) {
          this.pending.push(input);
          // Cola acotada también durante una desconexión prolongada.
          if (this.pending.length > 120) this.pending.shift();
        }
        model.step(this.state, input || target, world, obstacles);
        if (this.state.revengeRemaining > 0) {
          this.state.revengeRemaining = Math.max(0,this.state.revengeRemaining-model.STEP_MS);
          if (!this.state.revengeRemaining) this.state.speedMultiplier = 1;
        }
        this.accumulator = Math.max(0, this.accumulator - model.STEP_MS);
      }
      const error = Math.hypot(this.offsetX, this.offsetY);
      if (error > 0) {
        const seconds = Math.min(100, Math.max(0, delta)) / 1000;
        const speed = Math.hypot(this.state.vx, this.state.vy) * 30;
        // Un lerp de 0.2 sin límite podía descontar más distancia que la nave
        // recorría en un frame y hacerla retroceder. Corregir como máximo al 25%
        // de la velocidad de avance (12 px/s en reposo), sin depender de los FPS.
        const maxCorrection = Math.max(12, speed * 0.25) * seconds;
        const fraction = Math.min(1 - Math.pow(0.8, seconds * 60), maxCorrection / error);
        this.offsetX *= 1 - fraction; this.offsetY *= 1 - fraction;
      }
      // Vista predictiva del paso siguiente: responde incluso antes del primer tick.
      const t = this.accumulator / model.STEP_MS;
      const next = { ...this.state };
      model.step(next, target, world, obstacles);
      return {
        x: this.state.x + (next.x - this.state.x) * t + this.offsetX,
        y: this.state.y + (next.y - this.state.y) * t + this.offsetY,
        rotation: this.state.rotation || 0, vx: this.state.vx, vy: this.state.vy,
      };
    }
  }
  global.FleetPredictedPlayer = PredictedPlayer;
})(window);
