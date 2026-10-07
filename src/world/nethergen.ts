// Nether terrain generation (runs in workers): the 1.16 Nether. One cave system for all of it, with five biomes
// laid over it by two noise fields (vanilla's multi-noise points): nether wastes, soul sand valleys, crimson and
// warped forests, and basalt deltas. Each biome brings its own surface and features: nylium with huge fungi,
// roots and vines; soul sand and soul soil with basalt pillars, fossils and soul fire; basalt and blackstone with
// lava deltas and basalt columns. Ores, ancient debris, fortresses, bastions and ruined portals come after.
import { Octaves, Random, hash2, Noise } from '../noise';
import { B, B2, STONE2, OPAQUE, pack, WOOD } from './blocks';
import { BIOME } from './biomes';
import type { ChunkGenResult } from './worldgen';
import { fortressesNear, buildFortress } from './fortress';
import { hugeFungus } from './features';
import type { Spawn } from './village';
import { chunkCtx, startsNear, buildStarts, type GenAccess } from './structure';
import { NETHER_STRUCTURES } from './structures/nether';

const H = 128; // nether height (top 128 of the column is empty)
const LAVA_SEA = 31;
const GX = 5, GY = 17;
const idx = (x: number, y: number, z: number) => x | (z << 4) | (y << 8);
const AIR = 0;

/** Biome points (temperature, humidity, offset) as in vanilla 1.16's nether multi-noise source. */
const POINTS: [number, number, number, number][] = [
  [BIOME.NETHER, 0, 0, 0],
  [BIOME.SOUL_SAND_VALLEY, 0, -0.5, 0],
  [BIOME.CRIMSON_FOREST, 0.4, 0, 0],
  [BIOME.WARPED_FOREST, 0, 0.5, 0.375],
  [BIOME.BASALT_DELTAS, -0.5, 0, 0.175],
];

export class NetherGen implements GenAccess {
  private n1: Octaves;
  private n2: Octaves;
  private sel: Octaves;
  private surf: Noise;
  private temp: Octaves;
  private humid: Octaves;
  private patch: Noise;
  private delta: Noise;
  constructor(public seed: number) {
    const r = new Random(seed ^ 0x6e7e);
    this.n1 = new Octaves(r.nextU32(), 3);
    this.n2 = new Octaves(r.nextU32(), 3);
    this.sel = new Octaves(r.nextU32(), 2);
    this.surf = new Noise(r.nextU32());
    const r2 = new Random(seed ^ 0x6e7e1165);
    this.temp = new Octaves(r2.nextU32(), 2);
    this.humid = new Octaves(r2.nextU32(), 2);
    this.patch = new Noise(r2.nextU32());
    this.delta = new Noise(r2.nextU32());
  }

  /** The biome of a column (2D in this game: one biome per column). */
  biomeAt(x: number, z: number): number {
    const t = this.temp.sample2(x / 260, z / 260) * 1.1, h = this.humid.sample2(x / 260 + 300, z / 260) * 1.1;
    let best = BIOME.NETHER, bd = Infinity;
    for (const [b, pt, ph, off] of POINTS) {
      const d = (t - pt) * (t - pt) + (h - ph) * (h - ph) + off * off;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  biome(x: number, z: number) { return this.biomeAt(x, z); }
  /** A rough floor height (structures pick their y themselves in the Nether). */
  height(x: number, z: number): number {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const g = this.densityGrid(cx, cz);
    const lx = x - cx * 16, lz = z - cz * 16;
    for (let y = 70; y > LAVA_SEA; y--) if (NetherGen.density(g, lx, y, lz) > 0 && NetherGen.density(g, lx, y + 1, lz) <= 0) return y;
    return LAVA_SEA;
  }

  private densityGrid(cx: number, cz: number): Float32Array {
    const g = new Float32Array(GX * GX * GY);
    for (let gx = 0; gx < GX; gx++)
      for (let gz = 0; gz < GX; gz++) {
        const wx = cx * 16 + gx * 4, wz = cz * 16 + gz * 4;
        for (let gy = 0; gy < GY; gy++) {
          const y = gy * 8;
          const a = this.n1.sample3(wx / 70, y / 45, wz / 70);
          const b = this.n2.sample3(wx / 40, y / 30, wz / 40);
          const s = this.sel.sample3(wx / 120, y / 90, wz / 120) * 0.5 + 0.5;
          let d = (a * (1 - s) + b * s) * 1.6;
          // vertical profile: open caverns in the middle, solid floor and ceiling
          const mid = Math.cos(((y - 64) / 64) * Math.PI) * 0.35;
          d -= mid;
          if (y < 24) d += (24 - y) / 12;
          if (y > 96) d += (y - 96) / 10;
          g[(gx * GX + gz) * GY + gy] = d;
        }
      }
    return g;
  }

  private static density(g: Float32Array, lx: number, y: number, lz: number): number {
    const gx = lx >> 2, gz = lz >> 2, gy = y >> 3;
    const fx = (lx & 3) / 4, fz = (lz & 3) / 4, fy = (y & 7) / 8;
    const i00 = (gx * GX + gz) * GY + gy, i10 = ((gx + 1) * GX + gz) * GY + gy;
    const i01 = (gx * GX + gz + 1) * GY + gy, i11 = ((gx + 1) * GX + gz + 1) * GY + gy;
    const a = g[i00] + (g[i00 + 1] - g[i00]) * fy, b = g[i10] + (g[i10 + 1] - g[i10]) * fy;
    const c = g[i01] + (g[i01 + 1] - g[i01]) * fy, d = g[i11] + (g[i11 + 1] - g[i11]) * fy;
    const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }

  generate(cx: number, cz: number): ChunkGenResult {
    const blocks = new Uint16Array(16 * 16 * 256);
    const biomes = new Uint8Array(256);
    const g = this.densityGrid(cx, cz);
    const r = new Random(hash2(this.seed ^ 0x4e7e, cx, cz));
    const wx0 = cx * 16, wz0 = cz * 16;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = wx0 + lx, wz = wz0 + lz;
        const biome = this.biomeAt(wx, wz);
        biomes[lz * 16 + lx] = biome;
        for (let y = 0; y < H; y++) {
          let d = NetherGen.density(g, lx, y, lz);
          // the deltas are rougher: extra small-scale noise breaks their floors up
          if (biome === BIOME.BASALT_DELTAS && y > LAVA_SEA - 4 && y < 90) d += this.delta.noise3(wx / 9, y / 7, wz / 9) * 0.35;
          if (d > 0) blocks[idx(lx, y, lz)] = B.NETHERRACK;
          else if (y <= LAVA_SEA) blocks[idx(lx, y, lz)] = B.LAVA;
        }
        // bedrock floor & ceiling
        for (let y = 0; y < 5; y++) {
          if (y <= r.int(5)) blocks[idx(lx, y, lz)] = B.BEDROCK;
          if (y <= r.int(5)) blocks[idx(lx, H - 1 - y, lz)] = B.BEDROCK;
        }
        this.surface(blocks, lx, lz, wx, wz, biome, r);
      }
    const spawns: Spawn[] = [];
    // ores and blobs (by the biome in the middle of the chunk, like vanilla features)
    const mid = biomes[8 * 16 + 8];
    const deltas = mid === BIOME.BASALT_DELTAS;
    const host = [B.NETHERRACK, STONE2.BASALT, STONE2.BLACKSTONE];
    for (let i = 0; i < (deltas ? 32 : 16); i++) this.vein(r, blocks, B.NETHER_QUARTZ_ORE, 14, r.int(16), 10 + r.int(108), r.int(16), [B.NETHERRACK]);
    for (let i = 0; i < (deltas ? 20 : 10); i++) this.vein(r, blocks, B2.NETHER_GOLD_ORE, 10, r.int(16), 10 + r.int(108), r.int(16), [B.NETHERRACK]);
    // ancient debris: one small hidden vein low down, one anywhere (vanilla: size 3 at 8-24, size 2 at 8-119)
    this.vein(r, blocks, B2.ANCIENT_DEBRIS, 3, r.int(16), 8 + r.int(16), r.int(16), host, true);
    this.vein(r, blocks, B2.ANCIENT_DEBRIS, 2, r.int(16), 8 + r.int(111), r.int(16), host, true);
    for (let i = 0; i < 4; i++) this.vein(r, blocks, B.MAGMA_BLOCK, 20, r.int(16), 27 + r.int(10), r.int(16), [B.NETHERRACK]);
    for (let i = 0; i < 2; i++) this.vein(r, blocks, B.GRAVEL, 26, r.int(16), 5 + r.int(36), r.int(16), [B.NETHERRACK]);
    for (let i = 0; i < 2; i++) this.vein(r, blocks, STONE2.BLACKSTONE, 26, r.int(16), 5 + r.int(16), r.int(16), [B.NETHERRACK]);
    if (mid === BIOME.SOUL_SAND_VALLEY) for (let i = 0; i < 4; i++) this.vein(r, blocks, B.SOUL_SAND, 20, r.int(16), 5 + r.int(60), r.int(16), [B.NETHERRACK]);
    // biome features
    const fr = new Random(hash2(this.seed ^ 0x5eed, cx, cz));
    switch (mid) {
      case BIOME.CRIMSON_FOREST: this.forest(fr, blocks, cx, cz, false); break;
      case BIOME.WARPED_FOREST: this.forest(fr, blocks, cx, cz, true); break;
      case BIOME.SOUL_SAND_VALLEY: this.soulValley(fr, blocks); break;
      case BIOME.BASALT_DELTAS: this.deltas(fr, blocks); break;
      default: this.wastes(fr, blocks);
    }
    // glowstone everywhere but the deltas (fewer in the forests)
    const glow = deltas ? 0 : mid === BIOME.NETHER || mid === BIOME.SOUL_SAND_VALLEY ? 1 : 0.6;
    const clusters = Math.round((r.int(r.int(10) + 1) + 1) * glow);
    for (let c = 0; c < clusters; c++) this.glowstone(r, blocks, r.int(16), 4 + r.int(H - 8), r.int(16));
    for (let c = 0; c < Math.round(6 * glow); c++) this.glowstone(r, blocks, r.int(16), 4 + r.int(H - 8), r.int(16));
    // lava springs in walls
    for (let k = 0; k < (deltas ? 16 : 8); k++) {
      const x = 1 + r.int(14), y = 10 + r.int(H - 20), z = 1 + r.int(14);
      if (blocks[idx(x, y, z)] !== B.NETHERRACK || blocks[idx(x, y + 1, z)] !== B.NETHERRACK) continue;
      let air = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blocks[idx(x + dx, y, z + dz)] === AIR) air++;
      if (air === 1) blocks[idx(x, y, z)] = B.LAVA;
    }
    // structures: fortresses (the original builder), then bastions, ruined portals and fossils
    for (const f of fortressesNear(this.seed, cx, cz))
      buildFortress(f, cx, cz, (x, y, z) => blocks[idx(x - wx0, y, z - wz0)], (x, y, z, v) => { blocks[idx(x - wx0, y, z - wz0)] = v; });
    const ctx = chunkCtx(blocks, cx, cz, spawns);
    buildStarts(startsNear(NETHER_STRUCTURES, this, cx, cz), ctx);
    return { blocks, biomes, spawns };
  }

  // ---------------------------------------------------------------- surfaces
  private surface(blocks: Uint16Array, lx: number, lz: number, wx: number, wz: number, biome: number, r: Random) {
    const sn = this.surf.noise2(wx / 12, wz / 12), gn = this.surf.noise2(wx / 10 + 77, wz / 10);
    const pn = this.patch.noise2(wx / 8, wz / 8);
    for (let y = H - 6; y > 5; y--) {
      const i = idx(lx, y, lz);
      if (blocks[i] !== B.NETHERRACK) continue;
      const above = blocks[idx(lx, y + 1, lz)];
      const floor = above === AIR;
      switch (biome) {
        case BIOME.CRIMSON_FOREST: case BIOME.WARPED_FOREST:
          if (floor) blocks[i] = biome === BIOME.CRIMSON_FOREST ? B2.CRIMSON_NYLIUM : B2.WARPED_NYLIUM;
          break;
        case BIOME.SOUL_SAND_VALLEY: {
          // floors of soul sand and soul soil in patches, a few blocks deep; some walls too
          if (floor) {
            const v = pn > 0 ? B.SOUL_SAND : B2.SOUL_SOIL;
            for (let k = 0; k < 3 + r.int(2) && blocks[idx(lx, y - k, lz)] === B.NETHERRACK; k++) blocks[idx(lx, y - k, lz)] = v;
          } else if (y < 70 && this.patch.noise3(wx / 6, y / 6, wz / 6) > 0.45) blocks[i] = pn > 0.1 ? B.SOUL_SAND : B2.SOUL_SOIL;
          break;
        }
        case BIOME.BASALT_DELTAS: {
          // basalt and blackstone wherever the deltas' rock shows
          const exposed = floor || blocks[idx(lx, y - 1, lz)] === AIR || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => { const nx = lx + dx, nz = lz + dz; return nx >= 0 && nz >= 0 && nx < 16 && nz < 16 && blocks[idx(nx, y, nz)] === AIR; });
          if (exposed || this.patch.noise3(wx / 5, y / 5, wz / 5) > -0.2) blocks[i] = this.patch.noise3(wx / 7 + 40, y / 7, wz / 7) > 0.15 ? STONE2.BLACKSTONE : STONE2.BASALT;
          break;
        }
        default:
          // the old wastes: soul sand and gravel shores around the lava sea
          if (floor && y <= LAVA_SEA + 4 && y > LAVA_SEA - 4) {
            if (sn > 0.35) { blocks[i] = B.SOUL_SAND; if (blocks[idx(lx, y - 1, lz)] === B.NETHERRACK) blocks[idx(lx, y - 1, lz)] = B.SOUL_SAND; }
            else if (gn > 0.45 && y <= LAVA_SEA + 1) blocks[i] = B.GRAVEL;
          }
      }
    }
  }

  // ---------------------------------------------------------------- biome features
  /** Floors (a solid block with air above) in a column, top down. */
  private floors(blocks: Uint16Array, x: number, z: number, want: number[]): number[] {
    const out: number[] = [];
    for (let y = H - 6; y > LAVA_SEA; y--) if (want.includes(blocks[idx(x, y, z)]) && blocks[idx(x, y + 1, z)] === AIR) out.push(y);
    return out;
  }
  private ceilings(blocks: Uint16Array, x: number, z: number): number[] {
    const out: number[] = [];
    for (let y = H - 6; y > LAVA_SEA + 2; y--) if (OPAQUE[blocks[idx(x, y, z)]] && blocks[idx(x, y - 1, z)] === AIR) out.push(y);
    return out;
  }

  /** Crimson or warped forest: huge fungi, fungi, roots, sprouts and vines. */
  private forest(r: Random, blocks: Uint16Array, cx: number, cz: number, warped: boolean) {
    const nylium = warped ? B2.WARPED_NYLIUM : B2.CRIMSON_NYLIUM;
    const set = (x: number, y: number, z: number, v: number, force?: boolean) => {
      const lx = x - cx * 16, lz = z - cz * 16;
      if (lx < 0 || lz < 0 || lx > 15 || lz > 15 || y < 1 || y >= H - 1) return;
      const cur = blocks[idx(lx, y, lz)];
      if (force ? cur !== B.BEDROCK : cur === AIR || cur === B2.CRIMSON_ROOTS || cur === B2.WARPED_ROOTS || cur === B2.NETHER_SPROUTS) blocks[idx(lx, y, lz)] = v;
    };
    // huge fungi (vanilla: 8 tries a chunk), planted on nylium
    for (let k = 0; k < 8; k++) {
      const x = r.int(16), z = r.int(16);
      const fl = this.floors(blocks, x, z, [nylium]);
      if (!fl.length) continue;
      const y = fl[r.int(fl.length)] + 1;
      if (blocks[idx(x, y + 1, z)] !== AIR || blocks[idx(x, y + 4, z)] !== AIR) continue;
      hugeFungus(new Random(r.nextU32()), cx * 16 + x, y, cz * 16 + z, set, warped);
    }
    // ground cover
    for (let k = 0; k < 64; k++) {
      const x = r.int(16), z = r.int(16);
      const fl = this.floors(blocks, x, z, [nylium]);
      if (!fl.length) continue;
      const y = fl[r.int(fl.length)] + 1;
      if (blocks[idx(x, y, z)] !== AIR) continue;
      const roll = r.int(20);
      blocks[idx(x, y, z)] = roll === 0 ? WOOD[warped ? 'warped' : 'crimson'].sapling : roll < 3 && warped ? B2.NETHER_SPROUTS : warped ? B2.WARPED_ROOTS : B2.CRIMSON_ROOTS;
    }
    // vines: weeping from the ceilings of crimson forests, twisting up from warped floors
    for (let k = 0; k < 10; k++) {
      const x = r.int(16), z = r.int(16);
      if (!warped) {
        const ce = this.ceilings(blocks, x, z);
        if (!ce.length) continue;
        const y = ce[r.int(ce.length)] - 1, len = 1 + r.int(8);
        for (let i = 0; i < len && blocks[idx(x, y - i, z)] === AIR; i++) blocks[idx(x, y - i, z)] = i === len - 1 || blocks[idx(x, y - i - 1, z)] !== AIR ? B2.WEEPING_VINES : B2.WEEPING_VINES_PLANT;
      } else {
        const fl = this.floors(blocks, x, z, [nylium, B.NETHERRACK]);
        if (!fl.length) continue;
        const y = fl[r.int(fl.length)] + 1, len = 1 + r.int(8);
        for (let i = 0; i < len && blocks[idx(x, y + i, z)] === AIR; i++) blocks[idx(x, y + i, z)] = i === len - 1 || blocks[idx(x, y + i + 1, z)] !== AIR ? B2.TWISTING_VINES : B2.TWISTING_VINES_PLANT;
      }
    }
  }

  /** Soul sand valley: basalt pillars from floor to ceiling, soul fire, and a few patches of fire on the floor. */
  private soulValley(r: Random, blocks: Uint16Array) {
    for (let k = 0; k < 6; k++) {
      const x = 1 + r.int(14), z = 1 + r.int(14);
      const fl = this.floors(blocks, x, z, [B.SOUL_SAND, B2.SOUL_SOIL, B.NETHERRACK]);
      if (!fl.length) continue;
      let y = fl[r.int(fl.length)] + 1;
      // a basalt pillar (vanilla BasaltPillarFeature): straight up until the ceiling, ragged sides
      let n = 0;
      while (y < H - 6 && blocks[idx(x, y, z)] === AIR && n < 40) {
        blocks[idx(x, y, z)] = STONE2.BASALT;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (r.int(4) === 0 && blocks[idx(x + dx, y, z + dz)] === AIR) blocks[idx(x + dx, y, z + dz)] = STONE2.BASALT;
        y++; n++;
      }
      if (n >= 40) for (let i = 0; i < n; i++) blocks[idx(x, y - 1 - i, z)] = AIR; // reached nothing: take it back
    }
    for (let k = 0; k < 3; k++) {
      const x = r.int(16), z = r.int(16);
      const fl = this.floors(blocks, x, z, [B.SOUL_SAND, B2.SOUL_SOIL]);
      if (fl.length) blocks[idx(x, fl[0] + 1, z)] = B2.SOUL_FIRE;
    }
  }

  /** Basalt deltas: lava pools rimmed with magma, basalt columns, blackstone blobs. */
  private deltas(r: Random, blocks: Uint16Array) {
    // deltas (vanilla DeltaFeature): a pool of lava in solid ground with a magma rim
    for (let k = 0; k < 40; k++) {
      const x = r.int(16), z = r.int(16);
      const fl = this.floors(blocks, x, z, [STONE2.BASALT, STONE2.BLACKSTONE, B.NETHERRACK]);
      if (!fl.length) continue;
      const y = fl[r.int(fl.length)];
      const rad = 3 + r.int(5), rim = r.int(3);
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const px = x + dx, pz = z + dz;
        if (px < 0 || pz < 0 || px > 15 || pz > 15) continue;
        const d = Math.abs(dx) + Math.abs(dz);
        if (d > rad) continue;
        const i = idx(px, y, pz);
        // only into a floor that's solid around and below
        if (!OPAQUE[blocks[i]] || !OPAQUE[blocks[idx(px, y - 1, pz)]] || blocks[idx(px, y + 1, pz)] !== AIR) continue;
        blocks[i] = d > rad - rim ? B.MAGMA_BLOCK : B.LAVA;
      }
    }
    // basalt columns: clusters of columns of different heights
    for (let k = 0; k < 4; k++) {
      const x0 = r.int(16), z0 = r.int(16), big = r.int(3) === 0;
      const fl = this.floors(blocks, x0, z0, [STONE2.BASALT, STONE2.BLACKSTONE, B.NETHERRACK, B.MAGMA_BLOCK]);
      if (!fl.length) continue;
      const y0 = fl[r.int(fl.length)] + 1;
      const reach = big ? 3 : 1;
      for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
        const x = x0 + dx, z = z0 + dz;
        if (x < 0 || z < 0 || x > 15 || z > 15 || r.int(3) === 0) continue;
        const h = big ? 5 + r.int(6) : 1 + r.int(5);
        let y = y0;
        while (y > y0 - 4 && blocks[idx(x, y - 1, z)] === AIR) y--;
        for (let i = 0; i < h && blocks[idx(x, y + i, z)] === AIR; i++) blocks[idx(x, y + i, z)] = STONE2.BASALT;
      }
    }
  }

  /** Nether wastes: fire patches and mushrooms on the netherrack. */
  private wastes(r: Random, blocks: Uint16Array) {
    const fires = r.int(r.int(10) + 1) + 1;
    for (let f = 0; f < fires; f++) {
      const x = r.int(16), z = r.int(16), y0 = 4 + r.int(120);
      for (let k = 0; k < 16; k++) {
        const xx = x + r.int(5) - 2, yy = y0 + r.int(3) - 1, zz = z + r.int(5) - 2;
        if (xx < 0 || zz < 0 || xx > 15 || zz > 15 || yy < 1 || yy >= H) continue;
        if (blocks[idx(xx, yy, zz)] === AIR && blocks[idx(xx, yy - 1, zz)] === B.NETHERRACK) blocks[idx(xx, yy, zz)] = B.FIRE;
      }
    }
    for (let k = 0; k < 2; k++) {
      const x = r.int(16), z = r.int(16);
      for (let y = LAVA_SEA + 1; y < H - 5; y++) {
        if (blocks[idx(x, y, z)] === AIR && OPAQUE[blocks[idx(x, y - 1, z)]] && r.int(8) === 0) { blocks[idx(x, y, z)] = r.bool() ? B.BROWN_MUSHROOM : B.RED_MUSHROOM; break; }
      }
    }
  }

  private glowstone(r: Random, blocks: Uint16Array, x: number, y: number, z: number) {
    if (blocks[idx(x, y, z)] !== AIR || !OPAQUE[blocks[idx(x, y + 1, z)]]) return;
    blocks[idx(x, y, z)] = B.GLOWSTONE;
    for (let i = 0; i < 400; i++) {
      const xx = x + r.int(8) - r.int(8), yy = y - r.int(12), zz = z + r.int(8) - r.int(8);
      if (xx < 0 || zz < 0 || xx > 15 || zz > 15 || yy < 1) continue;
      if (blocks[idx(xx, yy, zz)] !== AIR) continue;
      let n = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const ax = xx + dx, az = zz + dz, ay = yy + dy;
        if (ax < 0 || az < 0 || ax > 15 || az > 15) continue;
        if (blocks[idx(ax, ay, az)] === B.GLOWSTONE) n++;
      }
      if (n === 1) blocks[idx(xx, yy, zz)] = B.GLOWSTONE;
    }
  }

  /** An ore vein replacing `host` blocks; `hidden` ones (ancient debris) skip cells that touch air. */
  private vein(r: Random, blocks: Uint16Array, ore: number, size: number, x: number, y: number, z: number, host: number[], hidden = false) {
    const a = r.next() * Math.PI;
    const x1 = x + (Math.sin(a) * size) / 8, x2 = x - (Math.sin(a) * size) / 8;
    const z1 = z + (Math.cos(a) * size) / 8, z2 = z - (Math.cos(a) * size) / 8;
    const y1 = y + r.int(3) - 2, y2 = y + r.int(3) - 2;
    for (let i = 0; i < size; i++) {
      const cx = x1 + ((x2 - x1) * i) / size, cy = y1 + ((y2 - y1) * i) / size, cz = z1 + ((z2 - z1) * i) / size;
      const hr = ((Math.sin((i * Math.PI) / size) + 1) * r.next() * size) / 16 / 2 + 0.5;
      for (let bx = Math.floor(cx - hr); bx <= Math.floor(cx + hr); bx++)
        for (let by = Math.floor(cy - hr); by <= Math.floor(cy + hr); by++)
          for (let bz = Math.floor(cz - hr); bz <= Math.floor(cz + hr); bz++) {
            if (bx < 0 || bz < 0 || bx > 15 || bz > 15 || by < 1 || by >= H) continue;
            const dx = (bx + 0.5 - cx) / hr, dy = (by + 0.5 - cy) / hr, dz = (bz + 0.5 - cz) / hr;
            if (dx * dx + dy * dy + dz * dz >= 1) continue;
            const i2 = idx(bx, by, bz);
            if (!host.includes(blocks[i2])) continue;
            if (hidden && [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([ox, oy, oz]) => { const nx = bx + ox, nz = bz + oz; return nx >= 0 && nz >= 0 && nx < 16 && nz < 16 && blocks[idx(nx, by + oy, nz)] === AIR; })) continue;
            blocks[i2] = ore;
          }
    }
  }
}
void pack;
