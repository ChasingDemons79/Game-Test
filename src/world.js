// The open world: terrain height, props, arenas, bonfires and collision obstacles.

const World = {
  bonfires: [],
  obstacles: [],   // { x, z, r } circles the player cannot walk through
  sealRing: null,
  flats: [],
  time: 0,

  hash(ix, iz) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ CONFIG.SEED;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },
  vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = World.hash(ix, iz), b = World.hash(ix + 1, iz);
    const c = World.hash(ix, iz + 1), d = World.hash(ix + 1, iz + 1);
    return Util.lerp(Util.lerp(a, b, u), Util.lerp(c, d, u), v);
  },
  fbm(x, z) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < 4; i++) {
      s += a * World.vnoise(x * f, z * f);
      n += a;
      a *= 0.5;
      f *= 2.03;
    }
    return s / n;
  },

  // Terrain before arenas are flattened.
  baseHeight(x, z) {
    let h = 6 + (World.fbm(x * 0.0045, z * 0.0045) - 0.5) * 60 + (World.vnoise(x * 0.03, z * 0.03) - 0.5) * 3;
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    h = Util.lerp(h, -4, Util.smooth(LAKE.r + 18, LAKE.r * 0.55, dl));
    const dp = Math.hypot(x - SITES.peak.x, z - SITES.peak.z);
    h += 42 * Math.exp(-(dp * dp) / (2 * 90 * 90));
    return h;
  },

  heightAt(x, z) {
    let h = World.baseHeight(x, z);
    for (const f of World.flats) {
      const d = Math.hypot(x - f.x, z - f.z);
      h = Util.lerp(f.h, h, Util.smooth(f.r, f.r + 32, d));
    }
    return h;
  },

  // Prepares flats and collision data. Must run before any heightAt call that matters.
  prepare() {
    World.flats = Object.values(SITES).map(s => ({ x: s.x, z: s.z, r: s.r, h: World.baseHeight(s.x, s.z) }));
  },

  build(scene) {
    World.scene = scene;
    World.prepare();
    World.buildTerrain(scene);
    World.buildLake(scene);
    World.buildProps(scene);
    for (const s of Object.values(SITES)) {
      if (s.boss || s.final) World.buildArena(scene, s);
      else World.buildCamp(scene, s);
    }
    for (const s of Object.values(SITES)) {
      if (s.bonfire) World.addBonfire(scene, s);
    }
    World.buildSealRing(scene);
  },

  buildTerrain(scene) {
    const size = CONFIG.WORLD_HALF * 2, seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, World.heightAt(x, z));
    }
    geo.computeVertexNormals();
    const colors = new Float32Array(pos.count * 3);
    const normal = geo.attributes.normal;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const steep = normal.getY(i);
      const grass = World.vnoise(x * 0.05, z * 0.05);
      c.setRGB(0.19 + grass * 0.08, 0.33 + grass * 0.1, 0.15 + grass * 0.04);
      if (y < 1.2) c.setRGB(0.55, 0.5, 0.36);                       // shoreline and sand
      if (steep < 0.72) c.setRGB(0.42, 0.4, 0.38);                   // rock faces
      if (y > 44) c.setRGB(0.88, 0.9, 0.95);                         // snowy peaks
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    scene.add(mesh);
  },

  buildLake(scene) {
    const geo = new THREE.CircleGeometry(LAKE.r * 1.02, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2e5f7a, transparent: true, opacity: 0.75 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(LAKE.x, -0.8, LAKE.z);
    scene.add(m);
  },

  buildProps(scene) {
    const r = Util.rng(CONFIG.SEED);
    const trees = [], dead = [], rocks = [];
    const wood = SITES.wood;
    for (let i = 0; i < 2600; i++) {
      const x = (r() - 0.5) * CONFIG.WORLD_HALF * 1.9;
      const z = (r() - 0.5) * CONFIG.WORLD_HALF * 1.9;
      const h = World.heightAt(x, z);
      if (h < 1.5) continue;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 6) continue;
      if (World.nearSite(x, z, 14)) continue;
      const s = 0.8 + r() * 0.9;
      const inWood = Math.hypot(x - wood.x, z - wood.z) < 140;
      if (inWood && r() < 0.6) {
        dead.push({ x, y: h, z, s });
      } else if (r() < 0.75) {
        trees.push({ x, y: h, z, s });
      } else {
        rocks.push({ x, y: h, z, s: 0.6 + r() * 1.8 });
      }
    }
    World.addInstanced(scene, trees, 'pine');
    World.addInstanced(scene, dead, 'dead');
    World.addInstanced(scene, rocks, 'rock');
    for (const t of [...trees, ...dead]) World.obstacles.push({ x: t.x, z: t.z, r: 0.5 * t.s + 0.3 });
    for (const t of rocks) World.obstacles.push({ x: t.x, z: t.z, r: 0.9 * t.s * 0.8 });
  },

  addInstanced(scene, items, kind) {
    if (!items.length) return;
    const dummy = new THREE.Object3D();
    const add = (geo, color) => {
      const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((t, i) => {
        dummy.position.set(t.x, t.y, t.z);
        dummy.rotation.set(0, (t.x * 13.1 + t.z * 7.7) % 6.28, 0);
        dummy.scale.setScalar(t.s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        dummy.position.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
      });
      scene.add(im);
    };
    if (kind === 'pine') {
      add(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 6).translate(0, 1.3, 0), 0x5b3d24);
      add(new THREE.ConeGeometry(2.1, 5.2, 7).translate(0, 4.6, 0), 0x2c5a2e);
    } else if (kind === 'dead') {
      add(new THREE.CylinderGeometry(0.12, 0.3, 5.5, 5).translate(0, 2.75, 0), 0x5c5448);
      add(new THREE.CylinderGeometry(0.04, 0.1, 2.2, 4).translate(0.4, 4.2, 0).rotateZ(-0.7), 0x5c5448);
    } else {
      add(new THREE.DodecahedronGeometry(0.9, 0).translate(0, 0.2, 0), 0x7a7770);
    }
  },

  nearSite(x, z, pad) {
    for (const s of Object.values(SITES)) {
      if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return true;
    }
    return false;
  },

  buildCamp(scene, s) {
    const y = World.heightAt(s.x, s.z);
    const tent = (x, z, rot) => {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.4, 4).rotateY(Math.PI / 4), new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true }));
      mesh.position.y = 1.2;
      g.add(mesh);
      g.position.set(x, y, z);
      g.rotation.y = rot;
      scene.add(g);
      World.obstacles.push({ x, z, r: 1.6 });
    };
    tent(s.x - 14, s.z + 8, 0.6);
    tent(s.x - 10, s.z - 12, 2.1);
    tent(s.x + 12, s.z + 4, 4.0);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5, 0.1), new THREE.MeshLambertMaterial({ color: 0x3a2a2a }));
    banner.position.set(s.x + 2, y + 2.5, s.z - 4);
    scene.add(banner);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.05), new THREE.MeshBasicMaterial({ color: 0xb3262e }));
    flag.position.set(s.x + 2.7, y + 4.4, s.z - 4);
    scene.add(flag);
  },

  buildArena(scene, s) {
    const y = World.heightAt(s.x, s.z);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(s.r, s.r + 0.6, 0.5, 36),
      new THREE.MeshLambertMaterial({ color: 0x4a4540, flatShading: true })
    );
    floor.position.set(s.x, y + 0.1, s.z);
    scene.add(floor);
    const r = Util.rng(Math.abs(Math.round(s.x * 31 + s.z * 17)) + 7);
    const n = s.final ? 14 : 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = (s.final ? 13 : 6) + r() * 3;
      const px = s.x + Math.cos(a) * (s.r - 1), pz = s.z + Math.sin(a) * (s.r - 1);
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.1, h, 7),
        new THREE.MeshLambertMaterial({ color: 0x6f6a62, flatShading: true })
      );
      pillar.position.set(px, y + h / 2, pz);
      scene.add(pillar);
      if (!s.final && i % 3 === 0) {
        const torch = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
        torch.position.set(px, y + h + 0.3, pz);
        scene.add(torch);
      }
    }
    const light = new THREE.PointLight(s.final ? 0x9a6bff : 0xffb070, 0.9, 40);
    light.position.set(s.x, y + 6, s.z);
    scene.add(light);
  },

  buildSealRing(scene) {
    const s = SITES.throne;
    const y = World.heightAt(s.x, s.z);
    const g = new THREE.Group();
    const barrier = new THREE.Mesh(
      new THREE.CylinderGeometry(s.sealRadius, s.sealRadius, 9, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x8a4cff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    barrier.position.y = 4.5;
    g.add(barrier);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), new THREE.MeshLambertMaterial({ color: 0x3a3440, flatShading: true }));
      p.position.set(Math.cos(a) * s.sealRadius, 4.5, Math.sin(a) * s.sealRadius);
      g.add(p);
      if (i % 2 === 0) World.obstacles.push({ x: s.x + Math.cos(a) * s.sealRadius, z: s.z + Math.sin(a) * s.sealRadius, r: 0.9 });
    }
    g.position.set(s.x, y, s.z);
    scene.add(g);
    World.sealRing = g;
  },

  removeSealRing() {
    if (World.sealRing) {
      World.scene.remove(World.sealRing);
      World.sealRing = null;
    }
  },

  addBonfire(scene, s) {
    const [bx, bz] = s.bonfire;
    const y = World.heightAt(bx, bz);
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x5a554e, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), stoneMat);
      st.position.set(Math.cos(a) * 0.9, 0.2, Math.sin(a) * 0.9);
      g.add(st);
    }
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3018 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 5), logMat);
      log.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
      log.position.y = 0.25;
      g.add(log);
    }
    const flames = [];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 6), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffe08a : 0xff7a22, transparent: true, opacity: 0.9 }));
      f.position.set((i - 1) * 0.25, 0.9, (i % 2) * 0.2);
      g.add(f);
      flames.push(f);
    }
    const light = new THREE.PointLight(0xff9a3c, 1.4, 26);
    light.position.set(0, 2.5, 0);
    g.add(light);
    g.position.set(bx, y, bz);
    scene.add(g);
    const id = s.id;
    World.bonfires.push({ id, name: s.name, x: bx, z: bz, flames, light, group: g, siteId: id });
    World.obstacles.push({ x: bx, z: bz, r: 1.1 });
  },

  bonfireById(id) {
    return World.bonfires.find(b => b.id === id);
  },

  nearestBonfire(x, z, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const b of World.bonfires) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  },

  // Keeps `e` out of solid obstacles and out of sealed/arena boundaries.
  resolveObstacles(e, radius) {
    for (const o of World.obstacles) {
      const dx = e.x - o.x, dz = e.z - o.z;
      const min = o.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        e.x = o.x + (dx / d) * min;
        e.z = o.z + (dz / d) * min;
      }
    }
  },

  update(dt, t) {
    World.time = t;
    for (const b of World.bonfires) {
      b.light.intensity = 1.2 + Math.sin(t * 13 + b.x) * 0.25 + Math.sin(t * 7.3 + b.z) * 0.15;
      b.flames.forEach((f, i) => {
        f.scale.y = 0.85 + Math.sin(t * 9 + i * 2.1) * 0.2;
        f.rotation.y = t * 1.4 + i;
      });
    }
  },
};
