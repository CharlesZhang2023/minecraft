// Recipes: key crafts of the 1.16 set work through the real crafting matcher, and nothing names a missing item.
//   node tools/test/run.mjs tools/test/recipes.ts
import { craft, SMELTING, STONECUTTING, SMITHING } from '../../src/game/recipes';
import { itemByName, getItem, ITEMS, ItemStack } from '../../src/game/items';
import { blockByName } from '../../src/world/blocks';
import { check, eq, done } from './check';
import { brewResult } from '../../src/game/brewing';

const id = (n: string) => itemByName(n)?.id ?? blockByName(n)?.id ?? -1;
const g = (rows: string[], key: Record<string, string>): (ItemStack | null)[] => {
  const out: (ItemStack | null)[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { const c = rows[y]?.[x] ?? ' '; out.push(c === ' ' ? null : { id: id(key[c]), count: 1 }); }
  return out;
};
const crafts = (rows: string[], key: Record<string, string>, want: string, count?: number) => {
  const r = craft(g(rows, key), 3);
  if (want === 'air') { check(!r, `nothing expected, got ${r ? getItem(r.id).name : ''}`); return; }
  check(r?.id === id(want), `${want}: got ${r ? getItem(r.id).name : 'nothing'}`);
  if (count && r) eq(r.count, count, `${want} count`);
};
crafts(['L  '], { L: 'jungle_log' }, 'jungle_planks', 4);
crafts(['L  '], { L: 'crimson_stem' }, 'crimson_planks', 4);
crafts(['P  ', 'P  '], { P: 'warped_planks' }, 'stick', 4);
crafts(['PP ', 'PP '], { P: 'acacia_planks' }, 'crafting_table');
crafts(['CCC', 'C C', 'CCC'], { C: 'blackstone' }, 'furnace');
crafts(['CCC', ' S ', ' S '], { C: 'blackstone', S: 'stick' }, 'stone_pickaxe');
crafts(['S#S', 'S#S'], { S: 'stick', '#': 'dark_oak_planks' }, 'dark_oak_fence_gate');
crafts(['###', '###', ' S '], { '#': 'birch_planks', S: 'stick' }, 'birch_sign', 3);
crafts(['## ', '## ', '## '], { '#': 'crimson_planks' }, 'crimson_door', 3);
crafts(['#  '], { '#': 'poppy' }, 'red_dye');
crafts(['#D '], { '#': 'white_wool', D: 'blue_dye' }, 'blue_wool');
crafts(['###', '#D#', '###'], { '#': 'glass', D: 'lime_dye' }, 'lime_stained_glass', 8);
crafts(['SSS', 'SSG', 'GGG'], { S: 'sand', G: 'gravel' }, 'air' as string); // needs a dye: nothing
crafts(['SSD', 'SSG', 'GGG'], { S: 'sand', G: 'gravel', D: 'cyan_dye' }, 'cyan_concrete_powder', 8);
crafts(['SSS', 'SSS', 'SGG'], { S: 'netherite_scrap', G: 'gold_ingot' }, 'air');
crafts(['SSS', 'SGG', 'GG '], { S: 'netherite_scrap', G: 'gold_ingot' }, 'netherite_ingot');
crafts(['SSS', 'SNS', 'SSS'], { S: 'chiseled_stone_bricks', N: 'netherite_ingot' }, 'lodestone');
crafts(['OOO', 'GGG', 'OOO'], { O: 'crying_obsidian', G: 'glowstone' }, 'respawn_anchor');
crafts(['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'soul_torch' }, 'soul_lantern');
crafts(['C  ', 'S  ', 'O  '], { C: 'coal', S: 'stick', O: 'soul_soil' }, 'soul_torch', 4);
crafts([' R ', 'RHR', ' R '], { R: 'redstone', H: 'hay_block' }, 'target');
crafts(['ii ', 'PP ', 'PP '], { i: 'iron_ingot', P: 'oak_planks' }, 'smithing_table');
crafts(['PIP', 'PPP', ' P '], { P: 'spruce_planks', I: 'iron_ingot' }, 'shield');
crafts(['#  ', '## ', '###'], { '#': 'polished_blackstone_bricks' }, 'polished_blackstone_brick_stairs', 4);
crafts(['###', '###'], { '#': 'red_nether_bricks' }, 'red_nether_brick_wall', 6);
check(SMELTING[id('ancient_debris')]?.out === id('netherite_scrap'), 'ancient debris smelts into netherite scrap');
check(!!SMELTING[id('ancient_debris')]?.ore, 'ancient debris is a blast-furnace recipe');
check(!!SMELTING[id('beef')]?.food, 'beef cooks in a smoker');
check(SMELTING[id('cyan_terracotta')]?.out === id('cyan_glazed_terracotta'), 'terracotta glazes in a furnace');
check(STONECUTTING.some((r) => r.input === id('stone') && r.out === id('stone_bricks')), 'stonecutter: stone -> stone bricks');
check(STONECUTTING.some((r) => r.input === id('blackstone') && r.out === id('polished_blackstone_brick_slab') && r.count === 2), 'stonecutter: blackstone -> 2 brick slabs');
check(SMITHING.some((r) => r.base === id('diamond_sword') && r.out === id('netherite_sword')), 'smithing: diamond sword -> netherite');
// every recipe output and smelting result is a real item
for (const [k, r] of Object.entries(SMELTING)) check(ITEMS.has(r.out), `smelting ${k} -> unknown ${r.out}`);
for (const r of STONECUTTING) check(ITEMS.has(r.out) && ITEMS.has(r.input), `stonecutting ${r.input} -> ${r.out}`);
// brewing: the 1.9-1.13 ingredients and dragon's breath
const brew = (potion: string, ing: string, splash = false, lingering = false) => brewResult(potion, splash, id(ing), lingering);
eq(brew('awkward', 'turtle_helmet')?.key, 'turtle_master', 'turtle shell brews the turtle master');
eq(brew('turtle_master', 'redstone')?.key, 'long_turtle_master', 'redstone lengthens it');
eq(brew('turtle_master', 'glowstone_dust')?.key, 'strong_turtle_master', 'glowstone strengthens it');
eq(brew('awkward', 'phantom_membrane')?.key, 'slow_falling', 'phantom membrane brews slow falling');
eq(brew('awkward', 'rabbit_foot')?.key, 'leaping', "a rabbit's foot brews leaping");
check(!!brew('swiftness', 'dragon_breath', true)?.lingering, "dragon's breath makes a splash potion lingering");
check(!brew('swiftness', 'dragon_breath'), "but not a drinkable one");
check(!!brew('swiftness', 'redstone', false, true)?.lingering, 'a lingering potion stays lingering');
check(!!itemByName('tipped_arrow_slow_falling') && !!itemByName('lingering_potion_turtle_master'), 'the new potions come in every form');
done();
