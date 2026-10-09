// A schematic as this mod keeps it, whatever file it came from: one or more boxes of blocks (Litematica's
// sub-regions), each with a palette of block states named the way Java Edition names them, the block entities'
// data and the entities. Block states keep the names the file used once they're brought up to date, so states and
// blocks this game doesn't have (other mods', newer versions') survive a trip through the game untouched.
import type { Compound } from './nbt';

export type Vec3 = [number, number, number];

/** A block state: `minecraft:oak_stairs` + `{ facing: 'east', half: 'bottom' }`. */
export interface BlockState {
  name: string;
  props: Record<string, string>;
  /**
   * This game's exact block (`oak_stairs:5`, `mymod:gizmo:3`) when the schematic was saved here or in a file this
   * mod wrote: it goes back exactly, even for states the Java names can't say.
   */
  game?: string;
}

export interface TileData {
  /** Cell index in its region. */
  i: number;
  /** Java Edition block entity data (without its position), as read from a file or made for one. */
  nbt?: Compound;
  /** This game's own tile entity (JSON), when it came from this game. */
  game?: Record<string, unknown>;
}

export interface EntityData {
  /** Position relative to the region's minimum corner. */
  pos: [number, number, number];
  /** Java Edition entity data (without Pos). */
  nbt: Compound;
}

export interface Region {
  name: string;
  /** Minimum corner, relative to the schematic's origin. */
  pos: Vec3;
  /** Always positive. */
  size: Vec3;
  /** Index 0 is air. */
  palette: BlockState[];
  /** Palette indices, x fastest, then z, then y: (y * sz + z) * sx + x. */
  blocks: Uint16Array | Uint32Array;
  tiles: TileData[];
  entities: EntityData[];
}

export interface Schematic {
  /** Library key (empty until stored). */
  id: string;
  name: string;
  author: string;
  description: string;
  created: number;
  modified: number;
  /** Java Edition data version the block states are named for (always brought up to the newest on reading). */
  dataVersion: number;
  /** Where it came from: 'game' (saved here), or the file format read. */
  source: 'game' | 'litematic' | 'schem' | 'nbt' | 'schematic';
  regions: Region[];
}

export const AIR: BlockState = { name: 'minecraft:air', props: {} };

export const stateKey = (s: BlockState) => {
  const ks = Object.keys(s.props).sort();
  return ks.length ? `${s.name}[${ks.map((k) => `${k}=${s.props[k]}`).join(',')}]` : s.name;
};
/** Parse `minecraft:oak_stairs[facing=east,half=top]` (the namespace is optional). */
export function parseState(s: string): BlockState {
  const m = /^([^[\]]+)(?:\[(.*)\])?$/.exec(s.trim());
  if (!m) return { ...AIR };
  const name = m[1].includes(':') ? m[1] : 'minecraft:' + m[1];
  const props: Record<string, string> = {};
  if (m[2]) for (const part of m[2].split(',')) { const [k, v] = part.split('='); if (k && v !== undefined) props[k.trim()] = v.trim(); }
  return { name: name.toLowerCase(), props };
}
export const isAir = (s: BlockState) => s.name === 'minecraft:air' || s.name === 'minecraft:cave_air' || s.name === 'minecraft:void_air';

export const volume = (s: Vec3) => s[0] * s[1] * s[2];
export const cellIndex = (r: Region, x: number, y: number, z: number) => (y * r.size[2] + z) * r.size[0] + x;

/** The box around every region: min corner and size. */
export function bounds(s: Schematic): { min: Vec3; size: Vec3 } {
  if (!s.regions.length) return { min: [0, 0, 0], size: [0, 0, 0] };
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const r of s.regions) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], r.pos[a]); max[a] = Math.max(max[a], r.pos[a] + r.size[a]); }
  return { min, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Non-air blocks. */
export function countBlocks(s: Schematic): number {
  let n = 0;
  for (const r of s.regions) {
    const air = r.palette.map(isAir);
    for (const i of r.blocks) if (!air[i]) n++;
  }
  return n;
}

/** A region's palette indices sized for its palette. */
export function newIndices(n: number, paletteSize: number): Uint16Array | Uint32Array {
  return paletteSize > 65535 ? new Uint32Array(n) : new Uint16Array(n);
}

/** Builds a palette, one entry per distinct state. */
export class PaletteBuilder {
  readonly list: BlockState[] = [{ ...AIR }];
  private index = new Map<string, number>([[stateKey(AIR), 0]]);
  add(s: BlockState): number {
    const k = s.game ? `${stateKey(s)}|${s.game}` : stateKey(s);
    let i = this.index.get(k);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.index.set(k, i); }
    return i;
  }
}

export function emptySchematic(name: string): Schematic {
  const now = Date.now();
  return { id: '', name, author: '', description: '', created: now, modified: now, dataVersion: 0, source: 'game', regions: [] };
}
