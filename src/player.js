// The player: movement, combat actions, mounts, pet summons, damage and death.

class Player extends Fighter {
  constructor() {
    super({ hp: CONFIG.PLAYER.hp, radius: CONFIG.PLAYER.radius });
    this.stats = { vigor: 1, end: 1, str: 1 };
    this.souls = 0;
    this.flasks = 5;
    this.maxStamina = CONFIG.PLAYER.stamina;
    this.stamina = this.maxStamina;
    this.staminaDelay = 0;
    this.blocking = false;
    this.iframes = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.grounded = true;
    this.dash = null;
    this.breathT = 0;
    this.rider = null;        // Companion being ridden
    this.counts = { attacks: 0, rolls: 0, flasks: 0, blocks: 0, mounts: 0, summons: 0, moved: 0 };
    this.setRig(Rig.humanoid({
      armor: 0x7b8ba0, cloth: 0x4a3a2a, skin: 0xd8b89a, helm: 0x8d98a8, legs: 0x3a3228,
      cape: 0x7a1f2a, weapon: 'sword', shield: 0x6e4a2b,
    }));
  }

  recalcStats(keepRatio = true) {
    const oldMax = this.maxHp;
    this.maxHp = CONFIG.PLAYER.hp + (this.stats.vigor - 1) * CONFIG.PLAYER.hpPerVigor;
    if (keepRatio && oldMax) this.hp = Math.min(this.maxHp, this.hp * (this.maxHp / oldMax));
    else this.hp = Math.min(this.hp, this.maxHp);
    this.maxStamina = CONFIG.PLAYER.stamina + (this.stats.end - 1) * CONFIG.PLAYER.staminaPerEnd;
    this.stamina = Math.min(this.stamina, this.maxStamina);
  }

  damageMult() {
    return 1 + (this.stats.str - 1) * CONFIG.PLAYER.damagePerStr;
  }

  get baseDamage() {
    return CONFIG.PLAYER.baseDamage * this.damageMult();
  }

  // Companion attached to the player, if any.
  get mountEntity() {
    return this.rider;
  }

  syncGroup() {
    const off = this.rider ? MOUNTS[this.rider.kind].saddle : 0;
    this.group.position.set(this.x, this.y + off, this.z);
    this.group.rotation.y = this.yaw;
  }

  reset(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vz = this.vy = 0;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.dead = false;
    this.deathT = 0;
    this.act = null;
    this.dash = null;
    this.stagger = 0;
    this.blocking = false;
    this.group.scale.setScalar(1);
    this.rig.roll.rotation.set(0, 0, 0);
    this.syncGroup();
  }

  update(dt, cam) {
    if (this.dead) {
      this.animate(dt);
      return;
    }
    if (this.iframes > 0) this.iframes -= dt;
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    this.breathT = Math.max(0, this.breathT - dt);

    const mv = Input.move();
    const fwdX = Math.sin(cam.yaw), fwdZ = Math.cos(cam.yaw);
    const rightX = -fwdZ, rightZ = fwdX;
    let wx = fwdX * mv.y + rightX * mv.x;
    let wz = fwdZ * mv.y + rightZ * mv.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const hasMove = wl > 0.05;

    // Stance and utility actions
    if (Input.pressed('mount')) this.toggleMount();
    if (Input.pressed('summon')) Game.trySummonPet();
    if (Input.pressed('flask')) this.useFlask();
    if (Input.pressed('ability')) this.useAbility();
    if (Input.pressed('lock')) Game.toggleLock();

    const attackingNow = this.act && (this.act.type === 'light' || this.act.type === 'heavy');
    const rolling = this.act && this.act.type === 'roll';

    // Guard. Blocking drains stamina, and an empty bar drops the guard.
    this.blocking = Input.held('block') && this.stamina > 0 && !attackingNow && !rolling && this.stagger <= 0;
    if (this.blocking) {
      this.stamina = Math.max(0, this.stamina - CONFIG.PLAYER.blockDrain * dt);
      this.staminaDelay = 0.6;
      this.counts.blocks += dt;
    }

    if (!this.act && this.stagger <= 0 && !this.dash) {
      if (!this.blocking && Input.pressed('light')) this.startAttack('light');
      else if (!this.blocking && Input.pressed('heavy')) this.startAttack('heavy');
      else if (Input.pressed('dodge') && !this.rider && this.stamina >= 18) this.startRoll(wx, wz, hasMove);
    }
    if (this.rider && Input.pressed('jump') && this.grounded && !this.rider.def.flying && !this.act) {
      this.vy = CONFIG.PLAYER.jump * (this.rider.def.jump / 8 || 1);
      this.grounded = false;
    }

    // Stagger cancels any action in progress.
    if (this.stagger > 0) {
      this.stagger -= dt;
      if (this.act && this.act.type !== 'roll') this.act = null;
    }

    this.advanceAct(dt);
    this.resolveAttackHit();
    this.updateBreath(dt);

    // Movement
    const ground = World.heightAt(this.x, this.z);
    const sprint = Input.held('sprint') && this.stamina > 0 && hasMove && !this.blocking;
    if (sprint && !this.rider) this.stamina = Math.max(0, this.stamina - 6 * dt);
    let speed = sprint ? CONFIG.PLAYER.run : CONFIG.PLAYER.walk;
    if (this.rider) speed = this.rider.def.speed * (sprint ? this.rider.def.sprint : 1);
    if (this.blocking) speed *= 0.35;
    if (attackingNow) speed *= 0.25;
    if (ground < -0.8) speed *= 0.6;

    let targetVx = wx * speed, targetVz = wz * speed;
    if (this.dash) {
      targetVx = this.dash.dx * this.dash.speed;
      targetVz = this.dash.dz * this.dash.speed;
      this.updateDash(dt);
    } else if (this.act && this.act.type === 'roll') {
      // Read the roll after advanceAct, which can end the roll this frame.
      targetVx = this.act.dx * CONFIG.PLAYER.roll;
      targetVz = this.act.dz * CONFIG.PLAYER.roll;
      if (this.act.t > 0.1) this.iframes = Math.max(this.iframes, CONFIG.PLAYER.rollIframes);
    }
    const accel = 1 - Math.exp(-(this.act && this.act.type === 'roll' ? 30 : 12) * dt);
    this.vx = Util.lerp(this.vx, targetVx, accel);
    this.vz = Util.lerp(this.vz, targetVz, accel);
    const prevX = this.x, prevZ = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (!this.dash || this.dash.kind !== 'pounce') World.resolveObstacles(this, this.radius);
    const moved = Util.dist(prevX, prevZ, this.x, this.z);
    this.counts.moved += moved;
    this.moving = Util.clamp(Math.hypot(this.vx, this.vz) / CONFIG.PLAYER.walk, 0, 2) * 0.5;

    // Facing
    if (Game.lockTarget && !Game.lockTarget.dead) {
      this.faceToward(Game.lockTarget.x, Game.lockTarget.z, dt, 14);
    } else if (this.blocking || attackingNow) {
      this.yaw = Util.turnToward(this.yaw, cam.yaw, 14 * dt);
    } else if (hasMove && Math.hypot(this.vx, this.vz) > 0.3) {
      this.yaw = Util.turnToward(this.yaw, Math.atan2(this.vx, this.vz), 12 * dt);
    }

    this.updateVertical(dt, ground);

    // Stamina regen
    if (!this.blocking && !this.act && this.staminaDelay <= 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 24 * dt);
    } else if (!this.blocking && this.act && this.staminaDelay <= 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 8 * dt);
    }

    // The rider's pose changes when mounted.
    this.animate(dt, { mounted: !!this.rider });
    this.syncGroup();
  }

  updateVertical(dt, ground) {
    const flyer = this.rider && this.rider.def.flying;
    if (flyer) {
      const up = Input.held('jump') ? 1 : 0, down = Input.held('descend') ? 1 : 0;
      const target = (up - down) * 9;
      this.vy = Util.lerp(this.vy, target, 1 - Math.exp(-5 * dt));
      this.y += this.vy * dt;
      this.y = Math.max(this.y, ground + 1.2);
      this.grounded = this.y <= ground + 1.25;
      return;
    }
    if (this.y > ground + 0.02 || this.vy > 0) {
      this.vy -= CONFIG.PLAYER.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else {
      this.y = ground;
      this.vy = 0;
      this.grounded = true;
    }
  }

  startRoll(wx, wz, hasMove) {
    const dx = hasMove ? wx : Math.sin(this.yaw);
    const dz = hasMove ? wz : Math.cos(this.yaw);
    this.stamina -= 18;
    this.staminaDelay = 0.8;
    this.counts.rolls++;
    const act = this.startAct('roll', CONFIG.PLAYER.rollTime);
    act.dx = dx; act.dz = dz;
    this.yaw = Math.atan2(dx, dz);
  }

  startAttack(kind) {
    const cost = kind === 'heavy' ? CONFIG.PLAYER.heavyCost : CONFIG.PLAYER.lightCost;
    if (this.stamina < cost) {
      Game.msg('Too tired to attack');
      return;
    }
    this.stamina -= cost;
    this.staminaDelay = 0.8;
    this.counts.attacks++;
    this.startAct(kind, kind === 'heavy' ? 1.1 : 0.55);
  }

  // Strikes land inside the middle window of each swing.
  resolveAttackHit() {
    const a = this.act;
    if (!a || (a.type !== 'light' && a.type !== 'heavy') || a.hit) return;
    const p = a.t / a.dur;
    const heavy = a.type === 'heavy';
    const strike = heavy ? [0.55, 0.78] : [0.38, 0.6];
    if (p < strike[0] || p > strike[1]) return;
    const range = (heavy ? 2.9 : 2.3) + (this.rider ? 0.6 : 0);
    const dmg = this.baseDamage * (heavy ? 2.4 : 1) * (this.rider ? 1.1 : 1);
    const hits = Combat.cone(this, Game.hostileTargets(), range, heavy ? 1.6 : 1.9, dmg, { stagger: heavy ? 0.45 : 0.2 });
    if (hits > 0) a.hit = true;
  }

  startDash(kind, dx, dz, speed, dur) {
    this.dash = { kind, dx, dz, speed, t: 0, dur, hitSet: new Set(), tick: 0 };
    this.yaw = Math.atan2(dx, dz);
  }

  updateDash(dt) {
    const d = this.dash;
    d.t += dt;
    d.tick -= dt;
    if (d.kind === 'charge' || d.kind === 'shadow') {
      if (d.tick <= 0) {
        d.tick = 0.1;
        for (const t of Game.hostileTargets()) {
          if (d.hitSet.has(t) || t.dead) continue;
          if (Util.dist(this.x, this.z, t.x, t.z) < 2.4) {
            d.hitSet.add(t);
            t.takeHit(this.baseDamage * 1.4, this.x, this.z, { stagger: 0.5 });
          }
        }
      }
    }
    if (d.kind === 'pounce' && d.t > 0.15 && this.grounded) {
      Combat.radial(this.x, this.z, 4.5, Game.hostileTargets(), this.baseDamage * 1.6, { stagger: 0.5 });
      Fx.ring(this.x, this.y, this.z, 5, 0xffd080, 0.45);
      this.dash = null;
      return;
    }
    if (d.t >= d.dur) this.dash = null;
  }

  toggleMount() {
    if (this.rider) {
      this.dismount();
      return;
    }
    const comp = Game.companion;
    if (!comp) { Game.msg('You have no companion. Choose one at a bonfire.'); return; }
    if (comp.downed) { Game.msg(`${comp.def.name} is wounded. Rest at a bonfire to recover it.`); return; }
    if (Util.dist(this.x, this.z, comp.x, comp.z) > 6) comp.teleportNear(this);
    this.rider = comp;
    comp.rider = this;
    comp.yaw = this.yaw;
    this.counts.mounts++;
    Game.msg(`Mounted ${comp.def.name}`);
  }

  dismount() {
    const comp = this.rider;
    if (!comp) return;
    comp.rider = null;
    this.rider = null;
    this.x += Math.sin(this.yaw + Math.PI / 2) * 1.5;
    this.z += Math.cos(this.yaw + Math.PI / 2) * 1.5;
    this.vy = 0;
    this.y = World.heightAt(this.x, this.z);
    comp.x = this.x - Math.sin(this.yaw) * 1.2;
    comp.z = this.z - Math.cos(this.yaw) * 1.2;
    comp.y = World.heightAt(comp.x, comp.z);
  }

  // Mount abilities. Each one costs no stamina but has a cooldown.
  useAbility() {
    const comp = this.rider;
    if (!comp) { Game.msg('Ride a companion to use its ability'); return; }
    if (comp.abilityCD > 0) { Game.msg(`${comp.def.abilityName} ready in ${comp.abilityCD.toFixed(1)}s`); return; }
    comp.abilityCD = MOUNT_TUNING.abilityCooldown;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    switch (comp.def.ability) {
      case 'charge':
        this.startDash('charge', fx, fz, 18, 0.6);
        Fx.spark(this.x, this.y + 1, this.z, 0xffe0a0, 14);
        break;
      case 'pounce':
        this.vy = 9;
        this.grounded = false;
        this.startDash('pounce', fx, fz, 14, 0.9);
        break;
      case 'shadow':
        this.startDash('shadow', fx, fz, 20, 0.35);
        this.iframes = 0.6;
        for (const e of Game.enemies) if (!e.dead && Util.dist(this.x, this.z, e.x, e.z) < 25) e.loseAggro(4);
        Fx.ring(this.x, this.y + 1, this.z, 3, 0x6a6a90, 0.5);
        break;
      case 'breath':
        this.breathT = 2.4;
        Game.msg('Fire Breath');
        break;
      case 'coil':
        Fx.ring(this.x, this.y, this.z, 9, 0xd8c04a, 0.6);
        Combat.radial(this.x, this.z, 9, Game.hostileTargets(), this.baseDamage * 1.2, { stagger: 0.8 });
        for (const e of Game.hostileTargets()) {
          if (!e.dead && Util.dist(this.x, this.z, e.x, e.z) < 9) e.stun = Math.max(e.stun, 2);
        }
        break;
    }
  }

  // Dragon breath is a steady cone that runs for its full duration.
  updateBreath(dt) {
    if (!this.rider || this.rider.kind !== 'dragon' || this.breathT <= 0) return;
    this.breathCD = (this.breathCD || 0) - dt;
    if (this.breathCD <= 0) {
      this.breathCD = 0.15;
      Combat.cone(this, Game.hostileTargets(), 13, 0.9, this.baseDamage * 0.35, { stagger: 0.05 });
      for (let i = 0; i < 3; i++) {
        const d = 3 + Math.random() * 9;
        Fx.spark(this.x + Math.sin(this.yaw) * d, this.y + 1.5, this.z + Math.cos(this.yaw) * d, 0xff8030, 3);
      }
    }
  }

  useFlask() {
    if (this.flasks <= 0) { Game.msg('No flask charges left. Rest at a bonfire.'); return; }
    if (this.hp >= this.maxHp) { Game.msg('You are already at full health'); return; }
    this.flasks--;
    this.counts.flasks++;
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * CONFIG.PLAYER.flaskHeal);
    Fx.spark(this.x, this.y + 1.2, this.z, 0x7dff9a, 14);
    Game.msg('Flask used');
  }

  // Damage pipeline: difficulty scaling, dodge frames, block and rider-mount absorption.
  takeHit(dmg, fromX, fromZ, opts = {}) {
    if (this.dead) return 0;
    if (this.iframes > 0 && opts.source !== 'poison') return 0;
    let amount = dmg * Game.difficulty.enemyDamage;

    const ang = Util.angleTo(this.x, this.z, fromX, fromZ);
    const frontal = Math.abs(Util.wrap(ang - this.yaw)) < 1.9;
    if (this.blocking && frontal) {
      this.stamina -= amount * 1.1;
      this.staminaDelay = 1.0;
      amount *= 0.2;
      Fx.spark(this.x, this.y + 1.4, this.z, 0xbfe6ff, 8);
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.blocking = false;
        Game.msg('Guard broken!');
        this.stagger = Math.max(this.stagger, 0.8);
      }
    }

    if (this.rider && !opts.noMount) {
      const comp = this.rider;
      const share = amount * 0.7;
      amount -= share;
      comp.hp -= share;
      comp.hurt = 0.3;
      if (comp.hp <= 0) {
        comp.hp = 0;
        comp.downed = true;
        this.dismount();
        Game.msg(`${comp.def.name} collapsed! Rest at a bonfire to revive it.`);
        comp.kill();
      }
    }

    this.hp -= amount;
    this.hurt = 0.3;
    this.stagger = Math.max(this.stagger, opts.stagger ?? 0.3);
    if (opts.stagger !== 0) Fx.spark(this.x, this.y + 1.3, this.z, 0xff5a4a, 6);
    Game.onPlayerHurt(amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.kill();
    }
    return amount;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.blocking = false;
    this.dash = null;
    this.act = null;
    Game.onPlayerDeath();
  }
}
