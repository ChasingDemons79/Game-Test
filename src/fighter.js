// Base class for anything that can be hit: the player, companions, enemies and bosses.
// Subclasses supply behaviour; this class handles position, the rig, hurt and death timing.

class Fighter {
  constructor(o = {}) {
    this.x = 0; this.y = 0; this.z = 0;
    this.yaw = 0;
    this.hp = o.hp; this.maxHp = o.hp;
    this.radius = o.radius ?? 0.6;
    this.dead = false;
    this.deathT = 0;
    this.hurt = 0;
    this.stagger = 0;
    this.stun = 0;
    this.moving = 0;
    this.act = null;
    this.animT = Math.random() * 10;
    this.group = new THREE.Group();
    this.rig = null;
  }

  setRig(rig) {
    this.rig = rig;
    this.group.add(rig.root);
  }

  // Start a timed action such as an attack, a roll or a windup.
  // `act.t` runs 0 to `act.dur`. `act.hit` lets an attack record that it already landed.
  startAct(type, dur, extra = {}) {
    this.act = { type, t: 0, dur, hit: false, ...extra };
    return this.act;
  }

  advanceAct(dt) {
    if (!this.act) return;
    this.act.t += dt;
    if (this.act.t >= this.act.dur) {
      const done = this.act;
      this.act = null;
      this.onActEnd?.(done);
    }
  }

  get actP() {
    return this.act ? Util.clamp(this.act.t / this.act.dur, 0, 1) : 0;
  }

  // Generic hit. Subclasses override to add blocking, rolls and so on.
  takeHit(dmg, fromX, fromZ, opts = {}) {
    if (this.dead) return 0;
    this.hp -= dmg;
    this.hurt = 0.3;
    this.stagger = Math.max(this.stagger, opts.stagger ?? 0.25);
    Fx.spark(this.x, this.y + 1.2, this.z, 0xff5a4a, 6);
    if (this.hp <= 0) {
      this.hp = 0;
      this.kill();
    }
    return dmg;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.act = null;
    this.onDeath?.();
  }

  faceToward(tx, tz, dt, rate = 8) {
    this.yaw = Util.turnToward(this.yaw, Util.angleTo(this.x, this.z, tx, tz), rate * dt);
  }

  // Keeps the visual group glued to the logical position.
  syncGroup() {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;
  }

  animate(dt, extra = {}) {
    this.animT += dt;
    this.hurt = Math.max(0, this.hurt - dt);
    if (this.dead) this.deathT += dt;
    if (this.rig) {
      this.rig.update({
        t: this.animT,
        moving: this.moving,
        act: this.act ? { type: this.act.type, p: this.actP } : null,
        blocking: this.blocking,
        dead: this.dead,
        deathP: this.deathT * 1.4,
        hurt: this.hurt,
        stun: this.stun,
        ...extra,
      });
    }
    this.syncGroup();
  }
}
