// How the plants of 1.9-1.16 grow (random ticks): beetroots, melon stems, sweet berries, cocoa pods, bamboo, kelp,
// weeping and twisting vines; and coral, which dies out of the water.
import { B, B2, BLOCKS, CORAL, idOf, metaOf, pack } from '../world/blocks';
import type { BlockCtx } from '../mod/types';

const DIRS4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const light = (c: BlockCtx) => { const [s, b] = c.world.getLight(c.x, c.y + 1, c.z); return Math.max(c.game.isDaytime() ? s : s - 11, b); };
const rnd = (n: number) => Math.floor(Math.random() * n);

/** A crop with `max` stages (beetroots: 3) growing like wheat: faster on wet farmland. */
const crop = (max: number) => (c: BlockCtx) => {
  if (c.meta >= max || light(c) < 9) return;
  const moist = metaOf(c.world.get(c.x, c.y - 1, c.z)) > 0;
  if (rnd(moist ? 6 : 14) === 0) c.setMeta(c.meta + 1);
};
BLOCKS[B2.BEETROOTS].behavior = { ...BLOCKS[B2.BEETROOTS].behavior, randomTick: crop(3) };

/** Melon stems: grow, then put a melon on a free side. */
BLOCKS[B2.MELON_STEM].behavior = {
  ...BLOCKS[B2.MELON_STEM].behavior,
  randomTick(c) {
    if (light(c) < 9) return;
    if (c.meta < 7) { if (rnd(5) === 0) c.setMeta(c.meta + 1); return; }
    if (DIRS4.some(([dx, dz]) => c.world.getId(c.x + dx, c.y, c.z + dz) === B.MELON)) return;
    const [dx, dz] = DIRS4[rnd(4)];
    const under = c.world.getId(c.x + dx, c.y - 1, c.z + dz);
    if (c.world.getId(c.x + dx, c.y, c.z + dz) === B.AIR && (under === B.DIRT || under === B.GRASS || under === B.FARMLAND)) c.world.set(c.x + dx, c.y, c.z + dz, B.MELON);
  },
};

/** Sweet berry bushes ripen in the light (stage 3 is full of berries). */
BLOCKS[B2.SWEET_BERRY_BUSH].behavior = {
  ...BLOCKS[B2.SWEET_BERRY_BUSH].behavior,
  randomTick(c) { if (c.meta < 3 && light(c) >= 9 && rnd(5) === 0) c.setMeta(c.meta + 1); },
};

/** Cocoa pods (age in the high bits, facing in the low two) swell on jungle logs. */
BLOCKS[B2.COCOA].behavior = {
  ...BLOCKS[B2.COCOA].behavior,
  randomTick(c) { const age = c.meta >> 2; if (age < 2 && rnd(5) === 0) c.setMeta(((age + 1) << 2) | (c.meta & 3)); },
};

/** Bamboo shoots up (to 12-16 tall) where there's light and room. */
BLOCKS[B2.BAMBOO].behavior = {
  ...BLOCKS[B2.BAMBOO].behavior,
  randomTick(c) {
    const w = c.world;
    if (w.getId(c.x, c.y + 1, c.z) !== B.AIR || light(c) < 9 || rnd(3)) return;
    let h = 1;
    while (w.getId(c.x, c.y - h, c.z) === B2.BAMBOO && h < 17) h++;
    if (h >= 12 + ((c.x * 7 + c.z * 13) & 3)) return;
    w.set(c.x, c.y + 1, c.z, pack(B2.BAMBOO, c.meta));
  },
};

/** Kelp: the top grows up through water (14% a tick, up to its age limit), the stem below becomes kelp plant. */
BLOCKS[B2.KELP].behavior = {
  ...BLOCKS[B2.KELP].behavior,
  randomTick(c) {
    const w = c.world;
    if (c.meta >= 15 || rnd(7) || w.getId(c.x, c.y + 1, c.z) !== B.WATER || metaOf(w.get(c.x, c.y + 1, c.z)) !== 0) return;
    w.set(c.x, c.y + 1, c.z, pack(B2.KELP, c.meta + 1));
    w.set(c.x, c.y, c.z, B2.KELP_PLANT);
  },
};

/** Weeping vines grow down and twisting vines up, from their tips (10% a tick). */
for (const [tip, plant, dir] of [[B2.WEEPING_VINES, B2.WEEPING_VINES_PLANT, -1], [B2.TWISTING_VINES, B2.TWISTING_VINES_PLANT, 1]] as const) {
  BLOCKS[tip].behavior = {
    ...BLOCKS[tip].behavior,
    randomTick(c) {
      const w = c.world;
      if (c.meta >= 15 || rnd(10) || w.getId(c.x, c.y + dir, c.z) !== B.AIR) return;
      w.set(c.x, c.y + dir, c.z, pack(tip, c.meta + 1));
      w.set(c.x, c.y, c.z, plant);
    },
  };
}

/** Coral out of the water dies (turns to its dead form). */
const deadOf = new Map<number, number>();
for (const c of CORAL) { deadOf.set(c.block, c.dead); deadOf.set(c.plant, c.deadPlant); deadOf.set(c.fan, c.deadFan); }
const wet = (c: BlockCtx) => {
  const w = c.world;
  if (BLOCKS[idOf(c.v)] && (metaOf(c.v) & 8) !== 0) return true; // waterlogged fans and coral
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (w.getId(c.x + dx, c.y + dy, c.z + dz) === B.WATER) return true;
  return false;
};
for (const [live, dead] of deadOf) {
  BLOCKS[live].behavior = {
    ...BLOCKS[live].behavior,
    randomTick(c) { if (!wet(c)) c.set(pack(dead, metaOf(c.v) & 7)); },
  };
}

/**
 * Chorus flowers (vanilla's growth): on end stone or a short stalk they grow straight up; higher, they branch out
 * sideways into one to four new flowers a stage older, leaving a stalk behind; at stage 5 (or boxed in) they die.
 */
const airAround = (c: BlockCtx, x: number, y: number, z: number, except: [number, number]) =>
  DIRS4.every(([dx, dz]) => (dx === except[0] && dz === except[1]) || c.world.getId(x + dx, y, z + dz) === B.AIR);
BLOCKS[B2.CHORUS_FLOWER].behavior = {
  ...BLOCKS[B2.CHORUS_FLOWER].behavior,
  randomTick(c) {
    const age = c.meta;
    if (age >= 5 || c.y >= 255 || c.world.getId(c.x, c.y + 1, c.z) !== B.AIR) return;
    const below = c.world.getId(c.x, c.y - 1, c.z);
    // how tall is the stalk under it, and does it stand on end stone at its foot?
    let up = false, onStone = false;
    if (below === B.END_STONE) up = true;
    else if (below === B2.CHORUS_PLANT) {
      let n = 1;
      while (n < 5 && c.world.getId(c.x, c.y - n - 1, c.z) === B2.CHORUS_PLANT) n++;
      onStone = c.world.getId(c.x, c.y - n - 1, c.z) === B.END_STONE;
      if (n < 2 || n <= rnd(onStone ? 5 : 4)) up = true;
    } else if (below === B.AIR) up = true;
    const grow = (x: number, y: number, z: number, a: number) => { c.world.set(x, y, z, pack(B2.CHORUS_FLOWER, a)); c.game.playBlockSound?.(B2.CHORUS_FLOWER, x, y, z, 'place'); };
    if (up && airAround(c, c.x, c.y + 1, c.z, [0, 0]) && c.world.getId(c.x, c.y + 2, c.z) === B.AIR) {
      c.world.set(c.x, c.y, c.z, B2.CHORUS_PLANT);
      grow(c.x, c.y + 1, c.z, age);
      return;
    }
    if (age < 4) {
      const n = rnd(4) + (onStone ? 1 : 0);
      const spots: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const [dx, dz] = DIRS4[rnd(4)];
        const x = c.x + dx, z = c.z + dz;
        if (c.world.getId(x, c.y, z) === B.AIR && c.world.getId(x, c.y - 1, z) === B.AIR && airAround(c, x, c.y, z, [-dx, -dz]) && !spots.some(([a, b]) => a === x && b === z)) spots.push([x, z]);
      }
      // the stalk first, so the new flowers have something to grow out of
      if (spots.length) { c.world.set(c.x, c.y, c.z, B2.CHORUS_PLANT); for (const [x, z] of spots) grow(x, c.y, z, age + 1); return; }
    }
    c.setMeta(5);
  },
};
