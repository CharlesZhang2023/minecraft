// The blocks and items, their shapes and recipes. Runs in the page and in the mesher workers (models must be pure).
import type { ModContext, BlockRef, ItemRef, Box, Shape, PlaceCtx, BlockCtx, PlayerBlockCtx, ItemCtx } from '../sdk';

/** What the blocks do (filled in after registering: the server side needs the refs). Only ever called in the page. */
export interface Hooks {
  assemblerUse(c: PlayerBlockCtx): boolean;
  assemblerTick(c: BlockCtx, t: Record<string, unknown>): void;
  assemblerRedstone(c: BlockCtx): void;
  propTick(c: BlockCtx, t: Record<string, unknown>): void;
  burnerTick(c: BlockCtx, t: Record<string, unknown>): void;
  burnerUse(c: PlayerBlockCtx): boolean;
  part(c: BlockCtx, kind: 'lev' | 'gyro' | 'helm'): void;
  helmUse(c: PlayerBlockCtx): boolean;
  staffTick(c: ItemCtx & { ticks: number }): void;
  staffStop(c: ItemCtx): void;
}

export const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'] as const;

export interface Refs {
  assembler: BlockRef;
  propeller: BlockRef;
  burner: BlockRef;
  envelopes: BlockRef[];
  levitite: BlockRef;
  helm: BlockRef;
  gyro: BlockRef;
  staff: ItemRef;
}

const shape = (b: Box): Shape => ({ x0: b.x0 / 16, y0: b.y0 / 16, z0: b.z0 / 16, x1: b.x1 / 16, y1: b.y1 / 16, z1: b.z1 / 16 });
/** The opposite vanilla 6-way direction (0 down, 1 up, 2 north, 3 south, 4 west, 5 east). */
export const OPP6 = [1, 0, 3, 2, 5, 4];

/** Propeller housing, authored pushing up (+y): the casing toward the way it pushes, the shaft out the back. */
export function propellerBoxes(faces: number[]): Box[] {
  const casing = faces.slice(0, 6), brass = [faces[3], faces[3], faces[3], faces[3], faces[3], faces[3]];
  return [
    { x0: 2, y0: 6, z0: 2, x1: 14, y1: 16, z1: 14, tex: casing },
    { x0: 6, y0: 0, z0: 6, x1: 10, y1: 6, z1: 10, tex: brass },
  ];
}
export function burnerBoxes(faces: number[]): Box[] {
  const f = faces.slice(0, 6);
  return [
    { x0: 1, y0: 0, z0: 1, x1: 15, y1: 5, z1: 15, tex: f },
    { x0: 3, y0: 5, z0: 3, x1: 13, y1: 12, z1: 13, tex: f, skip: 0 },
  ];
}
/** The helm, authored facing north (meta 0): a post with a wheel on top, the wheel's face toward the pilot. */
export function helmBoxes(faces: number[]): Box[] {
  const wood = faces.slice(0, 6), brass = [faces[3], faces[3], faces[3], faces[3], faces[3], faces[3]];
  const r: Box[] = [
    { x0: 5, y0: 0, z0: 7, x1: 11, y1: 2, z1: 13, tex: wood },
    { x0: 6.5, y0: 2, z0: 8.5, x1: 9.5, y1: 12, z1: 11.5, tex: wood },
    // hub and wheel (in the plane z 6-8, centred at y 13)
    { x0: 7, y0: 12, z0: 6, x1: 9, y1: 14, z1: 9, tex: brass },
    { x0: 2, y0: 7.5, z0: 6.5, x1: 14, y1: 8.5, z1: 7.5, tex: wood },
    { x0: 2, y0: 17.5, z0: 6.5, x1: 14, y1: 18.5, z1: 7.5, tex: wood },
    { x0: 2, y0: 8.5, z0: 6.5, x1: 3, y1: 17.5, z1: 7.5, tex: wood },
    { x0: 13, y0: 8.5, z0: 6.5, x1: 14, y1: 17.5, z1: 7.5, tex: wood },
    { x0: 7.5, y0: 8.5, z0: 6.75, x1: 8.5, y1: 17.5, z1: 7.25, tex: wood },
    { x0: 3, y0: 12.5, z0: 6.75, x1: 13, y1: 13.5, z1: 7.25, tex: wood },
  ];
  // handles sticking out of the rim
  for (const [x0, y0, x1, y1] of [[7.5, 5.5, 8.5, 7.5], [7.5, 18.5, 8.5, 20.5], [0, 12.5, 2, 13.5], [14, 12.5, 16, 13.5]]) r.push({ x0, y0, z0: 6.5, x1, y1, z1: 7.5, tex: wood });
  return r;
}
export function gyroBoxes(faces: number[]): Box[] {
  const f = faces.slice(0, 6), brass = [faces[3], faces[3], faces[3], faces[3], faces[3], faces[3]];
  return [
    { x0: 0, y0: 0, z0: 0, x1: 16, y1: 3, z1: 16, tex: f },
    { x0: 0, y0: 3, z0: 0, x1: 2, y1: 14, z1: 2, tex: brass },
    { x0: 14, y0: 3, z0: 0, x1: 16, y1: 14, z1: 2, tex: brass },
    { x0: 0, y0: 3, z0: 14, x1: 2, y1: 14, z1: 16, tex: brass },
    { x0: 14, y0: 3, z0: 14, x1: 16, y1: 14, z1: 16, tex: brass },
    { x0: 0, y0: 14, z0: 0, x1: 16, y1: 16, z1: 16, tex: f, skip: 0 },
  ];
}

export function registerBlocks(mod: ModContext, H: Hooks): Refs {
  const { Render, orient6, rotY } = mod.mc;
  const model = Render.Model;

  // ---- Physics Assembler: right-click (or a redstone pulse) lifts the structure it's part of into a sub-level,
  // and lands it again
  const assembler = mod.block('physics_assembler', 'Physics Assembler', {
    tex: 'aeronautics:assembler_side', top: 'aeronautics:assembler_top', bottom: 'aeronautics:casing', hardness: 2, tool: 'pickaxe', sound: 'metal',
  }, {
    onUse: (c) => H.assemblerUse(c),
    tile: { create: () => ({ on: false, pending: false }), tick: (c, t) => H.assemblerTick(c, t) },
    redstone: { update: (c) => H.assemblerRedstone(c) },
  }, { tab: 'aeronautics:aero' });

  // ---- Propeller: pushes the sub-level it's on the way it faces (the way you looked placing it), as hard as the
  // redstone signal it gets or the helm's throttle
  const propeller = mod.block('propeller', 'Propeller', {
    render: model, tex: 'aeronautics:casing', top: 'aeronautics:brass', hardness: 1.5, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0,
  }, {
    placementMeta: (c: PlaceCtx) => OPP6[c.facing6],
    model: (meta, _nb, faces) => propellerBoxes(faces).map((b) => orient6(b, meta & 7)),
    collision: (meta) => [shape(orient6({ x0: 2, y0: 6, z0: 2, x1: 14, y1: 16, z1: 14, tex: [0, 0, 0, 0, 0, 0] }, meta & 7))],
    selection: (meta) => [shape(orient6({ x0: 2, y0: 0, z0: 2, x1: 14, y1: 16, z1: 14, tex: [0, 0, 0, 0, 0, 0] }, meta & 7))],
    rotate: (meta, turns) => turn6(meta, turns),
    tile: { create: () => ({ p: 0 }), tick: (c, t) => H.propTick(c, t) },
  }, { tab: 'aeronautics:aero' });

  // ---- Hot Air Burner: fills the envelope above it with hot air, which lifts
  const burner = mod.block('hot_air_burner', 'Hot Air Burner', {
    render: model, tex: 'aeronautics:burner_side', top: 'aeronautics:burner_top', bottom: 'aeronautics:casing', hardness: 2, tool: 'pickaxe', sound: 'metal', opaque: false, lightOpacity: 0, light: 0,
  }, {
    model: (_m, _nb, faces) => burnerBoxes(faces),
    collision: () => [{ x0: 1 / 16, y0: 0, z0: 1 / 16, x1: 15 / 16, y1: 12 / 16, z1: 15 / 16 }],
    selection: () => [{ x0: 1 / 16, y0: 0, z0: 1 / 16, x1: 15 / 16, y1: 12 / 16, z1: 15 / 16 }],
    tile: { create: () => ({ lvl: 10, out: 0, gas: 0, cap: 0, leak: false }), tick: (c, t) => H.burnerTick(c, t) },
    onUse: (c) => H.burnerUse(c),
  }, { tab: 'aeronautics:aero' });

  // ---- Hot Air Envelopes: airtight cloth for balloons, in the 16 colours of wool
  const envelopes = COLORS.map((col) => mod.block(`${col}_envelope`, `${col === 'white' ? '' : title(col) + ' '}Hot Air Envelope`, {
    tex: `aeronautics:envelope_${col}`, hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: true,
  }, {}, { tab: 'aeronautics:aero' }));

  // ---- Levitite: a crystal that floats, holding up about a dozen blocks each (less, the higher it is)
  const levitite = mod.block('levitite', 'Levitite', {
    tex: 'aeronautics:levitite', hardness: 1.5, tool: 'pickaxe', sound: 'glass', light: 6,
  }, {
    tile: { create: () => ({}), tick: (c) => H.part(c, 'lev') },
  }, { tab: 'aeronautics:aero' });

  // ---- Helm: take it (right-click) to steer the sub-level: W/S throttle, A/D turn, jump/sneak up and down
  const helm = mod.block('helm', 'Helm', {
    render: model, tex: 'spruce_planks', top: 'aeronautics:brass', hardness: 1.5, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0,
  }, {
    placementMeta: (c: PlaceCtx) => c.facing & 3,
    model: (meta, _nb, faces) => helmBoxes(faces).map((b) => rotY(b, meta & 3)),
    collision: (meta) => [shape(rotY({ x0: 5, y0: 0, z0: 6, x1: 11, y1: 14, z1: 13, tex: [0, 0, 0, 0, 0, 0] }, meta & 3))],
    selection: (meta) => [shape(rotY({ x0: 1, y0: 0, z0: 6, x1: 15, y1: 16, z1: 13, tex: [0, 0, 0, 0, 0, 0] }, meta & 3))],
    rotate: (meta, turns) => (meta + turns) & 3,
    tile: { create: () => ({}), tick: (c) => H.part(c, 'helm') },
    onUse: (c) => H.helmUse(c),
  }, { tab: 'aeronautics:aero' });

  // ---- Gyroscope: keeps the sub-level it's on upright
  const gyro = mod.block('gyroscope', 'Gyroscopic Stabilizer', {
    render: model, tex: 'aeronautics:casing', top: 'aeronautics:brass', hardness: 2, tool: 'pickaxe', sound: 'metal', opaque: false, lightOpacity: 0,
  }, {
    model: (_m, _nb, faces) => gyroBoxes(faces),
    tile: { create: () => ({}), tick: (c) => H.part(c, 'gyro') },
  }, { tab: 'aeronautics:aero' });

  // ---- the Physics Staff (creative): grab a sub-level and drag it about; sneak-use to anchor it in place
  const staff = mod.item('physics_staff', { display: 'Physics Staff', maxStack: 1, rarity: 'epic', tab: 'aeronautics:aero' }, {
    useTick: (c) => H.staffTick(c as ItemCtx & { ticks: number }),
    useStop: (c) => H.staffStop(c),
    tooltip: (_s, lines) => { lines.push('§7Hold use on a sub-level to drag it', '§7Sneak + use: anchor it / let it go'); },
  });

  // ---- recipes
  mod.recipes.shaped(['IRI', 'PSP', 'IPI'], { I: 'iron_ingot', R: 'redstone', P: '#planks', S: 'slime_ball' }, assembler);
  mod.recipes.shaped([' P ', 'PIP', ' P '], { P: '#planks', I: 'iron_ingot' }, propeller);
  mod.recipes.shaped(['I I', 'IFI', 'III'], { I: 'iron_ingot', F: 'furnace' }, burner);
  COLORS.forEach((col, i) => mod.recipes.shapeless([`${col}_wool`, `${col}_wool`, 'string'], envelopes[i], 2));
  mod.recipes.shapeless(['end_stone', 'glowstone_dust', 'ender_pearl'], levitite, 2);
  mod.recipes.shaped([' S ', 'SPS', ' S '], { S: 'stick', P: '#planks' }, helm);
  mod.recipes.shaped(['GIG', 'IRI', 'GIG'], { G: 'gold_ingot', I: 'iron_ingot', R: 'redstone' }, gyro);

  return { assembler, propeller, burner, envelopes, levitite, helm, gyro, staff };
}

/** A 6-way direction turned `turns` quarter turns clockwise seen from above (up and down stay). */
export function turn6(meta: number, turns: number): number {
  const f = meta & 7;
  if (f < 2) return meta;
  const ring = [2, 5, 3, 4]; // north, east, south, west
  const i = ring.indexOf(f);
  return i < 0 ? meta : (meta & 8) | ring[(i + turns) & 3];
}

export function title(s: string) {
  return s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
