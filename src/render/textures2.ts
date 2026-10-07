// Procedural textures for the 1.9 - 1.16 blocks: the new wood kinds, the sixteen colours, the stone families, the
// Nether update, the ocean and the new functional blocks. Painted with the same helpers as textures.ts, which calls
// `paintMore` with them once its own painters exist.
import { Random } from '../noise';
import { S, Img, RGB, newImg, hex, set, get, shade, mix, blobField, paletteNoise, art, copy, voronoi } from './pixels';
import { DYE_COLORS, CORAL_KINDS, PAINTINGS } from '../world/blocks';

type Gen = (r: Random) => Img;
export interface Painters {
  gens: Record<string, Gen>;
  planks(pal: string[]): Gen;
  logSide(pal: string[]): Gen;
  logTop(bark: string, ring: string[], plankGen: Gen): Gen;
  leavesGen(dense: number, spruce?: boolean): Gen;
  sapling(leaf: string[], trunk: string): Gen;
  ore(clusters: string[], count: number, big?: boolean): Gen;
  metalBlock(pal: string[]): Gen;
  speckled(base: string[], spots: string[], n: number): Gen;
  brickPattern(r: Random, rows: number, mortar: RGB, brick: RGB[], dark: RGB, mortarLight?: RGB): Img;
  cropStages(name: string, n: number, leaf: string[], top: string | null): void;
}

const P = (...h: string[]) => h.map(hex);
const G = hex;
const clear = (img: Img) => { img.fill(0); return img; };

/** Every pixel of `img` through f (x, y, colour) -> colour or null (unchanged). */
function each(img: Img, f: (x: number, y: number, c: [number, number, number, number]) => RGB | null, alpha?: number) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const c = get(img, x, y);
      const n = f(x, y, c);
      if (n) set(img, x, y, n, alpha ?? c[3]);
    }
  return img;
}
/** A colour shifted lighter (f > 1) or darker (f < 1). */
const tone = (c: RGB, f: number) => shade(c, f);
/** Five-shade palette around a base colour, dark to light. */
const ramp = (h: string, spread = 0.18): RGB[] => { const c = hex(h); return [tone(c, 1 - spread * 2), tone(c, 1 - spread), c, tone(c, 1 + spread * 0.7), tone(c, 1 + spread * 1.3)]; };
const toHex = (c: RGB) => '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
const rampHex = (h: string, spread = 0.18) => ramp(h, spread).map(toHex);
/** A smooth surface with a faint bevel (polished stones, concrete). */
function smooth(pal: RGB[], jitter = 0.25, bevel = true): Gen {
  return (r) => {
    const img = newImg();
    paletteNoise(img, r, pal.slice(1, 4), { jitter, passes: 2 });
    if (bevel) for (let i = 0; i < S; i++) { set(img, i, 0, pal[4]); set(img, 0, i, pal[4]); set(img, i, 15, pal[0]); set(img, 15, i, pal[0]); }
    return img;
  };
}
/** Downscale-copy a 16x16 image into a w x h box of another (nearest), keeping transparency. */
function blit(dst: Img, src: Img, dx: number, dy: number, w: number, h: number, sx0 = 0, sy0 = 0, sw = 16, sh = 16) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = get(src, sx0 + Math.floor((x * sw) / w), sy0 + Math.floor((y * sh) / h));
      if (c[3] > 0) set(dst, dx + x, dy + y, [c[0], c[1], c[2]], c[3]);
    }
}

// ---------------------------------------------------------------- data
const WOODS: Record<string, { planks: string[]; bark: string[]; leaf?: string[]; trunk: string; nether?: boolean }> = {
  jungle: { planks: ['#5f4027', '#9c6e4a', '#a0734d', '#b4835a', '#bb8a5f'], bark: ['#3e2f13', '#4f3c18', '#59461c', '#5f4a1f', '#6b5424'], leaf: ['#2f7a17', '#46a020', '#235c10'], trunk: '#59461c' },
  acacia: { planks: ['#7a3e1f', '#a8582f', '#ad5d32', '#c26d3f', '#cb7442'], bark: ['#4f4a43', '#5a554d', '#67625a', '#6e6962', '#7a756d'], leaf: ['#5f8c27', '#7aab33', '#4a6e1d'], trunk: '#67625a' },
  dark_oak: { planks: ['#2d1d0c', '#3e2912', '#442d14', '#4f3519', '#56391c'], bark: ['#271c0f', '#2f2213', '#3a2a17', '#3e2d19', '#45331d'], leaf: ['#1f5a10', '#2e7a18', '#16420a'], trunk: '#3a2a17' },
  crimson: { planks: ['#4a1f30', '#653045', '#6a344b', '#7b3d57', '#86425f'], bark: ['#3d1515', '#5c1b1b', '#6e2424', '#7a2a2a', '#922d3a'], trunk: '#6e2424', nether: true },
  warped: { planks: ['#1b4a45', '#2b6963', '#2c6e66', '#3a8d7f', '#409b8b'], bark: ['#2a1f38', '#3b2d4d', '#4b3961', '#2b6963', '#56406e'], trunk: '#3b2d4d', nether: true },
  oak: { planks: ['#6b5130', '#9f844d', '#a2824e', '#b8945f', '#c29d62'], bark: ['#4f3a1f', '#5f4a2b', '#6b5231', '#6e5534', '#7a6040'], trunk: '#6b5231' },
  spruce: { planks: ['#3e2d17', '#5a4024', '#684b2a', '#735531', '#7a5a34'], bark: ['#241709', '#2e1e0d', '#3b2712', '#402c16', '#4a3219'], trunk: '#3b2712' },
  birch: { planks: ['#9a8757', '#c3ad73', '#c8b077', '#d7c185', '#e0cb8f'], bark: ['#cfcfca', '#d8d7d2', '#e2e2dc', '#ececea', '#a8a8a0'], trunk: '#d8d7d2' },
};
/** Vanilla dye, concrete, concrete powder and terracotta colours (by DYE_COLORS order). */
const DYE = ['#f9fffe', '#f9801d', '#c74ebd', '#3ab3da', '#fed83d', '#80c71f', '#f38baa', '#474f52', '#9d9d97', '#169c9c', '#8932b8', '#3c44aa', '#835432', '#5e7c16', '#b02e26', '#1d1d21'];
const CONCRETE = ['#cfd5d6', '#e06101', '#a9309f', '#2389c7', '#f1af15', '#5ea918', '#d5658e', '#36393d', '#7d7d73', '#157788', '#64209c', '#2c2e8f', '#603c20', '#495b24', '#8e2121', '#080a0f'];
const POWDER = ['#e1e3e4', '#e3842a', '#c054b9', '#4ab4d5', '#e9c736', '#7dbd29', '#e59ab5', '#4c5154', '#9a9a94', '#24939d', '#8438b1', '#4649a6', '#7d5434', '#61772c', '#a83632', '#191a1f'];
const TERRA = ['#d1b2a1', '#a15325', '#95576c', '#706c8a', '#ba8523', '#677535', '#a04d4e', '#392a23', '#876b62', '#575b5b', '#764656', '#4a3b5b', '#4d3323', '#4c532a', '#8f3d2e', '#251610'];
export const DYE_HEX = DYE;

export function paintMore(p: Painters) {
  const { gens, planks, logSide, logTop, leavesGen, sapling, speckled, brickPattern } = p;

  // ================================================================ wood
  const doorStyles: Record<string, 'panes' | 'slats' | 'cross' | 'holes' | 'solid' | 'vine'> = {
    spruce: 'slats', birch: 'holes', jungle: 'vine', acacia: 'cross', dark_oak: 'panes', crimson: 'slats', warped: 'cross', oak: 'panes',
  };
  for (const [k, w] of Object.entries(WOODS)) {
    const stem = w.nether ? 'stem' : 'log';
    if (!gens[`${k}_planks`]) gens[`${k}_planks`] = planks(w.planks);
    if (!gens[`${k}_${stem}`]) {
      if (w.nether) gens[`${k}_${stem}`] = netherStem(w.bark, k === 'crimson' ? '#e0393b' : '#28c9b0');
      else gens[`${k}_${stem}`] = logSide(w.bark);
    }
    if (!gens[`${k}_${stem}_top`]) gens[`${k}_${stem}_top`] = logTop(w.bark[2], [w.planks[3], w.planks[1]], gens[`${k}_planks`]);
    gens[`stripped_${k}_${stem}`] = strippedSide(w.planks);
    gens[`stripped_${k}_${stem}_top`] = logTop(w.planks[1], [w.planks[3], w.planks[2]], gens[`${k}_planks`]);
    if (w.leaf && !gens[`${k}_leaves`]) gens[`${k}_leaves`] = leavesGen(k === 'jungle' ? 0.12 : 0.2);
    if (w.leaf && !gens[`${k}_sapling`]) gens[`${k}_sapling`] = sapling(w.leaf, w.trunk);
    if (!gens[`${k}_door_top`]) {
      gens[`${k}_door_top`] = doorTex(w.planks, doorStyles[k], true);
      gens[`${k}_door_bottom`] = doorTex(w.planks, doorStyles[k], false);
    }
    gens[`${k}_door_item`] = doorItem(`${k}_door_top`, `${k}_door_bottom`);
    gens[`${k}_trapdoor`] = trapdoorTex(w.planks, doorStyles[k]);
    gens[`${k}_sign_item`] = signItem(w.planks, w.bark[2]);
  }
  gens.crimson_fungus = fungus('#a2281f', '#e0393b', '#f2a33f');
  gens.warped_fungus = fungus('#167e86', '#2bb8a7', '#f2a33f');
  gens.nether_wart_block = (r) => { const img = newImg(); paletteNoise(img, r, P('#6e0d0e', '#7b0f10', '#8a1415', '#a1191b'), { jitter: 0.5 }); return img; };
  gens.warped_wart_block = (r) => { const img = newImg(); paletteNoise(img, r, P('#0f6b62', '#167e73', '#1d8e81', '#2aa493'), { jitter: 0.5 }); return img; };
  gens.iron_door_top = doorTex(['#5a5a5a', '#c8c8c8', '#d4d4d4', '#dedede', '#e8e8e8'], 'holes', true);
  gens.iron_door_bottom = doorTex(['#5a5a5a', '#c8c8c8', '#d4d4d4', '#dedede', '#e8e8e8'], 'solid', false);
  gens.iron_door_item = doorItem('iron_door_top', 'iron_door_bottom');
  gens.iron_trapdoor = trapdoorTex(['#5a5a5a', '#c8c8c8', '#d4d4d4', '#dedede', '#e8e8e8'], 'holes');

  function netherStem(bark: string[], glow: string): Gen {
    return (r) => {
      const img = logSide(bark)(r);
      for (let i = 0; i < 10; i++) { const x = r.int(S), y = r.int(S); set(img, x, y, hex(glow)); if (r.bool()) set(img, x, (y + 1) % S, tone(hex(glow), 0.8)); }
      return img;
    };
  }
  function strippedSide(pal: string[]): Gen {
    return (r) => {
      const img = newImg();
      const p2 = P(...pal);
      for (let x = 0; x < S; x++) {
        let c = p2[1 + r.int(3)];
        for (let y = 0; y < S; y++) { if (r.next() < 0.15) c = p2[1 + r.int(4)]; set(img, x, y, c); }
      }
      for (let k = 0; k < 3; k++) { const x = r.int(S); for (let y = 0; y < S; y++) if (r.next() < 0.7) set(img, x, y, p2[1]); }
      return img;
    };
  }
  function doorTex(pal: string[], style: string, top: boolean): Gen {
    return (r) => {
      const img = newImg();
      const [frame, dark, mid, light] = P(...pal);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const edge = x === 0 || x === 15 || (top ? y === 0 : y === 15);
          set(img, x, y, edge ? frame : [dark, mid, light][r.int(3)]);
        }
      const hole = (x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(img, x, y, [0, 0, 0], 0); };
      if (top) {
        if (style === 'panes') for (const [x0, y0] of [[2, 2], [9, 2], [2, 8], [9, 8]]) hole(x0, y0, 5, 5);
        else if (style === 'holes') for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]]) hole(x0, y0, 4, 3);
        else if (style === 'cross') { hole(2, 2, 12, 12); for (let i = 2; i < 14; i++) { set(img, i, i, frame); set(img, 15 - i, i, frame); set(img, i, 7, frame); } }
        else if (style === 'vine') { hole(3, 2, 10, 11); for (let y = 2; y < 13; y++) { set(img, 5 + (y % 3), y, G('#4a8f23')); set(img, 10 - (y % 2), y, G('#3a7a18')); } }
        else if (style === 'slats') for (let y = 2; y < 14; y += 3) for (let x = 1; x < 15; x++) set(img, x, y, frame);
      } else {
        for (let y = 2; y < 14; y++) { set(img, 7, y, frame); set(img, 8, y, frame); }
        if (style === 'slats') for (let y = 1; y < 15; y += 3) for (let x = 1; x < 15; x++) set(img, x, y, frame);
        else for (let x = 1; x < 15; x++) set(img, x, 8, frame);
      }
      set(img, 12, top ? 15 : 1, G('#5a5a5a')); set(img, 13, top ? 15 : 1, G('#8a8a8a'));
      return img;
    };
  }
  function doorItem(topName: string, bottomName: string): Gen {
    return () => {
      const img = newImg();
      blit(img, gens[topName](new Random(1)), 4, 0, 8, 8);
      blit(img, gens[bottomName](new Random(2)), 4, 8, 8, 8);
      return img;
    };
  }
  function trapdoorTex(pal: string[], style: string): Gen {
    return (r) => {
      const img = newImg();
      const [frame, dark, mid, light] = P(...pal);
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const edge = x < 2 || x > 13 || y < 2 || y > 13;
          set(img, x, y, edge ? (r.bool() ? frame : dark) : [dark, mid, light][r.int(3)]);
        }
      if (style === 'panes' || style === 'holes') for (const [x0, y0] of [[3, 3], [9, 3], [3, 9], [9, 9]]) for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) set(img, x, y, [0, 0, 0], 0);
      else if (style === 'cross') for (let i = 2; i < 14; i++) { set(img, i, i, frame); set(img, 15 - i, i, frame); }
      else for (let y = 3; y < 14; y += 3) for (let x = 2; x < 14; x++) set(img, x, y, frame);
      return img;
    };
  }
  function signItem(pal: string[], post: string): Gen {
    return () => {
      const img = newImg();
      const [frame, dark, mid, light] = P(...pal);
      for (let y = 2; y < 10; y++) for (let x = 1; x < 15; x++) set(img, x, y, y === 2 || y === 9 || x === 1 || x === 14 ? frame : (x + y) % 3 ? mid : (x % 2 ? light : dark));
      for (let y = 4; y < 8; y += 2) for (let x = 3; x < 13; x++) if ((x * 7 + y) % 4) set(img, x, y, frame);
      for (let y = 10; y < 16; y++) { set(img, 7, y, hex(post)); set(img, 8, y, tone(hex(post), 0.8)); }
      return img;
    };
  }
  function fungus(cap: string, capLight: string, spot: string): Gen {
    return () => { const img = newImg(); art(img, [
      '', '', '', '', '',
      '.....cccccc.....',
      '...cCCCcCCCcc...',
      '..cCCsCCCCsCCc..',
      '..ccccccccccccc.',
      '.......ss.......',
      '.......ss.......',
      '......sss.......',
      '.......ss.......',
      '......s..s......',
      '.....s....s.....',
    ], { c: G(cap), C: G(capLight), s: G(spot) }); return img; };
  }

  // ================================================================ the sixteen colours
  DYE_COLORS.forEach((c, i) => {
    gens[`${c}_concrete`] = (r) => { const img = newImg(); paletteNoise(img, r, ramp(CONCRETE[i], 0.03).slice(1, 4), { jitter: 0.6 }); return img; };
    gens[`${c}_concrete_powder`] = (r) => { const img = newImg(); paletteNoise(img, r, ramp(POWDER[i], 0.09), { jitter: 0.9 }); return img; };
    gens[`${c}_terracotta`] = speckled(rampHex(TERRA[i], 0.03).slice(1, 4), rampHex(TERRA[i], 0.08).slice(0, 2).concat(rampHex(TERRA[i], 0.08).slice(4)), 14);
    gens[`${c}_glazed_terracotta`] = glazed(DYE[i], i);
    gens[`${c}_stained_glass`] = stainedGlass(DYE[i]);
    gens[`${c}_stained_glass_pane_top`] = () => { const img = newImg(); const col = tone(hex(DYE[i]), 0.8); for (let y = 0; y < S; y++) for (let x = 7; x < 9; x++) set(img, x, y, col, 220); return img; };
    if (c !== 'red') bedSet(`${c}_`, DYE[i]);
    // the banner as an item: cloth on a crossbar and pole
    gens[`${c}_banner_item`] = () => {
      const img = newImg(); const col = hex(DYE[i]), dark = tone(col, 0.8), wood = G('#8a6a3a');
      for (let x = 3; x < 13; x++) set(img, x, 1, wood);
      for (let y = 0; y < 16; y++) { set(img, 7, y, wood); set(img, 8, y, wood); }
      for (let y = 2; y < 14; y++) for (let x = 4; x < 12; x++) if (x !== 7 && x !== 8) set(img, x, y, x === 4 || x === 11 || y === 13 ? dark : col);
      return img;
    };
    gens[`${c}_shulker_box`] = shulker(DYE[i]);
  });
  gens.shulker_box = shulker('#8b6a9a');
  function glazed(h: string, seed: number): Gen {
    return () => {
      const img = newImg();
      const base = hex(h), dark = tone(base, 0.6), light = mix(base, [255, 255, 255], 0.5);
      const r = new Random(4242 + seed * 77);
      // a quarter motif mirrored into a rotating pinwheel, like the vanilla tiles
      const q = new Array(64).fill(0).map(() => r.int(4));
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = (x + y) % 5 === 0 ? 3 : x === 0 || y === 0 ? 2 : q[y * 8 + x] === 0 && x > 2 && y > 2 ? 1 : 0;
        const col = [base, dark, light, mix(base, dark, 0.5)][v];
        set(img, x, y, col); set(img, 15 - y, x, col); set(img, 15 - x, 15 - y, col); set(img, y, 15 - x, col);
      }
      return img;
    };
  }
  function stainedGlass(h: string): Gen {
    return () => {
      const img = newImg();
      const c = hex(h);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        set(img, x, y, edge ? tone(c, 0.85) : c, edge ? 200 : 110);
      }
      for (let k = 0; k < 3; k++) set(img, 3 + k, 3 + k * 2, mix(c, [255, 255, 255], 0.5), 160);
      return img;
    };
  }
  function bedSet(prefix: string, h: string) {
    const c = hex(h), d = tone(c, 0.85);
    gens[prefix + 'bed_head_top'] = () => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 6 ? (x < 2 || x > 13 ? d : G('#f0f0f0')) : (x + y) % 5 ? c : d); return img; };
    gens[prefix + 'bed_foot_top'] = () => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, (x + y) % 5 ? c : d); return img; };
    gens[prefix + 'bed_head_side'] = () => { const img = newImg(); for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? (x > 9 ? G('#f0f0f0') : c) : y < 13 ? G('#a2824e') : x > 12 ? G('#6b5130') : [0, 0, 0], y >= 13 && x <= 12 ? 0 : 255); return img; };
    gens[prefix + 'bed_foot_side'] = () => { const img = newImg(); for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? c : y < 13 ? G('#a2824e') : x < 3 ? G('#6b5130') : [0, 0, 0], y >= 13 && x >= 3 ? 0 : 255); return img; };
    gens[prefix + 'bed_head_end'] = () => { const img = newImg(); for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? G('#f0f0f0') : y < 13 ? G('#a2824e') : G('#6b5130'), y >= 13 && x > 2 && x < 13 ? 0 : 255); return img; };
    gens[prefix + 'bed_foot_end'] = () => { const img = newImg(); for (let y = 7; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 10 ? c : y < 13 ? G('#a2824e') : G('#6b5130'), y >= 13 && x > 2 && x < 13 ? 0 : 255); return img; };
    gens[prefix + 'bed_item'] = () => { const img = newImg(); for (let y = 6; y < 12; y++) for (let x = 1; x < 15; x++) set(img, x, y, y < 8 ? (x < 5 ? G('#f0f0f0') : c) : y < 10 ? G('#a2824e') : (x < 3 || x > 12 ? G('#6b5130') : [0, 0, 0]), y >= 10 && x >= 3 && x <= 12 ? 0 : 255); return img; };
  }
  gens.red_bed_item = () => { const img = newImg(); const c = G('#b52020'); for (let y = 6; y < 12; y++) for (let x = 1; x < 15; x++) set(img, x, y, y < 8 ? (x < 5 ? G('#f0f0f0') : c) : y < 10 ? G('#a2824e') : (x < 3 || x > 12 ? G('#6b5130') : [0, 0, 0]), y >= 10 && x >= 3 && x <= 12 ? 0 : 255); return img; };
  function shulker(h: string): Gen {
    return (r) => {
      const img = newImg();
      paletteNoise(img, r, ramp(h, 0.06).slice(1, 4), { jitter: 0.4 });
      const d = tone(hex(h), 0.6);
      for (let x = 0; x < S; x++) { set(img, x, 0, d); set(img, x, 15, d); set(img, x, 9, d); set(img, x, 10, tone(hex(h), 0.8)); }
      for (let y = 0; y < S; y++) { set(img, 0, y, d); set(img, 15, y, d); }
      return img;
    };
  }

  // ================================================================ stone families
  const stoneBricksLike = (pal: string[], line: string, light: string): Gen => (r) => {
    const img = newImg();
    paletteNoise(img, r, P(...pal), { jitter: 0.7 });
    for (let x = 0; x < S; x++) { set(img, x, 0, hex(light)); set(img, x, 7, hex(line)); set(img, x, 8, hex(light)); set(img, x, 15, hex(line)); }
    for (let y = 0; y < 8; y++) { set(img, 15, y, hex(line)); set(img, 0, y, hex(light)); }
    for (let y = 8; y < 16; y++) { set(img, 7, y, hex(line)); set(img, 8, y, hex(light)); }
    return img;
  };
  const chiseled = (pal: string[], line: string, light: string): Gen => (r) => {
    const img = newImg();
    paletteNoise(img, r, P(...pal), { jitter: 0.6 });
    const L = hex(line), H = hex(light);
    for (let i = 0; i < S; i++) { set(img, i, 0, H); set(img, 0, i, H); set(img, i, 15, L); set(img, 15, i, L); }
    for (let i = 3; i < 13; i++) { set(img, i, 3, L); set(img, 3, i, L); set(img, i, 12, H); set(img, 12, i, H); }
    for (let i = 5; i < 11; i++) { set(img, i, 5, H); set(img, 5, i, H); set(img, i, 10, L); set(img, 10, i, L); }
    return img;
  };
  gens.chiseled_stone_bricks = chiseled(['#747474', '#7a7a7a', '#7f7f7f', '#858585'], '#5b5b5b', '#8c8c8c');
  gens.polished_granite = smooth(ramp('#9a6a59', 0.07));
  gens.polished_diorite = smooth(ramp('#c0c0c2', 0.06));
  gens.polished_andesite = smooth(ramp('#848686', 0.07));
  // red sand & sandstone
  gens.red_sand = (r) => { const img = newImg(); paletteNoise(img, r, P('#a24f1a', '#b05a1f', '#bb6222', '#c56a28', '#cf7330'), { jitter: 0.7, bias: 0.05 }); return img; };
  const sandstoneSide = (pal: string[], band: string[]): Gen => (r) => {
    const img = newImg();
    paletteNoise(img, r, P(...pal), { jitter: 0.8 });
    const b = P(...band);
    for (let x = 0; x < S; x++) {
      set(img, x, 0, b[3]); set(img, x, 1, b[2]); set(img, x, 2, b[1]);
      set(img, x, 12, b[1]); set(img, x, 13, r.bool() ? b[1] : b[2]); set(img, x, 14, b[0]); set(img, x, 15, b[0]);
      if (r.next() < 0.3) set(img, x, 7, b[1]);
    }
    return img;
  };
  const RS = ['#a8541c', '#b05a1f', '#b86021', '#c06626'], RSB = ['#8a4214', '#9a4c18', '#c26a2a', '#ca7432'];
  gens.red_sandstone = sandstoneSide(RS, RSB);
  gens.red_sandstone_top = smooth(P('#8a4214', '#ae5a20', '#b45e22', '#ba6324', '#c26a2a'), 0.6, false);
  gens.red_sandstone_bottom = (r) => { const img = newImg(); paletteNoise(img, r, P(...RS), { jitter: 0.8 }); for (let x = 0; x < S; x++) { set(img, x, 0, hex(RSB[1])); set(img, x, 15, hex(RSB[0])); } return img; };
  gens.cut_red_sandstone = (r) => { const img = gens.red_sandstone_top(r); for (let x = 0; x < S; x++) { set(img, x, 0, hex(RSB[3])); set(img, x, 7, hex(RSB[0])); set(img, x, 8, hex(RSB[3])); set(img, x, 15, hex(RSB[0])); } return img; };
  gens.chiseled_red_sandstone = (r) => { const img = gens.red_sandstone_top(r); const d = hex(RSB[0]); for (let x = 3; x < 13; x++) { set(img, x, 4, d); set(img, x, 11, d); } for (let y = 4; y < 12; y++) { set(img, 3, y, d); set(img, 12, y, d); } for (let k = 0; k < 4; k++) { set(img, 6 + k % 2, 6 + (k >> 1) * 2, d); set(img, 9 - k % 2, 7 + (k >> 1) * 2, d); } for (let x = 0; x < S; x++) { set(img, x, 0, hex(RSB[3])); set(img, x, 15, d); } return img; };
  gens.chiseled_sandstone = (r) => { const img = gens.sandstone_top(r); const d = G('#b3a26f'); for (let x = 3; x < 13; x++) { set(img, x, 4, d); set(img, x, 11, d); } for (let y = 4; y < 12; y++) { set(img, 3, y, d); set(img, 12, y, d); } art(img, ['......dd......', '.....d..d.....', '......dd......'], { d }, 1, 6); for (let x = 0; x < S; x++) { set(img, x, 0, G('#e7dcb3')); set(img, x, 15, d); } return img; };
  // nether bricks
  gens.red_nether_bricks = (r) => brickPattern(r, 4, G('#2a0405'), P('#450608', '#4f090a', '#5a0b0d'), G('#330506'), G('#6a1012'));
  gens.chiseled_nether_bricks = chiseled(['#2c1419', '#361a1f', '#3c1c22'], '#1a0c10', '#4a2229');
  gens.cracked_nether_bricks = (r) => { const img = gens.nether_bricks(r); let x = 4 + r.int(6), y = 0; while (y < S) { set(img, x, y, G('#0e0608')); y++; x = Math.max(0, Math.min(15, x + r.int(3) - 1)); } return img; };
  // quartz
  const QZ = ramp('#ece6df', 0.04);
  gens.chiseled_quartz_block = (r) => { const img = smooth(QZ)(r); const d = tone(QZ[2], 0.85); for (let i = 3; i < 13; i++) { set(img, i, 3, d); set(img, i, 12, d); } for (let y = 4; y < 12; y++) { set(img, 7, y, d); set(img, 8, y, tone(QZ[2], 0.92)); } return img; };
  gens.chiseled_quartz_block_top = (r) => { const img = smooth(QZ)(r); const d = tone(QZ[2], 0.85); for (let i = 2; i < 14; i++) { set(img, i, 2, d); set(img, i, 13, d); set(img, 2, i, d); set(img, 13, i, d); } return img; };
  gens.quartz_pillar = (r) => { const img = smooth(QZ, 0.2, false)(r); const d = tone(QZ[2], 0.88); for (let y = 0; y < S; y++) { set(img, 0, y, d); set(img, 15, y, d); set(img, 4, y, tone(QZ[2], 0.94)); set(img, 11, y, tone(QZ[2], 0.94)); } return img; };
  gens.quartz_pillar_top = (r) => { const img = smooth(QZ)(r); const d = tone(QZ[2], 0.88); for (let i = 3; i < 13; i++) { set(img, i, 3, d); set(img, i, 12, d); set(img, 3, i, d); set(img, 12, i, d); } return img; };
  gens.quartz_bricks = (r) => brickPattern(r, 2, tone(QZ[2], 0.82), [QZ[2], QZ[3], QZ[1]], tone(QZ[2], 0.9), QZ[4]);
  // purpur & end stone bricks
  const PUR = ramp('#a77ba7', 0.08);
  gens.purpur_block = (r) => { const img = newImg(); paletteNoise(img, r, PUR.slice(1, 4), { jitter: 0.6 }); const d = PUR[0], l = PUR[4]; for (let i = 0; i < S; i++) { set(img, i, 0, l); set(img, 0, i, l); set(img, i, 7, d); set(img, i, 8, l); set(img, 7, i, d); set(img, 8, i, l); set(img, i, 15, d); set(img, 15, i, d); } return img; };
  gens.purpur_pillar = (r) => { const img = newImg(); paletteNoise(img, r, PUR.slice(1, 4), { jitter: 0.6 }); for (let y = 0; y < S; y++) for (const x of [0, 5, 10, 15]) set(img, x, y, PUR[0]); return img; };
  gens.purpur_pillar_top = (r) => { const img = newImg(); paletteNoise(img, r, PUR.slice(1, 4), { jitter: 0.6 }); for (let i = 0; i < S; i++) for (const k of [0, 15]) { set(img, i, k, PUR[0]); set(img, k, i, PUR[0]); } for (let i = 4; i < 12; i++) for (const k of [4, 11]) { set(img, i, k, PUR[0]); set(img, k, i, PUR[0]); } return img; };
  gens.end_stone_bricks = stoneBricksLike(['#dadb9d', '#e0e2a5', '#e6e8ad', '#eef0b7'], '#b8ba80', '#f4f6c4');
  // prismarine
  gens.prismarine = (r) => { const img = newImg(); paletteNoise(img, r, P('#5a9c8c', '#63a597', '#6aaea2', '#76b7a9', '#86c2b2', '#5d8f9a'), { jitter: 0.7, passes: 1 }); return img; };
  gens.prismarine_bricks = (r) => brickPattern(r, 2, G('#4e8a7c'), P('#64a99a', '#6bb2a3', '#75bdad'), G('#5a9c8c'), G('#8acbbb'));
  gens.dark_prismarine = (r) => { const img = newImg(); paletteNoise(img, r, P('#2f5a4a', '#355f50', '#3b6a59'), { jitter: 0.6 }); const l = G('#4c7f6b'), d = G('#22443a'); for (let i = 0; i < S; i++) { set(img, i, 0, l); set(img, 0, i, l); set(img, i, 15, d); set(img, 15, i, d); set(img, i, 7, d); set(img, i, 8, l); } for (let y = 1; y < 7; y++) { set(img, 7, y, d); } for (let y = 9; y < 15; y++) { set(img, 3, y, d); set(img, 11, y, d); } return img; };
  gens.sea_lantern = (r) => { const img = newImg(); paletteNoise(img, r, P('#a9c7bd', '#c3d8d0', '#d6e5e0', '#e8f2ee'), { jitter: 0.5 }); const f = G('#6f9a8f'); for (let i = 0; i < S; i++) { set(img, i, 0, f); set(img, 0, i, f); set(img, i, 15, f); set(img, 15, i, f); } for (let i = 3; i < 13; i++) { set(img, i, i, G('#f6fbf9')); set(img, 15 - i, i, G('#f6fbf9')); } return img; };
  // basalt and blackstone
  gens.basalt_side = (r) => { const img = newImg(); const p2 = P('#3f3f44', '#4a4a50', '#55555b', '#606066', '#6c6c72'); for (let x = 0; x < S; x++) { let c = p2[r.int(5)]; for (let y = 0; y < S; y++) { if (r.next() < 0.25) c = p2[r.int(5)]; set(img, x, y, c); } } for (const x of [0, 4, 9, 13]) for (let y = 0; y < S; y++) set(img, x, y, p2[0]); return img; };
  gens.basalt_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#4a4a50', '#55555b', '#606066', '#6c6c72'), { jitter: 0.6 }); const v = voronoi(r, 6); for (let i = 0; i < S * S; i++) if (v.edge[i] < 0.9) set(img, i % S, (i / S) | 0, G('#36363a')); return img; };
  gens.polished_basalt_side = (r) => { const img = newImg(); const p2 = P('#4e4e54', '#5a5a60', '#626268', '#6e6e74'); for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) set(img, x, y, p2[(x % 5 === 0 ? 0 : 1 + ((x * 3 + y + r.int(2)) % 3))]); return img; };
  gens.polished_basalt_top = (r) => { const img = smooth(ramp('#5e5e64', 0.08))(r); const d = G('#3e3e44'); for (let i = 3; i < 13; i++) { set(img, i, 3, d); set(img, i, 12, d); set(img, 3, i, d); set(img, 12, i, d); } return img; };
  const BLK = P('#1e1a20', '#24202a', '#2a252e', '#302a34', '#383140');
  gens.blackstone = (r) => { const img = newImg(); paletteNoise(img, r, BLK, { jitter: 0.6 }); for (let i = 0; i < 6; i++) set(img, r.int(S), r.int(S), G('#4a4252')); return img; };
  gens.blackstone_top = (r) => { const img = newImg(); paletteNoise(img, r, BLK, { jitter: 0.5, passes: 2 }); return img; };
  gens.gilded_blackstone = (r) => { const img = gens.blackstone(r); const gold = P('#b87f12', '#e5ad1c', '#fbd94c'); for (let i = 0; i < 7; i++) { const x = r.int(14), y = r.int(14); set(img, x, y, gold[1]); set(img, x + 1, y, gold[2]); set(img, x, y + 1, gold[0]); } return img; };
  gens.polished_blackstone = smooth([BLK[0], BLK[1], BLK[2], BLK[3], G('#433a48')]);
  gens.chiseled_polished_blackstone = chiseled(['#24202a', '#2a252e', '#302a34'], '#161318', '#433a48');
  gens.polished_blackstone_bricks = stoneBricksLike(['#24202a', '#2a252e', '#302a34', '#36303a'], '#141116', '#433a48');
  gens.cracked_polished_blackstone_bricks = (r) => { const img = gens.polished_blackstone_bricks(r); let x = 3 + r.int(8), y = 0; while (y < S) { set(img, x, y, G('#0c0a0e')); y++; x = Math.max(0, Math.min(15, x + r.int(3) - 1)); } return img; };

  paintNether(p);
  paintMisc(p);
  paintPaintings(gens);
}

// ================================================================ paintings and item frames
/** Each motif is a little seeded picture (landscape, figure, still life or pattern), cut into 16x16 cells. */
function paintPaintings(gens: Record<string, Gen>) {
  gens.item_frame = (r) => {
    const img = newImg();
    const wood = P('#8a6a3a', '#a8844c', '#6a4e28');
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const edge = x < 2 || y < 2 || x > 13 || y > 13;
      set(img, x, y, edge ? wood[(x + y + r.int(2)) % 3] : G('#c8a878'));
    }
    return img;
  };
  gens.painting_back = (r) => { const img = newImg(); paletteNoise(img, r, P('#7a5a3a', '#8a6a44', '#6a4a2c'), { jitter: 0.5 }); return img; };
  for (const [name, w, h] of PAINTINGS) {
    let big: Img | null = null;
    const W = w * 16, Hh = h * 16;
    const make = () => {
      if (big) return big;
      const r = new Random([...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 17));
      const img = new Uint8ClampedArray(W * Hh * 4);
      const put = (x: number, y: number, c: RGB) => { if (x < 0 || y < 0 || x >= W || y >= Hh) return; const i = (y * W + x) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255; };
      const style = name.includes('skull') || name === 'wither' || name === 'skeleton' ? 'dark' : w > h ? 'land' : h > w ? 'figure' : r.int(3) ? 'still' : 'pattern';
      const sky = [G('#5a8ac8'), G('#c86a3a'), G('#2a2a4a'), G('#8ac8d8')][r.int(4)], ground = [G('#4a7a2a'), G('#8a6a3a'), G('#2a4a6a')][r.int(3)];
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        let c: RGB;
        if (style === 'dark') c = mix(G('#1a1a1a'), G('#4a2a1a'), y / Hh);
        else if (style === 'pattern') c = ((x >> 2) + (y >> 2)) % 2 ? sky : ground;
        else c = y < Hh * 0.6 ? mix(tone(sky, 1.2), sky, y / Hh) : mix(ground, tone(ground, 0.7), (y - Hh * 0.6) / (Hh * 0.4));
        put(x, y, shade(c, 0.94 + r.next() * 0.12));
      }
      if (style === 'land') {
        const sx = r.int(W), sy = 2 + r.int(Math.max(1, Hh / 3));
        for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y < 10) put(sx + x, sy + y, G('#f8e080'));
        for (let k = 0; k < 3 + r.int(4); k++) { const hx0 = r.int(W - 6), hy = Math.floor(Hh * 0.6) - 4; for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) put(hx0 + x, hy + y, y < 2 && Math.abs(x - 2) > y ? sky : x === 2 && y > 2 ? G('#3a2a1a') : G('#c8b890')); }
      } else if (style === 'figure' || style === 'still') {
        const cx = W >> 1, cy = Math.floor(Hh * 0.45), body = [G('#8a2a2a'), G('#2a4a8a'), G('#3a6a2a')][r.int(3)];
        for (let y = -4; y <= 3; y++) for (let x = -3; x <= 3; x++) put(cx + x, cy + y - 5, G('#d8a888'));
        for (let y = 0; y < Hh * 0.45; y++) for (let x = -5 + (y >> 3); x <= 5 - (y >> 3); x++) put(cx + x, cy + y, body);
      } else if (style === 'dark') {
        const cx = W >> 1, cy = Hh >> 1, rad = Math.min(W, Hh) * 0.3;
        for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y * 1.2 < rad * rad) put(cx + x, cy + y, G('#e8e0d0'));
        for (const ex of [-rad * 0.4, rad * 0.4]) for (let y = -2; y <= 1; y++) for (let x = -2; x <= 1; x++) put(Math.round(cx + ex + x), Math.round(cy - rad * 0.1 + y), G('#1a1a1a'));
        if (name === 'burning_skull') for (let k = 0; k < 120; k++) put(r.int(W), r.int(Hh >> 1), G(r.bool() ? '#f8a020' : '#f8e040'));
      }
      // the wooden frame round the edge
      for (let x = 0; x < W; x++) { put(x, 0, G('#6a4a2a')); put(x, Hh - 1, G('#4a3018')); }
      for (let y = 0; y < Hh; y++) { put(0, y, G('#6a4a2a')); put(W - 1, y, G('#4a3018')); }
      big = img;
      return img;
    };
    for (let k = 0; k < w * h; k++) {
      const cx = k % w, cy = Math.floor(k / w);
      gens[`painting_${name}_${cx}_${cy}`] = () => {
        const src = make(), out = newImg();
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const i = ((cy * 16 + y) * W + cx * 16 + x) * 4;
          set(out, x, y, [src[i], src[i + 1], src[i + 2]]);
        }
        return out;
      };
    }
  }
}

// ================================================================ the Nether update
function paintNether(p: Painters) {
  const { gens, ore } = p;
  const nylium = (top: string[], spots: string): { top: Gen; side: Gen } => ({
    top: (r) => { const img = newImg(); paletteNoise(img, r, P(...top), { jitter: 0.6 }); for (let i = 0; i < 10; i++) set(img, r.int(S), r.int(S), hex(spots)); return img; },
    side: (r) => {
      const img = gens.netherrack(new Random(321));
      const t = P(...top);
      for (let x = 0; x < S; x++) { const d = 2 + r.int(3) + (x % 4 === 1 ? 1 : 0); for (let y = 0; y < d; y++) set(img, x, y, t[r.int(t.length)]); }
      return img;
    },
  });
  const cn = nylium(['#6b0f0f', '#8b1a1a', '#9b2323', '#a92b2b'], '#c83a3a');
  gens.crimson_nylium = cn.top; gens.crimson_nylium_side = cn.side;
  const wn = nylium(['#15584f', '#1a6b60', '#20786a', '#2b8b7a'], '#3eb39e');
  gens.warped_nylium = wn.top; gens.warped_nylium_side = wn.side;
  const roots = (a: string, b: string): Gen => () => { const img = newImg(); art(img, [
    '', '', '',
    '....a......b....',
    '....a...b..a....',
    '.....a..a.a.....',
    '..b..a..a.a..a..',
    '..a..ab.aa..a...',
    '...a.aa.a..a....',
    '...a..a.a.a..b..',
    '....a.aaa.a..a..',
    '....aa.aa.a.a...',
    '.....a.aaaa.a...',
    '.....aaaaaaa....',
    '......aaaaa.....',
    '.......aaa......',
  ], { a: G(a), b: G(b) }); return img; };
  gens.crimson_roots = roots('#8a1a1a', '#c83a3a');
  gens.warped_roots = roots('#167e73', '#2bb8a7');
  gens.nether_sprouts = () => { const img = newImg(); for (let k = 0; k < 7; k++) { const x = 1 + k * 2; const h = 3 + ((k * 5) % 4); for (let y = 15; y > 15 - h; y--) set(img, x + ((y + k) % 3 === 0 ? 1 : 0), y, k % 2 ? G('#1d8e81') : G('#2aa493')); } return img; };
  const vines = (main: string, light: string, up: boolean, tip: boolean): Gen => (r) => {
    const img = newImg();
    for (let y = 0; y < S; y++) {
      const x0 = 5 + Math.round(Math.sin((y + (up ? 3 : 0)) * 0.6) * 2);
      if (tip && (up ? y < 5 : y > 11)) continue;
      set(img, x0, y, hex(main)); set(img, x0 + 1, y, r.bool() ? hex(light) : hex(main));
      if (y % 4 === 1) { set(img, x0 + 3, y, hex(light)); set(img, x0 + 2, y, hex(main)); }
      if (y % 5 === 3) set(img, x0 - 2, y, hex(light));
    }
    return img;
  };
  gens.weeping_vines = vines('#8a1a1a', '#c83a3a', false, true);
  gens.weeping_vines_plant = vines('#8a1a1a', '#c83a3a', false, false);
  gens.twisting_vines = vines('#167e73', '#2bb8a7', true, true);
  gens.twisting_vines_plant = vines('#167e73', '#2bb8a7', true, false);
  gens.shroomlight = (r) => { const img = newImg(); paletteNoise(img, r, P('#e56a1f', '#f08a2a', '#f6a43a', '#fbc35a', '#ffdf8a'), { jitter: 0.6 }); return img; };
  gens.soul_soil = (r) => { const img = newImg(); paletteNoise(img, r, P('#3e2c22', '#4a3428', '#523a2d', '#5c4232'), { jitter: 0.6 }); for (let i = 0; i < 6; i++) { const x = r.int(14), y = r.int(14); set(img, x, y, G('#2a1d16')); set(img, x + 1, y, G('#2a1d16')); } return img; };
  gens.soul_fire = () => soulFireFrame(0);
  gens.soul_torch = () => { const img = newImg(); art(img, [
    '', '', '', '', '', '', '',
    '.......cc.......',
    '.......CC.......',
    '.......tt.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
    '.......tT.......',
  ], { c: G('#bff6ff'), C: G('#5ee0f0'), t: G('#7a5c34'), T: G('#5a4224') }); return img; };
  const lantern = (glow: string, glow2: string): Gen => () => { const img = newImg(); art(img, [
    '......kk........',
    '......k.k.......',
    '......kk........',
    '.....dddddd.....',
    '....dllllllde...',
    '....dgGgGgGd....',
    '....dGgGgGgd....',
    '....dgGgGgGd....',
    '....dGgGgGgd....',
    '....dgGgGgGd....',
    '....ddddddd.....',
  ], { k: G('#4a4a52'), d: G('#3a3a42'), l: G('#5a5a62'), e: G('#2a2a30'), g: G(glow), G: G(glow2) }); return img; };
  gens.lantern = lantern('#f7c45a', '#fde29a');
  gens.soul_lantern = lantern('#5ed7e8', '#b8f4fb');
  gens.lantern_item = gens.lantern;
  gens.soul_lantern_item = gens.soul_lantern;
  gens.campfire_log = (r) => { const img = newImg(); const bark = P('#4f3a1f', '#5f4a2b', '#6b5231'); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y % 4 === 0 ? G('#3a2a14') : bark[r.int(3)]); for (let x = 2; x < S; x += 5) for (let y = 1; y < 4; y++) set(img, x, y, G('#c87a2a')); return img; };
  gens.campfire_fire = () => campfireFlame(false);
  gens.soul_campfire_fire = () => campfireFlame(true);
  gens.chain = () => { const img = newImg(); for (let y = 0; y < S; y++) { const link = Math.floor(y / 4) % 2; if (link) { set(img, 7, y, G('#3a3e4a')); set(img, 8, y, G('#2a2e38')); } else if (y % 4 === 0 || y % 4 === 3) { set(img, 6, y, G('#4a4e5c')); set(img, 7, y, G('#5a5e6c')); set(img, 8, y, G('#3a3e4a')); set(img, 9, y, G('#2a2e38')); } else { set(img, 6, y, G('#4a4e5c')); set(img, 9, y, G('#2a2e38')); } } return img; };
  gens.chain_item = gens.chain;
  gens.crying_obsidian = (r) => { const img = gens.obsidian(r); for (let i = 0; i < 7; i++) { const x = r.int(S), y = r.int(14); set(img, x, y, G('#8a2be2')); set(img, x, y + 1, G('#c45ef0')); if (r.bool()) set(img, x, y + 2, G('#6a1fb0')); } return img; };
  for (let c = 0; c < 5; c++) gens['respawn_anchor_side' + c] = (r) => {
    const img = gens.obsidian(new Random(77));
    const glow = c ? G('#f8a03a') : G('#2a1f36');
    for (let x = 0; x < S; x++) { set(img, x, 0, G('#1a1424')); set(img, x, 15, G('#1a1424')); }
    for (let k = 0; k < 4; k++) set(img, 3 + k * 3, 13, k < c ? glow : G('#2a1f36'));
    for (let i = 0; i < 5; i++) { const x = r.int(S), y = 2 + r.int(10); set(img, x, y, c ? G('#8a2be2') : G('#3b2754')); }
    return img;
  };
  gens.respawn_anchor_top_off = (r) => { const img = gens.crying_obsidian(r); for (let i = 3; i < 13; i++) for (let j = 3; j < 13; j++) set(img, i, j, G('#2a1f36')); return img; };
  gens.respawn_anchor_top = (r) => { const img = gens.crying_obsidian(r); for (let i = 3; i < 13; i++) for (let j = 3; j < 13; j++) set(img, i, j, (i + j) % 3 ? G('#f8a03a') : G('#ffd27a')); return img; };
  gens.respawn_anchor_bottom = gens.obsidian;
  gens.lodestone_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#7a7a80', '#86868c', '#929298', '#9e9ea4'), { jitter: 0.5 }); const d = G('#56565c'); for (let i = 0; i < S; i++) { set(img, i, 0, d); set(img, i, 15, d); set(img, i, 4, d); set(img, i, 11, d); } for (let y = 5; y < 11; y++) { set(img, 0, y, d); set(img, 15, y, d); } return img; };
  gens.lodestone_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#7a7a80', '#86868c', '#929298'), { jitter: 0.5 }); const d = G('#56565c'); for (let i = 2; i < 14; i++) { set(img, i, 2, d); set(img, i, 13, d); set(img, 2, i, d); set(img, 13, i, d); } for (let i = 5; i < 11; i++) for (let j = 5; j < 11; j++) set(img, i, j, G('#4a4a50')); return img; };
  gens.ancient_debris_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#4a3830', '#5a4438', '#644c40', '#6e5446'), { jitter: 0.6 }); for (let i = 0; i < 12; i++) { const x = r.int(S), y = r.int(S); set(img, x, y, G('#8a6e5e')); } for (let y = 0; y < S; y += 5) for (let x = 0; x < S; x++) if (r.next() < 0.6) set(img, x, y, G('#3a2a24')); return img; };
  gens.ancient_debris_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#4a3830', '#5a4438', '#644c40'), { jitter: 0.6 }); for (let k = 0; k < 4; k++) { const cx = 2 + r.int(12), cy = 2 + r.int(12); for (let a = 0; a < 6; a++) set(img, cx + Math.round(Math.cos(a) * 2), cy + Math.round(Math.sin(a) * 2), G('#8a6e5e')); } return img; };
  gens.netherite_block = (r) => { const img = newImg(); paletteNoise(img, r, P('#3a3436', '#423c3e', '#4a4446', '#524c4e'), { jitter: 0.3, passes: 2 }); const l = G('#5c5658'), d = G('#2a2426'); for (let i = 0; i < S; i++) { set(img, i, 0, l); set(img, 0, i, l); set(img, i, 15, d); set(img, 15, i, d); } for (let i = 3; i < 13; i += 3) for (let j = 1; j < 15; j++) set(img, j, i, j % 4 ? d : l); return img; };
  gens.nether_gold_ore = (r) => { const img = gens.netherrack(new Random(888)); const gold = P('#b87f12', '#e5ad1c', '#fbd94c'); for (let i = 0; i < 9; i++) { const x = 1 + r.int(14), y = 1 + r.int(14); set(img, x, y, gold[1]); if (r.bool()) set(img, x + 1, y, gold[2]); else set(img, x, y + 1, gold[0]); } return img; };
  void ore;
  gens.target_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#d8c8a0', '#e2d2aa', '#e8d8b0'), { jitter: 0.5 }); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); if (d < 2) set(img, x, y, G('#d43a2a')); else if (d > 3.5 && d < 5.5) set(img, x, y, G('#d43a2a')); } return img; };
  gens.target_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#d8c8a0', '#e2d2aa', '#e8d8b0'), { jitter: 0.5 }); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 2) set(img, x, y, G('#d43a2a')); else if (d > 4 && d < 6) set(img, x, y, G('#d43a2a')); } return img; };
}

export function soulFireFrame(frame: number): Img {
  const img = newImg();
  const r = new Random(2112 + frame * 31);
  const f = blobField(new Random(55 + frame), 1);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const h = (S - y) / S; // 0 at bottom
      const v = f[((y + frame) % S) * S + x] * 0.8 + r.next() * 0.2;
      if (v < h * 1.25) continue;
      const t = Math.min(1, (v - h) * 1.8);
      set(img, x, y, mix(hex('#1aa6b8'), hex('#bdfaff'), t), 255);
    }
  return img;
}
function campfireFlame(soul: boolean): Img {
  const img = newImg();
  const r = new Random(soul ? 9 : 8);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const h = Math.abs(x - 7.5) / 8 + (S - y) / S;
      if (h + r.next() * 0.3 > 1.15) continue;
      const t = y / S;
      set(img, x, y, soul ? mix(hex('#bdfaff'), hex('#1aa6b8'), t) : mix(hex('#fff2a0'), hex('#e0501a'), t));
    }
  return img;
}

// ================================================================ everything else
function paintMisc(p: Painters) {
  const { gens, metalBlock, cropStages, leavesGen } = p;
  void leavesGen;
  gens.mycelium_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#5f5263', '#6e5f72', '#7a6b7e', '#8a7a8c'), { jitter: 0.7 }); return img; };
  gens.mycelium_side = (r) => { const img = gens.dirt(new Random(12345)); const t = P('#6e5f72', '#7a6b7e', '#8a7a8c'); for (let x = 0; x < S; x++) { const d = 2 + r.int(3); for (let y = 0; y < d; y++) set(img, x, y, t[r.int(3)]); } return img; };
  gens.grass_path_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#8a6c3a', '#957642', '#a0824c', '#a88a52'), { jitter: 0.7 }); return img; };
  gens.grass_path_side = (r) => { const img = gens.dirt(new Random(12345)); const t = P('#8a6c3a', '#957642', '#a0824c'); for (let x = 0; x < S; x++) { const d = 1 + r.int(2); for (let y = 0; y < d; y++) set(img, x, y, t[r.int(3)]); } return img; };
  gens.packed_ice = (r) => { const img = newImg(); paletteNoise(img, r, P('#7aa0e8', '#88acec', '#94b6f0', '#a2c2f4'), { jitter: 0.5 }); for (let k = 0; k < 4; k++) { let x = r.int(S), y = r.int(S); for (let j = 0; j < 7; j++) { set(img, x, y, G('#c4d8fa')); x = (x + 1) % S; y = (y + (r.bool() ? 1 : 0)) % S; } } return img; };
  gens.blue_ice = (r) => { const img = newImg(); paletteNoise(img, r, P('#5a8af0', '#6896f2', '#74a0f4', '#82acf6'), { jitter: 0.5 }); for (let k = 0; k < 5; k++) { let x = r.int(S), y = r.int(S); for (let j = 0; j < 6; j++) { set(img, x, y, G('#b4d0fa')); x = (x + 1) % S; y = (y + (r.bool() ? 1 : 0)) % S; } } return img; };
  for (let i = 0; i < 4; i++) gens['frosted_ice_' + i] = (r) => { const img = gens.ice(r); for (let k = 0; k < i * 4; k++) { const x = r.int(S), y = r.int(S); set(img, x, y, G('#ffffff'), 220); } return img; };
  const mushroomBlock = (base: string[], spots: string | null): Gen => (r) => { const img = newImg(); paletteNoise(img, r, P(...base), { jitter: 0.5 }); if (spots) for (let i = 0; i < 6; i++) { const x = r.int(13), y = r.int(13); for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) if (dx + dy !== 0 && dx + dy !== 4) set(img, x + dx, y + dy, hex(spots)); } return img; };
  gens.brown_mushroom_block = mushroomBlock(['#8a6448', '#957052', '#a07a5a'], null);
  gens.red_mushroom_block = mushroomBlock(['#b01e1e', '#c42828', '#d03030'], '#e8e0d0');
  gens.mushroom_stem = mushroomBlock(['#c8c0b0', '#d4ccbc', '#ddd5c6'], null);
  gens.mushroom_block_inside = mushroomBlock(['#c8a888', '#d4b494', '#ddbe9e'], null);
  gens.vine = (r) => { const img = newImg(); const pal = P('#5a5a5a', '#727272', '#8a8a8a', '#a0a0a0'); for (let k = 0; k < 4; k++) { let x = 1 + k * 4; for (let y = 0; y < S; y++) { set(img, x, y, pal[r.int(2)]); if (r.next() < 0.4) { set(img, x + 1, y, pal[2 + r.int(2)]); set(img, x - 1, y, pal[1]); } if (r.next() < 0.3) x = Math.max(0, Math.min(15, x + (r.bool() ? 1 : -1))); } } return img; };
  // flowers
  const flower = (rows: string[], pal: Record<string, string>): Gen => () => { const img = newImg(); const pp: Record<string, RGB> = { g: G('#3f7a19'), G: G('#52942c'), d: G('#2d5a10') }; for (const [k, v] of Object.entries(pal)) pp[k] = G(v); art(img, rows, pp); return img; };
  const stemRows = ['.......g........', '.......g........', '...Gg..g........', '....Gg.g..gG....', '.....GggggG.....', '.......g........', '.......g........'];
  gens.blue_orchid = flower(['', '', '...bb...bb......', '..bBBb.bBBb.....', '...bBBbBBb......', '....bbYbb.......', '...bBBbBBb......', '..bBBb.bBBb.....', '...bb..gbb......', ...stemRows], { b: '#2a8cd8', B: '#46b4f0', Y: '#d8d040' });
  gens.azure_bluet = flower(['', '', '', '...w...w..w.....', '..wYw.wYwwYw....', '...w...wg.w.....', '..w.w..g.w.w....', '.wYw..wYw.wYw...', '..w....wg..w....', ...stemRows], { w: '#e8eef0', Y: '#d8c840' });
  const tulip = (c: string, c2: string): Gen => flower(['', '', '', '', '......t.t.......', '.....tTtTt......', '.....tTTTt......', '.....tTTTt......', '......tTt.......', ...stemRows], { t: c, T: c2 });
  gens.red_tulip = tulip('#a8141a', '#d82a2a');
  gens.orange_tulip = tulip('#c85a12', '#f08a2a');
  gens.white_tulip = tulip('#c8d0c8', '#f0f4f0');
  gens.pink_tulip = tulip('#d07090', '#f0a8c0');
  gens.lily_of_the_valley = flower(['', '', '', '....w.........', '...wWw..w.....', '....w..wWw....', '..w.g...w..w..', '.wWwg...g.wWw.', '..w..g.g...w..', ...stemRows], { w: '#e8eef0', W: '#ffffff' });
  gens.wither_rose = flower(['', '', '', '', '.....kkk........', '....kKkKk.......', '....kkKkk.......', '.....kkk........', '......k.........', '.......k........', '...kk..k........', '....kk.k..kk....', '......kkkk......', '.......k........', '.......k........'], { k: '#1a1a14', K: '#3a3a2a' });
  const dbl = (name: string, top: string[], tp: Record<string, string>, tint = false) => {
    gens[`${name}_bottom`] = () => { const img = newImg(); const st = tint ? G('#8a8a8a') : G('#3f7a19'), lf = tint ? G('#a8a8a8') : G('#52942c'); for (let y = 0; y < S; y++) { set(img, 7, y, st); set(img, 8, y, st); if (y % 4 === 2) { for (let k = 1; k < 4; k++) { set(img, 7 - k, y + (k >> 1), lf); set(img, 8 + k, y + 1 + (k >> 1), lf); } } } return img; };
    gens[`${name}_top`] = flower(top, tp);
  };
  dbl('sunflower', ['', '', '', '', '', '', '', '', '.......g........', '.......g........', '.......g........', '....G..g..G.....', '.....GGgGG......', '.......g........', '.......g........', '.......g........'], {});
  gens.sunflower_front = () => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 3.2) set(img, x, y, (x + y) % 2 ? G('#5a3a10') : G('#7a5018')); else if (d < 7.2) set(img, x, y, d > 6 && (x + y) % 2 ? G('#e8b820') : G('#f8d830')); } return img; };
  dbl('lilac', ['', '..p.P..p........', '.pPpPp.PpP......', '..pPpPpPp.p.....', '.PpPpPpPpPp.....', '..pPpPpPpPp.....', '...pPpPpPp......', '....pPgPp.......', '.....pgp........', '.......g........', '.......g........', '....G..g..G.....', '.....GGgGG......', '.......g........', '.......g........', '.......g........'], { p: '#b47ab4', P: '#d8a0d8' });
  dbl('rose_bush', ['', '', '..r.....r.......', '.rRr...rRr..r...', '..r.lll.r..rRr..', '...lLLLl.....r..', '..lLlrLLl.......', '..lLrRrLl..r....', '...lLrLl..rRr...', '....lLl....r....', '.....l.g........', '.......g........', '....G..g..G.....', '.....GGgGG......', '.......g........', '.......g........'], { r: '#a8141a', R: '#d82a2a', l: '#2d5a10', L: '#3f7a19' });
  dbl('peony', ['', '', '...ppp..........', '..pPPPp..ppp....', '..pPpPp.pPPPp...', '...ppp..pPpPp...', '....l....ppp....', '...lLl...l......', '..lLlLl.lLl.....', '...lLl.lLlLl....', '....l...lLl.....', '.......g........', '....G..g..G.....', '.....GGgGG......', '.......g........', '.......g........'], { p: '#d4a0c8', P: '#f0c8e4', l: '#2d5a10', L: '#3f7a19' });
  const tallGrassPart = (top: boolean): Gen => (r) => { const img = newImg(); const pal = P('#7c7c7c', '#8f8f8f', '#a3a3a3'); for (let k = 0; k < 6; k++) { let x = 1 + k * 3 + r.int(2); for (let y = 15; y >= (top ? 3 + r.int(6) : 0); y--) { set(img, x, y, pal[r.int(3)]); if (r.next() < 0.25) x = Math.max(0, Math.min(15, x + (r.bool() ? 1 : -1))); } } return img; };
  gens.tall_grass_bottom = tallGrassPart(false);
  gens.tall_grass_top = tallGrassPart(true);
  gens.large_fern_bottom = (r) => gens.fern(r);
  gens.large_fern_top = (r) => gens.fern(r);
  for (let st = 0; st < 3; st++) gens['cocoa_stage' + st] = () => { const img = newImg(); const w = 4 + st * 2, h = 5 + st * 2; const c = [G('#8a9a3a'), G('#b07a3a'), G('#9a5a2a')][st]; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(img, 8 - (w >> 1) + x, 4 + y, (x + y) % 3 ? c : tone(c, 0.8)); for (let y = 0; y < 4; y++) set(img, 8, y, G('#5a7a20')); return img; };
  cropStages('beetroots', 4, ['#3e8c1c', '#52a52a', '#8a1a2a'], '#8a1a2a');
  gens.melon_stem = gens.pumpkin_stem;
  for (let st = 0; st < 4; st++) gens['sweet_berry_bush_stage' + st] = (r) => { const img = newImg(); const leaf = P('#2a5a1a', '#3a7a28', '#2e6a20'); const h = 6 + st * 3; for (let k = 0; k < 9; k++) { const x = 1 + r.int(14), y = 16 - r.int(h); set(img, x, y, leaf[r.int(3)]); set(img, x + 1, y, leaf[r.int(3)]); set(img, x, y + 1, leaf[0]); } for (let y = 15; y > 15 - h; y -= 2) set(img, 7 + (y % 3), y, G('#4a3a1a')); if (st >= 2) for (let k = 0; k < st * 2; k++) set(img, 2 + r.int(12), 16 - h + r.int(h - 2), st === 3 ? G('#c81a2a') : G('#6aa83a')); return img; };
  gens.bamboo_stalk = (r) => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 6; x < 10; x++) set(img, x, y, y % 8 === 0 ? G('#5a8a1a') : x === 6 ? G('#6a9a2a') : x === 9 ? G('#4a7a14') : r.next() < 0.2 ? G('#8aba3a') : G('#7aaa2a')); return img; };
  gens.bamboo_top = (r) => { const img = newImg(); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, r.bool() ? G('#7aaa2a') : G('#6a9a2a')); return img; };
  gens.bamboo_item = () => { const img = newImg(); for (let y = 0; y < S; y++) { set(img, 8 - (y >> 3), y, y % 6 === 0 ? G('#4a7a14') : G('#7aaa2a')); set(img, 9 - (y >> 3), y, G('#5a8a1a')); } set(img, 11, 2, G('#3a7a18')); set(img, 12, 1, G('#4a8f23')); return img; };
  gens.bamboo_sapling = (r) => { const img = newImg(); for (let y = 9; y < S; y++) set(img, 8, y, G('#7aaa2a')); for (let k = 0; k < 6; k++) set(img, 5 + r.int(6), 8 + r.int(4), G('#4a8f23')); return img; };
  gens.unused_2 = () => clear(newImg());
  // ocean
  const kelp = (tip: boolean): Gen => (r) => { const img = newImg(); for (let y = 0; y < S; y++) { const x = 7 + Math.round(Math.sin(y * 0.5) * 1.5); if (tip && y < 4) continue; set(img, x, y, G('#4a7a1a')); set(img, x + 1, y, G('#3a6a14')); if (y % 3 === 0) { set(img, x + 2, y, G('#5a8a24')); set(img, x - 1, y + 1, G('#5a8a24')); } if (r.next() < 0.1) set(img, x + 3, y, G('#6a9a2a')); } return img; };
  gens.kelp = kelp(true); gens.kelp_plant = kelp(false);
  gens.kelp_item = () => { const img = newImg(); for (let y = 1; y < S; y++) { const x = 6 + Math.round(Math.sin(y * 0.6) * 2); set(img, x, y, G('#4a7a1a')); set(img, x + 1, y, G('#5a8a24')); } return img; };
  const seagrass = (top: boolean): Gen => (r) => { const img = newImg(); for (let k = 0; k < 6; k++) { let x = 1 + k * 3; for (let y = 15; y >= (top ? 4 + r.int(5) : 0); y--) { set(img, x, y, r.bool() ? G('#2a7a3a') : G('#3a8a4a')); if (r.next() < 0.3) x = Math.max(0, Math.min(15, x + (r.bool() ? 1 : -1))); } } return img; };
  gens.seagrass = seagrass(true);
  gens.tall_seagrass_bottom = seagrass(false); gens.tall_seagrass_top = seagrass(true);
  gens.sea_pickle = () => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, (x + y) % 4 ? G('#5a6a2a') : G('#6a7a34')); for (let x = 4; x < 12; x++) set(img, x, 0, G('#a8c86a')); return img; };
  gens.dried_kelp_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#2a3018', '#32381c', '#3a4020'), { jitter: 0.5 }); for (let y = 2; y < S; y += 4) for (let x = 0; x < S; x++) set(img, x, y, G('#1e2410')); return img; };
  gens.dried_kelp_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#2a3018', '#32381c', '#3a4020'), { jitter: 0.5 }); for (let i = 1; i < 7; i += 2) for (let a = 0; a < 24; a++) set(img, Math.round(7.5 + Math.cos(a / 3.8) * i), Math.round(7.5 + Math.sin(a / 3.8) * i), G('#1e2410')); return img; };
  gens.bubble_column = () => clear(newImg());
  gens.turtle_egg = (r) => { const img = newImg(); paletteNoise(img, r, P('#e4e0c8', '#ece8d4', '#f4f0e0'), { jitter: 0.5 }); for (let i = 0; i < 8; i++) set(img, r.int(S), r.int(S), G('#8aa86a')); return img; };
  gens.conduit = (r) => { const img = newImg(); paletteNoise(img, r, P('#8a6a4a', '#a0805a', '#b4946a'), { jitter: 0.5 }); for (let i = 4; i < 12; i++) for (let j = 4; j < 12; j++) set(img, i, j, (i + j) % 3 ? G('#3a6aa0') : G('#5a9ad0')); return img; };
  for (const k of CORAL_KINDS) {
    const col = { tube: '#3156d0', brain: '#d054a0', bubble: '#a020a8', fire: '#c82a2a', horn: '#d8c42a' }[k];
    const dead = '#8a8580';
    for (const [pre, c] of [['', col], ['dead_', dead]] as const) {
      gens[`${pre}${k}_coral_block`] = (r) => { const img = newImg(); paletteNoise(img, r, ramp(c, 0.12), { jitter: 0.7 }); for (let i = 0; i < 10; i++) set(img, r.int(S), r.int(S), tone(hex(c), 1.3)); return img; };
      gens[`${pre}${k}_coral`] = (r) => { const img = newImg(); const C = hex(c); for (let k2 = 0; k2 < 5; k2++) { let x = 3 + k2 * 2 + r.int(2); for (let y = 15; y > 4 + r.int(4); y--) { set(img, x, y, r.bool() ? C : tone(C, 0.8)); if (r.next() < 0.3) { x += r.bool() ? 1 : -1; set(img, x, y, tone(C, 1.2)); } } } return img; };
      gens[`${pre}${k}_coral_fan`] = (r) => { const img = newImg(); const C = hex(c); for (let a = -3; a <= 3; a++) { for (let d = 0; d < 7; d++) { const x = Math.round(7.5 + Math.sin(a * 0.35) * d), y = Math.round(15 - Math.cos(a * 0.35) * d); set(img, x, y, (d + a) % 2 ? C : tone(C, 0.8)); } } void r; return img; };
    }
  }
  // functional blocks
  gens.note_block = (r) => { const img = newImg(); paletteNoise(img, r, P('#5a3a22', '#6a4428', '#724a2c'), { jitter: 0.6 }); const d = G('#3a2414'); for (let i = 0; i < S; i++) { set(img, i, 0, d); set(img, 0, i, d); set(img, i, 15, d); set(img, 15, i, d); } art(img, ['....kk...', '....k.k..', '....k....', '..kkk....', '..kkk....'], { k: G('#1a1008') }, 4, 5); return img; };
  gens.jukebox_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#5a3a22', '#6a4428', '#724a2c'), { jitter: 0.6 }); const d = G('#3a2414'); for (let i = 0; i < S; i++) { set(img, i, 0, d); set(img, 0, i, d); set(img, i, 15, d); set(img, 15, i, d); set(img, i, 3, d); set(img, i, 12, d); } return img; };
  gens.jukebox_top = (r) => { const img = gens.jukebox_side(r); for (let x = 3; x < 13; x++) { set(img, x, 7, G('#1a1008')); set(img, x, 8, G('#2a1a10')); } return img; };
  gens.trapped_chest_front = (r) => { const img = gens.chest_front(r); set(img, 7, 6, G('#c83a2a')); set(img, 8, 6, G('#c83a2a')); return img; };
  gens.barrel_side = (r) => { const img = p.planks(['#4a3418', '#6a4c26', '#72522a', '#7c5a2e', '#86622f'])(r); for (let x = 0; x < S; x++) for (const y of [2, 13]) set(img, x, y, G('#3a3a3a')); for (let y = 0; y < S; y++) for (const x of [0, 4, 8, 12]) set(img, x, y, G('#4a3418')); return img; };
  gens.barrel_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#6a4c26', '#72522a', '#7c5a2e'), { jitter: 0.5 }); for (let i = 0; i < S; i++) { set(img, i, 0, G('#3a3a3a')); set(img, 0, i, G('#3a3a3a')); set(img, i, 15, G('#3a3a3a')); set(img, 15, i, G('#3a3a3a')); } for (let i = 4; i < 12; i++) { set(img, i, 4, G('#3a2a14')); set(img, i, 11, G('#3a2a14')); set(img, 4, i, G('#3a2a14')); set(img, 11, i, G('#3a2a14')); } return img; };
  gens.barrel_bottom = gens.barrel_top;
  const furnaceLike = (top: string[], front: (img: Img, lit: boolean) => void) => ({
    side: (r: Random) => { const img = newImg(); paletteNoise(img, r, P(...top), { jitter: 0.6 }); for (let i = 0; i < S; i++) { set(img, i, 0, hex(top[0])); set(img, i, 15, hex(top[0])); } return img; },
    front: (lit: boolean) => (r: Random) => { const img = newImg(); paletteNoise(img, r, P(...top), { jitter: 0.6 }); front(img, lit); return img; },
  });
  const smoker = furnaceLike(['#4a4a4a', '#555555', '#5f5f5f', '#6a6a6a'], (img, lit) => { for (let y = 8; y < 14; y++) for (let x = 3; x < 13; x++) set(img, x, y, lit ? ((x + y) % 2 ? G('#f0a030') : G('#c85010')) : G('#1a1a1a')); for (let x = 2; x < 14; x++) { set(img, x, 7, G('#3a2a1a')); set(img, x, 14, G('#3a2a1a')); } for (let y = 1; y < 6; y++) for (let x = 2; x < 14; x++) set(img, x, y, (x + y) % 3 ? G('#6a4a2a') : G('#5a3a1a')); });
  gens.smoker_side = smoker.side; gens.smoker_front = smoker.front(false); gens.smoker_front_on = smoker.front(true);
  gens.smoker_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#3a3a3a', '#454545', '#505050'), { jitter: 0.5 }); for (let i = 4; i < 12; i++) for (let j = 4; j < 12; j++) set(img, i, j, G('#1a1a1a')); return img; };
  gens.smoker_bottom = gens.smoker_top;
  const blast = furnaceLike(['#4a4a50', '#56565c', '#606066', '#6a6a70'], (img, lit) => { for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) set(img, x, y, lit ? ((x + y) % 2 ? G('#f0a030') : G('#ffe060')) : G('#1a1a1a')); for (let x = 2; x < 14; x++) set(img, x, 6, G('#8a8a90')); for (let y = 7; y < 14; y++) for (const x of [5, 8, 11]) set(img, x, y, G('#8a8a90')); });
  gens.blast_furnace_side = blast.side; gens.blast_furnace_front = blast.front(false); gens.blast_furnace_front_on = blast.front(true);
  gens.blast_furnace_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#56565c', '#606066', '#6a6a70'), { jitter: 0.5 }); for (let i = 3; i < 13; i++) { set(img, i, 3, G('#8a8a90')); set(img, i, 12, G('#8a8a90')); set(img, 3, i, G('#8a8a90')); set(img, 12, i, G('#8a8a90')); } return img; };
  const table = (topPal: string[], sideDeco: (img: Img, r: Random) => void, topDeco?: (img: Img, r: Random) => void) => ({
    top: (r: Random) => { const img = newImg(); paletteNoise(img, r, P(...topPal), { jitter: 0.5 }); for (let i = 0; i < S; i++) { set(img, i, 0, hex(topPal[0])); set(img, 0, i, hex(topPal[0])); set(img, i, 15, hex(topPal[0])); set(img, 15, i, hex(topPal[0])); } topDeco?.(img, r); return img; },
    side: (r: Random) => { const img = p.planks(['#4a3418', '#6a4c26', '#72522a', '#7c5a2e', '#86622f'])(r); for (let x = 0; x < S; x++) { set(img, x, 0, G('#3a2a14')); set(img, x, 1, G('#3a2a14')); } sideDeco(img, r); return img; },
  });
  const cart = table(['#5a4028', '#c8b890', '#d4c49c', '#e0d0a8'], (img) => { for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) set(img, x, y, (x + y) % 4 ? G('#d4c49c') : G('#8a7a5a')); }, (img) => { for (let k = 3; k < 13; k++) { set(img, k, 8, G('#4a6aa0')); set(img, 6, k, G('#3a8a3a')); } });
  gens.cartography_table_top = cart.top; gens.cartography_table_side1 = cart.side; gens.cartography_table_side3 = cart.side;
  const flet = table(['#8a7a4a', '#c8b878', '#d4c484'], (img) => { for (let y = 4; y < 14; y++) set(img, 8, y, G('#e8e8e8')); set(img, 7, 4, G('#ffffff')); set(img, 9, 4, G('#ffffff')); }, (img) => { for (let k = 2; k < 14; k++) set(img, k, k, G('#5a4028')); });
  gens.fletching_table_top = flet.top; gens.fletching_table_side = flet.side; gens.fletching_table_front = flet.side;
  const smith = table(['#2a2a30', '#3a3a40', '#44444a'], (img) => { for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) set(img, x, y, G('#4a4a52')); }, (img) => { for (let i = 0; i < S; i++) { set(img, i, 5, G('#5a5a62')); set(img, i, 10, G('#5a5a62')); } });
  gens.smithing_table_top = smith.top; gens.smithing_table_side = smith.side; gens.smithing_table_front = smith.side; gens.smithing_table_bottom = (r) => p.planks(['#4a3418', '#6a4c26', '#72522a', '#7c5a2e', '#86622f'])(r);
  const loom = table(['#8a7a5a', '#a8946a', '#b4a078'], (img) => { for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if (x % 2 === 0) set(img, x, y, G('#d8d8d8')); });
  gens.loom_top = loom.top; gens.loom_side = loom.side; gens.loom_front = loom.side; gens.loom_bottom = gens.loom_top;
  gens.stonecutter_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#6a6a6a', '#747474', '#7e7e7e'), { jitter: 0.5 }); for (let x = 2; x < 14; x++) set(img, x, 7, G('#c8c8c8')); for (let x = 2; x < 14; x++) set(img, x, 8, G('#8a8a8a')); return img; };
  gens.stonecutter_side = (r) => { const img = p.planks(['#4a3418', '#6a4c26', '#72522a', '#7c5a2e', '#86622f'])(r); for (let y = 0; y < 7; y++) for (let x = 0; x < S; x++) set(img, x, y, G('#7a7a7a')); return img; };
  gens.stonecutter_bottom = gens.stonecutter_top;
  gens.grindstone_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#7a7a7a', '#848484', '#8e8e8e'), { jitter: 0.5 }); return img; };
  gens.grindstone_round = (r) => { const img = gens.grindstone_side(r); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x - 7.5, y - 7.5) > 7.5) set(img, x, y, G('#5a5a5a')); return img; };
  gens.composter_side = (r) => { const img = p.planks(['#4a3418', '#6a4c26', '#72522a', '#7c5a2e', '#86622f'])(r); for (let x = 0; x < S; x++) for (const y of [0, 15]) set(img, x, y, G('#3a2a14')); for (let y = 0; y < S; y++) for (const x of [0, 15]) set(img, x, y, G('#3a2a14')); return img; };
  gens.composter_top = (r) => { const img = gens.composter_side(r); for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) set(img, x, y, [0, 0, 0], 0); return img; };
  gens.composter_bottom = gens.composter_side;
  gens.composter_compost = (r) => { const img = newImg(); paletteNoise(img, r, P('#4a3a1a', '#5a4a24', '#6a5a2e'), { jitter: 0.7 }); return img; };
  gens.composter_ready = (r) => { const img = gens.composter_compost(r); for (let i = 0; i < 10; i++) set(img, r.int(S), r.int(S), G('#e8e0c8')); return img; };
  gens.lectern_top = (r) => { const img = p.planks(['#4a3418', '#9f844d', '#a2824e', '#b8945f', '#c29d62'])(r); for (let i = 3; i < 13; i++) set(img, i, 2, G('#6b5130')); return img; };
  gens.lectern_sides = (r) => p.planks(['#4a3418', '#9f844d', '#a2824e', '#b8945f', '#c29d62'])(r);
  gens.lectern_front = (r) => { const img = gens.lectern_sides(r); for (let y = 2; y < 14; y++) for (let x = 5; x < 11; x++) set(img, x, y, G('#7a6040')); return img; };
  gens.lectern_base = gens.lectern_sides;
  gens.bell_body = (r) => { const img = newImg(); paletteNoise(img, r, P('#c89a2a', '#d8aa34', '#e8bc44', '#f4cc5a'), { jitter: 0.4 }); return img; };
  gens.cauldron_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#3a3a3a', '#444444', '#4e4e4e'), { jitter: 0.5 }); for (let y = 12; y < S; y++) for (let x = 4; x < 12; x++) set(img, x, y, [0, 0, 0], 0); for (let x = 0; x < S; x++) set(img, x, 0, G('#5a5a5a')); return img; };
  gens.cauldron_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#3a3a3a', '#444444', '#4e4e4e'), { jitter: 0.5 }); for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) set(img, x, y, [0, 0, 0], 0); return img; };
  gens.cauldron_inner = (r) => { const img = newImg(); paletteNoise(img, r, P('#2a2a2a', '#323232', '#3a3a3a'), { jitter: 0.5 }); return img; };
  gens.cauldron_bottom = gens.cauldron_inner;
  gens.flower_pot = (r) => { const img = newImg(); paletteNoise(img, r, P('#7a3a24', '#8a4428', '#984c2e'), { jitter: 0.5 }); return img; };
  gens.flower_pot_item = () => { const img = newImg(); for (let y = 9; y < 15; y++) for (let x = 5 - (y === 9 ? 1 : 0); x < 11 + (y === 9 ? 1 : 0); x++) set(img, x, y, y === 9 ? G('#a85a3a') : x === 5 ? G('#984c2e') : G('#7a3a24')); return img; };
  gens.beacon = (r) => { const img = newImg(); paletteNoise(img, r, P('#5ad8d0', '#7ee8e0', '#a8f4ee'), { jitter: 0.4 }); for (let i = 0; i < S; i++) { set(img, i, 0, G('#d8f8f4'), 200); set(img, 0, i, G('#d8f8f4'), 200); set(img, i, 15, G('#3aa8a0')); set(img, 15, i, G('#3aa8a0')); } return img; };
  gens.beacon_glass = (r) => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, x === 0 || y === 0 || x === 15 || y === 15 ? G('#d8f8f4') : G('#b8e8f0'), x === 0 || y === 0 || x === 15 || y === 15 ? 220 : 60); void r; return img; };
  gens.daylight_detector_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#7a8aa0', '#8a9ab0', '#9aaac0'), { jitter: 0.5 }); for (let i = 0; i < S; i += 4) for (let j = 0; j < S; j++) { set(img, i, j, G('#5a6070')); set(img, j, i, G('#5a6070')); } return img; };
  gens.daylight_detector_inverted_top = (r) => { const img = gens.daylight_detector_top(r); each(img, (_x, _y, c) => [c[0] * 0.5, c[1] * 0.55, c[2] * 0.7] as RGB); return img; };
  gens.daylight_detector_side = (r) => p.planks(['#4a3418', '#6a4c26', '#72522a', '#7c5a2e', '#86622f'])(r);
  gens.tripwire_hook = () => { const img = newImg(); art(img, ['', '', '', '......ooo.......', '......o.o.......', '......ooo.......', '.......w........', '.......w........', '.......w........', '.....wwwww......', '.....wwwww......', '.......w........', '.......w........', '.......w........'], { o: G('#a8a8a8'), w: G('#6b5130') }); return img; };
  gens.tripwire = () => { const img = newImg(); for (let x = 0; x < S; x++) set(img, x, 7, G('#c8c8c8'), 220); return img; };
  gens.honey_block_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#f0a020', '#f4b030', '#f8c040'), { jitter: 0.4 }); each(img, () => null, 210); for (let i = 0; i < S; i++) { set(img, i, 0, G('#d08010'), 230); set(img, 0, i, G('#d08010'), 230); set(img, i, 15, G('#d08010'), 230); set(img, 15, i, G('#d08010'), 230); } return img; };
  gens.honey_block_side = gens.honey_block_top; gens.honey_block_bottom = gens.honey_block_top;
  gens.honeycomb_block = (r) => { const img = newImg(); const v = voronoi(r, 5); for (let i = 0; i < S * S; i++) set(img, i % S, (i / S) | 0, v.edge[i] < 0.7 ? G('#c88010') : (v.cell[i] % 2 ? G('#f4b030') : G('#f8c444'))); return img; };
  gens.bee_nest_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#c8a030', '#d4ac3a', '#deb844'), { jitter: 0.5 }); for (let y = 3; y < S; y += 4) for (let x = 0; x < S; x++) set(img, x, y, G('#8a6a20')); return img; };
  gens.bee_nest_front = (r) => { const img = gens.bee_nest_side(r); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, G('#2a1a08')); return img; };
  gens.bee_nest_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#c8a030', '#d4ac3a', '#deb844'), { jitter: 0.5 }); for (let i = 3; i < 13; i++) for (let j = 3; j < 13; j++) if (Math.hypot(i - 7.5, j - 7.5) < 5 && (i + j) % 2) set(img, i, j, G('#8a6a20')); return img; };
  gens.bee_nest_bottom = gens.bee_nest_top;
  gens.beehive_side = (r) => { const img = p.planks(['#6b5130', '#9f844d', '#a2824e', '#b8945f', '#c29d62'])(r); for (let x = 0; x < S; x++) { set(img, x, 0, G('#d8b040')); set(img, x, 15, G('#d8b040')); } return img; };
  gens.beehive_front = (r) => { const img = gens.beehive_side(r); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, G('#2a1a08')); return img; };
  gens.bee_nest_front_honey = (r) => { const img = gens.bee_nest_front(r); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, G(y > 7 ? '#f0a020' : '#f8c840')); for (let y = 10; y < 13; y++) set(img, 7 + (y % 2), y, G('#f0a020')); return img; };
  gens.beehive_front_honey = (r) => { const img = gens.beehive_front(r); for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) set(img, x, y, G(y > 7 ? '#f0a020' : '#f8c840')); for (let y = 10; y < 13; y++) set(img, 7 + (y % 2), y, G('#f0a020')); return img; };
  gens.beehive_end = (r) => { const img = p.planks(['#6b5130', '#9f844d', '#a2824e', '#b8945f', '#c29d62'])(r); for (let i = 0; i < S; i++) { set(img, i, 0, G('#d8b040')); set(img, 0, i, G('#d8b040')); set(img, i, 15, G('#d8b040')); set(img, 15, i, G('#d8b040')); } return img; };
  gens.scaffolding_side = () => { const img = newImg(); const b = G('#c8a858'), d = G('#9a7a3a'); for (let i = 0; i < S; i++) { set(img, i, 0, b); set(img, i, 1, d); set(img, 0, i, b); set(img, 1, i, d); set(img, 14, i, b); set(img, 15, i, d); set(img, i, 14, b); set(img, i, 15, d); set(img, i, i, b); } return img; };
  gens.scaffolding_top = (r) => { const img = gens.scaffolding_side(r); for (let i = 2; i < 14; i++) for (let j = 2; j < 14; j++) set(img, i, j, (i + j) % 4 ? G('#c8a858') : G('#9a7a3a')); return img; };
  gens.scaffolding_bottom = gens.scaffolding_side;
  gens.cake_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#f0e8e0', '#f8f0e8', '#ffffff'), { jitter: 0.4 }); for (let k = 0; k < 6; k++) set(img, 2 + r.int(12), 2 + r.int(12), G('#d82a2a')); return img; };
  gens.cake_side = (r) => { const img = newImg(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(img, x, y, y < 8 ? (y < 3 + (x % 3 === 0 ? 1 : 0) ? G('#f8f0e8') : G('#e0c8a8')) : G('#b08a5a')); void r; return img; };
  gens.cake_bottom = (r) => { const img = newImg(); paletteNoise(img, r, P('#a07a4a', '#b08a5a', '#c09a6a'), { jitter: 0.4 }); return img; };
  gens.cake_inner = (r) => { const img = gens.cake_side(r); for (let y = 4; y < 8; y++) for (let x = 0; x < S; x++) set(img, x, y, G('#e8a8a8')); return img; };
  gens.emerald_block = metalBlock(['#0e6a2a', '#22b852', '#2ac85e', '#4ad87a', '#9cf0b8']);
  gens.bone_block_side = (r) => { const img = newImg(); paletteNoise(img, r, P('#d8d2b8', '#e0dac2', '#e8e2cc'), { jitter: 0.5 }); for (let y = 0; y < S; y++) for (const x of [1, 6, 11]) set(img, x, y, G('#c4bea4')); return img; };
  gens.bone_block_top = (r) => { const img = newImg(); paletteNoise(img, r, P('#d8d2b8', '#e0dac2', '#e8e2cc'), { jitter: 0.5 }); for (let i = 4; i < 12; i++) for (let j = 4; j < 12; j++) if (Math.hypot(i - 7.5, j - 7.5) < 3.5) set(img, i, j, G('#b8b29a')); return img; };
  gens.wet_sponge = (r) => { const img = gens.sponge(r); each(img, (_x, _y, c) => [c[0] * 0.8, c[1] * 0.85, c[2] * 0.6] as RGB); return img; };
  gens.end_rod = () => { const img = newImg(); for (let y = 0; y < S; y++) { set(img, 7, y, y < 2 || y > 13 ? G('#8a7a6a') : G('#f8f4f0')); set(img, 8, y, y < 2 || y > 13 ? G('#6a5a4a') : G('#e0dcd8')); } return img; };
  gens.chorus_plant = (r) => { const img = newImg(); paletteNoise(img, r, P('#5a3a5a', '#6a4a6a', '#7a5a7a', '#8a6a8a'), { jitter: 0.6 }); return img; };
  gens.chorus_flower = (r) => { const img = newImg(); paletteNoise(img, r, P('#a07aa0', '#b48ab4', '#c8a0c8', '#dcb8dc'), { jitter: 0.6 }); for (let i = 0; i < S; i++) { set(img, i, 0, G('#6a4a6a')); set(img, 0, i, G('#6a4a6a')); set(img, i, 15, G('#6a4a6a')); set(img, 15, i, G('#6a4a6a')); } return img; };
  gens.chorus_flower_dead = (r) => { const img = gens.chorus_flower(r); each(img, (_x, _y, c) => [c[0] * 0.6, c[1] * 0.5, c[2] * 0.4] as RGB); return img; };
  // heads (a face on the front; the item icon is the face)
  const head = (name: string, base: string[], face: (img: Img) => void) => {
    gens['skull_' + name] = (r) => { const img = newImg(); paletteNoise(img, r, P(...base), { jitter: 0.5 }); return img; };
    gens['skull_' + name + '_face'] = (r) => { const img = gens['skull_' + name](r); face(img); return img; };
    gens['skull_' + name + '_item'] = (r) => { const img = newImg(); const f = gens['skull_' + name + '_face'](r); blit(img, f, 3, 3, 10, 10); return img; };
  };
  head('skeleton', ['#c8c8c0', '#d0d0c8', '#d8d8d0'], (img) => art(img, ['', '', '', '', '', '', '...kk....kk.....', '...kk....kk.....', '', '.......k........', '', '....kkkkkk......', '....k.k.k.k.....'], { k: G('#3a3a38') }));
  head('wither', ['#2a2a2a', '#323232', '#3a3a3a'], (img) => art(img, ['', '', '', '', '', '', '...kk....kk.....', '...kk....kk.....', '', '.......k........', '', '....kkkkkk......'], { k: G('#0e0e0e') }));
  head('zombie', ['#4a8a3a', '#5a9a44', '#4e8e3e'], (img) => art(img, ['', '', '', '', '', '', '', '...kk....kk.....', '', '', '.....kkkk.......'], { k: G('#1a3a14') }));
  head('player', ['#c89a7a', '#d0a282', '#c4966e'], (img) => { for (let y = 0; y < 5; y++) for (let x = 0; x < S; x++) set(img, x, y, G('#3a2a1a')); art(img, ['', '', '', '', '', '', '', '...wb....bw.....', '', '', '.....kkkk.......'], { w: G('#ffffff'), b: G('#3a4aa0'), k: G('#8a5a4a') }); });
  head('creeper', ['#4ab43a', '#5ac44a', '#3aa42a'], (img) => art(img, ['', '', '', '', '...kkk..kkk.....', '...kkk..kkk.....', '......kk........', '.....kkkk.......', '.....kkkk.......', '.....k..k.......'], { k: G('#0a1a08') }));
  head('dragon', ['#1a1a1a', '#222222', '#2a2a2a'], (img) => art(img, ['', '', '', '', '', '', '...pp....pp.....', '', '', '..kkkkkkkkkk....'], { p: G('#c050f0'), k: G('#0a0a0a') }));
  // the creative inventory's spare names
  gens.unused_3 = () => clear(newImg());
  gens.soul_fire_0 = () => soulFireFrame(0);
  void copy;
}
