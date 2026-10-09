// Schematic files, read and written: Litematica (.litematic), Sponge / WorldEdit (.schem, versions 1-3) and the
// vanilla structure files structure blocks and /place use (.nbt). Reading brings block states up to today's
// names; writing names them for the Java Edition version chosen, so the file opens there.
import * as N from './nbt';
import type { Compound, Tag } from './nbt';
import { type Schematic, type Region, type BlockState, type TileData, type EntityData, type Vec3, isAir, stateKey, bounds, volume, countBlocks, newIndices, PaletteBuilder, emptySchematic, AIR } from './model';
import { upgrade, downgrade, fromJava, NEWEST } from './vanilla';
import { tileToNbt, GAME_TAG } from './tiles';

export type Format = 'litematic' | 'schem' | 'nbt';
export const EXTENSIONS: Record<Format, string> = { litematic: '.litematic', schem: '.schem', nbt: '.nbt' };
/** Vanilla structure blocks save at most this much along each side. */
export const STRUCTURE_MAX = 48;
const VOID = 'minecraft:structure_void';
const GAME_KEY = 'BlueprintsGame';

const DV_1_13 = 1451;

// ------------------------------------------------------------------ helpers
const stateFromTag = (t: Tag | undefined, dv: number): BlockState => {
  const props: Record<string, string> = {};
  // (the newest snapshots spell these id and properties)
  const pc = N.compound(N.get(t, 'Properties') ?? N.get(t, 'properties'));
  if (pc) for (const [k, v] of Object.entries(pc.v)) props[k] = N.text(v, String(N.num(v)));
  const s: BlockState = { name: N.text(N.get(t, 'Name') ?? N.get(t, 'id'), 'minecraft:air').toLowerCase(), props };
  if (!s.name.includes(':')) s.name = 'minecraft:' + s.name;
  const game = N.text(N.get(t, GAME_KEY));
  if (game) s.game = game;
  return upgrade(s, dv);
};
/** A state as a palette compound for version `dv` (with this game's exact block when its Java name can't say it). */
const stateToTag = (s: BlockState, dv: number): Compound => {
  const d = downgrade(s, dv);
  const props = Object.keys(d.props).length ? N.comp(Object.fromEntries(Object.entries(d.props).sort().map(([k, v]) => [k, N.str(v)]))) : undefined;
  return N.comp({ Name: N.str(d.name), Properties: props, [GAME_KEY]: s.game && needsGame(s, dv) ? N.str(s.game) : undefined });
};
/** Does the state, written for version `dv`, lose something of this game's block? */
const needsGame = (s: BlockState, dv: number) => {
  if (!s.game) return false;
  const v = fromJava(upgrade(downgrade({ name: s.name, props: s.props }, dv), dv));
  return v === null || s.game !== gameOf(v);
};
let gameOf: (v: number) => string = () => '';
export function initFormats(game: (v: number) => string) { gameOf = game; }

/** Parse "a state string" as Sponge palettes write them: `minecraft:oak_stairs[facing=east]`. */
function spongeState(key: string, dv: number): BlockState {
  const m = /^([^[]+)(?:\[(.*)\])?$/.exec(key);
  const props: Record<string, string> = {};
  if (m?.[2]) for (const p of m[2].split(',')) { const [k, v] = p.split('='); if (k && v !== undefined) props[k] = v; }
  let name = (m?.[1] ?? 'minecraft:air').toLowerCase();
  if (!name.includes(':')) name = 'minecraft:' + name;
  return upgrade({ name, props }, dv);
}
const spongeKey = (s: BlockState, dv: number) => stateKey(downgrade(s, dv));

/** A Java block entity's data with its position and id (and our own tag) taken out. */
function tileData(nbt: Compound, i: number, drop: string[]): TileData {
  const v: Record<string, Tag> = {};
  for (const [k, t] of Object.entries(nbt.v)) if (!drop.includes(k)) v[k] = t;
  const out: TileData = { i, nbt: { t: 'compound', v } };
  const game = N.text(nbt.v[GAME_TAG]);
  if (game) { try { out.game = JSON.parse(game); } catch { /* not ours after all */ } delete v[GAME_TAG]; }
  return out;
}

/** The block entity data to write for a tile: what a file gave us, or the game's tile converted. */
function tileOut(t: TileData, block: BlockState, dv: number): Compound | null {
  let c: Compound | null = null;
  if (t.nbt) c = { t: 'compound', v: { ...t.nbt.v } };
  else if (t.game) c = tileToNbt(t.game as never, block.name, dv);
  if (t.game) { c ??= N.comp(); c.v[GAME_TAG] = N.str(JSON.stringify(t.game)); }
  return c;
}

// ------------------------------------------------------------------ varints (Sponge block data)
function readVarints(b: Int8Array, n: number): Uint32Array {
  const out = new Uint32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    let v = 0, shift = 0, byte: number;
    do {
      if (p >= b.length) throw new Error('block data ends too soon');
      byte = b[p++] & 0xff;
      v |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80 && shift < 35);
    out[i] = v >>> 0;
  }
  return out;
}
function writeVarints(a: ArrayLike<number>): Int8Array {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    let v = a[i] >>> 0;
    while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
    out.push(v);
  }
  return Int8Array.from(out, (x) => (x << 24) >> 24);
}

// ------------------------------------------------------------------ Litematica bit arrays
/** Litematica packs entries back to back across longs (no padding): a little-endian bit stream. */
function unpackBits(longs: BigInt64Array, bits: number, n: number): Uint32Array {
  const w = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2);
  const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const word = (k: number) => w[le ? k : (k ^ 1)];
  const out = new Uint32Array(n);
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < n; i++) {
    const bit = i * bits, k = Math.floor(bit / 32), off = bit % 32;
    let v = word(k) >>> off;
    if (off + bits > 32 && k + 1 < w.length) v |= word(k + 1) << (32 - off);
    out[i] = (v & mask) >>> 0;
  }
  return out;
}
function packBits(vals: ArrayLike<number>, bits: number): BigInt64Array {
  const longs = new BigInt64Array(Math.ceil((vals.length * bits) / 64) || 1);
  const w = new Uint32Array(longs.buffer);
  const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const at = (k: number) => (le ? k : k ^ 1);
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i] >>> 0, bit = i * bits, k = Math.floor(bit / 32), off = bit % 32;
    w[at(k)] |= (v << off) >>> 0;
    if (off + bits > 32) w[at(k + 1)] |= v >>> (32 - off);
  }
  return longs;
}
const bitsFor = (paletteSize: number) => Math.max(2, 32 - Math.clz32(Math.max(1, paletteSize - 1)));

// ------------------------------------------------------------------ reading
export interface ReadResult { schematic: Schematic; format: Format | 'schematic'; warnings: string[] }

/** Read a schematic file of any supported kind. */
export async function readSchematic(data: Uint8Array, fileName: string): Promise<ReadResult> {
  const { name, root } = await N.readFile(data);
  const base = fileName.replace(/\.[^.]+$/, '') || 'Schematic';
  if (N.get(root, 'Regions')) return { ...readLitematic(root, base), format: 'litematic' };
  const sponge = N.compound(N.get(root, 'Schematic'));
  if (sponge && N.get(sponge, 'Version')) return { ...readSponge(sponge, base), format: 'schem' };
  if (N.get(root, 'Materials') || (N.get(root, 'Blocks')?.t === 'bytes' && N.get(root, 'Width'))) {
    throw new Error('This is an MCEdit .schematic from before Minecraft 1.13 (numeric block ids), which can\'t be read. Open it in WorldEdit on 1.13 or newer and save it as .schem.');
  }
  if ((name === 'Schematic' || N.get(root, 'Palette') || N.get(root, 'Blocks')) && N.get(root, 'Width')) return { ...readSponge(root, base), format: 'schem' };
  if (N.get(root, 'size') && (N.get(root, 'palette') || N.get(root, 'palettes'))) return { ...readStructure(root, base), format: 'nbt' };
  throw new Error('Not a schematic this mod knows (Litematica .litematic, Sponge/WorldEdit .schem or vanilla structure .nbt)');
}

function readLitematic(root: Compound, base: string) {
  const warnings: string[] = [];
  const version = N.num(N.get(root, 'Version'));
  const dv = N.num(N.get(root, 'MinecraftDataVersion'), 1631);
  if (dv < DV_1_13) throw new Error('This Litematica schematic is from Minecraft 1.12 or older (numeric block ids), which can\'t be read. Load it in Litematica on 1.13 or newer and save it again.');
  if (version > 7) warnings.push(`Litematica format version ${version} is newer than this mod knows (7); some data may be missing.`);
  const meta = N.compound(N.get(root, 'Metadata'));
  const s = emptySchematic(N.text(N.get(meta, 'Name'), base));
  s.source = 'litematic';
  s.author = N.text(N.get(meta, 'Author'));
  s.description = N.text(N.get(meta, 'Description'));
  s.created = N.num(N.get(meta, 'TimeCreated'), Date.now());
  s.modified = N.num(N.get(meta, 'TimeModified'), s.created);
  s.dataVersion = dv;
  const regions = N.compound(N.get(root, 'Regions'))!;
  for (const [rname, rt] of Object.entries(regions.v)) {
    const pos = N.vec3(N.get(rt, 'Position')), size = N.vec3(N.get(rt, 'Size'));
    if (!pos || !size || !size[0] || !size[1] || !size[2]) { warnings.push(`Region ${rname} has no size; skipped.`); continue; }
    // a negative size reaches back from the position
    const min = [0, 1, 2].map((a) => Math.min(pos[a], pos[a] + size[a] + (size[a] > 0 ? -1 : 1))) as Vec3;
    const dims = size.map(Math.abs) as Vec3;
    const palette = N.items(N.get(rt, 'BlockStatePalette')).map((t) => stateFromTag(t, dv));
    if (!palette.length) palette.push({ ...AIR });
    const n = volume(dims);
    const longs = N.get(rt, 'BlockStates');
    const idx = longs?.t === 'longs' ? unpackBits(longs.v, bitsFor(palette.length), n) : new Uint32Array(n);
    const r = finishRegion(rname, min, dims, palette, idx);
    for (const t of N.items(N.get(rt, 'TileEntities'))) {
      const c = N.compound(t);
      if (!c) continue;
      const x = N.num(c.v.x), y = N.num(c.v.y), z = N.num(c.v.z);
      if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) continue;
      r.tiles.push(tileData(c, (y * dims[2] + z) * dims[0] + x, ['x', 'y', 'z']));
    }
    for (const e of N.items(N.get(rt, 'Entities'))) {
      const c = N.compound(e);
      const p = N.items(N.get(c, 'Pos')).map((t) => N.num(t));
      if (!c || p.length !== 3) continue;
      const v = { ...c.v };
      delete v.Pos;
      r.entities.push({ pos: [p[0], p[1], p[2]], nbt: { t: 'compound', v } });
    }
    s.regions.push(r);
  }
  return { schematic: s, warnings };
}

/** A region from a palette and indices (narrowed to 16 bits when the palette is small). */
function finishRegion(name: string, pos: Vec3, size: Vec3, palette: BlockState[], idx: Uint32Array): Region {
  // air first, as the rest of the mod expects
  let pal = palette, ids: ArrayLike<number> = idx;
  const air = palette.findIndex(isAir);
  if (air !== 0) {
    const map = new Uint32Array(palette.length);
    pal = [{ ...AIR }];
    palette.forEach((st, i) => { if (i === air) map[i] = 0; else { map[i] = pal.length; pal.push(st); } });
    if (air < 0) for (let i = 0; i < palette.length; i++) map[i] = i + 1;
    const out = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) out[i] = map[idx[i]] ?? 0;
    ids = out;
  }
  const blocks = newIndices(idx.length, pal.length);
  for (let i = 0; i < ids.length; i++) blocks[i] = ids[i] < pal.length ? ids[i] : 0;
  return { name, pos, size, palette: pal, blocks, tiles: [], entities: [] };
}

function readSponge(sc: Compound, base: string) {
  const warnings: string[] = [];
  const version = N.num(N.get(sc, 'Version'), 1);
  const dv = N.num(N.get(sc, 'DataVersion'), 1631);
  if (dv < DV_1_13) throw new Error('This schematic is from Minecraft 1.12 or older and can\'t be read.');
  const w = N.num(N.get(sc, 'Width')) & 0xffff, h = N.num(N.get(sc, 'Height')) & 0xffff, l = N.num(N.get(sc, 'Length')) & 0xffff;
  const meta = N.compound(N.get(sc, 'Metadata'));
  const s = emptySchematic(N.text(N.get(meta, 'Name'), base));
  s.source = 'schem';
  s.author = N.text(N.get(meta, 'Author'));
  s.created = s.modified = N.num(N.get(meta, 'Date'), Date.now());
  s.dataVersion = dv;
  const blocks = version >= 3 ? N.compound(N.get(sc, 'Blocks')) : sc;
  const pal = N.compound(N.get(blocks, version >= 3 ? 'Palette' : 'Palette'));
  const palette: BlockState[] = [];
  if (pal) for (const [k, t] of Object.entries(pal.v)) palette[N.num(t)] = spongeState(k, dv);
  for (let i = 0; i < palette.length; i++) palette[i] ??= { ...AIR };
  // our own exact blocks, if we wrote the file
  const games = N.compound(N.get(meta, GAME_KEY));
  if (games && pal) for (const [k, t] of Object.entries(games.v)) { const i = N.num(N.get(pal, k), -1); if (i >= 0 && palette[i]) palette[i].game = N.text(t); }
  const data = N.get(blocks, version >= 3 ? 'Data' : 'BlockData');
  const n = w * h * l;
  const idx = data?.t === 'bytes' ? readVarints(data.v, n) : new Uint32Array(n);
  const r = finishRegion('Main', [0, 0, 0], [w, h, l], palette.length ? palette : [{ ...AIR }], idx);
  const tiles = N.items(N.get(blocks, version >= 3 ? 'BlockEntities' : version === 2 ? 'BlockEntities' : 'TileEntities'));
  for (const t of tiles) {
    const c = N.compound(t);
    const p = N.vec3(N.get(c, 'Pos'));
    if (!c || !p) continue;
    const [x, y, z] = p;
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= l) continue;
    const i = (y * l + z) * w + x;
    if (version >= 3) {
      const inner = N.compound(N.get(c, 'Data')) ?? N.comp();
      const td = tileData({ t: 'compound', v: { ...inner.v, id: N.get(c, 'Id') ?? N.str('') } }, i, []);
      r.tiles.push(td);
    } else r.tiles.push(tileData({ t: 'compound', v: { ...c.v, id: N.get(c, 'Id') ?? N.get(c, 'id') ?? N.str('') } }, i, ['Pos', 'Id']));
  }
  for (const e of N.items(N.get(sc, 'Entities'))) {
    const c = N.compound(e);
    const p = N.items(N.get(c, 'Pos')).map((t) => N.num(t));
    if (!c || p.length !== 3) continue;
    const inner = version >= 3 ? N.compound(N.get(c, 'Data')) ?? N.comp() : c;
    const v: Record<string, Tag> = { ...inner.v, id: N.get(c, 'Id') ?? N.get(inner, 'id') ?? N.str('') };
    delete v.Pos; delete v.Id;
    r.entities.push({ pos: [p[0], p[1], p[2]], nbt: { t: 'compound', v } });
  }
  s.regions.push(r);
  return { schematic: s, warnings };
}

function readStructure(root: Compound, base: string) {
  const warnings: string[] = [];
  const dv = N.num(N.get(root, 'DataVersion'), 1631);
  if (dv < DV_1_13) throw new Error('This structure file is from Minecraft 1.12 or older and can\'t be read.');
  const size = N.vec3(N.get(root, 'size'));
  if (!size) throw new Error('The structure has no size');
  const s = emptySchematic(base);
  s.source = 'nbt';
  s.author = N.text(N.get(root, 'author'));
  s.dataVersion = dv;
  let palTag = N.items(N.get(root, 'palette'));
  if (!palTag.length) {
    const pals = N.items(N.get(root, 'palettes'));
    palTag = N.items(pals[0]);
    if (pals.length > 1) warnings.push(`The structure has ${pals.length} palettes (shipwreck-style variants); the first is used.`);
  }
  const palette = palTag.map((t) => stateFromTag(t, dv));
  // cells it doesn't list are left alone when it's placed: structure voids
  const voidIdx = palette.length;
  palette.push({ name: VOID, props: {} });
  const n = volume(size);
  const idx = new Uint32Array(n).fill(voidIdx);
  const nbts: [number, Compound][] = [];
  for (const b of N.items(N.get(root, 'blocks'))) {
    const p = N.vec3(N.get(b, 'pos'));
    if (!p) continue;
    const [x, y, z] = p;
    if (x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2]) continue;
    const i = (y * size[2] + z) * size[0] + x;
    idx[i] = N.num(N.get(b, 'state'));
    const nb = N.compound(N.get(b, 'nbt'));
    if (nb) nbts.push([i, nb]);
  }
  const r = finishRegion('Main', [0, 0, 0], size, palette, idx);
  for (const [i, c] of nbts) r.tiles.push(tileData(c, i, []));
  for (const e of N.items(N.get(root, 'entities'))) {
    const p = N.items(N.get(e, 'pos')).map((t) => N.num(t));
    const c = N.compound(N.get(e, 'nbt'));
    if (!c || p.length !== 3) continue;
    const v = { ...c.v };
    delete v.Pos; delete v.UUID;
    r.entities.push({ pos: [p[0], p[1], p[2]], nbt: { t: 'compound', v } });
  }
  s.regions.push(r);
  return { schematic: s, warnings };
}

// ------------------------------------------------------------------ writing
export interface WriteResult { data: Uint8Array; warnings: string[] }

/** Write a schematic as `format` for Java Edition data version `dv`. */
export async function writeSchematic(s: Schematic, format: Format, dv = NEWEST): Promise<WriteResult> {
  const warnings: string[] = [];
  if (format === 'litematic') return { data: await N.writeFile(writeLitematic(s, dv)), warnings };
  // the other formats hold one box: the regions merged into the box around them all
  const one = s.regions.length === 1 ? s.regions[0] : merge(s);
  if (s.regions.length > 1) warnings.push(`The ${s.regions.length} regions were merged into one box (${format} files have one).`);
  // Sponge version 2: every WorldEdit since 1.13 reads it (the root tag is named Schematic)
  if (format === 'schem') return { data: await N.writeFile(writeSponge(s, one, dv), 'Schematic'), warnings };
  if (one.size.some((d) => d > STRUCTURE_MAX)) warnings.push(`Larger than ${STRUCTURE_MAX} blocks across: structure blocks can't load it, but /place template can (1.19+).`);
  return { data: await N.writeFile(writeStructure(s, one, dv)), warnings };
}

function writeLitematic(s: Schematic, dv: number): Compound {
  const b = bounds(s);
  const regions: Record<string, Tag> = {};
  const used = new Set<string>();
  for (const r of s.regions) {
    let name = r.name || 'Main';
    for (let k = 2; used.has(name); k++) name = `${r.name} ${k}`;
    used.add(name);
    const tiles: Tag[] = [];
    const [sx, , sz] = r.size;
    for (const t of r.tiles) {
      const c = tileOut(t, r.palette[r.blocks[t.i]] ?? AIR, dv);
      if (!c) continue;
      const x = t.i % sx, z = Math.floor(t.i / sx) % sz, y = Math.floor(t.i / (sx * sz));
      c.v.x = N.int(x); c.v.y = N.int(y); c.v.z = N.int(z);
      tiles.push(c);
    }
    regions[name] = N.comp({
      Position: N.comp({ x: N.int(r.pos[0] - b.min[0]), y: N.int(r.pos[1] - b.min[1]), z: N.int(r.pos[2] - b.min[2]) }),
      Size: N.comp({ x: N.int(r.size[0]), y: N.int(r.size[1]), z: N.int(r.size[2]) }),
      BlockStatePalette: N.list('compound', r.palette.map((p) => stateToTag(p, dv))),
      BlockStates: N.longs(packBits(r.blocks, bitsFor(r.palette.length))),
      TileEntities: N.list('compound', tiles),
      Entities: N.list('compound', r.entities.map((e) => entityOut(e, [0, 0, 0]))),
      PendingBlockTicks: N.list('compound', []),
      PendingFluidTicks: N.list('compound', []),
    });
  }
  const version = dv >= 3837 ? 7 : dv >= 2825 ? 6 : 5;
  return N.comp({
    MinecraftDataVersion: N.int(dv),
    Version: N.int(version),
    SubVersion: version >= 7 ? N.int(1) : undefined,
    Metadata: N.comp({
      Name: N.str(s.name), Author: N.str(s.author), Description: N.str(s.description),
      RegionCount: N.int(s.regions.length), TotalVolume: N.int(s.regions.reduce((a, r) => a + volume(r.size), 0)), TotalBlocks: N.int(countBlocks(s)),
      TimeCreated: N.long(Math.round(s.created)), TimeModified: N.long(Math.round(s.modified)),
      EnclosingSize: N.comp({ x: N.int(b.size[0]), y: N.int(b.size[1]), z: N.int(b.size[2]) }),
    }),
    Regions: N.comp(regions),
  });
}

function entityOut(e: EntityData, off: Vec3): Compound {
  return { t: 'compound', v: { ...e.nbt.v, Pos: N.doubleList([e.pos[0] + off[0], e.pos[1] + off[1], e.pos[2] + off[2]]) } };
}

/** All regions in one box (later regions over earlier ones; what no region covers is a structure void). */
function merge(s: Schematic): Region {
  const b = bounds(s);
  const pal = new PaletteBuilder();
  const voidIdx = pal.add({ name: VOID, props: {} });
  const n = volume(b.size);
  const idx = new Uint32Array(n).fill(voidIdx);
  const tiles: TileData[] = [], entities: EntityData[] = [];
  for (const r of s.regions) {
    const map = r.palette.map((p) => pal.add(p));
    const [ox, oy, oz] = [r.pos[0] - b.min[0], r.pos[1] - b.min[1], r.pos[2] - b.min[2]];
    const tileAt = new Map(r.tiles.map((t) => [t.i, t]));
    for (let y = 0; y < r.size[1]; y++)
      for (let z = 0; z < r.size[2]; z++)
        for (let x = 0; x < r.size[0]; x++) {
          const i = (y * r.size[2] + z) * r.size[0] + x;
          const j = ((y + oy) * b.size[2] + z + oz) * b.size[0] + x + ox;
          idx[j] = map[r.blocks[i]];
          const t = tileAt.get(i);
          if (t) tiles.push({ ...t, i: j });
        }
    for (const e of r.entities) entities.push({ ...e, pos: [e.pos[0] + ox, e.pos[1] + oy, e.pos[2] + oz] });
  }
  const blocks = newIndices(n, pal.list.length);
  blocks.set(idx);
  // a tile written over by a later region's block isn't that block's
  const last = new Map<number, TileData>();
  for (const t of tiles) last.set(t.i, t);
  return { name: 'Main', pos: [0, 0, 0], size: b.size, palette: pal.list, blocks, tiles: [...last.values()], entities };
}

function writeSponge(s: Schematic, r: Region, dv: number): Compound {
  // Sponge has no structure voids: they're air there
  const keys = new Map<string, number>();
  const map = r.palette.map((p) => {
    const st = p.name === VOID ? AIR : p;
    const k = spongeKey(st, dv);
    let i = keys.get(k);
    if (i === undefined) { i = keys.size; keys.set(k, i); }
    return i;
  });
  const data = new Uint32Array(r.blocks.length);
  for (let i = 0; i < data.length; i++) data[i] = map[r.blocks[i]];
  // this game's exact blocks, where every state written under a key agrees on one (a key holds one block)
  const byKey = new Map<string, Set<string>>();
  for (const p of r.palette) {
    if (p.name === VOID || isAir(p)) continue;
    const k = spongeKey(p, dv);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k)!.add(p.game && needsGame(p, dv) ? p.game : '');
  }
  const games: Record<string, Tag> = {};
  for (const [k, gs] of byKey) { const g = [...gs][0]; if (gs.size === 1 && g) games[k] = N.str(g); }
  const [w, , l] = r.size;
  const tiles: Tag[] = [];
  for (const t of r.tiles) {
    const c = tileOut(t, r.palette[r.blocks[t.i]] ?? AIR, dv);
    if (!c) continue;
    const x = t.i % w, z = Math.floor(t.i / w) % l, y = Math.floor(t.i / (w * l));
    const id = c.v.id ?? N.str('');
    delete c.v.id;
    tiles.push(N.comp({ Pos: N.ints([x, y, z]), Id: id, ...c.v }));
  }
  return N.comp({
    Version: N.int(2),
    DataVersion: N.int(dv),
    Metadata: N.comp({ Name: N.str(s.name), Author: N.str(s.author), Date: N.long(Math.round(s.modified)), [GAME_KEY]: Object.keys(games).length ? N.comp(games) : undefined }),
    Width: N.short(r.size[0]), Height: N.short(r.size[1]), Length: N.short(r.size[2]),
    Offset: N.ints([0, 0, 0]),
    PaletteMax: N.int(keys.size),
    Palette: N.comp(Object.fromEntries([...keys].map(([k, i]) => [k, N.int(i)]))),
    BlockData: N.bytes(writeVarints(data)),
    BlockEntities: N.list('compound', tiles),
    Entities: N.list('compound', r.entities.map((e) => {
      const v = { ...e.nbt.v };
      const id = v.id ?? N.str('');
      delete v.id;
      return N.comp({ Pos: N.doubleList(e.pos), Id: id, ...v });
    })),
  });
}

function writeStructure(s: Schematic, r: Region, dv: number): Compound {
  const keys = new Map<string, number>();
  const palette: Compound[] = [];
  const map = r.palette.map((p) => {
    if (p.name === VOID) return -1;
    const k = stateKey(downgrade(p, dv)) + '|' + (p.game ?? '');
    let i = keys.get(k);
    if (i === undefined) { i = palette.length; keys.set(k, i); palette.push(stateToTag(p, dv)); }
    return i;
  });
  const [w, , l] = r.size;
  const tileAt = new Map(r.tiles.map((t) => [t.i, t]));
  const blocks: Tag[] = [];
  for (let i = 0; i < r.blocks.length; i++) {
    const st = map[r.blocks[i]];
    if (st < 0) continue;
    const x = i % w, z = Math.floor(i / w) % l, y = Math.floor(i / (w * l));
    const t = tileAt.get(i);
    const nbt = t ? tileOut(t, r.palette[r.blocks[i]], dv) : null;
    blocks.push(N.comp({ pos: N.intList([x, y, z]), state: N.int(st), nbt: nbt ?? undefined }));
  }
  return N.comp({
    DataVersion: N.int(dv),
    author: s.author ? N.str(s.author) : undefined,
    size: N.intList(r.size),
    palette: N.list('compound', palette),
    blocks: N.list('compound', blocks),
    entities: N.list('compound', r.entities.map((e) => N.comp({
      pos: N.doubleList(e.pos),
      blockPos: N.intList(e.pos.map(Math.floor)),
      nbt: { t: 'compound', v: { ...e.nbt.v, Pos: N.doubleList(e.pos) } },
    }))),
  });
}
