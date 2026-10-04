// Where buildings go and what they're made of: shared by the server (placing, building, counting health) and the
// client (the ghost that follows the pointer), so both judge a spot the same way.
import type { Mc, World } from '../sdk';
import { BUILDINGS, PALETTES, TEAMS, cellsOf, footprint, turn, type FactionId } from './defs';

/** The bits of a building these helpers need (server state and client info both have them). */
export interface Placed { id: number; type: string; x: number; y: number; z: number; rot: number; faction: FactionId; team: number }

export interface ACell { x: number; y: number; z: number; c: string; v: number }

/** Blocks that are scenery, not ground: trees and plants are cleared away for a building. */
export function isScenery(mc: Mc, id: number) {
  const n = mc.BLOCKS[id]?.name ?? '';
  return id === 0 || n.endsWith('_log') || n.endsWith('_leaves') || !mc.BLOCKS[id].solid || n === 'snow_layer' || n === 'cactus';
}

/** The ground's top block at (x, z): the highest solid block that isn't a tree (-1 if not loaded). */
export function groundY(mc: Mc, w: World, x: number, z: number) {
  let y = w.topSolidY(x, z);
  while (y > 0) {
    const id = w.getId(x, y, z);
    if (!isScenery(mc, id) || mc.BLOCKS[id].fluid) break;
    y--;
  }
  return y;
}

const blockCache = new Map<string, number>();
/** The block (packed value) for a palette letter. */
export function blockFor(mc: Mc, c: string, faction: FactionId, team: number): number {
  const k = `${c}|${faction}|${team}`;
  let v = blockCache.get(k);
  if (v !== undefined && mc.BLOCKS[mc.idOf(v)]?.name !== undefined) return v;
  const name = c === 'W' ? (team >= 0 ? TEAMS[team % TEAMS.length].wool : 'black_wool') : PALETTES[faction][c];
  v = name ? mc.blockByName(name)?.id ?? mc.B.COBBLESTONE : 0;
  blockCache.set(k, v);
  return v;
}
/** Forget looked-up blocks (ids can change between worlds). */
export function resetBlocks() { blockCache.clear(); }

/** Every block of a building in world coordinates, in the order it's built: layer by layer, clearing first. */
export function cellsAt(mc: Mc, b: Placed): ACell[] {
  const def = BUILDINGS[b.type];
  if (!def) return [];
  const out: ACell[] = [];
  for (const c of cellsOf(def.blueprint, b.rot)) out.push({ x: b.x + c.dx, y: b.y + c.dy, z: b.z + c.dz, c: c.c, v: c.c === '.' ? 0 : blockFor(mc, c.c, b.faction, b.team) });
  out.sort((a, b2) => a.y - b2.y || (a.c === '.' ? 0 : 1) - (b2.c === '.' ? 0 : 1));
  return out;
}

/** Does the world hold this cell's block (crops of any age, farmland or the dirt it turns to)? */
export function cellOk(mc: Mc, w: World, c: ACell) {
  const id = w.getId(c.x, c.y, c.z), want = mc.idOf(c.v);
  if (c.c === '.') return id === 0 || !mc.BLOCKS[id].solid && !mc.BLOCKS[id].fluid;
  if (c.c === 'Y') return id === want || id === mc.B.CARROTS || id === mc.B.POTATOES;
  if (c.c === 'A') return id === want;
  if (c.c === 'Q') return mc.BLOCKS[id].fluid === true;
  return id === want;
}
/** Cells that count towards a building's health (not air, not water). */
export const counts = (c: ACell) => c.c !== '.' && c.c !== 'Q';

/** The footprint rectangle [x0, z0, x1, z1] (inclusive). */
export function rect(b: { type: string; x: number; z: number; rot: number }): [number, number, number, number] {
  const def = BUILDINGS[b.type];
  const [w, d] = footprint(def.blueprint, b.rot);
  return [b.x, b.z, b.x + w - 1, b.z + d - 1];
}
/** Horizontal distance from a point to a building's footprint (0 inside). */
export function distToRect(b: { type: string; x: number; z: number; rot: number }, x: number, z: number) {
  const [x0, z0, x1, z1] = rect(b);
  const dx = x < x0 ? x0 - x : x > x1 + 1 ? x - x1 - 1 : 0;
  const dz = z < z0 ? z0 - z : z > z1 + 1 ? z - z1 - 1 : 0;
  return Math.hypot(dx, dz);
}
/** The door cell (where units come out and go in) in world coordinates, and the spot just outside it. */
export function door(b: { type: string; x: number; y: number; z: number; rot: number }) {
  const def = BUILDINGS[b.type];
  const bp = def.blueprint;
  const [dx, dz] = turn(def.door[0], def.door[1], bp.w, bp.d, b.rot);
  const [x0, z0, x1, z1] = rect(b);
  const x = b.x + dx, z = b.z + dz;
  // step out of the footprint through the nearest edge
  const ox = x === x0 ? -1 : x === x1 ? 1 : 0, oz = z === z1 ? 1 : z === z0 ? -1 : 0;
  return { x, z, y: b.y + 1, out: { x: x + (oz ? 0 : ox), z: z + oz, y: b.y + 1 } };
}

export interface PlaceCheck { ok: boolean; y: number; why?: string }
/**
 * Can a building go with its north-west corner at (x, z)? The ground under it must be fairly flat, dry and loaded,
 * clear of other buildings, and (after the first town hall) near the owner's own buildings.
 */
export function checkPlace(mc: Mc, w: World, type: string, x: number, z: number, rot: number, others: Placed[], own: Placed[], first: boolean): PlaceCheck {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, y: 0, why: 'Unknown building' };
  const [fw, fd] = footprint(def.blueprint, rot);
  const hs: number[] = [];
  for (let dz = 0; dz < fd; dz++)
    for (let dx = 0; dx < fw; dx++) {
      if (!w.isLoaded(x + dx, z + dz)) return { ok: false, y: 0, why: 'Not loaded' };
      const y = groundY(mc, w, x + dx, z + dz);
      const id = w.getId(x + dx, y, z + dz);
      if (mc.BLOCKS[id].fluid) return { ok: false, y, why: 'Not on water' };
      hs.push(y);
    }
  hs.sort((a, b) => a - b);
  const y = hs[Math.floor(hs.length / 2)];
  if (hs[hs.length - 1] - hs[0] > 3) return { ok: false, y, why: 'Too steep' };
  const r: [number, number, number, number] = [x, z, x + fw - 1, z + fd - 1];
  for (const o of others) {
    const [a0, b0, a1, b1] = rect(o);
    if (r[0] <= a1 + 1 && r[2] >= a0 - 1 && r[1] <= b1 + 1 && r[3] >= b0 - 1) return { ok: false, y, why: 'Too close to another building' };
  }
  if (first) return type === 'town_centre' ? { ok: true, y } : { ok: false, y, why: 'Place your town hall first' };
  if (!own.some((o) => distToRect(o, x + fw / 2, z + fd / 2) < 40)) return { ok: false, y, why: 'Too far from your buildings' };
  return { ok: true, y };
}
