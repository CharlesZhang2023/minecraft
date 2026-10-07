// Recipes of the 1.9 - 1.16 content: crafting (wood sets, colours, stone families, the Nether update, the sea, the
// new workstations), smelting with its blast-furnace and smoker kinds, campfire cooking, stonecutting and 1.16
// smithing (diamond gear + netherite ingot). recipes.ts calls `registerRecipes116` with its helpers.
import { B, B2, BLOCKS, BLOCK_COUNT, WOOD, STONE2, CONCRETE, CONCRETE_POWDER, TERRACOTTA_COLORS, GLAZED_TERRACOTTA, STAINED_GLASS, STAINED_PANES, CARPETS, BEDS, SHULKER_BOXES, WOOL_COLORS, SHAPE, Shape, blockByName, CORAL } from '../world/blocks';
import { I, I2, I3, I5, I6, I7, TOOLS, ARMOR, DYES, BOATS, TIPPED_ARROWS, LINGERING_ITEMS, itemByName, ItemStack } from './items';
import { ITEM_TAGS } from './tags';

type Key = Record<string, number | number[]>;
export interface RecipeKit {
  S(pattern: string[], key: Key, id: number, count?: number): void;
  L(ingredients: (number | number[])[], id: number, count?: number): void;
  SMELTING: Record<number, Smelt>;
}
/** A furnace recipe; `food` ones also cook in smokers and on campfires, `ore` ones in blast furnaces. */
export interface Smelt { out: number; xp: number; food?: boolean; ore?: boolean }
/** Stonecutter: one input block to one output (several outputs per input). */
export const STONECUTTING: { input: number; out: number; count: number }[] = [];
/** 1.16 smithing: base item + addition -> result (keeps enchantments and wear). */
export const SMITHING: { base: number; addition: number; out: number }[] = [];
/** The dye a flower gives (and how many). */
export const FLOWER_DYES: [number, string, number][] = [];

const id = (name: string) => { const b = blockByName(name); if (b) return b.id; const it = itemByName(name); if (!it) throw new Error('recipe: unknown ' + name); return it.id; };
const D = (c: string) => DYES[['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].indexOf(c)];

export function registerRecipes116(k: RecipeKit) {
  const { S, L, SMELTING } = k;
  const PLANKS = ITEM_TAGS.planks, STICK = I.STICK;
  const smelt = (input: number | number[], out: number, xp = 0.1, kind: Partial<Smelt> = {}) => { for (const i of Array.isArray(input) ? input : [input]) SMELTING[i] = { out, xp, ...kind }; };
  const cut = (input: number, out: number, count = 1) => STONECUTTING.push({ input, out, count });

  // ================================================================ wood
  for (const w of Object.values(WOOD)) {
    const P = w.planks;
    if (w.kind !== 'oak' && w.kind !== 'spruce' && w.kind !== 'birch') L([w.log], P, 4);
    for (const src of [w.strippedLog, w.wood, w.strippedWood]) L([src], P, 4);
    S(['##', '##'], { '#': w.log }, w.wood, 3);
    S(['##', '##'], { '#': w.strippedLog }, w.strippedWood, 3);
    if (w.kind !== 'oak' && w.kind !== 'spruce' && w.kind !== 'birch') S(['#  ', '## ', '###'], { '#': P }, w.stairs, 4);
    if (w.kind !== 'oak') S(['###'], { '#': P }, w.slab, 6);
    if (w.kind !== 'oak') S(['#S#', '#S#'], { '#': P, S: STICK }, w.fence, 3);
    S(['S#S', 'S#S'], { '#': P, S: STICK }, w.gate);
    if (w.kind !== 'oak') S(['##', '##', '##'], { '#': P }, w.door, 3);
    S(['###', '###'], { '#': P }, w.trapdoor, 2);
    L([P], w.button);
    S(['##'], { '#': P }, w.plate);
    S(['###', '###', ' S '], { '#': P, S: STICK }, w.sign, 3);
    if (!w.nether) {
      smelt([w.log, w.strippedLog, w.wood, w.strippedWood], I.CHARCOAL, 0.15);
      if (BOATS[w.kind] && w.kind !== 'oak') S(['# #', '###'], { '#': P }, BOATS[w.kind]);
    }
  }
  S(['#', '#'], { '#': B2.BAMBOO }, STICK);

  // ================================================================ dyes and the sixteen colours
  const flower = (block: number, dye: string, n = 1) => { L([block], D(dye), n); FLOWER_DYES.push([block, dye, n]); };
  flower(B.DANDELION, 'yellow'); flower(B.POPPY, 'red'); flower(B2.BLUE_ORCHID, 'light_blue'); flower(B.ALLIUM, 'magenta');
  flower(B2.AZURE_BLUET, 'light_gray'); flower(B2.RED_TULIP, 'red'); flower(B2.ORANGE_TULIP, 'orange'); flower(B2.WHITE_TULIP, 'light_gray');
  flower(B2.PINK_TULIP, 'pink'); flower(B.OXEYE_DAISY, 'light_gray'); flower(B.CORNFLOWER, 'blue'); flower(B2.LILY_OF_THE_VALLEY, 'white');
  flower(B2.WITHER_ROSE, 'black'); flower(B2.SUNFLOWER, 'yellow', 2); flower(B2.LILAC, 'magenta', 2); flower(B2.ROSE_BUSH, 'red', 2); flower(B2.PEONY, 'pink', 2);
  L([I.BONE_MEAL], D('white')); L([I2.INK_SAC], D('black')); L([I.COCOA], D('brown')); L([I.LAPIS], D('blue'));
  smelt(B.CACTUS, D('green'), 1); smelt(B2.SEA_PICKLE, D('lime'), 0.1);
  L([D('red'), D('yellow')], D('orange'), 2); L([D('red'), D('white')], D('pink'), 2); L([D('green'), D('white')], D('lime'), 2);
  L([D('blue'), D('white')], D('light_blue'), 2); L([D('blue'), D('green')], D('cyan'), 2); L([D('blue'), D('red')], D('purple'), 2);
  L([D('purple'), D('pink')], D('magenta'), 2); L([D('blue'), D('red'), D('pink')], D('magenta'), 3); L([D('blue'), D('red'), D('red'), D('white')], D('magenta'), 4);
  L([D('black'), D('white')], D('gray'), 2); L([D('gray'), D('white')], D('light_gray'), 2); L([D('black'), D('white'), D('white')], D('light_gray'), 3);
  DYES.forEach((dye, i) => {
    L([B.WOOL_WHITE, dye], WOOL_COLORS[i]);
    S(['###', '#D#', '###'], { '#': B.TERRACOTTA, D: dye }, TERRACOTTA_COLORS[i], 8);
    S(['###', '#D#', '###'], { '#': B.GLASS, D: dye }, STAINED_GLASS[i], 8);
    S(['###', '###'], { '#': STAINED_GLASS[i] }, STAINED_PANES[i], 16);
    S(['###', '#D#', '###'], { '#': B.GLASS_PANE, D: dye }, STAINED_PANES[i], 8);
    L([dye, B.SAND, B.SAND, B.SAND, B.SAND, B.GRAVEL, B.GRAVEL, B.GRAVEL, B.GRAVEL], CONCRETE_POWDER[i], 8);
    S(['##'], { '#': WOOL_COLORS[i] }, CARPETS[i], 3);
    S(['###', 'PPP'], { '#': WOOL_COLORS[i], P: PLANKS }, BEDS[i] === B.BED ? I.RED_BED : BEDS[i]);
    if (BEDS[i] !== B.BED) L([I.RED_BED, dye], BEDS[i]);
    smelt(TERRACOTTA_COLORS[i], GLAZED_TERRACOTTA[i], 0.1);
    L([B2.SHULKER_BOX, dye], SHULKER_BOXES[i]);
  });
  S(['S', 'C', 'S'], { S: I7.SHULKER_SHELL, C: B.CHEST }, B2.SHULKER_BOX);

  // ================================================================ stone families
  const fam = (base: number, stairs?: number, slab?: number, wall?: number, craft = true) => {
    if (stairs) { if (craft) S(['#  ', '## ', '###'], { '#': base }, stairs, 4); cut(base, stairs); }
    if (slab) { if (craft) S(['###'], { '#': base }, slab, 6); cut(base, slab, 2); }
    if (wall) { if (craft) S(['###', '###'], { '#': base }, wall, 6); cut(base, wall); }
  };
  const X = STONE2;
  fam(B.STONE, X.STONE_STAIRS); cut(B.STONE, B.STONE_SLAB, 2); cut(B.STONE, B.STONE_BRICKS); cut(B.STONE, B.STONE_BRICK_STAIRS); cut(B.STONE, X.STONE_BRICK_SLAB, 2); cut(B.STONE, X.STONE_BRICK_WALL); cut(B.STONE, X.CHISELED_STONE_BRICKS);
  fam(B.STONE_BRICKS, B.STONE_BRICK_STAIRS, X.STONE_BRICK_SLAB, X.STONE_BRICK_WALL, false); S(['###'], { '#': B.STONE_BRICKS }, X.STONE_BRICK_SLAB, 6); S(['###', '###'], { '#': B.STONE_BRICKS }, X.STONE_BRICK_WALL, 6); cut(B.STONE_BRICKS, X.CHISELED_STONE_BRICKS);
  S(['#', '#'], { '#': X.STONE_BRICK_SLAB }, X.CHISELED_STONE_BRICKS);
  fam(B.MOSSY_STONE_BRICKS, X.MOSSY_STONE_BRICK_STAIRS, X.MOSSY_STONE_BRICK_SLAB, X.MOSSY_STONE_BRICK_WALL);
  fam(B.MOSSY_COBBLESTONE, X.MOSSY_COBBLESTONE_STAIRS, X.MOSSY_COBBLESTONE_SLAB, X.MOSSY_COBBLESTONE_WALL);
  fam(B.COBBLESTONE, undefined, undefined, X.COBBLESTONE_WALL); cut(B.COBBLESTONE, B.COBBLESTONE_STAIRS); cut(B.COBBLESTONE, B.COBBLESTONE_SLAB, 2);
  L([B.COBBLESTONE, B2.VINE], B.MOSSY_COBBLESTONE); L([B.STONE_BRICKS, B2.VINE], B.MOSSY_STONE_BRICKS);
  for (const [raw, pol] of [[B.GRANITE, X.POLISHED_GRANITE], [B.DIORITE, X.POLISHED_DIORITE], [B.ANDESITE, X.POLISHED_ANDESITE]] as const) {
    S(['##', '##'], { '#': raw }, pol, 4); cut(raw, pol);
  }
  fam(B.GRANITE, X.GRANITE_STAIRS, X.GRANITE_SLAB, X.GRANITE_WALL); fam(B.DIORITE, X.DIORITE_STAIRS, X.DIORITE_SLAB, X.DIORITE_WALL); fam(B.ANDESITE, X.ANDESITE_STAIRS, X.ANDESITE_SLAB, X.ANDESITE_WALL);
  fam(X.POLISHED_GRANITE, X.POLISHED_GRANITE_STAIRS, X.POLISHED_GRANITE_SLAB); fam(X.POLISHED_DIORITE, X.POLISHED_DIORITE_STAIRS, X.POLISHED_DIORITE_SLAB); fam(X.POLISHED_ANDESITE, X.POLISHED_ANDESITE_STAIRS, X.POLISHED_ANDESITE_SLAB);
  for (const [raw, st, sl] of [[B.GRANITE, X.POLISHED_GRANITE_STAIRS, X.POLISHED_GRANITE_SLAB], [B.DIORITE, X.POLISHED_DIORITE_STAIRS, X.POLISHED_DIORITE_SLAB], [B.ANDESITE, X.POLISHED_ANDESITE_STAIRS, X.POLISHED_ANDESITE_SLAB]] as const) { cut(raw, st); cut(raw, sl, 2); }
  S(['CQ', 'QC'], { C: B.COBBLESTONE, Q: I.QUARTZ }, B.DIORITE, 2);
  L([B.DIORITE, I.QUARTZ], B.GRANITE); L([B.DIORITE, B.COBBLESTONE], B.ANDESITE, 2);
  // sandstone
  fam(B.SANDSTONE, X.SANDSTONE_STAIRS, X.SANDSTONE_SLAB, X.SANDSTONE_WALL); cut(B.SANDSTONE, B.SMOOTH_SANDSTONE); cut(B.SANDSTONE, X.CHISELED_SANDSTONE);
  S(['#', '#'], { '#': X.SANDSTONE_SLAB }, X.CHISELED_SANDSTONE);
  smelt(B.SANDSTONE, X.SMOOTH_SANDSTONE); fam(X.SMOOTH_SANDSTONE, X.SMOOTH_SANDSTONE_STAIRS, X.SMOOTH_SANDSTONE_SLAB);
  fam(B.SMOOTH_SANDSTONE, undefined, X.CUT_SANDSTONE_SLAB);
  S(['##', '##'], { '#': X.RED_SAND }, X.RED_SANDSTONE);
  S(['##', '##'], { '#': X.RED_SANDSTONE }, X.CUT_RED_SANDSTONE, 4); cut(X.RED_SANDSTONE, X.CUT_RED_SANDSTONE); cut(X.RED_SANDSTONE, X.CHISELED_RED_SANDSTONE);
  fam(X.RED_SANDSTONE, X.RED_SANDSTONE_STAIRS, X.RED_SANDSTONE_SLAB, X.RED_SANDSTONE_WALL);
  S(['#', '#'], { '#': X.RED_SANDSTONE_SLAB }, X.CHISELED_RED_SANDSTONE);
  smelt(X.RED_SANDSTONE, X.SMOOTH_RED_SANDSTONE); fam(X.SMOOTH_RED_SANDSTONE, X.SMOOTH_RED_SANDSTONE_STAIRS, X.SMOOTH_RED_SANDSTONE_SLAB);
  fam(X.CUT_RED_SANDSTONE, undefined, X.CUT_RED_SANDSTONE_SLAB);
  smelt(X.RED_SAND, B.GLASS, 0.1);
  // bricks and nether bricks
  fam(B.BRICKS, undefined, X.BRICK_SLAB, X.BRICK_WALL); cut(B.BRICKS, B.BRICK_STAIRS);
  fam(B.NETHER_BRICKS, undefined, X.NETHER_BRICK_SLAB, X.NETHER_BRICK_WALL); cut(B.NETHER_BRICKS, B.NETHER_BRICK_STAIRS); cut(B.NETHER_BRICKS, X.CHISELED_NETHER_BRICKS);
  S(['NW', 'WN'], { N: I3.NETHER_BRICK, W: I3.NETHER_WART }, X.RED_NETHER_BRICKS);
  fam(X.RED_NETHER_BRICKS, X.RED_NETHER_BRICK_STAIRS, X.RED_NETHER_BRICK_SLAB, X.RED_NETHER_BRICK_WALL);
  S(['#', '#'], { '#': X.NETHER_BRICK_SLAB }, X.CHISELED_NETHER_BRICKS);
  smelt(B.NETHER_BRICKS, X.CRACKED_NETHER_BRICKS);
  // quartz
  S(['##', '##'], { '#': I.QUARTZ }, B.QUARTZ_BLOCK);
  S(['#', '#'], { '#': B.QUARTZ_BLOCK }, X.QUARTZ_PILLAR, 2); cut(B.QUARTZ_BLOCK, X.QUARTZ_PILLAR); cut(B.QUARTZ_BLOCK, X.CHISELED_QUARTZ_BLOCK);
  S(['#', '#'], { '#': X.QUARTZ_SLAB }, X.CHISELED_QUARTZ_BLOCK);
  S(['##', '##'], { '#': B.QUARTZ_BLOCK }, X.QUARTZ_BRICKS, 4); cut(B.QUARTZ_BLOCK, X.QUARTZ_BRICKS);
  fam(B.QUARTZ_BLOCK, X.QUARTZ_STAIRS, X.QUARTZ_SLAB);
  smelt(B.QUARTZ_BLOCK, X.SMOOTH_QUARTZ); fam(X.SMOOTH_QUARTZ, X.SMOOTH_QUARTZ_STAIRS, X.SMOOTH_QUARTZ_SLAB);
  // purpur and end stone
  S(['##', '##'], { '#': I7.POPPED_CHORUS_FRUIT }, X.PURPUR_BLOCK, 4);
  S(['#', '#'], { '#': X.PURPUR_SLAB }, X.PURPUR_PILLAR); cut(X.PURPUR_BLOCK, X.PURPUR_PILLAR);
  fam(X.PURPUR_BLOCK, X.PURPUR_STAIRS, X.PURPUR_SLAB);
  S(['##', '##'], { '#': B.END_STONE }, X.END_STONE_BRICKS, 4); cut(B.END_STONE, X.END_STONE_BRICKS);
  fam(X.END_STONE_BRICKS, X.END_STONE_BRICK_STAIRS, X.END_STONE_BRICK_SLAB, X.END_STONE_BRICK_WALL);
  for (const [o, n] of [[X.END_STONE_BRICK_STAIRS, 1], [X.END_STONE_BRICK_SLAB, 2], [X.END_STONE_BRICK_WALL, 1]]) cut(B.END_STONE, o, n);
  smelt(I7.CHORUS_FRUIT, I7.POPPED_CHORUS_FRUIT, 0.1);
  S(['B', 'P'], { B: I3.BLAZE_ROD, P: I7.POPPED_CHORUS_FRUIT }, B2.END_ROD, 4);
  // prismarine
  S(['##', '##'], { '#': I7.PRISMARINE_SHARD }, X.PRISMARINE);
  S(['###', '###', '###'], { '#': I7.PRISMARINE_SHARD }, X.PRISMARINE_BRICKS);
  S(['###', '#D#', '###'], { '#': I7.PRISMARINE_SHARD, D: D('black') }, X.DARK_PRISMARINE);
  S(['SCS', 'CCC', 'SCS'], { S: I7.PRISMARINE_SHARD, C: I7.PRISMARINE_CRYSTALS }, X.SEA_LANTERN);
  fam(X.PRISMARINE, X.PRISMARINE_STAIRS, X.PRISMARINE_SLAB, X.PRISMARINE_WALL);
  fam(X.PRISMARINE_BRICKS, X.PRISMARINE_BRICK_STAIRS, X.PRISMARINE_BRICK_SLAB);
  fam(X.DARK_PRISMARINE, X.DARK_PRISMARINE_STAIRS, X.DARK_PRISMARINE_SLAB);
  // basalt and blackstone
  S(['##', '##'], { '#': X.BASALT }, X.POLISHED_BASALT, 4); cut(X.BASALT, X.POLISHED_BASALT);
  fam(X.BLACKSTONE, X.BLACKSTONE_STAIRS, X.BLACKSTONE_SLAB, X.BLACKSTONE_WALL);
  S(['##', '##'], { '#': X.BLACKSTONE }, X.POLISHED_BLACKSTONE, 4); cut(X.BLACKSTONE, X.POLISHED_BLACKSTONE);
  fam(X.POLISHED_BLACKSTONE, X.POLISHED_BLACKSTONE_STAIRS, X.POLISHED_BLACKSTONE_SLAB, X.POLISHED_BLACKSTONE_WALL);
  S(['##', '##'], { '#': X.POLISHED_BLACKSTONE }, X.POLISHED_BLACKSTONE_BRICKS, 4); cut(X.POLISHED_BLACKSTONE, X.POLISHED_BLACKSTONE_BRICKS); cut(X.POLISHED_BLACKSTONE, X.CHISELED_POLISHED_BLACKSTONE);
  S(['#', '#'], { '#': X.POLISHED_BLACKSTONE_SLAB }, X.CHISELED_POLISHED_BLACKSTONE);
  fam(X.POLISHED_BLACKSTONE_BRICKS, X.POLISHED_BLACKSTONE_BRICK_STAIRS, X.POLISHED_BLACKSTONE_BRICK_SLAB, X.POLISHED_BLACKSTONE_BRICK_WALL);
  for (const o of [X.POLISHED_BLACKSTONE_BRICKS, X.CHISELED_POLISHED_BLACKSTONE, X.POLISHED_BLACKSTONE_STAIRS, X.POLISHED_BLACKSTONE_WALL, X.POLISHED_BLACKSTONE_BRICK_STAIRS, X.POLISHED_BLACKSTONE_BRICK_WALL]) cut(X.BLACKSTONE, o);
  for (const o of [X.POLISHED_BLACKSTONE_SLAB, X.POLISHED_BLACKSTONE_BRICK_SLAB]) cut(X.BLACKSTONE, o, 2);
  smelt(X.POLISHED_BLACKSTONE_BRICKS, X.CRACKED_POLISHED_BLACKSTONE_BRICKS);
  L([X.POLISHED_BLACKSTONE], X.POLISHED_BLACKSTONE_BUTTON);
  S(['##'], { '#': X.POLISHED_BLACKSTONE }, X.POLISHED_BLACKSTONE_PRESSURE_PLATE);
  // a few more stone pieces
  smelt(B.STONE_BRICKS, B.CRACKED_STONE_BRICKS);
  S(['##', '##'], { '#': I3.MAGMA_CREAM }, B.MAGMA_BLOCK);
  S(['###', '###', '###'], { '#': I3.NETHER_WART }, WOOD.crimson.leaves);
  S(['###', '###', '###'], { '#': I.BONE_MEAL }, B2.BONE_BLOCK); L([B2.BONE_BLOCK], I.BONE_MEAL, 9);
  S(['###', '###', '###'], { '#': I.EMERALD }, B2.EMERALD_BLOCK); L([B2.EMERALD_BLOCK], I.EMERALD, 9);
  S(['###', '###', '###'], { '#': B.ICE }, B2.PACKED_ICE); S(['###', '###', '###'], { '#': B2.PACKED_ICE }, B2.BLUE_ICE);
  S(['###', '###', '###'], { '#': I7.DRIED_KELP }, B2.DRIED_KELP_BLOCK); L([B2.DRIED_KELP_BLOCK], I7.DRIED_KELP, 9);
  smelt(B2.KELP, I7.DRIED_KELP, 0.1, { food: true });
  smelt(B2.WET_SPONGE, B.SPONGE, 0.15);
  smelt(B.CLAY, B.TERRACOTTA, 0.35);
  for (const c of CORAL) void c;

  // ================================================================ the Nether update
  L([I7.NETHERITE_SCRAP, I7.NETHERITE_SCRAP, I7.NETHERITE_SCRAP, I7.NETHERITE_SCRAP, I.GOLD_INGOT, I.GOLD_INGOT, I.GOLD_INGOT, I.GOLD_INGOT], I7.NETHERITE_INGOT);
  S(['###', '###', '###'], { '#': I7.NETHERITE_INGOT }, B2.NETHERITE_BLOCK); L([B2.NETHERITE_BLOCK], I7.NETHERITE_INGOT, 9);
  smelt(B2.ANCIENT_DEBRIS, I7.NETHERITE_SCRAP, 2, { ore: true });
  smelt(B2.NETHER_GOLD_ORE, I.GOLD_INGOT, 1, { ore: true });
  S(['SSS', 'SNS', 'SSS'], { S: X.CHISELED_STONE_BRICKS, N: I7.NETHERITE_INGOT }, B2.LODESTONE);
  S(['OOO', 'GGG', 'OOO'], { O: B2.CRYING_OBSIDIAN, G: B.GLOWSTONE }, B2.RESPAWN_ANCHOR);
  S(['C', 'S', 'O'], { C: [I.COAL, I.CHARCOAL], S: STICK, O: [B.SOUL_SAND, B2.SOUL_SOIL] }, B2.SOUL_TORCH, 4);
  S(['NNN', 'NTN', 'NNN'], { N: I7.IRON_NUGGET, T: B.TORCH }, B2.LANTERN);
  S(['NNN', 'NTN', 'NNN'], { N: I7.IRON_NUGGET, T: B2.SOUL_TORCH }, B2.SOUL_LANTERN);
  S(['N', 'I', 'N'], { N: I7.IRON_NUGGET, I: I.IRON_INGOT }, B2.CHAIN);
  S([' S ', 'SCS', 'LLL'], { S: STICK, C: [I.COAL, I.CHARCOAL], L: ITEM_TAGS.logs }, B2.CAMPFIRE);
  S([' S ', 'SCS', 'LLL'], { S: STICK, C: [B.SOUL_SAND, B2.SOUL_SOIL], L: ITEM_TAGS.logs }, B2.SOUL_CAMPFIRE);
  S([' R ', 'RHR', ' R '], { R: I.REDSTONE, H: B.HAY_BLOCK }, B2.TARGET);
  S(['R ', ' F'], { R: I2.FISHING_ROD, F: WOOD.warped.sapling }, I7.WARPED_FUNGUS_ON_A_STICK);
  S(['R ', ' C'], { R: I2.FISHING_ROD, C: I3.CARROT }, I7.CARROT_ON_A_STICK);
  L([I.IRON_INGOT], I7.IRON_NUGGET, 9);
  S(['###', '###', '###'], { '#': I7.IRON_NUGGET }, I.IRON_INGOT);
  // gold and iron gear melts down to nuggets
  for (const n of ['golden_sword', 'golden_shovel', 'golden_pickaxe', 'golden_axe', 'golden_hoe']) smelt(TOOLS[n], I.GOLD_NUGGET, 0.1, { ore: true });
  for (const n of ['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots']) smelt(ARMOR[n], I.GOLD_NUGGET, 0.1, { ore: true });
  for (const n of ['iron_sword', 'iron_shovel', 'iron_pickaxe', 'iron_axe', 'iron_hoe']) smelt(TOOLS[n], I7.IRON_NUGGET, 0.1, { ore: true });
  for (const n of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) smelt(ARMOR[n], I7.IRON_NUGGET, 0.1, { ore: true });
  for (const kind of ['sword', 'shovel', 'pickaxe', 'axe', 'hoe']) SMITHING.push({ base: TOOLS['diamond_' + kind], addition: I7.NETHERITE_INGOT, out: TOOLS['netherite_' + kind] });
  for (const kind of ['helmet', 'chestplate', 'leggings', 'boots']) SMITHING.push({ base: ARMOR['diamond_' + kind], addition: I7.NETHERITE_INGOT, out: ARMOR['netherite_' + kind] });
  // ores and food: blast furnaces take the ores, smokers and campfires the food
  for (const ore of [B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.COAL_ORE, B.REDSTONE_ORE, B.LAPIS_ORE, B.EMERALD_ORE, B.NETHER_QUARTZ_ORE]) if (SMELTING[ore]) SMELTING[ore].ore = true;
  for (const raw of [I.PORKCHOP, I.BEEF, I.CHICKEN, I.MUTTON, I2.COD, I2.SALMON, I3.POTATO]) if (SMELTING[raw]) SMELTING[raw].food = true;
  smelt(I7.RABBIT, I7.COOKED_RABBIT, 0.35, { food: true });

  // ================================================================ the sea
  S(['NNN', 'NHN', 'NNN'], { N: I7.NAUTILUS_SHELL, H: I7.HEART_OF_THE_SEA }, B2.CONDUIT);
  S(['SSS', 'S S'], { S: I7.SCUTE }, I7.TURTLE_HELMET);
  S(['BSB', 'B B', 'B B'], { B: B2.BAMBOO, S: I.STRING }, B2.SCAFFOLDING, 6);

  // ================================================================ workstations and other blocks
  S([' L ', 'LFL', ' L '], { L: ITEM_TAGS.logs, F: B.FURNACE }, B2.SMOKER);
  S(['III', 'IFI', 'SSS'], { I: I.IRON_INGOT, F: B.FURNACE, S: B.DOUBLE_STONE_SLAB }, B2.BLAST_FURNACE);
  S(['PSP', 'P P', 'PSP'], { P: PLANKS, S: ITEM_TAGS.wooden_slabs }, B2.BARREL);
  S(['pp', 'PP', 'PP'], { p: I.PAPER, P: PLANKS }, B2.CARTOGRAPHY_TABLE);
  S(['ff', 'PP', 'PP'], { f: I.FLINT, P: PLANKS }, B2.FLETCHING_TABLE);
  S(['ii', 'PP', 'PP'], { i: I.IRON_INGOT, P: PLANKS }, B2.SMITHING_TABLE);
  S(['ss', 'PP'], { s: I.STRING, P: PLANKS }, B2.LOOM);
  S([' i ', 'SSS'], { i: I.IRON_INGOT, S: B.STONE }, B2.STONECUTTER);
  S(['StS', 'P P'], { S: STICK, t: B.STONE_SLAB, P: PLANKS }, B2.GRINDSTONE);
  S(['S S', 'S S', 'SSS'], { S: ITEM_TAGS.wooden_slabs }, B2.COMPOSTER);
  S(['SSS', ' B ', ' S '], { S: ITEM_TAGS.wooden_slabs, B: B.BOOKSHELF }, B2.LECTERN);
  S(['I I', 'I I', 'III'], { I: I.IRON_INGOT }, B2.CAULDRON);
  S(['B B', ' B '], { B: I.BRICK }, B2.FLOWER_POT);
  S(['GGG', 'QQQ', 'SSS'], { G: B.GLASS, Q: I.QUARTZ, S: ITEM_TAGS.wooden_slabs }, B2.DAYLIGHT_DETECTOR);
  S(['I', 'S', 'P'], { I: I.IRON_INGOT, S: STICK, P: PLANKS }, B2.TRIPWIRE_HOOK, 2);
  S(['PPP', 'PRP', 'PPP'], { P: PLANKS, R: I.REDSTONE }, B2.NOTE_BLOCK);
  S(['PPP', 'PDP', 'PPP'], { P: PLANKS, D: I.DIAMOND }, B2.JUKEBOX);
  L([B.CHEST, B2.TRIPWIRE_HOOK], B2.TRAPPED_CHEST);
  S(['##', '##', '##'], { '#': I.IRON_INGOT }, B2.IRON_DOOR, 3);
  S(['##', '##'], { '#': I.IRON_INGOT }, B2.IRON_TRAPDOOR);
  S(['##'], { '#': I.GOLD_INGOT }, B2.LIGHT_WEIGHTED_PRESSURE_PLATE);
  S(['##'], { '#': I.IRON_INGOT }, B2.HEAVY_WEIGHTED_PRESSURE_PLATE);
  S(['##', '##'], { '#': I7.HONEY_BOTTLE }, B2.HONEY_BLOCK);
  L([B2.HONEY_BLOCK, I3.GLASS_BOTTLE, I3.GLASS_BOTTLE, I3.GLASS_BOTTLE, I3.GLASS_BOTTLE], I7.HONEY_BOTTLE, 4);
  S(['##', '##'], { '#': I7.HONEYCOMB }, B2.HONEYCOMB_BLOCK);
  S(['PPP', 'HHH', 'PPP'], { P: PLANKS, H: I7.HONEYCOMB }, B2.BEEHIVE);
  L([I7.HONEY_BOTTLE], I.SUGAR, 3);
  L([B.PUMPKIN], B2.CARVED_PUMPKIN);
  S(['A', 'B'], { A: B2.CARVED_PUMPKIN, B: B.TORCH }, B.JACK_O_LANTERN);
  // items
  S(['SSS', 'SLS', 'SSS'], { S: STICK, L: I.LEATHER }, I7.ITEM_FRAME);
  S(['SSS', 'SWS', 'SSS'], { S: STICK, W: ITEM_TAGS.wool }, I7.PAINTING);
  S(['SSS', ' S ', 'SsS'], { S: STICK, s: B.STONE_SLAB }, I7.ARMOR_STAND);
  S(['SS ', 'SB ', '  S'], { S: I.STRING, B: I2.SLIME_BALL }, I7.LEAD, 2);
  S(['L L', 'LLL', 'L L'], { L: I.LEATHER }, I7.LEATHER_HORSE_ARMOR);
  S(['PIP', 'PPP', ' P '], { P: PLANKS, I: I.IRON_INGOT }, I7.SHIELD);
  S(['SIS', 'sTs', ' S '], { S: STICK, I: I.IRON_INGOT, s: I.STRING, T: B2.TRIPWIRE_HOOK }, I7.CROSSBOW);
  S([' G ', 'GAG', ' G '], { G: I.GLOWSTONE_DUST, A: I.ARROW }, I7.SPECTRAL_ARROW, 2);
  for (const [key, arrow] of Object.entries(TIPPED_ARROWS)) S(['AAA', 'APA', 'AAA'], { A: I.ARROW, P: LINGERING_ITEMS[key] }, arrow, 8);
  L([I.BOOK, I2.INK_SAC, I.FEATHER], I7.WRITABLE_BOOK);
  S(['PPP', 'PCP', 'PPP'], { P: I.PAPER, C: I.COMPASS }, I7.MAP);
  L([I5.MINECART, B.CHEST], I7.CHEST_MINECART); L([I5.MINECART, B.FURNACE], I7.FURNACE_MINECART);
  L([I5.MINECART, B.HOPPER], I7.HOPPER_MINECART); L([I5.MINECART, B.TNT], I7.TNT_MINECART);
  L([I.GUNPOWDER, I2.BLAZE_POWDER, [I.COAL, I.CHARCOAL]], I.FIRE_CHARGE, 3);
  // food
  S(['MMM', 'SES', 'WWW'], { M: I.MILK_BUCKET, S: I.SUGAR, E: I.EGG, W: I.WHEAT }, I7.CAKE);
  L([B.PUMPKIN, I.SUGAR, I.EGG], I7.PUMPKIN_PIE);
  L([I7.BEETROOT, I7.BEETROOT, I7.BEETROOT, I7.BEETROOT, I7.BEETROOT, I7.BEETROOT, I.BOWL], I7.BEETROOT_SOUP);
  L([I7.COOKED_RABBIT, I3.CARROT, I3.BAKED_POTATO, [B.BROWN_MUSHROOM, B.RED_MUSHROOM], I.BOWL], I7.RABBIT_STEW);
  L([B.BROWN_MUSHROOM, B.RED_MUSHROOM, I.BOWL, ITEM_TAGS.small_flowers], I7.SUSPICIOUS_STEW);
  L([I.MELON_SLICE], I7.MELON_SEEDS);
  void I6; void SHAPE; void Shape; void BLOCKS; void BLOCK_COUNT; void id; void ({} as ItemStack);
}
