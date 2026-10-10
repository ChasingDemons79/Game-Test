// Coordinator: owns the loop, the state machine, accounts and saves, bonfires, boss arenas,
// the tutorial and the camera. Everything else plugs in through this object.

const Accounts = {
  memory: {},
  read() {
    try {
      const data = JSON.parse(localStorage.getItem(CONFIG.SAVE_KEY) || '{}');
      return data.accounts || {};
    } catch (e) {
      return this.memory;
    }
  },
  write(accounts) {
    this.memory = accounts;
    try {
      localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify({ accounts }));
    } catch (e) { /* storage unavailable: the in-memory copy still works for this session */ }
  },
  get(key) { return this.read()[key] || null; },
  set(key, value) {
    const all = this.read();
    all[key] = value;
    this.write(all);
  },
  lastKey() {
    try { return localStorage.getItem(CONFIG.LAST_KEY) || null; } catch (e) { return this.memory.__last || null; }
  },
  setLast(key) {
    this.memory.__last = key;
    try { localStorage.setItem(CONFIG.LAST_KEY, key); } catch (e) { /* ignore */ }
  },
};

// Two tutorials with the same goals. Each step's `done` check is shared, only the wording differs.
const TUTORIAL_STEPS = {
  keyboard: [
    { text: 'Move with W A S D', done: g => g.player.counts.moved > 6 },
    { text: 'Look around with the mouse (click the game first)', done: g => g.lookSum > 250 },
    { text: 'Strike the training dummy: left click (twice)', done: g => g.player.counts.attacks >= 2 },
    { text: 'Hold right click or C to block. Blocking drains stamina', done: g => g.player.counts.blocks > 0.8 },
    { text: 'Roll with Space to dodge', done: g => g.player.counts.rolls >= 1 },
    {
      text: 'Drink a flask with F (you took a wound)',
      enter: g => { g.player.hp = g.player.maxHp * 0.65; },
      done: g => g.player.counts.flasks >= 1,
    },
    { text: 'Choose a companion from the menu that opens', enter: g => g.openCompanionMenu(null), done: g => !!g.companion },
    { text: 'Mount with R. Use V for its ability', done: g => g.player.counts.mounts >= 1 },
    { text: 'Summon your ally with T', done: g => g.player.counts.summons >= 1 },
    { text: 'Rest at the camp bonfire with E', done: g => g.restCount >= 1 },
  ],
  pad: [
    { text: 'Move with the left stick', done: g => g.player.counts.moved > 6 },
    { text: 'Look around with the right stick', done: g => g.lookSum > 250 },
    { text: 'Strike the training dummy: X (twice)', done: g => g.player.counts.attacks >= 2 },
    { text: 'Hold LB to block. Blocking drains stamina', done: g => g.player.counts.blocks > 0.8 },
    { text: 'Roll with A to dodge', done: g => g.player.counts.rolls >= 1 },
    {
      text: 'Drink a flask with D-pad down (you took a wound)',
      enter: g => { g.player.hp = g.player.maxHp * 0.65; },
      done: g => g.player.counts.flasks >= 1,
    },
    { text: 'Choose a companion from the menu that opens', enter: g => g.openCompanionMenu(null), done: g => !!g.companion },
    { text: 'Mount with View. Press RB for its ability', done: g => g.player.counts.mounts >= 1 },
    { text: 'Summon your ally with D-pad up', done: g => g.player.counts.summons >= 1 },
    { text: 'Rest at the camp bonfire with B', done: g => g.restCount >= 1 },
  ],
};

const Game = {
  difficulty: DIFFICULTIES[1],
  state: 'boot',
  player: null,
  companion: null,
  pet: null,
  enemies: [],
  bosses: [],
  activeBoss: null,
  lockTarget: null,
  camYaw: 0,
  camPitch: 0.3,
  camDist: 6.5,
  dropPile: null,
  account: null,
  defeated: new Set(),
  discovered: new Set(),
  lastBonfire: 'camp',
  throneOpen: false,
  tut: null,
  lookSum: 0,
  restCount: 0,
  petCD: 0,
  deathT: 0,
  victoryT: 0,
  sealMsgT: 0,
  time: 0,
  titleT: 0,
  pendingVictory: false,
  authMode: 'signup',
  tutChoice: 'keyboard',
  shake: 0,
  highQuality: true,

  async init() {
    const canvas = document.getElementById('game');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new THREE.Scene();
    // A vertical sky gradient that fades into the fog colour at the horizon.
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4;
    skyCanvas.height = 256;
    const sky = skyCanvas.getContext('2d');
    const grad = sky.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#3f6fa3');
    grad.addColorStop(0.55, '#b8cfe0');
    grad.addColorStop(1, '#d9cfb0');
    sky.fillStyle = grad;
    sky.fillRect(0, 0, 4, 256);
    this.scene.background = new THREE.CanvasTexture(skyCanvas);
    // The same sky lights and reflects the materials, so metal and stone pick up believable highlights.
    const envTex = new THREE.CanvasTexture(skyCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(envTex).texture;
    pmrem.dispose();
    envTex.dispose();
    this.scene.fog = new THREE.Fog(0xb8cfe0, 150, 470);
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 900);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a3020, 0.35);
    const sun = new THREE.DirectionalLight(0xffe7b0, 1.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.5;
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);
    this.setQuality(localStorage.getItem('hollowcrown.graphics') !== 'low');

    // Textures load first, so every material is built with its maps.
    await Materials.load(this.renderer);
    Fx.init(this.scene);
    World.build(this.scene);
    UI.init();
    Input.attach(canvas);
    this.buildDifficultyList();
    this.bindUi();

    this.player = new Player();
    this.scene.add(this.player.group);
    this.player.reset(SITES.camp.x, World.heightAt(SITES.camp.x, SITES.camp.z), SITES.camp.z);

    Sound.loadSettings();
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    this.last = performance.now();
    this.refreshTitle();
    this.setState('title');
    requestAnimationFrame(now => this.loop(now));
  },

  // High quality turns on shadows and full pixel density. Low is for older machines.
  setQuality(high) {
    this.highQuality = high;
    this.renderer.shadowMap.enabled = high;
    this.sun.castShadow = high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    try { localStorage.setItem('hollowcrown.graphics', high ? 'high' : 'low'); } catch (e) { /* optional */ }
  },

  // The shadow map follows the focus point so shadows stay sharp around the player.
  followSun(x, y, z) {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + 60, y + 110, z + 35);
  },

  bindUi() {
    const $ = id => document.getElementById(id);
    $('btn-new').onclick = () => this.openAuth('signup');
    $('btn-signin').onclick = () => this.openAuth('signin');
    $('btn-continue').onclick = () => this.continueLast();
    $('btn-controls').onclick = () => this.setState('controls');
    $('btn-padguide').onclick = () => this.setState('padguide');
    $('padguide-back').onclick = () => this.setState('title');
    $('tut-keyboard').onclick = () => this.setTutChoice('keyboard');
    $('tut-pad').onclick = () => this.setTutChoice('pad');
    $('controls-back').onclick = () => {
      if (this.controlsFromGame) {
        this.controlsFromGame = false;
        this.openPause();
      } else {
        this.setState('title');
      }
    };
    $('diff-back').onclick = () => this.setState('title');
    $('auth-back').onclick = () => this.setState('title');
    $('auth-switch').onclick = () => this.openAuth(this.authMode === 'signup' ? 'signin' : 'signup');
    $('auth-form').addEventListener('submit', e => { e.preventDefault(); this.submitAuth(); });
    $('victory-continue').onclick = () => this.closeVictory();
  },

  buildDifficultyList() {
    const list = document.getElementById('diff-list');
    list.innerHTML = '';
    for (const d of DIFFICULTIES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<strong>${d.name}</strong><span class="sub">${d.desc}</span>`;
      b.onclick = () => this.chooseDifficulty(d);
      list.appendChild(b);
    }
  },

  refreshTitle() {
    const last = Accounts.lastKey();
    const acc = last ? Accounts.get(last) : null;
    const cont = document.getElementById('btn-continue');
    cont.disabled = !(acc && acc.save);
    cont.textContent = acc && acc.save ? `Continue as ${acc.name}` : 'Continue';
    document.getElementById('title-user').textContent = acc ? `Last pilgrim: ${acc.name}` : '';
  },

  setState(name) {
    this.state = name;
    const screens = { title: 'screen-title', auth: 'screen-auth', difficulty: 'screen-difficulty', controls: 'screen-controls', padguide: 'screen-padguide' };
    if (screens[name]) {
      UI.show(screens[name]);
      UI.showHud(false);
      UI.closeMenu();
    } else {
      UI.hideScreens();
      UI.showHud(true);
    }
    if (name === 'title') this.refreshTitle();
    if (name === 'difficulty') this.setTutChoice(Input.usingGamepad() ? 'pad' : 'keyboard');
    if (name === 'playing') UI.closeMenu();
    if (name === 'dead') UI.death(true);
  },

  openAuth(mode) {
    this.authMode = mode;
    const signup = mode === 'signup';
    document.getElementById('auth-kicker').textContent = signup ? 'Sign up' : 'Sign in';
    document.getElementById('auth-title').textContent = signup ? 'Name your pilgrim' : 'Welcome back, pilgrim';
    document.getElementById('auth-submit').textContent = signup ? 'Create pilgrim' : 'Sign in';
    document.getElementById('auth-switch').textContent = signup ? 'Already have a pilgrim? Sign in' : 'New here? Create a pilgrim';
    document.getElementById('auth-confirm-row').classList.toggle('hidden', !signup);
    document.getElementById('auth-confirm').required = signup;
    document.getElementById('auth-error').textContent = '';
    document.getElementById('auth-form').reset();
    this.setState('auth');
    setTimeout(() => document.getElementById('auth-name').focus(), 50);
  },

  submitAuth() {
    const err = document.getElementById('auth-error');
    const name = document.getElementById('auth-name').value.trim();
    const pass = document.getElementById('auth-pass').value;
    const confirm = document.getElementById('auth-confirm').value;
    const key = name.toLowerCase();
    err.textContent = '';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { err.textContent = 'Use 3 to 16 letters, numbers or underscores.'; return; }
    if (pass.length < 4) { err.textContent = 'Your password needs at least 4 characters.'; return; }

    if (this.authMode === 'signup') {
      if (pass !== confirm) { err.textContent = 'The passwords do not match.'; return; }
      if (Accounts.get(key)) { err.textContent = 'That name is already taken.'; return; }
      const salt = Util.randomSalt();
      Accounts.set(key, { name, salt, hash: Util.hashStr(salt + pass), save: null });
      this.account = { key, name };
      Accounts.setLast(key);
      this.chooseDifficultyScreen();
      return;
    }

    const acc = Accounts.get(key);
    if (!acc) { err.textContent = 'No pilgrim by that name.'; return; }
    if (acc.hash !== Util.hashStr(acc.salt + pass)) { err.textContent = 'Wrong password.'; return; }
    this.account = { key, name: acc.name };
    Accounts.setLast(key);
    if (acc.save) this.loadGame(acc.save);
    else this.chooseDifficultyScreen();
  },

  chooseDifficultyScreen() {
    this.setState('difficulty');
  },

  chooseDifficulty(d) {
    this.difficulty = d;
    this.defeated = new Set();
    this.discovered = new Set(['camp']);
    this.lastBonfire = 'camp';
    this.throneOpen = false;
    this.player.stats = { vigor: 1, end: 1, str: 1 };
    this.player.souls = 0;
    this.startWorld({ tutorial: true, tutMode: this.tutChoice });
    this.saveGame();
  },

  // The difficulty screen offers a keyboard or controller tutorial. It defaults to the device in use.
  setTutChoice(mode) {
    this.tutChoice = mode;
    document.getElementById('tut-keyboard').classList.toggle('selected', mode === 'keyboard');
    document.getElementById('tut-pad').classList.toggle('selected', mode === 'pad');
  },

  continueLast() {
    const acc = Accounts.get(Accounts.lastKey());
    if (!acc || !acc.save) return;
    this.account = { key: Accounts.lastKey(), name: acc.name };
    this.loadGame(acc.save);
  },

  saveGame() {
    if (!this.account) return;
    const acc = Accounts.get(this.account.key);
    if (!acc) return;
    const p = this.player;
    acc.save = {
      difficulty: this.difficulty.id,
      souls: p.souls,
      stats: { ...p.stats },
      defeated: [...this.defeated],
      discovered: [...this.discovered],
      companion: this.companion ? this.companion.kind : null,
      lastBonfire: this.lastBonfire,
      tutorialDone: !this.tut,
      throneOpen: this.throneOpen,
      drop: this.dropPile ? { x: this.dropPile.x, z: this.dropPile.z, amount: this.dropPile.amount } : null,
    };
    Accounts.set(this.account.key, acc);
  },

  loadGame(save) {
    this.difficulty = DIFFICULTIES.find(d => d.id === save.difficulty) || DIFFICULTIES[1];
    this.defeated = new Set(save.defeated || []);
    this.discovered = new Set(save.discovered || ['camp']);
    this.lastBonfire = save.lastBonfire || 'camp';
    this.player.stats = { ...save.stats };
    this.player.souls = save.souls || 0;
    this.throneOpen = !!save.throneOpen;
    this.startWorld({ tutorial: !save.tutorialDone, tutMode: Input.usingGamepad() ? 'pad' : 'keyboard', companion: save.companion, drop: save.drop });
  },

  // Rebuilds enemies and bosses for the chosen difficulty and places the player at their bonfire.
  startWorld({ tutorial = false, tutMode = 'keyboard', companion = null, drop = null } = {}) {
    for (const e of this.enemies) this.scene.remove(e.group);
    for (const b of this.bosses) this.scene.remove(b.group);
    if (this.pet) { this.scene.remove(this.pet.group); this.pet = null; }
    if (this.player.rider) this.player.dismount();
    if (this.companion) { this.scene.remove(this.companion.group); this.companion = null; }
    this.enemies = [];
    this.bosses = [];
    this.activeBoss = null;
    this.lockTarget = null;
    this.clearDrop();

    this.player.recalcStats(false);
    this.player.flasks = this.difficulty.flasks;
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.maxStamina;

    if (companion) this.setCompanion(companion, { silent: true });

    this.spawnCamps();
    for (const s of Object.values(SITES)) {
      if (!s.boss) continue;
      const b = new Boss(BOSS_DEFS[s.boss], s);
      this.scene.add(b.group);
      this.bosses.push(b);
      if (this.defeated.has(b.id)) this.markBossDown(b);
    }
    if (!this.throneOpen && !World.sealRing) World.buildSealRing(this.scene);
    if (this.throneOpen) World.removeSealRing();

    const bf = World.bonfireById(this.lastBonfire) || World.bonfireById('camp');
    const x = bf.x + 2.5, z = bf.z + 1.5;
    this.player.reset(x, World.heightAt(x, z), z);
    this.player.yaw = Math.PI;
    this.camYaw = this.player.yaw;   // the camera starts behind the player, facing the same way
    this.restoreDrop(drop);

    this.restCount = 0;
    this.tut = tutorial ? { step: 0, mode: tutMode } : null;
    this.setState('playing');
    if (this.tut) {
      const c = SITES.camp;
      this.spawnEnemy('skeleton', c.x + 3, c.z + 10, { dummy: true });
      this.enterTutorialStep();
    }
    this.banner(this.difficulty.name + ' difficulty', tutorial ? 'Follow the trial in the corner' : 'The road continues', 3500);
    this.saveGame();
  },

  markBossDown(b) {
    b.dead = true;
    b.hp = 0;
    b.deathT = 6;
    b.group.rotation.z = -0.9;
    b.y = World.heightAt(b.x, b.z) - 1.2;
    b.group.position.y = b.y;
  },

  // Enemies spawn from the camps. Resting at a bonfire brings them back.
  spawnCamps() {
    for (const e of this.enemies) this.scene.remove(e.group);
    this.enemies = [];
    const r = Util.rng(CONFIG.SEED + 99);
    for (const c of CAMPS) {
      if (Util.dist(c.x, c.z, LAKE.x, LAKE.z) < LAKE.r + 8) continue;
      for (let i = 0; i < c.n; i++) {
        const a = r() * Math.PI * 2, d = 3 + r() * 9;
        this.spawnEnemy(c.type, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d);
      }
    }
  },

  spawnEnemy(type, x, z, opts = {}) {
    const e = new Enemy(type, x, z, opts);
    this.scene.add(e.group);
    this.enemies.push(e);
    return e;
  },

  onEnemyDeath(e) {
    if (e.dummy) return;
    Sound.play('kill');
    const gain = Math.round(e.def.souls * this.difficulty.souls);
    this.player.souls += gain;
    UI.setSouls(this.player.souls);
  },

  hostileTargets() {
    const list = [];
    for (const e of this.enemies) if (!e.dead && !e.removed) list.push(e);
    for (const b of this.bosses) if (!b.dead) list.push(b);
    return list;
  },

  setCompanion(kind, { silent = false } = {}) {
    if (this.player.rider) this.player.dismount();
    if (this.companion) this.scene.remove(this.companion.group);
    if (this.pet) { this.scene.remove(this.pet.group); this.pet = null; }
    const c = new Companion(kind);
    const p = this.player;
    c.x = p.x - Math.sin(p.yaw) * 2 - 1.5;
    c.z = p.z - Math.cos(p.yaw) * 2 + 1.5;
    c.y = World.heightAt(c.x, c.z);
    c.yaw = p.yaw;
    c.syncGroup();
    this.scene.add(c.group);
    this.companion = c;
    if (!silent) this.msg(`${c.def.name} is now your companion`);
    this.saveGame();
  },

  trySummonPet() {
    if (this.state !== 'playing') return;
    if (!this.companion) { this.msg('You have no companion yet. Choose one at a bonfire.'); return; }
    if (this.pet && !this.pet.removed) { this.msg('Your ally is already fighting beside you'); return; }
    if (this.petCD > 0) { this.msg(`Your ally answers again in ${Math.ceil(this.petCD)}s`); return; }
    const p = this.player;
    const pet = new Companion(this.companion.kind, { pet: true });
    pet.x = p.x - Math.sin(p.yaw) * 2.2 + Math.cos(p.yaw) * 2;
    pet.z = p.z - Math.cos(p.yaw) * 2.2 - Math.sin(p.yaw) * 2;
    pet.y = World.heightAt(pet.x, pet.z);
    pet.yaw = p.yaw;
    pet.syncGroup();
    this.scene.add(pet.group);
    this.pet = pet;
    Sound.play('summon');
    this.petCD = PET_TUNING.cooldown;
    p.counts.summons++;
    Fx.spark(pet.x, pet.y + 1, pet.z, 0xffe0a0, 18);
    this.msg(`${pet.def.name} answers your call`);
  },

  toggleLock() {
    if (this.lockTarget) {
      this.lockTarget = null;
      this.msg('Lock released');
      return;
    }
    const t = Combat.nearest(this.player, this.hostileTargets(), 26);
    if (!t) { this.msg('No foe in sight'); return; }
    this.lockTarget = t;
  },

  onPlayerHurt() {
    UI.flash();
    this.shake = Math.max(this.shake, 0.3);
  },

  onPlayerDeath() {
    Sound.play('death');
    this.setState('dead');
    this.deathT = 0;
    this.lockTarget = null;
    if (this.player.rider) this.player.dismount();
    if (this.player.souls > 0) {
      this.clearDrop();
      this.dropPile = { x: this.player.x, z: this.player.z, amount: this.player.souls, mesh: null };
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.85 }));
      mesh.position.set(this.dropPile.x, World.heightAt(this.dropPile.x, this.dropPile.z) + 0.8, this.dropPile.z);
      this.scene.add(mesh);
      this.dropPile.mesh = mesh;
      this.player.souls = 0;
      UI.setSouls(0);
    }
    this.msg('You died. Return to your souls to reclaim them.');
  },

  restoreDrop(drop) {
    if (!drop) return;
    this.dropPile = { x: drop.x, z: drop.z, amount: drop.amount, mesh: null };
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.85 }));
    mesh.position.set(drop.x, World.heightAt(drop.x, drop.z) + 0.8, drop.z);
    this.scene.add(mesh);
    this.dropPile.mesh = mesh;
  },

  clearDrop() {
    if (this.dropPile?.mesh) this.scene.remove(this.dropPile.mesh);
    this.dropPile = null;
  },

  respawnPlayer() {
    const bf = World.bonfireById(this.lastBonfire) || World.bonfireById('camp');
    const x = bf.x + 2.5, z = bf.z + 1.5;
    this.player.reset(x, World.heightAt(x, z), z);
    if (this.activeBoss) {
      this.activeBoss.reset();
      this.removeSummons();
      this.activeBoss = null;
      UI.bossBar(null);
    }
    UI.death(false);
    this.setState('playing');
  },

  removeSummons() {
    for (const e of this.enemies) if (e.summoned) e.removed = true;
  },

  // Bonfire actions: rest, level up, change companion, travel.
  openBonfire(bf) {
    this.setState('menu');
    this.openMenuFor(bf);
  },

  // Any menu freezes the world. Opening one from inside the simulation (tutorial steps) is fine.
  enterMenu() {
    if (this.state !== 'menu') this.setState('menu');
  },

  openMenuFor(bf) {
    this.enterMenu();
    const souls = this.player.souls;
    const items = [
      { label: 'Rest', sub: 'Restore health and stamina, refill flasks, and let the foes return', onPick: () => this.rest(bf) },
      { label: 'Level up', sub: `Souls ${souls.toLocaleString()}. Spend souls to grow stronger`, onPick: () => this.openLevelMenu(bf) },
      { label: 'Companion', sub: this.companion ? `Current: ${this.companion.def.name}` : 'Choose your steed', onPick: () => this.openCompanionMenu(bf) },
      { label: 'Travel', sub: 'Journey to another bonfire you have found', onPick: () => this.openTravelMenu(bf) },
      { label: 'Leave', onPick: () => this.closeMenu() },
    ];
    UI.menu(bf.name, 'A bonfire crackles softly beside you.', items, { onBack: () => this.closeMenu() });
  },

  levelCost(stat) {
    return Math.round(40 * Math.pow(this.player.stats[stat], 1.5));
  },

  openLevelMenu(bf) {
    this.enterMenu();
    const p = this.player;
    const rows = [
      { key: 'vigor', name: 'Vigor', gain: `+${CONFIG.PLAYER.hpPerVigor} max health` },
      { key: 'end', name: 'Endurance', gain: `+${CONFIG.PLAYER.staminaPerEnd} max stamina` },
      { key: 'str', name: 'Strength', gain: `+${Math.round(CONFIG.PLAYER.damagePerStr * 100)}% damage` },
    ];
    const items = rows.map(r => {
      const cost = this.levelCost(r.key);
      return {
        label: `${r.name} ${p.stats[r.key]}`,
        sub: `${r.gain}  ·  costs ${cost.toLocaleString()} souls`,
        disabled: p.souls < cost,
        onPick: () => {
          p.souls -= cost;
          p.stats[r.key]++;
          p.recalcStats(true);
          UI.setSouls(p.souls);
          this.msg(`${r.name} rises to ${p.stats[r.key]}`);
          this.saveGame();
          this.openLevelMenu(bf);
        },
      };
    });
    items.push({ label: 'Back', onPick: () => this.openMenuFor(bf) });
    UI.menu('Level up', `Souls: ${p.souls.toLocaleString()}`, items, { onBack: () => this.openMenuFor(bf) });
  },

  openCompanionMenu(bf) {
    this.enterMenu();
    const items = Object.entries(MOUNTS).map(([kind, def]) => ({
      label: `${def.name}${this.companion && this.companion.kind === kind ? ' (current)' : ''}`,
      sub: `${def.desc} Ability: ${def.abilityName}.`,
      onPick: () => {
        this.setCompanion(kind);
        // Close the menus so the mount key works straight away.
        this.closeMenu();
        this.msg(`Press ${Input.usingGamepad() ? 'View' : 'R'} to mount ${def.name}`);
      },
    }));
    if (bf) items.push({ label: 'Back', onPick: () => this.openMenuFor(bf) });
    UI.menu('Choose your companion', 'It carries you across the realm and can summon an ally in battle.', items, {
      onBack: () => { if (bf) this.openMenuFor(bf); else this.closeMenu(); },
    });
  },

  openTravelMenu(bf) {
    this.enterMenu();
    const items = World.bonfires
      .filter(b => this.discovered.has(b.id) && b.id !== bf.id)
      .map(b => ({
        label: b.name,
        sub: `${Math.round(Util.dist(bf.x, bf.z, b.x, b.z))} units away`,
        onPick: () => this.travelTo(b),
      }));
    if (!items.length) items.push({ label: 'No other bonfires found yet', disabled: true });
    items.push({ label: 'Back', onPick: () => this.openMenuFor(bf) });
    UI.menu('Travel', 'Fast travel to a bonfire you have discovered', items, { onBack: () => this.openMenuFor(bf) });
  },

  travelTo(b) {
    this.closeMenu();
    const p = this.player;
    if (p.rider) p.dismount();
    p.x = b.x + 2.5; p.z = b.z + 1.5;
    p.y = World.heightAt(p.x, p.z);
    p.vx = p.vz = p.vy = 0;
    this.lastBonfire = b.id;
    this.msg(`You arrive at ${b.name}`);
    this.saveGame();
  },

  rest(bf) {
    this.closeMenu();
    Sound.play('rest');
    this.lastBonfire = bf.id;
    const p = this.player;
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    p.flasks = this.difficulty.flasks;
    p.stagger = 0;
    p.act = null;
    if (this.companion) {
      if (this.companion.downed) {
        this.companion.downed = false;
        this.companion.dead = false;
        this.companion.group.visible = true;
        this.companion.group.scale.setScalar(1);
        this.companion.deathT = 0;
      }
      this.companion.hp = this.companion.maxHp;
    }
    if (this.pet) { this.scene.remove(this.pet.group); this.pet = null; }
    this.petCD = 0;
    if (!this.tut) this.spawnCamps();
    for (const b of this.bosses) if (!b.dead && !b.active) b.reset();
    if (this.activeBoss) {
      this.activeBoss.reset();
      this.removeSummons();
      this.activeBoss = null;
      UI.bossBar(null);
    }
    this.restCount++;
    Fx.spark(bf.x, World.heightAt(bf.x, bf.z) + 1.5, bf.z, 0xffb050, 26);
    this.msg('You rest. The foes of the realm have returned.');
    this.saveGame();
  },

  closeMenu() {
    UI.closeMenu();
    if (this.state === 'menu') this.setState('playing');
  },

  openPause() {
    this.setState('menu');
    if (document.pointerLockElement) document.exitPointerLock();
    const items = [{ label: 'Resume', onPick: () => this.closeMenu() }];
    items.push({ label: `Sound effects: ${Sound.sfxOn ? 'On' : 'Off'}`, onPick: () => { Sound.setSfx(!Sound.sfxOn); this.openPause(); } });
    items.push({ label: `Music: ${Sound.musicOn ? 'On' : 'Off'}`, onPick: () => { Sound.setMusic(!Sound.musicOn); this.openPause(); } });
    items.push({ label: `Graphics: ${this.highQuality ? 'High (shadows)' : 'Low'}`, sub: 'Turn off shadows on older machines', onPick: () => { this.setQuality(!this.highQuality); this.openPause(); } });
    if (this.tut) items.push({ label: 'Skip tutorial', sub: 'Begin your journey now', onPick: () => this.finishTutorial() });
    items.push({ label: 'Keyboard tutorial', sub: 'Restart the tutorial with key prompts', onPick: () => this.startTutorial('keyboard') });
    items.push({ label: 'Controller tutorial', sub: 'Restart the tutorial with gamepad prompts', onPick: () => this.startTutorial('pad') });
    items.push({ label: 'Controls', sub: 'Review the keys and buttons', onPick: () => { this.controlsFromGame = true; this.setState('controls'); } });
    items.push({ label: 'Save and return to title', onPick: () => { this.saveGame(); this.setState('title'); } });
    UI.menu('Paused', 'Your progress is saved at bonfires and when you leave', items, { onBack: () => this.closeMenu() });
  },

  msg(text) { UI.msg(text); },
  banner(title, sub, ms) { UI.banner(title, sub, ms); },

  // Tutorial
  tutSteps() {
    return this.tut ? TUTORIAL_STEPS[this.tut.mode] : null;
  },

  enterTutorialStep() {
    const step = this.tutSteps()[this.tut.step];
    if (!step) return;
    step.enter?.(this);
  },

  // Restarts the tutorial in the chosen wording. Used from the pause menu.
  startTutorial(mode) {
    this.closeMenu();
    this.tut = { step: 0, mode };
    this.lookSum = 0;
    this.restCount = 0;
    if (!this.enemies.some(e => e.dummy)) {
      const c = SITES.camp;
      this.spawnEnemy('skeleton', c.x + 3, c.z + 10, { dummy: true });
    }
    this.enterTutorialStep();
    this.msg(mode === 'pad' ? 'Controller tutorial started' : 'Keyboard tutorial started');
    this.saveGame();
  },

  updateTutorial() {
    if (!this.tut) return;
    const steps = this.tutSteps();
    const step = steps[this.tut.step];
    if (step && step.done(this)) {
      this.tut.step++;
      if (this.tut.step >= steps.length) {
        this.finishTutorial();
        return;
      }
      this.enterTutorialStep();
    }
  },

  finishTutorial() {
    this.tut = null;
    for (const e of this.enemies) if (e.dummy) e.removed = true;
    this.saveGame();
    this.banner('The road opens', 'Five guardians hold the realm. The throne waits beyond the seal.', 5000);
    UI.setTutorial(null);
  },

  // Boss callbacks
  onBossActivated(boss) {
    this.activeBoss = boss;
    Sound.play('roar');
    Sound.setBoss(true);
    UI.bossBar(boss);
    this.banner(boss.name, boss.def.intro, 4500);
  },

  onBossPhase(boss, p) {
    Sound.play('roar');
    this.banner(boss.name, boss.def.phaseLines[p - 1], 3500);
    Fx.ring(boss.x, boss.y, boss.z, 8, 0xff8060, 0.8);
  },

  onBossDefeated(boss) {
    this.defeated.add(boss.id);
    const gain = Math.round(boss.def.souls * this.difficulty.souls);
    this.player.souls += gain;
    UI.setSouls(this.player.souls);
    Sound.play('bossDown');
    if (this.activeBoss === boss) {
      this.activeBoss = null;
      UI.bossBar(null);
      Sound.setBoss(false);
    }
    this.lockTarget = null;
    this.banner(`${boss.name} has fallen`, `+${gain.toLocaleString()} souls`, 4500);
    if (this.defeated.size >= this.bosses.length - 1 && !this.throneOpen) {
      this.throneOpen = true;
      Sound.play('seal');
      World.removeSealRing();
      this.banner('The seal breaks', 'The Throne of the Hollow Crown lies open', 5000);
    }
    if (boss.id === 'king') this.pendingVictory = true;
    this.saveGame();
  },

  closeVictory() {
    UI.victory(false);
    this.setState('playing');
  },

  // Arenas, seals and bonfire proximity
  checkArenas() {
    const p = this.player;
    for (const b of this.bosses) {
      if (b.dead || b.active) continue;
      if (Util.dist(p.x, p.z, b.site.x, b.site.z) < b.site.r - 1 && !p.dead) b.activate();
    }
    const ab = this.activeBoss;
    if (ab && !ab.dead) {
      const s = ab.site;
      const d = Util.dist(p.x, p.z, s.x, s.z);
      const lim = s.r - 1.5;
      if (d > lim && d > 0.001) {
        p.x = s.x + (p.x - s.x) * lim / d;
        p.z = s.z + (p.z - s.z) * lim / d;
      }
    }
    if (!this.throneOpen) {
      const t = SITES.throne;
      const R = t.sealRadius + 1;
      const d = Util.dist(p.x, p.z, t.x, t.z);
      if (d < R && d > 0.001) {
        p.x = t.x + (p.x - t.x) * R / d;
        p.z = t.z + (p.z - t.z) * R / d;
        if (this.time - this.sealMsgT > 3) {
          this.sealMsgT = this.time;
          this.msg('A sealed gate bars the way. Defeat the five guardians first.');
        }
      }
    }
  },

  checkWorld() {
    const p = this.player;
    const bf = World.nearestBonfire(p.x, p.z, 4.5);
    if (bf && !this.discovered.has(bf.id)) {
      this.discovered.add(bf.id);
      Sound.play('pickup');
      this.msg(`Bonfire discovered: ${bf.name}`);
      this.saveGame();
    }
    if (this.dropPile && Util.dist(p.x, p.z, this.dropPile.x, this.dropPile.z) < CONFIG.SOULS_DROP_RADIUS) {
      p.souls += this.dropPile.amount;
      Sound.play('pickup');
      this.msg(`Recovered ${this.dropPile.amount.toLocaleString()} souls`);
      this.clearDrop();
      UI.setSouls(p.souls);
      this.saveGame();
    }
    // The most relevant prompt wins: fallen souls, then a bonfire, then the companion.
    const btn = Input.usingGamepad() ? 'View' : 'R';
    let prompt = '';
    if (p.rider) {
      prompt = `${btn}: dismount ${p.rider.def.name}`;
    } else if (this.companion && !this.companion.downed && Util.dist(p.x, p.z, this.companion.x, this.companion.z) < 7) {
      prompt = `${btn}: mount ${this.companion.def.name}`;
    }
    if (bf) {
      const rest = Input.usingGamepad() ? 'B' : 'E';
      prompt = `${rest}: rest at the bonfire`;
      if (Input.pressed('interact') && this.state === 'playing') this.openBonfire(bf);
    }
    if (this.dropPile && Util.dist(p.x, p.z, this.dropPile.x, this.dropPile.z) < 8) {
      prompt = 'Walk over your fallen souls to reclaim them';
    }
    UI.setPrompt(this.state === 'playing' ? prompt : '');
    const site = this.siteNear(p.x, p.z);
    UI.setLocation(site ? site.name : 'The Open Lands');
  },

  siteNear(x, z) {
    let best = null;
    for (const s of Object.values(SITES)) {
      if (Util.dist(x, z, s.x, s.z) < s.r + 12) { best = s; break; }
    }
    return best;
  },

  updateHud() {
    const p = this.player;
    UI.setHp(p.hp / p.maxHp);
    UI.setStamina(p.stamina / p.maxStamina);
    UI.setFlasks(p.flasks, this.difficulty.flasks);
    UI.setSouls(p.souls);
    UI.setLock(!!this.lockTarget);
    UI.bossBar(this.activeBoss);
    if (!!this.activeBoss !== Sound.bossMode) Sound.setBoss(!!this.activeBoss);
    if (this.companion) {
      const c = this.companion;
      const ab = c.abilityCD > 0 ? `${c.def.abilityName} ${c.abilityCD.toFixed(1)}s` : `${c.def.abilityName} ready (V)`;
      const state = c.downed ? ' · wounded' : p.rider ? ' · riding' : '';
      const pet = this.pet && !this.pet.removed ? ` · ally ${Math.ceil(this.pet.ttl)}s` : this.petCD > 0 ? ` · ally in ${Math.ceil(this.petCD)}s` : ' · ally ready (T)';
      UI.setCompanion(`${c.def.name}${state}\n${ab}${pet}`);
    } else {
      UI.setCompanion('No companion (choose at a bonfire)');
    }
    UI.setTutorial(this.tut ? this.tutSteps().map(t => ({ text: t.text })) : null, this.tut ? this.tut.step : 0);
  },

  // Camera
  handleLook(dt) {
    const look = Input.takeLook();
    const stick = Input.stickLook();
    this.lookSum += Math.abs(look.x) + Math.abs(look.y) + (Math.abs(stick.x) + Math.abs(stick.y)) * dt * 200;
    this.camYaw -= look.x * 0.0028 + stick.x * 2.8 * dt;
    this.camPitch += look.y * 0.0024 + stick.y * 1.8 * dt;
    this.camPitch = Util.clamp(this.camPitch, -0.15, 1.15);
    this.camDist = Util.clamp(this.camDist + Input.takeWheel() * 0.004, 3.5, 12);
  },

  updateCamera(dt) {
    const p = this.player;
    if (this.lockTarget && !this.lockTarget.dead) {
      const want = Util.angleTo(p.x, p.z, this.lockTarget.x, this.lockTarget.z);
      this.camYaw = Util.turnToward(this.camYaw, want, 2.6 * dt);
    }
    const mountOff = p.rider ? MOUNTS[p.rider.kind].saddle : 0;
    const tx = p.x, ty = p.y + 1.6 + mountOff * 0.5, tz = p.z;
    const dist = this.camDist * (p.rider ? 1.25 : 1);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const cx = tx - fx * dist * cp, cz = tz - fz * dist * cp;
    let cy = ty + sp * dist;
    const ground = World.heightAt(cx, cz) + 1.2;
    if (cy < ground) cy = ground;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(tx, ty, tz);
    this.followSun(tx, ty, tz);
    // Shake from hits, decaying quickly.
    if (this.shake > 0) {
      const k = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.shake = Math.max(0, this.shake - dt * 1.8);
    }
  },

  idleCamera(dt) {
    this.titleT += dt * 0.05;
    const c = SITES.camp;
    const a = this.titleT;
    const y = World.heightAt(c.x, c.z);
    this.camera.position.set(c.x + Math.sin(a) * 34, y + 14, c.z + Math.cos(a) * 34);
    this.camera.lookAt(c.x, y + 3, c.z);
    this.followSun(c.x, y, c.z);
  },

  // Simulation
  simulate(dt) {
    const p = this.player;
    this.handleLook(dt);
    this.petCD = Math.max(0, this.petCD - dt);

    if (this.state === 'playing' && Input.pressed('pause')) {
      this.openPause();
      return;
    }
    if (this.state === 'dead') {
      this.deathT += dt;
      if (this.deathT > 3.4) this.respawnPlayer();
    }

    p.update(dt, { yaw: this.camYaw });
    if (this.companion) this.companion.update(dt, p);
    if (this.pet) {
      this.pet.update(dt, p);
      if (this.pet.removed) { this.scene.remove(this.pet.group); this.pet = null; }
    }

    for (const e of this.enemies) e.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.removed || (e.dead && e.deathT > 4) || (e.dummy && e.removed)) {
        this.scene.remove(e.group);
        this.enemies.splice(i, 1);
      }
    }
    for (const b of this.bosses) b.update(dt);
    Fx.update(dt);

    this.checkArenas();
    this.checkWorld();
    this.updateTutorial();
    this.updateLockTarget();
    this.updateCamera(dt);
    this.updateHud();

    if (this.pendingVictory && !this.activeBoss) {
      this.victoryT += dt;
      if (this.victoryT > 2.5) {
        this.pendingVictory = false;
        this.victoryT = 0;
        this.setState('menu');
        UI.victory(true);
        Sound.play('victory');
      }
    }
  },

  updateLockTarget() {
    const t = this.lockTarget;
    if (!t) return;
    if (t.dead || Util.dist(this.player.x, this.player.z, t.x, t.z) > 35) this.lockTarget = null;
  },

  loop(now) {
    const dt = Math.min(0.033, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    Input.poll();

    // A press that closes a menu must not also act on the world in the same frame.
    const menuWasOpen = UI.menuOpen;
    if (['title', 'auth', 'difficulty', 'controls', 'padguide'].includes(this.state) || menuWasOpen) {
      UI.navigate();
    }
    if (this.state === 'auth' || this.state === 'controls' || this.state === 'difficulty') {
      if (Input.pressed('back')) {
        const back = { auth: 'auth-back', difficulty: 'diff-back', controls: 'controls-back', padguide: 'padguide-back' }[this.state];
        document.getElementById(back).click();
      }
    }

    if ((this.state === 'playing' || this.state === 'dead') && !menuWasOpen) {
      this.simulate(dt);
    } else if (this.state === 'menu') {
      // The world is frozen behind menus. Only the camera and HUD keep their state.
      Input.takeLook();
      Input.takeWheel();
      this.updateCamera(0);
      this.updateHud();
    } else if (['title', 'auth', 'difficulty', 'controls', 'padguide'].includes(this.state)) {
      Input.takeLook();
      Input.takeWheel();
      this.idleCamera(dt);
    }
    if (!UI.e.victory.classList.contains('hidden') && Input.pressed('confirm')) this.closeVictory();

    World.update(dt, this.time);
    this.renderer.render(this.scene, this.camera);
    Fx.projectPopups(this.camera, window.innerWidth, window.innerHeight);
    Input.endFrame();
    requestAnimationFrame(now2 => this.loop(now2));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
