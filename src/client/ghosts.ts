// Ghost blocks: blocks drawn into the world that aren't in it (a schematic's preview, a building's outline). A
// layer holds whole chunk columns of them; each is meshed by the world's workers like a real chunk (the same
// models, culling and textures) and drawn with the chunks, but it's only a picture: nothing collides with it, the
// aim passes through it, and the server never hears of it.
import type { Chunk, World } from '../world/world';
import type { Renderer } from '../render/renderer';
import type { MeshResult } from '../world/mesher';
import { CHUNK_H } from '../world/blocks';

const COLUMN = 16 * 16 * CHUNK_H;
const EMPTY = new Uint16Array(COLUMN);
const NO_BIOMES = new Uint8Array(256);
const key = (cx: number, cz: number) => cx * 65536 + cz;

/** Every layer (mods make theirs with `mod.client.ghostLayer()`); the client draws them all. */
export const GHOST_LAYERS: GhostLayer[] = [];

/** A column of ghost blocks, meshed and drawn like a chunk (the renderer only needs `cx`, `cz` and `mesh`). */
interface GhostColumn {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  mesh: unknown;
  /** Bumped by every change; a mesh made from an older version is thrown away when it arrives. */
  version: number;
  meshedVersion: number;
  meshing: boolean;
}

export class GhostLayer {
  /** Drawn at all (a mod's layer is also hidden while its mod is out of play). */
  visible = true;
  readonly columns = new Map<number, GhostColumn>();
  private dirty = new Set<GhostColumn>();
  /** Columns whose meshes the renderer must let go of (removed, or the layer cleared). */
  private freed: GhostColumn[] = [];
  /** `active`: whether the owner is in play (a mod's layer stops drawing while its mod is off). */
  constructor(readonly owner = '', readonly active: () => boolean = () => true) {}

  /**
   * Replace the ghost blocks of chunk column (cx, cz): packed block values (id | meta << 12) indexed like a chunk's,
   * `(y * 16 + z) * 16 + x` with x and z inside the column. Air (0) shows nothing; null removes the column.
   */
  setColumn(cx: number, cz: number, blocks: Uint16Array | null) {
    const k = key(cx, cz);
    const old = this.columns.get(k);
    if (!blocks) {
      if (!old) return;
      this.columns.delete(k);
      this.dirty.delete(old);
      this.freed.push(old);
      this.touchNeighbours(cx, cz);
      return;
    }
    if (blocks.length !== COLUMN) throw new Error(`a ghost column holds ${COLUMN} blocks, not ${blocks.length}`);
    const c = old ?? { cx, cz, blocks, mesh: null, version: 0, meshedVersion: -1, meshing: false };
    // its neighbours' faces toward it change only if its edges did
    const edges = !old || edgesDiffer(old.blocks, blocks);
    c.blocks = blocks;
    c.version++;
    this.columns.set(k, c);
    this.dirty.add(c);
    if (edges) this.touchNeighbours(cx, cz);
  }

  /** A column's ghost blocks (the array given to setColumn), if it has any. */
  column(cx: number, cz: number): Uint16Array | null {
    return this.columns.get(key(cx, cz))?.blocks ?? null;
  }

  /** Remove every column. */
  clear() {
    for (const c of this.columns.values()) this.freed.push(c);
    this.columns.clear();
    this.dirty.clear();
  }

  private touchNeighbours(cx: number, cz: number) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.columns.get(key(cx + dx, cz + dz));
        if (n) { n.version++; this.dirty.add(n); }
      }
  }

  /** Send changed columns to the workers and release the meshes of removed ones (once a frame). */
  update(world: World, renderer: Renderer) {
    for (const c of this.freed) if (c.mesh) renderer.freeChunk(c as unknown as Chunk);
    this.freed = [];
    for (const c of this.dirty) {
      if (c.meshing) continue;
      this.dirty.delete(c);
      const chunks: Uint16Array[] = [], biomes: Uint8Array[] = [];
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          chunks.push(this.columns.get(key(c.cx + dx, c.cz + dz))?.blocks ?? EMPTY);
          // grass and leaves take the colours of the real world's biomes there
          biomes.push(world.getChunk(c.cx + dx, c.cz + dz)?.biomes ?? NO_BIOMES);
        }
      c.meshing = true;
      const version = c.version;
      world.meshExtra(chunks, biomes, (r: MeshResult) => {
        c.meshing = false;
        if (this.columns.get(key(c.cx, c.cz)) !== c) { if (c.mesh) renderer.freeChunk(c as unknown as Chunk); return; }
        if (version !== c.version) { this.dirty.add(c); return; }
        renderer.uploadChunk(c as unknown as Chunk, r);
        c.meshedVersion = version;
      });
    }
  }

  /** The columns to draw (with a mesh). */
  drawList(): Chunk[] {
    if (!this.visible || !this.active()) return [];
    const out: Chunk[] = [];
    for (const c of this.columns.values()) if (c.mesh) out.push(c as unknown as Chunk);
    return out;
  }

  /** Let go of every mesh (the world is going away). */
  dispose(renderer: Renderer) {
    this.clear();
    for (const c of this.freed) if (c.mesh) renderer.freeChunk(c as unknown as Chunk);
    this.freed = [];
  }
}

/** Do two columns differ anywhere on their x or z edges? */
function edgesDiffer(a: Uint16Array, b: Uint16Array): boolean {
  for (let y = 0; y < CHUNK_H; y++) {
    const o = y * 256;
    for (let i = 0; i < 16; i++) {
      if (a[o + i] !== b[o + i] || a[o + 240 + i] !== b[o + 240 + i]) return true;
      if (a[o + i * 16] !== b[o + i * 16] || a[o + i * 16 + 15] !== b[o + i * 16 + 15]) return true;
    }
  }
  return false;
}
