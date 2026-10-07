/** Combat rules the player calls into (filled in by combat.ts when it loads: importing it here would make a cycle). */
export const playerHooks = {
  combatTick: (_p: Player) => {},
  shieldBlocks: (_g: import('./game').Game, _p: Player, _amount: number, _source: DamageSource, _attacker: Entity | null) => false,
  useTotem: (_g: import('./game').Game, _p: Player, _source: DamageSource) => false,
  vanishOnDeath: (_p: Player) => {},
  soulSpeed: (_p: Player) => 1,
};
import { live } from '../mod/hooks';
import { getItem } from './items';
import { LivingEntity, DamageSource } from '../entity/living';
import type { Entity } from '../entity/entity';
import type { World } from '../world/world';
import { Inventory } from './inventory';
import { I6 } from './items';
import type { Mount } from '../entity/mount';

export enum GameMode { Survival = 0, Creative = 1, Adventure = 2, Spectator = 3 }

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // left positive
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export class Player extends LivingEntity {
  inventory = new Inventory();
  /** Shown above the player's head to everyone else (multiplayer). */
  name = '';
  /** Skin: a built-in id or an imported PNG (data URL); `slim` = 3-pixel arms for imported ones. */
  look = 'steve';
  slim = false;
  gameMode = GameMode.Survival;
  flying = false;
  food = 20;
  saturation = 5;
  exhaustion = 0;
  foodTimer = 0;
  xpLevel = 0;
  xpProgress = 0;
  xpTotal = 0;
  spawnX = 0; spawnY = 80; spawnZ = 0;
  difficulty = 2; // 0 peaceful .. 3 hard
  sleeping = false;
  /** Parrots riding on the shoulders (variant, health and owner, to put back into the world). */
  shoulderLeft: { variant: number; health: number; ownerName: string } | null = null;
  shoulderRight: { variant: number; health: number; ownerName: string } | null = null;
  /** 1.9 combat: ticks since the last swing (or since the held item changed), and which item that was. */
  attackTicks = 0;
  lastHeldId = 0;
  /** Holding a shield up (and ticks until an axe-disabled shield works again). */
  blocking = false;
  shieldCooldown = 0;
  /** What's being used with the button held ('bow', 'shield', 'crossbow', 'trident', ''), for poses. */
  using = '';
  useTicks = 0;
  /** Spinning along after a riptide throw (client). */
  riptideTicks = 0;
  /** Ticks since the player last slept (phantoms come after three days). */
  restTicks = 0;
  sleepTimer = 0;
  eatingTicks = 0;
  distWalked = 0;
  pDistWalked = 0;
  cameraYaw = 0; // bob strength
  pCameraYaw = 0;
  cameraPitch = 0;
  pCameraPitch = 0;
  sprintToggleTimer = 0;
  flyToggleTimer = 0;
  eyeOffset = 1.62;
  pEyeOffset = 1.62;
  deathMessage = '';
  onDamaged: (src: DamageSource, amount: number) => void = () => {};
  onDeath: (msg: string) => void = () => {};
  prevHealth = 20;
  hurtFlash = 0; // health bar flashing ticks
  lastHurtDirection = 0;
  portalCooldown = 0;
  score = 0;
  riding: Mount | null = null;
  /**
   * The client's copy of its own player: it walks, jumps and collides here for instant response, but health,
   * hunger, damage and effects are the server's (they arrive with the player's status every tick).
   */
  clientSide = false;
  /** Jumps since the client last reported in (the server charges hunger for them). */
  jumps = 0;
  fishHook: { reel(): number; discard(): void; x: number; y: number; z: number } | null = null;
  /** Gliding on elytra (the client decides, the server follows); ticks spent gliding, for the model's pose. */
  gliding = false;
  glideTicks = 0;
  /** Ticks a firework rocket still pulls a glider along (told by the server, applied by the client). */
  rocketBoost = 0;
  /** Damage from flying into a wall this tick, felt by the client and reported to the server. */
  wallHit = 0;
  private jumpWasDown = false;

  constructor(world: World) {
    super(world);
    this.width = 0.6;
    this.height = 1.8;
  }

  get creative() { return this.gameMode === GameMode.Creative; }
  get spectator() { return this.gameMode === GameMode.Spectator; }
  get canFly() { return this.gameMode === GameMode.Creative || this.gameMode === GameMode.Spectator; }

  override eyeHeight() { return this.eyeOffset; }
  /** Where the eyes are heading: lower while sneaking, near the ground while gliding (or stuck 0.6 tall after it). */
  eyeTarget() { return this.height < 1 ? 0.4 : this.sneaking ? 1.54 : 1.62; }
  /** Wearing elytra that aren't worn out (they stop working one point short of breaking). */
  hasElytra() {
    const c = this.inventory.armor[1];
    return !!c && c.id === I6.ELYTRA && (c.damage ?? 0) < 431;
  }
  /** Gliding stops on landing, in water or lava, when flying, riding, climbing, or without working elytra. */
  canGlide() {
    return !this.onGround && !this.flying && !this.inWater && !this.inLava && !this.riding && !this.dead && this.hasElytra() && !this.isOnLadder();
  }
  /**
   * Gliding makes the player 0.6 blocks tall (through one-block gaps, like 1.12). Afterwards they stand up again
   * once there's room for it, and crawl until then.
   */
  updatePose() {
    let h = 1.8;
    if (this.gliding) h = 0.6;
    else if (this.height < 1.8) {
      const b = this.box;
      if (this.collisions({ ...b, y1: b.y0 + 1.8 }).length) h = 0.6;
    }
    this.height = h;
  }
  override isFlying() { return this.flying; }
  override groundSpeed() { return this.moveSpeed * (this.sprinting ? 1.3 : 1) * playerHooks.soulSpeed(this) * (this.blocking || this.using === 'bow' || this.using === 'crossbow' || this.using === 'trident' ? 0.2 : 1); }
  /** Armour toughness (1.9): diamond 2 a piece, netherite 3. */
  override armorToughness() { return this.inventory.armor.reduce((t, s) => t + (s ? getItem(s.id).armor?.toughness ?? 0 : 0), 0); }
  override airSpeed() {
    if (this.flying) return 0.05 * (this.sprinting ? 2 : 1);
    return this.sprinting ? 0.026 : 0.02;
  }

  setGameMode(m: GameMode) {
    this.gameMode = m;
    this.noClip = m === GameMode.Spectator;
    if (m === GameMode.Spectator) this.flying = true;
    else if (m !== GameMode.Creative) this.flying = false;
  }

  applyInput(inp: MoveInput) {
    this.sneaking = inp.sneak && !this.flying;
    let fwd = inp.forward, str = inp.strafe;
    if (this.sneaking || (this.height < 1 && !this.gliding)) { fwd *= 0.3; str *= 0.3; }
    // pressing jump in mid-air spreads the elytra
    if (inp.jump && !this.jumpWasDown && !this.gliding && this.canGlide()) this.gliding = true;
    this.jumpWasDown = inp.jump;
    if (this.eatingTicks > 0) { fwd *= 0.2; str *= 0.2; }
    this.forward = fwd;
    this.strafe = str;
    this.jumping = inp.jump;
    // sprinting rules
    const canSprint = (this.food > 6 || this.canFly) && !this.sneaking && fwd >= 0.8 && this.eatingTicks === 0 && this.height > 1;
    if (inp.sprint && canSprint && !this.collidedH) this.sprinting = true;
    if (!canSprint || this.collidedH) this.sprinting = false;
    if (this.flying) {
      if (inp.sneak) this.vy -= 0.15;
      if (inp.jump) this.vy += 0.15;
      if (this.onGround && !this.spectator) this.flying = false;
    }
  }

  override tick() {
    if (this.riding) {
      if (this.gliding) { this.gliding = false; this.updatePose(); }
      this.bodyYaw = this.riding.bodyFollows ? this.riding.yaw : this.yaw;
      this.headYaw = this.yaw;
      this.pEyeOffset = this.eyeOffset;
      this.eyeOffset = 1.62;
      this.pDistWalked = this.distWalked;
      this.pCameraYaw = this.cameraYaw;
      this.cameraYaw *= 0.5;
      this.prevHealth = this.health;
      this.armor = this.inventory.armorPoints();
      this.environment();
      this.updateSwing();
      if (this.hurtTime > 0) this.hurtTime--;
      if (this.invulnerable > 0) this.invulnerable--;
      if (!this.canFly) this.foodTick();
      return;
    }
    this.updateGlide();
    this.pEyeOffset = this.eyeOffset;
    this.eyeOffset += (this.eyeTarget() - this.eyeOffset) * 0.5;
    this.pDistWalked = this.distWalked;
    this.pCameraYaw = this.cameraYaw;
    this.pCameraPitch = this.cameraPitch;
    this.prevHealth = this.health;
    const ox = this.x, oy = this.y, oz = this.z;
    if (this.dead) {
      this.deathTime++;
      this.updateSwing();
      return;
    }
    this.armor = this.inventory.armorPoints();
    playerHooks.combatTick(this);
    this.livingTick();
    // walking distance for bobbing / hunger
    const dx = this.x - ox, dz = this.z - oz;
    const hd = Math.sqrt(dx * dx + dz * dz);
    let bob = Math.min(0.1, hd);
    if (!this.onGround || this.health <= 0) bob = 0;
    this.cameraYaw += (bob - this.cameraYaw) * 0.4;
    let tilt = Math.atan(-this.vy * 0.2) * 15;
    if (this.onGround || this.health <= 0) tilt = 0;
    this.cameraPitch += (tilt - this.cameraPitch) * 0.8;
    if (this.onGround && !this.flying) this.distWalked += hd * 0.6;
    this.turnBody(dx, dz);
    // exhaustion
    if (!this.canFly) {
      const d = Math.sqrt(dx * dx + (this.y - oy) ** 2 + dz * dz);
      if (this.inWater) this.exhaust(0.015 * d);
      else if (this.onGround && this.sprinting) this.exhaust(0.1 * hd);
      this.foodTick();
    }
    if (this.hurtFlash > 0) this.hurtFlash--;
  }

  /** Keep gliding while it's possible; count its ticks and the rocket's pull; size the player to match. */
  updateGlide() {
    if (this.gliding && !this.canGlide()) this.gliding = false;
    this.glideTicks = this.gliding ? this.glideTicks + 1 : 0;
    if (this.rocketBoost > 0) this.rocketBoost--;
    this.updatePose();
  }

  /** Vanilla's elytra flight (1.12 EntityLivingBase.travel): look down to dive and gain speed, up to climb it off. */
  override travel(strafe: number, forward: number) {
    if (!this.gliding) { super.travel(strafe, forward); return; }
    const yaw = (this.yaw * Math.PI) / 180, pitch = (this.pitch * Math.PI) / 180;
    const lx = -Math.sin(yaw) * Math.cos(pitch), ly = -Math.sin(pitch), lz = Math.cos(yaw) * Math.cos(pitch);
    if (this.rocketBoost > 0) {
      // a rocket pulls toward 1.5 blocks a tick along the look
      this.vx += lx * 0.1 + (lx * 1.5 - this.vx) * 0.5;
      this.vy += ly * 0.1 + (ly * 1.5 - this.vy) * 0.5;
      this.vz += lz * 0.1 + (lz * 1.5 - this.vz) * 0.5;
    }
    if (this.vy > -0.5) this.fallDistance = 1;
    const h = Math.hypot(lx, lz), speed = Math.hypot(this.vx, this.vz);
    const lift = Math.cos(pitch) ** 2 * Math.min(1, Math.hypot(lx, ly, lz) / 0.4);
    this.vy += -0.08 + lift * 0.06;
    if (this.vy < 0 && h > 0) {
      const d = this.vy * -0.1 * lift;
      this.vy += d;
      this.vx += (lx * d) / h;
      this.vz += (lz * d) / h;
    }
    if (pitch < 0 && h > 0) {
      const d = speed * -Math.sin(pitch) * 0.04;
      this.vy += d * 3.2;
      this.vx -= (lx * d) / h;
      this.vz -= (lz * d) / h;
    }
    if (h > 0) {
      this.vx += ((lx / h) * speed - this.vx) * 0.1;
      this.vz += ((lz / h) * speed - this.vz) * 0.1;
    }
    this.vx *= 0.99;
    this.vy *= 0.98;
    this.vz *= 0.99;
    this.move(this.vx, this.vy, this.vz);
    if (this.collidedH) {
      const hurt = (speed - Math.hypot(this.vx, this.vz)) * 10 - 3;
      if (hurt > 0) this.wallHit = Math.max(this.wallHit, hurt);
    }
  }

  /** Vanilla body turning: the head looks where you look, the body eases toward the way you walk (or
   * where you look when swinging) and never lets the head twist more than 75° from it. */
  protected turnBody(dx: number, dz: number) {
    this.headYaw = this.yaw;
    if (this.gliding) { this.bodyYaw = this.yaw; return; }
    let target = this.bodyYaw;
    if (dx * dx + dz * dz > 0.0025) {
      target = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
      // walking backwards keeps the body facing forwards (1.9+)
      if (Math.abs(wrapDeg(target - this.yaw)) > 95) target += 180;
    }
    if (this.swingProgress > 0) target = this.yaw;
    this.bodyYaw += wrapDeg(target - this.bodyYaw) * 0.3;
    let twist = wrapDeg(this.yaw - this.bodyYaw);
    twist = Math.max(-75, Math.min(75, twist));
    this.bodyYaw = this.yaw - twist;
    if (twist * twist > 2500) this.bodyYaw += twist * 0.2;
  }

  exhaust(n: number) {
    if (this.canFly || this.clientSide) return;
    this.exhaustion = Math.min(40, this.exhaustion + n);
  }

  foodTick() {
    if (this.clientSide) return;
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (this.difficulty > 0) this.food = Math.max(0, this.food - 1);
    }
    if (this.difficulty === 0) {
      if (this.health < this.maxHealth && this.age % 20 === 0) this.heal(1);
      if (this.food < 20 && this.age % 10 === 0) this.food++;
    }
    if (this.food >= 18 && this.health < this.maxHealth && this.health > 0) {
      this.foodTimer++;
      if (this.foodTimer >= 80) {
        this.heal(1);
        this.exhaust(3);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      this.foodTimer++;
      if (this.foodTimer >= 80) {
        if (this.health > 10 || this.difficulty >= 3 || (this.health > 1 && this.difficulty >= 2)) this.damage(1, 'starve');
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
  }

  eat(hunger: number, saturation: number) {
    this.food = Math.min(20, this.food + hunger);
    this.saturation = Math.min(this.food, this.saturation + saturation);
  }

  override exhaustEffect(n: number) { this.exhaust(n); }
  override depthStrider() { return this.inventory.armor[3]?.ench?.depth_strider ?? 0; }
  /** Respiration: level/(level+1) chance to keep air each tick underwater. */
  override keepAir() {
    const r = this.inventory.armor[0]?.ench?.respiration ?? 0;
    return r > 0 && Math.random() < r / (r + 1);
  }

  override jump() {
    super.jump();
    this.jumps++;
    this.exhaust(this.sprinting ? 0.2 : 0.05);
  }

  override environment() { if (!this.clientSide) super.environment(); }
  /** A player's client moves it, sub-levels included (the server's copy just follows). */
  override ridesShips() { return this.clientSide; }
  override tickEffects() { if (!this.clientSide) super.tickEffects(); }
  override onLand(fall: number) { if (!this.clientSide) super.onLand(fall); }

  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    if (this.clientSide) return false;
    if (this.canFly && source !== 'void' && source !== 'kill') return false;
    if (this.dead) return false;
    if (this.difficulty === 0 && (source === 'mob')) return false;
    if (source === 'mob' && this.difficulty === 1) amount = Math.min(amount / 2 + 1, amount);
    if (source === 'mob' && this.difficulty === 3) amount *= 1.5;
    // enchantment protection (EPF, capped at 20 -> 80%)
    if (source !== 'void' && source !== 'kill' && source !== 'starve') {
      let epf = 0;
      const typed = (lvl: number, mul: number) => (lvl ? Math.floor(((6 + lvl * lvl) * mul) / 3) : 0);
      for (const a of this.inventory.armor) {
        const e = a?.ench;
        if (!e) continue;
        epf += typed(e.protection ?? 0, 0.75);
        if (source === 'fall') epf += typed(e.feather_falling ?? 0, 2.5);
        if (source === 'fire' || source === 'lava') epf += typed(e.fire_protection ?? 0, 1.25);
        if (source === 'explosion') epf += typed(e.blast_protection ?? 0, 1.5);
        if (source === 'arrow') epf += typed(e.projectile_protection ?? 0, 1.5);
      }
      if (epf) amount *= 1 - Math.min(20, epf) / 25;
    }
    // a raised shield takes hits from the front
    if (live.game && playerHooks.shieldBlocks(live.game, this, amount, source, attacker ?? null)) return false;
    const before = this.health;
    const r = super.damage(amount, source, attacker);
    if (r && attacker && (source === 'mob' || source === 'player')) {
      // Thorns: 15% chance per level to hurt the attacker for 1-4
      const th = this.inventory.armor.reduce((m, a) => Math.max(m, a?.ench?.thorns ?? 0), 0);
      const le = attacker as unknown as { damage?: (n: number, s: DamageSource, a: Entity | null) => boolean };
      if (th && Math.random() < 0.15 * th && le.damage) le.damage(1 + Math.floor(Math.random() * 4), 'thorns', this);
    }
    if (r) {
      this.exhaust(0.3);
      this.hurtFlash = 10;
      this.onDamaged(source, before - this.health);
      if (attacker) this.lastHurtDirection = (Math.atan2(attacker.z - this.z, attacker.x - this.x) * 180) / Math.PI - this.yaw;
    }
    return r;
  }

  override die(source: DamageSource, attacker: Entity | null) {
    // a totem of undying in either hand: not today
    if (live.game && playerHooks.useTotem(live.game, this, source)) return;
    playerHooks.vanishOnDeath(this);
    super.die(source, attacker);
    const who = attacker ? (attacker as unknown as { typeName?: string }).typeName ?? 'something' : '';
    const msgs: Record<string, string> = {
      fall: 'Player hit the ground too hard',
      drown: 'Player drowned',
      lava: 'Player tried to swim in lava',
      fire: 'Player burned to death',
      starve: 'Player starved to death',
      void: 'Player fell out of the world',
      cactus: 'Player was pricked to death',
      explosion: attacker ? `Player was blown up by ${who}` : 'Player blew up',
      mob: `Player was slain by ${who}`,
      arrow: `Player was shot by ${who}`,
      suffocate: 'Player suffocated in a wall',
      magic: attacker ? `Player was killed by ${who} using magic` : 'Player was killed by magic',
      thorns: `Player was killed while trying to hurt ${who}`,
      wall: 'Player experienced kinetic energy',
      firework: 'Player went off with a bang',
      anvil: 'Player was squashed by a falling anvil',
      kill: 'Player fell out of the world',
    };
    this.deathMessage = msgs[source] ?? 'Player died';
    this.onDeath(this.deathMessage);
  }

  addXp(n: number) {
    this.xpTotal += n;
    let cap = xpCap(this.xpLevel);
    this.xpProgress += n / cap;
    while (this.xpProgress >= 1) {
      this.xpProgress = (this.xpProgress - 1) * cap;
      this.xpLevel++;
      cap = xpCap(this.xpLevel);
      this.xpProgress /= cap;
    }
  }

  /** Back to life at the spawn point; `keep` (the keepInventory rule) keeps the experience too. */
  respawn(keep = false) {
    this.dead = false;
    this.health = this.maxHealth;
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.fireTicks = 0;
    this.deathTime = 0;
    this.hurtTime = 0;
    this.fallDistance = 0;
    if (!keep) {
      this.xpLevel = 0;
      this.xpProgress = 0;
      this.xpTotal = 0;
    }
    this.clearEffects();
    this.vx = this.vy = this.vz = 0;
    this.gliding = false;
    this.rocketBoost = 0;
    this.height = 1.8;
    this.eyeOffset = this.pEyeOffset = 1.62;
    this.setPos(this.spawnX + 0.5, this.spawnY, this.spawnZ + 0.5);
  }

  toJSON() {
    return {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
      health: this.health, food: this.food, saturation: this.saturation, air: this.air,
      xpLevel: this.xpLevel, xpProgress: this.xpProgress, xpTotal: this.xpTotal,
      gameMode: this.gameMode, flying: this.flying, inventory: this.inventory.toJSON(),
      spawn: [this.spawnX, this.spawnY, this.spawnZ], fireTicks: this.fireTicks,
      effects: [...this.effects.values()], absorption: this.absorption, restTicks: this.restTicks,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  load(d: any) {
    this.setPos(d.x, d.y, d.z);
    this.yaw = d.yaw; this.pitch = d.pitch;
    this.health = d.health; this.food = d.food; this.saturation = d.saturation; this.air = d.air ?? 300;
    this.xpLevel = d.xpLevel ?? 0; this.xpProgress = d.xpProgress ?? 0; this.xpTotal = d.xpTotal ?? 0;
    this.setGameMode(d.gameMode ?? 0);
    this.flying = !!d.flying && this.canFly;
    this.inventory.load(d.inventory);
    if (d.spawn) [this.spawnX, this.spawnY, this.spawnZ] = d.spawn;
    this.fireTicks = d.fireTicks ?? 0;
    this.effects.clear();
    for (const e of d.effects ?? []) this.effects.set(e.id, { ...e });
    this.effectsChanged();
    this.absorption = d.absorption ?? 0;
    this.restTicks = d.restTicks ?? 0;
    if (this.health <= 0) { this.dead = true; }
  }
}

export function xpCap(level: number) {
  if (level >= 30) return 112 + (level - 30) * 9;
  if (level >= 15) return 37 + (level - 15) * 5;
  return 7 + level * 2;
}

function wrapDeg(a: number) {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}
