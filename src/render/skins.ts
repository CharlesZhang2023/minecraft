// Player skins: the built-in characters (painted here, pixel by pixel, in the modern 64x64 layout with its
// second "overlay" layer for hats, jackets, sleeves and trousers), and skins imported from PNG files (64x64, or
// old 64x32 ones, which are widened the way the real game does it).
//
// A player's look travels as one string: a built-in id ("steve", "alex"...) or a PNG data URL, plus whether the
// arms are slim (3 pixels wide) or classic (4).
import { Skin } from './models';
import { Random } from '../noise';
import { SKIN_PIXELS } from './skinpixels';

type C = [number, number, number] | [number, number, number, number];
type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

/** Where a painter is: the face, the pixel on it, the face size, and for limbs which side ('r' = the character's right). */
export interface At {
  f: Face; x: number; y: number; w: number; h: number;
  side: 'r' | 'l' | 'c';
  /** Front, back, top, bottom: columns counted from the outer edge (limbs) or the character's right (head, body). */
  ox: number;
  /** Sides: columns counted from the front edge. */
  fx: number;
  /** Is this the side face away from the body (limbs), or any side face (head, body)? */
  outer: boolean;
}
type Fn = (a: At) => C | null | undefined;

const hex = (h: string): C => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const mul = (c: C, k: number): C => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
const mix = (a: C, b: C, t: number): C => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

type PartName = 'head' | 'hat' | 'body' | 'jacket' | 'rArm' | 'rSleeve' | 'lArm' | 'lSleeve' | 'rLeg' | 'rPants' | 'lLeg' | 'lPants';
/** Texture origin (u, v) of each part in the 64x64 layout. */
const UV: Record<PartName, [number, number]> = {
  head: [0, 0], hat: [32, 0], body: [16, 16], jacket: [16, 32],
  rArm: [40, 16], rSleeve: [40, 32], lArm: [32, 48], lSleeve: [48, 48],
  rLeg: [0, 16], rPants: [0, 32], lLeg: [16, 48], lPants: [0, 48],
};

/** Paints the parts of a 64x64 skin, with a little per-pixel grain so flat colours look like cloth and skin. */
class Painter {
  skin = new Skin(64, 64);
  r: Random;
  constructor(seed: number, public slim: boolean, public grain = 0.035) { this.r = new Random(seed); }

  private size(p: PartName): [number, number, number] {
    if (p === 'head' || p === 'hat') return [8, 8, 8];
    if (p === 'body' || p === 'jacket') return [8, 12, 4];
    if (p.endsWith('Arm') || p.endsWith('Sleeve')) return [this.slim ? 3 : 4, 12, 4];
    return [4, 12, 4];
  }

  paint(p: PartName, fn: Fn) {
    const [u, v] = UV[p], [w, h, d] = this.size(p);
    const side: 'r' | 'l' | 'c' = p[0] === 'r' ? 'r' : p[0] === 'l' ? 'l' : 'c';
    this.skin.paintBox(u, v, w, h, d, (f, x, y, fw, fh) => {
      // count columns from the limb's outer edge, so left and right limbs can share one painter
      let ox = x;
      if (side === 'l' && (f === 'front' || f === 'top' || f === 'bottom')) ox = fw - 1 - x;
      if (side === 'r' && f === 'back') ox = fw - 1 - x;
      const fx = f === 'right' ? fw - 1 - x : x;
      const outer = side === 'c' ? f === 'left' || f === 'right' : (side === 'r' ? f === 'right' : f === 'left');
      const c = fn({ f, x, y, w: fw, h: fh, side, ox, fx, outer });
      if (!c) return null;
      if (c.length === 4 && c[3] === 0) return null;
      const g = 1 + (this.r.next() - 0.5) * 2 * this.grain;
      const out = mul(c, g).map(Math.round) as C;
      return c.length === 4 ? [out[0], out[1], out[2], c[3]] : out;
    });
  }
  arms(fn: Fn) { this.paint('rArm', fn); this.paint('lArm', fn); }
  sleeves(fn: Fn) { this.paint('rSleeve', fn); this.paint('lSleeve', fn); }
  legs(fn: Fn) { this.paint('rLeg', fn); this.paint('lLeg', fn); }
  pants(fn: Fn) { this.paint('rPants', fn); this.paint('lPants', fn); }
}

// ---------------------------------------------------------------------------------------------- a generic character
interface Spec {
  seed: number;
  slim?: boolean;
  skin: C;
  eyes: C;
  hair?: C;
  hairStyle?: 'short' | 'long' | 'messy' | 'bald' | 'bob';
  brows?: boolean;
  mouth?: 'steve' | 'small';
  beard?: C;
  shirt: C;
  sleeves?: 'short' | 'long' | 'none';
  /** Pants also cover the bottom rows of the body (a waistband). */
  pants: C;
  shorts?: boolean;
  shoes: C;
  belt?: C;
  buckle?: C;
  gloves?: C;
}

function character(s: Spec): Painter {
  const P = new Painter(s.seed, !!s.slim);
  const sk = s.skin, skD = mul(sk, 0.86), skL = mul(sk, 1.06), hair = s.hair ?? sk, hairD = mul(hair, 0.8);
  const style = s.hairStyle ?? 'short';
  const hairAt = (a: At): boolean => {
    if (style === 'bald') return false;
    const { f, x, y } = a;
    if (f === 'top') return true;
    if (f === 'back') return style !== 'short' || y <= 6;
    if (f === 'front') {
      if (y <= 1) return true;
      if (y === 2) return style === 'messy' ? (x * 5 + 3) % 3 !== 1 : x === 0 || x === 7 || (style === 'bob' && x !== 3 && x !== 4);
      if (style === 'long' || style === 'bob') return (x === 0 || x === 7) && y <= (style === 'long' ? 7 : 5);
      return false;
    }
    if (f === 'bottom') return false;
    // sides, fx = columns from the face
    if (y <= 2) return true;
    if (style === 'long') return a.fx >= 1 || y <= 4;
    if (style === 'bob') return y <= 6 && a.fx >= 1;
    return y <= 5 && a.fx >= 3 + (y >= 4 ? 2 : 0) - (style === 'messy' ? 1 : 0);
  };
  P.paint('head', (a) => {
    const { f, x, y } = a;
    if (hairAt(a)) return (x + y * 3) % 5 === 0 ? hairD : hair;
    if (f === 'bottom') return skD;
    if (f !== 'front') return a.fx === 3 && y === 4 && f !== 'top' && f !== 'back' ? skD : sk; // a hint of an ear
    // the face
    if (s.beard && y >= 5 && !(y === 6 && (x === 3 || x === 4))) return y === 5 && x !== 0 && x !== 7 && (x === 3 || x === 4) ? skD : s.beard;
    if (y === 3 && s.brows !== false && (x === 1 || x === 2 || x === 5 || x === 6)) return style === 'bald' ? skD : mix(hair, sk, 0.25);
    if (y === 4) {
      if (x === 1 || x === 6) return [245, 245, 245];
      if (x === 2 || x === 5) return s.eyes;
    }
    if (y === 5 && (x === 3 || x === 4)) return mul(sk, 0.82);
    if (y === 6) {
      const m = s.mouth ?? 'steve';
      if (m === 'steve' && x >= 2 && x <= 5) return x === 2 || x === 5 ? skD : mul(sk, 0.58);
      if (m === 'small' && (x === 3 || x === 4)) return mix(sk, hex('#b05050'), 0.4);
    }
    if (y === 7) return mul(sk, 0.95);
    return x === 0 || x === 7 ? mul(sk, 0.97) : y < 3 ? skL : sk;
  });
  const shirtD = mul(s.shirt, 0.85);
  P.paint('body', (a) => {
    const { f, x, y } = a;
    if (s.beard && f === 'front' && ((y <= 1 && x >= 2 && x <= 5) || (y === 2 && x >= 3 && x <= 4))) return s.beard;
    if (f === 'top') return s.shirt;
    if (f === 'bottom') return s.pants;
    if (y >= 10) return y === 10 && s.belt ? (s.buckle && f === 'front' && (x === 3 || x === 4) ? s.buckle : s.belt) : s.pants;
    if (f === 'front' && y === 0 && (x === 3 || x === 4)) return skD;
    return y === 9 ? shirtD : s.shirt;
  });
  P.arms((a) => {
    const { f, y } = a;
    if (s.gloves && (y >= 10 || f === 'bottom')) return s.gloves;
    if (f === 'bottom') return skD;
    const sl = s.sleeves ?? 'short';
    if (f === 'top') return sl === 'none' ? sk : s.shirt;
    if (sl === 'long') return y <= 9 ? (y === 9 ? shirtD : s.shirt) : y === 11 ? skD : sk;
    if (sl === 'short' && y <= 3) return y === 3 ? shirtD : s.shirt;
    return y === 11 ? skD : sk;
  });
  P.legs((a) => {
    const { f, y } = a;
    if (f === 'bottom' || y >= 10) return y === 11 || f === 'bottom' ? mul(s.shoes, 0.8) : s.shoes;
    if (f === 'top') return s.pants;
    if (s.shorts && y >= 5) return y === 5 ? skD : sk;
    return y === 0 ? mul(s.pants, 0.88) : s.pants;
  });
  return P;
}

// ---------------------------------------------------------------------------------------------- the characters
/** A small symbol drawn from rows of '#' (colour a) and '+' (colour b). */
function glyph(rows: string[], a: C, b?: C) {
  return (x: number, y: number): C | null => {
    const ch = rows[y]?.[x];
    return ch === '#' ? a : ch === '+' ? b ?? a : null;
  };
}

function steve() {
  return character({
    seed: 1, skin: hex('#b4846d'), eyes: hex('#4a3a8a'), hair: hex('#3a2812'), hairStyle: 'short',
    shirt: hex('#00a8a8'), sleeves: 'short', pants: hex('#3438a0'), shoes: hex('#5f5f5f'),
  }).skin;
}

function alex() {
  const hair = hex('#e3823a'), hairD = hex('#c3622a');
  const P = character({
    seed: 2, slim: true, skin: hex('#f2c7a4'), eyes: hex('#3f8c3f'), hair, hairStyle: 'long', mouth: 'small',
    shirt: hex('#7bb85e'), sleeves: 'short', pants: hex('#6b4a2b'), shoes: hex('#4d3a2a'), belt: hex('#4a3020'), buckle: hex('#c9a94a'),
  });
  // a side-swept fringe and a ponytail on the overlay
  P.paint('hat', ({ f, x, y, fx }) => {
    if (f === 'front') return y === 0 || (y === 1 && x <= 5) || (y === 2 && x <= 2) ? (x + y) % 3 === 0 ? hairD : hair : null;
    if (f === 'back') return y >= 5 && x >= 3 && x <= 4 ? hairD : null;
    if (f === 'top') return null;
    return (f === 'left' || f === 'right') && y >= 2 && y <= 6 && fx === 0 ? hair : null;
  });
  P.paint('jacket', ({ f, y, x }) => (f === 'back' && y <= 4 && x >= 3 && x <= 4 ? (y % 2 ? hairD : hair) : null));
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && y <= 1 && x >= 2 && x <= 5) return y === 0 && (x === 3 || x === 4) ? hex('#e2b394') : hex('#c9a874');
    if (y >= 10) return y === 10 ? (f === 'front' && (x === 3 || x === 4) ? hex('#c9a94a') : hex('#4a3020')) : hex('#6b4a2b');
    return y >= 8 ? hex('#6aa64f') : hex('#7bb85e');
  });
  return P.skin;
}

function knight() {
  const steel = hex('#b3b9c1'), steelD = hex('#848b95'), steelL = hex('#d4d9df'), mail = hex('#8c939c'), mailD = hex('#6c727b');
  const blue = hex('#2f56b0'), blueD = hex('#22408a'), gold = hex('#e8b93c'), red = hex('#b52a2a');
  const P = character({
    seed: 3, skin: hex('#c79172'), eyes: hex('#3b5bb0'), hair: hex('#5a3b22'), hairStyle: 'short', beard: hex('#5a3b22'),
    shirt: mail, sleeves: 'long', pants: mail, shoes: steelD, gloves: steelD,
  });
  const chain = ({ x, y }: At) => ((x + y) % 2 ? mail : mailD);
  P.paint('body', (a) => chain(a));
  P.arms((a) => (a.y >= 10 || a.f === 'bottom' ? steelD : chain(a)));
  P.legs((a) => (a.y >= 10 || a.f === 'bottom' ? steelD : chain(a)));
  // the great helm, with a slit to see through and a plume
  P.paint('hat', ({ f, x, y }) => {
    if (f === 'top') return x >= 3 && x <= 4 ? red : steel;
    if (f === 'bottom') return null;
    if (f === 'front') {
      if (y === 4 && x >= 1 && x <= 6) return [20, 22, 26];
      if (y === 3) return steelL;
      if (y >= 5 && (x === 3 || x === 4)) return steelD;
      if (y === 6 && (x === 1 || x === 6)) return [40, 42, 48];
      return x === 0 || x === 7 ? steelD : steel;
    }
    return y === 7 ? steelD : y === 0 ? steelL : steel;
  });
  // the tabard: blue with a gold cross, belted
  P.paint('jacket', ({ f, x, y }) => {
    if (f === 'top' || f === 'bottom' || f === 'left' || f === 'right') return null;
    if (y === 9) return f === 'front' && (x === 3 || x === 4) ? gold : hex('#5a3a22');
    if (x === 0 || x === 7) return null;
    if (y === 0) return blueD;
    if (f === 'front' && ((x >= 3 && x <= 4 && y >= 2 && y <= 7) || (y === 4 && x >= 2 && x <= 5))) return gold;
    if (y === 11) return gold;
    return y >= 10 ? blueD : blue;
  });
  // pauldrons and greaves
  P.sleeves(({ f, y }) => (f === 'bottom' ? null : y <= 3 ? (y === 3 ? steelD : f === 'top' || y === 0 ? steelL : steel) : y >= 9 ? steel : null));
  P.pants(({ f, y }) => (f === 'top' || f === 'bottom' ? null : y >= 5 && y <= 9 ? (y === 5 ? steelL : y === 9 ? steelD : steel) : null));
  return P.skin;
}

function astronaut() {
  const white = hex('#eef0f3'), whiteD = hex('#c8ccd3'), gray = hex('#8f96a0'), grayD = hex('#626a75');
  const visor = (y: number) => mix(hex('#f2c75a'), hex('#a8672a'), y / 7);
  const P = character({
    seed: 4, skin: hex('#d9a585'), eyes: hex('#2b2b2b'), hair: hex('#2a1a10'), hairStyle: 'short',
    shirt: white, sleeves: 'long', pants: white, shoes: grayD, gloves: gray,
  });
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && y >= 2 && y <= 6 && x >= 1 && x <= 4) {
      if (y === 2 || y === 6 || x === 1 || x === 4) return grayD;
      return y === 3 ? (x === 2 ? hex('#e84a4a') : hex('#4ad86a')) : y === 4 ? (x === 2 ? hex('#4a8ae8') : hex('#f0d040')) : hex('#2c3038');
    }
    if (f === 'front' && y >= 2 && y <= 4 && x === 6) return hex('#2a62c8'); // a mission patch
    if (y === 9) return gray;
    return x === 0 && f === 'front' ? whiteD : white;
  });
  P.arms(({ f, y, ox, outer }) => {
    if (y >= 10 || f === 'bottom') return gray;
    if (y === 9) return grayD;
    if (outer && y >= 1 && y <= 3 && ox >= 0) return y === 2 ? hex('#ffffff') : hex('#e04a3a'); // flag stripes
    return y === 4 ? whiteD : white;
  });
  P.legs(({ f, y }) => (y >= 9 || f === 'bottom' ? (y === 9 ? gray : grayD) : y === 5 ? whiteD : white));
  // the helmet and its gold visor
  P.paint('hat', ({ f, x, y }) => {
    if (f === 'bottom') return null;
    if (f === 'front') {
      if (y >= 2 && y <= 6 && x >= 1 && x <= 6) {
        if ((x === 2 && y === 3) || (x === 3 && y === 2) || (x === 2 && y === 4 && false)) return [255, 250, 225];
        return visor(y);
      }
      if (y >= 1 && y <= 7 && (y === 1 || y === 7 || x === 0 || x === 7)) return gray;
      return white;
    }
    if (f === 'top') return x === 3 || x === 4 ? whiteD : white;
    if ((f === 'left' || f === 'right') && y >= 3 && y <= 5 && (x === 3 || x === 4)) return y === 4 ? grayD : gray; // ear valves
    return y === 7 ? whiteD : white;
  });
  // the life-support pack
  P.paint('jacket', ({ f, x, y }) => {
    if (f !== 'back') return null;
    if (y >= 1 && y <= 9 && x >= 1 && x <= 6) return y === 1 || y === 9 || x === 1 || x === 6 ? gray : y === 3 && x >= 3 && x <= 4 ? hex('#4ad86a') : whiteD;
    return null;
  });
  return P.skin;
}

function ninja() {
  const suit = hex('#24273a'), suitD = hex('#191b29'), red = hex('#c42a2a'), redD = hex('#8e1c1c'), wrap = hex('#7f8496');
  const P = character({
    seed: 5, skin: hex('#d9a27c'), eyes: hex('#1d1d1d'), hairStyle: 'bald', brows: false,
    shirt: suit, sleeves: 'long', pants: suit, shoes: suitD, gloves: suitD,
  });
  P.paint('head', ({ f, x, y }) => {
    if (f === 'front' && y >= 3 && y <= 4 && x >= 1 && x <= 6) {
      if (y === 4 && (x === 2 || x === 5)) return [24, 24, 28];
      if (y === 4 && (x === 1 || x === 6)) return [240, 240, 240];
      return y === 3 && (x === 1 || x === 6) ? hex('#c08a66') : hex('#d9a27c');
    }
    return (x + y) % 7 === 0 ? suitD : suit;
  });
  P.paint('body', ({ f, x, y }) => {
    if (y === 9) return f === 'front' && (x === 3 || x === 4) ? redD : red;
    if (f === 'front' && Math.abs(x - (7 - y)) <= 0 && y <= 8) return suitD; // the fold of the jacket
    return y >= 10 ? suitD : suit;
  });
  P.arms(({ f, y }) => (y >= 10 || f === 'bottom' ? suitD : y >= 7 && y <= 9 ? (y % 2 ? wrap : mul(wrap, 0.8)) : suit));
  P.legs(({ f, y }) => (y >= 10 || f === 'bottom' ? suitD : y >= 7 && y <= 9 ? (y % 2 ? wrap : mul(wrap, 0.8)) : suit));
  // the headband, tied at the back with its tails hanging down
  P.paint('hat', ({ f, x, y }) => {
    if (f === 'top' || f === 'bottom') return null;
    if (y === 2) return red;
    if (f === 'back' && ((x === 3 && y >= 3 && y <= 6) || (x === 5 && y >= 3 && y <= 5))) return y % 2 ? redD : red;
    if (f === 'front' && y === 1 && (x === 3 || x === 4)) return hex('#e8e8e8'); // a little emblem
    return null;
  });
  return P.skin;
}

function wizard() {
  const robe = hex('#5a3aa0'), robeD = hex('#44297d'), gold = hex('#f0cf52'), beard = hex('#ebebeb'), beardD = hex('#c9c9c9');
  const star = (x: number, y: number) => (x * 7 + y * 13) % 23 === 0;
  const P = character({
    seed: 6, skin: hex('#e3b08e'), eyes: hex('#3a7ee0'), hair: beard, hairStyle: 'long', beard,
    shirt: robe, sleeves: 'long', pants: robe, shoes: hex('#3a2a1a'),
  });
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && ((y <= 3 && x >= 2 && x <= 5) || (y <= 5 && x >= 3 && x <= 4))) return (x + y) % 3 ? beard : beardD;
    if (y === 9) return gold;
    if (star(x + (f === 'back' ? 3 : 0), y)) return gold;
    return y >= 10 ? robeD : robe;
  });
  P.arms(({ f, y, x }) => (f === 'bottom' || y >= 11 ? hex('#e3b08e') : y >= 9 ? gold : star(x + 2, y) ? gold : robe));
  P.legs(({ f, y, x }) => (f === 'bottom' || y === 11 ? hex('#3a2a1a') : y === 10 ? gold : star(x + 5, y) ? gold : y >= 8 ? robeD : robe));
  // the hood, trimmed in gold
  P.paint('hat', ({ f, x, y, fx }) => {
    if (f === 'bottom') return null;
    if (f === 'front') return y <= 1 ? (y === 1 ? gold : robe) : (x === 0 || x === 7) && y <= 6 ? gold : null;
    if (f === 'left' || f === 'right') return fx === 0 ? (y <= 6 ? gold : null) : robe;
    return star(x, y) ? gold : robe;
  });
  P.paint('jacket', ({ f, x, y }) => (f === 'front' && y <= 6 && (x === 1 || x === 6) ? gold : f === 'back' && y <= 2 ? robeD : null));
  return P.skin;
}

function scientist() {
  const coat = hex('#f2f3f5'), coatD = hex('#d3d8de'), shirt = hex('#4a78c0'), tie = hex('#c33333');
  const P = character({
    seed: 7, skin: hex('#e8b896'), eyes: hex('#5a4030'), hair: hex('#b9bcc6'), hairStyle: 'messy',
    shirt, sleeves: 'long', pants: hex('#2c2c34'), shoes: hex('#5a3a22'),
  });
  // glasses (painting null keeps what's already there)
  const frame = hex('#26262c');
  P.paint('head', ({ f, x, y, fx }) => {
    if (f === 'front' && ((y === 3 && x !== 0 && x !== 3 && x !== 4 && x !== 7) || (y === 4 && (x === 0 || x === 3 || x === 4 || x === 7)))) return frame;
    if ((f === 'left' || f === 'right') && y === 4 && fx <= 2) return frame;
    return null;
  });
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && (x === 3 || x === 4) && y >= 1 && y <= 7) return y === 1 ? mul(tie, 0.8) : tie;
    return y >= 10 ? hex('#2c2c34') : shirt;
  });
  P.arms(({ f, y }) => (f === 'bottom' || y >= 10 ? (y === 11 || f === 'bottom' ? hex('#d6a684') : hex('#e8b896')) : y === 9 ? coatD : coat));
  // the lab coat, open at the front, with a pen in the pocket
  P.paint('jacket', ({ f, x, y }) => {
    if (f === 'top' || f === 'bottom') return null;
    if (f === 'front') {
      if (x >= 3 && x <= 4) return null;
      if (x === 2 || x === 5) return coatD;
      if (x === 6 && y === 3) return hex('#2a4ad0');
      if ((y === 4 && x >= 5) || (y === 8 && (x <= 1 || x >= 6))) return coatD;
      return coat;
    }
    return y === 11 ? coatD : coat;
  });
  P.sleeves(({ f, y }) => (f === 'bottom' ? null : y <= 9 ? (y === 9 ? coatD : coat) : null));
  P.pants(({ f, y }) => (f === 'top' || f === 'bottom' ? null : y <= 2 ? (y === 2 ? coatD : coat) : null));
  // goggles pushed up on the forehead
  P.paint('hat', ({ f, x, y }) => {
    if (f === 'top' || f === 'bottom') return null;
    if (f === 'front' && y >= 1 && y <= 2 && (x === 1 || x === 2 || x === 5 || x === 6)) return y === 1 ? hex('#a8e6f0') : hex('#6cc4d8');
    if (y === 2 || (f === 'front' && y === 1)) return hex('#3a3a3a');
    return null;
  });
  return P.skin;
}

function pirate() {
  const red = hex('#b52222'), redD = hex('#861616'), shirt = hex('#ece4d0'), shirtD = hex('#cfc4aa'), black = hex('#1d1a18'), gold = hex('#e8b93c');
  const P = character({
    seed: 8, skin: hex('#d29a72'), eyes: hex('#2a1a10'), hair: hex('#1a1412'), hairStyle: 'short', brows: true,
    shirt, sleeves: 'long', pants: hex('#3e2c22'), shoes: black, belt: hex('#2a1a12'), buckle: gold,
  });
  // a curled moustache and a goatee
  const beard = hex('#24180f');
  P.paint('head', ({ f, x, y }) => {
    if (f !== 'front') return null;
    if (y === 5 && (x === 1 || x === 6)) return beard;
    if (y === 6) return x >= 3 && x <= 4 ? hex('#7a3a2a') : x >= 1 && x <= 6 ? beard : null;
    if (y === 7 && x >= 2 && x <= 5) return x === 2 || x === 5 ? mul(beard, 1.4) : beard;
    return null;
  });
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && y <= 3 && Math.abs(x - 3.5) <= 1.5 - y * 0.5) return hex('#d29a72'); // open collar
    if (y === 8 || y === 9) return y === 8 ? red : redD; // sash
    if (y === 10) return f === 'front' && (x === 3 || x === 4) ? gold : hex('#2a1a12');
    if (y === 11) return hex('#3e2c22');
    return (f === 'front' || f === 'back') && (x === 0 || x === 7) ? shirtD : shirt;
  });
  P.arms(({ f, y }) => (f === 'bottom' || y >= 10 ? (y === 11 || f === 'bottom' ? hex('#b8825e') : hex('#d29a72')) : y === 9 ? shirtD : y % 3 === 0 ? shirtD : shirt));
  P.legs(({ f, y }) => (f === 'bottom' || y >= 6 ? (y === 6 ? hex('#3a2c22') : y === 7 ? hex('#4a3a2a') : black) : hex('#3e2c22')));
  // the bandana and an eye patch
  P.paint('hat', ({ f, x, y, fx }) => {
    if (f === 'bottom') return null;
    const dot = (x + y * 2) % 4 === 0 ? [240, 230, 220] as C : null;
    if (f === 'top') return dot ?? red;
    if (f === 'front') {
      if (y <= 2) return y === 2 ? redD : dot ?? red;
      if (y === 4 && (x === 5 || x === 6)) return black;
      if (y === 3 && x === 7) return black;
      return null;
    }
    if (f === 'back') return y <= 2 ? red : y <= 5 && (x === 3 || x === 4) ? (y % 2 ? redD : red) : null;
    if (f === 'left' && y === 3 && fx <= 2) return black; // the patch's strap
    return y <= 2 ? (dot ?? red) : null;
  });
  return P.skin;
}

function robot() {
  const m = hex('#a2abb6'), mD = hex('#7b848f'), mL = hex('#c6cdd6'), dark = hex('#2b3038'), cyan = hex('#46e6ff'), cyanD = hex('#1fa8c4');
  const P = character({ seed: 9, skin: m, eyes: cyan, hairStyle: 'bald', shirt: m, sleeves: 'long', pants: m, shoes: dark, gloves: dark });
  const plate = ({ x, y, f }: At, rows: number[]) => (rows.includes(y) ? mD : (x + y) % 9 === 0 && f !== 'top' ? mL : m);
  P.paint('head', (a) => {
    const { f, x, y } = a;
    if (f === 'front') {
      if (y >= 3 && y <= 5 && x >= 1 && x <= 6) return y === 4 && (x === 2 || x === 5) ? cyan : y === 4 && (x === 1 || x === 6) ? cyanD : dark;
      if (y === 6 && x >= 2 && x <= 5) return x % 2 ? dark : mD;
      if ((x === 0 || x === 7) && (y === 1 || y === 6)) return mL; // rivets
    }
    if (f === 'top' && x >= 3 && x <= 4 && y >= 3 && y <= 4) return dark;
    if ((f === 'left' || f === 'right') && y >= 3 && y <= 5 && a.fx >= 3 && a.fx <= 5) return y === 4 && a.fx === 4 ? cyan : dark;
    return plate(a, [0, 7]);
  });
  P.paint('body', (a) => {
    const { f, x, y } = a;
    if (f === 'front' && y >= 2 && y <= 6 && x >= 2 && x <= 5) return y === 2 || y === 6 || x === 2 || x === 5 ? dark : y === 4 && (x === 3) ? cyan : y === 4 ? hex('#ff5a4a') : hex('#1a2a30');
    if (f === 'back' && y >= 2 && y <= 7 && (x === 2 || x === 5)) return y % 2 ? dark : mD; // vents
    return plate(a, [0, 9]);
  });
  P.arms((a) => (a.y >= 10 || a.f === 'bottom' ? dark : a.y === 4 || a.y === 5 ? dark : plate(a, [0, 9])));
  P.legs((a) => (a.y >= 10 || a.f === 'bottom' ? dark : a.y === 5 || a.y === 6 ? dark : plate(a, [0, 9])));
  return P.skin;
}

function explorer() {
  const khaki = hex('#c9b27c'), khakiD = hex('#a8925e'), olive = hex('#6f7a3c'), boot = hex('#6a4426'), strap = hex('#5a3a1e'), hair = hex('#6b3e1f');
  const P = character({
    seed: 10, slim: true, skin: hex('#dca684'), eyes: hex('#5a3b20'), hair, hairStyle: 'long', mouth: 'small',
    shirt: khaki, sleeves: 'short', pants: olive, shorts: true, shoes: boot,
  });
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && y <= 1 && (x === 3 || x === 4)) return hex('#dca684');
    if ((f === 'front' || f === 'back') && (x === 1 || x === 6) && y <= 9) return strap; // backpack straps
    if (f === 'front' && y >= 3 && y <= 4 && (x === 2 || x === 5)) return khakiD; // pockets
    if (y >= 10) return y === 10 ? hex('#3a2a1a') : olive;
    return y === 9 ? khakiD : khaki;
  });
  P.arms(({ f, y }) => (f === 'bottom' ? hex('#c0896a') : f === 'top' ? khaki : y <= 3 ? (y === 3 ? hex('#e2d1a2') : khaki) : y === 11 ? hex('#c0896a') : hex('#dca684')));
  P.legs(({ f, y }) => {
    if (f === 'bottom' || y >= 9) return y === 9 ? hex('#e8e2d0') : y === 11 || f === 'bottom' ? mul(boot, 0.75) : boot;
    if (f === 'top' || y <= 4) return y === 4 ? hex('#5e6834') : olive;
    return y === 5 ? hex('#c0896a') : hex('#dca684');
  });
  // a braided ponytail and a bandana tied in the hair
  P.paint('hat', ({ f, x, y }) => {
    if (f === 'front') return y === 1 ? hex('#c84a3a') : null;
    if (f === 'back') return y === 1 ? hex('#c84a3a') : y >= 4 && (x === 3 || x === 4) ? ((x + y) % 2 ? hair : mul(hair, 0.8)) : null;
    if (f === 'left' || f === 'right') return y === 1 ? hex('#c84a3a') : null;
    return null;
  });
  P.paint('jacket', ({ f, x, y }) => (f === 'back' && y >= 1 && y <= 8 && x >= 1 && x <= 6 ? (y === 1 || y === 8 || x === 1 || x === 6 ? strap : y === 4 ? hex('#8a5a2e') : hex('#7a4e2a')) : null));
  return P.skin;
}

function creeperFan() {
  const g = hex('#4cae4f'), gD = hex('#3a8a3d'), gL = hex('#64c467'), face = hex('#1a1f1a');
  const creeper = glyph(['........', '.##..##.', '.##..##.', '...##...', '..####..', '..####..', '..#..#..'], face);
  const P = character({
    seed: 11, skin: hex('#e6b18f'), eyes: hex('#2a6a2a'), hair: hex('#4a2e1a'), hairStyle: 'messy',
    shirt: g, sleeves: 'long', pants: hex('#3d5c8e'), shoes: hex('#ececec'),
  });
  P.paint('body', ({ f, x, y }) => {
    if (f === 'front' && y >= 1 && y <= 7) { const c = creeper(x, y - 1); if (c) return c; }
    if (f === 'front' && y === 0 && (x === 2 || x === 5)) return hex('#f0f0f0'); // drawstrings
    if (f === 'back' && y <= 2) return y === 2 ? gD : mul(g, 0.92); // the hood, down
    if (y === 9) return gD;
    if (y >= 10) return hex('#3d5c8e');
    return g;
  });
  P.arms(({ f, y }) => (f === 'bottom' || y >= 10 ? (y === 11 || f === 'bottom' ? hex('#cf9a78') : hex('#e6b18f')) : y === 9 ? gD : y === 0 ? gL : g));
  P.legs(({ f, y, x }) => {
    if (f === 'bottom' || y >= 10) return y === 11 || f === 'bottom' ? hex('#9a9a9a') : hex('#ececec');
    return y === 9 ? hex('#34507c') : (x + y) % 6 === 0 ? hex('#4a6aa0') : hex('#3d5c8e');
  });
  P.paint('jacket', ({ f, x, y }) => (f === 'back' && y <= 1 && x >= 1 && x <= 6 ? gD : null));
  return P.skin;
}

function farmer() {
  const straw = hex('#e3c56a'), strawD = hex('#b99a42'), band = hex('#c0392b'), denim = hex('#4a70aa'), denimD = hex('#3a5a8c');
  const plaid = (x: number, y: number) => ((x % 3 === 0) !== (y % 3 === 0) ? hex('#8e2420') : (x % 3 === 0 && y % 3 === 0) ? hex('#5a1614') : hex('#c43a32'));
  const hair = hex('#e9cb68');
  const P = character({
    seed: 12, slim: true, skin: hex('#f0c4a0'), eyes: hex('#4a7ad0'), hair, hairStyle: 'bob', mouth: 'small',
    shirt: hex('#c43a32'), sleeves: 'short', pants: denim, shoes: hex('#6a4426'),
  });
  P.paint('body', ({ f, x, y }) => {
    if ((f === 'front' || f === 'back') && (x === 1 || x === 6) && y <= 3) return denimD; // straps
    if (f === 'front' && y >= 4 && x >= 1 && x <= 6) return y === 4 && (x === 1 || x === 6) ? hex('#d8c060') : y === 6 && x >= 3 && x <= 4 ? denimD : denim;
    if (f === 'back' && y >= 6) return denim;
    if (y >= 8) return denim;
    return plaid(x + (f === 'back' ? 1 : 0), y);
  });
  P.arms(({ f, x, y }) => (f === 'bottom' ? hex('#d8a888') : f === 'top' || y <= 3 ? plaid(x, y) : y === 11 ? hex('#d8a888') : hex('#f0c4a0')));
  P.legs(({ f, y }) => (f === 'bottom' || y >= 10 ? hex('#6a4426') : y === 9 ? denimD : denim));
  // a straw hat with a red band, and two braids
  P.paint('hat', ({ f, x, y, fx }) => {
    if (f === 'bottom') return null;
    if (f === 'top') return (x + y) % 2 ? straw : strawD;
    if (y <= 1) return (x + y) % 2 ? straw : strawD;
    if (y === 2) return band;
    if ((f === 'left' || f === 'right') && fx === 1 && y >= 3) return y % 2 ? hair : mul(hair, 0.82);
    return null;
  });
  return P.skin;
}

/** One of the hand-drawn skins. */
function drawn(id: string) {
  return () => {
    const s = new Skin(64, 64);
    const bin = atob(SKIN_PIXELS[id]);
    for (let i = 0; i < s.data.length; i++) s.data[i] = bin.charCodeAt(i);
    return s;
  };
}

// ---------------------------------------------------------------------------------------------- registry
export interface SkinPreset { id: string; name: string; slim: boolean; paint: () => Skin }
export const SKIN_PRESETS: SkinPreset[] = [
  { id: 'steve', name: 'Steve', slim: false, paint: steve },
  { id: 'alex', name: 'Alex', slim: true, paint: alex },
  { id: 'knight', name: 'Knight', slim: false, paint: knight },
  { id: 'astronaut', name: 'Astronaut', slim: false, paint: astronaut },
  { id: 'ninja', name: 'Ninja', slim: false, paint: ninja },
  { id: 'wizard', name: 'Wizard', slim: false, paint: wizard },
  { id: 'scientist', name: 'Scientist', slim: false, paint: scientist },
  { id: 'pirate', name: 'Pirate', slim: false, paint: pirate },
  { id: 'robot', name: 'Robot', slim: false, paint: robot },
  { id: 'explorer', name: 'Explorer', slim: true, paint: explorer },
  { id: 'creeperfan', name: 'Creeper Fan', slim: false, paint: creeperFan },
  { id: 'farmer', name: 'Farmer', slim: true, paint: farmer },
  { id: 'sakura', name: 'Sakura', slim: true, paint: drawn('sakura') },
  { id: 'rose', name: 'Rose', slim: true, paint: drawn('rose') },
];
const presetCache = new Map<string, Skin>();
export function presetSkin(id: string): Skin {
  let s = presetCache.get(id);
  if (!s) {
    s = (SKIN_PRESETS.find((p) => p.id === id) ?? SKIN_PRESETS[0]).paint();
    presetCache.set(id, s);
  }
  return s;
}
export const isPreset = (look: string) => SKIN_PRESETS.some((p) => p.id === look);
export const isCustom = (look: string) => look.startsWith('data:image/png;base64,');

/** Are this look's arms slim? Built-ins know; imported skins say so themselves. */
export function lookSlim(look: string, slim: boolean) {
  const p = SKIN_PRESETS.find((q) => q.id === look);
  return p ? p.slim : slim;
}

/** Longest imported skin we pass around (a 64x64 PNG is 1-8 KB; this leaves room for unoptimised files). */
export const MAX_SKIN_URL = 40000;

/** Is this a look the server may pass on? (a built-in id, or a modest PNG data URL) */
export function validLook(look: unknown): look is string {
  if (typeof look !== 'string') return false;
  if (isPreset(look)) return true;
  return look.length <= MAX_SKIN_URL && isCustom(look) && /^[A-Za-z0-9+/=]+$/.test(look.slice(22));
}

// ---------------------------------------------------------------------------------------------- imported skins
/** Pixels of an imported skin, 64x64 (old 64x32 skins get their left arm and leg copied from the right). */
export async function decodeSkin(url: string): Promise<{ data: Uint8ClampedArray; slimGuess: boolean }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  if (w !== 64 || (h !== 64 && h !== 32)) throw new Error('A skin must be a 64x64 (or 64x32) PNG image');
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  if (h === 32) {
    // legacy layout: mirror the right limbs into the left limbs' new home
    const flip = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) => {
      ctx.save();
      ctx.translate(dx + sw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.restore();
    };
    for (const [u, v, du, dv] of [[0, 16, 16, 48], [40, 16, 32, 48]]) {
      flip(u + 4, v, 4, 4, du + 4, dv); flip(u + 8, v, 4, 4, du + 8, dv); // top, bottom
      flip(u, v + 4, 4, 12, du + 8, dv + 4); flip(u + 4, v + 4, 4, 12, du + 4, dv + 4); // outside -> inside, front
      flip(u + 8, v + 4, 4, 12, du, dv + 4); flip(u + 12, v + 4, 4, 12, du + 12, dv + 4); // inside -> outside, back
    }
  }
  const data = ctx.getImageData(0, 0, 64, 64).data;
  // slim skins leave a strip unused beside the right arm (its faces are a column narrower)
  const a = (x: number, y: number) => data[(y * 64 + x) * 4 + 3];
  let empty = 0, n = 0;
  for (let y = 20; y < 32; y++) for (const x of [54, 55]) { n++; if (a(x, y) === 0) empty++; }
  for (let y = 16; y < 20; y++) for (const x of [50, 51]) { n++; if (a(x, y) === 0) empty++; }
  return { data, slimGuess: h === 64 && empty === n };
}

/** Turn a picked file into a normalised 64x64 PNG data URL (so every client decodes the same thing). */
export async function importSkinFile(file: File): Promise<{ url: string; slim: boolean }> {
  if (file.size > 256 * 1024) throw new Error('That file is too big to be a skin');
  const src = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error("Couldn't read the file"));
    fr.readAsDataURL(file);
  });
  const { data, slimGuess } = await decodeSkin(src);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), 64, 64), 0, 0);
  const url = c.toDataURL('image/png');
  if (url.length > MAX_SKIN_URL) throw new Error('That skin is too detailed to share (try a simpler one)');
  return { url, slim: slimGuess };
}

// ---------------------------------------------------------------------------------------------- flat pictures (menus)
/** The front of a skin as a 16x32 picture (both layers), for the skin picker. */
export function skinFront(pixels: Uint8ClampedArray, slim: boolean): HTMLCanvasElement {
  const src = document.createElement('canvas');
  src.width = src.height = 64;
  const full = new Uint8ClampedArray(64 * 64 * 4);
  full.set(pixels.subarray(0, Math.min(pixels.length, full.length)));
  src.getContext('2d')!.putImageData(new ImageData(full, 64, 64), 0, 0);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 32;
  const ctx = c.getContext('2d')!;
  const aw = slim ? 3 : 4;
  // [u, v] of each front face, then where it goes
  const parts: [number, number, number, number, number, number][] = [
    [8, 8, 8, 8, 4, 0], [20, 20, 8, 12, 4, 8], [44, 20, aw, 12, 4 - aw, 8], [36, 52, aw, 12, 12, 8], [4, 20, 4, 12, 4, 20], [20, 52, 4, 12, 8, 20],
    [40, 8, 8, 8, 4, 0], [20, 36, 8, 12, 4, 8], [44, 36, aw, 12, 4 - aw, 8], [52, 52, aw, 12, 12, 8], [4, 36, 4, 12, 4, 20], [4, 52, 4, 12, 8, 20],
  ];
  for (const [u, v, w, h, x, y] of parts) ctx.drawImage(src, u, v, w, h, x, y, w, h);
  return c;
}
