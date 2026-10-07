// Raids and patrols (1.14). Killing a patrol's captain gives Bad Omen; walking into a village with it starts a raid:
// waves of pillagers, vindicators, witches, evokers and ravagers (vanilla's wave table; 3, 5 or 7 waves by
// difficulty, one more with a strong omen) march on the village's meeting point. Win and everyone who fought is
// a Hero of the Village (cheaper trades); lose every villager and the raid is lost. Patrols of pillagers roam the
// land from day five.
import type { Game } from './game';
import type { Player } from './player';
import { B, B2 } from '../world/blocks';
import { LivingEntity } from '../entity/living';
import type { Mob } from '../entity/mobs';

/** Raiders per wave (index = wave, 1-based; vanilla Raid.RaiderType). */
const WAVES: [string, number[]][] = [
  ['vindicator', [0, 0, 2, 0, 1, 4, 2, 5]],
  ['evoker', [0, 0, 0, 0, 0, 1, 1, 2]],
  ['pillager', [0, 4, 3, 3, 4, 4, 4, 2]],
  ['witch', [0, 0, 0, 0, 3, 0, 0, 1]],
  ['ravager', [0, 0, 0, 1, 0, 1, 0, 2]],
];

export interface Raid {
  id: number;
  x: number; y: number; z: number;
  omen: number;
  waves: number;
  wave: number;
  /** Ticks until the next wave arrives (between waves), or the raid's overall clock. */
  cooldown: number;
  age: number;
  heroes: string[];
  state: 'ongoing' | 'victory' | 'defeat';
  /** Max health of the wave's raiders (for the progress bar). */
  total: number;
}
let nextId = 1;
const raidsOf = (g: Game): Raid[] => ((g as unknown as { raids?: Raid[] }).raids ??= []);
export const activeRaids = (g: Game) => raidsOf(g).filter((r) => r.state === 'ongoing');

/** The village around a point: its bell (meeting point), or the middle of 3+ villagers. */
function villageAt(g: Game, x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  const w = g.world!;
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  for (let dx = -32; dx <= 32; dx += 1) for (let dz = -32; dz <= 32; dz += 1) {
    if (Math.abs(dx) + Math.abs(dz) > 48) continue;
    for (let dy = -8; dy <= 8; dy++) if (w.getId(x0 + dx, y0 + dy, z0 + dz) === B2.BELL) return { x: x0 + dx, y: y0 + dy, z: z0 + dz };
  }
  const vs = g.entities.filter((e) => (e as unknown as { typeName?: string }).typeName === 'Villager' && !(e as LivingEntity).dead && e.distanceTo({ x, y, z } as never) < 32);
  if (vs.length < 3) return null;
  return { x: vs.reduce((a, e) => a + e.x, 0) / vs.length, y: vs[0].y, z: vs.reduce((a, e) => a + e.z, 0) / vs.length };
}

/** Each tick in the overworld: start raids (Bad Omen in a village), run them, and send patrols out. */
export function tickRaids(g: Game, rng: { next(): number; int(n: number): number }) {
  if (g.options.difficulty === 0) return;
  if (g.ticks % 20 === 0) for (const p of g.playerEntities()) {
    if (p.dead || p.spectator || !p.effects.has('bad_omen')) continue;
    if (activeRaids(g).some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 96)) continue;
    const v = villageAt(g, p.x, p.y, p.z);
    if (!v) continue;
    const omen = p.effectAmp('bad_omen') + 1;
    p.removeEffect('bad_omen');
    const waves = [3, 3, 5, 7][g.options.difficulty] + (omen > 1 ? 1 : 0);
    raidsOf(g).push({ id: nextId++, ...v, omen, waves, wave: 0, cooldown: 300, age: 0, heroes: [p.name ?? ''], state: 'ongoing', total: 0 });
    g.audio.play('raid.horn', null, 1, 1);
  }
  for (const r of activeRaids(g)) tickRaid(g, r, rng);
  // patrols: every 10-20 minutes, after the fifth day, maybe near a player who isn't in a village
  const pt = (g as unknown as { patrolTimer?: number });
  pt.patrolTimer ??= 12000 + rng.int(1200);
  if (--pt.patrolTimer <= 0) {
    pt.patrolTimer = 12000 + rng.int(12000);
    if (g.time > 24000 * 5 && rng.int(5) === 0) spawnPatrol(g, rng);
  }
}

function raiders(g: Game, r: Raid): Mob[] {
  return g.entities.filter((e) => (e as unknown as { raid?: number }).raid === r.id && !(e as LivingEntity).dead && !e.removed) as Mob[];
}
function tickRaid(g: Game, r: Raid, rng: { next(): number; int(n: number): number }) {
  r.age++;
  const alive = raiders(g, r);
  // everyone near the fight is counted for the reward
  if (r.age % 20 === 0) for (const p of g.playerEntities()) if (Math.hypot(p.x - r.x, p.z - r.z) < 64 && !r.heroes.includes(p.name ?? '')) r.heroes.push(p.name ?? '');
  // lost: no villagers left around the meeting point
  if (r.age % 40 === 0) {
    const villagers = g.entities.filter((e) => (e as unknown as { typeName?: string }).typeName === 'Villager' && !(e as LivingEntity).dead && Math.hypot(e.x - r.x, e.z - r.z) < 64);
    if (!villagers.length) { end(g, r, 'defeat'); return; }
  }
  if (r.age > 48000) { end(g, r, 'defeat'); return; }
  if (alive.length) {
    // raiders with nothing to fight march on the meeting point
    if (r.age % 40 === 0) for (const m of alive) if (!m.target && !m.path && Math.hypot(m.x - r.x, m.z - r.z) > 6) m.setPathTo(r.x, r.y, r.z, 0.07);
    return;
  }
  if (r.wave >= r.waves) { end(g, r, 'victory'); return; }
  if (--r.cooldown > 0) return;
  r.wave++;
  r.cooldown = 300;
  spawnWave(g, r, rng);
}

function spawnWave(g: Game, r: Raid, rng: { next(): number; int(n: number): number }) {
  const w = g.world!;
  const a = rng.next() * Math.PI * 2, d = 28 + rng.int(8);
  let x = Math.floor(r.x + Math.cos(a) * d), z = Math.floor(r.z + Math.sin(a) * d);
  if (!w.chunkAt(x, z)) { x = Math.floor(r.x) + 8; z = Math.floor(r.z) + 8; }
  const y = w.topSolidY(x, z) + 1;
  const waveIdx = Math.min(7, r.wave);
  let total = 0, first = true;
  for (const [kind, per] of WAVES) {
    let n = per[waveIdx] ?? 0;
    // the extra wave (strong omen) and harder difficulties bring a few more
    if (r.wave > [3, 3, 5, 7][g.options.difficulty]) n += kind === 'pillager' || kind === 'vindicator' ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const m = g.interact!.spawnMob(kind, x + 0.5 + rng.int(5) - 2, y, z + 0.5 + rng.int(5) - 2) as (Mob & { raid?: number; wave?: number; captain?: boolean; persistentHostile: boolean }) | null;
      if (!m) continue;
      m.raid = r.id; m.wave = r.wave; m.persistentHostile = true;
      if (first && kind === 'pillager' || first && kind === 'vindicator') { m.captain = true; first = false; }
      total += m.maxHealth;
      m.setPathTo(r.x, r.y, r.z, 0.07);
    }
  }
  r.total = total;
  g.audio.play('raid.horn', { x, y, z }, 4, 1);
}

function end(g: Game, r: Raid, state: 'victory' | 'defeat') {
  r.state = state;
  if (state === 'victory') {
    for (const p of g.playerEntities()) {
      if (!r.heroes.includes(p.name ?? '') || Math.hypot(p.x - r.x, p.z - r.z) > 96) continue;
      p.addEffect('hero_of_the_village', 48000, Math.min(4, r.omen - 1));
    }
    g.audio.play('raid.victory', null, 1, 1);
  }
  // the raid's stragglers stay as they are; the record goes
  const list = raidsOf(g);
  list.splice(list.indexOf(r), 1);
}

/** A patrol: two to five pillagers, one of them a captain carrying the ominous banner, near a player. */
export function spawnPatrol(g: Game, rng: { next(): number; int(n: number): number }, at?: Player) {
  const ps = g.playerEntities().filter((p) => !p.dead && !p.spectator);
  const p = at ?? ps[rng.int(ps.length)];
  if (!p) return [];
  if (villageAt(g, p.x, p.y, p.z)) return [];
  const w = g.world!;
  const a = rng.next() * Math.PI * 2, d = 24 + rng.int(24);
  const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
  if (!w.chunkAt(x, z)) return [];
  const y = w.topSolidY(x, z) + 1;
  if (y < 2 || w.getId(x, y - 1, z) === B.WATER) return [];
  const n = 2 + rng.int(4);
  const out: Mob[] = [];
  for (let i = 0; i < n; i++) {
    const m = g.interact!.spawnMob('pillager', x + 0.5 + rng.int(5) - 2, y, z + 0.5 + rng.int(5) - 2) as (Mob & { patrol: boolean; captain: boolean }) | null;
    if (!m) continue;
    m.patrol = true;
    if (i === 0) m.captain = true;
    out.push(m);
  }
  return out;
}

/** Hero of the Village: cheaper trades (30% off, plus 6.25% a level, at least one emerald). */
export function heroDiscount(p: Player | null, price: number): number {
  const amp = p ? p.effectAmp('hero_of_the_village') : -1;
  if (amp < 0) return price;
  return Math.max(1, price - Math.floor(price * (0.3 + 0.0625 * amp)));
}
