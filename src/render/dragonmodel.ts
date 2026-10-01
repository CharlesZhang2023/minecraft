// The Ender Dragon's model and procedurally painted skin. Every box is auto-packed into a 512x512 skin sheet.
// Model space matches the other entity models (pixels, y down, front toward -z); the renderer scales it up.
import { Random } from '../noise';
import { ModelDef, ModelPart, ModelBox, Skin } from './models';

interface Spec { key: string; x: number; y: number; z: number; w: number; h: number; d: number }
const spec = (key: string, x: number, y: number, z: number, w: number, h: number, d: number): Spec => ({ key, x, y, z, w, h, d });

// part name -> boxes
const PARTS: Record<string, Spec[]> = {
  body: [
    spec('body', -12, -12, -32, 24, 24, 64),
    spec('spine1', -1, -16, -26, 2, 4, 6), spec('spine2', -1, -16, -12, 2, 4, 6), spec('spine3', -1, -16, 2, 2, 4, 6), spec('spine4', -1, -16, 16, 2, 4, 6), spec('spine5', -1, -16, 28, 2, 4, 6),
  ],
  neck: [spec('neck', -5, -5, -5, 10, 10, 10), spec('neckSpine', -1, -9, -3, 2, 4, 6)],
  tail: [spec('tail', -5, -5, -5, 10, 10, 10), spec('tailSpine', -1, -9, -3, 2, 4, 6)],
  head: [
    spec('skull', -8, -8, -8, 16, 16, 16),
    spec('snout', -6, -2, -24, 12, 6, 16),
    spec('nostrilL', 3, -4, -22, 2, 2, 4), spec('nostrilR', -5, -4, -22, 2, 2, 4),
    spec('hornL', 4, -12, -2, 3, 5, 3), spec('hornR', -7, -12, -2, 3, 5, 3),
    spec('teethTop', -5, 4, -23, 10, 2, 14),
  ],
  jaw: [spec('jaw', -6, 0, -16, 12, 4, 16), spec('teethBot', -5, -2, -15, 10, 2, 12)],
  eyes: [spec('eyeL', 3, -5, -9, 3, 2, 1), spec('eyeR', -6, -5, -9, 3, 2, 1)],
  wing: [spec('wingBone', -56, -4, -4, 56, 8, 8), spec('wingMem', -56, 0, 2, 56, 1, 56)],
  wingTip: [spec('tipBone', -56, -2, -2, 56, 4, 4), spec('tipMem', -56, 0, 2, 56, 1, 56)],
  foreLeg: [spec('foreThigh', -4, 0, -4, 8, 20, 8), spec('foreShin', -3, 20, -3, 6, 18, 6), spec('foreFoot', -4, 36, -10, 8, 4, 12)],
  hindLeg: [spec('hindThigh', -6, 0, -6, 12, 24, 12), spec('hindShin', -4, 24, -4, 8, 22, 8), spec('hindFoot', -6, 44, -12, 12, 4, 16)],
};

const SW = 512, SH = 512;
const uv = new Map<string, [number, number]>();
let cx = 0, cy = 0, rowH = 0;
for (const list of Object.values(PARTS))
  for (const s of list) {
    const W = Math.ceil(2 * (s.w + s.d)), H = Math.ceil(s.h + s.d);
    if (cx + W > SW) { cx = 0; cy += rowH; rowH = 0; }
    uv.set(s.key, [cx, cy]);
    cx += W;
    rowH = Math.max(rowH, H);
  }

const toBox = (s: Spec): ModelBox => {
  const [u, v] = uv.get(s.key)!;
  return { x: s.x, y: s.y, z: s.z, w: s.w, h: s.h, d: s.d, u, v };
};

export function dragonModel(): ModelDef {
  const parts: ModelPart[] = Object.entries(PARTS).map(([name, list]) => ({ name, px: 0, py: 0, pz: 0, boxes: list.map(toBox) }));
  return { texW: SW, texH: SH, parts };
}

type RGB = [number, number, number];
const hx = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const vary = (c: RGB, r: Random, amt = 0.1): RGB => {
  const f = 1 + (r.next() - 0.5) * 2 * amt;
  return c.map((x) => Math.max(0, Math.min(255, Math.round(x * f)))) as RGB;
};

export function dragonSkin(): Skin {
  const s = new Skin(SW, SH);
  const r = new Random(5150);
  const scale = [hx('#2b2431'), hx('#332a3a'), hx('#3b3043'), hx('#251e2b')];
  const belly = hx('#4e4058'), spine = hx('#74608a'), mem = hx('#1d1526'), vein = hx('#42305a'), tooth = hx('#e0d8e8'), horn = hx('#5a4c66');
  const eye = hx('#e060ff');
  for (const list of Object.values(PARTS))
    for (const sp of list) {
      const [u, v] = uv.get(sp.key)!;
      s.paintBox(u, v, sp.w, Math.max(1, sp.h), sp.d, (f, x, y, fw, fh) => {
        const k = sp.key;
        if (k === 'eyeL' || k === 'eyeR') return vary(eye, r, 0.12);
        if (k.startsWith('spine') || k === 'neckSpine' || k === 'tailSpine') return vary(spine, r, 0.15);
        if (k.startsWith('teeth')) return vary(tooth, r, 0.08);
        if (k.startsWith('horn')) return vary(y < 2 ? tooth : horn, r, 0.1);
        if (k === 'wingMem' || k === 'tipMem') {
          // membrane: dark with fan-shaped veins radiating from the shoulder
          const onVein = (x + y * 2) % 11 === 0 || (x * 2 + y) % 17 === 0;
          return onVein ? vary(vein, r, 0.2) : vary(mem, r, 0.12);
        }
        if (k === 'body' && f === 'bottom') return vary(belly, r, 0.12);
        if (k === 'body' && (f === 'left' || f === 'right') && y > fh * 0.65) return vary(belly, r, 0.1);
        if (k === 'skull' && f === 'front' && y === 5 && (x < 4 || x > 11)) return vary(hx('#3a2a44'), r, 0.1);
        if (k === 'snout' && f === 'front' && y === 2 && (x === 3 || x === 8)) return hx('#08060a');
        if (k.startsWith('nostril')) return hx('#06040a');
        // scales: blotchy dark with lighter edge pixels
        const base = scale[(x * 3 + y * 5 + ((x >> 2) ^ (y >> 2))) & 3];
        return vary(r.int(9) === 0 ? vein : base, r, 0.1);
      });
    }
  return s;
}
