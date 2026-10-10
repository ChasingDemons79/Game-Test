// Companions are animals the player rides (mount) or summons for help (pet ally).
// A mount follows you around when you are on foot, and takes most of the damage while you ride.
// A pet is a smaller copy of the same species that fights until its time runs out.

class Companion extends Fighter {
  constructor(kind, { pet = false } = {}) {
    const def = MOUNTS[kind];
    const scale = pet ? 0.6 : 1;
    super({ hp: pet ? Math.round(def.hp * PET_TUNING.hpFactor) : def.hp, radius: pet ? 0.6 : 1.0 });
    this.kind = kind;
    this.def = def;
    this.isPet = pet;
    this.scale = scale;
    this.rider = null;
    this.abilityCD = 0;
    this.downed = false;
    this.ttl = pet ? PET_TUNING.duration : Infinity;
    this.attackCD = 0;
    this.attackFlash = 0;
    this.flying = def.flying;
    this.setRig(Rig.creature(kind, { scale }));
    if (!pet) this.maxHp = def.hp;
    this.syncGroup();
  }

  get mounted() { return !!this.rider; }

  // Pets die when they run out of hp. Mounts go down and must rest at a bonfire.
  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.downed = !this.isPet;
    this.onDeath?.(this);
  }

  // Pets are fragile and mounts absorb hits for their rider.
  takeHit(dmg, fromX, fromZ, opts = {}) {
    if (this.dead) return 0;
    this.hp -= dmg;
    this.hurt = 0.25;
    Fx.spark(this.x, this.y + 1.0, this.z, 0xffe0a0, 5);
    if (this.hp <= 0) {
      this.hp = 0;
      this.kill();
    }
    return dmg;
  }

  // Companions also act as a target for enemies that want to attack something other than the player.
  update(dt, player) {
    this.attackCD = Math.max(0, this.attackCD - dt);
    this.abilityCD = Math.max(0, this.abilityCD - dt);
    this.attackFlash = Math.max(0, this.attackFlash - dt);

    if (this.dead) {
      if (this.isPet) this.fadeOut(dt);
      this.animate(dt, { flying: false });
      return;
    }

    if (this.isPet) {
      this.updatePet(dt, player);
    } else if (this.rider) {
      this.x = player.x; this.z = player.z; this.y = player.y;
      this.yaw = player.yaw;
    } else {
      this.followRider(dt, player);
    }

    const moving = this.rider ? player.moving : this.moving;
    this.animate(dt, {
      moving: Util.clamp(moving, 0, 1),
      flying: this.flying && (this.y > World.heightAt(this.x, this.z) + 1.2),
      airborne: this.flying && this.y > World.heightAt(this.x, this.z) + 0.2,
      attack: this.attackFlash > 0,
    });
  }

  followRider(dt, player) {
    const d = Util.dist(this.x, this.z, player.x, player.z);
    if (d > 90) { this.teleportNear(player); return; }
    this.moving = 0;
    if (d > 6) {
      const speed = this.def.speed * 0.9;
      const a = Util.angleTo(this.x, this.z, player.x, player.z);
      this.yaw = Util.turnToward(this.yaw, a, 6 * dt);
      const step = Math.min(speed * dt, d - 4);
      this.x += Math.sin(this.yaw) * step;
      this.z += Math.cos(this.yaw) * step;
      this.moving = 0.8;
    }
    World.resolveObstacles(this, this.radius * 0.6);
    this.y = World.heightAt(this.x, this.z);
  }

  teleportNear(player) {
    this.x = player.x - Math.sin(player.yaw) * 2.5 + 1.5;
    this.z = player.z - Math.cos(player.yaw) * 2.5;
    this.y = World.heightAt(this.x, this.z);
    Fx.spark(this.x, this.y + 1, this.z, 0xa0d8ff, 12);
  }

  updatePet(dt, player) {
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.kill();
      return;
    }
    const foes = Game.hostileTargets();
    const target = Combat.nearest(this, foes, 16);
    let desiredX, desiredZ;
    this.moving = 0;
    if (target) {
      desiredX = target.x; desiredZ = target.z;
    } else {
      desiredX = player.x - Math.sin(player.yaw) * 2.5 + Math.cos(player.yaw) * 2;
      desiredZ = player.z - Math.cos(player.yaw) * 2.5 - Math.sin(player.yaw) * 2;
    }
    const d = Util.dist(this.x, this.z, desiredX, desiredZ);
    const stopAt = target ? 1.6 : 2.2;
    if (d > stopAt) {
      const speed = this.def.speed * (target ? 1.05 : 0.9);
      this.yaw = Util.turnToward(this.yaw, Util.angleTo(this.x, this.z, desiredX, desiredZ), 8 * dt);
      const step = Math.min(speed * dt, d - stopAt * 0.9);
      this.x += Math.sin(this.yaw) * step;
      this.z += Math.cos(this.yaw) * step;
      this.moving = 1;
    } else if (target) {
      this.faceToward(target.x, target.z, dt, 10);
    }
    World.resolveObstacles(this, this.radius * 0.6);
    const ground = World.heightAt(this.x, this.z);
    if (this.flying) {
      const hover = player.y + 2.2 + Math.sin(this.animT * 2) * 0.3;
      this.y = Util.lerp(this.y, hover, 1 - Math.exp(-4 * dt));
    } else {
      this.y = ground;
    }

    if (target && this.attackCD <= 0 && d < 2.4) {
      this.attackCD = PET_TUNING.attackEvery;
      this.attackFlash = 0.35;
      target.takeHit(PET_TUNING.damage * (Game.player.damageMult()), this.x, this.z, { stagger: 0.2 });
    }
  }

  fadeOut(dt) {
    this.deathT += dt;
    this.group.scale.setScalar(Math.max(0.01, 1 - this.deathT * 1.5));
    if (this.deathT > 0.7) this.removeFromWorld();
  }

  removeFromWorld() {
    this.removed = true;
    this.group.visible = false;
  }
}
