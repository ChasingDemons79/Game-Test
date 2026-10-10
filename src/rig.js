// Procedural character and creature models. No external assets: everything is boxes,
// cylinders and cones grouped into pivots that the animation code can rotate.

const Rig = {
  _mats: new Map(),
  mat(color, opts = {}) {
    const key = color + (opts.emissive ? 'e' : '') + (opts.transparent ? 't' : '');
    let m = this._mats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
      this._mats.set(key, m);
    }
    return m;
  },
  // Box geometries are shared by size so a crowd of enemies does not allocate thousands of buffers.
  geo(w, h, d) {
    if (!this._geos) this._geos = new Map();
    const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
    let g = this._geos.get(key);
    if (!g) {
      g = new THREE.BoxGeometry(w, h, d);
      this._geos.set(key, g);
    }
    return g;
  },
  box(w, h, d, color, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(Rig.geo(w, h, d), Rig.mat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  },
  pivot(parent, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  },

  // Armed humanoid. Dimensions are in units where a standing human is about 1.9 tall.
  humanoid(o = {}) {
    const s = o.scale || 1;
    const root = new THREE.Group();
    const roll = Rig.pivot(root, 0, 0.95 * s, 0);
    const legL = Rig.pivot(roll, -0.16 * s, 0, 0);
    const legR = Rig.pivot(roll, 0.16 * s, 0, 0);
    Rig.box(0.22 * s, 0.9 * s, 0.24 * s, o.legs || o.cloth || 0x3a3228, legL, 0, -0.45 * s, 0);
    Rig.box(0.22 * s, 0.9 * s, 0.24 * s, o.legs || o.cloth || 0x3a3228, legR, 0, -0.45 * s, 0);

    const torso = Rig.pivot(roll, 0, 0, 0);
    Rig.box(0.62 * s, 0.7 * s, 0.36 * s, o.armor, torso, 0, 0.55 * s, 0);
    Rig.box(0.5 * s, 0.2 * s, 0.4 * s, o.cloth || o.armor, torso, 0, 0.18 * s, 0);
    if (o.cape) Rig.box(0.56 * s, 1.0 * s, 0.05 * s, o.cape, torso, 0, 0.35 * s, -0.22 * s);

    const head = Rig.pivot(torso, 0, 0.98 * s, 0);
    Rig.box(0.3 * s, 0.3 * s, 0.3 * s, o.skin || 0xd8b89a, head, 0, 0.15 * s, 0);
    if (o.helm) Rig.box(0.36 * s, 0.22 * s, 0.36 * s, o.helm, head, 0, 0.32 * s, 0);
    if (o.crown) {
      Rig.box(0.4 * s, 0.1 * s, 0.4 * s, 0xd9b44a, head, 0, 0.48 * s, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        Rig.box(0.07 * s, 0.14 * s, 0.07 * s, 0xd9b44a, head, Math.cos(a) * 0.18 * s, 0.56 * s, Math.sin(a) * 0.18 * s);
      }
    }

    const armL = Rig.pivot(torso, -0.42 * s, 0.9 * s, 0);
    const armR = Rig.pivot(torso, 0.42 * s, 0.9 * s, 0);
    Rig.box(0.2 * s, 0.65 * s, 0.2 * s, o.armor, armL, 0, -0.32 * s, 0);
    Rig.box(0.2 * s, 0.65 * s, 0.2 * s, o.armor, armR, 0, -0.32 * s, 0);

    const weapon = Rig.pivot(armR, 0, -0.62 * s, 0.05 * s);
    Rig.buildWeapon(weapon, o.weapon || 'sword', s);

    let shield = null;
    if (o.shield) {
      shield = Rig.pivot(armL, -0.14 * s, -0.25 * s, 0.1 * s);
      Rig.box(0.08 * s, 0.75 * s, 0.5 * s, o.shield, shield, 0, 0, 0.15 * s);
      Rig.box(0.1 * s, 0.1 * s, 0.1 * s, 0xd9b44a, shield, 0, 0, 0.15 * s);
    }

    const rig = { kind: 'humanoid', root, roll, legL, legR, torso, head, armL, armR, weapon, shield, s };
    rig.update = st => Rig.poseHumanoid(rig, st);
    return rig;
  },

  buildWeapon(pivot, type, s) {
    const steel = 0xd9dee6, wood = 0x5b3d24, gold = 0xc9a24a;
    if (type === 'sword') {
      Rig.box(0.07 * s, 0.85 * s, 0.03 * s, steel, pivot, 0, -0.42 * s, 0);
      Rig.box(0.28 * s, 0.06 * s, 0.06 * s, gold, pivot, 0, 0.0, 0);
      Rig.box(0.06 * s, 0.2 * s, 0.06 * s, wood, pivot, 0, 0.12 * s, 0);
    } else if (type === 'greatsword') {
      Rig.box(0.14 * s, 1.5 * s, 0.05 * s, steel, pivot, 0, -0.75 * s, 0);
      Rig.box(0.4 * s, 0.08 * s, 0.08 * s, gold, pivot, 0, 0.0, 0);
    } else if (type === 'axe') {
      Rig.box(0.06 * s, 0.9 * s, 0.06 * s, wood, pivot, 0, -0.4 * s, 0);
      Rig.box(0.3 * s, 0.35 * s, 0.05 * s, steel, pivot, 0.1 * s, -0.8 * s, 0);
    } else if (type === 'bow') {
      Rig.box(0.05 * s, 1.1 * s, 0.05 * s, wood, pivot, 0.12 * s, -0.5 * s, 0.1 * s);
    } else if (type === 'club') {
      Rig.box(0.18 * s, 1.0 * s, 0.18 * s, wood, pivot, 0, -0.5 * s, 0);
      Rig.box(0.42 * s, 0.42 * s, 0.42 * s, 0x6c6258, pivot, 0, -1.1 * s, 0);
    }
  },

  poseHumanoid(rig, st) {
    const t = st.t || 0, mv = st.moving || 0;
    const walk = Math.sin(t * 8) * mv;
    const idle = Math.sin(t * 2) * 0.03;
    const { legL, legR, armL, armR, torso, head, roll, shield } = rig;

    if (st.mounted) {
      legL.rotation.x = -1.35; legR.rotation.x = -1.35;
    } else {
      legL.rotation.x = walk * 0.7; legR.rotation.x = -walk * 0.7;
    }
    torso.position.y = idle * 0.6;
    head.rotation.x = 0;

    armL.rotation.set(-0.1 + walk * -0.25, 0, 0.08);
    armR.rotation.set(-0.25 + idle + walk * 0.25, 0, 0);
    if (shield) shield.visible = true;
    if (st.blocking && shield) {
      armL.rotation.set(-1.25, 0, 0.45);
      armR.rotation.set(-0.4, 0, 0);
    }
    if (st.mounted) {
      armL.rotation.set(-0.7, 0, 0.1);
      armR.rotation.set(-0.9, 0, 0);
    }

    const act = st.act;
    if (act) {
      if (act.type === 'light' || act.type === 'heavy') {
        const heavy = act.type === 'heavy';
        const back = heavy ? -2.7 : -1.9, fwd = heavy ? 1.6 : 1.1;
        armR.rotation.x = Rig.swing(act.p, back, fwd);
        armR.rotation.z = heavy ? -0.2 : 0.15;
        torso.rotation.y = Rig.swing(act.p, -0.4, 0.5) * (heavy ? 0.6 : 0.4);
      } else if (act.type === 'windup') {
        armR.rotation.x = -2.3 - Math.sin(act.p * Math.PI) * 0.2;
        torso.rotation.x = -0.1 * act.p;
      } else if (act.type === 'roll') {
        roll.rotation.x = -act.p * Math.PI * 2;
        roll.position.y = 0.95 * rig.s + Math.sin(act.p * Math.PI) * 0.15;
      } else if (act.type === 'recover') {
        armR.rotation.x = Math.max(-0.25, 1.1 - act.p * 1.3);
      }
    }
    if (!act || act.type !== 'roll') {
      roll.rotation.x = 0;
      roll.position.y = 0.95 * rig.s;
    }
    if (st.dead) {
      const d = Math.min(1, st.deathP || 0);
      roll.rotation.z = -d * Math.PI / 2;
      roll.position.y = 0.95 * rig.s * (1 - d * 0.7);
    } else {
      roll.rotation.z = st.hurt > 0 ? Math.sin(st.hurt * 40) * 0.05 * st.hurt : 0;
    }
  },

  // Helper used by attack poses. `p` runs 0..1 across the strike.
  swing(p, back, fwd) {
    if (p < 0.4) return Util.lerp(-0.4, back, p / 0.4);
    const q = (p - 0.4) / 0.6;
    return Util.lerp(back, fwd, q * q * (3 - 2 * q));
  },

  // Quadruped creatures: horse, tiger, panther, wolf, and the dragon body.
  quadruped(o) {
    const s = o.scale || 1;
    const L = o.len * s, H = o.height * s, W = o.width * s, legLen = o.legLen * s;
    const root = new THREE.Group();
    const body = Rig.pivot(root, 0, legLen + H / 2, 0);
    Rig.box(L, H, W, o.color, body);
    if (o.stripes) {
      for (let i = -3; i <= 3; i++) {
        Rig.box(0.12 * s, H * 1.02, W * 1.03, o.accent, body, i * L * 0.12, 0, 0);
      }
    }
    if (o.belly) Rig.box(L * 0.86, 0.15 * s, W * 1.02, o.belly, body, 0, -H * 0.4, 0);

    const neck = Rig.pivot(body, L / 2 - 0.1 * s, H * 0.25, 0);
    neck.rotation.z = -o.neckTilt;
    Rig.box(o.neckLen * s, o.neckLen * 0.6 * s, W * 0.7, o.color, neck, o.neckLen * 0.4 * s, o.neckLen * 0.2 * s, 0);
    if (o.mane) Rig.box(0.12 * s, o.neckLen * 0.5 * s, W * 0.8, o.mane, neck, 0.1 * s, o.neckLen * 0.6 * s, 0);
    const head = Rig.pivot(neck, o.neckLen * 0.85 * s, o.neckLen * 0.35 * s, 0);
    Rig.box(o.headLen * s, o.headSize * s, o.headSize * 0.8 * s, o.color, head, o.headLen * 0.4 * s, 0, 0);
    Rig.box(o.headLen * 0.5 * s, o.headSize * 0.5 * s, o.headSize * 0.6 * s, o.accent, head, o.headLen * 0.85 * s, -0.05 * s, 0);
    for (const sx of [-1, 1]) {
      Rig.box(0.08 * s, 0.1 * s, 0.08 * s, o.eye || 0xffd23a, head, o.headLen * 0.2 * s, 0.05 * s, sx * o.headSize * 0.42 * s);
      if (o.ears) Rig.box(0.12 * s, 0.22 * s, 0.1 * s, o.color, head, -0.05 * s, o.headSize * 0.6 * s, sx * o.headSize * 0.3 * s);
    }
    if (o.horns) {
      for (const sz of [-1, 1]) Rig.box(0.1 * s, 0.4 * s, 0.1 * s, o.accent, head, -0.1 * s, 0.4 * s, sz * 0.25 * s).rotation.z = 0.5;
    }

    const tail = Rig.pivot(body, -L / 2, H * 0.2, 0);
    tail.rotation.z = o.tailTilt ?? 0.5;
    Rig.box(o.tailLen * 0.3 * s, o.tailLen * s, 0.14 * s, o.tailColor || o.color, tail, 0, -o.tailLen * 0.5 * s, 0);

    const legs = [];
    const legOff = [[L * 0.35, W * 0.32], [L * 0.35, -W * 0.32], [-L * 0.35, W * 0.32], [-L * 0.35, -W * 0.32]];
    for (const [lx, lz] of legOff) {
      const leg = Rig.pivot(root, lx, legLen, lz);
      Rig.box(0.2 * s, legLen, 0.2 * s, o.legColor || o.accent, leg, 0, -legLen / 2, 0);
      Rig.box(0.24 * s, 0.1 * s, 0.26 * s, o.hoof || 0x222222, leg, 0, -legLen, 0);
      legs.push(leg);
    }

    let wings = null;
    if (o.wings) {
      wings = [];
      for (const sz of [-1, 1]) {
        const w = Rig.pivot(body, 0, H * 0.4, sz * W * 0.5);
        Rig.box(2.6 * s, 0.1 * s, 2.2 * s, o.wings, w, sz * 1.3 * s, 0, sz * 0.6 * s);
        wings.push(w);
      }
    }
    return { root, body, neck, head, tail, legs, wings, s, legLen, bodyY0: legLen + H / 2, neckTilt0: o.neckTilt };
  },

  creature(kind, opts = {}) {
    const s = opts.scale || 1;
    let c;
    if (kind === 'horse') {
      c = Rig.quadruped({ scale: s, len: 2.2, height: 0.9, width: 0.55, legLen: 1.1, color: MOUNTS.horse.color, accent: 0x2a1a10, neckLen: 0.9, neckTilt: 0.7, headLen: 0.7, headSize: 0.42, mane: 0x2a1a10, tailLen: 1.0, tailTilt: 0.7 });
    } else if (kind === 'tiger') {
      c = Rig.quadruped({ scale: s, len: 2.1, height: 0.8, width: 0.6, legLen: 0.85, color: MOUNTS.tiger.color, accent: MOUNTS.tiger.accent, stripes: true, neckLen: 0.7, neckTilt: 0.4, headLen: 0.6, headSize: 0.5, ears: true, tailLen: 1.6, tailTilt: 0.15, belly: 0xf1d9a8 });
    } else if (kind === 'panther') {
      c = Rig.quadruped({ scale: s, len: 2.1, height: 0.7, width: 0.5, legLen: 0.9, color: MOUNTS.panther.color, accent: MOUNTS.panther.accent, neckLen: 0.7, neckTilt: 0.3, headLen: 0.55, headSize: 0.42, ears: true, tailLen: 1.9, tailTilt: 0.1, eye: 0x7fd6ff });
    } else if (kind === 'wolf') {
      c = Rig.quadruped({ scale: s, len: 1.8, height: 0.7, width: 0.45, legLen: 0.75, color: opts.color || 0x6b6e72, accent: opts.accent || 0x3a3c40, neckLen: 0.5, neckTilt: 0.5, headLen: 0.6, headSize: 0.36, ears: true, tailLen: 1.1, tailTilt: 0.8, eye: 0xffb040 });
    } else if (kind === 'dragon') {
      c = Rig.quadruped({ scale: s, len: 2.4, height: 1.0, width: 0.8, legLen: 0.8, color: MOUNTS.dragon.color, accent: MOUNTS.dragon.accent, wings: 0x5a1f1f, neckLen: 1.2, neckTilt: 0.5, headLen: 0.9, headSize: 0.55, horns: true, tailLen: 2.6, tailTilt: 0.05, eye: 0xffe080, mane: 0x3a1010 });
    }
    if (kind === 'snake' || kind === 'serpent') return Rig.serpent(opts);
    c.kind = 'quad';
    c.update = st => Rig.poseQuad(c, st);
    return c;
  },

  poseQuad(c, st) {
    const t = st.t || 0, mv = st.moving || 0;
    const gait = t * (4 + mv * 8);
    c.legs.forEach((leg, i) => {
      const phase = i === 0 || i === 3 ? 0 : Math.PI;
      leg.rotation.x = Math.sin(gait + phase) * 0.55 * mv;
    });
    const bob = Math.abs(Math.sin(gait)) * 0.08 * mv;
    c.body.position.y = c.bodyY0 + bob + (st.flying ? 0.5 : 0);
    c.tail.rotation.y = Math.sin(t * 2.5) * 0.25;
    if (c.wings) {
      const flap = st.flying || st.airborne ? Math.sin(t * 9) * 0.9 : Math.sin(t * 1.5) * 0.15;
      c.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (flap + 0.3); });
    }
    c.neck.rotation.z = -c.neckTilt0 - (st.attack ? 0.4 : 0);
  },

  // A segmented serpent. Segments trail the head and undulate.
  serpent(opts = {}) {
    const s = opts.scale || 1;
    const root = new THREE.Group();
    const color = MOUNTS.snake.color, accent = MOUNTS.snake.accent;
    const segs = [];
    const count = 9;
    for (let i = 0; i < count; i++) {
      const r = (0.55 - i * 0.035) * s;
      const seg = Rig.pivot(root, 0, r, -i * 0.7 * s);
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), Rig.mat(i % 2 ? color : accent));
      seg.add(m);
      if (i === 0) {
        // Head: a snout, two eyes and a forked tongue.
        Rig.box(0.5 * s, 0.35 * s, 0.7 * s, color, seg, 0, 0.05 * s, 0.6 * s);
        Rig.box(0.1 * s, 0.1 * s, 0.1 * s, 0xffd23a, seg, 0.2 * s, 0.25 * s, 0.35 * s);
        Rig.box(0.1 * s, 0.1 * s, 0.1 * s, 0xffd23a, seg, -0.2 * s, 0.25 * s, 0.35 * s);
        const tongue = Rig.box(0.04 * s, 0.04 * s, 0.6 * s, 0xc83030, seg, 0, 0, 1.2 * s);
        tongue.userData.tongue = true;
      }
      segs.push(seg);
    }
    const rig = { kind: 'serpent', root, segs, s, body: root, legs: [] };
    rig.update = st => {
      const t = st.t || 0, mv = st.moving || 0;
      segs.forEach((seg, i) => {
        const k = i / count;
        const wave = Math.sin(t * (2 + mv * 4) - i * 0.6) * (0.12 + mv * 0.45) * (0.3 + k);
        seg.position.x = wave * s;
        const sag = st.coiled ? 0 : Math.sin(t * 1.5 - i * 0.4) * 0.05;
        seg.position.y = seg.userData.y0 ?? (seg.userData.y0 = seg.position.y);
        seg.position.y += sag;
      });
      const tongue = segs[0].children.find(c => c.userData.tongue);
      if (tongue) tongue.scale.z = 0.5 + (Math.sin(t * 8) > 0.6 ? 1 : 0);
      if (st.dead) root.rotation.z = -Math.min(1, st.deathP || 0) * Math.PI / 2;
      else root.rotation.z = 0;
    };
    return rig;
  },
};
