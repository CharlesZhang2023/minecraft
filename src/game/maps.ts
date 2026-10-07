// Maps (1.0-1.16): an empty map becomes a filled one centred on the 128-block grid square (at its scale) the player
// stands in; while someone holds it, the server draws what's around them into its 128 x 128 pixels (vanilla's
// material colours, shaded by the slope towards the north, water by its depth). The pixels live in the world's meta
// and go to each holder's client as an event when they change. The cartography table zooms out, copies and locks.
import { BLOCKS, DYE_COLORS, B } from '../world/blocks';
import type { World } from '../world/world';
import type { WorldMeta } from './storage';
import type { ItemStack } from './items';
import { WorldGen } from '../world/worldgen';
import { OVERWORLD_STRUCTURES } from '../world/structures/overworld';
import { nearestStart } from '../world/structure';

export const MAP_SIZE = 128;
/** Vanilla's material colours (index 0 is "nothing here"). */
export const MAP_BASE = [
  0, 0x7fb238, 0xf7e9a3, 0xc7c7c7, 0xff0000, 0xa0a0ff, 0xa7a7a7, 0x007c00, 0xffffff, 0xa4a8b8, 0x976d4d, 0x707070, 0x4040ff, 0x8f7748, 0xfffcf5,
  // dye colours: orange .. black (white is snow, 8)
  0xd87f33, 0xb24cd8, 0x6699d8, 0xe5e533, 0x7fcc19, 0xf27fa5, 0x4c4c4c, 0x999999, 0x4c7f99, 0x7f3fb2, 0x334cb2, 0x664c33, 0x667f33, 0x993333, 0x191919,
  0xfaee4d, 0x5cdbd5, 0x4a80ff, 0x00d93a, 0x815631, 0x700200,
  // terracotta, white .. black
  0xd1b1a1, 0x9f5224, 0x95576c, 0x706c8a, 0xba8524, 0x677535, 0xa04d4e, 0x392923, 0x876b62, 0x575c5c, 0x7a4958, 0x4c3e5c, 0x4c3223, 0x4c522a, 0x8e3c2e, 0x251610,
  // crimson nylium, stem, hyphae; warped nylium, stem, hyphae, wart
  0xbd3031, 0x943f61, 0x5c191d, 0x167e86, 0x3a8e8c, 0x562c3e, 0x14b485,
];
const C = { grass: 1, sand: 2, wool: 3, fire: 4, ice: 5, metal: 6, plant: 7, snow: 8, clay: 9, dirt: 10, stone: 11, water: 12, wood: 13, quartz: 14, gold: 30, diamond: 31, lapis: 32, emerald: 33, podzol: 34, nether: 35 };
const dye = (i: number) => (i === 0 ? C.snow : 14 + i);
const terracotta = (i: number) => 36 + i;
const SHADES = [180, 220, 255, 135];

/** A block's map colour by its name (0: see through it, to what's below). */
function colourOf(name: string): number {
  if (name === 'air' || /glass(?!_pane)$|^glass_pane$|torch|rail|button|lever|redstone_wire|tripwire|string|barrier|structure_void|light$|_sign$|ladder|cobweb/.test(name)) return 0;
  if (/water|bubble_column|kelp|seagrass/.test(name)) return C.water;
  if (/lava|fire$|^tnt$|redstone_block/.test(name)) return C.fire;
  const col = DYE_COLORS.findIndex((c) => name.startsWith(c + '_'));
  if (col >= 0) return name.includes('terracotta') && !name.includes('glazed') ? terracotta(col) : dye(col);
  if (name === 'terracotta') return dye(1);
  if (name.startsWith('crimson_nylium')) return 52;
  if (/crimson_(stem|planks|slab|stairs|fence|door|trapdoor|sign|pressure|button)/.test(name)) return 53;
  if (name.includes('crimson_hyphae')) return 54;
  if (name.startsWith('warped_nylium')) return 55;
  if (/warped_(stem|planks|slab|stairs|fence|door|trapdoor|sign|pressure|button)/.test(name)) return 56;
  if (name.includes('warped_hyphae')) return 57;
  if (name === 'warped_wart_block') return 58;
  if (/grass_block|slime/.test(name)) return C.grass;
  if (/^(sand|sandstone|smooth_sandstone|cut_sandstone|chiseled_sandstone)|birch_planks|end_stone|glowstone|bone_block|sandstone/.test(name)) return C.sand;
  if (/ice$/.test(name)) return C.ice;
  if (/iron|anvil|cauldron|hopper|brewing|lantern|chain/.test(name)) return C.metal;
  if (/leaves|sapling|flower|grass|fern|vine|cactus|lily_pad|bush|wheat|carrots|potatoes|beetroots|bamboo|sugar_cane|dandelion|poppy|orchid|allium|tulip|daisy|cornflower|lily|rose|peony|lilac|sunflower|melon|pumpkin_stem|sweet_berry|azure|coral/.test(name)) return C.plant;
  if (/^snow/.test(name)) return C.snow;
  if (name === 'clay') return C.clay;
  if (/^podzol|spruce/.test(name)) return C.podzol;
  if (/dirt|farmland|grass_path|granite|jungle|^mud/.test(name)) return C.dirt;
  if (/netherrack|nether_brick|magma|nether_quartz_ore|nether_wart|crimson/.test(name)) return C.nether;
  if (/quartz|diorite|sea_lantern/.test(name)) return C.quartz;
  if (/gold/.test(name)) return C.gold;
  if (/diamond|prismarine_bricks|beacon/.test(name)) return C.diamond;
  if (/lapis/.test(name)) return C.lapis;
  if (/emerald/.test(name)) return C.emerald;
  if (/obsidian|basalt|blackstone|coal_block|dragon/.test(name)) return dye(15);
  if (/mycelium|purpur|shulker_box|chorus/.test(name)) return dye(10);
  if (/soul_s|dark_oak/.test(name)) return dye(12);
  if (/acacia|pumpkin|honey/.test(name)) return dye(1);
  if (/prismarine|warped/.test(name)) return dye(9);
  if (/^wool|white/.test(name)) return C.snow;
  if (/oak|planks|log|wood|chest|crafting|bookshelf|note_block|jukebox|fence|door|barrel|loom|lectern|composter|beehive|bee_nest|campfire|scaffolding|ladder/.test(name)) return C.wood;
  return C.stone;
}
let COLOURS: Uint8Array | null = null;
function colours(): Uint8Array {
  if (!COLOURS) { COLOURS = new Uint8Array(BLOCKS.length); BLOCKS.forEach((b, i) => { if (b) COLOURS![i] = colourOf(b.name); }); }
  return COLOURS;
}

/** A map pixel value (base * 4 + shade) as 0xRRGGBB, or -1 for unexplored. */
export function mapRGB(v: number): number {
  if (v < 4) return -1;
  const c = MAP_BASE[v >> 2] ?? 0, k = SHADES[v & 3];
  return ((((c >> 16) & 255) * k / 255) << 16) | ((((c >> 8) & 255) * k / 255) << 8) | ((c & 255) * k / 255);
}

export interface MapData {
  id: number;
  /** Centre of the map, in blocks. */
  x: number; z: number;
  /** Each pixel is 2^scale blocks across (0-4). */
  scale: number;
  dim: string;
  locked?: boolean;
  colors: Uint8Array;
  /** Bumped whenever a pixel changes (the server sends a holder the map again when it has). */
  ver: number;
  /** Fixed marks (explorer maps' targets), in blocks. */
  marks?: { x: number; z: number; type: string }[];
}
interface StoredMap { x: number; z: number; scale: number; dim: string; locked?: boolean; data: string; marks?: MapData['marks'] }

export function encodeColors(c: Uint8Array): string {
  let s = '';
  for (let i = 0; i < c.length; i += 0x2000) s += String.fromCharCode(...c.subarray(i, i + 0x2000));
  return btoa(s);
}
export function decodeColors(s: string): Uint8Array {
  const b = atob(s), out = new Uint8Array(MAP_SIZE * MAP_SIZE);
  for (let i = 0; i < b.length && i < out.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

type MapMeta = WorldMeta & { maps?: Record<string, StoredMap>; nextMap?: number };
const loaded = new WeakMap<object, Map<number, MapData>>();
/** The world's maps (read from its meta the first time). */
export function mapStore(meta: WorldMeta): Map<number, MapData> {
  let m = loaded.get(meta);
  if (!m) {
    m = new Map();
    for (const [k, v] of Object.entries((meta as MapMeta).maps ?? {})) m.set(Number(k), { id: Number(k), x: v.x, z: v.z, scale: v.scale, dim: v.dim, locked: v.locked, colors: decodeColors(v.data), ver: 1, marks: v.marks });
    loaded.set(meta, m);
  }
  return m;
}
function store(meta: WorldMeta, d: MapData) {
  const mm = meta as MapMeta;
  (mm.maps ??= {})[d.id] = { x: d.x, z: d.z, scale: d.scale, dim: d.dim, locked: d.locked, data: encodeColors(d.colors), ...(d.marks ? { marks: d.marks } : {}) };
}

/** A new map around (x, z): centred on its grid square, like vanilla's. Returns the map. */
export function createMap(meta: WorldMeta, x: number, z: number, scale: number, dim: string, from?: MapData): MapData {
  const mm = meta as MapMeta;
  const id = mm.nextMap ?? Math.max(0, ...Object.keys(mm.maps ?? {}).map(Number).map((n) => n + 1));
  mm.nextMap = id + 1;
  const span = MAP_SIZE << scale;
  const cx = Math.floor((x + 64) / span) * span + span / 2 - 64, cz = Math.floor((z + 64) / span) * span + span / 2 - 64;
  const d: MapData = { id, x: cx, z: cz, scale, dim, colors: from ? from.colors.slice() : new Uint8Array(MAP_SIZE * MAP_SIZE), ver: 1, locked: from?.locked, ...(from?.marks ? { marks: from.marks.map((m) => ({ ...m })) } : {}) };
  if (from && from.scale !== scale) {
    // zoomed out: the old pixels shrink into the middle of the new map (their square is inside it)
    d.colors.fill(0);
    const k = 1 << (scale - from.scale);
    for (let pz = 0; pz < MAP_SIZE; pz++) for (let px = 0; px < MAP_SIZE; px++) {
      const wx = from.x + ((px - 64) << from.scale), wz = from.z + ((pz - 64) << from.scale);
      const qx = Math.floor((wx - d.x) / (1 << scale)) + 64, qz = Math.floor((wz - d.z) / (1 << scale)) + 64;
      if (qx >= 0 && qz >= 0 && qx < MAP_SIZE && qz < MAP_SIZE && px % k === 0 && pz % k === 0) d.colors[qz * MAP_SIZE + qx] = from.colors[pz * MAP_SIZE + px];
    }
  }
  mapStore(meta).set(id, d);
  store(meta, d);
  return d;
}
export const mapIdOf = (s: ItemStack | null | undefined): number | null => (s && typeof s.tag?.map === 'number' ? (s.tag.map as number) : null);

/**
 * Draw one sweep of the map around a holder: every 16th pixel column each tick (vanilla's pace), within 128 blocks.
 * Returns true if any pixel changed.
 */
export function updateMap(w: World, d: MapData, px0: number, pz0: number, tick: number): boolean {
  if (d.locked) return false;
  const col = colours(), s = 1 << d.scale;
  const cx = Math.floor((px0 - d.x) / s) + 64, cz = Math.floor((pz0 - d.z) / s) + 64;
  const r = Math.floor(128 / s);
  const ceiling = w.dimension === 'nether';
  let changed = false;
  for (let px = Math.max(0, cx - r); px < Math.min(MAP_SIZE, cx + r); px++) {
    if ((px & 15) !== (tick & 15)) continue;
    let prevH = -1;
    for (let pz = Math.max(0, cz - r); pz < Math.min(MAP_SIZE, cz + r); pz++) {
      const dx = px - cx, dz = pz - cz;
      if (dx * dx + dz * dz > r * r) { prevH = -1; continue; }
      const wx = d.x + (px - 64) * s + (s >> 1), wz = d.z + (pz - 64) * s + (s >> 1);
      if (!w.isLoaded(wx, wz)) { prevH = -1; continue; }
      let v: number;
      let h = 0;
      if (ceiling) {
        // a dimension with a roof: vanilla's speckle of netherrack and dirt
        const n = ((wx * 3129871) ^ (wz * 116129781)) >>> 0;
        v = ((n >> 20) & 1 ? C.dirt : C.stone) * 4 + (((n >> 12) & 1) + 1);
      } else {
        let y = w.topY(wx, wz), base = 0;
        while (y >= 0) { base = col[w.getId(wx, y, wz)]; if (base) break; y--; }
        h = y;
        if (!base) { prevH = -1; continue; }
        let shade: number;
        if (base === C.water) {
          let depth = 0;
          while (y - depth > 0 && col[w.getId(wx, y - depth - 1, wz)] === C.water && depth < 30) depth++;
          const k = depth * 0.1 + ((px + pz) & 1) * 0.2;
          shade = k < 0.5 ? 2 : k > 0.9 ? 0 : 1;
        } else {
          const k = prevH < 0 ? 0 : (h - prevH) * 4 / (s + 4) + (((px + pz) & 1) - 0.5) * 0.4;
          shade = k > 0.6 ? 2 : k < -0.6 ? 0 : 1;
        }
        v = base * 4 + shade;
      }
      prevH = h;
      const i = pz * MAP_SIZE + px;
      if (d.colors[i] !== v) { d.colors[i] = v; changed = true; }
    }
  }
  if (changed) d.ver++;
  return changed;
}

/** Server: draw the maps people are holding and send each holder the maps that changed since they last saw them. */
const sent = new WeakMap<object, Map<number, number>>();
const dirty = new Set<MapData>();
export function tickMaps(g: { meta: WorldMeta | null; ticks: number }, w: World, players: { entity: { x: number; z: number; inventory: { held(): ItemStack | null; offhand: ItemStack | null } }; event(e: unknown): void }[], frames?: { item: ItemStack | null; x: number; z: number }[]) {
  if (!g.meta) return;
  const maps = mapStore(g.meta);
  for (const sp of players) {
    for (const s of [sp.entity.inventory.held(), sp.entity.inventory.offhand]) {
      if (s && typeof s.tag?.explore === 'string' && mapIdOf(s) === null && w.dimension === 'overworld') resolveExplorer(g.meta, s, sp.entity.x, sp.entity.z);
      const id = mapIdOf(s);
      const d = id === null ? undefined : maps.get(id);
      if (!d) continue;
      if (d.dim === w.dimension && updateMap(w, d, Math.floor(sp.entity.x), Math.floor(sp.entity.z), g.ticks)) dirty.add(d);
      let seen = sent.get(sp);
      if (!seen) sent.set(sp, (seen = new Map()));
      if (seen.get(d.id) !== d.ver && g.ticks % 10 === 0) {
        seen.set(d.id, d.ver);
        sp.event(mapEvent(d));
      }
    }
  }
  // maps hanging in item frames go to everyone near them (once a second)
  if (frames && g.ticks % 20 === 0) for (const f of frames) {
    const id = mapIdOf(f.item), d = id === null ? undefined : maps.get(id);
    if (!d) continue;
    for (const sp of players) {
      if ((sp.entity.x - f.x) ** 2 + (sp.entity.z - f.z) ** 2 > 96 * 96) continue;
      let seen = sent.get(sp);
      if (!seen) sent.set(sp, (seen = new Map()));
      if (seen.get(d.id) === d.ver) continue;
      seen.set(d.id, d.ver);
      sp.event(mapEvent(d));
    }
  }
  // the meta copy is refreshed now and then (it's what gets saved)
  if (g.ticks % 100 === 0) { for (const d of dirty) store(g.meta, d); dirty.clear(); }
}
const mapEvent = (d: MapData) => ['map', d.id, d.x, d.z, d.scale, d.dim, d.locked ? 1 : 0, encodeColors(d.colors), d.marks ?? null];

/** Where explorer maps lead, and at what scale (vanilla: monuments and mansions 1:4, buried treasure 1:2). */
const EXPLORE: Record<string, { structure: string; scale: number; mark: string; name: string }> = {
  monument: { structure: 'ocean_monument', scale: 2, mark: 'monument', name: 'Ocean Explorer Map' },
  mansion: { structure: 'woodland_mansion', scale: 2, mark: 'mansion', name: 'Woodland Explorer Map' },
  buried_treasure: { structure: 'buried_treasure', scale: 1, mark: 'treasure', name: 'Buried Treasure Map' },
};
export const explorerName = (kind: string) => EXPLORE[kind]?.name;
let gen: WorldGen | null = null;
/** Make an explorer map's map: centred on the nearest such structure, its land and water sketched in from the generator. */
export function resolveExplorer(meta: WorldMeta, s: ItemStack, x: number, z: number) {
  const e = EXPLORE[s.tag!.explore as string];
  const t = e && OVERWORLD_STRUCTURES.find((q) => q.name === e.structure);
  if (!t) { delete s.tag!.explore; return; }
  if (!gen || gen.seed !== meta.seed) gen = new WorldGen(meta.seed);
  const st = nearestStart(t, gen, x, z, e.structure === 'woodland_mansion' ? 24 : e.structure === 'buried_treasure' ? 40 : 16);
  if (!st) { s.tag = { ...s.tag, explore: undefined }; delete s.tag.explore; return; }
  const d = createMap(meta, st.x, st.z, e.scale, 'overworld');
  d.marks = [{ x: st.x, z: st.z, type: e.mark }];
  // the sketch: water in orange stripes, land left as paper (it fills in properly as you explore)
  const step = 1 << e.scale;
  const grid = gen.surfaceGrid(d.x - 64 * step, d.z - 64 * step, step, MAP_SIZE);
  for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
    const px = i % MAP_SIZE, pz = (i / MAP_SIZE) | 0;
    if (grid.height[i] < 62) d.colors[pz * MAP_SIZE + px] = dye(1) * 4 + (((px + pz) >> 1) & 1 ? 0 : 1);
  }
  d.ver++;
  store(meta, d);
  s.tag = { map: d.id };
  s.name ??= e.name;
}

/** An explorer map's marks, drawn over the map (ox, oy: its corner; k: screen pixels per map pixel). */
export function drawMapMarks(ctx: { fillStyle: unknown; fillRect(x: number, y: number, w: number, h: number): void }, d: MapData, ox: number, oy: number, k: number) {
  const s = 1 << d.scale;
  for (const m of d.marks ?? []) {
    const mx = ox + ((m.x - d.x) / s + 64) * k, my = oy + ((m.z - d.z) / s + 64) * k, u = Math.max(1, k);
    if (m.type === 'treasure') {
      ctx.fillStyle = '#b02020';
      for (let i = -3; i <= 3; i++) { ctx.fillRect(mx + i * u - u / 2, my + i * u - u / 2, u * 1.5, u * 1.5); ctx.fillRect(mx + i * u - u / 2, my - i * u - u / 2, u * 1.5, u * 1.5); }
    } else {
      // a little building: the monument teal, the mansion dark wood
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(mx - 4.5 * u, my - 4.5 * u, 9 * u, 9 * u);
      ctx.fillStyle = m.type === 'monument' ? '#3aa8a0' : '#5a3a22';
      ctx.fillRect(mx - 3.5 * u, my - 2.5 * u, 7 * u, 6 * u);
      ctx.fillRect(mx - 1.5 * u, my - 3.5 * u, 3 * u, 1 * u);
    }
  }
}

/** Lock a map's pixels (a glass pane at the cartography table). */
export function lockMap(meta: WorldMeta, from: MapData): MapData {
  const d = createMap(meta, from.x, from.z, from.scale, from.dim, from);
  d.x = from.x; d.z = from.z; d.locked = true;
  store(meta, d);
  return d;
}
void B;
