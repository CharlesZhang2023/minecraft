// The End: a floating main island of end stone with ten obsidian pillars (crystals on top), the bedrock exit
// fountain in the middle, and far-flung outer islands. Pure function of (seed, chunk); runs in workers.
import { Octaves, Random, hash2 } from '../noise';
import { B, B2, CHUNK_H, pack } from './blocks';
import { BIOME } from './biomes';
import type { ChunkGenResult } from './worldgen';
import type { Spawn } from './village';
import { chunkCtx, startsNear, buildStarts, type GenAccess } from './structure';
import { END_STRUCTURES } from './structures/end';

/**
 * Where players arrive (the middle of a 5x5 obsidian platform; it's built by the game, not the generator) and the
 * top of the island at its centre. The platform floats a few blocks off the island's edge (x = 75) and well below
 * its rim, so it takes a short pillar and bridge to get across, like the real game.
 */
export const END_PLATFORM = { x: 82, y: 48, z: 0 };
export const END_CENTER_Y = 64;
const MAIN_R = 76;
const idx = (x: number, y: number, z: number) => x | (z << 4) | (y << 8);

export interface Pillar { x: number; z: number; r: number; h: number; cage: boolean }

/** Ten pillars on a circle; sizes are shuffled around it. */
export function endPillars(seed: number): Pillar[] {
  const r = new Random(seed ^ 0x3d1177a2);
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = order.length - 1; i > 0; i--) { const j = r.int(i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
  return order.map((size, i) => {
    const a = (i / 10) * Math.PI * 2;
    return { x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), r: 2 + Math.floor(size / 3), h: 76 + size * 3, cage: size <= 2 };
  });
}

export class EndGen implements GenAccess {
  private n1: Octaves;
  private n2: Octaves;
  private island: Octaves;
  constructor(public seed: number) {
    const r = new Random(seed ^ 0x0e9d);
    this.n1 = new Octaves(r.nextU32(), 3);
    this.n2 = new Octaves(r.nextU32(), 3);
    this.island = new Octaves(r.nextU32(), 3);
  }

  /** The End's biomes: the main island, then (past 1024 blocks) highlands, midlands and barrens by how high the
   * islands rise, and small end islands over the void. */
  biome(x: number, z: number): number {
    const d = Math.hypot(x, z);
    if (d < MAIN_R + 30) return BIOME.THE_END;
    if (d <= 1024) return BIOME.SMALL_END_ISLANDS;
    const gate = Math.min(1, (d - 1024) / 200);
    const v = this.island.sample2(x / 95, z / 95) * 0.9 + 0.12 * gate - 0.12;
    return v > 0.33 ? BIOME.END_HIGHLANDS : v > 0.285 ? BIOME.END_MIDLANDS : v > 0.255 ? BIOME.END_BARRENS : BIOME.SMALL_END_ISLANDS;
  }
  height(x: number, z: number): number {
    const c = this.column(x, z);
    return c ? c[1] : 0;
  }

  /** Solid range [bottom, top] of end stone in a column, or null over the void. */
  column(wx: number, wz: number): [number, number] | null {
    const d = Math.hypot(wx, wz);
    if (d < MAIN_R) {
      const t = d / MAIN_R;
      const calm = Math.min(1, Math.max(0, (d - 8) / 22)); // the middle stays flat so the fountain sits level
      const top = Math.round(END_CENTER_Y - t * t * 6 + this.n1.sample2(wx / 28, wz / 28) * 2.2 * calm);
      const thick = Math.pow(1 - t, 0.65) * 30 + 2 + this.n2.sample2(wx / 14, wz / 14) * 5 * Math.min(1, t * 2 + 0.3);
      return [Math.round(top - Math.max(2, thick)), top];
    }
    // the outer islands start past 1024 blocks, like vanilla: the dragon's gateways are the way out there
    if (d > 1024) {
      const gate = Math.min(1, (d - 1024) / 200);
      const v = this.island.sample2(wx / 95, wz / 95) * 0.9 + 0.12 * gate - 0.12;
      if (v > 0.26) {
        const top = Math.round(54 + v * 14 + this.n1.sample2(wx / 20, wz / 20) * 1.5);
        return [Math.round(top - v * 65 - this.n2.sample2(wx / 12, wz / 12) * 4), top];
      }
    }
    return null;
  }

  /** Islands and chorus plants that start in chunk (cx, cz), written through `set` (clipped to the target chunk). */
  private decorate(cx: number, cz: number, set: (x: number, y: number, z: number, v: number) => void) {
    const X0 = cx * 16, Z0 = cz * 16;
    const r = new Random(hash2(this.seed ^ 0xe7d1, cx, cz));
    const mid = this.biome(X0 + 8, Z0 + 8);
    if (mid === BIOME.SMALL_END_ISLANDS && Math.hypot(X0, Z0) > MAIN_R + 60 && r.int(14) === 0) {
      // a little inverted cone of end stone (vanilla EndIslandFeature)
      const ix = X0 + r.int(16), iy = 55 + r.int(16), iz = Z0 + r.int(16);
      let rad = 4 + r.int(3);
      for (let y = 0; rad > 0.5; y--) {
        for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) for (let dz = -Math.ceil(rad); dz <= Math.ceil(rad); dz++) if (dx * dx + dz * dz <= (rad + 1) * (rad + 1)) set(ix + dx, iy + y, iz + dz, B.END_STONE);
        rad -= 1 + r.next() * 0.5;
      }
    }
    if (mid === BIOME.END_HIGHLANDS || (mid === BIOME.END_MIDLANDS && r.int(4) === 0)) {
      for (let k = 0; k < (mid === BIOME.END_HIGHLANDS ? 4 : 1); k++) {
        const lx = r.int(16), lz = r.int(16);
        const c = this.column(X0 + lx, Z0 + lz);
        const seed = r.nextU32();
        if (!c || r.int(3)) continue;
        growChorus(new Random(seed), X0 + lx, c[1] + 1, Z0 + lz, set, 8);
      }
    }
  }

  generate(cx: number, cz: number): ChunkGenResult {
    const blocks = new Uint16Array(16 * 16 * CHUNK_H);
    const biomes = new Uint8Array(256).fill(BIOME.THE_END);
    const spawns: Spawn[] = [];
    const X0 = cx * 16, Z0 = cz * 16;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        biomes[lz * 16 + lx] = this.biome(X0 + lx, Z0 + lz);
        const c = this.column(X0 + lx, Z0 + lz);
        if (!c) continue;
        for (let y = Math.max(1, c[0]); y <= c[1]; y++) blocks[idx(lx, y, lz)] = B.END_STONE;
      }
    const set = (x: number, y: number, z: number, v: number) => {
      const lx = x - X0, lz = z - Z0;
      if (lx < 0 || lz < 0 || lx > 15 || lz > 15 || y < 1 || y >= CHUNK_H) return;
      blocks[idx(lx, y, lz)] = v;
    };

    // ---- obsidian pillars with a crystal on a bedrock cap, three of them caged
    for (const p of endPillars(this.seed)) {
      if (p.x + p.r + 3 < X0 || p.x - p.r - 3 > X0 + 15 || p.z + p.r + 3 < Z0 || p.z - p.r - 3 > Z0 + 15) continue;
      for (let dx = -p.r; dx <= p.r; dx++)
        for (let dz = -p.r; dz <= p.r; dz++) {
          if (dx * dx + dz * dz > p.r * p.r + 1) continue;
          for (let y = 40; y <= p.h; y++) set(p.x + dx, y, p.z + dz, B.OBSIDIAN);
        }
      set(p.x, p.h, p.z, B.BEDROCK);
      if (p.cage) {
        for (let dx = -2; dx <= 2; dx++)
          for (let dz = -2; dz <= 2; dz++) {
            const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            if (edge) for (let h = 1; h <= 3; h++) set(p.x + dx, p.h + h, p.z + dz, B.IRON_BARS);
            set(p.x + dx, p.h + 4, p.z + dz, B.IRON_BARS);
          }
      }
      if (p.x >= X0 && p.x < X0 + 16 && p.z >= Z0 && p.z < Z0 + 16) spawns.push({ type: 'end_crystal', x: p.x + 0.5, y: p.h + 1, z: p.z + 0.5 });
    }

    // ---- the exit fountain: a bedrock ring around a pit, a central pillar with torches
    const F = END_CENTER_Y;
    if (X0 <= 6 && X0 + 15 >= -6 && Z0 <= 6 && Z0 + 15 >= -6) {
      for (let dx = -4; dx <= 4; dx++)
        for (let dz = -4; dz <= 4; dz++) {
          const r2 = dx * dx + dz * dz;
          if (r2 > 20) continue;
          if (r2 <= 6) { set(dx, F, dz, B.BEDROCK); for (let h = 1; h <= 6; h++) set(dx, F + h, dz, B.AIR); }
          else { set(dx, F, dz, B.BEDROCK); set(dx, F + 1, dz, B.BEDROCK); }
        }
      for (let h = 0; h <= 3; h++) set(0, F + h, 0, B.BEDROCK);
      set(1, F + 2, 0, pack(B.TORCH, 4)); set(-1, F + 2, 0, pack(B.TORCH, 2)); set(0, F + 2, 1, pack(B.TORCH, 1)); set(0, F + 2, -1, pack(B.TORCH, 3));
    }
    // ---- the outer End: small floating islands and chorus forests (from this chunk and its neighbours: they
    // reach over chunk borders), then End cities
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.decorate(cx + dx, cz + dz, set);
    if (Math.hypot(X0, Z0) > 1000) buildStarts(startsNear(END_STRUCTURES, this, cx, cz), chunkCtx(blocks, cx, cz, spawns));
    return { blocks, biomes, spawns };
  }
}

/** A chorus plant (vanilla ChorusFlowerBlock.generatePlant): a branching stalk with flowers at its tips. */
export function growChorus(r: Random, x: number, y: number, z: number, set: (x: number, y: number, z: number, v: number) => void, maxSize: number) {
  set(x, y, z, B2.CHORUS_PLANT);
  grow(x, y, z, 0);
  function grow(px: number, py: number, pz: number, depth: number) {
    const h = r.int(4) + 1 + (depth === 0 ? 1 : 0);
    for (let i = 0; i < h; i++) {
      set(px, py + i + 1, pz, B2.CHORUS_PLANT);
    }
    const top = py + h;
    let branched = false;
    if (depth < 4) {
      const n = r.int(4) + (depth === 0 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][r.int(4)];
        const nx = px + dx, nz = pz + dz;
        if (Math.abs(nx - x) >= maxSize || Math.abs(nz - z) >= maxSize) continue;
        set(nx, top, nz, B2.CHORUS_PLANT);
        grow(nx, top, nz, depth + 1);
        branched = true;
      }
    }
    if (!branched) set(px, top + 1, pz, pack(B2.CHORUS_FLOWER, 5));
  }
}
