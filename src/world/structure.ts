// Structures made of pieces. A structure type decides where it may start (vanilla's random-spread placement:
// one try per `spacing`-chunk region, at a seed-derived offset, at least `separation` chunks apart), lays out its
// pieces from a random generator seeded by (world seed, salt, region) — so every worker and every chunk agree —
// and each piece writes only the blocks inside the chunk being generated. Pieces use rotatable text templates or
// draw themselves; chests and spawners leave hints (a loot table, a mob) that the game fills in when the chunk loads.
import { Random, hash2 } from '../noise';
import { B, BLOCKS, CHUNK_H, idOf, pack } from './blocks';
import { rotateBlock } from '../agent/blockspec';
import type { Spawn } from './village';

export interface BBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
export const bbox = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BBox => ({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1) });
export const overlaps = (a: BBox, b: BBox) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0 && a.y0 <= b.y1 && a.y1 >= b.y0;
export const overlaps2 = (a: BBox, b: BBox) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
export const union = (a: BBox, b: BBox): BBox => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), z1: Math.max(a.z1, b.z1) });

/** What a generator offers structures: terrain height and biome where it decides, before any chunk exists. */
export interface GenAccess {
  seed: number;
  /** Top solid block of the column (overworld: from the density noise; elsewhere: what the generator knows). */
  height(x: number, z: number): number;
  biome(x: number, z: number, y?: number): number;
}

/** Writing into the chunk being generated (world coordinates; anything outside the chunk is dropped). */
export interface BuildCtx {
  cx: number; cz: number;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, v: number): void;
  /** A chest (or barrel/trapped chest) whose contents come from a loot table when the chunk first loads. */
  chest(x: number, y: number, z: number, table: string, v?: number): void;
  spawner(x: number, y: number, z: number, mob: string): void;
  /** An entity to create when the chunk first loads. */
  spawn(type: string, x: number, y: number, z: number, data?: Record<string, unknown>): void;
  inChunk(x: number, z: number): boolean;
}

export interface Piece {
  box: BBox;
  /** Draw the part of the piece inside ctx's chunk; `r` is seeded per piece (the same in every chunk). */
  build(ctx: BuildCtx, r: Random): void;
  seed?: number;
}
export interface Start { type: string; x: number; y: number; z: number; pieces: Piece[]; box: BBox }

export interface StructureType {
  name: string;
  /** Chunks between tries, and the least gap between two starts (vanilla's spacing/separation). */
  spacing: number;
  separation: number;
  salt: number;
  /** How far (in chunks) a start's pieces may reach from its chunk: bounds the search for nearby starts. */
  reach: number;
  /** Lay the structure out from its chunk, or null if it can't go there (wrong biome, no room...). */
  layout(g: GenAccess, cx: number, cz: number, r: Random): Start | null;
  /** Spread: 'triangular' clusters starts nearer the middle of each region (vanilla monuments and mansions). */
  triangular?: boolean;
}

/** The chunk where a structure type tries to start in region (rx, rz). */
export function startChunk(t: StructureType, seed: number, rx: number, rz: number): [number, number] {
  const r = new Random(hash2(seed ^ Math.imul(t.salt, 0x9e3779b1), rx, rz));
  const span = t.spacing - t.separation;
  const ox = t.triangular ? (r.int(span) + r.int(span)) >> 1 : r.int(span);
  const oz = t.triangular ? (r.int(span) + r.int(span)) >> 1 : r.int(span);
  return [rx * t.spacing + ox, rz * t.spacing + oz];
}

const startCache = new Map<string, Start | null>();
/** The start of a type in a region (cached: every chunk around it asks). */
export function regionStart(t: StructureType, g: GenAccess, rx: number, rz: number): Start | null {
  const key = `${t.name}:${g.seed}:${rx}:${rz}`;
  if (startCache.has(key)) return startCache.get(key)!;
  const [cx, cz] = startChunk(t, g.seed, rx, rz);
  const r = new Random(hash2(g.seed ^ Math.imul(t.salt + 7, 0x85ebca6b), cx, cz));
  let s: Start | null = null;
  try { s = t.layout(g, cx, cz, r); } catch (e) { console.error(`structure ${t.name} at ${cx},${cz}:`, e); s = null; }
  if (s) for (const [i, p] of s.pieces.entries()) p.seed ??= hash2(g.seed ^ t.salt, cx * 31 + i, cz * 17 + i);
  if (startCache.size > 512) startCache.clear();
  startCache.set(key, s);
  return s;
}

/** Starts of these types whose bounds reach chunk (cx, cz). */
export function startsNear(types: StructureType[], g: GenAccess, cx: number, cz: number): Start[] {
  const out: Start[] = [];
  const chunk = bbox(cx * 16, 0, cz * 16, cx * 16 + 15, CHUNK_H - 1, cz * 16 + 15);
  for (const t of types) {
    const rx0 = Math.floor((cx - t.reach) / t.spacing), rx1 = Math.floor((cx + t.reach) / t.spacing);
    const rz0 = Math.floor((cz - t.reach) / t.spacing), rz1 = Math.floor((cz + t.reach) / t.spacing);
    for (let rx = rx0; rx <= rx1; rx++)
      for (let rz = rz0; rz <= rz1; rz++) {
        const s = regionStart(t, g, rx, rz);
        if (s && overlaps2(s.box, chunk)) out.push(s);
      }
  }
  return out;
}

/** The nearest start of a type to a block position (searching outward over regions): locators, maps, /locate. */
export function nearestStart(t: StructureType, g: GenAccess, x: number, z: number, maxRegions = 12): Start | null {
  const rx0 = Math.floor(Math.floor(x / 16) / t.spacing), rz0 = Math.floor(Math.floor(z / 16) / t.spacing);
  let best: Start | null = null, bd = Infinity;
  for (let ring = 0; ring <= maxRegions; ring++) {
    for (let dx = -ring; dx <= ring; dx++)
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const s = regionStart(t, g, rx0 + dx, rz0 + dz);
        if (!s) continue;
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < bd) { bd = d; best = s; }
      }
    if (best && ring >= 1 && bd < ring * t.spacing * 16) break;
  }
  return best;
}

/** A chunk-building context over a chunk's block array; hints go to `spawns`. */
export function chunkCtx(blocks: Uint16Array, cx: number, cz: number, spawns: Spawn[]): BuildCtx {
  const X0 = cx * 16, Z0 = cz * 16;
  const idx = (x: number, y: number, z: number) => (x - X0) | ((z - Z0) << 4) | (y << 8);
  const inChunk = (x: number, z: number) => x >= X0 && x < X0 + 16 && z >= Z0 && z < Z0 + 16;
  const ctx: BuildCtx = {
    cx, cz, inChunk,
    get: (x, y, z) => (inChunk(x, z) && y >= 0 && y < CHUNK_H ? blocks[idx(x, y, z)] : 0),
    set: (x, y, z, v) => { if (inChunk(x, z) && y > 0 && y < CHUNK_H) blocks[idx(x, y, z)] = v; },
    chest: (x, y, z, table, v = pack(B.CHEST)) => {
      if (!inChunk(x, z) || y <= 0 || y >= CHUNK_H) return;
      blocks[idx(x, y, z)] = v;
      const id = idOf(v);
      spawns.push({ type: 'loot', x, y, z, data: id === B.DISPENSER ? { table, tile: 'dispenser' } : id === B.DROPPER ? { table, tile: 'dropper' } : { table } });
    },
    spawner: (x, y, z, mob) => { if (!inChunk(x, z) || y <= 0 || y >= CHUNK_H) return; blocks[idx(x, y, z)] = B.SPAWNER; spawns.push({ type: 'spawner', x, y, z, data: { mob } }); },
    spawn: (type, x, y, z, data) => { if (inChunk(Math.floor(x), Math.floor(z))) spawns.push({ type, x, y, z, data }); },
  };
  return ctx;
}

/** Build the parts of these starts that fall in chunk (cx, cz). */
export function buildStarts(starts: Start[], ctx: BuildCtx) {
  const chunk = bbox(ctx.cx * 16, 0, ctx.cz * 16, ctx.cx * 16 + 15, CHUNK_H - 1, ctx.cz * 16 + 15);
  for (const s of starts)
    for (const p of s.pieces) {
      if (!overlaps2(p.box, chunk)) continue;
      try { p.build(ctx, new Random(p.seed ?? 1)); } catch (e) { console.error(`structure ${s.type} piece:`, e); }
    }
}

// ------------------------------------------------------------------ templates
/**
 * A block template written as text: `layers` bottom-up, each a list of rows north to south, each row's characters
 * west to east; the palette maps characters to blocks (' ' leaves the world alone, '.' makes air). Placed turned
 * by quarter turns clockwise (blocks with a facing turn with it).
 */
export interface Template { w: number; h: number; d: number; at(x: number, y: number, z: number): number | null }
export function template(layers: string[][], palette: Record<string, number | (() => number)>): Template {
  const h = layers.length, d = Math.max(...layers.map((l) => l.length)), w = Math.max(...layers.flatMap((l) => l.map((r) => r.length)));
  return {
    w, h, d,
    at(x, y, z) {
      const ch = layers[y]?.[z]?.[x] ?? ' ';
      if (ch === ' ') return null;
      if (ch === '.') return 0;
      const v = palette[ch];
      if (v === undefined) throw new Error(`template: no block for '${ch}'`);
      return typeof v === 'function' ? v() : v;
    },
  };
}
/** Where template cell (x, z) lands when turned q quarter turns clockwise, for a template w x d placed at origin. */
export function turnXZ(x: number, z: number, w: number, d: number, q: number): [number, number] {
  switch (q & 3) {
    case 1: return [d - 1 - z, x];
    case 2: return [w - 1 - x, d - 1 - z];
    case 3: return [z, w - 1 - x];
  }
  return [x, z];
}
/** The box a turned template covers when its corner is at (ox, oy, oz). */
export function templateBox(t: Template, ox: number, oy: number, oz: number, q: number): BBox {
  const w = q & 1 ? t.d : t.w, d = q & 1 ? t.w : t.d;
  return bbox(ox, oy, oz, ox + w - 1, oy + t.h - 1, oz + d - 1);
}
/** Write a template (its part inside ctx's chunk). `onBlock` may swap blocks (decay, variants) or return null to skip. */
export function placeTemplate(ctx: BuildCtx, t: Template, ox: number, oy: number, oz: number, q: number, onBlock?: (v: number, x: number, y: number, z: number) => number | null) {
  for (let y = 0; y < t.h; y++)
    for (let z = 0; z < t.d; z++)
      for (let x = 0; x < t.w; x++) {
        let v = t.at(x, y, z);
        if (v === null) continue;
        const [tx, tz] = turnXZ(x, z, t.w, t.d, q);
        const wx = ox + tx, wy = oy + y, wz = oz + tz;
        if (!ctx.inChunk(wx, wz)) continue;
        if (q) v = rotateBlock(v, q);
        if (onBlock) { const n = onBlock(v, wx, wy, wz); if (n === null) continue; v = n; }
        ctx.set(wx, wy, wz, v);
      }
}

// ------------------------------------------------------------------ helpers pieces share
/** Fill a box (inside the chunk) with a block, or with what `f` picks per cell. */
export function fill(ctx: BuildCtx, b: BBox, v: number | ((x: number, y: number, z: number) => number | null)) {
  const x0 = Math.max(b.x0, ctx.cx * 16), x1 = Math.min(b.x1, ctx.cx * 16 + 15);
  const z0 = Math.max(b.z0, ctx.cz * 16), z1 = Math.min(b.z1, ctx.cz * 16 + 15);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = Math.max(1, b.y0); y <= Math.min(CHUNK_H - 1, b.y1); y++) {
        const n = typeof v === 'number' ? v : v(x, y, z);
        if (n !== null) ctx.set(x, y, z, n);
      }
}
/** A hollow box: walls/floor/ceiling of `wall`, inside `inside` (air by default; null leaves it). */
export function shell(ctx: BuildCtx, b: BBox, wall: number | ((x: number, y: number, z: number) => number), inside: number | null = 0) {
  fill(ctx, b, (x, y, z) => {
    const edge = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1 || z === b.z0 || z === b.z1;
    return edge ? (typeof wall === 'number' ? wall : wall(x, y, z)) : inside;
  });
}
/** Extend a column of `v` down from y until something solid (structures standing on uneven ground). */
export function pillarDown(ctx: BuildCtx, x: number, y: number, z: number, v: number, minY = 1) {
  if (!ctx.inChunk(x, z)) return;
  for (let yy = y; yy >= minY; yy--) {
    const id = idOf(ctx.get(x, yy, z));
    if (id !== B.AIR && !BLOCKS[id].replaceable && !BLOCKS[id].fluid) break;
    ctx.set(x, yy, z, v);
  }
}
/** Pick one of the given values by weight. */
export function weighted<T>(r: Random, list: [T, number][]): T {
  let total = 0;
  for (const [, w] of list) total += w;
  let k = r.next() * total;
  for (const [v, w] of list) { k -= w; if (k < 0) return v; }
  return list[list.length - 1][0];
}
