// Structure blocks (1.10): in save mode one copies a box of the world (blocks, their tiles and, if asked, entities)
// into a named structure kept with the world; in load mode one places a saved structure (turned, mirrored, with
// some blocks left out by its integrity); corner blocks mark a box for the save block's Detect; data blocks carry a
// marker for whoever generates the structure. Redstone saves or loads. Structure voids in the box are left out, so
// loading keeps what's there. Templates are shared with jigsaw generation (jigsaw.ts).
import type { Game } from './game';
import type { Entity } from '../entity/entity';
import { BLOCKS, STRUCTURE_BLOCK, STRUCTURE_MODES, STRUCTURE_VOID, idOf, metaOf } from '../world/blocks';
import type { World } from '../world/world';
import type { WorldMeta } from './storage';
import { mirrorBlock, rotateBlock } from '../agent/blockspec';
import { bbox, type BBox } from '../world/structure';
import { Random } from '../noise';

export interface StructureTile {
  type: 'structure';
  name: string;
  author: string;
  /** The box: its corner relative to the block, and its size. */
  pos: [number, number, number];
  size: [number, number, number];
  /** Load settings: quarter turns clockwise, mirror (0 none, 1 left-right = z flipped, 2 front-back = x flipped). */
  rotation: number;
  mirror: number;
  entities: boolean;
  showBox: boolean;
  integrity: number;
  seed: number;
  /** Data mode: the marker's text. */
  data: string;
  powered: boolean;
}
export const MAX_SIZE = 48;
export const [SAVE, LOAD, CORNER, DATA] = [0, 1, 2, 3];

export function structureTile(w: World, x: number, y: number, z: number): StructureTile {
  const t = w.getTile(x, y, z) as unknown as StructureTile | undefined;
  if (t?.type === 'structure') return t;
  const n: StructureTile = { type: 'structure', name: '', author: '', pos: [0, 1, 0], size: [0, 0, 0], rotation: 0, mirror: 0, entities: false, showBox: true, integrity: 1, seed: 0, data: '', powered: false };
  w.setTile(x, y, z, n as never);
  return n;
}
/** Structure names are namespaced like vanilla's (`house` is `minecraft:house`). */
export function normName(s: string): string {
  const n = s.trim().toLowerCase();
  if (!n) return '';
  return n.includes(':') ? n : 'minecraft:' + n;
}
export const validName = (s: string) => /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(s);

/** Where template cell (x, z) lands, the template's corner staying put: mirrored first, then turned clockwise. */
export function cellTransform(x: number, z: number, mirror: number, q: number): [number, number] {
  if (mirror === 1) z = -z;
  else if (mirror === 2) x = -x;
  switch (q & 3) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
  }
  return [x, z];
}
/** A block state carried through the same mirror and turn. */
export const blockTransform = (v: number, mirror: number, q: number) => rotateBlock(mirrorBlock(v, mirror === 1 ? 'z' : mirror === 2 ? 'x' : null), q);

/** The box a structure block shows (save: what it would save; load: where its structure would go), or null. */
export function structureBox(t: StructureTile, x: number, y: number, z: number, mode: number): BBox | null {
  const [sx, sy, sz] = t.size;
  if (sx <= 0 || sy <= 0 || sz <= 0 || (mode !== SAVE && mode !== LOAD)) return null;
  const ox = x + t.pos[0], oy = y + t.pos[1], oz = z + t.pos[2];
  if (mode === SAVE) return bbox(ox, oy, oz, ox + sx - 1, oy + sy - 1, oz + sz - 1);
  const a = cellTransform(0, 0, t.mirror, t.rotation), b = cellTransform(sx - 1, sz - 1, t.mirror, t.rotation);
  return bbox(ox + a[0], oy, oz + a[1], ox + b[0], oy + sy - 1, oz + b[1]);
}

// ------------------------------------------------------------------ templates kept with the world
export interface Template {
  size: [number, number, number];
  /** Packed blocks per cell (x fastest, then z, then y); -1 = a structure void (left alone). */
  blocks: Int32Array;
  tiles: Map<number, unknown>;
  /** Entities, their positions relative to the template's corner. */
  entities: Record<string, unknown>[];
  author: string;
}
interface Stored { size: [number, number, number]; palette: number[]; cells: string; tiles: [number, unknown][]; entities: Record<string, unknown>[]; author: string }
type StructMeta = WorldMeta & { structures?: Record<string, Stored> };
const cache = new WeakMap<object, Map<string, Template>>();

function encode(a: Uint16Array): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return btoa(s);
}
function decode(s: string, n: number): Uint16Array {
  const b = atob(s), out = new Uint8Array(n * 2);
  for (let i = 0; i < b.length && i < out.length; i++) out[i] = b.charCodeAt(i);
  return new Uint16Array(out.buffer);
}
const metaOfGame = (g: Game) => g.meta as StructMeta | null;

/** A saved structure by name (null if there's none). */
export function getTemplate(g: Game, name: string): Template | null {
  const meta = metaOfGame(g);
  if (!meta) return null;
  let c = cache.get(meta);
  if (!c) cache.set(meta, (c = new Map()));
  const hit = c.get(name);
  if (hit) return hit;
  const st = meta.structures?.[name];
  if (!st) return null;
  const n = st.size[0] * st.size[1] * st.size[2], idx = decode(st.cells, n);
  const blocks = new Int32Array(n);
  for (let i = 0; i < n; i++) blocks[i] = idx[i] === 0xffff ? -1 : st.palette[idx[i]] ?? 0;
  const t: Template = { size: st.size, blocks, tiles: new Map(st.tiles), entities: st.entities ?? [], author: st.author ?? '' };
  c.set(name, t);
  return t;
}
/** Every saved structure's name. */
export const templateNames = (g: Game): string[] => Object.keys(metaOfGame(g)?.structures ?? {});

function putTemplate(g: Game, name: string, t: Template) {
  const meta = metaOfGame(g)!;
  const palette: number[] = [], index = new Map<number, number>(), cells = new Uint16Array(t.blocks.length);
  for (let i = 0; i < t.blocks.length; i++) {
    const v = t.blocks[i];
    if (v < 0) { cells[i] = 0xffff; continue; }
    let k = index.get(v);
    if (k === undefined) { k = palette.length; palette.push(v); index.set(v, k); }
    cells[i] = k;
  }
  (meta.structures ??= {})[name] = { size: t.size, palette, cells: encode(cells), tiles: [...t.tiles], entities: t.entities, author: t.author };
  let c = cache.get(meta);
  if (!c) cache.set(meta, (c = new Map()));
  c.set(name, t);
}

// ------------------------------------------------------------------ save / load / detect
/** Copy the box into a template. */
export function captureTemplate(g: Game, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, withEntities: boolean, author: string): Template {
  const w = g.world!, n = sx * sy * sz;
  const blocks = new Int32Array(n), tiles = new Map<number, unknown>();
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = x + sx * (z + sz * y), v = w.get(ox + x, oy + y, oz + z);
    if (idOf(v) === STRUCTURE_VOID) { blocks[i] = -1; continue; }
    blocks[i] = v;
    const t = w.getTile(ox + x, oy + y, oz + z);
    if (t) tiles.set(i, structuredClone(t));
  }
  const entities: Record<string, unknown>[] = [];
  if (withEntities) for (const e of g.entities) {
    const m = e as unknown as { persist?: boolean; toJSON?(): Record<string, unknown> };
    if (e.removed || !m.persist || !m.toJSON || g.playerOf(e)) continue;
    if (e.x < ox || e.y < oy || e.z < oz || e.x >= ox + sx || e.y >= oy + sy || e.z >= oz + sz) continue;
    const d = structuredClone(m.toJSON());
    for (const [k, o] of [['x', ox], ['y', oy], ['z', oz], ['bx', ox], ['by', oy], ['bz', oz]] as const) if (typeof d[k] === 'number') d[k] = (d[k] as number) - o;
    entities.push(d);
  }
  return { size: [sx, sy, sz], blocks, tiles, entities, author };
}

export interface PlaceOptions {
  mirror?: number;
  rotation?: number;
  integrity?: number;
  seed?: number;
  entities?: boolean;
  /** Swap or skip blocks as they go in (jigsaw generation: markers, final states). */
  onBlock?: (v: number, x: number, y: number, z: number, tile: unknown) => number | null;
}
/** Place a template with its corner at (ox, oy, oz). Returns how many blocks were set. */
export function placeTemplate(g: Game, t: Template, ox: number, oy: number, oz: number, o: PlaceOptions = {}): number {
  const w = g.world!, tk = g.ticker!, [sx, sy, sz] = t.size;
  const mirror = o.mirror ?? 0, q = o.rotation ?? 0, integrity = o.integrity ?? 1;
  const rng = o.seed ? new Random(o.seed) : null;
  const rand = () => (rng ? rng.next() : Math.random());
  const placed: [number, number, number][] = [];
  tk.suppress = true;
  try {
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const i = x + sx * (z + sz * y);
      let v = t.blocks[i];
      if (v < 0) continue;
      if (integrity < 1 && rand() > integrity) continue;
      const [dx, dz] = cellTransform(x, z, mirror, q);
      const wx = ox + dx, wy = oy + y, wz = oz + dz;
      v = blockTransform(v, mirror, q);
      const tile = t.tiles.get(i);
      if (o.onBlock) { const n = o.onBlock(v, wx, wy, wz, tile); if (n === null) continue; v = n; }
      if (w.getTile(wx, wy, wz)) w.setTile(wx, wy, wz, undefined);
      w.set(wx, wy, wz, v);
      if (tile && idOf(w.get(wx, wy, wz)) === idOf(v)) w.setTile(wx, wy, wz, structuredClone(tile) as never);
      placed.push([wx, wy, wz]);
    }
  } finally { tk.suppress = false; }
  for (const [x, y, z] of placed) if (idOf(w.get(x, y, z))) tk.neighborChanged(x, y, z);
  if (o.entities) for (const d0 of t.entities) {
    const d = structuredClone(d0) as Record<string, number | string | unknown>;
    const at = (px: number, pz: number) => { const [a, b] = cellTransform(px - 0.5, pz - 0.5, mirror, q); return [a + 0.5, b + 0.5]; };
    const [px, pz] = at(d.x as number, d.z as number);
    d.x = ox + px; d.y = oy + (d.y as number); d.z = oz + pz;
    if (typeof d.bx === 'number') {
      const [cx, cz] = cellTransform(d.bx as number, d.bz as number, mirror, q);
      d.bx = ox + cx; d.by = oy + (d.by as number); d.bz = oz + cz;
      if (typeof d.facing === 'number') {
        let f = d.facing as number;
        if (mirror === 1 && (f & 1) === 0) f ^= 2;
        if (mirror === 2 && f & 1) f ^= 2;
        d.facing = (f + q) & 3;
      }
    }
    if (typeof d.yaw === 'number') d.yaw = (mirror === 1 ? 180 - (d.yaw as number) : mirror === 2 ? -(d.yaw as number) : (d.yaw as number)) + q * 90;
    const e = g.newEntity(String(d.type)) as (Entity & { load?(d: unknown): void }) | null;
    if (!e) continue;
    e.load?.(d);
    if (!(typeof d.bx === 'number')) e.setPos(d.x as number, d.y as number, d.z as number);
    g.addEntity(e);
  }
  return placed.length;
}

/** Save mode: copy the box under the block's name. Returns the message for the player. */
export function saveStructure(g: Game, x: number, y: number, z: number): string {
  const w = g.world!, t = structureTile(w, x, y, z);
  const name = normName(t.name);
  if (!name) throw new Error('Structure name is missing');
  if (!validName(name)) throw new Error(`Invalid structure name '${t.name}'`);
  const [sx, sy, sz] = t.size;
  if (sx <= 0 || sy <= 0 || sz <= 0) throw new Error('Structure size must be at least 1 in every direction');
  const ox = x + t.pos[0], oy = y + t.pos[1], oz = z + t.pos[2];
  for (let cx = ox >> 4; cx <= (ox + sx - 1) >> 4; cx++) for (let cz = oz >> 4; cz <= (oz + sz - 1) >> 4; cz++) if (!w.chunkAt(cx * 16, cz * 16)) throw new Error('The structure reaches into unloaded chunks');
  putTemplate(g, name, captureTemplate(g, ox, oy, oz, sx, sy, sz, t.entities, t.author));
  return `Structure saved as '${name}'`;
}

/**
 * Load mode: place the named structure at the box. Pressing Load on the block only sets the box's size the first
 * time (so it can be seen); a second press, or redstone, places it.
 */
export function loadStructure(g: Game, x: number, y: number, z: number, requireSize: boolean): string {
  const w = g.world!, t = structureTile(w, x, y, z);
  const name = normName(t.name);
  if (!name) throw new Error('Structure name is missing');
  const tpl = getTemplate(g, name);
  if (!tpl) throw new Error(`Structure '${name}' is not available`);
  const same = tpl.size.every((n, i) => n === t.size[i]);
  if (!same) { t.size = [...tpl.size]; w.setTile(x, y, z, t as never); }
  if (requireSize && !same) return `Size of '${name}' is ${tpl.size.join(' x ')}: load again to place it`;
  placeTemplate(g, tpl, x + t.pos[0], y + t.pos[1], z + t.pos[2], { mirror: t.mirror, rotation: t.rotation, integrity: t.integrity, seed: t.seed, entities: t.entities });
  return `Structure loaded from '${name}'`;
}

/** Save mode's Detect: fit the box inside the corner blocks of the same name (up to 80 blocks away). */
export function detectStructure(g: Game, x: number, y: number, z: number): string {
  const w = g.world!, t = structureTile(w, x, y, z), name = normName(t.name);
  if (!name) throw new Error('Structure name is missing');
  const found: [number, number, number][] = [];
  for (const c of w.chunks.values()) {
    if (!c.ready || !c.tiles.size || Math.abs(c.cx * 16 + 8 - x) > 88 || Math.abs(c.cz * 16 + 8 - z) > 88) continue;
    for (const [i, tile] of c.tiles) {
      if ((tile as { type?: string }).type !== 'structure') continue;
      const bx = c.cx * 16 + (i & 15), bz = c.cz * 16 + ((i >> 4) & 15), by = i >> 8;
      if (Math.abs(bx - x) > 80 || Math.abs(by - y) > 80 || Math.abs(bz - z) > 80) continue;
      const v = w.get(bx, by, bz);
      if (idOf(v) !== STRUCTURE_BLOCK || (metaOf(v) & 3) !== CORNER || normName((tile as unknown as StructureTile).name) !== name) continue;
      found.push([bx, by, bz]);
    }
  }
  if (!found.length) throw new Error(`No corner blocks named '${name}' found`);
  const lo = [0, 1, 2].map((a) => Math.min(...found.map((p) => p[a]))), hi = [0, 1, 2].map((a) => Math.max(...found.map((p) => p[a])));
  if (hi.some((h, a) => h - lo[a] < 2)) throw new Error('The corner blocks must enclose at least one block in every direction');
  const size = hi.map((h, a) => h - lo[a] - 1) as [number, number, number];
  if (size.some((s) => s > MAX_SIZE)) throw new Error(`The corners are too far apart (at most ${MAX_SIZE})`);
  t.pos = [lo[0] - x + 1, lo[1] - y + 1, lo[2] - z + 1];
  t.size = size;
  w.setTile(x, y, z, t as never);
  return `Size detected: ${size.join(' x ')}`;
}

/** Redstone: a rising edge saves (save mode) or loads (load mode). */
function structureRedstone(g: Game, x: number, y: number, z: number) {
  const w = g.world!, t = structureTile(w, x, y, z), powered = g.redstone.isPowered(x, y, z);
  if (powered === t.powered) return;
  t.powered = powered;
  w.setTile(x, y, z, t as never);
  if (!powered) return;
  const mode = metaOf(w.get(x, y, z)) & 3;
  try {
    if (mode === SAVE) saveStructure(g, x, y, z);
    else if (mode === LOAD) loadStructure(g, x, y, z, false);
  } catch { /* nothing to save or load */ }
}
BLOCKS[STRUCTURE_BLOCK].behavior = {
  ...BLOCKS[STRUCTURE_BLOCK].behavior,
  redstone: { update: (c) => structureRedstone(c.game as unknown as Game, c.x, c.y, c.z) },
  neighborChanged: (c) => structureRedstone(c.game as unknown as Game, c.x, c.y, c.z),
};
export const modeName = (m: number) => STRUCTURE_MODES[m & 3];
