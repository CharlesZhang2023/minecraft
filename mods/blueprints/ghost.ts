// The schematic in the world: every chunk column a placement reaches is compared with the world there. Blocks
// still to be placed become ghost blocks (drawn by the game's own mesher), and every difference is remembered for
// the highlights and the verifier: missing, wrong block, wrong state (same block turned or set differently),
// extra (something where the schematic has air) and unknown (a block this game doesn't have).
// Columns are checked again when their chunk changes, a few each tick, nearest first.
import type { Client, GhostLayer } from '../sdk';
import { state, layerShows, worldKey, load } from './state';
import { SKIP, UNKNOWN, type Placement } from './placement';
import { canonical, isFree } from './blocks';

export const enum Mark { Missing = 1, WrongBlock, WrongState, Extra, Unknown }
export interface Counts { missing: number; wrongBlock: number; wrongState: number; extra: number; unknown: number; correct: number }
const zero = (): Counts => ({ missing: 0, wrongBlock: 0, wrongState: 0, extra: 0, unknown: 0, correct: 0 });

interface Column {
  cx: number; cz: number;
  /** The chunk's version and the setup this was worked out for. */
  chunkVersion: number;
  setup: string;
  counts: Counts;
  /** Differences: cell index in the column (y * 256 + z * 16 + x) | kind << 16. */
  marks: Int32Array;
  /** Blocks already right, by the block wanted (for what's left on the material list). */
  done: Map<number, number>;
}

const COLUMN = 16 * 16 * 256;
const key = (cx: number, cz: number) => cx * 65536 + cz;
let layer: GhostLayer | null = null;
let unknownBlock = () => 0;
const columns = new Map<number, Column>();
/** Changes the client's world can't tell us about (the placements, the layers): part of every column's setup. */
let setupKey = '';
let loading: Promise<void> | null = null;

export function initGhosts(l: GhostLayer, unknown: () => number) {
  layer = l;
  unknownBlock = unknown;
}

export function allColumns() { return columns.values(); }

/** The verifier's totals over every checked column. */
export function totals(): Counts & { columns: number; unchecked: number } {
  const t = { ...zero(), columns: 0, unchecked: 0 };
  for (const c of columns.values()) {
    t.columns++;
    for (const k of Object.keys(c.counts) as (keyof Counts)[]) t[k] += c.counts[k];
  }
  t.unchecked = wanted.size - columns.size;
  return t;
}

/** Forget everything (the world changed). */
export function resetGhosts() {
  columns.clear();
  wanted.clear();
  layer?.clear();
}

/** Columns the placements reach that are loaded here (worked out each tick). */
const wanted = new Map<number, [number, number]>();

export function tickGhosts(client: Client) {
  const k = worldKey(client);
  if (k !== state.key && !loading) {
    resetGhosts();
    loading = load(k).finally(() => { loading = null; });
  }
  if (loading || !client.world || !layer) return;
  const w = client.world;
  const setup = `${state.placements.map((p) => `${p.data.id}:${p.version}:${p.data.visible}`).join(',')}|${state.layer.mode}:${state.layer.y}|${state.ghosts}`;
  if (setup !== setupKey) setupKey = setup;
  // the columns to check: those the visible placements reach, loaded here
  wanted.clear();
  const pcx = Math.floor(client.player!.x) >> 4, pcz = Math.floor(client.player!.z) >> 4;
  const reach = w.renderDistance + 1;
  const vis = state.placements.filter((p) => p.data.visible);
  for (const p of vis) {
    for (let cx = Math.max(p.min[0] >> 4, pcx - reach); cx <= Math.min(p.max[0] >> 4, pcx + reach); cx++)
      for (let cz = Math.max(p.min[2] >> 4, pcz - reach); cz <= Math.min(p.max[2] >> 4, pcz + reach); cz++)
        if (w.getChunk(cx, cz)?.ready) wanted.set(key(cx, cz), [cx, cz]);
  }
  for (const [kk, c] of columns) if (!wanted.has(kk)) { columns.delete(kk); layer.setColumn(c.cx, c.cz, null); }
  // stale columns, nearest first, within a time budget
  const stale: [number, number, number][] = [];
  for (const [kk, [cx, cz]] of wanted) {
    const ch = w.getChunk(cx, cz)!;
    const c = columns.get(kk);
    if (c && c.chunkVersion === ch.version && c.setup === setupKey) continue;
    stale.push([(cx - pcx) ** 2 + (cz - pcz) ** 2, cx, cz]);
  }
  stale.sort((a, b) => a[0] - b[0]);
  const t0 = performance.now();
  for (const [, cx, cz] of stale) {
    check(client, cx, cz, vis);
    if (performance.now() - t0 > 6) break;
  }
}

function check(client: Client, cx: number, cz: number, vis: Placement[]) {
  const ch = client.world!.getChunk(cx, cz)!;
  const wb = ch.blocks;
  let ghost: Uint16Array | null = null;
  const counts = zero();
  const marks: number[] = [];
  const done = new Map<number, number>();
  const unknown = unknownBlock();
  for (const p of vis) {
    if (!p.overlaps(cx, cz)) continue;
    const x0 = Math.max(p.min[0], cx * 16), x1 = Math.min(p.max[0], cx * 16 + 15);
    const z0 = Math.max(p.min[2], cz * 16), z1 = Math.min(p.max[2], cz * 16 + 15);
    const y0 = Math.max(p.min[1], 0), y1 = Math.min(p.max[1], 255);
    for (let y = y0; y <= y1; y++) {
      const shown = layerShows(y);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const want = p.at(x, y, z);
          if (want === SKIP) continue;
          const i = (y * 16 + (z & 15)) * 16 + (x & 15);
          const have = wb[i];
          let mark = 0;
          if (want === 0) { if (!isFree(have)) mark = Mark.Extra; }
          else if (want === UNKNOWN) {
            mark = Mark.Unknown;
            if (isFree(have) && shown && state.ghosts && unknown) (ghost ??= new Uint16Array(COLUMN))[i] = unknown;
          } else if (isFree(have)) {
            mark = Mark.Missing;
            if (shown && state.ghosts) (ghost ??= new Uint16Array(COLUMN))[i] = want;
          } else if (canonical(have) === canonical(want)) { counts.correct++; done.set(want, (done.get(want) ?? 0) + 1); }
          else mark = (have & 0xfff) === (want & 0xfff) || canonical(have).split('[')[0] === canonical(want).split('[')[0] ? Mark.WrongState : Mark.WrongBlock;
          if (!mark) continue;
          marks.push(i | (mark << 16));
          if (mark === Mark.Missing) counts.missing++;
          else if (mark === Mark.WrongBlock) counts.wrongBlock++;
          else if (mark === Mark.WrongState) counts.wrongState++;
          else if (mark === Mark.Extra) counts.extra++;
          else counts.unknown++;
        }
    }
  }
  columns.set(key(cx, cz), { cx, cz, chunkVersion: ch.version, setup: setupKey, counts, marks: Int32Array.from(marks), done });
  layer!.setColumn(cx, cz, ghost);
}

/** Blocks already right, by block wanted, over the checked columns. */
export function doneByBlock(): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of columns.values()) for (const [v, n] of c.done) out.set(v, (out.get(v) ?? 0) + n);
  return out;
}

/** Every difference near a point (for the verifier's list), nearest first. */
export function nearbyMarks(x: number, y: number, z: number, limit: number): { x: number; y: number; z: number; kind: Mark; d: number }[] {
  const out: { x: number; y: number; z: number; kind: Mark; d: number }[] = [];
  for (const c of columns.values()) {
    for (const m of c.marks) {
      const i = m & 0xffff, kind = (m >> 16) as Mark;
      const bx = c.cx * 16 + (i & 15), bz = c.cz * 16 + ((i >> 4) & 15), by = i >> 8;
      out.push({ x: bx, y: by, z: bz, kind, d: (bx - x) ** 2 + (by - y) ** 2 + (bz - z) ** 2 });
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, limit);
}

/** The ghost block a ray from the eye meets first within reach (stopping at the world's blocks), for easy placing. */
export function ghostAlong(client: Client, ex: number, ey: number, ez: number, dx: number, dy: number, dz: number, reach: number): { x: number; y: number; z: number; v: number } | null {
  const w = client.world!;
  let x = Math.floor(ex), y = Math.floor(ey), z = Math.floor(ez);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tx = sx ? (sx > 0 ? x + 1 - ex : ex - x) * tdx : Infinity;
  let ty = sy ? (sy > 0 ? y + 1 - ey : ey - y) * tdy : Infinity;
  let tz = sz ? (sz > 0 ? z + 1 - ez : ez - z) * tdz : Infinity;
  for (let t = 0; t <= reach;) {
    const have = w.get(x, y, z);
    if (!isFree(have)) return null;
    if (layerShows(y)) {
      for (let k = state.placements.length - 1; k >= 0; k--) {
        const p = state.placements[k];
        if (!p.data.visible) continue;
        const v = p.at(x, y, z);
        if (v > 0) return { x, y, z, v };
        if (v !== SKIP) break;
      }
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}
