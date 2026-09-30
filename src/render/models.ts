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
