// Models, skins and poses of the 1.4-1.16 animals (rabbits, foxes, cats, parrots, polar bears, pandas, llamas,
// turtles, dolphins, fish, mooshrooms, bees). These are built from part lists: each box gets its texture area packed
// automatically, and skins are painted per part and face, so a model is a few lines and its skin a colour scheme.
import { Random } from '../noise';
import { ModelDef, ModelBox, ModelPart, Skin, cowSkin } from './models';
import type { PoseCtx, PoseOut } from './mobmodels2';

type RGB = [number, number, number];
type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
const hx = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const vary = (c: RGB, r: Random, amt = 0.08): RGB => {
  const f = 1 + (r.next() - 0.5) * 2 * amt;
  return [c[0] * f, c[1] * f, c[2] * f].map((x) => Math.max(0, Math.min(255, Math.round(x)))) as RGB;
};
const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
const rgbOf = (n: number): RGB => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

// ------------------------------------------------------------------ the builder
/** A part: name, pivot, boxes [x, y, z, w, h, d] (model space, y down, front -z), resting rotation. */
interface PartSpec { n: string; p: [number, number, number]; b: [number, number, number, number, number, number][]; r?: [number, number, number]; inflate?: number }
interface Built { def: ModelDef; boxes: { part: string; i: number; u: number; v: number; w: number; h: number; d: number }[] }
/** Lay out every box's texture area on shelves across a `texW`-wide texture. */
function build(parts: PartSpec[], texW = 64): Built {
  const boxes: Built['boxes'] = [];
  let u = 0, v = 0, shelf = 0;
  const defParts: ModelPart[] = parts.map((ps) => ({
    name: ps.n, px: ps.p[0], py: ps.p[1], pz: ps.p[2], rx: ps.r?.[0], ry: ps.r?.[1], rz: ps.r?.[2],
    boxes: ps.b.map(([x, y, z, w, h, d], i): ModelBox => {
      const bw = Math.ceil(2 * d + 2 * w), bh = Math.ceil(d + h);
      if (u + bw > texW) { u = 0; v += shelf; shelf = 0; }
      const box: ModelBox = { x, y, z, w, h, d, u, v, inflate: ps.inflate };
      boxes.push({ part: ps.n, i, u, v, w: Math.ceil(w), h: Math.ceil(h), d: Math.ceil(d) });
      u += bw; shelf = Math.max(shelf, bh);
      return box;
    }),
  }));
  let texH = 16;
  while (texH < v + shelf) texH *= 2;
  return { def: { texW, texH, parts: defParts }, boxes };
}
/** Paint a built model's skin: `paint(part, boxIndex, face, x, y, w, h)` gives each pixel (null = transparent). */
function paint(b: Built, seed: number, f: (part: string, i: number, face: Face, x: number, y: number, w: number, h: number, r: Random) => RGB | [number, number, number, number] | null): Skin {
  const s = new Skin(b.def.texW, b.def.texH);
  const r = new Random(seed);
  for (const bx of b.boxes) s.paintBox(bx.u, bx.v, bx.w, bx.h, bx.d, (face, x, y, w, h) => f(bx.part, bx.i, face as Face, x, y, w, h, r));
  return s;
}
/** A furry coat: base colour with a darker back and lighter belly, a little noise. */
const coat = (base: RGB, r: Random, face: Face, y: number, h: number, amt = 0.06): RGB => {
  const k = face === 'top' ? 0.88 : face === 'bottom' ? 1.12 : 1 - (0.5 - y / Math.max(1, h)) * 0.12;
  return vary(mix(base, k > 1 ? [255, 255, 255] : [0, 0, 0], Math.abs(1 - k)), r, amt);
};
/** Eyes on the front of a head box: two pixels at row `ey`, `gap` apart around the middle. */
const eyes = (face: Face, x: number, y: number, w: number, ey: number, gap: number, col: RGB): RGB | null => {
  if (face !== 'front' || y !== ey) return null;
  const c = (w - 1) / 2;
  return Math.abs(x - c) === gap / 2 + 0.5 || (w % 2 === 1 && Math.abs(x - c) === gap / 2) ? col : null;
};

// ------------------------------------------------------------------ the models
const MODELS: Record<string, Built> = {};
const leg4 = (x: number, zf: number, zb: number, y: number, w: number, h: number, d = w): PartSpec[] => [
  { n: 'fl', p: [-x, y, zf], b: [[-w / 2, 0, -d / 2, w, h, d]] }, { n: 'fr', p: [x, y, zf], b: [[-w / 2, 0, -d / 2, w, h, d]] },
  { n: 'bl', p: [-x, y, zb], b: [[-w / 2, 0, -d / 2, w, h, d]] }, { n: 'br', p: [x, y, zb], b: [[-w / 2, 0, -d / 2, w, h, d]] },
];
MODELS.rabbit = build([
  { n: 'body', p: [0, 19, 1], b: [[-3, -2.5, -4, 6, 5, 9]] },
  { n: 'head', p: [0, 16, -3], b: [[-2.5, -4, -4, 5, 4, 5]] },
  { n: 'earL', p: [0, 12, -3], b: [[-2.5, -5, -0.5, 2, 5, 1]] }, { n: 'earR', p: [0, 12, -3], b: [[0.5, -5, -0.5, 2, 5, 1]] },
  { n: 'tail', p: [0, 18, 5], b: [[-1.5, -1.5, 0, 3, 3, 2]] },
  { n: 'fl', p: [-1.5, 20, -2.5], b: [[-1, 0, -1, 2, 4, 2]] }, { n: 'fr', p: [1.5, 20, -2.5], b: [[-1, 0, -1, 2, 4, 2]] },
  { n: 'bl', p: [-2.5, 20, 3], b: [[-1, 0, -3, 2, 4, 5]] }, { n: 'br', p: [2.5, 20, 3], b: [[-1, 0, -3, 2, 4, 5]] },
]);
MODELS.fox = build([
  { n: 'body', p: [0, 17, 1], b: [[-3, -3, -5, 6, 6, 11]] },
  { n: 'head', p: [0, 15, -4], b: [[-4, -3, -6, 8, 6, 6], [-2, 0, -9, 4, 2, 3], [-4, -5, -3, 2, 2, 1], [2, -5, -3, 2, 2, 1]] },
  { n: 'tail', p: [0, 15, 6], b: [[-2, -2, 0, 4, 9, 5]], r: [Math.PI / 2 - 0.4, 0, 0] },
  ...leg4(1.8, -2.5, 4.5, 20, 2, 4),
]);
MODELS.cat = build([
  { n: 'body', p: [0, 15, 1], b: [[-2, -3, -7, 4, 6, 15]] },
  { n: 'head', p: [0, 13, -7], b: [[-2.5, -2, -4, 5, 4, 5], [-1.5, 0, -5, 3, 2, 1], [-2, -3, -1, 1, 1, 2], [1, -3, -1, 1, 1, 2]] },
  { n: 'tail', p: [0, 13, 8], b: [[-0.5, 0, 0, 1, 8, 1]], r: [0.9, 0, 0] },
  { n: 'tail2', p: [0, 18.5, 13], b: [[-0.5, 0, 0, 1, 8, 1]], r: [1.7, 0, 0] },
  ...leg4(1.1, -4, 6, 16, 2, 8),
]);
MODELS.parrot = build([
  { n: 'body', p: [0, 16.5, -3], b: [[-1.5, 0, -1.5, 3, 6, 3]], r: [0.494, 0, 0] },
  { n: 'tail', p: [0, 21, 1.2], b: [[-1.5, -1, -1, 3, 4, 1]], r: [1.015, 0, 0] },
  { n: 'wingL', p: [1.5, 16.9, -2.8], b: [[-0.5, 0, -1.5, 1, 5, 3]], r: [-0.69, -Math.PI, 0] },
  { n: 'wingR', p: [-1.5, 16.9, -2.8], b: [[-0.5, 0, -1.5, 1, 5, 3]], r: [-0.69, -Math.PI, 0] },
  { n: 'head', p: [0, 15.69, -2.76], b: [[-1, -1.5, -1, 2, 3, 2], [-1, -3.5, -1, 2, 2, 2], [-0.5, -2, -2, 1, 2, 1], [-0.5, -2.7, -3, 1, 2, 1]] },
  { n: 'crest', p: [0, 13.4, -2.8], b: [[0, -4, -2, 0, 5, 4]], r: [-0.21, 0, 0] },
  { n: 'legL', p: [1, 22, -1.05], b: [[-0.5, 0, -0.5, 1, 2, 1]], r: [-0.07, 0, 0] },
  { n: 'legR', p: [-1, 22, -1.05], b: [[-0.5, 0, -0.5, 1, 2, 1]], r: [-0.07, 0, 0] },
], 32);
MODELS.polar_bear = build([
  { n: 'body', p: [-2, 9, 12], b: [[-5, -1, -24, 14, 14, 22], [-4, -6, -20, 12, 5, 11]] },
  { n: 'head', p: [0, 10, -16], b: [[-3.5, -3, -3, 7, 7, 7], [-2.5, 1, -6, 5, 3, 3], [-4.5, -4, -1, 2, 2, 1], [2.5, -4, -1, 2, 2, 1]] },
  ...leg4(4.5, -9, 6, 14, 4, 10, 8),
], 128);
MODELS.panda = build([
  { n: 'body', p: [0, 14, 0], b: [[-9.5, -6.5, -13, 19, 13, 26]] },
  { n: 'head', p: [0, 12, -16], b: [[-6.5, -5, -4, 13, 10, 9], [-3.5, 0, -6, 7, 5, 2], [-8.5, -6, -1, 5, 4, 1], [3.5, -6, -1, 5, 4, 1]] },
  ...leg4(5.5, -9, 9, 15, 6, 9),
], 128);
MODELS.llama = build([
  { n: 'body', p: [0, 7, 2], b: [[-6, -5, -9, 12, 10, 18]] },
  { n: 'head', p: [0, 7, -6], b: [[-4, -16, -6, 8, 18, 6], [-2, -14, -10, 4, 4, 9], [-4, -19, -4, 3, 3, 2], [1, -19, -4, 3, 3, 2]] },
  { n: 'chestL', p: [-8.5, 3, 3], b: [[-3, 0, 0, 8, 8, 3]], r: [0, Math.PI / 2, 0] },
  { n: 'chestR', p: [5.5, 3, 3], b: [[-3, 0, 0, 8, 8, 3]], r: [0, Math.PI / 2, 0] },
  ...leg4(3.5, -5, 6, 10, 4, 14),
], 128);
MODELS.turtle = build([
  { n: 'body', p: [0, 21, 0], b: [[-9.5, -4, -10, 19, 4, 20], [-5.5, 0, -7, 11, 3, 15]] },
  { n: 'head', p: [0, 19, -10], b: [[-3, -1, -6, 6, 5, 6]] },
  { n: 'fl', p: [-5, 21, -4], b: [[-13, 0, -2, 13, 1, 5]] }, { n: 'fr', p: [5, 21, -4], b: [[0, 0, -2, 13, 1, 5]] },
  { n: 'bl', p: [-3.5, 22, 9], b: [[-2, 0, 0, 4, 1, 10]] }, { n: 'br', p: [3.5, 22, 9], b: [[-2, 0, 0, 4, 1, 10]] },
  { n: 'egg', p: [0, 24, 0], b: [[-4.5, -3, -3, 9, 1, 13]] },
], 128);
MODELS.dolphin = build([
  { n: 'body', p: [0, 18, -1], b: [[-4, -3.5, -5, 8, 7, 13]] },
  { n: 'head', p: [0, 18, -5], b: [[-4, -3.5, -6, 8, 7, 6], [-1, 0.5, -10, 2, 2, 4]] },
  { n: 'fin', p: [0, 14.5, 1], b: [[-0.5, -5, 0, 1, 5, 4]], r: [-0.6, 0, 0] },
  { n: 'flipL', p: [-2, 21, -2], b: [[-8, 0, 0, 8, 1, 4]], r: [0.3, 0.5, 0.3] },
  { n: 'flipR', p: [2, 21, -2], b: [[0, 0, 0, 8, 1, 4]], r: [0.3, -0.5, -0.3] },
  { n: 'tail', p: [0, 18, 8], b: [[-2, -2.5, 0, 4, 5, 11]] },
  { n: 'fluke', p: [0, 18, 18], b: [[-5, -0.5, 0, 10, 1, 6]] },
]);
MODELS.cod = build([
  { n: 'body', p: [0, 22, 0], b: [[-1, -2, -3, 2, 4, 7]] }, { n: 'head', p: [0, 22, -3], b: [[-1, -2, -3, 2, 4, 3], [-1, -3, -2, 2, 1, 1]] },
  { n: 'fin', p: [0, 20, 0], b: [[0, -1, -1, 0, 1, 6]] }, { n: 'tail', p: [0, 22, 4], b: [[0, -2, 0, 0, 4, 4]] },
], 32);
MODELS.salmon = build([
  { n: 'body', p: [0, 20, 0], b: [[-1.5, -2.5, -4, 3, 5, 8]] }, { n: 'head', p: [0, 20, -4], b: [[-1, -2, -3, 2, 4, 3]] },
  { n: 'back', p: [0, 20, 4], b: [[-1.5, -2.5, 0, 3, 5, 8]] }, { n: 'tail', p: [0, 20, 12], b: [[0, -2.5, 0, 0, 5, 6]] },
  { n: 'fin', p: [0, 17.5, -2], b: [[0, -2, 0, 0, 2, 5]] },
], 32);
MODELS.pufferfish = build([
  { n: 'small', p: [0, 22.5, 0], b: [[-1.5, -1.5, -1.5, 3, 2, 3]] },
  { n: 'mid', p: [0, 22, 0], b: [[-2.5, -5, -2.5, 5, 5, 5]] },
  { n: 'full', p: [0, 22, 0], b: [[-4, -8, -4, 8, 8, 8]] },
  { n: 'tail', p: [0, 21, 2], b: [[-1.5, -0.5, 0, 3, 1, 1]] },
]);
MODELS.tropical_fish = build([
  { n: 'body', p: [0, 22, 0], b: [[-1, -1.5, -3, 2, 3, 6]] }, { n: 'tail', p: [0, 22, 3], b: [[0, -1.5, 0, 0, 3, 4]] },
  { n: 'fin', p: [0, 20.5, -1], b: [[0, -3, 0, 0, 3, 6]] },
], 32);
MODELS.tropical_fish_b = build([
  { n: 'body', p: [0, 19, 0], b: [[-1, -3, -0.5, 2, 6, 6]] }, { n: 'tail', p: [0, 19, 5.5], b: [[0, -3, 0, 0, 6, 5]] },
  { n: 'fin', p: [0, 16, 0], b: [[0, -5, 0, 0, 5, 6]] }, { n: 'finB', p: [0, 22, 0], b: [[0, 0, 0, 0, 5, 6]] },
], 32);
MODELS.bee = build([
  { n: 'body', p: [0, 19, 0], b: [[-3.5, -4, -5, 7, 7, 10], [-1.5, -1, -8, 0, 2, 3], [1.5, -1, -8, 0, 2, 3]] },
  { n: 'stinger', p: [0, 19, 5], b: [[0, -1, 0, 0, 1, 2]] },
  { n: 'wingL', p: [-1.5, 15, -3], b: [[-9, 0, 0, 9, 0, 6]], r: [0, -0.26, 0] },
  { n: 'wingR', p: [1.5, 15, -3], b: [[0, 0, 0, 9, 0, 6]], r: [0, 0.26, 0] },
  { n: 'legs', p: [1.5, 22, -2], b: [[-5, 0, 0, 7, 2, 0], [-5, 0, 2, 7, 2, 0], [-5, 0, 4, 7, 2, 0]] },
]);

MODELS.armor_stand = build([
  { n: 'head', p: [0, 0, 0], b: [[-1, -7, -1, 2, 7, 2]] },
  { n: 'body', p: [0, 0, 0], b: [[-6, 0, -1.5, 12, 3, 3], [-3, 3, -1, 2, 7, 2], [1, 3, -1, 2, 7, 2], [-4, 10, -1, 8, 2, 2]] },
  { n: 'rightArm', p: [-5, 2, 0], b: [[-2, -2, -1, 2, 12, 2]] },
  { n: 'leftArm', p: [5, 2, 0], b: [[0, -2, -1, 2, 12, 2]] },
  { n: 'rightLeg', p: [-1.9, 12, 0], b: [[-1, 0, -1, 2, 11, 2]] },
  { n: 'leftLeg', p: [1.9, 12, 0], b: [[-1, 0, -1, 2, 11, 2]] },
  { n: 'plate', p: [0, 24, 0], b: [[-6, -1, -6, 12, 1, 12]] },
]);
MODELS.wither = build([
  { n: 'head', p: [0, 0, 0], b: [[-4, -4, -4, 8, 8, 8]] },
  { n: 'headL', p: [10, 2, 0], b: [[-3, -3, -3, 6, 6, 6]] },
  { n: 'headR', p: [-10, 2, 0], b: [[-3, -3, -3, 6, 6, 6]] },
  { n: 'shoulders', p: [0, 0, 0], b: [[-10, 4, -1.5, 20, 3, 3]] },
  { n: 'spine', p: [0, 7, 0], b: [[-1.5, 0, -1.5, 3, 10, 3], [-4.5, 1.5, 0.5, 9, 2, 2], [-4.5, 4, 0.5, 9, 2, 2], [-4.5, 6.5, 0.5, 9, 2, 2]], r: [0.2, 0, 0] },
  { n: 'tail', p: [0, 16.8, 2], b: [[-1.5, 0, -1.5, 3, 7, 3]], r: [0.5, 0, 0] },
]);
/** Sign text: a sheet in front of the board (14 x 8 sixteenths), its texture is the text (front half only). */
const signText = (): ModelDef => ({ texW: 28, texH: 8, parts: [{ name: 'text', px: 0, py: 0, pz: 0, boxes: [{ x: -7, y: 0, z: 0, w: 14, h: 8, d: 0, u: 0, v: 0 }] }] });
export const MOB_MODELS3: Record<string, () => ModelDef> = { ...Object.fromEntries(Object.entries(MODELS).map(([k, b]) => [k, () => b.def])), signText };

// ------------------------------------------------------------------ skins
const EYE = hx('#1a1a1a');
function quadSkin(model: string, seed: number, base: string, opts: { belly?: string; head?: string; nose?: string; ear?: string; legs?: string; tail?: string; spots?: (part: string, x: number, y: number, face: Face, r: Random) => RGB | null; eyeRow?: number; eyeGap?: number; eyeCol?: string } = {}): Skin {
  const B0 = hx(base);
  return paint(MODELS[model], seed, (part, i, face, x, y, w, h, r) => {
    const sp = opts.spots?.(part, x, y, face, r);
    if (sp) return sp;
    if (part === 'head' && i === 0) {
      const e = eyes(face, x, y, w, opts.eyeRow ?? Math.floor(h / 3), opts.eyeGap ?? Math.max(1, w - 4), opts.eyeCol ? hx(opts.eyeCol) : EYE);
      if (e) return e;
      return coat(hx(opts.head ?? base), r, face, y, h);
    }
    if (part === 'head') return coat(hx(i === 1 ? opts.nose ?? opts.head ?? base : opts.ear ?? opts.head ?? base), r, face, y, h);
    if (part === 'tail' || part === 'tail2') return coat(hx(opts.tail ?? base), r, face, y, h);
    if (['fl', 'fr', 'bl', 'br'].includes(part)) return coat(y > h - 2 && opts.legs ? hx(opts.legs) : opts.legs && !opts.belly ? hx(opts.legs) : B0, r, face, y, h);
    if (part === 'body' && opts.belly && face === 'bottom') return coat(hx(opts.belly), r, face, y, h);
    return coat(B0, r, face, y, h);
  });
}
const RABBIT_COLORS: Record<string, [string, string?]> = { brown: ['#8a6a4a'], white: ['#f0f0ec'], black: ['#2a2626'], white_splotched: ['#f0f0ec', '#3a3434'], gold: ['#e8c87a'], salt: ['#c8b8a0', '#5a4a3a'] };
function rabbitSkin(kind: string): Skin {
  const [base, spot] = RABBIT_COLORS[kind];
  return quadSkin('rabbit', kind.length * 7, base, {
    eyeCol: kind === 'white' || kind === 'white_splotched' ? '#c83030' : '#1a1a1a', eyeRow: 1,
    spots: (part, x, y, face, r) => {
      if (part === 'tail') return vary(hx('#f4f4f0'), r, 0.03);
      if ((part === 'earL' || part === 'earR') && face === 'front' && x === 0 && y > 0) return hx('#e8a8a0');
      if (spot && part !== 'head' && r.int(4) === 0) return vary(hx(spot), r, 0.05);
      return null;
    },
  });
}
function foxSkin(snow: boolean): Skin {
  return quadSkin('fox', snow ? 81 : 80, snow ? '#e8eef0' : '#d47a2a', {
    head: snow ? '#e8eef0' : '#d47a2a', nose: snow ? '#d0d8dc' : '#f0e8e0', ear: snow ? '#c8d0d4' : '#2a1a10', legs: snow ? '#b8c0c4' : '#2a1a10', eyeRow: 2, eyeGap: 4,
    spots: (part, x, y, face, r) => {
      if (part === 'tail' && (y > 6 || face === 'top' && y > 3)) return vary(hx('#f4f0ec'), r, 0.03);
      if (part === 'head' && face === 'front' && y >= 3) return vary(hx('#f4f0ec'), r, 0.03);
      if (part === 'body' && face === 'bottom') return vary(hx('#f0e8e0'), r, 0.03);
      return null;
    },
  });
}
const CAT_COATS: Record<string, [string, string?, string?]> = {
  tabby: ['#8a7058', '#5a4636'], black: ['#2a2a2e', undefined, '#e8e8e8'], red: ['#d88a3a', '#b8682a'], siamese: ['#e8dcc8', '#4a3a2e'], british_shorthair: ['#8a9098', '#6a7078'],
  calico: ['#f0ece4', '#d88a3a'], persian: ['#e8c898', '#c8a478'], ragdoll: ['#f0ece4', '#8a7a6a'], white: ['#f4f4f0'], jellie: ['#e8e8e4', '#3a3a3e'], all_black: ['#1e1e22'], ocelot: ['#e0c070', '#5a3a1a'],
};
function catSkin(kind: string): Skin {
  const [base, stripe, chest] = CAT_COATS[kind];
  return quadSkin('cat', kind.length * 13 + 5, base, {
    eyeCol: kind === 'siamese' || kind === 'ragdoll' ? '#3a7ad8' : '#6ac83a', eyeRow: 1, eyeGap: 2,
    spots: (part, x, y, face, r) => {
      if (stripe && (part === 'body' || part === 'tail' || part === 'tail2') && face !== 'bottom' && (x + (kind === 'calico' ? r.int(3) : 0)) % 3 === 0) return vary(hx(stripe), r, 0.04);
      if (kind === 'siamese' && (part === 'head' && face === 'front' || ['fl', 'fr', 'bl', 'br'].includes(part) && y > 4)) return vary(hx(stripe!), r, 0.04);
      if (chest && part === 'body' && face === 'front') return vary(hx(chest), r, 0.03);
      if (part === 'head' && face === 'front' && y === 3 && x === 2) return hx('#e8a0a0');
      return null;
    },
  });
}
const PARROT_COLORS: Record<string, [string, string, string]> = { red: ['#d02a1a', '#2a5ad0', '#f0c030'], blue: ['#2a5ad0', '#f0c030', '#d02a1a'], green: ['#5ac83a', '#d02a1a', '#2a8ad0'], cyan: ['#3ac8d8', '#f0f0e0', '#f0c030'], grey: ['#a8a8a8', '#f0f0f0', '#d84a2a'] };
function parrotSkin(kind: string): Skin {
  const [body, wing, tail] = PARROT_COLORS[kind];
  return paint(MODELS.parrot, kind.length * 3, (part, i, face, x, y, w, h, r) => {
    if (part === 'head' && i >= 2) return hx('#3a3a3a');
    if (part === 'head') return eyes(face, x, y, w, 1, 0, hx('#f0f0f0')) ?? coat(hx(body), r, face, y, h);
    if (part === 'crest') return coat(hx(tail), r, face, y, h);
    if (part === 'wingL' || part === 'wingR') return coat(y > 2 ? hx(wing) : hx(body), r, face, y, h);
    if (part === 'tail') return coat(hx(tail), r, face, y, h);
    if (part === 'legL' || part === 'legR') return hx('#5a5a5a');
    return coat(hx(body), r, face, y, h);
  });
}
function pandaSkin(brown: boolean): Skin {
  const dark = brown ? '#6a4a2a' : '#222226', light = brown ? '#c8a888' : '#f0f0ec';
  return paint(MODELS.panda, brown ? 91 : 90, (part, i, face, x, y, w, h, r) => {
    if (part === 'head' && i === 0) {
      if (face === 'front' && y >= 3 && y <= 6 && (x >= 1 && x <= 4 || x >= w - 5 && x <= w - 2)) return y === 4 && (x === 3 || x === w - 4) ? hx('#f0f0f0') : vary(hx(dark), r, 0.04);
      return coat(hx(light), r, face, y, h);
    }
    if (part === 'head' && i === 1) return face === 'front' && y === 0 && x >= 2 && x <= 4 ? hx('#1a1a1a') : coat(hx(light), r, face, y, h);
    if (part === 'head') return coat(hx(dark), r, face, y, h);
    if (part === 'body') return coat(face === 'front' || (face !== 'back' && x < 8 && face !== 'top' && face !== 'bottom') ? hx(dark) : hx(light), r, face, y, h);
    return coat(hx(dark), r, face, y, h);
  });
}
const LLAMA: Record<string, string> = { creamy: '#e8d8b0', white: '#f0ece4', brown: '#8a6040', gray: '#9a948c' };
function llamaSkin(kind: string): Skin {
  const trader = kind === 'trader';
  return quadSkin('llama', kind.length * 11, trader ? '#e8d8b0' : LLAMA[kind], {
    eyeRow: 1, eyeGap: 2,
    spots: (part, x, y, face, r) => {
      if (part === 'chestL' || part === 'chestR') return vary(hx('#8a6a3a'), r, 0.06);
      if (trader && part === 'body' && face !== 'bottom' && y < 4) return vary((x >> 1) % 2 ? hx('#3a4ab8') : hx('#d8b030'), r, 0.04);
      return null;
    },
  });
}
function turtleSkin(): Skin {
  return paint(MODELS.turtle, 121, (part, i, face, x, y, w, h, r) => {
    if (part === 'body' && i === 0) return face === 'bottom' ? vary(hx('#d8d0a0'), r, 0.04) : vary((x + y) % 5 === 0 ? hx('#2a5a2a') : hx('#3a7a3a'), r, 0.05);
    if (part === 'body') return vary(hx('#d8d0a0'), r, 0.04);
    if (part === 'egg') return vary(hx('#e8e0c8'), r, 0.03);
    if (part === 'head') return eyes(face, x, y, w, 1, 4, EYE) ?? vary(hx('#4a9a5a'), r, 0.05);
    return vary(hx('#4a9a5a'), r, 0.05);
  });
}
function dolphinSkin(): Skin {
  return paint(MODELS.dolphin, 131, (part, i, face, x, y, w, h, r) => {
    if (part === 'head' && i === 0 && face === 'front' && y === 2 && (x === 1 || x === w - 2)) return EYE;
    const belly = face === 'bottom' || (face !== 'top' && y > h * 0.6);
    return vary(belly ? hx('#d8dce0') : hx('#7a8a9a'), r, 0.04);
  });
}
function fishSkin(model: 'cod' | 'salmon'): Skin {
  return paint(MODELS[model], model.length, (part, i, face, x, y, w, h, r) => {
    if (part === 'head' && face !== 'front' && face !== 'back' && y === 1 && x === (face === 'right' ? 1 : w - 2)) return EYE;
    if (model === 'salmon') return vary(part === 'tail' || part === 'fin' ? hx('#6a2a2a') : face === 'bottom' || y > h - 2 ? hx('#c84a3a') : hx('#9a3a3a'), r, 0.05);
    return vary(part === 'tail' || part === 'fin' ? hx('#8a7a5a') : face === 'bottom' ? hx('#e0d8c0') : hx('#b0a070'), r, 0.06);
  });
}
function pufferSkin(): Skin {
  return paint(MODELS.pufferfish, 141, (part, i, face, x, y, w, h, r) => {
    if (face === 'front' && y === 1 && (x === 1 || x === w - 2)) return EYE;
    if (part === 'full' && (x + y) % 3 === 0) return hx('#f0f0d0');
    return vary(face === 'bottom' ? hx('#f0e8b0') : (x * 3 + y) % 7 === 0 ? hx('#8a7a2a') : hx('#e0c040'), r, 0.06);
  });
}
const DYE = [0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21];
/** Tropical fish: two shapes, six patterns each, a base and a pattern colour (made on first sight: name tropical_<shape>_<pattern>_<base>_<pat>). */
function tropicalSkin(shape: number, pattern: number, base: number, pat: number): Skin {
  const B0 = rgbOf(DYE[base]), P0 = rgbOf(DYE[pat]);
  return paint(MODELS[shape ? 'tropical_fish_b' : 'tropical_fish'], shape * 100 + pattern * 10 + base, (part, i, face, x, y, w, h, r) => {
    if (part === 'body' && face !== 'front' && face !== 'back' && face !== 'top' && face !== 'bottom' && y === 1 && x === (face === 'right' ? 1 : w - 2)) return EYE;
    const on = [(x + y) % 4 < 2, y < h / 2, x % 3 === 0, (x >> 1) % 2 === 0 && y > 0, x > w / 2, (x + y) % 3 === 0][pattern];
    return vary(on && part !== 'tail' ? P0 : part === 'fin' || part === 'finB' || part === 'tail' ? mix(B0, P0, 0.5) : B0, r, 0.04);
  });
}
function beeSkin(angry: boolean, nectar: boolean): Skin {
  return paint(MODELS.bee, (angry ? 2 : 0) + (nectar ? 1 : 0), (part, i, face, x, y, w, h, r) => {
    if (part === 'wingL' || part === 'wingR') return [220, 235, 250, 150];
    if (part === 'stinger' || part === 'legs') return hx('#2a2a2a');
    if (part === 'body' && i > 0) return hx('#2a2a2a');
    if (face === 'front' && y >= 2 && y <= 3 && (x === 1 || x === w - 2)) return angry ? hx('#c81a1a') : EYE;
    if (nectar && face === 'bottom' && (x + y) % 3 === 0) return hx('#f8e870');
    return vary(face !== 'front' && (y >= 2 && y <= 3 || face === 'top' && ((x >> 1) % 3 === 1)) ? hx('#3a2a1a') : hx('#f0c030'), r, 0.04);
  });
}
function mooshroomSkin(brown: boolean): Skin {
  // the cow's pattern in red (or brown) and white, with mushrooms dotted on the back
  const s = cowSkin();
  const r = new Random(brown ? 151 : 150);
  const col = hx(brown ? '#8a6a4a' : '#a8282a');
  for (let i = 0; i < s.data.length; i += 4) {
    if (!s.data[i + 3]) continue;
    const l = (s.data[i] + s.data[i + 1] + s.data[i + 2]) / 765;
    if (l < 0.55) { const c = vary(mix(col, [0, 0, 0], 0.4 - l * 0.6), r, 0.04); s.data[i] = c[0]; s.data[i + 1] = c[1]; s.data[i + 2] = c[2]; }
  }
  for (let k = 0; k < 6; k++) { const x = 26 + r.int(20), y = 6 + r.int(8); s.set(x, y, hx(brown ? '#c8a07a' : '#e8e0d0')); s.set(x + 1, y, hx(brown ? '#8a6a4a' : '#d02a2a')); }
  return s;
}

function witherSkin(invul: boolean): Skin {
  const bone = hx(invul ? '#6a7aa8' : '#3a3a3e'), dark = hx(invul ? '#4a5a88' : '#1e1e22');
  return paint(MODELS.wither, invul ? 182 : 181, (part, i, face, x, y, w, h, r) => {
    if (part.startsWith('head') && face === 'front') {
      if (y === Math.floor(h / 3) && (x === 1 || x === w - 2)) return hx('#e8e8f0');
      if (y > h / 2 && y < h - 1 && x > 0 && x < w - 1 && (x % 2 === 0)) return dark;
    }
    return vary(r.int(4) ? bone : dark, r, 0.08);
  });
}

const WT = (): Skin => {
  // the wandering trader: a blue robe with a gold trim over the villager layout (64x64)
  const s = new Skin(64, 64);
  const r = new Random(161);
  const skin = hx('#b8805e'), robe = hx('#2a4a8a'), trim = hx('#d8b030');
  s.paintBox(0, 0, 8, 10, 8, (f, x, y) => (f === 'front' && y === 4 && (x === 2 || x === 5) ? hx('#2a8a3a') : f === 'top' || y < 2 ? vary(robe, r, 0.05) : vary(skin, r, 0.04)));
  s.paintBox(24, 0, 2, 4, 2, () => vary(hx('#a86c4c'), r, 0.04));
  s.paintBox(16, 20, 8, 12, 6, (f, x, y) => (f === 'front' && (x === 3 || x === 4) ? trim : vary(robe, r, 0.05)));
  s.paintBox(0, 38, 8, 18, 6, (f, x, y) => (y === 17 || f === 'front' && (x === 3 || x === 4) ? trim : vary(robe, r, 0.05)));
  s.paintBox(44, 22, 4, 8, 4, (f, x, y) => (y > 5 ? vary(skin, r, 0.04) : vary(robe, r, 0.05)));
  s.paintBox(40, 38, 8, 4, 4, () => vary(robe, r, 0.05));
  s.paintBox(0, 22, 4, 12, 4, (f, x, y) => (y > 9 ? hx('#3a2a1a') : vary(hx('#1a2a5a'), r, 0.05)));
  return s;
};

export const MOB_SKINS3: Record<string, () => Skin> = {
  ...Object.fromEntries(Object.keys(RABBIT_COLORS).map((k) => ['rabbit_' + k, () => rabbitSkin(k)])),
  fox: () => foxSkin(false), fox_snow: () => foxSkin(true),
  ...Object.fromEntries(Object.keys(CAT_COATS).filter((k) => k !== 'ocelot').map((k) => ['cat_' + k, () => catSkin(k)])), ocelot: () => catSkin('ocelot'),
  ...Object.fromEntries(Object.keys(PARROT_COLORS).map((k) => ['parrot_' + k, () => parrotSkin(k)])),
  polar_bear: () => quadSkin('polar_bear', 171, '#f0f0ea', { nose: '#e8e8e0', eyeRow: 2, eyeGap: 4, spots: (part, x, y, face) => (part === 'head' && face === 'front' && y === 0 && x >= 2 && x <= 2 ? hx('#1a1a1a') : null) }),
  panda: () => pandaSkin(false), panda_brown: () => pandaSkin(true),
  ...Object.fromEntries(Object.keys(LLAMA).map((k) => ['llama_' + k, () => llamaSkin(k)])), llama_trader: () => llamaSkin('trader'),
  turtle: turtleSkin, dolphin: dolphinSkin, cod: () => fishSkin('cod'), salmon: () => fishSkin('salmon'), pufferfish: pufferSkin,
  bee: () => beeSkin(false, false), bee_angry: () => beeSkin(true, false), bee_nectar: () => beeSkin(false, true), bee_angry_nectar: () => beeSkin(true, true),
  mooshroom: () => mooshroomSkin(false), brown_mooshroom: () => mooshroomSkin(true), wandering_trader: WT,
  wither: () => witherSkin(false), wither_invul: () => witherSkin(true),
  armor_stand: () => paint(MODELS.armor_stand, 191, (part, i, face, x, y, w, h, r) => (part === 'plate' ? vary(hx('#8a8a8a'), r, 0.05) : vary(face === 'top' ? hx('#b8945f') : hx('#a2824e'), r, 0.06))),
};
/** Skins made when first needed (the tropical fish's many colourings). */
export function lazySkin(name: string): Skin | null {
  const m = /^tropical_(\d)_(\d)_(\d+)_(\d+)$/.exec(name);
  if (m) return tropicalSkin(+m[1], +m[2], +m[3], +m[4]);
  return null;
}

// ------------------------------------------------------------------ poses
const c = Math.cos, s = Math.sin;
const legs = (ls: number, lsa: number, amp = 1.4): Record<string, [number, number, number]> => ({
  fl: [c(ls * 0.6662) * amp * lsa, 0, 0], fr: [c(ls * 0.6662 + Math.PI) * amp * lsa, 0, 0],
  bl: [c(ls * 0.6662 + Math.PI) * amp * lsa, 0, 0], br: [c(ls * 0.6662) * amp * lsa, 0, 0],
});
const quadPose = (extra?: (p: PoseCtx, pose: Record<string, [number, number, number]>, offs: Record<string, [number, number, number]>) => string | void) => (p: PoseCtx): PoseOut => {
  const pose: Record<string, [number, number, number]> = { head: [p.hp, p.netHead, 0], ...legs(p.ls, p.lsa) };
  const offs: Record<string, [number, number, number]> = {};
  const skin = extra?.(p, pose, offs) ?? undefined;
  return { pose, offs, skin: skin || undefined };
};
const fishPose = (p: PoseCtx): PoseOut => {
  const w = (p.e.wiggle as number) ?? p.age * 0.3;
  const k = (p.e.inWater as boolean) === false ? 1.7 : 1;
  return { pose: { tail: [0, s(w) * 0.45 * k, 0], back: [0, s(w) * 0.2 * k, 0] } };
};

export const MOB_POSES3: Record<string, (p: PoseCtx) => PoseOut> = {
  rabbit: quadPose((p, pose) => {
    const hop = Math.min(1, ((p.e.hop as number) ?? 10) / 10);
    const j = s(hop * Math.PI) * (p.e.onGround ? 0 : 1);
    pose.bl = pose.br = [j * 0.9, 0, 0]; pose.fl = pose.fr = [-j * 0.6, 0, 0];
    pose.earL = pose.earR = [p.hp - 0.26, p.netHead, 0];
  }),
  fox: quadPose((p, pose, offs) => {
    if (p.e.sleeping) {
      // curled up: legs tucked, tail around
      for (const l of ['fl', 'fr', 'bl', 'br']) { pose[l] = [Math.PI / 2, 0, 0]; offs[l] = [0, 3, 0]; }
      offs.body = [0, 3, 0]; offs.head = [1, 6, 2]; pose.head = [0.3, -0.8, 0.3]; pose.tail = [Math.PI / 2, -1.2, 0]; offs.tail = [0, 4, 0];
      return;
    }
    pose.tail = [Math.PI / 2 - 0.4 + c(p.ls * 0.6662) * 0.3 * p.lsa, 0, 0];
  }),
  cat: quadPose((p, pose, offs) => {
    if (p.e.sitting) {
      pose.body = [-Math.PI / 4, 0, 0]; offs.body = [0, -1, 0];
      offs.head = [0, -3, 2]; pose.bl = pose.br = [-Math.PI / 2, 0, 0]; offs.bl = offs.br = [0, 2, -3];
      pose.fl = pose.fr = [-0.157, 0, 0]; offs.fl = offs.fr = [0, -1, 1];
      pose.tail = [1.4, 0, 0]; offs.tail = [0, 7, -2]; pose.tail2 = [2.4, 0, 0]; offs.tail2 = [0, 6, -6];
      return;
    }
    pose.tail = [0.9 + c(p.ls) * 0.2 * p.lsa, 0, 0];
    pose.tail2 = [1.7 + c(p.ls) * 0.4 * p.lsa, 0, 0];
  }),
  parrot: (p) => {
    const pose: Record<string, [number, number, number]> = { head: [p.hp, p.netHead, 0], crest: [p.hp - 0.21, p.netHead, 0] };
    const offs: Record<string, [number, number, number]> = {};
    const flying = !(p.e.onGround as boolean) && !(p.e.sitting as boolean);
    const f = (p.e.flap as number) ?? 0;
    const flap = flying ? c(p.age * 1.4) * 0.8 : 0;
    pose.wingL = [-0.69, -Math.PI, -0.1 - flap]; pose.wingR = [-0.69, -Math.PI, 0.1 + flap];
    if (!flying) { pose.legL = [c(p.ls * 0.6662) * 1.4 * p.lsa, 0, 0]; pose.legR = [c(p.ls * 0.6662 + Math.PI) * 1.4 * p.lsa, 0, 0]; }
    if (p.e.dancing) { const d = s(p.age * 0.6) * 1.5; for (const k of ['head', 'crest', 'body', 'wingL', 'wingR', 'tail']) offs[k] = [d, 0, 0]; }
    if (p.e.sitting) for (const k of ['head', 'crest', 'body', 'wingL', 'wingR', 'tail']) offs[k] = [0, 1.9, 0];
    void f;
    return { pose, offs };
  },
  polar_bear: quadPose((p, pose, offs) => {
    const st = (p.e.standing as number) ?? 0;
    if (st > 0.01) {
      pose.body = [-st * Math.PI / 4, 0, 0]; pose.head = [p.hp - st * 0.3, p.netHead, 0];
      offs.head = [0, -st * 9, st * 6]; offs.fl = offs.fr = [0, -st * 10, st * 9];
      pose.fl = pose.fr = [-st * 0.8, 0, 0];
    }
  }),
  panda: quadPose((p, pose, offs) => {
    if ((p.e.sittingT as number) > 0 || (p.e.eating as number) > 0) {
      pose.body = [-Math.PI / 4, 0, 0]; offs.body = [0, -2, 4]; offs.head = [0, -9, 9]; pose.head = [0.3, p.netHead, 0];
      pose.fl = pose.fr = [-1.2, 0, 0]; offs.fl = offs.fr = [0, -6, 9]; pose.bl = pose.br = [-1.4, 0, 0]; offs.bl = offs.br = [0, 3, -2];
    }
    if ((p.e.rolling as number) > 0) { const a = (30 - (p.e.rolling as number)) / 30 * Math.PI * 2; for (const k of ['body', 'head', 'fl', 'fr', 'bl', 'br']) pose[k] = [a, 0, 0]; }
    if (p.e.gene === 6) return 'panda_brown';
  }),
  llama: quadPose((p, pose) => { pose.head = [p.hp * 0.5, p.netHead, 0]; }),
  turtle: (p) => {
    const sw = p.e.inWater ? c(p.ls * 0.6662) * 0.6 * p.lsa + s(p.age * 0.15) * 0.15 : c(p.ls * 0.6662 * 0.6) * 0.5 * p.lsa;
    return { pose: { head: [p.hp, p.netHead, 0], fl: [0, sw, 0], fr: [0, -sw, 0], bl: [0, -sw * 0.5, 0], br: [0, sw * 0.5, 0] }, skip: p.e.hasEgg ? undefined : new Set(['egg']) };
  },
  dolphin: (p) => {
    const w = p.age * 0.3, a = s(w) * 0.25 * (0.4 + p.lsa);
    const pose: Record<string, [number, number, number]> = { tail: [a, 0, 0], fluke: [a * 1.6, 0, 0] };
    const offs: Record<string, [number, number, number]> = { fluke: [0, -s(a) * 10, (c(a) - 1) * 10] };
    return { pose, offs };
  },
  cod: fishPose, salmon: fishPose, tropical_fish: fishPose, tropical_fish_b: fishPose,
  wither: (p) => {
    const sy = (p.e.sideYaw as number[]) ?? [0, 0];
    const sway = c(p.age * 0.1) * 0.05;
    const invul = (p.e.invul as number) > 0;
    return {
      pose: { head: [p.hp, p.netHead, 0], headL: [p.hp * 0.5, (sy[1] * Math.PI) / 180, 0], headR: [p.hp * 0.5, (sy[0] * Math.PI) / 180, 0], spine: [0.2 + sway, 0, 0], tail: [0.5 + sway * 2, 0, 0] },
      offs: { tail: [0, c(0.2 + sway) * 10 - 10, s(0.2 + sway) * 10 - 2] },
      skin: invul && Math.floor(p.age / 5) % 2 ? 'wither_invul' : 'wither',
    };
  },
  pufferfish: (p) => {
    const puff = (p.e.puff as number) ?? 0;
    return { pose: { tail: [0, s(p.age * 0.3) * 0.4, 0] }, skip: new Set(['small', 'mid', 'full'].filter((_, i) => i !== puff)) };
  },
  bee: (p) => {
    const f = c(p.age * 2.1) * Math.PI * 0.15;
    const bob = s(p.age * 0.18) * 0.5;
    const offs: Record<string, [number, number, number]> = {};
    for (const k of ['body', 'stinger', 'wingL', 'wingR', 'legs']) offs[k] = [0, bob, 0];
    return {
      pose: { body: [p.hp * 0.3, 0, 0], wingL: [0, -0.26, f], wingR: [0, 0.26, -f] },
      offs, skip: p.e.stung ? new Set(['stinger']) : undefined,
      skin: 'bee' + (p.e.angry ? '_angry' : '') + (p.e.nectar ? '_nectar' : ''),
    };
  },
};
