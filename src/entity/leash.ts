// Name tags and leads (1.6). A named mob keeps its name (shown over it) and never despawns. A lead ties an animal
// (or a golem) to a player, who can tie it to a fence post with a knot; pulled too far, the lead snaps.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Player } from '../game/player';
import type { Mob } from './mobs';
import { BLOCKS, isFence } from '../world/blocks';
import { I3, I7, ItemStack, stack } from '../game/items';

/** The knot of a lead tied to a fence post. */
export class LeashKnot extends Entity {
  typeName = 'Leash Knot';
  persist = true;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 0.375; this.height = 0.5;
  }
  override tick() {
    // gone with its fence, or with nothing tied to it any more
    const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
    if (!isFence(this.world.getId(x, y, z)) || (this.age > 20 && !this.game.entities.some((e) => (e as Mob).leashHolder === this))) this.loosen();
  }
  /** Hit by a player: everything tied here comes loose (the leads drop). */
  attacked(_creative: boolean) { this.loosen(); }
  loosen() {
    for (const e of this.game.entities) if ((e as Mob).leashHolder === this) unleash(e as Mob, true);
    this.removed = true;
  }
  toJSON() { return { type: 'leash_knot', x: this.x, y: this.y, z: this.z }; }
  load(d: { x: number; y: number; z: number }) { this.setPos(d.x, d.y, d.z); }
}

/** Mobs that a lead holds (vanilla: animals, golems, not monsters or villagers). */
export const leashable = (m: Mob) => !m.hostile && m.typeName !== 'Villager' && m.typeName !== 'Wandering Trader' && m.typeName !== 'Bat' && !(m as unknown as { rider?: unknown }).rider;

/** Right-click on a mob with a name tag or a lead (or on a leashed mob to untie it). Returns true if it acted. */
export function useOnMob(g: Game, p: Player, m: Mob, held: ItemStack | null, consume: (n: number) => void): boolean {
  if (held && held.id === I3.NAME_TAG && held.name && m.typeName !== 'Ender Dragon' && m.typeName !== 'Wither') {
    m.customName = held.name;
    consume(1);
    return true;
  }
  if (m.leashHolder === p) { unleash(m, true); return true; }
  if (held?.id === I7.LEAD && leashable(m) && !m.leashHolder) {
    m.leashHolder = p;
    consume(1);
    g.audio.play('lead.tie', m, 1, 1);
    return true;
  }
  return false;
}
/** A player right-clicks a fence: the mobs they lead within 7 blocks get tied to a knot on it. Returns true if any were. */
export function tieToFence(g: Game, p: Player, x: number, y: number, z: number): boolean {
  if (!isFence(g.world!.getId(x, y, z))) return false;
  const led = g.entities.filter((e) => (e as Mob).leashHolder === p && e.distanceTo(p) < 7) as Mob[];
  if (!led.length) return false;
  let knot = g.entities.find((e) => e instanceof LeashKnot && !e.removed && Math.floor(e.x) === x && Math.floor(e.y) === y && Math.floor(e.z) === z) as LeashKnot | undefined;
  if (!knot) {
    knot = new LeashKnot(g.world!, g);
    knot.setPos(x + 0.5, y + 0.25, z + 0.5);
    g.addEntity(knot);
  }
  for (const m of led) m.leashHolder = knot;
  g.audio.play('lead.tie', knot, 1, 1);
  return true;
}
/** Let a mob go (the lead drops where it stands, unless it's already gone). */
export function unleash(m: Mob, drop: boolean) {
  if (!m.leashHolder) return;
  m.leashHolder = null;
  if (drop) m.game.dropItem(m.x, m.y + 0.5, m.z, stack(I7.LEAD));
  m.game.audio.play('lead.untie', m, 1, 1);
}
/** Each tick of a leashed mob: pulled toward its holder past 6 blocks, snapping free past 10. */
export function leashTick(m: Mob) {
  const h = m.leashHolder as Entity | null;
  if (!h) return;
  if (h.removed || (h as unknown as { dead?: boolean }).dead || h.world !== m.world) { unleash(m, true); return; }
  const d = m.distanceTo(h);
  if (d > 10) { unleash(m, true); return; }
  if (d > 6) {
    const k = (d - 6) * 0.04;
    m.vx += ((h.x - m.x) / d) * k; m.vz += ((h.z - m.z) / d) * k;
    if (h.y > m.y + 1) m.vy += 0.04;
    m.path = null;
  } else if (d > 3 && !m.path && Math.random() < 0.05) m.setPathTo(h.x, h.y, h.z, 0.06);
  m.fallDistance = 0;
}
void BLOCKS;
