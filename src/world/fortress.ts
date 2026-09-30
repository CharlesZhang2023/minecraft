// Nether fortresses: nether-brick bridges on arches spanning the lava caverns, a crossing, blaze spawner
// platforms, an enclosed nether-wart hall and a corridor with a treasure chest. Like villages, the layout
// is a pure function of (seed, region), so each chunk rebuilds only the parts that overlap it.
import { Random, hash2 } from '../noise';
import { B, pack } from './blocks';

const REGION = 12; // chunks
type Kind = 'bridgeX' | 'bridgeZ' | 'crossing' | 'spawner' | 'hall' | 'corridor';
export interface FPiece { kind: Kind; x0: number; z0: number; x1: number; z1: number; y: number; seed: number; dir?: number }
export interface Fortress { x: number; y: number; z: number; pieces: FPiece[] }

const cache = new Map<string, Fortress | null>();

export function regionFortress(seed: number, rx: number, rz: number): Fortress | null {
  const key = rx + ',' + rz + ',' + seed;
  if (cache.has(key)) return cache.get(key)!;
  const r = new Random(hash2(seed ^ 0x0f047e55, rx, rz));
  let f: Fortress | null = null;
  if (r.next() < 0.7) {
    const cx = rx * REGION + 4 + r.int(REGION - 8), cz = rz * REGION + 4 + r.int(REGION - 8);
    f = layout(cx * 16 + 8, 64 + r.int(10), cz * 16 + 8, r);
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, f);
  return f;
}

function layout(x: number, y: number, z: number, r: Random): Fortress {
  const p: FPiece[] = [];
  const east = 22 + r.int(14), west = 22 + r.int(14), north = 20 + r.int(10), south = 20 + r.int(10);
  p.push({ kind: 'crossing', x0: x - 4, z0: z - 4, x1: x + 4, z1: z + 4, y, seed: r.nextU32() });
  p.push({ kind: 'bridgeX', x0: x + 5, z0: z - 2, x1: x + east, z1: z + 2, y, seed: r.nextU32() });
  p.push({ kind: 'bridgeX', x0: x - west, z0: z - 2, x1: x - 5, z1: z + 2, y, seed: r.nextU32() });
  p.push({ kind: 'bridgeZ', x0: x - 2, z0: z - north, x1: x + 2, z1: z - 5, y, seed: r.nextU32() });
  p.push({ kind: 'bridgeZ', x0: x - 2, z0: z + 5, x1: x + 2, z1: z + south, y, seed: r.nextU32() });
  // blaze spawner platforms at the east and west ends
  p.push({ kind: 'spawner', x0: x + east + 1, z0: z - 4, x1: x + east + 9, z1: z + 4, y, seed: r.nextU32() });
  p.push({ kind: 'spawner', x0: x - west - 9, z0: z - 4, x1: x - west - 1, z1: z + 4, y, seed: r.nextU32() });
  // nether wart hall to the north, treasure corridor to the south
  p.push({ kind: 'hall', x0: x - 7, z0: z - north - 15, x1: x + 7, z1: z - north - 1, y, seed: r.nextU32(), dir: 2 });
  p.push({ kind: 'corridor', x0: x - 2, z0: z + south + 1, x1: x + 2, z1: z + south + 16, y, seed: r.nextU32(), dir: 0 });
  return { x, y, z, pieces: p };
}

export function fortressesNear(seed: number, cx: number, cz: number): Fortress[] {
  const out: Fortress[] = [];
  const rx = Math.floor(cx / REGION), rz = Math.floor(cz / REGION);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const f = regionFortress(seed, rx + dx, rz + dz);
      if (f) out.push(f);
    }
  return out;
}

type Get = (x: number, y: number, z: number) => number;
type Set = (x: number, y: number, z: number, v: number) => void;

const NB = B.NETHER_BRICKS, FENCE = B.NETHER_BRICK_FENCE;
const stair = (facing: number, upside = false) => pack(B.NETHER_BRICK_STAIRS, facing | (upside ? 4 : 0));

/** Write the fortress blocks falling inside chunk (cx, cz). */
export function buildFortress(f: Fortress, cx: number, cz: number, get: Get, set: Set) {
  const X0 = cx * 16, Z0 = cz * 16, X1 = X0 + 15, Z1 = Z0 + 15;
  for (const pc of f.pieces) {
    if (pc.x1 + 1 < X0 || pc.x0 - 1 > X1 || pc.z1 + 1 < Z0 || pc.z0 - 1 > Z1) continue;
    const inChunk = (x: number, z: number) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
    const S = (x: number, y: number, z: number, v: number) => { if (inChunk(x, z) && y > 0 && y < 255) set(x, y, z, v); };
    const pillar = (x: number, z: number, from: number) => {
      if (!inChunk(x, z)) return;
      for (let y = from; y > 5; y--) {
        const id = get(x, y, z) & 0xfff;
        if (id !== 0 && id !== B.LAVA && id !== B.FIRE) break;
        set(x, y, z, NB);
      }
    };
    const r = new Random(pc.seed);
    const y = pc.y;
    switch (pc.kind) {
      case 'bridgeX': case 'bridgeZ': {
        const alongX = pc.kind === 'bridgeX';
        const len = alongX ? pc.x1 - pc.x0 : pc.z1 - pc.z0;
        for (let t = 0; t <= len; t++)
          for (let w = 0; w < 5; w++) {
            const x = alongX ? pc.x0 + t : pc.x0 + w, z = alongX ? pc.z0 + w : pc.z0 + t;
            const edge = w === 0 || w === 4;
            // deck and underside
            S(x, y, z, NB);
            S(x, y - 1, z, NB);
            // arches every 7 blocks: a solid support band and pillars on the edges
            const k = (alongX ? x : z) % 7;
            if (k === 0 || k === 1) { S(x, y - 2, z, NB); if (edge || w === 2) pillar(x, z, y - 3); }
            else if (k === 2 || k === 6) S(x, y - 2, z, edge ? NB : 0);
            // low walls with fence railings
            if (edge) { S(x, y + 1, z, NB); S(x, y + 2, z, FENCE); for (let h = 3; h <= 4; h++) S(x, y + h, z, 0); }
            else for (let h = 1; h <= 4; h++) S(x, y + h, z, 0);
          }
        break;
      }
      case 'crossing': {
        for (let x = pc.x0; x <= pc.x1; x++)
          for (let z = pc.z0; z <= pc.z1; z++) {
            const ex = x === pc.x0 || x === pc.x1, ez = z === pc.z0 || z === pc.z1;
            S(x, y, z, NB); S(x, y - 1, z, NB);
            for (let h = 1; h <= 6; h++) S(x, y + h, z, 0);
            const cxm = (pc.x0 + pc.x1) >> 1, czm = (pc.z0 + pc.z1) >> 1;
            const gap = Math.abs(x - cxm) <= 2 || Math.abs(z - czm) <= 2;
            if ((ex || ez) && !gap) { S(x, y + 1, z, NB); S(x, y + 2, z, FENCE); }
            // corner towers
            if (ex && ez) { for (let h = 1; h <= 5; h++) S(x, y + h, z, NB); pillar(x, z, y - 2); }
          }
        break;
      }
      case 'spawner': {
        const mx = (pc.x0 + pc.x1) >> 1, mz = (pc.z0 + pc.z1) >> 1;
        for (let x = pc.x0; x <= pc.x1; x++)
          for (let z = pc.z0; z <= pc.z1; z++) {
            const edge = x === pc.x0 || x === pc.x1 || z === pc.z0 || z === pc.z1;
            S(x, y, z, NB); S(x, y - 1, z, NB);
            for (let h = 1; h <= 6; h++) S(x, y + h, z, 0);
            const bridgeGap = Math.abs(z - mz) <= 2 && (x === pc.x0 || x === pc.x1) && ((pc.x0 < f.x && x === pc.x1) || (pc.x0 > f.x && x === pc.x0));
            if (edge && !bridgeGap) { S(x, y + 1, z, NB); S(x, y + 2, z, FENCE); }
            if ((x === pc.x0 || x === pc.x1) && (z === pc.z0 || z === pc.z1)) pillar(x, z, y - 2);
          }
        // raised dais with stairs and the spawner
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) S(mx + dx, y + 1, mz + dz, NB);
        S(mx, y + 1, mz - 2, stair(2)); S(mx, y + 1, mz + 2, stair(0)); S(mx - 2, y + 1, mz, stair(1)); S(mx + 2, y + 1, mz, stair(3));
        S(mx, y + 2, mz, B.SPAWNER);
        break;
      }
      case 'hall': {
        // enclosed nether-brick hall: walls with fence windows, roof, soul sand beds of nether wart
        const mx = (pc.x0 + pc.x1) >> 1;
        for (let x = pc.x0; x <= pc.x1; x++)
          for (let z = pc.z0; z <= pc.z1; z++) {
            const wall = x === pc.x0 || x === pc.x1 || z === pc.z0 || z === pc.z1;
            S(x, y, z, NB); S(x, y - 1, z, NB);
            S(x, y + 7, z, NB);
            for (let h = 1; h <= 6; h++) {
              if (!wall) { S(x, y + h, z, 0); continue; }
              const door = z === pc.z1 && Math.abs(x - mx) <= 1 && h <= 3;
              const corner = (x === pc.x0 || x === pc.x1) && (z === pc.z0 || z === pc.z1);
              const along = z === pc.z0 || z === pc.z1 ? x : z;
              const window = (h === 3 || h === 4) && !corner && along % 2 === 0;
              S(x, y + h, z, door ? 0 : window ? FENCE : NB);
            }
            if ((x === pc.x0 || x === pc.x1) && (z === pc.z0 || z === pc.z1)) pillar(x, z, y - 2);
          }
        // two soul sand beds framed by stairs
        for (const bz of [pc.z0 + 3, pc.z0 + 8]) {
          for (let x = pc.x0 + 2; x <= pc.x1 - 2; x++) {
            for (let dz = 0; dz < 3; dz++) {
              S(x, y, bz + dz, B.SOUL_SAND);
              if (r.int(5)) S(x, y + 1, bz + dz, pack(B.NETHER_WART, r.int(4)));
            }
            S(x, y + 1, bz - 1, stair(0));
            S(x, y + 1, bz + 3, stair(2));
          }
        }
        // lava-lit corner nooks (glowstone keeps the wart hall visible)
        S(pc.x0 + 1, y + 6, pc.z0 + 1, B.GLOWSTONE); S(pc.x1 - 1, y + 6, pc.z0 + 1, B.GLOWSTONE);
        S(pc.x0 + 1, y + 6, pc.z1 - 1, B.GLOWSTONE); S(pc.x1 - 1, y + 6, pc.z1 - 1, B.GLOWSTONE);
        break;
      }
      case 'corridor': {
        // 5-wide enclosed corridor with fence windows ending in a small chest room
        for (let x = pc.x0; x <= pc.x1; x++)
          for (let z = pc.z0; z <= pc.z1; z++) {
            const wall = x === pc.x0 || x === pc.x1;
            const end = z === pc.z1;
            S(x, y, z, NB); S(x, y - 1, z, NB); S(x, y + 5, z, NB);
            for (let h = 1; h <= 4; h++) S(x, y + h, z, wall || end ? ((h === 2 || h === 3) && z % 3 === 0 && !end ? FENCE : NB) : 0);
            if (wall && z % 7 === 0) pillar(x, z, y - 2);
          }
        const mx = (pc.x0 + pc.x1) >> 1;
        S(mx, y + 1, pc.z1 - 1, pack(B.CHEST, 0));
        S(mx - 1, y + 1, pc.z1 - 1, stair(1, true)); S(mx + 1, y + 1, pc.z1 - 1, stair(3, true));
        break;
      }
    }
  }
}
