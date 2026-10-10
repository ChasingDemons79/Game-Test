// Global tuning data for Hollow Crown.
// Every system reads its numbers from here so balance changes stay in one place.

const CONFIG = {
  SEED: 1337,
  WORLD_HALF: 400,
  SAVE_KEY: 'hollowcrown.accounts.v1',
  LAST_KEY: 'hollowcrown.last.v1',
  PLAYER: {
    hp: 200,
    hpPerVigor: 22,
    stamina: 100,
    staminaPerEnd: 6,
    walk: 4.2,
    run: 7.4,
    roll: 9.5,
    rollTime: 0.55,
    rollIframes: 0.35,
    jump: 8,
    gravity: 24,
    radius: 0.55,
    baseDamage: 26,
    damagePerStr: 0.06,
    flaskHeal: 0.4,
    eyeHeight: 1.6,
    lightCost: 12,
    heavyCost: 28,
    blockDrain: 7,
    attackGap: 0.12,
  },
  SOULS_DROP_RADIUS: 2.5,
};

const DIFFICULTIES = [
  {
    id: 'squire', name: 'Squire',
    desc: 'A gentle road for new pilgrims. Enemies strike softly and bosses are weakened.',
    enemyDamage: 0.6, enemyHp: 0.8, bossHp: 0.75, souls: 1.4, flasks: 6,
  },
  {
    id: 'knight', name: 'Knight',
    desc: 'The balanced path the realm was built for.',
    enemyDamage: 1, enemyHp: 1, bossHp: 1, souls: 1, flasks: 5,
  },
  {
    id: 'champion', name: 'Champion',
    desc: 'Enemies hit hard and gather in packs. Bosses are relentless.',
    enemyDamage: 1.4, enemyHp: 1.25, bossHp: 1.5, souls: 0.9, flasks: 4,
  },
  {
    id: 'nightmare', name: 'Nightmare',
    desc: 'Only the damned survive. Almost no mercy.',
    enemyDamage: 1.9, enemyHp: 1.6, bossHp: 2.2, souls: 0.7, flasks: 3,
  },
];

// Mounts double as travel and pets. The ability key is handled in player.js.
const MOUNTS = {
  horse: {
    name: 'Warhorse', speed: 9.5, sprint: 1.5, hp: 260, flying: false, ability: 'charge',
    abilityName: 'Charge', color: 0x8a5a33, accent: 0x3b2415, saddle: 1.0,
    desc: 'Steady, loyal and strong. Its charge breaks lines of foes.',
  },
  tiger: {
    name: 'Royal Tiger', speed: 11, sprint: 1.6, hp: 220, flying: false, ability: 'pounce',
    abilityName: 'Pounce', color: 0xd9822b, accent: 0x1d1208, saddle: 0.8,
    desc: 'Swift and fierce. Leaps onto foes and shakes the ground on landing.',
  },
  dragon: {
    name: 'Emberwing', speed: 13, sprint: 1.3, hp: 300, flying: true, ability: 'breath',
    abilityName: 'Fire Breath', color: 0x7d2b2b, accent: 0xf0a040, saddle: 1.7,
    desc: 'Takes to the sky. Space rises, Ctrl descends, and the breath scorches ahead.',
  },
  panther: {
    name: 'Black Panther', speed: 12.5, sprint: 1.7, hp: 190, flying: false, ability: 'shadow',
    abilityName: 'Shadow Dash', color: 0x17171d, accent: 0x4b4b66, saddle: 0.7,
    desc: 'Quiet as smoke. Dashes through danger and slips from enemy sight.',
  },
  snake: {
    name: 'Giant Serpent', speed: 7, sprint: 1.4, hp: 340, flying: false, ability: 'coil',
    abilityName: 'Coil Slam', color: 0x3f7a3a, accent: 0xd8c04a, saddle: 0.8,
    desc: 'Slow on open ground but very tough. Coils and slams, stunning nearby foes.',
  },
};

const PET_TUNING = {
  duration: 75,
  cooldown: 60,
  damage: 16,
  attackEvery: 1.5,
  hpFactor: 0.6,
};

const MOUNT_TUNING = {
  abilityCooldown: 6,
};

// Points of interest. Boss sites are open-world, so they can be tackled in any order.
// The throne is sealed until all five guardians have fallen.
const SITES = {
  camp:    { id: 'camp', name: 'Pilgrim Camp', x: 0, z: 0, r: 30, bonfire: [5, 7] },
  crypt:   { id: 'crypt', name: 'Crypt of the Bonewarden', x: -175, z: -165, r: 26, boss: 'gorath', bonfire: [-150, -140] },
  wood:    { id: 'wood', name: 'Withered Hollow', x: -205, z: 140, r: 26, boss: 'blightfang', bonfire: [-178, 118] },
  quarry:  { id: 'quarry', name: 'Ashen Quarry', x: 185, z: 165, r: 26, boss: 'ironhide', bonfire: [160, 140] },
  chapel:  { id: 'chapel', name: 'Sunken Chapel', x: 175, z: -160, r: 26, boss: 'abbot', bonfire: [150, -140] },
  peak:    { id: 'peak', name: 'Scorched Peak', x: 0, z: -270, r: 28, boss: 'emberwyrm', bonfire: [-22, -240] },
  throne:  { id: 'throne', name: 'Throne of the Hollow Crown', x: 0, z: 255, r: 30, boss: 'king', final: true, sealRadius: 40, bonfire: [-38, 225] },
};

const LAKE = { x: 110, z: 60, r: 55 };

const CAMPS = [
  { x: -60, z: -40, n: 3, type: 'skeleton' },
  { x: 60, z: -90, n: 3, type: 'skeleton' },
  { x: -120, z: 30, n: 4, type: 'wolf' },
  { x: 40, z: 120, n: 3, type: 'archer' },
  { x: -40, z: -140, n: 3, type: 'archer' },
  { x: 230, z: 20, n: 4, type: 'wolf' },
  { x: -260, z: -40, n: 3, type: 'skeleton' },
  { x: 250, z: -60, n: 3, type: 'skeleton' },
  { x: 120, z: 240, n: 3, type: 'archer' },
  { x: -130, z: 220, n: 4, type: 'wolf' },
  { x: 300, z: 120, n: 4, type: 'archer' },
  { x: -300, z: 200, n: 3, type: 'skeleton' },
  { x: 60, z: -220, n: 4, type: 'wolf' },
  { x: -240, z: -260, n: 4, type: 'archer' },
  { x: 90, z: -340, n: 3, type: 'skeleton' },
  { x: -90, z: 300, n: 3, type: 'wolf' },
  { x: 270, z: -220, n: 4, type: 'guard' },
];

const ENEMY_TYPES = {
  skeleton: {
    name: 'Hollow Soldier', hp: 70, dmg: 14, speed: 3.2, aggro: 20, range: 2.2,
    windup: 0.7, recover: 0.9, souls: 12, humanoid: true,
    look: { armor: 0xc9c2a8, skin: 0xe6dccb, cloth: 0x5a4a3a, helm: 0x8a8273, weapon: 'sword', shield: 0x6e4a2b },
  },
  wolf: {
    name: 'Grey Wolf', hp: 45, dmg: 11, speed: 6.8, aggro: 26, range: 2.0,
    windup: 0.35, recover: 0.6, souls: 8, humanoid: false,
    look: { color: 0x6b6e72, accent: 0x3a3c40 },
  },
  archer: {
    name: 'Hollow Archer', hp: 50, dmg: 16, speed: 3.6, aggro: 32, range: 20,
    windup: 0.9, recover: 1.0, souls: 14, ranged: true, humanoid: true,
    look: { armor: 0x4a5a3a, skin: 0xc2a688, cloth: 0x3a3228, helm: 0x3a3228, weapon: 'bow', shield: null },
  },
  guard: {
    name: 'Crownguard', hp: 130, dmg: 24, speed: 3.6, aggro: 24, range: 2.6,
    windup: 0.9, recover: 1.0, souls: 35, humanoid: true,
    look: { armor: 0x8d8f9c, skin: 0xd8c0a0, cloth: 0x3a2a4a, helm: 0x6c6e7a, weapon: 'greatsword', shield: 0x7a1f2a, scale: 1.1 },
  },
};
