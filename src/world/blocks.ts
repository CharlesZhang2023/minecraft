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
}

export type Tool = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears' | null;
export type Tint = 'none' | 'grass' | 'foliage' | 'spruce' | 'birch';
export type Sound = 'stone' | 'wood' | 'grass' | 'gravel' | 'sand' | 'glass' | 'cloth' | 'snow' | 'metal' | 'none';

// Texture registry: stable indices so workers and the main thread agree.
export const TEXTURES: string[] = [];
export function tex(name: string): number {
  let i = TEXTURES.indexOf(name);
  if (i < 0) {
    i = TEXTURES.length;
    TEXTURES.push(name);
  }
  return i;
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
}

export const BLOCKS: BlockDef[] = [];
const byName = new Map<string, BlockDef>();

type Opts = Partial<Omit<BlockDef, 'id' | 'name' | 'faces'>> & {
  tex?: string; // all faces
  top?: string;
  bottom?: string;
  side?: string;
  front?: string;
};

function reg(name: string, display: string, o: Opts = {}): number {
  const id = BLOCKS.length;
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
  };
  if (o.front) def.faces.push(tex(o.front)); // index 6: front face for oriented blocks
  BLOCKS.push(def);
  byName.set(name, def);
  return id;
}

export function blockByName(name: string): BlockDef | undefined {
  return byName.get(name);
}

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
} as const;

export const BLOCK_COUNT = BLOCKS.length;

// Fast lookup tables for hot loops (meshing / lighting / physics).
export const OPAQUE = new Uint8Array(4096);
export const LIGHT_OPACITY = new Uint8Array(4096);
export const LIGHT_EMIT = new Uint8Array(4096);
export const RENDER = new Uint8Array(4096);
export const SOLID = new Uint8Array(4096);
for (const b of BLOCKS) {
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  LIGHT_EMIT[b.id] = b.light;
  RENDER[b.id] = b.render;
  SOLID[b.id] = b.solid ? 1 : 0;
}

export const WOOL_COLORS = [
  B.WOOL_WHITE, B.WOOL_ORANGE, B.WOOL_MAGENTA, B.WOOL_LIGHT_BLUE, B.WOOL_YELLOW, B.WOOL_LIME, B.WOOL_PINK, B.WOOL_GRAY,
  B.WOOL_LIGHT_GRAY, B.WOOL_CYAN, B.WOOL_PURPLE, B.WOOL_BLUE, B.WOOL_BROWN, B.WOOL_GREEN, B.WOOL_RED, B.WOOL_BLACK,
];

export const isStairs = (id: number) =>
  id === B.OAK_STAIRS || id === B.COBBLESTONE_STAIRS || id === B.SPRUCE_STAIRS || id === B.BIRCH_STAIRS || id === B.STONE_BRICK_STAIRS || id === B.BRICK_STAIRS;
export const isSlab = (id: number) => id === B.STONE_SLAB || id === B.OAK_SLAB || id === B.COBBLESTONE_SLAB;
export const isLeaves = (id: number) => id === B.OAK_LEAVES || id === B.SPRUCE_LEAVES || id === B.BIRCH_LEAVES;
export const isLog = (id: number) => id === B.OAK_LOG || id === B.SPRUCE_LOG || id === B.BIRCH_LOG;
export const isFlower = (id: number) => id >= B.DANDELION && id <= B.ALLIUM;
export const isSapling = (id: number) => id === B.OAK_SAPLING || id === B.SPRUCE_SAPLING || id === B.BIRCH_SAPLING;
export const isOriented = (id: number) =>
  id === B.FURNACE || id === B.LIT_FURNACE || id === B.CHEST || id === B.PUMPKIN || id === B.JACK_O_LANTERN || id === B.CRAFTING_TABLE;

/** Blocks that plants can grow on */
export const isSoil = (id: number) => id === B.GRASS || id === B.DIRT || id === B.PODZOL || id === B.COARSE_DIRT || id === B.FARMLAND;

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
  lever: tex('lever'),
  cobble: tex('cobblestone'),
  stone: tex('stone'),
  fire: tex('fire'),
  glassPaneTop: tex('glass_pane_top'),
  saplingOak: tex('oak_sapling'),
  sugarCane: tex('sugar_cane'),
};
// Wool texture names are the same as the block names already.

export const isRedstoneTorch = (id: number) => id === B.REDSTONE_TORCH || id === B.UNLIT_REDSTONE_TORCH;
export const isRedstoneComponent = (id: number) =>
  id === B.REDSTONE_WIRE || id === B.LEVER || id === B.STONE_BUTTON || id === B.STONE_PRESSURE_PLATE || isRedstoneTorch(id) ||
  id === B.REDSTONE_LAMP || id === B.LIT_REDSTONE_LAMP || id === B.REDSTONE_BLOCK || id === B.OAK_DOOR || id === B.TNT;
