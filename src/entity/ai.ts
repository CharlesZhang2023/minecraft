// Goal-based mob AI (vanilla's GoalSelector): each mob has a list of goals in priority order; every tick the ones
// that may start do, unless a more important running goal holds a control they need (moving, looking, targeting),
// and running goals that can't continue stop. The goals here are shared by the mobs added for 1.16 (piglins,
// hoglins, striders, shulkers, golems, illagers, aquatic and other mobs): wander, look, swim, panic, flee, avoid,
// tempt, breed, follow a parent, melee and ranged attacks, and target selection.
import { Mob } from './mobs';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Entity } from './entity';
import { LivingEntity } from './living';
import { Player } from '../game/player';
import { Arrow, XpOrb } from './item';
import { Random } from '../noise';
import { B, BLOCKS, idOf } from '../world/blocks';
import type { ItemStack } from '../game/items';

export type Control = 'move' | 'look' | 'target' | 'jump';
export interface Goal {
  /** Lower runs first. */
  priority: number;
  controls: Control[];
  canStart(m: GoalMob): boolean;
  /** Default: canStart again. */
  canContinue?(m: GoalMob): boolean;
  start?(m: GoalMob): void;
  tick?(m: GoalMob): void;
  stop?(m: GoalMob): void;
  /** Goals that only re-check now and then (vanilla: most check every tick, some with a random chance). */
  name?: string;
}

export const aiRng = new Random((Date.now() * 7) & 0xffffff);

/** A mob driven by goals. Subclasses add goals in their constructor (`this.goals.push(...)`). */
export abstract class GoalMob extends Mob {
  goals: Goal[] = [];
  targetGoals: Goal[] = [];
  private running = new Set<Goal>();
  /** The registry name it saves under ('piglin_brute'...). */
  abstract kind: string;
  attackDamage = 2;
  /** Melee reach beyond the mob's own size. */
  attackReach = 0;
  /** Things it likes to eat / be lured by. */
  food: number[] = [];
  /** A target picked by targeting goals (`target` is the one being fought). */
  angerTicks = 0;

  constructor(world: World, game: Game) { super(world, game); }

  override ai() {
    this.runGoals(this.targetGoals, true);
    this.runGoals(this.goals, false);
    if (this.angerTicks > 0 && --this.angerTicks === 0 && this.target) this.target = null;
  }

  private runGoals(list: Goal[], targeting: boolean) {
    // stop what can't go on
    for (const g of list) {
      if (!this.running.has(g)) continue;
      const ok = g.canContinue ? g.canContinue(this) : g.canStart(this);
      if (!ok) { this.running.delete(g); g.stop?.(this); }
    }
    // start what can, by priority, unless a more important running goal holds one of its controls
    const sorted = list.slice().sort((a, b) => a.priority - b.priority);
    for (const g of sorted) {
      if (this.running.has(g)) continue;
      const blocked = sorted.some((o) => o !== g && this.running.has(o) && o.priority <= g.priority && o.controls.some((c) => g.controls.includes(c)));
      if (blocked || !g.canStart(this)) continue;
      // it takes over the controls of less important goals
      for (const o of sorted) if (o !== g && this.running.has(o) && o.priority > g.priority && o.controls.some((c) => g.controls.includes(c))) { this.running.delete(o); o.stop?.(this); }
      this.running.add(g);
      g.start?.(this);
    }
    for (const g of sorted) if (this.running.has(g)) g.tick?.(this);
    void targeting;
  }
  isRunning(name: string) { for (const g of this.running) if (g.name === name) return true; return false; }

  override toJSON() {
    return { ...super.toJSON(), type: this.kind };
  }

  /** Hit the target in reach (cooldown 20 ticks). Returns true if it hit. */
  meleeHit(t: LivingEntity): boolean {
    if (this.attackCooldown > 0) return false;
    const reach = this.width * 2 * this.width * 2 + t.width + this.attackReach;
    const dx = t.x - this.x, dz = t.z - this.z, dy = t.y - this.y;
    if (dx * dx + dz * dz > reach + 0.5 || Math.abs(dy) > 2) return false;
    this.attackCooldown = 20;
    this.swing();
    const hit = t.damage(Math.max(0, this.attackDamage + this.attackBonus()), 'mob', this);
    if (hit) this.onMeleeHit(t);
    return hit;
  }
  onMeleeHit(_t: LivingEntity) {}

  /** Can it breed now (adult, not on cooldown)? */
  canBreed() { return !this.baby && this.breedCooldown === 0; }
  /** Feed it: in love (breeding) or, for babies, grow up faster. */
  interact(game: Game, held: ItemStack | null): boolean {
    if (held && this.food.includes(held.id)) {
      if (this.baby) { this.growTimer += 2400; game.interact!.consume(1); return true; }
      if (this.canBreed() && this.loveTicks === 0) { this.loveTicks = 600; game.interact!.consume(1); return true; }
    }
    return false;
  }
  useLabel(_p: Player, held: ItemStack | null): string | null {
    return held && this.food.includes(held.id) && (this.baby || (this.canBreed() && this.loveTicks === 0)) ? 'Feed' : null;
  }
  override onDamaged(attacker: Entity | null) {
    if (this.fleesWhenHurt) { this.panicTicks = 60; this.path = null; }
    if (attacker instanceof LivingEntity && this.retaliates && !(attacker instanceof Player && (attacker.creative || attacker.spectator))) {
      this.target = attacker;
      this.angerTicks = 400;
    }
  }
  fleesWhenHurt = false;
  retaliates = false;
}

// ------------------------------------------------------------------ the goal library
const distSq = (a: Entity, b: { x: number; y: number; z: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/** Stay afloat in water and lava. */
export const swim = (priority = 0): Goal => ({
  priority, controls: ['jump'],
  canStart: (m) => m.inWater || m.inLava,
  tick: (m) => { if (aiRng.next() < 0.8) m.jumping = true; },
});

/** Stroll around now and then. */
export const wander = (priority: number, speed: number, chance = 120): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => !m.path && aiRng.int(chance) === 0,
  canContinue: (m) => !!m.path,
  start: (m) => {
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(m.x + aiRng.int(21) - 10), tz = Math.floor(m.z + aiRng.int(21) - 10), ty = Math.floor(m.y + aiRng.int(7) - 3);
      if (m.setPathTo(tx, ty, tz, speed)) break;
    }
  },
  stop: (m) => { m.path = null; },
});

/** Look at a player nearby for a while. */
export const lookAtPlayer = (priority: number, range = 8): Goal => {
  let who: Player | null = null, time = 0;
  return {
    priority, controls: ['look'],
    canStart: (m) => {
      if (aiRng.int(50)) return false;
      who = null;
      for (const p of m.game.playerEntities()) if (!p.spectator && m.distanceTo(p) < range) { who = p; break; }
      return !!who;
    },
    canContinue: (m) => !!who && time > 0 && m.distanceTo(who) < range,
    start: () => { time = 40 + aiRng.int(40); },
    tick: (m) => { time--; if (who) m.lookTarget = { x: who.x, y: who.y + who.eyeHeight(), z: who.z }; },
    stop: (m) => { who = null; m.lookTarget = null; },
  };
};

/** Run around after being hurt. */
export const panic = (priority: number, speed: number): Goal => ({
  priority, controls: ['move'],
  canStart: (m) => m.panicTicks > 0,
  start: (m) => { m.path = null; },
  tick: (m) => {
    if (!m.path || aiRng.int(20) === 0) m.setPathTo(m.x + aiRng.int(11) - 5, m.y, m.z + aiRng.int(11) - 5, speed);
  },
});

/** Keep away from entities that match (and that it can see). */
export const avoidEntity = (priority: number, pred: (m: GoalMob, e: Entity) => boolean, dist: number, speed: number): Goal => {
  let from: Entity | null = null;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      from = null;
      let bd = dist * dist;
      for (const e of m.game.entities) {
        if (e === m || e.removed || !pred(m, e)) continue;
        const d = distSq(m, e);
        if (d < bd) { bd = d; from = e; }
      }
      return !!from;
    },
    canContinue: (m) => !!from && !from.removed && distSq(m, from) < dist * dist * 1.5,
    tick: (m) => {
      if (!from) return;
      if (!m.path || aiRng.int(10) === 0) {
        const dx = m.x - from.x, dz = m.z - from.z, l = Math.hypot(dx, dz) || 1;
        m.setPathTo(m.x + (dx / l) * 8 + aiRng.int(5) - 2, m.y, m.z + (dz / l) * 8 + aiRng.int(5) - 2, speed);
      }
    },
    stop: (m) => { from = null; m.path = null; },
  };
};

/** Keep away from blocks that match within a radius (hoglins and warped fungus, piglins and soul fire). */
export const avoidBlock = (priority: number, pred: (id: number) => boolean, radius: number, speed: number): Goal => {
  let at: { x: number; y: number; z: number } | null = null;
  const scan = (m: GoalMob) => {
    const x0 = Math.floor(m.x), y0 = Math.floor(m.y), z0 = Math.floor(m.z);
    for (let k = 0; k < 24; k++) {
      const x = x0 + aiRng.int(radius * 2 + 1) - radius, y = y0 + aiRng.int(5) - 2, z = z0 + aiRng.int(radius * 2 + 1) - radius;
      if (pred(m.world.getId(x, y, z))) return { x: x + 0.5, y, z: z + 0.5 };
    }
    return null;
  };
  return {
    priority, controls: ['move'],
    canStart: (m) => { if (aiRng.int(5)) return false; at = scan(m); return !!at; },
    canContinue: (m) => !!at && distSq(m, at) < (radius + 2) ** 2,
    tick: (m) => {
      if (!at) return;
      if (!m.path || aiRng.int(15) === 0) {
        const dx = m.x - at.x, dz = m.z - at.z, l = Math.hypot(dx, dz) || 1;
        m.setPathTo(m.x + (dx / l) * (radius + 3), m.y, m.z + (dz / l) * (radius + 3), speed);
      }
    },
    stop: (m) => { at = null; m.path = null; },
  };
};

/** Follow a player holding one of its foods. */
export const tempt = (priority: number, speed: number): Goal => {
  let who: Player | null = null;
  return {
    priority, controls: ['move', 'look'],
    canStart: (m) => {
      who = null;
      for (const p of m.game.playerEntities()) {
        if (p.dead || p.spectator || m.distanceTo(p) > 10) continue;
        const h = p.inventory.held();
        if (h && m.food.includes(h.id)) { who = p; break; }
      }
      return !!who;
    },
    tick: (m) => {
      if (!who) return;
      m.lookTarget = { x: who.x, y: who.y + who.eyeHeight(), z: who.z };
      if (m.distanceTo(who) > 2.5) { if (--m.pathTimer <= 0) { m.pathTimer = 10; m.setPathTo(who.x, who.y, who.z, speed); } }
      else m.path = null;
    },
    stop: (m) => { who = null; m.path = null; },
  };
};

/** Two of a kind in love find each other and make a baby (`baby(mate)` makes and places it). */
export const breed = (priority: number, speed: number, makeBaby?: (m: GoalMob, mate: GoalMob) => void): Goal => {
  let mate: GoalMob | null = null;
  return {
    priority, controls: ['move', 'look'],
    canStart: (m) => {
      if (m.loveTicks <= 0) return false;
      mate = (m.game.entities.find((e) => e !== m && e instanceof GoalMob && e.kind === m.kind && e.loveTicks > 0 && !e.dead && e.distanceTo(m) < 8) as GoalMob | undefined) ?? null;
      return !!mate;
    },
    canContinue: (m) => !!mate && m.loveTicks > 0 && mate.loveTicks > 0 && !mate.dead,
    tick: (m) => {
      if (!mate) return;
      m.lookTarget = mate;
      if (m.distanceTo(mate) > 1.8) m.moveToward(mate.x, mate.z, speed);
      else if (m.id < mate.id) {
        m.loveTicks = mate.loveTicks = 0;
        m.breedCooldown = mate.breedCooldown = 6000;
        if (makeBaby) makeBaby(m, mate);
        else {
          const b = m.game.interact!.spawnMob(m.kind, m.x, m.y, m.z, true) as Mob | null;
          if (b) b.baby = true;
        }
        for (let i = 0; i < 7; i++) m.game.particles?.heart(m.x + aiRng.next() - 0.5, m.y + 0.8, m.z + aiRng.next() - 0.5);
        const o = new XpOrb(m.world, m.game, 1 + aiRng.int(7));
        o.setPos(m.x, m.y + 0.5, m.z);
        m.game.addEntity(o);
      }
    },
    stop: () => { mate = null; },
  };
};

/** Babies keep near an adult of their kind. */
export const followParent = (priority: number, speed: number): Goal => {
  let parent: GoalMob | null = null;
  return {
    priority, controls: ['move'],
    canStart: (m) => {
      if (!m.baby || aiRng.int(40)) return false;
      parent = (m.game.entities.find((e) => e !== m && e instanceof GoalMob && e.kind === m.kind && !e.baby && e.distanceTo(m) < 10) as GoalMob | undefined) ?? null;
      return !!parent && parent.distanceTo(m) > 3;
    },
    canContinue: (m) => !!parent && !parent.dead && parent.distanceTo(m) > 2 && parent.distanceTo(m) < 16,
    tick: (m) => { if (parent && (--m.pathTimer <= 0 || !m.path)) { m.pathTimer = 10; m.setPathTo(parent.x, parent.y, parent.z, speed); } },
    stop: (m) => { parent = null; m.path = null; },
  };
};

/** Chase the target and hit it. */
export const meleeAttack = (priority: number, speed: number): Goal => ({
  priority, controls: ['move', 'look'],
  canStart: (m) => !!m.target && !m.target.dead,
  canContinue: (m) => !!m.target && !m.target.dead && !(m.target as Player).spectator && m.distanceTo(m.target) < 32,
  tick: (m) => {
    const t = m.target!;
    m.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
    const d = m.distanceTo(t);
    if (--m.pathTimer <= 0 || !m.path) {
      m.pathTimer = 10 + aiRng.int(10) + (d > 16 ? 20 : 0);
      if (d < 2.5 && Math.abs(t.y - m.y) < 1.5) m.path = null;
      else m.setPathTo(t.x, t.y, t.z, speed);
    }
    if (!m.path) m.moveToward(t.x, t.z, speed);
    m.aiSpeed = speed;
    m.meleeHit(t);
  },
  stop: (m) => { m.path = null; },
});

/** Keep at range and shoot (bows and crossbows): `shoot` fires one projectile at the target. */
export const rangedAttack = (priority: number, speed: number, interval: number, range: number, shoot: (m: GoalMob, t: LivingEntity) => void): Goal => {
  let timer = interval, strafe = 1, strafeTimer = 0;
  return {
    priority, controls: ['move', 'look'],
    canStart: (m) => !!m.target && !m.target.dead,
    canContinue: (m) => !!m.target && !m.target.dead && m.distanceTo(m.target) < 40,
    tick: (m) => {
      const t = m.target!;
      m.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
      const d = m.distanceTo(t), sees = m.canSee(t);
      if (d > range * 0.75 || !sees) {
        if (--m.pathTimer <= 0 || !m.path) { m.pathTimer = 20; m.setPathTo(t.x, t.y, t.z, speed); }
      } else {
        m.path = null;
        m.yaw = (Math.atan2(t.z - m.z, t.x - m.x) * 180) / Math.PI - 90;
        if (++strafeTimer > 30) { strafeTimer = 0; if (aiRng.next() < 0.3) strafe = -strafe; }
        m.strafe = 0.5 * strafe;
        m.forward = d < range * 0.35 ? -0.5 : 0;
        m.aiSpeed = speed;
      }
      if (sees && d < range && --timer <= 0) { timer = interval + aiRng.int(interval); shoot(m, t); }
    },
    stop: (m) => { m.path = null; m.strafe = 0; },
  };
};

/** An arrow (or tipped arrow) shot by a mob at a target, like a skeleton's. */
export function shootArrow(m: GoalMob, t: LivingEntity, power = 1.6, damage = 2) {
  const a = new Arrow(m.world, m.game, m);
  const ey = m.y + m.eyeHeight() - 0.1;
  a.setPos(m.x, ey, m.z);
  const dx = t.x - m.x, dz = t.z - m.z, dy = t.y + t.height / 3 - ey, h = Math.hypot(dx, dz);
  a.shoot(dx, dy + h * 0.2, dz, power, 14 - m.game.options.difficulty * 4);
  a.pickup = false;
  a.damageBase = damage + m.game.options.difficulty * 0.11 + aiRng.next() * 0.25;
  m.game.addEntity(a);
  m.game.audio.play('bow', m, 1, 1 / (aiRng.next() * 0.4 + 0.8));
}

// ------------------------------------------------------------------ targeting goals
/** Go after the nearest entity that matches (players by default), if it can see it. */
export const nearestTarget = (priority: number, pred: (m: GoalMob, e: LivingEntity) => boolean, range = 16, mustSee = true): Goal => ({
  priority, controls: ['target'],
  canStart: (m) => {
    if (m.target && !m.target.dead) return false;
    if (aiRng.int(10)) return false;
    let best: LivingEntity | null = null, bd = range * range;
    for (const e of m.game.entities) {
      if (!(e instanceof LivingEntity) || e === m || e.dead || e.removed) continue;
      if (e instanceof Player && (e.creative || e.spectator)) continue;
      if (!pred(m, e)) continue;
      const d = distSq(m, e);
      if (d >= bd) continue;
      if (mustSee && !m.canSee(e) && d > 16) continue;
      bd = d; best = e;
    }
    if (best) m.target = best;
    return !!best;
  },
  canContinue: (m) => !!m.target && !m.target.dead && !(m.target instanceof Player && (m.target.creative || m.target.spectator)) && m.distanceTo(m.target) < range * 2,
  stop: (m) => { if (m.angerTicks <= 0) m.target = null; },
});

/** Players (not in creative), with a chance to ignore those it shouldn't see. */
export const isPlayer = (_m: GoalMob, e: LivingEntity) => e instanceof Player;

/** Is block id one of these. */
export const blockIn = (ids: number[]) => (id: number) => ids.includes(id);
void B; void BLOCKS; void idOf;
