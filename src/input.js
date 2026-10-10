// Unified input: keyboard, mouse and gamepad all feed the same named actions.
// Systems ask for `Input.held('block')` (continuous) or `Input.pressed('lightAttack')` (one-shot).

const Input = (() => {
  // Action -> bindings. Gamepad indices follow the "standard" controller layout.
  const BIND = {
    light:     { mouse: [0], keys: [], gp: [2, 7] },        // LMB / X or RT
    heavy:     { mouse: [], keys: ['KeyQ'], gp: [3] },      // Q / Y
    block:     { mouse: [2], keys: ['KeyC'], gp: [4] },     // RMB / LB
    dodge:     { mouse: [], keys: ['Space'], gp: [0] },     // Space / A (on foot)
    jump:      { mouse: [], keys: ['Space'], gp: [0] },     // Space / A (mounted)
    descend:   { mouse: [], keys: ['ControlLeft', 'ControlRight'], gp: [6] },
    sprint:    { mouse: [], keys: ['ShiftLeft', 'ShiftRight'], gp: [10] },
    interact:  { mouse: [], keys: ['KeyE'], gp: [1] },      // E / B
    flask:     { mouse: [], keys: ['KeyF'], gp: [13] },     // F / D-pad down
    mount:     { mouse: [], keys: ['KeyR'], gp: [8] },      // R / View
    ability:   { mouse: [], keys: ['KeyV'], gp: [5] },      // V / RB
    summon:    { mouse: [], keys: ['KeyT'], gp: [12] },     // T / D-pad up
    lock:      { mouse: [1], keys: ['Tab'], gp: [11] },     // Middle mouse / R3
    pause:     { mouse: [], keys: ['Escape', 'KeyP'], gp: [9] }, // Esc / Start
    up:        { mouse: [], keys: ['ArrowUp', 'KeyW'], gp: [12] },
    down:      { mouse: [], keys: ['ArrowDown', 'KeyS'], gp: [13] },
    confirm:   { mouse: [], keys: ['Enter', 'NumpadEnter'], gp: [0] },
    back:      { mouse: [], keys: ['Backspace'], gp: [1] },
  };

  const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft']);
  const STICK_DEADZONE = 0.18;

  const keys = new Set();
  const mouse = new Set();
  const gpBtns = [];
  let prevGp = [];
  const queue = new Set();
  const frame = { lookX: 0, lookY: 0, wheel: 0, locked: false, stickL: { x: 0, y: 0 }, stickR: { x: 0, y: 0 }, device: 'keyboard', gamepad: false };

  const keyActions = {};
  const mouseActions = {};
  const gpActions = {};
  for (const [name, b] of Object.entries(BIND)) {
    for (const k of b.keys) (keyActions[k] ||= []).push(name);
    for (const m of b.mouse) (mouseActions[m] ||= []).push(name);
    for (const g of b.gp) (gpActions[g] ||= []).push(name);
  }

  function deadzone(v) {
    return Math.abs(v) < STICK_DEADZONE ? 0 : (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE);
  }

  function isHeld(action) {
    const b = BIND[action];
    if (!b) return false;
    return b.keys.some(k => keys.has(k)) || b.mouse.some(m => mouse.has(m)) || b.gp.some(g => gpBtns[g]);
  }

  function attach(canvas) {
    window.addEventListener('keydown', e => {
      // Let text fields receive every key, including Space and the movement keys.
      if (isTextField(e.target)) return;
      Sound.unlock();
      if (PREVENT.has(e.code)) e.preventDefault();
      frame.device = 'keyboard';
      if (e.repeat) return;
      keys.add(e.code);
      for (const a of keyActions[e.code] || []) queue.add(a);
    });
    window.addEventListener('keyup', e => keys.delete(e.code));
    // Menu buttons sit outside the canvas, so clicks anywhere also unlock audio.
    window.addEventListener('pointerdown', () => Sound.unlock());
    window.addEventListener('blur', () => { keys.clear(); mouse.clear(); });

    canvas.addEventListener('mousedown', e => {
      Sound.unlock();
      frame.device = 'keyboard';
      mouse.add(e.button);
      for (const a of mouseActions[e.button] || []) queue.add(a);
      if (!frame.locked && e.button === 0) canvas.requestPointerLock?.();
    });
    window.addEventListener('mouseup', e => mouse.delete(e.button));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (frame.locked) {
        frame.lookX += e.movementX;
        frame.lookY += e.movementY;
      }
    });
    window.addEventListener('wheel', e => { frame.wheel += e.deltaY; }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      frame.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('gamepadconnected', () => { frame.gamepad = true; });
    window.addEventListener('gamepaddisconnected', () => { frame.gamepad = false; });
  }

  // Called once per frame. Converts the browser gamepad state into actions.
  function poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    frame.gamepad = !!pad;
    if (!pad) {
      gpBtns.length = 0;
      frame.stickL.x = frame.stickL.y = frame.stickR.x = frame.stickR.y = 0;
      prevGp = [];
      return;
    }
    const lx = deadzone(pad.axes[0] || 0), ly = deadzone(pad.axes[1] || 0);
    const rx = deadzone(pad.axes[2] || 0), ry = deadzone(pad.axes[3] || 0);
    frame.stickL.x = lx; frame.stickL.y = ly;
    frame.stickR.x = rx; frame.stickR.y = ry;
    if (lx || ly || rx || ry) frame.device = 'gamepad';

    const nowPressed = [];
    for (let i = 0; i < pad.buttons.length; i++) {
      const down = pad.buttons[i].pressed;
      gpBtns[i] = down;
      if (down) {
        nowPressed[i] = true;
        if (!prevGp[i]) {
          frame.device = 'gamepad';
          Sound.unlock();
          for (const a of gpActions[i] || []) queue.add(a);
        }
      }
    }
    prevGp = nowPressed;
  }

  return {
    attach,
    poll,
    frame,
    usingGamepad: () => frame.device === 'gamepad',
    held: isHeld,
    pressed: action => queue.has(action),
    // Movement in screen space: x = right, y = forward. Keyboard and left stick combined.
    move() {
      let x = (isKeyDown('KeyD', 'ArrowRight') ? 1 : 0) - (isKeyDown('KeyA', 'ArrowLeft') ? 1 : 0);
      let y = (isKeyDown('KeyW', 'ArrowUp') ? 1 : 0) - (isKeyDown('KeyS', 'ArrowDown') ? 1 : 0);
      x += frame.stickL.x;
      y -= frame.stickL.y;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      return { x, y };
    },
    // Right stick, positive x = right, positive y = pushed down.
    stickLook: () => ({ x: frame.stickR.x, y: frame.stickR.y }),
    // Returns and clears accumulated mouse look for this frame.
    takeLook() {
      const v = { x: frame.lookX, y: frame.lookY };
      frame.lookX = 0; frame.lookY = 0;
      return v;
    },
    takeWheel() {
      const w = frame.wheel;
      frame.wheel = 0;
      return w;
    },
    endFrame() { queue.clear(); },
    clearHeld() { keys.clear(); mouse.clear(); },
  };

  function isKeyDown(...codes) {
    return codes.some(c => keys.has(c));
  }

  function isTextField(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }
})();
