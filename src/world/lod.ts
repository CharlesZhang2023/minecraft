// Distant terrain manager: decides which low-detail tiles cover the land around the player, has them built from the
// world seed in its own workers (nothing is streamed from a server), keeps the results, and hands the renderer the
// meshes to draw. The renderer never sees anything but meshes.
//
// Tiles form a quadtree: a tile is split into four finer ones while the player is close to it compared with its size,
// so detail falls off with distance (2-block cells nearby, then 4, 8, 16...). Full chunks are drawn on top of all this
// near the player; the renderer hides the distant terrain wherever a real chunk is shown.
import { LOD_LEVELS, lodTileSize, lodCell, type LodPalette } from './lodgen';
import WorkerCtor from './lodworker.ts?worker&inline';

/** Where the renderer puts a tile's mesh: upload a vertex buffer, and free it again. */
export interface LodSink {
  upload(data: ArrayBuffer, opaque: number): unknown;
  free(mesh: unknown): void;
}

/** A tile ready to draw. */
export interface LodDraw {
  mesh: unknown;
  x: number; // world position of its corner
  z: number;
  size: number; // blocks across
  cell: number; // blocks per cell
  minY: number;
  maxY: number;
  opaque: number; // quads of ground, then `water` quads of water surface
  water: number;
}

interface Tile extends LodDraw {
  key: string;
  level: number;
  tx: number;
  tz: number;
  ready: boolean;
  bytes: number;
  used: number; // frame it was last wanted
}

interface Want { level: number; tx: number; tz: number; key: string; d: number }

const keyOf = (level: number, tx: number, tz: number) => level + ':' + tx + ':' + tz;
/** Does quadtree tile a contain tile b (or is it b)? */
const contains = (a: { level: number; tx: number; tz: number }, b: { level: number; tx: number; tz: number }) =>
  a.level >= b.level && b.tx >> (a.level - b.level) === a.tx && b.tz >> (a.level - b.level) === a.tz;

export class LodManager {
  private tiles = new Map<string, Tile>();
  private workers: { w: Worker; busy: number }[] = [];
  private drawn: Tile[] = [];
  private frame = 0;
  private last = { x: 1e9, z: 1e9, range: 0, detail: 0, near: 0 };
  private dirty = true;
  bytes = 0;
  pending = 0;
  wanted = 0;

  constructor(public readonly seed: number, palette: LodPalette, private sink: LodSink) {
    const n = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 3)));
    for (let i = 0; i < n; i++) {
      const w = new WorkerCtor();
      const slot = { w, busy: 0 };
      w.onmessage = (e) => { slot.busy--; this.arrived(e.data); };
      w.onerror = (e) => console.error('LOD worker error', e);
      w.postMessage({ type: 'init', seed, palette });
      this.workers.push(slot);
    }
  }

  /**
   * Called every frame. `range`: how far distant terrain reaches (blocks); `detail`: how close (in tile sizes) the
   * player must be before a tile splits into finer ones; `near`: radius (blocks) the full chunks are expected to cover,
   * so tiles hidden under them are built last.
   */
  update(px: number, pz: number, range: number, detail: number, near: number) {
    this.frame++;
    const L = this.last;
    if (this.dirty || Math.abs(px - L.x) > 8 || Math.abs(pz - L.z) > 8 || range !== L.range || detail !== L.detail || near !== L.near) {
      this.last = { x: px, z: pz, range, detail, near };
      this.dirty = false;
      this.select(px, pz, range, detail, near);
    }
    for (const t of this.drawn) t.used = this.frame;
  }

  /** The tiles to draw this frame. */
  draws(): readonly LodDraw[] {
    return this.drawn;
  }

  private select(px: number, pz: number, range: number, detail: number, near: number) {
    // the quadtree: the coarsest tiles around the player, split while close
    const want: Want[] = [];
    const top = LOD_LEVELS - 1, T = lodTileSize(top);
    const visit = (level: number, tx: number, tz: number) => {
      const size = lodTileSize(level), x0 = tx * size, z0 = tz * size;
      const dx = Math.max(x0 - px, 0, px - (x0 + size)), dz = Math.max(z0 - pz, 0, pz - (z0 + size));
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      if (level > 0 && d < detail * size) {
        for (let k = 0; k < 4; k++) visit(level - 1, tx * 2 + (k & 1), tz * 2 + (k >> 1));
      } else want.push({ level, tx, tz, key: keyOf(level, tx, tz), d });
    };
    for (let tz = Math.floor((pz - range) / T); tz <= Math.floor((pz + range) / T); tz++)
      for (let tx = Math.floor((px - range) / T); tx <= Math.floor((px + range) / T); tx++) visit(top, tx, tz);
    this.wanted = want.length;

    // draw what's ready; where a wanted tile isn't, keep showing whatever covered that ground before (a coarser tile
    // around it, or the finer ones inside it), so moving never opens holes
    const ready: Tile[] = [], missing: Want[] = [];
    for (const w of want) {
      const t = this.tiles.get(w.key);
      if (t?.ready) { t.used = this.frame; ready.push(t); }
      else missing.push(w);
    }
    const keep = new Set<Tile>();
    for (const m of missing) for (const p of this.drawn) if (contains(p, m) || contains(m, p)) keep.add(p);
    const drawn = [...keep];
    for (const t of ready) if (!drawn.some((p) => p.level > t.level && contains(p, t))) drawn.push(t);
    this.drawn = drawn;
    for (const t of drawn) t.used = this.frame;

    // build the missing ones, those that will show first (not under the full chunks), nearest first
    const queue = missing.filter((m) => !this.tiles.has(m.key));
    const hidden = (w: Want) => {
      const size = lodTileSize(w.level), x0 = w.tx * size, z0 = w.tz * size;
      const fx = Math.max(Math.abs(x0 - px), Math.abs(x0 + size - px)), fz = Math.max(Math.abs(z0 - pz), Math.abs(z0 + size - pz));
      return Math.hypot(fx, fz) < near;
    };
    queue.sort((a, b) => (hidden(a) ? 1e7 : 0) + a.d - ((hidden(b) ? 1e7 : 0) + b.d));
    this.queue = queue;
    this.pump();
    this.evict(want.length);
  }

  private queue: Want[] = [];

  /** Keep every worker busy with up to two tiles. */
  private pump() {
    for (const slot of this.workers) {
      while (slot.busy < 2 && this.queue.length) {
        const w = this.queue.shift()!;
        if (this.tiles.has(w.key)) continue;
        const size = lodTileSize(w.level);
        this.tiles.set(w.key, {
          key: w.key, level: w.level, tx: w.tx, tz: w.tz, ready: false, bytes: 0, used: this.frame,
          mesh: null, x: w.tx * size, z: w.tz * size, size, cell: lodCell(w.level), minY: 0, maxY: 256, opaque: 0, water: 0,
        });
        slot.busy++;
        slot.w.postMessage({ type: 'tile', key: w.key, level: w.level, tx: w.tx, tz: w.tz });
      }
    }
    this.pending = [...this.tiles.values()].filter((t) => !t.ready).length;
  }

  private arrived(m: { key: string; data: ArrayBuffer; opaque: number; water: number; minY: number; maxY: number }) {
    const t = this.tiles.get(m.key);
    if (!t || !this.workers.length) return;
    t.ready = true;
    t.opaque = m.opaque;
    t.water = m.water;
    t.minY = m.minY;
    t.maxY = m.maxY;
    t.bytes = m.data.byteLength;
    t.mesh = t.bytes ? this.sink.upload(m.data, m.opaque) : null;
    this.bytes += t.bytes;
    this.dirty = true;
    this.pump();
  }

  /** Forget the tiles nobody has wanted for longest once there are clearly more than needed. */
  private evict(wanted: number) {
    const cap = wanted * 2 + 64;
    if (this.tiles.size <= cap) return;
    const old = [...this.tiles.values()].filter((t) => t.ready && t.used < this.frame).sort((a, b) => a.used - b.used);
    for (const t of old.slice(0, this.tiles.size - cap)) this.drop(t);
  }

  private drop(t: Tile) {
    if (t.mesh) this.sink.free(t.mesh);
    this.bytes -= t.bytes;
    this.tiles.delete(t.key);
  }

  destroy() {
    for (const s of this.workers) s.w.terminate();
    this.workers = [];
    for (const t of [...this.tiles.values()]) this.drop(t);
    this.drawn = [];
    this.queue = [];
  }
}
