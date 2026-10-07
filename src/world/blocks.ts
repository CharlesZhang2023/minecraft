// Block registry. Shared between the main thread and workers (no DOM access here).
//
// Block storage: Uint16 per voxel = id (low 12 bits) | meta (high 4 bits).

export const CHUNK_W = 16;
export const CHUNK_H = 256;
export const SEA_LEVEL = 63;
export const CHUNK_SIZE = CHUNK_W * CHUNK_W * CHUNK_H;

export const idOf = (v: number) => v & 0xfff;
export const metaOf = (v: number) => v >>> 12;
export const pack = (id: number, meta = 0) => id | (meta << 12);

export enum Render {
  None,
  Cube,
  Cross,
  Liquid,
  Torch,
  Crops,
  Model, // arbitrary box list, see models.ts
  Rail, // flat or sloped track, see mesher.ts
}

/**
 * What kind of block it is, for the families that share rules (models, placement, collision, redstone, drops) no
 * matter what they're made of. `Cube` = no family. Kept apart from `Render` (how the mesher draws it).
 */
export enum Shape {
  Cube, Stairs, Slab, Fence, Gate, Wall, Pane, Door, Trapdoor, Button, Plate, Sign, WallSign, Log, Leaves, Sapling,
  Flower, Carpet, DoublePlant, Lantern, Chain, Vine, Head, WallHead, Coral, CoralFan, Campfire, Bed,
}

export type Tool = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears' | null;
export type Tint = 'none' | 'grass' | 'foliage' | 'spruce' | 'birch';
export type Sound = 'stone' | 'wood' | 'grass' | 'gravel' | 'sand' | 'glass' | 'cloth' | 'snow' | 'metal' | 'slime' | 'none';

// Texture registry: stable indices so workers and the main thread agree.
export const TEXTURES: string[] = [];
const texIndex = new Map<string, number>();
export function tex(name: string): number {
  let i = texIndex.get(name);
  if (i === undefined) {
    i = TEXTURES.length;
    TEXTURES.push(name);
    texIndex.set(name, i);
  }
  return i;
}
/** Workers: take the main thread's texture list (mods add textures, and every realm must number them alike). */
export function adoptTextures(names: string[]) {
  TEXTURES.length = 0;
  texIndex.clear();
  for (const n of names) tex(n);
}

// Face order: 0 = -X (west), 1 = +X (east), 2 = -Y (down), 3 = +Y (up), 4 = -Z (north), 5 = +Z (south)
export const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
];
// Horizontal facing (meta): 0 = north(-z), 1 = east(+x), 2 = south(+z), 3 = west(-x)
export const HORIZ: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const HORIZ_TO_FACE = [4, 1, 5, 0];

export interface BlockDef {
  id: number;
  name: string;
  display: string;
  render: Render;
  faces: number[]; // texture index per face
  opaque: boolean; // full opaque cube: hides neighbour faces and blocks light
  solid: boolean; // has collision
  translucent: boolean; // drawn in the blended pass
  cullSelf: boolean; // hides faces between two blocks of the same type (glass, water)
  lightOpacity: number;
  light: number;
  hardness: number; // -1 unbreakable
  tool: Tool;
  harvestLevel: number; // -1: harvestable by hand
  tint: Tint;
  sound: Sound;
  replaceable: boolean;
  gravity: boolean;
  flammable: boolean;
  fluid: boolean;
  slipperiness: number;
  climbable: boolean;
  selectable: boolean;
  needsSupport: boolean; // plants/torches: break when support is removed
  drop: string | null | undefined; // undefined = itself, null = nothing
  blastResistance: number;
  item: boolean; // appears in creative inventory
  /** The block family it belongs to (stairs, slabs, doors...). */
  shape: Shape;
  /**
   * What it's made of, where that changes the rules: 'wood' doors/trapdoors/gates open by hand and buttons stay
   * pressed longer, 'iron' doors and trapdoors only answer redstone, 'nether_wood' doesn't burn, 'gold'/'iron'
   * pressure plates count entities.
   */
  material?: 'wood' | 'nether_wood' | 'stone' | 'iron' | 'gold';
  /** Texture layer of the flat icon (block items drawn as a sprite: doors, signs...), when not the first face. */
  icon?: number;
  /** Family links by block name: the full block a slab/stair/wall is cut from, a log's stripped form, a leaf's sapling. */
  base?: string;
  stripped?: string;
  sapling?: string;
  /** Saplings and fungi: the tree they grow into (see `growTree`). */
  tree?: string;
  /** Burn chances for fire spread (vanilla encouragement/flammability); 0 = never catches. */
  burn?: [number, number];
  /** Light emitted by each meta, when it depends on the state (respawn anchor charges, lit campfires). */
  lights?: number[];
  /** Mods: the namespaced key ('mod:name'; vanilla blocks have none), the owning mod and its hooks. */
  key?: string;
  mod?: string;
  behavior?: import('../mod/types').BlockBehavior;
  /** A placeholder for an id whose mod isn't loaded (its blocks survive, drawn as missing). */
  missing?: boolean;
}

export const BLOCKS: BlockDef[] = [];
const byName = new Map<string, BlockDef>();

export type BlockOpts = Partial<Omit<BlockDef, 'id' | 'name' | 'faces' | 'icon'>> & {
  tex?: string; // all faces
  top?: string;
  bottom?: string;
  side?: string;
  front?: string;
  /** Texture of the flat item icon. */
  icon?: string;
};
type Opts = BlockOpts;

function reg(name: string, display: string, o: Opts = {}): number {
  const def = makeBlockDef(BLOCKS.length, name, display, o);
  BLOCKS.push(def);
  byName.set(name, def);
  return def.id;
}

/** A block definition with every property filled in (textures default to the block's name). */
export function makeBlockDef(id: number, name: string, display: string, o: Opts = {}): BlockDef {
  const all = o.tex ?? name;
  const side = o.side ?? all;
  const faces = [side, side, o.bottom ?? o.top ?? all, o.top ?? all, side, side].map(tex);
  const render = o.render ?? Render.Cube;
  const isCube = render === Render.Cube;
  const def: BlockDef = {
    id, name, display, render, faces,
    opaque: o.opaque ?? (isCube && !o.translucent),
    solid: o.solid ?? (render === Render.Cube || render === Render.Model),
    translucent: o.translucent ?? false,
    cullSelf: o.cullSelf ?? false,
    lightOpacity: o.lightOpacity ?? (o.opaque ?? (isCube && !o.translucent) ? 15 : 0),
    light: o.light ?? 0,
    hardness: o.hardness ?? 1,
    tool: o.tool ?? null,
    harvestLevel: o.harvestLevel ?? -1,
    tint: o.tint ?? 'none',
    sound: o.sound ?? 'stone',
    replaceable: o.replaceable ?? false,
    gravity: o.gravity ?? false,
    flammable: o.flammable ?? false,
    fluid: o.fluid ?? false,
    slipperiness: o.slipperiness ?? 0.6,
    climbable: o.climbable ?? false,
    selectable: o.selectable ?? true,
    needsSupport: o.needsSupport ?? false,
    drop: o.drop,
    blastResistance: o.blastResistance ?? (o.hardness ?? 1) * 5,
    item: o.item ?? true,
    shape: o.shape ?? Shape.Cube,
    material: o.material, base: o.base, stripped: o.stripped, sapling: o.sapling, tree: o.tree, burn: o.burn, lights: o.lights,
    icon: o.icon !== undefined ? tex(o.icon) : undefined,
    key: o.key, mod: o.mod, behavior: o.behavior, missing: o.missing,
  };
  if (o.front) def.faces.push(tex(o.front)); // index 6: front face for oriented blocks
  return def;
}

/** By name: vanilla names with or without 'minecraft:', mod blocks by their 'mod:name' key. */
export function blockByName(name: string): BlockDef | undefined {
  return byName.get(name) ?? (name.startsWith('minecraft:') ? byName.get(name.slice(10)) : undefined);
}

/** Put a definition at its id (mod registries binding to a world's ids), keeping the lookup tables in step. */
export function setBlockDef(id: number, def: BlockDef) {
  const old = BLOCKS[id];
  if (old && byName.get(old.name) === old) byName.delete(old.name);
  while (BLOCKS.length < id) BLOCKS.push(def);
  BLOCKS[id] = def;
  if (!def.missing) byName.set(def.name, def);
  OPAQUE[id] = def.opaque ? 1 : 0;
  LIGHT_OPACITY[id] = def.lightOpacity;
  LIGHT_EMIT[id] = def.light;
  RENDER[id] = def.render;
  SOLID[id] = def.solid ? 1 : 0;
  REDSTONE[id] = def.behavior?.redstone ? 1 : 0;
  SHAPE[id] = def.shape;
  for (let m = 0; m < 16; m++) STATE_LIGHT[id | (m << 12)] = def.lights?.[m] ?? def.light;
}

const RAIL: Opts = { render: Render.Rail, solid: false, opaque: false, lightOpacity: 0, hardness: 0.7, sound: 'metal', needsSupport: true };
const plant: Opts = { render: Render.Cross, solid: false, hardness: 0, sound: 'grass', needsSupport: true };
const stone: Opts = { hardness: 1.5, tool: 'pickaxe', harvestLevel: 0, sound: 'stone', blastResistance: 30 };
const ore = (lvl: number): Opts => ({ hardness: 3, tool: 'pickaxe', harvestLevel: lvl, sound: 'stone', blastResistance: 15 });
const wood: Opts = { hardness: 2, tool: 'axe', sound: 'wood', flammable: true, blastResistance: 15 };
const leaves: Opts = { hardness: 0.2, tool: 'hoe', sound: 'grass', opaque: false, lightOpacity: 1, flammable: true };
const wool: Opts = { hardness: 0.8, sound: 'cloth', flammable: true, tool: 'shears' };

export const B = {
  AIR: reg('air', 'Air', { render: Render.None, solid: false, opaque: false, hardness: 0, replaceable: true, selectable: false, sound: 'none', item: false, lightOpacity: 0 }),
  STONE: reg('stone', 'Stone', { ...stone, drop: 'cobblestone' }),
  GRASS: reg('grass_block', 'Grass Block', { top: 'grass_top', bottom: 'dirt', side: 'grass_side', hardness: 0.6, tool: 'shovel', sound: 'grass', drop: 'dirt', tint: 'grass' }),
  DIRT: reg('dirt', 'Dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' }),
  COBBLESTONE: reg('cobblestone', 'Cobblestone', { ...stone, hardness: 2 }),
  OAK_PLANKS: reg('oak_planks', 'Oak Planks', { ...wood }),
  SPRUCE_PLANKS: reg('spruce_planks', 'Spruce Planks', { ...wood }),
  BIRCH_PLANKS: reg('birch_planks', 'Birch Planks', { ...wood }),
  OAK_SAPLING: reg('oak_sapling', 'Oak Sapling', { ...plant }),
  SPRUCE_SAPLING: reg('spruce_sapling', 'Spruce Sapling', { ...plant }),
  BIRCH_SAPLING: reg('birch_sapling', 'Birch Sapling', { ...plant }),
  BEDROCK: reg('bedrock', 'Bedrock', { hardness: -1, blastResistance: 1e9 }),
  WATER: reg('water', 'Water', { tex: 'water_still', side: 'water_flow', render: Render.Liquid, solid: false, opaque: false, translucent: true, cullSelf: true, lightOpacity: 2, hardness: 100, replaceable: true, fluid: true, selectable: false, drop: null, item: false, sound: 'none', blastResistance: 500 }),
  LAVA: reg('lava', 'Lava', { tex: 'lava_still', side: 'lava_flow', render: Render.Liquid, solid: false, opaque: false, cullSelf: true, lightOpacity: 0, light: 15, hardness: 100, replaceable: true, fluid: true, selectable: false, drop: null, item: false, sound: 'none', blastResistance: 500 }),
  SAND: reg('sand', 'Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true }),
  GRAVEL: reg('gravel', 'Gravel', { hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true }),
  GOLD_ORE: reg('gold_ore', 'Gold Ore', ore(2)),
  IRON_ORE: reg('iron_ore', 'Iron Ore', ore(1)),
  COAL_ORE: reg('coal_ore', 'Coal Ore', { ...ore(0), drop: 'coal' }),
  OAK_LOG: reg('oak_log', 'Oak Log', { ...wood, top: 'oak_log_top', side: 'oak_log' }),
  SPRUCE_LOG: reg('spruce_log', 'Spruce Log', { ...wood, top: 'spruce_log_top', side: 'spruce_log' }),
  BIRCH_LOG: reg('birch_log', 'Birch Log', { ...wood, top: 'birch_log_top', side: 'birch_log' }),
  OAK_LEAVES: reg('oak_leaves', 'Oak Leaves', { ...leaves, tint: 'foliage' }),
  SPRUCE_LEAVES: reg('spruce_leaves', 'Spruce Leaves', { ...leaves, tint: 'spruce' }),
  BIRCH_LEAVES: reg('birch_leaves', 'Birch Leaves', { ...leaves, tex: 'oak_leaves', tint: 'birch' }),
  GLASS: reg('glass', 'Glass', { hardness: 0.3, sound: 'glass', opaque: false, cullSelf: true, lightOpacity: 0, drop: null }),
  LAPIS_ORE: reg('lapis_ore', 'Lapis Lazuli Ore', { ...ore(1), drop: 'lapis_lazuli' }),
  DIAMOND_ORE: reg('diamond_ore', 'Diamond Ore', { ...ore(2), drop: 'diamond' }),
  REDSTONE_ORE: reg('redstone_ore', 'Redstone Ore', { ...ore(2), drop: 'redstone' }),
  SANDSTONE: reg('sandstone', 'Sandstone', { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  TALL_GRASS: reg('short_grass', 'Grass', { ...plant, tint: 'grass', replaceable: true, drop: 'wheat_seeds' }),
  FERN: reg('fern', 'Fern', { ...plant, tint: 'grass', replaceable: true, drop: 'wheat_seeds' }),
  DEAD_BUSH: reg('dead_bush', 'Dead Bush', { ...plant, replaceable: true, drop: 'stick' }),
  DANDELION: reg('dandelion', 'Dandelion', { ...plant }),
  POPPY: reg('poppy', 'Poppy', { ...plant }),
  CORNFLOWER: reg('cornflower', 'Cornflower', { ...plant }),
  OXEYE_DAISY: reg('oxeye_daisy', 'Oxeye Daisy', { ...plant }),
  ALLIUM: reg('allium', 'Allium', { ...plant }),
  BROWN_MUSHROOM: reg('brown_mushroom', 'Brown Mushroom', { ...plant, light: 1 }),
  RED_MUSHROOM: reg('red_mushroom', 'Red Mushroom', { ...plant }),
  GOLD_BLOCK: reg('gold_block', 'Block of Gold', { hardness: 3, tool: 'pickaxe', harvestLevel: 2, sound: 'metal' }),
  IRON_BLOCK: reg('iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', harvestLevel: 1, sound: 'metal' }),
  DIAMOND_BLOCK: reg('diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', harvestLevel: 2, sound: 'metal' }),
  COAL_BLOCK: reg('coal_block', 'Block of Coal', { hardness: 5, tool: 'pickaxe', harvestLevel: 0, flammable: true }),
  BRICKS: reg('bricks', 'Bricks', { ...stone, hardness: 2 }),
  TNT: reg('tnt', 'TNT', { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side', hardness: 0, sound: 'grass', flammable: true }),
  BOOKSHELF: reg('bookshelf', 'Bookshelf', { ...wood, hardness: 1.5, top: 'oak_planks', side: 'bookshelf', drop: 'book' }),
  MOSSY_COBBLESTONE: reg('mossy_cobblestone', 'Mossy Cobblestone', { ...stone, hardness: 2 }),
  OBSIDIAN: reg('obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', harvestLevel: 3, blastResistance: 6000 }),
  TORCH: reg('torch', 'Torch', { render: Render.Torch, solid: false, opaque: false, hardness: 0, light: 14, sound: 'wood', needsSupport: true, lightOpacity: 0 }),
  CRAFTING_TABLE: reg('crafting_table', 'Crafting Table', { ...wood, hardness: 2.5, top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }),
  FURNACE: reg('furnace', 'Furnace', { ...stone, hardness: 3.5, top: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }),
  LIT_FURNACE: reg('lit_furnace', 'Furnace', { ...stone, hardness: 3.5, top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on', light: 13, drop: 'furnace', item: false }),
  CHEST: reg('chest', 'Chest', { ...wood, hardness: 2.5, render: Render.Model, opaque: false, lightOpacity: 0, top: 'chest_top', side: 'chest_side', front: 'chest_front' }),
  WHEAT: reg('wheat', 'Wheat Crops', { render: Render.Crops, tex: 'wheat_stage7', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drop: null, item: false }),
  FARMLAND: reg('farmland', 'Farmland', { render: Render.Model, top: 'farmland', side: 'dirt', hardness: 0.6, tool: 'shovel', sound: 'gravel', opaque: false, lightOpacity: 15, drop: 'dirt', item: false }),
  OAK_DOOR: reg('oak_door', 'Oak Door', { ...wood, hardness: 3, render: Render.Model, tex: 'oak_door_bottom', top: 'oak_door_top', opaque: false, lightOpacity: 0, item: false, drop: null }),
  LADDER: reg('ladder', 'Ladder', { render: Render.Model, hardness: 0.4, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0, climbable: true, needsSupport: true, solid: true }),
  OAK_STAIRS: reg('oak_stairs', 'Oak Stairs', { ...wood, render: Render.Model, tex: 'oak_planks', opaque: false, lightOpacity: 15 }),
  COBBLESTONE_STAIRS: reg('cobblestone_stairs', 'Cobblestone Stairs', { ...stone, hardness: 2, render: Render.Model, tex: 'cobblestone', opaque: false, lightOpacity: 15 }),
  STONE_SLAB: reg('stone_slab', 'Stone Slab', { ...stone, hardness: 2, render: Render.Model, top: 'smooth_stone', side: 'smooth_stone_slab_side', opaque: false, lightOpacity: 15 }),
  OAK_SLAB: reg('oak_slab', 'Oak Slab', { ...wood, render: Render.Model, tex: 'oak_planks', opaque: false, lightOpacity: 15 }),
  DOUBLE_STONE_SLAB: reg('smooth_stone', 'Smooth Stone', { ...stone, hardness: 2, top: 'smooth_stone', side: 'smooth_stone_slab_side', drop: 'stone_slab' }),
  SNOW: reg('snow', 'Snow', { render: Render.Model, tex: 'snow', hardness: 0.1, tool: 'shovel', sound: 'snow', opaque: false, lightOpacity: 0, replaceable: true, solid: false, drop: 'snowball', needsSupport: true }),
  ICE: reg('ice', 'Ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', translucent: true, opaque: false, cullSelf: true, lightOpacity: 2, slipperiness: 0.98, drop: null }),
  SNOW_BLOCK: reg('snow_block', 'Snow Block', { tex: 'snow', hardness: 0.2, tool: 'shovel', sound: 'snow', drop: 'snowball' }),
  CACTUS: reg('cactus', 'Cactus', { render: Render.Model, top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side', hardness: 0.4, sound: 'cloth', opaque: false, lightOpacity: 0, needsSupport: true }),
  CLAY: reg('clay', 'Clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drop: 'clay_ball' }),
  SUGAR_CANE: reg('sugar_cane', 'Sugar Cane', { ...plant, tint: 'grass', item: false }),
  PUMPKIN: reg('pumpkin', 'Pumpkin', { top: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin', hardness: 1, tool: 'axe', sound: 'wood' }),
  JACK_O_LANTERN: reg('jack_o_lantern', "Jack o'Lantern", { top: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern', hardness: 1, tool: 'axe', sound: 'wood', light: 15 }),
  GLOWSTONE: reg('glowstone', 'Glowstone', { hardness: 0.3, sound: 'glass', light: 15, drop: 'glowstone_dust' }),
  STONE_BRICKS: reg('stone_bricks', 'Stone Bricks', { ...stone }),
  MELON: reg('melon', 'Melon', { top: 'melon_top', side: 'melon_side', hardness: 1, tool: 'axe', sound: 'wood', drop: 'melon_slice' }),
  BED: reg('red_bed', 'Red Bed', { render: Render.Model, hardness: 0.2, sound: 'wood', opaque: false, lightOpacity: 0, tex: 'bed_head_top', item: false, drop: null }),
  GRANITE: reg('granite', 'Granite', { ...stone }),
  DIORITE: reg('diorite', 'Diorite', { ...stone }),
  ANDESITE: reg('andesite', 'Andesite', { ...stone }),
  PODZOL: reg('podzol', 'Podzol', { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side', hardness: 0.5, tool: 'shovel', sound: 'gravel', drop: 'dirt' }),
  FIRE: reg('fire', 'Fire', { render: Render.Cross, tex: 'fire', solid: false, opaque: false, hardness: 0, light: 15, replaceable: true, selectable: false, item: false, drop: null, sound: 'none' }),
  OAK_FENCE: reg('oak_fence', 'Oak Fence', { ...wood, render: Render.Model, tex: 'oak_planks', opaque: false, lightOpacity: 0 }),
  GLASS_PANE: reg('glass_pane', 'Glass Pane', { render: Render.Model, tex: 'glass', hardness: 0.3, sound: 'glass', opaque: false, lightOpacity: 0, drop: null }),
  COBWEB: reg('cobweb', 'Cobweb', { render: Render.Cross, solid: false, opaque: false, hardness: 4, tool: 'sword', sound: 'stone', drop: 'string', lightOpacity: 1 }),
  SPONGE: reg('sponge', 'Sponge', { hardness: 0.6, sound: 'grass' }),
  WOOL_WHITE: reg('white_wool', 'White Wool', wool),
  WOOL_ORANGE: reg('orange_wool', 'Orange Wool', wool),
  WOOL_MAGENTA: reg('magenta_wool', 'Magenta Wool', wool),
  WOOL_LIGHT_BLUE: reg('light_blue_wool', 'Light Blue Wool', wool),
  WOOL_YELLOW: reg('yellow_wool', 'Yellow Wool', wool),
  WOOL_LIME: reg('lime_wool', 'Lime Wool', wool),
  WOOL_PINK: reg('pink_wool', 'Pink Wool', wool),
  WOOL_GRAY: reg('gray_wool', 'Gray Wool', wool),
  WOOL_LIGHT_GRAY: reg('light_gray_wool', 'Light Gray Wool', wool),
  WOOL_CYAN: reg('cyan_wool', 'Cyan Wool', wool),
  WOOL_PURPLE: reg('purple_wool', 'Purple Wool', wool),
  WOOL_BLUE: reg('blue_wool', 'Blue Wool', wool),
  WOOL_BROWN: reg('brown_wool', 'Brown Wool', wool),
  WOOL_GREEN: reg('green_wool', 'Green Wool', wool),
  WOOL_RED: reg('red_wool', 'Red Wool', wool),
  WOOL_BLACK: reg('black_wool', 'Black Wool', wool),
  LAPIS_BLOCK: reg('lapis_block', 'Lapis Lazuli Block', { hardness: 3, tool: 'pickaxe', harvestLevel: 1 }),
  PUMPKIN_STEM: reg('pumpkin_stem', 'Pumpkin Stem', { ...plant, item: false }),
  SPRUCE_STAIRS: reg('spruce_stairs', 'Spruce Stairs', { ...wood, render: Render.Model, tex: 'spruce_planks', opaque: false, lightOpacity: 15 }),
  BIRCH_STAIRS: reg('birch_stairs', 'Birch Stairs', { ...wood, render: Render.Model, tex: 'birch_planks', opaque: false, lightOpacity: 15 }),
  STONE_BRICK_STAIRS: reg('stone_brick_stairs', 'Stone Brick Stairs', { ...stone, render: Render.Model, tex: 'stone_bricks', opaque: false, lightOpacity: 15 }),
  BRICK_STAIRS: reg('brick_stairs', 'Brick Stairs', { ...stone, hardness: 2, render: Render.Model, tex: 'bricks', opaque: false, lightOpacity: 15 }),
  COBBLESTONE_SLAB: reg('cobblestone_slab', 'Cobblestone Slab', { ...stone, hardness: 2, render: Render.Model, tex: 'cobblestone', opaque: false, lightOpacity: 15 }),
  MOSSY_STONE_BRICKS: reg('mossy_stone_bricks', 'Mossy Stone Bricks', { ...stone }),
  CRACKED_STONE_BRICKS: reg('cracked_stone_bricks', 'Cracked Stone Bricks', { ...stone }),
  SMOOTH_SANDSTONE: reg('cut_sandstone', 'Cut Sandstone', { top: 'sandstone_top', side: 'cut_sandstone', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  TERRACOTTA: reg('terracotta', 'Terracotta', { ...stone, hardness: 1.25 }),
  SPAWNER: reg('spawner', 'Monster Spawner', { hardness: 5, tool: 'pickaxe', harvestLevel: 0, opaque: false, lightOpacity: 1, drop: null, sound: 'metal' }),
  BIRCH_DOOR_UNUSED: reg('unused_1', 'Unused', { render: Render.None, item: false, selectable: false, solid: false, opaque: false, lightOpacity: 0 }),
  EMERALD_ORE: reg('emerald_ore', 'Emerald Ore', { ...ore(2), drop: 'emerald' }),
  COARSE_DIRT: reg('coarse_dirt', 'Coarse Dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' }),
  LILY_PAD: reg('lily_pad', 'Lily Pad', { render: Render.Model, hardness: 0, sound: 'grass', opaque: false, lightOpacity: 0, tint: 'foliage', solid: true, needsSupport: true }),
  NETHERRACK: reg('netherrack', 'Netherrack', { hardness: 0.4, tool: 'pickaxe', harvestLevel: 0, sound: 'stone', flammable: false }),
  SOUL_SAND: reg('soul_sand', 'Soul Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', render: Render.Model, opaque: false, lightOpacity: 15 }),
  NETHER_BRICKS: reg('nether_bricks', 'Nether Bricks', { ...stone, hardness: 2 }),
  NETHER_QUARTZ_ORE: reg('nether_quartz_ore', 'Nether Quartz Ore', { ...ore(0), drop: 'quartz' }),
  NETHER_PORTAL: reg('nether_portal', 'Nether Portal', { render: Render.Model, tex: 'nether_portal', solid: false, opaque: false, translucent: true, lightOpacity: 0, light: 11, hardness: -1, item: false, drop: null, sound: 'glass', selectable: false }),
  QUARTZ_BLOCK: reg('quartz_block', 'Block of Quartz', { top: 'quartz_block_top', side: 'quartz_block_side', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  MAGMA_BLOCK: reg('magma_block', 'Magma Block', { hardness: 0.5, tool: 'pickaxe', harvestLevel: 0, light: 3 }),
  REDSTONE_WIRE: reg('redstone_wire', 'Redstone Dust', { render: Render.Model, tex: 'redstone_dust_dot', solid: false, opaque: false, lightOpacity: 0, hardness: 0, sound: 'stone', needsSupport: true, drop: 'redstone', item: false }),
  LEVER: reg('lever', 'Lever', { render: Render.Model, tex: 'lever', solid: false, opaque: false, lightOpacity: 0, hardness: 0.5, sound: 'wood', needsSupport: true }),
  STONE_BUTTON: reg('stone_button', 'Stone Button', { render: Render.Model, tex: 'stone', solid: false, opaque: false, lightOpacity: 0, hardness: 0.5, sound: 'stone', needsSupport: true }),
  STONE_PRESSURE_PLATE: reg('stone_pressure_plate', 'Stone Pressure Plate', { render: Render.Model, tex: 'stone', solid: false, opaque: false, lightOpacity: 0, hardness: 0.5, tool: 'pickaxe', sound: 'stone', needsSupport: true }),
  REDSTONE_TORCH: reg('redstone_torch', 'Redstone Torch', { render: Render.Torch, tex: 'redstone_torch', solid: false, opaque: false, hardness: 0, light: 7, sound: 'wood', needsSupport: true, lightOpacity: 0 }),
  UNLIT_REDSTONE_TORCH: reg('unlit_redstone_torch', 'Redstone Torch', { render: Render.Torch, tex: 'redstone_torch_off', solid: false, opaque: false, hardness: 0, sound: 'wood', needsSupport: true, lightOpacity: 0, item: false, drop: 'redstone_torch' }),
  REDSTONE_LAMP: reg('redstone_lamp', 'Redstone Lamp', { hardness: 0.3, sound: 'glass' }),
  LIT_REDSTONE_LAMP: reg('lit_redstone_lamp', 'Redstone Lamp', { tex: 'redstone_lamp_on', hardness: 0.3, sound: 'glass', light: 15, item: false, drop: 'redstone_lamp' }),
  REDSTONE_BLOCK: reg('redstone_block', 'Block of Redstone', { hardness: 5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal' }),
  ENCHANTING_TABLE: reg('enchanting_table', 'Enchanting Table', { render: Render.Model, top: 'enchanting_table_top', bottom: 'obsidian', side: 'enchanting_table_side', hardness: 5, tool: 'pickaxe', harvestLevel: 0, opaque: false, lightOpacity: 0, light: 7, blastResistance: 6000 }),
  // redstone devices, brewing, anvils (appended: ids must stay stable)
  REPEATER: reg('repeater', 'Redstone Repeater', { render: Render.Model, tex: 'repeater', side: 'smooth_stone', solid: true, opaque: false, lightOpacity: 0, hardness: 0, sound: 'stone', needsSupport: true, item: false, drop: 'repeater' }),
  POWERED_REPEATER: reg('powered_repeater', 'Redstone Repeater', { render: Render.Model, tex: 'repeater_on', side: 'smooth_stone', solid: true, opaque: false, lightOpacity: 0, hardness: 0, sound: 'stone', needsSupport: true, item: false, drop: 'repeater' }),
  COMPARATOR: reg('comparator', 'Redstone Comparator', { render: Render.Model, tex: 'comparator', side: 'smooth_stone', solid: true, opaque: false, lightOpacity: 0, hardness: 0, sound: 'stone', needsSupport: true, item: false, drop: 'comparator' }),
  HOPPER: reg('hopper', 'Hopper', { render: Render.Model, tex: 'hopper_outside', top: 'hopper_top', hardness: 3, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', opaque: false, lightOpacity: 0, blastResistance: 24 }),
  DISPENSER: reg('dispenser', 'Dispenser', { ...stone, hardness: 3.5, top: 'furnace_top', side: 'furnace_side', front: 'dispenser_front', blastResistance: 17.5 }),
  DROPPER: reg('dropper', 'Dropper', { ...stone, hardness: 3.5, top: 'furnace_top', side: 'furnace_side', front: 'dropper_front', blastResistance: 17.5 }),
  PISTON: reg('piston', 'Piston', { render: Render.Model, top: 'piston_top', bottom: 'piston_bottom', side: 'piston_side', hardness: 0.5, sound: 'stone', opaque: false, lightOpacity: 0, tool: 'pickaxe' }),
  STICKY_PISTON: reg('sticky_piston', 'Sticky Piston', { render: Render.Model, top: 'piston_top_sticky', bottom: 'piston_bottom', side: 'piston_side', hardness: 0.5, sound: 'stone', opaque: false, lightOpacity: 0, tool: 'pickaxe' }),
  PISTON_HEAD: reg('piston_head', 'Piston Head', { render: Render.Model, top: 'piston_top', bottom: 'piston_top', side: 'piston_side', hardness: 0.5, sound: 'stone', opaque: false, lightOpacity: 0, item: false, drop: null, tool: 'pickaxe' }),
  MOVING_PISTON: reg('moving_piston', 'Moving Piston', { render: Render.None, solid: false, opaque: false, lightOpacity: 0, hardness: -1, item: false, drop: null, selectable: false, sound: 'none' }),
  OBSERVER: reg('observer', 'Observer', { ...stone, hardness: 3, top: 'observer_top', side: 'observer_side', front: 'observer_front', blastResistance: 15 }),
  SLIME_BLOCK: reg('slime_block', 'Slime Block', { render: Render.Model, tex: 'slime_block', hardness: 0, sound: 'slime', opaque: false, translucent: true, lightOpacity: 1, slipperiness: 0.8, solid: true }),
  BREWING_STAND: reg('brewing_stand', 'Brewing Stand', { render: Render.Model, tex: 'brewing_stand', bottom: 'brewing_stand_base', hardness: 0.5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', opaque: false, lightOpacity: 0, light: 1, item: false, drop: 'brewing_stand' }),
  NETHER_WART: reg('nether_wart', 'Nether Wart', { render: Render.Crops, tex: 'nether_wart_stage2', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drop: null, item: false }),
  CARROTS: reg('carrots', 'Carrots', { render: Render.Crops, tex: 'carrots_stage3', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drop: null, item: false }),
  POTATOES: reg('potatoes', 'Potatoes', { render: Render.Crops, tex: 'potatoes_stage3', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drop: null, item: false }),
  ANVIL: reg('anvil', 'Anvil', { render: Render.Model, tex: 'anvil', top: 'anvil_top', hardness: 5, tool: 'pickaxe', harvestLevel: 0, gravity: true, sound: 'metal', blastResistance: 6000, opaque: false, lightOpacity: 0 }),
  NETHER_BRICK_FENCE: reg('nether_brick_fence', 'Nether Brick Fence', { ...stone, hardness: 2, render: Render.Model, tex: 'nether_bricks', opaque: false, lightOpacity: 0 }),
  NETHER_BRICK_STAIRS: reg('nether_brick_stairs', 'Nether Brick Stairs', { ...stone, hardness: 2, render: Render.Model, tex: 'nether_bricks', opaque: false, lightOpacity: 15 }),
  // the End (appended: ids must stay stable)
  END_STONE: reg('end_stone', 'End Stone', { hardness: 3, tool: 'pickaxe', harvestLevel: 0, blastResistance: 45 }),
  END_PORTAL_FRAME: reg('end_portal_frame', 'End Portal Frame', { render: Render.Model, top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'end_stone', hardness: -1, blastResistance: 18000000, opaque: false, lightOpacity: 0, light: 1, drop: null }),
  END_PORTAL: reg('end_portal', 'End Portal', { render: Render.Model, tex: 'end_portal', solid: false, opaque: false, lightOpacity: 0, light: 15, hardness: -1, blastResistance: 18000000, item: false, drop: null, selectable: false, sound: 'none' }),
  DRAGON_EGG: reg('dragon_egg', 'Dragon Egg', { render: Render.Model, tex: 'dragon_egg', hardness: 3, gravity: true, opaque: false, lightOpacity: 0, light: 1, blastResistance: 45 }),
  IRON_BARS: reg('iron_bars', 'Iron Bars', { render: Render.Model, tex: 'iron_bars', hardness: 5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', opaque: false, lightOpacity: 0, blastResistance: 30 }),
  ENDER_CHEST: reg('ender_chest', 'Ender Chest', { render: Render.Model, top: 'ender_chest_top', side: 'ender_chest_side', front: 'ender_chest_front', hardness: 22.5, tool: 'pickaxe', harvestLevel: 0, opaque: false, lightOpacity: 0, light: 7, blastResistance: 3000, drop: 'obsidian' }),
  // rails and End gateways (appended: ids must stay stable). Rail meta: shape 0-9 (0 N-S, 1 E-W, 2-5 ascending
  // east/west/north/south, 6-9 curves SE/SW/NW/NE); the special rails only go straight (0-5) and use bit 8 for on.
  RAIL: reg('rail', 'Rail', { ...RAIL, tex: 'rail' }),
  POWERED_RAIL: reg('powered_rail', 'Powered Rail', { ...RAIL, tex: 'powered_rail' }),
  DETECTOR_RAIL: reg('detector_rail', 'Detector Rail', { ...RAIL, tex: 'detector_rail' }),
  ACTIVATOR_RAIL: reg('activator_rail', 'Activator Rail', { ...RAIL, tex: 'activator_rail' }),
  HAY_BLOCK: reg('hay_block', 'Hay Bale', { top: 'hay_block_top', side: 'hay_block_side', hardness: 0.5, sound: 'grass', flammable: true }),
  END_GATEWAY: reg('end_gateway', 'End Gateway', { render: Render.Model, tex: 'end_portal', solid: false, opaque: false, lightOpacity: 0, light: 15, hardness: -1, blastResistance: 18000000, item: false, drop: null, selectable: false, sound: 'none' }),
} as const;

// ======================================================================================== 1.9 - 1.16.5 content
// Everything from here on came with the 1.16 content set. Appended in a fixed order: ids must stay stable (only
// ever add at the end). Families (stairs, slabs, walls, fences, doors...) share their rules through `shape`.
const title = (s: string) => s.split('_').map((w, i) => (i && ['of', 'the', 'on', 'a', 'and'].includes(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
/** A registered block's face textures by name (for the stairs, slabs and walls cut from it). */
const texOf = (base: string) => {
  const d = byName.get(base)!;
  return { side: TEXTURES[d.faces[0]], top: TEXTURES[d.faces[3]], bottom: TEXTURES[d.faces[2]] };
};
const model = (s: Shape, o: Opts = {}): Opts => ({ render: Render.Model, opaque: false, lightOpacity: 0, ...o, shape: s });
/** The material properties of a block, without its looks. */
const matOf = (base: string): Opts => {
  const d = byName.get(base)!;
  return { hardness: d.hardness, tool: d.tool, harvestLevel: d.harvestLevel, sound: d.sound, blastResistance: d.blastResistance, flammable: d.flammable, material: d.material };
};
export function stairsOf(name: string, display: string, base: string, o: Opts = {}) {
  return reg(name, display, { ...matOf(base), ...texOf(base), ...model(Shape.Stairs, { lightOpacity: 15 }), base, ...o });
}
export function slabOf(name: string, display: string, base: string, o: Opts = {}) {
  return reg(name, display, { ...matOf(base), ...texOf(base), ...model(Shape.Slab, { lightOpacity: 15 }), base, ...o });
}
export function wallOf(name: string, display: string, base: string, o: Opts = {}) {
  return reg(name, display, { ...matOf(base), tex: texOf(base).side, ...model(Shape.Wall), base, ...o });
}
/** Stairs + slab (+ wall) cut from a block; returns their ids. */
function cuts(base: string, prefix: string, display: string, wall = false) {
  const st = stairsOf(`${prefix}_stairs`, `${display} Stairs`, base);
  const sl = slabOf(`${prefix}_slab`, `${display} Slab`, base);
  const wl = wall ? wallOf(`${prefix}_wall`, `${display} Wall`, base) : 0;
  return { stairs: st, slab: sl, wall: wl };
}

// ---------------------------------------------------------------- wood: eight kinds, every piece
export type WoodKind = 'oak' | 'spruce' | 'birch' | 'jungle' | 'acacia' | 'dark_oak' | 'crimson' | 'warped';
export const WOOD_KINDS: WoodKind[] = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped'];
export interface WoodSet {
  kind: WoodKind; nether: boolean;
  planks: number; sapling: number; log: number; strippedLog: number; wood: number; strippedWood: number; leaves: number;
  stairs: number; slab: number; fence: number; gate: number; door: number; trapdoor: number; button: number; plate: number;
  sign: number; wallSign: number;
}
export const WOOD = {} as Record<WoodKind, WoodSet>;
function woodSet(k: WoodKind, have: Partial<WoodSet>): WoodSet {
  const nether = k === 'crimson' || k === 'warped';
  const W = title(k);
  const wd: Opts = nether
    ? { hardness: 2, tool: 'axe', sound: 'wood', flammable: false, blastResistance: 15, material: 'nether_wood' }
    : { ...wood, material: 'wood', burn: [5, 20] };
  const stem = nether ? 'stem' : 'log', hy = nether ? 'hyphae' : 'wood';
  const P = `${k}_planks`;
  const planks = have.planks ?? reg(P, `${W} Planks`, { ...wd });
  const sapling = have.sapling ?? (nether
    ? reg(`${k}_fungus`, `${W} Fungus`, { ...plant, tree: k + '_fungus' })
    : reg(`${k}_sapling`, `${W} Sapling`, { ...plant, tree: k }));
  const log = have.log ?? reg(`${k}_${stem}`, `${W} ${title(stem)}`, { ...wd, top: `${k}_${stem}_top`, side: `${k}_${stem}`, shape: Shape.Log, stripped: `stripped_${k}_${stem}`, light: 0 });
  const strippedLog = reg(`stripped_${k}_${stem}`, `Stripped ${W} ${title(stem)}`, { ...wd, top: `stripped_${k}_${stem}_top`, side: `stripped_${k}_${stem}`, shape: Shape.Log });
  const woodB = reg(`${k}_${hy}`, `${W} ${title(hy)}`, { ...wd, tex: `${k}_${stem}`, shape: Shape.Log, stripped: `stripped_${k}_${hy}` });
  const strippedWood = reg(`stripped_${k}_${hy}`, `Stripped ${W} ${title(hy)}`, { ...wd, tex: `stripped_${k}_${stem}`, shape: Shape.Log });
  const leavesB = have.leaves ?? (nether
    ? (k === 'crimson' ? reg('nether_wart_block', 'Nether Wart Block', { hardness: 1, tool: 'hoe', sound: 'grass' }) : reg('warped_wart_block', 'Warped Wart Block', { hardness: 1, tool: 'hoe', sound: 'grass' }))
    : reg(`${k}_leaves`, `${W} Leaves`, { ...leaves, tint: 'foliage', shape: Shape.Leaves, sapling: `${k}_sapling`, burn: [30, 60] }));
  const t = { tex: P };
  const stairs = have.stairs ?? stairsOf(`${k}_stairs`, `${W} Stairs`, P);
  const slab = have.slab ?? slabOf(`${k}_slab`, `${W} Slab`, P);
  const fence = have.fence ?? reg(`${k}_fence`, `${W} Fence`, { ...wd, ...t, ...model(Shape.Fence), base: P });
  const gate = reg(`${k}_fence_gate`, `${W} Fence Gate`, { ...wd, ...t, ...model(Shape.Gate), base: P });
  const door = have.door ?? reg(`${k}_door`, `${W} Door`, { ...wd, hardness: 3, ...model(Shape.Door), tex: `${k}_door_bottom`, top: `${k}_door_top`, icon: `${k}_door_item` });
  const trapdoor = reg(`${k}_trapdoor`, `${W} Trapdoor`, { ...wd, hardness: 3, ...model(Shape.Trapdoor), tex: `${k}_trapdoor` });
  const button = reg(`${k}_button`, `${W} Button`, { ...wd, hardness: 0.5, ...t, ...model(Shape.Button), solid: false, needsSupport: true, flammable: false });
  const plate = reg(`${k}_pressure_plate`, `${W} Pressure Plate`, { ...wd, hardness: 0.5, ...t, ...model(Shape.Plate), solid: false, needsSupport: true, flammable: false });
  const sign = reg(`${k}_sign`, `${W} Sign`, { ...wd, hardness: 1, ...t, side: `${k}_${stem}`, ...model(Shape.Sign), solid: false, needsSupport: true, icon: `${k}_sign_item` });
  const wallSign = reg(`${k}_wall_sign`, `${W} Wall Sign`, { ...wd, hardness: 1, ...t, ...model(Shape.WallSign), solid: false, needsSupport: true, item: false, drop: `${k}_sign` });
  const set: WoodSet = { kind: k, nether, planks, sapling, log, strippedLog, wood: woodB, strippedWood, leaves: leavesB, stairs, slab, fence, gate, door, trapdoor, button, plate, sign, wallSign };
  WOOD[k] = set;
  return set;
}
woodSet('oak', { planks: B.OAK_PLANKS, sapling: B.OAK_SAPLING, log: B.OAK_LOG, leaves: B.OAK_LEAVES, stairs: B.OAK_STAIRS, slab: B.OAK_SLAB, fence: B.OAK_FENCE, door: B.OAK_DOOR });
woodSet('spruce', { planks: B.SPRUCE_PLANKS, sapling: B.SPRUCE_SAPLING, log: B.SPRUCE_LOG, leaves: B.SPRUCE_LEAVES, stairs: B.SPRUCE_STAIRS });
woodSet('birch', { planks: B.BIRCH_PLANKS, sapling: B.BIRCH_SAPLING, log: B.BIRCH_LOG, leaves: B.BIRCH_LEAVES, stairs: B.BIRCH_STAIRS });
woodSet('jungle', {});
woodSet('acacia', {});
woodSet('dark_oak', {});
woodSet('crimson', {});
woodSet('warped', {});

// ---------------------------------------------------------------- the sixteen colours
export const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'] as const;
const colored = (f: (c: string, C: string, i: number) => number) => DYE_COLORS.map((c, i) => f(c, title(c), i));
export const CONCRETE = colored((c, C) => reg(`${c}_concrete`, `${C} Concrete`, { hardness: 1.8, tool: 'pickaxe', harvestLevel: 0, blastResistance: 9 }));
export const CONCRETE_POWDER = colored((c, C) => reg(`${c}_concrete_powder`, `${C} Concrete Powder`, { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true }));
export const TERRACOTTA_COLORS = colored((c, C) => reg(`${c}_terracotta`, `${C} Terracotta`, { ...stone, hardness: 1.25, blastResistance: 21 }));
export const GLAZED_TERRACOTTA = colored((c, C) => reg(`${c}_glazed_terracotta`, `${C} Glazed Terracotta`, { ...stone, hardness: 1.4, blastResistance: 7 }));
export const STAINED_GLASS = colored((c, C) => reg(`${c}_stained_glass`, `${C} Stained Glass`, { hardness: 0.3, sound: 'glass', opaque: false, translucent: true, cullSelf: true, lightOpacity: 0, drop: null }));
export const STAINED_PANES = colored((c, C) => reg(`${c}_stained_glass_pane`, `${C} Stained Glass Pane`, { ...model(Shape.Pane), tex: `${c}_stained_glass`, top: `${c}_stained_glass_pane_top`, translucent: true, hardness: 0.3, sound: 'glass', drop: null }));
export const CARPETS = colored((c, C) => reg(`${c}_carpet`, `${C} Carpet`, { ...model(Shape.Carpet), tex: `${c}_wool`, hardness: 0.1, sound: 'cloth', flammable: true, needsSupport: true, solid: true, burn: [60, 20] }));
export const BEDS = colored((c, C) => (c === 'red' ? B.BED : reg(`${c}_bed`, `${C} Bed`, { ...model(Shape.Bed), tex: `${c}_bed_head_top`, hardness: 0.2, sound: 'wood', icon: `${c}_bed_item` })));
export const SHULKER_BOXES = colored((c, C) => reg(`${c}_shulker_box`, `${C} Shulker Box`, { ...model(Shape.Cube), tex: `${c}_shulker_box`, hardness: 2, tool: 'pickaxe' }));
export const BANNERS: number[] = [];
/** Each bed's textures: head top, foot top, head side, foot side, head end, foot end. */
export const BED_TEX: Record<number, number[]> = {};
BEDS.forEach((id, i) => {
  const p = id === B.BED ? '' : DYE_COLORS[i] + '_';
  BED_TEX[id] = ['head_top', 'foot_top', 'head_side', 'foot_side', 'head_end', 'foot_end'].map((s) => tex(`${p}bed_${s}`));
});

// ---------------------------------------------------------------- stone families
export const STONE2 = {
  STONE_STAIRS: stairsOf('stone_stairs', 'Stone Stairs', 'stone', { drop: undefined }),
  CHISELED_STONE_BRICKS: reg('chiseled_stone_bricks', 'Chiseled Stone Bricks', { ...stone }),
  STONE_BRICK_SLAB: slabOf('stone_brick_slab', 'Stone Brick Slab', 'stone_bricks'),
  STONE_BRICK_WALL: wallOf('stone_brick_wall', 'Stone Brick Wall', 'stone_bricks'),
  ...prefixed('MOSSY_STONE_BRICK', cuts('mossy_stone_bricks', 'mossy_stone_brick', 'Mossy Stone Brick', true)),
  ...prefixed('MOSSY_COBBLESTONE', cuts('mossy_cobblestone', 'mossy_cobblestone', 'Mossy Cobblestone', true)),
  COBBLESTONE_WALL: wallOf('cobblestone_wall', 'Cobblestone Wall', 'cobblestone'),
  POLISHED_GRANITE: reg('polished_granite', 'Polished Granite', { ...stone }),
  POLISHED_DIORITE: reg('polished_diorite', 'Polished Diorite', { ...stone }),
  POLISHED_ANDESITE: reg('polished_andesite', 'Polished Andesite', { ...stone }),
  ...prefixed('GRANITE', cuts('granite', 'granite', 'Granite', true)),
  ...prefixed('DIORITE', cuts('diorite', 'diorite', 'Diorite', true)),
  ...prefixed('ANDESITE', cuts('andesite', 'andesite', 'Andesite', true)),
  ...prefixed('POLISHED_GRANITE', cuts('polished_granite', 'polished_granite', 'Polished Granite')),
  ...prefixed('POLISHED_DIORITE', cuts('polished_diorite', 'polished_diorite', 'Polished Diorite')),
  ...prefixed('POLISHED_ANDESITE', cuts('polished_andesite', 'polished_andesite', 'Polished Andesite')),
  CHISELED_SANDSTONE: reg('chiseled_sandstone', 'Chiseled Sandstone', { top: 'sandstone_top', side: 'chiseled_sandstone', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  SMOOTH_SANDSTONE: reg('smooth_sandstone', 'Smooth Sandstone', { tex: 'sandstone_top', hardness: 2, tool: 'pickaxe', harvestLevel: 0, blastResistance: 30 }),
  ...prefixed('SANDSTONE', cuts('sandstone', 'sandstone', 'Sandstone', true)),
  ...prefixed('SMOOTH_SANDSTONE', cuts('smooth_sandstone', 'smooth_sandstone', 'Smooth Sandstone')),
  CUT_SANDSTONE_SLAB: slabOf('cut_sandstone_slab', 'Cut Sandstone Slab', 'cut_sandstone'),
  RED_SAND: reg('red_sand', 'Red Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true }),
  RED_SANDSTONE: reg('red_sandstone', 'Red Sandstone', { top: 'red_sandstone_top', bottom: 'red_sandstone_bottom', side: 'red_sandstone', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  CHISELED_RED_SANDSTONE: reg('chiseled_red_sandstone', 'Chiseled Red Sandstone', { top: 'red_sandstone_top', side: 'chiseled_red_sandstone', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  CUT_RED_SANDSTONE: reg('cut_red_sandstone', 'Cut Red Sandstone', { top: 'red_sandstone_top', side: 'cut_red_sandstone', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  SMOOTH_RED_SANDSTONE: reg('smooth_red_sandstone', 'Smooth Red Sandstone', { tex: 'red_sandstone_top', hardness: 2, tool: 'pickaxe', harvestLevel: 0, blastResistance: 30 }),
  ...prefixed('RED_SANDSTONE', cuts('red_sandstone', 'red_sandstone', 'Red Sandstone', true)),
  ...prefixed('SMOOTH_RED_SANDSTONE', cuts('smooth_red_sandstone', 'smooth_red_sandstone', 'Smooth Red Sandstone')),
  CUT_RED_SANDSTONE_SLAB: slabOf('cut_red_sandstone_slab', 'Cut Red Sandstone Slab', 'cut_red_sandstone'),
  BRICK_SLAB: slabOf('brick_slab', 'Brick Slab', 'bricks'),
  BRICK_WALL: wallOf('brick_wall', 'Brick Wall', 'bricks'),
  NETHER_BRICK_SLAB: slabOf('nether_brick_slab', 'Nether Brick Slab', 'nether_bricks'),
  NETHER_BRICK_WALL: wallOf('nether_brick_wall', 'Nether Brick Wall', 'nether_bricks'),
  RED_NETHER_BRICKS: reg('red_nether_bricks', 'Red Nether Bricks', { ...stone, hardness: 2 }),
  ...prefixed('RED_NETHER_BRICK', cuts('red_nether_bricks', 'red_nether_brick', 'Red Nether Brick', true)),
  CHISELED_NETHER_BRICKS: reg('chiseled_nether_bricks', 'Chiseled Nether Bricks', { ...stone, hardness: 2 }),
  CRACKED_NETHER_BRICKS: reg('cracked_nether_bricks', 'Cracked Nether Bricks', { ...stone, hardness: 2 }),
  CHISELED_QUARTZ_BLOCK: reg('chiseled_quartz_block', 'Chiseled Quartz Block', { top: 'chiseled_quartz_block_top', side: 'chiseled_quartz_block', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  QUARTZ_PILLAR: reg('quartz_pillar', 'Quartz Pillar', { top: 'quartz_pillar_top', side: 'quartz_pillar', hardness: 0.8, tool: 'pickaxe', harvestLevel: 0, shape: Shape.Log }),
  SMOOTH_QUARTZ: reg('smooth_quartz', 'Smooth Quartz Block', { tex: 'quartz_block_top', hardness: 2, tool: 'pickaxe', harvestLevel: 0, blastResistance: 30 }),
  QUARTZ_BRICKS: reg('quartz_bricks', 'Quartz Bricks', { hardness: 0.8, tool: 'pickaxe', harvestLevel: 0 }),
  ...prefixed('QUARTZ', cuts('quartz_block', 'quartz', 'Quartz')),
  ...prefixed('SMOOTH_QUARTZ', cuts('smooth_quartz', 'smooth_quartz', 'Smooth Quartz')),
  PURPUR_BLOCK: reg('purpur_block', 'Purpur Block', { hardness: 1.5, tool: 'pickaxe', harvestLevel: 0, blastResistance: 30 }),
  PURPUR_PILLAR: reg('purpur_pillar', 'Purpur Pillar', { top: 'purpur_pillar_top', side: 'purpur_pillar', hardness: 1.5, tool: 'pickaxe', harvestLevel: 0, blastResistance: 30, shape: Shape.Log }),
  ...prefixed('PURPUR', cuts('purpur_block', 'purpur', 'Purpur')),
  END_STONE_BRICKS: reg('end_stone_bricks', 'End Stone Bricks', { hardness: 3, tool: 'pickaxe', harvestLevel: 0, blastResistance: 45 }),
  ...prefixed('END_STONE_BRICK', cuts('end_stone_bricks', 'end_stone_brick', 'End Stone Brick', true)),
  PRISMARINE: reg('prismarine', 'Prismarine', { ...stone }),
  PRISMARINE_BRICKS: reg('prismarine_bricks', 'Prismarine Bricks', { ...stone }),
  DARK_PRISMARINE: reg('dark_prismarine', 'Dark Prismarine', { ...stone }),
  ...prefixed('PRISMARINE', cuts('prismarine', 'prismarine', 'Prismarine', true)),
  ...prefixed('PRISMARINE_BRICK', cuts('prismarine_bricks', 'prismarine_brick', 'Prismarine Brick')),
  ...prefixed('DARK_PRISMARINE', cuts('dark_prismarine', 'dark_prismarine', 'Dark Prismarine')),
  SEA_LANTERN: reg('sea_lantern', 'Sea Lantern', { hardness: 0.3, sound: 'glass', light: 15, drop: 'prismarine_crystals' }),
  BASALT: reg('basalt', 'Basalt', { top: 'basalt_top', side: 'basalt_side', hardness: 1.25, tool: 'pickaxe', harvestLevel: 0, blastResistance: 21, shape: Shape.Log }),
  POLISHED_BASALT: reg('polished_basalt', 'Polished Basalt', { top: 'polished_basalt_top', side: 'polished_basalt_side', hardness: 1.25, tool: 'pickaxe', harvestLevel: 0, blastResistance: 21, shape: Shape.Log }),
  BLACKSTONE: reg('blackstone', 'Blackstone', { top: 'blackstone_top', side: 'blackstone', ...stone }),
  ...prefixed('BLACKSTONE', cuts('blackstone', 'blackstone', 'Blackstone', true)),
  GILDED_BLACKSTONE: reg('gilded_blackstone', 'Gilded Blackstone', { ...stone }),
  POLISHED_BLACKSTONE: reg('polished_blackstone', 'Polished Blackstone', { ...stone, hardness: 2 }),
  ...prefixed('POLISHED_BLACKSTONE', cuts('polished_blackstone', 'polished_blackstone', 'Polished Blackstone', true)),
  POLISHED_BLACKSTONE_BUTTON: reg('polished_blackstone_button', 'Polished Blackstone Button', { hardness: 0.5, tex: 'polished_blackstone', ...model(Shape.Button), solid: false, needsSupport: true, material: 'stone' }),
  POLISHED_BLACKSTONE_PRESSURE_PLATE: reg('polished_blackstone_pressure_plate', 'Polished Blackstone Pressure Plate', { hardness: 0.5, tool: 'pickaxe', tex: 'polished_blackstone', ...model(Shape.Plate), solid: false, needsSupport: true, material: 'stone' }),
  CHISELED_POLISHED_BLACKSTONE: reg('chiseled_polished_blackstone', 'Chiseled Polished Blackstone', { ...stone }),
  POLISHED_BLACKSTONE_BRICKS: reg('polished_blackstone_bricks', 'Polished Blackstone Bricks', { ...stone }),
  CRACKED_POLISHED_BLACKSTONE_BRICKS: reg('cracked_polished_blackstone_bricks', 'Cracked Polished Blackstone Bricks', { ...stone }),
  ...prefixed('POLISHED_BLACKSTONE_BRICK', cuts('polished_blackstone_bricks', 'polished_blackstone_brick', 'Polished Blackstone Brick', true)),
};
function prefixed<P extends string>(p: P, c: { stairs: number; slab: number; wall: number }): { [K in `${P}_STAIRS` | `${P}_SLAB` | `${P}_WALL`]: number } {
  const o: Record<string, number> = {};
  o[p + '_STAIRS'] = c.stairs;
  o[p + '_SLAB'] = c.slab;
  if (c.wall) o[p + '_WALL'] = c.wall;
  return o as { [K in `${P}_STAIRS` | `${P}_SLAB` | `${P}_WALL`]: number };
}

// ---------------------------------------------------------------- the Nether update and other new blocks
const fungusSoil = { ...plant, replaceable: false };
export const B2 = {
  // nether ground and plants
  CRIMSON_NYLIUM: reg('crimson_nylium', 'Crimson Nylium', { top: 'crimson_nylium', bottom: 'netherrack', side: 'crimson_nylium_side', hardness: 0.4, tool: 'pickaxe', harvestLevel: 0, drop: 'netherrack' }),
  WARPED_NYLIUM: reg('warped_nylium', 'Warped Nylium', { top: 'warped_nylium', bottom: 'netherrack', side: 'warped_nylium_side', hardness: 0.4, tool: 'pickaxe', harvestLevel: 0, drop: 'netherrack' }),
  CRIMSON_ROOTS: reg('crimson_roots', 'Crimson Roots', { ...plant, replaceable: true }),
  WARPED_ROOTS: reg('warped_roots', 'Warped Roots', { ...plant, replaceable: true }),
  NETHER_SPROUTS: reg('nether_sprouts', 'Nether Sprouts', { ...plant, replaceable: true, drop: null }),
  WEEPING_VINES: reg('weeping_vines', 'Weeping Vines', { ...plant, climbable: true, needsSupport: true }),
  WEEPING_VINES_PLANT: reg('weeping_vines_plant', 'Weeping Vines', { ...plant, climbable: true, item: false, drop: 'weeping_vines' }),
  TWISTING_VINES: reg('twisting_vines', 'Twisting Vines', { ...plant, climbable: true }),
  TWISTING_VINES_PLANT: reg('twisting_vines_plant', 'Twisting Vines', { ...plant, climbable: true, item: false, drop: 'twisting_vines' }),
  SHROOMLIGHT: reg('shroomlight', 'Shroomlight', { hardness: 1, tool: 'hoe', sound: 'grass', light: 15 }),
  SOUL_SOIL: reg('soul_soil', 'Soul Soil', { hardness: 0.5, tool: 'shovel', sound: 'sand' }),
  SOUL_FIRE: reg('soul_fire', 'Soul Fire', { render: Render.Cross, tex: 'soul_fire', solid: false, opaque: false, hardness: 0, light: 10, replaceable: true, selectable: false, item: false, drop: null, sound: 'none' }),
  SOUL_TORCH: reg('soul_torch', 'Soul Torch', { render: Render.Torch, solid: false, opaque: false, hardness: 0, light: 10, sound: 'wood', needsSupport: true, lightOpacity: 0 }),
  LANTERN: reg('lantern', 'Lantern', { ...model(Shape.Lantern), hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', light: 15, icon: 'lantern_item' }),
  SOUL_LANTERN: reg('soul_lantern', 'Soul Lantern', { ...model(Shape.Lantern), hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', light: 10, icon: 'soul_lantern_item' }),
  CAMPFIRE: reg('campfire', 'Campfire', { ...model(Shape.Campfire), tex: 'campfire_log', top: 'campfire_fire', hardness: 2, tool: 'axe', sound: 'wood', light: 15, lights: [15, 15, 15, 15, 0, 0, 0, 0, 15, 15, 15, 15, 0, 0, 0, 0], drop: 'charcoal' }),
  SOUL_CAMPFIRE: reg('soul_campfire', 'Soul Campfire', { ...model(Shape.Campfire), tex: 'campfire_log', top: 'soul_campfire_fire', hardness: 2, tool: 'axe', sound: 'wood', light: 10, lights: [10, 10, 10, 10, 0, 0, 0, 0, 10, 10, 10, 10, 0, 0, 0, 0], drop: 'soul_soil' }),
  CHAIN: reg('chain', 'Chain', { ...model(Shape.Chain), hardness: 5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', blastResistance: 30, icon: 'chain_item' }),
  CRYING_OBSIDIAN: reg('crying_obsidian', 'Crying Obsidian', { hardness: 50, tool: 'pickaxe', harvestLevel: 3, blastResistance: 6000, light: 10 }),
  RESPAWN_ANCHOR: reg('respawn_anchor', 'Respawn Anchor', { top: 'respawn_anchor_top_off', bottom: 'respawn_anchor_bottom', side: 'respawn_anchor_side0', hardness: 50, tool: 'pickaxe', harvestLevel: 3, blastResistance: 6000, lights: [0, 3, 7, 11, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15] }),
  LODESTONE: reg('lodestone', 'Lodestone', { top: 'lodestone_top', side: 'lodestone_side', hardness: 3.5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', blastResistance: 17.5 }),
  ANCIENT_DEBRIS: reg('ancient_debris', 'Ancient Debris', { top: 'ancient_debris_top', side: 'ancient_debris_side', hardness: 30, tool: 'pickaxe', harvestLevel: 3, blastResistance: 6000, sound: 'metal' }),
  NETHERITE_BLOCK: reg('netherite_block', 'Block of Netherite', { hardness: 50, tool: 'pickaxe', harvestLevel: 3, blastResistance: 6000, sound: 'metal' }),
  NETHER_GOLD_ORE: reg('nether_gold_ore', 'Nether Gold Ore', { hardness: 3, tool: 'pickaxe', harvestLevel: 0, blastResistance: 15, drop: 'gold_nugget' }),
  TARGET: reg('target', 'Target', { top: 'target_top', side: 'target_side', hardness: 0.5, tool: 'hoe', sound: 'grass' }),
  // the overworld's missing natural blocks
  MYCELIUM: reg('mycelium', 'Mycelium', { top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side', hardness: 0.6, tool: 'shovel', sound: 'grass', drop: 'dirt' }),
  GRASS_PATH: reg('grass_path', 'Grass Path', { render: Render.Model, top: 'grass_path_top', bottom: 'dirt', side: 'grass_path_side', hardness: 0.65, tool: 'shovel', sound: 'grass', opaque: false, lightOpacity: 15, drop: 'dirt' }),
  PACKED_ICE: reg('packed_ice', 'Packed Ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', slipperiness: 0.98, drop: null }),
  BLUE_ICE: reg('blue_ice', 'Blue Ice', { hardness: 2.8, tool: 'pickaxe', sound: 'glass', slipperiness: 0.989, drop: null }),
  FROSTED_ICE: reg('frosted_ice', 'Frosted Ice', { tex: 'frosted_ice_0', hardness: 0.5, sound: 'glass', translucent: true, opaque: false, cullSelf: true, lightOpacity: 2, slipperiness: 0.98, drop: null, item: false }),
  BROWN_MUSHROOM_BLOCK: reg('brown_mushroom_block', 'Brown Mushroom Block', { hardness: 0.2, tool: 'axe', sound: 'wood', drop: null }),
  RED_MUSHROOM_BLOCK: reg('red_mushroom_block', 'Red Mushroom Block', { hardness: 0.2, tool: 'axe', sound: 'wood', drop: null }),
  MUSHROOM_STEM: reg('mushroom_stem', 'Mushroom Stem', { hardness: 0.2, tool: 'axe', sound: 'wood', drop: null }),
  VINE: reg('vine', 'Vines', { ...model(Shape.Vine), tex: 'vine', hardness: 0.2, tool: 'shears', sound: 'grass', solid: false, climbable: true, replaceable: true, tint: 'foliage', flammable: true, drop: null, burn: [15, 100] }),
  BLUE_ORCHID: reg('blue_orchid', 'Blue Orchid', { ...plant, shape: Shape.Flower }),
  AZURE_BLUET: reg('azure_bluet', 'Azure Bluet', { ...plant, shape: Shape.Flower }),
  RED_TULIP: reg('red_tulip', 'Red Tulip', { ...plant, shape: Shape.Flower }),
  ORANGE_TULIP: reg('orange_tulip', 'Orange Tulip', { ...plant, shape: Shape.Flower }),
  WHITE_TULIP: reg('white_tulip', 'White Tulip', { ...plant, shape: Shape.Flower }),
  PINK_TULIP: reg('pink_tulip', 'Pink Tulip', { ...plant, shape: Shape.Flower }),
  LILY_OF_THE_VALLEY: reg('lily_of_the_valley', 'Lily of the Valley', { ...plant, shape: Shape.Flower }),
  WITHER_ROSE: reg('wither_rose', 'Wither Rose', { ...plant, shape: Shape.Flower }),
  SUNFLOWER: reg('sunflower', 'Sunflower', { ...plant, shape: Shape.DoublePlant, tex: 'sunflower_bottom', top: 'sunflower_top', icon: 'sunflower_front' }),
  LILAC: reg('lilac', 'Lilac', { ...plant, shape: Shape.DoublePlant, tex: 'lilac_bottom', top: 'lilac_top', icon: 'lilac_top' }),
  ROSE_BUSH: reg('rose_bush', 'Rose Bush', { ...plant, shape: Shape.DoublePlant, tex: 'rose_bush_bottom', top: 'rose_bush_top', icon: 'rose_bush_top' }),
  PEONY: reg('peony', 'Peony', { ...plant, shape: Shape.DoublePlant, tex: 'peony_bottom', top: 'peony_top', icon: 'peony_top' }),
  TALL_GRASS2: reg('tall_grass', 'Tall Grass', { ...plant, shape: Shape.DoublePlant, tex: 'tall_grass_bottom', top: 'tall_grass_top', tint: 'grass', replaceable: true, drop: null, icon: 'tall_grass_top' }),
  LARGE_FERN: reg('large_fern', 'Large Fern', { ...plant, shape: Shape.DoublePlant, tex: 'large_fern_bottom', top: 'large_fern_top', tint: 'grass', replaceable: true, drop: null, icon: 'large_fern_top' }),
  COCOA: reg('cocoa', 'Cocoa', { render: Render.Model, tex: 'cocoa_stage2', hardness: 0.2, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0, needsSupport: true, item: false, drop: null }),
  BEETROOTS: reg('beetroots', 'Beetroots', { render: Render.Crops, tex: 'beetroots_stage3', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drop: null, item: false }),
  MELON_STEM: reg('melon_stem', 'Melon Stem', { ...plant, item: false }),
  SWEET_BERRY_BUSH: reg('sweet_berry_bush', 'Sweet Berry Bush', { ...plant, tex: 'sweet_berry_bush_stage3', item: false, drop: null }),
  BAMBOO: reg('bamboo', 'Bamboo', { render: Render.Model, tex: 'bamboo_stalk', top: 'bamboo_top', hardness: 1, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0, needsSupport: true, icon: 'bamboo_item' }),
  BAMBOO_SAPLING: reg('bamboo_sapling', 'Bamboo Shoot', { ...plant, hardness: 1, item: false, drop: 'bamboo' }),
  SNOW_LAYER_UNUSED: reg('unused_2', 'Unused', { render: Render.None, item: false, selectable: false, solid: false, opaque: false, lightOpacity: 0 }),
  // the ocean
  KELP: reg('kelp', 'Kelp', { render: Render.Cross, tex: 'kelp', solid: false, hardness: 0, sound: 'grass', needsSupport: true, fluid: false, icon: 'kelp_item' }),
  KELP_PLANT: reg('kelp_plant', 'Kelp Plant', { render: Render.Cross, tex: 'kelp_plant', solid: false, hardness: 0, sound: 'grass', needsSupport: true, item: false, drop: 'kelp' }),
  SEAGRASS: reg('seagrass', 'Seagrass', { render: Render.Cross, tex: 'seagrass', solid: false, hardness: 0, sound: 'grass', needsSupport: true, replaceable: true, drop: null }),
  TALL_SEAGRASS: reg('tall_seagrass', 'Tall Seagrass', { render: Render.Cross, tex: 'tall_seagrass_bottom', top: 'tall_seagrass_top', solid: false, hardness: 0, sound: 'grass', needsSupport: true, replaceable: true, drop: null, item: false, shape: Shape.DoublePlant }),
  SEA_PICKLE: reg('sea_pickle', 'Sea Pickle', { render: Render.Model, tex: 'sea_pickle', hardness: 0, sound: 'slime', opaque: false, lightOpacity: 0, needsSupport: true, lights: [0, 0, 0, 0, 6, 9, 12, 15, 0, 0, 0, 0, 6, 9, 12, 15], light: 0 }),
  DRIED_KELP_BLOCK: reg('dried_kelp_block', 'Dried Kelp Block', { top: 'dried_kelp_top', side: 'dried_kelp_side', hardness: 0.5, tool: 'hoe', sound: 'grass', flammable: true }),
  BUBBLE_COLUMN: reg('bubble_column', 'Bubble Column', { render: Render.None, solid: false, opaque: false, lightOpacity: 2, hardness: 100, fluid: true, selectable: false, drop: null, item: false, sound: 'none', replaceable: true }),
  TURTLE_EGG: reg('turtle_egg', 'Turtle Egg', { render: Render.Model, hardness: 0.5, sound: 'stone', opaque: false, lightOpacity: 0, drop: null }),
  CONDUIT: reg('conduit', 'Conduit', { render: Render.Model, hardness: 3, tool: 'pickaxe', opaque: false, lightOpacity: 0, light: 15, sound: 'glass' }),
  // functional blocks
  NOTE_BLOCK: reg('note_block', 'Note Block', { ...wood, hardness: 0.8 }),
  JUKEBOX: reg('jukebox', 'Jukebox', { ...wood, top: 'jukebox_top', side: 'jukebox_side', hardness: 2 }),
  TRAPPED_CHEST: reg('trapped_chest', 'Trapped Chest', { ...wood, hardness: 2.5, render: Render.Model, opaque: false, lightOpacity: 0, top: 'chest_top', side: 'chest_side', front: 'trapped_chest_front' }),
  BARREL: reg('barrel', 'Barrel', { ...wood, hardness: 2.5, top: 'barrel_top', bottom: 'barrel_bottom', side: 'barrel_side' }),
  SMOKER: reg('smoker', 'Smoker', { ...stone, hardness: 3.5, top: 'smoker_top', bottom: 'smoker_bottom', side: 'smoker_side', front: 'smoker_front', lights: [0, 0, 0, 0, 13, 13, 13, 13, 0, 0, 0, 0, 13, 13, 13, 13] }),
  BLAST_FURNACE: reg('blast_furnace', 'Blast Furnace', { ...stone, hardness: 3.5, top: 'blast_furnace_top', side: 'blast_furnace_side', front: 'blast_furnace_front', lights: [0, 0, 0, 0, 13, 13, 13, 13, 0, 0, 0, 0, 13, 13, 13, 13] }),
  CARTOGRAPHY_TABLE: reg('cartography_table', 'Cartography Table', { ...wood, top: 'cartography_table_top', side: 'cartography_table_side1', front: 'cartography_table_side3', hardness: 2.5 }),
  FLETCHING_TABLE: reg('fletching_table', 'Fletching Table', { ...wood, top: 'fletching_table_top', side: 'fletching_table_side', front: 'fletching_table_front', hardness: 2.5 }),
  SMITHING_TABLE: reg('smithing_table', 'Smithing Table', { ...wood, top: 'smithing_table_top', bottom: 'smithing_table_bottom', side: 'smithing_table_side', front: 'smithing_table_front', hardness: 2.5 }),
  LOOM: reg('loom', 'Loom', { ...wood, top: 'loom_top', bottom: 'loom_bottom', side: 'loom_side', front: 'loom_front', hardness: 2.5 }),
  STONECUTTER: reg('stonecutter', 'Stonecutter', { ...model(Shape.Cube), top: 'stonecutter_top', bottom: 'stonecutter_bottom', side: 'stonecutter_side', ...stone, hardness: 3.5, lightOpacity: 0 }),
  GRINDSTONE: reg('grindstone', 'Grindstone', { ...model(Shape.Cube), tex: 'grindstone_side', top: 'grindstone_round', ...stone, hardness: 2, harvestLevel: 0, blastResistance: 30 }),
  COMPOSTER: reg('composter', 'Composter', { ...model(Shape.Cube), top: 'composter_top', bottom: 'composter_bottom', side: 'composter_side', ...wood, hardness: 0.6 }),
  LECTERN: reg('lectern', 'Lectern', { ...model(Shape.Cube), top: 'lectern_top', bottom: 'oak_planks', side: 'lectern_sides', front: 'lectern_front', ...wood, hardness: 2.5 }),
  BELL: reg('bell', 'Bell', { ...model(Shape.Cube), tex: 'bell_body', hardness: 5, tool: 'pickaxe', sound: 'metal', blastResistance: 25 }),
  CAULDRON: reg('cauldron', 'Cauldron', { ...model(Shape.Cube), top: 'cauldron_top', bottom: 'cauldron_bottom', side: 'cauldron_side', hardness: 2, tool: 'pickaxe', harvestLevel: 0, sound: 'metal' }),
  FLOWER_POT: reg('flower_pot', 'Flower Pot', { ...model(Shape.Cube), tex: 'flower_pot', hardness: 0, sound: 'stone', icon: 'flower_pot_item' }),
  BEACON: reg('beacon', 'Beacon', { ...model(Shape.Cube), tex: 'beacon', hardness: 3, sound: 'glass', light: 15, blastResistance: 15 }),
  DAYLIGHT_DETECTOR: reg('daylight_detector', 'Daylight Detector', { ...model(Shape.Cube), top: 'daylight_detector_top', side: 'daylight_detector_side', ...wood, hardness: 0.2 }),
  TRIPWIRE_HOOK: reg('tripwire_hook', 'Tripwire Hook', { ...model(Shape.Cube), tex: 'tripwire_hook', solid: false, hardness: 0, sound: 'wood', needsSupport: true, icon: 'tripwire_hook' }),
  TRIPWIRE: reg('tripwire', 'Tripwire', { ...model(Shape.Cube), tex: 'tripwire', solid: false, hardness: 0, sound: 'cloth', item: false, drop: 'string', needsSupport: true }),
  HEAVY_WEIGHTED_PRESSURE_PLATE: reg('heavy_weighted_pressure_plate', 'Heavy Weighted Pressure Plate', { tex: 'iron_block', ...model(Shape.Plate), hardness: 0.5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', solid: false, needsSupport: true, material: 'iron' }),
  LIGHT_WEIGHTED_PRESSURE_PLATE: reg('light_weighted_pressure_plate', 'Light Weighted Pressure Plate', { tex: 'gold_block', ...model(Shape.Plate), hardness: 0.5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', solid: false, needsSupport: true, material: 'gold' }),
  IRON_DOOR: reg('iron_door', 'Iron Door', { ...model(Shape.Door), tex: 'iron_door_bottom', top: 'iron_door_top', icon: 'iron_door_item', hardness: 5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', material: 'iron', blastResistance: 25 }),
  IRON_TRAPDOOR: reg('iron_trapdoor', 'Iron Trapdoor', { ...model(Shape.Trapdoor), tex: 'iron_trapdoor', hardness: 5, tool: 'pickaxe', harvestLevel: 0, sound: 'metal', material: 'iron', blastResistance: 25 }),
  HONEY_BLOCK: reg('honey_block', 'Honey Block', { render: Render.Model, top: 'honey_block_top', bottom: 'honey_block_bottom', side: 'honey_block_side', hardness: 0, sound: 'slime', opaque: false, translucent: true, lightOpacity: 1 }),
  HONEYCOMB_BLOCK: reg('honeycomb_block', 'Honeycomb Block', { hardness: 0.6, sound: 'cloth' }),
  BEE_NEST: reg('bee_nest', 'Bee Nest', { top: 'bee_nest_top', bottom: 'bee_nest_bottom', side: 'bee_nest_side', front: 'bee_nest_front', hardness: 0.3, tool: 'axe', sound: 'wood', flammable: true, drop: null }),
  BEEHIVE: reg('beehive', 'Beehive', { top: 'beehive_end', side: 'beehive_side', front: 'beehive_front', hardness: 0.6, tool: 'axe', sound: 'wood', flammable: true }),
  SCAFFOLDING: reg('scaffolding', 'Scaffolding', { render: Render.Model, top: 'scaffolding_top', side: 'scaffolding_side', bottom: 'scaffolding_bottom', hardness: 0, sound: 'wood', opaque: false, lightOpacity: 0, climbable: true, flammable: true }),
  CAKE: reg('cake', 'Cake', { render: Render.Model, top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side', front: 'cake_inner', hardness: 0.5, sound: 'cloth', opaque: false, lightOpacity: 0, item: false, drop: null }),
  CARVED_PUMPKIN: reg('carved_pumpkin', 'Carved Pumpkin', { top: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin', hardness: 1, tool: 'axe', sound: 'wood' }),
  EMERALD_BLOCK: reg('emerald_block', 'Block of Emerald', { hardness: 5, tool: 'pickaxe', harvestLevel: 2, sound: 'metal' }),
  BONE_BLOCK: reg('bone_block', 'Bone Block', { top: 'bone_block_top', side: 'bone_block_side', ...stone, hardness: 2, shape: Shape.Log }),
  WET_SPONGE: reg('wet_sponge', 'Wet Sponge', { hardness: 0.6, sound: 'grass' }),
  INFESTED_STONE: reg('infested_stone', 'Infested Stone', { tex: 'stone', hardness: 0.75, tool: 'pickaxe', drop: null, item: false }),
  INFESTED_COBBLESTONE: reg('infested_cobblestone', 'Infested Cobblestone', { tex: 'cobblestone', hardness: 1, tool: 'pickaxe', drop: null, item: false }),
  INFESTED_STONE_BRICKS: reg('infested_stone_bricks', 'Infested Stone Bricks', { tex: 'stone_bricks', hardness: 0.75, tool: 'pickaxe', drop: null, item: false }),
  REDSTONE_ORE_LIT: reg('lit_redstone_ore', 'Redstone Ore', { tex: 'redstone_ore', ...ore(2), light: 9, item: false, drop: 'redstone' }),
  END_ROD: reg('end_rod', 'End Rod', { ...model(Shape.Chain), tex: 'end_rod', hardness: 0, sound: 'wood', light: 14, icon: 'end_rod' }),
  CHORUS_PLANT: reg('chorus_plant', 'Chorus Plant', { render: Render.Model, tex: 'chorus_plant', hardness: 0.4, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0, drop: 'chorus_fruit', needsSupport: true }),
  CHORUS_FLOWER: reg('chorus_flower', 'Chorus Flower', { render: Render.Model, tex: 'chorus_flower', hardness: 0.4, tool: 'axe', sound: 'wood', opaque: false, lightOpacity: 0, needsSupport: true }),
  SKELETON_SKULL: reg('skeleton_skull', 'Skeleton Skull', { ...model(Shape.Head), tex: 'skull_skeleton', hardness: 1, sound: 'stone', icon: 'skull_skeleton_item' }),
  WITHER_SKELETON_SKULL: reg('wither_skeleton_skull', 'Wither Skeleton Skull', { ...model(Shape.Head), tex: 'skull_wither', hardness: 1, sound: 'stone', icon: 'skull_wither_item' }),
  ZOMBIE_HEAD: reg('zombie_head', 'Zombie Head', { ...model(Shape.Head), tex: 'skull_zombie', hardness: 1, sound: 'stone', icon: 'skull_zombie_item' }),
  PLAYER_HEAD: reg('player_head', 'Player Head', { ...model(Shape.Head), tex: 'skull_player', hardness: 1, sound: 'stone', icon: 'skull_player_item' }),
  CREEPER_HEAD: reg('creeper_head', 'Creeper Head', { ...model(Shape.Head), tex: 'skull_creeper', hardness: 1, sound: 'stone', icon: 'skull_creeper_item' }),
  DRAGON_HEAD: reg('dragon_head', 'Dragon Head', { ...model(Shape.Head), tex: 'skull_dragon', hardness: 1, sound: 'stone', icon: 'skull_dragon_item' }),
  SKELETON_WALL_SKULL: reg('skeleton_wall_skull', 'Skeleton Skull', { ...model(Shape.WallHead), tex: 'skull_skeleton', hardness: 1, item: false, drop: 'skeleton_skull' }),
  WITHER_SKELETON_WALL_SKULL: reg('wither_skeleton_wall_skull', 'Wither Skeleton Skull', { ...model(Shape.WallHead), tex: 'skull_wither', hardness: 1, item: false, drop: 'wither_skeleton_skull' }),
  ZOMBIE_WALL_HEAD: reg('zombie_wall_head', 'Zombie Head', { ...model(Shape.WallHead), tex: 'skull_zombie', hardness: 1, item: false, drop: 'zombie_head' }),
  PLAYER_WALL_HEAD: reg('player_wall_head', 'Player Head', { ...model(Shape.WallHead), tex: 'skull_player', hardness: 1, item: false, drop: 'player_head' }),
  CREEPER_WALL_HEAD: reg('creeper_wall_head', 'Creeper Head', { ...model(Shape.WallHead), tex: 'skull_creeper', hardness: 1, item: false, drop: 'creeper_head' }),
  DRAGON_WALL_HEAD: reg('dragon_wall_head', 'Dragon Head', { ...model(Shape.WallHead), tex: 'skull_dragon', hardness: 1, item: false, drop: 'dragon_head' }),
  SHULKER_BOX: reg('shulker_box', 'Shulker Box', { ...model(Shape.Cube), tex: 'shulker_box', hardness: 2, tool: 'pickaxe' }),
  SPAWNER_UNUSED: reg('unused_3', 'Unused', { render: Render.None, item: false, selectable: false, solid: false, opaque: false, lightOpacity: 0 }),
} as const;

/** Coral: living (in water) and dead, as blocks, plants and fans. */
export const CORAL_KINDS = ['tube', 'brain', 'bubble', 'fire', 'horn'] as const;
export const CORAL = CORAL_KINDS.map((k) => {
  const K = title(k);
  return {
    block: reg(`${k}_coral_block`, `${K} Coral Block`, { ...stone, drop: `dead_${k}_coral_block` }),
    dead: reg(`dead_${k}_coral_block`, `Dead ${K} Coral Block`, { ...stone }),
    plant: reg(`${k}_coral`, `${K} Coral`, { ...plant, shape: Shape.Coral, drop: null }),
    deadPlant: reg(`dead_${k}_coral`, `Dead ${K} Coral`, { ...plant, shape: Shape.Coral, drop: null }),
    fan: reg(`${k}_coral_fan`, `${K} Coral Fan`, { ...model(Shape.CoralFan), tex: `${k}_coral_fan`, hardness: 0, sound: 'grass', solid: false, needsSupport: true, drop: null }),
    deadFan: reg(`dead_${k}_coral_fan`, `Dead ${K} Coral Fan`, { ...model(Shape.CoralFan), tex: `dead_${k}_coral_fan`, hardness: 0, sound: 'grass', solid: false, needsSupport: true, drop: null }),
  };
});

/** Textures models need beyond a block's own faces (registered here so every realm numbers them alike). */
export const T2 = {
  headFace: Object.fromEntries(['skeleton', 'wither', 'zombie', 'player', 'creeper', 'dragon'].map((k) => [tex('skull_' + k), tex(`skull_${k}_face`)])) as Record<number, number>,
  respawnAnchorTop: tex('respawn_anchor_top'),
  respawnAnchorSide: [0, 1, 2, 3, 4].map((c) => tex('respawn_anchor_side' + c)),
  smokerOn: tex('smoker_front_on'),
  blastOn: tex('blast_furnace_front_on'),
  cauldronInner: tex('cauldron_inner'),
  water: tex('water_still'),
  lava: tex('lava_still'),
  compost: tex('composter_compost'),
  compostReady: tex('composter_ready'),
  beaconGlass: tex('beacon_glass'),
  obsidian: tex('obsidian'),
  daylightInverted: tex('daylight_detector_inverted_top'),
  cocoa: [0, 1, 2].map((s) => tex('cocoa_stage' + s)),
  beetroots: [0, 1, 2, 3].map((s) => tex('beetroots_stage' + s)),
  berries: [0, 1, 2, 3].map((s) => tex('sweet_berry_bush_stage' + s)),
  frostedIce: [0, 1, 2, 3].map((s) => tex('frosted_ice_' + s)),
  chorusDead: tex('chorus_flower_dead'),
  mushroomInside: tex('mushroom_block_inside'),
  campfireLog: tex('campfire_log'),
  lecternBase: tex('lectern_base'),
  stem: tex('pumpkin_stem'),
};

// the families the original blocks belong to
for (const id of [B.OAK_STAIRS, B.COBBLESTONE_STAIRS, B.SPRUCE_STAIRS, B.BIRCH_STAIRS, B.STONE_BRICK_STAIRS, B.BRICK_STAIRS, B.NETHER_BRICK_STAIRS]) BLOCKS[id].shape = Shape.Stairs;
for (const id of [B.STONE_SLAB, B.OAK_SLAB, B.COBBLESTONE_SLAB]) BLOCKS[id].shape = Shape.Slab;
BLOCKS[B.OAK_SLAB].base = 'oak_planks'; BLOCKS[B.COBBLESTONE_SLAB].base = 'cobblestone'; BLOCKS[B.STONE_SLAB].base = 'smooth_stone';
for (const id of [B.OAK_FENCE, B.NETHER_BRICK_FENCE]) BLOCKS[id].shape = Shape.Fence;
BLOCKS[B.OAK_FENCE].material = 'wood';
for (const id of [B.GLASS_PANE, B.IRON_BARS]) BLOCKS[id].shape = Shape.Pane;
BLOCKS[B.OAK_DOOR].shape = Shape.Door; BLOCKS[B.OAK_DOOR].material = 'wood';
BLOCKS[B.STONE_BUTTON].shape = Shape.Button; BLOCKS[B.STONE_BUTTON].material = 'stone';
BLOCKS[B.STONE_PRESSURE_PLATE].shape = Shape.Plate; BLOCKS[B.STONE_PRESSURE_PLATE].material = 'stone';
for (const [id, k] of [[B.OAK_LOG, 'oak'], [B.SPRUCE_LOG, 'spruce'], [B.BIRCH_LOG, 'birch']] as const) { BLOCKS[id].shape = Shape.Log; BLOCKS[id].stripped = `stripped_${k}_log`; BLOCKS[id].material = 'wood'; }
for (const [id, k] of [[B.OAK_LEAVES, 'oak'], [B.SPRUCE_LEAVES, 'spruce'], [B.BIRCH_LEAVES, 'birch']] as const) { BLOCKS[id].shape = Shape.Leaves; BLOCKS[id].sapling = `${k}_sapling`; }
for (const [id, k] of [[B.OAK_SAPLING, 'oak'], [B.SPRUCE_SAPLING, 'spruce'], [B.BIRCH_SAPLING, 'birch']] as const) { BLOCKS[id].shape = Shape.Sapling; BLOCKS[id].tree = k; }
for (const w of Object.values(WOOD)) if (!w.nether) BLOCKS[w.sapling].shape = Shape.Sapling;
BLOCKS[WOOD.crimson.sapling].shape = BLOCKS[WOOD.warped.sapling].shape = Shape.Sapling;
for (const id of [B.DANDELION, B.POPPY, B.CORNFLOWER, B.OXEYE_DAISY, B.ALLIUM]) BLOCKS[id].shape = Shape.Flower;
BLOCKS[B.BED].shape = Shape.Bed;
BLOCKS[B.QUARTZ_BLOCK].base = 'quartz_block';
for (const id of [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.OAK_STAIRS, B.SPRUCE_STAIRS, B.BIRCH_STAIRS, B.OAK_SLAB, B.OAK_FENCE, B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG, B.BOOKSHELF]) BLOCKS[id].burn ??= [5, 20];
for (const id of [B.OAK_LEAVES, B.SPRUCE_LEAVES, B.BIRCH_LEAVES]) BLOCKS[id].burn = [30, 60];
for (const id of WOOL_IDS()) BLOCKS[id].burn = [30, 60];
BLOCKS[B.TNT].burn = [15, 100]; BLOCKS[B.TALL_GRASS].burn = BLOCKS[B.FERN].burn = BLOCKS[B.DEAD_BUSH].burn = [60, 100];
BLOCKS[B.HAY_BLOCK].burn = [60, 20]; BLOCKS[B.COAL_BLOCK].burn = [5, 5];
function WOOL_IDS() { return BLOCKS.filter((b) => b.name.endsWith('_wool')).map((b) => b.id); }

export const BLOCK_COUNT = BLOCKS.length;
/** Vanilla blocks take ids below this; mod blocks are bound to ids from here up (their items share the id). */
export const MOD_BLOCK_BASE = 2048;

// Fast lookup tables for hot loops (meshing / lighting / physics).
export const OPAQUE = new Uint8Array(4096);
export const LIGHT_OPACITY = new Uint8Array(4096);
export const LIGHT_EMIT = new Uint8Array(4096);
export const RENDER = new Uint8Array(4096);
export const SOLID = new Uint8Array(4096);
/** Mod blocks that take part in redstone (have redstone hooks). */
export const REDSTONE = new Uint8Array(4096);
/** Each block's family (`Shape`). */
export const SHAPE = new Uint8Array(4096);
/** Light emitted by each block state, indexed by the packed value (id | meta << 12). */
export const STATE_LIGHT = new Uint8Array(65536);
for (const b of BLOCKS) {
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  LIGHT_EMIT[b.id] = b.light;
  RENDER[b.id] = b.render;
  SOLID[b.id] = b.solid ? 1 : 0;
  SHAPE[b.id] = b.shape;
  for (let m = 0; m < 16; m++) STATE_LIGHT[b.id | (m << 12)] = b.lights?.[m] ?? b.light;
}

export const WOOL_COLORS = [
  B.WOOL_WHITE, B.WOOL_ORANGE, B.WOOL_MAGENTA, B.WOOL_LIGHT_BLUE, B.WOOL_YELLOW, B.WOOL_LIME, B.WOOL_PINK, B.WOOL_GRAY,
  B.WOOL_LIGHT_GRAY, B.WOOL_CYAN, B.WOOL_PURPLE, B.WOOL_BLUE, B.WOOL_BROWN, B.WOOL_GREEN, B.WOOL_RED, B.WOOL_BLACK,
];

/**
 * Waterlogging: blocks that hold water in their cell. Families with a free meta bit keep it in bit 8 (stairs, slabs,
 * fences, walls, panes, chains, lanterns, wall signs, ladders, coral); kelp, seagrass and bubble columns always do;
 * sea pickles use bit 4. WATERLOGGED is indexed by the packed value.
 */
export const WATERLOGGED = new Uint8Array(65536);
const LOGGABLE_SHAPES = new Set([Shape.Stairs, Shape.Slab, Shape.Fence, Shape.Wall, Shape.Pane, Shape.Chain, Shape.Lantern, Shape.WallSign, Shape.Coral, Shape.CoralFan]);
/** Can this block take water in with meta bit 8? */
export const waterloggable = (id: number) => (LOGGABLE_SHAPES.has(SHAPE[id]) && id !== B2.END_ROD) || id === B.LADDER;
function fillWaterlogged() {
  for (let id = 0; id < BLOCK_COUNT; id++) {
    const always = id === B2.KELP || id === B2.KELP_PLANT || id === B2.SEAGRASS || id === B2.TALL_SEAGRASS || id === B2.BUBBLE_COLUMN;
    for (let m = 0; m < 16; m++) {
      const logged = always || (waterloggable(id) && (m & 8) !== 0 && !(SHAPE[id] === Shape.Slab && (m & 7) === 2)) || (id === B2.SEA_PICKLE && (m & 4) !== 0);
      WATERLOGGED[id | (m << 12)] = logged ? 1 : 0;
    }
  }
}
fillWaterlogged();
/** Water, or a block standing in water: for swimming, drowning, fluid flow and drawing. */
export const isWaterAt = (v: number) => (v & 0xfff) === B.WATER || WATERLOGGED[v] === 1;

export const isStairs = (id: number) => SHAPE[id] === Shape.Stairs;
export const isFence = (id: number) => SHAPE[id] === Shape.Fence;
export const isSlab = (id: number) => SHAPE[id] === Shape.Slab;
export const isLeaves = (id: number) => SHAPE[id] === Shape.Leaves;
/** Pillar blocks that turn with their axis (logs, stems, quartz and purpur pillars, basalt, bone blocks). */
export const isPillar = (id: number) => SHAPE[id] === Shape.Log;
/** Tree trunks (overworld logs and nether stems, stripped or not, and their wood/hyphae). */
export const isLog = (id: number) => SHAPE[id] === Shape.Log && (BLOCKS[id].material === 'wood' || BLOCKS[id].material === 'nether_wood');
export const isFlower = (id: number) => SHAPE[id] === Shape.Flower;
export const isSapling = (id: number) => SHAPE[id] === Shape.Sapling;
export const isDoor = (id: number) => SHAPE[id] === Shape.Door;
export const isTrapdoor = (id: number) => SHAPE[id] === Shape.Trapdoor;
export const isGate = (id: number) => SHAPE[id] === Shape.Gate;
export const isWall = (id: number) => SHAPE[id] === Shape.Wall;
export const isPane = (id: number) => SHAPE[id] === Shape.Pane;
export const isButton = (id: number) => SHAPE[id] === Shape.Button;
export const isPlate = (id: number) => SHAPE[id] === Shape.Plate;
export const isSign = (id: number) => SHAPE[id] === Shape.Sign || SHAPE[id] === Shape.WallSign;
export const isBed = (id: number) => SHAPE[id] === Shape.Bed;
export const isDoublePlant = (id: number) => SHAPE[id] === Shape.DoublePlant;
/** Opened by hand (wooden doors, trapdoors and gates; iron ones need redstone). */
export const isHandOperated = (id: number) => (isDoor(id) || isTrapdoor(id) || isGate(id)) && BLOCKS[id].material !== 'iron';
/** Fire: the normal kind and the blue soul fire. */
export const isFire = (id: number) => id === B.FIRE || id === B2.SOUL_FIRE;
/** Blocks with a front face that turns toward the player (meta & 3 = facing). */
export const isOriented = (id: number) =>
  id === B.FURNACE || id === B.LIT_FURNACE || id === B.CHEST || id === B.ENDER_CHEST || id === B.PUMPKIN || id === B.JACK_O_LANTERN || id === B.CRAFTING_TABLE ||
  (id >= B2.NOTE_BLOCK && id < MOD_BLOCK_BASE && BLOCKS[id].faces.length > 6 && !BLOCKS[id].mod);

/** Blocks that plants can grow on */
export const isSoil = (id: number) => id === B.GRASS || id === B.DIRT || id === B.PODZOL || id === B.COARSE_DIRT || id === B.FARMLAND;
/** Blocks fungi and nether roots grow on. */
export const isNetherSoil = (id: number) => id === B2.CRIMSON_NYLIUM || id === B2.WARPED_NYLIUM || id === B2.SOUL_SOIL || isSoil(id);

// Extra textures referenced only by the mesher/UI (registered here so indices are shared).
export const T = {
  grassSideOverlay: tex('grass_side_overlay'),
  grassSideSnowed: tex('grass_side_snowed'),
  farmlandMoist: tex('farmland_moist'),
  torch: tex('torch'),
  wheat: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tex('wheat_stage' + i)),
  destroy: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => tex('destroy_stage_' + i)),
  doorTop: tex('oak_door_top'),
  doorBottom: tex('oak_door_bottom'),
  ladder: tex('ladder'),
  bedHeadTop: tex('bed_head_top'),
  bedFootTop: tex('bed_foot_top'),
  bedHeadSide: tex('bed_head_side'),
  bedFootSide: tex('bed_foot_side'),
  bedHeadEnd: tex('bed_head_end'),
  bedFootEnd: tex('bed_foot_end'),
  bedBottom: tex('oak_planks'),
  chestTop: tex('chest_top'),
  chestSide: tex('chest_side'),
  chestFront: tex('chest_front'),
  stemBent: tex('pumpkin_stem'),
  lilyPad: tex('lily_pad'),
  portal: tex('nether_portal'),
  dustDot: tex('redstone_dust_dot'),
  dustLine: tex('redstone_dust_line'),
  railCorner: tex('rail_corner'),
  poweredRailOn: tex('powered_rail_on'),
  detectorRailOn: tex('detector_rail_on'),
  activatorRailOn: tex('activator_rail_on'),
  minecart: tex('minecart'),
  minecartInside: tex('minecart_inside'),
  /** Dust top by connection mask (bits N, E, S, W). */
  dust: Array.from({ length: 16 }, (_, m) => tex('redstone_dust_' + m)),
  lever: tex('lever'),
  cobble: tex('cobblestone'),
  stone: tex('stone'),
  fire: tex('fire'),
  glassPaneTop: tex('glass_pane_top'),
  saplingOak: tex('oak_sapling'),
  sugarCane: tex('sugar_cane'),
  netherWart: [0, 1, 2].map((i) => tex('nether_wart_stage' + i)),
  carrots: [0, 1, 2, 3].map((i) => tex('carrots_stage' + i)),
  potatoes: [0, 1, 2, 3].map((i) => tex('potatoes_stage' + i)),
  smoothStone: tex('smooth_stone'),
  repeaterTorchOn: tex('redstone_torch'),
  repeaterTorchOff: tex('redstone_torch_off'),
  comparatorOn: tex('comparator_on'),
  hopperInside: tex('hopper_inside'),
  dispenserFrontV: tex('dispenser_front_vertical'),
  dropperFrontV: tex('dropper_front_vertical'),
  furnaceTop: tex('furnace_top'),
  pistonInner: tex('piston_inner'),
  pistonTop: tex('piston_top'),
  pistonTopSticky: tex('piston_top_sticky'),
  pistonSide: tex('piston_side'),
  observerBack: tex('observer_back'),
  observerBackOn: tex('observer_back_on'),
  brewingStandBase: tex('brewing_stand_base'),
  anvilTopChipped: tex('chipped_anvil_top'),
  anvilTopDamaged: tex('damaged_anvil_top'),
  netherBricks: tex('nether_bricks'),
  bedrock: tex('bedrock'),
  endStone: tex('end_stone'),
  endFrameTop: tex('end_portal_frame_top'),
  endFrameSide: tex('end_portal_frame_side'),
  endFrameEye: tex('end_portal_eye'),
  endPortal: tex('end_portal'),
  ironBarsTop: tex('iron_bars_top'),
  enderChestTop: tex('ender_chest_top'),
  enderChestSide: tex('ender_chest_side'),
  enderChestFront: tex('ender_chest_front'),
};
// Wool texture names are the same as the block names already.

export const isRedstoneTorch = (id: number) => id === B.REDSTONE_TORCH || id === B.UNLIT_REDSTONE_TORCH;
export const isRepeater = (id: number) => id === B.REPEATER || id === B.POWERED_REPEATER;
export const isDiode = (id: number) => isRepeater(id) || id === B.COMPARATOR;
export const isPiston = (id: number) => id === B.PISTON || id === B.STICKY_PISTON;
export const isRedstoneComponent = (id: number) =>
  id === B.REDSTONE_WIRE || id === B.LEVER || isButton(id) || isPlate(id) || isRedstoneTorch(id) || isDoor(id) || isTrapdoor(id) || isGate(id) ||
  id === B.REDSTONE_LAMP || id === B.LIT_REDSTONE_LAMP || id === B.REDSTONE_BLOCK || id === B.TNT || id === B2.TARGET || id === B2.NOTE_BLOCK || id === B2.DAYLIGHT_DETECTOR || id === B2.TRAPPED_CHEST ||
  isDiode(id) || isPiston(id) || id === B.OBSERVER || id === B.DISPENSER || id === B.DROPPER || id === B.HOPPER || isRail(id) || REDSTONE[id] === 1;
export const isRail = (id: number) => id === B.RAIL || id === B.POWERED_RAIL || id === B.DETECTOR_RAIL || id === B.ACTIVATOR_RAIL;

/** 6-way facing (vanilla order): 0 down, 1 up, 2 north, 3 south, 4 west, 5 east. */
export const FACING6: ReadonlyArray<readonly [number, number, number]> = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
/** FACING6 index -> FACE_DIRS face index */
export const FACING6_TO_FACE = [2, 3, 4, 5, 0, 1];
export const FACE_TO_FACING6 = [4, 5, 0, 1, 2, 3];
export const isFacing6Cube = (id: number) => id === B.DISPENSER || id === B.DROPPER || id === B.OBSERVER;
/** Crop texture for a crop block and growth meta. */
export function cropTexture(id: number, meta: number): number {
  if (id === B.NETHER_WART) return T.netherWart[meta >= 3 ? 2 : meta >= 1 ? 1 : 0];
  if (id === B.CARROTS) return T.carrots[[0, 0, 1, 1, 2, 2, 2, 3][Math.min(7, meta)]];
  if (id === B.POTATOES) return T.potatoes[[0, 0, 1, 1, 2, 2, 2, 3][Math.min(7, meta)]];
  if (id === B2.BEETROOTS) return T2.beetroots[Math.min(3, meta)];
  return T.wheat[Math.min(7, meta)];
}
