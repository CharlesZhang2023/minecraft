// Village generation. Layouts are a pure function of (seed, region) so every chunk can
// independently rebuild the pieces that overlap it.
import { Random, hash2 } from '../noise';
import { B, pack, SEA_LEVEL, CHUNK_H, BLOCKS } from './blocks';
import { BIOME } from './biomes';
import type { WorldGen } from './worldgen';

const REGION = 20; // chunks
type Piece =
  | { kind: 'well' | 'house' | 'bighouse' | 'farm' | 'lamp' | 'smithy' | 'library'; x: number; z: number; w: number; d: number; rot: number; seed: number }
  | { kind: 'road'; x: number; z: number; w: number; d: number; rot: number; seed: number };

export interface Village {
  x: number; z: number;
  style: 'oak' | 'spruce' | 'sand';
  pieces: Piece[];
}

export interface Spawn { type: string; x: number; y: number; z: number; data?: Record<string, unknown> }

const cache = new Map<string, Village | null>();

/** The village (if any) of the region containing chunk (cx, cz). */
export function regionVillage(gen: WorldGen, rx: number, rz: number): Village | null {
  const key = rx + ',' + rz + ',' + gen.seed;
  if (cache.has(key)) return cache.get(key)!;
  const r = new Random(hash2(gen.seed ^ 0x7111a6e, rx, rz));
  let v: Village | null = null;
  if (r.next() < 0.75) {
    const cx = rx * REGION + 3 + r.int(REGION - 6), cz = rz * REGION + 3 + r.int(REGION - 6);
    const x = cx * 16 + 8, z = cz * 16 + 8;
    const sh = gen.surfaceY(x, z);
    const b = gen.biomeAt(x, z, sh, gen.params(x, z));
    const ok = sh >= SEA_LEVEL && sh < 100 && [BIOME.PLAINS, BIOME.SAVANNA, BIOME.DESERT, BIOME.TAIGA, BIOME.SNOWY_PLAINS, BIOME.FOREST].includes(b);
    // reject steep sites
    let flat = ok;
    if (ok) for (const [dx, dz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) if (Math.abs(gen.surfaceY(x + dx, z + dz) - sh) > 7) flat = false;
    if (flat) v = layout(x, z, b === BIOME.DESERT ? 'sand' : b === BIOME.TAIGA || b === BIOME.SNOWY_PLAINS ? 'spruce' : 'oak', r);
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, v);
  return v;
}

function layout(x: number, z: number, style: Village['style'], r: Random): Village {
  const pieces: Piece[] = [];
  pieces.push({ kind: 'well', x: x - 3, z: z - 3, w: 6, d: 6, rot: 0, seed: r.nextU32() });
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let smithy = false, library = false;
  for (const [dx, dz] of dirs) {
    const len = 18 + r.int(18);
    // road: 3 wide starting at the well's edge
    const rx0 = dx === 0 ? x - 1 : dx > 0 ? x + 3 : x - 3 - len;
    const rz0 = dz === 0 ? z - 1 : dz > 0 ? z + 3 : z - 3 - len;
    pieces.push({ kind: 'road', x: rx0, z: rz0, w: dx === 0 ? 3 : len, d: dz === 0 ? 3 : len, rot: 0, seed: 0 });
    // buildings along both sides
    for (let t = 4; t < len - 4; t += 9 + r.int(3)) {
      for (const side of [-1, 1]) {
        if (r.int(4) === 0) continue;
        const roll = r.int(100);
        let kind: Piece['kind'] = roll < 45 ? 'house' : roll < 65 ? 'bighouse' : roll < 90 ? 'farm' : 'lamp';
        if (kind === 'bighouse' && !smithy) { kind = 'smithy'; smithy = true; }
        else if (kind === 'bighouse' && !library && r.bool()) { kind = 'library'; library = true; }
        const size = kind === 'farm' ? [7, 9] : kind === 'house' ? [5, 5] : kind === 'lamp' ? [1, 1] : [7, 7];
        // position along the road, facing it (rot = direction of the door: 0 N,1 E,2 S,3 W)
        const along = 3 + t;
        let bx: number, bz: number, rot: number, w: number, d: number;
        if (dx !== 0) {
          const cxr = dx > 0 ? x + along : x - along - size[0];
          w = size[0]; d = size[1];
          bx = cxr;
          bz = side < 0 ? z - 2 - 1 - d : z + 2 + 1;
          rot = side < 0 ? 2 : 0;
        } else {
          const czr = dz > 0 ? z + along : z - along - size[0];
          w = size[1]; d = size[0];
          bz = czr;
          bx = side < 0 ? x - 2 - 1 - w : x + 2 + 1;
          rot = side < 0 ? 1 : 3;
        }
        pieces.push({ kind, x: bx, z: bz, w, d, rot, seed: r.nextU32() });
      }
    }
    pieces.push({ kind: 'lamp', x: dx === 0 ? x + 2 : dx > 0 ? x + 3 + len : x - 4 - len, z: dz === 0 ? z + 2 : dz > 0 ? z + 3 + len : z - 4 - len, w: 1, d: 1, rot: 0, seed: 0 });
  }
  return { x, z, style, pieces };
}

/** Villages whose bounds may touch chunk (cx, cz). */
export function villagesNear(gen: WorldGen, cx: number, cz: number): Village[] {
  const out: Village[] = [];
  const rx = Math.floor(cx / REGION), rz = Math.floor(cz / REGION);
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const v = regionVillage(gen, rx + dx, rz + dz);
      if (v && Math.abs(v.x - (cx * 16 + 8)) < 80 && Math.abs(v.z - (cz * 16 + 8)) < 80) out.push(v);
    }
  return out;
}

// ------------------------------------------------------------------ placement
type Put = (x: number, y: number, z: number, v: number) => void;

export function placeVillage(gen: WorldGen, v: Village, cx: number, cz: number, blocks: Uint16Array, spawns: Spawn[]) {
  const x0 = cx * 16, z0 = cz * 16;
  const idx = (x: number, y: number, z: number) => (x - x0) | ((z - z0) << 4) | (y << 8);
  const inChunk = (x: number, z: number) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
  const put: Put = (x, y, z, b) => { if (inChunk(x, z) && y > 0 && y < CHUNK_H) blocks[idx(x, y, z)] = b; };
  const get = (x: number, y: number, z: number) => (inChunk(x, z) ? blocks[idx(x, y, z)] & 0xfff : 0);
  const S = styleBlocks(v.style);
  for (const p of v.pieces) {
    if (p.x > x0 + 15 || p.x + p.w - 1 < x0 || p.z > z0 + 15 || p.z + p.d - 1 < z0) continue;
    if (p.kind === 'road') {
      for (let x = Math.max(p.x, x0); x < Math.min(p.x + p.w, x0 + 16); x++)
        for (let z = Math.max(p.z, z0); z < Math.min(p.z + p.d, z0 + 16); z++) {
          // follow the real top of the column
          let y = CHUNK_H - 2;
          while (y > 1 && (get(x, y, z) === 0 || !BLOCKS[get(x, y, z)].solid && get(x, y, z) !== B.WATER || isPlantOrLeaf(get(x, y, z)))) y--;
          const top = get(x, y, z);
          if (top === B.WATER) put(x, y, z, S.bridge);
          else put(x, y, z, S.road);
          for (let k = 1; k < 4; k++) if (!BLOCKS[get(x, y + k, z)].solid || isPlantOrLeaf(get(x, y + k, z))) put(x, y + k, z, B.AIR);
        }
      continue;
    }
    const y = pieceGround(gen, p);
    const r = new Random(p.seed);
    const L = (lx: number, ly: number, lz: number, b: number) => {
      const [wx, wz] = rotate(p, lx, lz);
      put(wx, y + ly, wz, b);
    };
    // foundation + clearing
    if (p.kind !== 'lamp') {
      for (let lx = -1; lx <= p.w; lx++)
        for (let lz = -1; lz <= p.d; lz++) {
          const wx = p.x + lx, wz = p.z + lz;
          if (!inChunk(wx, wz)) continue;
          const edge = lx < 0 || lz < 0 || lx >= p.w || lz >= p.d;
          for (let yy = y + 12; yy >= y; yy--) put(wx, yy, wz, B.AIR);
          if (!edge) for (let yy = y - 1; yy > y - 8 && yy > 0; yy--) {
            const cur = get(wx, yy, wz);
            if (BLOCKS[cur].solid && cur !== B.OAK_LEAVES && yy < y - 1) break;
            put(wx, yy, wz, yy === y - 1 ? (p.kind === 'farm' ? B.DIRT : S.floorBase) : S.foundation);
          }
        }
    }
    switch (p.kind) {
      case 'well': buildWell(L, S); break;
      case 'lamp': buildLamp(L); break;
      case 'farm': buildFarm(L, p, r); break;
      case 'house': buildHouse(L, p, S, r, 5, 5, 4); break;
      case 'bighouse': buildHouse(L, p, S, r, 7, 7, 5); break;
      case 'smithy': buildHouse(L, p, S, r, 7, 7, 5, 'smith'); break;
      case 'library': buildHouse(L, p, S, r, 7, 7, 5, 'library'); break;
    }
    // villagers (spawned by the chunk that contains the piece origin)
    if ((p.kind === 'house' || p.kind === 'bighouse' || p.kind === 'smithy' || p.kind === 'library' || p.kind === 'farm') && inChunk(p.x, p.z)) {
      const prof = p.kind === 'smithy' ? 'smith' : p.kind === 'library' ? 'librarian' : p.kind === 'farm' ? 'farmer' : ['farmer', 'priest', 'butcher', 'librarian'][r.int(4)];
      const [sx, sz] = rotate(p, Math.floor(p.w / 2), Math.floor(p.d / 2));
      spawns.push({ type: 'villager', x: sx + 0.5, y: y + 1, z: sz + 0.5, data: { profession: prof } });
      // stray cats live in villages (1.14), and every village has its iron golem
      if (r.int(4) === 0) spawns.push({ type: 'cat', x: sx + 0.5, y: y + 1, z: sz + 0.5 });
      if (p.kind === 'smithy') spawns.push({ type: 'iron_golem', x: sx + 0.5, y: y + 1, z: sz + 2.5 });
    }
  }
}

function isPlantOrLeaf(id: number) {
  return id === B.TALL_GRASS || id === B.FERN || id === B.OAK_LEAVES || id === B.SPRUCE_LEAVES || id === B.BIRCH_LEAVES || (id >= B.DANDELION && id <= B.ALLIUM) || id === B.SNOW;
}

function pieceGround(gen: WorldGen, p: Piece): number {
  // average of the four corners and centre so houses sit naturally
  const pts = [[p.x, p.z], [p.x + p.w - 1, p.z], [p.x, p.z + p.d - 1], [p.x + p.w - 1, p.z + p.d - 1], [p.x + (p.w >> 1), p.z + (p.d >> 1)]];
  let sum = 0;
  for (const [x, z] of pts) sum += Math.max(SEA_LEVEL, gen.surfaceY(x, z));
  return Math.round(sum / pts.length) + 1;
}

/** local (lx along width, lz along depth, door side at lz = 0 when rot=0) -> world */
function rotate(p: Piece, lx: number, lz: number): [number, number] {
  switch (p.rot) {
    case 0: return [p.x + lx, p.z + lz];
    case 2: return [p.x + p.w - 1 - lx, p.z + p.d - 1 - lz];
    case 1: return [p.x + p.w - 1 - lz, p.z + lx];
    default: return [p.x + lz, p.z + p.d - 1 - lx];
  }
}

function styleBlocks(style: Village['style']) {
  if (style === 'sand') return { road: B.SMOOTH_SANDSTONE, bridge: B.SMOOTH_SANDSTONE, foundation: B.SANDSTONE, floorBase: B.SANDSTONE, wall: B.SMOOTH_SANDSTONE, corner: B.SANDSTONE, floor: B.SMOOTH_SANDSTONE, roof: B.SANDSTONE, stairs: B.COBBLESTONE_STAIRS, planks: B.SANDSTONE };
  if (style === 'spruce') return { road: B.GRAVEL, bridge: B.SPRUCE_PLANKS, foundation: B.COBBLESTONE, floorBase: B.COBBLESTONE, wall: B.SPRUCE_PLANKS, corner: B.SPRUCE_LOG, floor: B.SPRUCE_PLANKS, roof: B.SPRUCE_PLANKS, stairs: B.SPRUCE_STAIRS, planks: B.SPRUCE_PLANKS };
  return { road: B.GRAVEL, bridge: B.OAK_PLANKS, foundation: B.COBBLESTONE, floorBase: B.COBBLESTONE, wall: B.OAK_PLANKS, corner: B.OAK_LOG, floor: B.OAK_PLANKS, roof: B.OAK_PLANKS, stairs: B.OAK_STAIRS, planks: B.OAK_PLANKS };
}

function buildWell(L: (x: number, y: number, z: number, b: number) => void, S: ReturnType<typeof styleBlocks>) {
  for (let x = 0; x < 6; x++)
    for (let z = 0; z < 6; z++) {
      const ring = x === 0 || z === 0 || x === 5 || z === 5;
      L(x, -1, z, ring ? S.road : B.COBBLESTONE);
      if (ring) continue;
      const inner = x > 1 && x < 4 && z > 1 && z < 4;
      for (let y = -6; y <= -2; y++) L(x, y, z, inner ? B.WATER : B.COBBLESTONE);
      if (inner) L(x, -1, z, B.WATER);
      else { L(x, 0, z, B.COBBLESTONE); }
      if (!inner && (x === 1 || x === 4) && (z === 1 || z === 4)) { L(x, 1, z, B.OAK_FENCE); L(x, 2, z, B.OAK_FENCE); }
      L(x, 3, z, B.COBBLESTONE_SLAB);
    }
}

function buildLamp(L: (x: number, y: number, z: number, b: number) => void) {
  L(0, 0, 0, B.OAK_FENCE);
  L(0, 1, 0, B.OAK_FENCE);
  L(0, 2, 0, B.OAK_FENCE);
  L(0, 3, 0, B.WOOL_BLACK);
  L(0, 4, 0, pack(B.TORCH, 0));
}

function buildFarm(L: (x: number, y: number, z: number, b: number) => void, p: Piece, r: Random) {
  const w = p.rot % 2 ? p.d : p.w, d = p.rot % 2 ? p.w : p.d;
  // each half of the farm gets its own crop (vanilla: wheat, carrots, potatoes; pumpkins here too)
  const pick = () => [B.WHEAT, B.WHEAT, B.CARROTS, B.POTATOES, B.PUMPKIN_STEM][r.int(5)];
  const crops = [pick(), pick()];
  for (let x = 0; x < w; x++)
    for (let z = 0; z < d; z++) {
      const border = x === 0 || z === 0 || x === w - 1 || z === d - 1;
      if (border) { L(x, -1, z, B.OAK_LOG); continue; }
      if (x === (w >> 1)) { L(x, -1, z, B.WATER); continue; }
      L(x, -1, z, pack(B.FARMLAND, 1));
      const crop = crops[x < (w >> 1) ? 0 : 1];
      L(x, 0, z, pack(crop, crop === B.PUMPKIN_STEM ? 0 : r.int(8)));
    }
}

function buildHouse(L: (x: number, y: number, z: number, b: number) => void, p: Piece, S: ReturnType<typeof styleBlocks>, r: Random, w0: number, d0: number, h: number, special?: 'smith' | 'library') {
  const w = w0, d = d0;
  void p;
  for (let x = 0; x < w; x++)
    for (let z = 0; z < d; z++) {
      const edgeX = x === 0 || x === w - 1, edgeZ = z === 0 || z === d - 1;
      L(x, -1, z, S.floorBase);
      for (let y = 0; y < h; y++) {
        if (edgeX && edgeZ) L(x, y, z, S.corner);
        else if (edgeX || edgeZ) {
          const window = y === 1 && ((edgeZ && x % 2 === 0 && x > 0 && x < w - 1) || (edgeX && z % 2 === 0 && z > 0 && z < d - 1));
          L(x, y, z, window ? B.GLASS_PANE : S.wall);
        } else if (y > 0) L(x, y, z, B.AIR);
      }
    }
  // floor
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) L(x, 0, z, S.floor);
  // door in the middle of the front wall (local z = 0); local north maps to world facing `rot`
  const rot = p.rot;
  const dx = w >> 1;
  L(dx, 1, 0, pack(B.OAK_DOOR, rot));
  L(dx, 2, 0, pack(B.OAK_DOOR, rot | 8));
  L(dx, 0, -1, pack(S.stairs, (rot + 2) % 4));
  // stepped roof
  for (let x = -1; x <= w; x++)
    for (let z = -1; z <= d; z++) {
      const inset = Math.min(x + 1, z + 1, w - x, d - z);
      if (inset >= 1) L(x, h, z, S.roof);
      if (inset >= 2) L(x, h + 1, z, S.roof);
      if (inset >= 3) L(x, h + 2, z, pack(B.OAK_SLAB, 0));
    }
  // interior: wall torch on the front wall, workstation, bed
  L(1, 2, 1, pack(B.TORCH, rot + 1));
  L(w - 2, 1, d - 2, B.CRAFTING_TABLE);
  if (special === 'smith') {
    L(1, 1, d - 2, pack(B.FURNACE, (rot + 2) % 4));
    L(2, 1, d - 2, pack(B.FURNACE, (rot + 2) % 4));
    L(w - 2, 1, 1, pack(B.CHEST, (rot + 2) % 4));
  } else if (special === 'library') {
    for (let x = 1; x < w - 1; x++) { L(x, 1, d - 2, B.BOOKSHELF); L(x, 2, d - 2, B.BOOKSHELF); }
  } else if (r.bool()) {
    L(1, 1, d - 2, pack(B.BED, rot));
    L(1, 1, d - 3, pack(B.BED, rot | 8));
  }
}

