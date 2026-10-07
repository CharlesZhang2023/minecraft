// Tags: named sets of blocks and items (vanilla's #logs, #planks, #piglin_loved, #soul_fire_base_blocks...), worked
// out from the registry's families so new content joins them by itself. Recipes, mobs and game rules ask by name.
import { B, B2, BLOCKS, BLOCK_COUNT, WOOD, STONE2, SHAPE, Shape, DYE_COLORS, SHULKER_BOXES, CARPETS, BEDS, WOOL_COLORS, isLog } from '../world/blocks';
import { I, I2, I3, I5, I7, TOOLS, ARMOR, BOATS, DISCS, ITEMS, I11 } from './items';

const woods = Object.values(WOOD);
const shaped = (s: Shape, f: (id: number) => boolean = () => true) => {
  const out: number[] = [];
  for (let id = 0; id < BLOCK_COUNT; id++) if (SHAPE[id] === s && f(id)) out.push(id);
  return out;
};
const wooden = (id: number) => BLOCKS[id].material === 'wood' || BLOCKS[id].material === 'nether_wood';

/** Block tags. */
export const BLOCK_TAGS: Record<string, number[]> = {
  planks: woods.map((w) => w.planks),
  logs: woods.flatMap((w) => [w.log, w.strippedLog, w.wood, w.strippedWood]),
  logs_that_burn: woods.filter((w) => !w.nether).flatMap((w) => [w.log, w.strippedLog, w.wood, w.strippedWood]),
  crimson_stems: [WOOD.crimson.log, WOOD.crimson.strippedLog, WOOD.crimson.wood, WOOD.crimson.strippedWood],
  warped_stems: [WOOD.warped.log, WOOD.warped.strippedLog, WOOD.warped.wood, WOOD.warped.strippedWood],
  leaves: shaped(Shape.Leaves),
  saplings: woods.filter((w) => !w.nether).map((w) => w.sapling),
  wooden_stairs: woods.map((w) => w.stairs), wooden_slabs: woods.map((w) => w.slab), wooden_fences: woods.map((w) => w.fence),
  fence_gates: woods.map((w) => w.gate), wooden_doors: woods.map((w) => w.door), wooden_trapdoors: woods.map((w) => w.trapdoor),
  wooden_buttons: woods.map((w) => w.button), wooden_pressure_plates: woods.map((w) => w.plate),
  signs: woods.flatMap((w) => [w.sign, w.wallSign]), standing_signs: woods.map((w) => w.sign), wall_signs: woods.map((w) => w.wallSign),
  stairs: shaped(Shape.Stairs), slabs: shaped(Shape.Slab), walls: shaped(Shape.Wall), fences: shaped(Shape.Fence), doors: shaped(Shape.Door),
  trapdoors: shaped(Shape.Trapdoor), buttons: shaped(Shape.Button), pressure_plates: shaped(Shape.Plate),
  stone_pressure_plates: shaped(Shape.Plate, (id) => !wooden(id) && BLOCKS[id].material === 'stone'),
  wool: [...WOOL_COLORS], carpets: [...CARPETS], beds: [...BEDS], shulker_boxes: [...SHULKER_BOXES, B2.SHULKER_BOX],
  small_flowers: shaped(Shape.Flower), tall_flowers: [B2.SUNFLOWER, B2.LILAC, B2.ROSE_BUSH, B2.PEONY],
  flowers: [...shaped(Shape.Flower), B2.SUNFLOWER, B2.LILAC, B2.ROSE_BUSH, B2.PEONY],
  sand: [B.SAND, STONE2.RED_SAND],
  ice: [B.ICE, B2.PACKED_ICE, B2.BLUE_ICE, B2.FROSTED_ICE],
  climbable: [B.LADDER, B2.VINE, B2.SCAFFOLDING, B2.WEEPING_VINES, B2.WEEPING_VINES_PLANT, B2.TWISTING_VINES, B2.TWISTING_VINES_PLANT],
  nylium: [B2.CRIMSON_NYLIUM, B2.WARPED_NYLIUM],
  wart_blocks: [WOOD.crimson.leaves, WOOD.warped.leaves],
  soul_fire_base_blocks: [B.SOUL_SAND, B2.SOUL_SOIL],
  soul_speed_blocks: [B.SOUL_SAND, B2.SOUL_SOIL],
  infiniburn_overworld: [B.NETHERRACK, B.MAGMA_BLOCK],
  infiniburn_end: [B.NETHERRACK, B.MAGMA_BLOCK, B.BEDROCK],
  base_stone_overworld: [B.STONE, B.GRANITE, B.DIORITE, B.ANDESITE],
  base_stone_nether: [B.NETHERRACK, STONE2.BASALT, STONE2.BLACKSTONE],
  beacon_base_blocks: [B.IRON_BLOCK, B.GOLD_BLOCK, B.DIAMOND_BLOCK, B2.EMERALD_BLOCK, B2.NETHERITE_BLOCK],
  /** Piglins get angry when these are opened or broken near them. */
  guarded_by_piglins: [B.CHEST, B2.TRAPPED_CHEST, B2.BARREL, B.ENDER_CHEST, B.GOLD_BLOCK, STONE2.GILDED_BLACKSTONE, B2.NETHER_GOLD_ORE, B.GOLD_ORE, ...SHULKER_BOXES, B2.SHULKER_BOX],
  piglin_repellents: [B2.SOUL_FIRE, B2.SOUL_TORCH, B2.SOUL_LANTERN, B2.SOUL_CAMPFIRE],
  hoglin_repellents: [WOOD.warped.sapling, B2.RESPAWN_ANCHOR, B.NETHER_PORTAL],
  strider_warm_blocks: [B.LAVA],
  campfires: [B2.CAMPFIRE, B2.SOUL_CAMPFIRE],
  fire: [B.FIRE, B2.SOUL_FIRE],
  coral_blocks: BLOCKS.filter((b) => /^(tube|brain|bubble|fire|horn)_coral_block$/.test(b.name)).map((b) => b.id),
  enderman_holdable: [B.GRASS, B.DIRT, B.COARSE_DIRT, B.PODZOL, B.SAND, STONE2.RED_SAND, B.GRAVEL, B.BROWN_MUSHROOM, B.RED_MUSHROOM, B.TNT, B.CACTUS, B.CLAY, B.PUMPKIN, B2.CARVED_PUMPKIN, B.MELON, B2.MYCELIUM, B2.CRIMSON_NYLIUM, B2.WARPED_NYLIUM, B2.CRIMSON_ROOTS, B2.WARPED_ROOTS, WOOD.crimson.sapling, WOOD.warped.sapling, ...shaped(Shape.Flower)],
  bee_growables: [B.WHEAT, B.CARROTS, B.POTATOES, B2.BEETROOTS, B.PUMPKIN_STEM, B2.MELON_STEM, B2.SWEET_BERRY_BUSH],
  beehives: [B2.BEE_NEST, B2.BEEHIVE],
  logs_wood_only: BLOCKS.slice(0, BLOCK_COUNT).filter((b) => isLog(b.id)).map((b) => b.id),
};
void DYE_COLORS;

const goldTools = ['golden_sword', 'golden_shovel', 'golden_pickaxe', 'golden_axe', 'golden_hoe'].map((n) => TOOLS[n]);
const goldArmor = ['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots'].map((n) => ARMOR[n]);

/** Item tags (block items share their block's id). */
export const ITEM_TAGS: Record<string, number[]> = {
  ...BLOCK_TAGS,
  coals: [I.COAL, I.CHARCOAL],
  arrows: [I.ARROW, I7.SPECTRAL_ARROW, ...[...ITEMS.values()].filter((d) => d.name.startsWith('tipped_arrow')).map((d) => d.id)],
  boats: Object.values(BOATS),
  music_discs: DISCS,
  fishes: [I2.COD, I2.COOKED_COD, I2.SALMON, I2.COOKED_SALMON, I3.PUFFERFISH, I3.CLOWNFISH],
  /** Cobblestone stand-ins in crafting (furnaces, brewing stands, stone tools). */
  stone_crafting_materials: [B.COBBLESTONE, STONE2.BLACKSTONE],
  stone_tool_materials: [B.COBBLESTONE, STONE2.BLACKSTONE],
  /** What piglins admire and pick up. */
  piglin_loved: [I.GOLD_INGOT, I.GOLD_NUGGET, B.GOLD_BLOCK, B.GOLD_ORE, B2.NETHER_GOLD_ORE, STONE2.GILDED_BLACKSTONE, I.GOLDEN_APPLE, I7.ENCHANTED_GOLDEN_APPLE, I3.GOLDEN_CARROT, I3.GLISTERING_MELON, B2.LIGHT_WEIGHTED_PRESSURE_PLATE, I.CLOCK, I5.GOLDEN_HORSE_ARMOR, ...goldTools, ...goldArmor, B2.BELL],
  piglin_food: [I.PORKCHOP, I.COOKED_PORKCHOP],
  piglin_repellents: BLOCK_TAGS.piglin_repellents,
  /** Gold armour piglins respect. */
  piglin_safe_armor: goldArmor,
  creeper_drop_music_discs: DISCS.filter((_, i) => i < 12),
  lectern_books: [I7.WRITABLE_BOOK, I11.WRITTEN_BOOK],
  soul_fire_base_blocks: BLOCK_TAGS.soul_fire_base_blocks,
};

const blockSets = new Map<string, Set<number>>(), itemSets = new Map<string, Set<number>>();
/** Is the block in the tag ('#minecraft:' and '#' prefixes allowed)? */
export function blockIs(tag: string, id: number): boolean {
  const k = tag.replace(/^#?(minecraft:)?/, '');
  let s = blockSets.get(k);
  if (!s) { s = new Set(BLOCK_TAGS[k] ?? []); blockSets.set(k, s); }
  return s.has(id);
}
/** Is the item in the tag? */
export function itemIs(tag: string, id: number): boolean {
  const k = tag.replace(/^#?(minecraft:)?/, '');
  let s = itemSets.get(k);
  if (!s) { s = new Set(ITEM_TAGS[k] ?? []); itemSets.set(k, s); }
  return s.has(id);
}
