// The animals of 1.4-1.16: mooshrooms, rabbits, foxes, cats and ocelots, parrots, polar bears, pandas, llamas (and
// the wandering trader's), turtles (and their eggs), dolphins, the four fish (and their buckets), and the wandering
// trader. Shared pieces: a tameable base (owner, sitting, following), and goals for following owners and swimming.
import { GoalMob, Goal, swim, wander, lookAtPlayer, panic, avoidEntity, tempt, breed, followParent, meleeAttack, nearestTarget, aiRng } from './ai';
import { Mob, Cow, Villager, Wolf, Chicken, Trade } from './mobs';
import { Horse } from './horse';
import { Entity } from './entity';
import { LivingEntity, DamageSource } from './living';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { Player } from '../game/player';
import { ItemEntity } from './item';
import { B, B2, BLOCKS, OPAQUE, WOOD, idOf, metaOf, pack, isLeaves } from '../world/blocks';
import { BIOME } from '../world/biomes';
import { I, I2, I3, I7, ItemStack, stack, itemId, getItem, TOOLS, DYES } from '../game/items';
import { Random } from '../noise';
import { WorldGen } from '../world/worldgen';
import { OVERWORLD_STRUCTURES } from '../world/structures/overworld';
import { nearestStart } from '../world/structure';

const rng = aiRng;
const tn = (e: Entity | null | undefined) => (e as unknown as { typeName?: string } | null)?.typeName ?? '';
const dist2 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
const hearts = (m: Mob) => { for (let i = 0; i < 7; i++) m.game.particles?.heart(m.x + rng.next() - 0.5, m.y + m.height, m.z + rng.next() - 0.5); };
const smokes = (m: Mob) => { for (let i = 0; i < 7; i++) m.game.particles?.smoke(m.x + rng.next() - 0.5, m.y + m.height, m.z + rng.next() - 0.5); };
/** Give the player (or the world) one of something in exchange for one of what they hold. */
function swapHeld(game: Game, out: ItemStack) {
  const p = game.player!;
  const held = p.inventory.held();
  if (p.creative) { p.inventory.add(out); return; }
  if (held && held.count > 1) { held.count--; if (p.inventory.add(out) > 0) game.dropItem(p.x, p.y + 1, p.z, out); }
  else p.inventory.setHeld(out);
}

// ------------------------------------------------------------------ taming
/** A mob a player can tame: it remembers its owner, sits when told, follows, and teleports to keep up. */
export abstract class Tameable extends GoalMob {
  owner = false;
  ownerName = '';
  sitting = false;
  /** The items that tame it, and the 1-in-n odds per item. */
  tameItems: number[] = [];
  tameOdds = 3;
  ownerPlayer(): Player | null {
    if (!this.owner) return null;
    const sp = this.game.players.find((q) => (this.ownerName ? q.name === this.ownerName : q.owner));
    return sp && sp.entity.world === this.world ? sp.entity : null;
  }
  tameBy(game: Game) {
    this.owner = true;
    this.ownerName = game.ctx?.name ?? '';
    this.sitting = true;
    this.path = null;
    this.target = null;
    hearts(this);
    this.onTamed();
  }
  onTamed() {}
  override interact(game: Game, held: ItemStack | null): boolean {
    if (this.owner) {
      if (held && this.food.includes(held.id) && this.health < this.maxHealth) { this.heal(getItem(held.id).food?.hunger ?? 2); game.interact!.consume(1); return true; }
      if (held && this.food.includes(held.id) && super.interact(game, held)) return true;
      if (game.player === this.ownerPlayer() || !this.ownerName) { this.sitting = !this.sitting; this.path = null; this.target = null; return true; }
      return false;
    }
    if (held && this.tameItems.includes(held.id) && !this.baby) {
      game.interact!.consume(1);
      if (rng.int(this.tameOdds) === 0) this.tameBy(game); else smokes(this);
      return true;
    }
    return super.interact(game, held);
  }
  override useLabel(p: Player, held: ItemStack | null): string | null {
    if (this.owner) return held && this.food.includes(held.id) ? 'Feed' : this.sitting ? 'Stand' : 'Sit';
    return held && this.tameItems.includes(held.id) && !this.baby ? 'Tame' : super.useLabel(p, held);
  }
  override despawnCheck() { if (!this.owner) super.despawnCheck(); }
  override extraJSON(): Record<string, unknown> { return { owner: this.owner, ownerName: this.ownerName, sitting: this.sitting }; }
  override loadExtra(d: Record<string, unknown>) { this.owner = !!d.owner; this.ownerName = (d.ownerName as string) ?? ''; this.sitting = !!d.sitting; }
}
/** Stay put while sitting. */
const sitGoal = (priority: number): Goal => ({
  priority, controls: ['move', 'jump'],
  canStart: (m) => (m as Tameable).sitting && !m.inWater,
  start: (m) => { m.path = null; },
  tick: (m) => { m.forward = 0; m.path = null; },
});
/** Follow the owner, teleporting next to them when left far behind. */
const followOwner = (priority: number, speed: number, near: number, far: number, canFly = false): Goal => ({
  priority, controls: ['move', 'look'],
  canStart: (m) => { const o = (m as Tameable).ownerPlayer(); return !!o && !(m as Tameable).sitting && !o.spectator && m.distanceTo(o) > far; },
  canContinue: (m) => { const o = (m as Tameable).ownerPlayer(); return !!o && !(m as Tameable).sitting && m.distanceTo(o) > near; },
  tick: (m) => {
    const o = (m as Tameable).ownerPlayer()!;
    m.lookTarget = { x: o.x, y: o.y + o.eyeHeight(), z: o.z };
    if (m.distanceTo(o) > 12 && (o.onGround || canFly)) {
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(o.x) + rng.int(5) - 2, z = Math.floor(o.z) + rng.int(5) - 2, y = Math.floor(o.y);
        if (Math.abs(x - o.x) < 2 && Math.abs(z - o.z) < 2) continue;
        if (OPAQUE[m.world.getId(x, y - 1, z)] && !BLOCKS[m.world.getId(x, y, z)].solid && !BLOCKS[m.world.getId(x, y + 1, z)].solid) { m.setPos(x + 0.5, y, z + 0.5); m.path = null; return; }
      }
    }
    if (--m.pathTimer <= 0 || !m.path) { m.pathTimer = 10; m.setPathTo(o.x, o.y, o.z, speed); }
  },
  stop: (m) => { m.path = null; },
});
/** Attack whatever hurt the owner, or what the owner hit (wolves' and cats' loyalty). */
const defendOwner = (priority: number): Goal => ({
  priority, controls: ['target'],
  canStart: (m) => {
    const o = (m as Tameable).ownerPlayer();
    if (!o || (m as Tameable).sitting) return false;
    const a = o.lastAttacker;
    if (a instanceof LivingEntity && !a.dead && a !== m && o.hurtTime > 0 && !(a instanceof Player && a === o)) { m.target = a; return true; }
    return false;
  },
  canContinue: (m) => !!m.target && !m.target.dead,
  stop: (m) => { m.target = null; },
});

// ------------------------------------------------------------------ mooshrooms
/** Mooshrooms: mushroom cows. Shear for mushrooms (it turns into a cow), a bowl for stew. */
export class Mooshroom extends Cow {
  override typeName = 'Mooshroom';
  override skin = 'mooshroom';
  variant: 'red' | 'brown' = 'red';
  /** The flower a brown one ate (its next stew is suspicious). */
  flower = 0;
  override tick() { super.tick(); this.skin = this.variant === 'brown' ? 'brown_mooshroom' : 'mooshroom'; }
  override babyType() { return 'mooshroom'; }
  override useLabel(p: Player, held: ItemStack | null) {
    if (held?.id === I.BOWL && !this.baby) return 'Milk';
    if (held?.id === I.SHEARS && !this.baby) return 'Shear';
    return super.useLabel(p, held);
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held?.id === I.BOWL && !this.baby) {
      const sus = this.flower && this.variant === 'brown';
      const out = stack(sus ? I7.SUSPICIOUS_STEW ?? itemId('suspicious_stew') : I.MUSHROOM_STEW);
      if (sus) { (out as ItemStack & { stewEffect?: number }).stewEffect = this.flower; this.flower = 0; }
      swapHeld(game, out);
      game.audio.play('cow.say', this, 0.6, 1.4);
      return true;
    }
    if (held?.id === I.SHEARS && !this.baby) {
      const cow = game.interact!.spawnMob('cow', this.x, this.y, this.z) as Mob | null;
      if (cow) { cow.yaw = cow.bodyYaw = cow.headYaw = this.yaw; cow.health = this.health; }
      this.removed = true;
      for (let i = 0; i < 5; i++) game.dropItem(this.x, this.y + this.height, this.z, stack(this.variant === 'brown' ? B.BROWN_MUSHROOM : B.RED_MUSHROOM));
      for (let i = 0; i < 6; i++) game.particles?.explosion(this.x, this.y + 0.5, this.z);
      game.audio.play('shears', this, 1, 1);
      return true;
    }
    // brown mooshrooms eat a small flower for a suspicious stew
    if (held && this.variant === 'brown' && !this.flower && FLOWER_EFFECTS[held.id] !== undefined) {
      this.flower = held.id;
      game.interact!.consume(1);
      for (let i = 0; i < 4; i++) game.particles?.smoke(this.x, this.y + 1, this.z);
      return true;
    }
    return super.interact(game, held);
  }
  override extraJSON() { return { variant: this.variant, flower: this.flower }; }
  override loadExtra(d: Record<string, unknown>) { this.variant = d.variant === 'brown' ? 'brown' : 'red'; this.flower = (d.flower as number) ?? 0; }
}
/** Suspicious stew: the effect each small flower gives (id, seconds). */
export const FLOWER_EFFECTS: Record<number, [string, number]> = {};
for (const [name, eff, sec] of [['dandelion', 'saturation', 0.35], ['poppy', 'night_vision', 5], ['blue_orchid', 'saturation', 0.35], ['allium', 'fire_resistance', 4], ['azure_bluet', 'blindness', 8], ['red_tulip', 'weakness', 9], ['orange_tulip', 'weakness', 9], ['white_tulip', 'weakness', 9], ['pink_tulip', 'weakness', 9], ['oxeye_daisy', 'regeneration', 8], ['cornflower', 'jump_boost', 6], ['lily_of_the_valley', 'poison', 12], ['wither_rose', 'wither', 8]] as const) {
  const id = itemId(name);
  if (id) FLOWER_EFFECTS[id] = [eff, sec];
}

// ------------------------------------------------------------------ rabbits
export const RABBIT_TYPES = ['brown', 'white', 'black', 'white_splotched', 'gold', 'salt'] as const;
/** Rabbits: hop about, flee players and wolves, raid carrot crops; their colour depends on the biome. */
export class Rabbit extends GoalMob {
  kind = 'rabbit';
  typeName = 'Rabbit';
  override model = 'rabbit';
  override skin = 'rabbit_brown';
  override speedAttr = 0.3;
  override fleesWhenHurt = true;
  variant = 0;
  /** The hop animation (ticks into the current jump). */
  hop = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.4; this.height = 0.5;
    this.maxHealth = this.health = 3;
    this.food = [I3.CARROT, I3.GOLDEN_CARROT, B.DANDELION];
    this.goals.push(swim(0), panic(1, 0.12), breed(2, 0.08), tempt(3, 0.08),
      avoidEntity(4, (_m, e) => (e instanceof Player && !e.creative && !e.spectator && !e.sneaking) || e instanceof Wolf || tn(e) === 'Fox', 6, 0.12),
      raidCrops(5), followParent(6, 0.08), wander(7, 0.06, 60), lookAtPlayer(8, 6));
  }
  override eyeHeight() { return 0.4; }
  /** Rabbits hop: no walking, every move is a jump. */
  override tick() {
    super.tick();
    this.skin = 'rabbit_' + RABBIT_TYPES[this.variant];
    if (this.forward > 0 && this.onGround && !this.noAi) { this.jumping = true; this.hop = 0; }
    else this.hop++;
  }
  override jump() { this.vy = 0.4; this.game.audio.play('rabbit.hop', this, 0.4, 1); }
  /** Pick a coat for where it was born. */
  pickVariant() {
    const b = this.game.biomeAt(Math.floor(this.x), Math.floor(this.z)).id;
    if (b === BIOME.DESERT) this.variant = 4;
    else if (this.game.biomeAt(Math.floor(this.x), Math.floor(this.z)).cold) this.variant = rng.int(5) ? 1 : 3;
    else this.variant = [0, 0, 2, 5][rng.int(4)];
  }
  override drops(burning: boolean): ItemStack[] {
    const out = [stack(I7.RABBIT_HIDE ?? itemId('rabbit_hide'), rng.int(2)), stack(burning ? itemId('cooked_rabbit') : itemId('rabbit'), rng.int(2))].filter((s) => s.count > 0);
    if (rng.next() < 0.1) out.push(stack(itemId('rabbit_foot')));
    return out;
  }
  override extraJSON() { return { variant: this.variant }; }
  override loadExtra(d: Record<string, unknown>) { this.variant = (d.variant as number) ?? 0; }
}
/** Nibble mature carrots nearby (each bite takes a stage off). */
const raidCrops = (priority: number): Goal => {
  let at: { x: number; y: number; z: number } | null = null;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      if (rng.int(40)) return false;
      at = null;
      for (let k = 0; k < 20 && !at; k++) {
        const x = Math.floor(m.x) + rng.int(17) - 8, y = Math.floor(m.y) + rng.int(3) - 1, z = Math.floor(m.z) + rng.int(17) - 8;
        if (m.world.getId(x, y, z) === B.CARROTS && metaOf(m.world.get(x, y, z)) >= 7) at = { x, y, z };
      }
      return !!at && m.setPathTo(at.x, at.y, at.z, 0.07);
    },
    canContinue: (m) => !!at && !!m.path,
    tick: (m) => {
      if (!at || dist2(m, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }) > 1.5) return;
      const v = m.world.get(at.x, at.y, at.z);
      if (idOf(v) === B.CARROTS) { const s = metaOf(v); m.world.set(at.x, at.y, at.z, s > 0 ? pack(B.CARROTS, s - 1) : 0); m.game.particles?.blockBreak(at.x + 0.5, at.y + 0.3, at.z + 0.5, B.CARROTS); }
      at = null; m.path = null;
    },
    stop: (m) => { at = null; m.path = null; },
  };
};

// ------------------------------------------------------------------ foxes
/** Foxes: hunt chickens, rabbits and fish at night, sleep in the day, pick things up in their mouths, love sweet berries. Bred foxes trust players. */
export class Fox extends GoalMob {
  kind = 'fox';
  typeName = 'Fox';
  override model = 'fox';
  override skin = 'fox';
  override speedAttr = 0.3;
  override fleesWhenHurt = false;
  override retaliates = true;
  snow = false;
  sleeping = false;
  /** What it carries in its mouth. */
  mouth: ItemStack | null = null;
  trusted: string[] = [];
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 0.7;
    this.maxHealth = this.health = 10;
    this.attackDamage = 2;
    this.food = [I7.SWEET_BERRIES];
    const me = this;
    this.goals.push(swim(0), sleepGoal(1), breed(2, 0.08, (m, mate) => {
      const b = m.game.interact!.spawnMob('fox', m.x, m.y, m.z, true) as Fox | null;
      if (b) { b.baby = true; b.snow = (m as Fox).snow; const p = m.game.player; if (p) b.trusted = [p.name ?? '']; void mate; }
    }), tempt(3, 0.07), avoidEntity(4, (m, e) => ((e instanceof Player && !e.creative && !e.spectator && !e.sneaking && !me.trusts(e)) || e instanceof Wolf || tn(e) === 'Polar Bear'), 8, 0.12),
      meleeAttack(5, 0.12), eatBerries(6), pickUpItems(7), followParent(8, 0.08), wander(9, 0.06), lookAtPlayer(10, 6));
    this.targetGoals.push(nearestTarget(1, (m, e) => !this.sleeping && (tn(e) === 'Chicken' || tn(e) === 'Rabbit' || tn(e) === 'Cod' || tn(e) === 'Salmon' || (tn(e) === 'Turtle' && (e as Mob).baby) || tn(e) === 'Tropical Fish'), 16, true));
  }
  override eyeHeight() { return this.sleeping ? 0.25 : 0.4; }
  trusts(p: Player) { return this.trusted.includes(p.name ?? '') || (!p.name && this.trusted.length > 0); }
  override tick() {
    super.tick();
    this.skin = this.snow ? 'fox_snow' : 'fox';
    this.heldItem = this.mouth?.id ?? 0;
  }
  override onDamaged(attacker: Entity | null) { this.sleeping = false; super.onDamaged(attacker); if (this.mouth && rng.int(2) === 0) this.dropMouth(); }
  dropMouth() {
    if (!this.mouth) return;
    const e = new ItemEntity(this.world, this.game, this.mouth);
    e.setPos(this.x, this.y + 0.4, this.z);
    e.pickupDelay = 40;
    this.game.addEntity(e);
    this.mouth = null;
  }
  pickVariant() { this.snow = this.game.biomeAt(Math.floor(this.x), Math.floor(this.z)).cold; }
  override drops(): ItemStack[] { return this.mouth ? [this.mouth] : []; }
  override extraJSON() { return { snow: this.snow, mouth: this.mouth, trusted: this.trusted, sleeping: this.sleeping }; }
  override loadExtra(d: Record<string, unknown>) { this.snow = !!d.snow; this.mouth = (d.mouth as ItemStack) ?? null; this.trusted = (d.trusted as string[]) ?? []; this.sleeping = !!d.sleeping; }
}
/** Foxes sleep through the day in the shade (and wake if something comes near). */
const sleepGoal = (priority: number): Goal => ({
  priority, controls: ['move', 'look', 'jump'],
  canStart: (m) => {
    const f = m as Fox;
    if (!m.game.isDaytime() || m.target || m.inWater || rng.int(100)) return false;
    const [sky] = m.world.getLight(Math.floor(m.x), Math.floor(m.y + 1), Math.floor(m.z));
    if (sky >= 15 && m.world.topSolidY(Math.floor(m.x), Math.floor(m.z)) < m.y) return false;
    f.sleeping = true;
    return true;
  },
  canContinue: (m) => (m as Fox).sleeping && m.game.isDaytime() && !m.target && !m.game.playerEntities().some((p) => !p.sneaking && !p.spectator && m.distanceTo(p) < 4),
  tick: (m) => { m.path = null; m.forward = 0; },
  stop: (m) => { (m as Fox).sleeping = false; },
});
/** Eat sweet berries off bushes (or knock them off). */
const eatBerries = (priority: number): Goal => {
  let at: { x: number; y: number; z: number } | null = null;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      if (rng.int(60)) return false;
      at = null;
      for (let k = 0; k < 24 && !at; k++) {
        const x = Math.floor(m.x) + rng.int(17) - 8, y = Math.floor(m.y) + rng.int(3) - 1, z = Math.floor(m.z) + rng.int(17) - 8;
        if (m.world.getId(x, y, z) === B2.SWEET_BERRY_BUSH && metaOf(m.world.get(x, y, z)) >= 2) at = { x, y, z };
      }
      return !!at && m.setPathTo(at.x, at.y, at.z, 0.07);
    },
    canContinue: (m) => !!at && !!m.path,
    tick: (m) => {
      if (!at || dist2(m, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }) > 2.2) return;
      const f = m as Fox;
      const v = m.world.get(at.x, at.y, at.z);
      if (idOf(v) === B2.SWEET_BERRY_BUSH && metaOf(v) >= 2) {
        const n = metaOf(v) === 3 ? 2 + rng.int(2) : 1 + rng.int(2);
        if (!f.mouth) { f.mouth = stack(I7.SWEET_BERRIES, 1); if (n > 1) m.game.dropItem(at.x + 0.5, at.y + 0.5, at.z + 0.5, stack(I7.SWEET_BERRIES, n - 1)); }
        else m.game.dropItem(at.x + 0.5, at.y + 0.5, at.z + 0.5, stack(I7.SWEET_BERRIES, n));
        m.world.set(at.x, at.y, at.z, pack(B2.SWEET_BERRY_BUSH, 1));
      }
      at = null; m.path = null;
    },
    stop: (m) => { at = null; m.path = null; },
  };
};
/** Pick up an item lying nearby (foxes carry one in the mouth, eating food after a while). */
const pickUpItems = (priority: number): Goal => {
  let item: ItemEntity | null = null;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      if ((m as Fox).mouth || rng.int(30)) return false;
      item = (m.game.entities.find((e) => e instanceof ItemEntity && !e.removed && e.distanceTo(m) < 8 && e.pickupDelay <= 0) as ItemEntity | undefined) ?? null;
      if (item) m.setPathTo(item.x, item.y, item.z, 0.08);
      return !!item;
    },
    canContinue: (m) => !!item && !item.removed && !(m as Fox).mouth,
    tick: (m) => {
      if (!item) return;
      if (m.distanceTo(item) < 1.2) { (m as Fox).mouth = { ...item.item, count: 1 }; item.item.count--; if (item.item.count <= 0) item.removed = true; item = null; m.path = null; }
      else if (!m.path && !m.setPathTo(item.x, item.y, item.z, 0.08)) m.moveToward(item.x, item.z, 0.08);
    },
    stop: (m) => { item = null; m.path = null; },
  };
};

// ------------------------------------------------------------------ cats and ocelots
export const CAT_TYPES = ['tabby', 'black', 'red', 'siamese', 'british_shorthair', 'calico', 'persian', 'ragdoll', 'white', 'jellie', 'all_black'] as const;
/** Cats: village strays tamed with raw fish. They sit (even on chests and beds), follow, scare creepers and phantoms, and bring gifts. */
export class Cat extends Tameable {
  kind = 'cat';
  typeName = 'Cat';
  override model = 'cat';
  override skin = 'cat_tabby';
  override speedAttr = 0.3;
  variant = 0;
  /** The dye colour of its collar (red by default). */
  collar = 14;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 0.7;
    this.maxHealth = this.health = 10;
    this.attackDamage = 3;
    this.variant = rng.int(10);
    this.food = this.tameItems = [I2.COD, I2.SALMON];
    this.goals.push(swim(0), sitGoal(1), panic(2, 0.1), followOwner(3, 0.09, 3, 10), breed(4, 0.07), tempt(5, 0.07),
      avoidEntity(6, (m, e) => !(m as Cat).owner && e instanceof Player && !e.sneaking && !e.creative && !e.spectator, 7, 0.11),
      meleeAttack(7, 0.1), followParent(8, 0.07), wander(9, 0.05), lookAtPlayer(10, 6));
    this.targetGoals.push(nearestTarget(1, (m, e) => !(m as Cat).owner && (tn(e) === 'Rabbit' || (tn(e) === 'Turtle' && (e as Mob).baby)), 10, true), defendOwner(2));
  }
  override eyeHeight() { return 0.35; }
  override tick() { super.tick(); this.skin = 'cat_' + CAT_TYPES[this.variant]; }
  override onTamed() { this.game.audio.play('cat.purr', this, 1, 1); }
  /** A tamed cat sleeping with its owner leaves a gift in the morning (vanilla: 70%). */
  morningGift() {
    if (!this.owner || rng.next() > 0.7) return;
    const pool: [number, number][] = [[itemId('rabbit_hide'), 1], [itemId('rabbit_foot'), 1], [itemId('chicken'), 1], [itemId('feather'), 1], [itemId('rotten_flesh'), 1], [itemId('string'), 1], [itemId('phantom_membrane'), 1]];
    const [id] = pool[rng.int(pool.length)];
    if (id) this.game.dropItem(this.x, this.y + 0.5, this.z, stack(id));
  }
  override drops(): ItemStack[] { return [stack(I.STRING, rng.int(3))].filter((s) => s.count > 0); }
  override extraJSON() { return { ...super.extraJSON(), variant: this.variant, collar: this.collar }; }
  override loadExtra(d: Record<string, unknown>) { super.loadExtra(d); this.variant = (d.variant as number) ?? 0; this.collar = (d.collar as number) ?? 14; }
}
/** Ocelots: shy jungle cats. Fish makes them trust you (they stop running), but they're never tamed. */
export class Ocelot extends GoalMob {
  kind = 'ocelot';
  typeName = 'Ocelot';
  override model = 'cat';
  override skin = 'ocelot';
  override speedAttr = 0.3;
  trusting = false;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 0.7;
    this.maxHealth = this.health = 10;
    this.attackDamage = 3;
    this.food = [I2.COD, I2.SALMON];
    this.goals.push(swim(0), breed(2, 0.07), tempt(3, 0.06),
      avoidEntity(4, (m, e) => !(m as Ocelot).trusting && e instanceof Player && !e.creative && !e.spectator, 16, 0.12),
      meleeAttack(5, 0.1), followParent(6, 0.07), wander(8, 0.05), lookAtPlayer(9, 6));
    this.targetGoals.push(nearestTarget(1, (_m, e) => tn(e) === 'Chicken' || (tn(e) === 'Turtle' && (e as Mob).baby), 10, true));
  }
  override eyeHeight() { return 0.35; }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held && this.food.includes(held.id) && !this.trusting) {
      game.interact!.consume(1);
      if (rng.int(3) === 0) { this.trusting = true; hearts(this); } else smokes(this);
      return true;
    }
    return super.interact(game, held);
  }
  override despawnCheck() { if (!this.trusting) super.despawnCheck(); }
  override extraJSON() { return { trusting: this.trusting }; }
  override loadExtra(d: Record<string, unknown>) { this.trusting = !!d.trusting; }
}

// ------------------------------------------------------------------ parrots
export const PARROT_TYPES = ['red', 'blue', 'green', 'cyan', 'grey'] as const;
/** Parrots: fly about the jungle, tamed with seeds, ride on their owner's shoulder, dance to music, mimic monsters. Cookies kill them. */
export class Parrot extends Tameable {
  kind = 'parrot';
  typeName = 'Parrot';
  override model = 'parrot';
  override skin = 'parrot_red';
  override speedAttr = 0.4;
  variant = 0;
  /** Dancing to a jukebox playing nearby; wing flap for the renderer. */
  dancing = false;
  flap = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.5; this.height = 0.9;
    this.maxHealth = this.health = 6;
    this.variant = rng.int(5);
    this.tameItems = [I.WHEAT_SEEDS, I.PUMPKIN_SEEDS, I7.MELON_SEEDS, I7.BEETROOT_SEEDS];
    this.tameOdds = 3;
    this.goals.push(sitGoal(1), panic(2, 0.12), followOwner(3, 0.1, 3, 8, true), landOnShoulder(4), wander(8, 0.07), lookAtPlayer(9, 8));
  }
  override eyeHeight() { return 0.6; }
  override gravity() { return this.onGround || this.sitting ? 0.08 : 0.02; }
  override tick() {
    super.tick();
    this.skin = 'parrot_' + PARROT_TYPES[this.variant];
    this.flap += this.onGround ? -0.1 : 0.3;
    if (this.flap < 0) this.flap = 0;
    // keep airborne when moving through the air
    if (!this.onGround && this.vy < 0) this.vy *= 0.6;
    if (this.path && this.path.length && this.path[0].y > this.y) this.vy = Math.max(this.vy, 0.12);
    // dance to a jukebox playing within 3 blocks
    if (this.age % 20 === 0) this.dancing = jukeboxNear(this);
    // mimic a monster nearby now and then
    if (this.age % 200 === 0 && rng.int(4) === 0) {
      const m = this.game.entities.find((e) => e instanceof Mob && e.hostile && e.distanceTo(this) < 20) as Mob | undefined;
      if (m?.sayName) this.game.audio.play(m.sayName, this, 0.7, 1.8);
    }
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held?.id === I.COOKIE) {
      game.interact!.consume(1);
      this.addEffect('poison', 900, 0);
      this.damage(this.maxHealth * 10, 'magic', game.player ?? null);
      return true;
    }
    return super.interact(game, held);
  }
  override onLand() {}
  override drops(): ItemStack[] { return [stack(itemId('feather'), 1 + rng.int(2))]; }
  override extraJSON() { return { ...super.extraJSON(), variant: this.variant }; }
  override loadExtra(d: Record<string, unknown>) { super.loadExtra(d); this.variant = (d.variant as number) ?? 0; }
}
function jukeboxNear(m: Mob): boolean {
  const x0 = Math.floor(m.x), y0 = Math.floor(m.y), z0 = Math.floor(m.z);
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
    if (m.world.getId(x0 + dx, y0 + dy, z0 + dz) !== B2.JUKEBOX) continue;
    const t = m.world.getTile(x0 + dx, y0 + dy, z0 + dz) as { disc?: unknown } | undefined;
    if (t?.disc) return true;
  }
  return false;
}
/** A tame parrot close to its owner hops onto a free shoulder (it leaves the world until the owner jumps or gets hurt). */
const landOnShoulder = (priority: number): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => {
    const p = m as Parrot, o = p.ownerPlayer();
    return !!o && !p.sitting && !o.flying && !o.inWater && !o.sneaking && m.distanceTo(o) < 2 && rng.int(80) === 0 && (!o.shoulderLeft || !o.shoulderRight);
  },
  start: (m) => {
    const p = m as Parrot, o = p.ownerPlayer()!;
    const data = { variant: p.variant, health: p.health, ownerName: p.ownerName };
    if (!o.shoulderLeft) o.shoulderLeft = data; else o.shoulderRight = data;
    p.removed = true;
  },
});
/** Put shoulder parrots back into the world (the owner jumped, fell, got hurt, swam or slept). */
export function releaseShoulders(game: Game, p: Player) {
  for (const side of ['shoulderLeft', 'shoulderRight'] as const) {
    const d = p[side];
    if (!d) continue;
    p[side] = null;
    const par = game.interact!.spawnMob('parrot', p.x + (side === 'shoulderLeft' ? -0.4 : 0.4), p.y + 1.4, p.z) as Parrot | null;
    if (par) { par.variant = d.variant; par.health = d.health; par.owner = true; par.ownerName = d.ownerName; par.sitting = false; }
  }
}

// ------------------------------------------------------------------ polar bears and pandas
/** Polar bears: neutral, but fierce near their cubs; they stand up to strike. */
export class PolarBear extends GoalMob {
  kind = 'polar_bear';
  typeName = 'Polar Bear';
  override model = 'polar_bear';
  override skin = 'polar_bear';
  override speedAttr = 0.25;
  override retaliates = true;
  override sayName = 'polar_bear.say';
  override hurtName = 'polar_bear.hurt';
  override deathName = 'polar_bear.death';
  /** Standing up on its hind legs (0..1) to attack. */
  standing = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.4; this.height = 1.4;
    this.maxHealth = this.health = 30;
    this.attackDamage = 6;
    this.goals.push(swim(0), meleeAttack(1, 0.1), panic(2, 0.12), followParent(4, 0.08), wander(5, 0.05), lookAtPlayer(6, 6));
    // a mother attacks players near her cub
    this.targetGoals.push(nearestTarget(1, (m, e) => !m.baby && e instanceof Player && m.game.entities.some((c) => c instanceof PolarBear && c.baby && c.distanceTo(m) < 16) && m.distanceTo(e) < 10, 16, true));
  }
  override eyeHeight() { return 1.2; }
  override tick() {
    super.tick();
    const want = this.target && this.distanceTo(this.target) < 3 ? 1 : 0;
    this.standing += (want - this.standing) * 0.2;
    if (this.baby) this.panicTicks = this.panicTicks > 0 ? this.panicTicks : 0;
  }
  override onDamaged(attacker: Entity | null) {
    if (this.baby) { this.panicTicks = 60; for (const e of this.game.entities) if (e instanceof PolarBear && !e.baby && e.distanceTo(this) < 16 && attacker instanceof LivingEntity) { e.target = attacker; e.angerTicks = 400; } return; }
    super.onDamaged(attacker);
  }
  override drops(): ItemStack[] { return [stack(rng.int(4) ? I2.COD : I2.SALMON, rng.int(3))].filter((s) => s.count > 0); }
}

export const PANDA_GENES = ['normal', 'lazy', 'worried', 'playful', 'aggressive', 'weak', 'brown'] as const;
/** Pandas: bamboo eaters with personalities (lazy, worried, playful, aggressive, weak, brown); babies sneeze. */
export class Panda extends GoalMob {
  kind = 'panda';
  typeName = 'Panda';
  override model = 'panda';
  override skin = 'panda';
  override speedAttr = 0.15;
  gene = 0;
  /** Eating (holding bamboo), rolling (playful), sneezing (babies), sitting (lazy) timers for the renderer. */
  eating = 0;
  rolling = 0;
  sneezing = 0;
  sittingT = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.3; this.height = 1.25;
    this.maxHealth = this.health = 20;
    this.attackDamage = 6;
    const g = rng.int(20);
    this.gene = g < 2 ? 1 : g < 4 ? 2 : g < 6 ? 3 : g < 8 ? 4 : g < 10 ? 5 : g === 10 ? 6 : 0;
    this.food = [B2.BAMBOO];
    this.goals.push(swim(0), panic(1, 0.12), breed(2, 0.06), tempt(3, 0.05),
      avoidEntity(4, (m, e) => (m as Panda).gene === 2 && e instanceof Mob && e.hostile, 8, 0.1),
      meleeAttack(5, 0.08), followParent(6, 0.06), wander(8, 0.04, 200), lookAtPlayer(9, 6));
    this.targetGoals.push(nearestTarget(1, (m) => !!m.lastAttacker && (m as Panda).gene === 4, 16));
    this.retaliates = this.gene === 4;
  }
  override eyeHeight() { return 1; }
  override tick() {
    super.tick();
    this.skin = this.gene === 6 ? 'panda_brown' : 'panda';
    this.heldItem = this.eating > 0 ? B2.BAMBOO : 0;
    if (this.dead || this.noAi) return;
    if (this.eating > 0) this.eating--;
    if (this.rolling > 0) this.rolling--;
    else if (this.gene === 3 && rng.int(400) === 0) this.rolling = 30;
    if (this.sittingT > 0) this.sittingT--;
    else if (this.gene === 1 && rng.int(300) === 0) this.sittingT = 200;
    // babies sneeze (and scare the others into jumping); weak pandas sneeze less
    if (this.baby && this.sneezing === 0 && rng.int(this.gene === 5 ? 500 : 6000) === 0) this.sneezing = 20;
    if (this.sneezing > 0 && --this.sneezing === 1) {
      this.game.dropItem(this.x, this.y + 0.5, this.z, stack(I2.SLIME_BALL));
      this.game.audio.play('panda.sneeze', this, 1, 1.2);
    }
    // eat bamboo lying around
    if (this.eating === 0 && this.age % 20 === 0) {
      const it = this.game.entities.find((e) => e instanceof ItemEntity && e.item.id === B2.BAMBOO && e.distanceTo(this) < 2) as ItemEntity | undefined;
      if (it) { if (--it.item.count <= 0) it.removed = true; this.eating = 200; }
    }
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held?.id === B2.BAMBOO && this.eating === 0 && (this.baby || this.loveTicks > 0 || this.breedCooldown > 0)) { this.eating = 200; game.interact!.consume(1); return true; }
    return super.interact(game, held);
  }
  override drops(): ItemStack[] { return [stack(B2.BAMBOO, rng.int(3))].filter((s) => s.count > 0); }
  override extraJSON() { return { gene: this.gene }; }
  override loadExtra(d: Record<string, unknown>) { this.gene = (d.gene as number) ?? 0; this.retaliates = this.gene === 4; }
}

// ------------------------------------------------------------------ llamas
export const LLAMA_COLORS = ['creamy', 'white', 'brown', 'gray'] as const;
/** Llamas: chest carriers that can be tamed by riding but not steered; they spit at wolves and attackers. */
export class Llama extends Horse {
  override typeName = 'Llama';
  override model = 'llama';
  override skin = 'llama_creamy';
  override sayName = 'llama.say';
  override hurtName = 'llama.hurt';
  override deathName = 'llama.death';
  override temptItems = [I.WHEAT, B.HAY_BLOCK];
  /** Inventory size in thirds (strength 1-5: 3-15 chest slots). */
  strength = 1;
  /** The carpet it wears (dye colour, -1 none) and whether it's a trader llama. */
  carpet = -1;
  trader = false;
  private spitTimer = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 1.87;
    this.kind = 'donkey';
    this.color = rng.int(4);
    this.strength = 1 + rng.int(rng.int(5) === 0 ? 5 : 3);
    this.maxHealth = this.health = 15 + rng.int(16);
    this.speedStat = 0.175;
  }
  override get skinKey() { return 'llama_' + LLAMA_COLORS[this.color % 4]; }
  /** Llamas can't be steered. */
  override get controllable() { return false; }
  override babyType(): never { return "llama" as never; }
  override canMateWith(o: unknown) { return o instanceof Llama; }
  override tick() {
    super.tick();
    this.skin = this.trader ? 'llama_trader' : 'llama_' + LLAMA_COLORS[this.color % 4];
    this.chestItems.length = Math.max(3, this.strength * 3);
    if (this.dead || this.noAi) return;
    // spit at wolves, and at whoever hurt it
    if (this.spitTimer > 0) this.spitTimer--;
    const foe = (this.lastAttacker instanceof LivingEntity && !this.lastAttacker.dead && this.lastAttacker.distanceTo(this) < 16 && this.hurtTime > 0 ? this.lastAttacker : null)
      ?? (this.game.entities.find((e) => e instanceof Wolf && !(e as Wolf).owner && e.distanceTo(this) < 10) as LivingEntity | undefined) ?? null;
    if (foe && this.spitTimer === 0) { this.spitTimer = 40; spit(this, foe); }
  }
  override extraJSON() { return { ...super.extraJSON(), strength: this.strength, carpet: this.carpet, trader: this.trader }; }
  override loadExtra(d: Record<string, unknown>) { super.loadExtra(d); this.strength = (d.strength as number) ?? 1; this.carpet = (d.carpet as number) ?? -1; this.trader = !!d.trader; }
}
/** A gob of llama spit: 1 damage, a tiny arc (drawn as a puff of particles). */
function spit(l: Llama, t: LivingEntity) {
  const steps = Math.ceil(l.distanceTo(t) / 0.5);
  for (let i = 0; i < steps; i++) {
    const k = i / steps;
    l.game.particles?.smoke(l.x + (t.x - l.x) * k, l.y + l.eyeHeight() + (t.y + t.eyeHeight() - l.y - l.eyeHeight()) * k, l.z + (t.z - l.z) * k);
  }
  t.damage(1, 'mob', l);
  l.game.audio.play('llama.spit', l, 1, 1);
}
export class TraderLlama extends Llama {
  constructor(world: World, game: Game) { super(world, game); this.trader = true; }
  override toJSON() { return { ...super.toJSON(), type: 'trader_llama' }; }
}

// ------------------------------------------------------------------ turtles
/** Turtles: return to their home beach to lay eggs after breeding (fed seagrass); babies drop a scute as they grow up. */
export class Turtle extends GoalMob {
  kind = 'turtle';
  typeName = 'Turtle';
  override model = 'turtle';
  override skin = 'turtle';
  override canBreathe = true;
  override speedAttr = 0.25;
  home: { x: number; y: number; z: number } | null = null;
  hasEgg = false;
  /** Digging the egg hole (ticks). */
  digging = 0;
  private wasBaby = false;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.2; this.height = 0.4;
    this.maxHealth = this.health = 30;
    this.food = [B2.SEAGRASS];
    this.goals.push(panic(1, 0.1), breed(2, 0.06, (m, mate) => {
      // no baby here: the mother carries eggs home
      (m as Turtle).hasEgg = true;
      void mate;
    }), tempt(3, 0.05), goHomeToLay(4), followParent(6, 0.06), wander(7, 0.04), lookAtPlayer(8, 6));
  }
  override eyeHeight() { return 0.2; }
  override gravity() { return this.inWater ? 0.005 : 0.08; }
  override tick() {
    if (!this.home) this.home = { x: Math.floor(this.x), y: Math.floor(this.y), z: Math.floor(this.z) };
    super.tick();
    // babies grow up and shed a scute
    if (this.wasBaby && !this.baby) this.game.dropItem(this.x, this.y + 0.3, this.z, stack(I7.SCUTE));
    this.wasBaby = this.baby;
    if (this.inWater && this.path && this.path.length) { this.vx *= 1.1; this.vz *= 1.1; }
  }
  override drops(): ItemStack[] { return [stack(B2.SEAGRASS, rng.int(3))].filter((s) => s.count > 0); }
  override extraJSON() { return { home: this.home, hasEgg: this.hasEgg }; }
  override loadExtra(d: Record<string, unknown>) { this.home = (d.home as Turtle['home']) ?? null; this.hasEgg = !!d.hasEgg; }
}
/** A turtle with eggs swims back to its home beach and lays 1-4 eggs in the sand. */
const goHomeToLay = (priority: number): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => (m as Turtle).hasEgg && !!(m as Turtle).home,
  tick: (m) => {
    const t = m as Turtle, h = t.home!;
    if (dist2(m, { x: h.x + 0.5, y: h.y, z: h.z + 0.5 }) > 9) {
      if (--m.pathTimer <= 0 || !m.path) { m.pathTimer = 20; if (!m.setPathTo(h.x, h.y, h.z, 0.06)) m.moveToward(h.x + 0.5, h.z + 0.5, 0.06); }
      return;
    }
    // on sand: dig, then lay
    const x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
    if (m.world.getId(x, y - 1, z) !== B.SAND || m.world.getId(x, y, z) !== B.AIR) { t.home = null; return; }
    if (++t.digging > 200) {
      m.world.set(x, y, z, pack(B2.TURTLE_EGG, rng.int(4)));
      m.game.audio.play('dig.sand', m, 1, 1);
      t.hasEgg = false;
      t.digging = 0;
    }
  },
  stop: (m) => { (m as Turtle).digging = 0; },
});
/** Turtle eggs (meta: eggs - 1, plus hatch stage << 2) crack at night and hatch into babies that remember this beach. */
BLOCKS[B2.TURTLE_EGG].behavior = {
  randomTick(c) {
    const g = c.game;
    const night = !g.isDaytime() || rng.int(500) === 0;
    if (!night || c.world.getId(c.x, c.y - 1, c.z) !== B.SAND) return;
    const eggs = (c.meta & 3) + 1, stage = c.meta >> 2;
    if (stage < 2) { c.setMeta((c.meta & 3) | ((stage + 1) << 2)); g.audio.play('turtle.egg_crack', { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, 0.7, 0.9); return; }
    c.set(0);
    g.audio.play('turtle.egg_hatch', { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, 0.7, 0.9);
    for (let i = 0; i < eggs; i++) {
      const b = g.interact!.spawnMob('turtle', c.x + 0.3 + rng.next() * 0.4, c.y, c.z + 0.3 + rng.next() * 0.4, true) as Turtle | null;
      if (b) { b.baby = true; b.growTimer = 0; b.home = { x: c.x, y: c.y, z: c.z }; }
    }
  },
};

// ------------------------------------------------------------------ dolphins
/** Dolphins: playful, need air, speed swimming players with Dolphin's Grace; fed fish, they lead to treasure. */
export class Dolphin extends GoalMob {
  kind = 'dolphin';
  typeName = 'Dolphin';
  override model = 'dolphin';
  override skin = 'dolphin';
  override canBreathe = true;
  override retaliates = true;
  override xp = 0;
  /** Breath (ticks until it must surface) and moisture (ticks it can stay out of water). */
  breath = 4800;
  moisture = 2400;
  /** Where it's leading a player (a treasure), once fed. */
  lead: { x: number; y: number; z: number } | null = null;
  private dest: { x: number; y: number; z: number } | null = null;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 0.6;
    this.maxHealth = this.health = 10;
    this.attackDamage = 3;
    this.food = [I2.COD, I2.SALMON];
    this.goals.push(meleeAttack(1, 0.15));
  }
  override gravity() { return this.inWater ? 0 : 0.08; }
  override eyeHeight() { return 0.3; }
  override ai() {
    super.ai();
    if (this.target) { this.dest = { x: this.target.x, y: this.target.y + 0.5, z: this.target.z }; return; }
    // surface for air, follow a lead, keep near swimming players (and give them grace), or roam
    const surf = this.world.topSolidY(Math.floor(this.x), Math.floor(this.z));
    void surf;
    if (this.breath < 600) { this.dest = { x: this.x, y: this.waterTop() + 0.5, z: this.z }; return; }
    if (this.lead) {
      this.dest = { x: this.lead.x, y: Math.min(this.y, 60), z: this.lead.z };
      if (Math.hypot(this.lead.x - this.x, this.lead.z - this.z) < 12) this.lead = null;
      return;
    }
    const swimmer = this.game.playerEntities().find((p) => p.inWater && !p.spectator && p.distanceTo(this) < 10);
    if (swimmer) {
      if (swimmer.sprinting || rng.int(4) === 0) swimmer.addEffect('dolphins_grace', 100, 0);
      this.dest = { x: swimmer.x + Math.cos(this.age * 0.05) * 3, y: swimmer.y, z: swimmer.z + Math.sin(this.age * 0.05) * 3 };
      return;
    }
    if (!this.dest || rng.int(60) === 0 || dist2(this, this.dest) < 2) {
      for (let i = 0; i < 6; i++) {
        const d = { x: this.x + rng.int(21) - 10, y: this.y + rng.int(7) - 3, z: this.z + rng.int(21) - 10 };
        if (this.world.getId(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z)) === B.WATER) { this.dest = d; break; }
      }
    }
  }
  waterTop() { let y = Math.floor(this.y); while (this.world.getId(Math.floor(this.x), y + 1, Math.floor(this.z)) === B.WATER && y < 255) y++; return y + 1; }
  override travel() {
    this.updateFluidState();
    if (this.inWater) {
      if (this.dest && !this.noAi) {
        const dx = this.dest.x - this.x, dy = this.dest.y - this.y, dz = this.dest.z - this.z, l = Math.hypot(dx, dy, dz) || 1;
        const sp = this.target || this.lead ? 0.045 : 0.025;
        this.vx += (dx / l) * sp; this.vy += (dy / l) * sp; this.vz += (dz / l) * sp;
        this.yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
        this.pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
      }
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.9; this.vy *= 0.9; this.vz *= 0.9;
      // leap out of the water now and then
      if (!this.noAi && this.y + 0.6 > this.waterTop() - 0.2 && rng.int(80) === 0) { this.vy = 0.5; this.vx *= 2; this.vz *= 2; }
    } else {
      this.vy -= 0.08;
      this.vx *= 0.95; this.vz *= 0.95;
      if (this.onGround && rng.int(10) === 0) { this.vy = 0.4; this.vx = (rng.next() - 0.5) * 0.3; this.vz = (rng.next() - 0.5) * 0.3; }
      this.move(this.vx, this.vy, this.vz);
    }
  }
  override environment() {
    const head = this.world.getId(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    if (head === B.WATER) { if (--this.breath <= 0 && this.age % 20 === 0) this.damage(2, 'drown'); } else this.breath = 4800;
    if (this.inWater || (this.game.weather?.rainAt(this.x, this.y + 1, this.z) ?? false)) this.moisture = 2400;
    else if (--this.moisture <= 0 && this.age % 20 === 0) this.damage(1, 'generic');
    if (this.y < -64) this.damage(4, 'void');
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (!held || !this.food.includes(held.id)) return false;
    game.interact!.consume(1);
    hearts(this);
    const t = treasureNear(game, this.x, this.z);
    if (t) this.lead = t;
    return true;
  }
  override useLabel(_p: Player, held: ItemStack | null) { return held && this.food.includes(held.id) ? 'Feed' : null; }
  override drops(): ItemStack[] { return [stack(I2.COD, rng.int(2))].filter((s) => s.count > 0); }
  override extraJSON() { return { breath: this.breath, moisture: this.moisture }; }
  override loadExtra(d: Record<string, unknown>) { this.breath = (d.breath as number) ?? 4800; this.moisture = (d.moisture as number) ?? 2400; }
}
/** The nearest shipwreck, ocean ruin or buried treasure to lead a player to (by the generator; null if none known). */
let TREASURE: ((game: Game, x: number, z: number) => { x: number; y: number; z: number } | null) | null = null;
export function setTreasureFinder(f: typeof TREASURE) { TREASURE = f; }
const treasureNear = (game: Game, x: number, z: number) => (TREASURE ?? findTreasure)(game, x, z);
/** By default: ask the overworld generator (a copy of it on this thread) for the nearest shipwreck, ruin or buried treasure. */
let gen: WorldGen | null = null;
function findTreasure(game: Game, x: number, z: number): { x: number; y: number; z: number } | null {
  const seed = game.meta?.seed;
  if (seed === undefined || game.world?.dimension !== 'overworld') return null;
  if (!gen || gen.seed !== seed) gen = new WorldGen(seed);
  let best: { x: number; y: number; z: number } | null = null, bd = Infinity;
  for (const t of OVERWORLD_STRUCTURES) {
    if (t.name !== 'shipwreck' && t.name !== 'ocean_ruin' && t.name !== 'buried_treasure') continue;
    const s = nearestStart(t, gen, x, z, t.name === 'buried_treasure' ? 40 : 8);
    if (!s) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) { bd = d; best = { x: s.x, y: s.y, z: s.z }; }
  }
  return best;
}

// ------------------------------------------------------------------ fish
/** Fish: swim in small schools, flop and die on land; scooped up in a water bucket. */
export abstract class Fish extends Mob {
  abstract kind: string;
  override canBreathe = true;
  override xp = 1;
  /** The bucket that holds this kind. */
  abstract bucket: number;
  /** Wiggle phase for the tail. */
  wiggle = 0;
  fromBucket = false;
  leader: Fish | null = null;
  private dir = { x: 0, y: 0, z: 0 };
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.5; this.height = 0.3;
    this.maxHealth = this.health = 3;
  }
  override gravity() { return this.inWater ? 0 : 0.08; }
  override eyeHeight() { return this.height * 0.65; }
  override ai() {
    this.wiggle += this.inWater ? 0.3 + Math.hypot(this.vx, this.vz) * 4 : 0.8;
    // flee players that come close, follow the school leader, otherwise drift about
    const scary = this.game.playerEntities().find((p) => !p.spectator && p.distanceTo(this) < 4);
    if (scary) { const dx = this.x - scary.x, dz = this.z - scary.z, l = Math.hypot(dx, dz) || 1; this.dir = { x: (dx / l) * 0.12, y: 0, z: (dz / l) * 0.12 }; return; }
    if (this.leader && (this.leader.dead || this.leader.removed || this.leader.distanceTo(this) > 12)) this.leader = null;
    if (!this.leader && this.schools() && rng.int(40) === 0) this.leader = (this.game.entities.find((e) => e instanceof Fish && e !== this && e.kind === this.kind && !e.leader && e.distanceTo(this) < 8) as Fish | undefined) ?? null;
    if (this.leader) { const dx = this.leader.x - this.x, dy = this.leader.y - this.y, dz = this.leader.z - this.z, l = Math.hypot(dx, dy, dz) || 1; if (l > 2) this.dir = { x: (dx / l) * 0.08, y: (dy / l) * 0.04, z: (dz / l) * 0.08 }; return; }
    if (rng.int(60) === 0 || (!this.dir.x && !this.dir.z)) {
      const a = rng.next() * Math.PI * 2;
      this.dir = { x: Math.cos(a) * 0.05, y: (rng.next() - 0.5) * 0.03, z: Math.sin(a) * 0.05 };
    }
  }
  schools() { return true; }
  override travel() {
    this.updateFluidState();
    if (this.inWater) {
      if (!this.noAi) { this.vx += (this.dir.x - this.vx) * 0.1; this.vy += (this.dir.y - this.vy) * 0.1; this.vz += (this.dir.z - this.vz) * 0.1; }
      // don't swim out of the water
      const ahead = this.world.getId(Math.floor(this.x + this.vx * 8), Math.floor(this.y + 0.15), Math.floor(this.z + this.vz * 8));
      if (ahead !== B.WATER && ahead !== B2.BUBBLE_COLUMN && !BLOCKS[ahead].solid) { this.dir.x = -this.dir.x; this.dir.z = -this.dir.z; this.vx *= -0.5; this.vz *= -0.5; }
      const above = this.world.getId(Math.floor(this.x), Math.floor(this.y + this.height + 0.1), Math.floor(this.z));
      if (above !== B.WATER && above !== B2.BUBBLE_COLUMN && this.vy > 0) this.vy = -0.01;
      this.move(this.vx, this.vy, this.vz);
      if (Math.hypot(this.vx, this.vz) > 0.005) this.yaw = this.bodyYaw = this.headYaw = (Math.atan2(this.vz, this.vx) * 180) / Math.PI - 90;
    } else {
      this.vy -= 0.08;
      this.vx *= 0.9; this.vz *= 0.9;
      if (this.onGround && rng.int(8) === 0) { this.vy = 0.3; this.vx = (rng.next() - 0.5) * 0.2; this.vz = (rng.next() - 0.5) * 0.2; this.game.audio.play('fish.flop', this, 0.5, 1); }
      this.move(this.vx, this.vy, this.vz);
    }
  }
  override environment() {
    if (!this.inWater && this.age % 20 === 0) { this.air -= 20; if (this.air <= 0) this.damage(1, 'suffocate'); }
    else if (this.inWater) this.air = 300;
    if (this.y < -64) this.damage(4, 'void');
  }
  /** A water bucket scoops it up. */
  interact(game: Game, held: ItemStack | null): boolean {
    if (held?.id !== I.WATER_BUCKET || !this.inWater) return false;
    const out = stack(this.bucket) as ItemStack & { fish?: Record<string, unknown> };
    out.fish = this.bucketData();
    swapHeld(game, out);
    this.removed = true;
    game.audio.play('splash', this, 0.4, 1.4);
    return true;
  }
  useLabel(_p: Player, held: ItemStack | null) { return held?.id === I.WATER_BUCKET ? 'Catch' : null; }
  bucketData(): Record<string, unknown> { return { health: this.health }; }
  fromBucketData(d: Record<string, unknown>) { this.health = (d.health as number) ?? this.health; this.fromBucket = true; }
  override despawnCheck() {
    if (this.fromBucket) return;
    const d = this.playerDistance();
    if (d !== Infinity && d > 128) this.removed = true;
  }
  override extraJSON(): Record<string, unknown> { return { fromBucket: this.fromBucket }; }
  override loadExtra(d: Record<string, unknown>) { this.fromBucket = !!d.fromBucket; }
}
export class Cod extends Fish {
  kind = 'cod'; typeName = 'Cod'; override model = 'cod'; override skin = 'cod';
  bucket = I7.COD_BUCKET;
  override drops(burning: boolean) { return [stack(burning ? itemId('cooked_cod') : I2.COD), ...(rng.int(20) === 0 ? [stack(itemId('bone_meal'))] : [])]; }
}
export class Salmon extends Fish {
  kind = 'salmon'; typeName = 'Salmon'; override model = 'salmon'; override skin = 'salmon';
  bucket = I7.SALMON_BUCKET;
  constructor(world: World, game: Game) { super(world, game); this.width = 0.7; this.height = 0.4; }
  override drops(burning: boolean) { return [stack(burning ? itemId('cooked_salmon') : I2.SALMON), ...(rng.int(20) === 0 ? [stack(itemId('bone_meal'))] : [])]; }
}
/** Pufferfish: puff up when something comes close, and poison what touches them. */
export class Pufferfish extends Fish {
  kind = 'pufferfish'; typeName = 'Pufferfish'; override model = 'pufferfish'; override skin = 'pufferfish';
  bucket = I7.PUFFERFISH_BUCKET;
  /** 0 small, 1 half, 2 full. */
  puff = 0;
  private puffTimer = 0;
  override schools() { return false; }
  override tick() {
    super.tick();
    if (this.dead || this.noAi) return;
    const near = this.game.entities.some((e) => e instanceof LivingEntity && e !== this && !(e instanceof Fish) && !(e instanceof Player && (e.creative || e.spectator)) && e.distanceTo(this) < 2.5);
    if (near) { this.puffTimer = 0; if (this.puff < 2 && this.age % 10 === 0) { this.puff++; this.game.audio.play('pufferfish.blow_up', this, 1, 1); } }
    else if (this.puff > 0 && ++this.puffTimer > 60) { this.puff--; this.puffTimer = 0; }
    this.width = this.height = [0.35, 0.5, 0.7][this.puff];
    // stinging touch
    if (this.puff > 0) for (const e of this.game.entities) {
      if (!(e instanceof LivingEntity) || e === this || e instanceof Fish || e.dead) continue;
      if (e instanceof Player && (e.creative || e.spectator)) continue;
      if (Math.abs(e.x - this.x) < (e.width + this.width) / 2 + 0.1 && Math.abs(e.z - this.z) < (e.width + this.width) / 2 + 0.1 && e.y < this.y + this.height && e.y + e.height > this.y) {
        if (e.damage(1 + this.puff, 'mob', this)) e.addEffect('poison', 60 * this.puff, 0);
      }
    }
  }
  override drops() { return [stack(itemId("pufferfish")), ...(rng.int(20) === 0 ? [stack(itemId('bone_meal'))] : [])]; }
}
/** Tropical fish: a body shape (small or large), a pattern, and two dye colours (vanilla's 2700 combinations). */
export class TropicalFish extends Fish {
  kind = 'tropical_fish'; typeName = 'Tropical Fish'; override model = 'tropical_fish'; override skin = 'tropical_fish';
  bucket = I7.TROPICAL_FISH_BUCKET;
  shape = 0;
  pattern = 0;
  baseColor = 0;
  patternColor = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.shape = rng.int(2); this.pattern = rng.int(6); this.baseColor = rng.int(16); this.patternColor = rng.int(16);
  }
  override tick() { super.tick(); this.model = this.shape ? 'tropical_fish_b' : 'tropical_fish'; this.skin = `tropical_${this.shape}_${this.pattern}_${this.baseColor}_${this.patternColor}`; }
  override drops() { return [stack(itemId('tropical_fish') || I2.COD), ...(rng.int(20) === 0 ? [stack(itemId('bone_meal'))] : [])]; }
  override bucketData() { return { ...super.bucketData(), shape: this.shape, pattern: this.pattern, baseColor: this.baseColor, patternColor: this.patternColor }; }
  override fromBucketData(d: Record<string, unknown>) { super.fromBucketData(d); this.shape = (d.shape as number) ?? 0; this.pattern = (d.pattern as number) ?? 0; this.baseColor = (d.baseColor as number) ?? 0; this.patternColor = (d.patternColor as number) ?? 0; }
  override extraJSON() { return { ...super.extraJSON(), shape: this.shape, pattern: this.pattern, baseColor: this.baseColor, patternColor: this.patternColor }; }
  override loadExtra(d: Record<string, unknown>) { super.loadExtra(d); this.fromBucketData({ ...d, health: this.health }); this.fromBucket = !!d.fromBucket; }
}
/** Fish buckets: emptying one pours water and lets the fish out. Returns true if it was a fish bucket. */
export const FISH_BUCKETS: Record<number, string> = {
  [I7.COD_BUCKET]: 'cod', [I7.SALMON_BUCKET]: 'salmon', [I7.PUFFERFISH_BUCKET]: 'pufferfish', [I7.TROPICAL_FISH_BUCKET]: 'tropical_fish',
};
export function releaseFish(game: Game, held: ItemStack, x: number, y: number, z: number) {
  const kind = FISH_BUCKETS[held.id];
  if (!kind) return;
  const f = game.interact!.spawnMob(kind, x + 0.5, y + 0.2, z + 0.5) as Fish | null;
  if (f) f.fromBucketData((held as ItemStack & { fish?: Record<string, unknown> }).fish ?? {});
}

// ------------------------------------------------------------------ the wandering trader
/** Wandering traders: turn up near players with two llamas, sell rare blocks and plants, and leave after a while. */
export class WanderingTrader extends Villager {
  override typeName = 'Wandering Trader';
  override skin = 'wandering_trader';
  override model = 'villager';
  /** Ticks left before it disappears (vanilla 48000, or 24000 when it came by itself). */
  leaveIn = 48000;
  /** Drinking: invisibility at night, milk in the morning (ticks left). */
  drinking = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.profession = '';
  }
  override tick() {
    super.tick();
    if (this.dead || this.noAi) return;
    if (--this.leaveIn <= 0) { this.removed = true; return; }
    const night = !this.game.isDaytime();
    if (this.drinking > 0) {
      if (--this.drinking === 0) { if (night) this.addEffect('invisibility', 1200, 0); else this.removeEffect('invisibility'); this.heldItem = 0; }
    } else if (night && !this.effects.has('invisibility') && rng.int(300) === 0) { this.drinking = 40; this.heldItem = itemId('potion_invisibility'); }
    else if (!night && this.effects.has('invisibility')) { this.drinking = 40; this.heldItem = I.MILK_BUCKET; }
  }
  override ensureTrades(): Trade[] {
    if (this.trades) return this.trades;
    const r = new Random((this.id * 7919) ^ 0x7a1d);
    const E = I.EMERALD;
    const t = (cost: number, result: number, n = 1, max = 8): Trade => ({ cost: [E, cost], result: [result, n], uses: 0, max });
    // vanilla's list: saplings, flowers, sea plants, odd blocks, dyes (by name, so a missing one is just skipped)
    const plants = ['oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling', 'fern', 'sugar_cane', 'cactus', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'pumpkin_seeds', 'melon_seeds', 'beetroot_seeds', 'sea_pickle', 'kelp', 'vine', 'brown_mushroom', 'red_mushroom', 'lily_pad', 'sand', 'red_sand', 'pumpkin', 'nautilus_shell', 'slime_ball', 'glowstone', 'brain_coral_block', 'bubble_coral_block', 'fire_coral_block', 'horn_coral_block', 'tube_coral_block']
      .map((n) => itemId(n)).concat(DYES.slice(0, 8)).filter(Boolean) as number[];
    const pick = () => plants.splice(r.int(plants.length), 1)[0];
    const out: Trade[] = [];
    for (let i = 0; i < 5; i++) out.push(t(1 + r.int(3), pick(), 1 + r.int(3)));
    out.push(t(5, itemId('blue_ice') || B2.BLUE_ICE, 1, 6), t(3, itemId('gunpowder') || I.GUNPOWDER, 1, 8), t(6, itemId('podzol') || B.PODZOL, 3, 6));
    this.trades = out;
    return out;
  }
  override despawnCheck() {}
  override extraJSON() { return { ...super.extraJSON(), leaveIn: this.leaveIn }; }
  override loadExtra(d: Record<string, unknown>) { super.loadExtra(d); this.leaveIn = (d.leaveIn as number) ?? 48000; this.profession = ''; }
}

/** Every day or so, a wandering trader may turn up near a player with two trader llamas (vanilla odds grow 2.5% a try). */
let traderChance = 0.025;
export function spawnWanderingTrader(game: Game, r: { next(): number; int(n: number): number }) {
  if (game.entities.some((e) => e instanceof WanderingTrader)) return;
  if (r.next() > traderChance) { traderChance = Math.min(0.075, traderChance + 0.025); return; }
  traderChance = 0.025;
  const ps = game.playerEntities();
  if (!ps.length) return;
  const p = ps[r.int(ps.length)];
  const w = game.world!;
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(p.x) + r.int(97) - 48, z = Math.floor(p.z) + r.int(97) - 48;
    if (!w.chunkAt(x, z)) continue;
    const y = w.topSolidY(x, z) + 1;
    if (y <= 1 || BLOCKS[w.getId(x, y - 1, z)].fluid) continue;
    const t = game.interact!.spawnMob('wandering_trader', x + 0.5, y, z + 0.5) as WanderingTrader | null;
    if (!t) return;
    for (let k = 0; k < 2; k++) {
      const l = game.interact!.spawnMob('trader_llama', x + 0.5 + (k ? 2 : -2), y, z + 0.5) as Llama | null;
      if (l) { l.tame = true; l.trader = true; }
    }
    return;
  }
}

/** The animals each biome adds (checked by the spawner when populating chunks). */
export function pickVariant(m: Mob) {
  if (m instanceof Rabbit) m.pickVariant();
  else if (m instanceof Fox) m.pickVariant();
  else if (m instanceof Mooshroom) m.variant = rng.int(20) === 0 ? 'brown' : 'red';
}
void Chicken; void isLeaves; void TOOLS; void (0 as unknown as DamageSource);
