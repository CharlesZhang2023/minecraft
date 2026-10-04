// The server half (the host, or this page in single-player): fires wands, flies their projectiles, applies what
// they do, and tells each player what to show. Projectiles aren't entities: each cast sends one small message per
// projectile, every client flies its own copy, and the server only reports where each one ended (plus a position
// now and then for the ones that steer), which keeps a screen full of spells cheap to send.
import type { ModContext, Game, Player, Entity, ItemStack, Channel } from '../sdk';
import { SPELL_BY_ID, SPELL_INDEX, Shot, makeProj, type Proj, type SpellWorld, type Live, type HitInfo, type SpellDef } from './spells';
import { fire, finalProjs, newRuntime, catchUp, ready, type Runtime } from './engine';
import { bodyOf, rayBlocks, displacement, steer, bounce, rayEnd, type Body } from './motion';
import { wandOf, withWand, rollWand, fixUses, cloneWand, sanitize, type WandData } from './wand';

/** Host-side settings (the host's own browser decides them for its games). */
export interface ServerCfg { terrain: boolean; selfDamage: boolean; pvp: boolean; creativeInfinite: boolean }

/** A projectile in flight. */
interface Flying extends Body {
  id: number;
  p: Proj;
  caster: Entity | null;
  dim: string;
  speedMul: number;
  /** Things a piercing projectile already went through (entity id -> age). */
  hits: Map<number, number>;
  fired: boolean;
  digLeft: number;
  dead: boolean;
  ox: number; oy: number; oz: number;
}

/** Server -> client messages (one bundle per player per tick). */
export type FxEvent =
  | { k: 's'; i: number; s: number; p: number[]; v: number[]; c: number; z: number; g: number; l: number; b: number; h: number; pa: string; sd: number; dr: number; bk: number; gh: number; fu: number; rb: number; dg: number; o: number[] }
  | { k: 'e'; i: number; p: number[]; r: string }
  | { k: 'y'; i: number; p: number[]; v: number[] }
  | { k: 'x'; p: number[]; r: number; c: number }
  | { k: 'f'; n: string; p: number[]; d?: number[] }
  | { k: 'd'; p: number[]; a: number; c: number }
  | { k: 'w'; s: number; m: number; mm: number; d: number; dt: number; r: number; rt: number; dk: number[]; inf: number }
  | { k: 'w'; s: -1 }
  | { k: 'a'; rev: number; ok: number; msg?: string };

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const MAX_PROJS = 600;

export class SpellServer {
  private flying = new Map<string, Flying[]>();
  private nextId = 1;
  private runtimes = new Map<string, Runtime>();
  private dimOut = new Map<string, FxEvent[]>();
  private playerOut = new Map<Player, FxEvent[]>();
  private shown = new WeakMap<Player, string>();
  private fizzleAt = new WeakMap<Player, number>();
  private rng = Math.random;

  constructor(private mod: ModContext, private cfg: ServerCfg, private fx: Channel<FxEvent[]>, private spellItem: (spell: string) => number | undefined, private tierOf: (item: number) => number | undefined) {}

  // ------------------------------------------------------------------ wands in hand
  private get mc() { return this.mod.mc; }
  private runtime(w: WandData, now: number): Runtime {
    let rt = this.runtimes.get(w.uid!);
    if (!rt) this.runtimes.set(w.uid!, (rt = newRuntime(w, now)));
    return rt;
  }

  /** A wand stack ready to use: stats rolled and an id given the first time (writes the stack back). */
  attune(player: Player, slot: number, tier: number): { stack: ItemStack; w: WandData } | null {
    const stack = player.inventory.main[slot];
    if (!stack) return null;
    let w = wandOf(stack);
    if (w?.uid) return { stack, w };
    w = w ? cloneWand(w) : rollWand(tier);
    w.uid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    fixUses(w);
    const s = withWand(stack, w);
    player.inventory.main[slot] = s;
    return { stack: s, w };
  }

  private infinite(w: WandData, player: Player) {
    return !!w.inf || (this.cfg.creativeInfinite && !!player.creative);
  }

  /** The use button is held with a wand (ItemBehavior.useTick, inside the simulation). */
  useTick(game: Game, player: Player, tier: number) {
    const slot = player.inventory.selected;
    const a = this.attune(player, slot, tier);
    if (!a) return;
    let { w } = a;
    const rt = this.runtime(w, game.ticks);
    const regained = catchUp(w, rt, game.ticks);
    if (regained.length) w = this.regain(player, slot, w, regained);
    if (!ready(rt)) return;
    const inf = this.infinite(w, player);
    let uses = w.uses ? [...w.uses] : null;
    const res = fire(w, rt, {
      rand: this.rng, infinite: inf,
      usesLeft: (i) => uses?.[i] ?? 0,
      spendUse: (i) => { if (uses && typeof uses[i] === 'number') uses[i] = (uses[i] as number) - 1; },
    });
    if (uses && JSON.stringify(uses) !== JSON.stringify(w.uses)) {
      const nw = { ...cloneWand(w), uses };
      player.inventory.main[slot] = withWand(player.inventory.main[slot]!, nw);
      w = nw;
    }
    if (!res || !res.cards.length) {
      if (res?.noMana && (this.fizzleAt.get(player) ?? 0) < game.ticks) {
        this.fizzleAt.set(player, game.ticks + 10);
        game.audio.play('wands:fizzle', { x: player.x, y: player.y + 1, z: player.z }, 0.6, 1);
      }
      if (res && !rt.delay) rt.delay = rt.delayTotal = 4;
      return;
    }
    const eye = { x: player.x, y: player.y + player.eyeHeight(), z: player.z };
    const look = this.aimOf(game, player);
    // spells leave from the wand's tip (in the right hand), toward whatever the player is aiming at
    let rx = look[1] * 0 - look[2] * 1, rz = look[0] * 1 - look[1] * 0;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ox = eye.x + look[0] * 0.6 + rx * 0.28, oy = eye.y + look[1] * 0.6 - 0.22, oz = eye.z + look[2] * 0.6 + rz * 0.28;
    const at = rayEnd(eye.x, eye.y, eye.z, look[0], look[1], look[2], 48, this.solid(game));
    const tx = at.x - ox, ty = at.y - oy, tz = at.z - oz, tl = Math.hypot(tx, ty, tz);
    const d: [number, number, number] = tl > 1.5 ? [tx / tl, ty / tl, tz / tl] : look;
    const first = res.shot.projs[0]?.spell;
    game.audio.play('wands:cast', eye, 0.5, first ? 0.8 + ((SPELL_INDEX.get(first.id) ?? 0) % 7) * 0.08 : 1);
    this.release(game, res.shot, ox, oy, oz, d, player, w.s.speed, 0);
  }

  private regain(player: Player, slot: number, w: WandData, slots: number[]): WandData {
    const nw = cloneWand(w);
    nw.uses = [...(w.uses ?? [])];
    for (const i of slots) if (typeof nw.uses[i] === 'number') nw.uses[i] = (nw.uses[i] as number) + 1;
    player.inventory.main[slot] = withWand(player.inventory.main[slot]!, nw);
    return nw;
  }

  /** Where a player is aiming: the client's aim ray (touch aiming points where the finger is) or their look. */
  private aimOf(game: Game, player: Player): [number, number, number] {
    const sp = game.playerOf(player) as unknown as { dir: [number, number, number] | null } | null;
    if (sp?.dir && sp.dir.every(Number.isFinite)) {
      const [x, y, z] = sp.dir, l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    }
    const v = game.lookVec(player.yaw, player.pitch);
    return [v.x, v.y, v.z];
  }

  // ------------------------------------------------------------------ casting
  private solid = (game: Game) => (x: number, y: number, z: number) => this.mc.BLOCKS[game.world!.getId(x, y, z)]?.solid ?? false;

  /** Send a cast's projectiles on their way from a point, in a direction. */
  release(game: Game, shot: Shot, ox: number, oy: number, oz: number, dir: [number, number, number], caster: Entity | null, speedMul: number, depth: number) {
    if (depth > 8) return;
    const list = this.flying.get(game.dimension) ?? [];
    this.flying.set(game.dimension, list);
    const solid = this.solid(game);
    for (const p of finalProjs(shot)) {
      if (list.length >= MAX_PROJS) break;
      let [dx, dy, dz] = rotate(dir, p.yawOff, p.pitchOff);
      const spread = Math.max(0, shot.spread + p.spread);
      if (spread > 0) [dx, dy, dz] = cone(dx, dy, dz, spread, this.rng);
      let x = ox, y = oy, z = oz;
      if (shot.teleport || p.sky || (p.aim && depth === 0)) {
        const e = rayEnd(ox, oy, oz, dir[0], dir[1], dir[2], p.sky ? 48 : p.aim ? 20 : 32, solid);
        x = e.x; y = e.y; z = e.z;
      }
      if (shot.forward) {
        const e = rayEnd(x, y, z, dx, dy, dz, shot.forward, solid);
        x = e.x; y = e.y; z = e.z;
      }
      if (p.sky) {
        // from high above the target, falling onto it
        const tx = x, ty = y, tz = z;
        x = tx + (this.rng() - 0.5) * 6; y = ty + 22; z = tz + (this.rng() - 0.5) * 6;
        const l = Math.hypot(tx - x, ty - y, tz - z) || 1;
        dx = (tx - x) / l; dy = (ty - y) / l; dz = (tz - z) / l;
      }
      const speed = p.speed * speedMul * (0.95 + this.rng() * 0.1);
      if (p.speed === 0 && !shot.teleport && !p.aim && depth === 0) {
        // static spells appear just in front of the wand
        const e = rayEnd(x, y, z, dx, dy, dz, 1.5, solid);
        x = e.x; y = e.y; z = e.z;
      }
      const f: Flying = {
        ...bodyOf(p, x, y, z, dx * speed, dy * speed, dz * speed, Math.floor(this.rng() * 1e9)),
        id: this.nextId++, p, caster, dim: game.dimension, speedMul, hits: new Map(), fired: false, digLeft: p.digCount, dead: false, ox: x, oy: y, oz: z,
      };
      list.push(f);
      this.emit(f.dim, {
        k: 's', i: f.id, s: SPELL_INDEX.get(p.spell.id) ?? 0, p: [r3(x), r3(y), r3(z)], v: [r3(f.vx), r3(f.vy), r3(f.vz)], c: p.color, z: r3(p.size),
        g: r3(p.gravity), l: p.life, b: p.bounces, h: r3(p.homing), pa: p.path, sd: f.seed, dr: r3(p.drag), bk: r3(p.bounceKeep), gh: p.ghost ? 1 : 0,
        fu: p.fuse ? 1 : 0, rb: p.rainbow ? 1 : 0, dg: p.digHard > 0 ? 1 : 0, o: caster ? [caster.id] : [],
      });
    }
  }

  // ------------------------------------------------------------------ flying
  tick(game: Game) {
    for (const [dimName, list] of this.flying) {
      if (!list.length) continue;
      const dim = (game as unknown as { dims: Map<string, unknown> }).dims.get(dimName);
      if (!dim) { list.length = 0; continue; }
      game.inDim(dim as never, () => {
        for (const f of [...list]) if (!f.dead) this.step(game, f);
        for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
      });
    }
    this.hud(game);
    this.flush(game);
  }

  private live(game: Game, f: Flying): Live {
    return Object.assign(f, { kill: () => { if (!f.dead) this.end(game, f, { x: f.x, y: f.y, z: f.z, nx: 0, ny: 0, nz: 0, entity: null, reason: 'expire' }); } }) as unknown as Live;
  }

  private step(game: Game, f: Flying) {
    const w = game.world!, B = this.mc.BLOCKS;
    f.age++;
    const sw = this.world(game, f);
    if (f.p.spell.tick) f.p.spell.tick(this.live(game, f), sw);
    if (f.dead) return;
    if (f.p.trigger === 'timer' && !f.fired && f.age >= (f.p.timer ?? 10)) { f.fired = true; this.payload(game, f, f.x, f.y, f.z); }
    if (f.age > f.life) { this.end(game, f, { x: f.x, y: f.y, z: f.z, nx: 0, ny: 0, nz: 0, entity: null, reason: 'expire' }); return; }
    if (f.y < -64 || f.y > 320) { f.dead = true; this.emit(f.dim, { k: 'e', i: f.id, p: [f.x, f.y, f.z], r: 'gone' }); return; }
    const moving = f.vx !== 0 || f.vy !== 0 || f.vz !== 0 || f.gravity !== 0;
    if (!moving) return;
    steer(f, f.homing > 0 ? this.homingTarget(game, f) : null);
    const [dx, dy, dz] = displacement(f);
    const solid = (x: number, y: number, z: number) => B[w.getId(x, y, z)]?.solid ?? false;
    // drills: blocks soft enough are dug out of the way as it meets them
    const diggable = (x: number, y: number, z: number) => {
      if (f.digLeft <= 0 || f.p.digR > 0 || !this.cfg.terrain) return false;
      const d = B[w.getId(x, y, z)];
      return !!d && d.hardness >= 0 && d.hardness <= f.p.digHard;
    };
    let hit = f.ghost ? null : rayBlocks(f.x, f.y, f.z, dx, dy, dz, solid);
    for (let n = 0; hit && n < 8 && diggable(hit.bx, hit.by, hit.bz); n++) {
      this.digBlocks(game, [[hit.bx, hit.by, hit.bz]], 1, 'break');
      f.digLeft--;
      hit = rayBlocks(f.x, f.y, f.z, dx, dy, dz, solid);
    }
    // what's in the way first: a creature or the block
    const tmax = hit ? hit.t : 1;
    const ent = this.firstEntity(game, f, dx, dy, dz, tmax);
    if (ent) {
      const t = ent.t;
      const hx = f.x + dx * t, hy = f.y + dy * t, hz = f.z + dz * t;
      this.hitEntity(game, f, ent.e);
      if (!f.p.pierce) {
        f.x = hx; f.y = hy; f.z = hz;
        this.end(game, f, { x: hx, y: hy, z: hz, nx: 0, ny: 0, nz: 0, entity: ent.e, reason: 'entity' });
        return;
      }
    }
    if (hit) {
      if (f.p.digR > 0 && this.cfg.terrain) {
        this.dig(game, hit.bx + 0.5, hit.by + 0.5, hit.bz + 0.5, f.p.digR, f.p.digHard, 1);
        f.x = hit.x; f.y = hit.y; f.z = hit.z;
        this.end(game, f, { ...hit, entity: null, reason: 'block' });
        return;
      }
      if (f.bounces > 0) {
        bounce(f, hit);
        if (f.fuse) return;
        this.emit(f.dim, { k: 'y', i: f.id, p: [r3(f.x), r3(f.y), r3(f.z)], v: [r3(f.vx), r3(f.vy), r3(f.vz)] });
        return;
      }
      f.x = hit.x; f.y = hit.y; f.z = hit.z;
      if (f.fuse) { f.vx = f.vy = f.vz = 0; f.gravity = 0; return; }
      this.end(game, f, { ...hit, entity: null, reason: 'block' });
      return;
    }
    f.x += dx; f.y += dy; f.z += dz;
    if (f.p.fireTrail && f.age % 2 === 0) sw.ignite(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z));
    // steering ones drift apart from the clients' copies: correct them now and then
    if ((f.homing > 0 || f.path === 'chaos') && f.age % 8 === 0) this.emit(f.dim, { k: 'y', i: f.id, p: [r3(f.x), r3(f.y), r3(f.z)], v: [r3(f.vx), r3(f.vy), r3(f.vz)] });
  }

  private isLiving(e: Entity) { return e instanceof this.mc.LivingEntity && !(e as unknown as { dead: boolean }).dead; }
  private isPlayer(e: Entity) { return e instanceof this.mc.Player; }

  /** Things a projectile may hit: living, not its caster, not a spectator, not players when PvP is off. */
  private canHit(f: Flying, e: Entity) {
    if (!this.isLiving(e) || e === f.caster || e.removed) return false;
    if (this.isPlayer(e)) {
      const p = e as unknown as Player;
      if (p.spectator) return false;
      if (!this.cfg.pvp && f.caster && this.isPlayer(f.caster)) return false;
    }
    const at = f.hits.get(e.id);
    return at === undefined || f.age - at > 10;
  }

  private firstEntity(game: Game, f: Flying, dx: number, dy: number, dz: number, tmax: number): { e: Entity; t: number } | null {
    let best: { e: Entity; t: number } | null = null;
    const pad = Math.min(0.35, f.p.size * 0.5) + 0.05;
    const minX = Math.min(f.x, f.x + dx) - 4, maxX = Math.max(f.x, f.x + dx) + 4;
    const minZ = Math.min(f.z, f.z + dz) - 4, maxZ = Math.max(f.z, f.z + dz) + 4;
    for (const e of game.entities) {
      if (e.x < minX || e.x > maxX || e.z < minZ || e.z > maxZ || !this.canHit(f, e)) continue;
      for (const b of e.hitBoxes()) {
        const t = segBox(f.x, f.y, f.z, dx, dy, dz, b.x0 - pad, b.y0 - pad, b.z0 - pad, b.x1 + pad, b.y1 + pad, b.z1 + pad);
        if (t !== null && t <= tmax && (!best || t < best.t)) best = { e, t };
      }
    }
    return best;
  }

  /** The monster nearest to where a homing projectile is heading. */
  private homingTarget(game: Game, f: Flying) {
    let best: Entity | null = null, bd = 16 * 16;
    const sp = Math.hypot(f.vx, f.vy, f.vz) || 1;
    for (const e of game.entities) {
      if (!this.canHit(f, e)) continue;
      const hostile = (e as unknown as { hostile?: boolean }).hostile || (f.caster && !this.isPlayer(f.caster) && this.isPlayer(e));
      if (!hostile) continue;
      const tx = e.x - f.x, ty = e.y + e.height / 2 - f.y, tz = e.z - f.z;
      const d = tx * tx + ty * ty + tz * tz;
      // in front of it, more or less
      if (d < bd && (tx * f.vx + ty * f.vy + tz * f.vz) / sp > -2) { bd = d; best = e; }
    }
    return best ? { x: best.x, y: best.y + best.height / 2, z: best.z } : null;
  }

  private hitEntity(game: Game, f: Flying, e: Entity) {
    f.hits.set(e.id, f.age);
    const p = f.p;
    if (p.heal > 0) { this.world(game, f).heal(e, p.heal * p.dmgMul); return; }
    let dmg = p.dmg * p.dmgMul;
    if (dmg <= 0 && !p.knock) return;
    const crit = p.crit > 0 && this.rng() < p.crit;
    if (crit) dmg *= 3;
    const sp = Math.hypot(f.vx, f.vy, f.vz) || 1, k = 0.12 + p.knock * 0.5;
    this.hurt(game, f.caster, e, dmg, { fire: p.fire, freeze: p.freeze, kx: (f.vx / sp) * k, ky: 0.08 + p.knock * 0.15, kz: (f.vz / sp) * k, crit });
  }

  /** Spell damage: ignores the usual half-second of invulnerability (a wand fires faster than that). */
  hurt(game: Game, caster: Entity | null, e: Entity, dmg: number, o: { fire?: boolean; freeze?: boolean; kx?: number; ky?: number; kz?: number; crit?: boolean; blast?: boolean } = {}) {
    if (!this.isLiving(e)) return;
    const le = e as unknown as { invulnerable: number; damage(n: number, s: string, a: Entity | null): boolean; fireTicks: number; fireImmune?: boolean; addEffect(id: string, d: number, a: number): void; height: number };
    if (e === caster && !this.cfg.selfDamage) { if (o.kx !== undefined) this.push(e, o.kx, o.ky ?? 0, o.kz ?? 0); return; }
    if (this.isPlayer(e) && caster && this.isPlayer(caster) && e !== caster && !this.cfg.pvp) return;
    const v0 = [e.vx, e.vy, e.vz];
    const inv = le.invulnerable;
    le.invulnerable = 0;
    // fire spells hurt like magic and set alight (fire-immune mobs only shrug off the burning)
    const ok = dmg > 0 ? le.damage(dmg, o.blast ? 'explosion' : 'magic', caster) : true;
    le.invulnerable = inv;
    if (!ok) return;
    // our own push along the spell's flight, not vanilla's toward the attacker
    e.vx = v0[0] + (o.kx ?? 0); e.vy = Math.max(v0[1], 0) + (o.ky ?? 0); e.vz = v0[2] + (o.kz ?? 0);
    if (o.fire && !le.fireImmune) le.fireTicks = Math.max(le.fireTicks, 80);
    if (o.freeze) le.addEffect('slowness', 60, 2);
    if (dmg > 0 && caster && this.isPlayer(caster)) this.toPlayer(caster as unknown as Player, { k: 'd', p: [r3(e.x), r3(e.y + le.height + 0.2), r3(e.z)], a: Math.round(dmg * 100) / 100, c: o.crit ? 1 : 0 });
  }

  private push(e: Entity, kx: number, ky: number, kz: number) { e.vx += kx; e.vy += ky; e.vz += kz; }

  private payload(game: Game, f: Flying, x: number, y: number, z: number, nx = 0, ny = 0, nz = 0) {
    const shot = f.p.payload;
    if (!shot) return;
    const sp = Math.hypot(f.vx, f.vy, f.vz);
    let d: [number, number, number] = sp > 1e-4 ? [f.vx / sp, f.vy / sp, f.vz / sp] : [0, 1, 0];
    // off a wall: back out of it (a trigger on a wall bounces its spell back, like Noita's)
    if (nx || ny || nz) {
      const dot = d[0] * nx + d[1] * ny + d[2] * nz;
      d = [d[0] - 2 * dot * nx, d[1] - 2 * dot * ny, d[2] - 2 * dot * nz];
    }
    this.release(game, shot, x + nx * 0.15, y + ny * 0.15, z + nz * 0.15, d, f.caster, f.speedMul, 1);
  }

  private end(game: Game, f: Flying, h: HitInfo) {
    if (f.dead) return;
    f.dead = true;
    const p = f.p, sw = this.world(game, f);
    if (p.explR > 0) sw.blast(h.x + h.nx * 0.3, h.y + h.ny * 0.3, h.z + h.nz * 0.3, p.explR, p.explDmg * p.dmgMul, p.terrain, p.fire, p.color);
    if (p.elec > 0) {
      for (const e of sw.near(h.x, h.y, h.z, 2.5, true)) sw.hurt(e, p.elec * p.dmgMul);
      sw.fx('zap', h.x, h.y, h.z);
    }
    if (p.freeze) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 0; dy++) {
        const x = Math.floor(h.x) + dx, y = Math.floor(h.y) + dy, z = Math.floor(h.z) + dz;
        if (sw.id(x, y, z) === 'water') sw.place(x, y, z, 'ice');
      }
    }
    if (p.fire && h.reason === 'block') sw.ignite(Math.floor(h.x + h.nx * 0.5), Math.floor(h.y + h.ny * 0.5), Math.floor(h.z + h.nz * 0.5));
    if (p.spell.hit) p.spell.hit(this.live(game, f), h, sw);
    const t = p.trigger;
    if (t && (t === 'expire' || (t === 'hit' && h.reason !== 'expire') || (t === 'timer' && !f.fired))) {
      f.fired = true;
      this.payload(game, f, h.x, h.y, h.z, h.nx, h.ny, h.nz);
    }
    this.emit(f.dim, { k: 'e', i: f.id, p: [r3(h.x), r3(h.y), r3(h.z)], r: h.reason });
  }

  // ------------------------------------------------------------------ the world, as spells see it
  private world(game: Game, f: Flying | null): SpellWorld {
    const mc = this.mc, w = game.world!, caster = f?.caster ?? null;
    const def = (x: number, y: number, z: number) => mc.BLOCKS[w.getId(x, y, z)];
    return {
      blast: (x, y, z, r, dmg, terrain, fireOn, color) => this.blast(game, caster, x, y, z, r, dmg, terrain, fireOn, color),
      dig: (x, y, z, r, hard) => this.dig(game, x, y, z, r, hard, f?.p.spell.id === 'black_hole' ? 0 : 1),
      near: (x, y, z, r, others) => game.entities.filter((e) => {
        if (!this.isLiving(e) || (others && e === caster) || (this.isPlayer(e) && (e as unknown as Player).spectator)) return false;
        const d = Math.hypot(e.x - x, e.y + e.height / 2 - y, e.z - z) - e.width / 2;
        return d <= r;
      }),
      hurt: (e, dmg, o) => this.hurt(game, caster, e, dmg, o),
      heal: (e, n) => {
        const le = e as unknown as { heal(n: number): void; health: number; maxHealth: number };
        if (!this.isLiving(e) || le.health >= le.maxHealth) return;
        le.heal(n);
        this.fxAt(game.dimension, 'heal', e.x, e.y + e.height / 2, e.z);
      },
      effect: (e, id, t, amp) => (e as unknown as { addEffect(id: string, d: number, a: number): void }).addEffect(id, t, amp),
      id: (x, y, z) => def(x, y, z)?.name ?? 'air',
      solid: (x, y, z) => def(x, y, z)?.solid ?? false,
      place: (x, y, z, name, meta = 0) => {
        if (!this.cfg.terrain && name !== 'air') return;
        const cur = def(x, y, z);
        if (!cur || cur.hardness < 0 || w.getTile(x, y, z)) return;
        const nd = name === 'air' ? null : mc.blockByName(name);
        if (name !== 'air' && !nd) return;
        w.set(x, y, z, nd ? mc.pack(nd.id, meta) : 0);
        if (name === 'fire') game.ticker?.schedule(x, y, z, 30);
      },
      ignite: (x, y, z) => {
        if (w.getId(x, y, z) !== 0 || !(def(x, y - 1, z)?.solid)) return;
        w.set(x, y, z, mc.B.FIRE);
        game.ticker?.schedule(x, y, z, 30);
      },
      teleportCaster: (x, y, z) => {
        if (!caster || !this.isLiving(caster)) return;
        // find room for a body (two blocks of air) at or just above the spot
        const bx = Math.floor(x), bz = Math.floor(z);
        let by = Math.floor(y);
        for (let n = 0; n < 4 && (def(bx, by, bz)?.solid || def(bx, by + 1, bz)?.solid); n++) by++;
        if (def(bx, by, bz)?.solid || def(bx, by + 1, bz)?.solid) return;
        this.fxAt(game.dimension, 'tp', caster.x, caster.y + 1, caster.z);
        caster.setPos(bx + 0.5, by, bz + 0.5);
        caster.vx = caster.vy = caster.vz = 0;
        caster.fallDistance = 0;
        this.fxAt(game.dimension, 'tp', bx + 0.5, by + 1, bz + 0.5);
        game.audio.play('wands:teleport', { x: bx + 0.5, y: by + 1, z: bz + 0.5 }, 0.8, 1);
      },
      pull: (e, x, y, z, k) => {
        const dx = x - e.x, dy = y - (e.y + e.height / 2), dz = z - e.z, l = Math.hypot(dx, dy, dz) || 1;
        this.push(e, (dx / l) * k, (dy / l) * k + 0.02, (dz / l) * k);
      },
      spawn: (id, x, y, z, dx, dy, dz) => {
        const s = SPELL_BY_ID.get(id);
        if (!s) return;
        const shot = new Shot();
        shot.projs.push(makeProj(s));
        this.release(game, shot, x, y, z, [dx, dy, dz], caster, f?.speedMul ?? 1, 2);
      },
      fx: (kind, x, y, z, data) => this.fxAt(game.dimension, kind, x, y, z, data),
      sound: (name, x, y, z, vol = 1, pitch = 1) => game.audio.play(name, { x, y, z }, vol, pitch),
      rand: this.rng,
    };
  }

  private fxAt(dim: string, n: string, x: number, y: number, z: number, d?: number[]) {
    this.emit(dim, d ? { k: 'f', n, p: [r3(x), r3(y), r3(z)], d } : { k: 'f', n, p: [r3(x), r3(y), r3(z)] });
  }

  /** An explosion of a spell's own: hurts and throws what's near, breaks what it can, lights fires. */
  private blast(game: Game, caster: Entity | null, x: number, y: number, z: number, r: number, dmg: number, terrain: number, fireOn: boolean, color: number) {
    for (const e of game.entities) {
      if (!this.isLiving(e) || (this.isPlayer(e) && (e as unknown as Player).spectator)) continue;
      const cx = e.x, cy = e.y + e.height / 2, cz = e.z;
      const d = Math.max(0, Math.hypot(cx - x, cy - y, cz - z) - e.width / 2);
      if (d > r) continue;
      const f = 1 - d / r, l = Math.hypot(cx - x, cy - y, cz - z) || 1;
      const k = 0.25 + 0.75 * f;
      this.hurt(game, caster, e, dmg * (0.35 + 0.65 * f), { fire: fireOn, blast: true, kx: ((cx - x) / l) * k, ky: 0.2 + 0.3 * f, kz: ((cz - z) / l) * k });
    }
    if (terrain > 0 && this.cfg.terrain) {
      const B = this.mc.BLOCKS, w = game.world!, list: [number, number, number][] = [];
      const R = r * 0.85, maxRes = terrain * 5;
      for (let bx = Math.floor(x - R); bx <= Math.floor(x + R); bx++)
        for (let by = Math.floor(y - R); by <= Math.floor(y + R); by++)
          for (let bz = Math.floor(z - R); bz <= Math.floor(z + R); bz++) {
            const dd = (bx + 0.5 - x) ** 2 + (by + 0.5 - y) ** 2 + (bz + 0.5 - z) ** 2;
            // a ragged edge
            if (dd > R * R * (0.75 + this.rng() * 0.35)) continue;
            const d = B[w.getId(bx, by, bz)];
            if (!d || d.id === 0 || d.fluid || d.hardness < 0 || d.blastResistance > maxRes) continue;
            list.push([bx, by, bz]);
          }
      if (list.length) game.interact!.destroyBlocks(list, { drops: Math.min(1, 1 / r), fire: fireOn, fx: 'smoke' });
    }
    this.emit(game.dimension, { k: 'x', p: [r3(x), r3(y), r3(z)], r: r3(r), c: color });
    game.audio.play('explode', { x, y, z }, Math.min(4, 1 + r * 0.6), (1 + (this.rng() - this.rng()) * 0.2) * (r > 3 ? 0.6 : 0.9));
    game.particles?.explosion(x, y, z);
  }

  private dig(game: Game, x: number, y: number, z: number, r: number, hard: number, drops: number) {
    if (!this.cfg.terrain) return;
    const B = this.mc.BLOCKS, w = game.world!, list: [number, number, number][] = [];
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++)
      for (let by = Math.floor(y - r); by <= Math.floor(y + r); by++)
        for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
          if ((bx + 0.5 - x) ** 2 + (by + 0.5 - y) ** 2 + (bz + 0.5 - z) ** 2 > r * r) continue;
          const d = B[w.getId(bx, by, bz)];
          if (!d || d.id === 0 || d.fluid || d.hardness < 0 || d.hardness > hard) continue;
          list.push([bx, by, bz]);
        }
    if (list.length) this.digBlocks(game, list, drops, drops ? 'break' : 'none');
  }

  private digBlocks(game: Game, list: [number, number, number][], drops: number, fx: 'break' | 'none' | 'smoke') {
    if (!this.cfg.terrain) return;
    game.interact!.destroyBlocks(list, { drops, fx });
  }

  // ------------------------------------------------------------------ editing (from a player's wand editor)
  /**
   * A player's editor sends the wand as it should be now. In creative anything goes (Spell Lab); in survival the
   * stats stay the wand's own and the spells must add up: new ones come out of the inventory, removed ones go back.
   */
  edit(game: Game, player: Player, d: { slot: number; spells: unknown; always?: unknown; s?: unknown }) {
    const slot = d.slot;
    if (!Number.isInteger(slot) || slot < 0 || slot > 35) return;
    // the wand item says what tier it is, not the message
    const tier = this.tierOf(player.inventory.main[slot]?.id ?? -1);
    if (tier === undefined) return this.toPlayer(player, { k: 'a', rev: -1, ok: 0 });
    const a = this.attune(player, slot, tier);
    if (!a) return this.toPlayer(player, { k: 'a', rev: -1, ok: 0 });
    const cur = a.w;
    const creative = !!player.creative;
    const next = cloneWand(cur);
    if (!Array.isArray(d.spells)) return;
    next.spells = d.spells.slice(0, 64) as (string | null)[];
    if (creative) {
      if (d.s && typeof d.s === 'object') next.s = { ...cur.s, ...(d.s as object) };
      if (Array.isArray(d.always)) next.always = d.always as string[];
    }
    sanitize(next);
    if (!creative) {
      // the spells that came and went, counted
      const count = (ids: (string | null)[]) => { const m = new Map<string, number>(); for (const id of ids) if (id) m.set(id, (m.get(id) ?? 0) + 1); return m; };
      const was = count(cur.spells), now = count(next.spells);
      const need = new Map<string, number>(), give = new Map<string, number>();
      for (const [id, n] of now) if (n > (was.get(id) ?? 0)) need.set(id, n - (was.get(id) ?? 0));
      for (const [id, n] of was) if (n > (now.get(id) ?? 0)) give.set(id, n - (now.get(id) ?? 0));
      const inv = player.inventory;
      for (const [id, n] of need) {
        const item = this.spellItem(id);
        if (item === undefined || inv.count(item) < n) return this.toPlayer(player, { k: 'a', rev: cur.rev, ok: 0, msg: `You don't have ${SPELL_BY_ID.get(id)?.name ?? id}` });
      }
      for (const [id, n] of need) inv.remove(this.spellItem(id)!, n);
      for (const [id, n] of give) {
        const item = this.spellItem(id);
        if (item === undefined) continue;
        const left = inv.add({ id: item, count: n });
        if (left > 0) game.dropItem(player.x, player.y + 1, player.z, { id: item, count: left });
      }
    }
    fixUses(next, cur);
    next.rev = cur.rev + 1;
    next.uid = cur.uid;
    player.inventory.main[slot] = withWand(player.inventory.main[slot]!, next);
    this.toPlayer(player, { k: 'a', rev: next.rev, ok: 1 });
  }

  // ------------------------------------------------------------------ what each player is told
  private emit(dim: string, e: FxEvent) {
    let l = this.dimOut.get(dim);
    if (!l) this.dimOut.set(dim, (l = []));
    l.push(e);
  }
  toPlayer(p: Player, e: FxEvent) {
    let l = this.playerOut.get(p);
    if (!l) this.playerOut.set(p, (l = []));
    l.push(e);
  }

  /** The wand in each player's hand: mana and timers for their HUD (sent when they change). */
  private hud(game: Game) {
    for (const sp of game.players) {
      const p = sp.entity as unknown as Player;
      // wands just crafted or found get their stats now, so their tooltip and the editor can show them
      if (game.ticks % 10 === 0) p.inventory.main.forEach((st, i) => { const t = st ? this.tierOf(st.id) : undefined; if (t !== undefined && !wandOf(st)?.uid) this.attune(p, i, t); });
      const slot = p.inventory.selected, w = wandOf(p.inventory.main[slot]);
      let msg: FxEvent;
      if (w?.uid) {
        const rt = this.runtime(w, game.ticks);
        const regained = catchUp(w, rt, game.ticks);
        if (regained.length) this.regain(p, slot, w, regained);
        const inf = this.infinite(w, p);
        msg = { k: 'w', s: slot, m: Math.floor(rt.mana), mm: w.s.mana, d: rt.delay, dt: rt.delayTotal, r: rt.reload, rt: rt.reloadTotal, dk: rt.deck, inf: inf ? 1 : 0 };
      } else msg = { k: 'w', s: -1 };
      const key = JSON.stringify(msg);
      if (this.shown.get(p) === key) continue;
      this.shown.set(p, key);
      this.toPlayer(p, msg);
    }
  }

  private flush(game: Game) {
    for (const sp of game.players) {
      const p = sp.entity as unknown as Player;
      const a = this.dimOut.get(sp.dim) ?? [], b = this.playerOut.get(p) ?? [];
      if (!a.length && !b.length) continue;
      const all = a.length && b.length ? [...a, ...b] : a.length ? a : b;
      // the network takes at most so much at once
      for (let i = 0; i < all.length; i += 400) this.fx.toPlayer(p, all.slice(i, i + 400));
    }
    this.dimOut.clear();
    this.playerOut.clear();
  }

  /** A world closed: nothing carries over. */
  reset() {
    this.flying.clear();
    this.runtimes.clear();
    this.dimOut.clear();
    this.playerOut.clear();
  }

  spells(): readonly SpellDef[] { return [...SPELL_BY_ID.values()]; }
}

// ------------------------------------------------------------------ geometry
/** Turn a direction by yaw (around the vertical) and pitch (up / down) offsets, in degrees. */
function rotate(d: [number, number, number], yawDeg: number, pitchDeg: number): [number, number, number] {
  if (!yawDeg && !pitchDeg) return d;
  let yaw = Math.atan2(d[0], d[2]), pitch = Math.asin(Math.max(-1, Math.min(1, d[1])));
  yaw += (yawDeg * Math.PI) / 180;
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch + (pitchDeg * Math.PI) / 180));
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

/** A random direction within `deg` of d. */
function cone(dx: number, dy: number, dz: number, deg: number, rand: () => number): [number, number, number] {
  const a = ((deg * Math.PI) / 180) * Math.sqrt(rand()), t = rand() * Math.PI * 2;
  // a basis around d
  let ux = -dz, uy = 0, uz = dx;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const c = Math.cos(a), s = Math.sin(a);
  return [dx * c + (ux * Math.cos(t) + vx * Math.sin(t)) * s, dy * c + (uy * Math.cos(t) + vy * Math.sin(t)) * s, dz * c + (uz * Math.cos(t) + vz * Math.sin(t)) * s];
}

/** Where (0..1 along it) a segment enters a box, or null. */
function segBox(x: number, y: number, z: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let t0 = 0, t1 = 1;
  const axes: [number, number, number, number][] = [[x, dx, x0, x1], [y, dy, y0, y1], [z, dz, z0, z1]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
