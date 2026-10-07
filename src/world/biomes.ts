export interface Biome {
  id: number;
  name: string;
  grass: number; // 0xRRGGBB
  foliage: number;
  water: number;
  cold: boolean;
  treeDensity: number;
  /** 1.16 biome effects (optional): fog and water-fog colours, sky colour, ambient particle, temperature, rain. */
  fog?: number;
  waterFog?: number;
  sky?: number;
  particle?: 'crimson_spore' | 'warped_spore' | 'white_ash' | 'ash' | 'soul' | 'mycelium';
  /** Ambient particle chance per block per tick, roughly (vanilla probability). */
  particleChance?: number;
  temperature?: number;
  /** Dry biomes never rain (deserts, savannas, badlands, the Nether, the End). */
  dry?: boolean;
  dim?: 'overworld' | 'nether' | 'end';
}

export const BIOMES: Biome[] = [];
function b(name: string, grass: number, foliage: number, cold = false, treeDensity = 0, water = 0x3f76e4): number {
  BIOMES.push({ id: BIOMES.length, name, grass, foliage, water, cold, treeDensity });
  return BIOMES.length - 1;
}
/** Register with extra effects. */
function bx(name: string, grass: number, foliage: number, o: Partial<Biome> & { cold?: boolean; trees?: number; water?: number } = {}): number {
  BIOMES.push({ id: BIOMES.length, name, grass, foliage, water: o.water ?? 0x3f76e4, cold: o.cold ?? false, treeDensity: o.trees ?? 0, ...o });
  return BIOMES.length - 1;
}

export const BIOME = {
  OCEAN: b('Ocean', 0x8eb971, 0x71a74d),
  FROZEN_OCEAN: b('Frozen Ocean', 0x80b497, 0x60a17b, true),
  BEACH: b('Beach', 0x91bd59, 0x77ab2f),
  PLAINS: b('Plains', 0x91bd59, 0x77ab2f, false, 0.02),
  DESERT: b('Desert', 0xbfb755, 0xaea42a),
  MOUNTAINS: b('Windswept Hills', 0x8ab689, 0x6da36b, false, 0.08),
  FOREST: b('Forest', 0x79c05a, 0x59ae30, false, 1),
  BIRCH_FOREST: b('Birch Forest', 0x88bb67, 0x6ba941, false, 1),
  TAIGA: b('Taiga', 0x86b783, 0x68a464, false, 1),
  SNOWY_PLAINS: b('Snowy Plains', 0x80b497, 0x60a17b, true, 0.02),
  SNOWY_TAIGA: b('Snowy Taiga', 0x80b497, 0x60a17b, true, 0.8),
  RIVER: b('River', 0x91bd59, 0x77ab2f),
  SWAMP: b('Swamp', 0x6a7039, 0x6a7039, false, 0.25, 0x617b64),
  SNOWY_BEACH: b('Snowy Beach', 0x80b497, 0x60a17b, true),
  FROZEN_RIVER: b('Frozen River', 0x80b497, 0x60a17b, true),
  SAVANNA: b('Savanna', 0xbfb755, 0xaea42a, false, 0.06),
  FLOWER_FOREST: b('Flower Forest', 0x79c05a, 0x59ae30, false, 0.5),
  NETHER: b('Nether Wastes', 0xbfb755, 0xaea42a),
  THE_END: b('The End', 0xbfb755, 0xaea42a),
  // ---- 1.16 (appended: ids are saved with chunks)
  SOUL_SAND_VALLEY: bx('Soul Sand Valley', 0xbfb755, 0xaea42a, { fog: 0x1b4745, particle: 'ash', particleChance: 0.00625, dim: 'nether', dry: true }),
  CRIMSON_FOREST: bx('Crimson Forest', 0xbfb755, 0xaea42a, { fog: 0x330303, particle: 'crimson_spore', particleChance: 0.025, dim: 'nether', dry: true }),
  WARPED_FOREST: bx('Warped Forest', 0xbfb755, 0xaea42a, { fog: 0x1a051a, particle: 'warped_spore', particleChance: 0.01428, dim: 'nether', dry: true }),
  BASALT_DELTAS: bx('Basalt Deltas', 0xbfb755, 0xaea42a, { fog: 0x685f70, particle: 'white_ash', particleChance: 0.118093, dim: 'nether', dry: true }),
  SMALL_END_ISLANDS: bx('Small End Islands', 0xbfb755, 0xaea42a, { fog: 0xa080a0, dim: 'end', dry: true }),
  END_MIDLANDS: bx('End Midlands', 0xbfb755, 0xaea42a, { fog: 0xa080a0, dim: 'end', dry: true }),
  END_HIGHLANDS: bx('End Highlands', 0xbfb755, 0xaea42a, { fog: 0xa080a0, dim: 'end', dry: true }),
  END_BARRENS: bx('End Barrens', 0xbfb755, 0xaea42a, { fog: 0xa080a0, dim: 'end', dry: true }),
  SUNFLOWER_PLAINS: bx('Sunflower Plains', 0x91bd59, 0x77ab2f, { trees: 0.02 }),
  DARK_FOREST: bx('Dark Forest', 0x507a32, 0x59ae30, { trees: 2 }),
  GIANT_TREE_TAIGA: bx('Giant Tree Taiga', 0x86b87f, 0x68a55f, { trees: 1.2 }),
  GRAVELLY_MOUNTAINS: bx('Gravelly Mountains', 0x8ab689, 0x6da36b, { trees: 0.05 }),
  ICE_SPIKES: bx('Ice Spikes', 0x80b497, 0x60a17b, { cold: true }),
  JUNGLE: bx('Jungle', 0x59c93c, 0x30bb0b, { trees: 3, water: 0x3f76e4 }),
  JUNGLE_EDGE: bx('Jungle Edge', 0x64c73f, 0x3eb80f, { trees: 0.5 }),
  BAMBOO_JUNGLE: bx('Bamboo Jungle', 0x59c93c, 0x30bb0b, { trees: 1.2 }),
  BADLANDS: bx('Badlands', 0x90814d, 0x9e814d, { dry: true, sky: 0x6eb1ff }),
  WOODED_BADLANDS: bx('Wooded Badlands Plateau', 0x90814d, 0x9e814d, { dry: true, trees: 0.6 }),
  STONE_SHORE: bx('Stone Shore', 0x8ab689, 0x6da36b),
  DEEP_OCEAN: bx('Deep Ocean', 0x8eb971, 0x71a74d),
  WARM_OCEAN: bx('Warm Ocean', 0x8eb971, 0x71a74d, { water: 0x43d5ee, waterFog: 0x041f33 }),
  LUKEWARM_OCEAN: bx('Lukewarm Ocean', 0x8eb971, 0x71a74d, { water: 0x45adf2, waterFog: 0x041633 }),
  COLD_OCEAN: bx('Cold Ocean', 0x8eb971, 0x71a74d, { water: 0x3d57d6, waterFog: 0x050533 }),
  DEEP_FROZEN_OCEAN: bx('Deep Frozen Ocean', 0x80b497, 0x60a17b, { cold: true, water: 0x3938c9 }),
  DEEP_COLD_OCEAN: bx('Deep Cold Ocean', 0x8eb971, 0x71a74d, { water: 0x3d57d6 }),
  DEEP_LUKEWARM_OCEAN: bx('Deep Lukewarm Ocean', 0x8eb971, 0x71a74d, { water: 0x45adf2 }),
  MUSHROOM_FIELDS: bx('Mushroom Fields', 0x55c93f, 0x2bbb0f, { particle: 'mycelium', particleChance: 0 }),
  SNOWY_MOUNTAINS: bx('Snowy Mountains', 0x80b497, 0x60a17b, { cold: true, trees: 0.02 }),
  TALL_BIRCH_FOREST: bx('Tall Birch Forest', 0x88bb67, 0x6ba941, { trees: 1 }),
  SAVANNA_PLATEAU: bx('Savanna Plateau', 0xbfb755, 0xaea42a, { trees: 0.1, dry: true }),
};
for (const id of [BIOME.NETHER]) Object.assign(BIOMES[id], { fog: 0x330808, dim: 'nether', dry: true });
Object.assign(BIOMES[BIOME.THE_END], { fog: 0xa080a0, dim: 'end', dry: true });
for (const id of [BIOME.DESERT, BIOME.SAVANNA]) BIOMES[id].dry = true;

export const isNetherBiome = (id: number) => BIOMES[id]?.dim === 'nether';
export const isOceanBiome = (id: number) => [BIOME.OCEAN, BIOME.FROZEN_OCEAN, BIOME.DEEP_OCEAN, BIOME.WARM_OCEAN, BIOME.LUKEWARM_OCEAN, BIOME.COLD_OCEAN, BIOME.DEEP_FROZEN_OCEAN, BIOME.DEEP_COLD_OCEAN, BIOME.DEEP_LUKEWARM_OCEAN].includes(id);
