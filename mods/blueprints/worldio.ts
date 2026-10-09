// Whole worlds between this game and Java Edition.
//
// Import: a Java world (a folder or a .zip of one, from 1.13 to 26.x's new folder layout) becomes a new world in
// the list: its chunks within the chosen distance of the player (or of spawn), the mobs there, the player with
// their inventory, spawn, time and game mode. Chunks are stored as "foreign" (not this game's generator), so players
// joining get them whole. Beyond them, this game generates its own terrain.
//
// Export: a world here becomes a .zip of a Java 1.20.4 world (every newer Minecraft upgrades it on opening): every
// chunk anyone changed, plus all chunks within the chosen distance of the player (generated now if nobody went
// there), the mobs, the player and level.dat. Beyond them Java generates its own terrain from the seed.
import type { Mc } from '../sdk';
import * as N from './nbt';
import type { Compound } from './nbt';
import type { Archive } from './zip';
import { ZipWriter } from './zip';
import { regionChunks, readRegionChunk, RegionWriter, regionName } from './anvil';
import { readChunk, writeChunk, readLevel, playerFromJava, playerToJava, writeLevel, mobFromJava, mobToJava, substituted, type Dim, type JavaLevel, WORLD_VERSION_NAME } from './javaworld';

let mc: Mc;
export function initWorldIO(m: Mc) { mc = m; }

type WorldMeta = Awaited<ReturnType<Mc['storage']['listWorlds']>>[number];
export type Progress = (done: number, total: number, what: string) => void;
const DIMS: Dim[] = ['overworld', 'nether', 'end'];
const storeId = (id: string, d: Dim) => (d === 'overworld' ? id : `${id}~${d}`);
const yieldNow = () => new Promise((r) => setTimeout(r, 0));

// ------------------------------------------------------------------ import
export interface Scan {
  root: string;
  level: JavaLevel;
  /** Region files by dimension (paths in the archive). */
  regions: Record<Dim, string[]>;
  entities: Record<Dim, string[]>;
  /** The player (if the world has one) and where they are. */
  player: { data: Record<string, unknown>; dim: Dim } | null;
}

/** Find a Java world in an archive and read what it is. */
export async function scanWorld(ar: Archive): Promise<Scan> {
  const lvl = ar.names.filter((n) => /(^|\/)level\.dat$/.test(n)).sort((a, b) => a.length - b.length)[0];
  if (!lvl) throw new Error('No level.dat here: pick a Java world\'s folder (the one in .minecraft/saves) or a .zip of it');
  const root = lvl.slice(0, -'level.dat'.length);
  const level = readLevel((await N.readFile(await ar.read(lvl))).root);
  const dirs: Record<Dim, string[]> = {
    overworld: ['region/', 'dimensions/minecraft/overworld/region/'],
    nether: ['DIM-1/region/', 'dimensions/minecraft/the_nether/region/'],
    end: ['DIM1/region/', 'dimensions/minecraft/the_end/region/'],
  };
  const regions = { overworld: [], nether: [], end: [] } as Record<Dim, string[]>, entities = { overworld: [], nether: [], end: [] } as Record<Dim, string[]>;
  for (const d of DIMS) {
    for (const n of ar.names) {
      if (!n.startsWith(root) || !/r\.-?\d+\.-?\d+\.mca$/.test(n)) continue;
      const rel = n.slice(root.length);
      const dir = rel.slice(0, rel.lastIndexOf('/') + 1);
      if (dirs[d].includes(dir)) regions[d].push(n);
      if (dirs[d].map((p) => p.replace(/region\/$/, 'entities/')).includes(dir)) entities[d].push(n);
    }
  }
  // the player: in level.dat, or (26.1+, and servers) a file of their own
  let pl: Compound | null = level.player;
  if (!pl) {
    const files = ar.names.filter((n) => n.startsWith(root) && /(playerdata|players\/data)\/[0-9a-f-]+\.dat$/.test(n));
    const own = level.playerUuid ? files.find((n) => n.includes(level.playerUuid!)) : files[0];
    if (own) pl = (await N.readFile(await ar.read(own))).root;
  }
  const pj = pl ? playerFromJava(pl, N.num(N.get(pl, 'DataVersion'), level.dataVersion)) : null;
  const player = pj ? { data: pj.player, dim: pj.dim } : null;
  return { root, level, regions, entities, player };
}

export interface ImportOptions {
  name: string;
  /** Chunks from the centre (the player in the overworld, else spawn); null: everything. */
  radius: number | null;
  dims: Dim[];
}

/** The new world's id. */
export async function importWorld(ar: Archive, scan: Scan, o: ImportOptions, progress: Progress): Promise<{ id: string; chunks: number; mobs: number; substituted: string[] }> {
  const st = mc.storage;
  const now = Date.now();
  const id = 'w' + now.toString(36);
  substituted.clear();
  const centre = (d: Dim): [number, number] | null => {
    if (scan.player && scan.player.dim === d) return [Math.floor((scan.player.data.x as number) / 16), Math.floor((scan.player.data.z as number) / 16)];
    return d === 'overworld' ? [scan.level.spawn[0] >> 4, scan.level.spawn[2] >> 4] : null;
  };
  const near = (d: Dim, cx: number, cz: number) => {
    if (o.radius === null) return true;
    const c = centre(d) ?? [0, 0];
    return (cx - c[0]) ** 2 + (cz - c[1]) ** 2 <= o.radius * o.radius;
  };
  const regionNear = (d: Dim, rx: number, rz: number) => {
    if (o.radius === null) return true;
    const c = centre(d) ?? [0, 0], r = o.radius;
    return rx * 32 + 31 >= c[0] - r && rx * 32 <= c[0] + r && rz * 32 + 31 >= c[1] - r && rz * 32 <= c[1] + r;
  };
  const rxz = (path: string) => { const m = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(path)!; return [Number(m[1]), Number(m[2])]; };
  const work = o.dims.flatMap((d) => scan.regions[d].filter((p) => regionNear(d, ...(rxz(p) as [number, number]))).map((p) => [d, p] as const));
  const entityWork = o.dims.flatMap((d) => scan.entities[d].filter((p) => regionNear(d, ...(rxz(p) as [number, number]))).map((p) => [d, p] as const));
  const mobs: Record<Dim, Record<string, unknown>[]> = { overworld: [], nether: [], end: [] };
  let chunks = 0, done = 0;
  // where the player and spawn stand: the top of their columns, once those chunks are read
  const surface = new Map<string, number>();
  const want = [[scan.level.spawn[0], scan.level.spawn[2], 'overworld'], ...(scan.player ? [[scan.player.data.x, scan.player.data.z, scan.player.dim]] : [])] as [number, number, Dim][];
  for (const [d, path] of work) {
    progress(done++, work.length + entityWork.length, `Reading ${path.slice(scan.root.length)}`);
    const data = await ar.read(path);
    const list: [string, unknown][] = [];
    const [rx, rz] = rxz(path);
    for (const [i, off] of regionChunks(data)) {
      const cx = rx * 32 + (i & 31), cz = rz * 32 + (i >> 5);
      if (!near(d, cx, cz)) continue;
      let root: Compound | null = null;
      try {
        root = await readRegionChunk(data, off, async () => { const ext = path.replace(/r\.(-?\d+)\.(-?\d+)\.mca$/, `c.${cx}.${cz}.mcc`); return ar.names.includes(ext) ? ar.read(ext) : null; });
      } catch { root = null; }
      if (!root) continue;
      const c = readChunk(root, d);
      if (!c) continue;
      for (const e of c.entities) if (mobs[d].length < 3000) mobs[d].push(e);
      for (const [wx, wz, wd] of want) {
        if (wd !== d || Math.floor(wx / 16) !== cx || Math.floor(wz / 16) !== cz) continue;
        const lx = Math.floor(wx) & 15, lz = Math.floor(wz) & 15;
        let y = 255;
        while (y > 1 && !c.blocks[(y * 16 + lz) * 16 + lx]) y--;
        surface.set(`${wd}:${Math.floor(wx)}:${Math.floor(wz)}`, y + 1);
      }
      list.push([`${cx},${cz}`, { blocks: mc.rleEncode(c.blocks), biomes: c.biomes, tiles: c.tiles, foreign: true }]);
      chunks++;
    }
    if (list.length) await st.saveChunks(storeId(id, d), list as never);
    await yieldNow();
  }
  // mobs kept apart (1.17+)
  for (const [d, path] of entityWork) {
    progress(done++, work.length + entityWork.length, `Reading ${path.slice(scan.root.length)}`);
    const data = await ar.read(path);
    for (const [, off] of regionChunks(data)) {
      const root = await readRegionChunk(data, off).catch(() => null);
      if (!root) continue;
      const dv = N.num(N.get(root, 'DataVersion'), scan.level.dataVersion);
      for (const e of N.items(N.get(root, 'Entities'))) {
        const m = mobFromJava(e, dv);
        if (m && near(d, Math.floor((m.x as number) / 16), Math.floor((m.z as number) / 16)) && mobs[d].length < 3000) mobs[d].push(m);
      }
    }
    await yieldNow();
  }
  const sp = scan.level.spawn;
  const spawnY = surface.get(`overworld:${Math.floor(sp[0])}:${Math.floor(sp[2])}`) ?? Math.max(64, Math.min(250, sp[1]));
  const meta: WorldMeta = {
    id, name: o.name || scan.level.name, seed: Number(BigInt.asIntN(32, BigInt(scan.level.seedText || '0'))) || 1, seedText: scan.level.seedText || '0',
    gameMode: scan.level.gameMode === 1 ? 1 : 0, hardcore: scan.level.hardcore, created: now, lastPlayed: now, time: scan.level.time,
    spawn: [sp[0], spawnY, sp[2]], cheatsForAll: false,
    entities: mobs.overworld, netherEntities: mobs.nether, endEntities: mobs.end,
  };
  if (scan.player && o.dims.includes(scan.player.dim)) {
    const p = { ...scan.player.data };
    const s = surface.get(`${scan.player.dim}:${Math.floor(p.x as number)}:${Math.floor(p.z as number)}`);
    // underground below this game's floor, or above its sky: stand them on top
    const y = (p.y as number);
    if (s !== undefined && (y < 1 || y > 254)) p.y = s;
    meta.player = p;
    meta.dimension = scan.player.dim;
  }
  await st.saveWorld(meta);
  progress(1, 1, 'Done');
  return { id, chunks, mobs: mobs.overworld.length + mobs.nether.length + mobs.end.length, substituted: [...substituted.keys()] };
}

// ------------------------------------------------------------------ export
export interface ExportOptions {
  /** Chunks around the player (or spawn) to include even if nobody changed them. */
  radius: number;
}

/** A .zip holding the world as a Java Edition world folder. */
export async function exportWorld(meta: WorldMeta, o: ExportOptions, progress: Progress): Promise<{ zip: Blob; chunks: number; mobs: number; file: string }> {
  const st = mc.storage;
  const folder = meta.name.replace(/[^\w .()-]+/g, '_').trim() || 'World';
  const zip = new ZipWriter();
  const player = meta.player as Record<string, unknown> | undefined;
  const pdim = (meta.dimension ?? 'overworld') as Dim;
  const spawn = (meta.spawn ?? (player ? [Math.floor(player.x as number), Math.floor(player.y as number), Math.floor(player.z as number)] : [0, 64, 0])) as [number, number, number];
  let chunks = 0, mobCount = 0;
  // what to write, per dimension: changed chunks and the area around the player (or spawn)
  const plan: [Dim, Set<string>, Set<string>][] = [];
  for (const d of DIMS) {
    const saved = await st.chunkKeys(storeId(meta.id, d));
    const area = new Set(saved);
    const centre = player && pdim === d ? [Math.floor((player.x as number) / 16), Math.floor((player.z as number) / 16)] : d === 'overworld' ? [spawn[0] >> 4, spawn[2] >> 4] : null;
    if (centre) for (let dx = -o.radius; dx <= o.radius; dx++) for (let dz = -o.radius; dz <= o.radius; dz++) if (dx * dx + dz * dz <= o.radius * o.radius) area.add(`${centre[0] + dx},${centre[1] + dz}`);
    if (area.size) plan.push([d, area, saved]);
  }
  const total = plan.reduce((a, [, s]) => a + s.size, 0);
  let done = 0;
  for (const [d, area, saved] of plan) {
    const gen = new mc.World(meta.seed, `${meta.id}~export`, d, 'local');
    const sub = d === 'overworld' ? '' : d === 'nether' ? 'DIM-1/' : 'DIM1/';
    try {
      // region by region, with the chunks around each loaded so edges join up
      const regions = new Map<string, [number, number][]>();
      for (const k of area) { const [cx, cz] = k.split(',').map(Number); const r = regionName(cx, cz); if (!regions.has(r)) regions.set(r, []); regions.get(r)!.push([cx, cz]); }
      const cache = new Map<string, { blocks: Uint16Array; biomes: Uint8Array; tiles: [number, Record<string, unknown>][] } | null>();
      const load = async (cx: number, cz: number) => {
        const k = `${cx},${cz}`;
        if (cache.has(k)) return cache.get(k)!;
        let c = null;
        if (saved.has(k)) {
          const s = await st.loadChunk(storeId(meta.id, d), k);
          if (s) c = { blocks: mc.rleDecode(s.blocks, 65536), biomes: s.biomes, tiles: (s.tiles ?? []) as [number, Record<string, unknown>][] };
        } else if (area.has(k)) {
          const g = await gen.generateExtra(cx, cz);
          c = { blocks: g.blocks, biomes: g.biomes, tiles: [] };
        }
        cache.set(k, c);
        return c;
      };
      for (const [rname, list] of regions) {
        const writer = new RegionWriter();
        // this region's chunks and a ring around them
        const need = new Set<string>();
        for (const [cx, cz] of list) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) need.add(`${cx + dx},${cz + dz}`);
        for (const k of need) { const [cx, cz] = k.split(',').map(Number); await load(cx, cz); }
        const at = (x: number, y: number, z: number) => {
          if (y < 0 || y > 255) return 0;
          const c = cache.get(`${x >> 4},${z >> 4}`);
          return c ? c.blocks[(y * 16 + (z & 15)) * 16 + (x & 15)] : 0;
        };
        for (const [cx, cz] of list) {
          const c = cache.get(`${cx},${cz}`);
          if (c) { await writer.add(cx, cz, writeChunk(cx, cz, c, at)); chunks++; }
          progress(++done, total, `Writing ${sub}region/${rname}`);
        }
        if (writer.size) await zip.add(`${folder}/${sub}region/${rname}`, writer.finish());
        // keep only what the next region (in order) may still need
        for (const k of [...cache.keys()]) if (!need.has(k)) cache.delete(k);
        await yieldNow();
      }
    } finally { gen.destroy(); }
    // mobs, in entities/ by region (1.17+)
    const list = ((d === 'nether' ? meta.netherEntities : d === 'end' ? meta.endEntities : meta.entities) ?? []) as Record<string, unknown>[];
    const byChunk = new Map<string, Compound[]>();
    for (const e of list) {
      const j = mobToJava(e);
      if (!j) continue;
      const k = `${Math.floor((e.x as number) / 16)},${Math.floor((e.z as number) / 16)}`;
      if (!byChunk.has(k)) byChunk.set(k, []);
      byChunk.get(k)!.push(j);
      mobCount++;
    }
    const ents = new Map<string, RegionWriter>();
    for (const [k, l] of byChunk) {
      const [cx, cz] = k.split(',').map(Number);
      const r = regionName(cx, cz);
      if (!ents.has(r)) ents.set(r, new RegionWriter());
      await ents.get(r)!.add(cx, cz, N.comp({ DataVersion: N.int(3700), Position: N.ints([cx, cz]), Entities: N.list('compound', l) }));
    }
    for (const [r, w] of ents) await zip.add(`${folder}/${sub}entities/${r}`, w.finish());
  }
  const level = writeLevel({
    name: meta.name, seed: BigInt(meta.seed), spawn, time: meta.time ?? 0, gameMode: meta.gameMode, hardcore: !!meta.hardcore, allowCommands: true,
    player: player ? playerToJava(player, pdim) : null,
  });
  await zip.add(`${folder}/level.dat`, await N.writeFile(level));
  await zip.add(`${folder}/session.lock`, new TextEncoder().encode('☃'));
  progress(total, total, 'Done');
  return { zip: zip.finish(), chunks, mobs: mobCount, file: `${folder} (Java ${WORLD_VERSION_NAME}).zip` };
}
