// Common enemies: soldiers, wolves, archers and crownguards. They patrol around a camp,
// chase what they notice, telegraph every attack with a windup, and respawn at bonfires.

class Enemy extends Fighter {
  constructor(type, x, z, opts = {}) {
    const def = ENEMY_TYPES[type];
    const scale = def.look.scale || 1;
    super({ hp: Math.round(def.hp * Game.difficulty.enemyHp), radius: 0.6 * scale });
    this.type = type;
    this.def = def;
    this.x = x; this.z = z;
    this.y = World.heightAt(x, z);
    this.home = { x, z };
    this.yaw = Math.random() * Math.PI * 2;
    this.wanderT = Math.random() * 3;
    this.wanderX = x; this.wanderZ = z;
    this.cd = Math.random();
    this.aggroLost = 0;
    this.dummy = !!opts.dummy;
    this.summoned = !!opts.summoned;
    this.target = null;
    this.scale = scale;
    if (def.humanoid) {
      this.setRig(Rig.humanoid({ ...def.look, scale }));
    } else {
      this.setRig(Rig.creature('wolf', { color: def.look.color, accent: def.look.accent, scale: 1 }));
    }
    this.syncGroup();
    if (this.dummy) this.hp = this.maxHp = 9999;
  }

  loseAggro(seconds) {
    this.aggroLost = seconds;
    this.target = null;
  }

  takeHit(dmg, fromX, fromZ, opts = {}) {
    if (this.dummy) {
      this.hurt = 0.3;
      this.stagger = Math.max(this.stagger, 0.2);
      Fx.spark(this.x, this.y + 1.2, this.z, 0xffe0a0, 6);
      return dmg;
    }
    if (!this.dead && this.aggroLost > 0) this.aggroLost = 0;
    return super.takeHit(dmg, fromX, fromZ, opts);
  }

  kill() {
    if (this.dead) return;
    super.kill();
    Game.onEnemyDeath(this);
  }

  // Which of the player's allies or the player itself this enemy should pursue.
  pickTarget() {
    const player = Game.player;
    let best = null, bd = this.def.aggro;
    if (!player.dead) {
      const d = Util.dist(this.x, this.z, player.x, player.z);
      if (d < bd) { bd = d; best = player; }
    }
    const pet = Game.pet;
    if (pet && !pet.dead && !pet.removed) {
      const d = Util.dist(this.x, this.z, pet.x, pet.z);
      if (d < this.def.aggro * 0.8 && d < bd) { best = pet; }
    }
    return best;
  }

  update(dt) {
    if (this.dead) {
      this.y -= dt * 0.35;
      this.animate(dt);
      return;
    }
    if (this.dummy) {
      this.animate(dt);
      return;
    }
    this.cd = Math.max(0, this.cd - dt);
    this.aggroLost = Math.max(0, this.aggroLost - dt);
    if (this.stun > 0) {
      this.stun -= dt;
      this.animate(dt, { stunned: true });
      return;
    }
    if (this.stagger > 0) {
      this.stagger -= dt;
      if (this.act && this.act.type === 'windup') this.act = null;
      this.animate(dt);
      return;
    }

    this.advanceAct(dt);
    this.moving = 0;
    const target = this.aggroLost > 0 ? null : this.pickTarget();
    this.target = target;

    if (this.act) {
      if (this.act.type === 'windup') this.faceToward(target?.x ?? this.x, target?.z ?? this.z, dt, 4);
      this.animate(dt);
      return;
    }

    if (target) {
      const d = Util.dist(this.x, this.z, target.x, target.z);
      const reach = this.def.range + target.radius;
      const standoff = this.def.ranged ? this.def.range * 0.65 : reach * 0.8;
      this.faceToward(target.x, target.z, dt, 6);
      if (d > standoff) {
        this.stepToward(target.x, target.z, this.def.speed * (this.def.ranged ? 0.9 : 1), dt);
      } else if (this.def.ranged && d < 7) {
        this.stepToward(this.x - (target.x - this.x), this.z - (target.z - this.z), this.def.speed * 0.6, dt);
      } else if (this.cd <= 0 && d <= (this.def.ranged ? this.def.range : reach + 0.3)) {
        this.startAct('windup', this.def.windup);
        this.moving = 0;
      }
    } else {
      this.patrol(dt);
    }

    this.separate();
    World.resolveObstacles(this, this.radius * 0.8);
    this.y = World.heightAt(this.x, this.z);
    this.animate(dt);
  }

  stepToward(tx, tz, speed, dt) {
    const d = Util.dist(this.x, this.z, tx, tz);
    if (d < 0.05) return;
    const step = Math.min(speed * dt, d);
    this.yaw = Util.turnToward(this.yaw, Util.angleTo(this.x, this.z, tx, tz), 8 * dt);
    this.x += (tx - this.x) / d * step;
    this.z += (tz - this.z) / d * step;
    this.moving = 1;
  }

  patrol(dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = 3 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 10;
      this.wanderX = this.home.x + Math.cos(a) * r;
      this.wanderZ = this.home.z + Math.sin(a) * r;
    }
    if (Util.dist(this.x, this.z, this.wanderX, this.wanderZ) > 0.6) {
      this.stepToward(this.wanderX, this.wanderZ, this.def.speed * 0.35, dt);
    }
  }

  separate() {
    for (const o of Game.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.2 * 1.2 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = (1.2 - d) * 0.5;
        this.x += (dx / d) * push * 0.5;
        this.z += (dz / d) * push * 0.5;
      }
    }
  }

  // Called when the windup ends. Strikes once, then recovers.
  onActEnd(done) {
    if (done.type === 'windup') {
      this.strike();
      this.startAct('recover', this.def.recover);
    } else if (done.type === 'recover') {
      this.cd = 0.4 + Math.random() * 0.4;
    }
  }

  strike() {
    const target = this.target && !this.target.dead ? this.target : Game.player;
    if (this.def.ranged) {
      const dx = target.x - this.x, dz = target.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      const y0 = this.y + 1.4;
      Sound.play('arrow');
      Fx.projectile({
        x: this.x, y: y0, z: this.z,
        dir: { x: dx / d, y: (target.y + 1.1 - y0) / d * 0.6, z: dz / d },
        speed: 18, dmg: this.def.dmg, r: 0.18, life: 3, color: 0xd9c08a,
      });
      return;
    }
    const d = Util.dist(this.x, this.z, target.x, target.z);
    if (d < this.def.range + target.radius + 0.5) {
      target.takeHit(this.def.dmg, this.x, this.z, { stagger: 0.3 });
    }
  }
}
