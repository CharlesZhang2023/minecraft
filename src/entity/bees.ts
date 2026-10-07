// Bees and their homes (1.15): bees leave their nest or hive by day, gather nectar from flowers, pollinate crops on
// the way back, and fill the hive with honey (5 levels). Shears take honeycomb and a bottle takes honey; without a
// campfire smoking below, the bees go for whoever did it. A bee that stings loses its stinger and dies soon after.
import { GoalMob, Goal, swim, aiRng } from './ai';
import { Mob } from './mobs';
import { Entity } from './entity';
import { LivingEntity } from './living';
import type { World, TileEntity } from '../world/world';
import type { Game } from '../game/game';
import { Player } from '../game/player';
import { B, B2, BLOCKS, idOf, metaOf, pack } from '../world/blocks';
import { I, I7, ItemStack, stack, itemId } from '../game/items';
import { blockIs } from '../game/tags';

const rng = aiRng;
/** What a hive keeps of a bee inside it. */
export interface HiveBee { nectar: boolean; ticksIn: number; minTicks: number; health: number; anger?: number }
export interface HiveTile { type: 'beehive'; bees: HiveBee[]; honey: number }

const isHive = (id: number) => id === B2.BEE_NEST || id === B2.BEEHIVE;
const isFlower = (id: number) => blockIs('flowers', id);
let flowers: number[] | null = null;
const FLOWERS = () => (flowers ??= BLOCKS.filter((b) => b && isFlower(b.id)).map((b) => b.id));
const isCrop = (id: number) => id === B.WHEAT || id === B.CARROTS || id === B.POTATOES || id === B2.BEETROOTS || id === B2.SWEET_BERRY_BUSH || id === B.PUMPKIN_STEM || id === B2.MELON_STEM;
const cropMax = (id: number) => (id === B2.BEETROOTS || id === B2.SWEET_BERRY_BUSH ? 3 : 7);

export class Bee extends GoalMob {
  kind = 'bee';
  typeName = 'Bee';
  override model = 'bee';
  override skin = 'bee';
  override hostile = false;
  override speedAttr = 0.3;
  override sayName = 'bee.loop';
  override hurtName = 'bee.hurt';
  override deathName = 'bee.death';
  override xp = 1;
  hive: { x: number; y: number; z: number } | null = null;
  nectar = false;
  /** Angry for this many ticks (red eyes, chasing its target). */
  angry = 0;
  /** It stung someone and will die soon. */
  stung = false;
  private stungTicks = 0;
  /** Ticks since it left the hive (it must go home eventually), and crops pollinated this trip. */
  outTicks = 0;
  crops = 0;
  dest: { x: number; y: number; z: number } | null = null;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.7; this.height = 0.6;
    this.maxHealth = this.health = 10;
    this.attackDamage = 2;
    this.food = FLOWERS();
    this.goals.push(swim(0), stingGoal(1), goHome(2), gatherNectar(3), wanderAir(6));
  }
  override gravity() { return 0; }
  override isFlying() { return true; }
  override eyeHeight() { return 0.3; }
  override tick() {
    super.tick();
    if (this.dead || this.noAi) return;
    this.outTicks++;
    if (this.angry > 0 && --this.angry === 0) this.target = null;
    if (this.stung && ++this.stungTicks > 600 && rng.int(50) === 0) this.damage(this.health, 'generic');
    // pollinating crops on the way home
    if (this.nectar && this.crops < 10 && rng.int(30) === 0) {
      const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
      for (let dy = 1; dy <= 2; dy++) {
        const v = this.world.get(x, y - dy, z), id = idOf(v);
        if (isCrop(id) && metaOf(v) < cropMax(id)) { this.world.set(x, y - dy, z, pack(id, metaOf(v) + 1)); this.crops++; this.game.particles?.spell(x + 0.5, y - dy + 0.8, z + 0.5, 0xf8e070); break; }
      }
    }
    if (this.nectar && this.age % 10 === 0) this.game.particles?.drip(this.x, this.y, this.z, false, 0xf0c030);
  }
  override travel() {
    if (this.noAi) return;
    const d = this.target && this.angry > 0 ? { x: this.target.x, y: this.target.y + this.target.height * 0.6, z: this.target.z } : this.dest;
    if (d) {
      const dx = d.x - this.x, dy = d.y - this.y, dz = d.z - this.z, l = Math.hypot(dx, dy, dz) || 1;
      const sp = this.angry > 0 ? 0.035 : 0.02;
      this.vx += (dx / l) * sp; this.vy += (dy / l) * sp; this.vz += (dz / l) * sp;
      if (l > 0.3) this.yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    }
    this.vy += Math.sin(this.age * 0.2) * 0.004;
    this.move(this.vx, this.vy, this.vz);
    if (this.collidedH && d) this.vy += 0.05;
    this.vx *= 0.85; this.vy *= 0.85; this.vz *= 0.85;
  }
  override onDamaged(attacker: Entity | null) {
    const who = (attacker as unknown as { shooter?: Entity })?.shooter ?? attacker;
    if (who instanceof LivingEntity && !(who instanceof Player && (who.creative || who.spectator))) {
      // the whole neighbourhood joins in
      for (const e of this.game.entities) if (e instanceof Bee && !e.stung && e.distanceTo(this) < 16) e.anger(who);
    }
  }
  anger(who: LivingEntity) { if (this.stung) return; this.target = who; this.angry = 400 + rng.int(400); }
  override canBreed() { return !this.baby && this.breedCooldown === 0; }
  override drops(): ItemStack[] { return []; }
  override despawnCheck() {}
  override extraJSON() { return { hive: this.hive, nectar: this.nectar, stung: this.stung, angry: this.angry }; }
  override loadExtra(d: Record<string, unknown>) { this.hive = (d.hive as Bee['hive']) ?? null; this.nectar = !!d.nectar; this.stung = !!d.stung; this.angry = (d.angry as number) ?? 0; }
}

/** Sting the target once (poison on normal and hard), then lose the stinger. */
const stingGoal = (priority: number): Goal => ({
  priority, controls: ['move', 'look'],
  canStart: (m) => (m as Bee).angry > 0 && !!m.target && !m.target.dead && !(m as Bee).stung,
  tick: (m) => {
    const b = m as Bee, t = m.target!;
    m.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
    const dx = t.x - m.x, dz = t.z - m.z, dy = t.y + t.height * 0.5 - m.y;
    if (dx * dx + dz * dz < 1 && Math.abs(dy) < 1.2 && m.attackCooldown <= 0) {
      m.attackCooldown = 20;
      if (t.damage(2, 'sting', m)) {
        const d = m.game.options.difficulty;
        if (d >= 2) t.addEffect('poison', d === 2 ? 200 : 360, 0);
        b.stung = true; b.angry = 0; b.target = null;
        m.game.audio.play('bee.sting', m, 1, 1);
      }
    }
  },
});
/** Head home when carrying nectar, after a long trip, at night or in the rain; go in and stay a while. */
const goHome = (priority: number): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => {
    const b = m as Bee;
    if (!b.hive || b.angry > 0) return false;
    if (!isHive(m.world.getId(b.hive.x, b.hive.y, b.hive.z))) { b.hive = null; return false; }
    return b.nectar || b.outTicks > 2400 || !m.game.isDaytime() || (m.game.weather?.rain ?? 0) > 0.2;
  },
  tick: (m) => {
    const b = m as Bee, h = b.hive!;
    b.dest = { x: h.x + 0.5, y: h.y + 0.5, z: h.z + 0.5 };
    if (Math.hypot(m.x - h.x - 0.5, m.y - h.y - 0.5, m.z - h.z - 0.5) < 1.6) enterHive(b, h.x, h.y, h.z);
  },
  stop: (m) => { (m as Bee).dest = null; },
});
/** Find a flower, hover at it for a while, and come away with nectar. */
const gatherNectar = (priority: number): Goal => {
  let at: { x: number; y: number; z: number } | null = null;
  let hover = 0;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      const b = m as Bee;
      if (b.nectar || b.angry > 0 || !m.game.isDaytime() || rng.int(20)) return false;
      at = null;
      for (let k = 0; k < 40 && !at; k++) {
        const x = Math.floor(m.x) + rng.int(23) - 11, y = Math.floor(m.y) + rng.int(9) - 4, z = Math.floor(m.z) + rng.int(23) - 11;
        if (isFlower(m.world.getId(x, y, z))) at = { x, y, z };
      }
      hover = 0;
      return !!at;
    },
    canContinue: (m) => !!at && !(m as Bee).nectar && isFlower(m.world.getId(at.x, at.y, at.z)),
    tick: (m) => {
      const b = m as Bee;
      b.dest = { x: at!.x + 0.5, y: at!.y + 0.7, z: at!.z + 0.5 };
      if (Math.hypot(m.x - b.dest.x, m.y - b.dest.y, m.z - b.dest.z) < 0.6 && ++hover > 100) { b.nectar = true; b.crops = 0; }
    },
    stop: (m) => { at = null; (m as Bee).dest = null; },
  };
};
/** Drift about near home. */
const wanderAir = (priority: number): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => rng.int(40) === 0,
  canContinue: (m) => { const d = (m as Bee).dest; return !!d && Math.hypot(m.x - d.x, m.y - d.y, m.z - d.z) > 1 && rng.int(100) !== 0; },
  start: (m) => {
    const b = m as Bee, h = b.hive ?? { x: m.x, y: m.y, z: m.z };
    b.dest = { x: h.x + rng.int(17) - 8, y: Math.max(h.y, m.world.topSolidY(Math.floor(m.x), Math.floor(m.z)) + 1) + rng.int(4), z: h.z + rng.int(17) - 8 };
  },
  stop: (m) => { (m as Bee).dest = null; },
});

/** A bee goes into its hive (if there's room: 3 bees). */
function enterHive(b: Bee, x: number, y: number, z: number) {
  const w = b.world;
  const t = hiveTile(w, x, y, z);
  if (t.bees.length >= 3) { b.hive = null; return; }
  t.bees.push({ nectar: b.nectar, ticksIn: 0, minTicks: b.nectar ? 2400 : 600, health: b.health });
  w.setTile(x, y, z, t as unknown as TileEntity);
  b.removed = true;
  b.game.audio.play('bee.enter', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, 1);
}
function hiveTile(w: World, x: number, y: number, z: number): HiveTile {
  const t = w.getTile(x, y, z) as unknown as HiveTile | undefined;
  if (t && t.type === 'beehive') return t;
  const n: HiveTile = { type: 'beehive', bees: [], honey: 0 };
  w.setTile(x, y, z, n as unknown as TileEntity);
  return n;
}
/** Honey level shows on the block (meta bit 8 = full) for the front texture. */
function setHoney(w: World, x: number, y: number, z: number, t: HiveTile) {
  const v = w.get(x, y, z);
  const want = (metaOf(v) & 7) | (t.honey >= 5 ? 8 : 0);
  if (want !== metaOf(v)) w.set(x, y, z, pack(idOf(v), want));
}
/** Release the bees of a hive (angry at `at`, if given). */
export function releaseBees(g: Game, x: number, y: number, z: number, t: HiveTile, at: LivingEntity | null, all = true) {
  const keep: HiveBee[] = [];
  for (const hb of t.bees) {
    if (!all && hb.ticksIn < hb.minTicks) { keep.push(hb); continue; }
    const out = exitPoint(g.world!, x, y, z);
    const b = g.interact!.spawnMob('bee', out.x, out.y, out.z) as Bee | null;
    if (!b) { keep.push(hb); continue; }
    b.hive = { x, y, z };
    b.health = hb.health;
    if (hb.nectar && t.honey < 5) t.honey++;
    if (at) b.anger(at);
  }
  t.bees = keep;
}
function exitPoint(w: World, x: number, y: number, z: number) {
  const f = metaOf(w.get(x, y, z)) & 3;
  const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f] ?? [0, 1];
  return { x: x + 0.5 + dx * 0.9, y: y + 0.2, z: z + 0.5 + dz * 0.9 };
}
/** Hives tick with the stations: bees inside wait their time, then come out (by day, when it's dry). */
export function tickHive(g: Game, x: number, y: number, z: number, t: HiveTile) {
  if (!t.bees.length) return;
  for (const hb of t.bees) hb.ticksIn += 1;
  const out = g.isDaytime() && (g.weather?.rain ?? 0) < 0.2;
  if (out && t.bees.some((hb) => hb.ticksIn >= hb.minTicks)) {
    const before = t.honey;
    releaseBees(g, x, y, z, t, null, false);
    if (t.honey !== before) setHoney(g.world!, x, y, z, t);
    g.world!.setTile(x, y, z, t as unknown as TileEntity);
  }
}
/** Is a campfire smoking under the hive (within 5 blocks)? */
function smoked(w: World, x: number, y: number, z: number) {
  for (let dy = 1; dy <= 5; dy++) { const id = w.getId(x, y - dy, z); if (id === B2.CAMPFIRE || id === B2.SOUL_CAMPFIRE) return (metaOf(w.get(x, y - dy, z)) & 4) === 0; if (BLOCKS[id].solid) return false; }
  return false;
}
/** Shears (honeycomb) or a glass bottle (honey) on a full hive. Returns true if it was handled. */
export function harvestHive(g: Game, p: Player, x: number, y: number, z: number, held: ItemStack | null, consume: (n: number) => void, give: (s: ItemStack) => void): boolean {
  const w = g.world!;
  if (!isHive(w.getId(x, y, z)) || !held) return false;
  const t = hiveTile(w, x, y, z);
  if (t.honey < 5) return false;
  if (held.id === I.SHEARS) { g.dropItem(x + 0.5, y + 1, z + 0.5, stack(I7.HONEYCOMB, 3)); g.audio.play('shears', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, 1); }
  else if (held.id === itemId('glass_bottle')) { consume(1); give(stack(I7.HONEY_BOTTLE)); g.audio.play('bottle.fill', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, 1); }
  else return false;
  t.honey = 0;
  setHoney(w, x, y, z, t);
  if (!smoked(w, x, y, z)) {
    releaseBees(g, x, y, z, t, p);
    for (const e of g.entities) if (e instanceof Bee && e.hive && e.hive.x === x && e.hive.y === y && e.hive.z === z) e.anger(p);
  }
  w.setTile(x, y, z, t as unknown as TileEntity);
  return true;
}
/** A hive or nest broken: its bees come out angry at whoever broke it. */
export function hiveBroken(g: Game, x: number, y: number, z: number, by: Player | null) {
  const t = g.world!.getTile(x, y, z) as unknown as HiveTile | undefined;
  if (t?.type === 'beehive' && t.bees.length) releaseBees(g, x, y, z, t, by);
  if (by) for (const e of g.entities) if (e instanceof Bee && e.hive && e.hive.x === x && e.hive.y === y && e.hive.z === z) e.anger(by);
}
/** A nest generated with the world: three bees inside, ready to come out. */
export function nestTile(): HiveTile { return { type: 'beehive', bees: [0, 1, 2].map(() => ({ nectar: false, ticksIn: 600, minTicks: 600, health: 10 })), honey: 0 }; }
void Mob;
