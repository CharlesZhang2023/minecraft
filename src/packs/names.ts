// Where each of the game's textures is in a Java Edition resource pack (assets/minecraft/textures/...). Most block
// textures already have their modern names; the rest are listed here, newest name first, then older ones
// (1.12 packs keep blocks in textures/blocks/ with other names).

const BLOCK_ALIASES: Record<string, string[]> = {
  grass_top: ['grass_block_top', 'grass_top'],
  grass_side: ['grass_block_side', 'grass_side'],
  grass_side_overlay: ['grass_block_side_overlay', 'grass_side_overlay'],
  grass_side_snowed: ['grass_block_snow', 'grass_side_snowed'],
  short_grass: ['short_grass', 'grass', 'tallgrass'],
  fern: ['fern'],
  dead_bush: ['dead_bush', 'deadbush'],
  dandelion: ['dandelion', 'flower_dandelion'],
  poppy: ['poppy', 'flower_rose'],
  cornflower: ['cornflower', 'flower_blue_orchid'],
  oxeye_daisy: ['oxeye_daisy', 'flower_oxeye_daisy'],
  allium: ['allium', 'flower_allium'],
  brown_mushroom: ['brown_mushroom', 'mushroom_brown'],
  red_mushroom: ['red_mushroom', 'mushroom_red'],
  oak_log: ['oak_log', 'log_oak'], oak_log_top: ['oak_log_top', 'log_oak_top'],
  spruce_log: ['spruce_log', 'log_spruce'], spruce_log_top: ['spruce_log_top', 'log_spruce_top'],
  birch_log: ['birch_log', 'log_birch'], birch_log_top: ['birch_log_top', 'log_birch_top'],
  oak_leaves: ['oak_leaves', 'leaves_oak'], spruce_leaves: ['spruce_leaves', 'leaves_spruce'],
  oak_planks: ['oak_planks', 'planks_oak'], spruce_planks: ['spruce_planks', 'planks_spruce'], birch_planks: ['birch_planks', 'planks_birch'],
  oak_sapling: ['oak_sapling', 'sapling_oak'], spruce_sapling: ['spruce_sapling', 'sapling_spruce'], birch_sapling: ['birch_sapling', 'sapling_birch'],
  sandstone: ['sandstone', 'sandstone_normal'], cut_sandstone: ['cut_sandstone', 'sandstone_smooth'],
  bricks: ['bricks', 'brick'], mossy_cobblestone: ['mossy_cobblestone', 'cobblestone_mossy'],
  stone_bricks: ['stone_bricks', 'stonebrick'], mossy_stone_bricks: ['mossy_stone_bricks', 'stonebrick_mossy'], cracked_stone_bricks: ['cracked_stone_bricks', 'stonebrick_cracked'],
  smooth_stone: ['smooth_stone', 'stone_slab_top'], smooth_stone_slab_side: ['smooth_stone_slab_side', 'stone_slab_side'],
  granite: ['granite', 'stone_granite'], diorite: ['diorite', 'stone_diorite'], andesite: ['andesite', 'stone_andesite'],
  podzol_side: ['podzol_side', 'dirt_podzol_side'], podzol_top: ['podzol_top', 'dirt_podzol_top'], coarse_dirt: ['coarse_dirt'],
  wheat_stage0: ['wheat_stage0', 'wheat_stage_0'], wheat_stage1: ['wheat_stage1', 'wheat_stage_1'], wheat_stage2: ['wheat_stage2', 'wheat_stage_2'], wheat_stage3: ['wheat_stage3', 'wheat_stage_3'],
  wheat_stage4: ['wheat_stage4', 'wheat_stage_4'], wheat_stage5: ['wheat_stage5', 'wheat_stage_5'], wheat_stage6: ['wheat_stage6', 'wheat_stage_6'], wheat_stage7: ['wheat_stage7', 'wheat_stage_7'],
  farmland: ['farmland', 'farmland_dry'], farmland_moist: ['farmland_moist', 'farmland_wet'],
  oak_door_bottom: ['oak_door_bottom', 'door_wood_lower'], oak_door_top: ['oak_door_top', 'door_wood_upper'],
  cactus_side: ['cactus_side'], cactus_bottom: ['cactus_bottom'], cactus_top: ['cactus_top'],
  sugar_cane: ['sugar_cane', 'reeds'], pumpkin_side: ['pumpkin_side'], pumpkin_top: ['pumpkin_top'],
  carved_pumpkin: ['carved_pumpkin', 'pumpkin_face_off'], jack_o_lantern: ['jack_o_lantern', 'pumpkin_face_on'],
  pumpkin_stem: ['pumpkin_stem', 'pumpkin_stem_disconnected'],
  melon_side: ['melon_side'], melon_top: ['melon_top'],
  fire: ['fire_0', 'fire_layer_0'], cobweb: ['cobweb', 'web'], snow: ['snow'], ice: ['ice'],
  terracotta: ['terracotta', 'hardened_clay'], spawner: ['spawner', 'mob_spawner'], lily_pad: ['lily_pad', 'waterlily'],
  nether_bricks: ['nether_bricks', 'nether_brick'], nether_quartz_ore: ['nether_quartz_ore', 'quartz_ore'],
  quartz_block_side: ['quartz_block_side'], quartz_block_top: ['quartz_block_top'],
  magma_block: ['magma', 'magma_block'], redstone_dust_dot: ['redstone_dust_dot'], redstone_dust_line: ['redstone_dust_line0', 'redstone_dust_line'],
  redstone_torch_off: ['redstone_torch_off'], redstone_lamp: ['redstone_lamp', 'redstone_lamp_off'], redstone_lamp_on: ['redstone_lamp_on'],
  enchanting_table_side: ['enchanting_table_side'], enchanting_table_top: ['enchanting_table_top'],
  repeater: ['repeater', 'repeater_off'], repeater_on: ['repeater_on'], comparator: ['comparator', 'comparator_off'], comparator_on: ['comparator_on'],
  hopper_outside: ['hopper_outside'], hopper_top: ['hopper_top'], hopper_inside: ['hopper_inside'],
  dispenser_front: ['dispenser_front', 'dispenser_front_horizontal'], dropper_front: ['dropper_front', 'dropper_front_horizontal'],
  piston_top_sticky: ['piston_top_sticky'], piston_top: ['piston_top', 'piston_top_normal'], piston_inner: ['piston_inner'],
  slime_block: ['slime_block', 'slime'], brewing_stand_base: ['brewing_stand_base'],
  nether_wart_stage0: ['nether_wart_stage0', 'nether_wart_stage_0'], nether_wart_stage1: ['nether_wart_stage1', 'nether_wart_stage_1'], nether_wart_stage2: ['nether_wart_stage2', 'nether_wart_stage_2'],
  carrots_stage0: ['carrots_stage0', 'carrots_stage_0'], carrots_stage1: ['carrots_stage1', 'carrots_stage_1'], carrots_stage2: ['carrots_stage2', 'carrots_stage_2'], carrots_stage3: ['carrots_stage3', 'carrots_stage_3'],
  potatoes_stage0: ['potatoes_stage0', 'potatoes_stage_0'], potatoes_stage1: ['potatoes_stage1', 'potatoes_stage_1'], potatoes_stage2: ['potatoes_stage2', 'potatoes_stage_2'], potatoes_stage3: ['potatoes_stage3', 'potatoes_stage_3'],
  anvil: ['anvil', 'anvil_base'], anvil_top: ['anvil_top', 'anvil_top_damaged_0'], chipped_anvil_top: ['chipped_anvil_top', 'anvil_top_damaged_1'], damaged_anvil_top: ['damaged_anvil_top', 'anvil_top_damaged_2'],
  end_portal_frame_side: ['end_portal_frame_side', 'endframe_side'], end_portal_frame_top: ['end_portal_frame_top', 'endframe_top'], end_portal_eye: ['end_portal_frame_eye', 'endframe_eye'],
  dragon_egg: ['dragon_egg'], iron_bars: ['iron_bars'], glass_pane_top: ['glass_pane_top'],
  rail: ['rail', 'rail_normal'], rail_corner: ['rail_corner', 'rail_normal_turned'], powered_rail: ['powered_rail', 'rail_golden'], powered_rail_on: ['powered_rail_on', 'rail_golden_powered'],
  detector_rail: ['detector_rail', 'rail_detector'], detector_rail_on: ['detector_rail_on', 'rail_detector_powered'], activator_rail: ['activator_rail', 'rail_activator'], activator_rail_on: ['activator_rail_on', 'rail_activator_powered'],
  hay_block_side: ['hay_block_side'], hay_block_top: ['hay_block_top'],
  observer_side: ['observer_side'], observer_top: ['observer_top'], observer_front: ['observer_front'], observer_back: ['observer_back'], observer_back_on: ['observer_back_on', 'observer_back_lit'],
  lapis_block: ['lapis_block'], lapis_ore: ['lapis_ore'],
  white_wool: ['white_wool', 'wool_colored_white'], orange_wool: ['orange_wool', 'wool_colored_orange'], magenta_wool: ['magenta_wool', 'wool_colored_magenta'],
  light_blue_wool: ['light_blue_wool', 'wool_colored_light_blue'], yellow_wool: ['yellow_wool', 'wool_colored_yellow'], lime_wool: ['lime_wool', 'wool_colored_lime'],
  pink_wool: ['pink_wool', 'wool_colored_pink'], gray_wool: ['gray_wool', 'wool_colored_gray'], light_gray_wool: ['light_gray_wool', 'wool_colored_silver'],
  cyan_wool: ['cyan_wool', 'wool_colored_cyan'], purple_wool: ['purple_wool', 'wool_colored_purple'], blue_wool: ['blue_wool', 'wool_colored_blue'],
  brown_wool: ['brown_wool', 'wool_colored_brown'], green_wool: ['green_wool', 'wool_colored_green'], red_wool: ['red_wool', 'wool_colored_red'], black_wool: ['black_wool', 'wool_colored_black'],
  chest_side: [], chest_top: [], chest_front: [], ender_chest_side: [], ender_chest_top: [], ender_chest_front: [],
  bed_head_top: [], bed_foot_top: [], bed_head_side: [], bed_foot_side: [], bed_head_end: [], bed_foot_end: [],
  moving_piston: [], unused_1: [], air: [], missing: [], minecart: [], minecart_inside: [], iron_bars_top: [], end_portal: [],
};

/** Block texture paths (under textures/) to look for, best first. */
export function blockPaths(name: string): string[] {
  if (/^redstone_dust_\d+$/.test(name)) return [];
  if (/^destroy_stage_\d$/.test(name)) return [`block/${name}.png`, `blocks/${name}.png`];
  const names = BLOCK_ALIASES[name] ?? [name];
  return names.flatMap((n) => [`block/${n}.png`, `blocks/${n}.png`]);
}

const PARTICLES: Record<string, string[]> = {
  particle_flame: ['flame'], particle_bubble: ['bubble'], particle_crit: ['critical_hit'], particle_heart: ['heart'],
  particle_drip: ['drip_hang'], particle_rain: ['splash_0'], particle_spell: ['effect_0', 'spell_0'], particle_flash: ['flash'],
};

/** Particle texture paths for the game's particle sprites. */
export function particlePaths(name: string): string[] {
  let m: RegExpMatchArray | null;
  const list = PARTICLES[name] ?? ((m = name.match(/^particle_(smoke|splash|explosion|spark)_(\d+)$/)) ? [`${m[1] === 'smoke' ? 'generic' : m[1]}_${m[2]}`] : []);
  return list.map((n) => `particle/${n}.png`);
}

const ITEM_ALIASES: Record<string, string[]> = {
  zombie_pigman_spawn_egg: ['zombified_piglin_spawn_egg'],
  compass: ['compass_16', 'compass'], clock: ['clock_00', 'clock'],
  red_bed: ['red_bed', 'bed'], oak_door: ['oak_door', 'door_wood'], oak_boat: ['oak_boat', 'boat'],
  glistering_melon_slice: ['glistering_melon_slice', 'speckled_melon'], melon_slice: ['melon_slice', 'melon'],
  cod: ['cod', 'fish_cod_raw'], cooked_cod: ['cooked_cod', 'fish_cod_cooked'], salmon: ['salmon', 'fish_salmon_raw'], cooked_salmon: ['cooked_salmon', 'fish_salmon_cooked'],
  pufferfish: ['pufferfish', 'fish_pufferfish_raw'], tropical_fish: ['tropical_fish', 'fish_clownfish_raw'],
  fishing_bobber: [], missing: [],
};

/** Item sprite paths. Potions are drawn by the game (their colours are its own). */
export function itemPaths(name: string): string[] {
  if (/potion/.test(name)) return [];
  const names = ITEM_ALIASES[name] ?? [name];
  return names.flatMap((n) => [`item/${n}.png`, `items/${n}.png`]);
}
