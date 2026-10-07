// Rules shared by block families (shape-driven): how stairs, slabs, doors, trapdoors, gates, buttons, pressure
// plates, signs, heads, lanterns, chains, campfires, coral, vines and two-block plants are placed, opened, held up,
// broken in pairs and seen by redstone. The game's interaction, block-tick and redstone code ask here first, so a
// new block of a known family needs no code of its own.
import type { World } from '../world/world';
import {
  B, B2, BLOCKS, OPAQUE, SHAPE, Shape, HORIZ, idOf, metaOf, pack, isStairs, isSlab, isDoor, isTrapdoor, isGate, isButton,
  isPlate, isBed, isDoublePlant, isPillar, isFence, isWall, isNetherSoil, isSoil, waterloggable, WATERLOGGED, CORAL,
  isLeaves, WOOD, STONE2,
} from '../world/blocks';

/** What a placement needs to know. `face` is the clicked face of the block clicked (0 -x .. 5 +z). */
export interface PlaceInfo {
  world: World;
  x: number; y: number; z: number;
  face: number;
  /** Player facing: 0 north, 1 east, 2 south, 3 west. */
  facing: number;
  /** Player yaw in degrees (signs and heads turn in 16 steps). */
  yaw: number;
  /** Where the click landed on the face, vertically (0..1). */
  hitY: number;
  /** The block that was in the cell before (water: the new block may take it in). */
  replaced: number;
}
/** A placement: blocks to put down (the first is the one clicked into place), or null if it can't go there. */
export type Placement = [number, number, number, number][] | null;

/** A clicked face's direction to the wall it's on, for blocks hung on walls (HORIZ index), or -1 for top/bottom. */
const WALL_DIR: Record<number, number> = { 0: 1, 1: 3, 4: 2, 5: 0 };
const wallOf = (face: number) => WALL_DIR[face] ?? -1;
/** Does the block in direction `dir` (HORIZ) hold a wall-mounted block? */
const wallSolid = (w: World, x: number, y: number, z: number, dir: number) => {
  const [dx, dz] = HORIZ[dir];
  return OPAQUE[w.getId(x + dx, y, z + dz)] === 1;
};
const solidTop = (id: number) => OPAQUE[id] === 1 || isFence(id) || isWall(id) || id === B.GLASS || isSlab(id) || isStairs(id);

/** Placement rules of the family blocks; undefined = not a family the game handles here. */
export function familyPlacement(id: number, p: PlaceInfo): Placement | undefined {
  const { world: w, x, y, z, face, facing } = p;
  const sh = SHAPE[id];
  const upperHalf = face === 2 || (face !== 3 && p.hitY > 0.5);
  const logged = (v: number) => (waterloggable(idOf(v)) && idOf(p.replaced) === B.WATER && metaOf(p.replaced) === 0 ? v | (8 << 12) : v);
  const rot16 = Math.floor(((p.yaw + 180) * 16) / 360 + 0.5) & 15;
  switch (sh) {
    case Shape.Stairs: return [[x, y, z, logged(pack(id, facing | (upperHalf ? 4 : 0)))]];
    case Shape.Slab: return [[x, y, z, logged(pack(id, upperHalf ? 1 : 0))]];
    case Shape.Log: return [[x, y, z, pack(id, face === 0 || face === 1 ? 1 : face === 4 || face === 5 ? 2 : 0)]];
    case Shape.Fence: case Shape.Wall: case Shape.Pane: return [[x, y, z, logged(pack(id, 0))]];
    case Shape.Gate: return [[x, y, z, pack(id, facing)]];
    case Shape.Trapdoor: return [[x, y, z, pack(id, facing | (upperHalf ? 4 : 0))]];
    case Shape.Door: {
      if (!BLOCKS[w.getId(x, y + 1, z)].replaceable || !BLOCKS[w.getId(x, y - 1, z)].solid) return null;
      return [[x, y, z, pack(id, facing)], [x, y + 1, z, pack(id, facing | 8)]];
    }
    case Shape.Bed: {
      const [dx, dz] = HORIZ[facing];
      const hx = x + dx, hz = z + dz;
      if (!BLOCKS[w.getId(hx, y, hz)].replaceable || !BLOCKS[w.getId(x, y - 1, z)].solid || !BLOCKS[w.getId(hx, y - 1, hz)].solid) return null;
      return [[x, y, z, pack(id, facing)], [hx, y, hz, pack(id, facing | 8)]];
    }
    case Shape.DoublePlant: {
      if (!BLOCKS[w.getId(x, y + 1, z)].replaceable && w.getId(x, y + 1, z) !== B.AIR) return null;
      return [[x, y, z, pack(id, 0)], [x, y + 1, z, pack(id, 8)]];
    }
    case Shape.Button: {
      const meta = face === 3 ? 0 : face === 2 ? 5 : wallOf(face) + 1;
      return [[x, y, z, pack(id, meta)]];
    }
    case Shape.Plate: case Shape.Carpet: return [[x, y, z, pack(id, 0)]];
    case Shape.Sign: case Shape.WallSign: {
      const kind = BLOCKS[id].name.replace(/_(wall_)?sign$/, '');
      if (face === 3) return [[x, y, z, pack(blockId(kind + '_sign'), rot16)]];
      const d = wallOf(face);
      if (d < 0) return null;
      return [[x, y, z, logged(pack(blockId(kind + '_wall_sign'), d))]];
    }
    case Shape.Banner: case Shape.WallBanner: {
      const color = BLOCKS[id].name.replace(/_(wall_)?banner$/, '');
      if (face === 3) return [[x, y, z, pack(blockId(color + '_banner'), rot16)]];
      const d = wallOf(face);
      if (d < 0) return null;
      return [[x, y, z, pack(blockId(color + '_wall_banner'), d)]];
    }
    case Shape.Head: case Shape.WallHead: {
      const base = BLOCKS[id].name.replace('_wall_', '_');
      if (face === 3 || face === 2) return [[x, y, z, pack(blockId(base), rot16)]];
      const wall = base.replace(/_(skull|head)$/, '_wall_$1');
      return [[x, y, z, pack(blockId(wall), wallOf(face))]];
    }
    case Shape.Lantern: {
      const hang = face === 2 || !BLOCKS[w.getId(x, y - 1, z)].solid;
      return [[x, y, z, logged(pack(id, hang ? 1 : 0))]];
    }
    case Shape.Chain: return [[x, y, z, logged(pack(id, face === 0 || face === 1 ? 1 : face === 4 || face === 5 ? 2 : 0))]];
    case Shape.Campfire: return [[x, y, z, pack(id, facing)]];
    case Shape.Coral: return [[x, y, z, logged(pack(id, 0))]];
    case Shape.CoralFan: {
      const meta = face === 3 ? 0 : wallOf(face) + 1;
      if (meta < 0 || face === 2) return null;
      return [[x, y, z, logged(pack(id, meta))]];
    }
    case Shape.Vine: {
      const d = wallOf(face);
      if (d < 0) return null;
      const cur = w.get(x, y, z);
      const m = idOf(cur) === id ? metaOf(cur) : 0;
      return [[x, y, z, pack(id, m | (1 << d))]];
    }
  }
  // single blocks with a facing of their own
  switch (id) {
    case B2.GRINDSTONE: case B2.BELL: case B2.LECTERN: case B2.TRIPWIRE_HOOK:
      return [[x, y, z, pack(id, id === B2.TRIPWIRE_HOOK ? Math.max(0, wallOf(face)) : facing)]];
    case B2.COCOA: {
      const d = wallOf(face);
      return d < 0 ? null : [[x, y, z, pack(id, d)]];
    }
    case B2.KELP: case B2.SEAGRASS: case B2.TALL_SEAGRASS:
      return idOf(p.replaced) === B.WATER || WATERLOGGED[p.replaced] ? [[x, y, z, pack(id, 0)]] : null;
    case B2.SEA_PICKLE: return [[x, y, z, pack(id, idOf(p.replaced) === B.WATER ? 4 : 0)]];
    case B.LADDER: {
      const d = wallOf(face);
      return d < 0 ? null : [[x, y, z, logged(pack(id, d))]];
    }
  }
  return undefined;
}
const byName = new Map<string, number>();
function blockId(name: string): number {
  let id = byName.get(name);
  if (id === undefined) { id = BLOCKS.findIndex((b) => b.name === name); byName.set(name, id); }
  return id < 0 ? B.AIR : id;
}

/** The slab two of these make (legacy slabs became a full block; newer ones keep their own double state). */
export function doubleSlab(slab: number, cur: number): number {
  if (slab === B.STONE_SLAB) return B.DOUBLE_STONE_SLAB;
  if (slab === B.OAK_SLAB) return B.OAK_PLANKS;
  if (slab === B.COBBLESTONE_SLAB) return B.COBBLESTONE;
  void cur;
  return pack(slab, 2);
}

/** The other block(s) of a two-block family member, to remove together. */
export function partners(w: World, x: number, y: number, z: number, v: number): [number, number, number][] {
  const id = idOf(v), meta = metaOf(v);
  if (isDoor(id) || isDoublePlant(id)) {
    const oy = meta & 8 ? y - 1 : y + 1;
    return w.getId(x, oy, z) === id ? [[x, oy, z]] : [];
  }
  if (isBed(id)) {
    const [dx, dz] = HORIZ[meta & 3];
    const ox = meta & 8 ? x - dx : x + dx, oz = meta & 8 ? z - dz : z + dz;
    return w.getId(ox, y, oz) === id ? [[ox, y, oz]] : [];
  }
  return [];
}

/** Support rules of the family blocks: true/false, or undefined when the family has none to say. */
export function familyCanStay(w: World, x: number, y: number, z: number, v: number): boolean | undefined {
  const id = idOf(v), meta = metaOf(v);
  const below = w.getId(x, y - 1, z), above = w.getId(x, y + 1, z);
  switch (SHAPE[id]) {
    case Shape.Button: {
      const at = meta & 7;
      if (at === 0) return OPAQUE[below] === 1;
      if (at === 5) return OPAQUE[above] === 1;
      return wallSolid(w, x, y, z, (at - 1) & 3);
    }
    case Shape.Plate: return solidTop(below);
    case Shape.Carpet: return below !== B.AIR;
    case Shape.Door: {
      if (meta & 8) return w.getId(x, y - 1, z) === id;
      return w.getId(x, y + 1, z) === id && BLOCKS[below].solid;
    }
    case Shape.Bed: {
      const [dx, dz] = HORIZ[meta & 3];
      const o = meta & 8 ? w.get(x - dx, y, z - dz) : w.get(x + dx, y, z + dz);
      return idOf(o) === id;
    }
    case Shape.DoublePlant: {
      if (meta & 8) return w.getId(x, y - 1, z) === id;
      if (w.getId(x, y + 1, z) !== id) return false;
      if (id === B2.TALL_SEAGRASS) return BLOCKS[below].solid;
      return isSoil(below);
    }
    case Shape.Sign: case Shape.Banner: return BLOCKS[below].solid;
    case Shape.WallSign: case Shape.WallHead: case Shape.WallBanner: return wallSolid(w, x, y, z, meta & 3);
    case Shape.Lantern: return meta & 1 ? BLOCKS[above].solid || above === B2.CHAIN : BLOCKS[below].solid;
    case Shape.Coral: return BLOCKS[below].solid;
    case Shape.CoralFan: { const at = meta & 7; return at === 0 ? BLOCKS[below].solid : wallSolid(w, x, y, z, (at - 1) & 3); }
    case Shape.Vine: {
      // any side still against a solid block (or a vine above to hang from)
      for (let d = 0; d < 4; d++) if (meta & (1 << d) && wallSolid(w, x, y, z, d)) return true;
      return above === B2.VINE || OPAQUE[above] === 1;
    }
    case Shape.Sapling: if (BLOCKS[id].tree?.endsWith('_fungus')) return isNetherSoil(below) || below === B.NETHERRACK; break;
  }
  switch (id) {
    case B2.CRIMSON_ROOTS: case B2.WARPED_ROOTS: case B2.NETHER_SPROUTS: return isNetherSoil(below);
    case B2.WEEPING_VINES: case B2.WEEPING_VINES_PLANT: return BLOCKS[above].solid || above === B2.WEEPING_VINES || above === B2.WEEPING_VINES_PLANT;
    case B2.TWISTING_VINES: case B2.TWISTING_VINES_PLANT: return BLOCKS[below].solid || below === B2.TWISTING_VINES || below === B2.TWISTING_VINES_PLANT;
    case B2.KELP: case B2.KELP_PLANT: return (BLOCKS[below].solid && below !== B.MAGMA_BLOCK) || below === B2.KELP || below === B2.KELP_PLANT;
    case B2.SEAGRASS: case B2.SEA_PICKLE: case B2.TURTLE_EGG: return BLOCKS[below].solid;
    case B2.BAMBOO: case B2.BAMBOO_SAPLING: return below === B2.BAMBOO || below === B2.BAMBOO_SAPLING || isSoil(below) || below === B.SAND || below === B.GRAVEL || below === STONE2.RED_SAND;
    case B2.SWEET_BERRY_BUSH: return isSoil(below);
    case B2.BEETROOTS: case B2.MELON_STEM: return below === B.FARMLAND;
    case B2.COCOA: { const [dx, dz] = HORIZ[meta & 3]; const n = w.getId(x + dx, y, z + dz); return n === WOOD.jungle.log || n === WOOD.jungle.wood; }
    // a flower stands on its stalk (or end stone), or grows out sideways from one with air beneath
    case B2.CHORUS_FLOWER: return below === B2.CHORUS_PLANT || below === B.END_STONE || (below === B.AIR && HORIZ.filter(([dx, dz]) => w.getId(x + dx, y, z + dz) === B2.CHORUS_PLANT).length === 1);
    case B2.CHORUS_PLANT: {
      if (below === B2.CHORUS_PLANT || below === B.END_STONE) return true;
      return HORIZ.some(([dx, dz]) => w.getId(x + dx, y, z + dz) === B2.CHORUS_PLANT && [B2.CHORUS_PLANT, B.END_STONE].includes(w.getId(x + dx, y - 1, z + dz)));
    }
    case B2.TRIPWIRE_HOOK: return wallSolid(w, x, y, z, meta & 3);
    case B2.SOUL_TORCH: {
      if (meta === 0) return BLOCKS[below].solid;
      return wallSolid(w, x, y, z, (meta - 1) & 3);
    }
    case B2.FLOWER_POT: return BLOCKS[below].solid;
    case B2.SOUL_FIRE: return below === B.SOUL_SAND || below === B2.SOUL_SOIL;
  }
  if (CORAL_PLANTS.has(id)) return BLOCKS[below].solid;
  return undefined;
}
const CORAL_PLANTS = new Set(CORAL.flatMap((c) => [c.plant, c.deadPlant]));

/** Right-click on a family block: doors, trapdoors and gates swing (not iron ones). Returns the new value, or null. */
export function toggled(v: number, playerFacing: number): number | null {
  const id = idOf(v), m = metaOf(v);
  if (BLOCKS[id].material === 'iron') return null;
  if (isDoor(id)) return pack(id, m ^ 4);
  if (isTrapdoor(id)) return pack(id, m ^ 8);
  if (isGate(id)) {
    // a gate opens away from whoever opens it
    if (m & 4) return pack(id, m & 3);
    const f = m & 3;
    const away = (playerFacing & 1) === (f & 1) ? playerFacing : f;
    return pack(id, away | 4);
  }
  return null;
}

/** How long a button stays pressed (wooden ones longer). */
export const buttonTicks = (id: number) => (BLOCKS[id].material === 'wood' || BLOCKS[id].material === 'nether_wood' ? 30 : 20);
/** Power of a pressure plate from its meta (weighted plates store their level). */
export const platePower = (id: number, meta: number) => (BLOCKS[id].material === 'iron' || BLOCKS[id].material === 'gold' ? meta : meta ? 15 : 0);
/** Which entities press a plate: 'all' (wood, weighted) or 'mobs' (stone: players and mobs only). */
export const platePresses = (id: number) => (BLOCKS[id].material === 'stone' ? 'mobs' : 'all');
/** Weighted plates: power from the number of entities on them (vanilla: gold 1 per entity, iron 1 per 10). */
export const weightedLevel = (id: number, n: number) => (BLOCKS[id].material === 'gold' ? Math.min(15, n) : BLOCKS[id].material === 'iron' ? Math.min(15, Math.ceil(n / 10)) : n ? 15 : 0);

/** Fluids and fire: is this cell water (or a block standing in water)? */
export const waterAt = (w: World, x: number, y: number, z: number) => { const v = w.get(x, y, z); return idOf(v) === B.WATER || WATERLOGGED[v] === 1; };

export { isStairs, isPillar, isLeaves, isButton, isPlate };
