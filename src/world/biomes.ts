export interface Biome {
  id: number;
  name: string;
  grass: number; // 0xRRGGBB
  foliage: number;
  water: number;
  cold: boolean;
  treeDensity: number;
}

export const BIOMES: Biome[] = [];
function b(name: string, grass: number, foliage: number, cold = false, treeDensity = 0, water = 0x3f76e4): number {
  BIOMES.push({ id: BIOMES.length, name, grass, foliage, water, cold, treeDensity });
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
};
