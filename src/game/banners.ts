// Banner patterns (1.8-1.16): the vanilla designs as masks over the 20 x 40 cloth, layered over the banner's own
// colour (at most six layers, made at a loom). Six of them need a banner pattern item in the loom.
import { DYE_RGB } from './items';

export interface BannerLayer { p: string; c: number }
type Mask = (x: number, y: number) => number;
const W = 20, H = 40;
const pixels = (rows: string[], ox: number, oy: number): Mask => (x, y) => (rows[y - oy]?.[x - ox] === '#' ? 1 : 0);

/** Pattern id -> [name, mask]. The masks follow vanilla's layouts (the cloth seen from the front). */
export const PATTERNS: Record<string, [string, Mask]> = {
  bs: ['Base Fess', (x, y) => +(y >= 27)],
  ts: ['Chief Fess', (x, y) => +(y < 13)],
  ls: ['Pale Dexter', (x) => +(x < 7)],
  rs: ['Pale Sinister', (x) => +(x >= 13)],
  cs: ['Pale', (x) => +(x >= 7 && x < 13)],
  ms: ['Fess', (x, y) => +(y >= 17 && y < 23)],
  drs: ['Bend', (x, y) => +(Math.abs(y / 2 - x) < 2.5)],
  dls: ['Bend Sinister', (x, y) => +(Math.abs(y / 2 - (W - 1 - x)) < 2.5)],
  ss: ['Paly', (x) => +(x % 4 < 2 && x > 0 && x < W - 1)],
  cr: ['Saltire', (x, y) => +(Math.abs(y / 2 - x) < 2 || Math.abs(y / 2 - (W - 1 - x)) < 2)],
  sc: ['Cross', (x, y) => +((x >= 8 && x < 12) || (y >= 18 && y < 22))],
  bt: ['Chevron', (x, y) => +(y >= H - 1 - Math.min(x, W - 1 - x) * 1.1 && y > 28)],
  tt: ['Inverted Chevron', (x, y) => +(y <= Math.min(x, W - 1 - x) * 1.1 && y < 11)],
  bts: ['Base Indented', (x, y) => +(y >= 36 - (x % 4 < 2 ? x % 4 : 3 - (x % 4)) * 2)],
  tts: ['Chief Indented', (x, y) => +(y <= 3 + (x % 4 < 2 ? x % 4 : 3 - (x % 4)) * 2)],
  ld: ['Per Bend Sinister', (x, y) => +(x + y / 2 < W - 1)],
  rud: ['Per Bend', (x, y) => +(x < y / 2)],
  lud: ['Per Bend Inverted', (x, y) => +(x > y / 2)],
  rd: ['Per Bend Sinister Inverted', (x, y) => +(x + y / 2 >= W - 1)],
  vh: ['Per Pale', (x) => +(x < 10)],
  vhr: ['Per Pale Inverted', (x) => +(x >= 10)],
  hh: ['Per Fess', (x, y) => +(y < 20)],
  hhb: ['Per Fess Inverted', (x, y) => +(y >= 20)],
  bl: ['Base Dexter Canton', (x, y) => +(x < 7 && y >= 27)],
  br: ['Base Sinister Canton', (x, y) => +(x >= 13 && y >= 27)],
  tl: ['Chief Dexter Canton', (x, y) => +(x < 7 && y < 13)],
  tr: ['Chief Sinister Canton', (x, y) => +(x >= 13 && y < 13)],
  mc: ['Roundel', (x, y) => +(Math.hypot(x - 9.5, (y - 19.5) / 1.2) < 5)],
  mr: ['Lozenge', (x, y) => +(Math.abs(x - 9.5) / 6 + Math.abs(y - 19.5) / 11 < 1)],
  bo: ['Bordure', (x, y) => +(x < 1 || x >= W - 1 || y < 1 || y >= H - 1)],
  cbo: ['Bordure Indented', (x, y) => +(x < 2 - ((y >> 1) & 1) || x >= W - 2 + ((y >> 1) & 1) || y < 2 - ((x >> 1) & 1) || y >= H - 2 + ((x >> 1) & 1))],
  bri: ['Field Masoned', (x, y) => +(y % 4 === 0 || ((x + (((y >> 2) & 1) ? 2 : 0)) % 4 === 0))],
  gra: ['Gradient', (x, y) => Math.max(0, 1 - y / (H * 0.9))],
  gru: ['Base Gradient', (x, y) => Math.max(0, (y - H * 0.1) / (H * 0.9))],
  cre: ['Creeper Charge', pixels(['##....##', '##....##', '...##...', '..####..', '..####..', '..#..#..'], 6, 13)],
  sku: ['Skull Charge', pixels(['.######.', '########', '#..##..#', '#..##..#', '########', '.######.', '..#..#..', '##....##', '.#.##.#.', '##....##'], 6, 11)],
  flo: ['Flower Charge', pixels(['...##...', '..#..#..', '.#.##.#.', '#.####.#', '#.####.#', '.#.##.#.', '..#..#..', '...##...'], 6, 15)],
  moj: ['Thing', pixels(['..####..', '.#....#.', '#..##..#', '#.####.#', '#.#..#.#', '#.####.#', '.#....#.', '..####..'], 6, 14)],
  glb: ['Globe', pixels(['..####..', '.##.###.', '#.####.#', '##..####', '###..###', '#.###..#', '.#####..', '..####..'], 6, 15)],
  pig: ['Snout', pixels(['.######.', '#......#', '#.#..#.#', '#.#..#.#', '#......#', '.######.'], 6, 16)],
};
/** Patterns that need a banner pattern item in the loom (and which item). */
export const PATTERN_ITEMS: Record<string, string> = { cre: 'creeper_banner_pattern', sku: 'skull_banner_pattern', flo: 'flower_banner_pattern', moj: 'mojang_banner_pattern', glb: 'globe_banner_pattern', pig: 'piglin_banner_pattern' };
/** The patterns a loom offers with just a banner and a dye. */
export const PLAIN_PATTERNS = Object.keys(PATTERNS).filter((k) => !PATTERN_ITEMS[k]);

/** The cloth as RGBA (20 x 40): the banner's colour, then each layer's colour through its mask. */
export function bannerPixels(base: number, layers: BannerLayer[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  const rgb = (c: number) => [(DYE_RGB[c] >> 16) & 255, (DYE_RGB[c] >> 8) & 255, DYE_RGB[c] & 255];
  const b = rgb(base);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let [r, g, bl] = b;
    for (const l of layers) {
      const m = PATTERNS[l.p]?.[1](x, y) ?? 0;
      if (m <= 0) continue;
      const c = rgb(l.c);
      r += (c[0] - r) * m; g += (c[1] - g) * m; bl += (c[2] - bl) * m;
    }
    // a little cloth texture: the weave darkens every other row slightly
    const k = (x + y) % 2 ? 0.94 : 1;
    const i = (y * W + x) * 4;
    out[i] = r * k; out[i + 1] = g * k; out[i + 2] = bl * k; out[i + 3] = 255;
  }
  return out;
}
export const BANNER_W = W, BANNER_H = H;
