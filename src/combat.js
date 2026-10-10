// Shared combat helpers: hit queries, timed hazards, projectiles and visual effects.

const Combat = {
  // Everything in `list` inside a forward cone from `src`. Returns the number of hits.
  cone(src, list, range, arc, dmg, opts = {}) {
    let hits = 0;
    for (const t of list) {
      if (!t || t.dead || t === src) continue;
      const d = Util.dist(src.x, src.z, t.x, t.z);
      if (d > range + (t.radius || 0.6)) continue;
      const ang = Util.angleTo(src.x, src.z, t.x, t.z);
      if (Math.abs(Util.wrap(ang - src.yaw)) > arc / 2) continue;
      t.takeHit(dmg, src.x, src.z, opts);
      hits++;
    }
    return hits;
  },

  radial(x, z, r, list, dmg, opts = {}) {
    let hits = 0;
    for (const t of list) {
      if (!t || t.dead) continue;
      if (Util.dist(x, z, t.x, t.z) > r + (t.radius || 0.6)) continue;
      t.takeHit(dmg, x, z, opts);
      hits++;
    }
    return hits;
  },

  nearest(src, list, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const t of list) {
      if (!t || t.dead) continue;
      const d = Util.dist(src.x, src.z, t.x, t.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  },
};

const Fx = {
  parts: [],
  rings: [],
  hazards: [],
  projectiles: [],

  init(scene) {
    this.scene = scene;
    this.partGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.projGeo = new THREE.SphereGeometry(1, 10, 8);
  },

  spark(x, y, z, color = 0xffd27a, n = 8) {
    if (!this.scene) return;
    for (let i = 0; i < n && this.parts.length < 240; i++) {
      const m = new THREE.Mesh(this.partGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      m.position.set(x, y, z);
      this.scene.add(m);
      this.parts.push({ m, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 6, t: 0, life: 0.5 + Math.random() * 0.3 });
    }
  },

  ring(x, y, z, r, color = 0xffe2a0, life = 0.5) {
    if (!this.scene) return;
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.set(x, y + 0.2, z);
    this.scene.add(m);
    this.rings.push({ m, r0: 0.5, r1: r, t: 0, life });
  },

  // A timed ground zone. It shows a telegraph, then hurts the player once (or repeatedly for poison).
  hazard({ x, z, r, delay = 0.8, dmg = 20, poison = false, life = 0.35, color = 0xff4030, onActive }) {
    const mesh = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
    mesh.scale.set(r, 1, r);
    mesh.position.set(x, World.heightAt(x, z) + 0.15, z);
    this.scene.add(mesh);
    this.hazards.push({ x, z, r, delay, dmg, poison, life: poison ? life : life, t: 0, tick: 0, fired: false, mesh, color, onActive });
  },

  projectile({ x, y, z, dir, speed = 14, dmg = 15, r = 0.4, life = 4, homing = 0, color = 0xffc070, size = 1 }) {
    const m = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial({ color }));
    m.scale.setScalar(r * size);
    m.position.set(x, y, z);
    this.scene.add(m);
    this.projectiles.push({ x, y, z, vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed, speed, dmg, r, life, homing, mesh: m });
  },

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      p.vy -= 14 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.material.opacity = Math.max(0, 1 - p.t / p.life);
      if (p.t >= p.life) { this.scene.remove(p.m); p.m.material.dispose(); this.parts.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const rg = this.rings[i];
      rg.t += dt;
      const k = Math.min(1, rg.t / rg.life);
      rg.m.scale.setScalar(Util.lerp(rg.r0, rg.r1, k));
      rg.m.material.opacity = 1 - k;
      if (k >= 1) { this.scene.remove(rg.m); rg.m.material.dispose(); this.rings.splice(i, 1); }
    }
    const player = Game.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      const total = h.delay + h.life;
      if (h.t < h.delay) {
        h.mesh.material.opacity = 0.15 + 0.25 * Math.sin(h.t * 18) ** 2;
      } else {
        h.mesh.material.opacity = 0.55 * (1 - (h.t - h.delay) / h.life);
        h.mesh.material.color.setHex(h.color);
        if (!h.poison && !h.fired) {
          h.fired = true;
          h.onActive?.(h);
          if (player && !player.dead && Util.dist(h.x, h.z, player.x, player.z) < h.r + player.radius) {
            player.takeHit(h.dmg, h.x, h.z, { source: 'hazard' });
          }
          this.ring(h.x, World.heightAt(h.x, h.z), h.z, h.r * 1.1, h.color, 0.4);
        }
        if (h.poison) {
          h.tick -= dt;
          if (h.tick <= 0) {
            h.tick = 0.5;
            if (player && !player.dead && Util.dist(h.x, h.z, player.x, player.z) < h.r + player.radius) {
              player.takeHit(h.dmg, h.x, h.z, { source: 'poison', stagger: 0 });
            }
          }
        }
      }
      if (h.t >= total) {
        this.scene.remove(h.mesh);
        h.mesh.material.dispose();
        this.hazards.splice(i, 1);
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.homing && Game.player && !Game.player.dead) {
        const tx = Game.player.x, ty = Game.player.y + 1.2, tz = Game.player.z;
        const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(1, p.homing * dt);
        p.vx = Util.lerp(p.vx, (dx / d) * p.speed, k);
        p.vy = Util.lerp(p.vy, (dy / d) * p.speed, k);
        p.vz = Util.lerp(p.vz, (dz / d) * p.speed, k);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.life -= dt;
      p.mesh.position.set(p.x, p.y, p.z);
      const ground = World.heightAt(p.x, p.z);
      let remove = p.life <= 0 || p.y < ground - 0.2;
      if (!remove && player && !player.dead) {
        const d = Util.dist(p.x, p.z, player.x, player.z);
        if (d < p.r + player.radius && Math.abs(p.y - (player.y + 1.1)) < 1.6) {
          player.takeHit(p.dmg, p.x, p.z, { source: 'projectile' });
          remove = true;
        }
      }
      if (remove) {
        if (p.y < ground + 0.3) this.spark(p.x, p.y, p.z, 0xffb070, 5);
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  },

  clear() {
    const all = [...this.parts.map(p => p.m), ...this.rings.map(r => r.m), ...this.hazards.map(h => h.mesh), ...this.projectiles.map(p => p.mesh)];
    for (const m of all) this.scene.remove(m);
    this.parts = []; this.rings = []; this.hazards = []; this.projectiles = [];
  },
};
