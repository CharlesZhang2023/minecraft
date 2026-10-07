// Horses, donkeys and mules (1.8 behaviour): tame one by riding it until it stops bucking you off (food makes
// it more willing), put a saddle on it to steer, hold jump to charge a leap. Horses can wear armour; donkeys
// and mules can carry a chest. A horse and a donkey have a mule, which can't breed.
import { advanceNear } from '../game/advancements';
import { Animal, type Mob } from './mobs';
import type { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { DamageSource } from './living';
import { B, BLOCKS } from '../world/blocks';
import { I, I3, I5, HORSE_ARMOR, ItemStack, stack, itemId } from '../game/items';
import type { Player } from '../game/player';
import { Random } from '../noise';
import { carryRider, dismountSpot, type Mount } from './mount';

const rng = new Random(Date.now() & 0xffff);

export type HorseKind = 'horse' | 'donkey' | 'mule' | 'skeleton' | 'zombie';
export const HORSE_COLORS = ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'darkbrown'] as const;
export const HORSE_MARKINGS = ['none', 'white', 'whitefield', 'whitedots', 'blackdots'] as const;

/** Feet of a seated rider, relative to the horse. */
export const SADDLE_SEAT = 0.68;

/** Healing, growth and temper each food gives (vanilla EntityHorse.func_110256_cu). */
const FOODS: Record<number, { heal: number; grow: number; temper: number; love?: boolean }> = {
  [I.SUGAR]: { heal: 1, grow: 30, temper: 3 },
  [I.WHEAT]: { heal: 2, grow: 20, temper: 3 },
  [B.HAY_BLOCK]: { heal: 20, grow: 180, temper: 0 },
  [I.APPLE]: { heal: 3, grow: 60, temper: 3 },
  [I3.GOLDEN_CARROT]: { heal: 4, grow: 60, temper: 5, love: true },
  [I.GOLDEN_APPLE]: { heal: 10, grow: 240, temper: 10, love: true },
};

/** Jump strength from how long jump was held (vanilla's jump bar). */
export function jumpPowerFor(ticks: number) {
  if (ticks <= 0) return 0;
  return ticks < 10 ? ticks * 0.1 : Math.min(1, 0.8 + (2 / (ticks - 9)) * 0.1);
}

export class Horse extends Animal implements Mount {
  typeName = 'Horse';
  override model = 'horse';
  override skin = 'horse';
  override sayName = 'horse.say';
  override hurtName = 'horse.hurt';
  override deathName = 'horse.death';
  override stepSound() {}
  override temptItems: number[] = [];
  kind: HorseKind = 'horse';
  color = 0;
  markings = 0;
  tame = false;
  temper = 0;
  saddle: ItemStack | null = null;
  armorItem: ItemStack | null = null;
  chest = false;
  chestItems: (ItemStack | null)[] = new Array(15).fill(null);
  /** Movement speed and jump strength (vanilla attributes). */
  speedStat = 0.225;
  jumpStat = 0.7;
  rider: Player | null = null;
  lookLimit = 180;
  bodyFollows = true;
  /** Ticks jump has been held (the bar), the charged leap waiting to happen, and whether it's in the air. */
  jumpCharge = 0;
  private jumpPower = 0;
  airborne = false;
  /** Rearing up (bucking, angry) and grazing animation timers. */
  rearTicks = 0;
  pRear = 0;
  rear = 0;
  eatTicks = 0;
  pEat = 0;
  eat = 0;
  tailSwish = 0;
  private stepDist = 0;
  private gallop = 0;

  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.3965;
    this.height = 1.6;
    this.stepHeight = 1;
    this.maxHealth = this.health = 15 + rng.int(8) + rng.int(9);
    this.speedStat = (0.45 + rng.next() * 0.3 + rng.next() * 0.3 + rng.next() * 0.3) * 0.25;
    this.jumpStat = 0.4 + rng.next() * 0.2 + rng.next() * 0.2 + rng.next() * 0.2;
    this.color = rng.int(7);
    this.markings = rng.int(5);
  }

  get adult() { return !this.baby; }
  get canWearArmor() { return this.kind === 'horse'; }
  get canCarryChest() { return this.kind === 'donkey' || this.kind === 'mule'; }
  /** Texture name for the renderer. */
  get skinKey() { return this.kind === 'horse' ? `horse_${this.color}_${this.markings}` : this.kind === 'skeleton' || this.kind === 'zombie' ? `${this.kind}_horse` : this.kind; }

  override eyeHeight() { return this.height * 0.95; }
  override groundSpeed() { return this.aiSpeed * this.speedFactor(); }
  override airSpeed() { return this.rider && this.tame && this.saddle ? this.speedStat * 0.1 : 0.02; }

  /** Horses and donkeys can breed with each other (making mules); mules can't. */
  override canMateWith(o: Animal) { return o instanceof Horse && o.kind !== 'mule' && this.kind !== 'mule' && o.tame && this.tame; }
  override babyType(mate?: Animal) {
    if (mate instanceof Horse && mate.kind !== this.kind) return 'mule';
    return this.kind;
  }
  /** Foals take after their parents: stats are the average of both and a random roll. */
  override bred(baby: Mob, mate: Animal) {
    if (!(baby instanceof Horse) || !(mate instanceof Horse)) return;
    const mix = (a: number, b: number, r: number) => (a + b + r) / 3;
    const fresh = new Horse(this.world, this.game);
    baby.maxHealth = baby.health = Math.round(mix(this.maxHealth, mate.maxHealth, fresh.maxHealth));
    baby.speedStat = mix(this.speedStat, mate.speedStat, fresh.speedStat);
    baby.jumpStat = mix(this.jumpStat, mate.jumpStat, fresh.jumpStat);
    if (baby.kind === 'horse') {
      const r = rng.int(9);
      baby.color = r < 4 ? this.color : r < 8 ? mate.color : rng.int(7);
      const m = rng.int(5);
      baby.markings = m < 2 ? this.markings : m < 4 ? mate.markings : rng.int(5);
    }
    baby.growTimer = 0;
  }

  // ---------------------------------------------------------------- riding
  mountBy(p: Player) {
    if (this.rider || p.riding) return;
    this.rider = p;
    p.riding = this;
    p.sprinting = false;
    this.path = null;
    this.eatTicks = 0;
    p.yaw = p.pyaw = this.yaw;
    carryRider(this, p, SADDLE_SEAT);
  }

  dismount() {
    const r = this.rider;
    if (!r) return;
    r.riding = null;
    this.rider = null;
    this.jumpCharge = 0;
    const [x, y, z] = dismountSpot(this, r);
    r.setPos(x, y, z);
  }

  /** The jump bar, 0..1 (HUD). */
  get jumpBar() { return jumpPowerFor(this.jumpCharge); }
  get controllable() { return !!this.rider && this.tame && !!this.saddle; }

  override tick() {
    this.pRear = this.rear;
    this.pEat = this.eat;
    if (this.rearTicks > 0) this.rearTicks--;
    if (this.eatTicks > 0) this.eatTicks--;
    this.rear += ((this.rearTicks > 0 ? 1 : 0) - this.rear) * 0.2;
    this.eat += ((this.eatTicks > 0 ? 1 : 0) - this.eat) * 0.25;
    if (this.tailSwish > 0) this.tailSwish--;
    else if (rng.int(200) === 0) this.tailSwish = 8;
    const r = this.rider;
    if (r && (r.dead || r.removed || r.riding !== this)) { this.rider = null; }
    // charge the jump while it's held, leap when it's let go
    if (this.controllable && r) {
      if (r.jumping && this.onGround && !this.airborne) this.jumpCharge++;
      else if (this.jumpCharge > 0) { this.jumpPower = jumpPowerFor(this.jumpCharge); this.jumpCharge = 0; }
    } else this.jumpCharge = 0;
    super.tick();
    if (this.dead) { if (this.rider) this.dismount(); return; }
    if (this.onGround && this.airborne) {
      this.airborne = false;
      this.game.audio.play('horse.land', this, 0.4, 1);
    }
    if (this.rider) {
      // the horse turns with its rider
      this.bodyYaw = this.headYaw = this.yaw;
      carryRider(this, this.rider, SADDLE_SEAT);
      this.hoofSounds();
    }
  }

  private hoofSounds() {
    const d = Math.hypot(this.x - this.px, this.z - this.pz);
    if (!this.onGround || d < 0.01) return;
    this.stepDist += d;
    const fast = d > 0.25;
    if (this.stepDist > (fast ? 1.6 : 0.9)) {
      this.stepDist = 0;
      const wood = BLOCKS[this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z))].sound === 'wood';
      this.game.audio.play(fast ? 'horse.gallop' : wood ? 'horse.stepWood' : 'horse.step', this, fast ? 0.5 : 0.3, 0.9 + rng.next() * 0.2);
      if (fast && ++this.gallop % 7 === 0 && rng.int(3) === 0) this.game.audio.play('horse.breathe', this, 0.5, 1);
    }
  }

  override ai() {
    const r = this.rider;
    if (r) {
      this.path = null;
      if (!this.tame) { this.buck(r); return; }
      if (!this.saddle) return; // tame but no saddle: you can sit on it, not steer it
      this.yaw = r.yaw;
      this.pitch = r.pitch * 0.5;
      const strafe = r.strafe * 0.5;
      let fwd = r.forward;
      if (fwd <= 0) fwd *= 0.25;
      if (this.jumpPower > 0 && !this.airborne && this.onGround) {
        this.vy = this.jumpStat * this.jumpPower;
        const jb = this.effectAmp('jump_boost');
        if (jb >= 0) this.vy += (jb + 1) * 0.1;
        this.airborne = true;
        if (fwd > 0) {
          const a = (this.yaw * Math.PI) / 180;
          this.vx += -0.4 * Math.sin(a) * this.jumpPower;
          this.vz += 0.4 * Math.cos(a) * this.jumpPower;
        }
        this.game.audio.play('horse.jump', this, 0.4, 1);
        this.jumpPower = 0;
      }
      this.forward = fwd;
      this.strafe = strafe;
      this.aiSpeed = this.speedStat;
      // keep its head above water (and nothing else: the wander AI may have left its jump flag set)
      this.jumping = this.inWater;
      return;
    }
    this.jumpPower = 0;
    // graze now and then
    if (!this.path && this.onGround && this.eatTicks === 0 && rng.int(this.baby ? 300 : 1000) === 0 && this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)) === B.GRASS) {
      this.eatTicks = 40;
      this.game.audio.play('horse.eat', this, 0.5, 1);
    }
    if (this.eatTicks > 0) { this.path = null; return; }
    super.ai();
  }

  /** Untamed and ridden: it runs about, and every so often either accepts the rider or throws them off. */
  private buck(r: Player) {
    if (!this.path || rng.int(40) === 0) {
      const a = rng.next() * Math.PI * 2;
      this.setPathTo(this.x + Math.cos(a) * 5, this.y, this.z + Math.sin(a) * 5, this.speedStat * 1.2);
    }
    if (rng.int(50) !== 0) return;
    if (rng.int(100) < this.temper) {
      this.tame = true;
      advanceNear(this.game, this, 'tame', {}, 4);
      for (let i = 0; i < 7; i++) this.game.particles?.heart(this.x + rng.next() * 1.4 - 0.7, this.y + this.height + 0.2, this.z + rng.next() * 1.4 - 0.7);
      this.game.audio.play(this.kind === 'horse' ? 'horse.say' : 'donkey.say', this, 1, 1);
      return;
    }
    this.temper = Math.min(100, this.temper + 5);
    this.dismount();
    this.makeRear();
    for (let i = 0; i < 7; i++) this.game.particles?.smoke(this.x + rng.next() * 1.4 - 0.7, this.y + this.height + 0.2, this.z + rng.next() * 1.4 - 0.7, true);
    void r;
  }

  makeRear() {
    this.rearTicks = 20;
    this.game.audio.play(this.kind === 'horse' ? 'horse.angry' : 'donkey.angry', this, 1, 1);
  }

  override onLand(fall: number) {
    // horses take less fall damage, and so does their rider
    const dmg = Math.ceil(fall * 0.5 - 3);
    if (dmg > 0) {
      this.damage(dmg, 'fall');
      this.rider?.damage(dmg, 'fall');
    }
  }

  override onDamaged(attacker: Entity | null) {
    if (this.rider) return; // a ridden horse doesn't bolt
    super.onDamaged(attacker);
  }

  override die(source: DamageSource, attacker: Entity | null) {
    this.dismount();
    super.die(source, attacker);
    if (this.saddle) this.game.dropItem(this.x, this.y + 0.5, this.z, this.saddle);
    if (this.armorItem) this.game.dropItem(this.x, this.y + 0.5, this.z, this.armorItem);
    if (this.chest) {
      this.game.dropItem(this.x, this.y + 0.5, this.z, stack(B.CHEST));
      for (const s of this.chestItems) if (s) this.game.dropItem(this.x, this.y + 0.5, this.z, s, true);
    }
    this.saddle = null;
    this.setArmor(null);
    this.chest = false;
  }

  override drops(): ItemStack[] {
    return [stack(I.LEATHER, rng.int(3))].filter((s) => s.count > 0);
  }

  /** Horse armour counts toward its protection like a player's. */
  setArmor(s: ItemStack | null) {
    this.armorItem = s;
    this.armor = s ? HORSE_ARMOR[s.id]?.points ?? 0 : 0;
  }

  // ---------------------------------------------------------------- interaction
  /** What a phone's action button would say (mirrors interact and useItem). */
  override useLabel(p: Player, held: ItemStack | null): string | null {
    const food = held ? FOODS[held.id] : undefined;
    if (food && ((this.health < this.maxHealth && food.heal) || (this.baby && food.grow) || (!this.tame && food.temper && this.temper < 100) ||
      (food.love && this.tame && this.adult && this.breedCooldown === 0 && this.loveTicks === 0 && this.kind !== 'mule'))) return 'Feed';
    if (held && this.tame && !this.baby) {
      if (held.id === I5.SADDLE && !this.saddle) return 'Saddle';
      if (HORSE_ARMOR[held.id] && this.canWearArmor && !this.armorItem) return 'Equip';
      if (held.id === B.CHEST && this.canCarryChest && !this.chest) return 'Attach Chest';
    }
    if (this.tame && p.sneaking && this.adult) return 'Open';
    if (this.baby || p.sneaking || this.rider || p.riding) return null;
    if (held && !this.tame && (held.id === I5.SADDLE || HORSE_ARMOR[held.id])) return null;
    return 'Mount';
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    const p = game.player!;
    if (held?.id === I5.SADDLE || held?.id === B.CHEST || (held && HORSE_ARMOR[held.id]) || (held && FOODS[held.id])) {
      if (this.useItem(game, held)) return true;
    }
    if (this.tame && p.sneaking && this.adult) { game.ui.openHorse(this); return true; }
    if (this.baby) return false;
    if (held && !this.tame && (held.id === I5.SADDLE || HORSE_ARMOR[held.id])) { this.makeRear(); return true; }
    if (p.sneaking) return false;
    this.mountBy(p);
    return true;
  }

  private useItem(game: Game, held: ItemStack): boolean {
    const food = FOODS[held.id];
    if (food) {
      let used = false;
      if (this.health < this.maxHealth && food.heal) { this.heal(food.heal); used = true; }
      if (this.baby && food.grow) { this.growTimer += food.grow * 20; used = true; }
      if (!this.tame && food.temper && this.temper < 100) { this.temper = Math.min(100, this.temper + food.temper); used = true; }
      if (food.love && this.tame && this.adult && this.breedCooldown === 0 && this.loveTicks === 0 && this.kind !== 'mule') { this.loveTicks = 600; used = true; }
      if (!used) return false;
      game.interact!.consume(1);
      this.eatTicks = 16;
      game.audio.play('horse.eat', this, 0.6, 1);
      return true;
    }
    if (!this.tame || this.baby) return false;
    if (held.id === I5.SADDLE && !this.saddle) {
      this.saddle = stack(I5.SADDLE);
      game.interact!.consume(1);
      game.audio.play('horse.saddle', this, 0.6, 1);
      return true;
    }
    if (HORSE_ARMOR[held.id] && this.canWearArmor && !this.armorItem) {
      this.setArmor(stack(held.id));
      game.interact!.consume(1);
      game.audio.play('horse.armor', this, 0.6, 1);
      return true;
    }
    if (held.id === B.CHEST && this.canCarryChest && !this.chest) {
      this.chest = true;
      game.interact!.consume(1);
      game.audio.play('horse.saddle', this, 0.6, 0.8);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- saving
  override extraJSON() {
    return {
      kind: this.kind, color: this.color, markings: this.markings, tame: this.tame, temper: this.temper, saddle: this.saddle, armor: this.armorItem,
      chest: this.chest, chestItems: this.chest ? this.chestItems : undefined, maxHealth: this.maxHealth, speed: this.speedStat, jump: this.jumpStat, grow: this.growTimer,
    };
  }
  override loadExtra(d: Record<string, unknown>) {
    this.color = (d.color as number) ?? this.color;
    this.markings = (d.markings as number) ?? this.markings;
    this.tame = !!d.tame;
    this.temper = (d.temper as number) ?? 0;
    this.saddle = (d.saddle as ItemStack) ?? null;
    this.setArmor((d.armor as ItemStack) ?? null);
    this.chest = !!d.chest;
    if (Array.isArray(d.chestItems)) this.chestItems = (d.chestItems as (ItemStack | null)[]).concat(new Array(15).fill(null)).slice(0, 15);
    if (typeof d.maxHealth === 'number') this.maxHealth = d.maxHealth;
    if (typeof d.speed === 'number') this.speedStat = d.speed;
    if (typeof d.jump === 'number') this.jumpStat = d.jump;
    if (typeof d.grow === 'number') this.growTimer = d.grow;
  }
}

export class Donkey extends Horse {
  override typeName = 'Donkey';
  override sayName = 'donkey.say';
  override hurtName = 'donkey.hurt';
  override deathName = 'donkey.death';
  override kind: HorseKind = 'donkey';
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.3965 * 0.87;
    this.height = 1.6 * 0.87;
    this.speedStat = 0.175;
    this.jumpStat = 0.5;
  }
}

export class Mule extends Horse {
  override typeName = 'Mule';
  override sayName = 'donkey.say';
  override hurtName = 'donkey.hurt';
  override deathName = 'donkey.death';
  override kind: HorseKind = 'mule';
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.3965 * 0.92;
    this.height = 1.6 * 0.92;
    this.speedStat = 0.175;
    this.jumpStat = 0.5;
  }
}

/** Skeleton horses (1.6/1.9): undead, they don't drown and swim fast; the ones from a skeleton trap come with riders. */
export class SkeletonHorse extends Horse {
  override typeName = 'Skeleton Horse';
  override kind: HorseKind = 'skeleton';
  override undead = true;
  override canBreathe = true;
  override sayName = 'skeleton_horse.say';
  override hurtName = 'skeleton_horse.hurt';
  override deathName = 'skeleton_horse.death';
  /** A trap: when a player comes within 10 blocks, lightning strikes and four horsemen appear. */
  trap = false;
  private trapAge = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.maxHealth = this.health = 15;
    this.tame = true;
  }
  override tick() {
    super.tick();
    if (!this.trap || this.dead) return;
    if (++this.trapAge > 18000) { this.removed = true; return; }
    const near = this.game.playerEntities().find((p) => !p.creative && !p.spectator && p.distanceTo(this) < 10);
    if (!near) return;
    this.trap = false;
    springTrap(this);
  }
  override drops(): ItemStack[] { return [stack(I.BONE, rng.int(3))].filter((s) => s.count > 0); }
  override babyType(): HorseKind { return 'skeleton'; }
  override extraJSON() { return { ...super.extraJSON(), trap: this.trap }; }
  override loadExtra(d: Record<string, unknown>) { super.loadExtra(d); this.trap = !!d.trap; }
}
/** Zombie horses: undead, rotten; can't be tamed in survival (vanilla). */
export class ZombieHorse extends Horse {
  override typeName = 'Zombie Horse';
  override kind: HorseKind = 'zombie';
  override undead = true;
  override sayName = 'zombie_horse.say';
  override hurtName = 'zombie_horse.hurt';
  override deathName = 'zombie_horse.death';
  constructor(world: World, game: Game) {
    super(world, game);
    this.maxHealth = this.health = 15;
  }
  override drops(): ItemStack[] { return [stack(I.ROTTEN_FLESH, rng.int(3))].filter((s) => s.count > 0); }
  override babyType(): HorseKind { return 'zombie'; }
}
/** The trap springs: lightning, and the horse plus three more, each with a skeleton (in an enchanted iron helmet) beside it. */
function springTrap(h: SkeletonHorse) {
  const g = h.game;
  for (const p of g.playersHere()) p.event(['thunder', 2]);
  for (let i = 0; i < 4; i++) {
    const x = h.x + (i ? rng.next() * 6 - 3 : 0), z = h.z + (i ? rng.next() * 6 - 3 : 0);
    const horse = i ? g.interact!.spawnMob('skeleton_horse', x, h.y, z) as SkeletonHorse | null : h;
    const sk = g.interact!.spawnMob('skeleton', x + 0.6, h.y, z) as (Entity & { armorItems?: (ItemStack | null)[]; persistentHostile?: boolean }) | null;
    if (sk) { sk.armorItems = [{ ...stack(itemIdOf('iron_helmet')), ench: { protection: 1 + rng.int(3) } }, null, null, null]; sk.persistentHostile = true; }
    if (horse) horse.tame = true;
  }
}
const itemIdOf = (n: string) => itemId(n);

