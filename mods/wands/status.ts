// Conditions on creatures (Noita's stains and curses): wet, oily, bloody, drunk, slimy, toxic, cursed, and the odd
// ones spells leave behind (a creature that throws fireballs at its friends...). The server keeps them; every few
// ticks they act, and clients are told to show drips in the condition's colour.
import type { Entity } from '../sdk';
import type { Status } from './spells';

/** What clients show for each condition (drips of colour); conditions without one aren't shown. */
export const STATUS_COLOR: Partial<Record<Status, number>> = {
  wet: 0x4080ff, oiled: 0x403020, bloody: 0xb01010, drunk: 0xe0d080, slimy: 0x60c040, toxic: 0x90ff40, cursed: 0x8030c0,
  venom: 0x60a020, petrified: 0x909090, charmed: 0xff80c0, fervour: 0xff4020,
  curseElec: 0xc040ff, curseExpl: 0xc040ff, curseMelee: 0xc040ff, curseProj: 0xc040ff,
  fireThrower: 0xff7020, lightningCaster: 0xc0d0ff, tentacler: 0x50e090, gravityWell: 0x8040ff,
};

export class Statuses {
  private map = new WeakMap<Entity, Map<Status, number>>();
  /** Creatures with any condition (weakly: they can be dropped once their conditions run out). */
  private live = new Set<Entity>();

  set(e: Entity, s: Status, ticks: number, now: number) {
    let m = this.map.get(e);
    if (!m) this.map.set(e, (m = new Map()));
    m.set(s, Math.max(m.get(s) ?? 0, now + ticks));
    this.live.add(e);
  }
  has(e: Entity, s: Status, now: number) {
    const t = this.map.get(e)?.get(s);
    return t !== undefined && t > now;
  }
  clear(e: Entity, s: Status) { this.map.get(e)?.delete(s); }
  /** Each creature with conditions, and the conditions still running. */
  *each(now: number): Generator<[Entity, Status[]]> {
    for (const e of this.live) {
      const m = this.map.get(e);
      if (!m || e.removed || (e as unknown as { dead?: boolean }).dead) { this.live.delete(e); continue; }
      const on: Status[] = [];
      for (const [s, t] of m) { if (t > now) on.push(s); else m.delete(s); }
      if (!on.length) { this.live.delete(e); continue; }
      yield [e, on];
    }
  }
  reset() { this.live.clear(); this.map = new WeakMap(); }
}
