// Java Edition worlds, chunk by chunk: their chunks (1.13 to today: the old "Level" layout and the 1.18+ one,
// packed palettes, biomes by number or by name), block entities, mobs, the player and level.dat, turned into this
// game's chunk columns, tiles, entity records and world settings, and back.
//
// Heights: this game holds y 0-255. A 1.18+ world's blocks below 0 and above 255 stay behind, and bedrock goes
// at y 0 (where a 1.18 world has deepslate). Blocks newer than this game get the nearest block it has (deepslate
// is stone, copper is terracotta...), or the player's own stand-ins (Unknown Blocks).
import type { Mc, ItemStack } from '../sdk';
import * as N from './nbt';
import type { Compound, Tag } from './nbt';
import type { BlockState } from './model';
import { fromJava, toJava, upgrade, downgrade } from './vanilla';
import { itemFromNbt, itemToNbt, tileFromNbt, tileToNbt, blockEntityId, embeddedTile, GAME_TAG } from './tiles';
import { remaps } from './placement';

let mc: Mc;
export function initJavaWorld(m: Mc) { mc = m; resolved.clear(); }

export type Dim = 'overworld' | 'nether' | 'end';
export const JAVA_DIMS: Record<Dim, string> = { overworld: 'minecraft:overworld', nether: 'minecraft:the_nether', end: 'minecraft:the_end' };
/** The data version worlds are written for: 1.20.4. Every newer Minecraft upgrades a world from it when it opens it. */
export const WORLD_DV = 3700;
export const WORLD_VERSION_NAME = '1.20.4';
const DV_1_16 = 2529, DV_1_18 = 2825;
const COLUMN = 16 * 16 * 256;

// ------------------------------------------------------------------ blocks this game doesn't have
/** Materials of newer Java blocks and the nearest this game has (tried in order, on the block's name). */
const MATERIALS: [RegExp, string][] = [
  [/^(waxed_)?(exposed_|weathered_|oxidized_)?/, ''],
  [/^reinforced_deepslate$/, 'obsidian'], [/^cobbled_deepslate/, 'cobblestone'], [/^polished_deepslate/, 'polished_andesite'],
  [/^cracked_deepslate_(bricks|tiles)$/, 'cracked_stone_bricks'], [/^chiseled_deepslate$/, 'chiseled_stone_bricks'],
  [/^deepslate_(brick|tile)/, 'stone_brick'], [/^deepslate_(\w+_ore)$/, '$1'], [/^deepslate$/, 'stone'], [/^infested_deepslate$/, 'infested_stone'],
  [/^polished_tuff/, 'polished_andesite'], [/^tuff_brick/, 'stone_brick'], [/^chiseled_tuff(_bricks)?$/, 'chiseled_stone_bricks'], [/^tuff/, 'andesite'],
  [/^calcite$/, 'diorite'], [/^smooth_basalt$/, 'polished_basalt'], [/^dripstone_block$/, 'granite'], [/^(budding_)?amethyst_block$/, 'purpur_block'],
  [/^mud_brick/, 'brick'], [/^(packed_)?mud$/, 'dirt'], [/^muddy_mangrove_roots$/, 'dirt'], [/^rooted_dirt$/, 'coarse_dirt'], [/^moss_block$/, 'green_concrete_powder'],
  [/^moss_carpet$/, 'green_carpet'], [/^(flowering_)?azalea_leaves$/, 'oak_leaves'], [/^powder_snow$/, 'snow_block'], [/^tinted_glass$/, 'black_stained_glass'],
  [/^cut_copper_(stairs|slab)$/, 'red_sandstone_$1'], [/^cut_copper/, 'cut_red_sandstone'], [/^chiseled_copper$/, 'chiseled_red_sandstone'], [/^copper_grate$/, 'iron_bars'], [/^copper_door$/, 'iron_door'],
  [/^copper_trapdoor$/, 'iron_trapdoor'], [/^copper_bulb$/, 'redstone_lamp'], [/^(raw_)?copper(_block)?$/, 'orange_terracotta'], [/^raw_iron_block$/, 'iron_block'],
  [/^raw_gold_block$/, 'gold_block'], [/^sculk(_catalyst|_shrieker|_sensor)?$/, 'black_concrete'], [/^calibrated_sculk_sensor$/, 'black_concrete'],
  [/^crafter$/, 'dropper'], [/^(trial_spawner|vault)$/, 'spawner'], [/^heavy_core$/, 'iron_block'], [/_froglight$/, 'shroomlight'],
  [/^suspicious_sand$/, 'sand'], [/^suspicious_gravel$/, 'gravel'], [/^chiseled_bookshelf$/, 'bookshelf'], [/^lightning_rod$/, 'end_rod'],
  [/^sniffer_egg$/, 'turtle_egg'], [/^decorated_pot$/, 'flower_pot'], [/^resin_brick/, 'red_nether_brick'], [/^(chiseled_)?resin_block$/, 'orange_terracotta'],
  [/^(mangrove|bamboo)_/, 'jungle_'], [/^(cherry|pale_oak)_/, 'birch_'], [/^stripped_(mangrove|bamboo)_/, 'stripped_jungle_'], [/^stripped_(cherry|pale_oak)_/, 'stripped_birch_'],
  [/^bamboo_mosaic/, 'oak_planks'], [/^bamboo_block$/, 'jungle_log'], [/^copper_chain$/, 'iron_chain'], [/^(copper|iron)_lantern$/, 'lantern'],
];
/** By the shape a name ends in, when its material didn't help. */
const SHAPES: [RegExp, string][] = [
  [/_wall_hanging_sign$|_hanging_sign$/, 'air'], [/_wall_sign$/, 'oak_wall_sign'], [/_sign$/, 'oak_sign'], [/_stairs$/, 'cobblestone_stairs'],
  [/_slab$/, 'cobblestone_slab'], [/_wall$/, 'cobblestone_wall'], [/_fence_gate$/, 'oak_fence_gate'], [/_fence$/, 'oak_fence'],
  [/_trapdoor$/, 'oak_trapdoor'], [/_door$/, 'oak_door'], [/_button$/, 'stone_button'], [/_pressure_plate$/, 'stone_pressure_plate'],
  [/_leaves$/, 'oak_leaves'], [/(_log|_stem)$/, 'oak_log'], [/(_wood|_hyphae)$/, 'oak_wood'], [/_planks$/, 'oak_planks'], [/_carpet$/, 'white_carpet'],
  [/_glass_pane$/, 'glass_pane'], [/_glass$/, 'glass'], [/_bed$/, 'red_bed'], [/_ore$/, 'stone'], [/_bricks$/, 'stone_bricks'], [/_tiles$/, 'stone_bricks'],
];
/** Newer things that aren't blocks you'd miss: left out. */
const NOT_SOLID = /(grass|flower|sapling|vine|roots|sprouts|lichen|candle|rail|torch|banner|head|skull|pot|vein|spore|dripleaf|propagule|petals|bush|fungus|mushroom|lantern|chain|bars|frogspawn|egg|amethyst_bud|cluster|pointed_dripstone|light$|air$|structure_void|barrier|jigsaw|leaf_litter|eyeblossom|cactus_flower|firefly|hanging_moss|creaking_heart|wildflowers)/;

/** What each Java state became, and which names were stood in for (for the import's report). */
const resolved = new Map<string, number>();
export const substituted = new Map<string, string>();

/** This game's block for a Java state (today's names), always something: a stand-in if it has to be. */
export function worldBlock(s: BlockState): number {
  const key = s.name + JSON.stringify(s.props);
  const hit = resolved.get(key);
  if (hit !== undefined) return hit;
  let v = fromJava(s);
  if (v === null) {
    const re = remaps.get(s.name);
    if (re) { try { v = mc.blockspec.parseBlock(re); } catch { v = null; } }
  }
  if (v === null) v = standIn(s);
  resolved.set(key, v);
  return v;
}

function standIn(s: BlockState): number {
  const short = s.name.replace(/^minecraft:/, '');
  const tryName = (n: string) => (n === 'air' ? 0 : fromJava({ name: 'minecraft:' + n, props: s.props }));
  let name = short;
  for (const [re, to] of MATERIALS) {
    if (!re.test(name)) continue;
    name = name.replace(re, to);
    const v = tryName(name);
    if (v !== null) { substituted.set(s.name, mc.BLOCKS[v & 0xfff].name); return v; }
  }
  for (const [re, to] of SHAPES) {
    if (!re.test(name)) continue;
    const v = tryName(to);
    if (v !== null) { substituted.set(s.name, to); return v; }
  }
  const out = NOT_SOLID.test(short) ? 'air' : 'stone';
  substituted.set(s.name, out);
  return out === 'air' ? 0 : mc.blockspec.parseBlock('stone');
}

// ------------------------------------------------------------------ biomes
/** Biome numbers (1.13 to 1.17) and the names they had. */
const BIOME_IDS: Record<number, string> = {
  0: 'ocean', 1: 'plains', 2: 'desert', 3: 'mountains', 4: 'forest', 5: 'taiga', 6: 'swamp', 7: 'river', 8: 'nether_wastes', 9: 'the_end',
  10: 'frozen_ocean', 11: 'frozen_river', 12: 'snowy_tundra', 13: 'snowy_mountains', 14: 'mushroom_fields', 15: 'mushroom_field_shore', 16: 'beach',
  17: 'desert_hills', 18: 'wooded_hills', 19: 'taiga_hills', 20: 'mountain_edge', 21: 'jungle', 22: 'jungle_hills', 23: 'jungle_edge', 24: 'deep_ocean',
  25: 'stone_shore', 26: 'snowy_beach', 27: 'birch_forest', 28: 'birch_forest_hills', 29: 'dark_forest', 30: 'snowy_taiga', 31: 'snowy_taiga_hills',
  32: 'giant_tree_taiga', 33: 'giant_tree_taiga_hills', 34: 'wooded_mountains', 35: 'savanna', 36: 'savanna_plateau', 37: 'badlands',
  38: 'wooded_badlands_plateau', 39: 'badlands_plateau', 40: 'small_end_islands', 41: 'end_midlands', 42: 'end_highlands', 43: 'end_barrens',
  44: 'warm_ocean', 45: 'lukewarm_ocean', 46: 'cold_ocean', 47: 'deep_warm_ocean', 48: 'deep_lukewarm_ocean', 49: 'deep_cold_ocean', 50: 'deep_frozen_ocean',
  127: 'the_void', 129: 'sunflower_plains', 130: 'desert_lakes', 131: 'gravelly_mountains', 132: 'flower_forest', 133: 'taiga_mountains', 134: 'swamp_hills',
  140: 'ice_spikes', 149: 'modified_jungle', 151: 'modified_jungle_edge', 155: 'tall_birch_forest', 156: 'tall_birch_hills', 157: 'dark_forest_hills',
  158: 'snowy_taiga_mountains', 160: 'giant_spruce_taiga', 161: 'giant_spruce_taiga_hills', 162: 'modified_gravelly_mountains', 163: 'shattered_savanna',
  164: 'shattered_savanna_plateau', 165: 'eroded_badlands', 166: 'modified_wooded_badlands_plateau', 167: 'modified_badlands_plateau', 168: 'bamboo_jungle',
  169: 'bamboo_jungle_hills', 170: 'soul_sand_valley', 171: 'crimson_forest', 172: 'warped_forest', 173: 'basalt_deltas',
};
/** This game's biomes by their Java name today (where it isn't just the name in snake case). */
const BIOME_NAMES: Record<string, string> = {
  'Giant Tree Taiga': 'old_growth_pine_taiga', 'Gravelly Mountains': 'windswept_gravelly_hills', 'Jungle Edge': 'sparse_jungle',
  'Wooded Badlands Plateau': 'wooded_badlands', 'Stone Shore': 'stony_shore', 'Snowy Mountains': 'snowy_slopes', 'Tall Birch Forest': 'old_growth_birch_forest',
};
/** Java biomes (any version's names) this game has under another name. */
const BIOME_ALIASES: Record<string, string> = {
  mountains: 'Windswept Hills', wooded_mountains: 'Windswept Hills', windswept_forest: 'Windswept Hills', stony_peaks: 'Windswept Hills', mountain_edge: 'Windswept Hills',
  snowy_tundra: 'Snowy Plains', giant_tree_taiga: 'Giant Tree Taiga', giant_spruce_taiga: 'Giant Tree Taiga', old_growth_spruce_taiga: 'Giant Tree Taiga',
  gravelly_mountains: 'Gravelly Mountains', modified_gravelly_mountains: 'Gravelly Mountains', windswept_gravelly_hills: 'Gravelly Mountains',
  stone_shore: 'Stone Shore', tall_birch_forest: 'Tall Birch Forest', wooded_badlands_plateau: 'Wooded Badlands Plateau', snowy_mountains: 'Snowy Mountains',
  snowy_slopes: 'Snowy Mountains', frozen_peaks: 'Snowy Mountains', jagged_peaks: 'Snowy Mountains', grove: 'Snowy Taiga', meadow: 'Plains',
  cherry_grove: 'Flower Forest', mushroom_field_shore: 'Mushroom Fields', nether: 'Nether Wastes', windswept_savanna: 'Savanna', shattered_savanna: 'Savanna',
  eroded_badlands: 'Badlands', mangrove_swamp: 'Swamp', swamp_hills: 'Swamp', pale_garden: 'Dark Forest', deep_dark: 'Plains', lush_caves: 'Plains',
  dripstone_caves: 'Plains', the_void: 'Plains', desert_lakes: 'Desert', ice_spikes: 'Ice Spikes', sparse_jungle: 'Jungle Edge', modified_jungle_edge: 'Jungle Edge',
};
let biomeIndex: Map<string, number> | null = null;
/** This game's biome index for a Java biome name. */
export function biomeFromJava(name: string, dim: Dim): number {
  if (!biomeIndex) {
    biomeIndex = new Map();
    mc.BIOMES.forEach((b, i) => biomeIndex!.set(BIOME_NAMES[b.name] ?? b.name.toLowerCase().replace(/ /g, '_'), i));
  }
  const n = name.replace(/^minecraft:/, '');
  const direct = biomeIndex.get(n);
  if (direct !== undefined) return direct;
  const alias = BIOME_ALIASES[n];
  if (alias) { const i = mc.BIOMES.findIndex((b) => b.name === alias); if (i >= 0) return i; }
  // hills, plateaus and "modified" variants of a biome this game has
  const base = n.replace(/^(modified|tall|deep_)_?/, '').replace(/_(hills|mountains|plateau|edge|lakes)$/, '');
  const b2 = biomeIndex.get(base);
  if (b2 !== undefined) return b2;
  const def = dim === 'nether' ? 'nether_wastes' : dim === 'end' ? 'the_end' : n.includes('ocean') ? 'ocean' : 'plains';
  return biomeIndex.get(def) ?? 0;
}
/** A biome of this game by Java's name today. */
export function biomeToJava(i: number): string {
  const b = mc.BIOMES[i];
  return 'minecraft:' + (b ? BIOME_NAMES[b.name] ?? b.name.toLowerCase().replace(/ /g, '_') : 'plains');
}

// ------------------------------------------------------------------ packed arrays
/** Entries of `bits` bits from a long array: back to back (before 1.16) or never across two longs (since). */
function unpack(longs: BigInt64Array, bits: number, n: number, spanning: boolean): Uint32Array {
  const out = new Uint32Array(n);
  if (!bits) return out;
  const w = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2);
  const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
  const per = Math.floor(64 / bits);
  for (let i = 0; i < n; i++) {
    let bit: number;
    if (spanning) bit = i * bits;
    else { const l = Math.floor(i / per); bit = l * 64 + (i - l * per) * bits; }
    const k = bit >>> 5, off = bit & 31;
    if (k >= w.length) break;
    let v = w[k] >>> off;
    if (off + bits > 32 && k + 1 < w.length) v |= w[k + 1] << (32 - off);
    out[i] = (v & mask) >>> 0;
  }
  return out;
}
/** Entries packed the 1.16+ way (whole entries per long). */
function pack(vals: ArrayLike<number>, bits: number): BigInt64Array {
  const per = Math.floor(64 / bits);
  const longs = new BigInt64Array(Math.ceil(vals.length / per));
  const w = new Uint32Array(longs.buffer);
  for (let i = 0; i < vals.length; i++) {
    const l = Math.floor(i / per), bit = l * 64 + (i - l * per) * bits, k = bit >>> 5, off = bit & 31, v = vals[i] >>> 0;
    w[k] |= (v << off) >>> 0;
    if (off + bits > 32) w[k + 1] |= v >>> (32 - off);
  }
  return longs;
}
const bitsFor = (n: number) => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));

// ------------------------------------------------------------------ chunks: Java -> game
export interface GameChunk {
  blocks: Uint16Array;
  biomes: Uint8Array;
  tiles: [number, Record<string, unknown>][];
  /** Mobs, in the game's entity records (absolute positions). */
  entities: Record<string, unknown>[];
}

const FULL = new Set(['full', 'minecraft:full', 'postprocessed', 'minecraft:postprocessed', 'fullchunk']);

/** A Java chunk as one of this game's chunk columns, or null if it isn't finished (being generated) or unreadable. */
export function readChunk(root: Compound, dim: Dim): GameChunk | null {
  const dv = N.num(N.get(root, 'DataVersion'), 1631);
  const level = N.compound(N.get(root, 'Level')) ?? root;
  const status = N.text(N.get(level, 'Status') ?? N.get(level, 'status'), 'full');
  if (!FULL.has(status)) return null;
  const blocks = new Uint16Array(COLUMN);
  const sections = N.items(N.get(level, 'sections') ?? N.get(level, 'Sections'));
  const biomes3d: (number[] | null)[] = new Array(16).fill(null);
  for (const sec of sections) {
    const Y = N.num(N.get(sec, 'Y'));
    if (Y < 0 || Y > 15) continue;
    const bs = N.compound(N.get(sec, 'block_states'));
    const palTag = bs ? N.get(bs, 'palette') : N.get(sec, 'Palette');
    const dataTag = bs ? N.get(bs, 'data') : N.get(sec, 'BlockStates');
    const pal = N.items(palTag);
    if (!pal.length) continue;
    const vals = pal.map((p) => worldBlock(paletteState(p, dv)));
    const base = Y * 4096;
    if (pal.length === 1 || dataTag?.t !== 'longs') {
      if (vals[0]) blocks.fill(vals[0], base, base + 4096);
    } else {
      const bits = Math.max(4, bitsFor(pal.length));
      const idx = unpack(dataTag.v, bits, 4096, dv < DV_1_16);
      for (let i = 0; i < 4096; i++) blocks[base + i] = vals[idx[i]] ?? 0;
    }
    // 1.18+: biomes by name, 4x4x4 cells (4096 single blocks in the newest snapshots)
    const bio = N.compound(N.get(sec, 'biomes'));
    if (bio) {
      const bp = N.items(N.get(bio, 'palette')).map((t) => biomeFromJava(N.text(t), dim));
      const bd = N.get(bio, 'data');
      if (bp.length === 1 || bd?.t !== 'longs') biomes3d[Y] = new Array(64).fill(bp[0] ?? 0);
      else {
        const bits = bitsFor(bp.length), per = Math.floor(64 / bits);
        const cells = bd.v.length * per >= 4096 ? 4096 : 64;
        const idx = unpack(bd.v, bits, cells, false);
        const out: number[] = [];
        // down to 4x4x4 cells (a block per cell when there are 4096)
        for (let c = 0; c < 64; c++) out.push(bp[idx[cells === 64 ? c : ((c >> 4) * 4 * 256 + ((c >> 2) & 3) * 4 * 16 + (c & 3) * 4)]] ?? 0);
        biomes3d[Y] = out;
      }
    }
  }
  // a 1.18 world goes on below 0: bedrock where this game's world ends
  if (dim === 'overworld' && dv >= DV_1_18) blocks.fill(mc.blockspec.parseBlock('bedrock'), 0, 256);
  // biomes: per column, where its surface is
  const biomes = new Uint8Array(256);
  const old = N.get(level, 'Biomes');
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      let top = 255;
      while (top > 0 && !blocks[(top * 16 + z) * 16 + x]) top--;
      let b = 0;
      if (old?.t === 'ints' && old.v.length) {
        const a = old.v;
        const id = a.length === 256 ? a[z * 16 + x] : a[((Math.min(63, top >> 2)) * 4 + (z >> 2)) * 4 + (x >> 2)];
        b = biomeFromJava(BIOME_IDS[id] ?? 'plains', dim);
      } else {
        const sec = biomes3d[top >> 4] ?? biomes3d.find((s) => s) ?? null;
        b = sec ? sec[(((top & 15) >> 2) * 4 + (z >> 2)) * 4 + (x >> 2)] : biomeFromJava(dim === 'nether' ? 'nether_wastes' : dim === 'end' ? 'the_end' : 'plains', dim);
      }
      biomes[z * 16 + x] = b;
    }
  // block entities (absolute positions), then default tiles for blocks that need one
  const tiles = new Map<number, Record<string, unknown>>();
  for (const t of N.items(N.get(level, 'block_entities') ?? N.get(level, 'TileEntities'))) {
    const c = N.compound(t);
    if (!c) continue;
    const x = N.num(c.v.x), y = N.num(c.v.y), z = N.num(c.v.z);
    if (y < 0 || y > 255) continue;
    const i = (y * 16 + (z & 15)) * 16 + (x & 15);
    const v = blocks[i];
    if (!v) continue;
    const tile = embeddedTile(c) ?? tileFromNbt(c, toJava(v).name, dv);
    if (tile) tiles.set(i, tile);
  }
  const needs = new Map<number, string | null>();
  for (let i = 0; i < COLUMN; i++) {
    const v = blocks[i];
    if (!v || tiles.has(i)) continue;
    let name = needs.get(v);
    if (name === undefined) { const n = toJava(v).name; name = blockEntityId(n) ? n : null; needs.set(v, name); }
    if (!name) continue;
    const tile = tileFromNbt(N.comp(), name, dv);
    if (tile) tiles.set(i, tile);
  }
  const entities = N.items(N.get(level, 'Entities') ?? N.get(level, 'entities')).map((e) => mobFromJava(e, dv)).filter((e): e is Record<string, unknown> => !!e);
  return { blocks, biomes, tiles: [...tiles], entities };
}

function paletteState(t: Tag, dv: number): BlockState {
  // the newest snapshots write a block in its default state as just its name
  if (t.t === 'string') return upgrade({ name: t.v.includes(':') ? t.v : 'minecraft:' + t.v, props: {} }, dv);
  const props: Record<string, string> = {};
  const pc = N.compound(N.get(t, 'Properties') ?? N.get(t, 'properties'));
  if (pc) for (const [k, v] of Object.entries(pc.v)) props[k] = N.text(v, String(N.num(v)));
  let name = N.text(N.get(t, 'Name') ?? N.get(t, 'id'), 'minecraft:air').toLowerCase();
  if (!name.includes(':')) name = 'minecraft:' + name;
  return upgrade({ name, props }, dv);
}

// ------------------------------------------------------------------ chunks: game -> Java (1.18+ layout)
/**
 * One of this game's chunk columns as a Java chunk for WORLD_DV. `at(x, y, z)` reads blocks of the world around
 * it (absolute coordinates), so fences, stairs and chests on the chunk's edge join their neighbours.
 */
export function writeChunk(cx: number, cz: number, c: { blocks: Uint16Array; biomes: Uint8Array; tiles: [number, Record<string, unknown>][] }, at: (x: number, y: number, z: number) => number): Compound {
  const dv = WORLD_DV;
  const sections: Tag[] = [];
  const stateCache = new Map<number, Compound>();
  const stateTag = (v: number, x: number, y: number, z: number): Compound => {
    const dep = depends(v);
    if (!dep) { const hit = stateCache.get(v); if (hit) return hit; }
    const s = downgrade(toJava(v, dep ? (dx, dy, dz) => at(x + dx, y + dy, z + dz) : undefined), dv);
    const props = Object.keys(s.props).length ? N.comp(Object.fromEntries(Object.entries(s.props).sort().map(([k, p]) => [k, N.str(p)]))) : undefined;
    const tag = N.comp({ Name: N.str(s.name), Properties: props });
    if (!dep) stateCache.set(v, tag);
    return tag;
  };
  for (let Y = -4; Y < 20; Y++) {
    const pal: Compound[] = [N.comp({ Name: N.str('minecraft:air') })], keys = new Map<string, number>(), byValue = new Map<number, number>();
    const idx = new Uint16Array(4096);
    const add = (t: Compound) => { const k = stateKeyOf(t); let i = keys.get(k); if (i === undefined) { i = pal.length; pal.push(t); keys.set(k, i); } return i; };
    if (Y >= 0 && Y < 16)
      for (let i = 0; i < 4096; i++) {
        const v = c.blocks[Y * 4096 + i];
        if (!v) continue;
        if (!depends(v)) { let p = byValue.get(v); if (p === undefined) { p = add(stateTag(v, 0, 0, 0)); byValue.set(v, p); } idx[i] = p; continue; }
        const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = Y * 16 + (i >> 8);
        idx[i] = add(stateTag(v, x, y, z));
      }
    const bs: Record<string, Tag> = { palette: N.list('compound', pal) };
    // (air everywhere: one entry and no data)
    if (pal.length > 1) bs.data = N.longs(pack(idx, Math.max(4, bitsFor(pal.length))));
    // biomes: 4x4x4 cells from this game's biome per column
    const bpal: string[] = [], bidx: number[] = [];
    for (let k = 0; k < 64; k++) {
      const x = (k & 3) * 4 + 1, z = ((k >> 2) & 3) * 4 + 1;
      const n = biomeToJava(c.biomes[z * 16 + x]);
      let j = bpal.indexOf(n);
      if (j < 0) { j = bpal.length; bpal.push(n); }
      bidx.push(j);
    }
    const bio: Record<string, Tag> = { palette: N.list('string', bpal.map(N.str)) };
    if (bpal.length > 1) bio.data = N.longs(pack(bidx, bitsFor(bpal.length)));
    sections.push(N.comp({ Y: N.byte(Y), block_states: { t: 'compound', v: bs }, biomes: { t: 'compound', v: bio } }));
  }
  const bes: Tag[] = [];
  for (const [i, t] of c.tiles) {
    const v = c.blocks[i];
    if (!v) continue;
    const name = toJava(v).name;
    const nbt = tileToNbt(t as never, name, dv) ?? N.comp();
    if (!nbt.v.id) { const id = blockEntityId(name); if (!id) continue; nbt.v.id = N.str(id); }
    nbt.v.x = N.int(cx * 16 + (i & 15)); nbt.v.y = N.int(i >> 8); nbt.v.z = N.int(cz * 16 + ((i >> 4) & 15));
    nbt.v.keepPacked = N.byte(0);
    nbt.v[GAME_TAG] = N.str(JSON.stringify(t));
    bes.push(nbt);
  }
  return N.comp({
    DataVersion: N.int(dv), xPos: N.int(cx), zPos: N.int(cz), yPos: N.int(-4), Status: N.str('minecraft:full'),
    LastUpdate: N.long(0), InhabitedTime: N.long(0), isLightOn: N.byte(0),
    sections: N.list('compound', sections), block_entities: N.list('compound', bes),
    block_ticks: N.list('compound', []), fluid_ticks: N.list('compound', []),
    structures: N.comp({ References: N.comp(), starts: N.comp() }),
  });
}

/** A palette entry's identity: its name and properties. */
const stateKeyOf = (t: Compound) => N.text(t.v.Name) + (t.v.Properties ? JSON.stringify(N.toPlain(t.v.Properties)) : '');

let nbDep: Uint8Array | null = null;
/** Does this block's Java state depend on its neighbours (stairs, fences, chests, wire)? */
function depends(v: number): boolean {
  if (!nbDep) {
    nbDep = new Uint8Array(4096);
    for (let i = 0; i < mc.BLOCKS.length; i++) {
      const d = mc.BLOCKS[i];
      if (!d || d.missing || d.mod) continue;
      nbDep[i] = Object.keys(toJava(mc.pack(i, 0)).props).length !== Object.keys(toJava(mc.pack(i, 0), () => 0).props).length ? 1 : 0;
    }
  }
  return nbDep[v & 0xfff] === 1;
}

// ------------------------------------------------------------------ mobs
/** Java's living mobs (today's names; zombie_pigman is 1.15's zombified piglin). */
const MOBS = new Set(('allay armadillo axolotl bat bee blaze bogged breeze camel cat cave_spider chicken cod cow creeper dolphin donkey drowned elder_guardian '
  + 'enderman endermite evoker fox frog ghast glow_squid goat guardian hoglin horse husk iron_golem llama magma_cube mooshroom mule ocelot panda parrot '
  + 'phantom pig piglin piglin_brute pillager polar_bear pufferfish rabbit ravager salmon sheep shulker silverfish skeleton skeleton_horse slime sniffer '
  + 'snow_golem spider squid stray strider tadpole trader_llama tropical_fish turtle vex villager vindicator wandering_trader warden witch wither_skeleton '
  + 'wolf zoglin zombie zombie_horse zombie_villager zombified_piglin').split(' '));
const ZOMBIES = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin', 'piglin', 'zoglin']);

/** A Java mob as this game's entity record (other entities are left out). */
export function mobFromJava(t: Tag, dv: number): Record<string, unknown> | null {
  let id = N.text(N.get(t, 'id')).replace(/^minecraft:/, '');
  if (id === 'zombie_pigman') id = 'zombified_piglin';
  if (!MOBS.has(id)) return null;
  const pos = N.items(N.get(t, 'Pos')).map((p) => N.num(p));
  if (pos.length !== 3 || pos[1] < 0 || pos[1] > 256) return null;
  const rot = N.items(N.get(t, 'Rotation')).map((p) => N.num(p));
  const out: Record<string, unknown> = { type: id, x: pos[0], y: pos[1], z: pos[2], yaw: rot[0] ?? 0, health: Math.max(1, N.num(N.get(t, 'Health'), 10)) };
  if (N.num(N.get(t, 'Age')) < 0 || N.num(N.get(t, 'IsBaby')) === 1) out.baby = true;
  const name = N.get(t, 'CustomName');
  if (name) { const s = name.t === 'string' && /^\s*[{["]/.test(name.v) ? (() => { try { const j = JSON.parse(name.v); return typeof j === 'string' ? j : j.text ?? ''; } catch { return name.v; } })() : N.text(name); if (s) out.customName = s; }
  if (N.num(N.get(t, 'NoAI')) === 1) out.noAi = true;
  void dv;
  return out;
}

/** This game's entity record as a Java mob for WORLD_DV (null for anything that isn't a living mob Java has). */
export function mobToJava(e: Record<string, unknown>): Compound | null {
  const id = String(e.type ?? '').replace(/ /g, '_').replace(/^zombie_pigman$/, 'zombified_piglin');
  if (!MOBS.has(id) || typeof e.x !== 'number') return null;
  const uuid = Int32Array.from({ length: 4 }, () => (Math.random() * 2 ** 32) | 0);
  const baby = !!e.baby;
  return N.comp({
    id: N.str('minecraft:' + id), Pos: N.doubleList([e.x as number, e.y as number, e.z as number]),
    Rotation: N.list('float', [N.float((e.yaw as number) ?? 0), N.float(0)]), Motion: N.doubleList([0, 0, 0]),
    Health: N.float(Math.max(1, (e.health as number) ?? 10)), UUID: N.ints(uuid), PersistenceRequired: N.byte(1), OnGround: N.byte(1),
    Age: baby && !ZOMBIES.has(id) ? N.int(-24000) : undefined, IsBaby: baby && ZOMBIES.has(id) ? N.byte(1) : undefined,
    CustomName: e.customName ? N.str(JSON.stringify({ text: String(e.customName) })) : undefined, NoAI: e.noAi ? N.byte(1) : undefined,
  });
}

// ------------------------------------------------------------------ the player and level.dat
export interface JavaLevel {
  name: string;
  seedText: string;
  spawn: [number, number, number];
  time: number;
  gameMode: number;
  hardcore: boolean;
  allowCommands: boolean;
  dataVersion: number;
  player: Compound | null;
  /** 26.1+: the singleplayer's file in players/data. */
  playerUuid: string | null;
}

export function readLevel(root: Compound): JavaLevel {
  const d = N.compound(N.get(root, 'Data')) ?? root;
  const wgs = N.compound(N.get(d, 'WorldGenSettings'));
  const seed = N.get(wgs, 'seed') ?? N.get(d, 'RandomSeed');
  const spawnC = N.compound(N.get(d, 'spawn'));
  const spos = N.vec3(N.get(spawnC, 'pos'));
  const spawn: [number, number, number] = spos ?? [N.num(N.get(d, 'SpawnX')), N.num(N.get(d, 'SpawnY'), 64), N.num(N.get(d, 'SpawnZ'))];
  const uu = N.get(d, 'singleplayer_uuid');
  return {
    name: N.text(N.get(d, 'LevelName'), 'Imported World'),
    seedText: seed ? String(seed.t === 'long' ? seed.v : N.num(seed)) : '',
    spawn, time: N.num(N.get(d, 'DayTime'), N.num(N.get(d, 'Time'))) % 24000,
    gameMode: N.num(N.get(d, 'GameType')), hardcore: N.num(N.get(d, 'hardcore')) === 1, allowCommands: N.num(N.get(d, 'allowCommands')) === 1,
    dataVersion: N.num(N.get(d, 'DataVersion'), 1631), player: N.compound(N.get(d, 'Player')) ?? null,
    playerUuid: uu?.t === 'ints' && uu.v.length === 4 ? uuidString(uu.v) : null,
  };
}
const uuidString = (a: Int32Array) => [...a].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** A Java player as this game's saved player, and the dimension they're in. */
export function playerFromJava(p: Compound, dv: number): { player: Record<string, unknown>; dim: Dim } {
  const pos = N.items(N.get(p, 'Pos')).map((t) => N.num(t));
  const rot = N.items(N.get(p, 'Rotation')).map((t) => N.num(t));
  const main: (ItemStack | null)[] = new Array(36).fill(null), armor: (ItemStack | null)[] = [null, null, null, null];
  let offhand: ItemStack | null = null;
  for (const t of N.items(N.get(p, 'Inventory'))) {
    const r = itemFromNbt(t, dv);
    if (!r) continue;
    if (r.slot >= 0 && r.slot < 36) main[r.slot] = r.stack;
    else if (r.slot >= 100 && r.slot <= 103) armor[103 - r.slot] = r.stack;
    else if (r.slot === -106) offhand = r.stack;
  }
  // 1.21.5+: armour and the off hand are "equipment"
  const eq = N.compound(N.get(p, 'equipment'));
  if (eq) {
    (['head', 'chest', 'legs', 'feet'] as const).forEach((k, i) => { const t = N.get(eq, k); const r = t ? itemFromNbt(N.comp({ ...N.compound(t)!.v, Slot: N.byte(0) }), dv) : null; if (r) armor[i] = r.stack; });
    const oh = N.get(eq, 'offhand');
    const r = oh ? itemFromNbt(oh, dv) : null;
    if (r) offhand = r.stack;
  }
  const dimTag = N.get(p, 'Dimension');
  const dimName = dimTag?.t === 'string' ? dimTag.v : ['minecraft:the_nether', 'minecraft:overworld', 'minecraft:the_end'][N.num(dimTag) + 1] ?? 'minecraft:overworld';
  const dim: Dim = dimName.endsWith('the_nether') ? 'nether' : dimName.endsWith('the_end') ? 'end' : 'overworld';
  const abilities = N.compound(N.get(p, 'abilities'));
  const player: Record<string, unknown> = {
    x: pos[0] ?? 0, y: Math.max(1, Math.min(255, pos[1] ?? 80)), z: pos[2] ?? 0, yaw: rot[0] ?? 0, pitch: rot[1] ?? 0,
    health: Math.max(1, N.num(N.get(p, 'Health'), 20)), food: N.num(N.get(p, 'foodLevel'), 20), saturation: N.num(N.get(p, 'foodSaturationLevel'), 5), air: 300,
    xpLevel: N.num(N.get(p, 'XpLevel')), xpProgress: N.num(N.get(p, 'XpP')), xpTotal: N.num(N.get(p, 'XpTotal')),
    gameMode: N.num(N.get(p, 'playerGameType')), flying: N.num(N.get(abilities, 'flying')) === 1,
    inventory: { main, armor, offhand, selected: Math.max(0, Math.min(8, N.num(N.get(p, 'SelectedItemSlot')))) },
    effects: [], spawnKind: 'world',
  };
  return { player, dim };
}

/** This game's saved player as Java's Player compound for WORLD_DV. */
export function playerToJava(d: Record<string, unknown>, dim: Dim): Compound {
  const dv = WORLD_DV;
  const inv = (d.inventory ?? {}) as { main?: (ItemStack | null)[]; armor?: (ItemStack | null)[]; offhand?: ItemStack | null; selected?: number };
  const items: Tag[] = [];
  (inv.main ?? []).forEach((s, i) => { if (s && i < 36) items.push(itemToNbt(s, i, dv)); });
  (inv.armor ?? []).forEach((s, i) => { if (s) items.push(itemToNbt(s, 103 - i, dv)); });
  if (inv.offhand) items.push(itemToNbt(inv.offhand, -106, dv));
  const mode = (d.gameMode as number) ?? 0;
  const spawn = d.spawn as number[] | undefined;
  return N.comp({
    DataVersion: N.int(dv),
    Pos: N.doubleList([(d.x as number) ?? 0, (d.y as number) ?? 80, (d.z as number) ?? 0]), Motion: N.doubleList([0, 0, 0]),
    Rotation: N.list('float', [N.float((d.yaw as number) ?? 0), N.float((d.pitch as number) ?? 0)]), OnGround: N.byte(1),
    Health: N.float((d.health as number) ?? 20), foodLevel: N.int((d.food as number) ?? 20), foodSaturationLevel: N.float((d.saturation as number) ?? 5),
    Air: N.short(300), Fire: N.short(-20), XpLevel: N.int((d.xpLevel as number) ?? 0), XpP: N.float((d.xpProgress as number) ?? 0), XpTotal: N.int((d.xpTotal as number) ?? 0),
    playerGameType: N.int(mode), Inventory: N.list('compound', items), EnderItems: N.list('compound', []), SelectedItemSlot: N.int(inv.selected ?? 0),
    Dimension: N.str(JAVA_DIMS[dim]), UUID: N.ints(Int32Array.from({ length: 4 }, () => (Math.random() * 2 ** 32) | 0)),
    abilities: N.comp({
      flying: N.byte(d.flying ? 1 : 0), mayfly: N.byte(mode === 1 || mode === 3 ? 1 : 0), instabuild: N.byte(mode === 1 ? 1 : 0),
      invulnerable: N.byte(mode === 1 || mode === 3 ? 1 : 0), mayBuild: N.byte(mode === 2 ? 0 : 1), flySpeed: N.float(0.05), walkSpeed: N.float(0.1),
    }),
    ...(spawn && d.spawnKind === 'bed' ? { SpawnX: N.int(spawn[0]), SpawnY: N.int(spawn[1]), SpawnZ: N.int(spawn[2]), SpawnDimension: N.str('minecraft:overworld'), SpawnForced: N.byte(0) } : {}),
  });
}

/** level.dat for WORLD_DV (1.20.4), with the vanilla generators: land past what was exported is Java's own. */
export function writeLevel(o: { name: string; seed: bigint; spawn: [number, number, number]; time: number; gameMode: number; hardcore: boolean; allowCommands: boolean; player: Compound | null }): Compound {
  const noise = (settings: string, biomes: Compound) => N.comp({ type: N.str('minecraft:noise'), settings: N.str(settings), biome_source: biomes });
  const multi = (preset: string) => N.comp({ type: N.str('minecraft:multi_noise'), preset: N.str(preset) });
  return N.comp({
    Data: N.comp({
      DataVersion: N.int(WORLD_DV), version: N.int(19133),
      Version: N.comp({ Id: N.int(WORLD_DV), Name: N.str(WORLD_VERSION_NAME), Series: N.str('main'), Snapshot: N.byte(0) }),
      LevelName: N.str(o.name), LastPlayed: N.long(Date.now()), GameType: N.int(o.gameMode), hardcore: N.byte(o.hardcore ? 1 : 0),
      Difficulty: N.byte(2), DifficultyLocked: N.byte(0), allowCommands: N.byte(o.allowCommands ? 1 : 0), initialized: N.byte(1),
      SpawnX: N.int(o.spawn[0]), SpawnY: N.int(o.spawn[1]), SpawnZ: N.int(o.spawn[2]), SpawnAngle: N.float(0),
      Time: N.long(Math.round(o.time)), DayTime: N.long(Math.round(o.time)), clearWeatherTime: N.int(0), raining: N.byte(0), rainTime: N.int(12000),
      thundering: N.byte(0), thunderTime: N.int(12000), WasModded: N.byte(0), ServerBrands: N.list('string', [N.str('vanilla')]),
      DataPacks: N.comp({ Enabled: N.list('string', [N.str('vanilla')]), Disabled: N.list('string', []) }),
      GameRules: N.comp({ doDaylightCycle: N.str('true'), keepInventory: N.str('false') }),
      WorldGenSettings: N.comp({
        seed: N.long(o.seed), generate_features: N.byte(1), bonus_chest: N.byte(0),
        dimensions: N.comp({
          'minecraft:overworld': N.comp({ type: N.str('minecraft:overworld'), generator: noise('minecraft:overworld', multi('minecraft:overworld')) }),
          'minecraft:the_nether': N.comp({ type: N.str('minecraft:the_nether'), generator: noise('minecraft:nether', multi('minecraft:nether')) }),
          'minecraft:the_end': N.comp({ type: N.str('minecraft:the_end'), generator: noise('minecraft:end', N.comp({ type: N.str('minecraft:the_end') })) }),
        }),
      }),
      Player: o.player ?? undefined,
    }),
  });
}
