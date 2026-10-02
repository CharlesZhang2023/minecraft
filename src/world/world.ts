// Main-thread world: chunk storage, streaming, worker scheduling, block access.
import { CHUNK_H, idOf, metaOf, BLOCKS, B, OPAQUE, LIGHT_OPACITY, LIGHT_EMIT } from './blocks';
import type { MeshResult } from './mesher';
import { Storage, SavedChunk, rleEncode, rleDecode } from '../game/storage';
import WorkerCtor from './worker.ts?worker&inline';
import { chunkHash } from '../net/protocol';

export const chunkKey = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
export const keyStr = (cx: number, cz: number) => cx + ',' + cz;

export interface TileEntity {
  type: 'chest' | 'furnace' | 'comparator' | 'hopper' | 'dispenser' | 'dropper' | 'brewing' | 'moving' | 'spawner';
  [k: string]: unknown;
}

export class Chunk {
  blocks!: Uint16Array;
  biomes!: Uint8Array;
  light: Uint8Array | null = null;
  heightmap: Uint8Array | null = null;
  ready = false;
  loading = false;
  dirty = true; // needs (re)mesh
  meshing = false;
  version = 0; // bumps every block change
  meshedVersion = -1;
  modified = false; // needs saving
  urgent = false;
  /** Client: the server said this chunk is untouched terrain, so we generate it ourselves from the seed. */
  localGen = false;
  /** Server: hash of the blocks as generated (only for chunks fresh from the generator). */
  genHash: number | null = null;
  /** Client: what the generated blocks must hash to (the server's copy); null = not checked. */
  expectHash: number | null = null;
  mesh: unknown = null; // owned by the renderer
  tiles = new Map<number, TileEntity>();
  lastSeen = 0;
  constructor(public cx: number, public cz: number) {}
}

type Job = { type: 'gen' | 'mesh' | 'light'; chunk: Chunk; version?: number };

export type Dimension = 'overworld' | 'nether' | 'end';

/**
 * - `server`: the simulation's world. Generates or loads chunks around every player, lights them (no meshes) and saves.
 * - `client`: what a player's screen shows. Chunks near the player arrive from the server (`receiveChunk`); farther
 *   ones the server knows are untouched, the client generates itself from the seed (`generateChunk`). Never saved.
 * - `local`: the title-screen backdrop: generates and meshes by itself, never saved.
 */
export type WorldRole = 'server' | 'client' | 'local';

/** A spot chunks are kept loaded around (each player on the server), with its radius in chunks. */
export interface LoadCenter { x: number; z: number; r: number }

export class World {
  chunks = new Map<number, Chunk>();
  private workers: { w: Worker; busy: boolean; job: Job | null }[] = [];
  private jobId = 0;
  savedKeys = new Set<string>();
  onMesh: (c: Chunk, r: MeshResult) => void = () => {};
  onUnload: (c: Chunk) => void = () => {};
  onChunkLoaded: (c: Chunk, spawns?: { type: string; x: number; y: number; z: number; data?: Record<string, unknown> }[]) => void = () => {};
  onBlockChange: (x: number, y: number, z: number, old: number, v: number) => void = () => {};
  /** A tile entity was replaced or removed (server: tell the players who have that chunk). */
  onTileChange: (x: number, y: number, z: number) => void = () => {};
  renderDistance = 8;
  centerCX = 0;
  centerCZ = 0;
  frame = 0;
  /** Only the server's world is saved. */
  get readOnly() { return this.role !== 'server'; }
  /** Server: where players are, so chunks load around all of them (set every tick). */
  centers: LoadCenter[] = [];

  constructor(public seed: number, public worldId: string, public dimension: Dimension = 'overworld', public role: WorldRole = 'server') {
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new WorkerCtor();
      const slot = { w, busy: false, job: null as Job | null };
      w.onmessage = (e) => this.onWorkerMessage(slot, e.data);
      w.onerror = (e) => console.error('worker error', e);
      this.workers.push(slot);
    }
  }

  async init() {
    if (!this.readOnly) this.savedKeys = await Storage.chunkKeys(this.worldId);
  }

  destroy() {
    for (const s of this.workers) s.w.terminate();
    this.workers = [];
  }

  // ------------------------------------------------------------------ access
  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }
  chunkAt(x: number, z: number): Chunk | undefined {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c && c.ready ? c : undefined;
  }
  isLoaded(x: number, z: number) {
    return !!this.chunkAt(Math.floor(x), Math.floor(z));
  }
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_H) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.ready) return y < 0 ? B.BEDROCK : 0;
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }
  getId(x: number, y: number, z: number) {
    return this.get(x, y, z) & 0xfff;
  }
  /** Solid (unloaded chunks count as solid so entities don't fall into the void while loading). */
  getForPhysics(x: number, y: number, z: number): number {
    // below the world is open void (the End has no bedrock floor), where living things take void damage
    if (y < 0) return 0;
    if (y >= CHUNK_H) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.ready) return B.BEDROCK;
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }
  get hasSky() {
    return this.dimension === 'overworld';
  }
  getLight(x: number, y: number, z: number): [number, number] {
    if (y >= CHUNK_H) return [this.hasSky ? 15 : 0, 0];
    if (y < 0) return [0, 0];
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.light) return [this.hasSky ? 15 : 0, 0];
    const v = c.light[(x & 15) | ((z & 15) << 4) | (y << 8)];
    return [v >> 4, v & 15];
  }
  /** Highest non-air block y at column (or -1). */
  topY(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    const lx = x & 15, lz = z & 15;
    for (let y = CHUNK_H - 1; y >= 0; y--) if (c.blocks[lx | (lz << 4) | (y << 8)] !== 0) return y;
    return -1;
  }
  /** Highest y that blocks motion or light (used for rain/snow & mob spawning). */
  topSolidY(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    const lx = x & 15, lz = z & 15;
    for (let y = CHUNK_H - 1; y >= 0; y--) {
      const id = c.blocks[lx | (lz << 4) | (y << 8)] & 0xfff;
      if (id && (BLOCKS[id].solid || BLOCKS[id].fluid || LIGHT_OPACITY[id] > 0)) return y;
    }
    return -1;
  }

  set(x: number, y: number, z: number, v: number): boolean {
    if (y < 0 || y >= CHUNK_H) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    const old = c.blocks[i];
    if (old === v) return false;
    c.blocks[i] = v;
    c.version++;
    c.modified = true;
    c.dirty = true;
    c.urgent = true;
    const oid = old & 0xfff, nid = v & 0xfff;
    // update cached heightmap/light-sensitive neighbours
    const lightChanged = LIGHT_OPACITY[oid] !== LIGHT_OPACITY[nid] || LIGHT_EMIT[oid] !== LIGHT_EMIT[nid];
    const lx = x & 15, lz = z & 15;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const near = (dx === -1 ? lx === 0 : dx === 1 ? lx === 15 : true) && (dz === -1 ? lz === 0 : dz === 1 ? lz === 15 : true);
        if (!near && !lightChanged) continue;
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (n && n.ready) {
          n.dirty = true;
          if (near) n.urgent = true;
        }
      }
    if (oid !== nid && c.tiles.has(i) && !(BLOCKS[nid].name === BLOCKS[oid].name)) c.tiles.delete(i);
    this.onBlockChange(x, y, z, old, v);
    return true;
  }

  getTile(x: number, y: number, z: number): TileEntity | undefined {
    const c = this.chunkAt(x, z);
    return c?.tiles.get((x & 15) | ((z & 15) << 4) | (y << 8));
  }
  setTile(x: number, y: number, z: number, t: TileEntity | undefined) {
    const c = this.chunkAt(x, z);
    if (!c) return;
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    if (t) c.tiles.set(i, t);
    else c.tiles.delete(i);
    c.modified = true;
    this.onTileChange(x, y, z);
  }

  // ------------------------------------------------------------------ streaming
  /** Called every frame (client / local) with the camera's position. */
  update(px: number, pz: number, frustumTest?: (cx: number, cz: number) => boolean) {
    this.updateCenters([{ x: px, z: pz, r: this.renderDistance }], frustumTest);
  }

  /** Squared chunk distance to the nearest center, measured against that center's radius (< 0 = inside). */
  private nearest(cx: number, cz: number, centers: { cx: number; cz: number; r: number }[]) {
    let best = Infinity, slack = Infinity;
    for (const c of centers) {
      const dx = cx - c.cx, dz = cz - c.cz, d = dx * dx + dz * dz;
      if (d < best) best = d;
      const s = Math.sqrt(d) - c.r;
      if (s < slack) slack = s;
    }
    return { d: best, slack };
  }

  /** Keep chunks loaded around every center (the server passes one per player). */
  updateCenters(centers: LoadCenter[], frustumTest?: (cx: number, cz: number) => boolean) {
    this.frame++;
    const cs = centers.map((c) => ({ cx: Math.floor(c.x / 16), cz: Math.floor(c.z / 16), r: c.r }));
    if (!cs.length) return;
    this.centerCX = cs[0].cx;
    this.centerCZ = cs[0].cz;
    // the client only holds what the server sent it (and drops it when told)
    if (this.role !== 'client') {
      // ensure chunk objects exist
      for (const ctr of cs) {
        const loadR = ctr.r + 1;
        for (let dz = -loadR; dz <= loadR; dz++)
          for (let dx = -loadR; dx <= loadR; dx++) {
            if (dx * dx + dz * dz > (loadR + 0.5) * (loadR + 0.5)) continue;
            const cx = ctr.cx + dx, cz = ctr.cz + dz;
            const k = chunkKey(cx, cz);
            let c = this.chunks.get(k);
            if (!c) {
              c = new Chunk(cx, cz);
              this.chunks.set(k, c);
            }
            c.lastSeen = this.frame;
          }
      }
      // unload far chunks
      if (this.frame % 30 === 0) {
        const toSave: [string, SavedChunk][] = [];
        for (const [k, c] of this.chunks) {
          if (this.nearest(c.cx, c.cz, cs).slack > 3 && !c.meshing && !c.loading && this.canUnload(c)) {
            if (c.modified && c.ready) toSave.push([keyStr(c.cx, c.cz), this.serialize(c)]);
            this.onUnload(c);
            this.chunks.delete(k);
          }
        }
        if (toSave.length && !this.readOnly) {
          for (const [k] of toSave) this.savedKeys.add(k);
          Storage.saveChunks(this.worldId, toSave);
        }
      }
    }
    this.schedule(cs, frustumTest);
  }

  /** Server hook: chunks a player was sent stay loaded until that player lets go of them. */
  canUnload: (c: Chunk) => boolean = () => true;

  /** Client: a chunk arrived from the server (replacing any copy we had). */
  receiveChunk(cx: number, cz: number, blocks: Uint16Array, biomes: Uint8Array, tiles?: [number, TileEntity][]) {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(k, c);
    }
    c.tiles.clear();
    c.version++;
    c.urgent = true;
    c.localGen = false;
    this.acceptChunk(c, blocks, biomes, tiles);
  }

  /** Client: generate this chunk ourselves (the server says it's still exactly what the seed makes). */
  generateChunk(cx: number, cz: number, hash: number | null = null) {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (c?.ready || c?.loading) return;
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(k, c);
    }
    c.localGen = true;
    c.expectHash = hash;
  }

  /** Client: terrain we generated came out different from the server's (another browser's maths): ask for it. */
  onGenMismatch: (cx: number, cz: number) => void = () => {};

  /** Client: the server stopped tracking a chunk for us. */
  dropChunk(cx: number, cz: number) {
    const k = chunkKey(cx, cz), c = this.chunks.get(k);
    if (!c) return;
    this.onUnload(c);
    this.chunks.delete(k);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(cx + dx, cz + dz);
        if (n && n.ready && n !== c) n.dirty = true;
      }
  }

  private schedule(cs: { cx: number; cz: number; r: number }[], frustumTest?: (cx: number, cz: number) => boolean) {
    const idle = this.workers.filter((w) => !w.busy);
    if (!idle.length) return;
    const genCands: [number, Chunk][] = [];
    const meshCands: [number, Chunk][] = [];
    for (const c of this.chunks.values()) {
      const near = this.nearest(c.cx, c.cz, cs);
      let d = near.d;
      if (!c.ready) {
        if (!c.loading && (this.role !== 'client' || c.localGen)) genCands.push([d, c]);
        continue;
      }
      if (!c.dirty || c.meshing) continue;
      if (near.slack > 0.5) continue;
      if (!this.neighborsReady(c)) continue;
      if (c.urgent) d = -1000 + d;
      else if (frustumTest && !frustumTest(c.cx, c.cz)) d += 400;
      meshCands.push([d, c]);
    }
    meshCands.sort((a, b) => a[0] - b[0]);
    genCands.sort((a, b) => a[0] - b[0]);
    let mi = 0, gi = 0;
    for (const slot of idle) {
      // urgent meshes first, then alternate: nearer of gen vs mesh
      const m = meshCands[mi], g = genCands[gi];
      if (m && (m[0] < 0 || !g || m[0] <= g[0] + 2)) {
        mi++;
        this.startMesh(slot, m[1]);
      } else if (g) {
        gi++;
        this.startGen(slot, g[1]);
      } else break;
    }
  }

  neighborsReady(c: Chunk) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (!n || !n.ready) return false;
      }
    return true;
  }

  private startGen(slot: { w: Worker; busy: boolean; job: Job | null }, c: Chunk) {
    c.loading = true;
    const ks = keyStr(c.cx, c.cz);
    if (this.savedKeys.has(ks)) {
      // load from disk asynchronously (doesn't occupy the worker)
      Storage.loadChunk(this.worldId, ks).then((saved) => {
        if (saved) this.acceptChunk(c, rleDecode(saved.blocks, 16 * 16 * CHUNK_H), saved.biomes, saved.tiles as [number, TileEntity][] | undefined);
        else {
          this.savedKeys.delete(ks);
          c.loading = false;
        }
      });
      return;
    }
    slot.busy = true;
    slot.job = { type: 'gen', chunk: c };
    slot.w.postMessage({ type: 'gen', id: ++this.jobId, seed: this.seed, cx: c.cx, cz: c.cz, dim: this.dimension });
  }

  private startMesh(slot: { w: Worker; busy: boolean; job: Job | null }, c: Chunk) {
    const chunks: Uint16Array[] = [];
    const biomes: Uint8Array[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz)!;
        chunks.push(n.blocks);
        biomes.push(n.biomes);
      }
    c.meshing = true;
    c.dirty = false;
    c.urgent = false;
    slot.busy = true;
    // the server only needs light (mob spawning, crops, snow); meshes are for screens
    const type = this.role === 'server' ? 'light' : 'mesh';
    slot.job = { type, chunk: c, version: c.version };
    if (type === 'light') slot.w.postMessage({ type, id: ++this.jobId, cx: c.cx, cz: c.cz, chunks, sky: this.hasSky });
    else slot.w.postMessage({ type, id: ++this.jobId, cx: c.cx, cz: c.cz, chunks, biomes, sky: this.hasSky });
  }

  private acceptChunk(c: Chunk, blocks: Uint16Array, biomes: Uint8Array, tiles?: [number, TileEntity][], spawns?: { type: string; x: number; y: number; z: number; data?: Record<string, unknown> }[]) {
    // server: a fresh chunk's fingerprint, so clients can generate it themselves and check
    if (this.role === 'server' && !this.savedKeys.has(keyStr(c.cx, c.cz))) c.genHash = chunkHash(blocks);
    c.blocks = blocks;
    c.biomes = biomes;
    c.ready = true;
    c.loading = false;
    c.dirty = true;
    if (tiles) for (const [i, t] of tiles) c.tiles.set(i, t);
    // neighbours may now be meshable (their border lighting changes too)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(c.cx + dx, c.cz + dz);
        if (n && n.ready && n !== c) n.dirty = true;
      }
    // chests generated in dungeons get loot; fresh chunks may spawn structure inhabitants
    this.onChunkLoaded(c, spawns);
  }

  private onWorkerMessage(slot: { w: Worker; busy: boolean; job: Job | null }, d: { type: string; cx: number; cz: number } & Record<string, unknown>) {
    const job = slot.job!;
    slot.busy = false;
    slot.job = null;
    const c = job.chunk;
    if (d.type === 'gen') {
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) return; // unloaded meanwhile
      if (!c.loading) return; // the server sent the real thing while we were generating
      if (c.expectHash !== null && chunkHash(d.blocks as Uint16Array) !== c.expectHash) {
        c.loading = false;
        c.localGen = false;
        this.onGenMismatch(c.cx, c.cz);
        return;
      }
      this.acceptChunk(c, d.blocks as Uint16Array, d.biomes as Uint8Array, undefined, d.spawns as { type: string; x: number; y: number; z: number }[]);
      c.modified = !!(d.spawns as unknown[] | undefined)?.length; // remember that inhabitants were spawned
    } else if (d.type === 'mesh' || d.type === 'light') {
      c.meshing = false;
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) return;
      const r = d as unknown as MeshResult;
      c.light = r.light;
      c.heightmap = r.heightmap;
      c.meshedVersion = job.version!;
      if (d.type === 'mesh') this.onMesh(c, r);
    }
  }

  serialize(c: Chunk): SavedChunk {
    return { blocks: rleEncode(c.blocks), biomes: c.biomes, tiles: [...c.tiles.entries()] };
  }

  /** Persist all modified chunks. */
  saveAll(): Promise<void> {
    if (this.readOnly) return Promise.resolve();
    const list: [string, SavedChunk][] = [];
    for (const c of this.chunks.values())
      if (c.ready && c.modified) {
        const k = keyStr(c.cx, c.cz);
        list.push([k, this.serialize(c)]);
        this.savedKeys.add(k);
        c.modified = false;
      }
    return Storage.saveChunks(this.worldId, list).then(() => undefined);
  }

  /** Fraction of chunks near the spawn that are ready+meshed (loading screen). */
  loadProgress(px: number, pz: number, radius: number): number {
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    let total = 0, done = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        total++;
        const c = this.getChunk(pcx + dx, pcz + dz);
        if (c && c.ready && c.meshedVersion >= 0) done++;
      }
    return done / total;
  }

  isOpaque(x: number, y: number, z: number) {
    return OPAQUE[this.getId(x, y, z)] === 1;
  }
  meta(x: number, y: number, z: number) {
    return metaOf(this.get(x, y, z));
  }
  id(x: number, y: number, z: number) {
    return idOf(this.get(x, y, z));
  }
}
