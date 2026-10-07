// Box models and painted skins of the mobs added for 1.16 (vanilla model shapes, this game's procedural skins).
// EntityRenderer loads everything in MOB_MODELS and MOB_SKINS; poses come from the shared biped/quadruped code
// or from the cases written for the odd shapes (striders, shulkers, bees, fish...).
import { Random } from '../noise';
import { ModelDef, ModelBox, ModelPart, Skin, skeletonSkin, slimeSkin } from './models';

const box = (x: number, y: number, z: number, w: number, h: number, d: number, u: number, v: number, extra: Partial<ModelBox> = {}): ModelBox => ({ x, y, z, w, h, d, u, v, ...extra });
const part = (name: string, px: number, py: number, pz: number, boxes: ModelBox[], extra: Partial<ModelPart> = {}): ModelPart => ({ name, px, py, pz, boxes, ...extra });
type RGB = [number, number, number];
const hx = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const vary = (c: RGB, r: Random, amt = 0.08): RGB => {
  const f = 1 + (r.next() - 0.5) * 2 * amt;
  return [c[0] * f, c[1] * f, c[2] * f].map((x) => Math.max(0, Math.min(255, Math.round(x)))) as RGB;
};
/** Swap a skin's colours toward a new hue by brightness (recolouring a sibling mob). */
function recolor(s: Skin, f: (c: RGB) => RGB): Skin {
  for (let i = 0; i < s.data.length; i += 4) {
    if (!s.data[i + 3]) continue;
    const c = f([s.data[i], s.data[i + 1], s.data[i + 2]]);
    s.data[i] = c[0]; s.data[i + 1] = c[1]; s.data[i + 2] = c[2];
  }
  return s;
}

// ------------------------------------------------------------------ models
/** Piglins: a biped with a wide head, a snout, tusks and floppy ears (64x64 texture). */
export function piglinModel(): ModelDef {
  return {
    texW: 64, texH: 64,
    parts: [
      part('head', 0, 0, 0, [box(-5, -8, -4, 10, 8, 8, 0, 0), box(-2, -4, -5, 4, 4, 1, 36, 0), box(-3, -2, -5, 1, 2, 1, 46, 0), box(2, -2, -5, 1, 2, 1, 46, 0)]),
      part('rightEar', -4.5, -6, 0, [box(-1, 0, -2, 1, 5, 4, 51, 6)], { rz: 0.5 }),
      part('leftEar', 4.5, -6, 0, [box(0, 0, -2, 1, 5, 4, 39, 6)], { rz: -0.5 }),
      part('body', 0, 0, 0, [box(-4, 0, -2, 8, 12, 4, 16, 16)]),
      part('rightArm', -5, 2, 0, [box(-3, -2, -2, 4, 12, 4, 40, 16)]),
      part('leftArm', 5, 2, 0, [box(-1, -2, -2, 4, 12, 4, 32, 48)]),
      part('rightLeg', -1.9, 12, 0, [box(-2, 0, -2, 4, 12, 4, 0, 16)]),
      part('leftLeg', 1.9, 12, 0, [box(-2, 0, -2, 4, 12, 4, 16, 48)]),
    ],
  };
}
/** Hoglins: a big quadruped with a long head, tusks and a mane (128x64). */
export function hoglinModel(): ModelDef {
  const leg = (name: string, x: number, z: number, u: number) => part(name, x, 10, z, [box(-3, 0, -3, 6, 14, 6, u, 42)]);
  return {
    texW: 128, texH: 64,
    parts: [
      part('head', 0, 6, -12, [box(-7, -3, -19, 14, 6, 19, 61, 1), box(-8, -10, -17, 2, 11, 2, 88, 30), box(6, -10, -17, 2, 11, 2, 96, 30), box(-11, -4, -6, 4, 1, 6, 104, 30), box(7, -4, -6, 4, 1, 6, 104, 38)], { rx: 0.87 }),
      part('body', 0, 7, 0, [box(-8, -13, -7, 16, 26, 14, 1, 1), box(-0.5, -13, -12, 1, 20, 5, 90, 46)], { rx: Math.PI / 2 }),
      leg('leg1', -5, 10, 41), leg('leg2', 5, 10, 41), leg('leg3', -5, -10, 66), leg('leg4', 5, -10, 66),
    ],
  };
}
/** Striders: a squat body on two long legs, a fringe of bristles on top (64x64). */
export function striderModel(): ModelDef {
  return {
    texW: 64, texH: 64,
    parts: [
      part('body', 0, 1, 0, [box(-8, -6, -8, 16, 14, 16, 0, 0)]),
      part('bristle1', -8, -5, 0, [box(-12, 0, 0, 12, 1, 0, 0, 52)], { rz: 0.9 }),
      part('bristle2', 8, -5, 0, [box(0, 0, 0, 12, 1, 0, 0, 55)], { rz: -0.9 }),
      part('bristle3', 0, -5, -8, [box(-8, -10, 0, 16, 10, 0, 32, 32)], { rx: -0.4 }),
      part('rightLeg', -4, 8, 0, [box(-2, 0, -2, 4, 16, 4, 0, 32)]),
      part('leftLeg', 4, 8, 0, [box(-2, 0, -2, 4, 16, 4, 16, 32)]),
    ],
  };
}

export const MOB_MODELS: Record<string, () => ModelDef> = {
  piglin: piglinModel, hoglin: hoglinModel, strider: striderModel,
};

// ------------------------------------------------------------------ skins
function piglinSkin(brute: boolean): Skin {
  const s = new Skin(64, 64);
  const r = new Random(brute ? 61 : 60);
  const pink = hx(brute ? '#b7837a' : '#eba7a0'), pinkD = hx(brute ? '#93655d' : '#cf8a82'), snout = hx(brute ? '#c9968c' : '#f6bcb4');
  const cloth = hx(brute ? '#2a2a2a' : '#6b4a2a'), clothD = hx(brute ? '#1a1a1a' : '#4f351c'), gold = hx('#f1c43a'), tusk = hx('#e8e0c8');
  s.paintBox(0, 0, 10, 8, 8, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && (x === 2 || x === 7)) return [255, 255, 255];
      if (y === 3 && (x === 3 || x === 6)) return hx('#2a1a14');
      if (y === 1 && x > 1 && x < 8) return pinkD;
    }
    return vary(r.int(4) ? pink : pinkD, r, 0.04);
  });
  s.paintBox(36, 0, 4, 4, 1, (f, x, y) => (f === 'front' && y === 1 && (x === 1 || x === 2) ? hx('#6a3a3a') : vary(snout, r, 0.03)));
  s.paintBox(46, 0, 1, 2, 1, () => tusk);
  s.paintBox(51, 6, 1, 5, 4, () => vary(pinkD, r, 0.05));
  s.paintBox(39, 6, 1, 5, 4, () => vary(pinkD, r, 0.05));
  s.paintBox(16, 16, 8, 12, 4, (f, x, y) => (y === 7 ? gold : y > 7 ? vary(cloth, r, 0.06) : brute && y > 2 ? vary(clothD, r, 0.06) : vary(pink, r, 0.04)));
  for (const [u, v] of [[40, 16], [32, 48]] as const) s.paintBox(u, v, 4, 12, 4, (f, x, y) => (brute && y < 5 ? vary(cloth, r, 0.05) : y === 4 && !brute ? gold : vary(pink, r, 0.04)));
  for (const [u, v] of [[0, 16], [16, 48]] as const) s.paintBox(u, v, 4, 12, 4, (f, x, y) => (y > 9 ? hx('#3a2a1a') : vary(y < 6 ? cloth : clothD, r, 0.06)));
  return s;
}
function hoglinSkin(zoglin: boolean): Skin {
  const s = new Skin(128, 64);
  const r = new Random(zoglin ? 71 : 70);
  const hide = hx(zoglin ? '#d8a0a0' : '#a8695a'), hideD = hx(zoglin ? '#b07878' : '#7c4a3e'), mane = hx(zoglin ? '#c8c0a8' : '#5a3a2a'), tusk = hx('#efe8d6');
  const rot = hx('#5a8a4a');
  s.paintBox(1, 1, 16, 26, 14, (f, x, y) => {
    if (zoglin && r.int(9) === 0) return vary(rot, r, 0.1);
    return vary(f === 'top' ? mane : r.int(5) ? hide : hideD, r, 0.06);
  });
  s.paintBox(61, 1, 14, 6, 19, (f, x, y) => {
    if (f === 'front') { if (y === 1 && (x === 3 || x === 10)) return zoglin ? hx('#e8e8e8') : hx('#1a1010'); if (y >= 3 && x >= 4 && x <= 9) return hx(zoglin ? '#c09090' : '#8a5040'); }
    if (zoglin && r.int(8) === 0) return vary(rot, r, 0.1);
    return vary(hide, r, 0.06);
  });
  for (const u of [88, 96]) s.paintBox(u, 30, 2, 11, 2, () => vary(tusk, r, 0.03));
  for (const v of [30, 38]) s.paintBox(104, v, 4, 1, 6, () => vary(hideD, r, 0.05));
  s.paintBox(90, 46, 1, 20, 5, () => vary(mane, r, 0.08));
  for (const u of [41, 66]) s.paintBox(u, 42, 6, 14, 6, (f, x, y) => vary(y > 11 ? hx('#3a2a20') : hideD, r, 0.06));
  return s;
}
function striderSkin(cold: boolean): Skin {
  const s = new Skin(64, 64);
  const r = new Random(cold ? 81 : 80);
  const body = hx(cold ? '#6a4c8a' : '#b8392f'), bodyD = hx(cold ? '#4e3668' : '#8a2620'), leg = hx(cold ? '#8a7a9a' : '#9a8a8a');
  s.paintBox(0, 0, 16, 14, 16, (f, x, y) => {
    if (f === 'front') {
      if (y >= 4 && y <= 6 && (x === 3 || x === 4 || x === 11 || x === 12)) return y === 5 ? hx('#1a0a0a') : hx('#f0e0d0');
      if (y === 10 && x >= 4 && x <= 11) return bodyD;
    }
    return vary(r.int(6) ? body : bodyD, r, 0.05);
  });
  for (const u of [0, 16]) s.paintBox(u, 32, 4, 16, 4, (f, x, y) => vary(y % 4 === 0 ? hx(cold ? '#5a4a6a' : '#6a5a5a') : leg, r, 0.05));
  const hair = hx(cold ? '#8a7aa8' : '#c8862a');
  for (let x = 0; x < 32; x++) for (let y = 52; y < 58; y++) s.set(x, y, vary(hair, r, 0.1));
  for (let x = 32; x < 48; x++) for (let y = 32; y < 42; y++) if (x % 3 !== 2 || y > 39) s.set(x, y, vary(hair, r, 0.1));
  return s;
}
function magmaCubeSkin(): Skin {
  const s = slimeSkin();
  // the slime's layers in magma: dark red-black with glowing orange cracks; opaque
  const r = new Random(91);
  for (let i = 0; i < s.data.length; i += 4) {
    if (!s.data[i + 3]) continue;
    const hot = r.int(5) === 0;
    const c = hot ? vary(hx('#f8a020'), r, 0.1) : vary(r.bool() ? hx('#3a1010') : hx('#5a1a10'), r, 0.1);
    s.data[i] = c[0]; s.data[i + 1] = c[1]; s.data[i + 2] = c[2]; s.data[i + 3] = 255;
  }
  for (let y = 0; y < 8; y++) for (let x = 32; x < 40; x++) s.set(x, y, hx('#f8e040'));
  return s;
}
function witherSkeletonSkin(): Skin {
  return recolor(skeletonSkin(), ([r, g, b]) => { const l = (r + g + b) / 3; const v = Math.round(l * 0.22 + 10); return [v, v, v + 2]; });
}

export const MOB_SKINS: Record<string, () => Skin> = {
  piglin: () => piglinSkin(false), piglin_brute: () => piglinSkin(true),
  hoglin: () => hoglinSkin(false), zoglin: () => hoglinSkin(true),
  strider: () => striderSkin(false), strider_cold: () => striderSkin(true),
  magma_cube: magmaCubeSkin, wither_skeleton: witherSkeletonSkin,
};
