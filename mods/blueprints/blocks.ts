// What each block costs (the items it takes to place, for material lists and easy placing) and whether a block in
// the world counts as the one a schematic wants (ignoring what changes on its own: power, light, growth).
import type { Mc } from '../sdk';
import { toJava } from './vanilla';

let mc: Mc;
let itemOfBlock: Map<number, number> | null = null;
export function initBlocks(m: Mc) { mc = m; itemOfBlock = null; canon.clear(); }

/** Blocks whose item has another name. */
const ITEM_NAMES: Record<string, string> = {
  redstone_wire: 'redstone', wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds',
  pumpkin_stem: 'pumpkin_seeds', melon_stem: 'melon_seeds', cocoa: 'cocoa_beans', sweet_berry_bush: 'sweet_berries', tripwire: 'string',
  water: 'water_bucket', lava: 'lava_bucket', kelp_plant: 'kelp', weeping_vines_plant: 'weeping_vines', twisting_vines_plant: 'twisting_vines',
  tall_seagrass: 'seagrass', bamboo_sapling: 'bamboo', farmland: 'dirt', grass_path: 'dirt', lit_redstone_ore: 'redstone_ore',
  lit_furnace: 'furnace', lit_redstone_lamp: 'redstone_lamp', unlit_redstone_torch: 'redstone_torch', powered_repeater: 'repeater',
  infested_stone: 'stone', infested_cobblestone: 'cobblestone', infested_stone_bricks: 'stone_bricks', frosted_ice: 'ice',
};
/** Blocks nothing places (portals, fire, moving pistons...). */
const NO_ITEM = new Set(['air', 'fire', 'soul_fire', 'nether_portal', 'end_portal', 'end_gateway', 'piston_head', 'moving_piston', 'bubble_column', 'structure_void', 'unused_1', 'unused_2', 'unused_3']);

/** The item that places block `id` (or null). */
export function blockItem(id: number): number | null {
  if (!itemOfBlock) {
    itemOfBlock = new Map();
    for (const [iid, d] of mc.ITEMS) if (d.block !== undefined && !itemOfBlock.has(d.block)) itemOfBlock.set(d.block, iid);
  }
  const hit = itemOfBlock.get(id);
  if (hit !== undefined) return hit >= 0 ? hit : null;
  const def = mc.BLOCKS[id];
  if (!def || NO_ITEM.has(def.name)) return null;
  const name = ITEM_NAMES[def.name] ?? def.name.replace('_wall_', '_');
  const d = mc.itemByName(name);
  const r = d && !d.missing ? d.id : null;
  itemOfBlock.set(id, r ?? -1);
  return r;
}

/**
 * The items a block takes: [item id, count]. The top half of a door, the head of a bed and the like cost nothing
 * (their other half pays), a double slab costs two slabs, a pot with a plant costs the plant too.
 */
export function materials(v: number): [number, number][] {
  const id = v & 0xfff, m = v >>> 12;
  if (!id) return [];
  const fam = mc.blockspec.familyOf(id);
  if ((fam === 'door' || fam === 'plant2' || fam === 'bed') && m & 8) return [];
  const it = blockItem(id);
  if (it === null) return [];
  if (fam === 'slab' && (m & 7) === 2) return [[it, 2]];
  const name = mc.BLOCKS[id].name;
  if (name === 'flower_pot' && m) { const p = mc.shapes.POT_PLANTS[m]; const pi = p ? blockItem(p) : null; return pi !== null ? [[it, 1], [pi, 1]] : [[it, 1]]; }
  if (name === 'sea_pickle' || name === 'turtle_egg') return [[it, (m & 3) + 1]];
  return [[it, 1]];
}

/** Properties that change by themselves, which a check of the build shouldn't care about. */
const DYNAMIC = new Set(['powered', 'lit', 'power', 'triggered', 'enabled', 'distance', 'persistent', 'age', 'moisture', 'level', 'honey_level', 'locked', 'snowy', 'bottom', 'occupied', 'signal_fire', 'has_book', 'hatch', 'extended']);
const canon = new Map<number, string>();
/** A key that two blocks share when they're the same block in the same orientation. */
export function canonical(v: number): string {
  let k = canon.get(v);
  if (k === undefined) {
    const j = toJava(v);
    const props = Object.entries(j.props).filter(([p]) => !DYNAMIC.has(p)).sort();
    k = j.name + (props.length ? '[' + props.map(([a, b]) => `${a}=${b}`).join(',') + ']' : '');
    canon.set(v, k);
  }
  return k;
}

/** Is there nothing in the way at this block (air, or something placing replaces: grass, water, snow)? */
export function isFree(v: number): boolean {
  const id = v & 0xfff;
  if (!id) return true;
  const def = mc.BLOCKS[id];
  return !!def && (def.replaceable === true || def.name === 'water' || def.name === 'lava' || def.name === 'structure_void');
}
