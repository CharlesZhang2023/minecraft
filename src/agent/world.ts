// Blocks for the agent API: reading them (one, a box as text layers, a top-down map, a side cut, a search) and
// changing them (single blocks, boxes, text blueprints, shapes, copies), every change recorded for undo.
import type { Dim } from '../game/game';
import type { TileEntity } from '../world/world';
import { B, BLOCKS, Render, idOf, metaOf, pack } from '../world/blocks';
import { BIOMES } from '../world/biomes';
import type { Agent, P3 } from './agent';
import { parseBlock, formatBlock, stateOf, rotateBlock, partnerOf, Palette } from './blockspec';

type Params = Record<string, unknown>;
const MAX_WRITE = 8_000_000;

const isPlant = (id: number) => { const r = BLOCKS[id]?.render; return r === Render.Cross || r === Render.Crops; };
/** Blocks with something attached that a plain set wouldn't make (containers, comparators, mod tiles). */
const TILE_IDS = new Set([B.CHEST, B.FURNACE, B.HOPPER, B.DISPENSER, B.DROPPER, B.BREWING_STAND, B.COMPARATOR]);
const hasTile = (id: number) => TILE_IDS.has(id) || !!BLOCKS[id]?.behavior?.tile;

/** Which blocks a filter like "stone,dirt", "solid", "air", "!air", "oak_stairs[facing=east]" means. */
export function matcher(spec: unknown): ((v: number) => boolean) | null {
  if (spec === undefined || spec === null || spec === '') return null;
  let s = String(spec).trim();
  const neg = s.startsWith('!');
  if (neg) s = s.slice(1);
  const tests = s.split(',').map((t) => t.trim()).filter(Boolean).map((t): ((v: number) => boolean) => {
    switch (t.toLowerCase()) {
      case 'any': case '*': return () => true;
      case 'air': return (v) => v === 0;
      case 'solid': return (v) => !!BLOCKS[idOf(v)]?.solid;
      case 'liquid': case 'fluid': return (v) => !!BLOCKS[idOf(v)]?.fluid;
      case 'plants': case 'plant': return (v) => isPlant(idOf(v));
      case 'replaceable': return (v) => !!BLOCKS[idOf(v)]?.replaceable;
    }
    const exact = /[[:]/.test(t);
    const want = parseBlock(t);
    return exact ? (v) => v === want : (v) => idOf(v) === idOf(want);
  });
  const any = (v: number) => tests.some((f) => f(v));
  return neg ? (v) => !any(v) : any;
}

/** Puts blocks for one request, remembering what was there for undo. */
class Writer {
  cells: number[] = [];
  tiles = new Map<number, TileEntity>();
  changed = 0;
  skipped = 0;
  private seen = new Set<string>();
  constructor(private a: Agent, readonly dim: Dim, readonly physics: boolean) {}
  put(x: number, y: number, z: number, v: number) {
    if (y < 0 || y > 255) return;
    const w = this.dim.world;
    const old = w.get(x, y, z);
    if (old === v) return;
    const t = w.getTile(x, y, z);
    const i = this.cells.length / 4;
    if (!w.set(x, y, z, v)) { this.skipped++; return; }
    if (t) this.tiles.set(i, structuredClone(t));
    this.cells.push(x, y, z, old);
    this.changed++;
    if (hasTile(idOf(v)) || this.physics) this.dim.interact.initTile(x, y, z, v);
  }
  /** Doors and beds: also put the other half, unless the same request puts something there itself. */
  claim(x: number, y: number, z: number) { this.seen.add(`${x},${y},${z}`); }
  partner(x: number, y: number, z: number, v: number) {
    const p = partnerOf(v);
    if (p && !this.seen.has(`${x + p[0]},${y + p[1]},${z + p[2]}`)) this.put(x + p[0], y + p[1], z + p[2], p[3]);
  }
  /** Run the writes with the world's reactions held back (unless physics), then record them. */
  run(what: string, fn: () => void) {
    const t = this.dim.ticker;
    this.a.act(() => {
      const was = t.suppress;
      t.suppress = !this.physics;
      try { fn(); } finally { t.suppress = was; }
    }, this.dim);
    this.a.record(what, this.dim, this.cells, this.tiles);
    return { changed: this.changed, ...(this.skipped ? { skipped: this.skipped, note: 'some blocks were outside the loaded world or y 0-255' } : {}) };
  }
}

const vol = (a: P3, b: P3) => (b[0] - a[0] + 1) * (b[1] - a[1] + 1) * (b[2] - a[2] + 1);
function checkVolume(n: number) {
  if (n > MAX_WRITE) throw new Error(`That's ${n} blocks; at most ${MAX_WRITE} per request (split it up)`);
}

// ------------------------------------------------------------------ reading
export async function block(a: Agent, p: Params) {
  const [x, y, z] = a.bpos(p.pos);
  const dim = a.dim(p.dim);
  await a.load(dim, x, z, x, z);
  const w = dim.world, v = w.get(x, y, z), def = BLOCKS[idOf(v)];
  const tile = w.getTile(x, y, z);
  const c = w.chunkAt(x, z)!;
  const biome = dim.world.dimension === 'overworld' ? BIOMES[c.biomes[(z & 15) * 16 + (x & 15)]]?.name : dim.world.dimension;
  return {
    pos: [x, y, z], block: formatBlock(v), name: def?.name, display: def?.display, meta: metaOf(v), state: stateOf(v),
    solid: !!def?.solid, liquid: !!def?.fluid, light: w.getLight(x, y, z), biome, ...(tile ? { tile: tileInfo(tile) } : {}),
  };
}

function tileInfo(t: TileEntity) {
  const o = t as unknown as Record<string, unknown>;
  const stacks = (o.items ?? o.slots) as ({ id: number; count: number } | null)[] | undefined;
  const out: Record<string, unknown> = { type: o.type };
  if (Array.isArray(stacks)) out.items = stacks.map((s, i) => (s ? { slot: i, item: itemName(s.id), count: s.count } : null)).filter(Boolean);
  for (const [k, v] of Object.entries(o)) if (k !== 'items' && k !== 'slots' && k !== 'type' && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) out[k] = v;
  return out;
}
let itemNames: ((id: number) => string) | null = null;
export function setItemNamer(f: (id: number) => string) { itemNames = f; }
const itemName = (id: number) => itemNames?.(id) ?? String(id);

export async function read(a: Agent, p: Params) {
  const [lo, hi] = a.box(p.from, p.to);
  const n = vol(lo, hi);
  if (n > 300_000) throw new Error(`That box has ${n} blocks; read at most 300000 at a time (and ~40x40x40 stays readable)`);
  const dim = a.dim(p.dim);
  await a.load(dim, lo[0], lo[2], hi[0], hi[2]);
  const w = dim.world, pal = new Palette();
  pal.charFor(0);
  const layers: string[][] = [];
  for (let y = lo[1]; y <= hi[1]; y++) {
    const rows: string[] = [];
    for (let z = lo[2]; z <= hi[2]; z++) {
      let row = '';
      for (let x = lo[0]; x <= hi[0]; x++) {
        const c = pal.charFor(w.get(x, y, z));
        if (!c) throw new Error('More than ~90 different blocks in that box: read a smaller one');
        row += c;
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  const palette = pal.legend();
  // only what's used (air is always '.')
  return { origin: lo, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1], palette, layers };
}

/** The ground's top block: the highest solid block that isn't part of a tree (-1 if none). */
function groundY(dim: Dim, x: number, z: number) {
  const w = dim.world;
  let y = w.topSolidY(x, z);
  while (y > 0) {
    const n = BLOCKS[w.getId(x, y, z)]?.name ?? '';
    if (!(n.endsWith('_log') || n.endsWith('_leaves') || !BLOCKS[w.getId(x, y, z)].solid) || BLOCKS[w.getId(x, y, z)].fluid) break;
    y--;
  }
  return y;
}

export async function surface(a: Agent, p: Params) {
  let at = p.at as unknown;
  if (!Array.isArray(at)) throw new Error('`at` must be [[x, z], ...]');
  if (at.length === 2 && typeof at[0] !== 'object') at = [at];
  const dim = a.dim(p.dim);
  const cols = (at as unknown[][]).map((c) => [Math.floor(Number(c[0])), Math.floor(Number(c[c.length === 3 ? 2 : 1]))]);
  const out = [];
  for (const [x, z] of cols) {
    await a.load(dim, x, z, x, z);
    const y = groundY(dim, x, z);
    out.push({ x, z, y, block: formatBlock(dim.world.get(x, y, z)) });
  }
  return out;
}

/** The highest block of a column worth showing on a map (grass and flowers show the ground under them). */
function topShown(dim: Dim, x: number, z: number): [number, number] {
  const w = dim.world;
  let y = w.topY(x, z);
  while (y > 0) {
    const id = w.getId(x, y, z);
    if (id !== 0 && !(isPlant(id) && id !== B.WHEAT && id !== B.CARROTS && id !== B.POTATOES)) break;
    y--;
  }
  return [y, y >= 0 ? w.get(x, y, z) : 0];
}

const ruler = (from: number, n: number, step: number, pad: number) => {
  // labels every `step` columns, each over its column
  let line = ' '.repeat(pad), ticks = ' '.repeat(pad);
  for (let i = 0; i < n; i++) {
    const v = from + i * step;
    if (v % (8 * step) === 0 || (i === 0)) {
      const s = String(v);
      if (line.length < pad + i || i === 0) { line = line.padEnd(pad + i) + s; ticks = ticks.padEnd(pad + i) + '|'; }
    }
  }
  return line + '\n' + ticks;
};

export async function map(a: Agent, p: Params) {
  const c = p.center !== undefined ? a.bpos(p.center, 'center') : a.bpos('~ ~ ~');
  const radius = Math.max(4, Math.min(96, Math.floor(Number(p.radius ?? 24))));
  const scale = Math.max(1, Math.min(8, Math.floor(Number(p.scale ?? 1))));
  const dim = a.dim(p.dim);
  const x0 = c[0] - radius, z0 = c[2] - radius, x1 = c[0] + radius, z1 = c[2] + radius;
  await a.load(dim, x0, z0, x1, z1);
  const pal = new Palette();
  const rows: string[] = [], hs: number[][] = [];
  let minY = 255, maxY = 0;
  for (let z = z0; z <= z1; z += scale) {
    let row = '';
    const hr: number[] = [];
    for (let x = x0; x <= x1; x += scale) {
      // the most common top block of the cell
      const votes = new Map<number, number>();
      let ysum = 0, nn = 0;
      for (let dz = 0; dz < scale; dz++) for (let dx = 0; dx < scale; dx++) {
        const [y, v] = topShown(dim, x + dx, z + dz);
        votes.set(idOf(v), (votes.get(idOf(v)) ?? 0) + 1);
        ysum += y; nn++;
      }
      const id = [...votes].sort((q, r) => r[1] - q[1])[0][0];
      row += pal.charFor(pack(id), id) ?? '?';
      const y = Math.round(ysum / nn);
      hr.push(y);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    rows.push(row);
    hs.push(hr);
  }
  // players on it
  const marks: { char: string; pos: number[]; what: string }[] = [];
  const s = a.server;
  for (const sp of s.players) {
    if (sp.dim !== dim.world.dimension) continue;
    const e = sp.entity, mx = Math.floor((Math.floor(e.x) - x0) / scale), mz = Math.floor((Math.floor(e.z) - z0) / scale);
    const ch = sp === a.sp ? '@' : 'P';
    marks.push({ char: ch, pos: [Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)], what: sp === a.sp ? 'you' : sp.name });
    if (mz >= 0 && mz < rows.length && mx >= 0 && mx < rows[mz].length) rows[mz] = rows[mz].slice(0, mx) + ch + rows[mz].slice(mx + 1);
  }
  const legend = pal.legend((k) => BLOCKS[k]?.name ?? String(k));
  const pad = String(z1).length + 2;
  const label = (z: number) => String(z).padStart(pad - 1) + ' ';
  let text = `Top-down map, north up. x ${x0}..${x1} west→east, z ${z0}..${z1} north→south${scale > 1 ? `, ${scale} blocks per character` : ''}. Rows are labelled with z.\n`;
  text += ruler(x0, rows[0].length, scale, pad) + '\n';
  rows.forEach((r, i) => { text += label(z0 + i * scale) + r + '\n'; });
  text += 'Legend: ' + Object.entries(legend).map(([ch, n]) => `${ch}=${n}`).join('  ') + (marks.length ? '  ' + marks.map((m) => `${m.char}=${m.what}`).join('  ') : '');
  const out: Record<string, unknown> = { x0, z0, x1, z1, scale, rows, legend, marks, text };
  if (p.heights) {
    const base = minY;
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
    const hrows = hs.map((r) => r.map((y) => (y < 0 ? ' ' : digits[y - base] ?? '+')).join(''));
    out.heights = { base, max: maxY, rows: hrows, note: `each character is the surface y minus ${base} (0-9 then a-z = 10-35, + = higher)` };
    out.text += `\n\nSurface heights (y - ${base}; 0-9, a=10 ... z=35):\n` + ruler(x0, hrows[0].length, scale, pad) + '\n' + hrows.map((r, i) => label(z0 + i * scale) + r).join('\n');
  }
  return out;
}

export async function slice(a: Agent, p: Params) {
  const [lo, hi] = a.box(p.from, p.to);
  const alongX = hi[2] - lo[2] <= hi[0] - lo[0];
  if ((alongX ? hi[2] - lo[2] : hi[0] - lo[0]) > 0) throw new Error('A slice must be one block thick in x or in z');
  const n = (alongX ? hi[0] - lo[0] : hi[2] - lo[2]) + 1;
  if (n > 200 || hi[1] - lo[1] > 255) throw new Error('At most 200 blocks wide');
  const dim = a.dim(p.dim);
  await a.load(dim, lo[0], lo[2], hi[0], hi[2]);
  const w = dim.world, pal = new Palette();
  pal.charFor(0);
  const rows: string[] = [];
  for (let y = hi[1]; y >= lo[1]; y--) {
    let r = '';
    for (let i = 0; i < n; i++) r += pal.charFor(alongX ? w.get(lo[0] + i, y, lo[2]) : w.get(lo[0], y, lo[2] + i)) ?? '?';
    rows.push(r);
  }
  const legend = pal.legend();
  const pad = 5;
  const axis = alongX ? 'x' : 'z';
  let text = alongX
    ? `Side view looking north, at z=${lo[2]}: x ${lo[0]}..${hi[0]} left→right, y ${hi[1]} at the top down to ${lo[1]}.\n`
    : `Side view looking west, at x=${lo[0]}: z ${lo[2]}..${hi[2]} left→right (north→south), y ${hi[1]} at the top down to ${lo[1]}.\n`;
  text += ruler(alongX ? lo[0] : lo[2], n, 1, pad) + '\n';
  rows.forEach((r, i) => { text += String(hi[1] - i).padStart(pad - 1) + ' ' + r + '\n'; });
  text += 'Legend: ' + Object.entries(legend).map(([ch, nm]) => `${ch}=${nm}`).join('  ');
  return { axis, at: alongX ? lo[2] : lo[0], top: hi[1], rows, legend, text };
}

export async function find(a: Agent, p: Params) {
  const q = String(p.block ?? '').trim();
  if (!q) throw new Error('Which block? (`block`)');
  const c = p.center !== undefined ? a.bpos(p.center, 'center') : a.bpos('~ ~ ~');
  const r = Math.max(1, Math.min(96, Math.floor(Number(p.radius ?? 32))));
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(p.limit ?? 20))));
  // a name (or list) if it is one, else any block whose name contains the word
  let test: (v: number) => boolean;
  try { test = matcher(q)!; } catch {
    const words = q.toLowerCase().split(',').map((s) => s.trim());
    const ids = new Set(BLOCKS.filter((b) => b && !b.missing && words.some((wd) => b.name.includes(wd))).map((b) => b.id));
    if (!ids.size) throw new Error(`No block name contains '${q}'`);
    test = (v) => ids.has(idOf(v));
  }
  const dim = a.dim(p.dim);
  await a.load(dim, c[0] - r, c[2] - r, c[0] + r, c[2] + r);
  const w = dim.world, hits: [number, number, number, number, number][] = [];
  for (let x = c[0] - r; x <= c[0] + r; x++) for (let z = c[2] - r; z <= c[2] + r; z++) {
    const top = Math.min(255, c[1] + r);
    for (let y = Math.max(0, c[1] - r); y <= top; y++) {
      const v = w.get(x, y, z);
      if (v && test(v) || v === 0 && test(0)) {
        const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
        if (d <= r) hits.push([d, x, y, z, v]);
      }
    }
  }
  hits.sort((m, n) => m[0] - n[0]);
  return { found: hits.length, nearest: hits.slice(0, limit).map(([d, x, y, z, v]) => ({ pos: [x, y, z], block: formatBlock(v), dist: Math.round(d * 10) / 10 })) };
}

// ------------------------------------------------------------------ writing
export async function set(a: Agent, p: Params) {
  const list: [number, number, number, number][] = [];
  if (p.blocks !== undefined) {
    if (!Array.isArray(p.blocks)) throw new Error('`blocks` must be [[x, y, z, block], ...]');
    for (const b of p.blocks as unknown[]) {
      if (Array.isArray(b) && b.length === 4) { const [x, y, z] = a.bpos(b.slice(0, 3)); list.push([x, y, z, parseBlock(b[3] as string)]); }
      else if (b && typeof b === 'object' && 'block' in (b as object)) { const o = b as Params; const [x, y, z] = a.bpos(o.pos ?? [o.x, o.y, o.z]); list.push([x, y, z, parseBlock(o.block as string)]); }
      else throw new Error(`Bad entry ${JSON.stringify(b)}: use [x, y, z, block]`);
    }
  } else {
    const [x, y, z] = a.bpos(p.pos);
    if (p.block === undefined) throw new Error('Which block? (`block`)');
    list.push([x, y, z, parseBlock(p.block as string)]);
  }
  checkVolume(list.length);
  if (!list.length) return { changed: 0 };
  const dim = a.dim(p.dim);
  await a.load(dim, Math.min(...list.map((b) => b[0])), Math.min(...list.map((b) => b[2])), Math.max(...list.map((b) => b[0])), Math.max(...list.map((b) => b[2])));
  const wr = new Writer(a, dim, !!p.physics);
  for (const [x, y, z] of list) wr.claim(x, y, z);
  return wr.run(list.length === 1 ? `set ${formatBlock(list[0][3])} at ${list[0].slice(0, 3).join(' ')}` : `set ${list.length} blocks`, () => { for (const [x, y, z, v] of list) { wr.put(x, y, z, v); wr.partner(x, y, z, v); } });
}

export async function fill(a: Agent, p: Params) {
  const [lo, hi] = a.box(p.from, p.to);
  checkVolume(vol(lo, hi));
  if (p.block === undefined) throw new Error('Which block? (`block`)');
  const v = parseBlock(p.block as string);
  const mode = String(p.mode ?? 'fill');
  if (!['fill', 'hollow', 'outline', 'walls', 'frame'].includes(mode)) throw new Error('mode: fill | hollow | outline | walls | frame');
  const only = matcher(p.replace);
  const dim = a.dim(p.dim);
  await a.load(dim, lo[0], lo[2], hi[0], hi[2]);
  const w = dim.world;
  const wr = new Writer(a, dim, !!p.physics);
  const res = wr.run(`fill ${formatBlock(v)} ${lo.join(' ')} → ${hi.join(' ')}`, () => {
    for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
      const ex = x === lo[0] || x === hi[0], ey = y === lo[1] || y === hi[1], ez = z === lo[2] || z === hi[2];
      let put: number | null = v;
      if (mode === 'hollow') put = ex || ey || ez ? v : 0;
      else if (mode === 'outline') put = ex || ey || ez ? v : null;
      else if (mode === 'walls') put = ex || ez ? v : null;
      else if (mode === 'frame') put = (+ex) + (+ey) + (+ez) >= 2 ? v : null;
      if (put === null) continue;
      if (only && !only(w.get(x, y, z))) continue;
      wr.put(x, y, z, put);
    }
  });
  return { ...res, volume: vol(lo, hi) };
}

/** Where a footprint cell goes after `q` clockwise quarter turns, for a footprint `w` wide (x) and `d` deep (z). */
function turnXZ(x: number, z: number, w: number, d: number, q: number): [number, number] {
  switch (q & 3) {
    case 1: return [d - 1 - z, x];
    case 2: return [w - 1 - x, d - 1 - z];
    case 3: return [z, w - 1 - x];
    default: return [x, z];
  }
}

export async function build(a: Agent, p: Params) {
  const origin = a.bpos(p.origin, 'origin');
  if (!Array.isArray(p.layers)) throw new Error('`layers` must be a list of layers (bottom first), each a list of rows');
  const layers: string[][] = (p.layers as unknown[]).map((L) => (Array.isArray(L) ? (L as unknown[]).flatMap((r) => String(r).split('\n')) : String(L).split('\n')));
  const pal = new Map<string, number | null>([['.', 0], [' ', null]]);
  for (const [k, val] of Object.entries((p.palette ?? {}) as Record<string, unknown>)) {
    if ([...k].length !== 1) throw new Error(`Palette keys are single characters ('${k}' isn't)`);
    pal.set(k, val === null || val === '' ? null : parseBlock(val as string));
  }
  const h = layers.length, d = Math.max(...layers.map((L) => L.length)), wdt = Math.max(...layers.flatMap((L) => L.map((r) => [...r].length)));
  const q = ((Math.floor(Number(p.rotate ?? 0)) % 4) + 4) % 4;
  const [W, D] = q & 1 ? [d, wdt] : [wdt, d];
  let [ox, oy, oz] = origin;
  if (p.anchor === 'center') { ox -= Math.floor(W / 2); oz -= Math.floor(D / 2); }
  checkVolume(W * h * D);
  const cells: [number, number, number, number][] = [];
  const unknown = new Set<string>();
  layers.forEach((rows, y) => rows.forEach((row, z) => [...row].forEach((ch, x) => {
    if (!pal.has(ch)) { unknown.add(ch); return; }
    const v = pal.get(ch);
    if (v === null || v === undefined) return;
    const [tx, tz] = turnXZ(x, z, wdt, d, q);
    cells.push([ox + tx, oy + y, oz + tz, rotateBlock(v, q)]);
  })));
  if (unknown.size) throw new Error(`Characters not in the palette: ${[...unknown].map((c) => JSON.stringify(c)).join(' ')} (space = leave, '.' = air)`);
  const dim = a.dim(p.dim);
  await a.load(dim, ox, oz, ox + W - 1, oz + D - 1);
  const wr = new Writer(a, dim, !!p.physics);
  for (const [x, y, z] of cells) wr.claim(x, y, z);
  const res = wr.run(`build ${W}x${h}x${D} at ${ox} ${oy} ${oz}`, () => { for (const [x, y, z, v] of cells) { wr.put(x, y, z, v); wr.partner(x, y, z, v); } });
  return { ...res, from: [ox, oy, oz], to: [ox + W - 1, oy + h - 1, oz + D - 1] };
}

export async function shape(a: Agent, p: Params) {
  const kind = String(p.kind ?? '');
  if (p.block === undefined) throw new Error('Which block? (`block`)');
  const v = parseBlock(p.block as string);
  const num = (k: string, def?: number) => { const n = p[k] === undefined ? def : Number(p[k]); if (n === undefined || !Number.isFinite(n)) throw new Error(`${kind} needs \`${k}\``); return n; };
  let lo: P3, hi: P3, inside: (x: number, y: number, z: number) => boolean;
  if (kind === 'line') {
    const f = a.pos(p.from, 'from'), t = a.pos(p.to, 'to');
    const th = Math.max(1, num('thickness', 1)), r = (th - 1) / 2 + 0.5;
    lo = [Math.floor(Math.min(f[0], t[0]) - r), Math.floor(Math.min(f[1], t[1]) - r), Math.floor(Math.min(f[2], t[2]) - r)];
    hi = [Math.floor(Math.max(f[0], t[0]) + r), Math.floor(Math.max(f[1], t[1]) + r), Math.floor(Math.max(f[2], t[2]) + r)];
    // block centres within r of the segment (centres of the end blocks: the line runs block centre to centre)
    const fc = f.map((n) => Math.floor(n) + 0.5), tc = t.map((n) => Math.floor(n) + 0.5);
    const ex = tc[0] - fc[0], ey = tc[1] - fc[1], ez = tc[2] - fc[2], E2 = ex * ex + ey * ey + ez * ez || 1;
    inside = (x, y, z) => {
      const px = x + 0.5 - fc[0], py = y + 0.5 - fc[1], pz = z + 0.5 - fc[2];
      const s = Math.max(0, Math.min(1, (px * ex + py * ey + pz * ez) / E2));
      const qx = px - s * ex, qy = py - s * ey, qz = pz - s * ez;
      return qx * qx + qy * qy + qz * qz <= (th <= 1 ? 0.5 * 0.5 + 0.26 : r * r);
    };
  } else {
    const c = a.bpos(p.center, 'center');
    const axis = String(p.axis ?? 'y');
    // shapes work in a frame where "up" is the axis: (u, h, v)
    const toLocal = (x: number, y: number, z: number): [number, number, number] => axis === 'x' ? [z - c[2], x - c[0], y - c[1]] : axis === 'z' ? [x - c[0], z - c[2], y - c[1]] : [x - c[0], y - c[1], z - c[2]];
    let ext: P3;
    switch (kind) {
      case 'sphere': case 'dome': {
        const R = num('radius', p.rx !== undefined ? undefined : 0);
        const rx = num('rx', R) + 0.5, ry = num('ry', R) + 0.5, rz = num('rz', R) + 0.5;
        ext = [Math.ceil(rx), Math.ceil(ry), Math.ceil(rz)];
        inside = (x, y, z) => { const dx = x - c[0], dy = y - c[1], dz = z - c[2]; return (kind === 'sphere' || dy >= 0) && (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz) <= 1; };
        break;
      }
      case 'cylinder': case 'cone': {
        const R = num('radius') + 0.5, H = Math.max(1, Math.floor(num('height')));
        ext = axis === 'x' ? [H, Math.ceil(R), Math.ceil(R)] : axis === 'z' ? [Math.ceil(R), Math.ceil(R), H] : [Math.ceil(R), H, Math.ceil(R)];
        inside = (x, y, z) => {
          const [u, hgt, w] = toLocal(x, y, z);
          if (hgt < 0 || hgt >= H) return false;
          const r = kind === 'cone' ? R * (1 - hgt / H) : R;
          return u * u + w * w <= r * r;
        };
        break;
      }
      case 'pyramid': {
        const S = Math.floor(num('radius', p.size !== undefined ? Number(p.size) : undefined)), H = Math.floor(num('height', S + 1));
        ext = [S, H, S];
        inside = (x, y, z) => { const dy = y - c[1]; if (dy < 0 || dy >= H) return false; const r = S - Math.floor((dy * (S + 1)) / H); return Math.abs(x - c[0]) <= r && Math.abs(z - c[2]) <= r; };
        break;
      }
      case 'torus': {
        const R = num('radius'), T = num('tube', Math.max(1, R / 3)) + 0.5;
        ext = axis === 'x' ? [Math.ceil(T), Math.ceil(R + T), Math.ceil(R + T)] : axis === 'z' ? [Math.ceil(R + T), Math.ceil(R + T), Math.ceil(T)] : [Math.ceil(R + T), Math.ceil(T), Math.ceil(R + T)];
        inside = (x, y, z) => { const [u, hgt, w] = toLocal(x, y, z); const q = R - Math.hypot(u, w); return q * q + hgt * hgt <= T * T; };
        break;
      }
      default: throw new Error('kind: sphere | dome | cylinder | cone | pyramid | line | torus');
    }
    lo = [c[0] - ext[0], c[1] - (kind === 'sphere' || kind === 'torus' ? ext[1] : 0), c[2] - ext[2]];
    hi = [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]];
    if (axis === 'x' && (kind === 'cylinder' || kind === 'cone')) { lo = [c[0], c[1] - ext[1], c[2] - ext[2]]; hi = [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]]; }
    if (axis === 'z' && (kind === 'cylinder' || kind === 'cone')) { lo = [c[0] - ext[0], c[1] - ext[1], c[2]]; hi = [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]]; }
  }
  checkVolume(vol(lo, hi));
  const hollow = !!p.hollow;
  const only = matcher(p.replace);
  const dim = a.dim(p.dim);
  await a.load(dim, lo[0], lo[2], hi[0], hi[2]);
  const w = dim.world;
  const wr = new Writer(a, dim, !!p.physics);
  return wr.run(`${kind} of ${formatBlock(v)}`, () => {
    for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
      if (!inside(x, y, z)) continue;
      if (hollow && inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y + 1, z) && inside(x, y - 1, z) && inside(x, y, z + 1) && inside(x, y, z - 1)) continue;
      if (only && !only(w.get(x, y, z))) continue;
      wr.put(x, y, z, v);
    }
  });
}

export async function clone(a: Agent, p: Params) {
  const [lo, hi] = a.box(p.from, p.to);
  const dest = a.bpos(p.dest, 'dest');
  checkVolume(vol(lo, hi));
  const q = ((Math.floor(Number(p.rotate ?? 0)) % 4) + 4) % 4;
  const air = p.air !== false;
  const dim = a.dim(p.dim);
  await a.load(dim, lo[0], lo[2], hi[0], hi[2]);
  const w = dim.world;
  const W = hi[0] - lo[0] + 1, D = hi[2] - lo[2] + 1;
  const src: [number, number, number, number, TileEntity | undefined][] = [];
  for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
    const v = w.get(x, y, z);
    if (!v && !air) continue;
    const [tx, tz] = turnXZ(x - lo[0], z - lo[2], W, D, q);
    const t = w.getTile(x, y, z);
    src.push([dest[0] + tx, dest[1] + y - lo[1], dest[2] + tz, rotateBlock(v, q), t ? structuredClone(t) : undefined]);
  }
  const [RW, RD] = q & 1 ? [D, W] : [W, D];
  await a.load(dim, dest[0], dest[2], dest[0] + RW - 1, dest[2] + RD - 1);
  const wr = new Writer(a, dim, !!p.physics);
  const res = wr.run(`clone ${lo.join(' ')} → ${dest.join(' ')}`, () => {
    for (const [x, y, z, v, t] of src) {
      wr.put(x, y, z, v);
      if (t) w.setTile(x, y, z, t);
    }
  });
  return { ...res, to: [dest[0] + RW - 1, dest[1] + hi[1] - lo[1], dest[2] + RD - 1] };
}

export async function undo(a: Agent, p: Params) {
  const steps = Math.max(1, Math.floor(Number(p.steps ?? 1)));
  const done: string[] = [];
  let restored = 0;
  for (let i = 0; i < steps; i++) {
    const s = a.popStep();
    if (!s) break;
    const dim = a.dim(s.dim);
    const c = s.cells;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < c.length; k += 4) { x0 = Math.min(x0, c[k]); x1 = Math.max(x1, c[k]); z0 = Math.min(z0, c[k + 2]); z1 = Math.max(z1, c[k + 2]); }
    await a.load(dim, x0, z0, x1, z1);
    const w = dim.world, t = dim.ticker;
    a.act(() => {
      const was = t.suppress;
      t.suppress = true;
      try {
        // newest first, so a block changed twice in one step ends up as it was before
        for (let k = c.length - 4; k >= 0; k -= 4) {
          w.set(c[k], c[k + 1], c[k + 2], c[k + 3]);
          const tile = s.tiles.get(k / 4);
          if (tile) w.setTile(c[k], c[k + 1], c[k + 2], structuredClone(tile));
          restored++;
        }
      } finally { t.suppress = was; }
    }, dim);
    done.push(s.what);
  }
  return { undone: done, restored, left: a.journal.length };
}

export function history(a: Agent) {
  return a.journal.slice().reverse().map((s, i) => ({ step: i + 1, what: s.what, blocks: s.cells.length / 4, dim: s.dim, at: new Date(s.at).toISOString() }));
}
