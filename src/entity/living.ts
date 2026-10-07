import { Entity } from './entity';
import type { World } from '../world/world';
import { BLOCKS, B, B2, metaOf } from '../world/blocks';
import { bubblePush, standingOn, honeySlide, insideBlock } from '../game/blockrules';
import { EFFECTS, potionColor } from '../game/potiondata';
import { Events } from '../mod/events';
import { live } from '../mod/hooks';

export interface ActiveEffect { id: string; amp: number; dur: number }

export type DamageSource = 'generic' | 'fall' | 'drown' | 'lava' | 'fire' | 'mob' | 'player' | 'explosion' | 'starve' | 'void' | 'cactus' | 'arrow' | 'suffocate' | 'kill' | 'magic' | 'thorns' | 'anvil' | 'wall' | 'firework' | 'wither' | 'sweet_berry_bush' | 'hot_floor' | 'trident' | 'sting' | 'dragon_breath' | 'freeze' | 'lightning' | 'soul_fire';

export class LivingEntity extends Entity {
  health = 20;
  maxHealth = 20;
  hurtTime = 0;
  hurtDuration = 10;
  deathTime = 0;
  invulnerable = 0; // hurt resistance ticks
  lastDamage = 0;
  air = 300;
  jumping = false;
  jumpTicks = 0;
  strafe = 0;
  forward = 0;
  moveSpeed = 0.1;
  sprinting = false;
  onLadder = false;
  headYaw = 0;
  pHeadYaw = 0;
  bodyYaw = 0;
  pBodyYaw = 0;
  limbSwing = 0;
  limbSwingAmount = 0;
  pLimbSwingAmount = 0;
  swingProgress = 0;
  pSwingProgress = 0;
  swinging = false;
  swingTicks = 0;
  attackedAtYaw = 0;
  lastAttacker: Entity | null = null;
  armor = 0;
  canBreathe = false; // undead / fish
  fireImmune = false;
  undead = false; // healing potions hurt, harming potions heal
  arthropod = false;
  effects = new Map<string, ActiveEffect>();
  absorption = 0;
  effectColor = 0; // particle colour of active effects (0 = none)
  constructor(world: World) {
    super(world);
    this.stepHeight = 0.6;
  }

  override preTick() {
    super.preTick();
    this.pHeadYaw = this.headYaw;
    this.pBodyYaw = this.bodyYaw;
    this.pLimbSwingAmount = this.limbSwingAmount;
    this.pSwingProgress = this.swingProgress;
  }

  swing() {
    if (!this.swinging || this.swingTicks >= 3 || this.swingTicks < 0) {
      this.swingTicks = -1;
      this.swinging = true;
    }
  }

  updateSwing() {
    if (this.swinging) {
      this.swingTicks++;
      if (this.swingTicks >= 6) { this.swingTicks = 0; this.swinging = false; }
    } else this.swingTicks = 0;
    this.swingProgress = this.swingTicks / 6;
  }

  /** Returns true if damage was applied. */
  damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    if (this.dead || this.health <= 0) return false;
    // mods may cancel damage (server side only: puppets never take any)
    if (Events.entityDamage.any && live.game && this.world.role === 'server' && Events.entityDamage.fire({ game: live.game, entity: this, amount, source }) === 'fail') return false;
    if ((source === 'fire' || source === 'lava') && (this.fireImmune || this.effects.has('fire_resistance'))) return false;
    const res = this.effectAmp('resistance');
    if (res >= 0 && source !== 'void' && source !== 'kill') amount *= Math.max(0, 1 - 0.2 * (res + 1));
    // armor reduces most damage
    if (source !== 'drown' && source !== 'starve' && source !== 'void' && source !== 'fall' && source !== 'suffocate' && source !== 'kill' && source !== 'magic' && source !== 'wall') {
      // 1.9: toughness lets armour hold up against big hits
      const tough = this.armorToughness();
      const eff = Math.min(20, Math.max(this.armor / 5, this.armor - amount / (2 + tough / 4)));
      amount = (amount * (25 - eff)) / 25;
    }
    let applied = amount;
    if (this.invulnerable > this.hurtDuration / 2) {
      if (amount <= this.lastDamage) return false;
      applied = amount - this.lastDamage;
      this.lastDamage = amount;
    } else {
      this.lastDamage = amount;
      this.invulnerable = 20;
      this.hurtTime = this.hurtDuration;
    }
    if (this.absorption > 0 && source !== 'kill') {
      const a = Math.min(this.absorption, applied);
      this.absorption -= a;
      applied -= a;
    }
    this.health -= applied;
    this.onHurt(source, attacker ?? null);
    if (attacker) {
      this.lastAttacker = attacker;
      const dx = attacker.x - this.x, dz = attacker.z - this.z;
      this.knockback(dx, dz, 0.4);
      this.attackedAtYaw = (Math.atan2(dz, dx) * 180) / Math.PI - this.yaw;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.die(source, attacker ?? null);
      if (Events.entityDeath.any && live.game && this.world.role === 'server') Events.entityDeath.fire({ game: live.game, entity: this, source });
    }
    return true;
  }

  knockback(dx: number, dz: number, strength: number) {
    const d = Math.hypot(dx, dz) || 1;
    this.vx /= 2;
    this.vy /= 2;
    this.vz /= 2;
    this.vx -= (dx / d) * strength;
    this.vy += strength;
    this.vz -= (dz / d) * strength;
    if (this.vy > 0.4) this.vy = 0.4;
  }

  onHurt(_source: DamageSource, _attacker: Entity | null) {}
  /** Armour toughness (players: from what they wear). */
  armorToughness() { return 0; }
  die(_source: DamageSource, _attacker: Entity | null) {
    this.dead = true;
  }

  heal(n: number) {
    if (this.health > 0) this.health = Math.min(this.maxHealth, this.health + n);
  }

  // ---------------------------------------------------------------- status effects
  effectAmp(id: string): number { return this.effects.get(id)?.amp ?? -1; }
  /** Apply an effect; instant effects act immediately. `scale` scales instant strength (splash distance). */
  addEffect(id: string, dur: number, amp: number, scale = 1) {
    const def = EFFECTS[id];
    if (!def) return;
    if (def.instant) {
      if (id === 'saturation') { this.exhaustEffect(-(amp + 1)); return; }
      const heal = (id === 'instant_health') !== this.undead;
      if (heal) this.heal(Math.floor(scale * (4 << amp) + 0.5));
      else this.damage(Math.floor(scale * (6 << amp) + 0.5), 'magic');
      return;
    }
    const cur = this.effects.get(id);
    if (cur && (cur.amp > amp || (cur.amp === amp && cur.dur >= dur))) return;
    this.effects.set(id, { id, amp, dur });
    if (id === 'absorption') this.absorption = Math.max(this.absorption, 4 * (amp + 1));
    if (id === 'health_boost') this.maxHealth = this.baseMaxHealth() + 4 * (amp + 1);
    this.effectsChanged();
  }
  /** Max health without Health Boost. */
  baseMaxHealth() { return (this as unknown as { baseHealth?: number }).baseHealth ?? 20; }
  removeEffect(id: string) {
    if (!this.effects.delete(id)) return;
    if (id === 'absorption') this.absorption = 0;
    if (id === 'health_boost') { this.maxHealth = this.baseMaxHealth(); this.health = Math.min(this.health, this.maxHealth); }
    this.effectsChanged();
  }
  clearEffects() {
    if (!this.effects.size) return;
    this.effects.clear();
    this.absorption = 0;
    this.effectsChanged();
  }
  effectsChanged() {
    const list = [...this.effects.values()].filter((e) => e.id !== 'invisibility' || this.effects.size === 1);
    this.effectColor = list.length ? potionColor(list.map((e) => [e.id, e.dur, e.amp])) : 0;
  }
  tickEffects() {
    if (!this.effects.size) return;
    for (const e of [...this.effects.values()]) {
      switch (e.id) {
        case 'regeneration': { const k = 50 >> e.amp; if (k <= 0 || this.age % k === 0) this.heal(1); break; }
        case 'poison': { const k = 25 >> e.amp; if ((k <= 0 || this.age % k === 0) && this.health > 1 && !this.undead) this.damage(1, 'magic'); break; }
        case 'hunger': this.exhaustEffect(0.025 * (e.amp + 1)); break;
        // wither: like poison, but it can kill
        case 'wither': { const k = 40 >> e.amp; if (k <= 0 || this.age % k === 0) this.damage(1, 'wither'); break; }
        // levitation: drift upward (vanilla: vy += (0.05 * (amp + 1) - vy) * 0.2)
        case 'levitation': this.vy += (0.05 * (e.amp + 1) - this.vy) * 0.2; this.fallDistance = 0; break;
        case 'slow_falling': if (this.vy < -0.01 * 2) this.vy = Math.max(this.vy, -0.06); this.fallDistance = 0; break;
      }
      if (--e.dur <= 0) this.removeEffect(e.id);
    }
  }
  exhaustEffect(_n: number) {}
  speedFactor(): number {
    let f = 1;
    const sp = this.effectAmp('speed'), sl = this.effectAmp('slowness');
    if (sp >= 0) f *= 1 + 0.2 * (sp + 1);
    if (sl >= 0) f *= Math.max(0, 1 - 0.15 * (sl + 1));
    return f;
  }
  /** Extra melee damage from Strength / Weakness. */
  attackBonus(): number {
    let b = 0;
    const st = this.effectAmp('strength'), wk = this.effectAmp('weakness');
    if (st >= 0) b += 3 * (st + 1);
    if (wk >= 0) b -= 4 * (wk + 1);
    return b;
  }

  override onLand(fall: number) {
    const f = Math.ceil(fall - 3 - (this.effectAmp('jump_boost') + 1));
    const below = this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
    if (f > 0 && !this.inWater && below !== B.WATER && this.damage(f, 'fall') && this.world.role === 'server') live.game?.audio.play(f > 4 ? 'fall.big' : 'fall.small', this, 1, 1);
    this.landed(fall, below);
  }
  landed(_fall: number, _below: number) {}

  isOnLadder() {
    const id = this.world.getId(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    return BLOCKS[id].climbable;
  }

  /** Minecraft's moveEntityWithHeading. */
  travel(strafe: number, forward: number) {
    if (this.inWater && !this.isFlying()) {
      const y0 = this.y;
      let drag = 0.8, accel = 0.02;
      let ds = Math.min(3, this.depthStrider());
      if (!this.onGround) ds *= 0.5;
      if (ds > 0) { drag += ((0.546 - drag) * ds) / 3; accel += ((this.groundSpeed() - accel) * ds) / 3; }
      this.moveRelative(strafe, forward, accel);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= drag; this.vy *= 0.8; this.vz *= drag;
      this.vy -= 0.02;
      if (this.collidedH && this.canMoveTo(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
      return;
    }
    if (this.inLava && !this.isFlying()) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5;
      this.vy -= 0.02;
      if (this.collidedH && this.canMoveTo(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
      return;
    }
    let friction = 0.91;
    if (this.onGround) {
      const below = this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
      friction = (below ? BLOCKS[below].slipperiness : 0.6) * 0.91;
    }
    const accel = this.onGround ? this.groundSpeed() * (0.16277136 / (friction * friction * friction)) : this.airSpeed();
    this.moveRelative(strafe, forward, accel);
    // re-evaluate friction after moveRelative like vanilla
    friction = 0.91;
    if (this.onGround) {
      const below = this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
      friction = (below ? BLOCKS[below].slipperiness : 0.6) * 0.91;
    }
    this.onLadder = this.isOnLadder();
    if (this.onLadder) {
      const m = 0.15;
      this.vx = Math.max(-m, Math.min(m, this.vx));
      this.vz = Math.max(-m, Math.min(m, this.vz));
      this.fallDistance = 0;
      if (this.vy < -0.15) this.vy = -0.15;
      if (this.sneaking && this.vy < 0) this.vy = 0;
    }
    this.move(this.vx, this.vy, this.vz);
    if (this.collidedH && this.onLadder) this.vy = 0.2;
    if (this.isFlying()) {
      this.vy *= 0.6;
    } else {
      this.vy -= this.gravity();
      this.vy *= 0.98;
    }
    this.vx *= friction;
    this.vz *= friction;
  }

  gravity() { return 0.08; }
  depthStrider() { return 0; }
  isFlying() { return false; }
  groundSpeed() { return this.moveSpeed * (this.sprinting ? 1.3 : 1) * this.speedFactor(); }
  airSpeed(): number { return this.sprinting ? 0.026 : 0.02; }

  moveRelative(strafe: number, forward: number, friction: number) {
    let f = strafe * strafe + forward * forward;
    if (f < 1e-4) return;
    f = Math.sqrt(f);
    if (f < 1) f = 1;
    f = friction / f;
    strafe *= f;
    forward *= f;
    const r = (this.yaw * Math.PI) / 180;
    const s = Math.sin(r), c = Math.cos(r);
    this.vx += strafe * c - forward * s;
    this.vz += forward * c + strafe * s;
  }

  canMoveTo(dx: number, dy: number, dz: number) {
    const b = this.box;
    const nb = { x0: b.x0 + dx, y0: b.y0 + dy, z0: b.z0 + dz, x1: b.x1 + dx, y1: b.y1 + dy, z1: b.z1 + dz };
    if (this.collisions(nb).length) return false;
    // not into liquid
    for (let x = Math.floor(nb.x0); x <= Math.floor(nb.x1); x++)
      for (let y = Math.floor(nb.y0); y <= Math.floor(nb.y1); y++)
        for (let z = Math.floor(nb.z0); z <= Math.floor(nb.z1); z++) if (BLOCKS[this.world.getId(x, y, z)].fluid) return false;
    return true;
  }

  jump() {
    this.vy = 0.42 + (this.effectAmp('jump_boost') + 1) * 0.1;
    if (this.sprinting) {
      const r = (this.yaw * Math.PI) / 180;
      this.vx -= Math.sin(r) * 0.2;
      this.vz += Math.cos(r) * 0.2;
    }
  }

  /** Living update: jumping, travel, environmental damage. */
  livingTick() {
    if (this.jumpTicks > 0) this.jumpTicks--;
    if (Math.abs(this.vx) < 0.003) this.vx = 0;
    if (Math.abs(this.vy) < 0.003) this.vy = 0;
    if (Math.abs(this.vz) < 0.003) this.vz = 0;
    this.updateFluidState();
    if (this.jumping && !this.isFlying()) {
      if (this.inWater || this.inLava) this.vy += 0.04;
      else if (this.onGround && this.jumpTicks === 0) {
        this.jump();
        this.jumpTicks = 10;
      }
    } else this.jumpTicks = 0;
    this.strafe *= 0.98;
    this.forward *= 0.98;
    this.travel(this.strafe, this.forward);
    if (this.inWater) bubblePush(this);
    standingOn(this as never);
    honeySlide(this);
    // limb animation
    this.pLimbSwingAmount = this.limbSwingAmount;
    const dx = this.x - this.px, dz = this.z - this.pz;
    let d = Math.sqrt(dx * dx + dz * dz) * 4;
    if (d > 1) d = 1;
    this.limbSwingAmount += (d - this.limbSwingAmount) * 0.4;
    this.limbSwing += this.limbSwingAmount;
    this.environment();
    this.tickEffects();
    this.updateSwing();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
  }

  /** Respiration-style chance to not lose air this tick. */
  keepAir() { return false; }

  environment() {
    // drowning
    const eyeY = this.y + this.eyeHeight();
    const eyeBlock = this.world.getId(Math.floor(this.x), Math.floor(eyeY), Math.floor(this.z));
    if (eyeBlock === B.WATER && !this.canBreathe && !this.effects.has('water_breathing') && !this.keepAir()) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, 'drown');
      }
    } else this.air = Math.min(300, this.air + 4);
    // suffocation
    if (this.isInsideOpaque() && !this.noClip) this.damage(1, 'suffocate');
    // lava & fire
    if (this.inLava) {
      this.fireTicks = Math.max(this.fireTicks, 300);
      this.damage(4, 'lava');
    }
    if (this.fireTicks > 0) {
      if (this.fireImmune) this.fireTicks = 0;
      else if (this.effects.has('fire_resistance')) { if (this.inWater) this.fireTicks = 0; else this.fireTicks--; }
      else {
        if (this.inWater) this.fireTicks = 0;
        else {
          if (this.fireTicks % 20 === 0) this.damage(1, 'fire');
          this.fireTicks--;
        }
      }
    }
    // cactus
    const b = this.box;
    for (let x = Math.floor(b.x0 - 0.01); x <= Math.floor(b.x1 + 0.01); x++)
      for (let z = Math.floor(b.z0 - 0.01); z <= Math.floor(b.z1 + 0.01); z++)
        for (let y = Math.floor(b.y0); y <= Math.floor(b.y1); y++) {
          const id = this.world.getId(x, y, z);
          if (id === B.CACTUS) {
            const cx0 = x + 1 / 16, cx1 = x + 15 / 16, cz0 = z + 1 / 16, cz1 = z + 15 / 16;
            if (b.x1 > cx0 - 0.01 && b.x0 < cx1 + 0.01 && b.z1 > cz0 - 0.01 && b.z0 < cz1 + 0.01) this.damage(1, 'cactus');
          } else if (id === B.FIRE && !this.fireImmune) {
            this.damage(1, 'fire');
            this.fireTicks = Math.max(this.fireTicks, 160);
          } else if (id === B2.SWEET_BERRY_BUSH || id === B2.SOUL_FIRE || id === B2.WITHER_ROSE) insideBlock(this as never, id, metaOf(this.world.get(x, y, z)));
        }
    if (this.y < -64) this.damage(4, 'void');
  }
}
