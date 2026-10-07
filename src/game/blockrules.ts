// Block rules of 1.9-1.16 that act on the world or on entities: concrete powder hardening in water, the basalt
// generator (lava over soul soil next to blue ice), bubble columns (soul sand lifts, magma drags down), honey
// blocks (slow, sticky, slide down their sides), magma blocks (hot floors), sweet berry bushes (slow and prick),
// soul fire (hotter than fire), scaffolding (climbed like a ladder).
import type { World } from '../world/world';
import type { Entity } from '../entity/entity';
import { B, B2, STONE2, BLOCKS, CONCRETE, CONCRETE_POWDER, idOf, metaOf, pack } from '../world/blocks';

// scaffolding is climbed like a ladder (jump to go up, sneak to come down)
BLOCKS[B2.SCAFFOLDING].climbable = true;

/** Concrete powder touching water (any side but below) sets into concrete. Returns true if it did. */
export function hardenConcrete(w: World, x: number, y: number, z: number): boolean {
  const i = CONCRETE_POWDER.indexOf(w.getId(x, y, z));
  if (i < 0) return false;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    const id = w.getId(x + dx, y + dy, z + dz);
    if (id === B.WATER || id === B2.BUBBLE_COLUMN) { w.set(x, y, z, CONCRETE[i]); return true; }
  }
  return false;
}

/** Lava at (x, y, z) over soul soil and next to blue ice becomes basalt (the basalt generator). Returns true if it did. */
export function basaltForms(w: World, x: number, y: number, z: number): boolean {
  if (w.getId(x, y - 1, z) !== B2.SOUL_SOIL) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getId(x + dx, y, z + dz) === B2.BLUE_ICE) { w.set(x, y, z, pack(STONE2.BASALT, 0)); return true; }
  return false;
}

// ------------------------------------------------------------------ bubble columns
/** Rebuild the bubble column standing on (x, y-1, z) upward through water sources (meta 1 = pulling down). */
export function updateColumn(w: World, x: number, y: number, z: number) {
  for (let yy = y, n = 0; yy < 256 && n < 256; yy++, n++) {
    const v = w.get(x, yy, z), id = idOf(v);
    const isSource = (id === B.WATER && metaOf(v) === 0) || id === B2.BUBBLE_COLUMN;
    if (!isSource) return;
    const below = w.getId(x, yy - 1, z);
    let want = -1;
    if (below === B.SOUL_SAND) want = 0;
    else if (below === B.MAGMA_BLOCK) want = 1;
    else if (below === B2.BUBBLE_COLUMN) want = metaOf(w.get(x, yy - 1, z)) & 1;
    const cur = id === B2.BUBBLE_COLUMN ? metaOf(v) & 1 : -1;
    if (want === cur) { if (want < 0) return; continue; }
    w.set(x, yy, z, want < 0 ? B.WATER : pack(B2.BUBBLE_COLUMN, want));
  }
}
/** A bubble column carries what's in it: up fast over soul sand, down over magma. */
export function bubblePush(e: Entity) {
  const w = e.world;
  const x = Math.floor(e.x), z = Math.floor(e.z);
  for (const yy of [Math.floor(e.y), Math.floor(e.y + e.height * 0.5)]) {
    const v = w.get(x, yy, z);
    if (idOf(v) !== B2.BUBBLE_COLUMN) continue;
    const down = (metaOf(v) & 1) === 1;
    // at the top (air above) the push is a burst out of the water
    const top = w.getId(x, yy + 1, z) === B.AIR;
    if (down) e.vy = Math.max(top ? -0.9 : -0.3, e.vy - (top ? 0.03 : 0.03));
    else e.vy = Math.min(top ? 1.8 : 0.7, e.vy + (top ? 0.1 : 0.06));
    e.fallDistance = 0;
    return;
  }
}

// ------------------------------------------------------------------ what the ground does to walkers
/** Under the feet of a living thing: honey (slow and sticky), magma (burns unless sneaking or fire-proof). */
export function standingOn(e: Entity & { damage?(n: number, s: string): boolean; sneaking?: boolean; fireImmune?: boolean; effects?: Map<string, unknown>; age: number }) {
  if (!e.onGround) return;
  const id = e.world.getId(Math.floor(e.x), Math.floor(e.y - 0.2), Math.floor(e.z));
  if (id === B2.HONEY_BLOCK) { e.vx *= 0.4; e.vz *= 0.4; }
  else if (id === B.MAGMA_BLOCK && !e.sneaking && !e.fireImmune && !e.effects?.has('fire_resistance') && e.age % 10 === 0) {
    const boots = (e as unknown as { inventory?: { armor: ({ ench?: Record<string, number> } | null)[] } }).inventory?.armor[3];
    if (!boots?.ench?.frost_walker) e.damage?.(1, 'hot_floor');
  }
}
/** Sliding down the side of a honey block: slow fall, no fall damage. */
export function honeySlide(e: Entity) {
  if (e.onGround || e.vy >= -0.08) return;
  const w = e.world, b = e.box;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = Math.floor(dx > 0 ? b.x1 + 0.05 : dx < 0 ? b.x0 - 0.05 : e.x), z = Math.floor(dz > 0 ? b.z1 + 0.05 : dz < 0 ? b.z0 - 0.05 : e.z);
    if (w.getId(x, Math.floor(e.y + 0.5), z) === B2.HONEY_BLOCK) { e.vy = -0.05; e.fallDistance = 0; return; }
  }
}
/** Blocks in the way: sweet berry bushes slow and prick what moves through them (stages 1-3); soul fire burns harder. */
export function insideBlock(e: Entity & { damage?(n: number, s: string): boolean; fireTicks: number; fireImmune?: boolean }, id: number, meta: number) {
  if (id === B2.SWEET_BERRY_BUSH) {
    e.vx *= 0.8; e.vz *= 0.8; e.vy *= 0.75;
    const moved = Math.abs(e.x - e.px) > 0.003 || Math.abs(e.z - e.pz) > 0.003;
    const kind = (e as unknown as { typeName?: string }).typeName;
    if (meta > 0 && moved && kind !== 'Fox' && kind !== 'Bee') e.damage?.(1, 'sweet_berry_bush');
  } else if (id === B2.SOUL_FIRE && !e.fireImmune) {
    e.damage?.(2, 'soul_fire');
    e.fireTicks = Math.max(e.fireTicks, 160);
  }
}

/**
 * Scaffolding (1.14): each piece is 0 on the ground or a tower over it, one more than its least neighbour sideways
 * (to 7); at 7 it falls. A piece hanging over nothing gets a frame round its bottom (meta bit 8).
 */
export function scaffoldingDistance(w: World, x: number, y: number, z: number): number {
  const below = w.getId(x, y - 1, z);
  if (below === B2.SCAFFOLDING) return metaOf(w.get(x, y - 1, z)) & 7;
  if (BLOCKS[below]?.solid) return 0;
  let d = 7;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getId(x + dx, y, z + dz) === B2.SCAFFOLDING) d = Math.min(d, (metaOf(w.get(x + dx, y, z + dz)) & 7) + 1);
  return d;
}
BLOCKS[B2.SCAFFOLDING].behavior = {
  ...BLOCKS[B2.SCAFFOLDING].behavior,
  neighborChanged(c) { c.game.ticker?.schedule(c.x, c.y, c.z, 1); },
  onPlaced(c) { c.game.ticker?.schedule(c.x, c.y, c.z, 1); },
  scheduledTick(c) {
    const w = c.world, d = scaffoldingDistance(w, c.x, c.y, c.z);
    if (d >= 7) {
      w.set(c.x, c.y, c.z, B.AIR);
      c.game.interact?.fallingBlock(c.x, c.y, c.z, B2.SCAFFOLDING);
      return;
    }
    const bottom = d > 0 && w.getId(c.x, c.y - 1, c.z) !== B2.SCAFFOLDING && !BLOCKS[w.getId(c.x, c.y - 1, c.z)]?.solid ? 8 : 0;
    if ((c.meta & 15) !== (d | bottom)) w.set(c.x, c.y, c.z, pack(B2.SCAFFOLDING, d | bottom));
  },
};
