// Terrain generation. Runs inside workers; pure functions of (seed, chunk coords).
import { Octaves, Random, hash2, Noise } from '../noise';
import { B, B2, STONE2, WOOD, CORAL, TERRACOTTA_COLORS, CHUNK_H, SEA_LEVEL, pack, BLOCKS, OPAQUE, isLeaves } from './blocks';
import { BIOME, BIOMES, isOceanBiome } from './biomes';
import { jungleTree, megaJungleTree, jungleBush, acaciaTree, darkOakTree, megaSpruceTree, hugeMushroom } from './features';
import { chunkCtx, startsNear, buildStarts, type GenAccess } from './structure';
/** A world-generated bee nest's tile: three bees inside. (Kept here so the generator worker needn't load the bee code.) */
const nestTile = () => ({ type: 'beehive', bees: [0, 1, 2].map(() => ({ nectar: false, ticksIn: 600, minTicks: 600, health: 10 })), honey: 0 });
import { OVERWORLD_STRUCTURES } from './structures/overworld';
import { smoothstep, lerp } from '../math';
import { villagesNear, placeVillage, Spawn } from './village';
import { buildStrongholds } from './stronghold';

const GX = 5, GY = 33; // density grid: 4-block horizontal cells, 8-block vertical cells
const idx = (x: number, y: number, z: number) => x | (z << 4) | (y << 8);

export interface ColumnParams {
  base: number;
  amp: number;
  mount: number;
  river: number;
  cont: number;
}

export interface ChunkGenResult {
  blocks: Uint16Array;
  biomes: Uint8Array;
  spawns?: Spawn[];
}

export type Setter = (x: number, y: number, z: number, v: number, force?: boolean) => void;

/**
 * Version of the terrain generator (overworld, Nether and End). Bump it whenever generation changes what a seed
 * produces. Worlds record the version they were made with, so old saves can be recognised (and, if ever needed,
 * generated the old way) after the generator changes.
 */
const SURFACE_STRUCTURES = OVERWORLD_STRUCTURES.filter((t) => ['desert_pyramid', 'jungle_temple', 'swamp_hut', 'igloo', 'pillager_outpost', 'woodland_mansion', 'desert_well', 'ruined_portal'].includes(t.name));
export const GENERATOR_VERSION = 2;

export class WorldGen implements GenAccess {
  private cont: Octaves;
  private erosion: Octaves;
  private peaks: Octaves;
  private hills: Octaves;
  private riverN: Octaves;
  private temp: Octaves;
  private humid: Octaves;
  private d3: Octaves;
  private surf: Noise;
  private patch: Noise;
  /** 1.16 biomes: a large-scale "weirdness" field picks the special variants (badlands, dark forest...). */
  private special: Octaves;
  private bandNoise: Noise;
  private bands: number[];
  private gridCache = new Map<string, Float32Array>();

  constructor(public seed: number) {
    const r = new Random(seed);
    this.cont = new Octaves(r.nextU32(), 4);
    this.erosion = new Octaves(r.nextU32(), 3);
    this.peaks = new Octaves(r.nextU32(), 4);
    this.hills = new Octaves(r.nextU32(), 3);
    this.riverN = new Octaves(r.nextU32(), 3);
    this.temp = new Octaves(r.nextU32(), 3);
    this.humid = new Octaves(r.nextU32(), 3);
    this.d3 = new Octaves(r.nextU32(), 3);
    this.surf = new Noise(r.nextU32());
    this.patch = new Noise(r.nextU32());
    // (drawn after the original fields so those stay what they were)
    this.special = new Octaves(r.nextU32(), 2);
    this.bandNoise = new Noise(r.nextU32());
    // badlands terracotta bands, 64 layers (vanilla's generateBands: plain terracotta with coloured stripes)
    const br = new Random(r.nextU32());
    this.bands = new Array(64).fill(B.TERRACOTTA);
    for (let i = 0; i < 64; i++) { i += br.int(5) + 1; if (i < 64) this.bands[i] = TERRACOTTA_COLORS[1]; }
    for (const [col, n] of [[4, 2 + br.int(3)], [14, 2 + br.int(3)], [0, 1 + br.int(3)], [8, 2 + br.int(2)], [12, 1 + br.int(2)]] as const)
      for (let k = 0; k < n; k++) { const at = br.int(64), len = 1 + br.int(3); for (let j = 0; j < len && at + j < 64; j++) this.bands[at + j] = TERRACOTTA_COLORS[col]; }
  }
  height(x: number, z: number): number { return this.surfaceY(x, z); }
  biome(x: number, z: number): number { const sh = this.surfaceY(x, z); return this.biomeAt(x, z, sh, this.params(x, z)); }

  params(x: number, z: number): ColumnParams {
    const c = this.cont.sample2(x / 900, z / 900) * 1.5 + 0.12;
    const e = this.erosion.sample2(x / 500 + 100, z / 500) * 1.4;
    const pRaw = this.peaks.sample2(x / 260, z / 260);
    const ridge = 1 - Math.abs(pRaw) * 2.2; // ridged: peaks along zero crossings
    const hill = this.hills.sample2(x / 140, z / 140);

    let base: number;
    if (c < -0.35) base = 34 + ((c + 1) / 0.65) * 16;
    else if (c < -0.12) base = 50 + ((c + 0.35) / 0.23) * 12;
    else if (c < 0) base = 62 + ((c + 0.12) / 0.12) * 3;
    else base = 65 + c * 16;
    const land = smoothstep(-0.12, 0.05, c);
    const hilly = smoothstep(0.3, -0.5, e);
    base += land * hill * (3 + 12 * hilly);
    const mount = smoothstep(0.08, 0.45, c) * smoothstep(0.05, -0.4, e);
    base += mount * (25 + Math.max(0, ridge) * 75 + hill * 12);

    // rivers carve through land
    const rv = Math.abs(this.riverN.sample2(x / 480, z / 480));
    const rf = (1 - smoothstep(0.0, 0.045, rv)) * land * (1 - mount * 0.7);
    if (base > SEA_LEVEL - 4) base = lerp(base, SEA_LEVEL - 5, rf);
    // mushroom islands: low hills raised out of the deep sea where the 'special' noise peaks (see biomeAt)
    if (c < -0.4) {
      const isl = smoothstep(0.56, 0.72, this.special.sample2(x / 700 + 900, z / 700) * 1.6) * smoothstep(-0.4, -0.5, c);
      if (isl > 0) base = lerp(base, 66 + hill * 5, isl);
    }
    const amp = (2.5 + hilly * 4 + mount * 13) * (1 - rf * 0.9);
    return { base, amp, mount, river: rf, cont: c };
  }

  /** 3D density grid for one chunk (5x33x5 samples). */
  densityGrid(cx: number, cz: number): Float32Array {
    const key = cx + ',' + cz;
    const cached = this.gridCache.get(key);
    if (cached) return cached;
    const g = new Float32Array(GX * GX * GY);
    for (let gx = 0; gx < GX; gx++)
      for (let gz = 0; gz < GX; gz++) this.gridColumn(cx * 16 + gx * 4, cz * 16 + gz * 4, g, (gx * GX + gz) * GY);
    if (this.gridCache.size > 256) this.gridCache.clear();
    this.gridCache.set(key, g);
    return g;
  }

  /** One column of the density grid (33 samples, 8 blocks apart) at a world position on the 4-block grid. */
  private gridColumn(wx: number, wz: number, out: Float32Array, o: number) {
    const p = this.params(wx, wz);
    for (let gy = 0; gy < GY; gy++) {
      const y = gy * 8;
      let d = p.base - y;
      // only bother with 3D noise near the surface; weaker above the base height so
      // overhangs form cliffs rather than floating islands
      if (Math.abs(d) < p.amp * 1.6 + 8) {
        const n = this.d3.sample3(wx / 56, y / 36, wz / 56) * p.amp * 1.6;
        d += d < 0 ? n * Math.max(0.25, 1 + d / (p.amp * 2.5)) : n;
      }
      if (y > 250) d = -100;
      out[o + gy] = d;
    }
  }

  /**
   * The ground on a regular grid, worked out straight from the noise without generating any chunk (for distant
   * low-detail terrain). Sample (i, k) is at (x0 + i * step, z0 + k * step) for i, k in [0, n): the height of the top
   * solid block, the biome and the top block, as `generate` makes them before caves, trees and structures.
   */
  surfaceGrid(x0: number, z0: number, step: number, n: number): { height: Int16Array; biome: Uint8Array; top: Uint16Array } {
    const height = new Int16Array(n * n), biome = new Uint8Array(n * n), top = new Uint16Array(n * n);
    // density columns on the 4-block grid, each followed by the highest grid level that is solid
    const cols = new Map<number, Float32Array>();
    const col = (wx: number, wz: number) => {
      const k = (wx / 4 + 0x100000) * 0x200000 + (wz / 4 + 0x100000);
      let c = cols.get(k);
      if (!c) {
        c = new Float32Array(GY + 1);
        this.gridColumn(wx, wz, c, 0);
        let t = -1;
        for (let gy = GY - 1; gy >= 0; gy--) if (c[gy] > 0) { t = gy; break; }
        c[GY] = t;
        cols.set(k, c);
      }
      return c;
    };
    for (let k = 0; k < n; k++)
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, z = z0 + k * step;
        const gx = Math.floor(x / 4) * 4, gz = Math.floor(z / 4) * 4;
        const fx = (x - gx) / 4, fz = (z - gz) / 4;
        // the same trilinear blend as `density` (corners a: x z, b: x+1 z, c: x z+1, d: x+1 z+1)
        const A = col(gx, gz), Bc = fx ? col(gx + 4, gz) : A, C = fz ? col(gx, gz + 4) : A, D = fx && fz ? col(gx + 4, gz + 4) : fx ? Bc : C;
        let sh = 0;
        const hi = Math.max(A[GY], Bc[GY], C[GY], D[GY]);
        for (let y = Math.min(250, hi * 8 + 7); y > 0; y--) {
          const gy = y >> 3, fy = (y & 7) / 8;
          const a = A[gy] + (A[gy + 1] - A[gy]) * fy;
          const b = Bc[gy] + (Bc[gy + 1] - Bc[gy]) * fy;
          const c = C[gy] + (C[gy + 1] - C[gy]) * fy;
          const d = D[gy] + (D[gy + 1] - D[gy]) * fy;
          const ab = a + (b - a) * fx;
          const cd = c + (d - c) * fx;
          if (ab + (cd - ab) * fz > 0) { sh = y; break; }
        }
        const j = k * n + i;
        const bm = this.biomeAt(x, z, sh, this.params(x, z));
        height[j] = sh;
        biome[j] = bm;
        top[j] = this.topBlock(bm, sh, x, z);
      }
    return { height, biome, top };
  }

  /** The trees `generate` grows from one chunk, written through `set` (which may get blocks outside the chunk). */
  treesOf(cx: number, cz: number, set: Setter) {
    this.placeTrees(cx, cz, set);
  }

  /** Trilinear density lookup (same arithmetic used for filling and for queries). */
  static density(g: Float32Array, lx: number, y: number, lz: number): number {
    const gx = lx >> 2, gz = lz >> 2, gy = y >> 3;
    const fx = (lx & 3) / 4, fz = (lz & 3) / 4, fy = (y & 7) / 8;
    const i00 = (gx * GX + gz) * GY + gy;
    const i10 = ((gx + 1) * GX + gz) * GY + gy;
    const i01 = (gx * GX + gz + 1) * GY + gy;
    const i11 = ((gx + 1) * GX + gz + 1) * GY + gy;
    const a = g[i00] + (g[i00 + 1] - g[i00]) * fy;
    const b = g[i10] + (g[i10 + 1] - g[i10]) * fy;
    const c = g[i01] + (g[i01 + 1] - g[i01]) * fy;
    const d = g[i11] + (g[i11 + 1] - g[i11]) * fy;
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }

  /** Top solid y for a column (-1 if none) using the density function. */
  surfaceY(wx: number, wz: number): number {
    const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
    const g = this.densityGrid(cx, cz);
    const lx = wx - cx * 16, lz = wz - cz * 16;
    for (let y = 250; y > 0; y--) if (WorldGen.density(g, lx, y, lz) > 0) return y;
    return 0;
  }

  climate(x: number, z: number): [number, number] {
    const t = this.temp.sample2(x / 1100, z / 1100) * 1.8 + this.surf.noise2(x / 40, z / 40) * 0.03;
    const h = this.humid.sample2(x / 900 + 50, z / 900) * 1.8;
    return [t, h];
  }

  biomeAt(x: number, z: number, sh: number, p: ColumnParams): number {
    const [t, h] = this.climate(x, z);
    const w = this.special.sample2(x / 700 + 900, z / 700) * 1.6;
    if (sh < SEA_LEVEL - 1) {
      if (p.river > 0.4 && p.cont > -0.1) return t < -0.45 ? BIOME.FROZEN_RIVER : BIOME.RIVER;
      // mushroom islands rise out of the deep sea now and then
      if (p.cont < -0.4 && w > 0.62) return BIOME.MUSHROOM_FIELDS;
      const deep = sh < SEA_LEVEL - 20;
      if (t < -0.45) return deep ? BIOME.DEEP_FROZEN_OCEAN : BIOME.FROZEN_OCEAN;
      if (t < -0.2) return deep ? BIOME.DEEP_COLD_OCEAN : BIOME.COLD_OCEAN;
      if (t > 0.6) return BIOME.WARM_OCEAN;
      if (t > 0.3) return deep ? BIOME.DEEP_LUKEWARM_OCEAN : BIOME.LUKEWARM_OCEAN;
      return deep ? BIOME.DEEP_OCEAN : BIOME.OCEAN;
    }
    if (p.cont < -0.4 && w > 0.62) return BIOME.MUSHROOM_FIELDS;
    if (sh <= SEA_LEVEL + 2 && p.cont < 0.06 && p.mount < 0.2 && p.river < 0.3) {
      if (p.mount > 0.1 || w < -0.75) return BIOME.STONE_SHORE;
      return t < -0.45 ? BIOME.SNOWY_BEACH : t > 0.45 && h < 0.1 ? BIOME.DESERT : BIOME.BEACH;
    }
    if (p.mount > 0.35 && sh > 92) {
      if (t < -0.45) return w > 0.3 ? BIOME.SNOWY_MOUNTAINS : BIOME.SNOWY_TAIGA;
      if (t > 0.42 && h < 0.05 && w > 0.25) return BIOME.WOODED_BADLANDS;
      return w > 0.45 ? BIOME.GRAVELLY_MOUNTAINS : BIOME.MOUNTAINS;
    }
    if (t > 0.42) {
      if (h < 0.05) return w > 0.35 ? (sh > 88 ? BIOME.WOODED_BADLANDS : BIOME.BADLANDS) : BIOME.DESERT;
      if (h < 0.3) return sh > 90 ? BIOME.SAVANNA_PLATEAU : BIOME.SAVANNA;
      if (h < 0.38) return BIOME.JUNGLE_EDGE;
      return w > 0.35 ? BIOME.BAMBOO_JUNGLE : BIOME.JUNGLE;
    }
    if (t < -0.42) return h > 0.05 ? BIOME.SNOWY_TAIGA : w > 0.5 ? BIOME.ICE_SPIKES : BIOME.SNOWY_PLAINS;
    if (t < -0.18) return h > 0.32 ? BIOME.GIANT_TREE_TAIGA : BIOME.TAIGA;
    if (h > 0.45 && sh < 67 && t > 0) return BIOME.SWAMP;
    if (h > 0.2) {
      if (w > 0.3 && h > 0.35) return BIOME.DARK_FOREST;
      return t < 0.05 ? (w < -0.4 ? BIOME.TALL_BIRCH_FOREST : BIOME.BIRCH_FOREST) : h > 0.55 ? BIOME.FLOWER_FOREST : BIOME.FOREST;
    }
    if (h > 0.08) return BIOME.FOREST;
    return w > 0.55 ? BIOME.SUNFLOWER_PLAINS : BIOME.PLAINS;
  }

  /** Block placed on the very top of a column (used for trees / plants deciding validity). */
  topBlock(biome: number, sh: number, x: number, z: number): number {
    if (sh < SEA_LEVEL - 1) {
      if (biome === BIOME.MUSHROOM_FIELDS) return B.DIRT;
      if (biome === BIOME.WARM_OCEAN || biome === BIOME.LUKEWARM_OCEAN || biome === BIOME.DEEP_LUKEWARM_OCEAN) return B.SAND;
      if (biome === BIOME.DEEP_OCEAN || biome === BIOME.DEEP_COLD_OCEAN || biome === BIOME.DEEP_FROZEN_OCEAN) return this.patch.noise2(x / 12, z / 12) > -0.2 ? B.GRAVEL : B.SAND;
      return this.patch.noise2(x / 12, z / 12) > 0.35 ? B.GRAVEL : sh > SEA_LEVEL - 10 ? B.SAND : B.DIRT;
    }
    switch (biome) {
      case BIOME.BADLANDS: case BIOME.WOODED_BADLANDS:
        return biome === BIOME.WOODED_BADLANDS && sh > 86 ? (this.patch.noise2(x / 8, z / 8) > 0.2 ? B.COARSE_DIRT : B.GRASS) : STONE2.RED_SAND;
      case BIOME.MUSHROOM_FIELDS: return B2.MYCELIUM;
      case BIOME.GRAVELLY_MOUNTAINS: return this.patch.noise2(x / 14, z / 14) > -0.2 ? B.GRAVEL : sh > 120 ? B.STONE : B.GRASS;
      case BIOME.STONE_SHORE: return B.STONE;
      case BIOME.GIANT_TREE_TAIGA: { const n = this.patch.noise2(x / 9, z / 9); return n > 0.3 ? B.PODZOL : n < -0.4 ? B.COARSE_DIRT : B.GRASS; }
      case BIOME.ICE_SPIKES: return B.SNOW_BLOCK;
      case BIOME.SNOWY_MOUNTAINS: return sh > 110 ? B.SNOW_BLOCK : B.GRASS;
      case BIOME.DESERT:
      case BIOME.BEACH:
      case BIOME.SNOWY_BEACH:
        return B.SAND;
      case BIOME.RIVER:
      case BIOME.FROZEN_RIVER:
        return sh < SEA_LEVEL + 1 ? B.SAND : B.GRASS;
      case BIOME.MOUNTAINS:
        return sh > 118 + this.surf.noise2(x / 16, z / 16) * 10 ? B.STONE : this.patch.noise2(x / 20, z / 20) > 0.6 ? B.GRAVEL : B.GRASS;
      case BIOME.TAIGA:
        return this.patch.noise2(x / 10, z / 10) > 0.45 ? B.PODZOL : B.GRASS;
      case BIOME.SAVANNA:
        return this.patch.noise2(x / 10, z / 10) > 0.6 ? B.COARSE_DIRT : B.GRASS;
      default:
        return B.GRASS;
    }
  }

  generate(cx: number, cz: number): ChunkGenResult {
    const blocks = new Uint16Array(16 * 16 * CHUNK_H);
    const biomes = new Uint8Array(256);
    const g = this.densityGrid(cx, cz);
    const wx0 = cx * 16, wz0 = cz * 16;

    // 1. base terrain: stone / water / air
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++)
        for (let y = 0; y < 252; y++) {
          const d = WorldGen.density(g, lx, y, lz);
          if (d > 0) blocks[idx(lx, y, lz)] = B.STONE;
          else if (y <= SEA_LEVEL) blocks[idx(lx, y, lz)] = B.WATER;
        }

    // 2. surface + biomes
    const rng = new Random(hash2(this.seed, cx, cz));
    const heights = new Int16Array(256);
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = wx0 + lx, wz = wz0 + lz;
        let sh = 0;
        for (let y = 250; y > 0; y--) if (blocks[idx(lx, y, lz)] === B.STONE) { sh = y; break; }
        heights[lz * 16 + lx] = sh;
        const p = this.params(wx, wz);
        const biome = this.biomeAt(wx, wz, sh, p);
        biomes[lz * 16 + lx] = biome;
        const top = this.topBlock(biome, sh, wx, wz);
        const depth = 3 + (rng.next() < 0.5 ? 1 : 0) + (this.surf.noise2(wx / 8, wz / 8) > 0.3 ? 1 : 0);
        if ((biome === BIOME.BADLANDS || biome === BIOME.WOODED_BADLANDS) && sh >= SEA_LEVEL - 1) {
          // badlands: a skin of red sand (or the plateau's soil), then the terracotta bands down the slopes
          const off = Math.round(this.bandNoise.noise2(wx / 64, wz / 64) * 2);
          for (let y = sh; y > Math.max(1, sh - 50); y--) {
            const i = idx(lx, y, lz);
            if (blocks[i] !== B.STONE) { if (y < sh - 3) break; continue; }
            if (y === sh) blocks[i] = top === STONE2.RED_SAND && sh > 80 && this.patch.noise2(wx / 6, wz / 6) > 0.3 ? this.bands[(y + off + 64) % 64] : top;
            else if (y > sh - 2 && top === STONE2.RED_SAND && sh < 80) blocks[i] = STONE2.RED_SAND;
            else if (y > 50) blocks[i] = this.bands[(y + off + 64) % 64];
          }
          blocks[idx(lx, 0, lz)] = B.BEDROCK;
          for (let y = 1; y < 5; y++) if (y <= rng.int(5)) blocks[idx(lx, y, lz)] = B.BEDROCK;
          continue;
        }
        const sandy = top === B.SAND;
        const filler = top === B.SAND ? B.SAND : top === B.GRAVEL ? B.GRAVEL : top === B.STONE ? B.STONE : B.DIRT;
        let run = -1;
        for (let y = sh; y > 0; y--) {
          const i = idx(lx, y, lz);
          const v = blocks[i];
          if (v !== B.STONE) { run = -1; continue; }
          if (run === -1) {
            // top of a solid run
            const underwater = y < SEA_LEVEL && blocks[idx(lx, y + 1, lz)] === B.WATER;
            if (y === sh) blocks[i] = underwater && top === B.GRASS ? B.DIRT : top;
            else blocks[i] = y > SEA_LEVEL + 20 && top === B.STONE ? B.STONE : underwater ? B.DIRT : top === B.SAND ? B.SAND : B.GRASS === top || top === B.PODZOL || top === B.COARSE_DIRT ? B.GRASS : top;
            if (y < SEA_LEVEL - 1 && y !== sh && blocks[i] === B.GRASS) blocks[i] = B.DIRT;
            run = depth;
          } else if (run > 0) {
            run--;
            blocks[i] = filler;
            if (run === 0 && sandy && (biome === BIOME.DESERT)) run = -2; // then sandstone
          } else if (run === -2) {
            blocks[i] = B.SANDSTONE;
            if (rng.next() < 0.3) run = 0;
          }
        }
        // clay patches in shallow water
        if (sh < SEA_LEVEL && sh > SEA_LEVEL - 6 && this.patch.noise2(wx / 7 + 40, wz / 7) > 0.55) {
          for (let y = sh; y > sh - 2; y--) blocks[idx(lx, y, lz)] = B.CLAY;
        }
        // bedrock
        blocks[idx(lx, 0, lz)] = B.BEDROCK;
        for (let y = 1; y < 5; y++) if (y <= rng.int(5)) blocks[idx(lx, y, lz)] = B.BEDROCK;
      }

    // 3. caves
    this.carveCaves(cx, cz, blocks);
    this.carveRavines(cx, cz, blocks);

    // 4. ores & stone variants
    const oreRng = new Random(hash2(this.seed ^ 0x0de5, cx, cz));
    const vein = (b: number, size: number, count: number, minY: number, maxY: number) => {
      for (let i = 0; i < count; i++) this.genMinable(oreRng, blocks, b, size, oreRng.int(16), minY + oreRng.int(maxY - minY), oreRng.int(16));
    };
    vein(B.DIRT, 33, 10, 0, 160);
    vein(B.GRAVEL, 33, 8, 0, 160);
    vein(B.GRANITE, 33, 10, 0, 80);
    vein(B.DIORITE, 33, 10, 0, 80);
    vein(B.ANDESITE, 33, 10, 0, 80);
    vein(B.COAL_ORE, 17, 20, 0, 128);
    vein(B.IRON_ORE, 9, 20, 0, 64);
    vein(B.GOLD_ORE, 9, 2, 0, 32);
    vein(B.REDSTONE_ORE, 8, 8, 0, 16);
    vein(B.DIAMOND_ORE, 8, 1, 0, 16);
    vein(B.LAPIS_ORE, 7, 1, 0, 32);
    const centreBiome = biomes[8 * 16 + 8];
    if (centreBiome === BIOME.MOUNTAINS) {
      const n = 3 + oreRng.int(6);
      for (let i = 0; i < n; i++) {
        const x = oreRng.int(16), y = 4 + oreRng.int(28), z = oreRng.int(16);
        if (blocks[idx(x, y, z)] === B.STONE) blocks[idx(x, y, z)] = B.EMERALD_ORE;
      }
    }

    // 5. dungeons (rare)
    this.dungeon(cx, cz, blocks);

    // 6. decoration
    const set: Setter = (x, y, z, v, force) => {
      const lx = x - wx0, lz = z - wz0;
      if (lx < 0 || lz < 0 || lx > 15 || lz > 15 || y < 1 || y >= CHUNK_H) return;
      const i = idx(lx, y, lz);
      const cur = blocks[i] & 0xfff;
      if (force || cur === B.AIR || BLOCKS[cur].replaceable && cur !== B.WATER && cur !== B.LAVA || (isLeaves(cur) && !isLeaves(v & 0xfff))) blocks[i] = v;
    };
    const spawns: Spawn[] = [];
    this.nestSink = (x, y, z) => { if (x >> 4 === cx && z >> 4 === cz && y > 0 && y < CHUNK_H) spawns.push({ type: 'tile', x, y, z, data: { tile: nestTile() } }); };
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) this.placeTrees(cx + dx, cz + dz, set);
    this.nestSink = null;
    this.plants(cx, cz, blocks, biomes, heights);
    for (const v of villagesNear(this, cx, cz)) placeVillage(this, v, cx, cz, blocks, spawns);
    buildStarts(startsNear(OVERWORLD_STRUCTURES, this, cx, cz), chunkCtx(blocks, cx, cz, spawns));
    this.snowAndIce(blocks, biomes);
    buildStrongholds(this.seed, cx, cz, (x, y, z) => blocks[idx(x - wx0, y, z - wz0)], (x, y, z, v) => { blocks[idx(x - wx0, y, z - wz0)] = v; });
    return { blocks, biomes, spawns };
  }

  // ------------------------------------------------------------------ caves (port of the classic carver)
  private carveCaves(cx: number, cz: number, blocks: Uint16Array) {
    const range = 8;
    for (let x = cx - range; x <= cx + range; x++)
      for (let z = cz - range; z <= cz + range; z++) {
        const r = new Random(hash2(this.seed ^ 0xcafe, x, z));
        let n = r.int(r.int(r.int(15) + 1) + 1);
        if (r.int(7) !== 0) n = 0;
        for (let i = 0; i < n; i++) {
          const px = x * 16 + r.int(16), py = r.int(r.int(120) + 8), pz = z * 16 + r.int(16);
          let branches = 1;
          if (r.int(4) === 0) {
            this.tunnel(r.nextU32(), cx, cz, blocks, px, py, pz, 1 + r.next() * 6, 0, 0, -1, -1, 0.5);
            branches += r.int(4);
          }
          for (let j = 0; j < branches; j++) {
            const yaw = r.next() * Math.PI * 2;
            const pitch = ((r.next() - 0.5) * 2) / 8;
            let width = r.next() * 2 + r.next();
            if (r.int(10) === 0) width *= r.next() * r.next() * 3 + 1;
            this.tunnel(r.nextU32(), cx, cz, blocks, px, py, pz, width, yaw, pitch, 0, 0, 1);
          }
        }
      }
  }

  private tunnel(seed: number, cx: number, cz: number, blocks: Uint16Array, x: number, y: number, z: number, width: number, yaw: number, pitch: number, start: number, end: number, vScale: number) {
    const centerX = cx * 16 + 8, centerZ = cz * 16 + 8;
    let yawV = 0, pitchV = 0;
    const r = new Random(seed);
    if (end <= 0) {
      const maxLen = 8 * 16 - 16;
      end = maxLen - r.int(maxLen / 4);
    }
    let room = false;
    if (start === -1) { start = end / 2; room = true; }
    const split = r.int(end / 2) + end / 4;
    const steep = r.int(6) === 0;
    for (; start < end; start++) {
      const hr = 1.5 + Math.sin((start * Math.PI) / end) * width;
      const vr = hr * vScale;
      const cp = Math.cos(pitch);
      x += Math.cos(yaw) * cp;
      y += Math.sin(pitch);
      z += Math.sin(yaw) * cp;
      pitch *= steep ? 0.92 : 0.7;
      pitch += pitchV * 0.1;
      yaw += yawV * 0.1;
      pitchV *= 0.9;
      yawV *= 0.75;
      pitchV += (r.next() - r.next()) * r.next() * 2;
      yawV += (r.next() - r.next()) * r.next() * 4;
      if (!room && start === Math.floor(split) && width > 1) {
        this.tunnel(r.nextU32(), cx, cz, blocks, x, y, z, r.next() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, start, end, 1);
        this.tunnel(r.nextU32(), cx, cz, blocks, x, y, z, r.next() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, start, end, 1);
        return;
      }
      if (!room && r.int(4) === 0) continue;
      const dx = x - centerX, dz = z - centerZ, rem = end - start, maxR = width + 18;
      if (dx * dx + dz * dz - rem * rem > maxR * maxR) return;
      if (x < centerX - 16 - hr * 2 || z < centerZ - 16 - hr * 2 || x > centerX + 16 + hr * 2 || z > centerZ + 16 + hr * 2) continue;
      this.carveBlob(cx, cz, blocks, x, y, z, hr, vr, true);
      if (room) break;
    }
  }

  private carveBlob(cx: number, cz: number, blocks: Uint16Array, x: number, y: number, z: number, hr: number, vr: number, floorCut: boolean) {
    const x0 = Math.max(0, Math.floor(x - hr) - cx * 16 - 1), x1 = Math.min(16, Math.floor(x + hr) - cx * 16 + 1);
    const y0 = Math.max(1, Math.floor(y - vr) - 1), y1 = Math.min(CHUNK_H - 8, Math.floor(y + vr) + 1);
    const z0 = Math.max(0, Math.floor(z - hr) - cz * 16 - 1), z1 = Math.min(16, Math.floor(z + hr) - cz * 16 + 1);
    if (x0 >= x1 || z0 >= z1 || y0 >= y1) return;
    // don't break into water bodies
    for (let lx = x0; lx < x1; lx++)
      for (let lz = z0; lz < z1; lz++)
        for (let yy = y1 + 1; yy >= y0 - 1; yy--) {
          if (yy < 0 || yy >= CHUNK_H) continue;
          const v = blocks[idx(lx, yy, lz)];
          if (v === B.WATER) return;
          if (yy !== y0 - 1 && lx !== x0 && lx !== x1 - 1 && lz !== z0 && lz !== z1 - 1) yy = y0;
        }
    for (let lx = x0; lx < x1; lx++) {
      const ddx = (lx + cx * 16 + 0.5 - x) / hr;
      for (let lz = z0; lz < z1; lz++) {
        const ddz = (lz + cz * 16 + 0.5 - z) / hr;
        if (ddx * ddx + ddz * ddz >= 1) continue;
        let grassAbove = false;
        for (let yy = y1 - 1; yy >= y0; yy--) {
          const ddy = (yy + 0.5 - y) / vr;
          if (floorCut && ddy <= -0.7) continue;
          if (ddx * ddx + ddy * ddy + ddz * ddz >= 1) continue;
          const i = idx(lx, yy, lz);
          const b = blocks[i];
          if (b === B.GRASS) grassAbove = true;
          if (b === B.STONE || b === B.DIRT || b === B.GRASS || b === B.GRAVEL || b === B.SANDSTONE || b === B.PODZOL || b === B.COARSE_DIRT || b === B.CLAY || b === B.GRANITE || b === B.DIORITE || b === B.ANDESITE) {
            // avoid exposing sand to collapse above
            if (yy < 11) blocks[i] = B.LAVA;
            else {
              blocks[i] = B.AIR;
              if (grassAbove && yy > 0 && blocks[idx(lx, yy - 1, lz)] === B.DIRT) blocks[idx(lx, yy - 1, lz)] = B.GRASS;
            }
          }
        }
      }
    }
  }

  private carveRavines(cx: number, cz: number, blocks: Uint16Array) {
    const range = 8;
    for (let x = cx - range; x <= cx + range; x++)
      for (let z = cz - range; z <= cz + range; z++) {
        const r = new Random(hash2(this.seed ^ 0x7a1e, x, z));
        if (r.int(60) !== 0) continue;
        const px = x * 16 + r.int(16), py = r.int(r.int(40) + 8) + 20, pz = z * 16 + r.int(16);
        const yaw = r.next() * Math.PI * 2, pitch = ((r.next() - 0.5) * 2) / 8;
        const width = (r.next() * 2 + r.next()) * 2;
        this.ravine(r.nextU32(), cx, cz, blocks, px, py, pz, width, yaw, pitch, 3);
      }
  }

  private ravine(seed: number, cx: number, cz: number, blocks: Uint16Array, x: number, y: number, z: number, width: number, yaw: number, pitch: number, vScale: number) {
    const r = new Random(seed);
    const centerX = cx * 16 + 8, centerZ = cz * 16 + 8;
    const end = 112 - r.int(28);
    let yawV = 0, pitchV = 0;
    const mult: number[] = [];
    let f = 1;
    for (let i = 0; i < 256; i++) { if (i === 0 || r.int(3) === 0) f = 1 + r.next() * r.next(); mult[i] = f * f; }
    for (let s = 0; s < end; s++) {
      let hr = 1.5 + Math.sin((s * Math.PI) / end) * width;
      let vr = hr * vScale;
      hr *= r.next() * 0.25 + 0.75;
      vr *= r.next() * 0.25 + 0.75;
      const cp = Math.cos(pitch);
      x += Math.cos(yaw) * cp; y += Math.sin(pitch); z += Math.sin(yaw) * cp;
      pitch *= 0.7; pitch += pitchV * 0.05; yaw += yawV * 0.05;
      pitchV *= 0.8; yawV *= 0.5;
      pitchV += (r.next() - r.next()) * r.next() * 2;
      yawV += (r.next() - r.next()) * r.next() * 4;
      if (r.int(4) === 0) continue;
      if (x < centerX - 16 - hr * 2 || z < centerZ - 16 - hr * 2 || x > centerX + 16 + hr * 2 || z > centerZ + 16 + hr * 2) continue;
      // ravines: carve an ellipse whose horizontal radius varies with height
      const x0 = Math.max(0, Math.floor(x - hr) - cx * 16 - 1), x1 = Math.min(16, Math.floor(x + hr) - cx * 16 + 1);
      const y0 = Math.max(1, Math.floor(y - vr) - 1), y1 = Math.min(CHUNK_H - 8, Math.floor(y + vr) + 1);
      const z0 = Math.max(0, Math.floor(z - hr) - cz * 16 - 1), z1 = Math.min(16, Math.floor(z + hr) - cz * 16 + 1);
      for (let lx = x0; lx < x1; lx++) {
        const ddx = (lx + cx * 16 + 0.5 - x) / hr;
        for (let lz = z0; lz < z1; lz++) {
          const ddz = (lz + cz * 16 + 0.5 - z) / hr;
          if (ddx * ddx + ddz * ddz >= 1) continue;
          for (let yy = y1 - 1; yy >= y0; yy--) {
            const ddy = (yy + 0.5 - y) / vr;
            if ((ddx * ddx + ddz * ddz) * mult[yy] + (ddy * ddy) / 6 >= 1) continue;
            const i = idx(lx, yy, lz);
            const b = blocks[i];
            if (b === B.WATER) continue;
            if (b === B.STONE || b === B.DIRT || b === B.GRASS || b === B.GRAVEL || b === B.GRANITE || b === B.DIORITE || b === B.ANDESITE || b === B.SANDSTONE) blocks[i] = yy < 11 ? B.LAVA : B.AIR;
          }
        }
      }
    }
  }

  private genMinable(r: Random, blocks: Uint16Array, ore: number, size: number, x: number, y: number, z: number) {
    const a = r.next() * Math.PI;
    const x1 = x + (Math.sin(a) * size) / 8, x2 = x - (Math.sin(a) * size) / 8;
    const z1 = z + (Math.cos(a) * size) / 8, z2 = z - (Math.cos(a) * size) / 8;
    const y1 = y + r.int(3) - 2, y2 = y + r.int(3) - 2;
    for (let i = 0; i < size; i++) {
      const cx = x1 + ((x2 - x1) * i) / size, cy = y1 + ((y2 - y1) * i) / size, cz = z1 + ((z2 - z1) * i) / size;
      const rr = (r.next() * size) / 16;
      const hr = (Math.sin((i * Math.PI) / size) + 1) * rr + 1;
      const xa = Math.floor(cx - hr / 2), xb = Math.floor(cx + hr / 2);
      const ya = Math.floor(cy - hr / 2), yb = Math.floor(cy + hr / 2);
      const za = Math.floor(cz - hr / 2), zb = Math.floor(cz + hr / 2);
      for (let bx = xa; bx <= xb; bx++) {
        if (bx < 0 || bx > 15) continue;
        const dx = (bx + 0.5 - cx) / (hr / 2);
        if (dx * dx >= 1) continue;
        for (let by = ya; by <= yb; by++) {
          if (by < 1 || by >= CHUNK_H) continue;
          const dy = (by + 0.5 - cy) / (hr / 2);
          if (dx * dx + dy * dy >= 1) continue;
          for (let bz = za; bz <= zb; bz++) {
            if (bz < 0 || bz > 15) continue;
            const dz = (bz + 0.5 - cz) / (hr / 2);
            if (dx * dx + dy * dy + dz * dz >= 1) continue;
            const i2 = idx(bx, by, bz);
            if (blocks[i2] === B.STONE) blocks[i2] = ore;
          }
        }
      }
    }
  }

  private dungeon(cx: number, cz: number, blocks: Uint16Array) {
    const r = new Random(hash2(this.seed ^ 0xd0d0, cx, cz));
    for (let attempt = 0; attempt < 4; attempt++) {
      const x = 4 + r.int(8), y = 12 + r.int(40), z = 4 + r.int(8);
      const w = 2 + r.int(2), d = 2 + r.int(2);
      if (x - w - 1 < 0 || x + w + 1 > 15 || z - d - 1 < 0 || z + d + 1 > 15) continue;
      // needs solid floor/ceiling and 1-5 openings in walls
      let ok = true, holes = 0;
      for (let dx = -w - 1; dx <= w + 1 && ok; dx++)
        for (let dz = -d - 1; dz <= d + 1 && ok; dz++) {
          const floor = blocks[idx(x + dx, y - 1, z + dz)], ceil = blocks[idx(x + dx, y + 4, z + dz)];
          if (!OPAQUE[floor] || !OPAQUE[ceil]) ok = false;
          if ((Math.abs(dx) === w + 1 || Math.abs(dz) === d + 1) && blocks[idx(x + dx, y, z + dz)] === B.AIR && blocks[idx(x + dx, y + 1, z + dz)] === B.AIR) holes++;
        }
      if (!ok || holes < 1 || holes > 5) continue;
      for (let dx = -w - 1; dx <= w + 1; dx++)
        for (let dz = -d - 1; dz <= d + 1; dz++)
          for (let dy = -1; dy <= 4; dy++) {
            const i = idx(x + dx, y + dy, z + dz);
            const wall = Math.abs(dx) === w + 1 || Math.abs(dz) === d + 1 || dy === -1 || dy === 4;
            if (!wall) blocks[i] = B.AIR;
            else if (OPAQUE[blocks[i]]) blocks[i] = dy === -1 && r.int(4) !== 0 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE;
          }
      blocks[idx(x, y, z)] = B.SPAWNER;
      // a chest against a wall
      const cxw = x + (r.bool() ? w : -w);
      blocks[idx(cxw, y, z)] = pack(B.CHEST, r.int(4));
      return;
    }
  }

  // ------------------------------------------------------------------ trees
  /** Deterministic list of trees for a chunk; each tree writes via `set`, which clips to the target chunk. */
  /** Where generate() collects the bee nests trees put in the chunk (their bees are tile hints). */
  private nestSink: ((x: number, y: number, z: number) => void) | null = null;
  /** Whether a surface structure claims this column (trees don't grow there: vanilla places structures first). */
  private onStructure(x: number, z: number) {
    for (const st of startsNear(SURFACE_STRUCTURES, this, x >> 4, z >> 4))
      if (x >= st.box.x0 - 3 && x <= st.box.x1 + 3 && z >= st.box.z0 - 3 && z <= st.box.z1 + 3) return true;
    return false;
  }

  private placeTrees(cx: number, cz: number, set: Setter) {
    const r = new Random(hash2(this.seed ^ 0x7eee, cx, cz));
    const cp = this.params(cx * 16 + 8, cz * 16 + 8);
    const csh = this.surfaceY(cx * 16 + 8, cz * 16 + 8);
    const cb = this.biomeAt(cx * 16 + 8, cz * 16 + 8, csh, cp);
    const dens = BIOMES[cb].treeDensity;
    let count = Math.floor(dens * 9);
    if (r.next() < (dens * 9) % 1) count++;
    if (cb === BIOME.PLAINS && r.int(10) === 0) count = 1;
    for (let i = 0; i < count; i++) {
      const x = cx * 16 + r.int(16), z = cz * 16 + r.int(16);
      const treeSeed = r.nextU32();
      const sh = this.surfaceY(x, z);
      if (sh < SEA_LEVEL) continue;
      const p = this.params(x, z);
      const biome = this.biomeAt(x, z, sh, p);
      const top = this.topBlock(biome, sh, x, z);
      if (top !== B.GRASS && top !== B.PODZOL && top !== B.COARSE_DIRT && !(top === B2.MYCELIUM && biome === BIOME.MUSHROOM_FIELDS)) continue;
      if (this.caveAtSurface(x, sh, z)) continue;
      if (this.onStructure(x, z)) continue;
      const tr = new Random(treeSeed);
      const y = sh + 1;
      switch (biome) {
        case BIOME.JUNGLE: case BIOME.JUNGLE_EDGE: case BIOME.BAMBOO_JUNGLE: {
          const k = tr.int(10);
          if (k === 0 && biome === BIOME.JUNGLE) megaJungleTree(tr, x, y, z, set);
          else if (k < 5) jungleBush(tr, x, y, z, set);
          else if (k < 6) WorldGen.bigOak(tr, x, y, z, set);
          else jungleTree(tr, x, y, z, set);
          break;
        }
        case BIOME.DARK_FOREST: {
          const k = tr.int(12);
          if (k < 2) hugeMushroom(tr, x, y, z, set, k === 0);
          else if (k < 3) WorldGen.oakTree(tr, x, y, z, set, B.BIRCH_LOG, B.BIRCH_LEAVES, 5);
          else darkOakTree(tr, x, y, z, set);
          break;
        }
        case BIOME.GIANT_TREE_TAIGA:
          if (tr.int(3) === 0) megaSpruceTree(tr, x, y, z, set);
          else if (tr.int(3) === 0) WorldGen.pineTree(tr, x, y, z, set);
          else WorldGen.spruceTree(tr, x, y, z, set);
          break;
        case BIOME.SAVANNA: case BIOME.SAVANNA_PLATEAU:
          if (tr.int(5)) acaciaTree(tr, x, y, z, set);
          else WorldGen.oakTree(tr, x, y, z, set, B.OAK_LOG, B.OAK_LEAVES, 4);
          break;
        case BIOME.TALL_BIRCH_FOREST:
          WorldGen.oakTree(tr, x, y, z, set, B.BIRCH_LOG, B.BIRCH_LEAVES, 8);
          break;
        case BIOME.MUSHROOM_FIELDS:
          hugeMushroom(tr, x, y, z, set, tr.bool());
          break;
        case BIOME.SNOWY_MOUNTAINS: case BIOME.GRAVELLY_MOUNTAINS:
          if (tr.bool()) WorldGen.spruceTree(tr, x, y, z, set);
          else WorldGen.oakTree(tr, x, y, z, set, B.OAK_LOG, B.OAK_LEAVES, 4);
          break;
        case BIOME.TAIGA:
        case BIOME.SNOWY_TAIGA:
        case BIOME.SNOWY_PLAINS:
          if (tr.int(3) === 0) WorldGen.pineTree(tr, x, y, z, set);
          else WorldGen.spruceTree(tr, x, y, z, set);
          break;
        case BIOME.BIRCH_FOREST:
          WorldGen.oakTree(tr, x, y, z, set, B.BIRCH_LOG, B.BIRCH_LEAVES, 5);
          break;
        case BIOME.MOUNTAINS:
          if (tr.bool()) WorldGen.spruceTree(tr, x, y, z, set);
          else WorldGen.oakTree(tr, x, y, z, set, B.OAK_LOG, B.OAK_LEAVES, 4);
          break;
        case BIOME.SWAMP:
          WorldGen.oakTree(tr, x, y, z, set, B.OAK_LOG, B.OAK_LEAVES, 4, true);
          break;
        default:
          if (biome === BIOME.FOREST && tr.int(5) === 0) WorldGen.oakTree(tr, x, y, z, set, B.BIRCH_LOG, B.BIRCH_LEAVES, 5);
          else if (tr.int(10) === 0) WorldGen.bigOak(tr, x, y, z, set);
          else WorldGen.oakTree(tr, x, y, z, set, B.OAK_LOG, B.OAK_LEAVES, 4);
      }
      // bee nests hang off the trunks of plains and flower-forest trees (1.15: 5% and 2%; rare in forests)
      const nestOdds = biome === BIOME.PLAINS || biome === BIOME.SUNFLOWER_PLAINS ? 0.05 : biome === BIOME.FLOWER_FOREST ? 0.02 : biome === BIOME.FOREST || biome === BIOME.BIRCH_FOREST ? 0.002 : 0;
      if (nestOdds && tr.next() < nestOdds) {
        set(x, y + 1, z + 1, pack(B2.BEE_NEST, 0), true);
        this.nestSink?.(x, y + 1, z + 1);
      }
    }
  }

  /** Cheap check so trees don't float over cave mouths (uses nothing but deterministic noise). */
  private caveAtSurface(_x: number, _y: number, _z: number) {
    return false;
  }

  static oakTree(r: Random, x: number, y: number, z: number, set: Setter, log: number, leaves: number, minH: number, wide = false) {
    const h = r.int(3) + minH;
    set(x, y - 1, z, B.DIRT, true);
    for (let yy = y + h - 3; yy <= y + h; yy++) {
      const dy = yy - (y + h);
      const rad = (wide ? 2 : 1) - Math.trunc(dy / 2);
      for (let dx = -rad; dx <= rad; dx++)
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && (r.int(2) === 0 || dy === 0)) continue;
          set(x + dx, yy, z + dz, leaves);
        }
    }
    for (let i = 0; i < h; i++) set(x, y + i, z, log, true);
  }

  static bigOak(r: Random, x: number, y: number, z: number, set: Setter) {
    const h = 8 + r.int(5);
    set(x, y - 1, z, B.DIRT, true);
    const blob = (bx: number, by: number, bz: number, rad: number) => {
      for (let dy = 0; dy < 4; dy++) {
        const rr = dy === 0 || dy === 3 ? rad - 1 : rad;
        for (let dx = -rr; dx <= rr; dx++)
          for (let dz = -rr; dz <= rr; dz++)
            if (dx * dx + dz * dz <= rr * rr + 1) set(bx + dx, by + dy, bz + dz, B.OAK_LEAVES);
      }
    };
    const branches = 2 + r.int(3);
    for (let i = 0; i < branches; i++) {
      const a = r.next() * Math.PI * 2, len = 2 + r.int(3), by = y + Math.floor(h * 0.5) + r.int(Math.floor(h * 0.4));
      let bx = x, bz = z;
      for (let k = 1; k <= len; k++) {
        bx = x + Math.round(Math.cos(a) * k); bz = z + Math.round(Math.sin(a) * k);
        set(bx, by + Math.floor(k / 2), bz, pack(B.OAK_LOG, Math.abs(Math.cos(a)) > 0.7 ? 1 : 2), true);
      }
      blob(bx, by + Math.floor(len / 2), bz, 2);
    }
    blob(x, y + h - 2, z, 2);
    for (let i = 0; i < h; i++) set(x, y + i, z, B.OAK_LOG, true);
  }

  static spruceTree(r: Random, x: number, y: number, z: number, set: Setter) {
    const h = r.int(4) + 6;
    const bare = 1 + r.int(2);
    const maxR = 2 + r.int(2);
    let rad = r.int(2), target = 1, reset = false;
    set(x, y - 1, z, B.DIRT, true);
    for (let l = 0; l <= h - bare; l++) {
      const yy = y + h - l;
      for (let dx = -rad; dx <= rad; dx++)
        for (let dz = -rad; dz <= rad; dz++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && rad > 0) continue;
          set(x + dx, yy, z + dz, B.SPRUCE_LEAVES);
        }
      if (rad >= target) {
        rad = reset ? 1 : 0;
        reset = true;
        if (++target > maxR) target = maxR;
      } else rad++;
    }
    set(x, y + h + 1, z, B.SPRUCE_LEAVES);
    for (let i = 0; i < h; i++) set(x, y + i, z, B.SPRUCE_LOG, true);
  }

  static pineTree(r: Random, x: number, y: number, z: number, set: Setter) {
    const h = r.int(5) + 7;
    const top = h - r.int(2) - 3;
    const rad = 1 + r.int(2);
    set(x, y - 1, z, B.DIRT, true);
    let cur = 0;
    for (let yy = y + h; yy >= y + top; yy--) {
      for (let dx = -cur; dx <= cur; dx++)
        for (let dz = -cur; dz <= cur; dz++) {
          if (Math.abs(dx) === cur && Math.abs(dz) === cur && cur > 0) continue;
          set(x + dx, yy, z + dz, B.SPRUCE_LEAVES);
        }
      if (cur >= 1 && yy === y + top + 1) cur--;
      else if (cur < rad) cur++;
    }
    for (let i = 0; i < h; i++) set(x, y + i, z, B.SPRUCE_LOG, true);
  }

  // ------------------------------------------------------------------ plants
  private plants(cx: number, cz: number, blocks: Uint16Array, biomes: Uint8Array, heights: Int16Array) {
    const r = new Random(hash2(this.seed ^ 0x9a55, cx, cz));
    const topAt = (lx: number, lz: number) => {
      for (let y = Math.min(250, heights[lz * 16 + lx] + 30); y > 1; y--) {
        const b = blocks[idx(lx, y, lz)] & 0xfff;
        if (b !== B.AIR && !isLeaves(b)) return y;
      }
      return 0;
    };
    const place = (lx: number, lz: number, block: number, on: number[]) => {
      const y = topAt(lx, lz);
      const below = blocks[idx(lx, y, lz)] & 0xfff;
      if (!on.includes(below)) return false;
      if (blocks[idx(lx, y + 1, lz)] !== B.AIR) return false;
      blocks[idx(lx, y + 1, lz)] = block;
      return true;
    };
    /** A two-block plant (sunflowers, lilacs, tall grass...) on grass. */
    const place2 = (lx: number, lz: number, block: number) => {
      const y = topAt(lx, lz);
      if ((blocks[idx(lx, y, lz)] & 0xfff) !== B.GRASS || blocks[idx(lx, y + 1, lz)] !== B.AIR || blocks[idx(lx, y + 2, lz)] !== B.AIR || y + 2 >= CHUNK_H) return false;
      blocks[idx(lx, y + 1, lz)] = pack(block, 0);
      blocks[idx(lx, y + 2, lz)] = pack(block, 8);
      return true;
    };
    const biome = biomes[8 * 16 + 8];
    // swamps: shallow pools wherever the ground sits at the water line (vanilla's swamp surface noise)
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        if (biomes[lz * 16 + lx] !== BIOME.SWAMP) continue;
        const y = topAt(lx, lz);
        if (y < SEA_LEVEL - 1 || y > SEA_LEVEL || blocks[idx(lx, y + 1, lz)] !== B.AIR) continue;
        if (this.patch.noise2((cx * 16 + lx) / 9, (cz * 16 + lz) / 9) < 0.05) continue;
        const t = blocks[idx(lx, y, lz)] & 0xfff;
        if (t !== B.GRASS && t !== B.DIRT) continue;
        for (let k = y; k <= SEA_LEVEL; k++) blocks[idx(lx, k, lz)] = B.WATER;
        blocks[idx(lx, y - 1, lz)] = B.DIRT;
      }
    const grassSoil = [B.GRASS, B.PODZOL, B.COARSE_DIRT];
    let grassCount = 0, flowerCount = 0, doubles = 0;
    let doubleTypes: number[] = [B2.LILAC, B2.ROSE_BUSH, B2.PEONY];
    switch (biome) {
      case BIOME.PLAINS: grassCount = 40; flowerCount = 3; doubles = r.int(4) === 0 ? 2 : 0; doubleTypes = [B2.TALL_GRASS2]; break;
      case BIOME.SUNFLOWER_PLAINS: grassCount = 40; flowerCount = 3; doubles = 10; doubleTypes = [B2.SUNFLOWER]; break;
      case BIOME.SAVANNA: case BIOME.SAVANNA_PLATEAU: grassCount = 50; doubles = 7; doubleTypes = [B2.TALL_GRASS2]; break;
      case BIOME.FOREST: grassCount = 12; flowerCount = 2; doubles = r.int(2) ? 3 : 0; break;
      case BIOME.FLOWER_FOREST: grassCount = 10; flowerCount = 14; doubles = 5; break;
      case BIOME.BIRCH_FOREST: case BIOME.TALL_BIRCH_FOREST: grassCount = 12; flowerCount = 2; doubles = r.int(3) === 0 ? 2 : 0; break;
      case BIOME.DARK_FOREST: grassCount = 6; flowerCount = 1; doubles = r.int(3) === 0 ? 3 : 0; break;
      case BIOME.TAIGA: case BIOME.SNOWY_TAIGA: grassCount = 14; doubles = r.int(3) === 0 ? 3 : 0; doubleTypes = [B2.LARGE_FERN]; break;
      case BIOME.GIANT_TREE_TAIGA: grassCount = 20; doubles = 6; doubleTypes = [B2.LARGE_FERN]; break;
      case BIOME.JUNGLE: case BIOME.JUNGLE_EDGE: case BIOME.BAMBOO_JUNGLE: grassCount = 25; flowerCount = 1; doubles = 4; doubleTypes = [B2.LARGE_FERN, B2.TALL_GRASS2]; break;
      case BIOME.MOUNTAINS: case BIOME.GRAVELLY_MOUNTAINS: grassCount = 6; break;
      case BIOME.SWAMP: grassCount = 8; flowerCount = 1; break;
      case BIOME.SNOWY_PLAINS: grassCount = 2; break;
      case BIOME.RIVER: case BIOME.BEACH: grassCount = 3; break;
      case BIOME.WOODED_BADLANDS: grassCount = 4; break;
    }
    const fernish = biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA || biome === BIOME.GIANT_TREE_TAIGA || biome === BIOME.JUNGLE;
    for (let i = 0; i < grassCount; i++) place(r.int(16), r.int(16), fernish && r.int(3) > 0 ? B.FERN : B.TALL_GRASS, grassSoil);
    // flower patches (the kinds each biome has, vanilla 1.16)
    const tulips = [B2.RED_TULIP, B2.ORANGE_TULIP, B2.WHITE_TULIP, B2.PINK_TULIP];
    const flowerTypes = biome === BIOME.FLOWER_FOREST ? [B.DANDELION, B.POPPY, B.ALLIUM, B2.AZURE_BLUET, B.CORNFLOWER, B.OXEYE_DAISY, B2.LILY_OF_THE_VALLEY, ...tulips]
      : biome === BIOME.PLAINS || biome === BIOME.SUNFLOWER_PLAINS ? [B.DANDELION, B.POPPY, B2.AZURE_BLUET, B.OXEYE_DAISY, B.CORNFLOWER, ...tulips]
      : biome === BIOME.SWAMP ? [B2.BLUE_ORCHID]
      : biome === BIOME.FOREST || biome === BIOME.BIRCH_FOREST || biome === BIOME.DARK_FOREST ? [B.DANDELION, B.POPPY, B2.LILY_OF_THE_VALLEY]
      : [B.DANDELION, B.POPPY];
    for (let i = 0; i < flowerCount; i++) {
      const f = flowerTypes[r.int(flowerTypes.length)];
      const px = r.int(16), pz = r.int(16);
      for (let k = 0; k < 8; k++) {
        const lx = px + r.int(5) - 2, lz = pz + r.int(5) - 2;
        if (lx >= 0 && lz >= 0 && lx < 16 && lz < 16) place(lx, lz, f, [B.GRASS]);
      }
    }
    for (let i = 0; i < doubles; i++) place2(r.int(16), r.int(16), doubleTypes[r.int(doubleTypes.length)]);
    // mushrooms in dark/cold places; everywhere on mushroom islands
    if ((biome === BIOME.TAIGA || biome === BIOME.SWAMP || biome === BIOME.FOREST || biome === BIOME.DARK_FOREST || biome === BIOME.GIANT_TREE_TAIGA) && r.int(4) === 0) place(r.int(16), r.int(16), r.bool() ? B.BROWN_MUSHROOM : B.RED_MUSHROOM, [B.GRASS, B.PODZOL]);
    if (biome === BIOME.MUSHROOM_FIELDS) for (let i = 0; i < 3; i++) place(r.int(16), r.int(16), r.bool() ? B.BROWN_MUSHROOM : B.RED_MUSHROOM, [B2.MYCELIUM]);
    // desert and badlands
    if (biome === BIOME.DESERT || biome === BIOME.BADLANDS) {
      const sands = [B.SAND, STONE2.RED_SAND];
      for (let i = 0; i < (biome === BIOME.BADLANDS ? 5 : 2); i++) place(r.int(16), r.int(16), B.DEAD_BUSH, [...sands, ...TERRACOTTA_COLORS, B.TERRACOTTA]);
      for (let i = 0; i < (biome === BIOME.BADLANDS ? 5 : 3); i++) {
        const lx = r.int(16), lz = r.int(16);
        if (place(lx, lz, B.CACTUS, sands)) {
          const y = topAt(lx, lz);
          const h = r.int(3);
          const ok = (x: number, z: number) => x < 0 || z < 0 || x > 15 || z > 15 || !SOLIDISH(blocks[idx(x, y, z)]);
          if (ok(lx - 1, lz) && ok(lx + 1, lz) && ok(lx, lz - 1) && ok(lx, lz + 1)) {
            for (let k = 1; k <= h; k++) if (blocks[idx(lx, y + k, lz)] === B.AIR) blocks[idx(lx, y + k, lz)] = B.CACTUS;
          } else blocks[idx(lx, y, lz)] = B.AIR;
        }
      }
    }
    if (biome === BIOME.SAVANNA || biome === BIOME.BEACH) if (r.int(3) === 0) place(r.int(16), r.int(16), B.DEAD_BUSH, [B.SAND, B.COARSE_DIRT]);
    // jungles: melons and, in bamboo jungles, bamboo; taigas: sweet berry bushes
    if ((biome === BIOME.JUNGLE || biome === BIOME.BAMBOO_JUNGLE) && r.int(3) === 0) for (let k = 0; k < 6; k++) place(r.int(16), r.int(16), B.MELON, [B.GRASS]);
    if (biome === BIOME.BAMBOO_JUNGLE || (biome === BIOME.JUNGLE && r.int(4) === 0)) {
      for (let k = 0; k < (biome === BIOME.BAMBOO_JUNGLE ? 40 : 8); k++) {
        const lx = r.int(16), lz = r.int(16), y = topAt(lx, lz);
        if (![B.GRASS, B.PODZOL, B.DIRT].includes(blocks[idx(lx, y, lz)] & 0xfff) || blocks[idx(lx, y + 1, lz)] !== B.AIR) continue;
        const h = 4 + r.int(12);
        for (let i = 1; i <= h && y + i < CHUNK_H - 1 && blocks[idx(lx, y + i, lz)] === B.AIR; i++) blocks[idx(lx, y + i, lz)] = B2.BAMBOO;
        if (biome === BIOME.BAMBOO_JUNGLE && r.bool()) blocks[idx(lx, y, lz)] = B.PODZOL;
      }
    }
    if ((biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA || biome === BIOME.GIANT_TREE_TAIGA) && r.int(5) === 0)
      for (let k = 0; k < 4; k++) place(r.int(16), r.int(16), pack(B2.SWEET_BERRY_BUSH, 2 + r.int(2)), [B.GRASS, B.PODZOL]);
    // giant tree taigas: mossy boulders
    if (biome === BIOME.GIANT_TREE_TAIGA && r.int(3) === 0) {
      const lx = 2 + r.int(12), lz = 2 + r.int(12), y = topAt(lx, lz);
      for (let k = 0; k < 3; k++) {
        const bx = lx + r.int(3) - 1, bz = lz + r.int(3) - 1, by = y + r.int(2), rad = 1 + r.int(2);
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) for (let dy = -rad; dy <= rad; dy++) {
          const px = bx + dx, pz = bz + dz, py = by + dy;
          if (px < 0 || pz < 0 || px > 15 || pz > 15 || dx * dx + dy * dy + dz * dz > rad * rad + 1) continue;
          blocks[idx(px, py, pz)] = B.MOSSY_COBBLESTONE;
        }
      }
    }
    // ice spikes: tall spikes of packed ice, now and then a huge one
    if (biome === BIOME.ICE_SPIKES && r.int(3) === 0) {
      const lx = 3 + r.int(10), lz = 3 + r.int(10), y = topAt(lx, lz);
      const huge = r.int(10) === 0, h = huge ? 30 + r.int(25) : 7 + r.int(10), base = huge ? 3 : 1 + r.int(2);
      for (let dy = -2; dy < h; dy++) {
        const rad = Math.max(0, Math.round(base * (1 - dy / h)));
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          const px = lx + dx, pz = lz + dz;
          if (px < 0 || pz < 0 || px > 15 || pz > 15 || dx * dx + dz * dz > rad * rad + 0.5 || y + dy >= CHUNK_H) continue;
          blocks[idx(px, y + dy, pz)] = B2.PACKED_ICE;
        }
      }
    }
    // sugar cane next to water
    for (let i = 0; i < 10; i++) {
      const lx = 1 + r.int(14), lz = 1 + r.int(14);
      const y = topAt(lx, lz);
      if (y !== SEA_LEVEL) continue;
      const b = blocks[idx(lx, y, lz)];
      if (b !== B.GRASS && b !== B.SAND && b !== B.DIRT) continue;
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => blocks[idx(lx + dx, y, lz + dz)] === B.WATER);
      if (!nearWater || blocks[idx(lx, y + 1, lz)] !== B.AIR) continue;
      const h = 1 + r.int(3);
      for (let k = 1; k <= h; k++) blocks[idx(lx, y + k, lz)] = B.SUGAR_CANE;
    }
    // pumpkins
    if (r.int(40) === 0 && biome !== BIOME.DESERT) {
      const px = r.int(16), pz = r.int(16);
      for (let k = 0; k < 6; k++) {
        const lx = px + r.int(5) - 2, lz = pz + r.int(5) - 2;
        if (lx >= 0 && lz >= 0 && lx < 16 && lz < 16) place(lx, lz, pack(B.PUMPKIN, r.int(4)), [B.GRASS]);
      }
    }
    // lily pads in swamps
    if (biome === BIOME.SWAMP) {
      for (let i = 0; i < 10; i++) {
        const lx = r.int(16), lz = r.int(16);
        if (blocks[idx(lx, SEA_LEVEL, lz)] === B.WATER && blocks[idx(lx, SEA_LEVEL + 1, lz)] === B.AIR) blocks[idx(lx, SEA_LEVEL + 1, lz)] = B.LILY_PAD;
      }
    }
    // the sea floor: seagrass, kelp forests (not in warm or frozen seas), coral reefs and sea pickles in warm ones
    if (isOceanBiome(biome) || biome === BIOME.RIVER || biome === BIOME.SWAMP) this.seaFloor(r, blocks, biome);
  }

  /** The sea floor's plants (vanilla 1.13): seagrass, kelp, coral reefs, sea pickles. */
  private seaFloor(r: Random, blocks: Uint16Array, biome: number) {
    const floorAt = (lx: number, lz: number) => {
      for (let y = SEA_LEVEL - 1; y > 1; y--) {
        const b = blocks[idx(lx, y, lz)];
        if (b !== B.WATER) return b !== B.AIR && blocks[idx(lx, y + 1, lz)] === B.WATER ? y : -1;
      }
      return -1;
    };
    const warm = biome === BIOME.WARM_OCEAN, frozen = biome === BIOME.FROZEN_OCEAN || biome === BIOME.DEEP_FROZEN_OCEAN;
    const grassN = warm ? 40 : biome === BIOME.RIVER || biome === BIOME.SWAMP ? 24 : 32;
    for (let i = 0; i < grassN; i++) {
      const lx = r.int(16), lz = r.int(16), y = floorAt(lx, lz);
      if (y < 0 || !OPAQUE[blocks[idx(lx, y, lz)] & 0xfff]) continue;
      if (r.int(4) === 0 && blocks[idx(lx, y + 2, lz)] === B.WATER) { blocks[idx(lx, y + 1, lz)] = pack(B2.TALL_SEAGRASS, 0); blocks[idx(lx, y + 2, lz)] = pack(B2.TALL_SEAGRASS, 8); }
      else blocks[idx(lx, y + 1, lz)] = B2.SEAGRASS;
    }
    if (!warm && !frozen && biome !== BIOME.RIVER && biome !== BIOME.SWAMP && r.int(2) === 0) {
      for (let i = 0; i < 18; i++) {
        const lx = r.int(16), lz = r.int(16), y = floorAt(lx, lz);
        if (y < 0 || !OPAQUE[blocks[idx(lx, y, lz)] & 0xfff]) continue;
        const h = 1 + r.int(Math.max(1, SEA_LEVEL - y - 2));
        for (let k = 1; k <= h; k++) {
          if (blocks[idx(lx, y + k + 1, lz)] !== B.WATER) { blocks[idx(lx, y + k, lz)] = B2.KELP; break; }
          blocks[idx(lx, y + k, lz)] = k === h ? B2.KELP : B2.KELP_PLANT;
        }
      }
    }
    if (warm) {
      // coral reefs: blobs of coral blocks with corals and fans on them
      for (let k = 0; k < 3; k++) {
        const kind = CORAL[r.int(CORAL.length)];
        const lx = 2 + r.int(12), lz = 2 + r.int(12), y = floorAt(lx, lz);
        if (y < 0) continue;
        const rad = 1 + r.int(2);
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) for (let dy = 0; dy <= rad; dy++) {
          const px = lx + dx, pz = lz + dz, py = y + dy;
          if (px < 0 || pz < 0 || px > 15 || pz > 15 || dx * dx + dz * dz + dy * dy > rad * rad + 1 || (blocks[idx(px, py, pz)] !== B.WATER && dy > 0)) continue;
          blocks[idx(px, py, pz)] = kind.block;
          if (blocks[idx(px, py + 1, pz)] === B.WATER && r.int(3) === 0) blocks[idx(px, py + 1, pz)] = pack(r.bool() ? kind.plant : kind.fan, 8);
        }
      }
      for (let k = 0; k < 4; k++) {
        const lx = r.int(16), lz = r.int(16), y = floorAt(lx, lz);
        if (y >= 0 && OPAQUE[blocks[idx(lx, y, lz)] & 0xfff]) blocks[idx(lx, y + 1, lz)] = pack(B2.SEA_PICKLE, 4 | r.int(4));
      }
    }
  }

  private snowAndIce(blocks: Uint16Array, biomes: Uint8Array) {
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const biome = BIOMES[biomes[lz * 16 + lx]];
        let y = 250;
        while (y > 0 && blocks[idx(lx, y, lz)] === B.AIR) y--;
        const top = blocks[idx(lx, y, lz)] & 0xfff;
        const high = y > 150 + ((lx * 7 + lz * 13) % 5);
        if (!biome.cold && !high) continue;
        if (top === B.WATER) { if (biome.cold) blocks[idx(lx, y, lz)] = B.ICE; }
        else if (BLOCKS[top].opaque || isLeaves(top)) { if (y + 1 < CHUNK_H) blocks[idx(lx, y + 1, lz)] = B.SNOW; }
        else if (top === B.TALL_GRASS || top === B.FERN) blocks[idx(lx, y, lz)] = B.SNOW;
      }
  }
}

function SOLIDISH(v: number) {
  return v !== B.AIR && v !== B.WATER;
}
