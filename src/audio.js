// Sound: every effect and the music are synthesized with the Web Audio API,
// so the game ships no audio files. Nothing plays until the first key, click or button press,
// because browsers only allow audio after a user gesture.

const Sound = {
  ctx: null,
  ready: false,
  sfxOn: true,
  musicOn: true,
  bossMode: false,
  noiseBuf: null,

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('hollowcrown.audio') || '{}');
      if (s.sfx === false) this.sfxOn = false;
      if (s.music === false) this.musicOn = false;
    } catch (e) { /* settings are optional */ }
  },

  saveSettings() {
    try {
      localStorage.setItem('hollowcrown.audio', JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch (e) { /* settings are optional */ }
  },

  unlock() {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    this.ctx = c;
    this.master = c.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.gain.value = this.sfxOn ? 1 : 0;
    this.sfx.connect(this.master);
    this.music = c.createGain();
    this.music.gain.value = this.musicOn ? 1 : 0;
    this.music.connect(this.master);
    this.noiseBuf = this.makeNoise();
    this.ready = true;
    this.startMusic();
    if (c.state === 'suspended') c.resume();
  },

  setSfx(on) {
    this.sfxOn = on;
    if (this.ready) this.sfx.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    this.saveSettings();
  },

  setMusic(on) {
    this.musicOn = on;
    if (this.ready) this.music.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.1);
    this.saveSettings();
  },

  makeNoise() {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  // A short oscillator tone with a quick attack and exponential decay.
  tone({ freq, dur = 0.15, type = 'sine', vol = 0.2, slideTo = null, delay = 0, out = null }) {
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(out || this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  },

  // A short burst of filtered noise. It is the basis for swooshes, impacts and wind.
  burst({ dur = 0.15, vol = 0.2, freq = 1000, sweepTo = null, q = 1, type = 'bandpass', delay = 0 }) {
    const c = this.ctx, t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  },

  play(name) {
    if (!this.ready || !this.sfxOn) return;
    const fx = EFFECTS[name];
    if (fx) fx();
  },

  // Field music is a slow drone with wind. Boss music adds a low saw drone and a heartbeat pulse.
  startMusic() {
    const c = this.ctx;
    this.fieldGain = c.createGain();
    this.fieldGain.gain.value = 0.5;
    this.fieldGain.connect(this.music);
    for (const [f, detune, gain] of [[55, -4, 0.25], [82.4, 0, 0.12], [110.2, 4, 0.06]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.fieldGain);
      o.start();
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.2;
    lfo.connect(lfoGain).connect(this.fieldGain.gain);
    lfo.start();

    // Wind: looping noise through a low-pass filter, slowly swelling.
    const wind = c.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 500;
    const wg = c.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(this.fieldGain);
    wind.start();

    this.bossGain = c.createGain();
    this.bossGain.gain.value = 0;
    this.bossGain.connect(this.music);
    const saw = c.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 41.2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    saw.connect(lp).connect(this.bossGain);
    saw.start();

    this.pulseTimer = setInterval(() => {
      if (this.bossMode && this.ready && this.musicOn) {
        this.tone({ freq: 82, dur: 0.3, type: 'sine', vol: 0.3, slideTo: 60, out: this.bossGain });
      }
    }, 650);
  },

  setBoss(on) {
    this.bossMode = on;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.bossGain.gain.setTargetAtTime(on ? 0.45 : 0, t, 0.8);
    this.fieldGain.gain.setTargetAtTime(on ? 0.15 : 0.5, t, 0.8);
  },
};

const EFFECTS = {
  ui: () => Sound.tone({ freq: 1200, dur: 0.04, type: 'square', vol: 0.05 }),
  swing: () => Sound.burst({ dur: 0.14, vol: 0.18, freq: 2400, sweepTo: 700, q: 1.2 }),
  heavySwing: () => {
    Sound.burst({ dur: 0.3, vol: 0.25, freq: 1600, sweepTo: 300, q: 0.9 });
    Sound.tone({ freq: 110, dur: 0.3, type: 'sine', vol: 0.2, slideTo: 55 });
  },
  hit: () => {
    Sound.tone({ freq: 200, dur: 0.12, type: 'square', vol: 0.12, slideTo: 70 });
    Sound.burst({ dur: 0.08, vol: 0.15, freq: 3000, q: 2 });
  },
  block: () => {
    Sound.tone({ freq: 1400, dur: 0.12, type: 'triangle', vol: 0.18, slideTo: 900 });
    Sound.burst({ dur: 0.1, vol: 0.2, freq: 4200, q: 6 });
  },
  hurt: () => Sound.tone({ freq: 160, dur: 0.3, type: 'sawtooth', vol: 0.16, slideTo: 60 }),
  roll: () => Sound.burst({ dur: 0.28, vol: 0.16, freq: 500, type: 'lowpass', q: 0.7 }),
  flask: () => [523, 659, 784].forEach((f, i) => Sound.tone({ freq: f, dur: 0.18, vol: 0.12, delay: i * 0.07 })),
  kill: () => Sound.tone({ freq: 420, dur: 0.18, type: 'triangle', vol: 0.12, slideTo: 180 }),
  pickup: () => {
    Sound.tone({ freq: 880, dur: 0.1, vol: 0.12 });
    Sound.tone({ freq: 1320, dur: 0.14, vol: 0.1, delay: 0.07 });
  },
  rest: () => [330, 415, 494, 659].forEach((f, i) => Sound.tone({ freq: f, dur: 1.2, vol: 0.09, delay: i * 0.12 })),
  death: () => {
    Sound.tone({ freq: 220, dur: 1.6, type: 'sawtooth', vol: 0.18, slideTo: 35 });
    Sound.burst({ dur: 1.2, vol: 0.12, freq: 300, sweepTo: 60, type: 'lowpass' });
  },
  mount: () => Sound.tone({ freq: 300, dur: 0.25, type: 'triangle', vol: 0.15, slideTo: 520 }),
  summon: () => {
    Sound.tone({ freq: 660, dur: 0.35, vol: 0.12, slideTo: 990 });
    Sound.tone({ freq: 1320, dur: 0.25, vol: 0.06, delay: 0.1 });
  },
  ability: () => Sound.tone({ freq: 260, dur: 0.4, type: 'sawtooth', vol: 0.1, slideTo: 780 }),
  arrow: () => Sound.burst({ dur: 0.22, vol: 0.08, freq: 800, sweepTo: 3000, q: 1.5 }),
  boom: () => {
    Sound.burst({ dur: 0.6, vol: 0.28, freq: 200, type: 'lowpass', q: 0.8 });
    Sound.tone({ freq: 70, dur: 0.5, vol: 0.25, slideTo: 35 });
  },
  // A low telegraph tone that warns of a boss attack.
  warn: () => Sound.tone({ freq: 150, dur: 0.35, vol: 0.1, slideTo: 110 }),
  roar: () => {
    Sound.tone({ freq: 90, dur: 1.4, type: 'sawtooth', vol: 0.2, slideTo: 50 });
    Sound.burst({ dur: 1.2, vol: 0.12, freq: 400, sweepTo: 120, type: 'lowpass' });
  },
  bossDown: () => [196, 247, 294, 392].forEach((f, i) => Sound.tone({ freq: f, dur: 1.6, type: 'triangle', vol: 0.13, delay: i * 0.18 })),
  seal: () => [262, 330, 392, 523].forEach((f, i) => Sound.tone({ freq: f, dur: 1.2, vol: 0.12, delay: i * 0.1 })),
  victory: () => [262, 330, 392, 523, 659].forEach((f, i) => Sound.tone({ freq: f, dur: 1.8, type: 'triangle', vol: 0.12, delay: i * 0.22 })),
};
