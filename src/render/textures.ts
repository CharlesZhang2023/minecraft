// Procedural block textures. Every texture is generated deterministically at start-up.
import { TEXTURES, WOOL_COLORS, BLOCKS } from '../world/blocks';
import { Random } from '../noise';
import { S, Img, RGB, newImg, hex, set, get, rngFor, shade, mix, blobField, paletteNoise, art, copy, voronoi } from './pixels';
import { OVERRIDES, small } from './overrides';
import { paintMore, soulFireFrame } from './textures2';

type Gen = (r: Random) => Img;
const gens: Record<string, Gen> = {};
const cache: Record<string, Img> = {};

/** Mods: add (or replace) a texture by name; it's generated when the atlas is built. */
export function registerTexture(name: string, gen: (r: Random) => Img) {
  gens[name] = gen;
  delete cache[name];
}

/** Is there a painter for this texture (tests: every block texture must have one)? */
export function hasTexture(name: string): boolean {
  return !!gens[name];
}

export function getTexture(name: string): Img {
  // a resource pack's (at 16x16 here: the atlas takes it at its own size)
  const o = OVERRIDES.blocks.get(name);
  if (o) return small(o);
  if (cache[name]) return cache[name];
  const g = gens[name];
  let img: Img;
  if (g) img = g(rngFor(name));
  else {
    // missing texture: magenta/black checker like the real game
    img = newImg();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, ((x >> 3) ^ (y >> 3)) & 1 ? hex('#f800f8') : hex('#000000'));
  }
  cache[name] = img;
  return img;
}

const P = (...h: string[]) => h.map(hex);

// ---------------------------------------------------------------- natural
const STONE_PAL = P('#6b6b6b', '#737373', '#7a7a7a', '#7f7f7f', '#858585', '#8f8f8f');
gens.stone = (r) => {
  const img = newImg();
  paletteNoise(img, r, STONE_PAL, { passes: 1, jitter: 0.45 });
  // a few darker horizontal streaks like the vanilla texture
  for (let i = 0; i < 5; i++) {
    const x = r.int(S), y = r.int(S), len = 2 + r.int(3);
    for (let k = 0; k < len; k++) set(img, (x + k) % S, y, STONE_PAL[r.int(2)]);
  }
  return img;
};
gens.smooth_stone = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#9c9c9c', '#a0a0a0', '#a5a5a5', '#a8a8a8'), { jitter: 0.6 });
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#b8b8b8')); set(img, i, 15, hex('#727272')); set(img, 0, i, hex('#b0b0b0')); set(img, 15, i, hex('#7b7b7b')); }
  return img;
};
gens.smooth_stone_slab_side = (r) => {
  const img = gens.smooth_stone(r);
  for (let i = 0; i < S; i++) { set(img, i, 7, hex('#727272')); set(img, i, 8, hex('#b8b8b8')); }
  return img;
};
const DIRT_PAL = P('#593d29', '#6c4b31', '#79553a', '#866043', '#8b6546', '#9b7653');
gens.dirt = (r) => {
  const img = newImg();
  paletteNoise(img, r, DIRT_PAL, { jitter: 0.55, bias: 0.05 });
  for (let i = 0; i < 6; i++) set(img, r.int(S), r.int(S), r.bool() ? hex('#b9855c') : hex('#4a3322'));
  return img;
};
gens.coarse_dirt = (r) => {
  const img = gens.dirt(r);
  for (let i = 0; i < 26; i++) set(img, r.int(S), r.int(S), r.bool() ? hex('#5c5c5c') : hex('#473021'));
  return img;
};
const GRASS_GRAY = P('#7c7c7c', '#878787', '#909090', '#999999', '#a3a3a3', '#aeaeae');
gens.grass_top = (r) => {
  const img = newImg();
  paletteNoise(img, r, GRASS_GRAY, { jitter: 0.6 });
  return img;
};
// grass side: dirt with a tinted overlay band. Overlay pixels are marked with alpha 254 so the
// shader knows to apply the biome tint only there.
function grassSide(r: Random, snow: boolean): Img {
  const img = gens.dirt(new Random(12345));
  for (let x = 0; x < S; x++) {
    const depth = 1 + r.int(3) + (r.next() < 0.25 ? 1 : 0) + (x % 5 === 2 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      if (snow) set(img, x, y, (r.next() < 0.3 ? hex('#dcebeb') : hex('#f4fcfc')));
      else set(img, x, y, GRASS_GRAY[1 + r.int(5)], 254);
    }
    if (snow && depth < 4) set(img, x, depth, hex('#c7d7d7'));
  }
  return img;
}
gens.grass_side = (r) => grassSide(r, false);
gens.grass_side_snowed = (r) => grassSide(r, true);
gens.grass_side_overlay = (r) => grassSide(r, false);
gens.podzol_top = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#4a2f14', '#5a3a1a', '#6a4520', '#7a5227', '#8c5e2c', '#946b3a'), { jitter: 0.7 });
  return img;
};
gens.podzol_side = (r) => {
  const img = gens.dirt(new Random(12345));
  const top = gens.podzol_top(r);
  for (let x = 0; x < S; x++) {
    const d = 2 + r.int(3);
    for (let y = 0; y < d; y++) { const c = get(top, x, y); set(img, x, y, [c[0], c[1], c[2]]); }
  }
  return img;
};
gens.sand = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#c9c08a', '#d6cd96', '#dbd3a0', '#e0d8a8', '#e7e0b8'), { jitter: 0.7, bias: 0.05 });
  return img;
};
gens.sandstone = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#d3c595', '#d8cb9b', '#ded2a4', '#e3d8ad'), { jitter: 0.8 });
  for (let x = 0; x < S; x++) {
    set(img, x, 0, hex('#e7dcb3')); set(img, x, 1, hex('#e0d4a8')); set(img, x, 2, hex('#cdbf8c'));
    set(img, x, 12, hex('#c7b784')); set(img, x, 13, r.bool() ? hex('#cbbc89') : hex('#d6c795'));
    set(img, x, 14, hex('#bfae79')); set(img, x, 15, hex('#b3a26f'));
    if (r.next() < 0.3) set(img, x, 7, hex('#cdbf8c'));
  }
  return img;
};
gens.sandstone_top = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#d8cb9b', '#ded2a4', '#e3d8ad', '#e7dcb3'), { jitter: 0.8 });
  return img;
};
gens.sandstone_bottom = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#bfae79', '#cbbc89', '#d3c595', '#d8cb9b'), { jitter: 0.6 });
  return img;
};
gens.cut_sandstone = (r) => {
  const img = gens.sandstone_top(r);
  for (let i = 0; i < S; i++) {
    set(img, i, 0, hex('#e7dcb3')); set(img, 0, i, hex('#e7dcb3'));
    set(img, i, 15, hex('#bfae79')); set(img, 15, i, hex('#bfae79'));
    set(img, i, 7, hex('#c7b784')); set(img, i, 8, hex('#e3d8ad'));
  }
  return img;
};
gens.gravel = (r) => {
  const img = newImg();
  const pal = P('#5b5656', '#6e6a6a', '#7f7b7b', '#8b8686', '#9a9595', '#a89f9f');
  paletteNoise(img, r, pal, { jitter: 0.9 });
  // clusters of pebbles
  for (let i = 0; i < 14; i++) {
    const x = r.int(S), y = r.int(S), c = r.next() < 0.15 ? hex('#8a7466') : pal[3 + r.int(3)];
    set(img, x, y, c); set(img, (x + 1) % S, y, c); set(img, x, (y + 1) % S, shade(c, 0.75)); set(img, (x + 1) % S, (y + 1) % S, shade(c, 0.7));
  }
  return img;
};
gens.clay = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#959ba8', '#9ca2af', '#a0a6b3', '#a5abb8', '#abb1be'), { jitter: 0.7 });
  return img;
};
gens.bedrock = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#1f1f1f', '#333333', '#454545', '#565656', '#6b6b6b', '#7f7f7f', '#999999'), { jitter: 0.6 });
  return img;
};
gens.obsidian = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#0f0a18', '#140f1f', '#181226', '#1d1629'), { jitter: 0.5 });
  for (let i = 0; i < 8; i++) {
    const x = r.int(14), y = r.int(14);
    set(img, x, y, hex('#3b2754')); set(img, x + 1, y, hex('#2a1c3c')); if (r.bool()) set(img, x, y + 1, hex('#4d3570'));
  }
  return img;
};
function speckled(base: string[], spots: string[], n: number): Gen {
  return (r) => {
    const img = newImg();
    paletteNoise(img, r, P(...base), { jitter: 0.6 });
    const sp = P(...spots);
    for (let i = 0; i < n; i++) {
      const x = r.int(S), y = r.int(S), c = sp[r.int(sp.length)];
      set(img, x, y, c);
      if (r.next() < 0.5) set(img, (x + 1) % S, y, c);
      if (r.next() < 0.3) set(img, x, (y + 1) % S, c);
    }
    return img;
  };
}
gens.granite = speckled(['#8f5b4a', '#9a6552', '#9f6b58', '#a87561'], ['#c29180', '#6d4337', '#b88470', '#ffffff'], 20);
gens.diorite = speckled(['#b8b8b8', '#bcbcbc', '#c4c4c4', '#cfcfcf'], ['#7f7f7f', '#8f8f8f', '#6b6b6b', '#ededed'], 26);
gens.andesite = speckled(['#7d7d7d', '#858585', '#888888', '#8e8e8e'], ['#6b6b6b', '#9e9e9e', '#a5a5a5', '#5d5d5d'], 24);
gens.terracotta = speckled(['#945b43', '#985f45', '#9c624a'], ['#8d553e', '#a3684f'], 16);
gens.snow = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#e4f0f0', '#eef8f8', '#f4fcfc', '#fafefe', '#ffffff'), { jitter: 0.6, bias: 0.1 });
  return img;
};
gens.ice = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#7ea3f5', '#8ab0f7', '#94b8f8', '#a0c0fa'), { jitter: 0.6 });
  for (let i = 0; i < S * S; i++) img[i * 4 + 3] = 160;
  for (let k = 0; k < 3; k++) {
    let x = r.int(S), y = r.int(S);
    for (let j = 0; j < 6; j++) { set(img, x, y, hex('#d8e6fc'), 200); x = (x + 1) % S; y = (y + (r.bool() ? 1 : 0)) % S; }
  }
  return img;
};

// ---------------------------------------------------------------- ores
function ore(clusters: string[], count: number, big = false): Gen {
  return (r) => {
    const img = gens.stone(new Random(777));
    const pal = P(...clusters);
    for (let i = 0; i < count; i++) {
      const cx = 1 + r.int(13), cy = 1 + r.int(13);
      const shape = big ? [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 1], [0, 2], [1, -1]] : [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1], [2, 0]];
      const n = 3 + r.int(shape.length - 2);
      for (let k = 0; k < n; k++) {
        const [dx, dy] = shape[k];
        // lighter at top-left of cluster, darker at bottom-right
        const c = dy <= 0 && dx <= 0 ? pal[2] : dy >= 1 && dx >= 1 ? pal[0] : pal[1];
        set(img, cx + dx, cy + dy, c);
      }
    }
    return img;
  };
}
gens.coal_ore = ore(['#1a1a1a', '#2c2c2c', '#454545'], 5, true);
gens.iron_ore = ore(['#af8e77', '#d8af93', '#e3c0aa'], 5);
gens.gold_ore = ore(['#e6c434', '#fcee4b', '#fffdb5'], 5);
gens.diamond_ore = ore(['#1ba59b', '#5decf5', '#d5fffa'], 5);
gens.redstone_ore = ore(['#8f0000', '#ff0000', '#ff7070'], 6);
gens.lapis_ore = ore(['#0f2d80', '#1946a8', '#3a6ad1'], 6);
gens.emerald_ore = ore(['#007a2b', '#17dd62', '#aaffc8'], 3);

function metalBlock(pal: string[]): Gen {
  return (r) => {
    const img = newImg();
    const p = P(...pal); // dark .. light
    paletteNoise(img, r, [p[1], p[2], p[2], p[3]], { jitter: 0.3, passes: 2 });
    for (let i = 0; i < S; i++) {
      set(img, i, 0, p[4]); set(img, 0, i, p[4]);
      set(img, i, 15, p[0]); set(img, 15, i, p[0]);
    }
    for (let i = 2; i < 6; i++) set(img, i, i - 1, p[4]);
    return img;
  };
}
gens.gold_block = metalBlock(['#a88b18', '#f5cc27', '#fadb3d', '#fdf065', '#fffcb8']);
gens.iron_block = metalBlock(['#a8a8a8', '#d8d8d8', '#dcdcdc', '#e8e8e8', '#ffffff']);
gens.diamond_block = metalBlock(['#1a9b93', '#62dbd5', '#6ee6e0', '#97f0ec', '#d5fffa']);
gens.lapis_block = metalBlock(['#16328c', '#1f47a8', '#264fb5', '#345ec8', '#5a86e0']);
gens.coal_block = metalBlock(['#050505', '#121212', '#181818', '#212121', '#363636']);

// ---------------------------------------------------------------- stone building blocks
gens.cobblestone = (r) => {
  const img = newImg();
  const { cell, edge } = voronoi(r, 10);
  const bases = Array.from({ length: 10 }, () => 0.85 + r.next() * 0.3);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const e = edge[y * S + x];
      if (e < 1.1) set(img, x, y, e < 0.55 ? hex('#4d4d4d') : hex('#5f5f5f'));
      else {
        const b = bases[cell[y * S + x]];
        const lum = 0x7a * b * (0.92 + r.next() * 0.16) + Math.min(e, 4) * 3;
        set(img, x, y, [lum, lum, lum].map(Math.round) as RGB);
      }
    }
  return img;
};
gens.mossy_cobblestone = (r) => {
  const img = gens.cobblestone(new Random(4242));
  const f = blobField(r, 2);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (f[y * S + x] > 0.55) {
        const c = get(img, x, y);
        set(img, x, y, mix([c[0], c[1], c[2]], r.bool() ? hex('#5a7a36') : hex('#48662a'), 0.75));
      }
  return img;
};
function brickPattern(r: Random, rows: number, mortar: RGB, brick: RGB[], dark: RGB, mortarLight?: RGB): Img {
  const img = newImg();
  const h = S / rows;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const row = Math.floor(y / h);
      const off = row % 2 ? h : 0;
      const bw = h * 2;
      const lx = (x + off) % bw, ly = y % h;
      if (ly === h - 1 || lx === bw - 1) set(img, x, y, mortar);
      else if (ly === 0 && mortarLight) set(img, x, y, mortarLight);
      else {
        const c = brick[r.int(brick.length)];
        set(img, x, y, ly === h - 2 || lx === bw - 2 ? dark : c);
      }
    }
  return img;
}
gens.bricks = (r) => brickPattern(r, 4, hex('#9c9a93'), P('#96614f', '#a0685a', '#8e5a48', '#9a6454'), hex('#7b4a3c'), hex('#b5b1a8'));
gens.stone_bricks = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#747474', '#7a7a7a', '#7f7f7f', '#858585'), { jitter: 0.7 });
  for (let x = 0; x < S; x++) {
    set(img, x, 0, hex('#8c8c8c')); set(img, x, 7, hex('#5b5b5b')); set(img, x, 8, hex('#8c8c8c')); set(img, x, 15, hex('#5b5b5b'));
  }
  for (let y = 0; y < 8; y++) { set(img, 15, y, hex('#5b5b5b')); set(img, 0, y, hex('#8c8c8c')); }
  for (let y = 8; y < 16; y++) { set(img, 7, y, hex('#5b5b5b')); set(img, 8, y, hex('#8c8c8c')); }
  return img;
};
gens.mossy_stone_bricks = (r) => {
  const img = gens.stone_bricks(new Random(99));
  const f = blobField(r, 2);
  for (let i = 0; i < S * S; i++)
    if (f[i] > 0.6) { const c = get(img, i % S, (i / S) | 0); set(img, i % S, (i / S) | 0, mix([c[0], c[1], c[2]], hex('#566e34'), 0.7)); }
  return img;
};
gens.cracked_stone_bricks = (r) => {
  const img = gens.stone_bricks(new Random(99));
  let x = 3 + r.int(4), y = 0;
  while (y < S) { set(img, x, y, hex('#4a4a4a')); y++; x += r.int(3) - 1; x = Math.max(0, Math.min(15, x)); }
  return img;
};

// ---------------------------------------------------------------- wood
function planks(pal: string[]): Gen {
  return (r) => {
    const img = newImg();
    const [seam, dark, mid, light, lighter] = P(...pal);
    for (let row = 0; row < 4; row++) {
      const cut = r.int(S);
      for (let y = row * 4; y < row * 4 + 4; y++)
        for (let x = 0; x < S; x++) {
          const ly = y - row * 4;
          let c = r.next() < 0.5 ? mid : r.next() < 0.5 ? light : dark;
          if (r.next() < 0.08) c = lighter;
          if (ly === 3) c = seam;
          else if (x === cut && (row % 2 === 0 || true)) c = seam;
          set(img, x, y, c);
        }
      // grain streaks
      for (let k = 0; k < 3; k++) {
        const y = row * 4 + r.int(3), x0 = r.int(S), len = 3 + r.int(6);
        for (let i = 0; i < len; i++) if ((x0 + i) % S !== cut) set(img, (x0 + i) % S, y, dark);
      }
    }
    return img;
  };
}
gens.oak_planks = planks(['#6b5130', '#9f844d', '#a2824e', '#b8945f', '#c29d62']);
gens.spruce_planks = planks(['#3e2d17', '#5a4024', '#684b2a', '#735531', '#7a5a34']);
gens.birch_planks = planks(['#9a8757', '#c3ad73', '#c8b077', '#d7c185', '#e0cb8f']);

function logSide(pal: string[]): Gen {
  return (r) => {
    const img = newImg();
    const p = P(...pal);
    for (let x = 0; x < S; x++) {
      let c = p[r.int(p.length)];
      for (let y = 0; y < S; y++) {
        if (r.next() < 0.3) c = p[r.int(p.length)];
        set(img, x, y, c);
      }
    }
    // darker vertical cracks
    for (let k = 0; k < 4; k++) {
      const x = r.int(S), y0 = r.int(S), len = 3 + r.int(8);
      for (let i = 0; i < len; i++) set(img, x, (y0 + i) % S, shade(p[0], 0.8));
    }
    return img;
  };
}
gens.oak_log = logSide(['#4f3a1f', '#5f4a2b', '#6b5231', '#6e5534', '#7a6040']);
gens.spruce_log = logSide(['#241709', '#2e1e0d', '#3b2712', '#402c16', '#4a3219']);
gens.birch_log = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#cfcfca', '#d8d7d2', '#e2e2dc', '#ececea'), { jitter: 0.5 });
  for (let k = 0; k < 9; k++) {
    const y = r.int(S), x0 = r.int(S), len = 2 + r.int(4);
    for (let i = 0; i < len; i++) set(img, (x0 + i) % S, y, i === 0 || i === len - 1 ? hex('#4d4d48') : hex('#282828'));
  }
  for (let k = 0; k < 6; k++) set(img, r.int(S), r.int(S), hex('#a8a8a0'));
  return img;
};
function logTop(bark: string, ring: string[], plankGen: Gen): Gen {
  return (r) => {
    const img = plankGen(new Random(5));
    const b = hex(bark);
    const rings = P(...ring);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 6.9) { set(img, x, y, shade(b, 0.85 + r.next() * 0.3)); continue; }
        const ri = Math.floor(d + (r.next() < 0.15 ? 1 : 0)) % 2;
        set(img, x, y, rings[ri]);
      }
    return img;
  };
}
gens.oak_log_top = logTop('#6b5231', ['#b8945f', '#9f7e4a'], gens.oak_planks);
gens.spruce_log_top = logTop('#3b2712', ['#735531', '#5e4427'], gens.spruce_planks);
gens.birch_log_top = logTop('#d8d7d2', ['#d7c185', '#c1a86f'], gens.birch_planks);

function leavesGen(dense: number, spruce = false): Gen {
  return (r) => {
    const img = newImg();
    const pal = spruce ? P('#5a5a5a', '#6e6e6e', '#8a8a8a', '#a0a0a0') : P('#4e4e4e', '#6a6a6a', '#8a8a8a', '#a8a8a8', '#bcbcbc');
    const f = blobField(r, 1);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const v = f[y * S + x] * 0.6 + r.next() * 0.4;
        if (r.next() < dense) { set(img, x, y, [0, 0, 0], 0); continue; }
        set(img, x, y, pal[Math.min(pal.length - 1, Math.floor(v * pal.length))]);
      }
    return img;
  };
}
gens.oak_leaves = leavesGen(0.2);
gens.spruce_leaves = leavesGen(0.16, true);

// ---------------------------------------------------------------- liquids (animated)
export const ANIMATED: Record<string, { frames: number; speed: number }> = {
  water_still: { frames: 32, speed: 2 },
  water_flow: { frames: 32, speed: 1 },
  lava_still: { frames: 20, speed: 3 },
  lava_flow: { frames: 16, speed: 2 },
  fire: { frames: 16, speed: 1 },
  nether_portal: { frames: 32, speed: 1 },
  end_portal: { frames: 24, speed: 2 },
};
function waterFrame(frame: number, total: number, flow: boolean): Img {
  const img = newImg();
  const t = (frame / total) * Math.PI * 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * Math.PI * 2, fy = (y / S) * Math.PI * 2;
      let v: number;
      if (flow) v = Math.sin(fy * 2 - t * 2 + Math.sin(fx) * 0.8) * 0.5 + Math.sin(fx * 3 + fy + t) * 0.25;
      else v = Math.sin(fx + t) * Math.cos(fy * 2 - t) * 0.4 + Math.sin((fx + fy) * 2 + t * 2) * 0.3 + Math.sin(fx * 3 - fy + t) * 0.15;
      const l = 0.5 + v * 0.5;
      const c = mix(hex('#2448b8'), hex('#4a80f0'), l);
      set(img, x, y, l > 0.93 ? mix(c, hex('#8cb4ff'), 0.6) : c, 185);
    }
  return img;
}
function lavaFrame(frame: number, total: number, flow: boolean): Img {
  const img = newImg();
  const t = (frame / total) * Math.PI * 2;
  const r = new Random(31337);
  const phase = Array.from({ length: 6 }, () => [r.next() * 6.28, 1 + r.int(3), 1 + r.int(3)]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const fx = (x / S) * Math.PI * 2, fy = (y / S) * Math.PI * 2;
      let v = 0;
      for (const [p, a, b] of phase) v += Math.sin(fx * a + fy * b * (flow ? 1 : 0.5) + p + t * (flow ? 2 : 1)) / phase.length;
      const l = 0.5 + v;
      const c = l < 0.35 ? mix(hex('#b83000'), hex('#d45a12'), l / 0.35) : l < 0.75 ? mix(hex('#d45a12'), hex('#fc9f2a'), (l - 0.35) / 0.4) : mix(hex('#fc9f2a'), hex('#fff0a0'), Math.min(1, (l - 0.75) / 0.3));
      set(img, x, y, c);
    }
  return img;
}
function fireFrame(frame: number): Img {
  const img = newImg();
  const r = new Random(frame * 7919 + 13);
  const heat = new Float32Array(S * (S + 2));
  // simple fire automaton run for a few steps
  for (let step = 0; step < 24; step++) {
    for (let x = 0; x < S; x++) heat[(S + 1) * S + x] = r.next() < 0.7 ? 1 : 0.5;
    for (let y = 0; y < S + 1; y++)
      for (let x = 0; x < S; x++) {
        const below = heat[(y + 1) * S + x], bl = heat[(y + 1) * S + ((x + S - 1) % S)], br = heat[(y + 1) * S + ((x + 1) % S)];
        heat[y * S + x] = Math.max(0, (below * 2 + bl + br) / 4 - 0.035 - r.next() * 0.06);
      }
  }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const edge = Math.min(x, 15 - x) < 1 ? 0.15 : 0;
      const h = heat[y * S + x] - edge;
      if (h < 0.25) continue;
      const c = h > 0.75 ? hex('#fff3b0') : h > 0.55 ? hex('#ffc629') : h > 0.4 ? hex('#f98a0a') : hex('#d8430c');
      set(img, x, y, c);
    }
  return img;
}
export function animatedFrame(name: string, frame: number): Img {
  const a = ANIMATED[name];
  switch (name) {
    case 'water_still': return waterFrame(frame, a.frames, false);
    case 'water_flow': return waterFrame(frame, a.frames, true);
    case 'lava_still': return lavaFrame(frame, a.frames, false);
    case 'lava_flow': return lavaFrame(frame, a.frames, true);
    case 'fire': return fireFrame(frame);
    case 'nether_portal': return portalFrame(frame);
    case 'end_portal': return endPortalFrame(frame);
    case 'soul_fire': return soulFireFrame(frame);
  }
  return getTexture(name);
}
gens.water_still = () => waterFrame(0, 32, false);
gens.water_flow = () => waterFrame(0, 32, true);
gens.lava_still = () => lavaFrame(0, 20, false);
gens.lava_flow = () => lavaFrame(0, 16, true);
gens.fire = () => fireFrame(0);

// ---------------------------------------------------------------- glass & transparent
gens.glass = (r) => {
  const img = newImg();
  const edge = hex('#dbe9ea'), shadowE = hex('#a3c1c4');
  for (let i = 0; i < S; i++) {
    set(img, i, 0, edge); set(img, 0, i, edge); set(img, i, 15, shadowE); set(img, 15, i, shadowE);
  }
  // glints
  for (const [x, y] of [[3, 4], [4, 3], [5, 2], [2, 5], [10, 11], [11, 10], [12, 9]]) set(img, x, y, hex('#ffffff'), 230);
  void r;
  return img;
};
gens.glass_pane_top = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 7; x < 9; x++) set(img, x, y, hex('#dbe9ea'));
  return img;
};
gens.cobweb = (r) => {
  const img = newImg();
  const c = hex('#dcdcdc');
  for (let i = 0; i < S; i++) {
    set(img, i, i, c, 220); set(img, 15 - i, i, c, 220); set(img, 7, i, c, 200); set(img, i, 8, c, 200);
  }
  for (const rad of [3, 6]) for (let a = 0; a < 32; a++) {
    const x = Math.round(7.5 + Math.cos((a / 32) * 6.28) * rad), y = Math.round(7.5 + Math.sin((a / 32) * 6.28) * rad);
    if (r.next() < 0.8) set(img, x, y, c, 200);
  }
  return img;
};
gens.spawner = () => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (x % 4 === 0 || y % 4 === 0 || x === 15 || y === 15) set(img, x, y, (x + y) % 3 ? hex('#1c2530') : hex('#394a5c'));
  return img;
};

// ---------------------------------------------------------------- plants (pixel art)
const G = (h: string) => hex(h);
gens.short_grass = (r) => {
  const img = newImg();
  const pal = GRASS_GRAY;
  for (let b = 0; b < 11; b++) {
    let x = 1 + r.int(14);
    const h = 5 + r.int(10);
    for (let y = 15; y > 15 - h; y--) {
      set(img, x, y, pal[Math.min(5, 1 + Math.floor(((15 - y) / h) * 5))]);
      if (r.next() < 0.18) x = Math.max(0, Math.min(15, x + (r.bool() ? 1 : -1)));
    }
  }
  return img;
};
gens.fern = (r) => {
  const img = newImg();
  const pal = GRASS_GRAY;
  for (const [sx, dir] of [[7, -1], [8, 1], [5, -1], [10, 1]] as const) {
    let x: number = sx;
    for (let y = 15; y > 2 + r.int(3); y--) {
      set(img, x, y, pal[3]);
      if (y % 2 === 0) { set(img, x + dir, y, pal[2]); if (y < 12) set(img, x - dir, y - 1, pal[4]); }
      if (y % 4 === 0) x += dir;
      x = Math.max(0, Math.min(15, x));
    }
  }
  return img;
};
gens.dead_bush = (r) => {
  const img = newImg();
  const c = [G('#6b4b25'), G('#8a6331'), G('#94703f')];
  const branch = (x: number, y: number, dx: number, len: number) => {
    for (let i = 0; i < len; i++) {
      set(img, x, y, c[r.int(3)]);
      y--; if (r.next() < 0.6) x += dx;
      if (x < 0 || x > 15 || y < 0) return;
      if (i > 1 && r.next() < 0.25) branch(x, y, -dx, len - i - 1);
    }
  };
  branch(7, 15, -1, 9); branch(8, 15, 1, 10); branch(8, 13, 1, 6);
  return img;
};
const STEM = { g: G('#3f7a19'), G: G('#52942c'), d: G('#2d5a10') };
gens.dandelion = () => { const img = newImg(); art(img, [
  '', '', '', '', '', '',
  '......yy........',
  '.....yYYy.......',
  '.....yYOYy......',
  '......yYy.......',
  '.......g........',
  '.......g..G.....',
  '....G..g.GG.....',
  '.....GGgGG......',
  '......Gg........',
  '.......g........',
], { y: G('#e6c20d'), Y: G('#fff04a'), O: G('#f5a623'), ...STEM }); return img; };
gens.poppy = () => { const img = newImg(); art(img, [
  '', '', '', '',
  '.....rr.RR......',
  '....rRRRRRr.....',
  '....RRRqRRR.....',
  '.....RqkqR......',
  '.....rRRRr......',
  '.......g........',
  '.......g..g.....',
  '....G..g.GG.....',
  '.....GGgG.......',
  '......Gg........',
  '.......g........',
  '.......g........',
], { r: G('#9e1b1b'), R: G('#e32222'), q: G('#6b1010'), k: G('#1f1f1f'), ...STEM }); return img; };
gens.cornflower = () => { const img = newImg(); art(img, [
  '', '', '', '',
  '......b.b.......',
  '....b.BBB.b.....',
  '.....BBlBB......',
  '....bBlLlBb.....',
  '.....BBlBB......',
  '....b.BgB.b.....',
  '.......g........',
  '....G..g..G.....',
  '.....G.g.G......',
  '......Gg........',
  '.......g........',
  '.......g........',
], { b: G('#3a53b8'), B: G('#5474e4'), l: G('#8aa3f5'), L: G('#c9d6ff'), ...STEM }); return img; };
gens.oxeye_daisy = () => { const img = newImg(); art(img, [
  '', '', '', '',
  '......w.w.......',
  '....wwWWWww.....',
  '....WWyYyWW.....',
  '...wWyYOYyWw....',
  '....WWyYyWW.....',
  '....wwWWWww.....',
  '......wgw.......',
  '....G..g..G.....',
  '.....G.gGG......',
  '......Gg........',
  '.......g........',
  '.......g........',
], { w: G('#cfd4d6'), W: G('#ffffff'), y: G('#e0b31c'), Y: G('#f8dc3e'), O: G('#c28a0b'), ...STEM }); return img; };
gens.allium = () => { const img = newImg(); art(img, [
  '', '',
  '......pPp.......',
  '.....pPLPPp.....',
  '....pPPLPPPp....',
  '....PLPPPLPp....',
  '....pPPPLPPp....',
  '.....pPPPPp.....',
  '......pPp.......',
  '.......g........',
  '.......g..G.....',
  '....G..g.G......',
  '.....G.gG.......',
  '......Gg........',
  '.......g........',
  '.......g........',
], { p: G('#8a3fb8'), P: G('#b565e0'), L: G('#e0a8ff'), ...STEM }); return img; };
gens.brown_mushroom = () => { const img = newImg(); art(img, [
  '', '', '', '', '', '', '', '',
  '.....bbbbbb.....',
  '....bBBBBBBb....',
  '...bBBLBBBBBb...',
  '...dddddddddd...',
  '.......ss.......',
  '.......sS.......',
  '.......sS.......',
  '.......ss.......',
], { b: G('#8a6448'), B: G('#9e7556'), L: G('#b99478'), d: G('#6b4a34'), s: G('#d4c9b4'), S: G('#b3a58d') }); return img; };
gens.red_mushroom = () => { const img = newImg(); art(img, [
  '', '', '', '', '', '', '',
  '......rrrr......',
  '....rRRWRRRr....',
  '...rRWRRRRWRr...',
  '...RRRRRWRRRR...',
  '...dddddddddd...',
  '.......ss.......',
  '.......sS.......',
  '.......sS.......',
  '.......ss.......',
], { r: G('#a31010'), R: G('#e02020'), W: G('#f0f0f0'), d: G('#7d0f0f'), s: G('#d4c9b4'), S: G('#b3a58d') }); return img; };
function sapling(leaf: string[], trunk: string): Gen {
  return () => { const img = newImg(); art(img, [
    '', '',
    '.......L........',
    '.....lLLl.......',
    '....lLDLLl..L...',
    '...lLLLDLl.lLl..',
    '....lDLLLllLDl..',
    '..L..lLLt.lLl...',
    '.lLl..lLt.......',
    '.lDLl...t.l.....',
    '..lLLllt.lLl....',
    '....lLLtLLl.....',
    '.......t........',
    '.......t........',
    '.......t........',
    '.......t........',
  ], { l: G(leaf[0]), L: G(leaf[1]), D: G(leaf[2]), t: G(trunk) }); return img; };
}
gens.oak_sapling = sapling(['#2d6a14', '#4a8f23', '#1e4d0c'], '#6b5231');
gens.spruce_sapling = sapling(['#2c4a2c', '#3f663f', '#1d331d'], '#3b2712');
gens.birch_sapling = sapling(['#5a7f2e', '#7aa645', '#46661f'], '#d8d7d2');
gens.sugar_cane = (r) => {
  const img = newImg();
  for (const x0 of [3, 8, 12]) {
    for (let y = 0; y < S; y++) {
      const joint = (y + x0) % 5 === 0;
      set(img, x0, y, joint ? hex('#8a8a8a') : hex('#b5b5b5'));
      set(img, x0 + 1, y, joint ? hex('#707070') : hex('#9a9a9a'));
    }
    if (r.bool()) { set(img, x0 - 1, 4 + r.int(6), hex('#a8a8a8')); set(img, x0 - 2, 3 + r.int(4), hex('#a8a8a8')); }
  }
  return img;
};
gens.lily_pad = () => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 7.5) continue;
      if (dx > 0 && Math.abs(dy) < dx * 0.35) continue; // notch
      set(img, x, y, d > 6.4 ? hex('#6b6b6b') : (Math.atan2(dy, dx) * 3 | 0) % 2 ? hex('#9a9a9a') : hex('#8a8a8a'));
    }
  return img;
};
gens.pumpkin_stem = () => { const img = newImg(); art(img, [
  '', '', '', '', '', '', '', '',
  '.........l......',
  '........lL......',
  '.......lL.......',
  '.......L........',
  '.......L........',
  '.......l........',
  '.......L........',
  '.......l........',
], { l: G('#6b8a2d'), L: G('#8fb842') }); return img; };
for (let s = 0; s < 8; s++) {
  gens['wheat_stage' + s] = (r) => {
    const img = newImg();
    const ripe = s === 7;
    const h = 3 + Math.round((s / 7) * 12);
    const green = [G('#2d7a12'), G('#49a324'), G('#63b82d')];
    const yellow = [G('#9e8a1f'), G('#c7ae2f'), G('#dcc145'), G('#e8d562')];
    for (const x0 of [1, 4, 7, 10, 13]) {
      let x = x0 + r.int(2);
      for (let y = 15; y > 15 - h; y--) {
        const top = y < 15 - h + 5;
        const pal = ripe ? (top ? yellow : [G('#8f7a1a'), G('#a8902a')]) : s > 4 && top ? [G('#6f9a24'), G('#8fae2a'), G('#a6b83a')] : green;
        set(img, x, y, pal[r.int(pal.length)]);
        if (top && (s >= 5) && y % 2 === 0) set(img, x + 1, y, pal[r.int(pal.length)]);
        if (r.next() < 0.12) x += r.bool() ? 1 : -1;
        x = Math.max(0, Math.min(15, x));
      }
    }
    return img;
  };
}
gens.torch = () => { const img = newImg(); art(img, [
  '', '', '', '', '', '',
  '.......yY.......',
  '.......YW.......',
  '.......oy.......',
  '.......ss.......',
  '.......sS.......',
  '.......sS.......',
  '.......sS.......',
  '.......sS.......',
  '.......sS.......',
  '.......sS.......',
], { y: G('#ffd800'), Y: G('#fff78a'), W: G('#ffffff'), o: G('#ff9900'), s: G('#8a6b3c'), S: G('#6b5130') }); return img; };

// ---------------------------------------------------------------- crafted / functional
gens.crafting_table_top = (r) => {
  const img = gens.oak_planks(new Random(8));
  const frame = hex('#6b4b2a'), line = hex('#4a3319');
  for (let i = 0; i < S; i++) {
    set(img, i, 0, frame); set(img, 0, i, frame); set(img, i, 15, frame); set(img, 15, i, frame);
    set(img, i, 1, hex('#b8945f')); set(img, 1, i, hex('#b8945f'));
  }
  for (let i = 2; i < 14; i++) { set(img, i, 5, line); set(img, i, 10, line); set(img, 5, i, line); set(img, 10, i, line); }
  void r;
  return img;
};
function tableSide(front: boolean): Gen {
  return () => {
    const img = gens.oak_planks(new Random(8));
    const d = hex('#4a3319'), top = hex('#6b4b2a');
    for (let i = 0; i < S; i++) { set(img, i, 0, top); set(img, i, 1, top); set(img, i, 2, hex('#503a22')); }
    for (let i = 3; i < S; i++) { set(img, 0, i, d); set(img, 15, i, d); }
    if (front) {
      // saw
      art(img, ['.gggg.', 'gGGGGg', '.gggg.', '..ww..', '..ww..', '..ww..', '..ww..'], { g: G('#8f8f8f'), G: G('#c8c8c8'), w: G('#6b4b2a') }, 2, 5);
      // hammer
      art(img, ['kkkk', 'kKKk', '.w..', '.w..', '.w..', '.w..'], { k: G('#4f4f4f'), K: G('#8a8a8a'), w: G('#6b4b2a') }, 10, 6);
    } else {
      art(img, ['ssssss', 'sSSSSs', 's....s', 'sSSSSs', 'ssssss'], { s: G('#5a3f22'), S: G('#826036') }, 5, 7);
    }
    return img;
  };
}
gens.crafting_table_side = tableSide(false);
gens.crafting_table_front = tableSide(true);
gens.furnace_side = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#6e6e6e', '#747474', '#7a7a7a', '#808080'), { jitter: 0.8 });
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#909090')); set(img, i, 15, hex('#525252')); set(img, 0, i, hex('#8a8a8a')); set(img, 15, i, hex('#5a5a5a')); }
  return img;
};
gens.furnace_top = (r) => {
  const img = gens.furnace_side(r);
  for (let i = 3; i < 13; i++) { set(img, i, 3, hex('#5a5a5a')); set(img, i, 12, hex('#8a8a8a')); set(img, 3, i, hex('#5a5a5a')); set(img, 12, i, hex('#8a8a8a')); }
  return img;
};
function furnaceFront(lit: boolean): Gen {
  return () => {
    const img = gens.furnace_side(new Random(11));
    for (let i = 1; i < 15; i++) set(img, i, 7, hex('#555555'));
    for (let y = 9; y < 14; y++)
      for (let x = 3; x < 13; x++) {
        const edge = y === 9 || x === 3 || x === 12 || y === 13;
        if (edge) set(img, x, y, hex('#3a3a3a'));
        else if (lit) set(img, x, y, y > 11 ? hex('#ffd24a') : (x + y) % 3 ? hex('#ff8a1f') : hex('#fffbb0'));
        else set(img, x, y, hex('#1a1a1a'));
      }
    for (let x = 4; x < 12; x++) { set(img, x, 3, hex('#555555')); set(img, x, 4, hex('#9a9a9a')); }
    return img;
  };
}
gens.furnace_front = furnaceFront(false);
gens.furnace_front_on = furnaceFront(true);
const CHEST = { o: G('#2b1d0e'), w: G('#9c6b30'), W: G('#b07a3c'), d: G('#7a5020'), l: G('#c7c7c7'), L: G('#8a8a8a') };
function chestTex(kind: 'top' | 'side' | 'front'): Gen {
  return (r) => {
    const img = newImg();
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const border = x === 0 || y === 0 || x === 15 || y === 15;
        set(img, x, y, border ? CHEST.o : r.next() < 0.5 ? CHEST.w : r.next() < 0.5 ? CHEST.W : CHEST.d);
      }
    if (kind !== 'top') for (let x = 0; x < S; x++) set(img, x, 5, CHEST.o);
    if (kind === 'front') art(img, ['LL', 'll', 'll', 'LL'], { l: CHEST.l, L: CHEST.L }, 7, 3);
    return img;
  };
}
gens.chest_top = chestTex('top');
gens.chest_side = chestTex('side');
gens.chest_front = chestTex('front');
gens.bookshelf = (r) => {
  const img = gens.oak_planks(new Random(8));
  const books = P('#8b1f1f', '#2d5a8b', '#2d7a2d', '#7a5a2d', '#6b2d7a', '#b8a15a', '#3a3a3a', '#a8431d');
  for (const row of [1, 9]) {
    let x = 1;
    for (let y = row; y < row + 6; y++) set(img, 0, y, hex('#6b4b2a'));
    while (x < 15) {
      const w = 1 + r.int(2), c = books[r.int(books.length)], h = 5 + r.int(2);
      for (let k = 0; k < w && x < 15; k++, x++)
        for (let y = row + 6 - h; y < row + 6; y++) set(img, x, y, k === 0 ? shade(c, 1.2) : c);
      if (r.next() < 0.3 && x < 15) { for (let y = row; y < row + 6; y++) set(img, x, y, hex('#3a2a15')); x++; }
    }
    for (let x2 = 0; x2 < S; x2++) set(img, x2, row + 6, hex('#6b4b2a'));
  }
  return img;
};
gens.tnt_side = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const band = y >= 5 && y <= 10;
      set(img, x, y, band ? (r.next() < 0.1 ? hex('#e8e8e8') : hex('#ffffff')) : x % 4 === 3 ? hex('#a8260e') : r.next() < 0.3 ? hex('#c93217') : hex('#db3b1b'));
    }
  art(img, [
    'kkk.k..k.kkk',
    '.k..kk.k..k.',
    '.k..k.kk..k.',
    '.k..k..k..k.',
  ], { k: G('#1a1a1a') }, 2, 6);
  return img;
};
gens.tnt_top = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, r.next() < 0.3 ? hex('#b52d13') : hex('#db3b1b'));
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) set(img, x, y, hex('#e0e0e0'));
  for (const [x, y] of [[5, 5], [9, 5], [5, 9], [9, 9], [7, 7]]) { set(img, x, y, hex('#262626')); set(img, x + 1, y, hex('#262626')); set(img, x, y + 1, hex('#262626')); set(img, x + 1, y + 1, hex('#404040')); }
  return img;
};
gens.tnt_bottom = gens.tnt_top;
gens.farmland = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#5a3b22', '#6b4a2e', '#77533a', '#7f5b3e'), { jitter: 0.6 });
  for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) set(img, x, y, hex('#4a2f19'));
  return img;
};
gens.farmland_moist = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#2e1d10', '#3a2616', '#44301d', '#4a3420'), { jitter: 0.6 });
  for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) set(img, x, y, hex('#20140a'));
  return img;
};
function doorTex(top: boolean): Gen {
  return (r) => {
    const img = newImg();
    const frame = hex('#6b5130'), p = P('#9f844d', '#a2824e', '#b8945f');
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const edge = x === 0 || x === 15 || (top ? y === 0 : y === 15);
        set(img, x, y, edge ? frame : p[r.int(3)]);
      }
    if (top) {
      for (const [x0, y0] of [[2, 2], [9, 2], [2, 8], [9, 8]]) for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 5; x++) set(img, x, y, [0, 0, 0], 0);
    } else {
      for (let y = 2; y < 14; y++) { set(img, 7, y, frame); set(img, 8, y, frame); }
      for (let x = 1; x < 15; x++) { set(img, x, 8, frame); }
      set(img, 12, 1, hex('#5a5a5a')); set(img, 13, 1, hex('#8a8a8a'));
    }
    return img;
  };
}
gens.oak_door_top = doorTex(true);
gens.oak_door_bottom = doorTex(false);
gens.ladder = () => {
  const img = newImg();
  const rail = hex('#6b5130'), rung = hex('#a2824e'), dark = hex('#4a3319');
  for (let y = 0; y < S; y++) { set(img, 2, y, rail); set(img, 3, y, dark); set(img, 12, y, rail); set(img, 13, y, dark); }
  for (const y of [1, 5, 9, 13]) for (let x = 2; x < 14; x++) { set(img, x, y, rung); set(img, x, y + 1, dark); }
  return img;
};
gens.cactus_side = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 1; x < 15; x++) {
      const stripe = x % 4 === 1;
      set(img, x, y, stripe ? hex('#0d5e1a') : r.next() < 0.5 ? hex('#138a28') : hex('#16992c'));
    }
  for (let i = 0; i < 10; i++) { const x = 1 + r.int(14), y = r.int(S); set(img, x, y, hex('#d6e0a0')); }
  return img;
};
gens.cactus_top = (r) => {
  const img = newImg();
  for (let y = 1; y < 15; y++)
    for (let x = 1; x < 15; x++) {
      const border = x === 1 || y === 1 || x === 14 || y === 14;
      set(img, x, y, border ? hex('#0d5e1a') : r.next() < 0.5 ? hex('#16992c') : hex('#1aa332'));
    }
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if ((x + y) % 2) set(img, x, y, hex('#65c248'));
  return img;
};
gens.cactus_bottom = gens.cactus_top;
gens.pumpkin_side = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const groove = x % 4 === 0;
      set(img, x, y, groove ? hex('#b0600c') : r.next() < 0.4 ? hex('#d9811a') : hex('#e38a1f'));
    }
  return img;
};
gens.pumpkin_top = (r) => {
  const img = gens.pumpkin_side(r);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, x === 6 || y === 6 ? hex('#6b4b1a') : hex('#4a6b1a'));
  return img;
};
function pumpkinFace(lit: boolean): Gen {
  return () => {
    const img = gens.pumpkin_side(new Random(3));
    const c = lit ? G('#ffe06b') : G('#3a2204');
    const d = lit ? G('#ffb52e') : G('#2a1602');
    art(img, [
      '..cc....cc..',
      '.cdc....cdc.',
      '............',
      '............',
      '.cccccccccc.',
      '.cdcdccdcdc.',
      '..cc.cc.cc..',
    ], { c, d }, 2, 4);
    return img;
  };
}
gens.carved_pumpkin = pumpkinFace(false);
gens.jack_o_lantern = pumpkinFace(true);
gens.melon_side = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, (x + (y >> 2)) % 5 < 2 ? hex('#c7c632') : r.next() < 0.5 ? hex('#6b9e1c') : hex('#7aad24'));
  return img;
};
gens.melon_top = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    set(img, x, y, (d | 0) % 3 === 0 ? hex('#c7c632') : r.next() < 0.5 ? hex('#6b9e1c') : hex('#7aad24'));
  }
  return img;
};
gens.glowstone = (r) => {
  const img = newImg();
  const { cell, edge } = voronoi(r, 9);
  const pal = P('#8f6a37', '#c49a4a', '#e8c37a', '#fdeebb', '#ffdb8a');
  const cols = Array.from({ length: 9 }, () => r.int(pal.length));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const e = edge[y * S + x];
      set(img, x, y, e < 0.8 ? pal[0] : pal[Math.min(4, cols[cell[y * S + x]] + (e > 2.5 ? 1 : 0))]);
    }
  return img;
};
gens.sponge = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#c3c040', '#cfcc4a', '#d8d65a'), { jitter: 0.5 });
  for (let i = 0; i < 14; i++) { const x = r.int(15), y = r.int(15); set(img, x, y, hex('#8f8c22')); set(img, x + 1, y, hex('#a3a02c')); }
  return img;
};
// wool
const WOOL_HEX = ['#e9ecec', '#f07613', '#bd44b3', '#3aafd9', '#f8c627', '#70b919', '#ed8dac', '#3e4447', '#8e8e86', '#158991', '#792aac', '#35399d', '#724728', '#546d1b', '#a12722', '#141519'];
WOOL_COLORS.forEach((id, i) => {
  gens[BLOCKS[id].name] = (r) => {
    const img = newImg();
    const base = hex(WOOL_HEX[i]);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const knit = ((x + (y % 2) * 2) % 4 < 2 ? 1.04 : 0.96) * (0.95 + r.next() * 0.1);
        set(img, x, y, shade(base, knit));
      }
    return img;
  };
});
// bed textures
gens.bed_head_top = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 6 ? (x < 2 || x > 13 ? hex('#8e1414') : hex('#f0f0f0')) : (x + y) % 5 ? hex('#b52020') : hex('#9e1a1a'));
  return img;
};
gens.bed_foot_top = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, (x + y) % 5 ? hex('#b52020') : hex('#9e1a1a'));
  return img;
};
gens.bed_head_side = () => {
  const img = newImg();
  for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? (x > 9 ? hex('#f0f0f0') : hex('#b52020')) : y < 13 ? hex('#a2824e') : x > 12 ? hex('#6b5130') : [0, 0, 0], y >= 13 && x <= 12 ? 0 : 255);
  return img;
};
gens.bed_foot_side = () => {
  const img = newImg();
  for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? hex('#b52020') : y < 13 ? hex('#a2824e') : x < 3 ? hex('#6b5130') : [0, 0, 0], y >= 13 && x >= 3 ? 0 : 255);
  return img;
};
gens.bed_head_end = () => {
  const img = newImg();
  for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? hex('#f0f0f0') : y < 13 ? hex('#a2824e') : hex('#6b5130'), y >= 13 && x > 2 && x < 13 ? 0 : 255);
  return img;
};
gens.bed_foot_end = () => {
  const img = newImg();
  for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? hex('#b52020') : y < 13 ? hex('#a2824e') : hex('#6b5130'), y >= 13 && x > 2 && x < 13 ? 0 : 255);
  return img;
};

// ---------------------------------------------------------------- block breaking cracks
{
  const r = new Random(99991);
  const segs: [number, number][] = [];
  // random-walk crack network grown from the centre
  const walkers: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) { const a = r.next() * Math.PI * 2; walkers.push([7.5, 7.5, Math.cos(a), Math.sin(a)]); }
  for (let step = 0; step < 60; step++) {
    const w = walkers[step % walkers.length];
    w[0] += w[2]; w[1] += w[3];
    const a = Math.atan2(w[3], w[2]) + (r.next() - 0.5) * 1.2;
    w[2] = Math.cos(a); w[3] = Math.sin(a);
    const x = Math.round(w[0]), y = Math.round(w[1]);
    if (x < 0 || y < 0 || x > 15 || y > 15) { w[0] = 7.5 + (r.next() - 0.5) * 8; w[1] = 7.5 + (r.next() - 0.5) * 8; continue; }
    segs.push([x, y]);
    if (r.next() < 0.1) walkers.push([w[0], w[1], -w[3], w[2]]);
  }
  for (let s = 0; s < 10; s++) {
    gens['destroy_stage_' + s] = () => {
      const img = newImg();
      const n = Math.floor(((s + 1) / 10) * segs.length);
      for (let i = 0; i < n; i++) {
        const [x, y] = segs[i];
        set(img, x, y, [30, 30, 30], 200);
        if (i % 3 === 0 && s > 4) set(img, x + 1, y, [60, 60, 60], 140);
      }
      return img;
    };
  }
}

// ---------------------------------------------------------------- nether
gens.netherrack = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#5a1d1d', '#6b2222', '#6f2525', '#7a2a2a', '#843030', '#8f3a36'), { jitter: 0.75 });
  for (let i = 0; i < 12; i++) { const x = r.int(S), y = r.int(S); set(img, x, y, hex('#4a1414')); set(img, (x + 1) % S, y, hex('#4a1414')); }
  for (let i = 0; i < 8; i++) set(img, r.int(S), r.int(S), hex('#9e4a44'));
  return img;
};
gens.soul_sand = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#3f2d22', '#4a3628', '#54402f', '#5c4636', '#664f3c'), { jitter: 0.7 });
  // faint screaming faces
  for (const [fx, fy] of [[2, 3], [9, 8], [4, 11]]) {
    set(img, fx, fy, hex('#2a1c14')); set(img, fx + 2, fy, hex('#2a1c14'));
    set(img, fx + 1, fy + 2, hex('#2a1c14')); set(img, fx + 1, fy + 3, hex('#2a1c14'));
  }
  return img;
};
gens.nether_bricks = (r) => brickPattern(r, 4, hex('#1a0c10'), P('#2c1419', '#361a1f', '#3c1c22'), hex('#241014'), hex('#4a2229'));
gens.nether_quartz_ore = (r) => {
  const img = gens.netherrack(new Random(55));
  for (let i = 0; i < 6; i++) {
    const x = 1 + r.int(13), y = 1 + r.int(13);
    set(img, x, y, hex('#e8e0d8')); set(img, x + 1, y, hex('#d8cfc4')); if (r.bool()) set(img, x, y + 1, hex('#bfb3a5'));
  }
  return img;
};
gens.quartz_block_side = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#e3dcd2', '#e8e2d9', '#ece6de', '#f0ebe4'), { jitter: 0.5 });
  return img;
};
gens.quartz_block_top = (r) => {
  const img = gens.quartz_block_side(r);
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#d4ccc0')); set(img, 0, i, hex('#d4ccc0')); set(img, i, 15, hex('#c8bfb2')); set(img, 15, i, hex('#c8bfb2')); }
  return img;
};
gens.magma_block = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#5a1a0a', '#6b240c', '#7a2e10', '#8a3812'), { jitter: 0.6 });
  const { edge } = voronoi(r, 7);
  for (let i = 0; i < S * S; i++) if (edge[i] < 0.9) set(img, i % S, (i / S) | 0, edge[i] < 0.45 ? hex('#ffb030') : hex('#e0601a'));
  return img;
};
function portalFrame(frame: number): Img {
  const img = newImg();
  const t = (frame / 32) * Math.PI * 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const v = Math.sin(a * 2 + d * 0.9 - t * 2) * 0.5 + Math.sin(x * 0.9 + y * 0.4 + t) * 0.25 + Math.cos(d * 1.3 + t * 3) * 0.25;
      const l = 0.5 + v * 0.5;
      const c = mix(hex('#4a0e8a'), hex('#b44aff'), l);
      set(img, x, y, l > 0.85 ? mix(c, hex('#f0c0ff'), 0.5) : c, 190);
    }
  return img;
}
gens.nether_portal = () => portalFrame(0);

// ---------------------------------------------------------------- redstone
// Dust is drawn as one quad per block (no overlapping layers to z-fight), so each connection shape gets its
// own texture: mask bits are N, E, S, W. Alone: a dot. One side or two opposite sides: a straight line right
// across the block. Corners, T's and crosses: the dot with arms.
const dustDotPx = (x: number, y: number) => {
  const d = Math.hypot(x - 7.5, y - 7.5);
  return d < 2 ? 2 : d < 3.2 || (d < 4.5 && (x * 7 + y * 3) % 5 < 2) ? 1 : 0;
};
const dustLinePx = (along: number, across: number) => {
  // a 2px core with ragged 1px edges, like vanilla's redstone_dust_line
  if (across === 7 || across === 8) return 2;
  if ((across === 6 || across === 9) && ((along * 5 + across * 3) % 7) < 4) return 1;
  return 0;
};
gens.redstone_dust_dot = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = dustDotPx(x, y);
    if (v) set(img, x, y, v === 2 ? [255, 255, 255] : [200, 200, 200]);
  }
  return img;
};
gens.redstone_dust_line = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = dustLinePx(y, x);
    if (v) set(img, x, y, v === 2 ? [255, 255, 255] : [190, 190, 190]);
  }
  return img;
};
for (let m = 0; m < 16; m++) gens['redstone_dust_' + m] = () => {
  const img = newImg();
  const n = !!(m & 1), e = !!(m & 2), so = !!(m & 4), w = !!(m & 8);
  const count = +n + +e + +so + +w;
  const ns = (n || so) && !e && !w, ew = (e || w) && !n && !so;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    if (count === 0) v = dustDotPx(x, y);
    else if (ns) v = dustLinePx(y, x);
    else if (ew) v = dustLinePx(x, y);
    else {
      v = dustDotPx(x, y);
      if (n && y <= 8) v = Math.max(v, dustLinePx(y, x));
      if (so && y >= 7) v = Math.max(v, dustLinePx(y, x));
      if (w && x <= 8) v = Math.max(v, dustLinePx(x, y));
      if (e && x >= 7) v = Math.max(v, dustLinePx(x, y));
    }
    if (v) set(img, x, y, v === 2 ? [255, 255, 255] : [195, 195, 195]);
  }
  return img;
};
// ---------------------------------------------------------------- rails
// Track runs north-south (along the texture's height): wooden ties across, two rails at columns 2-3 and 12-13.
type RailStyle = { rail: [RGB, RGB]; tie: [RGB, RGB]; middle?: (x: number, y: number) => RGB | null };
const IRON_RAIL: [RGB, RGB] = [hex('#b5b5b5'), hex('#6b6b6b')];
const GOLD_RAIL: [RGB, RGB] = [hex('#fbe26a'), hex('#b8901c')];
const TIE: [RGB, RGB] = [hex('#7a5c34'), hex('#4f3a20')];
function railImg(r: Random, st: RailStyle): Img {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const tieRow = y % 4 === 1 || y % 4 === 2;
    if (tieRow && x >= 1 && x <= 14) set(img, x, y, shade(y % 4 === 1 ? st.tie[0] : st.tie[1], 0.92 + r.next() * 0.16));
    const m = st.middle?.(x, y);
    if (m) set(img, x, y, m);
    if (x === 2 || x === 12) set(img, x, y, st.rail[0]);
    if (x === 3 || x === 13) set(img, x, y, st.rail[1]);
  }
  return img;
}
gens.rail = (r) => railImg(r, { rail: IRON_RAIL, tie: TIE });
gens.rail_corner = (r) => {
  // a quarter turn joining the bottom (south) and right (east) edges
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = 16 - (x + 0.5), dy = 16 - (y + 0.5);
    const rr = Math.hypot(dx, dy), a = Math.atan2(dy, dx) / (Math.PI / 2);
    const tie = (a * 4.6) % 1 < 0.42 && rr > 1.2 && rr < 15.2;
    if (tie) set(img, x, y, shade(TIE[(a * 4.6) % 1 < 0.21 ? 0 : 1], 0.92 + r.next() * 0.16));
    if ((rr >= 2.5 && rr < 3.5) || (rr >= 12.5 && rr < 13.5)) set(img, x, y, IRON_RAIL[1]);
    if ((rr >= 3.5 && rr < 4.5) || (rr >= 13.5 && rr < 14.5)) set(img, x, y, IRON_RAIL[0]);
  }
  return img;
};
const redLine = (on: boolean) => (x: number, y: number): RGB | null => (x === 7 || x === 8) && y % 4 !== 0 ? (on ? (x === 7 ? hex('#ff3a2a') : hex('#d01a10')) : x === 7 ? hex('#6a1410') : hex('#4c0d0a')) : null;
gens.powered_rail = (r) => railImg(r, { rail: GOLD_RAIL, tie: TIE, middle: redLine(false) });
gens.powered_rail_on = (r) => railImg(r, { rail: GOLD_RAIL, tie: TIE, middle: redLine(true) });
const plate = (on: boolean) => (x: number, y: number): RGB | null => {
  if (x < 5 || x > 10 || y < 3 || y > 12) return null;
  if ((x === 7 || x === 8) && (y === 5 || y === 10)) return on ? hex('#ff3a2a') : hex('#5c120e');
  return x === 5 || y === 3 ? hex('#9a9a9a') : x === 10 || y === 12 ? hex('#5a5a5a') : hex('#7a7a7a');
};
gens.detector_rail = (r) => railImg(r, { rail: IRON_RAIL, tie: TIE, middle: plate(false) });
gens.detector_rail_on = (r) => railImg(r, { rail: IRON_RAIL, tie: TIE, middle: plate(true) });
const DARK_TIE: [RGB, RGB] = [hex('#5a4a3a'), hex('#3a2e24')];
gens.activator_rail = (r) => railImg(r, { rail: IRON_RAIL, tie: DARK_TIE, middle: redLine(false) });
gens.activator_rail_on = (r) => railImg(r, { rail: IRON_RAIL, tie: DARK_TIE, middle: redLine(true) });
// hay bale: straw with two red-brown bands round the sides
gens.hay_block_side = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = shade(hex(r.int(3) ? '#c9a92c' : '#a88a1e'), 0.9 + r.next() * 0.2);
    if (x % 3 === 0 && r.int(2)) c = shade(c, 0.82);
    if (y === 3 || y === 4 || y === 11 || y === 12) c = shade(hex('#8a3c1c'), 0.9 + r.next() * 0.2);
    set(img, x, y, c);
  }
  return img;
};
gens.hay_block_top = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    let c = shade(hex(r.int(3) ? '#c9a92c' : '#b0921f'), 0.88 + r.next() * 0.2);
    if (Math.abs(Math.sin(d * 1.3)) < 0.25) c = shade(c, 0.8);
    if (x === 3 || x === 4 || x === 11 || x === 12) c = shade(hex('#8a3c1c'), 0.9 + r.next() * 0.2);
    set(img, x, y, c);
  }
  return img;
};
// minecart body: riveted iron plates
gens.minecart = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = shade(hex('#8c8c8c'), 0.9 + r.next() * 0.12);
    if (y === 0 || x === 0) c = hex('#b0b0b0');
    if (y === 15 || x === 15) c = hex('#4e4e4e');
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) c = hex('#c8c8c8');
    set(img, x, y, c);
  }
  return img;
};
gens.minecart_inside = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, shade(hex('#5e5e5e'), 0.88 + r.next() * 0.14 - (x % 5 === 0 ? 0.12 : 0)));
  return img;
};
gens.lever = () => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, x < 8 ? hex('#8a6b3c') : hex('#6b5130')); return img; };
function rsTorch(on: boolean): Gen {
  return () => { const img = newImg(); art(img, [
    '', '', '', '', '', '',
    '.......rR.......',
    '.......RW.......',
    '.......rr.......',
    '.......sS.......',
    '.......sS.......',
    '.......sS.......',
    '.......sS.......',
    '.......sS.......',
    '.......sS.......',
    '.......sS.......',
  ], on ? { r: G('#d80000'), R: G('#ff3a2a'), W: G('#ffb0a0'), s: G('#8a6b3c'), S: G('#6b5130') } : { r: G('#4a0a0a'), R: G('#6a1414'), W: G('#7a2a2a'), s: G('#8a6b3c'), S: G('#6b5130') }); return img; };
}
gens.redstone_torch = rsTorch(true);
gens.redstone_torch_off = rsTorch(false);
gens.redstone_lamp = (r) => {
  const img = newImg();
  const { edge } = voronoi(r, 8);
  for (let i = 0; i < S * S; i++) set(img, i % S, (i / S) | 0, edge[i] < 0.8 ? hex('#3a2418') : hex(['#6e4a2e', '#7a5434', '#5e3e26'][i % 3]));
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#2a1a10')); set(img, 0, i, hex('#2a1a10')); set(img, i, 15, hex('#2a1a10')); set(img, 15, i, hex('#2a1a10')); }
  return img;
};
gens.redstone_lamp_on = (r) => {
  const img = newImg();
  const { edge } = voronoi(r, 8);
  for (let i = 0; i < S * S; i++) set(img, i % S, (i / S) | 0, edge[i] < 0.8 ? hex('#8a5a2a') : hex(['#ffd58a', '#ffe8b0', '#f8c070'][i % 3]));
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#6a4020')); set(img, 0, i, hex('#6a4020')); set(img, i, 15, hex('#6a4020')); set(img, 15, i, hex('#6a4020')); }
  return img;
};
gens.enchanting_table_top = (r) => {
  const img = gens.obsidian(new Random(3));
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#8a1a1a')); set(img, 0, i, hex('#8a1a1a')); set(img, i, 15, hex('#5a0a0a')); set(img, 15, i, hex('#5a0a0a')); }
  for (let y = 3; y < 13; y++) for (let x = 2; x < 14; x++) set(img, x, y, (x === 7 || x === 8) ? hex('#6b4a2a') : r.int(4) ? hex('#b02a2a') : hex('#d04040'));
  for (const [x, y] of [[4, 5], [5, 7], [10, 6], [11, 9]]) set(img, x, y, hex('#46d4d0'));
  return img;
};
gens.enchanting_table_side = (r) => {
  const img = gens.obsidian(new Random(4));
  for (let x = 0; x < S; x++) for (let y = 0; y < 4; y++) set(img, x, y, y === 0 ? hex('#5a0a0a') : r.int(3) ? hex('#b02a2a') : hex('#8a1a1a'));
  for (const [x, y] of [[3, 8], [8, 10], [12, 7]]) { set(img, x, y, hex('#46d4d0')); set(img, x + 1, y, hex('#2a9a98')); }
  return img;
};
gens.redstone_block = metalBlock(['#6a0a04', '#a8140a', '#b81c10', '#d02818', '#ff5040']);

// ---------------------------------------------------------------- redstone devices
const RS_ON = hex('#ff2a18'), RS_ON2 = hex('#c01008'), RS_OFF = hex('#6a0a04'), RS_OFF2 = hex('#4a0602');
function diodeTop(kind: 'repeater' | 'comparator', on: boolean): Gen {
  return () => {
    const img = gens.smooth_stone(new Random(21));
    const a = on ? RS_ON : RS_OFF, b = on ? RS_ON2 : RS_OFF2;
    if (kind === 'repeater') {
      for (let y = 2; y < 15; y++) { set(img, 7, y, a); set(img, 8, y, b); }
      // arrow head toward the output (north / top)
      for (const [x, y] of [[6, 4], [9, 4], [5, 5], [10, 5]]) set(img, x, y, b);
    } else {
      for (let y = 3; y < 13; y++) { set(img, 7, y, y < 5 ? RS_OFF : a); set(img, 8, y, y < 5 ? RS_OFF2 : b); }
      for (let x = 4; x < 12; x++) { set(img, x, 12, a); set(img, x, 13, b); }
      for (const [x, y] of [[4, 11], [11, 11]]) set(img, x, y, a);
    }
    return img;
  };
}
gens.repeater = diodeTop('repeater', false);
gens.repeater_on = diodeTop('repeater', true);
gens.comparator = diodeTop('comparator', false);
gens.comparator_on = diodeTop('comparator', true);

const IRON_DARK = P('#3a3a3a', '#424242', '#4a4a4a', '#525252');
gens.hopper_outside = (r) => {
  const img = newImg();
  paletteNoise(img, r, IRON_DARK, { jitter: 0.5 });
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#5e5e5e')); set(img, 0, i, hex('#5a5a5a')); set(img, i, 15, hex('#262626')); set(img, 15, i, hex('#2a2a2a')); }
  return img;
};
gens.hopper_top = (r) => {
  const img = gens.hopper_outside(r);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) set(img, x, y, (x + y) % 5 ? hex('#1e1e1e') : hex('#262626'));
  return img;
};
gens.hopper_inside = (r) => { const img = newImg(); paletteNoise(img, r, P('#1c1c1c', '#222222', '#282828'), { jitter: 0.5 }); return img; };

function dispenserFace(kind: 'dispenser' | 'dropper', vertical: boolean): Gen {
  return () => {
    const img = vertical ? gens.furnace_top(new Random(12)) : gens.furnace_side(new Random(11));
    const hole = hex('#1a1a1a'), rim = hex('#4a4a4a'), lip = hex('#9a9a9a');
    if (kind === 'dispenser') {
      const rows = vertical ? ['.rrrrrr.', 'rkkkkkkr', 'rkkkkkkr', 'rkkkkkkr', 'rkkkkkkr', 'rkkkkkkr', 'rkkkkkkr', '.llllll.'] : ['..rrrr..', '.rkkkkr.', 'rkkkkkkr', 'rkkkkkkr', 'rkkkkkkr', '.rkkkkr.', '..llll..'];
      art(img, rows, { r: rim, k: hole, l: lip }, 4, vertical ? 4 : 5);
      if (!vertical) for (let x = 1; x < 15; x++) set(img, x, 2, hex('#555555'));
    } else {
      art(img, ['rrrr', 'rkkr', 'rkkr', 'llll'], { r: rim, k: hole, l: lip }, 6, vertical ? 6 : 7);
      if (!vertical) for (let x = 1; x < 15; x++) set(img, x, 2, hex('#555555'));
    }
    return img;
  };
}
gens.dispenser_front = dispenserFace('dispenser', false);
gens.dispenser_front_vertical = dispenserFace('dispenser', true);
gens.dropper_front = dispenserFace('dropper', false);
gens.dropper_front_vertical = dispenserFace('dropper', true);

// pistons
function pistonHeadFace(sticky: boolean): Gen {
  return () => {
    const img = gens.oak_planks(new Random(5));
    const iron = hex('#9a9a9a'), ironD = hex('#6a6a6a');
    for (let i = 0; i < S; i++) { set(img, i, 0, iron); set(img, 0, i, iron); set(img, i, 15, ironD); set(img, 15, i, ironD); }
    for (let i = 5; i < 11; i++) { set(img, i, 5, ironD); set(img, i, 10, ironD); set(img, 5, i, ironD); set(img, 10, i, ironD); }
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, iron);
    if (sticky) {
      const r = new Random(77);
      for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) if (Math.hypot(x - 7.5, y - 7.5) < 6.2 + r.next() * 0.8) set(img, x, y, r.int(4) ? hex('#6fb85a') : hex('#8ad872'));
    }
    return img;
  };
}
gens.piston_top = pistonHeadFace(false);
gens.piston_top_sticky = pistonHeadFace(true);
gens.piston_side = (r) => {
  const img = gens.cobblestone(new Random(9));
  const planks = gens.oak_planks(new Random(5));
  for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4; set(img, x, y, [planks[i], planks[i + 1], planks[i + 2]]); }
  for (let x = 0; x < S; x++) { set(img, x, 4, hex('#2a2a2a')); set(img, x, 0, hex('#b08a58')); }
  // iron band down the middle
  for (let y = 5; y < S; y++) { set(img, 6, y, hex('#8a8a8a')); set(img, 7, y, hex('#b0b0b0')); set(img, 8, y, hex('#9a9a9a')); set(img, 9, y, hex('#6a6a6a')); }
  void r;
  return img;
};
gens.piston_bottom = () => {
  const img = gens.cobblestone(new Random(13));
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) set(img, x, y, y === 5 || x === 5 ? hex('#b0b0b0') : y === 10 || x === 10 ? hex('#5a5a5a') : hex('#8a8a8a'));
  return img;
};
gens.piston_inner = () => {
  const img = gens.cobblestone(new Random(14));
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) set(img, x, y, hex('#2a2a2a'));
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, (x + y) % 2 ? hex('#8a8a8a') : hex('#a0a0a0'));
  return img;
};

// observer
const OBS = P('#5c5c5c', '#626262', '#686868', '#6e6e6e');
function observerBase(r: Random): Img {
  const img = newImg();
  paletteNoise(img, r, OBS, { jitter: 0.5 });
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#7e7e7e')); set(img, 0, i, hex('#7a7a7a')); set(img, i, 15, hex('#3a3a3a')); set(img, 15, i, hex('#404040')); }
  return img;
}
gens.observer_front = (r) => {
  const img = observerBase(r);
  art(img, ['kkkkkkkkkk', 'kddkkkkddk', 'kdWkkkkdWk', 'kddkkkkddk', 'kkkkkkkkkk'], { k: hex('#1e1e1e'), d: hex('#3a3a3a'), W: hex('#c8c8c8') }, 3, 5);
  for (let x = 3; x < 13; x++) set(img, x, 11, hex('#2a2a2a'));
  return img;
};
gens.observer_back = (r) => {
  const img = observerBase(r);
  art(img, ['kkkk', 'kddk', 'kddk', 'kkkk'], { k: hex('#2a2a2a'), d: hex('#4a0a04') }, 6, 6);
  return img;
};
gens.observer_back_on = (r) => {
  const img = observerBase(r);
  art(img, ['kkkk', 'kRRk', 'kRRk', 'kkkk'], { k: hex('#2a2a2a'), R: hex('#ff3020') }, 6, 6);
  return img;
};
gens.observer_side = (r) => {
  const img = observerBase(r);
  // arrow pointing up (toward the output)
  for (let y = 3; y < 13; y++) { set(img, 7, y, hex('#3a3a3a')); set(img, 8, y, hex('#2e2e2e')); }
  for (const [x, y] of [[6, 4], [9, 4], [5, 5], [10, 5]]) set(img, x, y, hex('#3a3a3a'));
  return img;
};
gens.observer_top = (r) => {
  const img = observerBase(r);
  for (let x = 2; x < 14; x++) { set(img, x, 4, hex('#3a3a3a')); set(img, x, 11, hex('#3a3a3a')); }
  for (let y = 4; y < 12; y++) { set(img, 7, y, hex('#6a0a04')); set(img, 8, y, hex('#4a0602')); }
  return img;
};

// slime block
gens.slime_block = (r) => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const inner = x >= 3 && x <= 12 && y >= 3 && y <= 12;
      const innerEdge = inner && (x === 3 || y === 3 || x === 12 || y === 12);
      const c = edge ? hex('#4f9a3f') : innerEdge ? hex('#5aa64a') : inner ? (r.int(5) ? hex('#78c865') : hex('#8ad872')) : r.int(6) ? hex('#6fbf5c') : hex('#86d470');
      set(img, x, y, c, edge ? 220 : innerEdge ? 210 : inner ? 190 : 150);
    }
  return img;
};

// brewing
gens.brewing_stand = () => {
  const img = newImg();
  // central rod (columns 7-8)
  for (let y = 2; y < 16; y++) { set(img, 7, y, hex('#6a5a3a')); set(img, 8, y, hex('#4a3e28')); }
  set(img, 7, 1, hex('#e8d060')); set(img, 8, 1, hex('#c8a830'));
  // left half: bottle hanging from the arm
  art(img, [
    '.aaaaaa',
    '...g...',
    '..gGg..',
    '.gGWGg.',
    'gGWGGGg',
    'gGGGGGg',
    'gGGGGGg',
    '.gGGGg.',
    '..ggg..',
  ], { a: hex('#6a5a3a'), g: hex('#cfd8e0'), G: hex('#8aa4e8'), W: hex('#ffffff') }, 0, 5);
  // right half: empty arm
  art(img, ['aaaaaaa', 'a......'], { a: hex('#6a5a3a') }, 9, 5);
  return img;
};
gens.brewing_stand_base = (r) => { const img = newImg(); paletteNoise(img, r, P('#6a6a6a', '#747474', '#7e7e7e'), { jitter: 0.6 }); return img; };

// crops
function cropStages(name: string, n: number, leaf: string[], top: string | null) {
  for (let st = 0; st < n; st++) gens[`${name}_stage${st}`] = (r) => {
    const img = newImg();
    const h = 4 + Math.round((st / (n - 1)) * 7);
    for (let k = 0; k < 5; k++) {
      let x = 2 + k * 3;
      for (let y = 15; y > 15 - h + r.int(2); y--) {
        set(img, x, y, hex(leaf[r.int(leaf.length)]));
        if (y < 13 && r.next() < 0.3) { set(img, x + 1, y, hex(leaf[0])); }
        if (r.next() < 0.2) x = Math.max(0, Math.min(15, x + (r.bool() ? 1 : -1)));
      }
    }
    if (top && st === n - 1) for (let k = 0; k < 4; k++) { const x = 2 + k * 4, y = 13 + (k & 1); set(img, x, y, hex(top)); set(img, x + 1, y, hex(top)); set(img, x, y + 1, hex(top)); }
    return img;
  };
}
cropStages('carrots', 4, ['#3e8c1c', '#52a52a', '#2e6c14'], '#f08a1a');
cropStages('potatoes', 4, ['#3a8a24', '#4ea02e', '#2c6a18'], '#c8a64a');
for (let st = 0; st < 3; st++) gens['nether_wart_stage' + st] = (r) => {
  const img = newImg();
  const h = [5, 8, 12][st];
  for (let k = 0; k < 4; k++) {
    const x = 2 + k * 4;
    for (let y = 15; y > 15 - h; y--) set(img, x + (y % 3 === 0 ? 1 : 0), y, hex(r.int(2) ? '#7a1418' : '#9a2024'));
    if (st > 0) { set(img, x - 1, 16 - h, hex('#c83036')); set(img, x + 1, 16 - h, hex('#c83036')); set(img, x, 15 - h, hex('#e04a4a')); }
  }
  return img;
};

// anvil
gens.anvil = (r) => { const img = newImg(); paletteNoise(img, r, P('#3e3e3e', '#444444', '#4a4a4a', '#505050'), { jitter: 0.4 }); return img; };
function anvilTop(cracks: number): Gen {
  return (r) => {
    const img = newImg();
    paletteNoise(img, r, P('#4a4a4a', '#505050', '#585858'), { jitter: 0.4 });
    for (let y = 0; y < S; y++) { set(img, 3, y, hex('#2e2e2e')); set(img, 12, y, hex('#2e2e2e')); }
    for (let c = 0; c < cracks * 3; c++) {
      let x = 4 + r.int(8), y = r.int(16);
      for (let k = 0; k < 5; k++) { set(img, x, y, hex('#262626')); x += r.int(3) - 1; y += 1; if (x < 4 || x > 11 || y > 15) break; }
    }
    return img;
  };
}
gens.anvil_top = anvilTop(0);
gens.chipped_anvil_top = anvilTop(1);
gens.damaged_anvil_top = anvilTop(3);

// ---------------------------------------------------------------- particles
for (let i = 0; i < 8; i++) {
  gens['particle_smoke_' + i] = () => {
    const img = newImg();
    const r = 7 - i * 0.8;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d < r) set(img, x, y, [255, 255, 255], 255);
      }
    return img;
  };
}
for (let i = 0; i < 16; i++) {
  gens['particle_explosion_' + i] = (r) => {
    const img = newImg();
    const f = blobField(new Random(4040), 2);
    const rad = 5 + i * 0.2, fade = 1 - i / 18;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5) / rad;
        const n = f[y * S + x];
        if (d + (n - 0.5) * 0.6 > 1) continue;
        const c = Math.round((150 + n * 90 - i * 5) * (i < 3 ? 1.1 : 1));
        set(img, x, y, [Math.min(255, c), Math.min(255, c), Math.min(255, c)], Math.round(255 * fade));
      }
    void r;
    return img;
  };
}
gens.particle_flame = () => { const img = newImg(); art(img, [
  '', '', '', '',
  '.......y........',
  '......yYy.......',
  '.....yYWYy......',
  '.....oYWYo......',
  '.....oyYyo......',
  '......ooo.......',
], { y: G('#ffd800'), Y: G('#fff78a'), W: G('#ffffff'), o: G('#ff7a00') }); return img; };
gens.particle_bubble = () => { const img = newImg(); art(img, [
  '', '', '', '',
  '.....bbbbb......',
  '....b.....b.....',
  '...b..w....b....',
  '...b.w.....b....',
  '...b.......b....',
  '...b.......b....',
  '....b.....b.....',
  '.....bbbbb......',
], { b: G('#a8c8ff'), w: G('#ffffff') }); return img; };
for (let i = 0; i < 4; i++) gens['particle_splash_' + i] = () => { const img = newImg(); for (let y = 6; y < 10; y++) for (let x = 6 + i % 2; x < 10; x++) set(img, x, y, [200, 220, 255]); return img; };
gens.particle_crit = () => { const img = newImg(); art(img, [
  '', '', '', '', '',
  '.......w........',
  '.......w........',
  '.....w.w.w......',
  '......www.......',
  '...wwwwWwwww....',
  '......www.......',
  '.....w.w.w......',
  '.......w........',
  '.......w........',
], { w: G('#ffffff'), W: G('#ffffff') }); return img; };
gens.particle_heart = () => { const img = newImg(); art(img, [
  '', '', '', '',
  '....rr...rr.....',
  '...rRRr.rRRr....',
  '...rRWRrRRRr....',
  '...rRRRRRRRr....',
  '....rRRRRRr.....',
  '.....rRRRr......',
  '......rRr.......',
  '.......r........',
], { r: G('#8a0a0a'), R: G('#e01010'), W: G('#ffffff') }); return img; };
gens.particle_drip = () => { const img = newImg(); for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) set(img, x, y, [255, 255, 255]); return img; };
gens.particle_rain = gens.particle_drip;
gens.particle_spell = () => { const img = newImg(); art(img, [
  '', '', '', '', '',
  '.......w........',
  '......www.......',
  '.....wwWww......',
  '......www.......',
  '.......w........',
], { w: G('#ffffff'), W: G('#ffffff') }); return img; };

// firework sparks: a glint that shrinks as it burns out (frame 7 is the biggest), and the burst's flash
for (let i = 0; i < 8; i++) gens['particle_spark_' + i] = () => {
  const img = newImg();
  const R = 1.5 + i * 0.9, core = R * 0.45;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5), d = Math.hypot(dx, dy);
      let a = 0;
      if (d <= core) a = 255;
      else if (d <= R) {
        // four bright rays, a softer glow between them
        const ray = Math.min(dx, dy) < 1 ? 1 - (d - core) / (R - core + 0.5) : 0;
        const glow = (1 - (d - core) / (R - core)) * 0.45;
        a = Math.round(255 * Math.max(ray, glow));
      }
      if (a > 0) set(img, x, y, [255, 255, 255], a);
    }
  return img;
};
gens.particle_flash = () => {
  const img = newImg();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8;
      if (d < 1) set(img, x, y, [255, 255, 255], Math.round(255 * (1 - d) * (1 - d)));
    }
  return img;
};

// ---------------------------------------------------------------- the End
gens.end_stone = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#d9d99a', '#dfdfa4', '#e2e3a9', '#e6e6b0', '#ebecb8'), { jitter: 0.6 });
  for (let i = 0; i < 18; i++) set(img, r.int(S), r.int(S), r.bool() ? hex('#c3c486') : hex('#b3b476'));
  for (let i = 0; i < 6; i++) { const x = r.int(14), y = r.int(14); set(img, x, y, hex('#f4f5cc')); set(img, x + 1, y, hex('#ced08e')); }
  return img;
};
gens.end_portal_frame_top = (r) => {
  const img = newImg();
  // outer rim, then a sunken socket for the eye
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let c: RGB;
    if (d > 7) c = hex('#1f3d34');
    else if (d > 6) c = hex('#2f5f4d');
    else if (d > 4.5) c = hex('#3f7f63');
    else if (d > 3.5) c = hex('#1b3a30');
    else c = hex(['#123027', '#163529', '#102a22'][(x * 7 + y * 3) % 3]);
    set(img, x, y, c);
  }
  for (let i = 0; i < 14; i++) { const x = 2 + r.int(12), y = 2 + r.int(12); if (Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 4.5) set(img, x, y, hex('#4f9a76')); }
  return img;
};
gens.end_portal_frame_side = (r) => {
  const img = gens.end_stone(new Random(77));
  for (let y = 0; y < 3; y++) for (let x = 0; x < S; x++) set(img, x, y, y === 0 ? hex('#4f9a76') : y === 1 ? hex('#3f7f63') : hex('#2f5f4d'));
  for (let x = 0; x < S; x++) set(img, x, 3, hex('#1f3d34'));
  void r;
  return img;
};
gens.end_portal_eye = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
    let c: RGB = hex('#12302a');
    if (d < 7.2) c = hex('#1c4a3a');
    if (d < 5.6) c = hex('#2f8f6a');
    if (d < 4.2) c = hex('#6bd9a0');
    if (d < 2.4) c = hex('#0a1f1a');
    if (Math.hypot(dx + 1.6, dy + 1.6) < 1) c = hex('#d4ffe8');
    set(img, x, y, c);
  }
  return img;
};
function endPortalFrame(frame: number): Img {
  // a black void with drifting multi-coloured stars
  const img = newImg();
  const t = frame / 24;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const base = 8 + ((x * 31 + y * 17) % 7);
    set(img, x, y, [base * 0.6, base * 0.8, base * 1.4].map((v) => Math.floor(v)) as RGB);
  }
  const r = new Random(4242);
  for (let i = 0; i < 26; i++) {
    const sx = r.int(S), sy = r.int(S), ph = r.next(), hue = r.int(4), size = r.int(3) === 0 ? 2 : 1;
    const tw = 0.5 + 0.5 * Math.sin((t + ph) * Math.PI * 2);
    const col: RGB = [[110, 255, 220], [190, 120, 255], [255, 255, 255], [120, 190, 255]][hue].map((v) => Math.floor(v * (0.35 + 0.65 * tw))) as RGB;
    const ox = Math.floor(((t * 4 * (1 + (i % 3))) + sx) % S);
    for (let k = 0; k < size; k++) set(img, (ox + k) % S, sy, col);
  }
  return img;
}
gens.end_portal = () => endPortalFrame(0);
gens.end_beam = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.abs(x - 7.5);
    if (d < 1.2) set(img, x, y, [255, 255, 255]);
    else if (d < 3.2) set(img, x, y, (y + (x >> 1)) % 4 === 0 ? [255, 150, 255] : [200, 90, 245]);
    else if (d < 5.5 && (y * 3 + x) % 5 === 0) set(img, x, y, [160, 70, 220]);
  }
  return img;
};
gens.dragon_egg = (r) => {
  const img = newImg();
  paletteNoise(img, r, P('#0d0814', '#120a1c', '#170d24', '#1d122d'), { jitter: 0.6 });
  for (let i = 0; i < 30; i++) {
    const x = r.int(S), y = r.int(S);
    set(img, x, y, r.int(3) === 0 ? hex('#c040ff') : hex('#7a2cc8'));
  }
  return img;
};
gens.iron_bars = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) {
    set(img, 7, y, hex('#a9aaa8')); set(img, 8, y, hex('#7d7e7c'));
    if (y === 0 || y === 15) { set(img, 6, y, hex('#7d7e7c')); set(img, 9, y, hex('#5c5d5b')); }
    if (y === 1 || y === 14) set(img, 7, y, hex('#d0d1cf'));
  }
  return img;
};
gens.iron_bars_top = () => {
  const img = newImg();
  for (let y = 0; y < S; y++) { set(img, 7, y, hex('#8f908e')); set(img, 8, y, hex('#6a6b69')); }
  return img;
};
function enderChestBase(r: Random): Img {
  const img = newImg();
  paletteNoise(img, r, P('#10242a', '#142b32', '#183339', '#1c3a40'), { jitter: 0.6 });
  for (let i = 0; i < S; i++) { set(img, i, 0, hex('#0a181c')); set(img, 0, i, hex('#0a181c')); set(img, i, 15, hex('#0a181c')); set(img, 15, i, hex('#0a181c')); }
  return img;
}
gens.ender_chest_top = (r) => {
  const img = enderChestBase(r);
  for (let i = 1; i < 15; i++) { set(img, i, 1, hex('#2a5a52')); set(img, 1, i, hex('#2a5a52')); set(img, i, 14, hex('#0e2226')); set(img, 14, i, hex('#0e2226')); }
  return img;
};
gens.ender_chest_side = (r) => {
  const img = enderChestBase(r);
  for (let x = 1; x < 15; x++) { set(img, x, 5, hex('#2a5a52')); set(img, x, 6, hex('#0e2226')); }
  return img;
};
gens.ender_chest_front = (r) => {
  const img = gens.ender_chest_side(r);
  for (let y = 4; y < 9; y++) for (let x = 6; x < 10; x++) set(img, x, y, y === 4 || y === 8 ? hex('#a9aaa8') : x === 6 || x === 9 ? hex('#7d7e7c') : hex('#4fd9a0'));
  return img;
};

/** Build all block textures in registry order. */
export function buildBlockTextures(): Img[] {
  return TEXTURES.map((n) => copy(getTexture(n)));
}

// ---------------------------------------------------------------- 1.9 - 1.16 blocks (textures2.ts)
paintMore({ gens, planks, logSide, logTop, leavesGen, sapling, ore, metalBlock, speckled, brickPattern, cropStages });
ANIMATED.soul_fire = { frames: 16, speed: 1 };
