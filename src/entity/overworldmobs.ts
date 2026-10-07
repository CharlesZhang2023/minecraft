// The overworld's hostile and guardian mobs added between 1.4 and 1.16: husks, drowned, strays, zombie villagers
// (and curing them), cave spiders, witches, the illagers (pillagers, vindicators, evokers with their fangs and vexes,
// ravagers), guardians and elder guardians, phantoms, and the iron and snow golems players build.
import { GoalMob, Goal, swim, wander, lookAtPlayer, meleeAttack, rangedAttack, shootArrow, nearestTarget, avoidEntity, aiRng } from './ai';
import { Mob, Monster, Zombie, Skeleton, Spider, Villager, Squid, convertMob } from './mobs';
import { Entity } from './entity';
import { LivingEntity, DamageSource } from './living';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { Player } from '../game/player';
import { Snowball } from './item';
import { ThrownPotion } from './potion';
import { B, B2, BLOCKS, OPAQUE, idOf, isLeaves, pack } from '../world/blocks';
import { BIOMES } from '../world/biomes';
import { I, I2, I7, ItemStack, stack, itemId, TOOLS, SPLASH_ITEMS, POTION_ITEMS, getItem } from '../game/items';
import { POTION_BY_KEY } from '../game/potiondata';

const rng = aiRng;
const tn = (e: Entity | null | undefined) => (e as unknown as { typeName?: string } | null)?.typeName ?? '';
const diff = (g: Game) => g.options.difficulty;

// ------------------------------------------------------------------ zombie kin
/** Husks: desert zombies that don't burn and leave you hungry. */
export class Husk extends Zombie {
  override typeName = 'Husk';
  override skin = 'husk';
  override burnsInDay = false;
  override drownsInto = 'zombie';
  override soundPitch = 0.8;
  override onAttack(t: LivingEntity) { t.addEffect('hunger', 140 * Math.max(1, diff(this.game)), 0); }
}

/** Drowned: zombies of the deep, swimming after their prey; some carry tridents or nautilus shells. */
export class Drowned extends Zombie {
  override typeName = 'Drowned';
  override skin = 'drowned';
  override drownsInto = null;
  override canBreathe = true;
  override soundPitch = 0.9;
  /** Off-hand nautilus shell (dropped on death). */
  shell = false;
  constructor(world: World, game: Game) {
    super(world, game);
    const k = rng.next();
    if (k < 0.0625) { this.heldItem = I7.TRIDENT; this.holding = true; }
    else if (k < 0.1) { this.heldItem = I2.FISHING_ROD; this.holding = true; }
    if (rng.next() < 0.03) this.shell = true;
  }
  override ai() {
    // they hunt players in the water (or anyone, at night)
    if (this.target && !this.target.inWater && this.game.isDaytime() && !this.target.dead && this.distanceTo(this.target) > 4) this.target = null;
    super.ai();
  }
  override travel(strafe: number, forward: number) {
    if (this.inWater && this.target && !this.noAi) {
      // swim straight at it
      const t = this.target, dx = t.x - this.x, dy = t.y + 0.4 - this.y, dz = t.z - this.z, l = Math.hypot(dx, dy, dz) || 1;
      this.vx += (dx / l) * 0.02; this.vy += (dy / l) * 0.03; this.vz += (dz / l) * 0.02;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.9; this.vy *= 0.9; this.vz *= 0.9;
      this.yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
      return;
    }
    super.travel(strafe, forward);
  }
  override drops(): ItemStack[] {
    const out = super.drops();
    if (this.heldItem === I7.TRIDENT && rng.next() < 0.085) out.push(stack(I7.TRIDENT));
    if (this.shell) out.push(stack(I7.NAUTILUS_SHELL));
    return out;
  }
  override extraJSON() { return { heldItem: this.heldItem, shell: this.shell }; }
  override loadExtra(d: Record<string, unknown>) { this.heldItem = (d.heldItem as number) ?? 0; this.holding = !!this.heldItem; this.shell = !!d.shell; }
}

/** Zombie villagers: a villager the zombies got. Weakness and a golden apple cure them, a few minutes later. */
export class ZombieVillager extends Zombie {
  override typeName = 'Zombie Villager';
  override model = 'illager';
  override skin = 'zombie_villager';
  profession = 'farmer';
  /** Ticks until cured (0 = not being cured). */
  curing = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    const profs = ['farmer', 'librarian', 'priest', 'smith', 'butcher'];
    this.profession = profs[rng.int(profs.length)];
  }
  override tick() {
    super.tick();
    if (this.dead || this.removed || this.curing <= 0) return;
    if (this.age % 10 === 0) this.game.particles?.spell(this.x + (rng.next() - 0.5) * 0.6, this.y + 1 + rng.next(), this.z + (rng.next() - 0.5) * 0.6, 0xd8b030);
    if (--this.curing === 0) {
      const v = convertMob(this, 'villager') as Villager | null;
      if (v) { v.profession = this.profession; v.trades = null; v.addEffect('nausea', 200, 0); this.game.audio.play('villager.trade', v, 1, 1); }
    }
  }
  /** A golden apple while it's weakened starts the cure. */
  interact(game: Game, held: ItemStack | null): boolean {
    if (!held || held.id !== I.GOLDEN_APPLE || !this.effects.has('weakness') || this.curing > 0) return false;
    this.curing = 3600 + rng.int(2400);
    this.removeEffect('weakness');
    this.addEffect('strength', this.curing, Math.min(diff(game) - 1, 1));
    game.interact!.consume(1);
    game.audio.play('zombie.say', this, 1, 0.6);
    return true;
  }
  useLabel(_p: Player, held: ItemStack | null): string | null { return held?.id === I.GOLDEN_APPLE && this.effects.has('weakness') && this.curing === 0 ? 'Cure' : null; }
  override despawnCheck() { if (this.curing <= 0) super.despawnCheck(); }
  override extraJSON() { return { profession: this.profession, curing: this.curing }; }
  override loadExtra(d: Record<string, unknown>) { this.profession = (d.profession as string) ?? 'farmer'; this.curing = (d.curing as number) ?? 0; }
}

/** Strays: snowy skeletons whose arrows slow. */
export class Stray extends Skeleton {
  override typeName = 'Stray';
  override skin = 'stray';
  override arrowEffect: [string, number, number] = ['slowness', 600, 0];
  override drops(): ItemStack[] {
    const out = super.drops();
    if (rng.int(2) === 0) out.push({ id: TIPPED_SLOWNESS(), count: 1 });
    return out;
  }
}
const TIPPED_SLOWNESS = () => itemId('tipped_arrow_slowness') || I.ARROW;

/** Cave spiders: small, fit through one-block gaps, poisonous; they live in mineshaft spawners. */
export class CaveSpider extends Spider {
  override typeName = 'Cave Spider';
  override skin = 'cave_spider';
  override renderScale = 0.7;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.7; this.height = 0.5;
    this.maxHealth = this.health = 12;
  }
  override eyeHeight() { return 0.45; }
  override onAttack(t: LivingEntity) {
    const d = diff(this.game);
    if (d >= 2) t.addEffect('poison', d === 2 ? 140 : 300, 0);
  }
}

// ------------------------------------------------------------------ witches
/** Witches: throw splash potions (harming, poison, slowness, weakness) and drink their own to stay alive. */
export class Witch extends GoalMob {
  kind = 'witch';
  typeName = 'Witch';
  override model = 'witch';
  override skin = 'witch';
  override hostile = true;
  override sayName = 'witch.idle';
  override hurtName = 'witch.hurt';
  override deathName = 'witch.hurt';
  override speedAttr = 0.25;
  override xp = 5;
  override retaliates = true;
  /** The potion it's drinking, and for how long still. */
  drinking = 0;
  private drinkKey = '';
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 26;
    this.goals.push(swim(0), rangedAttack(2, 0.06, 60, 10, (m, t) => (m as Witch).throwPotion(t)), wander(5, 0.05), lookAtPlayer(6, 8));
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Player, 16));
  }
  override eyeHeight() { return 1.62; }
  override tick() {
    super.tick();
    if (this.dead || this.noAi) return;
    if (this.drinking > 0) {
      if (--this.drinking === 0) {
        const p = POTION_ITEMS[this.drinkKey];
        if (p) for (const [id, dur, amp] of potionEffects(p)) dur <= 1 ? this.addEffect(id, 1, amp) : this.addEffect(id, dur, amp);
        this.heldItem = 0;
        this.holding = false;
      }
      return;
    }
    // drink: water breathing under water, fire resistance when burning, healing when hurt, swiftness to catch up
    let key = '';
    if (this.inWater && !this.effects.has('water_breathing') && this.air < 200) key = 'water_breathing';
    else if ((this.fireTicks > 0 || this.inLava) && !this.effects.has('fire_resistance')) key = 'fire_resistance';
    else if (this.health < this.maxHealth && rng.next() < 0.05) key = 'healing';
    else if (this.target && !this.effects.has('speed') && this.distanceTo(this.target) > 11 && rng.next() < 0.01) key = 'swiftness';
    if (key) {
      this.drinkKey = key;
      this.drinking = 32;
      this.heldItem = POTION_ITEMS[key];
      this.holding = true;
      this.game.audio.play('drink', this, 1, 0.8);
    }
  }
  throwPotion(t: LivingEntity) {
    if (this.drinking > 0) return;
    const d = this.distanceTo(t);
    const key = t.health <= 4 ? 'poison' : d >= 8 && !t.effects.has('slowness') ? 'slowness' : t.health >= 8 && !t.effects.has('poison') ? 'poison' : d <= 3 && !t.effects.has('weakness') && rng.next() < 0.25 ? 'weakness' : 'harming';
    const p = new ThrownPotion(this.world, this.game, this, { id: SPLASH_ITEMS[key], count: 1 });
    const ey = this.y + this.eyeHeight() - 0.1;
    p.setPos(this.x, ey, this.z);
    const dx = t.x + t.vx - this.x, dz = t.z + t.vz - this.z, dy = t.y + t.eyeHeight() - 1.1 - ey, h = Math.hypot(dx, dz);
    const l = Math.hypot(dx, dy + h * 0.2, dz) || 1;
    p.vx = (dx / l) * 0.75; p.vy = ((dy + h * 0.2) / l) * 0.75; p.vz = (dz / l) * 0.75;
    this.game.addEntity(p);
    this.swing();
    this.game.audio.play('witch.throw', this, 1, 0.8 + rng.next() * 0.4);
  }
  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    // witches shrug off most magic (vanilla: 85% less)
    if (source === 'magic' && attacker !== this) amount *= 0.15;
    return super.damage(amount, source, attacker);
  }
  override drops(): ItemStack[] {
    const out: ItemStack[] = [];
    const pool = [itemId('glass_bottle'), I.GLOWSTONE_DUST, I.GUNPOWDER, I.REDSTONE, I.SPIDER_EYE, I.SUGAR, I.STICK];
    for (let k = 1 + rng.int(3); k > 0; k--) out.push(stack(pool[rng.int(pool.length)], 1 + rng.int(3)));
    if (this.drinking > 0 && this.heldItem && rng.next() < 0.085) out.push(stack(this.heldItem));
    return out;
  }
  override extraJSON() { return { persistentHostile: this.persistentHostile }; }
  override loadExtra(d: Record<string, unknown>) { this.persistentHostile = !!d.persistentHostile; }
  override despawnCheck() { if (!this.persistentHostile) super.despawnCheck(); }
}
function potionEffects(itemIdN: number): [string, number, number][] {
  return (POTION_BY_KEY.get(getItem(itemIdN).potion ?? '')?.effects ?? []) as [string, number, number][];
}

// ------------------------------------------------------------------ illagers
/** Illagers: hostile to players, villagers, wandering traders and iron golems. Raiders and patrols belong to a raid or patrol. */
export abstract class Illager extends GoalMob {
  override model = 'illager';
  override hostile = true;
  override speedAttr = 0.35;
  override retaliates = true;
  override sayName = 'illager.idle';
  override hurtName = 'illager.hurt';
  override deathName = 'illager.death';
  /** Patrol or raid captain: carries the ominous banner, and gives Bad Omen when killed. */
  captain = false;
  patrol = false;
  /** The raid it belongs to (raid id, 0 = none) and the wave. */
  raid = 0;
  wave = 0;
  armsPose: string | undefined;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 24;
    this.targetGoals.push(
      nearestTarget(1, (_m, e) => e instanceof Player, 16),
      nearestTarget(2, (_m, e) => e instanceof Villager || tn(e) === 'Iron Golem' || tn(e) === 'Wandering Trader', 16),
    );
  }
  override eyeHeight() { return 1.62; }
  override die(source: DamageSource, attacker: Entity | null) {
    super.die(source, attacker);
    // killing a captain outside a raid: Bad Omen (and the banner drops)
    const who = attacker instanceof Player ? attacker : (attacker as unknown as { shooter?: Entity })?.shooter;
    if (this.captain && !this.raid && who instanceof Player) {
      const cur = who.effectAmp('bad_omen');
      who.addEffect('bad_omen', 120000, Math.min(4, cur + 1));
      this.game.dropItem(this.x, this.y + 0.5, this.z, stack(itemId('ominous_banner')));
    }
  }
  override despawnCheck() { if (!this.raid && !this.patrol && !this.persistentHostile) super.despawnCheck(); }
  override extraJSON() { return { captain: this.captain, patrol: this.patrol, raid: this.raid, wave: this.wave, persistentHostile: this.persistentHostile }; }
  override loadExtra(d: Record<string, unknown>) { this.captain = !!d.captain; this.patrol = !!d.patrol; this.raid = (d.raid as number) ?? 0; this.wave = (d.wave as number) ?? 0; this.persistentHostile = !!d.persistentHostile; }
}

export class Pillager extends Illager {
  kind = 'pillager';
  typeName = 'Pillager';
  override skin = 'pillager';
  override holding = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.heldItem = I7.CROSSBOW;
    this.goals.push(swim(0), rangedAttack(3, 0.09, 40, 12, (m, t) => shootArrow(m, t, 1.6, 3.5)), wander(8, 0.06), lookAtPlayer(9, 15));
  }
  override tick() { super.tick(); this.armsPose = this.target ? 'bow' : undefined; }
  override drops(): ItemStack[] { return rng.next() < 0.085 ? [stack(I7.CROSSBOW)] : []; }
}

export class Vindicator extends Illager {
  kind = 'vindicator';
  typeName = 'Vindicator';
  override skin = 'vindicator';
  constructor(world: World, game: Game) {
    super(world, game);
    this.heldItem = TOOLS.iron_axe;
    this.attackDamage = 9;
    this.goals.push(swim(0), meleeAttack(3, 0.11), wander(8, 0.06), lookAtPlayer(9, 8));
    // named "Johnny", it goes after everything
    this.targetGoals.push(nearestTarget(3, (m, e) => (m as unknown as { customName?: string }).customName === 'Johnny' && !(e instanceof Illager) && !(e instanceof Player), 16));
  }
  override tick() { super.tick(); this.holding = !!this.target; this.armsPose = undefined; }
  override drops(): ItemStack[] { const out = [stack(I.EMERALD, rng.int(2))].filter((s) => s.count > 0); if (rng.next() < 0.085) out.push(stack(TOOLS.iron_axe)); return out; }
}

/** Evokers: keep their distance and cast fangs, summon vexes, and turn blue sheep red. */
export class Evoker extends Illager {
  kind = 'evoker';
  typeName = 'Evoker';
  override skin = 'evoker';
  /** Ticks left of the current spell, and its colour (fangs purple-grey, vexes pale, wololo orange). */
  casting = 0;
  spellColor = 0;
  private fangsCd = 0;
  private vexCd = 100;
  private wololoCd = 140;
  constructor(world: World, game: Game) {
    super(world, game);
    this.goals.push(swim(0), avoidEntity(2, (_m, e) => e instanceof Player && !e.creative && !e.spectator, 8, 0.1), castGoal(3), wander(8, 0.05), lookAtPlayer(9, 8));
  }
  override tick() {
    super.tick();
    if (this.fangsCd > 0) this.fangsCd--;
    if (this.vexCd > 0) this.vexCd--;
    if (this.wololoCd > 0) this.wololoCd--;
    this.armsPose = this.casting > 0 ? 'cast' : undefined;
    if (this.casting > 0) {
      this.casting--;
      if (this.age % 2 === 0) for (const s of [-1, 1]) {
        const yaw = (this.bodyYaw * Math.PI) / 180;
        this.game.particles?.spell(this.x + Math.cos(yaw) * 0.6 * s, this.y + 1.8, this.z + Math.sin(yaw) * 0.6 * s, this.spellColor);
      }
    }
  }
  /** Pick and cast a spell (the casting goal's choice). */
  cast(): boolean {
    const t = this.target;
    const vexes = this.game.entities.filter((e) => e instanceof Vex && !e.dead && e.distanceTo(this) < 16).length;
    if (t && this.vexCd === 0 && vexes < 8) {
      this.vexCd = 340; this.casting = 40; this.spellColor = 0xb3b3cc;
      for (let i = 0; i < 3; i++) {
        const v = this.game.interact!.spawnMob('vex', this.x + rng.int(3) - 1, this.y + 1, this.z + rng.int(3) - 1) as Vex | null;
        if (v) { v.owner = this; v.target = t; v.life = 20 * (30 + rng.int(90)); }
      }
      this.game.audio.play('evoker.summon', this, 1, 1);
      return true;
    }
    if (t && this.fangsCd === 0 && this.distanceTo(t) < 16) {
      this.fangsCd = 100; this.casting = 40; this.spellColor = 0x664d59;
      castFangs(this, t);
      this.game.audio.play('evoker.fangs', this, 1, 1);
      return true;
    }
    if (!t && this.wololoCd === 0 && this.game.options.difficulty > 0) {
      const sheep = this.game.entities.find((e) => tn(e) === 'Sheep' && !(e as Mob).dead && e.distanceTo(this) < 16 && (e as unknown as { color?: number }).color === 11) as (Mob & { color: number; woolColor?: number[] }) | undefined;
      if (sheep) {
        this.wololoCd = 140; this.casting = 60; this.spellColor = 0xb3804d;
        sheep.color = 14;
        this.lookTarget = sheep;
        this.game.audio.play('evoker.wololo', this, 1, 1);
        return true;
      }
    }
    return false;
  }
  override drops(): ItemStack[] { return [stack(I7.TOTEM_OF_UNDYING), ...[stack(I.EMERALD, rng.int(2))].filter((s) => s.count > 0)]; }
}
const castGoal = (priority: number): Goal => ({
  priority, controls: ['look'],
  canStart: (m) => (m as Evoker).casting === 0 && aiRng.int(10) === 0 && (m as Evoker).cast(),
  canContinue: (m) => (m as Evoker).casting > 0,
  tick: (m) => { const t = m.target; if (t) m.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z }; },
});

/** A line of fangs toward the target, or two rings around the evoker when it's close. */
function castFangs(e: Evoker, t: LivingEntity) {
  const d = e.distanceTo(t);
  const yaw = Math.atan2(t.z - e.z, t.x - e.x);
  const lo = Math.min(t.y, e.y), hi = Math.max(t.y, e.y) + 1;
  const place = (x: number, z: number, delay: number, rot: number) => {
    // find the floor between the two heights
    for (let y = Math.floor(hi); y >= Math.floor(lo) - 1; y--) {
      if (OPAQUE[e.world.getId(Math.floor(x), y - 1, Math.floor(z))] && !BLOCKS[e.world.getId(Math.floor(x), y, Math.floor(z))].solid) {
        const f = new EvokerFangs(e.world, e.game);
        f.setPos(x, y, z);
        f.owner = e;
        f.warmup = delay;
        f.yaw = (rot * 180) / Math.PI;
        e.game.addEntity(f);
        return;
      }
    }
  };
  if (d < 3) {
    for (let i = 0; i < 5; i++) { const a = yaw + (i * Math.PI * 2) / 5; place(e.x + Math.cos(a) * 1.5, e.z + Math.sin(a) * 1.5, 0, a); }
    for (let i = 0; i < 8; i++) { const a = yaw + (i * Math.PI * 2) / 8 + (Math.PI * 2 / 5) * 0.5; place(e.x + Math.cos(a) * 2.5, e.z + Math.sin(a) * 2.5, 3, a); }
  } else {
    for (let i = 0; i < 16; i++) { const r = 1.25 * (i + 1); place(e.x + Math.cos(yaw) * r, e.z + Math.sin(yaw) * r, i, yaw); }
  }
}

/** Evoker fangs: rise out of the ground after a short delay and bite whatever stands there. */
export class EvokerFangs extends Entity {
  typeName = 'Evoker Fangs';
  persist = false;
  owner: Entity | null = null;
  warmup = 0;
  /** Ticks since they rose (0-22): the jaws open and snap. */
  life = 0;
  private bit = false;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 0.5; this.height = 0.8;
  }
  override tick() {
    if (--this.warmup >= 0) return;
    this.life++;
    if (this.life === 1) this.game.audio.play('evoker.fangs_bite', this, 1, 0.85 + Math.random() * 0.3);
    if (!this.bit && this.life >= 4) {
      this.bit = true;
      for (const e of this.game.entities) {
        if (!(e instanceof LivingEntity) || e.dead || e === this.owner || e instanceof Illager || e instanceof Vex) continue;
        if (Math.abs(e.x - this.x) < 0.25 + e.width && Math.abs(e.z - this.z) < 0.25 + e.width && e.y < this.y + 0.8 && e.y + e.height > this.y) e.damage(6, 'magic', this.owner ?? this);
      }
    }
    if (this.life > 22) this.removed = true;
  }
}

/** Vexes: small winged spirits that fly through walls and die after a while. */
export class Vex extends GoalMob {
  kind = 'vex';
  typeName = 'Vex';
  override model = 'biped';
  override skin = 'vex';
  override hostile = true;
  override renderScale = 0.4;
  override holding = true;
  override sayName = 'vex.idle';
  override hurtName = 'vex.hurt';
  override deathName = 'vex.death';
  override xp = 3;
  owner: Evoker | null = null;
  /** Ticks left to live (0 = forever: spawn eggs). */
  life = 0;
  charging = false;
  private dest: { x: number; y: number; z: number } | null = null;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.4; this.height = 0.8;
    this.maxHealth = this.health = 14;
    this.attackDamage = 9;
    this.heldItem = TOOLS.iron_sword;
    this.noClip = true;
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Player || e instanceof Villager, 16, false));
  }
  override gravity() { return 0; }
  override isFlying() { return true; }
  override eyeHeight() { return 0.6; }
  override ai() {
    super.ai();
    if (this.owner && this.owner.dead) this.owner = null;
    if (!this.target && this.owner?.target) this.target = this.owner.target;
    const t = this.target;
    if (t && !t.dead) {
      // charge in a straight line, ignoring walls
      this.charging = true;
      this.dest = { x: t.x, y: t.y + t.height * 0.5, z: t.z };
      this.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
      const dx = t.x - this.x, dz = t.z - this.z, dy = t.y - this.y;
      if (dx * dx + dz * dz < 1.2 && Math.abs(dy) < 1.5) this.meleeHit(t);
    } else {
      this.charging = false;
      if (!this.dest || rng.int(40) === 0 || Math.hypot(this.dest.x - this.x, this.dest.z - this.z) < 1) {
        const ax = this.owner?.x ?? this.x, ay = this.owner?.y ?? this.y, az = this.owner?.z ?? this.z;
        this.dest = { x: ax + rng.int(15) - 7, y: ay + rng.int(11) - 3, z: az + rng.int(15) - 7 };
      }
    }
  }
  override travel() {
    if (this.dest && !this.noAi) {
      const dx = this.dest.x - this.x, dy = this.dest.y - this.y, dz = this.dest.z - this.z, l = Math.hypot(dx, dy, dz) || 1;
      const sp = this.charging ? 0.06 : 0.025;
      this.vx += (dx / l) * sp; this.vy += (dy / l) * sp; this.vz += (dz / l) * sp;
      this.yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    }
    this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    this.setPos(this.x, this.y, this.z);
  }
  override tick() {
    super.tick();
    if (this.life > 0 && --this.life === 0) this.life = -1;
    if (this.life < 0 && this.age % 20 === 0) this.damage(1, 'generic');
  }
  override environment() { if (this.y < -64) this.damage(4, 'void'); }
  override despawnCheck() { if (!this.owner) super.despawnCheck(); }
}

/** Ravagers: the raid's battering ram. Trample crops and leaves, roar when stunned, carry an illager now and then. */
export class Ravager extends Illager {
  kind = 'ravager';
  typeName = 'Ravager';
  override model = 'ravager';
  override skin = 'ravager';
  override sayName = 'ravager.idle';
  override hurtName = 'ravager.hurt';
  override deathName = 'ravager.death';
  override xp = 20;
  /** Ticks of the bite animation and of the roar. */
  biteTicks = 0;
  roarTicks = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.95; this.height = 2.2;
    this.maxHealth = this.health = 100;
    this.attackDamage = 12;
    this.attackReach = 1;
    this.stepHeight = 1;
    this.goals.push(swim(0), meleeAttack(3, 0.12), wander(8, 0.05), lookAtPlayer(9, 6));
  }
  override eyeHeight() { return 2.1; }
  override onMeleeHit(t: LivingEntity) {
    this.biteTicks = 10;
    const dx = t.x - this.x, dz = t.z - this.z, l = Math.hypot(dx, dz) || 1;
    t.vx += (dx / l) * 1.2; t.vz += (dz / l) * 1.2; t.vy += 0.3;
  }
  override tick() {
    super.tick();
    if (this.biteTicks > 0) this.biteTicks--;
    if (this.dead || this.noAi) return;
    // pushes through leaves (and crops underfoot)
    if (this.collidedH && this.game.options.difficulty > 0) {
      const yaw = (this.yaw * Math.PI) / 180;
      const fx = Math.floor(this.x - Math.sin(yaw) * 1.5), fz = Math.floor(this.z + Math.cos(yaw) * 1.5);
      for (let dy = 0; dy < 3; dy++) {
        const id = this.world.getId(fx, Math.floor(this.y) + dy, fz);
        if (isLeaves(id) || id === B.WHEAT || id === B.CARROTS || id === B.POTATOES || id === B2.BEETROOTS) this.game.interact!.breakBlockNaturally(fx, Math.floor(this.y) + dy, fz, true);
      }
    }
    // a roar knocks everything back now and then when it's cornered
    if (this.roarTicks > 0) {
      if (--this.roarTicks === 10) {
        for (const e of this.game.entities) {
          if (!(e instanceof LivingEntity) || e === this || e instanceof Illager || e.dead || e.distanceTo(this) > 4) continue;
          e.damage(6, 'mob', this);
          const dx = e.x - this.x, dz = e.z - this.z, l = Math.hypot(dx, dz) || 1;
          e.vx += (dx / l) * 1.5; e.vz += (dz / l) * 1.5; e.vy += 0.4;
        }
        for (let i = 0; i < 20; i++) this.game.particles?.smoke(this.x + (rng.next() - 0.5) * 3, this.y + 1, this.z + (rng.next() - 0.5) * 3, true);
      }
    } else if (this.target && this.collidedH && rng.int(100) === 0) { this.roarTicks = 20; this.game.audio.play('ravager.roar', this, 1.5, 1); }
  }
  override drops(): ItemStack[] { return [stack(itemId('saddle'))]; }
}

// ------------------------------------------------------------------ guardians
/** Guardians: swim around monuments, fire a charging laser at players and squid, and prick melee attackers. */
export class Guardian extends Mob {
  typeName = 'Guardian';
  override model = 'guardian';
  override skin = 'guardian';
  override hostile = true;
  override canBreathe = true;
  override sayName = 'guardian.idle';
  override hurtName = 'guardian.hurt';
  override deathName = 'guardian.death';
  override xp = 10;
  elder = false;
  /** The laser: its target and how far charged (0-80 ticks). */
  beamTarget: LivingEntity | null = null;
  beam = 0;
  /** Spikes out (still) or in (swimming), 0..1; the tail's wave. */
  spikes = 1;
  tail = 0;
  private dest: { x: number; y: number; z: number } | null = null;
  private cooldown = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = this.height = 0.85;
    this.maxHealth = this.health = 30;
  }
  override gravity() { return this.inWater ? 0 : 0.08; }
  override eyeHeight() { return this.height * 0.5; }
  override ai() {
    if (this.cooldown > 0) this.cooldown--;
    // target: players (not creative) and squid in sight, in water or not
    const t = this.beamTarget;
    if (t && (t.dead || t.removed || this.distanceTo(t) > 16 || !this.canSee(t) || (t instanceof Player && (t.creative || t.spectator)))) { this.beamTarget = null; this.beam = 0; }
    if (!this.beamTarget && this.cooldown === 0 && rng.int(20) === 0) {
      let best: LivingEntity | null = null, bd = 16;
      for (const e of this.game.entities) {
        if (!(e instanceof LivingEntity) || e.dead || e === this) continue;
        if (!(e instanceof Player && !e.creative && !e.spectator) && !(e instanceof Squid)) continue;
        const d = this.distanceTo(e);
        if (d < bd && this.canSee(e)) { bd = d; best = e; }
      }
      if (best) { this.beamTarget = best; this.beam = 0; this.game.audio.play('guardian.attack', this, 1, 1); }
    }
    if (this.beamTarget) {
      // charging: it holds still and stares
      const t2 = this.beamTarget;
      this.lookTarget = { x: t2.x, y: t2.y + t2.eyeHeight(), z: t2.z };
      this.yaw = (Math.atan2(t2.z - this.z, t2.x - this.x) * 180) / Math.PI - 90;
      this.dest = null;
      if (++this.beam >= this.chargeTime()) {
        t2.damage(1 + (this.elder ? 2 : 0), 'magic', this);
        t2.damage(this.elder ? 8 : 6, 'mob', this);
        this.beamTarget = null;
        this.beam = 0;
        this.cooldown = 40;
      }
    } else if (!this.dest || rng.int(80) === 0 || Math.hypot(this.dest.x - this.x, this.dest.y - this.y, this.dest.z - this.z) < 1) {
      for (let i = 0; i < 6; i++) {
        const d = { x: this.x + rng.int(15) - 7, y: this.y + rng.int(7) - 3, z: this.z + rng.int(15) - 7 };
        if (this.world.getId(Math.floor(d.x), Math.floor(d.y), Math.floor(d.z)) === B.WATER) { this.dest = d; break; }
      }
    }
    // elders curse players nearby with mining fatigue
    if (this.elder && this.age % 1200 === 0) {
      for (const p of this.game.playerEntities()) {
        if (p.creative || p.spectator || this.distanceTo(p) > 50) continue;
        if (p.effectAmp('mining_fatigue') < 2 || (p.effects.get('mining_fatigue')?.dur ?? 0) < 1200) {
          p.addEffect('mining_fatigue', 6000, 2);
          this.game.audio.play('elder_guardian.curse', p, 1, 1);
          (p as unknown as { event?: (e: unknown[]) => void }).event?.(['elderCurse']);
        }
      }
    }
  }
  chargeTime() { return this.elder ? 60 : 80; }
  override travel() {
    this.updateFluidState();
    if (this.inWater) {
      const moving = !!this.dest;
      this.spikes += ((moving ? 0 : 1) - this.spikes) * 0.06;
      this.tail += moving ? 0.3 : 0.08;
      if (this.dest) {
        const dx = this.dest.x - this.x, dy = this.dest.y - this.y, dz = this.dest.z - this.z, l = Math.hypot(dx, dy, dz) || 1;
        const sp = this.elder ? 0.006 : 0.012;
        this.vx += (dx / l) * sp; this.vy += (dy / l) * sp; this.vz += (dz / l) * sp;
        if (!this.beamTarget) this.yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
      }
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.9; this.vy *= 0.9; this.vz *= 0.9;
    } else {
      // flopping on land
      this.vy -= 0.08;
      this.vx *= 0.9; this.vz *= 0.9;
      if (this.onGround && rng.int(15) === 0) { this.vy = 0.4; this.vx = (rng.next() - 0.5) * 0.4; this.vz = (rng.next() - 0.5) * 0.4; }
      this.move(this.vx, this.vy, this.vz);
      this.spikes += (0 - this.spikes) * 0.1;
    }
  }
  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    // spikes out: melee attackers get pricked back (thorns)
    if (source !== 'thorns' && source !== 'magic' && attacker instanceof LivingEntity && this.spikes > 0.5 && attacker.distanceTo(this) < 4 && !(attacker instanceof Guardian)) attacker.damage(this.elder ? 2 : 2, 'thorns', this);
    return super.damage(amount, source, attacker);
  }
  override environment() {
    if (!this.inWater && this.age % 20 === 0) this.damage(1, 'suffocate');
    if (this.y < -64) this.damage(4, 'void');
  }
  override drops(): ItemStack[] {
    const out = [stack(I7.PRISMARINE_SHARD, rng.int(3))].filter((s) => s.count > 0);
    const r = rng.next();
    if (r < 0.4) out.push(stack(I2.COD));
    else if (r < 0.8) out.push(stack(I7.PRISMARINE_CRYSTALS));
    if (this.elder) out.push(stack(B2.WET_SPONGE));
    return out;
  }
  override despawnCheck() { if (!this.elder) { const d = this.playerDistance(); if (d !== Infinity && d > 128) this.removed = true; } }
  override extraJSON() { return { elder: this.elder }; }
  override loadExtra(d: Record<string, unknown>) { if (d.elder) this.makeElder(); }
  makeElder() {
    this.elder = true;
    this.typeName = 'Elder Guardian';
    this.skin = 'elder_guardian';
    this.renderScale = 2.35;
    this.width = this.height = 1.9975;
    this.maxHealth = this.health = 80;
    this.xp = 10;
  }
}
export class ElderGuardian extends Guardian {
  constructor(world: World, game: Game) { super(world, game); this.makeElder(); }
  override toJSON() { return { ...super.toJSON(), type: 'elder_guardian' }; }
}

// ------------------------------------------------------------------ phantoms
/** Phantoms: come down on players who haven't slept for three nights, circling and swooping. They fear cats. */
export class Phantom extends Mob {
  typeName = 'Phantom';
  override model = 'phantom';
  override skin = 'phantom';
  override hostile = true;
  override undead = true;
  override burnsInDay = true;
  override sayName = 'phantom.idle';
  override hurtName = 'phantom.hurt';
  override deathName = 'phantom.death';
  /** Size 0-64 (spawned bigger in harder times): more health, more damage. */
  size = 0;
  /** The circle it flies around (centre and radius), and whether it's swooping. */
  anchor: { x: number; y: number; z: number } | null = null;
  swooping = false;
  flap = 0;
  private angle = rng.next() * Math.PI * 2;
  private swoopTimer = 100;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 0.5;
    this.maxHealth = this.health = 20;
  }
  attackDamage = 6;
  override gravity() { return 0; }
  override isFlying() { return true; }
  override ai() {
    this.flap += 0.25;
    if (!this.target || this.target.dead || (this.target as Player).creative || (this.target as Player).spectator || this.distanceTo(this.target) > 64) {
      this.target = null;
      for (const p of this.game.playerEntities()) if (!p.dead && !p.creative && !p.spectator && this.distanceTo(p) < 64) { this.target = p; break; }
    }
    const t = this.target;
    if (!this.anchor) this.anchor = { x: this.x, y: this.y, z: this.z };
    if (t) this.anchor = { x: t.x, y: Math.max(t.y + 20, this.world.topSolidY(Math.floor(t.x), Math.floor(t.z)) + 10), z: t.z };
    // cats scare them off
    const cat = this.game.entities.find((e) => (tn(e) === 'Cat' || tn(e) === 'Ocelot') && e.distanceTo(this) < 16);
    if (this.swooping && t) {
      if (cat || t.dead) { this.swooping = false; return; }
      const dx = t.x - this.x, dz = t.z - this.z, dy = t.y + t.height * 0.5 - this.y;
      if (dx * dx + dz * dz < 1 && Math.abs(dy) < 1.2) {
        if (t.damage(this.attackDamage, 'mob', this)) this.swing();
        this.swooping = false;
        this.swoopTimer = 60 + rng.int(60);
      }
      if (this.collidedH || this.collidedV) this.swooping = false;
      return;
    }
    if (t && !cat && --this.swoopTimer <= 0) { this.swooping = true; this.game.audio.play('phantom.swoop', this, 1, 1); }
  }
  override travel() {
    if (this.noAi) { this.flap += 0.25; return; }
    let tx: number, ty: number, tz: number;
    if (this.swooping && this.target) { tx = this.target.x; ty = this.target.y + this.target.height * 0.5; tz = this.target.z; }
    else {
      const a = this.anchor ?? { x: this.x, y: this.y, z: this.z };
      this.angle += 0.03;
      tx = a.x + Math.cos(this.angle) * 12; ty = a.y + Math.sin(this.angle * 2) * 2; tz = a.z + Math.sin(this.angle) * 12;
    }
    const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, l = Math.hypot(dx, dy, dz) || 1;
    const sp = this.swooping ? 0.08 : 0.05;
    this.vx += ((dx / l) * sp * 6 - this.vx) * 0.1; this.vy += ((dy / l) * sp * 6 - this.vy) * 0.1; this.vz += ((dz / l) * sp * 6 - this.vz) * 0.1;
    this.yaw = this.bodyYaw = this.headYaw = (Math.atan2(this.vz, this.vx) * 180) / Math.PI - 90;
    this.pitch = (-Math.atan2(this.vy, Math.hypot(this.vx, this.vz)) * 180) / Math.PI;
    this.move(this.vx, this.vy, this.vz);
  }
  setSize(n: number) {
    this.size = n;
    this.renderScale = 1 + 0.15 * n;
    this.width = 0.9 + 0.2 * n; this.height = 0.5 + 0.1 * n;
    this.attackDamage = 6 + n;
  }
  override drops(): ItemStack[] { return [stack(I7.PHANTOM_MEMBRANE, rng.int(2))].filter((s) => s.count > 0); }
  override despawnCheck() { const d = this.playerDistance(); if (d !== Infinity && d > 128) this.removed = true; }
  override extraJSON() { return { size: this.size }; }
  override loadExtra(d: Record<string, unknown>) { this.setSize((d.size as number) ?? 0); }
}

/** Every so often at night, phantoms come for players who haven't slept in 3+ days (by vanilla's odds). */
export function spawnPhantoms(game: Game, rnd: { next(): number; int(n: number): number }) {
  if (game.isDaytime() || game.options.difficulty === 0) return;
  for (const p of game.playerEntities()) {
    if (p.dead || p.creative || p.spectator) continue;
    const rest = (p as unknown as { restTicks?: number }).restTicks ?? 0;
    if (rest < 72000 || rnd.next() * rest < 72000) continue;
    // only under the open sky
    if (game.world!.topSolidY(Math.floor(p.x), Math.floor(p.z)) > p.y + 1) continue;
    const n = 1 + rnd.int(game.options.difficulty + 1);
    for (let i = 0; i < n; i++) {
      const m = game.interact!.spawnMob('phantom', p.x + rnd.int(10) - 5, p.y + 20 + rnd.int(15), p.z + rnd.int(10) - 5) as Phantom | null;
      m?.setSize(0);
    }
  }
}

// ------------------------------------------------------------------ golems
/** Iron golems: villages' guardians (or built by players from iron blocks and a pumpkin). */
export class IronGolem extends GoalMob {
  kind = 'iron_golem';
  typeName = 'Iron Golem';
  override model = 'iron_golem';
  override skin = 'iron_golem';
  override hurtName = 'iron_golem.hurt';
  override deathName = 'iron_golem.death';
  override speedAttr = 0.25;
  override retaliates = true;
  override xp = 0;
  playerCreated = false;
  /** Ticks of the arm swing (attacking) and of holding out a poppy. */
  attackTicks = 0;
  poppyTicks = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.4; this.height = 2.7;
    this.maxHealth = this.health = 100;
    this.stepHeight = 1;
    this.goals.push(meleeAttack(1, 0.1), wander(6, 0.04, 240), lookAtPlayer(7, 6));
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Mob && e.hostile && tn(e) !== 'Creeper' && !(e instanceof Guardian) && tn(e) !== 'Zombified Piglin', 16, false));
  }
  override eyeHeight() { return 2.3; }
  override tick() {
    super.tick();
    if (this.attackTicks > 0) this.attackTicks--;
    if (this.poppyTicks > 0) this.poppyTicks--;
    else if (!this.target && rng.int(8000) === 0 && this.game.entities.some((e) => e instanceof Villager && e.distanceTo(this) < 6)) this.poppyTicks = 400;
  }
  override meleeHit(t: LivingEntity): boolean {
    if (this.attackCooldown > 0) return false;
    const dx = t.x - this.x, dz = t.z - this.z;
    if (dx * dx + dz * dz > (this.width + t.width + 0.6) ** 2 || Math.abs(t.y - this.y) > 2.5) return false;
    this.attackCooldown = 20;
    this.attackTicks = 10;
    const dmg = 7 + rng.int(15) * (this.game.options.difficulty / 2 + 0.5);
    if (t.damage(dmg, 'mob', this)) { t.vy += 0.4; this.game.audio.play('iron_golem.attack', this, 1, 1); }
    return true;
  }
  /** Iron ingots patch it up. */
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held?.id !== I.IRON_INGOT || this.health >= this.maxHealth) return false;
    this.heal(25);
    game.interact!.consume(1);
    game.audio.play('iron_golem.repair', this, 1, 1);
    return true;
  }
  override useLabel(_p: Player, held: ItemStack | null) { return held?.id === I.IRON_INGOT && this.health < this.maxHealth ? 'Repair' : null; }
  override onDamaged(attacker: Entity | null) {
    // village golems turn on players who hurt them (or villagers); player-made ones only fight back
    super.onDamaged(attacker);
  }
  override drops(): ItemStack[] { return [stack(I.IRON_INGOT, 3 + rng.int(3)), ...[stack(B.POPPY, rng.int(3))].filter((s) => s.count > 0)]; }
  override despawnCheck() {}
  override extraJSON() { return { playerCreated: this.playerCreated }; }
  override loadExtra(d: Record<string, unknown>) { this.playerCreated = !!d.playerCreated; }
}

/** Snow golems: throw snowballs at monsters and leave a trail of snow; they melt where it's warm. */
export class SnowGolem extends GoalMob {
  kind = 'snow_golem';
  typeName = 'Snow Golem';
  override model = 'snow_golem';
  override skin = 'snow_golem';
  override speedAttr = 0.2;
  override xp = 0;
  pumpkin = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.7; this.height = 1.9;
    this.maxHealth = this.health = 4;
    this.goals.push(swim(0), rangedAttack(1, 0.06, 20, 10, (m, t) => throwSnowball(m, t)), wander(5, 0.05), lookAtPlayer(6, 6));
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Mob && e.hostile && !(e instanceof SnowGolem), 10, true));
  }
  override eyeHeight() { return 1.7; }
  override tick() {
    super.tick();
    if (this.dead || this.noAi) return;
    const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
    const biome = BIOMES[this.game.biomeAt(x, z).id];
    const hot = (biome.temperature ?? (biome.dry ? 2 : 0.8)) > 1 || biome.dry || this.world.dimension === 'nether';
    if (hot && this.age % 20 === 0) this.damage(1, 'fire');
    if ((this.inWater || (this.game.weather?.rainAt(this.x, this.y + 1, this.z) ?? false)) && this.age % 20 === 0) this.damage(1, 'drown');
    if (!hot && this.game.options.difficulty >= 0 && this.world.getId(x, y, z) === B.AIR && OPAQUE[this.world.getId(x, y - 1, z)]) this.world.set(x, y, z, B.SNOW);
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (!held || held.id !== I.SHEARS || !this.pumpkin) return false;
    this.pumpkin = false;
    game.audio.play('shears', this, 1, 1);
    game.dropItem(this.x, this.y + 1.7, this.z, stack(B2.CARVED_PUMPKIN));
    return true;
  }
  override useLabel(_p: Player, held: ItemStack | null) { return held?.id === I.SHEARS && this.pumpkin ? 'Shear' : null; }
  override drops(): ItemStack[] { return [stack(I.SNOWBALL, rng.int(16))].filter((s) => s.count > 0); }
  override despawnCheck() {}
  override extraJSON() { return { pumpkin: this.pumpkin }; }
  override loadExtra(d: Record<string, unknown>) { this.pumpkin = d.pumpkin !== false; }
}
function throwSnowball(m: GoalMob, t: LivingEntity) {
  const s = new Snowball(m.world, m.game, m, 'snowball');
  const ey = m.y + m.eyeHeight() - 0.1;
  s.setPos(m.x, ey, m.z);
  const dx = t.x - m.x, dz = t.z - m.z, dy = t.y + t.eyeHeight() - 1.1 - ey, h = Math.hypot(dx, dz);
  const l = Math.hypot(dx, dy + h * 0.2, dz) || 1;
  s.vx = (dx / l) * 1.6; s.vy = ((dy + h * 0.2) / l) * 1.6; s.vz = (dz / l) * 1.6;
  m.game.addEntity(s);
  m.game.audio.play('throw', m, 1, 0.4 / (rng.next() * 0.4 + 0.8));
}

/**
 * A carved pumpkin (or jack o'lantern) was put at (x, y, z): if it tops a T of iron blocks or a pillar of two snow
 * blocks, the blocks become a golem. Returns the golem made, if any.
 */
export function buildGolem(game: Game, x: number, y: number, z: number): Mob | null {
  const w = game.world!;
  const id = (dx: number, dy: number, dz: number) => w.getId(x + dx, y + dy, z + dz);
  const clear = (cells: [number, number, number][]) => { for (const [dx, dy, dz] of cells) w.set(x + dx, y + dy, z + dz, 0); };
  if (id(0, -1, 0) === B.SNOW_BLOCK && id(0, -2, 0) === B.SNOW_BLOCK) {
    clear([[0, 0, 0], [0, -1, 0], [0, -2, 0]]);
    const g = game.interact!.spawnMob('snow_golem', x + 0.5, y - 2, z + 0.5) as Mob | null;
    for (let i = 0; i < 20; i++) game.particles?.smoke(x + 0.5 + (Math.random() - 0.5), y - 1 + Math.random() * 2, z + 0.5 + (Math.random() - 0.5));
    return g;
  }
  if (id(0, -1, 0) === B.IRON_BLOCK && id(0, -2, 0) === B.IRON_BLOCK) {
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      if (id(ax, -1, az) !== B.IRON_BLOCK || id(-ax, -1, -az) !== B.IRON_BLOCK) continue;
      // the arms' feet must be clear (a T, not a block)
      if (id(ax, -2, az) === B.IRON_BLOCK || id(-ax, -2, -az) === B.IRON_BLOCK) continue;
      clear([[0, 0, 0], [0, -1, 0], [0, -2, 0], [ax, -1, az], [-ax, -1, -az]]);
      const g = game.interact!.spawnMob('iron_golem', x + 0.5, y - 2, z + 0.5) as IronGolem | null;
      if (g) g.playerCreated = true;
      return g;
    }
  }
  return null;
}

/** Monsters that keep away from iron golems? None in vanilla; but villagers flee zombies (used by villages). */
export const isZombieKind = (e: Entity) => e instanceof Zombie || tn(e) === 'Zombie Villager' || tn(e) === 'Husk' || tn(e) === 'Drowned';
void idOf; void pack; void Monster;
