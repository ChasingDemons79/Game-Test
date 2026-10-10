// Guardians of the realm and the Hollow Crowned King.
// Each boss is a list of timed attacks. The shared Boss class handles phases, windups,
// scheduled follow-up hits, and the dashes and dives some attacks need.

class Boss extends Fighter {
  constructor(def, site) {
    super({ hp: Math.round(def.hp * Game.difficulty.bossHp), radius: def.radius });
    this.def = def;
    this.site = site;
    this.id = def.id;
    this.name = def.name;
    this.title = def.title;
    this.x = site.x; this.z = site.z;
    this.spawnX = site.x; this.spawnZ = site.z;
    this.y = World.heightAt(site.x, site.z) + (def.flyHeight || 0);
    this.yTarget = this.y;
    this.active = false;
    this.phase = 0;
    this.cd = 2;
    this.pending = null;
    this.lastAttackId = null;
    this.tickFn = null;
    this.schedule = [];
    this.speedMult = 1;
    this.buffT = 0;
    this.setRig(def.rig());
    if (def.aura) {
      const aura = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), new THREE.MeshBasicMaterial({ color: def.aura, transparent: true, opacity: 0.18, depthWrite: false }));
      aura.position.y = 1.2 * def.scale;
      this.group.add(aura);
    }
    this.syncGroup();
  }

  takeHit(dmg, fromX, fromZ, opts = {}) {
    if (this.dead) return 0;
    if (!this.active) this.activate();
    // Bosses have super armor: hits chip them without interrupting an attack.
    return super.takeHit(dmg, fromX, fromZ, { ...opts, stagger: 0 });
  }

  kill() {
    if (this.dead) return;
    super.kill();
    Game.onBossDefeated(this);
  }

  activate() {
    if (this.active || this.dead) return;
    this.active = true;
    this.cd = 1.2;
    Game.onBossActivated(this);
  }

  reset() {
    this.hp = this.maxHp;
    this.dead = false;
    this.deathT = 0;
    this.active = false;
    this.phase = 0;
    this.act = null;
    this.tickFn = null;
    this.schedule = [];
    this.pending = null;
    this.cd = 2;
    this.x = this.spawnX; this.z = this.spawnZ;
    this.y = World.heightAt(this.x, this.z) + (this.def.flyHeight || 0);
    this.yTarget = this.y;
    this.group.visible = true;
    this.group.rotation.z = 0;
    this.speedMult = 1;
    this.buffT = 0;
    this.syncGroup();
  }

  // Runs `fn` after `seconds`. Used for multi-hit combos and delayed projectiles.
  later(seconds, fn) {
    this.schedule.push({ t: seconds, fn });
  }

  // Dash in a direction for a fixed time. `onTick` returns true to stop early.
  dash(dx, dz, speed, dur, onTick) {
    let t = 0;
    const d = Math.hypot(dx, dz) || 1;
    this.yaw = Math.atan2(dx / d, dz / d);
    this.tickFn = dt => {
      t += dt;
      this.x += (dx / d) * speed * dt;
      this.z += (dz / d) * speed * dt;
      World.resolveObstacles(this, this.radius * 0.8);
      const stop = onTick?.(dt);
      if (stop || t >= dur) {
        this.tickFn = null;
        return true;
      }
      return false;
    };
  }

  targets() {
    return [Game.player, Game.pet].filter(t => t && !t.dead);
  }

  faceAt(x, z) { this.yaw = Util.angleTo(this.x, this.z, x, z); }

  update(dt) {
    if (this.dead) {
      this.deathT += dt;
      this.y = Util.lerp(this.y, World.heightAt(this.x, this.z) - 1.2, 1 - Math.exp(-1.5 * dt));
      this.group.rotation.z = -Math.min(1, this.deathT) * 0.9;
      this.animate(dt);
      return;
    }
    if (!this.active) {
      this.animate(dt);
      return;
    }

    // Phase transitions
    const f = this.hp / this.maxHp;
    const p = f > 0.66 ? 0 : f > 0.33 ? 1 : 2;
    if (p > this.phase) {
      this.phase = p;
      this.act = null;
      this.pending = null;
      this.tickFn = null;
      this.cd = 1.0;
      this.speedMult = 1 + p * 0.15;
      Game.onBossPhase(this, p);
    }

    if (this.stun > 0) {
      this.stun -= dt;
      this.animate(dt);
      return;
    }

    for (let i = this.schedule.length - 1; i >= 0; i--) {
      const s = this.schedule[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.schedule.splice(i, 1);
        s.fn();
      }
    }

    if (this.tickFn) this.tickFn(dt);
    this.buffT = Math.max(0, this.buffT - dt);
    this.advanceAct(dt);

    // Vertical motion for flyers
    if (this.def.flyHeight) {
      this.y = Util.lerp(this.y, this.yTarget, 1 - Math.exp(-4 * dt));
    }

    if (this.act) {
      if (this.act.type === 'windup') this.faceAt(Game.player.x, Game.player.z);
      this.animate(dt, { flying: !!this.def.flyHeight, airborne: !!this.def.flyHeight });
      return;
    }
    if (this.tickFn) {
      this.animate(dt, { flying: !!this.def.flyHeight, airborne: !!this.def.flyHeight });
      return;
    }

    const player = Game.player;
    const d = Util.dist(this.x, this.z, player.x, player.z);
    this.cd -= dt;
    if (this.cd <= 0 && !player.dead) {
      const choice = this.chooseAttack(d);
      if (choice) {
        this.pending = choice;
        this.lastAttackId = choice.id;
        this.faceAt(player.x, player.z);
        this.startAct('windup', choice.windup * (this.phase === 2 ? 0.8 : 1));
        Sound.play('warn');
        this.animate(dt);
        return;
      }
    }

    // Movement
    this.faceAt(player.x, player.z);
    const speed = this.def.speed * this.speedMult * (this.buffT > 0 ? 1.5 : 1);
    if (d > this.def.keepDist) {
      const step = Math.min(speed * dt, d - this.def.keepDist);
      this.x += (player.x - this.x) / d * step;
      this.z += (player.z - this.z) / d * step;
      this.moving = 1;
    } else {
      this.moving = 0;
    }
    World.resolveObstacles(this, this.radius * 0.8);
    if (!this.def.flyHeight) this.y = World.heightAt(this.x, this.z);
    this.animate(dt, { flying: !!this.def.flyHeight, airborne: !!this.def.flyHeight });
  }

  chooseAttack(dist) {
    const candidates = this.def.attacks.filter(a =>
      (a.minPhase || 0) <= this.phase &&
      dist >= (a.minDist || 0) &&
      dist <= (a.maxDist ?? 99) &&
      a.id !== this.lastAttackId
    );
    if (!candidates.length) return null;
    const total = candidates.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * total;
    for (const a of candidates) {
      r -= a.weight;
      if (r <= 0) return a;
    }
    return candidates[candidates.length - 1];
  }

  onActEnd(done) {
    if (done.type === 'windup' && this.pending) {
      const atk = this.pending;
      this.pending = null;
      atk.strike(this);
      this.startAct('recover', atk.recover);
    } else if (done.type === 'recover') {
      this.cd = this.def.cooldown * (this.phase === 2 ? 0.7 : 1) * (0.8 + Math.random() * 0.4);
    }
  }
}

// Helper for the Emberwyrm's flight. Dives to the target and lands with a shockwave.
function bossDive(b, tx, tz, onLand) {
  b.yTarget = World.heightAt(tx, tz);
  const sx = tx - b.x, sz = tz - b.z;
  b.faceAt(tx, tz);
  let landed = false;
  b.tickFn = dt => {
    if (!landed) {
      b.x += sx * Math.min(1, dt * 2.2);
      b.z += sz * Math.min(1, dt * 2.2);
      b.y = Util.lerp(b.y, b.yTarget, Math.min(1, dt * 5));
      if (b.y <= b.yTarget + 0.6) {
        landed = true;
        onLand?.();
        b.yTarget = World.heightAt(b.spawnX, b.spawnZ) + b.def.flyHeight;
      }
      return false;
    }
    b.tickFn = null;
    return true;
  };
}

const BOSS_DEFS = {
  gorath: {
    id: 'gorath', name: 'Gorath, the Bonewarden', title: 'Guardian of the Crypt', hp: 900, radius: 1.6,
    speed: 2.6, keepDist: 2.6, cooldown: 1.6, scale: 2.6, souls: 600, flyHeight: 0,
    intro: 'The dead do not rest here.',
    phaseLines: ['Gorath lifts his bone club.', 'Gorath calls his legion from the dust!'],
    rig: () => Rig.humanoid({ armor: 0xbcb4a0, cloth: 0x3a3228, skin: 0xd8d0b8, helm: 0xa8a090, legs: 0x8c8474, weapon: 'club', scale: 2.6 }),
    attacks: [
      { id: 'slam', name: 'Bone Slam', weight: 3, maxDist: 4.5, windup: 1.2, recover: 1.0,
        strike(b) {
          const x = b.x + Math.sin(b.yaw) * 2.8, z = b.z + Math.cos(b.yaw) * 2.8;
          Fx.hazard({ x, z, r: 4.2, delay: 0.25, dmg: 45, life: 0.3, color: 0xd9d0b0 });
        } },
      { id: 'sweep', name: 'Club Sweep', weight: 3, maxDist: 5.5, windup: 0.8, recover: 0.9,
        strike(b) {
          Combat.cone(b, b.targets(), 5.4, 2.4, 40, { stagger: 0.5 });
          Fx.ring(b.x, b.y + 1, b.z, 5, 0xd9d0b0, 0.35);
        } },
      { id: 'legion', name: 'Summon Legion', weight: 1.6, minPhase: 1, windup: 1.3, recover: 1.2,
        strike(b) {
          for (let i = 0; i < 2; i++) {
            const a = b.yaw + (i ? 0.7 : -0.7);
            Game.spawnEnemy('skeleton', b.x + Math.sin(a) * 6, b.z + Math.cos(a) * 6, { summoned: true });
          }
          Fx.ring(b.x, b.y, b.z, 7, 0xb8b0a0, 0.6);
        } },
      { id: 'shards', name: 'Bone Shards', weight: 2, minDist: 6, windup: 1.0, recover: 0.9,
        strike(b) {
          const p = Game.player;
          const base = Util.angleTo(b.x, b.z, p.x, p.z);
          for (const off of [-0.3, 0, 0.3]) {
            const a = base + off;
            Fx.projectile({ x: b.x, y: b.y + 2.5, z: b.z, dir: { x: Math.sin(a), y: 0, z: Math.cos(a) }, speed: 16, dmg: 20, r: 0.3, life: 3, color: 0xe8e0c8 });
          }
        } },
    ],
  },

  blightfang: {
    id: 'blightfang', name: 'Blightfang, Matriarch of the Hollow', title: 'Guardian of the Withered Wood', hp: 1000, radius: 1.8,
    speed: 5.5, keepDist: 3.2, cooldown: 1.1, scale: 2.4, souls: 650, flyHeight: 0,
    intro: 'Something hungry stirs in the rot.',
    phaseLines: ['Blightfang snarls, her hide blistering with rot.', 'Blightfang enters a frenzy!'],
    rig: () => Rig.creature('wolf', { color: 0x4f5e3a, accent: 0x1d2a14, scale: 2.4 }),
    attacks: [
      { id: 'bite', name: 'Triple Bite', weight: 3, maxDist: 4, windup: 0.5, recover: 1.2,
        strike(b) {
          for (let k = 0; k < 3; k++) {
            b.later(k * 0.3, () => { if (!b.dead) Combat.cone(b, b.targets(), 3.8, 1.7, 30, { stagger: 0.25 }); });
          }
        } },
      { id: 'pounce', name: 'Pounce', weight: 2, minDist: 6, maxDist: 14, windup: 0.8, recover: 0.9,
        strike(b) {
          const p = Game.player;
          const dx = p.x - b.x, dz = p.z - b.z;
          b.dash(dx, dz, 22, 0.5, () => false);
          b.later(0.5, () => {
            Fx.ring(b.x, b.y, b.z, 4.5, 0x9ac060, 0.4);
            Combat.radial(b.x, b.z, 4.5, b.targets(), 40, { stagger: 0.6 });
          });
        } },
      { id: 'cloud', name: 'Rot Cloud', weight: 2, minDist: 5, windup: 1.0, recover: 0.8,
        strike(b) {
          const p = Game.player;
          Fx.hazard({ x: p.x, z: p.z, r: 4.5, delay: 1.0, dmg: 4, poison: true, life: 6, color: 0x8ad040 });
        } },
      { id: 'frenzy', name: 'Frenzy', weight: 1.5, minPhase: 1, windup: 0.6, recover: 0.6,
        strike(b) {
          b.buffT = 5;
          Fx.ring(b.x, b.y + 1, b.z, 3, 0xb0ff60, 0.5);
        } },
    ],
  },

  ironhide: {
    id: 'ironhide', name: 'Ironhide, the Ashen Colossus', title: 'Guardian of the Quarry', hp: 1250, radius: 2.2,
    speed: 2.2, keepDist: 3.6, cooldown: 1.8, scale: 3.2, souls: 700, flyHeight: 0,
    intro: 'The quarry remembers every stone it lost.',
    phaseLines: ['Ironhide cracks the ground with a roar.', 'Ironhide begins hurling the quarry!'],
    rig: () => Rig.humanoid({ armor: 0x5a5550, cloth: 0x2a2420, skin: 0x3a3530, helm: 0x4a4540, legs: 0x3a3530, weapon: 'club', scale: 3.2 }),
    attacks: [
      { id: 'stomp', name: 'Stomp', weight: 3, maxDist: 7, windup: 1.4, recover: 1.2,
        strike(b) {
          Fx.ring(b.x, b.y, b.z, 9, 0xc8a070, 0.6);
          Combat.radial(b.x, b.z, 9, b.targets(), 50, { stagger: 0.7 });
        } },
      { id: 'charge', name: 'Iron Charge', weight: 2, minDist: 6, maxDist: 20, windup: 1.0, recover: 1.0,
        strike(b) {
          const p = Game.player;
          const dx = p.x - b.x, dz = p.z - b.z;
          let hit = false;
          b.dash(dx, dz, 14, 1.2, () => {
            if (hit) return false;
            if (Util.dist(b.x, b.z, Game.player.x, Game.player.z) < b.radius + 0.8) {
              hit = true;
              Game.player.takeHit(55, b.x, b.z, { stagger: 0.8 });
              return true;
            }
            return false;
          });
        } },
      { id: 'boulder', name: 'Hurled Boulder', weight: 2, minDist: 8, windup: 0.9, recover: 0.8,
        strike(b) {
          const p = Game.player;
          const dx = p.x - b.x, dy = p.y + 1 - (b.y + 3), dz = p.z - b.z;
          const d = Math.hypot(dx, dy, dz) || 1;
          Fx.projectile({ x: b.x, y: b.y + 3, z: b.z, dir: { x: dx / d, y: dy / d, z: dz / d }, speed: 13, dmg: 50, r: 0.8, life: 5, color: 0x6a6058 });
        } },
      { id: 'quake', name: 'Quake', weight: 1.4, minPhase: 1, windup: 1.1, recover: 1.0,
        strike(b) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3;
            const p = Game.player;
            Fx.hazard({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, r: 2.6, delay: 0.9 + i * 0.2, dmg: 35, color: 0xd09050 });
          }
        } },
    ],
  },

  abbot: {
    id: 'abbot', name: 'The Drowned Abbot', title: 'Guardian of the Sunken Chapel', hp: 800, radius: 1.1,
    speed: 3.5, keepDist: 4, cooldown: 1.3, scale: 1.4, souls: 550, flyHeight: 1.6, aura: 0x6ad0ff,
    intro: 'Hymns rise from the water. Do not listen.',
    phaseLines: ['The Abbot sinks beneath the waves and reappears behind you.', 'The Abbot sings a drowning hymn!'],
    rig: () => Rig.humanoid({ armor: 0x2f3b4a, cloth: 0x1e2630, skin: 0xbfc8d0, helm: 0x2f3b4a, legs: 0x1e2630, weapon: 'club', scale: 1.4 }),
    attacks: [
      { id: 'vanish', name: 'Drowned Step', weight: 2, minDist: 5, windup: 0.5, recover: 0.7,
        strike(b) {
          b.group.visible = false;
          b.later(0.7, () => {
            const p = Game.player;
            b.x = p.x - Math.sin(p.yaw) * 3.5;
            b.z = p.z - Math.cos(p.yaw) * 3.5;
            b.group.visible = true;
            b.faceAt(p.x, p.z);
            Fx.spark(b.x, b.y + 1, b.z, 0x6ad0ff, 16);
          });
        } },
      { id: 'orbs', name: 'Homing Orbs', weight: 2, windup: 0.9, recover: 0.8,
        strike(b) {
          for (let i = 0; i < 3; i++) {
            b.later(i * 0.35, () => {
              const p = Game.player;
              const dx = p.x - b.x, dy = p.y + 1 - b.y, dz = p.z - b.z;
              const d = Math.hypot(dx, dy, dz) || 1;
              Fx.projectile({ x: b.x, y: b.y + 1.5, z: b.z, dir: { x: dx / d, y: dy / d, z: dz / d }, speed: 9, dmg: 22, r: 0.4, life: 6, homing: 1.2, color: 0x6ad0ff });
            });
          }
        } },
      { id: 'hymn', name: 'Drowning Hymn', weight: 2, maxDist: 8.5, windup: 1.2, recover: 1.0,
        strike(b) {
          Fx.ring(b.x, b.y, b.z, 8, 0x6ad0ff, 0.7);
          Fx.hazard({ x: b.x, z: b.z, r: 8, delay: 0.3, dmg: 40, life: 0.3, color: 0x6ad0ff });
        } },
      { id: 'legion', name: 'Summon Drowned', weight: 1.4, minPhase: 1, windup: 1.1, recover: 1.0,
        strike(b) {
          for (let i = 0; i < 2; i++) Game.spawnEnemy('archer', b.x + (i ? 5 : -5), b.z + 3, { summoned: true });
        } },
    ],
  },

  emberwyrm: {
    id: 'emberwyrm', name: 'Emberwyrm Vaelor', title: 'Guardian of the Scorched Peak', hp: 1200, radius: 2.4,
    speed: 6, keepDist: 6, cooldown: 1.2, scale: 2.2, souls: 800, flyHeight: 9,
    intro: 'The sky burns, and the sky is hers.',
    phaseLines: ['Vaelor takes wing and scorches the peak.', 'Vaelor rains fire across the mountain!'],
    rig: () => Rig.creature('dragon', { scale: 2.2 }),
    attacks: [
      { id: 'breath', name: 'Fire Breath', weight: 3, windup: 0.9, recover: 0.6,
        strike(b) {
          let t = 0, tick = 0;
          b.tickFn = dt => {
            t += dt; tick -= dt;
            if (tick <= 0) {
              tick = 0.15;
              Combat.cone(b, b.targets(), 14, 0.8, 14, { stagger: 0.05 });
              Fx.spark(b.x + Math.sin(b.yaw) * 5, b.y - 0.5, b.z + Math.cos(b.yaw) * 5, 0xff8030, 4);
            }
            if (t >= 2.4) { b.tickFn = null; return true; }
            return false;
          };
        } },
      { id: 'dive', name: 'Dive', weight: 2, minDist: 6, windup: 0.8, recover: 1.0,
        strike(b) {
          const p = Game.player;
          bossDive(b, p.x, p.z, () => {
            Fx.ring(b.x, b.y, b.z, 7, 0xff8030, 0.6);
            Combat.radial(b.x, b.z, 7, b.targets(), 55, { stagger: 0.7 });
          });
        } },
      { id: 'tail', name: 'Tail Sweep', weight: 2, maxDist: 8, windup: 0.6, recover: 0.8,
        strike(b) {
          Combat.cone(b, b.targets(), 8.5, 2.6, 35, { stagger: 0.6 });
          Fx.ring(b.x, b.y - 2, b.z, 6, 0xffa050, 0.35);
        } },
      { id: 'rain', name: 'Fire Rain', weight: 1.6, minPhase: 1, windup: 1.0, recover: 1.0,
        strike(b) {
          const p = Game.player;
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
            Fx.hazard({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, r: 2.4, delay: 1.2 + i * 0.1, dmg: 30, color: 0xff6a20 });
          }
        } },
    ],
  },

  king: {
    id: 'king', name: 'The Hollow Crowned King', title: 'Lord of the Sealed Throne', hp: 2200, radius: 2.6,
    speed: 3.4, keepDist: 3.2, cooldown: 1.1, scale: 2.9, souls: 2000, flyHeight: 0, final: true,
    intro: 'Five guardians fell for this. You will kneel too.',
    phaseLines: ['The King draws his greatsword and roars.', 'The King rages. The crown burns!'],
    rig: () => Rig.humanoid({ armor: 0x6a6e7a, cloth: 0x6a1a2a, skin: 0xd8c0a0, helm: 0x9aa0ac, legs: 0x4a4e5a, cape: 0x6a1a2a, crown: true, shield: 0x7a1f2a, weapon: 'greatsword', scale: 2.9 }),
    attacks: [
      { id: 'combo', name: 'Greatsword Combo', weight: 3, maxDist: 6, windup: 0.9, recover: 1.0,
        strike(b) {
          Combat.cone(b, b.targets(), 6.3, 1.5, 60, { stagger: 0.4 });
          b.later(0.7, () => { if (!b.dead) Combat.cone(b, b.targets(), 6.3, 1.5, 60, { stagger: 0.4 }); });
          b.later(1.4, () => {
            if (b.dead) return;
            Fx.ring(b.x, b.y, b.z, 5, 0xffd080, 0.4);
            Combat.radial(b.x + Math.sin(b.yaw) * 3, b.z + Math.cos(b.yaw) * 3, 5, b.targets(), 70, { stagger: 0.8 });
          });
        } },
      { id: 'charge', name: 'Royal Charge', weight: 2, minDist: 5, maxDist: 16, windup: 1.0, recover: 0.8,
        strike(b) {
          const p = Game.player;
          let hit = false;
          b.dash(p.x - b.x, p.z - b.z, 10, 1.5, () => {
            if (!hit && Util.dist(b.x, b.z, Game.player.x, Game.player.z) < b.radius + 0.8) {
              hit = true;
              Game.player.takeHit(50, b.x, b.z, { stagger: 0.8 });
              return true;
            }
            return false;
          });
        } },
      { id: 'shock', name: 'Kingsfall Shockwave', weight: 2, windup: 1.2, recover: 1.0,
        strike(b) {
          Fx.ring(b.x, b.y, b.z, 10, 0xd9b44a, 0.7);
          Combat.radial(b.x, b.z, 10, b.targets(), 50, { stagger: 0.8 });
        } },
      { id: 'guards', name: 'Summon Crownguard', weight: 1.2, minPhase: 1, windup: 1.0, recover: 1.0,
        strike(b) {
          for (let i = 0; i < 2; i++) {
            const a = b.yaw + (i ? 1 : -1) * 0.9;
            Game.spawnEnemy('guard', b.x + Math.sin(a) * 6, b.z + Math.cos(a) * 6, { summoned: true });
          }
        } },
      { id: 'storm', name: 'Crown Storm', weight: 2, minPhase: 2, windup: 1.0, recover: 0.8,
        strike(b) {
          const p = Game.player;
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 7;
            Fx.hazard({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, r: 2.2, delay: 1.0 + i * 0.15, dmg: 35, color: 0xd9b44a });
          }
        } },
    ],
  },
};

// Each boss keeps its definition as the source of its numbers. The site entry says where it stands.
for (const [id, def] of Object.entries(BOSS_DEFS)) {
  def.id = id;
  def.cooldown = def.cooldown ?? 1.4;
  def.scale = def.scale ?? 1;
  def.flyHeight = def.flyHeight ?? 0;
}
