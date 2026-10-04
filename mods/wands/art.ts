// Pixel art, all painted in code: a card for every spell (a frame in its type's colour around a little picture),
// the wands, the light sprites spells are drawn with, the target dummy, and the sounds.
import type { ModContext, Img } from '../sdk';
import { SPELLS, TYPE_COLORS, type SpellDef, type Icon } from './spells';

type RGB = [number, number, number];
const hex = (h: string): RGB => { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const W: RGB = [255, 255, 255], K: RGB = [0, 0, 0];

/** A 16x16 canvas with drawing helpers. */
class Pix {
  img: Img;
  constructor(public px: ModContext['mc']['pixels']) { this.img = px.newImg(); }
  set(x: number, y: number, c: RGB, a = 255) { if (x >= 0 && y >= 0 && x < 16 && y < 16) this.px.set(this.img, Math.round(x), Math.round(y), c, a); }
  rect(x: number, y: number, w: number, h: number, c: RGB) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  disc(cx: number, cy: number, r: number, c: RGB) {
    for (let y = -r - 1; y <= r + 1; y++) for (let x = -r - 1; x <= r + 1; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c);
  }
  ring(cx: number, cy: number, r: number, c: RGB) {
    for (let a = 0; a < 64; a++) this.set(cx + Math.cos((a / 64) * Math.PI * 2) * r, cy + Math.sin((a / 64) * Math.PI * 2) * r, c);
  }
  /** A ball: dark rim, colour, highlight. */
  ball(cx: number, cy: number, r: number, c: RGB) {
    this.disc(cx, cy, r, mix(c, K, 0.45));
    this.disc(cx, cy, Math.max(0, r - 1), c);
    this.set(cx - Math.ceil(r / 2), cy - Math.ceil(r / 2), mix(c, W, 0.75));
  }
  /** Characters from a tiny font (3x5 digits, a few letters and signs). */
  text(s: string, x: number, y: number, c: RGB) {
    for (const ch of s) {
      const rows = FONT[ch];
      if (!rows) { x += 2; continue; }
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') this.set(x + i, y + j, c); });
      x += rows[0].length + 1;
    }
  }
}

const FONT: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'], '1': ['.#', '##', '.#', '.#', '.#'], '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'], '4': ['#.#', '#.#', '###', '..#', '..#'], '8': ['###', '#.#', '###', '#.#', '###'],
  '?': ['###', '..#', '.##', '...', '.#.'], '+': ['...', '.#.', '###', '.#.', '...'], '-': ['...', '...', '###', '...', '...'],
  '!': ['#', '#', '#', '.', '#'],
};

/** The little pictures, by glyph name. `c` is the spell's colour, `l` lighter, `d` darker. */
type Painter = (p: Pix, c: RGB, l: RGB, d: RGB, icon: Icon) => void;
const G: Record<string, Painter> = {
  spark: (p, c, l) => { p.line(3, 12, 8, 7, mix(c, K, 0.3)); p.line(8, 7, 11, 4, c); p.set(11, 4, W); p.set(10, 4, l); p.set(12, 4, l); p.set(11, 3, l); p.set(11, 5, l); p.set(5, 9, l); p.set(7, 11, c); },
  arrow: (p, c, l) => { p.line(3, 12, 11, 4, c); p.line(11, 4, 7, 4, l); p.line(11, 4, 11, 8, l); p.set(12, 3, W); p.set(4, 11, l); },
  bolt: (p, c, l) => { p.line(3, 12, 7, 8, mix(c, K, 0.35)); p.ball(10, 6, 3, c); p.set(9, 5, W); p.set(10, 5, l); },
  burst: (p, c, l) => { p.ball(10, 5, 2, c); for (let i = 0; i < 4; i++) p.set(3 + i * 2, 12 - ((i % 2) * 3), l); p.set(10, 4, W); },
  orb: (p, c, l) => { p.ball(8, 8, 5, c); p.disc(8, 8, 2, l); p.set(6, 6, W); p.set(7, 6, W); },
  spit: (p, c, l) => { p.disc(5, 11, 1, c); p.disc(9, 7, 1, c); p.disc(12, 4, 1, l); p.set(12, 4, W); },
  wood: (p) => { const s = hex('#c89858'), d = hex('#6a4a28'); p.line(3, 12, 11, 4, s); p.line(4, 12, 11, 5, d); p.line(11, 4, 9, 4, hex('#d8d8d8')); p.line(11, 4, 11, 6, hex('#d8d8d8')); p.set(3, 11, W); p.set(2, 12, W); p.set(3, 13, W); },
  fireball: (p, c, l) => { p.line(2, 13, 6, 9, hex('#ffd040')); p.line(3, 13, 7, 9, c); p.ball(9, 7, 4, c); p.disc(9, 7, 2, hex('#ffd040')); p.set(9, 6, W); void l; },
  firebolt: (p, c) => { p.line(3, 12, 10, 5, c); p.line(4, 12, 10, 6, hex('#ffb030')); p.disc(11, 4, 1, hex('#ffe060')); p.set(11, 4, W); },
  meteor: (p, c) => { p.line(2, 2, 7, 7, hex('#ffd040')); p.line(3, 2, 8, 7, c); p.line(2, 3, 7, 8, c); p.ball(10, 10, 3, hex('#7a5a4a')); p.set(9, 9, hex('#ffb060')); },
  bomb: (p) => { p.ball(8, 9, 4, hex('#3a3a44')); p.set(6, 7, hex('#8a8a9a')); p.line(10, 5, 12, 3, hex('#c8a060')); p.set(13, 2, hex('#ffd040')); p.set(12, 2, hex('#ff8020')); },
  dynamite: (p) => { const r = hex('#d02020'), d = hex('#801010'); p.rect(4, 6, 8, 5, r); p.rect(4, 10, 8, 1, d); p.rect(6, 6, 1, 5, hex('#f0e0c0')); p.rect(9, 6, 1, 5, hex('#f0e0c0')); p.line(11, 6, 13, 3, hex('#c8a060')); p.set(13, 2, hex('#ffd040')); },
  holy: (p) => { p.ball(8, 9, 4, hex('#e8c860')); p.line(8, 7, 8, 11, W); p.line(6, 8, 10, 8, W); p.ring(8, 9, 6, hex('#fff0a0')); p.set(8, 2, hex('#ffffc0')); },
  hole: (p, c) => { p.ring(8, 8, 5, c); p.ring(8, 8, 4, mix(c, K, 0.5)); p.disc(8, 8, 3, K); p.set(11, 4, mix(c, W, 0.5)); p.set(4, 11, mix(c, W, 0.5)); },
  dig: (p, c, l, d) => { p.line(3, 12, 10, 5, c); p.line(10, 5, 12, 3, l); p.rect(11, 9, 2, 2, d); p.rect(12, 12, 2, 1, d); p.set(9, 11, d); },
  digblast: (p, c, l, d) => { p.disc(8, 8, 3, d); p.disc(8, 8, 1, l); for (let a = 0; a < 8; a++) p.set(8 + Math.cos(a * 0.785) * 5.5, 8 + Math.sin(a * 0.785) * 5.5, c); },
  saw: (p, c, l) => { p.disc(8, 8, 4, hex('#9aa0a8')); p.disc(8, 8, 1, hex('#404448')); for (let a = 0; a < 8; a++) p.set(8 + Math.cos(a * 0.785) * 5.5, 8 + Math.sin(a * 0.785) * 5.5, l); void c; },
  drill: (p, c, l) => { for (let i = 0; i < 8; i++) p.line(3 + i, 12 - i + (i % 2), 3 + i, 12 - i, i > 5 ? W : c); p.line(4, 12, 12, 4, l); },
  lightning: (p, c, l) => { p.line(10, 2, 6, 8, c); p.line(6, 8, 10, 8, c); p.line(10, 8, 5, 14, c); p.line(11, 2, 7, 8, l); p.set(5, 14, W); },
  lance: (p, c, l) => { p.line(2, 13, 13, 2, c); p.line(3, 13, 13, 3, mix(c, K, 0.3)); p.line(9, 6, 13, 2, l); p.set(13, 2, W); },
  bubble: (p, c, l) => { p.ring(9, 7, 4, c); p.set(7, 5, W); p.ring(5, 12, 1.6, l); },
  heal: (p, c, l) => { p.rect(7, 3, 3, 10, c); p.rect(3, 7, 11, 3, c); p.rect(8, 4, 1, 8, l); p.rect(4, 8, 9, 1, l); },
  tp: (p, c, l) => { for (let i = 0; i < 40; i++) { const a = i * 0.4, r = i * 0.13; p.set(8 + Math.cos(a) * r, 8 + Math.sin(a) * r, i > 30 ? l : c); } p.set(8, 8, W); },
  cross: (p, c, l) => { p.line(3, 3, 12, 12, c); p.line(12, 3, 3, 12, c); p.line(4, 3, 12, 11, l); p.set(8, 8, W); },
  tentacle: (p, c, l) => { for (let x = 2; x < 13; x++) p.set(x, 9 + Math.round(Math.sin(x * 0.9) * 2), c); p.disc(13, 9, 1, l); },
  rock: (p) => { p.disc(8, 9, 4, hex('#6a6a6a')); p.disc(7, 8, 3, hex('#8a8a8a')); p.set(6, 7, hex('#b0b0b0')); p.set(10, 11, hex('#505050')); },
  explosion: (p, c, l) => { for (let a = 0; a < 12; a++) { const r = a % 2 ? 6 : 4; p.line(8, 8, 8 + Math.cos(a * 0.5236) * r, 8 + Math.sin(a * 0.5236) * r, a % 2 ? c : l); } p.disc(8, 8, 2, hex('#fff0a0')); },
  circle: (p, c, l) => { p.ring(8, 8, 5.5, c); p.ring(8, 8, 4.5, mix(c, K, 0.4)); p.set(8, 8, l); p.set(5, 5, l); p.set(11, 10, l); },
  cloud: (p, c, _l, _d, icon) => { const cc = hex(icon.c); p.disc(6, 6, 2, cc); p.disc(9, 5, 3, cc); p.disc(11, 7, 2, cc); p.rect(4, 7, 9, 2, cc); if (icon.c2) { p.line(9, 9, 7, 12, hex(icon.c2)); p.line(7, 12, 9, 12, hex(icon.c2)); p.line(9, 12, 7, 15, hex(icon.c2)); } else for (const x of [5, 8, 11]) { p.set(x, 11, hex('#6080ff')); p.set(x - 1, 13, hex('#6080ff')); } void c; },
  sea: (p, c, l) => { for (let y = 7; y < 14; y++) for (let x = 2; x < 14; x++) if (y > 8 + Math.round(Math.sin(x * 0.8 + y) * 0.8)) p.set(x, y, y < 10 ? l : c); },
  drop: (p, c, l) => { for (let y = 3; y < 13; y++) { const w = y < 7 ? Math.floor((y - 3) / 1.5) : Math.round(Math.sqrt(Math.max(0, 9 - (y - 10) ** 2)) * 1.3); p.line(8 - w, y, 8 + w, y, c); } p.set(7, 9, l); p.set(7, 10, W); },
  sand: (p, c, l, d) => { for (let y = 9; y < 14; y++) p.line(8 - (y - 8), y, 8 + (y - 8), y, (y % 2 ? c : l)); p.set(8, 5, d); p.set(6, 6, c); p.set(10, 4, c); },
  snowflake: (p, c, l) => { p.line(8, 2, 8, 14, c); p.line(3, 5, 13, 11, c); p.line(3, 11, 13, 5, c); p.set(8, 8, W); p.set(8, 3, l); p.set(8, 13, l); },
  plus: (p, c, l) => { p.rect(6, 3, 4, 10, c); p.rect(3, 6, 10, 4, c); p.rect(7, 4, 1, 8, l); p.rect(4, 7, 8, 1, l); },
  heavy: (p, c, l) => { p.rect(4, 7, 8, 6, c); p.line(5, 7, 6, 4, c); p.line(10, 7, 11, 4, c); p.line(6, 4, 10, 4, c); p.rect(5, 8, 1, 4, l); },
  feather: (p, c, l) => { p.line(3, 13, 12, 3, mix(c, K, 0.3)); for (let i = 0; i < 6; i++) { p.line(5 + i, 11 - i, 4 + i, 8 - i, c); p.line(6 + i, 12 - i, 9 + i, 11 - i, l); } },
  speed: (p, c, l) => { for (const o of [0, 5]) { p.line(3 + o, 4, 7 + o, 8, c); p.line(7 + o, 8, 3 + o, 12, c); } p.set(12, 8, l); },
  accel: (p, c, l) => { p.line(3, 8, 12, 8, c); p.line(12, 8, 9, 5, c); p.line(12, 8, 9, 11, c); p.line(3, 5, 5, 5, l); p.line(2, 11, 6, 11, l); },
  pierce: (p, c, l) => { p.rect(8, 3, 2, 10, hex('#8a8a9a')); p.line(2, 8, 13, 8, c); p.line(13, 8, 11, 6, l); p.line(13, 8, 11, 10, l); },
  bounce: (p, c, l) => { p.line(2, 13, 14, 13, hex('#8a8a9a')); for (let x = 2; x < 14; x++) p.set(x, 12 - Math.abs(Math.sin(((x - 2) / 6) * Math.PI)) * 8, c); p.disc(13, 7, 1, l); },
  homing: (p, c, l) => { p.ring(8, 8, 5, c); p.ring(8, 8, 2, l); p.line(8, 1, 8, 4, c); p.line(8, 12, 8, 15, c); p.line(1, 8, 4, 8, c); p.line(12, 8, 15, 8, c); },
  boom: (p, c, l) => { G.explosion(p, c, l, c, { g: '', c: '' }); p.line(1, 14, 5, 10, hex('#d0d0ff')); },
  flametrail: (p, c) => { for (let x = 2; x < 14; x += 3) { p.line(x, 13, x + 1, 9 - (x % 2), c); p.set(x + 1, 12, hex('#ffd040')); } p.disc(12, 4, 1, hex('#ffe060')); },
  crit: (p, c, l) => { for (let a = 0; a < 10; a++) { const r = a % 2 ? 2.5 : 6; p.line(8, 8, 8 + Math.cos(a * 0.628 - 1.57) * r, 8 + Math.sin(a * 0.628 - 1.57) * r, c); } p.disc(8, 8, 1, l); },
  mana: (p, c, l) => { G.drop(p, c, l, c, { g: '', c: '' }); p.text('+', 11, 1, W); },
  recharge: (p, c, l) => { p.ring(8, 8, 5, c); p.line(8, 8, 8, 4, l); p.line(8, 8, 11, 8, l); p.line(12, 2, 13, 4, c); p.line(13, 4, 11, 4, c); },
  lifeup: (p, c, l) => { p.line(4, 3, 12, 3, l); p.line(4, 13, 12, 13, l); p.line(5, 4, 11, 12, c); p.line(11, 4, 5, 12, c); p.rect(7, 10, 3, 2, l); p.text('+', 12, 0, W); },
  lifedown: (p, c, l) => { p.line(4, 3, 12, 3, l); p.line(4, 13, 12, 13, l); p.line(5, 4, 11, 12, c); p.line(11, 4, 5, 12, c); p.text('-', 12, 0, W); },
  spread: (p, c, l) => { p.line(2, 8, 13, 5, c); p.line(2, 8, 13, 11, c); p.line(5, 8, 13, 8, l); },
  line: (p, c, l) => { p.line(2, 8, 13, 8, c); p.set(13, 8, W); p.line(2, 11, 6, 13, mix(c, K, 0.6)); p.line(6, 13, 9, 13, mix(c, K, 0.6)); void l; },
  wave: (p, c, l) => { for (let x = 1; x < 15; x++) p.set(x, 8 + Math.round(Math.sin(x * 0.8) * 3), x > 11 ? l : c); },
  chaos: (p, c, l) => { const pts = [[2, 10], [4, 4], [7, 12], [9, 5], [11, 11], [13, 3]]; for (let i = 1; i < pts.length; i++) p.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], i > 4 ? l : c); },
  spiral: (p, c, l) => { for (let x = 1; x < 15; x++) { p.set(x, 8 + Math.round(Math.sin(x * 1.1) * 3), c); p.set(x, 8 + Math.round(Math.cos(x * 1.1) * 1.5), l); } },
  down: (p, c, l) => { p.rect(7, 2, 2, 8, c); p.line(3, 9, 8, 14, c); p.line(12, 9, 8, 14, c); p.set(8, 13, l); },
  up: (p, c, l) => { p.rect(7, 6, 2, 8, c); p.line(3, 6, 8, 1, c); p.line(12, 6, 8, 1, c); p.set(8, 2, l); },
  push: (p, c, l) => { p.rect(3, 6, 5, 5, c); p.line(8, 8, 13, 8, l); p.line(13, 8, 11, 6, l); p.line(13, 8, 11, 10, l); },
  zap: (p, c, l) => { p.line(9, 2, 5, 8, c); p.line(5, 8, 10, 8, c); p.line(10, 8, 6, 14, c); p.set(6, 14, l); p.disc(12, 12, 1, l); },
  glimmer: (p, c, _l, _d, icon) => {
    const cols = icon.c === '#ffffff' ? ['#ff4040', '#ffc040', '#40ff60', '#40c0ff', '#c040ff'].map(hex) : [c];
    for (let i = 0; i < 9; i++) { const a = i * 0.7, r = 1 + i * 0.55; const q = cols[i % cols.length]; p.set(8 + Math.cos(a) * r, 8 + Math.sin(a) * r, q); }
    p.set(8, 8, W); p.set(8, 7, mix(c, W, 0.5)); p.set(7, 8, mix(c, W, 0.5));
  },
  digit: (p, c, l, _d, icon) => { p.text(icon.n ?? '2', 6, 5, c); p.line(2, 13, 5, 13, l); p.line(11, 13, 14, 13, l); },
  scatter: (p, c, l, _d, icon) => { p.text(icon.n ?? '2', 2, 2, c); for (const [x, y] of [[9, 8], [12, 6], [11, 11], [14, 9], [8, 12]]) p.set(x, y, l); },
  form: (p, c, l, _d, icon) => {
    const arrow = (a: number) => { const x = 8 + Math.cos(a) * 5.5, y = 8 + Math.sin(a) * 5.5; p.line(8 + Math.cos(a) * 2, 8 + Math.sin(a) * 2, x, y, c); p.set(x, y, l); };
    const n = icon.n;
    p.disc(8, 8, 1, W);
    if (n === 'behind') { arrow(0); arrow(Math.PI); }
    else if (n === 'bi') { arrow(-0.35); arrow(0.35); }
    else if (n === 'tri') { arrow(-0.5); arrow(0); arrow(0.5); }
    else if (n === 'ab') { arrow(0); arrow(-Math.PI / 2); arrow(Math.PI / 2); }
    else { const k = n === 'penta' ? 5 : 6; for (let i = 0; i < k; i++) arrow((i / k) * Math.PI * 2 - Math.PI / 2); }
  },
  tag: (p, c, l, _d, icon) => { p.rect(3, 5, 7, 6, c); p.line(10, 5, 13, 8, c); p.line(10, 10, 13, 8, c); p.set(5, 7, W); badge(p, icon.n ?? 'trigger', l); },
  divide: (p, c, l, _d, icon) => { p.rect(2, 7, 7, 1, c); p.set(5, 5, c); p.set(5, 9, c); p.text(icon.n ?? '2', 10, 5, l); },
  greek: (p, c, l, _d, icon) => {
    const art: Record<string, string[]> = {
      alpha: ['.##.#', '#..#.', '#..#.', '#..#.', '.##.#'],
      gamma: ['#####', '#....', '#....', '#....', '#....'],
      omega: ['.###.', '#...#', '#...#', '.#.#.', '##.##'],
      mu: ['#..#.', '#..#.', '#..#.', '####.', '#...#'],
    };
    (art[icon.n ?? 'alpha'] ?? []).forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === '#') { p.set(4 + i * 1.5, 4 + j * 1.6, c); p.set(5 + i * 1.5, 4 + j * 1.6, c); } });
    p.set(13, 2, l);
  },
  random: (p, c, l) => { p.text('?', 6, 5, c); p.set(3, 3, l); p.set(12, 12, l); p.set(12, 3, mix(c, K, 0.3)); },
  far: (p, c, l) => { for (let x = 2; x < 10; x += 2) p.set(x, 8, mix(c, K, 0.3)); p.line(10, 8, 13, 8, c); p.ball(12, 8, 2, c); p.set(12, 7, l); },
  telecast: (p, c, l) => { p.ring(11, 8, 3, c); p.ring(11, 8, 2, l); p.line(2, 8, 6, 8, c); p.line(6, 8, 4, 6, c); p.line(6, 8, 4, 10, c); },
  refresh: (p, c, l) => { for (let a = 0.4; a < 5.8; a += 0.2) p.set(8 + Math.cos(a) * 5, 8 + Math.sin(a) * 5, c); p.line(13, 6, 13, 9, l); p.line(13, 9, 10, 9, l); },
};

/** Small badges for spells that carry a trigger. */
function badge(p: Pix, kind: string, c: RGB) {
  if (kind === 'trigger') { p.rect(11, 11, 4, 1, c); p.rect(12, 12, 2, 3, c); }
  else if (kind === 'timer') { p.ring(13, 13, 2, c); p.set(13, 12, c); p.set(13, 13, W); }
  else if (kind === 'expire') { p.line(11, 11, 15, 15, c); p.line(15, 11, 11, 15, c); }
}

/** A spell's card: a dark frame in its type's colour around its picture. */
export function paintSpell(px: ModContext['mc']['pixels'], s: SpellDef): Img {
  const p = new Pix(px);
  const [frame, bg] = TYPE_COLORS[s.type].map(hex);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      p.set(x, y, edge ? frame : mix(bg, K, (y / 16) * 0.35));
    }
  // corners rounded off
  for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) p.set(x, y, mix(frame, K, 0.5), 0);
  const c = hex(s.icon.c);
  (G[s.icon.g] ?? G.spark)(p, c, mix(c, W, 0.5), mix(c, K, 0.5), s.icon);
  if (s.icon.n && s.icon.g !== 'tag' && ['trigger', 'timer', 'expire'].includes(s.icon.n)) badge(p, s.icon.n, hex('#ffd040'));
  return p.img;
}

/** Wands: a shaft from the bottom left to a gem at the top right. */
const WAND_LOOKS: { shaft: string; dark: string; band: string; gem: string }[] = [
  { shaft: '#9a6a3a', dark: '#5a3a1a', band: '#c8c8c8', gem: '#3a70ff' },
  { shaft: '#5a3a2a', dark: '#2a1a10', band: '#f0c040', gem: '#30e070' },
  { shaft: '#2a2a3a', dark: '#101018', band: '#a0a0c0', gem: '#c040ff' },
  { shaft: '#e8e0d0', dark: '#a09080', band: '#f0d060', gem: '#ff3040' },
  { shaft: '#b08050', dark: '#6a4a2a', band: '#8a6a4a', gem: '#ff80ff' },
  { shaft: '#8a9aaa', dark: '#4a5a6a', band: '#40ffff', gem: '#a0ffff' },
];
export function paintWand(px: ModContext['mc']['pixels'], tier: number): Img {
  const p = new Pix(px), L = WAND_LOOKS[tier] ?? WAND_LOOKS[0];
  const s = hex(L.shaft), d = hex(L.dark), b = hex(L.band), g = hex(L.gem);
  for (let i = 0; i < 10; i++) { p.set(2 + i, 13 - i, s); p.set(3 + i, 13 - i, d); p.set(2 + i, 14 - i, d); }
  p.set(4, 11, b); p.set(5, 11, b); p.set(4, 12, b);
  p.set(9, 6, b); p.set(10, 6, b); p.set(9, 7, b);
  p.ball(12, 3, tier >= 2 ? 2 : 1.5 as number, g);
  p.set(12, 2, mix(g, W, 0.8));
  if (tier === 3 || tier === 5) { p.set(14, 1, mix(g, W, 0.6)); p.set(10, 1, mix(g, W, 0.6)); p.set(14, 5, mix(g, W, 0.6)); }
  return p.img;
}

/** The arcane scroll: rolled parchment with a glowing rune. */
export function paintScroll(px: ModContext['mc']['pixels'], greater: boolean): Img {
  const p = new Pix(px);
  const pa = hex('#e8d8b0'), pd = hex('#b0986a'), rune = hex(greater ? '#ff60ff' : '#60a0ff');
  p.rect(3, 4, 10, 9, pa);
  p.rect(2, 3, 12, 2, pd); p.rect(2, 12, 12, 2, pd);
  p.line(5, 6, 10, 6, pd); p.line(5, 10, 9, 10, pd);
  p.line(8, 6, 6, 9, rune); p.line(6, 9, 10, 9, rune); p.line(10, 9, 8, 6, rune); p.set(8, 8, W);
  return p.img;
}

export function paintDummyItem(px: ModContext['mc']['pixels']): Img {
  const p = new Pix(px);
  const straw = hex('#d8b858'), sack = hex('#b89868'), wood = hex('#7a5a32');
  p.rect(7, 9, 2, 6, wood);
  p.rect(3, 6, 10, 2, wood);
  p.rect(5, 5, 6, 6, sack);
  p.disc(8, 3, 2, sack);
  p.set(7, 3, K); p.set(9, 3, K);
  p.line(6, 8, 10, 8, straw); p.set(4, 7, straw); p.set(11, 6, straw);
  return p.img;
}

// ------------------------------------------------------------------ registration
export function registerArt(mod: ModContext, wandItemKeys: string[]) {
  const { pixels: px } = mod.mc;
  for (const s of SPELLS) if (!s.hidden) mod.client.itemSprite(`wands:${s.id}`, () => paintSpell(px, s));
  wandItemKeys.forEach((k, tier) => mod.client.itemSprite(`wands:${k}`, () => paintWand(px, tier), '#1a1020'));
  mod.client.itemSprite('wands:arcane_scroll', () => paintScroll(px, false), '#3a2a10');
  mod.client.itemSprite('wands:greater_arcane_scroll', () => paintScroll(px, true), '#3a1030');
  mod.client.itemSprite('wands:target_dummy', () => paintDummyItem(px), '#2a2010');

  // light sprites: soft and hard round glows, a star, a ring (white: spells tint them)
  const radial = (f: (d: number) => number) => () => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      const a = Math.max(0, Math.min(1, f(d)));
      if (a > 0) px.set(img, x, y, [255, 255, 255], Math.round(a * 255));
    }
    return img;
  };
  mod.client.texture('wands:glow', radial((d) => (1 - d) ** 1.6));
  mod.client.texture('wands:core', radial((d) => (d < 0.45 ? 1 : 1 - (d - 0.45) * 3)));
  mod.client.texture('wands:ring', radial((d) => 1 - Math.abs(d - 0.8) * 6));
  mod.client.texture('wands:star', () => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
      const a = Math.max(0, 1 - Math.min(dx, dy) * 0.9 - Math.max(dx, dy) * 0.11);
      if (a > 0.05) px.set(img, x, y, [255, 255, 255], Math.round(a * 255));
    }
    return img;
  });
  // solid things
  const noisy = (base: string, var2: string, extra?: (img: Img) => void) => (r: { next(): number }) => {
    const img = px.newImg(), a = hex(base), b = hex(var2);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, mix(a, b, r.next()));
    extra?.(img);
    return img;
  };
  mod.client.texture('wands:bomb', noisy('#2e2e36', '#44444e', (img) => { px.set(img, 4, 4, [140, 140, 160]); px.set(img, 5, 4, [110, 110, 130]); px.set(img, 4, 5, [110, 110, 130]); }));
  mod.client.texture('wands:dynamite', noisy('#c01818', '#e02828', (img) => { for (let x = 0; x < 16; x++) { px.set(img, x, 4, [240, 224, 192]); px.set(img, x, 11, [240, 224, 192]); } }));
  mod.client.texture('wands:holy', noisy('#e0c050', '#fff0a0', (img) => { for (let i = 3; i < 13; i++) { px.set(img, 8, i, [255, 255, 255]); px.set(img, i, 7, [255, 255, 255]); } }));
  mod.client.texture('wands:void', noisy('#000000', '#14001e'));
  mod.client.texture('wands:straw', noisy('#c8a848', '#e8c868', (img) => { for (let k = 0; k < 10; k++) px.set(img, (k * 7) % 16, (k * 5) % 16, [150, 120, 40]); }));
  mod.client.texture('wands:burlap', noisy('#a88a5a', '#c0a070', (img) => { for (let y = 0; y < 16; y += 2) for (let x = (y / 2) % 2; x < 16; x += 2) px.set(img, x, y, [140, 112, 72]); }));
  mod.client.texture('wands:dummy_face', noisy('#a88a5a', '#c0a070', (img) => {
    const k: RGB = [40, 30, 20];
    for (const [x, y] of [[4, 5], [5, 5], [10, 5], [11, 5], [4, 6], [11, 6]]) px.set(img, x, y, k);
    for (let x = 5; x < 11; x++) px.set(img, x, 11, k);
    for (let x = 6; x < 10; x += 2) px.set(img, x, 12, k);
    // a red target painted on
    for (let a = 0; a < 32; a++) px.set(img, Math.round(8 + Math.cos(a / 5) * 6.5) % 16, Math.round(8 + Math.sin(a / 5) * 6.5) % 16, [180, 30, 30]);
  }));
  mod.client.texture('wands:post', noisy('#6a4a28', '#8a6a3a'));
  mod.client.texture('wands:cloud', noisy('#e4e8f0', '#f8f8ff'));
  mod.client.texture('wands:stormcloud', noisy('#4a4e5a', '#5e6270'));

  // sounds
  const sy = mod.mc.synth, SR = mod.mc.SAMPLE_RATE;
  mod.client.sound('wands:cast', (r) => {
    const b = sy.env(sy.tone(Math.floor(SR * 0.12), 1500 + r.next() * 400, 500, 'square'), 0.002, 0.1, 3);
    sy.mixInto(b, sy.env(sy.highpass(sy.noise(Math.floor(SR * 0.08), r), 3000), 0.001, 0.06, 3), 0.4);
    return sy.normalize(b, 0.4);
  });
  mod.client.sound('wands:fizzle', (r) => sy.normalize(sy.env(sy.bandpass(sy.noise(Math.floor(SR * 0.2), r), 300, 1200), 0.01, 0.18, 2), 0.35));
  mod.client.sound('wands:teleport', () => sy.normalize(sy.env(sy.tone(Math.floor(SR * 0.4), 300, 1800, 'sine', 30, 18), 0.01, 0.38, 1.5), 0.5));
  mod.client.sound('wands:thunder', (r) => {
    const b = sy.env(sy.lowpass(sy.noise(Math.floor(SR * 1.6), r), 400), 0.005, 1.5, 1.4);
    sy.mixInto(b, sy.env(sy.highpass(sy.noise(Math.floor(SR * 0.15), r), 2000), 0.001, 0.12, 2), 0.8);
    return sy.normalize(b, 0.9);
  });
  mod.client.sound('wands:scroll', (r) => sy.normalize(sy.env(sy.bandpass(sy.noise(Math.floor(SR * 0.35), r), 1500, 6000), 0.03, 0.3, 1.5), 0.3));
  mod.client.sound('wands:learn', () => {
    const b = sy.env(sy.tone(Math.floor(SR * 0.5), 660, 660, 'sine'), 0.005, 0.45, 2);
    sy.mixInto(b, sy.env(sy.tone(Math.floor(SR * 0.4), 990, 990, 'sine'), 0.005, 0.35, 2), 0.6, Math.floor(SR * 0.08));
    sy.mixInto(b, sy.env(sy.tone(Math.floor(SR * 0.35), 1320, 1320, 'sine'), 0.005, 0.3, 2), 0.4, Math.floor(SR * 0.16));
    return sy.normalize(b, 0.4);
  });
}
