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

  // Grass on flat ground, bare rock on steep faces and high ground. The blend happens in the
  // shader, using a per-vertex rockMix value, so the seam between textures is smooth.
  buildTerrain(scene) {
    const size = CONFIG.WORLD_HALF * 2, seg = 240;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, World.heightAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    const normal = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    const rockMix = new Float32Array(pos.count);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const slope = normal.getY(i);
      rockMix[i] = Util.clamp(Util.smooth(0.72, 0.5, slope) + Util.smooth(38, 46, y) * 0.6, 0, 1);
      const v = 0.9 + World.vnoise(x * 0.05, z * 0.05) * 0.2;
      c.setRGB(v, v * 1.02, v * 0.9);
      if (y < 1.2) c.setRGB(1.3, 1.1, 0.8);     // sand at the shoreline
      if (y > 44) c.setRGB(1.4, 1.4, 1.45);     // snow on the peaks
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      uv.setXY(i, x / 10, z / 10);
    }
    uv.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('rockMix', new THREE.BufferAttribute(rockMix, 1));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      map: Materials.map('grass_albedo'),
      normalMap: Materials.map('grass_normal'),
      normalScale: new THREE.Vector2(1.2, 1.2),
    });
    const rockAlbedo = Materials.map('rock_albedo');
    const rockNormal = Materials.map('rock_normal');
    mat.onBeforeCompile = shader => {
      shader.uniforms.rockMap = { value: rockAlbedo };
      shader.uniforms.rockNormalMap = { value: rockNormal };
      shader.vertexShader = 'attribute float rockMix;\nvarying float vRockMix;\n' + shader.vertexShader
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vRockMix = rockMix;');
      shader.fragmentShader = 'uniform sampler2D rockMap;\nuniform sampler2D rockNormalMap;\nvarying float vRockMix;\n' + shader.fragmentShader
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 grassTex = texture2D( map, vUv );
  vec4 rockTex = texture2D( rockMap, vUv );
  diffuseColor *= mix( grassTex, rockTex, vRockMix );
#endif`)
        .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP
  vec3 grassN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
  vec3 rockN = texture2D( rockNormalMap, vUv ).xyz * 2.0 - 1.0;
  vec3 mapN = normalize( mix( grassN, rockN, vRockMix ) );
  mapN.xy *= normalScale;
  normal = perturbNormal2Arb( - vViewPosition, normal, mapN, faceDirection );
#endif`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  },

  buildLake(scene) {
    const geo = new THREE.CircleGeometry(LAKE.r * 1.02, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhongMaterial({ color: 0x2e5f7a, transparent: true, opacity: 0.78, shininess: 90, specular: 0x88aacc });
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
    World.buildGrass(scene);
    for (const t of [...trees, ...dead]) World.obstacles.push({ x: t.x, z: t.z, r: 0.5 * t.s + 0.3 });
    for (const t of rocks) World.obstacles.push({ x: t.x, z: t.z, r: 0.9 * t.s * 0.8 });
  },

  // Grass blades: one instanced draw call for thousands of tufts, varied in colour and tilt.
  buildGrass(scene) {
    const r = Util.rng(CONFIG.SEED + 7);
    const count = 16000;
    const geo = new THREE.ConeGeometry(0.1, 0.7, 3).translate(0, 0.35, 0);
    const im = new THREE.InstancedMesh(geo, Materials.std(0xffffff, { set: 'grass', roughness: 0.9, normalScale: 0.6 }), count);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    let n = 0;
    for (let tries = 0; tries < count * 2 && n < count; tries++) {
      const x = (r() - 0.5) * CONFIG.WORLD_HALF * 1.9;
      const z = (r() - 0.5) * CONFIG.WORLD_HALF * 1.9;
      const h = World.heightAt(x, z);
      if (h < 0.8 || h > 34) continue;
      if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2) continue;
      if (World.nearSite(x, z, 2)) continue;
      dummy.position.set(x, h, z);
      dummy.rotation.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4);
      dummy.scale.setScalar(0.6 + r() * 0.9);
      dummy.updateMatrix();
      im.setMatrixAt(n, dummy.matrix);
      c.setHSL(0.2 + r() * 0.06, 0.45 + r() * 0.15, 0.2 + r() * 0.12);
      im.setColorAt(n, c);
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true;
    scene.add(im);
  },

  addInstanced(scene, items, kind) {
    if (!items.length) return;
    const dummy = new THREE.Object3D();
    const add = (geo, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      im.castShadow = true;
      im.receiveShadow = true;
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
      add(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 10).translate(0, 1.3, 0), Materials.std(0xffffff, { set: 'bark', roughness: 0.9, normalScale: 1.2 }));
      add(new THREE.ConeGeometry(2.1, 5.2, 12).translate(0, 4.6, 0), Materials.std(0x6fa06a, { set: 'needles', roughness: 0.85, normalScale: 0.8 }));
    } else if (kind === 'dead') {
      add(new THREE.CylinderGeometry(0.12, 0.3, 5.5, 8).translate(0, 2.75, 0), Materials.std(0xb8b09a, { set: 'bark', roughness: 0.95, normalScale: 1.2 }));
      add(new THREE.CylinderGeometry(0.04, 0.1, 2.2, 6).translate(0.4, 4.2, 0).rotateZ(-0.7), Materials.std(0xb8b09a, { set: 'bark', roughness: 0.95, normalScale: 1.2 }));
    } else {
      add(new THREE.DodecahedronGeometry(0.9, 1).translate(0, 0.2, 0), Materials.std(0xffffff, { set: 'rock', roughness: 0.9, normalScale: 1.4 }));
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
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.4, 4).rotateY(Math.PI / 4), Materials.std(0x9a7a58, { set: 'fabric', roughness: 0.9 }));
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
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5, 0.1), Materials.std(0x5a3a2a, { set: 'fabric', roughness: 0.9 }));
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
      Materials.std(0x8a847a, { set: 'stone', roughness: 0.92, normalScale: 1.0 })
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
        Materials.std(0xbdb6a8, { set: 'stone', roughness: 0.9, normalScale: 1.0 })
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
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), Materials.std(0x6a6276, { set: 'stone', roughness: 0.9, normalScale: 1.0 }));
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
    const stoneMat = Materials.std(0xc4bdb0, { set: 'stone', roughness: 0.9, normalScale: 1.0 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.42, 0), stoneMat);
      st.position.set(Math.cos(a) * 0.9, 0.2, Math.sin(a) * 0.9);
      g.add(st);
    }
    const logMat = Materials.std(0xffffff, { set: 'bark', roughness: 0.9, normalScale: 1.2 });
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
