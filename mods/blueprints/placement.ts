// A placement: a schematic put somewhere in the world, turned and mirrored, the way Litematica places one. It
// works out which block of this game each cell means (after the turn) and maps world positions to cells and back.
import type { Mc } from '../sdk';
import type { Schematic, Region, Vec3, BlockState } from './model';
import { bounds, isAir } from './model';
import { fromJava } from './vanilla';

let mc: Mc;
export function initPlacements(m: Mc) { mc = m; }

/** Cells a placement leaves alone (structure voids). */
export const SKIP = -1;
/** Cells with a block this game doesn't have: shown as a placeholder, never placed. */
export const UNKNOWN = -2;

export interface PlacementData {
  id: string;
  schematicId: string;
  name: string;
  /** Where the schematic's minimum corner goes (before turning; it stays put when turned). */
  origin: Vec3;
  /** Quarter turns clockwise seen from above. */
  rotation: number;
  /** 0 none, 1 north-south flipped (Java's LEFT_RIGHT), 2 east-west flipped (FRONT_BACK). */
  mirror: number;
  visible: boolean;
}

/** Player-chosen stand-ins for Java blocks this game lacks: Java name -> this game's block (`stone`, `oak_stairs[...]`). */
export const remaps = new Map<string, string>();

/** A cell's offset from the origin, mirrored then turned: where it lands. */
export function forward(x: number, z: number, mirror: number, q: number): [number, number] {
  if (mirror === 1) z = -z;
  else if (mirror === 2) x = -x;
  switch (q & 3) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
  }
  return [x, z];
}
/** The way back: the cell at an offset from the origin. */
export function inverse(a: number, b: number, mirror: number, q: number): [number, number] {
  let x: number, z: number;
  switch (q & 3) {
    case 1: x = b; z = -a; break;
    case 2: x = -a; z = -b; break;
    case 3: x = -b; z = a; break;
    default: x = a; z = b;
  }
  if (mirror === 1) z = -z;
  else if (mirror === 2) x = -x;
  return [x, z];
}

export class Placement {
  /** Per region: the game block for each palette entry, turned (or SKIP / UNKNOWN). */
  values: Int32Array[] = [];
  /** Java names in the schematic this game has no block for. */
  unknown = new Set<string>();
  min: Vec3 = [0, 0, 0];
  max: Vec3 = [0, 0, 0];
  /** Bumped whenever what it puts where changes. */
  version = 0;
  private anchor: Vec3;
  private regionBoxes: { r: Region; x0: number; y0: number; z0: number }[] = [];

  constructor(public data: PlacementData, public schematic: Schematic) {
    this.anchor = bounds(schematic).min;
    this.resolve();
  }

  get size(): Vec3 { return bounds(this.schematic).size; }

  /** Work out every palette entry's block and the box in the world (after any change to the placement). */
  resolve() {
    const d = this.data, axis = d.mirror === 1 ? 'z' : d.mirror === 2 ? 'x' : null;
    this.unknown.clear();
    this.values = this.schematic.regions.map((r) => Int32Array.from(r.palette, (st) => {
      const v = this.blockOf(st);
      if (v < 0) return v;
      return mc.blockspec.rotateBlock(mc.blockspec.mirrorBlock(v, axis), d.rotation);
    }));
    this.regionBoxes = this.schematic.regions.map((r) => ({ r, x0: r.pos[0] - this.anchor[0], y0: r.pos[1] - this.anchor[1], z0: r.pos[2] - this.anchor[2] }));
    const [sx, sy, sz] = this.size;
    const a = forward(0, 0, d.mirror, d.rotation), b = forward(sx - 1, sz - 1, d.mirror, d.rotation);
    this.min = [d.origin[0] + Math.min(a[0], b[0]), d.origin[1], d.origin[2] + Math.min(a[1], b[1])];
    this.max = [d.origin[0] + Math.max(a[0], b[0]), d.origin[1] + sy - 1, d.origin[2] + Math.max(a[1], b[1])];
    this.version++;
  }

  private blockOf(st: BlockState): number {
    if (isAir(st)) return 0;
    if (st.name === 'minecraft:structure_void') return SKIP;
    const re = remaps.get(st.name);
    if (re) { try { return mc.blockspec.parseBlock(re); } catch { /* a stale stand-in: as unknown */ } }
    const v = fromJava(st);
    if (v === null) { this.unknown.add(st.name); return UNKNOWN; }
    return v;
  }

  /** The block wanted at a world position: a packed value, 0 for air, SKIP outside or for voids, UNKNOWN. */
  at(wx: number, wy: number, wz: number): number {
    const r = this.cellAt(wx, wy, wz);
    return r ? this.values[r.ri][r.region.blocks[r.i]] : SKIP;
  }

  /** The schematic cell at a world position: its region, the region's index and the cell's index. */
  cellAt(wx: number, wy: number, wz: number): { region: Region; ri: number; i: number } | null {
    if (wx < this.min[0] || wx > this.max[0] || wy < this.min[1] || wy > this.max[1] || wz < this.min[2] || wz > this.max[2]) return null;
    const d = this.data;
    const [x, z] = inverse(wx - d.origin[0], wz - d.origin[2], d.mirror, d.rotation);
    const y = wy - d.origin[1];
    // later regions sit over earlier ones
    for (let ri = this.regionBoxes.length - 1; ri >= 0; ri--) {
      const { r, x0, y0, z0 } = this.regionBoxes[ri];
      const lx = x - x0, ly = y - y0, lz = z - z0;
      if (lx < 0 || ly < 0 || lz < 0 || lx >= r.size[0] || ly >= r.size[1] || lz >= r.size[2]) continue;
      return { region: r, ri, i: (ly * r.size[2] + lz) * r.size[0] + lx };
    }
    return null;
  }

  /** World position of a region's cell. */
  worldOf(ri: number, i: number): Vec3 {
    const { r, x0, y0, z0 } = this.regionBoxes[ri];
    const sx = r.size[0], sz = r.size[2];
    const lx = i % sx + x0, lz = Math.floor(i / sx) % sz + z0, ly = Math.floor(i / (sx * sz)) + y0;
    const d = this.data;
    const [a, b] = forward(lx, lz, d.mirror, d.rotation);
    return [d.origin[0] + a, d.origin[1] + ly, d.origin[2] + b];
  }

  /** Does the placement reach into chunk column (cx, cz)? */
  overlaps(cx: number, cz: number) {
    return this.max[0] >= cx * 16 && this.min[0] < cx * 16 + 16 && this.max[2] >= cz * 16 && this.min[2] < cz * 16 + 16;
  }
}
