// Nether terrain generation (runs in workers).
import { Octaves, Random, hash2, Noise } from '../noise';
import { B, OPAQUE } from './blocks';
import { BIOME } from './biomes';
import type { ChunkGenResult } from './worldgen';

const H = 128; // nether height (top 128 of the column is empty)
const LAVA_SEA = 31;
const GX = 5, GY = 17;
const idx = (x: number, y: number, z: number) => x | (z << 4) | (y << 8);

export class NetherGen {
  private n1: Octaves;
  private n2: Octaves;
  private sel: Octaves;
  private surf: Noise;
  constructor(public seed: number) {
    const r = new Random(seed ^ 0x6e7e);
    this.n1 = new Octaves(r.nextU32(), 3);
    this.n2 = new Octaves(r.nextU32(), 3);
    this.sel = new Octaves(r.nextU32(), 2);
    this.surf = new Noise(r.nextU32());
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
    const biomes = new Uint8Array(256).fill(BIOME.NETHER);
    const g = this.densityGrid(cx, cz);
    const r = new Random(hash2(this.seed ^ 0x4e7e, cx, cz));
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        for (let y = 0; y < H; y++) {
          const d = NetherGen.density(g, lx, y, lz);
          if (d > 0) blocks[idx(lx, y, lz)] = B.NETHERRACK;
          else if (y <= LAVA_SEA) blocks[idx(lx, y, lz)] = B.LAVA;
        }
        // bedrock floor & ceiling
        for (let y = 0; y < 5; y++) {
          if (y <= r.int(5)) blocks[idx(lx, y, lz)] = B.BEDROCK;
          if (y <= r.int(5)) blocks[idx(lx, H - 1 - y, lz)] = B.BEDROCK;
        }
        // soul sand / gravel shores around the lava sea
        const wx = cx * 16 + lx, wz = cz * 16 + lz;
        const sn = this.surf.noise2(wx / 12, wz / 12), gn = this.surf.noise2(wx / 10 + 77, wz / 10);
        for (let y = LAVA_SEA + 4; y > LAVA_SEA - 4; y--) {
          const i = idx(lx, y, lz);
          if (blocks[i] !== B.NETHERRACK || blocks[idx(lx, y + 1, lz)] !== 0) continue;
          if (sn > 0.35) { blocks[i] = B.SOUL_SAND; if (blocks[idx(lx, y - 1, lz)] === B.NETHERRACK) blocks[idx(lx, y - 1, lz)] = B.SOUL_SAND; }
          else if (gn > 0.45 && y <= LAVA_SEA + 1) blocks[i] = B.GRAVEL;
        }
      }
    // quartz ore
    for (let i = 0; i < 16; i++) this.vein(r, blocks, B.NETHER_QUARTZ_ORE, 14, r.int(16), 10 + r.int(108), r.int(16));
    // magma near the lava sea
    for (let i = 0; i < 4; i++) this.vein(r, blocks, B.MAGMA_BLOCK, 20, r.int(16), 27 + r.int(10), r.int(16));
    // glowstone clusters hanging from ceilings
    const clusters = r.int(r.int(10) + 1) + 1;
    for (let c = 0; c < clusters; c++) this.glowstone(r, blocks, r.int(16), 4 + r.int(H - 8), r.int(16));
    for (let c = 0; c < 6; c++) this.glowstone(r, blocks, r.int(16), 4 + r.int(H - 8), r.int(16));
    // fire patches on netherrack
    const fires = r.int(r.int(10) + 1) + 1;
    for (let f = 0; f < fires; f++) {
      const x = r.int(16), z = r.int(16), y0 = 4 + r.int(120);
      for (let k = 0; k < 16; k++) {
        const xx = x + r.int(5) - 2, yy = y0 + r.int(3) - 1, zz = z + r.int(5) - 2;
        if (xx < 0 || zz < 0 || xx > 15 || zz > 15 || yy < 1 || yy >= H) continue;
        if (blocks[idx(xx, yy, zz)] === 0 && blocks[idx(xx, yy - 1, zz)] === B.NETHERRACK) blocks[idx(xx, yy, zz)] = B.FIRE;
      }
    }
    // lava springs in walls
    for (let k = 0; k < 8; k++) {
      const x = 1 + r.int(14), y = 10 + r.int(H - 20), z = 1 + r.int(14);
      if (blocks[idx(x, y, z)] !== B.NETHERRACK || blocks[idx(x, y + 1, z)] !== B.NETHERRACK) continue;
      let air = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blocks[idx(x + dx, y, z + dz)] === 0) air++;
      if (air === 1) blocks[idx(x, y, z)] = B.LAVA;
    }
    // mushrooms
    for (let k = 0; k < 2; k++) {
      const x = r.int(16), z = r.int(16);
      for (let y = LAVA_SEA + 1; y < H - 5; y++) {
        if (blocks[idx(x, y, z)] === 0 && OPAQUE[blocks[idx(x, y - 1, z)]] && r.int(8) === 0) { blocks[idx(x, y, z)] = r.bool() ? B.BROWN_MUSHROOM : B.RED_MUSHROOM; break; }
      }
    }
    return { blocks, biomes };
  }

  private glowstone(r: Random, blocks: Uint16Array, x: number, y: number, z: number) {
    if (blocks[idx(x, y, z)] !== 0 || blocks[idx(x, y + 1, z)] !== B.NETHERRACK) return;
    blocks[idx(x, y, z)] = B.GLOWSTONE;
    for (let i = 0; i < 400; i++) {
      const xx = x + r.int(8) - r.int(8), yy = y - r.int(12), zz = z + r.int(8) - r.int(8);
      if (xx < 0 || zz < 0 || xx > 15 || zz > 15 || yy < 1) continue;
      if (blocks[idx(xx, yy, zz)] !== 0) continue;
      let n = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const ax = xx + dx, az = zz + dz, ay = yy + dy;
        if (ax < 0 || az < 0 || ax > 15 || az > 15) continue;
        if (blocks[idx(ax, ay, az)] === B.GLOWSTONE) n++;
      }
      if (n === 1) blocks[idx(xx, yy, zz)] = B.GLOWSTONE;
    }
  }

  private vein(r: Random, blocks: Uint16Array, ore: number, size: number, x: number, y: number, z: number) {
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
            if (blocks[idx(bx, by, bz)] === B.NETHERRACK) blocks[idx(bx, by, bz)] = ore;
          }
    }
  }
}
