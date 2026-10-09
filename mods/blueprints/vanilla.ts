// This game's blocks as Java Edition names them, both ways, and how those names changed between versions.
//
// A block here is a packed value (id | meta << 12); Java Edition has a name and named properties. `toJava` says
// what a packed value is in Java's words, written for the newest version. The way back (`fromJava`) is a search
// over the same table: the block whose Java state matches best, so the two directions can never disagree.
// Properties Java works out from neighbours (fence sides, stair corners, chest halves...) are filled in when the
// neighbours are known and ignored on the way back. `upgrade` / `downgrade` rename the states of other versions.
import type { Mc } from '../sdk';
import type { BlockState } from './model';

let mc: Mc;
export function initVanilla(m: Mc) { mc = m; byName = null; cache.clear(); }

type Nb = (dx: number, dy: number, dz: number) => number;

const H4 = ['north', 'east', 'south', 'west'];
const F6 = ['down', 'up', 'north', 'south', 'west', 'east'];
const RAIL_SHAPES = ['north_south', 'east_west', 'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south', 'south_east', 'south_west', 'north_west', 'north_east'];
const POTTED: Record<string, string> = {
  oak_sapling: 'potted_oak_sapling', spruce_sapling: 'potted_spruce_sapling', birch_sapling: 'potted_birch_sapling', jungle_sapling: 'potted_jungle_sapling',
  acacia_sapling: 'potted_acacia_sapling', dark_oak_sapling: 'potted_dark_oak_sapling', dandelion: 'potted_dandelion', poppy: 'potted_poppy',
  blue_orchid: 'potted_blue_orchid', cornflower: 'potted_cornflower', red_mushroom: 'potted_red_mushroom', brown_mushroom: 'potted_brown_mushroom',
  dead_bush: 'potted_dead_bush', fern: 'potted_fern', cactus: 'potted_cactus',
};
/** Blocks of this game that are a state of a Java block (or an older name of one). */
const RENAMED: Record<string, string> = {
  lit_furnace: 'furnace', lit_redstone_lamp: 'redstone_lamp', lit_redstone_ore: 'redstone_ore', unlit_redstone_torch: 'redstone_torch',
  powered_repeater: 'repeater', stone_slab: 'smooth_stone_slab', grass_path: 'dirt_path', chain: 'iron_chain',
  unused_1: 'air', unused_2: 'air', unused_3: 'air',
};
const bool = (b: boolean | number) => (b ? 'true' : 'false');
const ns = (n: string) => (n.includes(':') ? n : 'minecraft:' + n);

/** Java's chest halves: 'left' when the partner is clockwise of the facing. */
function chestType(id: number, m: number, nb: Nb): string {
  const d = mc.shapes.chestPartnerDir(id, m, (dx, dz) => nb(dx, 0, dz));
  if (!d) return 'single';
  const h = d[1] < 0 ? 0 : d[0] > 0 ? 1 : d[1] > 0 ? 2 : 3;
  return h === ((m + 1) & 3) ? 'left' : 'right';
}

/** The game's exact block, for the `game` field of a state (and parseBlock): `name:meta`. */
export function gameName(v: number): string {
  const id = v & 0xfff, n = mc.BLOCKS[id]?.name ?? 'air';
  return `${n}:${v >>> 12}`;
}

/**
 * A packed block in Java Edition's words (newest names). With `nb`, the properties Java keeps for what's around a
 * block (fence sides, stair corners, chest halves, wire sides) are worked out too.
 */
export function toJava(v: number, nb?: Nb): BlockState {
  const id = v & 0xfff, m = v >>> 12;
  const def = mc.BLOCKS[id];
  if (!def || def.missing) return { name: 'minecraft:air', props: {} };
  // other mods' blocks: their key, and the exact block for this game
  if (def.mod) return { name: def.name, props: {}, game: gameName(v) };
  let name = RENAMED[def.name] ?? def.name;
  const st = mc.blockspec.stateOf(v);
  const p: Record<string, string> = { ...st };
  const fam = mc.blockspec.familyOf(id);
  switch (fam) {
    case 'stairs':
      if (nb) p.shape = ['straight', 'outer_left', 'outer_right', 'inner_left', 'inner_right'][mc.shapes.stairShape(m, nb)];
      break;
    case 'slab':
      delete p.half;
      p.type = (m & 7) === 2 ? 'double' : m & 1 ? 'top' : 'bottom';
      p.waterlogged = bool(m & 8 && (m & 7) !== 2);
      break;
    case 'leaves':
      // leaves that aren't persistent work out their distance again; 1 keeps them from decaying meanwhile
      p.distance = m & 1 ? '7' : '1';
      break;
    case 'torch': {
      const lit = def.name !== 'unlit_redstone_torch';
      const wall = (m & 7) !== 0;
      const base = name.replace(/_torch$/, '');
      if (wall) { name = base === 'torch' ? 'wall_torch' : `${base}_wall_torch`; p.facing = H4[(((m & 7) - 1) + 2) & 3]; }
      else delete p.facing;
      if (base === 'redstone') p.lit = bool(lit);
      break;
    }
    case 'switch': {
      const at = m & 7;
      if (/_coral_fan$/.test(name)) {
        delete p.powered;
        if (at === 0) delete p.facing;
        else { name = name.replace(/_fan$/, '_wall_fan'); p.facing = H4[((at - 1) + 2) & 3]; }
        p.waterlogged = bool(m & 8);
        break;
      }
      p.face = at === 0 ? 'floor' : at === 5 ? 'ceiling' : 'wall';
      p.facing = at === 0 || at === 5 ? 'north' : H4[((at - 1) + 2) & 3];
      break;
    }
    case 'diode': {
      // Java's repeaters and comparators face their input; this game's face their output
      p.facing = H4[(m + 2) & 3];
      if (name === 'repeater') { p.powered = bool(def.name === 'powered_repeater'); p.locked = 'false'; }
      break;
    }
    case 'anvil':
      p.facing = H4[m & 3];
      name = ['anvil', 'chipped_anvil', 'damaged_anvil'][(m >> 2) & 3] ?? 'anvil';
      break;
    case 'ladder':
      if (name === 'cocoa') { p.facing = H4[m & 3]; p.age = String(Math.min(2, m >> 2)); }
      if (name === 'tripwire_hook') { p.attached = 'false'; p.powered = 'false'; }
      break;
    case 'door': p.hinge = 'left'; p.powered = 'false'; break;
    case 'trapdoor': p.powered = 'false'; p.waterlogged = 'false'; break;
    case 'bed': p.occupied = 'false'; break;
    case 'plant2': p.half = m & 8 ? 'upper' : 'lower'; break;
    case 'facing6':
      if (name === 'piston' || name === 'sticky_piston') p.extended = bool(m & 8);
      if (name === 'dispenser' || name === 'dropper') p.triggered = 'false';
      if (name === 'observer') p.powered = 'false';
      break;
    case 'hopper': p.enabled = 'true'; break;
    case 'front':
      if (/_fence_gate$/.test(name)) {
        p.open = bool(m & 4);
        p.powered = 'false';
        if (nb) {
          // a gate between two walls sits lower, like them
          const l = [[1, 0], [0, 1]][m & 1];
          const wall = (v2: number) => /_wall$/.test(mc.BLOCKS[v2 & 0xfff]?.name ?? '');
          p.in_wall = bool(wall(nb(l[0], 0, l[1])) || wall(nb(-l[0], 0, -l[1])));
        }
      } else if (name === 'campfire' || name === 'soul_campfire') { p.lit = bool((m & 4) === 0); p.signal_fire = 'false'; p.waterlogged = 'false'; }
      else if (name === 'chest' || name === 'trapped_chest') { if (nb) p.type = chestType(id, m, nb); p.waterlogged = 'false'; }
      else if (name === 'furnace' || name === 'smoker' || name === 'blast_furnace') p.lit = bool(def.name === 'lit_furnace');
      else if (name === 'lectern') { p.facing = H4[(m + 2) & 3]; p.has_book = bool(m & 4); p.powered = 'false'; }
      else if (name === 'grindstone') { p.facing = H4[m & 3]; p.face = 'floor'; }
      else if (name === 'bell') { p.facing = H4[m & 3]; p.attachment = 'floor'; p.powered = 'false'; }
      else if (name === 'beehive' || name === 'bee_nest') p.honey_level = m & 8 ? '5' : '0';
      else if (name === 'end_portal_frame') p.eye = bool(m & 4);
      else if (name === 'barrel') p.open = 'false';
      break;
    case 'log':
      if (name === 'iron_chain') p.waterlogged = bool(m & 8);
      break;
  }
  if (/_wall_banner$/.test(name)) p.facing = H4[(m + 2) & 3];
  else if (/_banner$/.test(name)) p.rotation = String(m);
  // walls, fences, panes and bars: the sides they join on
  const j = nb ? mc.shapes.joins(v, nb) : null;
  if (j) {
    if (/_wall$/.test(name)) {
      const above = nb!(0, 1, 0);
      const tall = above !== 0 && (mc.BLOCKS[above & 0xfff].opaque || /_wall$/.test(mc.BLOCKS[above & 0xfff].name));
      H4.forEach((d, i) => (p[d] = j[i] ? (tall ? 'tall' : 'low') : 'none'));
      const straight = (j[0] && j[2] && !j[1] && !j[3]) || (j[1] && j[3] && !j[0] && !j[2]);
      p.up = bool(!straight || above !== 0);
    } else H4.forEach((d, i) => (p[d] = bool(j[i])));
    p.waterlogged ??= 'false';
  }
  switch (name) {
    case 'water': case 'lava': p.level = String(m & 15); break;
    case 'farmland': p.moisture = m ? '7' : '0'; break;
    case 'redstone_wire':
      if (nb) {
        const c = mc.shapes.wireConnections(nb), up = mc.shapes.wireClimbs(nb);
        H4.forEach((d, i) => (p[d] = up[i] ? 'up' : c[i] ? 'side' : 'none'));
      }
      break;
    case 'cauldron': {
      const lvl = m & 3;
      delete p.level;
      if (m & 4) name = 'lava_cauldron';
      else if (lvl) { name = 'water_cauldron'; p.level = String(lvl); }
      break;
    }
    case 'flower_pot': {
      const plant = mc.shapes.POT_PLANTS[m];
      if (plant) name = POTTED[mc.BLOCKS[plant].name] ?? 'flower_pot';
      break;
    }
    case 'rail': p.shape = RAIL_SHAPES[m] ?? 'north_south'; break;
    case 'powered_rail': case 'detector_rail': case 'activator_rail':
      p.shape = RAIL_SHAPES[m & 7] ?? 'north_south';
      p.powered = bool(m & 8);
      break;
    case 'nether_portal': p.axis = m & 1 ? 'z' : 'x'; break;
    case 'lantern': case 'soul_lantern': p.hanging = bool(m & 1); p.waterlogged = bool(m & 8); break;
    case 'sea_pickle': p.pickles = String((m & 3) + 1); p.waterlogged = bool(m & 4); break;
    case 'turtle_egg': p.eggs = String((m & 3) + 1); p.hatch = String((m >> 2) & 3); break;
    case 'scaffolding': p.distance = String(m & 7); p.bottom = bool(m & 8); p.waterlogged = 'false'; break;
    case 'daylight_detector': p.inverted = bool(m & 8); p.power = '0'; break;
    case 'brewing_stand': for (let b = 0; b < 3; b++) p['has_bottle_' + b] = bool(m & (1 << b)); break;
    case 'vine': H4.forEach((d, i) => (p[d] = bool(m & (1 << i)))); p.up = 'false'; break;
    case 'bubble_column': p.drag = bool(m === 1); break;
    case 'end_rod': p.facing = ['up', 'east', 'south'][m % 3]; break;
    case 'snow': p.layers = '1'; break;
    case 'pumpkin_stem': case 'melon_stem': p.age = String(Math.min(7, m)); break;
    case 'frosted_ice': p.age = String(Math.min(3, m)); break;
    case 'chorus_flower': p.age = String(Math.min(5, m)); break;
    case 'grass_block': case 'podzol': case 'mycelium': p.snowy = 'false'; break;
    case 'redstone_lamp': case 'redstone_ore': p.lit = bool(def.name.startsWith('lit_')); break;
  }
  if (/shulker_box$/.test(name)) p.facing = 'up';
  return { name: ns(name), props: p };
}

// ------------------------------------------------------------------ the way back
/** Java names (newest) to the blocks of this game that can be them. */
let byName: Map<string, number[]> | null = null;
const cache = new Map<string, number>();

function index() {
  if (byName) return byName;
  byName = new Map();
  for (let id = 0; id < mc.BLOCKS.length; id++) {
    const def = mc.BLOCKS[id];
    if (!def || def.missing || def.mod) continue;
    const seen = new Set<string>();
    for (let m = 0; m < 16; m++) {
      const n = toJava(mc.pack(id, m)).name;
      if (seen.has(n)) continue;
      seen.add(n);
      const l = byName.get(n) ?? [];
      if (!l.includes(id)) l.push(id);
      byName.set(n, l);
    }
  }
  return byName;
}

/** Close stand-ins for Java blocks this game doesn't have exactly. */
const SUBSTITUTES: Record<string, string> = {
  'minecraft:stone_slab': 'minecraft:smooth_stone_slab', 'minecraft:cave_air': 'minecraft:air', 'minecraft:void_air': 'minecraft:air',
  'minecraft:attached_pumpkin_stem': 'minecraft:pumpkin_stem', 'minecraft:attached_melon_stem': 'minecraft:melon_stem',
  'minecraft:powder_snow_cauldron': 'minecraft:cauldron', 'minecraft:light': 'minecraft:air', 'minecraft:barrier': 'minecraft:air',
};

/**
 * The packed block for a Java state (newest names), or null if this game has no such block. Mods' blocks come
 * back by key; `game` (saved by this game) wins when it names a block that exists.
 */
export function fromJava(s: BlockState, substitutes = true): number | null {
  if (s.game) {
    try {
      const v = mc.blockspec.parseBlock(s.game);
      if ((v & 0xfff) || s.name === 'minecraft:air') return v;
    } catch { /* not here (a mod that's missing): by name below */ }
  }
  const key = `${s.name}|${Object.entries(s.props).sort().map(([k, v]) => `${k}=${v}`).join(',')}|${substitutes}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit < 0 ? null : hit;
  const r = search(s, substitutes);
  cache.set(key, r ?? -1);
  return r;
}

function search(s: BlockState, substitutes: boolean): number | null {
  if (s.name === 'minecraft:air') return 0;
  // another mod's block, by its key
  if (!s.name.startsWith('minecraft:')) {
    const def = mc.blockByName(s.name);
    if (!def || def.missing) return null;
    const meta = parseInt(s.props.meta ?? '0');
    return mc.pack(def.id, Number.isFinite(meta) ? meta & 15 : 0);
  }
  let ids = index().get(s.name);
  let state = s;
  if (!ids && substitutes && SUBSTITUTES[s.name]) {
    state = { name: SUBSTITUTES[s.name], props: s.props };
    if (state.name === 'minecraft:air') return 0;
    ids = index().get(state.name);
  }
  if (!ids) return null;
  let best = -1, bestScore = -1;
  for (const id of ids) {
    for (let m = 0; m < 16; m++) {
      const j = toJava(mc.pack(id, m));
      if (j.name !== state.name) continue;
      let score = 0;
      for (const [k, v] of Object.entries(j.props)) if (state.props[k] === v) score++;
      // a state the Java side doesn't name (leaves' meta 0 vs 1 and the like) is told apart by what is named
      if (score > bestScore) { bestScore = score; best = mc.pack(id, m); }
    }
  }
  return best < 0 ? null : best;
}

// ------------------------------------------------------------------ versions
/** Java Edition versions a file can be written for: the name shown and its data version. */
export const VERSIONS: [string, number][] = [
  ['1.16.5', 2586], ['1.17.1', 2730], ['1.18.2', 2975], ['1.19.4', 3337], ['1.20.1', 3465], ['1.20.4', 3700],
  ['1.20.6', 3839], ['1.21.1', 3955], ['1.21.4', 4189], ['1.21.5', 4325], ['1.21.8', 4440], ['1.21.10', 4556], ['1.21.11', 4671],
];
export const NEWEST = VERSIONS[VERSIONS.length - 1][1];
export const versionName = (dv: number) => {
  if (dv > NEWEST) return `newer than ${VERSIONS[VERSIONS.length - 1][0]}`;
  let n = dv < 1451 ? 'pre-1.13' : '1.13+';
  for (const [name, d] of VERSIONS) if (dv >= d) n = name;
  return n;
};

// data versions where blocks were renamed
const DV_1_14 = 1952, DV_1_16 = 2566, DV_1_17 = 2724, DV_1_20_3 = 3698, DV_1_21_9 = 4554;

/** A state named for data version `dv`, renamed to today's names. */
export function upgrade(s: BlockState, dv: number): BlockState {
  let { name } = s;
  const props = { ...s.props };
  if (dv < DV_1_14) {
    if (name === 'minecraft:sign') name = 'minecraft:oak_sign';
    else if (name === 'minecraft:wall_sign') name = 'minecraft:oak_wall_sign';
    else if (name === 'minecraft:stone_slab') name = 'minecraft:smooth_stone_slab';
  }
  if (dv < DV_1_16 && /_wall$/.test(name)) for (const d of H4) if (props[d] === 'true' || props[d] === 'false') props[d] = props[d] === 'true' ? 'low' : 'none';
  if (dv < DV_1_17) {
    if (name === 'minecraft:grass_path') name = 'minecraft:dirt_path';
    else if (name === 'minecraft:cauldron' && props.level && props.level !== '0') name = 'minecraft:water_cauldron';
    else if (name === 'minecraft:cauldron') delete props.level;
  }
  if (dv < DV_1_20_3 && name === 'minecraft:grass') name = 'minecraft:short_grass';
  if (dv < DV_1_21_9 && name === 'minecraft:chain') name = 'minecraft:iron_chain';
  return name === s.name && props === s.props ? s : { ...s, name, props };
}

/** A state with today's names, renamed for data version `dv` (where older versions had other names). */
export function downgrade(s: BlockState, dv: number): BlockState {
  let { name } = s;
  const props = { ...s.props };
  if (dv < DV_1_21_9 && name === 'minecraft:iron_chain') name = 'minecraft:chain';
  if (dv < DV_1_20_3 && name === 'minecraft:short_grass') name = 'minecraft:grass';
  if (dv < DV_1_17) {
    if (name === 'minecraft:dirt_path') name = 'minecraft:grass_path';
    else if (name === 'minecraft:water_cauldron') name = 'minecraft:cauldron';
    else if (name === 'minecraft:lava_cauldron' || name === 'minecraft:powder_snow_cauldron') { name = 'minecraft:cauldron'; props.level = '0'; }
    else if (name === 'minecraft:cauldron') props.level = '0';
  }
  if (dv < DV_1_16 && /_wall$/.test(name)) for (const d of H4) if (props[d]) props[d] = props[d] === 'none' ? 'false' : 'true';
  if (dv < DV_1_14) {
    if (name === 'minecraft:oak_sign') name = 'minecraft:sign';
    else if (name === 'minecraft:oak_wall_sign') name = 'minecraft:wall_sign';
    else if (name === 'minecraft:smooth_stone_slab') name = 'minecraft:stone_slab';
  }
  return { ...s, name, props };
}

// ------------------------------------------------------------------ items
const ITEM_RENAMES: Record<string, string> = { zombie_pigman_spawn_egg: 'zombified_piglin_spawn_egg', grass_path: 'dirt_path', chain: 'iron_chain', stone_slab: 'smooth_stone_slab' };
const ITEM_BACK: Record<string, string> = Object.fromEntries(Object.entries(ITEM_RENAMES).map(([a, b]) => [b, a]));

/** An item's Java name (newest) by this game's item id. */
export function itemToJava(id: number): string {
  const d = mc.ITEMS.get(id);
  if (!d) return 'minecraft:air';
  if (d.mod) return d.key ?? d.name;
  return ns(ITEM_RENAMES[d.name] ?? d.name);
}
/** This game's item id for a Java item name (any version's), or null. */
export function itemFromJava(name: string, dv: number): number | null {
  let n = name.toLowerCase();
  if (!n.includes(':')) n = 'minecraft:' + n;
  if (!n.startsWith('minecraft:')) { const d = mc.itemByName(n); return d && !d.missing ? d.id : null; }
  let short = n.slice(10);
  if (dv < DV_1_20_3 && short === 'grass') short = 'short_grass';
  if (dv < DV_1_17 && short === 'grass_path') short = 'dirt_path';
  if (dv < DV_1_14 && short === 'sign') short = 'oak_sign';
  short = ITEM_BACK[short] ?? short;
  const d = mc.itemByName(short);
  return d && !d.missing ? d.id : null;
}
/** An item's Java name for data version `dv`. */
export function itemForVersion(name: string, dv: number): string {
  const s = downgrade({ name, props: {} }, dv);
  return s.name;
}
