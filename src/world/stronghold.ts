// Strongholds: a few underground stone-brick complexes per world, placed on rings around the origin like the
// real game. Each is a 4x4 grid of rooms joined by corridors; one room holds the end portal frames, a lava
// pool and a silverfish spawner. Layout is a pure function of (seed, index); chunks rebuild their share.
import { Random, hash2, hash3 } from '../noise';
import { B, pack } from './blocks';

const GRID = 4;
const PITCH = 20; // distance between room centres
const SPAN = (GRID * PITCH) / 2 + 12; // half-size of a stronghold's footprint

export interface Site { x: number; z: number; index: number }
export type RoomKind = 'start' | 'plain' | 'library' | 'prison' | 'fountain' | 'chest' | 'portal' | 'cross';
export interface Room { gx: number; gz: number; kind: RoomKind; half: number; cx: number; cz: number }
export interface Corridor { a: number; b: number }
export interface Stronghold { site: Site; y: number; rooms: Room[]; links: Corridor[] }

/** Three strongholds on the inner ring, six on the next. (Cached: worldgen and loot ask for every chunk/chest.) */
const sitesCache = new Map<number, Site[]>();
export function strongholdSites(seed: number): Site[] {
  let sites = sitesCache.get(seed);
  if (!sites) { sites = computeSites(seed); sitesCache.set(seed, sites); }
  return sites;
}
function computeSites(seed: number): Site[] {
  const r = new Random(hash2(seed, 0x57001, 0x4d));
  const out: Site[] = [];
  const ring = (count: number, lo: number, hi: number, first: number) => {
    const off = r.next() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = off + (i / count) * Math.PI * 2 + (r.next() - 0.5) * 0.5;
      const d = lo + r.next() * (hi - lo);
      out.push({ x: Math.round(Math.cos(a) * d), z: Math.round(Math.sin(a) * d), index: first + i });
    }
  };
  ring(3, 700, 1000, 0);
  ring(6, 1500, 1900, 3);
  return out;
}

export function nearestSite(seed: number, x: number, z: number): Site {
  const sites = strongholdSites(seed);
  let best = sites[0], bd = Infinity;
  for (const s of sites) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Is (x,z) inside any stronghold's footprint? */
export function inStronghold(seed: number, x: number, z: number): boolean {
  for (const s of strongholdSites(seed)) if (Math.abs(x - s.x) <= SPAN && Math.abs(z - s.z) <= SPAN) return true;
  return false;
}

const cache = new Map<string, Stronghold>();

export function layoutStronghold(seed: number, site: Site): Stronghold {
  const key = seed + ':' + site.index;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = new Random(hash2(seed ^ 0x5740, site.index, 0x91));
  const y = 18 + r.int(18);
  const cells: Room[] = [];
  for (let gz = 0; gz < GRID; gz++)
    for (let gx = 0; gx < GRID; gx++)
      cells.push({ gx, gz, kind: 'plain', half: 5, cx: site.x + (gx - (GRID - 1) / 2) * PITCH, cz: site.z + (gz - (GRID - 1) / 2) * PITCH });
  // random spanning tree from a random start cell (depth-first), plus a few loops
  const start = r.int(cells.length);
  const depth = new Array(cells.length).fill(-1);
  const links: Corridor[] = [];
  const stack = [start];
  depth[start] = 0;
  const nbrs = (i: number) => {
    const gx = i % GRID, gz = Math.floor(i / GRID), out: number[] = [];
    if (gx > 0) out.push(i - 1);
    if (gx < GRID - 1) out.push(i + 1);
    if (gz > 0) out.push(i - GRID);
    if (gz < GRID - 1) out.push(i + GRID);
    return out;
  };
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const options = nbrs(cur).filter((n) => depth[n] < 0);
    if (!options.length) { stack.pop(); continue; }
    const n = options[r.int(options.length)];
    depth[n] = depth[cur] + 1;
    links.push({ a: cur, b: n });
    stack.push(n);
  }
  for (let i = 0; i < 4; i++) {
    const a = r.int(cells.length), ns = nbrs(a), b = ns[r.int(ns.length)];
    if (!links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))) links.push({ a, b });
  }
  // room kinds: the portal room at the deepest cell, a library next
  const order = cells.map((_, i) => i).sort((p, q) => depth[q] - depth[p]);
  cells[start].kind = 'start';
  cells[order[0]].kind = 'portal';
  cells[order[0]].half = 7;
  cells[order[1] === start ? order[2] : order[1]].kind = 'library';
  const spare = order.filter((i) => cells[i].kind === 'plain');
  const kinds: RoomKind[] = ['prison', 'fountain', 'chest', 'chest', 'cross', 'cross', 'cross', 'prison'];
  for (const k of kinds) {
    if (!spare.length) break;
    const j = r.int(spare.length);
    cells[spare[j]].kind = k;
    if (k === 'cross') cells[spare[j]].half = 3;
    spare.splice(j, 1);
  }
  const sh: Stronghold = { site, y, rooms: cells, links };
  if (cache.size > 16) cache.clear();
  cache.set(key, sh);
  return sh;
}

/** The three-by-three inside of a portal room frame ring: positions of the 12 frames relative to the centre. */
export const FRAME_RING: [number, number][] = [
  [-1, -2], [0, -2], [1, -2], [-1, 2], [0, 2], [1, 2],
  [-2, -1], [-2, 0], [-2, 1], [2, -1], [2, 0], [2, 1],
];

type Get = (x: number, y: number, z: number) => number;
type Set = (x: number, y: number, z: number, v: number) => void;

/** Write the part of every nearby stronghold that falls inside chunk (cx, cz). */
export function buildStrongholds(seed: number, cx: number, cz: number, get: Get, set: Set) {
  const X0 = cx * 16, Z0 = cz * 16, X1 = X0 + 15, Z1 = Z0 + 15;
  for (const site of strongholdSites(seed)) {
    if (X1 < site.x - SPAN || X0 > site.x + SPAN || Z1 < site.z - SPAN || Z0 > site.z + SPAN) continue;
    const sh = layoutStronghold(seed, site);
    const brick = (x: number, y: number, z: number) => {
      const h = hash3(seed ^ 0x57b, x, y, z) % 100;
      return h < 68 ? B.STONE_BRICKS : h < 84 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS;
    };
    const inChunk = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
    const S = (x: number, y: number, z: number, v: number) => { if (inChunk(x, z) && y > 1 && y < 255) set(x, y, z, v); };
    const H = 5; // interior height of corridors and ordinary rooms
    const Y = sh.y;
    // axis-aligned boxes of the whole complex
    interface Cube { x0: number; x1: number; z0: number; z1: number; h: number }
    const cubes: Cube[] = [];
    for (const rm of sh.rooms) {
      const h = rm.kind === 'portal' ? 8 : rm.kind === 'library' ? 7 : H;
      cubes.push({ x0: rm.cx - rm.half, x1: rm.cx + rm.half, z0: rm.cz - rm.half, z1: rm.cz + rm.half, h });
    }
    for (const l of sh.links) {
      const a = sh.rooms[l.a], b = sh.rooms[l.b];
      const x0 = Math.min(a.cx, b.cx), x1 = Math.max(a.cx, b.cx), z0 = Math.min(a.cz, b.cz), z1 = Math.max(a.cz, b.cz);
      cubes.push(a.cz === b.cz ? { x0, x1, z0: a.cz - 1, z1: a.cz + 1, h: 4 } : { x0: a.cx - 1, x1: a.cx + 1, z0, z1, h: 4 });
    }
    const touches = (c: Cube) => c.x1 + 1 >= X0 && c.x0 - 1 <= X1 && c.z1 + 1 >= Z0 && c.z0 - 1 <= Z1;
    const near = cubes.filter(touches);
    // pass 1: shells (floor, ceiling, walls)
    for (const c of near)
      for (let x = Math.max(c.x0 - 1, X0); x <= Math.min(c.x1 + 1, X1); x++)
        for (let z = Math.max(c.z0 - 1, Z0); z <= Math.min(c.z1 + 1, Z1); z++)
          for (let y = Y - 1; y <= Y + c.h + 1; y++) S(x, y, z, brick(x, y, z));
    // pass 2: hollow interiors
    for (const c of near)
      for (let x = Math.max(c.x0, X0); x <= Math.min(c.x1, X1); x++)
        for (let z = Math.max(c.z0, Z0); z <= Math.min(c.z1, Z1); z++)
          for (let y = Y; y <= Y + c.h; y++) S(x, y, z, B.AIR);
    // corridor torches
    for (const l of sh.links) {
      const a = sh.rooms[l.a], b = sh.rooms[l.b];
      const horiz = a.cz === b.cz;
      const lo = horiz ? Math.min(a.cx, b.cx) + a.half + 3 : Math.min(a.cz, b.cz) + a.half + 3, hi = horiz ? Math.max(a.cx, b.cx) - a.half - 3 : Math.max(a.cz, b.cz) - a.half - 3;
      for (let t = lo; t <= hi; t += 5) {
        if (horiz) S(t, Y + 3, a.cz - 1, pack(B.TORCH, 1)); // on the north wall
        else S(a.cx - 1, Y + 3, t, pack(B.TORCH, 4)); // on the west wall
      }
    }
    // decorations per room
    for (const rm of sh.rooms) {
      if (rm.cx + rm.half + 1 < X0 || rm.cx - rm.half - 1 > X1 || rm.cz + rm.half + 1 < Z0 || rm.cz - rm.half - 1 > Z1) continue;
      const rr = new Random(hash2(seed ^ 0x57c, rm.cx, rm.cz));
      const R = (dx: number, dy: number, dz: number, v: number) => S(rm.cx + dx, Y + dy, rm.cz + dz, v);
      const h = rm.half;
      const pillar = (dx: number, dz: number, ht: number) => { for (let k = 0; k < ht; k++) R(dx, k, dz, brick(rm.cx + dx, Y + k, rm.cz + dz)); };
      switch (rm.kind) {
        case 'start':
          // a small landing with a campfire-less ring of torches
          for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { pillar(dx, dz, 4); R(dx, 3, dz + (dz > 0 ? -1 : 1), pack(B.TORCH, dz > 0 ? 3 : 1)); }
          break;
        case 'plain':
          for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) if (rr.int(4) > 0) pillar(dx, dz, H);
          if (rr.int(3) === 0) R(rr.int(5) - 2, 0, rr.int(5) - 2, pack(B.COBBLESTONE_SLAB));
          break;
        case 'cross': break;
        case 'library':
          // shelves two high along the side walls, a table and a chest
          for (let d = -h + 1; d <= h - 1; d++) {
            if (Math.abs(d) <= 1) continue; // keep the doorways clear
            for (let k = 0; k < 3; k++) { R(-h, k, d, B.BOOKSHELF); R(h, k, d, B.BOOKSHELF); }
            if (rr.int(3) > 0) for (let k = 0; k < 2; k++) { R(d, k, -h, B.BOOKSHELF); R(d, k, h, B.BOOKSHELF); }
          }
          R(0, 0, 0, B.CRAFTING_TABLE);
          R(2, 0, 2, pack(B.CHEST, 0));
          R(-2, 0, -2, pack(B.CHEST, 2));
          break;
        case 'prison':
          // iron-barred cells in two corners with a spare chest between them
          for (const sx of [-1, 1])
            for (let k = 0; k < 3; k++) {
              for (let z = -5; z <= -1; z++) R(sx * 2, k, z, B.IRON_BARS);
              for (let x = 2; x <= 5; x++) R(sx * x, k, -1, B.IRON_BARS);
            }
          R(4, 0, -4, pack(B.CHEST, 3));
          break;
        case 'fountain':
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { R(dx, 0, dz, B.COBBLESTONE); }
          R(0, 0, 0, B.WATER);
          R(0, 1, 0, B.AIR);
          for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) pillar(dx, dz, 3);
          break;
        case 'chest':
          R(0, 0, -h + 1, pack(B.CHEST, 2));
          R(-1, 0, -h + 1, B.STONE_BRICKS); R(1, 0, -h + 1, B.STONE_BRICKS);
          break;
        case 'portal': {
          // a 3x3 lava-filled well ringed by twelve frames; some of them already hold an eye
          for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) R(dx, 0, dz, B.STONE_BRICKS);
          for (const [dx, dz] of FRAME_RING) R(dx, 1, dz, pack(B.END_PORTAL_FRAME, rr.int(10) === 0 ? 4 : 0));
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) R(dx, 1, dz, B.LAVA);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) R(dx, 0, dz, B.LAVA);
          // stairs up to the well, spawner on a pedestal against the far wall
          R(-3, 0, 0, pack(B.STONE_BRICK_STAIRS, 3)); R(3, 0, 0, pack(B.STONE_BRICK_STAIRS, 1));
          R(0, 0, -h + 1, B.STONE_BRICKS); R(0, 1, -h + 1, B.STONE_BRICKS);
          R(0, 2, -h + 1, B.SPAWNER);
          for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) { pillar(dx, dz, 7); R(dx + (dx > 0 ? -1 : 1), 3, dz, pack(B.TORCH, dx > 0 ? 2 : 4)); }
          if (rr.int(2) === 0) R(5, 0, 0, pack(B.CHEST, 3));
          break;
        }
      }
    }
    void get;
  }
}
