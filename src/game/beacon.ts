// Beacons and conduits. A beacon on a pyramid of iron, gold, emerald, diamond or netherite blocks (1-4 levels) with
// a clear view of the sky shines a beam and, paid with an ingot, emerald or diamond, gives everyone nearby a power
// (speed or haste; resistance or jump boost at two levels; strength at three; at four, regeneration or the first
// power at level II). A conduit in a frame of prismarine under water gives Conduit Power to swimmers and, with a
// full frame, attacks monsters near it.
import type { Game } from './game';
import type { World } from '../world/world';
import { B, B2, STONE2, BLOCKS, OPAQUE, STAINED_GLASS, STAINED_PANES } from '../world/blocks';
import { blockIs } from './tags';
import { DYE_RGB, I, I7 } from './items';
import type { LivingEntity } from '../entity/living';

export interface BeaconTile { type: 'beacon'; levels: number; primary: string; secondary: string; /** Beam colour (0 when off). */ beam: number }
export const BEACON_POWERS: string[][] = [['speed', 'haste'], ['resistance', 'jump_boost'], ['strength'], ['regeneration']];
export const BEACON_PAYMENT = () => [I.IRON_INGOT, I.GOLD_INGOT, I.EMERALD, I.DIAMOND, I7.NETHERITE_INGOT];

/** How many full pyramid layers are under a beacon (0-4). */
export function pyramidLevels(w: World, x: number, y: number, z: number): number {
  let n = 0;
  for (let k = 1; k <= 4; k++) {
    for (let dx = -k; dx <= k; dx++) for (let dz = -k; dz <= k; dz++) if (!blockIs('beacon_base_blocks', w.getId(x + dx, y - k, z + dz))) return n;
    n = k;
  }
  return n;
}
/** The beam's colour through any stained glass above (averaged pane by pane, like vanilla), or 0 if something blocks the sky. */
export function beamColor(w: World, x: number, y: number, z: number): number {
  let col = 0xffffff, tinted = false;
  for (let yy = y + 1; yy < 256; yy++) {
    const id = w.getId(x, yy, z);
    if (id === B.AIR) continue;
    const gi = STAINED_GLASS.indexOf(id), pi = STAINED_PANES.indexOf(id);
    const k = gi >= 0 ? gi : pi;
    if (k >= 0) {
      const c = DYE_RGB[k];
      col = tinted ? (((((col >> 16) & 255) + ((c >> 16) & 255)) >> 1) << 16) | (((((col >> 8) & 255) + ((c >> 8) & 255)) >> 1) << 8) | (((col & 255) + (c & 255)) >> 1) : c;
      tinted = true;
      continue;
    }
    if (id === B.GLASS || id === B.GLASS_PANE || id === B2.BEACON) continue;
    if (OPAQUE[id] || (BLOCKS[id].solid && id !== B.BEDROCK)) return 0;
  }
  return col || 0xfffffe;
}

/** Every 80 ticks (vanilla): recount the pyramid, recolour the beam, and hand out the powers. */
export function tickBeacon(g: Game, x: number, y: number, z: number, t: BeaconTile) {
  if ((g.ticks + x * 7 + z * 13) % 80 !== 0 && t.levels >= 0) return;
  const w = g.world!;
  const levels = pyramidLevels(w, x, y, z);
  const beam = levels ? beamColor(w, x, y, z) : 0;
  if (levels !== t.levels || beam !== t.beam) {
    const at = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    if (!t.beam && beam) g.audio.play('beacon.activate', at, 1, 1);
    if (t.beam && !beam) g.audio.play('beacon.deactivate', at, 1, 1);
    t.levels = levels; t.beam = beam;
    w.setTile(x, y, z, t as never);
  }
  if (!levels || !beam || !t.primary) return;
  const range = 10 + levels * 10, dur = (9 + levels * 2) * 20;
  const amp1 = levels >= 4 && t.primary === t.secondary ? 1 : 0;
  for (const p of g.playerEntities()) {
    if (p.dead || Math.abs(p.x - x) > range || Math.abs(p.z - z) > range || p.y < y - range) continue;
    p.addEffect(t.primary, dur, amp1);
    if (levels >= 4 && t.secondary && t.secondary !== t.primary) p.addEffect(t.secondary, dur, 0);
  }
}

// ------------------------------------------------------------------ conduits
export interface ConduitTile { type: 'conduit'; frame: number; active: boolean; target: number }
const FRAME = () => [STONE2.PRISMARINE, STONE2.PRISMARINE_BRICKS, STONE2.DARK_PRISMARINE, STONE2.SEA_LANTERN];
/**
 * Count the prismarine frame: the blocks two away in the three planes through the conduit (vanilla's 42 spots:
 * the 5x5 square rings of the xy, xz and yz planes).
 */
export function conduitFrame(w: World, x: number, y: number, z: number): number {
  const frame = FRAME();
  let n = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== 2 || (dx !== 0 && dy !== 0 && dz !== 0)) continue;
    if (frame.includes(w.getId(x + dx, y + dy, z + dz))) n++;
  }
  return n;
}
/** The 3x3x3 around the conduit must be water (except the conduit itself). */
function wet(w: World, x: number, y: number, z: number) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dy && !dz) continue;
    if (w.getId(x + dx, y + dy, z + dz) !== B.WATER) return false;
  }
  return true;
}
export function tickConduit(g: Game, x: number, y: number, z: number, t: ConduitTile) {
  if (g.ticks % 40 !== 0) return;
  const w = g.world!;
  const frame = wet(w, x, y, z) ? conduitFrame(w, x, y, z) : 0;
  const active = frame >= 16;
  if (active !== t.active || frame !== t.frame) {
    if (active && !t.active) g.audio.play('conduit.activate', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, 1);
    t.active = active; t.frame = frame;
    w.setTile(x, y, z, t as never);
  }
  if (!active) return;
  const range = Math.floor(frame / 7) * 16;
  for (const p of g.playerEntities()) {
    if (p.dead || Math.hypot(p.x - x - 0.5, p.y - y - 0.5, p.z - z - 0.5) > range) continue;
    if (p.inWater || (g.weather?.rainAt(p.x, p.y + 1, p.z) ?? false)) p.addEffect('conduit_power', 260, 0);
  }
  // a full frame (42 blocks) attacks the nearest monster in the water within 8 blocks
  if (frame >= 42) {
    const m = g.entities.find((e) => (e as unknown as { hostile?: boolean }).hostile && !(e as LivingEntity).dead && e.inWater && Math.hypot(e.x - x - 0.5, e.y - y - 0.5, e.z - z - 0.5) < 8) as LivingEntity | undefined;
    t.target = m?.id ?? 0;
    if (m) { m.damage(4, 'magic', null); g.audio.play('conduit.attack', m, 1, 1); }
  }
}
