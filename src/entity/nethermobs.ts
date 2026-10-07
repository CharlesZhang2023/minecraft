// The Nether update's mobs: piglins (gold armour keeps them calm; they admire gold, barter for ingots, guard chests
// and gold, fear soul fire and the zombified, hunt hoglins, and turn zombified in the overworld), piglin brutes,
// hoglins and zoglins, striders (lava walkers you can saddle and steer), and the magma cubes and wither skeletons
// the Nether always needed.
import { GoalMob, Goal, swim, wander, lookAtPlayer, panic, avoidEntity, avoidBlock, tempt, breed, followParent, meleeAttack, rangedAttack, shootArrow, nearestTarget, aiRng } from './ai';
import { Slime, ZombiePigman } from './mobs';
import { LivingEntity, DamageSource } from './living';
import type { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { Player } from '../game/player';
import { ItemEntity } from './item';
import { B, B2, WOOD, idOf } from '../world/blocks';
import { I, I3, I5, I7, ItemStack, stack, getItem, TOOLS, ARMOR } from '../game/items';
import { itemIs, blockIs } from '../game/tags';
import { rollLoot } from '../game/loot';
import { carryRider, dismountSpot, type Mount } from './mount';

const rng = aiRng;
const tn = (e: Entity) => (e as unknown as { typeName?: string }).typeName ?? '';
const ARMOR_GOLD = ['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots'];

/** Does the player wear a piece of gold armour (piglins then leave them be)? */
export function wearsGold(p: Player): boolean {
  return p.inventory.armor.some((a) => !!a && itemIs('piglin_safe_armor', a.id));
}

// ------------------------------------------------------------------ piglins
export class Piglin extends GoalMob {
  kind = 'piglin';
  typeName = 'Piglin';
  override model = 'piglin';
  override skin = 'piglin';
  override sayName = 'piglin.say';
  override hurtName = 'piglin.hurt';
  override deathName = 'piglin.death';
  override hostile = true;
  override speedAttr = 0.35;
  override holding = true;
  override retaliates = true;
  /** Gold armour and gear it wears: helmet, chest, legs, boots. */
  armorItems: (ItemStack | null)[] = [null, null, null, null];
  /** Crossbow piglins shoot; the others carry a golden sword. */
  crossbow = false;
  /** The gold item it's admiring (in its offhand), and for how long still. */
  admiring: ItemStack | null = null;
  admireTicks = 0;
  /** Loved things it picked up and keeps. */
  pocket: ItemStack[] = [];
  /** Ticks spent outside the Nether (zombifies at 300). */
  conversion = 0;
  bastion = false;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 16;
    this.attackDamage = 5;
    this.crossbow = rng.int(2) === 0;
    this.heldItem = this.crossbow ? I7.CROSSBOW : TOOLS.golden_sword;
    ARMOR_GOLD.forEach((n, i) => { if (rng.next() < 0.1) this.armorItems[i] = stack(ARMOR[n]); });
    const me = this;
    this.goals.push(
      swim(0),
      avoidBlock(1, (id) => blockIs('piglin_repellents', id), 6, 0.12),
      avoidEntity(2, (_m, e) => e instanceof ZombiePigman || tn(e) === 'Zoglin', 6, 0.12),
      admireGoal(3),
      pickupGoldGoal(4),
      this.crossbow ? rangedAttack(5, 0.08, 40, 14, (m, t) => shootArrow(m, t, 1.6, 2)) : meleeAttack(5, 0.1),
      wander(8, 0.06), lookAtPlayer(9, 8),
    );
    this.targetGoals.push(
      nearestTarget(1, (m, e) => e instanceof Player && !wearsGold(e) && !me.baby && me.admireTicks === 0, 16),
      nearestTarget(2, (m, e) => tn(e) === 'Hoglin' && !(e as GoalMob).baby && rng.int(3) === 0 && countKind(m, 'piglin', 16) >= 2, 16),
    );
  }
  override eyeHeight() { return this.baby ? 0.9 : 1.74; }
  get armsPose() { return this.crossbow && this.target ? 'bow' : this.admireTicks > 0 ? 'admire' : undefined; }
  override tick() {
    super.tick();
    if (this.dead) return;
    // in the overworld (or the End) a piglin turns zombified after 15 seconds
    if (this.world.dimension !== 'nether' && !this.noAi) {
      if (++this.conversion > 300) { zombify(this); return; }
      if (this.conversion % 20 === 0) this.game.particles?.smoke(this.x, this.y + 1.5, this.z);
    } else this.conversion = 0;
    if (this.admireTicks > 0 && --this.admireTicks === 0) this.finishAdmiring();
  }
  /** Done looking at gold: an ingot is bartered for loot, anything else it keeps (babies keep it all). */
  finishAdmiring() {
    const s = this.admiring;
    this.admiring = null;
    if (!s) return;
    if (s.id === I.GOLD_INGOT && !this.baby) {
      for (const out of rollLoot('piglin_bartering', rng)) this.throwItem(out);
      this.game.audio.play('piglin.say', this, 1, 1.2);
    } else this.pocket.push(s);
  }
  throwItem(s: ItemStack) {
    const yaw = (this.headYaw * Math.PI) / 180;
    const e = new ItemEntity(this.world, this.game, s);
    e.setPos(this.x - Math.sin(yaw) * 0.5, this.y + 1.2, this.z + Math.cos(yaw) * 0.5);
    e.vx = -Math.sin(yaw) * 0.2; e.vz = Math.cos(yaw) * 0.2; e.vy = 0.15;
    e.pickupDelay = 40;
    this.game.addEntity(e);
  }
  /** Start admiring a loved item (handed over or picked up). */
  admire(s: ItemStack) {
    if (this.admiring) this.finishAdmiring();
    this.admiring = { ...s, count: 1 };
    this.admireTicks = 120 + rng.int(40);
    this.target = null;
    this.path = null;
    this.game.audio.play('piglin.admire', this, 1, 1);
  }
  /** Right-click with a gold ingot (or other loved item): it takes it and admires it. */
  override interact(game: Game, held: ItemStack | null): boolean {
    if (!held || !itemIs('piglin_loved', held.id) || this.admireTicks > 0) return false;
    this.admire(held);
    game.interact!.consume(1);
    return true;
  }
  override useLabel(_p: Player, held: ItemStack | null): string | null { return held && itemIs('piglin_loved', held.id) && this.admireTicks === 0 ? 'Give' : null; }
  override onDamaged(attacker: Entity | null) {
    super.onDamaged(attacker);
    const who = (attacker as unknown as { shooter?: Entity })?.shooter ?? attacker;
    if (who instanceof Player) angerPiglins(this.game, who, this.x, this.y, this.z, 16);
    this.admireTicks = 0;
    if (this.admiring) { this.throwItem(this.admiring); this.admiring = null; }
  }
  override drops(): ItemStack[] {
    const out: ItemStack[] = [];
    if (rng.next() < 0.085) out.push(stack(this.heldItem, 1));
    for (const a of this.armorItems) if (a && rng.next() < 0.085) out.push({ ...a });
    out.push(...this.pocket);
    if (this.admiring) out.push(this.admiring);
    return out;
  }
  override despawnCheck() { if (!this.bastion) super.despawnCheck(); }
  override extraJSON() { return { crossbow: this.crossbow, armorItems: this.armorItems, pocket: this.pocket, bastion: this.bastion, conversion: this.conversion }; }
  override loadExtra(d: Record<string, unknown>) {
    this.crossbow = !!d.crossbow;
    this.heldItem = this.crossbow ? I7.CROSSBOW : TOOLS.golden_sword;
    if (Array.isArray(d.armorItems)) this.armorItems = d.armorItems as (ItemStack | null)[];
    if (Array.isArray(d.pocket)) this.pocket = d.pocket as ItemStack[];
    this.bastion = !!d.bastion;
    this.conversion = (d.conversion as number) ?? 0;
  }
}
const countKind = (m: GoalMob, kind: string, r: number) => m.game.entities.filter((e) => (e as GoalMob).kind === kind && !(e as GoalMob).dead && e.distanceTo(m) < r).length;

/** Stand still and look at the gold it holds. */
const admireGoal = (priority: number): Goal => ({
  priority, controls: ['move', 'look'],
  canStart: (m) => (m as Piglin).admireTicks > 0,
  tick: (m) => { m.path = null; m.lookTarget = { x: m.x - Math.sin((m.bodyYaw * Math.PI) / 180), y: m.y + 1.1, z: m.z + Math.cos((m.bodyYaw * Math.PI) / 180) }; },
});
/** Walk to gold lying about and pick it up (then admire it). */
const pickupGoldGoal = (priority: number): Goal => {
  let item: ItemEntity | null = null;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      const p = m as Piglin;
      if (p.admireTicks > 0 || p.target || rng.int(10)) return false;
      item = (m.game.entities.find((e) => e instanceof ItemEntity && !e.removed && e.pickupDelay <= 0 && itemIs('piglin_loved', e.item.id) && e.distanceTo(m) < 9) as ItemEntity | undefined) ?? null;
      return !!item;
    },
    canContinue: (m) => !!item && !item.removed && (m as Piglin).admireTicks === 0,
    tick: (m) => {
      if (!item) return;
      if (m.distanceTo(item) < 1.5) {
        const s = { ...item.item, count: 1 };
        if (--item.item.count <= 0) item.removed = true;
        (m as Piglin).admire(s);
        m.game.audio.play('pop', m, 0.2, 1.5);
        item = null;
        return;
      }
      if (--m.pathTimer <= 0 || !m.path) { m.pathTimer = 15; m.setPathTo(item.x, item.y, item.z, 0.1); }
    },
    stop: (m) => { item = null; m.path = null; },
  };
};

/** A player opened a guarded container or broke guarded gold near piglins: they all go for them. */
export function angerPiglins(g: Game, who: Player, x: number, y: number, z: number, radius = 16) {
  if (who.creative || who.spectator) return;
  for (const e of g.entities)
    if ((e instanceof Piglin || e instanceof PiglinBrute) && !e.dead && Math.abs(e.x - x) < radius && Math.abs(e.y - y) < radius && Math.abs(e.z - z) < radius) {
      e.target = who;
      e.angerTicks = 600;
      if (e instanceof Piglin) e.admireTicks = 0;
    }
}

/** A piglin, brute or hoglin outside the Nether too long becomes zombified. */
export function zombify(m: GoalMob) {
  const into = m instanceof Hoglin ? 'zoglin' : 'zombie_pigman';
  const z = m.game.interact!.spawnMob(into, m.x, m.y, m.z, true) as LivingEntity | null;
  if (z) {
    z.yaw = m.yaw;
    (z as unknown as { baby: boolean }).baby = m.baby;
    if (m instanceof Piglin || m instanceof PiglinBrute) (z as unknown as { heldItem: number }).heldItem = m.heldItem;
    z.addEffect('nausea', 200, 0);
  }
  m.game.audio.play('zombie.say', m, 1, 0.8);
  m.removed = true;
}

export class PiglinBrute extends GoalMob {
  kind = 'piglin_brute';
  typeName = 'Piglin Brute';
  override model = 'piglin';
  override skin = 'piglin_brute';
  override sayName = 'piglin_brute.say';
  override hurtName = 'piglin_brute.hurt';
  override deathName = 'piglin_brute.death';
  override hostile = true;
  override speedAttr = 0.35;
  override holding = true;
  override retaliates = true;
  override persist = true;
  armorItems: (ItemStack | null)[] = [null, null, null, null];
  conversion = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 50;
    this.attackDamage = 7;
    this.heldItem = TOOLS.golden_axe;
    this.goals.push(swim(0), meleeAttack(2, 0.12), wander(8, 0.06), lookAtPlayer(9, 8));
    // brutes don't care about gold armour or soul fire: they guard the bastion
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Player || tn(e) === 'Wither Skeleton', 16));
  }
  override eyeHeight() { return 1.74; }
  override tick() {
    super.tick();
    if (this.dead) return;
    if (this.world.dimension !== 'nether' && !this.noAi) { if (++this.conversion > 300) zombify(this); }
    else this.conversion = 0;
  }
  override despawnCheck() {}
  override drops(): ItemStack[] { return rng.next() < 0.085 ? [stack(TOOLS.golden_axe)] : []; }
}

// ------------------------------------------------------------------ hoglins and zoglins
export class Hoglin extends GoalMob {
  kind = 'hoglin';
  typeName = 'Hoglin';
  override model = 'hoglin';
  override skin = 'hoglin';
  override sayName = 'hoglin.say';
  override hurtName = 'hoglin.hurt';
  override deathName = 'hoglin.death';
  override hostile = true;
  override speedAttr = 0.3;
  override retaliates = true;
  conversion = 0;
  override food = [WOOD.crimson.sapling];
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.3965; this.height = 1.4;
    this.maxHealth = this.health = 40;
    this.attackDamage = 6;
    this.stepHeight = 1;
    this.goals.push(
      swim(0),
      avoidBlock(1, (id) => blockIs('hoglin_repellents', id), 7, 0.1),
      meleeAttack(3, 0.1),
      breed(4, 0.06), tempt(5, 0.08), followParent(6, 0.08),
      wander(8, 0.05), lookAtPlayer(9, 8),
    );
    this.targetGoals.push(nearestTarget(1, (m, e) => !m.baby && e instanceof Player, 16));
  }
  override eyeHeight() { return 1.0; }
  /** Hoglins toss what they hit into the air. */
  override onMeleeHit(t: LivingEntity) {
    const dx = t.x - this.x, dz = t.z - this.z, l = Math.hypot(dx, dz) || 1;
    t.vx += (dx / l) * 0.5; t.vz += (dz / l) * 0.5; t.vy += 0.5 + rng.next() * 0.2;
  }
  override tick() {
    super.tick();
    if (this.dead) return;
    if (this.world.dimension !== 'nether' && !this.noAi) { if (++this.conversion > 300) zombify(this); }
    else this.conversion = 0;
  }
  override drops(burning: boolean): ItemStack[] {
    return [stack(burning ? I.COOKED_PORKCHOP : I.PORKCHOP, 2 + rng.int(3)), stack(I.LEATHER, rng.int(2))].filter((s) => s.count > 0);
  }
  override despawnCheck() {}
}

export class Zoglin extends GoalMob {
  kind = 'zoglin';
  typeName = 'Zoglin';
  override model = 'hoglin';
  override skin = 'zoglin';
  override sayName = 'zoglin.say';
  override hurtName = 'zoglin.hurt';
  override deathName = 'zoglin.death';
  override hostile = true;
  override undead = true;
  override speedAttr = 0.25;
  override retaliates = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.3965; this.height = 1.4;
    this.maxHealth = this.health = 40;
    this.attackDamage = 6;
    this.stepHeight = 1;
    this.goals.push(swim(0), meleeAttack(2, 0.1), wander(8, 0.05));
    // a zoglin attacks nearly anything alive: players and mobs alike (not creepers or other zoglins)
    this.targetGoals.push(nearestTarget(1, (_m, e) => tn(e) !== 'Zoglin' && tn(e) !== 'Creeper' && tn(e) !== 'Ghast', 16));
  }
  override eyeHeight() { return 1.0; }
  override onMeleeHit(t: LivingEntity) {
    const dx = t.x - this.x, dz = t.z - this.z, l = Math.hypot(dx, dz) || 1;
    t.vx += (dx / l) * 0.5; t.vz += (dz / l) * 0.5; t.vy += 0.5;
  }
  override drops(): ItemStack[] { return [stack(I.ROTTEN_FLESH, 1 + rng.int(3))]; }
}

// ------------------------------------------------------------------ striders
export class Strider extends GoalMob implements Mount {
  kind = 'strider';
  typeName = 'Strider';
  override model = 'strider';
  override skin = 'strider';
  override sayName = 'strider.say';
  override hurtName = 'strider.hurt';
  override deathName = 'strider.death';
  override fireImmune = true;
  override speedAttr = 0.175;
  override food = [WOOD.warped.sapling];
  saddled = false;
  /** Out of lava it shivers, turns purple and slows down. */
  cold = false;
  rider: Player | null = null;
  boost = 0;
  bodyFollows = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 1.7;
    this.maxHealth = this.health = 20;
    this.fleesWhenHurt = true;
    this.goals.push(panic(1, 0.1), breed(3, 0.08), tempt(4, 0.1), followParent(5, 0.09), lavaWander(7), lookAtPlayer(9, 8));
  }
  override eyeHeight() { return 1.5; }
  override standsOn = B.LAVA;
  override tick() {
    // lava is a floor to a strider (Entity.collisions); sunk in it, it bobs back up
    const below = this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z));
    const at = this.world.getId(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
    if (at === B.LAVA) this.vy = Math.max(this.vy, 0.1);
    if (below === B.LAVA) this.fallDistance = 0;
    this.cold = at !== B.LAVA && below !== B.LAVA;
    const r = this.rider;
    if (r && (r.dead || r.removed || r.riding !== this)) this.rider = null;
    super.tick();
    if (this.boost > 0) this.boost--;
    if (this.dead) { if (this.rider) this.dismount(); return; }
    if (this.rider) { this.bodyYaw = this.headYaw = this.yaw; carryRider(this, this.rider, this.height - 0.2); }
  }
  mountBy(p: Player) {
    if (this.rider || p.riding) return;
    this.rider = p;
    p.riding = this;
    p.sprinting = false;
    this.path = null;
    carryRider(this, p, this.height - 0.2);
  }
  dismount() {
    const r = this.rider;
    if (!r) return;
    r.riding = null;
    this.rider = null;
    const [x, y, z] = dismountSpot(this, r);
    r.setPos(x, y, z);
  }
  override groundSpeed() {
    const ridden = !!this.rider;
    const base = ridden ? 0.1 * (this.boost > 0 ? 1.8 : 1) : this.aiSpeed;
    return base * (this.cold ? 0.66 : 1);
  }
  override ai() {
    const rider = this.rider;
    if (rider) {
      // steered with a warped fungus on a stick: it walks where the rider looks
      const held = rider.inventory.held();
      if (held?.id === I7.WARPED_FUNGUS_ON_A_STICK) {
        this.yaw = this.bodyYaw = rider.yaw;
        this.forward = 1;
        this.aiSpeed = 0.1;
        return;
      }
    }
    super.ai();
  }
  /** Saddle it, ride it, or (with the stick) boost it. */
  override interact(game: Game, held: ItemStack | null): boolean {
    const p = game.interact!.hands().player;
    if (held?.id === I5.SADDLE && !this.saddled && !this.baby) { this.saddled = true; game.interact!.consume(1); game.audio.play('horse.saddle', this, 0.5, 1); return true; }
    if (held?.id === I7.WARPED_FUNGUS_ON_A_STICK && this.rider === p) {
      this.boost = 140;
      game.interact!.hands().damageHeld(7);
      return true;
    }
    if (super.interact(game, held)) return true;
    if (this.saddled && !this.baby && !this.rider && !p.sneaking && !p.riding) { this.mountBy(p); return true; }
    return false;
  }
  override useLabel(p: Player, held: ItemStack | null): string | null {
    if (held?.id === I5.SADDLE && !this.saddled && !this.baby) return 'Saddle';
    if (this.saddled && !this.rider) return 'Ride';
    return super.useLabel(p, held);
  }
  override drops(): ItemStack[] { const out = [stack(I.STRING, 2 + rng.int(4))]; if (this.saddled) out.push(stack(I5.SADDLE)); return out; }
  override extraJSON() { return { saddled: this.saddled }; }
  override loadExtra(d: Record<string, unknown>) { this.saddled = !!d.saddled; }
}
/** Striders like to keep to the lava. */
const lavaWander = (priority: number): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => !m.path && rng.int(100) === 0,
  canContinue: (m) => !!m.path,
  start: (m) => {
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(m.x + rng.int(17) - 8), z = Math.floor(m.z + rng.int(17) - 8);
      let y = Math.floor(m.y) + 2;
      while (y > m.y - 4 && m.world.getId(x, y, z) === 0) y--;
      if (m.world.getId(x, y, z) === B.LAVA || i > 8) { m.setPathTo(x, y + 1, z, 0.06); return; }
    }
  },
  stop: (m) => { m.path = null; },
});

// ------------------------------------------------------------------ magma cubes and wither skeletons
export class MagmaCube extends Slime {
  override hurtName = 'magma_cube.squish';
  override deathName = 'magma_cube.squish';
  override typeName = 'Magma Cube';
  override model = 'slime';
  override skin = 'magma_cube';
  override fireImmune = true;
  override die(source: DamageSource, attacker: Entity | null) {
    // (Slime.die would split into slimes: do the splitting here instead)
    const size = this.size;
    this.size = 1;
    super.die(source, attacker);
    this.size = size;
    if (size > 1) {
      const n = 2 + rng.int(3);
      for (let i = 0; i < n; i++) {
        const c = new MagmaCube(this.world, this.game);
        c.setSize(size / 2);
        c.setPos(this.x + ((i % 2) - 0.5) * size / 4, this.y + 0.5, this.z + (((i / 2) | 0) - 0.5) * size / 4);
        this.game.addEntity(c);
      }
    }
  }
  override setSize(s: number) { super.setSize(s); this.armor = s * 3; }
  override drops(): ItemStack[] { return this.size > 1 && rng.int(4) === 0 ? [stack(I3.MAGMA_CREAM)] : []; }
}

export class WitherSkeleton extends GoalMob {
  kind = 'wither_skeleton';
  typeName = 'Wither Skeleton';
  override model = 'bipedThin';
  override skin = 'wither_skeleton';
  override sayName = 'wither_skeleton.say';
  override hurtName = 'wither_skeleton.hurt';
  override deathName = 'wither_skeleton.death';
  override hostile = true;
  override undead = true;
  override fireImmune = true;
  override canBreathe = true;
  override speedAttr = 0.25;
  override holding = true;
  override retaliates = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.7; this.height = 2.4;
    this.renderScale = 1.2;
    this.maxHealth = this.health = 20;
    this.attackDamage = 8;
    this.heldItem = TOOLS.stone_sword;
    this.goals.push(swim(0), meleeAttack(2, 0.1), wander(8, 0.05), lookAtPlayer(9, 8));
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Player || tn(e) === 'Piglin', 16));
  }
  override eyeHeight() { return 2.1; }
  override onMeleeHit(t: LivingEntity) { t.addEffect('wither', 200, 0); }
  override drops(): ItemStack[] {
    const out = [stack(I.COAL, rng.int(2)), stack(I.BONE, rng.int(3))].filter((s) => s.count > 0);
    if (rng.next() < 0.025) out.push(stack(B2.WITHER_SKELETON_SKULL));
    return out;
  }
}
void getItem; void idOf;
