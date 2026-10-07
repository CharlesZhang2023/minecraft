// Loot tables, as data: each table is a list of pools; a pool rolls a number of times and each roll picks one entry
// by weight; entries give an item (by name), a count range and functions (random enchantments, enchanting at a
// level, damage, a potion, an enchanted book of a given enchantment). Chests in structures name a table; piglin
// bartering and fishing use the same machinery. Values follow vanilla 1.16.5 where this game has the items.
import { Random } from '../noise';
import { ItemStack, itemByName, getItem, stack, POTION_ITEMS, DISCS } from './items';
import { blockByName } from '../world/blocks';
import { ENCHANTS, rollEnchants } from './enchant';

type Fn = { enchant?: true; levels?: [number, number]; damage?: [number, number]; book?: string; potion?: string };
interface Entry { item: string | null; w: number; n?: [number, number] | number; fn?: Fn }
interface Pool { rolls: [number, number] | number; entries: Entry[] }
export type LootTable = Pool[];

const E = (item: string | null, w: number, n?: [number, number] | number, fn?: Fn): Entry => ({ item, w, n, fn });
const ench: Fn = { enchant: true };
const lv = (a: number, b: number, d?: [number, number]): Fn => ({ levels: [a, b], ...(d ? { damage: d } : {}) });
const dmg = (a: number, b: number): Fn => ({ damage: [a, b] });

export const LOOT: Record<string, LootTable> = {
  simple_dungeon: [
    { rolls: [1, 3], entries: [E('saddle', 20), E('golden_apple', 15), E('enchanted_golden_apple', 2), E('music_disc_13', 15), E('music_disc_cat', 15), E('name_tag', 20), E('golden_horse_armor', 10), E('iron_horse_armor', 15), E('diamond_horse_armor', 5), E('enchanted_book', 10, 1, ench)] },
    { rolls: [1, 4], entries: [E('iron_ingot', 10, [1, 4]), E('gold_ingot', 5, [1, 4]), E('bread', 20), E('wheat', 20, [1, 4]), E('bucket', 10), E('redstone', 15, [1, 4]), E('coal', 15, [1, 4]), E('melon_seeds', 10, [2, 4]), E('pumpkin_seeds', 10, [2, 4]), E('beetroot_seeds', 10, [2, 4])] },
    { rolls: 3, entries: [E('bone', 10, [1, 8]), E('gunpowder', 10, [1, 8]), E('rotten_flesh', 10, [1, 8]), E('string', 10, [1, 8])] },
  ],
  nether_bridge: [
    { rolls: [2, 4], entries: [E('diamond', 5, [1, 3]), E('iron_ingot', 5, [1, 5]), E('gold_ingot', 15, [1, 3]), E('golden_sword', 5), E('golden_chestplate', 5), E('flint_and_steel', 5), E('nether_wart', 5, [3, 7]), E('saddle', 10), E('golden_horse_armor', 8), E('iron_horse_armor', 5), E('diamond_horse_armor', 3), E('obsidian', 2, [2, 4])] },
  ],
  stronghold_corridor: [
    { rolls: [2, 3], entries: [E('ender_pearl', 10), E('diamond', 3, [1, 3]), E('iron_ingot', 10, [1, 5]), E('gold_ingot', 5, [1, 3]), E('redstone', 5, [4, 9]), E('bread', 15, [1, 3]), E('apple', 15, [1, 3]), E('iron_pickaxe', 5), E('iron_sword', 5), E('iron_chestplate', 5), E('iron_helmet', 5), E('iron_leggings', 5), E('iron_boots', 5), E('golden_apple', 1), E('saddle', 1), E('iron_horse_armor', 1), E('golden_horse_armor', 1), E('diamond_horse_armor', 1), E('enchanted_book', 1, 1, lv(30, 30))] },
  ],
  stronghold_crossing: [
    { rolls: [1, 4], entries: [E('iron_ingot', 10, [1, 5]), E('gold_ingot', 5, [1, 3]), E('redstone', 5, [4, 9]), E('coal', 10, [3, 8]), E('bread', 15, [1, 3]), E('apple', 15, [1, 3]), E('iron_pickaxe', 1), E('enchanted_book', 1, 1, lv(30, 30))] },
  ],
  stronghold_library: [
    { rolls: [2, 10], entries: [E('book', 20, [1, 3]), E('paper', 20, [2, 7]), E('map', 1), E('compass', 1), E('enchanted_book', 10, 1, lv(30, 30))] },
  ],
  abandoned_mineshaft: [
    { rolls: 1, entries: [E('golden_apple', 20), E('enchanted_golden_apple', 3), E('name_tag', 30), E('enchanted_book', 10, 1, ench), E('iron_pickaxe', 5), E(null, 5)] },
    { rolls: [2, 4], entries: [E('iron_ingot', 10, [1, 5]), E('gold_ingot', 5, [1, 3]), E('redstone', 5, [4, 9]), E('lapis_lazuli', 5, [4, 9]), E('diamond', 3, [1, 2]), E('coal', 10, [3, 8]), E('bread', 15, [1, 3]), E('melon_seeds', 10, [2, 4]), E('pumpkin_seeds', 10, [2, 4]), E('beetroot_seeds', 10, [2, 4])] },
    { rolls: 3, entries: [E('rail', 20, [4, 8]), E('powered_rail', 5, [1, 4]), E('detector_rail', 5, [1, 4]), E('activator_rail', 5, [1, 4]), E('torch', 15, [1, 16])] },
  ],
  desert_pyramid: [
    { rolls: [2, 4], entries: [E('diamond', 5, [1, 3]), E('iron_ingot', 15, [1, 5]), E('gold_ingot', 15, [2, 7]), E('emerald', 15, [1, 3]), E('bone', 25, [4, 6]), E('spider_eye', 25, [1, 3]), E('rotten_flesh', 25, [3, 7]), E('saddle', 20), E('iron_horse_armor', 15), E('golden_horse_armor', 10), E('diamond_horse_armor', 5), E('enchanted_book', 20, 1, ench), E('golden_apple', 20), E('enchanted_golden_apple', 2), E(null, 15)] },
    { rolls: 4, entries: [E('bone', 10, [1, 8]), E('gunpowder', 10, [1, 8]), E('rotten_flesh', 10, [1, 8]), E('string', 10, [1, 8]), E('sand', 10, [1, 8])] },
  ],
  jungle_temple: [
    { rolls: [2, 6], entries: [E('diamond', 3, [1, 3]), E('iron_ingot', 10, [1, 5]), E('gold_ingot', 15, [2, 7]), E('emerald', 2, [1, 3]), E('bone', 20, [4, 6]), E('rotten_flesh', 16, [3, 7]), E('saddle', 3), E('iron_horse_armor', 1), E('golden_horse_armor', 1), E('diamond_horse_armor', 1), E('enchanted_book', 1, 1, lv(30, 30))] },
  ],
  jungle_temple_dispenser: [{ rolls: [1, 2], entries: [E('arrow', 30, [2, 7])] }],
  igloo_chest: [
    { rolls: [2, 8], entries: [E('apple', 15, [1, 3]), E('coal', 15, [1, 4]), E('gold_nugget', 10, [1, 3]), E('stone_axe', 2), E('rotten_flesh', 10), E('emerald', 1), E('wheat', 10, [2, 3])] },
    { rolls: 1, entries: [E('golden_apple', 1)] },
  ],
  pillager_outpost: [
    { rolls: [0, 1], entries: [E('crossbow', 1)] },
    { rolls: [2, 3], entries: [E('wheat', 7, [3, 5]), E('potato', 5, [2, 5]), E('carrot', 5, [3, 5])] },
    { rolls: [1, 3], entries: [E('dark_oak_log', 1, [2, 3])] },
    { rolls: [2, 3], entries: [E('experience_bottle', 7), E('string', 4, [1, 6]), E('arrow', 4, [2, 7]), E('tripwire_hook', 3), E('iron_ingot', 3, [1, 3]), E('enchanted_book', 1, 1, ench)] },
  ],
  woodland_mansion: [
    { rolls: [1, 3], entries: [E('lead', 20), E('golden_apple', 15), E('enchanted_golden_apple', 2), E('music_disc_13', 15), E('music_disc_cat', 15), E('name_tag', 20), E('chainmail_chestplate', 10), E('diamond_hoe', 15), E('enchanted_book', 10, 1, ench)] },
    { rolls: [1, 4], entries: [E('iron_ingot', 10, [1, 4]), E('gold_ingot', 5, [1, 4]), E('bread', 20), E('wheat', 20, [1, 4]), E('bucket', 10), E('redstone', 15, [1, 4]), E('coal', 15, [1, 4]), E('melon_seeds', 10, [2, 4]), E('pumpkin_seeds', 10, [2, 4]), E('beetroot_seeds', 10, [2, 4])] },
    { rolls: 3, entries: [E('bone', 10, [1, 8]), E('gunpowder', 10, [1, 8]), E('rotten_flesh', 10, [1, 8]), E('string', 10, [1, 8])] },
  ],
  buried_treasure: [
    { rolls: 1, entries: [E('heart_of_the_sea', 1)] },
    { rolls: [5, 8], entries: [E('iron_ingot', 20, [1, 4]), E('gold_ingot', 10, [1, 4]), E('tnt', 5, [1, 2])] },
    { rolls: [1, 3], entries: [E('emerald', 5, [4, 8]), E('diamond', 5, [1, 2]), E('prismarine_crystals', 5, [1, 5])] },
    { rolls: [0, 1], entries: [E('leather_chestplate', 1), E('iron_sword', 1)] },
    { rolls: 2, entries: [E('cooked_cod', 1, [2, 4]), E('cooked_salmon', 1, [2, 4])] },
    { rolls: [0, 2], entries: [E('potion_water_breathing', 1)] },
  ],
  shipwreck_supply: [
    { rolls: [3, 10], entries: [E('paper', 8, [1, 12]), E('potato', 7, [2, 6]), E('poisonous_potato', 7, [2, 6]), E('carrot', 7, [4, 8]), E('wheat', 7, [8, 21]), E('suspicious_stew', 10), E('coal', 6, [2, 8]), E('rotten_flesh', 5, [5, 24]), E('pumpkin', 2, [1, 3]), E('bamboo', 2, [1, 3]), E('gunpowder', 3, [1, 5]), E('tnt', 1, [1, 2]), E('leather_helmet', 3, 1, ench), E('leather_chestplate', 3, 1, ench), E('leather_leggings', 3, 1, ench), E('leather_boots', 3, 1, ench)] },
  ],
  shipwreck_treasure: [
    { rolls: [3, 6], entries: [E('iron_ingot', 90, [1, 5]), E('gold_ingot', 10, [1, 5]), E('emerald', 40, [1, 5]), E('diamond', 5), E('experience_bottle', 5)] },
    { rolls: [2, 5], entries: [E('iron_nugget', 50, [1, 10]), E('gold_nugget', 10, [1, 10]), E('lapis_lazuli', 20, [1, 10])] },
  ],
  shipwreck_map: [
    { rolls: 1, entries: [E('map', 1)] },
    { rolls: 3, entries: [E('compass', 1), E('map', 1), E('clock', 1), E('paper', 20, [1, 10]), E('feather', 10, [1, 5]), E('book', 5, [1, 5])] },
  ],
  underwater_ruin_small: [
    { rolls: [2, 8], entries: [E('coal', 10, [1, 4]), E('stone_axe', 2), E('rotten_flesh', 5), E('emerald', 1), E('wheat', 10, [2, 3])] },
    { rolls: 1, entries: [E('leather_chestplate', 1), E('golden_helmet', 1), E('fishing_rod', 5, 1, ench), E('map', 5)] },
  ],
  underwater_ruin_big: [
    { rolls: [2, 8], entries: [E('coal', 10, [1, 4]), E('gold_nugget', 10, [1, 3]), E('emerald', 1), E('wheat', 10, [2, 3])] },
    { rolls: 1, entries: [E('golden_apple', 1), E('enchanted_book', 5, 1, ench), E('leather_chestplate', 1), E('golden_helmet', 1), E('fishing_rod', 5, 1, ench), E('map', 10)] },
  ],
  ruined_portal: [
    { rolls: [4, 8], entries: [E('obsidian', 40, [1, 2]), E('flint', 40, [1, 4]), E('iron_nugget', 40, [9, 18]), E('flint_and_steel', 40), E('fire_charge', 40), E('golden_apple', 15), E('gold_nugget', 15, [4, 24]),
      E('golden_sword', 15, 1, ench), E('golden_axe', 15, 1, ench), E('golden_hoe', 15, 1, ench), E('golden_shovel', 15, 1, ench), E('golden_pickaxe', 15, 1, ench), E('golden_boots', 15, 1, ench), E('golden_chestplate', 15, 1, ench), E('golden_helmet', 15, 1, ench), E('golden_leggings', 15, 1, ench),
      E('glistering_melon_slice', 5, [4, 12]), E('golden_horse_armor', 5), E('light_weighted_pressure_plate', 5), E('golden_carrot', 5, [4, 12]), E('clock', 5), E('gold_ingot', 5, [2, 8]), E('bell', 1), E('enchanted_golden_apple', 1), E('gold_block', 1, [1, 2])] },
  ],
  bastion_treasure: [
    { rolls: 3, entries: [E('netherite_ingot', 15), E('ancient_debris', 10), E('netherite_scrap', 8), E('ancient_debris', 4, 2), E('diamond_sword', 6, 1, { enchant: true, damage: [0.8, 1] }), E('diamond_chestplate', 6, 1, { enchant: true, damage: [0.8, 1] }), E('diamond_helmet', 6, 1, { enchant: true, damage: [0.8, 1] }), E('diamond_leggings', 6, 1, { enchant: true, damage: [0.8, 1] }), E('diamond_boots', 6, 1, { enchant: true, damage: [0.8, 1] }), E('diamond', 6, [2, 6]), E('enchanted_golden_apple', 5)] },
    { rolls: [3, 4], entries: [E('spectral_arrow', 1, [12, 25]), E('gold_block', 1, [2, 5]), E('iron_block', 1, [2, 5]), E('gold_ingot', 1, [3, 9]), E('iron_ingot', 1, [3, 9]), E('crying_obsidian', 1, [3, 5]), E('quartz', 1, [8, 23]), E('gilded_blackstone', 1, [5, 15]), E('magma_cream', 1, [3, 8])] },
  ],
  bastion_other: [
    { rolls: 1, entries: [E('diamond_pickaxe', 6, 1, ench), E('diamond_shovel', 6), E('crossbow', 6, 1, { enchant: true, damage: [0.1, 0.9] }), E('ancient_debris', 12), E('netherite_scrap', 4), E('spectral_arrow', 10, [10, 22]), E('music_disc_pigstep', 5), E('golden_carrot', 12, [6, 17]), E('golden_apple', 9), E('enchanted_book', 10, 1, { book: 'soul_speed' })] },
    { rolls: 2, entries: [E('iron_sword', 2, 1, { damage: [0.1, 0.9], enchant: true }), E('iron_block', 2), E('golden_boots', 1, 1, { book: 'soul_speed' }), E('golden_axe', 1, 1, ench), E('gold_block', 2), E('crossbow', 1), E('gold_ingot', 2, [1, 6]), E('iron_ingot', 2, [1, 6]), E('golden_sword', 2), E('golden_chestplate', 2), E('golden_helmet', 2), E('golden_leggings', 2), E('golden_boots', 2), E('crying_obsidian', 2, [1, 5])] },
    { rolls: [3, 4], entries: [E('gilded_blackstone', 2, [1, 5]), E('chain', 2, [2, 10]), E('magma_cream', 2, [2, 6]), E('bone_block', 2, [3, 6]), E('iron_nugget', 2, [2, 8]), E('obsidian', 2, [4, 6]), E('gold_nugget', 2, [2, 8]), E('string', 2, [4, 6]), E('arrow', 2, [5, 17]), E('cooked_porkchop', 1)] },
  ],
  bastion_bridge: [
    { rolls: 1, entries: [E('lodestone', 1)] },
    { rolls: [1, 2], entries: [E('crossbow', 1, 1, { damage: [0.1, 0.5], enchant: true }), E('spectral_arrow', 1, [10, 28]), E('gilded_blackstone', 1, [8, 12]), E('crying_obsidian', 1, [3, 8]), E('gold_block', 1), E('gold_ingot', 1, [4, 9]), E('iron_ingot', 1, [4, 9]), E('golden_sword', 1), E('golden_chestplate', 1, 1, ench), E('golden_helmet', 1, 1, ench), E('golden_leggings', 1, 1, ench), E('golden_boots', 1, 1, ench), E('golden_axe', 1, 1, ench)] },
    { rolls: [2, 4], entries: [E('string', 1, [1, 6]), E('leather', 1, [1, 3]), E('arrow', 1, [5, 17]), E('iron_nugget', 1, [2, 6]), E('gold_nugget', 1, [2, 6])] },
  ],
  bastion_hoglin_stable: [
    { rolls: 1, entries: [E('diamond_shovel', 15, 1, { damage: [0.15, 0.8], enchant: true }), E('diamond_pickaxe', 12, 1, { damage: [0.15, 0.95], enchant: true }), E('netherite_scrap', 8), E('ancient_debris', 12), E('ancient_debris', 5, 2), E('saddle', 12), E('gold_block', 16, [2, 4]), E('golden_carrot', 10, [8, 17]), E('golden_apple', 10)] },
    { rolls: [3, 4], entries: [E('golden_axe', 1, 1, ench), E('crying_obsidian', 1, [1, 5]), E('glowstone', 1, [3, 6]), E('gilded_blackstone', 1, [2, 5]), E('soul_sand', 1, [2, 7]), E('crimson_nylium', 1, [2, 7]), E('gold_nugget', 1, [2, 8]), E('leather', 1, [1, 3]), E('arrow', 1, [5, 17]), E('string', 1, [3, 8]), E('porkchop', 1, [2, 5]), E('cooked_porkchop', 1, [2, 5]), E('crimson_fungus', 1, [2, 7]), E('crimson_roots', 1, [2, 7])] },
  ],
  end_city_treasure: [
    { rolls: [2, 6], entries: [E('diamond', 5, [2, 7]), E('iron_ingot', 10, [4, 8]), E('gold_ingot', 15, [2, 7]), E('emerald', 2, [2, 6]), E('beetroot_seeds', 5, [1, 10]), E('saddle', 3), E('iron_horse_armor', 1), E('golden_horse_armor', 1), E('diamond_horse_armor', 1),
      E('diamond_sword', 3, 1, lv(20, 39)), E('diamond_boots', 3, 1, lv(20, 39)), E('diamond_chestplate', 3, 1, lv(20, 39)), E('diamond_leggings', 3, 1, lv(20, 39)), E('diamond_helmet', 3, 1, lv(20, 39)), E('diamond_pickaxe', 3, 1, lv(20, 39)), E('diamond_shovel', 3, 1, lv(20, 39)),
      E('iron_sword', 3, 1, lv(20, 39)), E('iron_boots', 3, 1, lv(20, 39)), E('iron_chestplate', 3, 1, lv(20, 39)), E('iron_leggings', 3, 1, lv(20, 39)), E('iron_helmet', 3, 1, lv(20, 39)), E('iron_pickaxe', 3, 1, lv(20, 39)), E('iron_shovel', 3, 1, lv(20, 39))] },
  ],
  village_weaponsmith: [{ rolls: [3, 8], entries: [E('diamond', 3, [1, 3]), E('iron_ingot', 10, [1, 5]), E('gold_ingot', 5, [1, 3]), E('bread', 15, [1, 3]), E('apple', 15, [1, 3]), E('iron_pickaxe', 5), E('iron_sword', 5), E('iron_chestplate', 5), E('iron_helmet', 5), E('iron_leggings', 5), E('iron_boots', 5), E('obsidian', 5, [3, 7]), E('oak_sapling', 5, [3, 7]), E('saddle', 3), E('iron_horse_armor', 1), E('golden_horse_armor', 1), E('diamond_horse_armor', 1)] }],
  village_toolsmith: [{ rolls: [3, 8], entries: [E('diamond', 1, [1, 3]), E('iron_ingot', 5, [1, 5]), E('gold_ingot', 1, [1, 3]), E('bread', 15, [1, 3]), E('iron_pickaxe', 5), E('coal', 1, [1, 3]), E('stick', 20, [1, 3]), E('iron_shovel', 5)] }],
  village_house: [{ rolls: [3, 8], entries: [E('gold_nugget', 1, [1, 3]), E('dandelion', 2), E('poppy', 1), E('potato', 10, [1, 7]), E('bread', 10, [1, 4]), E('apple', 10, [1, 5]), E('book', 1), E('feather', 1), E('emerald', 2, [1, 4]), E('oak_sapling', 5, [1, 2])] }],
  village_temple: [{ rolls: [3, 8], entries: [E('redstone', 2, [1, 4]), E('bread', 7, [1, 4]), E('rotten_flesh', 7, [1, 4]), E('lapis_lazuli', 1, [1, 4]), E('gold_ingot', 1, [1, 4]), E('emerald', 1, [1, 4])] }],
  spawn_bonus_chest: [
    { rolls: 1, entries: [E('stone_axe', 1), E('wooden_axe', 3)] },
    { rolls: 1, entries: [E('stone_pickaxe', 1), E('wooden_pickaxe', 3)] },
    { rolls: 3, entries: [E('apple', 5, [1, 2]), E('bread', 3, [1, 2]), E('salmon', 3, [1, 2])] },
    { rolls: 4, entries: [E('stick', 10, [1, 12]), E('oak_planks', 10, [1, 12]), E('oak_log', 3, [1, 3]), E('spruce_log', 3, [1, 3]), E('birch_log', 3, [1, 3]), E('jungle_log', 3, [1, 3]), E('acacia_log', 3, [1, 3]), E('dark_oak_log', 3, [1, 3])] },
  ],
  /** Piglin bartering (1.16.5 weights, out of 459). */
  piglin_bartering: [
    { rolls: 1, entries: [E('enchanted_book', 5, 1, { book: 'soul_speed' }), E('iron_boots', 8, 1, { book: 'soul_speed' }), E('potion_fire_resistance', 8), E('splash_potion_fire_resistance', 8), E('potion_water', 10),
      E('iron_nugget', 10, [10, 36]), E('ender_pearl', 10, [2, 4]), E('string', 20, [3, 9]), E('quartz', 20, [5, 12]), E('obsidian', 40), E('crying_obsidian', 40, [1, 3]), E('fire_charge', 40),
      E('leather', 40, [2, 4]), E('soul_sand', 40, [2, 8]), E('nether_brick', 40, [2, 8]), E('spectral_arrow', 40, [6, 12]), E('gravel', 40, [8, 16]), E('blackstone', 40, [8, 16])] },
  ],
};

const resolved = new Map<string, number>();
const idOfName = (name: string) => {
  let id = resolved.get(name);
  if (id === undefined) { id = itemByName(name)?.id ?? blockByName(name)?.id ?? -1; resolved.set(name, id); }
  return id;
};
const span = (r: Random, v: [number, number] | number | undefined) => (v === undefined ? 1 : typeof v === 'number' ? v : v[0] + r.int(v[1] - v[0] + 1));

/** Roll a table: the stacks it gives. */
export function rollLoot(name: string, r: Random): ItemStack[] {
  const t = LOOT[name];
  if (!t) return [];
  const out: ItemStack[] = [];
  for (const pool of t) {
    const rolls = span(r, pool.rolls);
    const total = pool.entries.reduce((a, e) => a + e.w, 0);
    for (let k = 0; k < rolls; k++) {
      let pick = r.next() * total;
      let e = pool.entries[pool.entries.length - 1];
      for (const x of pool.entries) { pick -= x.w; if (pick < 0) { e = x; break; } }
      if (!e.item) continue;
      const id = idOfName(e.item);
      if (id < 0) continue;
      const s = stack(id, Math.max(1, span(r, e.n)));
      applyFn(s, e.fn, r);
      out.push(s);
    }
  }
  return out;
}

function applyFn(s: ItemStack, fn: Fn | undefined, r: Random) {
  if (!fn) return;
  const d = getItem(s.id);
  if (fn.book) {
    if (d.name === 'enchanted_book') s.ench = { [fn.book]: 1 + r.int(3) };
    else s.ench = { ...(s.ench ?? {}), [fn.book]: 1 + r.int(3) };
  } else if (fn.enchant || fn.levels) {
    if (d.name === 'enchanted_book' || d.name === 'book') {
      const pool = ENCHANTS;
      const e = pool[r.int(pool.length)];
      s.id = idOfName('enchanted_book');
      s.ench = { [e.id]: fn.levels ? Math.max(1, Math.min(e.max, Math.round((fn.levels[0] + r.int(fn.levels[1] - fn.levels[0] + 1)) / 8))) : 1 + r.int(e.max) };
    } else {
      const lvlCost = fn.levels ? fn.levels[0] + r.int(fn.levels[1] - fn.levels[0] + 1) : 1 + r.int(30);
      const e = rollEnchants(s, lvlCost, r);
      if (Object.keys(e).length) s.ench = e;
    }
  }
  if (fn.damage && d.durability) s.damage = Math.floor(d.durability * (1 - (fn.damage[0] + r.next() * (fn.damage[1] - fn.damage[0]))));
}

/** A 27-slot chest filled from a table (stacks scattered over random slots, like vanilla). */
export function chestLoot(name: string, r: Random, size = 27): (ItemStack | null)[] {
  const items: (ItemStack | null)[] = new Array(size).fill(null);
  const free = Array.from({ length: size }, (_, i) => i);
  for (const s of rollLoot(name, r)) {
    if (!free.length) break;
    const k = free.splice(r.int(free.length), 1)[0];
    items[k] = s;
  }
  return items;
}
void POTION_ITEMS; void DISCS;
