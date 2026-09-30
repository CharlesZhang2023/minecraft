// Mob behaviours.
import { LivingEntity, DamageSource } from './living';
import type { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { findPath, PathNode } from './path';
import { B, BLOCKS, idOf, WOOL_COLORS } from '../world/blocks';
import { I, I2, ItemStack, stack, getItem, TOOLS } from '../game/items';
import { Arrow, XpOrb, Fireball } from './item';
import { Random } from '../noise';
import { raycastBlocks } from '../game/raycast';

const rng = new Random(Date.now() & 0xfff);

export abstract class Mob extends LivingEntity {
  abstract typeName: string;
  model = 'biped';
  skin = 'steve';
  hostile = false;
  persist = true;
  target: LivingEntity | null = null;
  path: PathNode[] | null = null;
  pathTimer = 0;
  wanderTimer = 0;
  aiSpeed = 0;
  speedAttr = 0.25;
  sayTimer = 0;
  sayName = '';
  hurtName = '';
  deathName = '';
  soundPitch = 1;
  xp = 5;
  burnsInDay = false;
  attackCooldown = 0;
  panicTicks = 0;
  baby = false;
  growTimer = 0;
  loveTicks = 0;
  breedCooldown = 0;
  despawnTimer = 0;
  lookTarget: { x: number; y: number; z: number } | null = null;
  lookTimer = 0;
  heldItem = 0;
  holding = false;

  constructor(world: World, public game: Game) {
    super(world);
    this.yaw = this.bodyYaw = this.headYaw = rng.next() * 360;
  }

  override groundSpeed() { return this.aiSpeed; }
  override airSpeed() { return 0.02; }

  override tick() {
    if (this.dead) {
      this.deathTime++;
      if (this.deathTime >= 20) {
        this.removed = true;
        for (let i = 0; i < 12; i++) this.game.particles?.smoke(this.x + (rng.next() - 0.5) * this.width * 2, this.y + rng.next() * this.height, this.z + (rng.next() - 0.5) * this.width * 2, true);
      }
      this.vx *= 0.5; this.vz *= 0.5;
      this.vy -= 0.08;
      this.move(this.vx, this.vy, this.vz);
      return;
    }
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.panicTicks > 0) this.panicTicks--;
    if (this.loveTicks > 0) { this.loveTicks--; if (this.loveTicks % 10 === 0) this.game.particles?.heart(this.x + (rng.next() - 0.5), this.y + this.height + 0.3, this.z + (rng.next() - 0.5)); }
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.baby && ++this.growTimer > 24000) this.baby = false;
    this.forward = 0;
    this.strafe = 0;
    this.jumping = false;
    this.ai();
    this.followPath();
    this.livingTick();
    this.updateRotations();
    // ambient sound
    if (this.sayName && --this.sayTimer <= 0) {
      this.sayTimer = 80 + rng.int(160);
      this.game.audio.play(this.sayName, this, 1, (this.baby ? 1.5 : 1) * this.soundPitch * (0.9 + rng.next() * 0.2));
    }
    // daylight burning
    if (this.burnsInDay && this.game.isDaytime() && !this.inWater && (this.game.weather?.rain ?? 0) < 0.2) {
      const [sky] = this.world.getLight(Math.floor(this.x), Math.floor(this.y + this.eyeHeight()), Math.floor(this.z));
      if (sky >= 15 && rng.next() * 30 < (1 + 0.4) * 2 && this.world.topSolidY(Math.floor(this.x), Math.floor(this.z)) < this.y + this.eyeHeight()) {
        this.fireTicks = Math.max(this.fireTicks, 160);
      }
    }
    if (this.fireTicks > 0 && this.age % 3 === 0) this.game.particles?.flame(this.x + (rng.next() - 0.5) * this.width, this.y + rng.next() * this.height, this.z + (rng.next() - 0.5) * this.width);
    this.despawnCheck();
  }

  abstract ai(): void;

  private updateRotations() {
    // body follows movement, head follows look target
    const dx = this.x - this.px, dz = this.z - this.pz;
    if (dx * dx + dz * dz > 0.0005) {
      const moveYaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
      this.bodyYaw += wrap(moveYaw - this.bodyYaw) * 0.3;
    }
    if (this.lookTarget) {
      const lx = this.lookTarget.x - this.x, ly = this.lookTarget.y - (this.y + this.eyeHeight()), lz = this.lookTarget.z - this.z;
      const yaw = (Math.atan2(lz, lx) * 180) / Math.PI - 90;
      const pitch = (-Math.atan2(ly, Math.hypot(lx, lz)) * 180) / Math.PI;
      this.headYaw += Math.max(-10, Math.min(10, wrap(yaw - this.headYaw)));
      this.pitch += Math.max(-10, Math.min(10, pitch - this.pitch));
    } else {
      this.headYaw += wrap(this.yaw - this.headYaw) * 0.3;
      this.pitch *= 0.9;
    }
    // keep head within 75° of body
    const d = wrap(this.headYaw - this.bodyYaw);
    if (d > 75) this.bodyYaw = this.headYaw - 75;
    if (d < -75) this.bodyYaw = this.headYaw + 75;
    if (this.lookTimer > 0 && --this.lookTimer === 0) this.lookTarget = null;
  }

  setPathTo(x: number, y: number, z: number, speed: number) {
    const p = findPath(this.world, Math.floor(this.x), Math.floor(this.y + 0.01), Math.floor(this.z), Math.floor(x), Math.floor(y), Math.floor(z), Math.ceil(this.height), 300);
    this.path = p;
    this.aiSpeed = speed;
    return !!p;
  }

  private followPath() {
    if (!this.path || !this.path.length) return;
    const n = this.path[0];
    const tx = n.x + 0.5, tz = n.z + 0.5;
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist < Math.max(0.3, this.width * 0.5) && Math.abs(n.y - this.y) < 1.2) {
      this.path.shift();
      if (!this.path.length) this.path = null;
      return;
    }
    const yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    this.yaw += Math.max(-30, Math.min(30, wrap(yaw - this.yaw)));
    this.forward = 1;
    if ((n.y > Math.floor(this.y + 0.01) || this.collidedH) && (this.onGround || this.inWater)) this.jumping = true;
    if (this.inWater && this.y < n.y + 0.2) this.jumping = true;
  }

  moveToward(x: number, z: number, speed: number) {
    const dx = x - this.x, dz = z - this.z;
    const yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    this.yaw += Math.max(-30, Math.min(30, wrap(yaw - this.yaw)));
    this.forward = 1;
    this.aiSpeed = speed;
    if (this.collidedH && this.onGround) this.jumping = true;
  }

  wander(speed: number, chance = 120) {
    if (this.path) return;
    if (this.inWater && rng.next() < 0.8) this.jumping = true;
    if (--this.wanderTimer > 0 || rng.int(chance) !== 0) {
      // random look around
      if (!this.lookTarget && rng.int(80) === 0) {
        const a = rng.next() * Math.PI * 2;
        this.lookTarget = { x: this.x + Math.cos(a) * 4, y: this.y + this.eyeHeight(), z: this.z + Math.sin(a) * 4 };
        this.lookTimer = 20 + rng.int(20);
      }
      return;
    }
    this.wanderTimer = 60;
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(this.x + rng.int(21) - 10), tz = Math.floor(this.z + rng.int(21) - 10);
      const ty = Math.floor(this.y + rng.int(7) - 3);
      if (this.setPathTo(tx, ty, tz, speed)) break;
    }
  }

  canSee(e: Entity): boolean {
    const ex = this.x, ey = this.y + this.eyeHeight(), ez = this.z;
    const tx = e.x, ty = e.y + (e as LivingEntity).eyeHeight(), tz = e.z;
    const d = Math.hypot(tx - ex, ty - ey, tz - ez);
    if (d < 0.01) return true;
    const hit = raycastBlocks(this.world, ex, ey, ez, (tx - ex) / d, (ty - ey) / d, (tz - ez) / d, d);
    return !hit || !BLOCKS[this.world.getId(hit.x, hit.y, hit.z)].opaque;
  }

  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    const r = super.damage(amount, source, attacker);
    if (r && !this.dead && this.hurtName) this.game.audio.play(this.hurtName, this, 1, (this.baby ? 1.5 : 1) * this.soundPitch * (0.9 + rng.next() * 0.2));
    if (r) this.onDamaged(attacker ?? null);
    return r;
  }
  onDamaged(_attacker: Entity | null) {}

  override die(source: DamageSource, attacker: Entity | null) {
    super.die(source, attacker);
    this.deathTime = 0;
    if (this.deathName) this.game.audio.play(this.deathName, this, 1, (this.baby ? 1.5 : 1) * this.soundPitch);
    const byPlayer = attacker === this.game.player || (attacker as unknown as { shooter?: Entity })?.shooter === this.game.player;
    if (byPlayer) {
      const p = this.game.player!;
      this.game.achievements.onKill(this.typeName, source === 'arrow' ? this.distanceTo(p) : undefined, source === 'explosion');
    }
    if (!this.baby) {
      for (const s of this.drops(this.fireTicks > 0)) this.game.dropItem(this.x, this.y + 0.5, this.z, s);
      if (byPlayer && this.xp > 0) {
        let n = this.xp;
        while (n > 0) {
          const v = n >= 3 ? 3 : 1;
          n -= v;
          const o = new XpOrb(this.world, this.game, v);
          o.setPos(this.x, this.y + 0.5, this.z);
          this.game.addEntity(o);
        }
      }
    }
  }

  drops(_burning: boolean): ItemStack[] { return []; }

  despawnCheck() {
    if (!this.hostile) return;
    const p = this.game.player;
    if (!p) return;
    const d = this.distanceTo(p);
    if (d > 128) this.removed = true;
    else if (d > 32 && ++this.despawnTimer > 600 && rng.int(800) === 0) this.removed = true;
    else if (d < 32) this.despawnTimer = 0;
  }

  nearestPlayer(range: number): LivingEntity | null {
    const p = this.game.player;
    if (!p || p.dead || p.creative || p.spectator) return null;
    return this.distanceTo(p) < range ? p : null;
  }

  toJSON() {
    return { type: this.typeName.toLowerCase(), x: this.x, y: this.y, z: this.z, yaw: this.yaw, health: this.health, baby: this.baby, ...this.extraJSON() };
  }
  extraJSON(): Record<string, unknown> { return {}; }
  load(d: { x: number; y: number; z: number; yaw: number; health: number; baby?: boolean } & Record<string, unknown>) {
    this.setPos(d.x, d.y, d.z);
    this.yaw = this.bodyYaw = this.headYaw = d.yaw;
    this.health = d.health;
    this.baby = !!d.baby;
    this.loadExtra(d);
  }
  loadExtra(_d: Record<string, unknown>) {}
}

function wrap(d: number) {
  d %= 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ------------------------------------------------------------------ hostile
abstract class Monster extends Mob {
  override hostile = true;
  attackDamage = 3;
  followRange = 35;
  aggroRange = 16;
  chaseSpeed = 0.1;

  override ai() {
    // acquire target
    if (!this.target || this.target.dead || (this.target as unknown as { creative?: boolean }).creative || this.distanceTo(this.target) > this.followRange) {
      this.target = null;
      const p = this.nearestPlayer(this.aggroRange);
      if (p && (this.canSee(p) || this.distanceTo(p) < 4)) this.target = p;
    }
    if (this.target) this.chase(this.target);
    else this.wander(this.speedAttr * this.speedAttr * 1.0 * 0.9);
  }

  chase(t: LivingEntity) {
    this.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
    const d = this.distanceTo(t);
    if (--this.pathTimer <= 0 || !this.path) {
      this.pathTimer = 10 + rng.int(10) + (d > 16 ? 20 : 0);
      if (d < 2.5 && Math.abs(t.y - this.y) < 1.5) { this.path = null; }
      else this.setPathTo(t.x, t.y, t.z, this.chaseSpeed);
    }
    if (!this.path) this.moveToward(t.x, t.z, this.chaseSpeed);
    this.aiSpeed = this.chaseSpeed;
    const reach = this.width * 2 * this.width * 2 + t.width;
    const dx = t.x - this.x, dz = t.z - this.z, dy = t.y - this.y;
    if (dx * dx + dz * dz <= reach + 0.5 && Math.abs(dy) < 2 && this.attackCooldown <= 0) {
      this.attackCooldown = 20;
      this.swing();
      if (t.damage(this.attackDamage, 'mob', this)) {
        if (this.fireTicks > 0 && rng.next() < 0.3) t.fireTicks = Math.max(t.fireTicks, 40);
      }
    }
  }
}

export class Zombie extends Monster {
  typeName = 'Zombie';
  override skin = 'zombie';
  armsPose = 'zombie';
  override sayName = 'zombie.say';
  override hurtName = 'zombie.hurt';
  override deathName = 'zombie.death';
  override burnsInDay = true;
  override speedAttr = 0.23;
  override chaseSpeed = 0.23 * 0.23 * 1.0 * 1.0;
  override canBreathe = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 20;
    this.attackDamage = 3;
  }
  override eyeHeight() { return 1.74; }
  override drops(): ItemStack[] {
    const out = [stack(I.ROTTEN_FLESH, rng.int(3))].filter((s) => s.count > 0);
    if (rng.int(40) === 0) out.push(stack(I.IRON_INGOT));
    return out;
  }
}

export class Skeleton extends Monster {
  typeName = 'Skeleton';
  override model = 'bipedThin';
  override skin = 'skeleton';
  armsPose = 'bow';
  override sayName = 'skeleton.say';
  override hurtName = 'skeleton.hurt';
  override deathName = 'skeleton.hurt';
  override burnsInDay = true;
  override speedAttr = 0.25;
  override chaseSpeed = 0.25 * 0.25;
  override canBreathe = true;
  override heldItem = I.BOW;
  private shootTimer = 40;
  private strafeTimer = 0;
  private strafeDir = 1;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.99;
    this.maxHealth = this.health = 20;
  }
  override eyeHeight() { return 1.74; }
  override chase(t: LivingEntity) {
    this.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
    const d = this.distanceTo(t);
    const sees = this.canSee(t);
    if (d > 12 || !sees) {
      if (--this.pathTimer <= 0 || !this.path) { this.pathTimer = 20; this.setPathTo(t.x, t.y, t.z, this.chaseSpeed); }
    } else {
      this.path = null;
      // face the target, strafe around
      const yaw = (Math.atan2(t.z - this.z, t.x - this.x) * 180) / Math.PI - 90;
      this.yaw = yaw;
      if (++this.strafeTimer > 30) { this.strafeTimer = 0; if (rng.next() < 0.3) this.strafeDir *= -1; }
      this.strafe = 0.5 * this.strafeDir;
      this.forward = d < 6 ? -0.5 : d > 10 ? 0.5 : 0;
      this.aiSpeed = this.chaseSpeed;
      if (this.collidedH && this.onGround) this.jumping = true;
    }
    if (sees && d < 16 && --this.shootTimer <= 0) {
      this.shootTimer = 20 + rng.int(40);
      const a = new Arrow(this.world, this.game, this);
      const ey = this.y + this.eyeHeight() - 0.1;
      a.setPos(this.x, ey, this.z);
      const dx = t.x - this.x, dz = t.z - this.z;
      const dy = t.y + t.height / 3 - ey;
      const h = Math.hypot(dx, dz);
      a.shoot(dx, dy + h * 0.2, dz, 1.6, 14 - this.game.options.difficulty * 4);
      a.pickup = false;
      a.damageBase = 2 + this.game.options.difficulty * 0.11 + rng.next() * 0.25;
      this.game.addEntity(a);
      this.game.audio.play('bow', this, 1, 1 / (rng.next() * 0.4 + 0.8));
    }
  }
  override drops(): ItemStack[] {
    return [stack(I.ARROW, rng.int(3)), stack(I.BONE, rng.int(3))].filter((s) => s.count > 0);
  }
}

export class Creeper extends Monster {
  typeName = 'Creeper';
  override model = 'creeper';
  override skin = 'creeper';
  override hurtName = 'creeper.hurt';
  override deathName = 'creeper.hurt';
  override speedAttr = 0.25;
  override chaseSpeed = 0.25 * 0.25;
  swell = 0;
  swellDir = 0;
  fuse = 30;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.7;
    this.maxHealth = this.health = 20;
  }
  override eyeHeight() { return 1.45; }
  override chase(t: LivingEntity) {
    const d = this.distanceTo(t);
    this.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
    if (d < 3 && this.canSee(t)) {
      this.swellDir = 1;
      this.path = null;
    } else if (d > 7 || !this.canSee(t)) this.swellDir = -1;
    if (this.swellDir <= 0) super.chase(t);
    else { this.forward = 0; this.attackCooldown = 20; }
  }
  override ai() {
    super.ai();
    if (!this.target) this.swellDir = -1;
    if (this.swellDir > 0 && this.swell === 0) this.game.audio.play('fuse', this, 1, 0.5);
    this.swell = Math.max(0, this.swell + this.swellDir);
    if (this.swell >= this.fuse) {
      this.swell = this.fuse;
      this.removed = true;
      this.dead = true;
      this.game.interact!.explode(this.x, this.y, this.z, 3, false, this);
    }
  }
  override drops(): ItemStack[] {
    return [stack(I.GUNPOWDER, rng.int(3))].filter((s) => s.count > 0);
  }
}

export class Spider extends Monster {
  typeName = 'Spider';
  override model = 'spider';
  override skin = 'spider';
  override sayName = 'spider.say';
  override hurtName = 'spider.say';
  override deathName = 'spider.say';
  override speedAttr = 0.3;
  override chaseSpeed = 0.3 * 0.3;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1.4; this.height = 0.9;
    this.maxHealth = this.health = 16;
    this.attackDamage = 2;
  }
  override eyeHeight() { return 0.65; }
  override ai() {
    // neutral in bright light unless provoked
    const [sky, blk] = this.world.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    const bright = Math.max(this.game.isDaytime() ? sky : 0, blk) > 11;
    if (bright && !this.lastAttacker && this.target && rng.int(100) === 0) this.target = null;
    if (bright && !this.lastAttacker) this.wander(0.05);
    else super.ai();
  }
  override chase(t: LivingEntity) {
    super.chase(t);
    const d = this.distanceTo(t);
    if (d > 2 && d < 6 && this.onGround && rng.int(10) === 0) {
      const dx = t.x - this.x, dz = t.z - this.z, h = Math.hypot(dx, dz);
      this.vx = (dx / h) * 0.4 * 0.8 + this.vx * 0.2;
      this.vz = (dz / h) * 0.4 * 0.8 + this.vz * 0.2;
      this.vy = 0.4;
    }
  }
  override isOnLadder() { return this.collidedH; }
  override drops(): ItemStack[] {
    const out = [stack(I.STRING, rng.int(3))].filter((s) => s.count > 0);
    if (rng.int(3) === 0) out.push(stack(I.SPIDER_EYE));
    return out;
  }
}

// ------------------------------------------------------------------ passive
abstract class Animal extends Mob {
  temptItems: number[] = [I.WHEAT];
  override xp = 1 + rng.int(3);

  override ai() {
    const p = this.game.player;
    if (this.panicTicks > 0) {
      if (!this.path || rng.int(20) === 0) {
        const tx = this.x + rng.int(11) - 5, tz = this.z + rng.int(11) - 5;
        this.setPathTo(tx, this.y, tz, this.speedAttr * this.speedAttr * 1.25 * 1.6);
      }
      return;
    }
    // breeding: find partner in love
    if (this.loveTicks > 0) {
      const mate = this.game.entities.find((e) => e !== this && e.constructor === this.constructor && (e as Animal).loveTicks > 0 && !(e as Animal).dead && e.distanceTo(this) < 8) as Animal | undefined;
      if (mate) {
        this.lookTarget = mate;
        if (this.distanceTo(mate) > 1.8) this.moveToward(mate.x, mate.z, this.speedAttr * this.speedAttr);
        else if (this.id < mate.id) {
          this.loveTicks = mate.loveTicks = 0;
          this.breedCooldown = mate.breedCooldown = 6000;
          const baby = this.game.interact!.spawnMob(this.typeName.toLowerCase(), this.x, this.y, this.z, true);
          if (baby) for (let i = 0; i < 7; i++) this.game.particles?.heart(this.x + rng.next() - 0.5, this.y + 0.8, this.z + rng.next() - 0.5);
          const o = new XpOrb(this.world, this.game, 1 + rng.int(7));
          o.setPos(this.x, this.y + 0.5, this.z);
          this.game.addEntity(o);
        }
        return;
      }
    }
    // tempted by held food
    if (p && !p.dead && this.distanceTo(p) < 10) {
      const held = p.inventory.held();
      if (held && this.temptItems.includes(held.id)) {
        this.lookTarget = { x: p.x, y: p.y + p.eyeHeight(), z: p.z };
        if (this.distanceTo(p) > 2.5) {
          if (--this.pathTimer <= 0) { this.pathTimer = 10; this.setPathTo(p.x, p.y, p.z, this.speedAttr * this.speedAttr * 1.2); }
        } else this.path = null;
        return;
      }
      if (rng.int(200) === 0) { this.lookTarget = { x: p.x, y: p.y + p.eyeHeight(), z: p.z }; this.lookTimer = 40; }
    }
    this.wander(this.speedAttr * this.speedAttr);
  }

  override onDamaged() {
    this.panicTicks = 60;
    this.path = null;
  }

  interact(game: Game, held: ItemStack | null): boolean {
    if (held && this.temptItems.includes(held.id) && !this.baby && this.breedCooldown === 0 && this.loveTicks === 0) {
      this.loveTicks = 600;
      game.interact!.consume(1);
      return true;
    }
    return false;
  }
}

export class Pig extends Animal {
  typeName = 'Pig';
  override model = 'pig';
  override skin = 'pig';
  override sayName = 'pig.say';
  override hurtName = 'pig.say';
  override deathName = 'animal.hurt';
  override temptItems = [I.WHEAT, I.APPLE];
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 0.9;
    this.maxHealth = this.health = 10;
  }
  override eyeHeight() { return 0.6; }
  override drops(burning: boolean): ItemStack[] {
    return [stack(burning ? I.COOKED_PORKCHOP : I.PORKCHOP, 1 + rng.int(3))];
  }
}

export class Cow extends Animal {
  typeName = 'Cow';
  override model = 'cow';
  override skin = 'cow';
  override sayName = 'cow.say';
  override hurtName = 'cow.say';
  override deathName = 'cow.say';
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 1.4;
    this.maxHealth = this.health = 10;
  }
  override eyeHeight() { return 1.3; }
  override drops(burning: boolean): ItemStack[] {
    return [stack(I.LEATHER, rng.int(3)), stack(burning ? I.COOKED_BEEF : I.BEEF, 1 + rng.int(3))].filter((s) => s.count > 0);
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held && held.id === I.BUCKET && !this.baby) {
      const p = game.player!;
      if (p.creative) p.inventory.add(stack(I.MILK_BUCKET));
      else if (held.count === 1) p.inventory.setHeld(stack(I.MILK_BUCKET));
      else { held.count--; p.inventory.add(stack(I.MILK_BUCKET)); }
      game.audio.play('splash', this, 0.3, 1.5);
      return true;
    }
    return super.interact(game, held);
  }
}

const WOOL_RGB: Record<number, [number, number, number]> = {
  0: [1, 1, 1], 7: [0.25, 0.27, 0.28], 8: [0.6, 0.6, 0.58], 15: [0.1, 0.1, 0.12], 12: [0.45, 0.3, 0.18], 6: [0.95, 0.6, 0.7],
};
export class Sheep extends Animal {
  typeName = 'Sheep';
  override model = 'sheep';
  override skin = 'sheep';
  override sayName = 'sheep.say';
  override hurtName = 'sheep.say';
  override deathName = 'sheep.say';
  sheared = false;
  color = 0;
  eatTimer = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 1.3;
    this.maxHealth = this.health = 8;
    const r = rng.int(100);
    this.color = r < 5 ? 15 : r < 10 ? 7 : r < 15 ? 8 : r < 18 ? 12 : r < 19 ? 6 : 0;
  }
  get woolColor() { return WOOL_RGB[this.color] ?? [1, 1, 1]; }
  override eyeHeight() { return 1.1; }
  override ai() {
    if (this.eatTimer > 0) {
      this.eatTimer--;
      if (this.eatTimer === 4) {
        const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
        if (this.world.getId(x, y, z) === B.TALL_GRASS) { this.world.set(x, y, z, B.AIR); this.sheared = false; }
        else if (this.world.getId(x, y - 1, z) === B.GRASS) {
          this.game.particles?.blockBreak(x, y - 1, z, B.GRASS, this.game.biomeAt(x, z).grass);
          this.world.set(x, y - 1, z, B.DIRT);
          this.sheared = false;
        }
      }
      return;
    }
    if (rng.int(this.baby ? 50 : 1000) === 0 && this.onGround) {
      const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
      if (this.world.getId(x, y, z) === B.TALL_GRASS || this.world.getId(x, y - 1, z) === B.GRASS) { this.eatTimer = 40; this.path = null; return; }
    }
    super.ai();
  }
  override drops(burning: boolean): ItemStack[] {
    const out = [stack(burning ? I.COOKED_MUTTON : I.MUTTON, 1 + rng.int(2))];
    if (!this.sheared) out.push(stack(WOOL_COLORS[this.color]));
    return out;
  }
  override interact(game: Game, held: ItemStack | null): boolean {
    if (held && getItem(held.id).tool?.type === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      const n = 1 + rng.int(3);
      for (let i = 0; i < n; i++) {
        const e = game.dropItem(this.x, this.y + 1, this.z, stack(WOOL_COLORS[this.color]));
        if (e) { e.vy += rng.next() * 0.05; e.vx += (rng.next() - rng.next()) * 0.1; e.vz += (rng.next() - rng.next()) * 0.1; }
      }
      game.interact!.damageHeld(1);
      game.audio.play('dig.cloth', this, 1, 1);
      return true;
    }
    return super.interact(game, held);
  }
  override extraJSON() { return { sheared: this.sheared, color: this.color }; }
  override loadExtra(d: Record<string, unknown>) { this.sheared = !!d.sheared; this.color = (d.color as number) ?? 0; }
}

export class Chicken extends Animal {
  typeName = 'Chicken';
  override model = 'chicken';
  override skin = 'chicken';
  override sayName = 'chicken.say';
  override hurtName = 'chicken.say';
  override deathName = 'chicken.say';
  override temptItems = [I.WHEAT_SEEDS, I.PUMPKIN_SEEDS];
  flap = 0;
  flapSpeed = 0;
  eggTimer = 6000 + rng.int(6000);
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.4; this.height = 0.7;
    this.maxHealth = this.health = 4;
  }
  override eyeHeight() { return 0.644; }
  override tick() {
    super.tick();
    if (this.dead) return;
    this.flapSpeed += (this.onGround ? -1 : 4) * 0.3;
    this.flapSpeed = Math.max(0, Math.min(1, this.flapSpeed));
    if (!this.onGround) this.flap += 1.2;
    if (!this.onGround && this.vy < 0) this.vy *= 0.6;
    this.fallDistance = 0;
    if (!this.baby && --this.eggTimer <= 0) {
      this.game.audio.play('pop', this, 1, (rng.next() - rng.next()) * 0.2 + 1);
      this.game.dropItem(this.x, this.y, this.z, stack(I.EGG));
      this.eggTimer = 6000 + rng.int(6000);
    }
  }
  override drops(burning: boolean): ItemStack[] {
    return [stack(I.FEATHER, rng.int(3)), stack(burning ? I.COOKED_CHICKEN : I.CHICKEN)].filter((s) => s.count > 0);
  }
}

// ------------------------------------------------------------------ enderman & slime
const CARRYABLE = [B.GRASS, B.DIRT, B.SAND, B.GRAVEL, B.DANDELION, B.POPPY, B.PUMPKIN, B.MELON, B.CLAY, B.CACTUS, B.RED_MUSHROOM, B.BROWN_MUSHROOM];

export class Enderman extends Monster {
  typeName = 'Enderman';
  override model = 'enderman';
  override skin = 'enderman';
  override sayName = 'enderman.idle';
  override hurtName = 'enderman.hurt';
  override deathName = 'enderman.death';
  override speedAttr = 0.3;
  override chaseSpeed = 0.3 * 0.3;
  override canBreathe = true;
  carried = 0;
  private stareTicks = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 2.9;
    this.maxHealth = this.health = 40;
    this.attackDamage = 7;
  }
  override eyeHeight() { return 2.55; }
  /** Is the player looking at our head? */
  private stared(): boolean {
    const p = this.game.player;
    if (!p || p.dead || p.creative || p.spectator) return false;
    const held = p.inventory.armor[0];
    if (held && held.id === B.PUMPKIN) return false;
    const eye = this.game.eyePos(1);
    const d = this.game.lookVec(p.yaw, p.pitch);
    const tx = this.x - eye.x, ty = this.y + this.eyeHeight() - eye.y, tz = this.z - eye.z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist > 64) return false;
    const dot = (tx * d.x + ty * d.y + tz * d.z) / dist;
    return dot > 1 - 0.025 / dist && this.canSee(p);
  }
  override ai() {
    const p = this.game.player;
    if (!this.target && this.stared()) {
      if (++this.stareTicks > 5) { this.target = p; this.game.audio.play('enderman.stare', this, 1.5, 1); }
    } else this.stareTicks = 0;
    if (this.target) {
      if (this.target.dead || (this.target as { creative?: boolean }).creative || this.distanceTo(this.target) > 64) this.target = null;
      else {
        this.chase(this.target);
        if (this.distanceTo(this.target) > 16 && rng.int(30) === 0) this.teleportTowards(this.target);
      }
    } else this.wander(0.04, 150);
    // water hurts: teleport away
    if (this.inWater || (this.game.weather?.rainAt(this.x, this.y + 2, this.z) && this.game.dimension === 'overworld')) {
      if (this.age % 10 === 0) { this.damage(1, 'drown'); this.teleportRandom(); }
    }
    // block griefing
    if (rng.int(this.carried ? 2000 : 20) === 0) {
      const x = Math.floor(this.x + rng.int(5) - 2), y = Math.floor(this.y + rng.int(3)), z = Math.floor(this.z + rng.int(5) - 2);
      const w = this.world;
      if (!this.carried) {
        const id = w.getId(x, y, z);
        if (CARRYABLE.includes(id)) { this.carried = id; w.set(x, y, z, B.AIR); }
      } else if (w.getId(x, y, z) === B.AIR && BLOCKS[w.getId(x, y - 1, z)].opaque) {
        w.set(x, y, z, this.carried);
        this.carried = 0;
      }
    }
    if (rng.int(200) === 0 && !this.target) this.teleportRandom();
  }
  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    if (source === 'arrow') { this.teleportRandom(); return false; }
    const r = super.damage(amount, source, attacker);
    if (r && attacker instanceof LivingEntity) this.target = attacker;
    if (r && !this.dead && rng.int(3) === 0) this.teleportRandom();
    return r;
  }
  teleportRandom() {
    this.teleportTo(this.x + (rng.next() - 0.5) * 64, this.y + rng.int(64) - 32, this.z + (rng.next() - 0.5) * 64);
  }
  teleportTowards(e: Entity) {
    const dx = this.x - e.x, dz = this.z - e.z, l = Math.hypot(dx, dz) || 1;
    this.teleportTo(this.x + (rng.next() - 0.5) * 8 - (dx / l) * 16, this.y + rng.int(16) - 8, this.z + (rng.next() - 0.5) * 8 - (dz / l) * 16);
  }
  teleportTo(tx: number, ty: number, tz: number): boolean {
    const w = this.world;
    const x = Math.floor(tx), z = Math.floor(tz);
    if (!w.chunkAt(x, z)) return false;
    let y = Math.floor(ty);
    while (y > 1 && !BLOCKS[w.getId(x, y - 1, z)].solid) y--;
    for (let k = 0; k < 3; k++) { const id = w.getId(x, y + k, z); if (BLOCKS[id].solid || BLOCKS[id].fluid) return false; }
    if (!BLOCKS[w.getId(x, y - 1, z)].solid) return false;
    const ox = this.x, oy = this.y, oz = this.z;
    for (let i = 0; i < 32; i++) this.game.particles?.spell(ox + (rng.next() - 0.5), oy + rng.next() * 2.9, oz + (rng.next() - 0.5), 0xcc00fa);
    this.setPos(x + 0.5, y, z + 0.5);
    this.path = null;
    this.game.audio.play('enderman.teleport', { x: ox, y: oy, z: oz }, 1, 1);
    this.game.audio.play('enderman.teleport', this, 1, 1);
    return true;
  }
  override tick() {
    super.tick();
    if (!this.dead && this.age % 3 === 0) this.game.particles?.spell(this.x + (rng.next() - 0.5) * 0.6, this.y + rng.next() * 2.9, this.z + (rng.next() - 0.5) * 0.6, 0xa030d0);
  }
  override drops(): ItemStack[] {
    const out = rng.int(2) ? [stack(I.ENDER_PEARL)] : [];
    if (this.carried) out.push(stack(this.carried));
    return out;
  }
  override extraJSON() { return { carried: this.carried }; }
  override loadExtra(d: Record<string, unknown>) { this.carried = (d.carried as number) ?? 0; }
}

export class Slime extends Mob {
  typeName = 'Slime';
  override model = 'slime';
  override skin = 'slime';
  override hostile = true;
  override hurtName = 'slime.squish';
  override deathName = 'slime.squish';
  override canBreathe = false;
  size = 1;
  squish = 0;
  pSquish = 0;
  private jumpDelay = 20;
  private wasOnGround = false;
  constructor(world: World, game: Game) {
    super(world, game);
    this.setSize([1, 2, 4][rng.int(3)]);
  }
  setSize(s: number) {
    this.size = s;
    this.width = this.height = 0.51 * s;
    this.maxHealth = this.health = s * s;
    this.xp = s;
  }
  override eyeHeight() { return 0.625 * this.height; }
  override preTick() { super.preTick(); this.pSquish = this.squish; }
  override ai() {
    const p = this.game.player;
    const target = p && !p.dead && !p.creative && !p.spectator && this.distanceTo(p) < 16 ? p : null;
    if (target) this.yaw = this.bodyYaw = this.headYaw = (Math.atan2(target.z - this.z, target.x - this.x) * 180) / Math.PI - 90;
    else if (rng.int(80) === 0) this.yaw = rng.next() * 360;
    if (this.onGround && --this.jumpDelay <= 0) {
      this.jumpDelay = rng.int(20) + 10;
      if (target) this.jumpDelay = Math.floor(this.jumpDelay / 3);
      this.jumping = true;
      this.forward = 1;
      this.aiSpeed = 0.2 + this.size * 0.03;
      this.game.audio.play('slime.jump', this, 0.4 * this.size, ((rng.next() - rng.next()) * 0.2 + 1) / 0.8);
    } else if (!this.onGround) {
      this.forward = 1;
      this.aiSpeed = 0.2 + this.size * 0.03;
    }
    if (target && this.size > 1 && this.distanceTo(target) < 0.6 * this.size + 0.8 && this.attackCooldown <= 0 && this.canSee(target)) {
      this.attackCooldown = 20;
      target.damage(this.size, 'mob', this);
    }
  }
  override airSpeed() { return 0.02 * (1 + this.size * 0.3); }
  override tick() {
    super.tick();
    if (this.onGround && !this.wasOnGround) {
      this.squish = -0.5;
      for (let i = 0; i < this.size * 8; i++) this.game.particles?.add({ x: this.x + (rng.next() - 0.5) * this.width, y: this.y + 0.1, z: this.z + (rng.next() - 0.5) * this.width, vy: 0.1, vx: (rng.next() - 0.5) * 0.2, vz: (rng.next() - 0.5) * 0.2, layer: this.game.interact!.spriteLayer('slime_ball'), u0: 0.3, v0: 0.3, u1: 0.5, v1: 0.5, size: 0.06, life: 12 });
    } else if (!this.onGround && this.wasOnGround) this.squish = 1;
    this.squish *= 0.6;
    this.wasOnGround = this.onGround;
  }
  override die(source: DamageSource, attacker: Entity | null) {
    super.die(source, attacker);
    if (this.size > 1) {
      const n = 2 + rng.int(3);
      for (let i = 0; i < n; i++) {
        const c = new Slime(this.world, this.game);
        c.setSize(this.size / 2);
        c.setPos(this.x + ((i % 2) - 0.5) * this.size / 4, this.y + 0.5, this.z + (((i / 2) | 0) - 0.5) * this.size / 4);
        this.game.addEntity(c);
      }
    }
  }
  override drops(): ItemStack[] {
    return this.size === 1 ? [stack(I2.SLIME_BALL, rng.int(3))].filter((s) => s.count > 0) : [];
  }
  override extraJSON() { return { size: this.size }; }
  override loadExtra(d: Record<string, unknown>) { this.setSize((d.size as number) ?? 1); }
}

// ------------------------------------------------------------------ villagers
export interface Trade { cost: [number, number]; cost2?: [number, number]; result: [number, number]; uses: number; max: number }

export class Villager extends Mob {
  typeName = 'Villager';
  override model = 'villager';
  override sayName = 'villager.idle';
  override hurtName = 'villager.hurt';
  override deathName = 'villager.hurt';
  override speedAttr = 0.25;
  profession = 'farmer';
  trades: Trade[] | null = null;
  tradingWith: LivingEntity | null = null;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 20;
  }
  override eyeHeight() { return 1.62; }
  override ai() {
    const p = this.game.player;
    if (this.tradingWith) {
      this.path = null;
      this.lookTarget = { x: this.tradingWith.x, y: this.tradingWith.y + this.tradingWith.eyeHeight(), z: this.tradingWith.z };
      return;
    }
    if (this.panicTicks > 0) {
      if (!this.path || rng.int(20) === 0) this.setPathTo(this.x + rng.int(11) - 5, this.y, this.z + rng.int(11) - 5, 0.06);
      return;
    }
    if (p && !p.dead && this.distanceTo(p) < 8 && rng.int(40) === 0) { this.lookTarget = { x: p.x, y: p.y + p.eyeHeight(), z: p.z }; this.lookTimer = 60; }
    this.wander(0.035, 200);
  }
  override onDamaged() { this.panicTicks = 60; this.path = null; }
  ensureTrades(): Trade[] {
    if (this.trades) return this.trades;
    const r = new Random((this.id * 7919) ^ 0x5eed);
    const t = (cost: [number, number], result: [number, number], cost2?: [number, number]): Trade => ({ cost, cost2, result, uses: 0, max: 7 + r.int(6) });
    const E = I.EMERALD;
    const n = (lo: number, hi: number) => lo + r.int(hi - lo + 1);
    const T: Record<string, Trade[]> = {
      farmer: [t([I.WHEAT, n(18, 22)], [E, 1]), t([E, 1], [I.BREAD, n(4, 6)]), t([E, 1], [I.APPLE, n(4, 6)]), t([B.PUMPKIN, n(8, 13)], [E, 1]), t([E, 1], [I.COOKIE, n(7, 10)])],
      librarian: [t([I.PAPER, n(24, 36)], [E, 1]), t([I.BOOK, n(8, 10)], [E, 1]), t([E, n(3, 4)], [B.BOOKSHELF, 1]), t([E, 1], [B.GLASS, n(3, 5)]), t([E, n(8, 10)], [I.COMPASS, 1])],
      priest: [t([I.ROTTEN_FLESH, n(36, 40)], [E, 1]), t([E, 1], [I.REDSTONE, n(1, 4)]), t([E, 1], [I.LAPIS, n(1, 2)]), t([E, n(4, 7)], [I.ENDER_PEARL, 1]), t([E, n(3, 4)], [I.GLOWSTONE_DUST, n(1, 3)])],
      smith: [t([I.COAL, n(16, 24)], [E, 1]), t([I.IRON_INGOT, n(7, 9)], [E, 1]), t([E, n(7, 9)], [TOOLS.iron_pickaxe, 1]), t([E, n(9, 12)], [TOOLS.iron_sword, 1]), t([E, n(12, 15)], [TOOLS.diamond_axe, 1])],
      butcher: [t([I.PORKCHOP, n(14, 18)], [E, 1]), t([I.CHICKEN, n(14, 18)], [E, 1]), t([E, 1], [I.COOKED_PORKCHOP, n(5, 7)]), t([E, 1], [I.COOKED_BEEF, n(5, 7)])],
    };
    this.trades = T[this.profession] ?? T.farmer;
    return this.trades;
  }
  interact(game: Game, held: ItemStack | null): boolean {
    void held;
    if (this.baby || this.dead) return false;
    this.ensureTrades();
    game.audio.play('villager.trade', this, 1, 1);
    this.tradingWith = game.player;
    game.ui.openTrade(this);
    return true;
  }
  override despawnCheck() {}
  override extraJSON() { return { profession: this.profession, trades: this.trades }; }
  override loadExtra(d: Record<string, unknown>) { this.profession = (d.profession as string) ?? 'farmer'; this.trades = (d.trades as Trade[]) ?? null; }
}

// ------------------------------------------------------------------ nether
export class ZombiePigman extends Monster {
  typeName = 'Zombie Pigman';
  override skin = 'pigman';
  override sayName = 'pigman.say';
  override hurtName = 'pigman.hurt';
  override deathName = 'pigman.hurt';
  override speedAttr = 0.23;
  override chaseSpeed = 0.23 * 0.23 * 1.1;
  override heldItem = 0;
  override fireImmune = true;
  override canBreathe = true;
  anger = 0;
  override holding = true;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.6; this.height = 1.95;
    this.maxHealth = this.health = 20;
    this.attackDamage = 5;
    this.heldItem = goldSword();
  }
  override eyeHeight() { return 1.74; }
  get armsPose() { return this.anger > 0 ? 'zombie' : undefined; }
  override ai() {
    if (this.anger > 0) {
      this.anger--;
      if (!this.target || this.target.dead) { const p = this.game.player; if (p && !p.creative && !p.dead && this.distanceTo(p) < 40) this.target = p; }
      if (this.target) this.chase(this.target);
      return;
    }
    this.target = null;
    this.wander(0.03);
  }
  override onDamaged(attacker: Entity | null) {
    if (!attacker) return;
    const who = (attacker as unknown as { shooter?: Entity }).shooter ?? attacker;
    if (!(who instanceof LivingEntity)) return;
    // the whole group gets angry
    for (const e of this.game.entities) if (e instanceof ZombiePigman && e.distanceTo(this) < 32) { e.anger = 400 + rng.int(400); e.target = who; }
    this.game.audio.play('pigman.angry', this, 1, 1);
  }
  override drops(): ItemStack[] {
    return [stack(I.ROTTEN_FLESH, rng.int(2)), stack(I.GOLD_NUGGET, rng.int(2))].filter((s) => s.count > 0);
  }
  override despawnCheck() {}
}

export class Ghast extends Mob {
  typeName = 'Ghast';
  override model = 'ghast';
  override skin = 'ghast';
  override hostile = true;
  override sayName = 'ghast.moan';
  override hurtName = 'ghast.scream';
  override deathName = 'ghast.death';
  override fireImmune = true;
  override canBreathe = true;
  override xp = 5;
  shooting = false;
  private attack = 0;
  private course = { x: 0, y: 0, z: 0 };
  private courseTimer = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 4; this.height = 4;
    this.maxHealth = this.health = 10;
    this.soundPitch = 0.7;
  }
  override eyeHeight() { return 2.6; }
  override gravity() { return 0; }
  override isFlying() { return true; }
  override ai() {
    // wander through the air
    const dx = this.course.x - this.x, dy = this.course.y - this.y, dz = this.course.z - this.z;
    const d = Math.hypot(dx, dy, dz);
    if (--this.courseTimer <= 0 || d < 1 || d > 60) {
      this.courseTimer = rng.int(5) + 2;
      if (d < 1 || d > 60 || rng.int(20) === 0) this.course = { x: this.x + (rng.next() * 2 - 1) * 16, y: this.y + (rng.next() * 2 - 1) * 16, z: this.z + (rng.next() * 2 - 1) * 16 };
    } else {
      this.vx += (dx / d) * 0.1 * 0.1; this.vy += (dy / d) * 0.1 * 0.1; this.vz += (dz / d) * 0.1 * 0.1;
    }
    const p = this.game.player;
    const target = p && !p.dead && !p.creative && !p.spectator && this.distanceTo(p) < 64 ? p : null;
    if (target) {
      this.lookTarget = { x: target.x, y: target.y + target.eyeHeight(), z: target.z };
      this.bodyYaw = this.yaw = (Math.atan2(target.z - this.z, target.x - this.x) * 180) / Math.PI - 90;
      if (this.canSee(target)) {
        this.attack++;
        if (this.attack === 10) this.game.audio.play('ghast.charge', this, 3, 1);
        if (this.attack === 20) {
          const ex = this.x, ey = this.y + 2, ez = this.z;
          const tx = target.x - ex, ty = target.y + target.height / 2 - ey, tz = target.z - ez;
          const f = new Fireball(this.world, this.game, this, tx, ty, tz);
          const l = Math.hypot(tx, ty, tz);
          f.setPos(ex + (tx / l) * 4, ey - 0.5, ez + (tz / l) * 4);
          this.game.addEntity(f);
          this.game.audio.play('ghast.fireball', this, 3, 1);
          this.attack = -40;
        }
      } else if (this.attack > 0) this.attack--;
    } else if (this.attack > 0) this.attack--;
    this.shooting = this.attack > 10;
  }
  override travel() {
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.91; this.vy *= 0.91; this.vz *= 0.91;
  }
  override drops(): ItemStack[] {
    return [stack(I.GHAST_TEAR, rng.int(2)), stack(I.GUNPOWDER, rng.int(3))].filter((s) => s.count > 0);
  }
}

function goldSword(): number {
  return TOOLS.golden_sword ?? 0;
}

export function woolRgb(color: number) {
  return WOOL_RGB[color] ?? [1, 1, 1];
}
void idOf;
