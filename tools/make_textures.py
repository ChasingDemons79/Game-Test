#!/usr/bin/env python3
"""Generates the game's texture pack: seamless albedo and normal maps.

Run from the project root:  python3 tools/make_textures.py
Output goes to assets/textures/. Every map tiles seamlessly, so the game can repeat it across terrain.
To use licensed packs instead (for example CC0 packs from ambientCG or Poly Haven), drop
files with the same names into assets/textures/. The game loads whatever is there.
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'textures')
rng = np.random.default_rng(1337)


def periodic_noise(size, cells):
    """Tileable value noise. `cells` lattice points across the image, wrapped at the edges."""
    lat = rng.random((cells, cells))
    coords = np.arange(size) * cells / size
    i0 = np.floor(coords).astype(int)
    f = coords - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    i0 %= cells
    a = lat[np.ix_(i0, i0)]
    b = lat[np.ix_(i0, i1)]
    c = lat[np.ix_(i1, i0)]
    d = lat[np.ix_(i1, i1)]
    fx = f[None, :]
    fy = f[:, None]
    top = a * (1 - fx) + b * fx
    bot = c * (1 - fx) + d * fx
    return top * (1 - fy) + bot * fy


def fbm(size, base_cells, octaves=5, gain=0.5):
    total = np.zeros((size, size))
    amp, norm = 1.0, 0.0
    cells = base_cells
    for _ in range(octaves):
        total += amp * periodic_noise(size, cells)
        norm += amp
        amp *= gain
        cells *= 2
    return total / norm


def voronoi(size, points):
    """Tileable cellular noise: distance to the nearest of `points` random sites, wrapped."""
    pts = rng.random((points, 2)) * size
    ys, xs = np.mgrid[0:size, 0:size]
    best = np.full((size, size), np.inf)
    for px, py in pts:
        dx = np.abs(xs - px)
        dy = np.abs(ys - py)
        dx = np.minimum(dx, size - dx)
        dy = np.minimum(dy, size - dy)
        best = np.minimum(best, np.sqrt(dx * dx + dy * dy))
    return best / best.max()


def normalize(v):
    return (v - v.min()) / (v.max() - v.min() + 1e-9)


def to_normal(height, strength):
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-dx, dy, np.ones_like(height)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def tint(gray, dark, light):
    g = gray[..., None]
    return (np.array(dark) * (1 - g) + np.array(light) * g)


def save(name, albedo_rgb, height, strength):
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(np.clip(albedo_rgb, 0, 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}_albedo.jpg'), quality=90)
    Image.fromarray(to_normal(height, strength)).save(os.path.join(OUT, f'{name}_normal.jpg'), quality=90)
    print('wrote', name)


def grass():
    size = 1024
    big = fbm(size, 4)
    blade = fbm(size, 128, octaves=2)
    speck = periodic_noise(size, 256)
    t = normalize(big * 0.6 + blade * 0.4)
    albedo = tint(t, (38, 66, 26), (104, 128, 56))
    albedo *= (0.85 + 0.3 * speck)[..., None]
    albedo[..., 0] += (periodic_noise(size, 64) - 0.5) * 16
    height = normalize(blade * 0.7 + speck * 0.3)
    save('grass', albedo, height, 2.2)


def rock():
    size = 1024
    cells = voronoi(size, 60)
    grain = fbm(size, 32, octaves=6)
    crack = np.clip(1 - cells * 6, 0, 1)
    t = normalize(cells * 0.5 + grain * 0.5)
    albedo = tint(t, (70, 66, 62), (150, 143, 134))
    albedo *= (1 - 0.35 * crack)[..., None]
    height = normalize(cells * 0.6 + grain * 0.4)
    save('rock', albedo, height, 3.0)


def bark():
    size = 1024
    streak = periodic_noise(size, 8)  # varies slowly around the trunk
    fine = periodic_noise(size, 96)
    vert = periodic_noise(size, 6)
    t = normalize(fine * 0.5 + vert * 0.3 + streak * 0.2)
    albedo = tint(t, (42, 30, 20), (110, 82, 56))
    height = normalize(fine * 0.5 + vert * 0.5)
    save('bark', albedo, height, 3.5)


def stone():
    size = 1024
    # Ashlar blocks: rows of blocks with an offset every other row, separated by mortar lines.
    rows, cols = 8, 4
    ys, xs = np.mgrid[0:size, 0:size]
    row = (ys * rows / size).astype(int)
    col = ((xs * cols / size + (row % 2) * 0.5) % cols).astype(int)
    fy = (ys * rows / size) % 1
    fx = (xs * cols / size + (row % 2) * 0.5) % 1
    mortar = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    mortar = np.clip(mortar * 40, 0, 1)
    block_id = row * 13 + col
    per_block = (block_id * 0.6180339) % 1
    grain = fbm(size, 24, octaves=5)
    t = normalize(grain * 0.7 + per_block * 0.3)
    albedo = tint(t, (84, 80, 76), (168, 160, 148))
    albedo *= (0.55 + 0.45 * mortar)[..., None]
    albedo[mortar < 0.3] = albedo[mortar < 0.3] * 0.6 + np.array([60, 58, 54]) * 0.4
    height = normalize(mortar * 0.8 + grain * 0.2)
    save('stone', albedo, height, 3.0)


def fabric():
    size = 512
    weave = np.sin(np.linspace(0, 2 * np.pi * 96, size))[None, :] * np.sin(np.linspace(0, 2 * np.pi * 96, size))[:, None]
    weave = (weave + 1) / 2
    noise = fbm(size, 16, octaves=3)
    t = normalize(weave * 0.35 + noise * 0.65)
    albedo = tint(t, (150, 150, 150), (222, 222, 222))
    save('fabric', albedo, normalize(weave * 0.6 + noise * 0.4), 1.6)


def metal():
    size = 512
    brushed = periodic_noise(size, 256)
    streaks = np.repeat(periodic_noise(size, 64)[:, :1], size, axis=1)
    t = normalize(brushed * 0.4 + streaks * 0.6)
    albedo = tint(t, (120, 124, 130), (205, 210, 218))
    save('metal', albedo, normalize(brushed * 0.5 + streaks * 0.5), 1.2)


def needles():
    size = 512
    fine = fbm(size, 48, octaves=4)
    dark = periodic_noise(size, 128)
    t = normalize(fine * 0.6 + dark * 0.4)
    albedo = tint(t, (20, 46, 28), (62, 98, 52))
    save('needles', albedo, normalize(fine), 2.4)


if __name__ == '__main__':
    grass()
    rock()
    bark()
    stone()
    fabric()
    metal()
    needles()
