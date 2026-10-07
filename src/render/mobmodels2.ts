// Models, painted skins and poses of the overworld mobs added between 1.4 and 1.16 (illagers, witches, golems,
// guardians, phantoms, ravagers, and the zombie and skeleton variants). Mobs whose model has an entry in MOB_POSES
// are posed by it (EntityRenderer draws them generically); illagers use the biped poses, witches the villager's.
import { Random } from '../noise';
import { ModelDef, ModelBox, ModelPart, Skin, zombieSkin, skeletonSkin, spiderSkin, villagerModel } from './models';

const box = (x: number, y: number, z: number, w: number, h: number, d: number, u: number, v: number, extra: Partial<ModelBox> = {}): ModelBox => ({ x, y, z, w, h, d, u, v, ...extra });
const part = (name: string, px: number, py: number, pz: number, boxes: ModelBox[], extra: Partial<ModelPart> = {}): ModelPart => ({ name, px, py, pz, boxes, ...extra });
type RGB = [number, number, number];
const hx = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const vary = (c: RGB, r: Random, amt = 0.08): RGB => {
  const f = 1 + (r.next() - 0.5) * 2 * amt;
  return [c[0] * f, c[1] * f, c[2] * f].map((x) => Math.max(0, Math.min(255, Math.round(x)))) as RGB;
};
const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
/** Recolour every painted pixel of a skin. */
function recolor(s: Skin, f: (c: RGB, x: number, y: number) => RGB): Skin {
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = (y * s.w + x) * 4;
    if (!s.data[i + 3]) continue;
    const c = f([s.data[i], s.data[i + 1], s.data[i + 2]], x, y);
    s.data[i] = c[0]; s.data[i + 1] = c[1]; s.data[i + 2] = c[2];
  }
  return s;
}
const lum = (c: RGB) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255;

// ------------------------------------------------------------------ models
/** Illagers and zombie villagers: a villager's long head and nose on a biped (64x64). */
export function illagerModel(robe = false): ModelDef {
  return {
    texW: 64, texH: 64,
    parts: [
      part('head', 0, 0, 0, [box(-4, -10, -4, 8, 10, 8, 0, 0), box(-1, -3, -6, 2, 4, 2, 24, 0)]),
      part('body', 0, 0, 0, [box(-4, 0, -3, 8, 12, 6, 16, 20), ...(robe ? [box(-4, 0, -3, 8, 18, 6, 0, 38, { inflate: 0.5 })] : [])]),
      part('rightArm', -5, 2, 0, [box(-3, -2, -2, 4, 12, 4, 44, 22)]),
      part('leftArm', 5, 2, 0, [box(-1, -2, -2, 4, 12, 4, 44, 22, { mirror: true })]),
      part('rightLeg', -2, 12, 0, [box(-2, 0, -2, 4, 12, 4, 0, 22)]),
      part('leftLeg', 2, 12, 0, [box(-2, 0, -2, 4, 12, 4, 0, 22, { mirror: true })]),
    ],
  };
}
/** Witches: the villager with a pointed hat (64x128). */
export function witchModel(): ModelDef {
  const v = villagerModel();
  return {
    texW: 64, texH: 128,
    parts: [
      ...v.parts,
      part('hat', 0, 0, 0, [box(-5, -10.03, -5, 10, 2, 10, 0, 64), box(-3.5, -14, -3.5, 7, 4, 7, 0, 76), box(-2, -17, -1, 4, 3, 4, 0, 87), box(-0.5, -19, 1.5, 1, 2, 1, 0, 95)]),
    ],
  };
}
/** Ravagers (128x128): a huge horned head with a jaw, a barrel body on four thick legs. */
export function ravagerModel(): ModelDef {
  const leg = (name: string, x: number, z: number) => part(name, x, 8, z, [box(-3, 0, -3, 6, 16, 6, 80, 0)]);
  return {
    texW: 128, texH: 128,
    parts: [
      part('body', 0, 0, 2, [box(-7, -9, -13, 14, 17, 26, 0, 0)]),
      part('head', 0, -3, -12, [box(-6, -7, -14, 12, 14, 14, 0, 44), box(-9, -11, -9, 2, 7, 2, 80, 24), box(7, -11, -9, 2, 7, 2, 80, 24), box(-2, -1, -16, 4, 6, 2, 88, 24)]),
      part('jaw', 0, -3, -12, [box(-5, 7, -13, 10, 3, 12, 56, 44)]),
      leg('leg1', -5, 12), leg('leg2', 5, 12), leg('leg3', -5, -8), leg('leg4', 5, -8),
    ],
  };
}
/** Guardians (64x64): a spiked block of a body with one big eye and a three-piece tail. */
export function guardianModel(): ModelDef {
  // each spike points out along its direction (a box along +y turned by x then z)
  const spikes: ModelPart[] = SPIKE_DIRS.map(([x, y, z], i) => part('spike' + i, x * 6, 16 + y * 6, z * 7, [box(-0.5, -4.5, -0.5, 1, 9, 1, 0, 56)], {
    rx: Math.atan2(z, Math.hypot(x, y)), rz: Math.atan2(-x, y),
  }));
  return {
    texW: 64, texH: 64,
    parts: [
      part('body', 0, 16, 0, [box(-6, -6, -8, 12, 12, 16, 0, 0)]),
      part('eye', 0, 16, -8.05, [box(-1, -1, -0.5, 2, 2, 1, 8, 32)]),
      part('tail1', 0, 16, 8, [box(-2, -2, 0, 4, 4, 8, 0, 36)]),
      part('tail2', 0, 16, 16, [box(-1.5, -1.5, 0, 3, 3, 7, 24, 36)]),
      part('tail3', 0, 16, 23, [box(-1, -1, 0, 2, 2, 6, 44, 36), box(0, -4.5, 3, 1, 9, 9, 0, 50)]),
      ...spikes,
    ],
  };
}
/** Outward directions of a guardian's 12 spikes (the cube's edges, vanilla-ish). */
const SPIKE_DIRS: [number, number, number][] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
];
/** Phantoms (64x64): a flat body, a wide head, two-piece wings and a tail. */
export function phantomModel(): ModelDef {
  return {
    texW: 64, texH: 64,
    parts: [
      part('body', 0, 20, 0, [box(-2.5, -1.5, -4.5, 5, 3, 9, 0, 8)]),
      part('head', 0, 20, -4.5, [box(-3.5, -1.5, -5, 7, 3, 5, 0, 0)]),
      part('rightWing', -2.5, 19, -3.5, [box(-6, 0, 0, 6, 2, 9, 23, 12)]),
      part('rightTip', -8.5, 19, -3.5, [box(-13, 0, 0, 13, 1, 9, 16, 24)]),
      part('leftWing', 2.5, 19, -3.5, [box(0, 0, 0, 6, 2, 9, 23, 12, { mirror: true })]),
      part('leftTip', 8.5, 19, -3.5, [box(0, 0, 0, 13, 1, 9, 16, 24, { mirror: true })]),
      part('tail', 0, 19.5, 4.5, [box(-1.5, 0, 0, 3, 2, 6, 3, 20)]),
      part('tailTip', 0, 20, 10.5, [box(-0.5, 0, 0, 1, 1, 6, 4, 29)]),
    ],
  };
}
/** Iron golems (128x128): long arms, a broad chest, a villager's face. */
export function ironGolemModel(): ModelDef {
  return {
    texW: 128, texH: 128,
    parts: [
      part('head', 0, -7, -2, [box(-4, -12, -5.5, 8, 10, 8, 0, 0), box(-1, -5, -7.5, 2, 4, 2, 24, 0)]),
      part('body', 0, -7, 0, [box(-9, -2, -6, 18, 12, 11, 0, 40), box(-4.5, 10, -3, 9, 5, 6, 0, 70, { inflate: 0.5 })]),
      part('rightArm', 0, -7, 0, [box(-13, -2.5, -3, 4, 30, 6, 60, 21)]),
      part('leftArm', 0, -7, 0, [box(9, -2.5, -3, 4, 30, 6, 60, 58)]),
      part('rightLeg', -4, 11, 0, [box(-3.5, -3, -3, 6, 16, 5, 37, 0)]),
      part('leftLeg', 5, 11, 0, [box(-3.5, -3, -3, 6, 16, 5, 60, 0, { mirror: true })]),
    ],
  };
}
/** Snow golems (64x128): three stacked snowballs, stick arms, a pumpkin head. */
export function snowGolemModel(): ModelDef {
  return {
    texW: 64, texH: 128,
    parts: [
      part('head', 0, 4, 0, [box(-4, -8, -4, 8, 8, 8, 0, 0, { inflate: -0.5 })]),
      part('pumpkin', 0, 4, 0, [box(-5, -9.5, -5, 10, 10, 10, 0, 64, { inflate: -0.4 })]),
      part('upper', 0, 13, 0, [box(-5, -10, -5, 10, 10, 10, 0, 16, { inflate: -0.5 })]),
      part('lower', 0, 24, 0, [box(-6, -12, -6, 12, 12, 12, 0, 36, { inflate: -0.5 })]),
      part('rightArm', -5, 6, 1, [box(-11, -1, -1, 12, 2, 2, 32, 0)], { rz: -1 }),
      part('leftArm', 5, 6, -1, [box(-1, -1, -1, 12, 2, 2, 32, 0)], { rz: 1 }),
    ],
  };
}
/** Evoker fangs (64x32): a base and two jaws. */
export function fangsModel(): ModelDef {
  return {
    texW: 64, texH: 32,
    parts: [
      part('base', -5, 22, -5, [box(0, 0, 0, 10, 12, 10, 0, 0)]),
      part('upperJaw', 1.5, 24, -4, [box(0, 0, 0, 4, 14, 8, 40, 0)]),
      part('lowerJaw', -1.5, 24, 4, [box(0, 0, 0, 4, 14, 8, 40, 0)], { ry: Math.PI }),
    ],
  };
}
/** A guardian's laser: a unit-long beam along +z. */
export function beamModel(): ModelDef {
  return { texW: 16, texH: 16, parts: [part('beam', 0, 0, 0, [box(-1, -1, 0, 2, 2, 16, 0, 0)])] };
}

export const MOB_MODELS2: Record<string, () => ModelDef> = {
  illager: () => illagerModel(false), illager_robed: () => illagerModel(true), witch: witchModel, ravager: ravagerModel,
  guardian: guardianModel, phantom: phantomModel, iron_golem: ironGolemModel, snow_golem: snowGolemModel, fangs: fangsModel, beam: beamModel,
};

// ------------------------------------------------------------------ poses
export interface PoseCtx {
  e: Record<string, unknown>;
  hp: number; netHead: number; ls: number; lsa: number; age: number; t: number;
}
export interface PoseOut { pose: Record<string, [number, number, number]>; offs?: Record<string, [number, number, number]>; skin?: string; skip?: Set<string>; fullBright?: boolean }
const c = Math.cos, s = Math.sin;
const walk = (ls: number, lsa: number, phase = 0, amp = 1.4) => c(ls * 0.6662 + phase) * amp * lsa;

export const MOB_POSES: Record<string, (p: PoseCtx) => PoseOut> = {
  ravager: ({ e, hp, netHead, ls, lsa }) => {
    const bite = ((e.biteTicks as number) ?? 0) / 10, roar = ((e.roarTicks as number) ?? 0) / 20;
    const jaw = Math.max(Math.sin(bite * Math.PI) * 0.6, roar > 0 ? 0.8 : 0);
    return {
      pose: {
        head: [hp * 0.5 - roar * 0.5, netHead * 0.6, 0], jaw: [hp * 0.5 - roar * 0.5 + jaw, netHead * 0.6, 0],
        leg1: [walk(ls, lsa, 0, 0.8), 0, 0], leg2: [walk(ls, lsa, Math.PI, 0.8), 0, 0], leg3: [walk(ls, lsa, Math.PI, 0.8), 0, 0], leg4: [walk(ls, lsa, 0, 0.8), 0, 0],
      },
    };
  },
  guardian: ({ e, hp, netHead, age }) => {
    const out = (e.spikes as number) ?? 1, wave = (e.tail as number) ?? age * 0.1;
    const pose: Record<string, [number, number, number]> = {};
    void hp; void netHead;
    const offs: Record<string, [number, number, number]> = {};
    // the tail sways, each piece following the one before
    const a1 = s(wave) * Math.PI * 0.05, a2 = a1 + s(wave - 0.5) * Math.PI * 0.08, a3 = a2 + s(wave - 1) * Math.PI * 0.12;
    pose.tail1 = [0, a1, 0]; pose.tail2 = [0, a2, 0]; pose.tail3 = [0, a3, 0];
    offs.tail2 = [s(a1) * 8 - 0, 0, (c(a1) - 1) * 8];
    offs.tail3 = [offs.tail2[0] + s(a2) * 7, 0, offs.tail2[2] + (c(a2) - 1) * 7];
    SPIKE_DIRS.forEach(([x, y, z], i) => {
      // out when still, drawn in while swimming
      const k = -2.5 + out * 3 + Math.sin(age * 0.2 + i) * 0.1;
      const l = Math.hypot(x, y, z);
      offs['spike' + i] = [(x / l) * k, (y / l) * k, (z / l) * k];
      const d = SPIKE_DIRS[i];
      pose['spike' + i] = [Math.atan2(d[2], Math.hypot(d[0], d[1])), 0, Math.atan2(-d[0], d[1])];
    });
    return { pose, offs, skin: e.elder ? 'elder_guardian' : 'guardian' };
  },
  phantom: ({ e, age }) => {
    const f = ((e.flap as number) ?? age * 0.25);
    const a = c(f) * 0.28;
    const pose: Record<string, [number, number, number]> = {
      leftWing: [0, 0, a], leftTip: [0, 0, a * 2], rightWing: [0, 0, -a], rightTip: [0, 0, -a * 2],
      tail: [-(5 + c(f * 2) * 5) * Math.PI / 180, 0, 0], tailTip: [-(5 + c(f * 2) * 5) * Math.PI / 180, 0, 0],
    };
    // the wing tips hang off the ends of the wings
    const offs: Record<string, [number, number, number]> = { leftTip: [6 * (c(a) - 1), 6 * s(a), 0], rightTip: [-6 * (c(a) - 1), 6 * s(a), 0] };
    return { pose, offs };
  },
  iron_golem: ({ e, hp, netHead, ls, lsa }) => {
    const atk = (e.attackTicks as number) ?? 0, poppy = (e.poppyTicks as number) ?? 0;
    const leg = (-1.5 * Math.abs(((ls * 0.6662 / Math.PI) % 2) - 1) + 0.75) * lsa;
    let ra = leg, la = -leg;
    if (atk > 0) { const k = -2 + 1.5 * Math.abs(((atk / 10) % 2) - 1); ra = la = k; }
    if (poppy > 0) ra = -0.8;
    return {
      pose: { head: [hp, netHead, 0], rightArm: [ra, 0, 0], leftArm: [la, 0, 0], rightLeg: [-leg * 1.2, 0, 0], leftLeg: [leg * 1.2, 0, 0] },
    };
  },
  snow_golem: ({ e, hp, netHead, age }) => {
    const sway = s(age * 0.1) * 0.05;
    return {
      pose: { head: [hp, netHead, 0], pumpkin: [hp, netHead, 0], upper: [0, netHead * 0.25, 0], rightArm: [0, netHead * 0.25, -1 + sway], leftArm: [0, netHead * 0.25, 1 - sway] },
      skip: e.pumpkin === false ? new Set(['pumpkin']) : new Set(['head']),
    };
  },
};

// ------------------------------------------------------------------ skins
function zombieLike(seed: number, skin: RGB, shirt: RGB, pants: RGB): Skin {
  const base = zombieSkin();
  const r = new Random(seed);
  // map the zombie's greens to the new skin tone, its cyan shirt and blue trousers to the new cloth
  return recolor(base, (c0, x, y) => {
    const l = lum(c0);
    const green = c0[1] > c0[0] + 15 && c0[1] > c0[2];
    const cyan = c0[2] > 100 && c0[1] > 100 && c0[0] < 60;
    const blue = c0[2] > c0[1] + 20 && c0[0] < 80;
    if (green) return vary(mix([0, 0, 0], skin, Math.min(1.25, l * 2.2)), r, 0.04);
    if (cyan) return vary(mix([0, 0, 0], shirt, Math.min(1.2, l * 1.7)), r, 0.05);
    if (blue && y >= 16) return vary(mix([0, 0, 0], pants, Math.min(1.2, l * 2.4)), r, 0.05);
    return c0;
  });
}
function strayskin(): Skin {
  const s0 = skeletonSkin();
  const r = new Random(201);
  recolor(s0, (c0) => { const l = lum(c0); return vary(mix(hx('#3e5052'), hx('#d6e4e2'), l), r, 0.03); });
  // tattered clothes over the bones
  s0.paintBox(16, 16, 8, 12, 4, (f, x, y) => (y < 9 && (x + y) % 3 !== 0 ? vary(hx('#5f7472'), r, 0.06) : null));
  s0.paintBox(0, 0, 8, 8, 8, (f, x, y) => (f !== 'front' && f !== 'bottom' && y < 3 ? vary(hx('#4f6260'), r, 0.06) : null));
  return s0;
}
function villagerHead(s0: Skin, r: Random, skin: RGB, skinD: RGB, eyes: RGB, brow: RGB) {
  s0.paintBox(0, 0, 8, 10, 8, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && x >= 1 && x <= 6) return brow;
      if (y === 4 && (x === 1 || x === 6)) return [240, 240, 240];
      if (y === 4 && (x === 2 || x === 5)) return eyes;
      if (y === 8 && x >= 2 && x <= 5) return skinD;
    }
    if (f === 'top') return vary(skinD, r, 0.05);
    return vary(skin, r, 0.04);
  });
  s0.paintBox(24, 0, 2, 4, 2, () => vary(skinD, r, 0.04));
}
/** Illager skins on the illager layout (64x64). */
function illagerSkin(kind: 'pillager' | 'vindicator' | 'evoker' | 'zombie_villager'): Skin {
  const s0 = new Skin(64, 64);
  const r = new Random(kind.length * 17 + 3);
  const grey = hx('#959b9b'), greyD = hx('#6c7272');
  if (kind === 'zombie_villager') {
    villagerHead(s0, r, hx('#5f8a46'), hx('#3f6a2e'), hx('#c21e1e'), hx('#2e4a22'));
    s0.paintBox(16, 20, 8, 12, 6, (f, x, y) => vary(y > 9 ? hx('#4f3a28') : hx('#6a4e34'), r, 0.06));
    s0.paintBox(44, 22, 4, 12, 4, (f, x, y) => vary(y > 7 ? hx('#5f8a46') : hx('#6a4e34'), r, 0.05));
    s0.paintBox(0, 22, 4, 12, 4, (f, x, y) => vary(y > 9 ? hx('#3a2a1a') : hx('#4f3a28'), r, 0.05));
    return s0;
  }
  villagerHead(s0, r, grey, greyD, kind === 'evoker' ? hx('#2a5a5a') : hx('#1e6a6a'), hx('#2a2a2a'));
  const coat = kind === 'pillager' ? hx('#3c4a4c') : kind === 'vindicator' ? hx('#2a4a5c') : hx('#2a2a2e');
  const trim = kind === 'pillager' ? hx('#5a3a2a') : kind === 'vindicator' ? hx('#4a3a2a') : hx('#d8b030');
  s0.paintBox(16, 20, 8, 12, 6, (f, x, y) => (f === 'front' && (x === 3 || x === 4) ? trim : y === 8 ? trim : vary(coat, r, 0.06)));
  if (kind === 'evoker') s0.paintBox(0, 38, 8, 18, 6, (f, x, y) => (f === 'front' && (x === 3 || x === 4) ? trim : y === 17 ? trim : vary(coat, r, 0.05)));
  s0.paintBox(44, 22, 4, 12, 4, (f, x, y) => (y > 8 ? vary(grey, r, 0.04) : vary(coat, r, 0.06)));
  s0.paintBox(0, 22, 4, 12, 4, (f, x, y) => (y > 9 ? hx('#2a2a2a') : vary(kind === 'pillager' ? hx('#4a4038') : hx('#3a3a3e'), r, 0.06)));
  return s0;
}
function witchSkin(): Skin {
  const s0 = new Skin(64, 128);
  const r = new Random(301);
  const skin = hx('#b7845e'), skinD = hx('#946646');
  villagerHead(s0, r, skin, skinD, hx('#7a2a8a'), hx('#3a2a1a'));
  s0.paintBox(24, 0, 2, 4, 2, (f, x, y) => (f === 'front' && y === 2 && x === 1 ? hx('#3a7a2a') : vary(skinD, r, 0.04)));
  const robe = hx('#4a2a5a'), robeD = hx('#2e1a3a'), green = hx('#3a6a2a');
  s0.paintBox(16, 20, 8, 12, 6, (f, x, y) => (f === 'front' && y < 2 ? green : vary(robe, r, 0.06)));
  s0.paintBox(0, 38, 8, 18, 6, (f, x, y) => vary(y % 6 === 0 ? robeD : robe, r, 0.05));
  s0.paintBox(44, 22, 4, 8, 4, (f, x, y) => (y > 5 ? vary(skin, r, 0.03) : vary(robe, r, 0.05)));
  s0.paintBox(40, 38, 8, 4, 4, () => vary(robe, r, 0.05));
  s0.paintBox(0, 22, 4, 12, 4, (f, x, y) => (y > 9 ? hx('#2a1a10') : vary(robeD, r, 0.05)));
  const hat = hx('#2a2a2a'), band = hx('#5a7a2a');
  s0.paintBox(0, 64, 10, 2, 10, () => vary(hat, r, 0.08));
  s0.paintBox(0, 76, 7, 4, 7, (f, x, y) => (y === 3 && f !== 'top' && f !== 'bottom' ? band : vary(hat, r, 0.08)));
  s0.paintBox(0, 87, 4, 3, 4, () => vary(hat, r, 0.08));
  s0.paintBox(0, 95, 1, 2, 1, () => vary(hat, r, 0.08));
  return s0;
}
function vexSkin(): Skin {
  const s0 = new Skin(64, 32);
  const r = new Random(311);
  const body = hx('#9fb2c4'), dark = hx('#6a7f94');
  s0.paintBox(0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && y === 4 && (x === 2 || x === 5) ? hx('#e8ffff') : f === 'front' && y === 6 && x > 1 && x < 6 ? hx('#3a4a5a') : vary(body, r, 0.06)));
  s0.paintBox(16, 16, 8, 12, 4, (f, x, y) => (y > 8 ? null : vary(y > 5 ? dark : body, r, 0.06)));
  s0.paintBox(40, 16, 4, 12, 4, (f, x, y) => (y > 7 ? null : vary(body, r, 0.06)));
  s0.paintBox(0, 16, 4, 12, 4, () => null);
  return s0;
}
function ravagerSkin(): Skin {
  const s0 = new Skin(128, 128);
  const r = new Random(321);
  const hide = hx('#6e6a62'), hideD = hx('#4f4b45'), mane = hx('#3a322c'), horn = hx('#c4bca8');
  s0.paintBox(0, 0, 14, 17, 26, (f, x, y) => vary(f === 'top' ? (r.int(3) ? mane : hideD) : r.int(5) ? hide : hideD, r, 0.06));
  s0.paintBox(0, 44, 12, 14, 14, (f, x, y) => {
    if (f === 'front') {
      if (y === 5 && (x === 2 || x === 9)) return hx('#1a1a1a');
      if (y === 5 && (x === 3 || x === 8)) return hx('#e8e0d0');
      if (y > 9) return vary(hideD, r, 0.05);
    }
    return vary(hide, r, 0.06);
  });
  s0.paintBox(80, 24, 2, 7, 2, () => vary(horn, r, 0.05));
  s0.paintBox(88, 24, 4, 6, 2, () => vary(hideD, r, 0.05));
  s0.paintBox(56, 44, 10, 3, 12, (f, x, y) => (f === 'top' && x % 2 === 0 ? horn : vary(hideD, r, 0.05)));
  s0.paintBox(80, 0, 6, 16, 6, (f, x, y) => vary(y > 13 ? hx('#2a2622') : hideD, r, 0.06));
  return s0;
}
function guardianSkin(elder: boolean): Skin {
  const s0 = new Skin(64, 64);
  const r = new Random(elder ? 331 : 330);
  const main = hx(elder ? '#cdc9b2' : '#5a8272'), dark = hx(elder ? '#9e9a86' : '#3e5c50'), plate = hx(elder ? '#b6a98e' : '#c07a3a');
  s0.paintBox(0, 0, 12, 12, 16, (f, x, y, w, h) => {
    if (f === 'front' && x >= 4 && x <= 7 && y >= 4 && y <= 7) return [235, 235, 220];
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    return vary(edge ? plate : r.int(4) ? main : dark, r, 0.06);
  });
  s0.paintBox(8, 32, 2, 2, 1, () => hx(elder ? '#5a2a8a' : '#6a1a1a'));
  s0.paintBox(0, 36, 4, 4, 8, () => vary(main, r, 0.06));
  s0.paintBox(24, 36, 3, 3, 7, () => vary(dark, r, 0.06));
  s0.paintBox(44, 36, 2, 2, 6, () => vary(dark, r, 0.06));
  s0.paintBox(0, 50, 1, 9, 9, (f) => (f === 'left' || f === 'right' ? vary(plate, r, 0.08) : null));
  s0.paintBox(0, 56, 1, 9, 1, (f, x, y) => vary(y < 2 ? hx('#efe8d8') : plate, r, 0.05));
  return s0;
}
function phantomSkin(): Skin {
  const s0 = new Skin(64, 64);
  const r = new Random(341);
  const main = hx('#43518a'), dark = hx('#2c3560'), memb = hx('#7f8db8');
  s0.paintBox(0, 0, 7, 3, 5, (f, x, y) => (f === 'front' && y === 1 && (x === 1 || x === 5) ? hx('#88ff00') : vary(main, r, 0.06)));
  s0.paintBox(0, 8, 5, 3, 9, () => vary(r.int(4) ? main : dark, r, 0.06));
  s0.paintBox(23, 12, 6, 2, 9, (f) => vary(f === 'top' || f === 'bottom' ? memb : main, r, 0.06));
  s0.paintBox(16, 24, 13, 1, 9, (f, x) => vary(f === 'top' || f === 'bottom' ? (x % 4 === 0 ? dark : memb) : main, r, 0.06));
  s0.paintBox(3, 20, 3, 2, 6, () => vary(main, r, 0.06));
  s0.paintBox(4, 29, 1, 1, 6, () => vary(dark, r, 0.06));
  return s0;
}
function ironGolemSkin(): Skin {
  const s0 = new Skin(128, 128);
  const r = new Random(351);
  const iron = hx('#c9c3b8'), ironD = hx('#9e978c'), vine = hx('#4a7a2a');
  const metal = () => vary(r.int(6) ? iron : ironD, r, 0.04);
  s0.paintBox(0, 0, 8, 10, 8, (f, x, y) => {
    if (f === 'front') {
      if (y === 3 && x >= 1 && x <= 6) return ironD;
      if (y === 4 && (x === 2 || x === 5)) return hx('#a02020');
      if (y === 8 && x >= 2 && x <= 5) return ironD;
    }
    return metal();
  });
  s0.paintBox(24, 0, 2, 4, 2, () => metal());
  s0.paintBox(0, 40, 18, 12, 11, (f, x, y) => (r.int(14) === 0 ? vine : metal()));
  s0.paintBox(0, 70, 9, 5, 6, () => metal());
  for (const v of [21, 58]) s0.paintBox(60, v, 4, 30, 6, (f, x, y) => (r.int(12) === 0 && y < 20 ? vine : metal()));
  for (const u of [37, 60]) s0.paintBox(u, 0, 6, 16, 5, () => metal());
  return s0;
}
function snowGolemSkin(): Skin {
  const s0 = new Skin(64, 128);
  const r = new Random(361);
  const snow = hx('#f4f8f8'), snowD = hx('#dce6e8');
  // the carved pumpkin it wears, ribbed like the block
  s0.paintBox(0, 64, 10, 10, 10, (f, x, y) => {
    const orange = vary(x % 3 === 0 && f !== 'top' && f !== 'bottom' ? hx('#c8741a') : hx('#e38a1d'), r, 0.05);
    if (f === 'front') {
      if (y >= 2 && y <= 4 && (x === 2 || x === 3 || x === 6 || x === 7)) return hx('#3a1a00');
      if (y >= 6 && y <= 7 && x >= 2 && x <= 7 && !(y === 6 && (x === 4 || x === 5))) return hx('#3a1a00');
    }
    if (f === 'top' && x >= 4 && x <= 5 && y >= 4 && y <= 5) return hx('#6a5a2a');
    return orange;
  });
  s0.paintBox(0, 0, 8, 8, 8, (f, x, y) => (f === 'front' && y === 3 && (x === 2 || x === 5) ? hx('#1a1a1a') : f === 'front' && y === 5 && x > 1 && x < 6 ? hx('#3a3a3a') : vary(hx('#eef4f4'), r, 0.02)));
  s0.paintBox(0, 16, 10, 10, 10, () => vary(r.int(4) ? snow : snowD, r, 0.02));
  s0.paintBox(0, 36, 12, 12, 12, () => vary(r.int(4) ? snow : snowD, r, 0.02));
  s0.paintBox(32, 0, 12, 2, 2, () => vary(hx('#5a3a1a'), r, 0.08));
  return s0;
}
function fangsSkin(): Skin {
  const s0 = new Skin(64, 32);
  const r = new Random(371);
  const bone = hx('#bdb7a0'), dark = hx('#5a5040');
  s0.paintBox(0, 0, 10, 12, 10, () => [0, 0, 0, 0] as never);
  s0.paintBox(40, 0, 4, 14, 8, (f, x, y) => (f === 'left' && y < 3 && x % 2 === 0 ? [240, 240, 230] : vary(y > 10 ? dark : bone, r, 0.06)));
  return s0;
}
function beamSkin(): Skin {
  const s0 = new Skin(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s0.set(x, y, [255, 255, 255]);
  return s0;
}
function caveSpiderSkin(): Skin {
  const s0 = spiderSkin();
  const r = new Random(381);
  return recolor(s0, (c0) => (c0[0] > 150 && c0[1] < 80 ? c0 : vary(mix(hx('#0a2a34'), hx('#2a6a72'), lum(c0) * 2), r, 0.04)));
}

export const MOB_SKINS2: Record<string, () => Skin> = {
  husk: () => zombieLike(211, hx('#9a8a64'), hx('#6a5a3a'), hx('#4a3a2a')),
  drowned: () => zombieLike(212, hx('#4fa092'), hx('#3a6a7a'), hx('#2e4a5a')),
  stray: strayskin,
  zombie_villager: () => illagerSkin('zombie_villager'),
  pillager: () => illagerSkin('pillager'), vindicator: () => illagerSkin('vindicator'), evoker: () => illagerSkin('evoker'),
  witch: witchSkin, vex: vexSkin, ravager: ravagerSkin, guardian: () => guardianSkin(false), elder_guardian: () => guardianSkin(true),
  phantom: phantomSkin, iron_golem: ironGolemSkin, snow_golem: snowGolemSkin, fangs: fangsSkin, beam: beamSkin,
  cave_spider: caveSpiderSkin,
};
