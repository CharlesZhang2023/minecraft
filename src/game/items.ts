// Item registry. Block items share ids with their blocks (< 1000); other items start at 1000.
import { BLOCKS, B, blockByName, Render } from '../world/blocks';

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export interface ItemDef {
  id: number;
  name: string;
  display: string;
  maxStack: number;
  block?: number; // placed block id
  tool?: { type: ToolType; level: number; speed: number; damage: number };
  durability?: number;
  food?: { hunger: number; saturation: number; stew?: boolean };
  armor?: { slot: 0 | 1 | 2 | 3; points: number }; // 0 helmet .. 3 boots
  attack?: number;
  fuel?: number; // burn ticks in a furnace
  sprite?: string; // item sprite name (else rendered from the block)
  flatBlock?: boolean; // block item rendered as flat sprite (flowers, torches...)
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic';
}

export const ITEMS = new Map<number, ItemDef>();
const byName = new Map<string, ItemDef>();

// block items
for (const b of BLOCKS) {
  if (!b.item || b.id === 0) continue;
  const flat = b.render === Render.Cross || b.render === Render.Torch || b.id === B.LADDER || b.id === B.LILY_PAD || b.id === B.GLASS_PANE;
  const d: ItemDef = { id: b.id, name: b.name, display: b.display, maxStack: 64, block: b.id, flatBlock: flat };
  if (b.flammable && b.sound === 'wood') d.fuel = 300;
  if (b.name.endsWith('_sapling')) d.fuel = 100;
  if (b.id === B.COAL_BLOCK) d.fuel = 16000;
  ITEMS.set(b.id, d);
  byName.set(b.name, d);
}

let next = 1000;
function item(name: string, display: string, o: Partial<ItemDef> = {}): number {
  const id = next++;
  const d: ItemDef = { id, name, display, maxStack: 64, sprite: name, ...o };
  ITEMS.set(id, d);
  byName.set(name, d);
  return id;
}

export const I = {
  STICK: item('stick', 'Stick', { fuel: 100 }),
  COAL: item('coal', 'Coal', { fuel: 1600 }),
  CHARCOAL: item('charcoal', 'Charcoal', { fuel: 1600 }),
  IRON_INGOT: item('iron_ingot', 'Iron Ingot'),
  GOLD_INGOT: item('gold_ingot', 'Gold Ingot'),
  DIAMOND: item('diamond', 'Diamond'),
  EMERALD: item('emerald', 'Emerald'),
  REDSTONE: item('redstone', 'Redstone Dust'),
  LAPIS: item('lapis_lazuli', 'Lapis Lazuli'),
  FLINT: item('flint', 'Flint'),
  APPLE: item('apple', 'Apple', { food: { hunger: 4, saturation: 2.4 } }),
  GOLDEN_APPLE: item('golden_apple', 'Golden Apple', { food: { hunger: 4, saturation: 9.6 }, rarity: 'rare' }),
  BREAD: item('bread', 'Bread', { food: { hunger: 5, saturation: 6 } }),
  WHEAT: item('wheat', 'Wheat'),
  WHEAT_SEEDS: item('wheat_seeds', 'Wheat Seeds', { block: B.WHEAT }),
  MELON_SLICE: item('melon_slice', 'Melon Slice', { food: { hunger: 2, saturation: 1.2 } }),
  PORKCHOP: item('porkchop', 'Raw Porkchop', { food: { hunger: 3, saturation: 1.8 } }),
  COOKED_PORKCHOP: item('cooked_porkchop', 'Cooked Porkchop', { food: { hunger: 8, saturation: 12.8 } }),
  BEEF: item('beef', 'Raw Beef', { food: { hunger: 3, saturation: 1.8 } }),
  COOKED_BEEF: item('cooked_beef', 'Steak', { food: { hunger: 8, saturation: 12.8 } }),
  CHICKEN: item('chicken', 'Raw Chicken', { food: { hunger: 2, saturation: 1.2 } }),
  COOKED_CHICKEN: item('cooked_chicken', 'Cooked Chicken', { food: { hunger: 6, saturation: 7.2 } }),
  MUTTON: item('mutton', 'Raw Mutton', { food: { hunger: 2, saturation: 1.2 } }),
  COOKED_MUTTON: item('cooked_mutton', 'Cooked Mutton', { food: { hunger: 6, saturation: 9.6 } }),
  ROTTEN_FLESH: item('rotten_flesh', 'Rotten Flesh', { food: { hunger: 4, saturation: 0.8 } }),
  BONE: item('bone', 'Bone'),
  BONE_MEAL: item('bone_meal', 'Bone Meal'),
  ARROW: item('arrow', 'Arrow'),
  BOW: item('bow', 'Bow', { maxStack: 1, durability: 384, fuel: 300 }),
  STRING: item('string', 'String'),
  FEATHER: item('feather', 'Feather'),
  GUNPOWDER: item('gunpowder', 'Gunpowder'),
  LEATHER: item('leather', 'Leather'),
  EGG: item('egg', 'Egg', { maxStack: 16 }),
  BUCKET: item('bucket', 'Bucket', { maxStack: 16 }),
  WATER_BUCKET: item('water_bucket', 'Water Bucket', { maxStack: 1 }),
  LAVA_BUCKET: item('lava_bucket', 'Lava Bucket', { maxStack: 1, fuel: 20000 }),
  MILK_BUCKET: item('milk_bucket', 'Milk Bucket', { maxStack: 1 }),
  FLINT_AND_STEEL: item('flint_and_steel', 'Flint and Steel', { maxStack: 1, durability: 64 }),
  BOWL: item('bowl', 'Bowl', { fuel: 100 }),
  MUSHROOM_STEW: item('mushroom_stew', 'Mushroom Stew', { maxStack: 1, food: { hunger: 6, saturation: 7.2, stew: true } }),
  SUGAR_CANE: item('sugar_cane', 'Sugar Cane', { block: B.SUGAR_CANE }),
  SUGAR: item('sugar', 'Sugar'),
  PAPER: item('paper', 'Paper'),
  BOOK: item('book', 'Book'),
  BRICK: item('brick', 'Brick'),
  CLAY_BALL: item('clay_ball', 'Clay Ball'),
  SNOWBALL: item('snowball', 'Snowball', { maxStack: 16 }),
  GLOWSTONE_DUST: item('glowstone_dust', 'Glowstone Dust'),
  SHEARS: item('shears', 'Shears', { maxStack: 1, durability: 238, tool: { type: 'shears', level: 0, speed: 5, damage: 1 } }),
  OAK_DOOR: item('oak_door', 'Oak Door', { block: B.OAK_DOOR, fuel: 200 }),
  RED_BED: item('red_bed', 'Red Bed', { block: B.BED, maxStack: 1 }),
  PUMPKIN_SEEDS: item('pumpkin_seeds', 'Pumpkin Seeds', { block: B.PUMPKIN_STEM }),
  COOKIE: item('cookie', 'Cookie', { food: { hunger: 2, saturation: 0.4 } }),
  COCOA: item('cocoa_beans', 'Cocoa Beans'),
  SPIDER_EYE: item('spider_eye', 'Spider Eye', { food: { hunger: 2, saturation: 3.2 } }),
  COMPASS: item('compass', 'Compass', { maxStack: 1 }),
  CLOCK: item('clock', 'Clock', { maxStack: 1 }),
  ENDER_PEARL: item('ender_pearl', 'Ender Pearl', { maxStack: 16 }),
  QUARTZ: item('quartz', 'Nether Quartz'),
  GOLD_NUGGET: item('gold_nugget', 'Gold Nugget'),
  FIRE_CHARGE: item('fire_charge', 'Fire Charge'),
  GHAST_TEAR: item('ghast_tear', 'Ghast Tear'),
};

export const MATERIALS = [
  { name: 'wooden', display: 'Wooden', level: 0, speed: 2, durability: 59, dmg: 0, mat: 'oak_planks' },
  { name: 'stone', display: 'Stone', level: 1, speed: 4, durability: 131, dmg: 1, mat: 'cobblestone' },
  { name: 'iron', display: 'Iron', level: 2, speed: 6, durability: 250, dmg: 2, mat: 'iron_ingot' },
  { name: 'golden', display: 'Golden', level: 0, speed: 12, durability: 32, dmg: 0, mat: 'gold_ingot' },
  { name: 'diamond', display: 'Diamond', level: 3, speed: 8, durability: 1561, dmg: 3, mat: 'diamond' },
] as const;
const TOOL_KINDS: { type: ToolType; display: string; base: number }[] = [
  { type: 'sword', display: 'Sword', base: 4 },
  { type: 'shovel', display: 'Shovel', base: 1.5 },
  { type: 'pickaxe', display: 'Pickaxe', base: 2 },
  { type: 'axe', display: 'Axe', base: 3 },
  { type: 'hoe', display: 'Hoe', base: 1 },
];
export const TOOLS: Record<string, number> = {};
for (const m of MATERIALS)
  for (const k of TOOL_KINDS) {
    const name = `${m.name}_${k.type}`;
    TOOLS[name] = item(name, `${m.display} ${k.display}`, {
      maxStack: 1,
      durability: m.durability,
      tool: { type: k.type, level: m.level, speed: m.speed, damage: k.base + m.dmg + (k.type === 'axe' ? 0 : 0) },
      attack: k.type === 'sword' ? 4 + m.dmg : k.type === 'axe' ? 3 + m.dmg : k.type === 'pickaxe' ? 2 + m.dmg : k.type === 'shovel' ? 1 + m.dmg : 1,
      fuel: m.name === 'wooden' ? 200 : undefined,
      rarity: 'common',
    });
  }

const ARMOR_MATS = [
  { name: 'leather', display: 'Leather', pts: [1, 3, 2, 1], dur: 5 },
  { name: 'iron', display: 'Iron', pts: [2, 6, 5, 2], dur: 15 },
  { name: 'golden', display: 'Golden', pts: [2, 5, 3, 1], dur: 7 },
  { name: 'diamond', display: 'Diamond', pts: [3, 8, 6, 3], dur: 33 },
];
const ARMOR_SLOTS = [
  { name: 'helmet', display: 'Helmet', mul: 11 },
  { name: 'chestplate', display: 'Chestplate', mul: 16 },
  { name: 'leggings', display: 'Leggings', mul: 15 },
  { name: 'boots', display: 'Boots', mul: 13 },
];
export const ARMOR: Record<string, number> = {};
for (const m of ARMOR_MATS)
  ARMOR_SLOTS.forEach((s, i) => {
    const name = `${m.name}_${s.name}`;
    ARMOR[name] = item(name, `${m.display} ${s.display}`, { maxStack: 1, durability: s.mul * m.dur, armor: { slot: i as 0 | 1 | 2 | 3, points: m.pts[i] } });
  });

// Items added after the original set are registered here so earlier ids stay stable.
export const I2 = {
  BOAT: item('oak_boat', 'Oak Boat', { maxStack: 1, fuel: 400 }),
  SLIME_BALL: item('slime_ball', 'Slimeball'),
  ENDER_EYE: item('ender_eye', 'Eye of Ender'),
  BLAZE_POWDER: item('blaze_powder', 'Blaze Powder'),
  INK_SAC: item('ink_sac', 'Ink Sac'),
};

export function itemByName(name: string): ItemDef | undefined {
  return byName.get(name);
}
export function itemId(name: string): number {
  const d = byName.get(name);
  if (!d) throw new Error('unknown item ' + name);
  return d.id;
}
export function getItem(id: number): ItemDef {
  return ITEMS.get(id) ?? ITEMS.get(B.STONE)!;
}

export interface ItemStack {
  id: number;
  count: number;
  damage?: number; // durability used
}
export const stack = (id: number, count = 1, damage = 0): ItemStack => ({ id, count, damage });
export const cloneStack = (s: ItemStack | null): ItemStack | null => (s ? { id: s.id, count: s.count, damage: s.damage ?? 0 } : null);
export const sameItem = (a: ItemStack | null, b: ItemStack | null) => !!a && !!b && a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0);
export const maxStack = (s: ItemStack) => getItem(s.id).maxStack;

// ------------------------------------------------------------------ block drops
import { Random } from '../noise';
import { isLeaves } from '../world/blocks';

export function blockDrops(blockId: number, meta: number, tool: ItemDef | undefined, rng: Random, silk = false): ItemStack[] {
  const def = BLOCKS[blockId];
  // must use the right tool for blocks that require one
  if (def.harvestLevel >= 0) {
    if (!tool?.tool || tool.tool.type !== def.tool || tool.tool.level < def.harvestLevel) return [];
  }
  void silk;
  const shears = tool?.tool?.type === 'shears';
  switch (blockId) {
    case B.OAK_LEAVES: case B.SPRUCE_LEAVES: case B.BIRCH_LEAVES: {
      if (shears) return [stack(blockId)];
      const out: ItemStack[] = [];
      const sap = blockId === B.OAK_LEAVES ? B.OAK_SAPLING : blockId === B.SPRUCE_LEAVES ? B.SPRUCE_SAPLING : B.BIRCH_SAPLING;
      if (rng.int(20) === 0) out.push(stack(sap));
      if (blockId === B.OAK_LEAVES && rng.int(200) === 0) out.push(stack(I.APPLE));
      if (rng.int(50) === 0) out.push(stack(I.STICK, 1 + rng.int(2)));
      return out;
    }
    case B.TALL_GRASS: case B.FERN:
      if (shears) return [stack(blockId)];
      return rng.int(8) === 0 ? [stack(I.WHEAT_SEEDS)] : [];
    case B.GRAVEL: return rng.int(10) === 0 ? [stack(I.FLINT)] : [stack(B.GRAVEL)];
    case B.WHEAT: {
      if (meta >= 7) return [stack(I.WHEAT), stack(I.WHEAT_SEEDS, 1 + rng.int(3))];
      return [stack(I.WHEAT_SEEDS)];
    }
    case B.REDSTONE_ORE: return [stack(I.REDSTONE, 4 + rng.int(2))];
    case B.LAPIS_ORE: return [stack(I.LAPIS, 4 + rng.int(5))];
    case B.GLOWSTONE: return [stack(I.GLOWSTONE_DUST, 2 + rng.int(3))];
    case B.CLAY: return [stack(I.CLAY_BALL, 4)];
    case B.SNOW: return [stack(I.SNOWBALL)];
    case B.SNOW_BLOCK: return [stack(I.SNOWBALL, 4)];
    case B.MELON: return [stack(I.MELON_SLICE, 3 + rng.int(5))];
    case B.BOOKSHELF: return [stack(I.BOOK, 3)];
    case B.DEAD_BUSH: return shears ? [stack(B.DEAD_BUSH)] : rng.int(2) ? [stack(I.STICK, 1 + rng.int(2))] : [];
    case B.COBWEB: return shears ? [stack(B.COBWEB)] : [stack(I.STRING)];
    case B.OAK_DOOR: return [stack(I.OAK_DOOR)];
    case B.BED: return [stack(I.RED_BED)];
    case B.SUGAR_CANE: return [stack(I.SUGAR_CANE)];
    case B.PUMPKIN_STEM: return [stack(I.PUMPKIN_SEEDS)];
    case B.DOUBLE_STONE_SLAB: return [stack(B.STONE_SLAB, 2)];
  }
  if (isLeaves(blockId)) return [];
  if (def.drop === null) return [];
  if (def.drop) {
    const d = byName.get(def.drop);
    return d ? [stack(d.id)] : [];
  }
  if (!def.item) return [];
  return [stack(blockId)];
}

export function blockItemFor(name: string): number {
  const b = blockByName(name);
  return b ? b.id : 0;
}
