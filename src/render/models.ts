// Entity box models (Minecraft model-space: y down, front toward -z) and procedural skins.
import { Random } from '../noise';

export interface ModelBox {
  x: number; y: number; z: number; w: number; h: number; d: number;
  u: number; v: number;
  inflate?: number;
  mirror?: boolean;
}
export interface ModelPart {
  name: string;
  px: number; py: number; pz: number; // rotation point
  rx?: number; ry?: number; rz?: number;
  boxes: ModelBox[];
  children?: ModelPart[];
}
export interface ModelDef {
  parts: ModelPart[];
  texW: number;
  texH: number;
}

const box = (x: number, y: number, z: number, w: number, h: number, d: number, u: number, v: number, extra: Partial<ModelBox> = {}): ModelBox => ({ x, y, z, w, h, d, u, v, ...extra });
const part = (name: string, px: number, py: number, pz: number, boxes: ModelBox[], extra: Partial<ModelPart> = {}): ModelPart => ({ name, px, py, pz, boxes, ...extra });

export function bipedModel(thinLimbs = false, inflate = 0): ModelDef {
  const a = thinLimbs ? 2 : 4;
  const ao = thinLimbs ? -1 : -2;
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', 0, 0, 0, [box(-4, -8, -4, 8, 8, 8, 0, 0, { inflate })]),
      part('hat', 0, 0, 0, [box(-4, -8, -4, 8, 8, 8, 32, 0, { inflate: 0.5 + inflate })]),
      part('body', 0, 0, 0, [box(-4, 0, -2, 8, 12, 4, 16, 16, { inflate })]),
      part('rightArm', -5, 2, 0, [box(thinLimbs ? -1 : -3, -2, ao, a, 12, a, 40, 16, { inflate })]),
      part('leftArm', 5, 2, 0, [box(-1, -2, ao, a, 12, a, 40, 16, { mirror: true, inflate })]),
      part('rightLeg', -1.9, 12, 0, [box(ao, 0, ao, a, 12, a, 0, 16, { inflate })]),
      part('leftLeg', 1.9, 12, 0, [box(ao, 0, ao, a, 12, a, 0, 16, { mirror: true, inflate })]),
    ],
  };
}

/**
 * The player in the modern 64x64 skin layout: separate left limbs, and an outer layer (hat, jacket, sleeves,
 * trousers) drawn slightly larger than the body. Slim skins have 3-pixel arms.
 */
export function playerModel(slim: boolean): ModelDef {
  const aw = slim ? 3 : 4, ay = slim ? 2.5 : 2;
  const limb = (name: string, px: number, py: number, x: number, y: number, w: number, u: number, v: number, inflate = 0) => part(name, px, py, 0, [box(x, y, -2, w, 12, 4, u, v, { inflate })]);
  return {
    texW: 64, texH: 64,
    parts: [
      part('head', 0, 0, 0, [box(-4, -8, -4, 8, 8, 8, 0, 0)]),
      part('hat', 0, 0, 0, [box(-4, -8, -4, 8, 8, 8, 32, 0, { inflate: 0.5 })]),
      part('body', 0, 0, 0, [box(-4, 0, -2, 8, 12, 4, 16, 16)]),
      part('jacket', 0, 0, 0, [box(-4, 0, -2, 8, 12, 4, 16, 32, { inflate: 0.25 })]),
      limb('rightArm', -5, ay, slim ? -2 : -3, -2, aw, 40, 16),
      limb('rightSleeve', -5, ay, slim ? -2 : -3, -2, aw, 40, 32, 0.25),
      limb('leftArm', 5, ay, -1, -2, aw, 32, 48),
      limb('leftSleeve', 5, ay, -1, -2, aw, 48, 48, 0.25),
      limb('rightLeg', -1.9, 12, -2, 0, 4, 0, 16),
      limb('rightPants', -1.9, 12, -2, 0, 4, 0, 32, 0.25),
      limb('leftLeg', 1.9, 12, -2, 0, 4, 16, 48),
      limb('leftPants', 1.9, 12, -2, 0, 4, 0, 48, 0.25),
    ],
  };
}

/** The outer-layer parts of the player model, and the part each one moves with. */
export const PLAYER_OVERLAYS: [string, string][] = [['hat', 'head'], ['jacket', 'body'], ['rightSleeve', 'rightArm'], ['leftSleeve', 'leftArm'], ['rightPants', 'rightLeg'], ['leftPants', 'leftLeg']];

export function creeperModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', 0, 6, 0, [box(-4, -8, -4, 8, 8, 8, 0, 0)]),
      part('body', 0, 6, 0, [box(-4, 0, -2, 8, 12, 4, 16, 16)]),
      part('leg1', -2, 18, 4, [box(-2, 0, -2, 4, 6, 4, 0, 16)]),
      part('leg2', 2, 18, 4, [box(-2, 0, -2, 4, 6, 4, 0, 16)]),
      part('leg3', -2, 18, -4, [box(-2, 0, -2, 4, 6, 4, 0, 16)]),
      part('leg4', 2, 18, -4, [box(-2, 0, -2, 4, 6, 4, 0, 16)]),
    ],
  };
}

function quadruped(height: number, head: ModelBox[], headPivot: [number, number, number], body: ModelBox[], bodyPivot: [number, number, number], legX: number, legZb: number, legZf: number): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', headPivot[0], headPivot[1], headPivot[2], head),
      part('body', bodyPivot[0], bodyPivot[1], bodyPivot[2], body, { rx: Math.PI / 2 }),
      part('leg1', -legX, 24 - height, legZb, [box(-2, 0, -2, 4, height, 4, 0, 16)]),
      part('leg2', legX, 24 - height, legZb, [box(-2, 0, -2, 4, height, 4, 0, 16)]),
      part('leg3', -legX, 24 - height, legZf, [box(-2, 0, -2, 4, height, 4, 0, 16)]),
      part('leg4', legX, 24 - height, legZf, [box(-2, 0, -2, 4, height, 4, 0, 16)]),
    ],
  };
}

export function pigModel(): ModelDef {
  return quadruped(6, [box(-4, -4, -8, 8, 8, 8, 0, 0), box(-2, 0, -9, 4, 3, 1, 16, 16)], [0, 12, -6], [box(-5, -10, -7, 10, 16, 8, 28, 8)], [0, 11, 2], 3, 7, -5);
}
export function cowModel(): ModelDef {
  return quadruped(12,
    [box(-4, -4, -6, 8, 8, 6, 0, 0), box(-5, -5, -4, 1, 3, 1, 22, 0), box(4, -5, -4, 1, 3, 1, 22, 0)], [0, 4, -8],
    [box(-6, -10, -7, 12, 18, 10, 18, 4), box(-2, 2, -8, 4, 6, 1, 52, 0)], [0, 5, 2], 4, 7, -6);
}
export function sheepModel(): ModelDef {
  return quadruped(12, [box(-3, -4, -6, 6, 6, 8, 0, 0)], [0, 6, -8], [box(-4, -10, -7, 8, 16, 6, 28, 8)], [0, 5, 2], 3, 7, -5);
}
export function sheepWoolModel(): ModelDef {
  const m = quadruped(12, [box(-3, -4, -4, 6, 6, 6, 0, 0, { inflate: 0.6 })], [0, 6, -8], [box(-4, -10, -7, 8, 16, 6, 28, 8, { inflate: 1.75 })], [0, 5, 2], 3, 7, -5);
  for (const p of m.parts) if (p.name.startsWith('leg')) p.boxes = [box(-2, 0, -2, 4, 6, 4, 0, 16, { inflate: 0.5 })];
  return m;
}
export function chickenModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', 0, 15, -4, [box(-2, -6, -2, 4, 6, 3, 0, 0), box(-2, -4, -4, 4, 2, 2, 14, 0), box(-1, -2, -3, 2, 2, 2, 14, 4)]),
      part('body', 0, 16, 0, [box(-3, -4, -3, 6, 8, 6, 0, 9)], { rx: Math.PI / 2 }),
      part('rightLeg', -2, 19, 1, [box(-1, 0, -3, 3, 5, 3, 26, 0)]),
      part('leftLeg', 1, 19, 1, [box(-1, 0, -3, 3, 5, 3, 26, 0)]),
      part('rightWing', -4, 13, 0, [box(0, 0, -3, 1, 4, 6, 24, 13)]),
      part('leftWing', 4, 13, 0, [box(-1, 0, -3, 1, 4, 6, 24, 13)]),
    ],
  };
}
export function spiderModel(): ModelDef {
  const legs: ModelPart[] = [];
  const zs = [2, 1, 0, -1];
  zs.forEach((z, i) => {
    legs.push(part('leg' + (i * 2 + 1), -4, 15, z, [box(-15, -1, -1, 16, 2, 2, 18, 0)]));
    legs.push(part('leg' + (i * 2 + 2), 4, 15, z, [box(-1, -1, -1, 16, 2, 2, 18, 0)]));
  });
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', 0, 15, -3, [box(-4, -4, -8, 8, 8, 8, 32, 4)]),
      part('neck', 0, 15, 0, [box(-3, -3, -3, 6, 6, 6, 0, 0)]),
      part('body', 0, 15, 9, [box(-5, -4, -6, 10, 8, 12, 0, 12)]),
      ...legs,
    ],
  };
}

export function villagerModel(): ModelDef {
  return {
    texW: 64, texH: 64,
    parts: [
      part('head', 0, 0, 0, [box(-4, -10, -4, 8, 10, 8, 0, 0), box(-1, -3, -6, 2, 4, 2, 24, 0)]),
      part('body', 0, 0, 0, [box(-4, 0, -3, 8, 12, 6, 16, 20), box(-4, 0, -3, 8, 18, 6, 0, 38, { inflate: 0.5 })]),
      part('arms', 0, 3, -1, [box(-8, -2, -2, 4, 8, 4, 44, 22), box(4, -2, -2, 4, 8, 4, 44, 22, { mirror: true }), box(-4, 2, -2, 8, 4, 4, 40, 38)], { rx: -0.75 }),
      part('rightLeg', -2, 12, 0, [box(-2, 0, -2, 4, 12, 4, 0, 22)]),
      part('leftLeg', 2, 12, 0, [box(-2, 0, -2, 4, 12, 4, 0, 22, { mirror: true })]),
    ],
  };
}

export function endermanModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', 0, -14, 0, [box(-4, -8, -4, 8, 8, 8, 0, 0)]),
      part('jaw', 0, -14, 0, [box(-4, -8, -4, 8, 8, 8, 0, 16, { inflate: -0.5 })]),
      part('body', 0, -14, 0, [box(-4, 0, -2, 8, 12, 4, 32, 16)]),
      part('rightArm', -5, -12, 0, [box(-1, -2, -1, 2, 30, 2, 56, 0)]),
      part('leftArm', 5, -12, 0, [box(-1, -2, -1, 2, 30, 2, 56, 0, { mirror: true })]),
      part('rightLeg', -2, -5, 0, [box(-1, 0, -1, 2, 30, 2, 56, 0)]),
      part('leftLeg', 2, -5, 0, [box(-1, 0, -1, 2, 30, 2, 56, 0, { mirror: true })]),
    ],
  };
}
export function slimeInnerModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [part('cube', 0, 0, 0, [
      box(-3, 17, -3, 6, 6, 6, 0, 16),
      box(-3.25, 18, -3.5, 2, 2, 2, 32, 0),
      box(1.25, 18, -3.5, 2, 2, 2, 32, 4),
      box(0, 21, -3.5, 1, 1, 1, 32, 8),
    ])],
  };
}
export function slimeOuterModel(): ModelDef {
  return { texW: 64, texH: 32, parts: [part('cube', 0, 0, 0, [box(-4, 16, -4, 8, 8, 8, 0, 0)])] };
}

export function squidModel(): ModelDef {
  const t: ModelPart[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    t.push(part('t' + i, Math.cos(a) * 5, 15, Math.sin(a) * 5, [box(-1, 0, -1, 2, 18, 2, 48, 0)], { ry: (i * Math.PI * -2) / 8 + Math.PI / 2 }));
  }
  return { texW: 64, texH: 32, parts: [part('body', 0, 8, 0, [box(-6, -8, -6, 12, 16, 12, 0, 0)]), ...t] };
}
export function batModel(): ModelDef {
  return {
    texW: 64, texH: 64,
    parts: [
      part('head', 0, 0, 0, [box(-3, -3, -3, 6, 6, 6, 0, 0), box(-4, -6, -2, 3, 4, 1, 24, 0), box(1, -6, -2, 3, 4, 1, 24, 0, { mirror: true })]),
      part('body', 0, 0, 0, [box(-3, 4, -3, 6, 12, 6, 0, 16), box(-5, 16, 0, 10, 6, 1, 0, 34)]),
      part('rightWing', 0, 0, 0, [box(-12, 1, 1.5, 10, 16, 1, 42, 0)]),
      part('leftWing', 0, 0, 0, [box(2, 1, 1.5, 10, 16, 1, 42, 0, { mirror: true })]),
    ],
  };
}

export function wolfModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('head', -1, 13.5, -7, [box(-3, -3, -2, 6, 6, 4, 0, 0), box(-3, -5, 0, 2, 2, 1, 16, 14), box(1, -5, 0, 2, 2, 1, 16, 14), box(-1.5, 0, -5, 3, 3, 4, 0, 10)]),
      part('body', 0, 14, 2, [box(-4, -2, -3, 6, 9, 6, 18, 14)], { rx: Math.PI / 2 }),
      part('mane', -1, 14, 2, [box(-4, -3, -3, 8, 6, 7, 21, 0)], { rx: Math.PI / 2 }),
      part('leg1', -2.5, 16, 7, [box(0, 0, -1, 2, 8, 2, 0, 18)]),
      part('leg2', 0.5, 16, 7, [box(0, 0, -1, 2, 8, 2, 0, 18)]),
      part('leg3', -2.5, 16, -4, [box(0, 0, -1, 2, 8, 2, 0, 18)]),
      part('leg4', 0.5, 16, -4, [box(0, 0, -1, 2, 8, 2, 0, 18)]),
      part('tail', -1, 12, 8, [box(0, 0, -1, 2, 8, 2, 9, 18)]),
    ],
  };
}

export function ghastModel(): ModelDef {
  const tentacles: ModelPart[] = [];
  const r = new Random(1660);
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * 5 + ((i / 3 | 0) % 2) * 1.5 - 0.75;
    const z = ((i / 3 | 0) - 1) * 5;
    const len = r.int(7) + 8;
    tentacles.push(part('tentacle' + i, x, 15, z, [box(-1, 0, -1, 2, len, 2, 0, 0)]));
  }
  return { texW: 64, texH: 32, parts: [part('body', 0, 8, 0, [box(-8, -8, -8, 16, 16, 16, 0, 0)]), ...tentacles] };
}

export function blazeModel(): ModelDef {
  const rods: ModelPart[] = [];
  for (let i = 0; i < 12; i++) rods.push(part('rod' + i, 0, 0, 0, [box(0, 0, 0, 2, 8, 2, 0, 16)]));
  return { texW: 64, texH: 32, parts: [part('head', 0, 0, 0, [box(-4, -4, -4, 8, 8, 8, 0, 0)]), ...rods] };
}

// ------------------------------------------------------------------ skin painting
type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
type Painter = (face: Face, x: number, y: number, fw: number, fh: number) => [number, number, number, number] | [number, number, number] | null;

export class Skin {
  data: Uint8ClampedArray;
  constructor(public w = 64, public h = 32) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: [number, number, number, number] | [number, number, number]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = c.length > 3 ? (c as number[])[3] : 255;
  }
  paintBox(u: number, v: number, w: number, h: number, d: number, p: Painter) {
    const faces: [Face, number, number, number, number][] = [
      ['top', u + d, v, w, d], ['bottom', u + d + w, v, w, d],
      ['right', u, v + d, d, h], ['front', u + d, v + d, w, h], ['left', u + d + w, v + d, d, h], ['back', u + d + w + d, v + d, w, h],
    ];
    for (const [f, fx, fy, fw, fh] of faces)
      for (let y = 0; y < fh; y++)
        for (let x = 0; x < fw; x++) {
          const c = p(f, x, y, fw, fh);
          if (c) this.set(fx + x, fy + y, c);
        }
  }
}

const hx = (h: string): [number, number, number] => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const vary = (c: [number, number, number], r: Random, amt = 0.08): [number, number, number] => {
  const f = 1 + (r.next() - 0.5) * 2 * amt;
  return [c[0] * f, c[1] * f, c[2] * f].map((x) => Math.max(0, Math.min(255, Math.round(x)))) as [number, number, number];
};

export function steveSkin(): Skin {
  const s = new Skin();
  const r = new Random(1);
  const skin = hx('#b4846d'), skinD = hx('#9e6f58'), hair = hx('#2e1f0f'), hairL = hx('#3c2a15');
  const shirt = hx('#00a0a0'), shirtD = hx('#008b8b'), pants = hx('#3438a0'), pantsD = hx('#2a2d85'), shoe = hx('#5a5a5a');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'top' || f === 'back') return vary(r.bool() ? hair : hairL, r, 0.05);
    if (f === 'bottom') return skinD;
    if (f === 'front') {
      if (y <= 1) return vary(hair, r, 0.05);
      if (y === 2 && (x === 0 || x === 7)) return hair;
      if (y === 4 && (x === 1 || x === 6)) return [255, 255, 255];
      if (y === 4 && (x === 2 || x === 5)) return hx('#4a3a8a');
      if (y === 5 && (x === 3 || x === 4)) return hx('#8f5e48');
      if (y === 6 && x >= 2 && x <= 5) return x === 2 || x === 5 ? skinD : hx('#6a4030');
      if (y === 7 && x >= 3 && x <= 4) return hx('#7a4d3a');
      return vary(skin, r, 0.03);
    }
    // sides
    if (y <= 2 || (y === 3 && (f === 'left' ? x >= 5 : x <= 2))) return vary(hair, r, 0.05);
    return vary(skin, r, 0.03);
  });
  s.paintBox(16, 16, 8, 12, 4, (f, x, y) => {
    if (f === 'front' && y === 0 && x >= 3 && x <= 4) return skinD;
    return vary(y > 10 ? shirtD : shirt, r, 0.04);
  });
  s.paintBox(40, 16, 4, 12, 4, (f, x, y) => {
    if (f === 'top') return shirt;
    if (y < 4) return vary(shirt, r, 0.04);
    if (y === 4) return shirtD;
    return vary(f === 'bottom' || y === 11 ? skinD : skin, r, 0.03);
  });
  s.paintBox(0, 16, 4, 12, 4, (f, x, y) => {
    if (f === 'bottom' || y >= 10) return vary(shoe, r, 0.06);
    return vary(y < 1 ? pantsD : pants, r, 0.04);
  });
  return s;
}

export function zombieSkin(): Skin {
  const s = steveSkin();
  const r = new Random(2);
  const skin = hx('#5aa050'), skinD = hx('#3f7a38');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'top') return vary(hx('#3f6f38'), r, 0.1);
    if (f === 'front') {
      if (y === 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return hx('#1e3a1a');
      if (y === 6 && x >= 2 && x <= 5) return hx('#2e5a28');
      if (y <= 1) return vary(skinD, r, 0.1);
    }
    return vary(skin, r, 0.1);
  });
  s.paintBox(40, 16, 4, 12, 4, (f, x, y) => vary(y > 9 ? skinD : skin, r, 0.1));
  s.paintBox(16, 16, 8, 12, 4, (f, x, y) => (f === 'front' && y < 2 && x > 2 && x < 5 ? skin : vary(hx('#00989a'), r, 0.08)));
  return s;
}

export function skeletonSkin(): Skin {
  const s = new Skin();
  const r = new Random(3);
  const bone = hx('#bcbcbc'), boneD = hx('#8e8e8e'), dark = hx('#3a3a3a');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'front') {
      if (y >= 3 && y <= 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return dark;
      if (y === 5 && (x === 3 || x === 4)) return boneD;
      if (y === 6 && x >= 1 && x <= 6) return x % 2 ? dark : boneD;
    }
    return vary(bone, r, 0.05);
  });
  s.paintBox(16, 16, 8, 12, 4, (f, x, y) => {
    if (f === 'front' || f === 'back') {
      if (x === 3 || x === 4) return y < 11 ? boneD : null;
      if (y % 2 === 1 && y < 8) return bone;
      if (y >= 10) return bone;
      return null;
    }
    return y % 2 === 1 && y < 8 ? boneD : null;
  });
  s.paintBox(40, 16, 2, 12, 2, () => vary(bone, r, 0.05));
  s.paintBox(0, 16, 2, 12, 2, () => vary(bone, r, 0.05));
  return s;
}

export function creeperSkin(): Skin {
  const s = new Skin();
  const r = new Random(4);
  const pal = ['#0da70b', '#1c9b1a', '#35832b', '#61d15e', '#4cb84a', '#0b7a09', '#aeb8ae'].map(hx);
  const cam = () => pal[Math.min(pal.length - 1, Math.floor(r.next() * r.next() * pal.length * 1.4))];
  const face = ['........', '........', '.XX..XX.', '.XX..XX.', '...XX...', '..XXXX..', '..XXXX..', '..X..X..'];
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && face[y][x] === 'X' ? (y < 4 ? hx('#0a0a0a') : hx('#1a1a1a')) : cam()));
  s.paintBox(16, 16, 8, 12, 4, () => cam());
  s.paintBox(0, 16, 4, 6, 4, (f, x, y) => (f === 'bottom' ? hx('#1a4a18') : cam()));
  return s;
}

export function pigSkin(): Skin {
  const s = new Skin();
  const r = new Random(5);
  const pink = hx('#f0a5a2'), pinkD = hx('#e08e8a'), pinkL = hx('#f7c0bd');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'front' && y === 3 && (x === 1 || x === 6)) return [255, 255, 255];
    if (f === 'front' && y === 3 && (x === 2 || x === 5)) return hx('#2a1a1a');
    return vary(pink, r, 0.05);
  });
  s.paintBox(16, 16, 4, 3, 1, (f, x, y) => (f === 'front' && y === 1 && (x === 0 || x === 3) ? hx('#8a4a4a') : pinkL));
  s.paintBox(28, 8, 10, 16, 8, (f, x, y) => vary(r.int(12) === 0 ? pinkD : pink, r, 0.05));
  s.paintBox(0, 16, 4, 6, 4, (f, x, y) => (y >= 5 || f === 'bottom' ? hx('#9a6060') : vary(pink, r, 0.05)));
  return s;
}

export function cowSkin(): Skin {
  const s = new Skin();
  const r = new Random(6);
  const black = hx('#2c2622'), white = hx('#e8e8e8');
  const spots = Array.from({ length: 6 }, () => [r.int(64), r.int(32), 3 + r.int(5)]);
  const patch = (x: number, y: number) => spots.some(([sx, sy, rr]) => Math.hypot(x - sx, y - sy) < rr);
  s.paintBox(0, 0, 8, 8, 6, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && (x === 1 || x === 6)) return [255, 255, 255];
      if (y === 3 && (x === 2 || x === 5)) return hx('#111111');
      if (y >= 5 && x >= 2 && x <= 5) return y === 6 && (x === 2 || x === 5) ? hx('#6b4b3b') : hx('#b8a39a');
      if (x >= 3 && x <= 4 && y < 5) return white;
    }
    return vary(black, r, 0.05);
  });
  s.paintBox(22, 0, 1, 3, 1, () => hx('#d8d0c0'));
  s.paintBox(18, 4, 12, 18, 10, (f, x, y) => vary(patch(x + (f === 'left' ? 20 : 0), y) ? white : black, r, 0.04));
  s.paintBox(52, 0, 4, 6, 1, () => hx('#e89a9a'));
  s.paintBox(0, 16, 4, 12, 4, (f, x, y) => (y >= 10 || f === 'bottom' ? hx('#3a3a3a') : vary(y < 5 && x < 2 ? white : black, r, 0.04)));
  return s;
}

export function sheepSkin(): Skin {
  const s = new Skin();
  const r = new Random(7);
  const face = hx('#d9c4b4'), skin = hx('#d9b5a6');
  s.paintBox(0, 0, 6, 6, 8, (f, x, y) => {
    if (f === 'front' && y === 2 && (x === 0 || x === 5)) return [255, 255, 255];
    if (f === 'front' && y === 2 && (x === 1 || x === 4)) return hx('#111111');
    if (f === 'front' && y === 4 && (x === 2 || x === 3)) return hx('#b89080');
    return vary(face, r, 0.04);
  });
  s.paintBox(28, 8, 8, 16, 6, () => vary(skin, r, 0.05));
  s.paintBox(0, 16, 4, 12, 4, (f, x, y) => (y >= 10 ? hx('#6b5a4a') : vary(face, r, 0.04)));
  return s;
}
export function woolSkin(): Skin {
  const s = new Skin();
  const r = new Random(8);
  const w = hx('#e8e8e8');
  s.paintBox(0, 0, 6, 6, 6, () => vary(w, r, 0.06));
  s.paintBox(28, 8, 8, 16, 6, () => vary(w, r, 0.06));
  s.paintBox(0, 16, 4, 6, 4, () => vary(w, r, 0.06));
  return s;
}

export function chickenSkin(): Skin {
  const s = new Skin();
  const r = new Random(9);
  const w = hx('#f4f4f4'), wd = hx('#dadada');
  s.paintBox(0, 0, 4, 6, 3, (f, x, y) => {
    if (f === 'front' && y === 2 && (x === 0 || x === 3)) return hx('#111111');
    return vary(w, r, 0.03);
  });
  s.paintBox(14, 0, 4, 2, 2, () => hx('#f0b020'));
  s.paintBox(14, 4, 2, 2, 2, () => hx('#d02020'));
  s.paintBox(0, 9, 6, 8, 6, () => vary(r.int(5) === 0 ? wd : w, r, 0.03));
  s.paintBox(26, 0, 3, 5, 3, (f, x, y) => (y < 2 ? null : hx('#f0a020')));
  s.paintBox(24, 13, 1, 4, 6, () => vary(wd, r, 0.04));
  return s;
}

const PROFESSION_ROBES: Record<string, [string, string, string?]> = {
  farmer: ['#7a5a36', '#5a4026', '#c8b078'],
  librarian: ['#e0e0da', '#b8b8b0'],
  priest: ['#6a2a8a', '#4a1a62', '#e0c040'],
  smith: ['#3a3a3a', '#262626', '#7a5a36'],
  butcher: ['#e8e8e8', '#c0c0c0', '#b02020'],
};
export const PROFESSIONS = Object.keys(PROFESSION_ROBES);
export function villagerSkin(prof: string): Skin {
  const s = new Skin(64, 64);
  const r = new Random(prof.length * 13);
  const skin = hx('#b8805e'), skinD = hx('#9a684a');
  const [robe, robeD, trim] = PROFESSION_ROBES[prof] ?? PROFESSION_ROBES.farmer;
  const R = hx(robe), RD = hx(robeD), T = trim ? hx(trim) : RD;
  s.paintBox(0, 0, 8, 10, 8, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && x >= 1 && x <= 6) return hx('#4a3020'); // unibrow
      if (y === 4 && (x === 1 || x === 6)) return [255, 255, 255];
      if (y === 4 && (x === 2 || x === 5)) return hx('#2a8a3a'); // green eyes
      if (y === 8 && x >= 2 && x <= 5) return skinD;
    }
    if (f === 'top') return vary(prof === 'librarian' ? hx('#5a4030') : skinD, r, 0.05);
    return vary(skin, r, 0.03);
  });
  s.paintBox(24, 0, 2, 4, 2, () => vary(hx('#a86c4c'), r, 0.04));
  s.paintBox(16, 20, 8, 12, 6, (f, x, y) => (f === 'front' && y < 1 ? T : vary(y > 9 ? RD : R, r, 0.04)));
  s.paintBox(0, 38, 8, 18, 6, (f, x, y) => {
    if (prof === 'smith' && f === 'front' && y > 2) return vary(hx('#2a1a0a'), r, 0.05);
    if (prof === 'butcher' && f === 'front' && y > 2 && y < 14) return y === 3 ? T : vary(hx('#f0f0f0'), r, 0.03);
    if (y === 17) return T;
    return vary(y % 5 === 0 ? RD : R, r, 0.04);
  });
  s.paintBox(44, 22, 4, 8, 4, (f, x, y) => (y > 5 ? vary(skin, r, 0.03) : vary(R, r, 0.04)));
  s.paintBox(40, 38, 8, 4, 4, () => vary(R, r, 0.04));
  s.paintBox(0, 22, 4, 12, 4, (f, x, y) => (y > 9 ? hx('#3a2a1a') : vary(RD, r, 0.04)));
  return s;
}

export function endermanSkin(): Skin {
  const s = new Skin();
  const r = new Random(21);
  const k = hx('#161616'), k2 = hx('#0e0e0e');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'front' && y === 4 && (x <= 2 || x >= 5)) return x === 1 || x === 6 ? hx('#f0a0ff') : hx('#cc00fa');
    return vary(r.int(3) ? k : k2, r, 0.05);
  });
  s.paintBox(0, 16, 8, 8, 8, (f, x, y) => (y > 5 ? vary(k, r, 0.05) : null));
  s.paintBox(32, 16, 8, 12, 4, () => vary(r.int(3) ? k : k2, r, 0.05));
  s.paintBox(56, 0, 2, 30, 2, () => vary(r.int(3) ? k : k2, r, 0.05));
  return s;
}
export function slimeSkin(): Skin {
  const s = new Skin();
  const r = new Random(22);
  const g = hx('#6fbe5a'), g2 = hx('#5ea84c'), inner = hx('#4c9a3a');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => { const v = vary(r.int(4) ? g : g2, r, 0.06); return [v[0], v[1], v[2], 150]; });
  s.paintBox(0, 16, 6, 6, 6, () => vary(inner, r, 0.08));
  s.paintBox(32, 0, 2, 2, 2, () => hx('#1a3a14'));
  s.paintBox(32, 4, 2, 2, 2, () => hx('#1a3a14'));
  s.paintBox(32, 8, 1, 1, 1, () => hx('#1a3a14'));
  return s;
}

export function squidSkin(): Skin {
  const s = new Skin();
  const r = new Random(31);
  const b = hx('#2a4a6a'), b2 = hx('#3a5a7e'), d = hx('#1a2e44');
  s.paintBox(0, 0, 12, 16, 12, (f, x, y) => {
    if (f === 'front' && y === 10 && (x === 3 || x === 8)) return [230, 230, 230];
    if (f === 'front' && y === 11 && (x === 3 || x === 8)) return hx('#101010');
    return vary(r.int(4) ? b : b2, r, 0.06);
  });
  s.paintBox(48, 0, 2, 18, 2, (f, x, y) => vary(y % 4 === 0 ? d : b, r, 0.06));
  return s;
}
export function batSkin(): Skin {
  const s = new Skin(64, 64);
  const r = new Random(32);
  const fur = hx('#4a3a2a'), dk = hx('#2a2018');
  s.paintBox(0, 0, 6, 6, 6, (f, x, y) => (f === 'front' && y === 2 && (x === 1 || x === 4) ? hx('#101010') : vary(fur, r, 0.08)));
  s.paintBox(24, 0, 3, 4, 1, () => vary(dk, r, 0.08));
  s.paintBox(0, 16, 6, 12, 6, () => vary(fur, r, 0.08));
  s.paintBox(0, 34, 10, 6, 1, () => vary(dk, r, 0.08));
  s.paintBox(42, 0, 10, 16, 1, (f, x, y) => (y > 12 && x % 3 === 0 ? null : vary(dk, r, 0.06)));
  return s;
}

export function wolfSkin(kind: 'wild' | 'tame' | 'angry'): Skin {
  const s = new Skin();
  const r = new Random(41);
  const fur = hx('#d8d4cc'), furD = hx('#b8b2a8'), dk = hx('#8a847a');
  const eye = kind === 'angry' ? hx('#e02020') : hx('#1a1a1a');
  s.paintBox(0, 0, 6, 6, 4, (f, x, y) => {
    if (f === 'front' && y === 2 && (x === 1 || x === 4)) return eye;
    if (f === 'front' && y === 1 && (x === 1 || x === 4) && kind === 'angry') return hx('#5a4a40');
    return vary(y > 3 ? furD : fur, r, 0.05);
  });
  s.paintBox(16, 14, 2, 2, 1, () => vary(dk, r, 0.05));
  s.paintBox(0, 10, 3, 3, 4, (f, x, y) => (f === 'front' && y === 0 ? hx('#1a1a1a') : vary(furD, r, 0.05)));
  s.paintBox(18, 14, 6, 9, 6, () => vary(r.int(4) ? fur : furD, r, 0.05));
  s.paintBox(21, 0, 8, 6, 7, (f, x, y) => (kind === 'tame' && y >= 4 ? (y === 4 ? hx('#b02020') : hx('#d83030')) : vary(r.int(3) ? fur : furD, r, 0.05)));
  s.paintBox(0, 18, 2, 8, 2, (f, x, y) => vary(y > 6 ? dk : fur, r, 0.05));
  s.paintBox(9, 18, 2, 8, 2, (f, x, y) => vary(y > 5 ? furD : fur, r, 0.05));
  return s;
}

export function ghastSkin(shooting: boolean): Skin {
  const s = new Skin();
  const r = new Random(11);
  const w = hx('#f0f0f0'), g = hx('#d8d8d8'), dark = hx('#4a4a4a');
  s.paintBox(0, 0, 16, 16, 16, (f, x, y) => {
    if (f === 'front') {
      // eyes & mouth (open and red-eyed when shooting)
      if (shooting) {
        if (y >= 5 && y <= 6 && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12))) return y === 6 && (x === 4 || x === 11) ? hx('#ff4040') : dark;
        if (y >= 9 && y <= 12 && x >= 6 && x <= 9) return y === 9 ? dark : hx('#2a2a2a');
      } else {
        if (y === 6 && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12))) return dark;
        if (y === 10 && x >= 6 && x <= 9) return dark;
      }
      if (y === 8 && (x === 4 || x === 11)) return hx('#c8c8c8');
    }
    return vary(r.int(9) === 0 ? g : w, r, 0.03);
  });
  s.paintBox(0, 0, 2, 16, 2, () => vary(g, r, 0.05));
  return s;
}

export function blazeSkin(): Skin {
  const s = new Skin();
  const r = new Random(31);
  const y1 = hx('#f8c828'), y2 = hx('#f0a018'), y3 = hx('#fff070'), dark = hx('#6a3a08');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return x === 2 || x === 5 ? hx('#1a1a1a') : dark;
      if (y === 4 && (x === 1 || x === 2 || x === 5 || x === 6)) return hx('#3a2a08');
      if (y === 6 && x >= 2 && x <= 5) return dark;
    }
    const k = r.int(10);
    return vary(k < 2 ? y3 : k < 6 ? y1 : y2, r, 0.05);
  });
  s.paintBox(0, 16, 2, 8, 2, (_f, _x, y) => vary(y % 3 === 0 ? y2 : y1, r, 0.06));
  return s;
}

export function pigmanSkin(): Skin {
  const s = new Skin();
  const r = new Random(12);
  const pink = hx('#e89a8e'), pinkD = hx('#c8766a'), green = hx('#5a8a3a'), bone = hx('#d8d0c0'), brown = hx('#6b4a2a');
  s.paintBox(0, 0, 8, 8, 8, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && (x === 1 || x === 2)) return [255, 255, 255];
      if (y === 3 && (x === 5 || x === 6)) return hx('#8a1010');
      if (y >= 5 && y <= 6 && x >= 2 && x <= 5) return y === 5 && (x === 3 || x === 4) ? hx('#8a4a4a') : hx('#f0b0a8');
      if (x >= 5 && y >= 1 && y <= 7 && x <= 7) return (x + y) % 2 ? bone : green; // exposed skull
    }
    if (f === 'right' && y > 2) return (x + y) % 3 ? bone : green;
    return vary(r.int(5) === 0 ? pinkD : pink, r, 0.05);
  });
  s.paintBox(16, 16, 8, 12, 4, (f, x, y) => {
    if (y >= 9) return vary(brown, r, 0.08);
    if ((f === 'front' || f === 'back') && x >= 4 && y >= 2 && y <= 7) return y % 2 ? bone : green;
    return vary(pink, r, 0.05);
  });
  s.paintBox(40, 16, 4, 12, 4, (f, x, y) => (y > 6 && y % 2 === 0 ? bone : vary(pink, r, 0.05)));
  s.paintBox(0, 16, 4, 12, 4, (f, x, y) => (y < 3 ? vary(brown, r, 0.08) : y > 8 && x < 2 ? bone : vary(pinkD, r, 0.05)));
  return s;
}

export function spiderSkin(): Skin {
  const s = new Skin();
  const r = new Random(10);
  const dark = hx('#342b24'), darker = hx('#231d18'), hairy = hx('#4a3e34');
  s.paintBox(32, 4, 8, 8, 8, (f, x, y) => {
    if (f === 'front') {
      if ((y === 2 || y === 3) && (x === 1 || x === 6)) return hx('#c01010');
      if (y === 3 && (x === 2 || x === 5)) return hx('#ff3030');
      if (y === 5 && (x === 3 || x === 4)) return hx('#ff3030');
      if (y === 1 && (x === 2 || x === 5)) return hx('#c01010');
    }
    return vary(r.int(4) ? dark : hairy, r, 0.06);
  });
  s.paintBox(0, 0, 6, 6, 6, () => vary(darker, r, 0.06));
  s.paintBox(0, 12, 10, 8, 12, (f, x, y) => vary(r.int(3) ? dark : hairy, r, 0.06));
  s.paintBox(18, 0, 16, 2, 2, () => vary(r.int(3) ? darker : hairy, r, 0.06));
  return s;
}

// ------------------------------------------------------------------ armor
const ARMOR_COLORS: Record<string, [string, string, string]> = {
  leather: ['#a0663a', '#c78452', '#6b4222'],
  iron: ['#c8c8c8', '#ececec', '#8a8a8a'],
  golden: ['#e8c030', '#fff080', '#a8820c'],
  diamond: ['#3ad6c8', '#a8fff4', '#1a8a84'],
};
/** layer 1: helmet, chestplate, boots; layer 2: leggings */
export function armorSkin(mat: string, layer: 1 | 2): Skin {
  const s = new Skin();
  const r = new Random(mat.length * 31 + layer);
  const [b, l, d] = ARMOR_COLORS[mat].map(hx);
  const c = (x: number, y: number, fw: number, fh: number) => {
    if (y === 0 || x === 0) return vary(l, r, 0.03);
    if (y === fh - 1 || x === fw - 1) return vary(d, r, 0.03);
    return vary(b, r, mat === 'leather' ? 0.08 : 0.04);
  };
  if (layer === 1) {
    s.paintBox(0, 0, 8, 8, 8, (f, x, y, fw, fh) => {
      if (f === 'bottom') return null;
      if (f === 'front') return y < 2 || x === 0 || x === 7 || (y === 2 && (x === 1 || x === 6)) ? c(x, y, fw, fh) : null;
      if (f === 'right' || f === 'left') return y < 6 ? c(x, y, fw, fh) : null;
      return c(x, y, fw, fh);
    });
    s.paintBox(16, 16, 8, 12, 4, (f, x, y, fw, fh) => (f === 'top' && x > 1 && x < 6 ? null : y < 11 || f === 'top' ? c(x, y, fw, fh) : null));
    s.paintBox(40, 16, 4, 12, 4, (f, x, y, fw, fh) => (f === 'bottom' ? null : y < 5 || f === 'top' ? c(x, y, fw, fh) : null));
    s.paintBox(0, 16, 4, 12, 4, (f, x, y, fw, fh) => (f === 'top' ? null : y >= 8 || f === 'bottom' ? c(x, y - 8, fw, 4) : null));
  } else {
    s.paintBox(16, 16, 8, 12, 4, (f, x, y, fw, fh) => (f === 'top' ? null : y >= 7 || f === 'bottom' ? c(x, y - 7, fw, fh - 7) : null));
    s.paintBox(0, 16, 4, 12, 4, (f, x, y, fw, fh) => (f === 'bottom' ? null : y < 9 || f === 'top' ? c(x, y, fw, 9) : null));
  }
  return s;
}
export const ARMOR_MATERIALS = Object.keys(ARMOR_COLORS);

// ------------------------------------------------------------------ The End
export function crystalModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('outer', 0, 0, 0, [box(-4, -4, -4, 8, 8, 8, 0, 0)]),
      part('inner', 0, 0, 0, [box(-3, -3, -3, 6, 6, 6, 32, 0)]),
      part('base', 0, 0, 0, [box(-6, 6, -6, 12, 4, 12, 0, 16)]),
    ],
  };
}
export function crystalSkin(): Skin {
  const s = new Skin();
  const r = new Random(808);
  const glass1 = hx('#e8b0ff'), glass2 = hx('#c070ff'), edge = hx('#f8e8ff');
  s.paintBox(0, 0, 8, 8, 8, (_f, x, y, fw, fh) => {
    const e = x === 0 || y === 0 || x === fw - 1 || y === fh - 1;
    const c = e ? edge : vary(r.int(3) === 0 ? glass1 : glass2, r, 0.06);
    return [c[0], c[1], c[2], e ? 235 : 150];
  });
  s.paintBox(32, 0, 6, 6, 6, (_f, x, y) => vary(((x + y) & 1) === 0 ? hx('#ff90ff') : hx('#c040e0'), r, 0.08));
  s.paintBox(0, 16, 12, 4, 12, () => vary(hx('#1c1c1c'), r, 0.2));
  return s;
}

/** Silverfish: seven body blocks laid end to end. */
const SILVER = [[3, 2, 2, 0, 0], [4, 3, 2, 0, 4], [6, 4, 3, 0, 9], [3, 3, 3, 0, 16], [2, 2, 3, 0, 22], [2, 1, 2, 11, 0], [1, 1, 2, 13, 4]];
export function silverfishModel(): ModelDef {
  const parts: ModelPart[] = [];
  let z = -3.5;
  SILVER.forEach(([w, h, d, u, v], i) => {
    parts.push(part('s' + i, 0, 24 - h, z, [box(-w / 2, 0, -d / 2, w, h, d, u, v)]));
    if (i < SILVER.length - 1) z += (d + SILVER[i + 1][2]) * 0.5;
  });
  return { texW: 64, texH: 32, parts };
}
export function silverfishSkin(): Skin {
  const s = new Skin();
  const r = new Random(66);
  const a = hx('#7a7a82'), b = hx('#5e5e66'), c = hx('#9a9aa2');
  for (const [w, h, d, u, v] of SILVER) s.paintBox(u, v, w, h, d, (f, x, y) => vary(f === 'top' ? c : (y + x) % 2 ? a : b, r, 0.08));
  s.set(13, 6, hx('#101010')); s.set(14, 6, hx('#101010'));
  return s;
}

// ------------------------------------------------------------------ horses (1.8 ModelHorse proportions)
// Texture 128x128. The head group (neck, head, muzzle, ears, mane) shares the neck pivot so it moves as one.
const HORSE_UV = {
  neck: [0, 0], head: [24, 0], muzzle: [24, 12], jaw: [48, 0], ear: [66, 0], longEar: [72, 0], mane: [78, 0],
  tailBase: [90, 0], tailMid: [90, 5], tailTip: [90, 16], body: [0, 30], thigh: [68, 30], shin: [86, 30], hoof: [98, 30], foreleg: [68, 44],
  saddle: [0, 64], saddleFront: [36, 64], saddleBack: [48, 64], strap: [70, 64], stirrup: [76, 64], bag: [0, 80],
} as const;
export function horseModel(long: boolean, inflate = 0): ModelDef {
  const U = HORSE_UV, o = { inflate };
  const ears = long
    ? [box(0.45, -16, 4, 2, 7, 1, U.longEar[0], U.longEar[1], o), box(-2.45, -16, 4, 2, 7, 1, U.longEar[0], U.longEar[1], { mirror: true, inflate })]
    : [box(0.45, -12, 4, 2, 3, 1, U.ear[0], U.ear[1], o), box(-2.45, -12, 4, 2, 3, 1, U.ear[0], U.ear[1], { mirror: true, inflate })];
  const leg = (front: boolean, mirror: boolean) => [
    front ? box(-1.9, -1, -2.1, 3, 8, 4, U.foreleg[0], U.foreleg[1], { mirror, inflate }) : box(-2.5, -2, -2.5, 4, 9, 5, U.thigh[0], U.thigh[1], { mirror, inflate }),
    box(-2, 7, -1.5, 3, 5, 3, U.shin[0], U.shin[1], { mirror, inflate }),
    box(-2.5, 12.1, -2, 4, 3, 4, U.hoof[0], U.hoof[1], { mirror, inflate }),
  ];
  return {
    texW: 128, texH: 128,
    parts: [
      part('head', 0, 4, -10, [
        box(-2.05, -9.8, -2, 4, 14, 8, U.neck[0], U.neck[1], o),
        box(-2.5, -10, -1.5, 5, 5, 7, U.head[0], U.head[1], o),
        box(-2, -10, -7, 4, 3, 6, U.muzzle[0], U.muzzle[1], o),
        box(-2, -7, -6.5, 4, 2, 5, U.jaw[0], U.jaw[1], o),
        ...ears,
        box(-1, -11.5, 5, 2, 16, 4, U.mane[0], U.mane[1], o),
      ], { rx: Math.PI / 6 }),
      part('body', 0, 11, 9, [box(-5, -8, -19, 10, 10, 24, U.body[0], U.body[1], o)]),
      part('tail', 0, 3, 14, [box(-1, -1, 0, 2, 2, 3, U.tailBase[0], U.tailBase[1], o), box(-1.5, -2, 3, 3, 4, 7, U.tailMid[0], U.tailMid[1], o), box(-1.5, -1.5, 9.5, 3, 4, 6, U.tailTip[0], U.tailTip[1], o)], { rx: -1.1 }),
      part('leg1', 4, 9, 11, leg(false, false)),
      part('leg2', -4, 9, 11, leg(false, true)),
      part('leg3', 4, 9, -8, leg(true, false)),
      part('leg4', -4, 9, -8, leg(true, true)),
      part('saddle', 0, 2, 2, [
        box(-5, 0, -3, 10, 1, 8, U.saddle[0], U.saddle[1]), box(-1.5, -1, -3, 3, 1, 2, U.saddleFront[0], U.saddleFront[1]), box(-4, -1, 3, 8, 1, 2, U.saddleBack[0], U.saddleBack[1]),
        box(5, 0, 1, 1, 6, 1, U.strap[0], U.strap[1]), box(-6, 0, 1, 1, 6, 1, U.strap[0], U.strap[1]),
        box(4.5, 6, 0, 2, 2, 3, U.stirrup[0], U.stirrup[1]), box(-6.5, 6, 0, 2, 2, 3, U.stirrup[0], U.stirrup[1]),
      ]),
      part('bags', 0, 0, 0, [box(5, 3, 4, 3, 8, 8, U.bag[0], U.bag[1]), box(-8, 3, 4, 3, 8, 8, U.bag[0], U.bag[1], { mirror: true })]),
    ],
  };
}

const HORSE_COATS: [string, string][] = [
  ['#e9e4da', '#cfc8bb'], // white
  ['#c8a06a', '#a27c4a'], // creamy
  ['#9a5528', '#7a3e1a'], // chestnut
  ['#6a4226', '#4e2f19'], // brown
  ['#2c2622', '#1c1814'], // black
  ['#7c7570', '#5e5854'], // gray
  ['#40291a', '#2c1c10'], // dark brown
];
const HORSE_MANES = ['#bdb6aa', '#7a5a34', '#5a2a10', '#2a1a0e', '#121010', '#3a3634', '#1a100a'];

/** Paint every box of the horse model; `coat` picks the colour for a face pixel (region name, face, x, y). */
function paintHorse(s: Skin, coat: (region: string, f: Face, x: number, y: number, w: number, h: number) => [number, number, number] | null) {
  const U = HORSE_UV;
  const reg = (name: keyof typeof HORSE_UV, w: number, h: number, d: number) => s.paintBox(U[name][0], U[name][1], w, h, d, (f, x, y, fw, fh) => coat(name, f, x, y, fw, fh));
  reg('neck', 4, 14, 8); reg('head', 5, 5, 7); reg('muzzle', 4, 3, 6); reg('jaw', 4, 2, 5); reg('ear', 2, 3, 1); reg('longEar', 2, 7, 1); reg('mane', 2, 16, 4);
  reg('tailBase', 2, 2, 3); reg('tailMid', 3, 4, 7); reg('tailTip', 3, 4, 6); reg('body', 10, 10, 24); reg('thigh', 4, 9, 5); reg('shin', 3, 5, 3); reg('hoof', 4, 3, 4); reg('foreleg', 3, 8, 4);
}

function horseSaddle(s: Skin, r: Random) {
  const U = HORSE_UV;
  const leather = (f: Face, x: number, y: number) => vary(f === 'top' && (x === 0 || y === 0) ? hx('#8a5428') : hx('#6a3c1c'), r, 0.06);
  s.paintBox(U.saddle[0], U.saddle[1], 10, 1, 8, leather);
  s.paintBox(U.saddleFront[0], U.saddleFront[1], 3, 1, 2, leather);
  s.paintBox(U.saddleBack[0], U.saddleBack[1], 8, 1, 2, leather);
  s.paintBox(U.strap[0], U.strap[1], 1, 6, 1, () => hx('#3a2414'));
  s.paintBox(U.stirrup[0], U.stirrup[1], 2, 2, 3, () => vary(hx('#a8a8a8'), r, 0.08));
  s.paintBox(U.bag[0], U.bag[1], 3, 8, 8, (f, x, y) => (y === 1 ? hx('#3a2414') : vary(hx('#8a5a2c'), r, 0.06)));
}

const isHead = (n: string) => n === 'head' || n === 'muzzle' || n === 'jaw' || n === 'neck' || n === 'ear' || n === 'longEar';
const isLeg = (n: string) => n === 'thigh' || n === 'shin' || n === 'foreleg' || n === 'hoof';

export function horseSkin(color: number, markings: number): Skin {
  const s = new Skin(128, 128);
  const r = new Random(900 + color * 7 + markings);
  const [base, dark] = HORSE_COATS[color].map(hx);
  const mane = hx(HORSE_MANES[color]);
  const white = hx('#ece9e2'), black = hx('#1a1614');
  const spots = Array.from({ length: 40 }, () => [r.int(128), r.int(128)]);
  const blobs = Array.from({ length: 7 }, () => [r.int(128), 30 + r.int(40), 4 + r.int(6)]);
  paintHorse(s, (n, f, x, y, w, h) => {
    const U = HORSE_UV[n as keyof typeof HORSE_UV];
    const gx = U[0] + x, gy = U[1] + y;
    if (n === 'mane' || n === 'tailMid' || n === 'tailTip' || n === 'tailBase') return vary(r.int(4) ? mane : shade3(mane, 1.25), r, 0.08);
    if (n === 'hoof') return vary(hx('#3c3632'), r, 0.06);
    let c = vary(r.int(5) ? base : dark, r, 0.04);
    // shading: belly and lower legs a touch darker
    if ((n === 'body' && f === 'bottom') || (isLeg(n) && y > h * 0.6)) c = shade3(c, 0.88);
    if (n === 'head' && f !== 'top' && f !== 'bottom' && (f === 'left' || f === 'right') && y === 2 && x === Math.floor(w * 0.3)) return hx('#0e0c0a'); // eyes
    if (n === 'muzzle' && f === 'front' && y === 1 && (x === 0 || x === w - 1)) return hx('#181412'); // nostrils
    switch (markings) {
      case 1: // white socks and a blaze
        if ((n === 'shin' || (n === 'foreleg' && y > 5)) ) return vary(white, r, 0.03);
        if ((n === 'muzzle' || n === 'head') && f === 'top' && x >= 1 && x <= w - 2) return vary(white, r, 0.03);
        if (n === 'muzzle' && f === 'front') return vary(white, r, 0.03);
        break;
      case 2: // white field: big patches
        if (blobs.some(([bx, by, br]) => Math.hypot(gx - bx, gy - by) < br) || (n === 'shin' && y > 1)) return vary(white, r, 0.03);
        break;
      case 3: // white dots
        if (!isHead(n) && spots.some(([sx, sy]) => Math.abs(gx - sx) + Math.abs(gy - sy) < 1.5)) return vary(white, r, 0.03);
        break;
      case 4: // black dots
        if (!isHead(n) && spots.some(([sx, sy]) => Math.abs(gx - sx) + Math.abs(gy - sy) < 1.5)) return vary(black, r, 0.03);
        break;
    }
    return c;
  });
  horseSaddle(s, r);
  return s;
}

export function donkeySkin(mule: boolean): Skin {
  const s = new Skin(128, 128);
  const r = new Random(mule ? 77 : 66);
  const base = hx(mule ? '#6a4630' : '#8a7c6c'), dark = hx(mule ? '#523422' : '#6e6254'), pale = hx(mule ? '#a88a6a' : '#cfc4b4');
  const mane = hx(mule ? '#2c1c10' : '#4a3e34');
  paintHorse(s, (n, f, x, y, w, h) => {
    if (n === 'mane' || n.startsWith('tail')) return vary(mane, r, 0.08);
    if (n === 'hoof') return vary(hx('#3c3632'), r, 0.06);
    if (n === 'head' && (f === 'left' || f === 'right') && y === 2 && x === Math.floor(w * 0.3)) return hx('#0e0c0a');
    // pale muzzle and belly, a dark stripe down the back
    if (n === 'muzzle' || n === 'jaw') return vary(pale, r, 0.04);
    if (n === 'body' && f === 'bottom') return vary(pale, r, 0.04);
    if (n === 'body' && f === 'top' && (x === 4 || x === 5)) return vary(mane, r, 0.06);
    if (n === 'longEar' && f === 'front') return vary(shade3(base, 0.7), r, 0.05);
    if (isLeg(n) && y > h * 0.7) return vary(dark, r, 0.05);
    return vary(r.int(5) ? base : dark, r, 0.04);
  });
  horseSaddle(s, r);
  return s;
}

/** Horse armour layer (drawn on a slightly inflated model): plates on the head, neck, body and upper legs. */
export function horseArmorSkin(kind: string): Skin {
  const s = new Skin(128, 128);
  const r = new Random(31);
  const [hi, mid, lo] = ({ iron: ['#eeeeee', '#c4c4c4', '#8a8a8a'], gold: ['#fff6a8', '#f0c830', '#b08a10'], diamond: ['#d0fff6', '#4ae0d0', '#1a8a80'] } as Record<string, string[]>)[kind].map(hx);
  paintHorse(s, (n, f, x, y, w, h) => {
    if (n === 'mane' || n.startsWith('tail') || n === 'hoof' || n === 'shin' || n === 'ear' || n === 'longEar' || n === 'jaw') return null;
    if (n === 'thigh' || n === 'foreleg') { if (y > h * 0.6) return null; }
    if (n === 'body' && f === 'bottom') return null;
    if (n === 'head' && (f === 'left' || f === 'right') && y === 2 && x === Math.floor(w * 0.3)) return null; // eye holes
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    return vary(edge ? lo : (x + y) % 5 === 0 ? hi : mid, r, 0.04);
  });
  return s;
}

function shade3(c: [number, number, number], f: number): [number, number, number] {
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))) as [number, number, number];
}
