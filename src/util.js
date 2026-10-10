// Small math helpers shared by every system.
// Yaw convention: forward on the ground is (sin yaw, 0, cos yaw), so yaw = atan2(dx, dz).

const Util = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  smooth(e0, e1, x) {
    const t = Util.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  },
  wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  },
  angleTo: (ax, az, bx, bz) => Math.atan2(bx - ax, bz - az),
  dist: (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
  // Turn `cur` toward `target` by at most `maxStep` radians.
  turnToward(cur, target, maxStep) {
    const d = Util.wrap(target - cur);
    return cur + Util.clamp(d, -maxStep, maxStep);
  },
  // Seeded RNG so the world is identical every time it loads.
  rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  },
  pick: (arr, r = Math.random) => arr[Math.floor(r() * arr.length)],
  hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  },
  randomSalt: () => Math.random().toString(36).slice(2, 10),
};
