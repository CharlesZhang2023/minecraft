// Item registry. Block items share ids with their blocks (< 1000); other items start at 1000.
import { BLOCKS, B, blockByName, Render } from '../world/blocks';
import { POTIONS } from './potiondata';

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
  potion?: string; // potion type key (potiondata.ts)
  splash?: boolean;
  egg?: string; // spawn egg mob type
  drink?: boolean; // consumed by drinking (potions, milk)
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
  REDSTONE: item('redstone', 'Redstone Dust', { block: B.REDSTONE_WIRE }),
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
  FISHING_ROD: item('fishing_rod', 'Fishing Rod', { maxStack: 1, durability: 64, fuel: 300 }),
  COD: item('cod', 'Raw Cod', { food: { hunger: 2, saturation: 0.4 } }),
  COOKED_COD: item('cooked_cod', 'Cooked Cod', { food: { hunger: 5, saturation: 6 } }),
  SALMON: item('salmon', 'Raw Salmon', { food: { hunger: 2, saturation: 0.4 } }),
  COOKED_SALMON: item('cooked_salmon', 'Cooked Salmon', { food: { hunger: 6, saturation: 9.6 } }),
};

// Spawn eggs (vanilla egg colours).
export const SPAWN_EGGS: { mob: string; display: string; c1: number; c2: number }[] = [
  { mob: 'creeper', display: 'Creeper', c1: 0x0da70b, c2: 0x000000 },
  { mob: 'skeleton', display: 'Skeleton', c1: 0xc1c1c1, c2: 0x494949 },
  { mob: 'spider', display: 'Spider', c1: 0x342d27, c2: 0xa80e0e },
  { mob: 'zombie', display: 'Zombie', c1: 0x00afaf, c2: 0x799c65 },
  { mob: 'slime', display: 'Slime', c1: 0x51a03e, c2: 0x7ebf6e },
  { mob: 'ghast', display: 'Ghast', c1: 0xf9f9f9, c2: 0xbcbcbc },
  { mob: 'zombie_pigman', display: 'Zombie Pigman', c1: 0xea9393, c2: 0x4c7129 },
  { mob: 'enderman', display: 'Enderman', c1: 0x161616, c2: 0x000000 },
  { mob: 'blaze', display: 'Blaze', c1: 0xf6b201, c2: 0xfff87e },
  { mob: 'bat', display: 'Bat', c1: 0x4c3e30, c2: 0x0f0f0f },
  { mob: 'pig', display: 'Pig', c1: 0xf0a5a2, c2: 0xdb635f },
  { mob: 'sheep', display: 'Sheep', c1: 0xe7e7e7, c2: 0xffb5b5 },
  { mob: 'cow', display: 'Cow', c1: 0x443626, c2: 0xa1a1a1 },
  { mob: 'chicken', display: 'Chicken', c1: 0xa1a1a1, c2: 0xff0000 },
  { mob: 'squid', display: 'Squid', c1: 0x223b4d, c2: 0x708899 },
  { mob: 'wolf', display: 'Wolf', c1: 0xd7d3d3, c2: 0xceaf96 },
  { mob: 'villager', display: 'Villager', c1: 0x563c33, c2: 0xbd8b72 },
];

// Redstone devices, brewing, enchanted books, spawn eggs and potions (appended after I2).
export const I3 = {
  ENCHANTED_BOOK: item('enchanted_book', 'Enchanted Book', { maxStack: 1, rarity: 'uncommon' }),
  REPEATER: item('repeater', 'Redstone Repeater', { block: B.REPEATER }),
  COMPARATOR: item('comparator', 'Redstone Comparator', { block: B.COMPARATOR }),
  BREWING_STAND: item('brewing_stand', 'Brewing Stand', { block: B.BREWING_STAND }),
  NETHER_WART: item('nether_wart', 'Nether Wart', { block: B.NETHER_WART }),
  GLASS_BOTTLE: item('glass_bottle', 'Glass Bottle'),
  BLAZE_ROD: item('blaze_rod', 'Blaze Rod', { fuel: 2400 }),
  FERMENTED_SPIDER_EYE: item('fermented_spider_eye', 'Fermented Spider Eye'),
  GLISTERING_MELON: item('glistering_melon_slice', 'Glistering Melon'),
  MAGMA_CREAM: item('magma_cream', 'Magma Cream'),
  CARROT: item('carrot', 'Carrot', { block: B.CARROTS, food: { hunger: 3, saturation: 3.6 } }),
  GOLDEN_CARROT: item('golden_carrot', 'Golden Carrot', { food: { hunger: 6, saturation: 14.4 } }),
  POTATO: item('potato', 'Potato', { block: B.POTATOES, food: { hunger: 1, saturation: 0.6 } }),
  BAKED_POTATO: item('baked_potato', 'Baked Potato', { food: { hunger: 5, saturation: 6 } }),
  PUFFERFISH: item('pufferfish', 'Pufferfish', { food: { hunger: 1, saturation: 0.2 } }),
  CLOWNFISH: item('tropical_fish', 'Clownfish', { food: { hunger: 1, saturation: 0.2 } }),
  NAME_TAG: item('name_tag', 'Name Tag'),
  NETHER_BRICK: item('nether_brick', 'Nether Brick'),
};
export const EGG_ITEMS: Record<string, number> = {};
for (const e of SPAWN_EGGS) EGG_ITEMS[e.mob] = item(`${e.mob}_spawn_egg`, `Spawn ${e.display}`, { egg: e.mob });
export const POTION_ITEMS: Record<string, number> = {};
export const SPLASH_ITEMS: Record<string, number> = {};
for (const p of POTIONS) POTION_ITEMS[p.key] = item(`potion_${p.key}`, p.name, { maxStack: 1, potion: p.key, drink: true, sprite: `potion_${p.sprite}` });
for (const p of POTIONS) SPLASH_ITEMS[p.key] = item(`splash_potion_${p.key}`, p.key === 'water' ? 'Splash Water Bottle' : 'Splash ' + p.name, { maxStack: 1, potion: p.key, splash: true, sprite: `splash_potion_${p.sprite}` });
getItem(I.MILK_BUCKET).drink = true;

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
  ench?: Record<string, number>;
  name?: string; // custom name from an anvil
  repair?: number; // anvil prior-work penalty
}
export const stack = (id: number, count = 1, damage = 0): ItemStack => ({ id, count, damage });
export const cloneStack = (s: ItemStack | null): ItemStack | null => (s ? { ...s, damage: s.damage ?? 0, ...(s.ench ? { ench: { ...s.ench } } : {}) } : null);
export const sameItem = (a: ItemStack | null, b: ItemStack | null) => !!a && !!b && a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && JSON.stringify(a.ench ?? null) === JSON.stringify(b.ench ?? null) && (a.name ?? '') === (b.name ?? '') && (a.repair ?? 0) === (b.repair ?? 0);
/** Display name (custom anvil name if set). */
export const stackName = (s: ItemStack) => s.name ?? getItem(s.id).display;
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
  if (silk && def.item && blockId !== B.SPAWNER && !def.needsSupport) return [stack(blockId)];
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
    case B.CARROTS: return [stack(I3.CARROT, meta >= 7 ? 1 + rng.int(4) : 1)];
    case B.POTATOES: return meta >= 7 ? [stack(I3.POTATO, 1 + rng.int(4))] : [stack(I3.POTATO)];
    case B.NETHER_WART: return [stack(I3.NETHER_WART, meta >= 3 ? 2 + rng.int(3) : 1)];
    case B.GLASS: case B.GLASS_PANE: case B.ICE: return silk ? [stack(blockId)] : [];
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
