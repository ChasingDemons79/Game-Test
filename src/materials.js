// Texture packs and shared PBR materials. The maps are loaded before the world is built.
// Missing files are skipped, so the game still runs with flat colours if assets are absent.

const Materials = {
  maps: {},
  anisotropy: 4,
  ready: false,

  load(renderer) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const loader = new THREE.TextureLoader();
    const names = ['grass', 'rock', 'bark', 'stone', 'fabric', 'metal', 'needles'];
    const jobs = [];
    for (const n of names) {
      for (const kind of ['albedo', 'normal']) {
        jobs.push(new Promise(resolve => {
          loader.load(
            `assets/textures/${n}_${kind}.jpg`,
            tex => {
              tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
              tex.anisotropy = this.anisotropy;
              if (kind === 'albedo') tex.encoding = THREE.sRGBEncoding;
              this.maps[`${n}_${kind}`] = tex;
              resolve();
            },
            undefined,
            () => resolve()
          );
        }));
      }
    }
    return Promise.all(jobs).then(() => { this.ready = true; });
  },

  map(name) {
    return this.maps[name] || null;
  },

  // A standard PBR material with the named texture pack applied. `color` tints the albedo.
  std(color, { set = null, roughness = 0.8, metalness = 0, normalScale = 0.8 } = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const albedo = set ? this.map(`${set}_albedo`) : null;
    const normal = set ? this.map(`${set}_normal`) : null;
    if (albedo) m.map = albedo;
    if (normal) {
      m.normalMap = normal;
      m.normalScale = new THREE.Vector2(normalScale, normalScale);
    }
    return m;
  },
};
