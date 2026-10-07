// Item registry. Block items share ids with their blocks (< 1000); other items start at 1000.
import { BLOCKS, B, B2, blockByName, Render, DYE_COLORS, WOOD, BEDS, SHULKER_BOXES, STONE2 } from '../world/blocks';
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
  armor?: { slot: 0 | 1 | 2 | 3; points: number; toughness?: number; knockback?: number }; // 0 helmet .. 3 boots
  attack?: number;
  fuel?: number; // burn ticks in a furnace
  sprite?: string; // item sprite name (else rendered from the block)
  flatBlock?: boolean; // block item rendered as flat sprite (flowers, torches...)
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic';
  potion?: string; // potion type key (potiondata.ts)
  splash?: boolean;
  egg?: string; // spawn egg mob type
  drink?: boolean; // consumed by drinking (potions, milk)
  /** Survives fire and lava as a dropped item (netherite). */
  fireproof?: boolean;
  /** A lingering potion (leaves a cloud). */
  lingering?: boolean;
  /** A music disc: the tune's name. */
  disc?: string;
  /** Mods: the namespaced key ('mod:name'), the owning mod, its hooks and creative tab. */
  key?: string;
  mod?: string;
  behavior?: import('../mod/types').ItemBehavior;
  /** Creative tab: a vanilla tab's name ('Building Blocks', 'Tools'...) or a mod tab's id; default: the mod's own tab. */
  tab?: string;
  /** A placeholder for an id whose mod isn't loaded. */
  missing?: boolean;
}

export const ITEMS = new Map<number, ItemDef>();
const byName = new Map<string, ItemDef>();

// block items
for (const b of BLOCKS) {
  if (!b.item || b.id === 0) continue;
  const flat = b.render === Render.Cross || b.render === Render.Torch || b.render === Render.Rail || b.id === B.LADDER || b.id === B.LILY_PAD || b.id === B.GLASS_PANE || b.icon !== undefined || b.name.endsWith('glass_pane') || b.name === 'iron_bars' || b.name === 'vine' || b.name.endsWith('coral_fan');
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

// The End (appended after the potions: ids must stay stable)
export const EXTRA_EGGS: { mob: string; display: string; c1: number; c2: number }[] = [
  { mob: 'silverfish', display: 'Silverfish', c1: 0x6e6e6e, c2: 0x303030 },
];
for (const e of EXTRA_EGGS) EGG_ITEMS[e.mob] = item(`${e.mob}_spawn_egg`, `Spawn ${e.display}`, { egg: e.mob });
export const I4 = {
  END_CRYSTAL: item('end_crystal', 'End Crystal', { rarity: 'rare' }),
};

// Rails and horses (appended after I4: ids must stay stable)
export const I5 = {
  MINECART: item('minecart', 'Minecart', { maxStack: 1 }),
  SADDLE: item('saddle', 'Saddle', { maxStack: 1 }),
  IRON_HORSE_ARMOR: item('iron_horse_armor', 'Iron Horse Armor', { maxStack: 1 }),
  GOLDEN_HORSE_ARMOR: item('golden_horse_armor', 'Gold Horse Armor', { maxStack: 1 }),
  DIAMOND_HORSE_ARMOR: item('diamond_horse_armor', 'Diamond Horse Armor', { maxStack: 1 }),
};
/** Protection of each horse armour (vanilla: iron 5, gold 7, diamond 11). */
export const HORSE_ARMOR: Record<number, { points: number; kind: string }> = {
  [I5.IRON_HORSE_ARMOR]: { points: 5, kind: 'iron' },
  [I5.GOLDEN_HORSE_ARMOR]: { points: 7, kind: 'gold' },
  [I5.DIAMOND_HORSE_ARMOR]: { points: 11, kind: 'diamond' },
};
export const EXTRA_EGGS2: { mob: string; display: string; c1: number; c2: number }[] = [
  { mob: 'horse', display: 'Horse', c1: 0xc09e7d, c2: 0xeee500 },
  { mob: 'donkey', display: 'Donkey', c1: 0x534539, c2: 0x867566 },
];
for (const e of EXTRA_EGGS2) EGG_ITEMS[e.mob] = item(`${e.mob}_spawn_egg`, `Spawn ${e.display}`, { egg: e.mob });

// Fireworks and elytra (appended after the horse eggs: ids must stay stable)
export const I6 = {
  FIREWORK_ROCKET: item('firework_rocket', 'Firework Rocket'),
  FIREWORK_STAR: item('firework_star', 'Firework Star'),
  // worn in the chest slot; no protection, wears down while gliding (repaired with leather, as before membranes)
  ELYTRA: item('elytra', 'Elytra', { maxStack: 1, durability: 432, armor: { slot: 1, points: 0 }, rarity: 'uncommon' }),
};
/** Firework explosion shapes, in the vanilla order. */
export const FIREWORK_SHAPES = ['Small Ball', 'Large Ball', 'Star-shaped', 'Creeper-shaped', 'Burst'];
/**
 * Colours a firework star can take, from the dyes this game has (the same stand-ins its wool uses), in the
 * vanilla dye colours.
 */
export const FIREWORK_DYES: { id: () => number; name: string; col: number }[] = [
  { id: () => I.BONE_MEAL, name: 'White', col: 0xf0f0f0 },
  { id: () => B.OXEYE_DAISY, name: 'Light Gray', col: 0xababab },
  { id: () => I2.INK_SAC, name: 'Black', col: 0x1e1b1b },
  { id: () => I.COCOA, name: 'Brown', col: 0x51301a },
  { id: () => B.POPPY, name: 'Red', col: 0xb3312c },
  { id: () => I.REDSTONE, name: 'Red', col: 0xb3312c },
  { id: () => B.DANDELION, name: 'Yellow', col: 0xdecf2a },
  { id: () => B.CACTUS, name: 'Green', col: 0x3b511a },
  { id: () => I.LAPIS, name: 'Blue', col: 0x253192 },
  { id: () => B.CORNFLOWER, name: 'Blue', col: 0x253192 },
  { id: () => B.ALLIUM, name: 'Magenta', col: 0xc354cd },
];
/** A firework star's icon colour: the average of its colours (grey without any); undefined for other items. */
export function starTint(s: ItemStack): number | undefined {
  if (s.id !== I6.FIREWORK_STAR) return undefined;
  const cs = s.fw?.ex?.[0]?.colors ?? [];
  if (!cs.length) return 0x8a8a8a;
  let r = 0, g = 0, b = 0;
  for (const c of cs) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; }
  const n = cs.length;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}
export function dyeColor(id: number): number | undefined {
  return FIREWORK_DYES.find((d) => d.id() === id)?.col;
}

// ======================================================================== 1.9 - 1.16.5 items (appended after I6)
const M = 60 * 20;
/** The sixteen dyes (1.14+), in DYE_COLORS order. */
export const DYES: number[] = DYE_COLORS.map((c) => item(`${c}_dye`, `${c.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')} Dye`));
/** Vanilla dye colours (firework stars, leather, beds and banners use them). */
export const DYE_RGB = [0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21];
DYES.forEach((id, i) => FIREWORK_DYES.push({ id: () => id, name: getItem(id).display.replace(' Dye', ''), col: DYE_RGB[i] }));
export const I7 = {
  // the Nether update
  NETHERITE_SCRAP: item('netherite_scrap', 'Netherite Scrap', { fireproof: true }),
  NETHERITE_INGOT: item('netherite_ingot', 'Netherite Ingot', { fireproof: true }),
  WARPED_FUNGUS_ON_A_STICK: item('warped_fungus_on_a_stick', 'Warped Fungus on a Stick', { maxStack: 1, durability: 100 }),
  CARROT_ON_A_STICK: item('carrot_on_a_stick', 'Carrot on a Stick', { maxStack: 1, durability: 25 }),
  // the sea
  PRISMARINE_SHARD: item('prismarine_shard', 'Prismarine Shard'),
  PRISMARINE_CRYSTALS: item('prismarine_crystals', 'Prismarine Crystals'),
  NAUTILUS_SHELL: item('nautilus_shell', 'Nautilus Shell', { rarity: 'uncommon' }),
  HEART_OF_THE_SEA: item('heart_of_the_sea', 'Heart of the Sea', { rarity: 'uncommon' }),
  SCUTE: item('scute', 'Scute'),
  TURTLE_HELMET: item('turtle_helmet', 'Turtle Shell', { maxStack: 1, durability: 275, armor: { slot: 0, points: 2 } }),
  TRIDENT: item('trident', 'Trident', { maxStack: 1, durability: 250, attack: 9, rarity: 'rare' }),
  DRIED_KELP: item('dried_kelp', 'Dried Kelp', { food: { hunger: 1, saturation: 0.6 } }),
  COD_BUCKET: item('cod_bucket', 'Bucket of Cod', { maxStack: 1 }),
  SALMON_BUCKET: item('salmon_bucket', 'Bucket of Salmon', { maxStack: 1 }),
  PUFFERFISH_BUCKET: item('pufferfish_bucket', 'Bucket of Pufferfish', { maxStack: 1 }),
  TROPICAL_FISH_BUCKET: item('tropical_fish_bucket', 'Bucket of Tropical Fish', { maxStack: 1 }),
  PHANTOM_MEMBRANE: item('phantom_membrane', 'Phantom Membrane'),
  // the End
  CHORUS_FRUIT: item('chorus_fruit', 'Chorus Fruit', { food: { hunger: 4, saturation: 2.4 } }),
  POPPED_CHORUS_FRUIT: item('popped_chorus_fruit', 'Popped Chorus Fruit'),
  SHULKER_SHELL: item('shulker_shell', 'Shulker Shell'),
  DRAGON_BREATH: item('dragon_breath', "Dragon's Breath", { rarity: 'uncommon' }),
  // combat
  SHIELD: item('shield', 'Shield', { maxStack: 1, durability: 336 }),
  CROSSBOW: item('crossbow', 'Crossbow', { maxStack: 1, durability: 326 }),
  TOTEM_OF_UNDYING: item('totem_of_undying', 'Totem of Undying', { maxStack: 1, rarity: 'uncommon' }),
  SPECTRAL_ARROW: item('spectral_arrow', 'Spectral Arrow'),
  // food and farming
  BEETROOT: item('beetroot', 'Beetroot', { food: { hunger: 1, saturation: 1.2 } }),
  BEETROOT_SEEDS: item('beetroot_seeds', 'Beetroot Seeds', { block: B2.BEETROOTS }),
  BEETROOT_SOUP: item('beetroot_soup', 'Beetroot Soup', { maxStack: 1, food: { hunger: 6, saturation: 7.2, stew: true } }),
  MELON_SEEDS: item('melon_seeds', 'Melon Seeds', { block: B2.MELON_STEM }),
  SWEET_BERRIES: item('sweet_berries', 'Sweet Berries', { block: B2.SWEET_BERRY_BUSH, food: { hunger: 2, saturation: 0.4 } }),
  HONEY_BOTTLE: item('honey_bottle', 'Honey Bottle', { maxStack: 16, food: { hunger: 6, saturation: 1.2 }, drink: true }),
  HONEYCOMB: item('honeycomb', 'Honeycomb'),
  PUMPKIN_PIE: item('pumpkin_pie', 'Pumpkin Pie', { food: { hunger: 8, saturation: 4.8 } }),
  CAKE: item('cake', 'Cake', { maxStack: 1, block: B2.CAKE }),
  RABBIT: item('rabbit', 'Raw Rabbit', { food: { hunger: 3, saturation: 1.8 } }),
  COOKED_RABBIT: item('cooked_rabbit', 'Cooked Rabbit', { food: { hunger: 5, saturation: 6 } }),
  RABBIT_STEW: item('rabbit_stew', 'Rabbit Stew', { maxStack: 1, food: { hunger: 10, saturation: 12, stew: true } }),
  RABBIT_FOOT: item('rabbit_foot', "Rabbit's Foot"),
  RABBIT_HIDE: item('rabbit_hide', 'Rabbit Hide'),
  POISONOUS_POTATO: item('poisonous_potato', 'Poisonous Potato', { food: { hunger: 2, saturation: 1.2 } }),
  ENCHANTED_GOLDEN_APPLE: item('enchanted_golden_apple', 'Enchanted Golden Apple', { food: { hunger: 4, saturation: 9.6 }, rarity: 'epic' }),
  SUSPICIOUS_STEW: item('suspicious_stew', 'Suspicious Stew', { maxStack: 1, food: { hunger: 6, saturation: 7.2, stew: true } }),
  // materials and tools
  IRON_NUGGET: item('iron_nugget', 'Iron Nugget'),
  EXPERIENCE_BOTTLE: item('experience_bottle', "Bottle o' Enchanting", { rarity: 'uncommon' }),
  LEAD: item('lead', 'Lead'),
  LEATHER_HORSE_ARMOR: item('leather_horse_armor', 'Leather Horse Armor', { maxStack: 1 }),
  ITEM_FRAME: item('item_frame', 'Item Frame'),
  PAINTING: item('painting', 'Painting'),
  ARMOR_STAND: item('armor_stand', 'Armor Stand', { maxStack: 16 }),
  CHEST_MINECART: item('chest_minecart', 'Minecart with Chest', { maxStack: 1 }),
  FURNACE_MINECART: item('furnace_minecart', 'Minecart with Furnace', { maxStack: 1 }),
  HOPPER_MINECART: item('hopper_minecart', 'Minecart with Hopper', { maxStack: 1 }),
  TNT_MINECART: item('tnt_minecart', 'Minecart with TNT', { maxStack: 1 }),
  MAP: item('map', 'Empty Map'),
  FILLED_MAP: item('filled_map', 'Map', { maxStack: 1 }),
  WRITABLE_BOOK: item('writable_book', 'Book and Quill', { maxStack: 1 }),
  KNOWLEDGE_UNUSED: item('unused_item_1', 'Unused'),
};
/** Boats of every wood (the oak boat is I2.BOAT). */
export const BOATS: Record<string, number> = { oak: I2.BOAT };
for (const k of ['spruce', 'birch', 'jungle', 'acacia', 'dark_oak'] as const) BOATS[k] = item(`${k}_boat`, `${k.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')} Boat`, { maxStack: 1, fuel: 1200 });
/** Netherite: tools and armour a step above diamond that float on lava. */
export const NETHERITE = { level: 4, speed: 9, durability: 2031, dmg: 4 };
for (const k of TOOL_KINDS) {
  const name = `netherite_${k.type}`;
  TOOLS[name] = item(name, `Netherite ${k.display}`, {
    maxStack: 1, durability: NETHERITE.durability, fireproof: true, rarity: 'common',
    tool: { type: k.type, level: NETHERITE.level, speed: NETHERITE.speed, damage: k.base + NETHERITE.dmg },
    attack: k.type === 'sword' ? 4 + NETHERITE.dmg : k.type === 'axe' ? 3 + NETHERITE.dmg : k.type === 'pickaxe' ? 2 + NETHERITE.dmg : k.type === 'shovel' ? 1 + NETHERITE.dmg : 1,
  });
}
ARMOR_SLOTS.forEach((s, i) => {
  const name = `netherite_${s.name}`;
  ARMOR[name] = item(name, `Netherite ${s.display}`, { maxStack: 1, durability: s.mul * 37, fireproof: true, armor: { slot: i as 0 | 1 | 2 | 3, points: [3, 8, 6, 3][i], toughness: 3, knockback: 0.1 } });
});
// 1.9 armour toughness: diamond 2
for (const s of ARMOR_SLOTS) getItem(ARMOR[`diamond_${s.name}`]).armor!.toughness = 2;
HORSE_ARMOR[I7.LEATHER_HORSE_ARMOR] = { points: 3, kind: 'leather' };
/** Potion forms of 1.9+: lingering potions and tipped arrows, one per potion type. */
export const LINGERING_ITEMS: Record<string, number> = {};
export const TIPPED_ARROWS: Record<string, number> = {};
for (const p of POTIONS) LINGERING_ITEMS[p.key] = item(`lingering_potion_${p.key}`, p.key === 'water' ? 'Lingering Water Bottle' : 'Lingering ' + p.name, { maxStack: 1, potion: p.key, lingering: true, sprite: `lingering_potion_${p.sprite}` });
for (const p of POTIONS) if (p.effects.length) TIPPED_ARROWS[p.key] = item(`tipped_arrow_${p.key}`, 'Arrow of ' + p.name.replace(/^Potion of /, ''), { potion: p.key, sprite: `tipped_arrow_${p.sprite}` });
/** Music discs (the jukebox plays each disc's own tune). */
export const DISCS = ['13', 'cat', 'blocks', 'chirp', 'far', 'mall', 'mellohi', 'stal', 'strad', 'ward', '11', 'wait', 'pigstep'].map((n) => item(`music_disc_${n}`, 'Music Disc', { maxStack: 1, rarity: 'rare', sprite: `music_disc_${n}`, disc: n }));
void M;
/** Chainmail armour (traded, worn by mobs; not craftable) and the boss drops of 1.4 the game was missing. */
ARMOR_SLOTS.forEach((sl, i) => {
  const name = `chainmail_${sl.name}`;
  ARMOR[name] = item(name, `Chainmail ${sl.display}`, { maxStack: 1, durability: sl.mul * 15, armor: { slot: i as 0 | 1 | 2 | 3, points: [2, 5, 4, 1][i] }, rarity: 'uncommon' });
});
/** Spawn eggs of the 1.16 mobs (appended; vanilla egg colours). */
export const EXTRA_EGGS3: { mob: string; display: string; c1: number; c2: number }[] = [
  { mob: 'piglin', display: 'Piglin', c1: 0x995f40, c2: 0xf9f3a4 },
  { mob: 'piglin_brute', display: 'Piglin Brute', c1: 0x592a10, c2: 0xf9f3a4 },
  { mob: 'hoglin', display: 'Hoglin', c1: 0xc66e55, c2: 0x5f6464 },
  { mob: 'zoglin', display: 'Zoglin', c1: 0xc66e55, c2: 0xe6e6e6 },
  { mob: 'strider', display: 'Strider', c1: 0x9c3436, c2: 0x4d494d },
  { mob: 'magma_cube', display: 'Magma Cube', c1: 0x340000, c2: 0xfcfc00 },
  { mob: 'wither_skeleton', display: 'Wither Skeleton', c1: 0x141414, c2: 0x474d4d },
  { mob: 'shulker', display: 'Shulker', c1: 0x946794, c2: 0x4d3852 },
  { mob: 'endermite', display: 'Endermite', c1: 0x161616, c2: 0x6e6e6e },
];
for (const e of EXTRA_EGGS3) EGG_ITEMS[e.mob] = item(`${e.mob}_spawn_egg`, `Spawn ${e.display}`, { egg: e.mob });
getItem(EGG_ITEMS.zombie_pigman).display = 'Spawn Zombified Piglin';
export const I8 = {
  NETHER_STAR: item('nether_star', 'Nether Star', { rarity: 'uncommon', fireproof: true }),
  /** Bottled dragon's breath makes lingering potions; this is the explorer map pointing to a structure. */
  EXPLORER_MAP_UNUSED: item('unused_item_2', 'Unused'),
};
/** Spawn eggs of the overworld mobs of 1.4-1.16 (appended; vanilla egg colours). */
export const EXTRA_EGGS4: { mob: string; display: string; c1: number; c2: number }[] = [
  { mob: 'husk', display: 'Husk', c1: 0x797061, c2: 0xe6cc94 },
  { mob: 'drowned', display: 'Drowned', c1: 0x8ff1d7, c2: 0x799c65 },
  { mob: 'stray', display: 'Stray', c1: 0x617677, c2: 0xdde6e5 },
  { mob: 'zombie_villager', display: 'Zombie Villager', c1: 0x563c33, c2: 0x799c65 },
  { mob: 'cave_spider', display: 'Cave Spider', c1: 0x0c424e, c2: 0xa80e0e },
  { mob: 'witch', display: 'Witch', c1: 0x340000, c2: 0x51a03e },
  { mob: 'pillager', display: 'Pillager', c1: 0x532f36, c2: 0x959b9b },
  { mob: 'vindicator', display: 'Vindicator', c1: 0x959b9b, c2: 0x275e61 },
  { mob: 'evoker', display: 'Evoker', c1: 0x959b9b, c2: 0x1e1c1a },
  { mob: 'vex', display: 'Vex', c1: 0x7a90a4, c2: 0xe8edf1 },
  { mob: 'ravager', display: 'Ravager', c1: 0x757470, c2: 0x5b5049 },
  { mob: 'guardian', display: 'Guardian', c1: 0x5a8272, c2: 0xf17d30 },
  { mob: 'elder_guardian', display: 'Elder Guardian', c1: 0xceccba, c2: 0x747693 },
  { mob: 'phantom', display: 'Phantom', c1: 0x43518a, c2: 0x88ff00 },
];
for (const e of EXTRA_EGGS4) EGG_ITEMS[e.mob] = item(`${e.mob}_spawn_egg`, `Spawn ${e.display}`, { egg: e.mob });

// block items of the new blocks: sizes and fuel that differ from the defaults
for (const id of [...BEDS]) { const d = ITEMS.get(id); if (d) d.maxStack = 1; }
for (const w of Object.values(WOOD)) {
  for (const id of [w.sign]) { const d = ITEMS.get(id); if (d) d.maxStack = 16; }
  if (!w.nether) for (const id of [w.planks, w.log, w.strippedLog, w.wood, w.strippedWood, w.stairs, w.fence, w.gate, w.trapdoor]) { const d = ITEMS.get(id); if (d) d.fuel ??= 300; }
  if (!w.nether) for (const id of [w.slab, w.button, w.plate, w.sapling, w.door]) { const d = ITEMS.get(id); if (d) d.fuel ??= w.slab === id ? 150 : id === w.door ? 200 : 100; }
}
for (const id of [B2.LANTERN, B2.SOUL_LANTERN, B2.CHAIN, B2.END_ROD]) { const d = ITEMS.get(id); if (d) d.flatBlock = true; }
for (const id of SHULKER_BOXES.concat(B2.SHULKER_BOX)) { const d = ITEMS.get(id); if (d) d.maxStack = 1; }
for (const id of [STONE2.SEA_LANTERN, B2.CRYING_OBSIDIAN, B2.NETHERITE_BLOCK, B2.ANCIENT_DEBRIS]) { const d = ITEMS.get(id); if (d && (id === B2.NETHERITE_BLOCK || id === B2.ANCIENT_DEBRIS)) d.fireproof = true; }
ITEMS.get(B2.BAMBOO)!.fuel = 50;
ITEMS.get(B2.DRIED_KELP_BLOCK)!.fuel = 4000;
ITEMS.get(B2.SCAFFOLDING)!.fuel = 50;

/** How many items the game itself has (before any mod's). */
export const VANILLA_ITEM_COUNT = ITEMS.size;

export function itemByName(name: string): ItemDef | undefined {
  return byName.get(name) ?? (name.startsWith('minecraft:') ? byName.get(name.slice(10)) : undefined);
}
/** Vanilla items take ids below this (block items share their block's id); pure mod items are bound from 4096 up. */
export const MOD_ITEM_BASE = 4096;
/** Put a definition at its id (mod registries binding to a world's ids). */
export function setItemDef(def: ItemDef) {
  const old = ITEMS.get(def.id);
  if (old && byName.get(old.name) === old) byName.delete(old.name);
  ITEMS.set(def.id, def);
  if (!def.missing) byName.set(def.name, def);
}
export function deleteItemDef(id: number) {
  const old = ITEMS.get(id);
  if (!old) return;
  if (byName.get(old.name) === old) byName.delete(old.name);
  ITEMS.delete(id);
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
  fw?: Firework; // firework rockets and stars
  /** Mods: JSON data of their own (a wand's spells...). Stacks only stack when their tags match. Replace it, don't mutate it. */
  tag?: Record<string, unknown>;
}
/** One burst of a firework: `shape` indexes FIREWORK_SHAPES; colours are 0xRRGGBB. */
export interface FireworkExplosion { shape: number; colors: number[]; fade?: number[]; trail?: boolean; twinkle?: boolean }
/** A rocket's flight duration (gunpowder used) and bursts; a star carries its one burst in `ex`. */
export interface Firework { flight?: number; ex?: FireworkExplosion[] }
export const stack = (id: number, count = 1, damage = 0): ItemStack => ({ id, count, damage });
export const cloneStack = (s: ItemStack | null): ItemStack | null => (s ? { ...s, damage: s.damage ?? 0, ...(s.ench ? { ench: { ...s.ench } } : {}), ...(s.tag ? { tag: structuredClone(s.tag) } : {}) } : null);
export const sameItem = (a: ItemStack | null, b: ItemStack | null) => !!a && !!b && a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && JSON.stringify(a.ench ?? null) === JSON.stringify(b.ench ?? null) && (a.name ?? '') === (b.name ?? '') && (a.repair ?? 0) === (b.repair ?? 0) && JSON.stringify(a.fw ?? null) === JSON.stringify(b.fw ?? null) && JSON.stringify(a.tag ?? null) === JSON.stringify(b.tag ?? null);
/** Display name (custom anvil name if set). */
export const stackName = (s: ItemStack) => s.name ?? getItem(s.id).display;
export const maxStack = (s: ItemStack) => getItem(s.id).maxStack;

// ------------------------------------------------------------------ block drops
import { Random } from '../noise';
import { isLeaves, Shape, BlockDef } from '../world/blocks';

export function blockDrops(blockId: number, meta: number, tool: ItemDef | undefined, rng: Random, silk = false): ItemStack[] {
  const def = BLOCKS[blockId];
  if (def.missing) return [];
  // must use the right tool for blocks that require one
  if (def.harvestLevel >= 0) {
    if (!tool?.tool || tool.tool.type !== def.tool || tool.tool.level < def.harvestLevel) return [];
  }
  if (def.behavior?.drops) return def.behavior.drops({ id: blockId, meta, tool, rng, silk });
  if (silk && def.item && blockId !== B.SPAWNER && !def.needsSupport) return [stack(blockId)];
  const shears = tool?.tool?.type === 'shears';
  const fam = familyDrops(blockId, meta, def, shears, rng, tool);
  if (fam) return fam;
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
    case B.ENDER_CHEST: return silk ? [stack(blockId)] : [stack(B.OBSIDIAN, 8)];
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

/** Drops of the block families and the 1.9-1.16 blocks; null = the old rules decide. */
function familyDrops(id: number, meta: number, def: BlockDef, shears: boolean, rng: Random, tool: ItemDef | undefined): ItemStack[] | null {
  const fortune = 0; void tool;
  switch (def.shape) {
    case Shape.Slab: return (meta & 7) === 2 ? [stack(id, 2)] : [stack(id)];
    case Shape.Leaves: {
      if (shears) return [stack(id)];
      const out: ItemStack[] = [];
      const sap = def.sapling ? blockByName(def.sapling)?.id : undefined;
      if (sap && rng.int(id === WOOD.jungle.leaves ? 40 : 20) === 0) out.push(stack(sap));
      if ((id === B.OAK_LEAVES || id === WOOD.dark_oak.leaves) && rng.int(200) === 0) out.push(stack(I.APPLE));
      if (rng.int(50) === 0) out.push(stack(I.STICK, 1 + rng.int(2)));
      return out;
    }
    case Shape.DoublePlant:
      if (id === B2.TALL_GRASS2 || id === B2.LARGE_FERN) return shears ? [stack(id === B2.TALL_GRASS2 ? B.TALL_GRASS : B.FERN, 2)] : rng.int(8) === 0 ? [stack(I.WHEAT_SEEDS)] : [];
      if (id === B2.TALL_SEAGRASS) return shears ? [stack(B2.SEAGRASS, 2)] : [];
      return [stack(id)];
    case Shape.Bed: return [stack(id === B.BED ? I.RED_BED : id)];
    case Shape.Vine: return shears ? [stack(id)] : [];
    case Shape.Campfire: return [stack(id === B2.SOUL_CAMPFIRE ? B2.SOUL_SOIL : I.CHARCOAL, id === B2.SOUL_CAMPFIRE ? 1 : 2)];
  }
  switch (id) {
    case B2.NETHER_GOLD_ORE: return [stack(I.GOLD_NUGGET, 2 + rng.int(5) + fortune)];
    case STONE2.GILDED_BLACKSTONE: return rng.int(10) === 0 ? [stack(I.GOLD_NUGGET, 2 + rng.int(4))] : [stack(id)];
    case B2.REDSTONE_ORE_LIT: return [stack(I.REDSTONE, 4 + rng.int(2))];
    case STONE2.SEA_LANTERN: return [stack(I7.PRISMARINE_CRYSTALS, 2 + rng.int(2))];
    case B2.BROWN_MUSHROOM_BLOCK: case B2.RED_MUSHROOM_BLOCK: { const n = Math.max(0, rng.int(10) - 7); return n ? [stack(id === B2.RED_MUSHROOM_BLOCK ? B.RED_MUSHROOM : B.BROWN_MUSHROOM, n)] : []; }
    case B2.SEAGRASS: case B2.NETHER_SPROUTS: return shears ? [stack(id)] : [];
    case B2.SWEET_BERRY_BUSH: return meta >= 2 ? [stack(I7.SWEET_BERRIES, meta === 3 ? 2 + rng.int(2) : 1 + rng.int(2))] : [];
    case B2.BEETROOTS: return meta >= 3 ? [stack(I7.BEETROOT), stack(I7.BEETROOT_SEEDS, 1 + rng.int(3))] : [stack(I7.BEETROOT_SEEDS)];
    case B2.MELON_STEM: return [stack(I7.MELON_SEEDS)];
    case B2.COCOA: return [stack(I.COCOA, meta >> 2 >= 2 ? 2 + rng.int(2) : 1)];
    case B2.FLOWER_POT: { const out = [stack(B2.FLOWER_POT)]; const pl = POT_PLANT_IDS[meta]; if (pl) out.push(stack(pl)); return out; }
    case B2.SEA_PICKLE: return [stack(id, (meta & 3) + 1)];
    case B2.TURTLE_EGG: return [];
    case B2.CHORUS_PLANT: return rng.int(2) ? [stack(I7.CHORUS_FRUIT)] : [];
    case B2.CHORUS_FLOWER: return [stack(id)];
    case B2.KELP: case B2.KELP_PLANT: return [stack(B2.KELP)];
    case B2.BAMBOO: case B2.BAMBOO_SAPLING: return [stack(B2.BAMBOO)];
    case B2.GRASS_PATH: case B2.MYCELIUM: return [stack(B.DIRT)];
    case B2.BEE_NEST: case B2.INFESTED_STONE: case B2.INFESTED_COBBLESTONE: case B2.INFESTED_STONE_BRICKS: return [];
    case B2.TRIPWIRE: return [stack(I.STRING)];
  }
  return null;
}
/** What a flower pot can hold, by meta (models.ts keeps the same list). */
const POT_PLANT_IDS: number[] = [0, B.OAK_SAPLING, B.SPRUCE_SAPLING, B.BIRCH_SAPLING, WOOD.jungle.sapling, WOOD.acacia.sapling, WOOD.dark_oak.sapling, B.DANDELION, B.POPPY, B2.BLUE_ORCHID, B.CORNFLOWER, B.RED_MUSHROOM, B.BROWN_MUSHROOM, B.DEAD_BUSH, B.FERN, B.CACTUS];

export function blockItemFor(name: string): number {
  const b = blockByName(name);
  return b ? b.id : 0;
}
