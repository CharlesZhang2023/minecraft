// The Wither (1.4): built from soul sand and three wither skeleton skulls. It swells for eleven seconds, explodes,
// then flies at every living thing that isn't undead, its three heads firing wither skulls (and now and then a
// blue one that breaks blocks). Hurt, it smashes the blocks around it; below half health its armour turns arrows.
// It drops a nether star.
import { Mob } from './mobs';
import { Entity } from './entity';
import { LivingEntity, type DamageSource } from './living';
import { Fireball } from './item';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { Player } from '../game/player';
import { B, B2, BLOCKS, idOf } from '../world/blocks';
import { I8, ItemStack, stack } from '../game/items';

const rng = { next: Math.random, int: (n: number) => Math.floor(Math.random() * n) };
/** Blocks the Wither can't break (vanilla's wither_immune tag). */
const IMMUNE = () => new Set([B.BEDROCK, B.END_PORTAL_FRAME, B.END_PORTAL, B.NETHER_PORTAL, B.END_GATEWAY]);

export class Wither extends Mob {
  typeName = 'Wither';
  override model = 'wither';
  override skin = 'wither';
  override hostile = true;
  override undead = true;
  override fireImmune = true;
  override persistentHostile = true;
  override renderScale = 2;
  override sayName = 'wither.ambient';
  override hurtName = 'wither.hurt';
  override deathName = 'wither.death';
  override xp = 50;
  /** Ticks of the spawning phase left (it can't be hurt and heals to full). */
  invul = 220;
  /** The side heads' targets (ids), and their aim for the renderer. */
  sideTargets: [number, number] = [0, 0];
  sideYaw: [number, number] = [0, 0];
  private skullCd: [number, number, number] = [40, 50, 60];
  private smash = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.9; this.height = 3.5;
    this.maxHealth = 300;
    this.health = 1;
  }
  override gravity() { return 0; }
  override isFlying() { return true; }
  override eyeHeight() { return 3; }
  get armored() { return this.health <= this.maxHealth / 2; }
  override ai() {
    if (this.invul > 0) {
      this.invul--;
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth / 220);
      if (this.invul === 0) {
        this.game.interact!.explode(this.x, this.y + this.eyeHeight(), this.z, 7, false, this);
        this.game.audio.play('wither.spawn', null, 1, 1);
      }
      return;
    }
    // targets: the nearest living thing that isn't undead (players not in creative), within 20 blocks
    const valid = (e: Entity | null | undefined): e is LivingEntity => e instanceof LivingEntity && !e.dead && !e.undead && e !== this && !(e instanceof Player && (e.creative || e.spectator)) && e.distanceTo(this) < 30;
    if (!valid(this.target)) this.target = this.pickTarget(valid);
    for (let k = 0; k < 2; k++) {
      const cur = this.game.entities.find((e) => e.id === this.sideTargets[k]);
      if (!valid(cur) || rng.int(200) === 0) this.sideTargets[k] = this.pickTarget(valid)?.id ?? 0;
    }
    // heads fire wither skulls at their targets (difficulty speeds them up)
    const heads: [number, LivingEntity | null][] = [[0, this.target], [1, (this.game.entities.find((e) => e.id === this.sideTargets[0]) as LivingEntity) ?? null], [2, (this.game.entities.find((e) => e.id === this.sideTargets[1]) as LivingEntity) ?? null]];
    for (const [h, t] of heads) {
      if (--this.skullCd[h] > 0 || !t || !valid(t)) continue;
      this.skullCd[h] = 40 + rng.int(20) - this.game.options.difficulty * 8;
      this.shootSkull(h, t.x, t.y + t.eyeHeight() * 0.5, t.z, rng.int(1000) < (this.game.options.difficulty >= 3 ? 10 : 1));
    }
    // aim the side heads (for the renderer)
    for (let k = 0; k < 2; k++) {
      const t = heads[k + 1][1];
      const want = t ? (Math.atan2(t.z - this.z, t.x - this.x) * 180) / Math.PI - 90 - this.bodyYaw : 0;
      this.sideYaw[k] += (wrap(want) - this.sideYaw[k]) * 0.2;
    }
    if (this.target) this.lookTarget = { x: this.target.x, y: this.target.y + this.target.eyeHeight(), z: this.target.z };
    // smash the blocks around it a second after being hurt
    if (this.smash > 0 && --this.smash === 0 && this.game.options.difficulty > 0) this.smashBlocks();
    // regenerate slowly
    if (this.age % 20 === 0) this.heal(1);
  }
  private pickTarget(valid: (e: Entity) => boolean): LivingEntity | null {
    let best: LivingEntity | null = null, bd = 20;
    for (const e of this.game.entities) if (valid(e)) { const d = e.distanceTo(this); if (d < bd) { bd = d; best = e as LivingEntity; } }
    return best;
  }
  override travel() {
    if (this.invul > 0) { this.vx = this.vz = 0; this.vy = Math.min(0, this.vy * 0.6); this.move(0, this.vy, 0); return; }
    const t = this.target;
    if (t) {
      // hover above the target, closing in when far and holding off when close (vanilla)
      const want = t.y + 5;
      this.vy += ((want > this.y ? 0.3 : -0.3) - this.vy) * 0.08;
      const dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz) || 1;
      if (d > 9) { this.vx += ((dx / d) * 0.3 - this.vx) * 0.08; this.vz += ((dz / d) * 0.3 - this.vz) * 0.08; }
    } else this.vy *= 0.6;
    this.vx *= 0.9; this.vz *= 0.9; this.vy *= 0.9;
    this.move(this.vx, this.vy, this.vz);
    if (Math.hypot(this.vx, this.vz) > 0.05) this.yaw = this.bodyYaw = (Math.atan2(this.vz, this.vx) * 180) / Math.PI - 90;
  }
  /** One head's skull: from the head's position toward a point (blue skulls are slow and break blocks). */
  shootSkull(head: number, tx: number, ty: number, tz: number, blue: boolean) {
    const r = ((this.bodyYaw + 90) * Math.PI) / 180;
    const off = head === 0 ? 0 : head === 1 ? -1.3 : 1.3;
    const hx = this.x + Math.cos(r) * off, hy = this.y + (head === 0 ? 3 : 2.2), hz = this.z + Math.sin(r) * off;
    const s = new WitherSkull(this.world, this.game, this, tx - hx, ty - hy, tz - hz);
    s.blue = blue;
    s.setPos(hx, hy - 0.5, hz);
    this.game.addEntity(s);
    this.game.audio.play('wither.shoot', this, 1, 1);
  }
  private smashBlocks() {
    const immune = IMMUNE();
    const x0 = Math.floor(this.x), y0 = Math.floor(this.y), z0 = Math.floor(this.z);
    const list: [number, number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 3; dy++) {
      const id = this.world.getId(x0 + dx, y0 + dy, z0 + dz);
      if (id && !immune.has(id) && !BLOCKS[id].fluid) list.push([x0 + dx, y0 + dy, z0 + dz]);
    }
    if (list.length) { this.game.interact!.destroyBlocks(list, { drops: 1, fx: 'break' }); this.game.audio.play('wither.break_block', this, 1, 1); }
  }
  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    if (this.invul > 0 && source !== 'kill' && source !== 'void') return false;
    if (source === 'drown' || source === 'wither' || source === 'suffocate' || attacker instanceof Wither) return false;
    // armoured below half health: arrows glance off
    if (this.armored && (source === 'arrow' || (attacker as unknown as { typeName?: string })?.typeName === 'Arrow')) return false;
    const r = super.damage(amount, source, attacker);
    if (r) this.smash = 20;
    return r;
  }
  override drops(): ItemStack[] { return [stack(I8.NETHER_STAR)]; }
  override die(source: DamageSource, attacker: Entity | null) {
    super.die(source, attacker);
    this.game.audio.play('wither.death', null, 1, 1);
  }
  override environment() { if (this.y < -64) this.damage(4, 'void'); }
  override despawnCheck() {}
  override extraJSON() { return { invul: this.invul }; }
  override loadExtra(d: Record<string, unknown>) { this.invul = (d.invul as number) ?? 0; }
}
const wrap = (d: number) => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };

/** A wither skull: explodes where it hits (power 1); a direct hit withers (10 s, 40 s on hard). Blue ones break tough blocks. */
export class WitherSkull extends Fireball {
  override typeName = 'Wither Skull';
  blue = false;
  constructor(world: World, game: Game, shooter: Entity | null, dx: number, dy: number, dz: number) {
    super(world, game, shooter, dx, dy, dz);
    this.width = this.height = 0.3125;
    this.small = false;
  }
  override tick() {
    if (this.age > 300) { this.removed = true; return; }
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const id = this.world.getId(Math.floor(nx), Math.floor(ny + 0.15), Math.floor(nz));
    let hitEnt: LivingEntity | null = null;
    for (const e of this.game.entities) {
      if (!(e instanceof LivingEntity) || e === this.shooter || e.dead || e instanceof Wither) continue;
      if (e instanceof Player && e.spectator) continue;
      if (Math.abs(e.x - nx) < e.width / 2 + 0.2 && Math.abs(e.z - nz) < e.width / 2 + 0.2 && ny > e.y - 0.2 && ny < e.y + e.height + 0.2) { hitEnt = e; break; }
    }
    if ((hitEnt || BLOCKS[id].solid) && this.age > 1) {
      this.removed = true;
      if (hitEnt) {
        const g = this.game;
        if (hitEnt.damage(8, 'wither', this.shooter)) {
          const d = g.options.difficulty;
          if (d >= 2) hitEnt.addEffect('wither', d === 2 ? 200 : 800, 1);
          // whatever a Wither kills leaves a wither rose
          if (hitEnt.dead && !(hitEnt instanceof Player)) witherRose(g, hitEnt);
        }
      }
      this.game.interact!.explode(this.x, this.y + 0.15, this.z, 1, false, this);
      return;
    }
    this.x = nx; this.y = ny; this.z = nz;
    const a = this as unknown as { ax: number; ay: number; az: number };
    const sp = this.blue ? 0.6 : 1;
    this.vx = (this.vx + a.ax * sp) * 0.95; this.vy = (this.vy + a.ay * sp) * 0.95; this.vz = (this.vz + a.az * sp) * 0.95;
    if (this.age % 2 === 0) this.game.particles?.smoke(this.x, this.y + 0.15, this.z);
  }
}
function witherRose(g: Game, e: LivingEntity) {
  const w = g.world!, x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z);
  if (w.getId(x, y, z) === B.AIR && [B.GRASS, B.DIRT, B.PODZOL, B.COARSE_DIRT, B2.SOUL_SOIL, B.SOUL_SAND].includes(w.getId(x, y - 1, z))) w.set(x, y, z, B2.WITHER_ROSE);
  else g.dropItem(e.x, e.y + 0.5, e.z, stack(B2.WITHER_ROSE));
}

/**
 * A wither skeleton skull was placed at (x, y, z): if it completes the T of soul sand (or soil) with two more skulls,
 * the Wither comes to life there.
 */
export function buildWither(g: Game, x: number, y: number, z: number): Wither | null {
  const w = g.world!;
  const soul = (id: number) => id === B.SOUL_SAND || id === B2.SOUL_SOIL;
  const skull = (id: number) => id === B2.WITHER_SKELETON_SKULL || id === B2.WITHER_SKELETON_WALL_SKULL;
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    for (let k = -1; k <= 1; k++) {
      // the middle skull's column
      const mx = x - ax * k, mz = z - az * k;
      const ok = [-1, 0, 1].every((s) => skull(w.getId(mx + ax * s, y, mz + az * s)) && soul(w.getId(mx + ax * s, y - 1, mz + az * s)))
        && soul(w.getId(mx, y - 2, mz)) && !BLOCKS[w.getId(mx + ax, y - 2, mz + az)].solid && !BLOCKS[w.getId(mx - ax, y - 2, mz - az)].solid;
      if (!ok) continue;
      const cells: [number, number, number][] = [[mx, y - 2, mz]];
      for (const s of [-1, 0, 1]) cells.push([mx + ax * s, y, mz + az * s], [mx + ax * s, y - 1, mz + az * s]);
      for (const [cx, cy, cz] of cells) w.set(cx, cy, cz, 0);
      const wi = g.interact!.spawnMob('wither', mx + 0.5, y - 2, mz + 0.5) as Wither | null;
      if (wi) { wi.yaw = wi.bodyYaw = ax ? 0 : 90; g.audio.play('wither.spawn', null, 1, 1); }
      return wi;
    }
  }
  return null;
}
void idOf;
