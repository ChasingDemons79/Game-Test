// DOM-based interface: HUD, menus, title screens, tutorial checklist and overlays.
// Every button can be driven by mouse, keyboard or gamepad. Gamepad and arrow-key navigation
// moves a highlight, and confirm clicks the highlighted button.

const UI = {
  navIdx: 0,
  navScope: null,
  menuOpen: false,
  menuBack: null,
  logTimers: [],

  init() {
    const $ = id => document.getElementById(id);
    this.e = {
      hud: $('hud'), hpFill: $('hp-fill'), stFill: $('st-fill'), flasks: $('flasks'),
      souls: $('souls-val'), location: $('location'), companion: $('companion-info'),
      lock: $('lock-info'), prompt: $('prompt'), log: $('log'), tut: $('tut'), tutList: $('tut-list'),
      boss: $('boss'), bossName: $('boss-name'), bossFill: $('boss-fill'), vignette: $('vignette'),
      banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      menu: $('menu'), menuTitle: $('menu-title'), menuSub: $('menu-subtitle'), menuItems: $('menu-items'),
      menuHint: $('menu-hint'), death: $('death'), victory: $('victory'),
    };
  },

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
    this.navScope = null;
  },
  hideScreens() {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  },
  showHud(on) {
    this.e.hud.classList.toggle('hidden', !on);
  },

  // A short message in the top-left log.
  msg(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.e.log.prepend(d);
    while (this.e.log.children.length > 4) this.e.log.lastChild.remove();
    setTimeout(() => d.remove(), 4200);
  },

  banner(title, sub = '', ms = 4000) {
    const b = this.e.banner;
    this.e.bannerTitle.textContent = title;
    this.e.bannerSub.textContent = sub;
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.add('hidden'), ms);
  },

  flash() {
    const v = this.e.vignette;
    v.classList.add('flash');
    setTimeout(() => v.classList.remove('flash'), 120);
  },

  // Generic menu. items: [{ label, sub, disabled, onPick }]
  menu(title, subtitle, items, { onBack = null, hint = null } = {}) {
    const e = this.e;
    e.menuTitle.textContent = title;
    e.menuSub.textContent = subtitle || '';
    e.menuSub.classList.toggle('hidden', !subtitle);
    e.menuItems.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !!it.disabled;
      b.innerHTML = it.label;
      if (it.sub) {
        const s = document.createElement('span');
        s.className = 'sub';
        s.textContent = it.sub;
        b.appendChild(s);
      }
      b.addEventListener('click', () => {
        Sound.play('ui');
        it.onPick?.();
      });
      e.menuItems.appendChild(b);
    }
    e.menuHint.textContent = hint || 'Arrow keys or D-pad to choose, Enter or A to confirm, Esc or B to go back';
    this.menuOpen = true;
    this.menuBack = onBack;
    e.menu.classList.remove('hidden');
    this.navScope = null;
  },

  closeMenu() {
    this.menuOpen = false;
    this.menuBack = null;
    this.e.menu.classList.add('hidden');
    this.navScope = null;
  },

  // Keyboard and gamepad navigation for whatever screen or menu is open.
  navigate() {
    // Forms own the keyboard while a text field has focus.
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    const scope = this.menuOpen ? this.e.menuItems : [...document.querySelectorAll('.screen:not(.hidden)')][0];
    if (!scope) return;
    if (scope !== this.navScope) {
      this.navScope = scope;
      this.navIdx = 0;
    }
    const btns = [...scope.querySelectorAll('button:not([disabled])')];
    if (!btns.length) return;
    if (this.navIdx >= btns.length) this.navIdx = btns.length - 1;
    if (Input.pressed('up')) this.navIdx = (this.navIdx - 1 + btns.length) % btns.length;
    if (Input.pressed('down')) this.navIdx = (this.navIdx + 1) % btns.length;
    btns.forEach((b, i) => b.classList.toggle('focused', i === this.navIdx));
    if (Input.pressed('confirm')) {
      // Native Enter/Space already clicks a focused button, so skip it to avoid double activation.
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      btns[this.navIdx].click();
    }
    if (Input.pressed('back') || Input.pressed('pause')) {
      if (this.menuOpen && this.menuBack) this.menuBack();
    }
  },

  setHp(frac) { this.e.hpFill.style.width = `${Util.clamp(frac, 0, 1) * 100}%`; },
  setStamina(frac) { this.e.stFill.style.width = `${Util.clamp(frac, 0, 1) * 100}%`; },
  setSouls(n) { this.e.souls.textContent = n.toLocaleString(); },
  setFlasks(n, max) {
    this.e.flasks.textContent = `Flasks ${n}/${max}`;
  },
  setLocation(text) { this.e.location.textContent = text; },
  setPrompt(text) { this.e.prompt.textContent = text || ''; },
  setCompanion(text) { this.e.companion.textContent = text || ''; },
  setLock(on) { this.e.lock.classList.toggle('hidden', !on); },

  setTutorial(steps, index) {
    if (!steps) { this.e.tut.classList.add('hidden'); return; }
    this.e.tut.classList.remove('hidden');
    this.e.tutList.innerHTML = '';
    steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = s.text;
      li.className = i < index ? 'done' : i === index ? 'current' : '';
      this.e.tutList.appendChild(li);
    });
  },

  bossBar(boss) {
    if (!boss) { this.e.boss.classList.add('hidden'); return; }
    this.e.boss.classList.remove('hidden');
    this.e.bossName.textContent = `${boss.name}`;
    this.e.bossFill.style.width = `${Util.clamp(boss.hp / boss.maxHp, 0, 1) * 100}%`;
  },

  death(on) {
    this.e.death.classList.toggle('hidden', !on);
    if (on) {
      this.e.death.style.animation = 'none';
      void this.e.death.offsetWidth;
      this.e.death.style.animation = '';
      const h = this.e.death.querySelector('h1');
      h.style.animation = 'none';
      void h.offsetWidth;
      h.style.animation = '';
    }
  },

  victory(on) {
    this.e.victory.classList.toggle('hidden', !on);
  },
};
