// The Ender Dragon and its end crystals.
//
// The dragon flies through blocks (except obsidian, bedrock and end stone), swoops at the player, shoves things
// with its wings and bites with its head. Its body is made of several hit boxes; only the head takes full
// damage. End crystals on the pillars heal it until they are destroyed.
import { openGateway } from '../game/gateways';
import { LivingEntity, DamageSource } from './living';
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { AABB } from '../math';
import { B, BLOCKS } from '../world/blocks';
import { XpOrb } from './item';
import { Random } from '../noise';
import { END_CENTER_Y } from '../world/endgen';

const rng = new Random((Date.now() & 0xffff) + 99);
/** Blocks per 16 model pixels (the renderer scales the dragon model by this). */
export const DRAGON_SCALE = 3;
const UNIT = DRAGON_SCALE / 16; // blocks per model pixel

const wrap = (d: number) => { d %= 360; if (d >= 180) d -= 360; if (d < -180) d += 360; return d; };
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- end crystal
export class EndCrystal extends LivingEntity {
  typeName = 'End Crystal';
  model = 'crystal';
  persist = true;
  /** The dragon this crystal is currently healing (drawn as a beam). */
  beam: Entity | null = null;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 2; this.height = 2;
    this.maxHealth = this.health = 5;
  }
  override damage(_amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    if (this.dead || this.removed) return false;
    if (source === 'fall' || source === 'drown' || source === 'void' || source === 'suffocate' || source === 'cactus') return false;
    this.dead = this.removed = true;
    const g = this.game;
    for (const e of g.entities) if (e instanceof EnderDragon && e.crystal === this) e.crystalLost();
    g.interact?.explode(this.x, this.y + 1, this.z, 6, true, this);
    void attacker;
    return true;
  }
  override knockback() {}
  toJSON() { return { type: 'end_crystal', x: this.x, y: this.y, z: this.z, yaw: this.yaw, health: this.health }; }
  load(d: { x: number; y: number; z: number }) { this.setPos(d.x, d.y, d.z); }
}

// ---------------------------------------------------------------- pose shared by the hit boxes and the renderer
export interface Seg { x: number; y: number; z: number; ry: number; rx: number } // model pixels (y down, front -z)
export interface DragonPose { neck: Seg[]; head: Seg; tail: Seg[]; wing: number; tip: number; jaw: number; legs: number }

interface Pt { x: number; y: number; z: number }
const WING_PIVOT = { x: 12, y: -8, z: -10 };

/** Walk back along the dragon's recent flight path by `dist` blocks. */
function pathPoint(path: Pt[], dist: number, fx: number, fz: number): Pt {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (l < 1e-6) continue;
    if (acc + l >= dist) {
      const k = (dist - acc) / l;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    }
    acc += l;
  }
  // flight path too short (hovering): trail straight behind the last known point
  const e = path[path.length - 1];
  const rest = dist - acc;
  return { x: e.x - fx * rest, y: e.y, z: e.z - fz * rest };
}

/** World offset (blocks) from the dragon's centre -> model pixels. */
export function toModel(yawDeg: number, dx: number, dy: number, dz: number): [number, number, number] {
  const y = (yawDeg * Math.PI) / 180, c = Math.cos(y), s = Math.sin(y);
  return [(dx * c + dz * s) / UNIT, -dy / UNIT, (s * dx - c * dz) / UNIT];
}
/** Model pixels -> world offset (blocks). */
export function toWorld(yawDeg: number, mx: number, my: number, mz: number): [number, number, number] {
  const y = (yawDeg * Math.PI) / 180, c = Math.cos(y), s = Math.sin(y);
  return [(mx * c + mz * s) * UNIT, -my * UNIT, (mx * s - mz * c) * UNIT];
}

export function dragonPose(d: EnderDragon, t: number): DragonPose {
  const yaw = d.pyaw + wrap(d.yaw - d.pyaw) * t;
  const cx = d.lerpX(t), cy = d.lerpY(t), cz = d.lerpZ(t);
  const fx = -Math.sin((yaw * Math.PI) / 180), fz = Math.cos((yaw * Math.PI) / 180);
  const path: Pt[] = [{ x: cx, y: cy, z: cz }];
  for (const h of d.hist) path.push(h);
  // tail: follow the flight path
  const tail: Seg[] = [];
  for (let i = 0; i < 12; i++) {
    const s = (32 + 5 + i * 10) * UNIT;
    const p = pathPoint(path, s, fx, fz), a = pathPoint(path, s - 5 * UNIT, fx, fz), b = pathPoint(path, s + 5 * UNIT, fx, fz);
    const [mx, my, mz] = toModel(yaw, p.x - cx, p.y - cy, p.z - cz);
    const [ax, ay, az] = toModel(yaw, a.x - cx, a.y - cy, a.z - cz), [bx, by, bz] = toModel(yaw, b.x - cx, b.y - cy, b.z - cz);
    const ddx = bx - ax, ddy = by - ay, ddz = bz - az;
    tail.push({ x: mx, y: my, z: mz, ry: Math.atan2(ddx, ddz), rx: Math.atan2(ddy, Math.hypot(ddx, ddz)) * -1 });
  }
  // neck and head lean into turns and dip/rise with the flight
  const turn = clampN(wrap(d.yaw - d.pyaw) * 0.08, -0.5, 0.5);
  const pitch = clampN(-d.vy * 0.9, -0.55, 0.55);
  const neck: Seg[] = [];
  let px = 0, py = 0, pz = -32, yawN = 0, pitN = 0;
  for (let i = 0; i < 5; i++) {
    yawN += turn * 0.45;
    pitN += pitch * 0.2;
    const step = 10;
    const dirx = Math.sin(yawN) * Math.cos(pitN), dirz = -Math.cos(yawN) * Math.cos(pitN), diry = Math.sin(pitN);
    px += dirx * step * (i === 0 ? 0.5 : 1); py += diry * step * (i === 0 ? 0.5 : 1); pz += dirz * step * (i === 0 ? 0.5 : 1);
    neck.push({ x: px, y: py - 3 * (i + 1) * 0.8, z: pz, ry: -yawN, rx: pitN });
  }
  const last = neck[neck.length - 1];
  const hx = last.x + Math.sin(yawN) * 12, hy = last.y + Math.sin(pitN) * 12 - 2, hz = last.z - Math.cos(yawN) * 12;
  const head: Seg = { x: hx, y: hy, z: hz, ry: -yawN, rx: pitN };
  const flap = Math.sin((d.pAnimTime + (d.animTime - d.pAnimTime + (d.animTime < d.pAnimTime ? 1 : 0)) * t) * Math.PI * 2);
  const tipLag = Math.sin((d.animTime - 0.12) * Math.PI * 2);
  return { neck, head, tail, wing: flap * 0.55 + 0.15, tip: tipLag * 0.45, jaw: d.jawOpen, legs: 0.35 + flap * 0.12 };
}

// ---------------------------------------------------------------- the dragon
export class EnderDragon extends LivingEntity {
  /** The player it's after when chasing. */
  prey: LivingEntity | null = null;
  typeName = 'Ender Dragon';
  persist = true;
  boss = true;
  model = 'dragon';
  animTime = 0;
  pAnimTime = 0;
  hist: Pt[] = [];
  jawOpen = 0;
  crystal: EndCrystal | null = null;
  deathTicks = 0;
  private tx = 0; private ty = 80; private tz = 0;
  private chasing = false;
  private forceNew = true;
  private yawVel = 0;
  private growl = 200;
  private flapPhase = 0;

  constructor(world: World, public game: Game) {
    super(world);
    this.width = 16; this.height = 8;
    this.maxHealth = this.health = 200;
    this.noClip = true;
    this.fireImmune = true;
    this.canBreathe = true;
    this.yaw = this.pyaw = rng.next() * 360;
  }
  override eyeHeight() { return 0; }
  override get box(): AABB {
    return { x0: this.x - 3, y0: this.y - 3, z0: this.z - 3, x1: this.x + 3, y1: this.y + 3, z1: this.z + 3 };
  }
  override knockback() {}
  override isFlying() { return true; }

  /** Hit boxes of every body part (also used for ray casts and projectiles). */
  override hitBoxes(): (AABB & { part?: string })[] {
    // the pose walks the whole flight path, so it's built once per state, not per caller (look ray, arrows, collisions)
    const h = this.hist[0];
    const key = `${this.x},${this.y},${this.z},${this.yaw},${this.pyaw},${this.vy},${this.animTime},${this.hist.length},${h?.x},${h?.y},${h?.z}`;
    if (key !== this.boxKey) { this.boxKey = key; this.boxCache = this.buildHitBoxes(); }
    return this.boxCache;
  }
  private boxKey = '';
  private boxCache: (AABB & { part?: string })[] = [];

  private buildHitBoxes(): (AABB & { part?: string })[] {
    const p = dragonPose(this, 1);
    const at = (name: string, mx: number, my: number, mz: number, hx: number, hy: number, hz: number) => {
      const [dx, dy, dz] = toWorld(this.yaw, mx, my, mz);
      return { part: name, x0: this.x + dx - hx, y0: this.y + dy - hy, z0: this.z + dz - hz, x1: this.x + dx + hx, y1: this.y + dy + hy, z1: this.z + dz + hz };
    };
    const out = [
      at('head', p.head.x, p.head.y, p.head.z, 2.0, 2.0, 2.0),
      at('neck', p.neck[1].x, p.neck[1].y, p.neck[1].z, 2.0, 2.0, 2.0),
      at('neck', p.neck[3].x, p.neck[3].y, p.neck[3].z, 2.0, 2.0, 2.0),
      at('body', 0, 0, 0, 3.2, 3.0, 3.2),
      at('body', 0, 0, -16, 2.8, 2.6, 2.8),
      at('body', 0, 0, 16, 2.8, 2.6, 2.8),
      at('tail', p.tail[0].x, p.tail[0].y, p.tail[0].z, 1.7, 1.7, 1.7),
      at('tail', p.tail[2].x, p.tail[2].y, p.tail[2].z, 1.6, 1.6, 1.6),
      at('tail', p.tail[4].x, p.tail[4].y, p.tail[4].z, 1.5, 1.5, 1.5),
    ];
    // wings, swept back behind the shoulders
    const wy = (WING_PIVOT.y + 0) - p.wing * 28;
    out.push(at('wingR', -34, wy, 18, 3.4, 1.4, 5.2), at('wingL', 34, wy, 18, 3.4, 1.4, 5.2));
    return out;
  }

  // ---------------------------------------------------------------- behaviour
  override tick() {
    if (this.dead) { this.dying(); return; }
    this.hist.unshift({ x: this.x, y: this.y, z: this.z });
    if (this.hist.length > 220) this.hist.pop();
    this.fly();
    this.pAnimTime = this.animTime;
    const hs = Math.hypot(this.vx, this.vz);
    let f = 0.2 / (hs * 10 + 1);
    f *= Math.pow(2, this.vy);
    this.animTime = (this.animTime + f * (hs > 0.2 ? 0.5 : 1) + 0.012) % 1;
    // wing beats
    this.flapPhase += f;
    this.checkCrystals();
    this.collideWithEntities();
    this.destroyBlocks();
    this.jawOpen += ((this.chasing && this.prey && this.distanceTo(this.prey) < 30 ? 0.8 : 0.15 + 0.1 * Math.sin(this.age * 0.05)) - this.jawOpen) * 0.1;
    if (--this.growl <= 0) {
      this.growl = 150 + rng.int(300);
      this.game.audio.play('dragon.growl', this, 8, 0.9 + rng.next() * 0.2);
    }
    if (this.age % 24 === 0) this.game.audio.play('dragon.flap', this, 5, 0.9 + rng.next() * 0.2);
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
  }

  /** Port of the 1.8 flight controller: steer toward a target with limited turn rate. */
  private fly() {
    const p = this.prey;
    let dx = this.tx - this.x, dy = this.ty - this.y, dz = this.tz - this.z;
    let d3 = dx * dx + dy * dy + dz * dz;
    if (this.chasing && p && !p.dead) {
      this.tx = p.x; this.tz = p.z;
      dx = this.tx - this.x; dz = this.tz - this.z;
      let d5 = 0.4 + Math.hypot(dx, dz) / 80 - 1;
      if (d5 > 10) d5 = 10;
      this.ty = p.y + d5;
      dy = this.ty - this.y;
    } else {
      this.tx += rng.gaussian() * 2;
      this.tz += rng.gaussian() * 2;
      dx = this.tx - this.x; dz = this.tz - this.z;
    }
    d3 = dx * dx + dy * dy + dz * dz;
    if (this.forceNew || d3 < 100 || d3 > 22500) this.newTarget();
    const horiz = Math.hypot(dx, dz) || 1;
    this.vy += clampN(dy / horiz, -0.6, 0.6) * 0.1;
    const wanted = (-Math.atan2(dx, dz) * 180) / Math.PI; // heading that points at the target
    const f1 = clampN(wrap(wanted - this.yaw), -50, 50);
    const tl = Math.hypot(dx, dy, dz) || 1;
    const tvx = dx / tl, tvy = dy / tl, tvz = dz / tl;
    const yr = (this.yaw * Math.PI) / 180;
    const fl = Math.hypot(-Math.sin(yr), this.vy, Math.cos(yr)) || 1;
    const fvx = -Math.sin(yr) / fl, fvy = this.vy / fl, fvz = Math.cos(yr) / fl;
    let f5 = (fvx * tvx + fvy * tvy + fvz * tvz + 0.5) / 1.5;
    if (f5 < 0) f5 = 0;
    this.yawVel *= 0.8;
    const hs = Math.hypot(this.vx, this.vz);
    const f6 = hs + 1;
    let d10 = hs + 1;
    if (d10 > 40) d10 = 40;
    this.yawVel += f1 * (0.7 / d10 / f6);
    this.yaw += this.yawVel * 0.1;
    const f7 = 2 / (d10 + 1);
    const accel = 0.06 * (f5 * f7 + (1 - f7));
    this.vx += -Math.sin((this.yaw * Math.PI) / 180) * accel;
    this.vz += Math.cos((this.yaw * Math.PI) / 180) * accel;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    const vl = Math.hypot(this.vx, this.vy, this.vz) || 1;
    let f9 = ((this.vx / vl) * fvx + (this.vy / vl) * fvy + (this.vz / vl) * fvz + 1) / 2;
    f9 = 0.8 + 0.15 * f9;
    this.vx *= f9; this.vz *= f9; this.vy *= 0.91;
    this.bodyYaw = this.headYaw = this.yaw;
    if (this.y < 55) this.vy += 0.05; // never dive into the void under the island
  }

  private newTarget() {
    this.forceNew = false;
    // half the time, go after one of the players in the End
    const ps = this.game.playerEntities().filter((q) => !q.dead && !q.spectator);
    const p = ps.length ? ps[rng.int(ps.length)] : null;
    this.prey = p;
    if (rng.int(2) === 0 && p) {
      this.chasing = true;
      this.tx = p.x; this.tz = p.z; this.ty = p.y;
      return;
    }
    this.chasing = false;
    let d = 0;
    do {
      this.tx = rng.next() * 120 - 60;
      this.ty = 70 + rng.next() * 50;
      this.tz = rng.next() * 120 - 60;
      d = (this.x - this.tx) ** 2 + (this.y - this.ty) ** 2 + (this.z - this.tz) ** 2;
    } while (d <= 100);
  }

  /** Heals from the nearest crystal; the crystal draws a beam to the dragon. */
  private checkCrystals() {
    if (this.crystal && (this.crystal.removed || this.crystal.dead)) this.setCrystal(null);
    if (this.crystal) {
      this.crystal.beam = this;
      if (this.age % 10 === 0 && this.health < this.maxHealth) this.health++;
    }
    // like 1.8: re-pick the nearest crystal within 32 blocks now and then, letting go when none is in range
    if (rng.int(10) === 0) {
      let best: EndCrystal | null = null, bd = 32 * 32;
      for (const e of this.game.entities) {
        if (!(e instanceof EndCrystal) || e.removed || e.dead) continue;
        const d = (e.x - this.x) ** 2 + (e.y - this.y) ** 2 + (e.z - this.z) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      this.setCrystal(best);
    }
  }

  /** Switch the healing crystal, taking the beam away from the old one. */
  private setCrystal(c: EndCrystal | null) {
    if (this.crystal && this.crystal !== c && this.crystal.beam === this) this.crystal.beam = null;
    this.crystal = c;
  }

  crystalLost() {
    this.setCrystal(null);
    this.invulnerable = 0;
    this.hitPart = 'head';
    this.damage(10, 'explosion', null);
  }

  /** Wings shove entities aside; the head and neck bite hard. */
  private collideWithEntities() {
    const boxes = this.hitBoxes();
    const g = this.game;
    const targets: LivingEntity[] = [];
    for (const e of g.entities) if (e instanceof LivingEntity && !(e instanceof EnderDragon) && !(e instanceof EndCrystal) && !e.dead && !(e as { spectator?: boolean }).spectator) targets.push(e);
    for (const e of targets) {
      const b = e.box;
      for (const pb of boxes) {
        const grow = pb.part === 'wingL' || pb.part === 'wingR' ? { x: 3, y: 1.5, z: 3 } : pb.part === 'head' || pb.part === 'neck' ? { x: 1, y: 1, z: 1 } : null;
        if (!grow) continue;
        if (b.x1 < pb.x0 - grow.x || b.x0 > pb.x1 + grow.x || b.y1 < pb.y0 - grow.y || b.y0 > pb.y1 + grow.y || b.z1 < pb.z0 - grow.z || b.z0 > pb.z1 + grow.z) continue;
        if (pb.part === 'head' || pb.part === 'neck') {
          if (e.damage(10, 'mob', this)) g.audio.play('dragon.hit', this, 3, 1);
        } else {
          const cx = (pb.x0 + pb.x1) / 2, cz = (pb.z0 + pb.z1) / 2;
          const ex = e.x - cx, ez = e.z - cz, l = Math.hypot(ex, ez) || 1;
          e.vx += (ex / l) * 1.2; e.vz += (ez / l) * 1.2; e.vy += 0.25;
        }
        break;
      }
    }
  }

  /** Smashes through most blocks; obsidian, bedrock and end stone survive. */
  private destroyBlocks() {
    const w = this.world;
    for (const pb of this.hitBoxes()) {
      if (pb.part !== 'head' && pb.part !== 'neck' && pb.part !== 'body') continue;
      const x0 = Math.floor(pb.x0), x1 = Math.floor(pb.x1), y0 = Math.floor(pb.y0), y1 = Math.floor(pb.y1), z0 = Math.floor(pb.z0), z1 = Math.floor(pb.z1);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++) {
            const id = w.getId(x, y, z);
            if (id === 0 || id === B.OBSIDIAN || id === B.BEDROCK || id === B.END_STONE || id === B.END_PORTAL) continue;
            if (BLOCKS[id].hardness < 0) continue;
            w.set(x, y, z, B.AIR);
            if (rng.int(6) === 0) this.game.particles?.smoke(x + 0.5, y + 0.5, z + 0.5, true);
          }
    }
  }

  // ---------------------------------------------------------------- damage & death
  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    // the hit part only applies to the hit that set it
    const part = this.hitPart;
    this.hitPart = null;
    if (this.dead) return false;
    if (source === 'void' || source === 'fall' || source === 'drown' || source === 'suffocate' || source === 'cactus' || source === 'lava' || source === 'fire') return false;
    if (source === 'mob') return false;
    if (part !== 'head' && source !== 'explosion') amount = amount / 4 + 1;
    const r = super.damage(amount, source, attacker);
    if (r) {
      this.game.audio.play('dragon.hit', this, 4, 0.9 + rng.next() * 0.2);
      this.game.particles?.explosion(this.x + (rng.next() - 0.5) * 4, this.y + (rng.next() - 0.5) * 3, this.z + (rng.next() - 0.5) * 4);
    }
    return r;
  }

  override die(source: DamageSource, attacker: Entity | null) {
    super.die(source, attacker);
    this.deathTicks = 0;
    this.setCrystal(null);
    this.vx = this.vz = 0; this.vy = 0.02;
    this.game.audio.play('dragon.death', null, 3, 1);
  }

  /** 200 ticks of spinning, exploding and raining experience, then the exit portal opens. */
  private dying() {
    const g = this.game;
    this.deathTicks++;
    this.y += 0.1;
    this.yaw += 20;
    if (this.deathTicks >= 1 && this.deathTicks % 4 === 0) {
      g.particles?.explosion(this.x + (rng.next() - 0.5) * 8, this.y + (rng.next() - 0.5) * 4, this.z + (rng.next() - 0.5) * 8);
      for (let i = 0; i < 6; i++) g.particles?.spell(this.x + (rng.next() - 0.5) * 10, this.y + (rng.next() - 0.5) * 6, this.z + (rng.next() - 0.5) * 10, 0xe070ff);
    }
    if (this.deathTicks === 1) g.audio.play('explode', this, 5, 0.6);
    if (this.deathTicks > 150 && this.deathTicks % 5 === 0 && this.deathTicks < 200) {
      const o = new XpOrb(this.world, g, 1000);
      o.setPos(this.x, this.y, this.z);
      g.addEntity(o);
    }
    if (this.deathTicks >= 200) {
      this.removed = true;
      for (let i = 0; i < 40; i++) g.particles?.explosion(this.x + (rng.next() - 0.5) * 14, this.y + (rng.next() - 0.5) * 6, this.z + (rng.next() - 0.5) * 14);
      g.audio.play('explode', null, 5, 0.5);
      finishDragonFight(g);
    }
  }

  toJSON() {
    return { type: 'ender_dragon', x: this.x, y: this.y, z: this.z, yaw: this.yaw, health: this.health, dead: this.dead, deathTicks: this.deathTicks, vx: this.vx, vy: this.vy, vz: this.vz };
  }
  load(d: { x: number; y: number; z: number; yaw: number; health: number; dead?: boolean; deathTicks?: number; vx?: number; vy?: number; vz?: number }) {
    this.setPos(d.x, d.y, d.z);
    this.yaw = this.pyaw = this.bodyYaw = d.yaw;
    this.health = d.health;
    this.dead = !!d.dead;
    this.deathTicks = d.deathTicks ?? 0;
    this.vx = d.vx ?? 0; this.vy = d.vy ?? 0; this.vz = d.vz ?? 0;
  }
}

/** The dragon is gone: light the exit portal and leave the egg on top of the fountain. */
export function finishDragonFight(g: Game) {
  const w = g.world;
  if (!w || w.dimension !== 'end') return;
  if (g.meta) {
    if (!g.meta.dragonKilled) g.meta.dragonEggPending = true;
    g.meta.dragonKilled = true;
  }
  g.achievements.unlock('theEnd2');
  g.ui.chat.add('§dThe Ender Dragon has been slain. The exit portal opens beneath you.');
  buildExitPortal(g);
  openGateway(g);
}

/**
 * Light the exit portal (and place a pending egg) once the fountain's chunks are loaded. The fight can end far
 * from the origin, so this is retried every second while in the End; it also repairs a missing portal.
 */
export function buildExitPortal(g: Game) {
  const w = g.world, meta = g.meta;
  if (!w || w.dimension !== 'end' || !meta?.dragonKilled) return;
  for (const [x, z] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (!w.chunkAt(x, z)) return;
  const F = END_CENTER_Y;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      const r2 = dx * dx + dz * dz;
      // the bedrock pillar stays in the middle of the portal
      if (r2 === 0 || r2 > 6) continue;
      if (w.getId(dx, F + 1, dz) !== B.END_PORTAL) w.set(dx, F + 1, dz, B.END_PORTAL);
    }
  if (meta.dragonEggPending) {
    w.set(0, F + 4, 0, B.DRAGON_EGG);
    meta.dragonEggPending = false;
  }
}
