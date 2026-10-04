// The server half (the host, or this page in single-player): fires wands, flies their projectiles, applies what
// they do, and tells each player what to show. Projectiles aren't entities: each cast sends one small message per
// projectile, every client flies its own copy, and the server only reports where each one ended (plus a position
// now and then for the ones that steer by things only it knows), which keeps a screen full of spells cheap to send.
import type { ModContext, Game, Player, Entity, ItemStack, Channel } from '../sdk';
import {
  SPELL_BY_ID, SPELL_INDEX, ORBITS, SERVER_STEER, Shot, makeProj, cloneProj,
  type Proj, type SpellWorld, type Live, type HitInfo, type SpellDef, type SpawnRule, type Status, type Orbit,
} from './spells';
import { fire, finalProjs, newRuntime, catchUp, ready, type Runtime } from './engine';
import { bodyOf, rayBlocks, displacement, steer, bounce, rayEnd, orbitAt, type Body } from './motion';
import { wandOf, withWand, rollWand, fixUses, cloneWand, sanitize, wandSpells, type WandData } from './wand';
import { Statuses, STATUS_COLOR } from './status';
import { SCHEDULE } from './blocks';

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
  /** Which way it was cast (static projectiles release payloads this way). */
  d0: [number, number, number];
  /** Generations of projectiles casting projectiles. */
  depth: number;
  /** Times each of its spawn rules has fired. */
  counts: number[];
  prevVy: number;
  /** Steered by things only the server knows: clients get its position often. */
  srv: boolean;
  tpUsed: boolean;
}

/** Server -> client messages (one bundle per player per tick). */
export type FxEvent =
  | { k: 's'; i: number; s: number; p: number[]; v: number[]; c: number; z: number; g: number; l: number; b: number; h: number; pa: string; sd: number; dr: number; bk: number; gh: number; fu: number; rb: number; dg: number; o: number[]; st?: string[]; ob?: number[]; iv?: number }
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
const MAX_DEPTH = 5;
const PROJECTILE_ENTITIES = ['Arrow', 'Fireball', 'Snowball', 'ThrownPotion'];
/** Blocks each transmutation turns into others. */
const TRANSMUTE: Record<string, (n: string, rand: () => number) => string | null> = {
  bloodToAcid: (n) => (n === 'wands:blood' ? 'wands:acid' : null),
  lavaToBlood: (n) => (n === 'lava' ? 'wands:blood' : null),
  waterToPoison: (n) => (n === 'water' ? 'wands:toxic' : null),
  toxicToAcid: (n) => (n === 'wands:toxic' ? 'wands:acid' : null),
  groundToSand: (n) => (['dirt', 'grass_block', 'stone', 'cobblestone', 'gravel', 'coarse_dirt', 'podzol', 'andesite', 'diorite', 'granite', 'netherrack'].includes(n) ? 'sand' : null),
  chaos: (n, rand) => (n === 'air' || n === 'bedrock' ? null : ['sand', 'gravel', 'glass', 'gold_block', 'ice', 'slime_block', 'netherrack', 'obsidian', 'wands:slime', 'water', 'clay', 'snow_block'][Math.floor(rand() * 12)]),
};
const LIQUIDS = ['water', 'lava', 'wands:acid', 'wands:oil', 'wands:blood', 'wands:slime', 'wands:toxic', 'wands:alcohol', 'wands:urine'];
/** Stains creatures pick up standing in a puddle (or in water). */
const PUDDLE_STATUS: Record<string, Status> = {
  water: 'wet', 'wands:urine': 'wet', 'wands:oil': 'oiled', 'wands:blood': 'bloody', 'wands:slime': 'slimy', 'wands:toxic': 'toxic', 'wands:alcohol': 'drunk', 'wands:acid': 'toxic',
};

export class SpellServer {
  private flying = new Map<string, Flying[]>();
  private byId = new Map<number, Flying>();
  private nextId = 1;
  private nextGroup = 1;
  private runtimes = new Map<string, Runtime>();
  private dimOut = new Map<string, FxEvent[]>();
  private playerOut = new Map<Player, FxEvent[]>();
  private shown = new WeakMap<Player, string>();
  private fizzleAt = new WeakMap<Player, number>();
  private rng = Math.random;
  readonly statuses = new Statuses();
  private rigs: { e: Entity; hp: number; until: number; r: number; dmg: number; dim: string }[] = [];
  /** Inside our own damage call (the damage event shouldn't double it again). */
  inHurt = false;
  private now = 0;

  constructor(private mod: ModContext, private cfg: ServerCfg, private fx: Channel<FxEvent[]>, private spellItem: (spell: string) => number | undefined, private tierOf: (item: number) => number | undefined, private isDummy: (e: unknown) => boolean = () => false) {}

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

  /** Gold carried: ingots, a ninth for each nugget, nine for each block. */
  private gold(player: Player) {
    let n = 0;
    for (const st of player.inventory.main) {
      if (!st) continue;
      const name = this.mc.ITEMS.get(st.id)?.name;
      if (name === 'gold_ingot') n += st.count;
      else if (name === 'gold_nugget') n += st.count / 9;
      else if (name === 'gold_block') n += st.count * 9;
    }
    return n;
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
    const others = player.inventory.main.flatMap((st, i) => { const ow = i !== slot ? wandOf(st) : null; return ow ? wandSpells(ow) : []; });
    const le = player as unknown as { health: number; maxHealth: number };
    const res = fire(w, rt, {
      rand: this.rng, infinite: inf,
      usesLeft: (i) => uses?.[i] ?? 0,
      spendUse: (i) => { if (uses && typeof uses[i] === 'number') uses[i] = (uses[i] as number) - 1; },
      others, health: le.health / le.maxHealth, gold: this.gold(player),
      enemies: this.foes(game, player, player.x, player.y + 1, player.z, 16).length,
      flying: (this.flying.get(game.dimension) ?? []).filter((f) => f.caster === player && !f.dead).length,
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
    let rx = -look[2], rz = look[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ox = eye.x + look[0] * 0.6 + rx * 0.28, oy = eye.y + look[1] * 0.6 - 0.22, oz = eye.z + look[2] * 0.6 + rz * 0.28;
    const at = rayEnd(eye.x, eye.y, eye.z, look[0], look[1], look[2], 48, this.solid(game));
    const tx = at.x - ox, ty = at.y - oy, tz = at.z - oz, tl = Math.hypot(tx, ty, tz);
    const d: [number, number, number] = tl > 1.5 ? [tx / tl, ty / tl, tz / tl] : look;
    const first = res.shot.projs[0]?.spell;
    game.audio.play('wands:cast', eye, 0.5, first ? 0.8 + ((SPELL_INDEX.get(first.id) ?? 0) % 7) * 0.08 : 1);
    this.castEffects(game, res.shot, player, d);
    this.release(game, res.shot, ox, oy, oz, d, player, w.s.speed, 0);
  }

  /** What a cast does besides its projectiles: recoil, blood, ending or converting what's already out. */
  private castEffects(game: Game, shot: Shot, caster: Entity, d: [number, number, number]) {
    if (shot.recoil > 0) { caster.vx -= d[0] * shot.recoil * 0.35; caster.vy -= d[1] * shot.recoil * 0.25; caster.vz -= d[2] * shot.recoil * 0.35; }
    if (shot.bloodCost > 0) this.hurt(game, null, caster, shot.bloodCost, { self: true });
    const mine = (this.flying.get(game.dimension) ?? []).filter((f) => f.caster === caster && !f.dead);
    if (shot.cease) for (const f of mine) this.remove(f);
    if (shot.convert) for (const f of mine) this.replace(game, f, shot.convert);
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
  /** The point a caster aims at (players only). */
  private aimPoint(game: Game, caster: Entity | null) {
    if (!caster || !this.isPlayer(caster)) return null;
    const p = caster as unknown as Player;
    const d = this.aimOf(game, p), y = p.y + p.eyeHeight();
    return rayEnd(p.x, y, p.z, d[0], d[1], d[2], 48, this.solid(game));
  }

  // ------------------------------------------------------------------ casting
  private solid = (game: Game) => (x: number, y: number, z: number) => this.mc.BLOCKS[game.world!.getId(x, y, z)]?.solid ?? false;

  /** Send a cast's projectiles on their way from a point, in a direction. */
  release(game: Game, shot: Shot, ox: number, oy: number, oz: number, dir: [number, number, number], caster: Entity | null, speedMul: number, depth: number) {
    if (depth > 8) return;
    const solid = this.solid(game);
    const group = this.nextGroup++;
    for (const p of finalProjs(shot)) {
      if (p.fizzle > 0 && this.rng() < p.fizzle) continue;
      p.group = group;
      let [dx, dy, dz] = rotate(dir, p.yawOff, p.pitchOff);
      const spread = Math.max(0, shot.spread + p.spread);
      if (spread > 0) [dx, dy, dz] = cone(dx, dy, dz, Math.min(180, spread), this.rng);
      let x = ox, y = oy, z = oz;
      if (shot.fromFoe && depth === 0) {
        const foe = this.foes(game, caster, ox, oy, oz, 24)[0];
        if (foe) { x = foe.x; y = foe.y + foe.height + 0.6; z = foe.z; }
        else { const e = rayEnd(ox, oy, oz, dir[0], dir[1], dir[2], 32, solid); x = e.x; y = e.y; z = e.z; }
      } else if (shot.teleport || p.sky || (p.aim && depth === 0)) {
        const e = rayEnd(ox, oy, oz, dir[0], dir[1], dir[2], p.sky ? 48 : p.aim ? 20 : 32, solid);
        x = e.x; y = e.y; z = e.z;
      }
      if (shot.forward) {
        const e = rayEnd(x, y, z, dx, dy, dz, shot.forward, solid);
        x = e.x; y = e.y; z = e.z;
      }
      if (shot.inner && depth === 0) {
        // from a few blocks out, back toward the caster
        const e = rayEnd(x, y, z, dx, dy, dz, 4, solid);
        x = e.x; y = e.y; z = e.z;
        dx = -dx; dy = -dy; dz = -dz;
      }
      if (p.sky) {
        // from high above the target, falling onto it
        const tx = x, ty = y, tz = z;
        x = tx + (this.rng() - 0.5) * 6; y = ty + 22; z = tz + (this.rng() - 0.5) * 6;
        const l = Math.hypot(tx - x, ty - y, tz - z) || 1;
        dx = (tx - x) / l; dy = (ty - y) / l; dz = (tz - z) / l;
      }
      if (p.steer.includes('autoAim') && depth === 0) {
        const foe = this.foes(game, caster, x, y, z, 24)[0];
        if (foe) { const v = norm(foe.x - x, foe.y + foe.height / 2 - y, foe.z - z); [dx, dy, dz] = v; }
      }
      if (p.speed === 0 && !shot.teleport && !shot.fromFoe && !p.aim && !p.orbit && depth === 0) {
        // static spells appear just in front of the wand
        const e = rayEnd(x, y, z, dx, dy, dz, 1.5, solid);
        x = e.x; y = e.y; z = e.z;
      }
      this.absorb(game, p, caster, x, y, z);
      this.launch(game, p, x, y, z, [dx, dy, dz], caster, speedMul, depth);
    }
  }

  /** Essence to Power and Spells to Power: soak up experience orbs, or the caster's other projectiles. */
  private absorb(game: Game, p: Proj, caster: Entity | null, x: number, y: number, z: number) {
    if (p.data.essence) {
      for (const e of game.entities) {
        if ((e as unknown as { typeName: string }).typeName !== 'Experience Orb' || e.removed || Math.hypot(e.x - x, e.y - y, e.z - z) > 8) continue;
        e.removed = true;
        p.dmg += 2;
      }
    }
    if (p.data.spellsPower) {
      for (const f of this.flying.get(game.dimension) ?? []) {
        if (f.dead || f.caster !== caster || Math.hypot(f.x - x, f.y - y, f.z - z) > 8) continue;
        p.dmg += f.p.dmg + f.p.explDmg * 0.5;
        this.remove(f);
      }
    }
  }

  /** One projectile into the world (casts, payloads and everything projectiles cast). */
  private launch(game: Game, p: Proj, x: number, y: number, z: number, d: [number, number, number], caster: Entity | null, speedMul: number, depth: number): Flying | null {
    const list = this.flying.get(game.dimension) ?? [];
    this.flying.set(game.dimension, list);
    if (list.length >= MAX_PROJS) return null;
    const speed = p.speed * speedMul * (0.95 + this.rng() * 0.1);
    if (!p.orbit) {
      if (p.steer.includes('orbit')) p.orbit = { around: 'origin', r: 2, w: 0.22, phase: Math.atan2(d[2], d[0]) };
      else if (p.steer.includes('trueOrbit')) p.orbit = { around: 'caster', r: 2.6, w: 0.13, phase: Math.atan2(d[2], d[0]) };
    }
    const f: Flying = {
      ...bodyOf(p, x, y, z, d[0] * speed, d[1] * speed, d[2] * speed, Math.floor(this.rng() * 1e9)),
      id: this.nextId++, p, caster, dim: game.dimension, speedMul, hits: new Map(), fired: false, digLeft: p.digCount, dead: false, ox: x, oy: y, oz: z,
      d0: [d[0], d[1], d[2]], depth, counts: p.spawns.map(() => 0), prevVy: d[1] * speed,
      srv: p.steer.some((s) => SERVER_STEER.includes(s)) || p.orbit?.around === 'caster', tpUsed: false,
    };
    if (p.orbit?.around === 'origin') { const o = orbitAt(p.orbit, 0, x, y, z); f.x = o[0]; f.y = o[1]; f.z = o[2]; }
    list.push(f);
    this.byId.set(f.id, f);
    const o = p.orbit;
    this.emit(f.dim, {
      k: 's', i: f.id, s: SPELL_INDEX.get(p.spell.id) ?? 0, p: [r3(f.x), r3(f.y), r3(f.z)], v: [r3(f.vx), r3(f.vy), r3(f.vz)], c: p.color, z: r3(p.size),
      g: r3(p.gravity), l: p.life, b: p.bounces, h: r3(p.homing), pa: p.path, sd: f.seed, dr: r3(p.drag), bk: r3(p.bounceKeep), gh: p.ghost ? 1 : 0,
      fu: p.fuse ? 1 : 0, rb: p.rainbow ? 1 : 0, dg: p.digHard > 0 ? 1 : 0, o: caster ? [caster.id] : [],
      ...(p.steer.length ? { st: p.steer } : {}),
      ...(o ? { ob: [o.around === 'origin' ? 0 : o.around === 'caster' ? 1 : 2, r3(o.r), r3(o.w), r3(o.phase), o.parent ?? 0, r3(x), r3(y), r3(z)] } : {}),
      ...(p.invisible ? { iv: 1 } : {}),
    });
    // things that circle it
    if (p.data.orbit !== undefined && p.data.orbit >= 0) {
      const what = ORBITS[p.data.orbit];
      for (let k = 0; k < 4; k++) {
        const q = what === 'self' ? this.copyOf(p) : SPELL_BY_ID.get(what) ? makeProj(SPELL_BY_ID.get(what)!) : null;
        if (!q) continue;
        delete q.data.orbit;
        q.speed = 0;
        q.life = p.life + 2;
        q.orbit = { around: 'parent', parent: f.id, r: 1.3, w: 0.25, phase: (k * Math.PI) / 2 };
        q.group = p.group;
        this.launch(game, q, f.x, f.y, f.z, d, caster, 1, depth + 1);
      }
    }
    return f;
  }

  /** A copy of a projectile that won't copy itself again (larpas, orbit larpa, quantum split). */
  private copyOf(p: Proj): Proj {
    const q = cloneProj(p);
    q.copy = true;
    q.spawns = q.spawns.filter((r) => r.spell !== 'self');
    q.orbit = undefined;
    delete q.data.orbit;
    return q;
  }

  // ------------------------------------------------------------------ flying
  tick(game: Game) {
    this.now = game.ticks;
    const dims = (game as unknown as { dims: Map<string, unknown> }).dims;
    for (const [dimName, list] of this.flying) {
      if (!list.length) continue;
      const dim = dims.get(dimName);
      if (!dim) { list.length = 0; continue; }
      game.inDim(dim as never, () => {
        for (const f of [...list]) if (!f.dead) this.step(game, f);
        if (game.ticks % 3 === 0) this.arcs(game, list);
        for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) { this.byId.delete(list[i].id); list.splice(i, 1); }
      });
    }
    if (game.ticks % 5 === 0) for (const [, dim] of dims) game.inDim(dim as never, () => this.conditions(game));
    for (const name of new Set(this.rigs.map((g) => g.dim))) { const dim = dims.get(name); if (dim) game.inDim(dim as never, () => this.tickRigs(game, name)); }
    this.hud(game);
    this.flush(game);
  }

  private live(game: Game, f: Flying): Live {
    const self = f as unknown as Live & Flying;
    if (!(self as { kill?: unknown }).kill) {
      Object.assign(f, {
        kill: () => { if (!f.dead) this.end(game, f, { x: f.x, y: f.y, z: f.z, nx: 0, ny: 0, nz: 0, entity: null, reason: 'expire' }); },
        remove: () => this.remove(f),
        sync: () => this.emit(f.dim, { k: 'y', i: f.id, p: [r3(f.x), r3(f.y), r3(f.z)], v: [r3(f.vx), r3(f.vy), r3(f.vz)] }),
      });
    }
    return f as unknown as Live;
  }
  /** Gone without a trace (no explosion, no payload). */
  private remove(f: Flying) {
    if (f.dead) return;
    f.dead = true;
    this.emit(f.dim, { k: 'e', i: f.id, p: [r3(f.x), r3(f.y), r3(f.z)], r: 'gone' });
  }
  /** Turn a projectile into another spell where it is. */
  private replace(game: Game, f: Flying, spell: string) {
    const s = SPELL_BY_ID.get(spell);
    if (!s || f.dead) return;
    const sp = Math.hypot(f.vx, f.vy, f.vz);
    const d: [number, number, number] = sp > 1e-4 ? [f.vx / sp, f.vy / sp, f.vz / sp] : f.d0;
    this.remove(f);
    const q = makeProj(s);
    q.group = f.p.group;
    this.launch(game, q, f.x, f.y, f.z, d, f.caster, f.speedMul, f.depth);
  }

  private step(game: Game, f: Flying) {
    const w = game.world!, B = this.mc.BLOCKS;
    f.age++;
    const sw = this.world(game, f), p = f.p;
    if (p.spell.tick) p.spell.tick(this.live(game, f), sw);
    if (f.dead) return;
    if (p.trigger === 'timer' && !f.fired && f.age >= (p.timer ?? 10)) { f.fired = true; this.payload(game, f, f.x, f.y, f.z); }
    if (f.age > f.life) { this.end(game, f, { x: f.x, y: f.y, z: f.z, nx: 0, ny: 0, nz: 0, entity: null, reason: 'expire' }); return; }
    if (f.y < -64 || f.y > 320) { this.remove(f); return; }
    this.during(game, f, sw);
    if (f.dead) return;

    // circling something: placed on its circle, hitting what it sweeps through
    if (p.orbit) {
      const c = this.orbitCentre(f);
      if (!c) { this.end(game, f, { x: f.x, y: f.y, z: f.z, nx: 0, ny: 0, nz: 0, entity: null, reason: 'expire' }); return; }
      const [nx, ny, nz] = orbitAt(p.orbit, f.age, c[0], c[1], c[2]);
      const dx = nx - f.x, dy = ny - f.y, dz = nz - f.z;
      const ent = this.firstEntity(game, f, dx, dy, dz, 1);
      f.vx = dx; f.vy = dy; f.vz = dz;
      f.x = nx; f.y = ny; f.z = nz;
      if (ent) { this.hitEntity(game, f, ent.e); if (!p.pierce && !f.dead) this.end(game, f, { x: f.x, y: f.y, z: f.z, nx: 0, ny: 0, nz: 0, entity: ent.e, reason: 'entity' }); }
      return;
    }

    const moving = f.vx !== 0 || f.vy !== 0 || f.vz !== 0 || f.gravity !== 0;
    if (!moving) return;
    this.serverSteer(game, f);
    if (f.dead) return;
    const needTarget = f.homing > 0 || p.steer.includes('antiHoming');
    steer(f, needTarget ? this.homingTarget(game, f) : null);
    const [dx, dy, dz] = displacement(f);
    const solid = (x: number, y: number, z: number) => B[w.getId(x, y, z)]?.solid ?? false;
    // drills: blocks soft enough are dug out of the way as it meets them
    const diggable = (x: number, y: number, z: number) => {
      if (f.digLeft <= 0 || p.digR > 0 || !this.cfg.terrain) return false;
      const d = B[w.getId(x, y, z)];
      return !!d && d.hardness >= 0 && d.hardness <= p.digHard;
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
      if (f.dead) return;
      if (!p.pierce) {
        f.x = hx; f.y = hy; f.z = hz;
        this.end(game, f, { x: hx, y: hy, z: hz, nx: 0, ny: 0, nz: 0, entity: ent.e, reason: 'entity' });
        return;
      }
    }
    if (hit) {
      if (p.digR > 0 && this.cfg.terrain) {
        this.dig(game, hit.bx + 0.5, hit.by + 0.5, hit.bz + 0.5, p.digR, p.digHard, 1);
        f.x = hit.x; f.y = hit.y; f.z = hit.z;
        this.end(game, f, { ...hit, entity: null, reason: 'block' });
        return;
      }
      if (f.bounces > 0) {
        bounce(f, hit);
        this.spawnOn(game, f, 'bounce', [f.vx, f.vy, f.vz], [hit.nx, hit.ny, hit.nz]);
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
    // falling, or slowing: bolt bundles
    if (f.age > 2 && f.vy < -0.02 && f.prevVy >= -0.02) this.spawnOn(game, f, 'down', [f.vx, f.vy, f.vz]);
    if (f.age > 2 && Math.hypot(f.vx, f.vy, f.vz) < Math.max(0.12, f.speed0 * 0.35)) this.spawnOn(game, f, 'slow', [f.vx, f.vy, f.vz]);
    f.prevVy = f.vy;
    // steering only the server can follow: clients get its position often
    if ((f.srv || f.homing > 0 || f.path === 'chaos') && f.age % (f.srv ? 3 : 8) === 0) this.emit(f.dim, { k: 'y', i: f.id, p: [r3(f.x), r3(f.y), r3(f.z)], v: [r3(f.vx), r3(f.vy), r3(f.vz)] });
  }

  /** What a projectile does every tick it flies: trails, auras, eating, shields, casting more. */
  private during(game: Game, f: Flying, sw: SpellWorld) {
    const p = f.p;
    if (f.age % 2 === 0) {
      if (p.fireTrail) sw.ignite(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z));
      for (const t of p.trails) this.trail(game, f, t, sw);
      if (p.eater) this.dig(game, f.x, f.y, f.z, 1.2, 3, 0);
    }
    if (p.aura > 0 && f.age % 5 === 0) {
      for (const e of sw.near(f.x, f.y, f.z, p.aura + 0.4, !p.selfHit)) if (e !== f.caster || f.age > 10) this.hurt(game, f.caster, e, 2 * p.dmgMul, { self: p.selfHit, proj: true });
    }
    if (p.shield) sw.deflect(f.x, f.y, f.z, 1.6);
    p.spawns.forEach((r, i) => {
      if (r.on !== 'tick' || f.age % (r.every ?? 1) !== 0) return;
      this.spawnRule(game, f, r, i, [f.vx, f.vy, f.vz]);
    });
  }

  private trail(game: Game, f: Flying, kind: string, sw: SpellWorld) {
    if (kind === 'rainbow') return;
    if (kind === 'burning') { if (this.rng() < 0.3) sw.ignite(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z)); return; }
    if (kind === 'fire') return;
    // the material drops to the ground below the projectile
    const x = Math.floor(f.x), z = Math.floor(f.z);
    let y = Math.floor(f.y);
    for (let n = 0; n < 8 && !sw.solid(x, y - 1, z); n++) y--;
    if (!sw.solid(x, y - 1, z) || sw.id(x, y, z) !== 'air') return;
    if (kind === 'water') sw.place(x, y, z, 'water', 7);
    else sw.place(x, y, z, kind);
    void game;
  }

  /** Steering that needs the world or the caster (server only). */
  private serverSteer(game: Game, f: Flying) {
    const st = f.p.steer;
    if (!st.length) return;
    const sp = Math.hypot(f.vx, f.vy, f.vz) || f.speed0 || 0.5;
    const toward = (tx: number, ty: number, tz: number, k: number) => {
      const [ax, ay, az] = norm(tx - f.x, ty - f.y, tz - f.z);
      f.vx += (ax * sp - f.vx) * k; f.vy += (ay * sp - f.vy) * k; f.vz += (az * sp - f.vz) * k;
      const s2 = Math.hypot(f.vx, f.vy, f.vz) || 1;
      f.vx *= sp / s2; f.vy *= sp / s2; f.vz *= sp / s2;
    };
    if (st.includes('rotateFoes') && f.age === 3) {
      const foe = this.foes(game, f.caster, f.x, f.y, f.z, 20)[0];
      if (foe) { const [ax, ay, az] = norm(foe.x - f.x, foe.y + foe.height / 2 - f.y, foe.z - f.z); f.vx = ax * sp; f.vy = ay * sp; f.vz = az * sp; }
    }
    if ((st.includes('aim') || st.includes('wandHoming')) && f.caster) {
      const a = this.aimPoint(game, f.caster);
      if (a) toward(a.x, a.y, a.z, st.includes('wandHoming') ? 0.35 : 0.12);
    }
    if (st.includes('boomerang') && f.caster && f.age > f.life * 0.4) {
      const c = f.caster;
      toward(c.x, c.y + 1, c.z, 0.3);
      if (Math.hypot(c.x - f.x, c.y + 1 - f.y, c.z - f.z) < 1.2) { this.remove(f); return; }
    }
    if (st.includes('phasing') && f.age % 8 === 0) {
      const [ax, ay, az] = norm(f.vx, f.vy, f.vz);
      const e = rayEnd(f.x, f.y, f.z, ax, ay, az, 3, this.solid(game));
      if (!e.hit) { f.x = e.x; f.y = e.y; f.z = e.z; this.fxAt(f.dim, 'tp', f.x, f.y, f.z); }
    }
    if (st.includes('floating')) {
      const s = this.solid(game);
      let gy = Math.floor(f.y);
      for (let n = 0; n < 6 && !s(Math.floor(f.x), gy - 1, Math.floor(f.z)); n++) gy--;
      f.vy += (gy + 1.2 - f.y) * 0.2 - f.vy * 0.3;
    }
    if (st.includes('avoid')) {
      const s = this.solid(game);
      if (rayBlocks(f.x, f.y, f.z, f.vx * 4, f.vy * 4, f.vz * 4, s)) {
        for (const a of [0.7, -0.7, 1.4, -1.4]) {
          const c = Math.cos(a), si = Math.sin(a), vx = f.vx * c - f.vz * si, vz = f.vx * si + f.vz * c;
          if (!rayBlocks(f.x, f.y, f.z, vx * 4, f.vy * 4, vz * 4, s)) { f.vx = vx; f.vz = vz; break; }
        }
      }
    }
    if (st.includes('areaTeleport') && !f.tpUsed) {
      const foe = this.foes(game, f.caster, f.x, f.y, f.z, 6)[0];
      if (foe) { f.tpUsed = true; f.x = foe.x; f.y = foe.y + foe.height + 0.4; f.z = foe.z; f.vx = 0; f.vy = -sp; f.vz = 0; this.fxAt(f.dim, 'tp', f.x, f.y, f.z); }
    }
  }

  private orbitCentre(f: Flying): [number, number, number] | null {
    const o = f.p.orbit!;
    if (o.around === 'origin') return [f.ox, f.oy, f.oz];
    if (o.around === 'caster') { const c = f.caster; return c && !c.removed ? [c.x, c.y + 1.1, c.z] : null; }
    const par = this.byId.get(o.parent ?? -1);
    return par && !par.dead ? [par.x, par.y, par.z] : null;
  }

  // ------------------------------------------------------------------ casting more from a projectile
  /** Run the spawn rules for an event. `along`: the direction it's going; `normal`: the surface it met. */
  private spawnOn(game: Game, f: Flying, on: SpawnRule['on'], along: number[], normal?: number[]) {
    f.p.spawns.forEach((r, i) => { if (r.on === on) this.spawnRule(game, f, r, i, along, normal); });
  }
  private spawnRule(game: Game, f: Flying, r: SpawnRule, i: number, along: number[], normal?: number[]) {
    if (f.depth >= MAX_DEPTH) return;
    if (r.max !== undefined && f.counts[i] >= r.max) return;
    if (r.chance !== undefined && this.rng() > r.chance) return;
    f.counts[i]++;
    const n = r.n ?? 1;
    const base = norm(along[0], along[1], along[2], f.d0);
    for (let k = 0; k < n; k++) {
      const q = r.spell === 'self' ? (f.p.copy ? null : this.copyOf(f.p)) : SPELL_BY_ID.get(r.spell) ? makeProj(SPELL_BY_ID.get(r.spell)!) : null;
      if (!q) return;
      if (r.speed !== undefined) q.speed = r.speed === 0 ? 0 : q.speed * r.speed;
      q.group = f.p.group;
      const d = this.spawnDir(game, f, r, k, n, base, normal);
      // a little way out, so it doesn't land inside what made it
      const off = q.speed === 0 ? 0 : 0.2;
      this.launch(game, q, f.x + d[0] * off, f.y + d[1] * off, f.z + d[2] * off, d, f.caster, f.speedMul, f.depth + 1);
    }
  }
  private spawnDir(game: Game, f: Flying, r: SpawnRule, k: number, n: number, base: [number, number, number], normal?: number[]): [number, number, number] {
    const rand = () => norm(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5);
    switch (r.dir ?? 'same') {
      case 'same': return base;
      case 'back': return [-base[0], -base[1], -base[2]];
      case 'random': return rand();
      case 'up': return norm((this.rng() - 0.5) * 0.3, 1, (this.rng() - 0.5) * 0.3);
      case 'down': return norm((this.rng() - 0.5) * 0.3, -1, (this.rng() - 0.5) * 0.3);
      case 'cone': return cone(base[0], base[1], base[2], r.cone ?? 20, this.rng);
      case 'reflect': {
        if (!normal) return base;
        const dot = base[0] * normal[0] + base[1] * normal[1] + base[2] * normal[2];
        return dot < 0 ? norm(base[0] - 2 * dot * normal[0], base[1] - 2 * dot * normal[1], base[2] - 2 * dot * normal[2]) : base;
      }
      case 'hemi': {
        const up = normal && (normal[0] || normal[1] || normal[2]) ? normal : [0, 1, 0];
        const v = rand();
        const dot = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
        return dot < 0 ? [v[0] - 2 * dot * up[0], v[1] - 2 * dot * up[1], v[2] - 2 * dot * up[2]] : v;
      }
      case 'ring': {
        const yaw = Math.atan2(base[0], base[2]) + (k / n) * Math.PI * 2 + Math.PI / 4;
        return [Math.sin(yaw), 0, Math.cos(yaw)];
      }
      case 'perp': {
        const side = k % 2 === 0 ? 1 : -1, h = Math.hypot(base[0], base[2]) || 1;
        return [(-base[2] / h) * side, 0, (base[0] / h) * side];
      }
      case 'foe': {
        const foe = this.foes(game, f.caster, f.x, f.y, f.z, 16)[k % 3];
        return foe ? norm(foe.x - f.x, foe.y + foe.height / 2 - f.y, foe.z - f.z) : rand();
      }
    }
  }

  // ------------------------------------------------------------------ arcs between a cast's projectiles
  private arcs(game: Game, list: Flying[]) {
    const groups = new Map<number, Flying[]>();
    for (const f of list) if (!f.dead && f.p.arcs.length) { let g = groups.get(f.p.group); if (!g) groups.set(f.p.group, (g = [])); g.push(f); }
    for (const g of groups.values()) {
      for (let i = 0; i + 1 < g.length; i++) {
        const a = g[i], b = g[i + 1];
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 12) continue;
        for (const kind of a.p.arcs) this.arc(game, a, b, kind);
      }
    }
  }
  private arc(game: Game, a: Flying, b: Flying, kind: string) {
    const col = kind === 'electric' ? 0xffff80 : kind === 'fire' ? 0xff7020 : kind === 'poison' ? 0x90ff40 : 0x808080;
    this.fxAt(a.dim, 'arc', a.x, a.y, a.z, [r3(b.x), r3(b.y), r3(b.z), col]);
    const sw = this.world(game, a);
    for (const e of game.entities) {
      if (!this.canHit(a, e) || segDist(a.x, a.y, a.z, b.x, b.y, b.z, e.x, e.y + e.height / 2, e.z) > 0.9) continue;
      if (kind === 'electric') this.hurt(game, a.caster, e, 3 * a.p.dmgMul, { elec: true });
      else if (kind === 'fire') this.hurt(game, a.caster, e, 1, { fire: true });
      else if (kind === 'poison') { sw.status(e, 'toxic', 100); sw.effect(e, 'poison', 60, 0); }
    }
    if (kind === 'gunpowder' && this.rng() < 0.4) {
      const t = this.rng(), x = Math.floor(a.x + (b.x - a.x) * t), z = Math.floor(a.z + (b.z - a.z) * t);
      let y = Math.floor(a.y + (b.y - a.y) * t);
      for (let n = 0; n < 6 && !sw.solid(x, y - 1, z); n++) y--;
      if (sw.solid(x, y - 1, z) && sw.id(x, y, z) === 'air') sw.place(x, y, z, 'wands:gunpowder');
    }
  }

  private isLiving(e: Entity) { return e instanceof this.mc.LivingEntity && !(e as unknown as { dead: boolean }).dead; }
  private isPlayer(e: Entity) { return e instanceof this.mc.Player; }

  /** Things a projectile may hit: living, not its caster, not a spectator, not players when PvP is off. */
  private canHit(f: Flying, e: Entity) {
    if (!this.isLiving(e) || e.removed) return false;
    if (e === f.caster && !(f.p.selfHit && f.age > 8)) return false;
    if (this.isPlayer(e)) {
      const p = e as unknown as Player;
      if (p.spectator) return false;
      if (!this.cfg.pvp && f.caster && this.isPlayer(f.caster) && e !== f.caster) return false;
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

  /** Creatures a caster fights, nearest first: monsters for players (and target dummies); for a creature, the others. */
  foes(game: Game, caster: Entity | null, x: number, y: number, z: number, r: number): Entity[] {
    const out: [number, Entity][] = [];
    const player = !caster || this.isPlayer(caster);
    for (const e of game.entities) {
      if (e === caster || !this.isLiving(e) || e.removed) continue;
      const hostile = (e as unknown as { hostile?: boolean }).hostile || this.isDummy(e);
      if (player ? !hostile : this.isPlayer(e) && !(caster as unknown as { hostile?: boolean })?.hostile) continue;
      if (!player && this.isPlayer(e)) continue;
      const d = Math.hypot(e.x - x, e.y + e.height / 2 - y, e.z - z);
      if (d <= r) out.push([d, e]);
    }
    return out.sort((a, b) => a[0] - b[0]).map(([, e]) => e);
  }

  /** The monster nearest to where a homing projectile is heading. */
  private homingTarget(game: Game, f: Flying) {
    const range = f.p.steer.includes('shortHoming') ? 5 : f.p.steer.includes('antiHoming') ? 8 : 16;
    let best: Entity | null = null, bd = range * range;
    const sp = Math.hypot(f.vx, f.vy, f.vz) || 1;
    for (const e of this.foes(game, f.caster, f.x, f.y, f.z, range)) {
      if (!this.canHit(f, e)) continue;
      const tx = e.x - f.x, ty = e.y + e.height / 2 - f.y, tz = e.z - f.z;
      const d = tx * tx + ty * ty + tz * tz;
      // in front of it, more or less
      if (d < bd && (tx * f.vx + ty * f.vy + tz * f.vz) / sp > -2) { bd = d; best = e; }
    }
    return best ? { x: best.x, y: best.y + best.height / 2, z: best.z } : null;
  }

  private hitEntity(game: Game, f: Flying, e: Entity) {
    f.hits.set(e.id, f.age);
    const p = f.p, sw = this.world(game, f);
    p.spell.touch?.(this.live(game, f), e, sw);
    if (f.dead || e.removed) return;
    for (const [s, t] of p.inflict) sw.status(e, s, t);
    if (p.data.charm && this.statuses.has(e, 'toxic', this.now)) sw.status(e, 'charmed', 400);
    for (const x of p.explodeOn) if (this.statuses.has(e, x.status, this.now)) this.blast(game, f.caster, e.x, e.y + e.height / 2, e.z, x.r, x.dmg * p.dmgMul, 0, false, 0xffa040);
    if (p.heal > 0) { sw.heal(e, p.heal * p.dmgMul); return; }
    let dmg = p.dmg * p.dmgMul;
    if (dmg <= 0 && !p.knock) return;
    const le = e as unknown as { fireTicks: number; health: number; dead: boolean; inWater?: boolean };
    const critOn = p.critOn.some((s) => (s === 'burning' ? le.fireTicks > 0 : this.statuses.has(e, s, this.now) || (s === 'wet' && !!le.inWater)));
    const crit = critOn || (p.crit > 0 && this.rng() < p.crit);
    if (crit) dmg *= 3;
    const sp = Math.hypot(f.vx, f.vy, f.vz) || 1, k = 0.12 + p.knock * 0.5;
    this.hurt(game, f.caster, e, dmg, { fire: p.fire, freeze: p.freeze, kx: (f.vx / sp) * k, ky: 0.08 + p.knock * 0.15, kz: (f.vz / sp) * k, crit, self: p.selfHit, proj: true });
    if (p.lifeSteal > 0 && f.caster && dmg > 0) sw.heal(f.caster, dmg * p.lifeSteal * 0.5);
    if (le.dead || le.health <= 0) this.spawnOn(game, f, 'kill', [0, 1, 0]);
  }

  /** Spell damage: ignores the usual half-second of invulnerability (a wand fires faster than that). */
  hurt(game: Game, caster: Entity | null, e: Entity, dmg: number, o: { fire?: boolean; freeze?: boolean; kx?: number; ky?: number; kz?: number; crit?: boolean; blast?: boolean; elec?: boolean; proj?: boolean; self?: boolean } = {}) {
    if (!this.isLiving(e)) return;
    const le = e as unknown as { invulnerable: number; damage(n: number, s: string, a: Entity | null): boolean; fireTicks: number; fireImmune?: boolean; addEffect(id: string, d: number, a: number): void; height: number };
    if (e === caster && !this.cfg.selfDamage && !o.self) { if (o.kx !== undefined) this.push(e, o.kx, o.ky ?? 0, o.kz ?? 0); return; }
    if (this.isPlayer(e) && caster && this.isPlayer(caster) && e !== caster && !this.cfg.pvp) return;
    // conditions that make it hurt more
    const st = this.statuses, now = this.now;
    if (st.has(e, 'cursed', now)) dmg *= 1.25;
    if (o.proj && st.has(e, 'curseProj', now)) dmg *= 2;
    if (o.blast && st.has(e, 'curseExpl', now)) dmg *= 2;
    if (o.elec && st.has(e, 'curseElec', now)) dmg *= 2;
    if (o.fire && st.has(e, 'oiled', now)) dmg *= 1.5;
    const v0 = [e.vx, e.vy, e.vz];
    const inv = le.invulnerable;
    le.invulnerable = 0;
    // fire spells hurt like magic and set alight (fire-immune mobs only shrug off the burning)
    this.inHurt = true;
    const ok = dmg > 0 ? le.damage(dmg, o.blast ? 'explosion' : 'magic', caster === e ? null : caster) : true;
    this.inHurt = false;
    le.invulnerable = inv;
    if (!ok) return;
    // our own push along the spell's flight, not vanilla's toward the attacker
    e.vx = v0[0] + (o.kx ?? 0); e.vy = Math.max(v0[1], 0) + (o.ky ?? 0); e.vz = v0[2] + (o.kz ?? 0);
    if (o.fire && !le.fireImmune && !st.has(e, 'wet', now)) le.fireTicks = Math.max(le.fireTicks, st.has(e, 'oiled', now) ? 200 : 80);
    if (o.freeze) le.addEffect('slowness', 60, 2);
    if (dmg > 0 && caster && this.isPlayer(caster) && caster !== e) this.toPlayer(caster as unknown as Player, { k: 'd', p: [r3(e.x), r3(e.y + le.height + 0.2), r3(e.z)], a: Math.round(dmg * 100) / 100, c: o.crit ? 1 : 0 });
  }

  private push(e: Entity, kx: number, ky: number, kz: number) { e.vx += kx; e.vy += ky; e.vz += kz; }

  private payload(game: Game, f: Flying, x: number, y: number, z: number, nx = 0, ny = 0, nz = 0) {
    const shot = f.p.payload;
    if (!shot) return;
    const sp = Math.hypot(f.vx, f.vy, f.vz);
    let d: [number, number, number] = sp > 1e-4 && !f.p.orbit ? [f.vx / sp, f.vy / sp, f.vz / sp] : f.d0;
    // off a wall: back out of it (a trigger on a wall bounces its spell back, like Noita's)
    if (nx || ny || nz) {
      const dot = d[0] * nx + d[1] * ny + d[2] * nz;
      d = [d[0] - 2 * dot * nx, d[1] - 2 * dot * ny, d[2] - 2 * dot * nz];
    }
    this.release(game, shot, x + nx * 0.15, y + ny * 0.15, z + nz * 0.15, d, f.caster, f.speedMul, Math.max(1, f.depth + 1));
  }

  private end(game: Game, f: Flying, h: HitInfo) {
    if (f.dead) return;
    f.dead = true;
    const p = f.p, sw = this.world(game, f);
    if (p.explR > 0) sw.blast(h.x + h.nx * 0.3, h.y + h.ny * 0.3, h.z + h.nz * 0.3, p.explR, p.explDmg * p.dmgMul, p.terrain, p.fire, p.color, { self: p.selfHit });
    if (p.elec > 0) {
      for (const e of sw.near(h.x, h.y, h.z, 2.5, true)) this.hurt(game, f.caster, e, p.elec * p.dmgMul, { elec: true });
      sw.fx('zap', h.x, h.y, h.z);
    }
    if (p.freeze) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 0; dy++) {
        const x = Math.floor(h.x) + dx, y = Math.floor(h.y) + dy, z = Math.floor(h.z) + dz;
        if (sw.id(x, y, z) === 'water') sw.place(x, y, z, 'ice');
      }
    }
    if (p.fire && h.reason === 'block') sw.ignite(Math.floor(h.x + h.nx * 0.5), Math.floor(h.y + h.ny * 0.5), Math.floor(h.z + h.nz * 0.5));
    for (const kind of p.transmute) this.transmuteAt(game, h, kind);
    if (p.spell.hit) p.spell.hit(this.live(game, f), h, sw);
    const t = p.trigger;
    if (t && (t === 'expire' || (t === 'hit' && h.reason !== 'expire') || (t === 'timer' && !f.fired))) {
      f.fired = true;
      this.payload(game, f, h.x, h.y, h.z, h.nx, h.ny, h.nz);
    }
    const along = [f.vx, f.vy, f.vz], normal = [h.nx, h.ny, h.nz];
    this.spawnOn(game, f, 'end', along, normal);
    if (h.reason === 'block') this.spawnOn(game, f, 'block', along, normal);
    if (h.reason === 'entity') this.spawnOn(game, f, 'entity', along, normal);
    // Chain Spell: a copy carries on, one fewer time
    if ((p.data.chain ?? 0) > 0 && f.depth < 8) {
      const q = cloneProj(p);
      q.data.chain = p.data.chain - 1;
      q.payload = undefined;
      const d = norm(f.vx, f.vy, f.vz, f.d0);
      const dd = h.nx || h.ny || h.nz ? this.spawnDir(game, f, { on: 'end', spell: '', dir: 'reflect' }, 0, 1, d, normal) : d;
      this.launch(game, q, h.x + h.nx * 0.2, h.y + h.ny * 0.2, h.z + h.nz * 0.2, dd, f.caster, f.speedMul, f.depth + 1);
    }
    this.emit(f.dim, { k: 'e', i: f.id, p: [r3(h.x), r3(h.y), r3(h.z)], r: h.reason });
  }

  private transmuteAt(game: Game, h: HitInfo, kind: string) {
    const sw = this.world(game, null);
    if (kind === 'detonate') {
      const spots: [number, number, number][] = [];
      sw.transmute(h.x, h.y, h.z, 3, (n) => (LIQUIDS.includes(n) ? 'air' : null), (x, y, z) => spots.push([x, y, z]));
      for (let i = 0; i < Math.min(6, spots.length); i++) {
        const [x, y, z] = spots[Math.floor(this.rng() * spots.length)];
        this.blast(game, null, x + 0.5, y + 0.5, z + 0.5, 1.6, 8, 2, false, 0x80c0ff);
      }
      return;
    }
    const fn = TRANSMUTE[kind];
    if (fn) sw.transmute(h.x, h.y, h.z, kind === 'chaos' ? 2.5 : 3.5, (n) => fn(n, this.rng));
  }

  // ------------------------------------------------------------------ conditions, puddles, rigged creatures
  private conditions(game: Game) {
    const now = this.now, w = game.world;
    if (!w) return;
    const B = this.mc.BLOCKS;
    // standing in something picks up its stain
    for (const e of game.entities) {
      if (!this.isLiving(e)) continue;
      const n = B[w.getId(Math.floor(e.x), Math.floor(e.y + 0.05), Math.floor(e.z))]?.name ?? 'air';
      const s = PUDDLE_STATUS[n];
      if (!s) continue;
      this.statuses.set(e, s, 200, now);
      if (s === 'wet') e.fireTicks = 0;
      if (n === 'wands:acid' && now % 10 === 0) this.hurt(game, null, e, 1);
    }
    const dimEntities = new Set(game.entities);
    for (const [e, on] of this.statuses.each(now)) {
      if (!dimEntities.has(e)) continue;
      const le = e as unknown as { addEffect(id: string, d: number, a: number): void; fireTicks: number };
      for (const s of on) {
        switch (s) {
          case 'toxic': le.addEffect('poison', 40, 0); break;
          case 'venom': le.addEffect('poison', 40, 1); break;
          case 'slimy': le.addEffect('slowness', 20, 1); break;
          case 'wet': le.fireTicks = 0; break;
          case 'petrified': le.addEffect('slowness', 20, 6); e.vx = 0; e.vz = 0; break;
          case 'drunk': if (this.rng() < 0.3) { e.vx += (this.rng() - 0.5) * 0.15; e.vz += (this.rng() - 0.5) * 0.15; } break;
          case 'charmed': {
            const m = e as unknown as { target?: unknown };
            if ('target' in m) m.target = this.foes(game, e, e.x, e.y, e.z, 16).find((x) => !this.isPlayer(x)) ?? null;
            break;
          }
          case 'fireThrower': if (now % 20 === 0) this.creatureCasts(game, e, 'fireball_small'); break;
          case 'tentacler': if (now % 15 === 0) this.creatureCasts(game, e, 'tentacle'); break;
          case 'lightningCaster': if (now % 30 === 0) {
            const x = e.x + (this.rng() - 0.5) * 8, z = e.z + (this.rng() - 0.5) * 8;
            this.fxAt(game.dimension, 'strike', x, e.y, z, [e.y + 12]);
            for (const o of this.world(game, null).near(x, e.y, z, 2, true)) if (o !== e) this.hurt(game, e, o, 6, { elec: true });
          } break;
          case 'gravityWell': for (const o of game.entities) if (o !== e && this.isLiving(o) && Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z) < 6) this.world(game, null).pull(o, e.x, e.y + 1, e.z, 0.12); break;
          default: break;
        }
      }
      // drips in the condition's colour, now and then
      if (now % 10 === 0) { const col = on.map((s) => STATUS_COLOR[s]).find((c) => c !== undefined); if (col !== undefined) this.fxAt(game.dimension, 'st', e.x, e.y + e.height * 0.6, e.z, [col, r3(e.width)]); }
    }
  }
  /** A creature under a spell's influence casts at its nearest fellow creature. */
  private creatureCasts(game: Game, e: Entity, spell: string) {
    const foe = this.foes(game, e, e.x, e.y + 1, e.z, 12).find((x) => !this.isPlayer(x)) ?? this.foes(game, e, e.x, e.y + 1, e.z, 12)[0];
    const s = SPELL_BY_ID.get(spell);
    if (!foe || !s) return;
    const y = e.y + e.height * 0.8, d = norm(foe.x - e.x, foe.y + foe.height / 2 - y, foe.z - e.z);
    this.launch(game, makeProj(s), e.x + d[0] * 0.8, y, e.z + d[2] * 0.8, d, e, 1, 1);
  }
  private tickRigs(game: Game, dim: string) {
    for (let i = this.rigs.length - 1; i >= 0; i--) {
      const g = this.rigs[i], e = g.e as unknown as { health: number; dead?: boolean };
      if (g.dim !== dim) continue;
      if (g.e.removed && !e.dead) { this.rigs.splice(i, 1); continue; }
      if (e.dead || e.health < g.hp || game.ticks > g.until) {
        this.rigs.splice(i, 1);
        g.e.removed = true;
        this.blast(game, null, g.e.x, g.e.y + 0.8, g.e.z, g.r, g.dmg, 6, false, 0xffa040);
      }
    }
  }

  // ------------------------------------------------------------------ the world, as spells see it
  private world(game: Game, f: Flying | null): SpellWorld {
    const mc = this.mc, w = game.world!, caster = f?.caster ?? null;
    const def = (x: number, y: number, z: number) => mc.BLOCKS[w.getId(x, y, z)];
    const sw: SpellWorld = {
      blast: (x, y, z, r, dmg, terrain, fireOn, color, o) => this.blast(game, caster, x, y, z, r, dmg, terrain, fireOn, color, o),
      dig: (x, y, z, r, hard) => this.dig(game, x, y, z, r, hard, f && ['black_hole', 'black_hole_death', 'white_hole', 'worm_launcher'].includes(f.p.spell.id) ? 0 : 1),
      near: (x, y, z, r, others) => game.entities.filter((e) => {
        if (!this.isLiving(e) || (others && e === caster) || (this.isPlayer(e) && (e as unknown as Player).spectator)) return false;
        const d = Math.hypot(e.x - x, e.y + e.height / 2 - y, e.z - z) - e.width / 2;
        return d <= r;
      }),
      foes: (x, y, z, r) => this.foes(game, caster, x, y, z, r),
      hurt: (e, dmg, o) => this.hurt(game, caster, e, dmg, o),
      heal: (e, n) => {
        const le = e as unknown as { heal(n: number): void; health: number; maxHealth: number };
        if (!this.isLiving(e) || le.health >= le.maxHealth) return;
        le.heal(n);
        this.fxAt(game.dimension, 'heal', e.x, e.y + e.height / 2, e.z);
      },
      effect: (e, id, t, amp) => { if (this.isLiving(e)) (e as unknown as { addEffect(id: string, d: number, a: number): void }).addEffect(id, t, amp); },
      status: (e, s, t) => { if (this.isLiving(e) && t > 0) this.statuses.set(e, s, t, game.ticks); },
      has: (e, s) => this.statuses.has(e, s, game.ticks),
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
        else if (SCHEDULE[name]) game.ticker?.schedule(x, y, z, SCHEDULE[name]);
      },
      temp: (x, y, z, name, ticks) => {
        if (!this.cfg.terrain) return;
        const cur = def(x, y, z), nd = mc.blockByName(name);
        if (!cur || !nd || cur.solid || cur.hardness < 0 || w.getTile(x, y, z)) return;
        w.set(x, y, z, mc.pack(nd.id, 0));
        game.ticker?.schedule(x, y, z, ticks);
      },
      ignite: (x, y, z) => {
        if (w.getId(x, y, z) !== 0 || !(def(x, y - 1, z)?.solid)) return;
        w.set(x, y, z, mc.B.FIRE);
        game.ticker?.schedule(x, y, z, 30);
      },
      teleportCaster: (x, y, z) => { if (caster) sw.teleport(caster, x, y, z); },
      teleport: (e, x, y, z) => {
        if (!this.isLiving(e) && !e) return;
        // find room for a body (two blocks of air) at or just above the spot
        const bx = Math.floor(x), bz = Math.floor(z);
        let by = Math.floor(y);
        for (let n = 0; n < 6 && (def(bx, by, bz)?.solid || def(bx, by + 1, bz)?.solid); n++) by++;
        if (def(bx, by, bz)?.solid || def(bx, by + 1, bz)?.solid) return;
        this.fxAt(game.dimension, 'tp', e.x, e.y + 1, e.z);
        e.setPos(bx + 0.5, by, bz + 0.5);
        e.vx = e.vy = e.vz = 0;
        e.fallDistance = 0;
        this.fxAt(game.dimension, 'tp', bx + 0.5, by + 1, bz + 0.5);
        game.audio.play('wands:teleport', { x: bx + 0.5, y: by + 1, z: bz + 0.5 }, 0.8, 1);
      },
      pull: (e, x, y, z, k) => {
        const dx = x - e.x, dy = y - (e.y + e.height / 2), dz = z - e.z, l = Math.hypot(dx, dy, dz) || 1;
        this.push(e, (dx / l) * k, (dy / l) * k + 0.02, (dz / l) * k);
      },
      spawn: (id, x, y, z, dx, dy, dz, over) => {
        const s = SPELL_BY_ID.get(id);
        if (!s) return undefined;
        const q = makeProj(s);
        if (over) Object.assign(q, over, { data: { ...q.data, ...(over.data ?? {}) } });
        q.group = f?.p.group ?? 0;
        const nf = this.launch(game, q, x, y, z, norm(dx, dy, dz, [0, 1, 0]), caster, f?.speedMul ?? 1, Math.max(1, (f?.depth ?? 0) + 1));
        return nf?.id;
      },
      projs: (x, y, z, r) => (this.flying.get(game.dimension) ?? []).filter((o) => !o.dead && Math.hypot(o.x - x, o.y - y, o.z - z) <= r).map((o) => this.live(game, o)),
      mine: () => (this.flying.get(game.dimension) ?? []).filter((o) => !o.dead && o.caster === caster).map((o) => this.live(game, o)),
      replace: (l, spell) => this.replace(game, l as unknown as Flying, spell),
      mob: (type, x, y, z) => game.interact?.spawnMob(type, x, y, z) ?? null,
      rig: (e, r, dmg, ticks) => { this.rigs.push({ e, hp: (e as unknown as { health: number }).health, until: game.ticks + ticks, r, dmg, dim: game.dimension }); },
      polymorph: (e, type) => {
        if (!this.isLiving(e) || this.isPlayer(e) || this.isDummy(e) || ['Ender Dragon', 'End Crystal'].includes((e as unknown as { typeName: string }).typeName)) return;
        const n = game.interact?.spawnMob(type, e.x, e.y, e.z);
        if (!n) return;
        n.yaw = e.yaw;
        e.removed = true;
        this.fxAt(game.dimension, 'tp', e.x, e.y + 0.8, e.z);
      },
      aim: () => this.aimPoint(game, caster),
      transmute: (x, y, z, r, fn, each?: (x: number, y: number, z: number) => void) => {
        if (!this.cfg.terrain) return;
        const R = Math.ceil(r);
        for (let bx = Math.floor(x) - R; bx <= Math.floor(x) + R; bx++)
          for (let by = Math.floor(y) - R; by <= Math.floor(y) + R; by++)
            for (let bz = Math.floor(z) - R; bz <= Math.floor(z) + R; bz++) {
              if ((bx + 0.5 - x) ** 2 + (by + 0.5 - y) ** 2 + (bz + 0.5 - z) ** 2 > r * r) continue;
              const d = def(bx, by, bz);
              if (!d || d.hardness < 0 || w.getTile(bx, by, bz)) continue;
              const to = fn(d.name);
              if (to === null || to === d.name) continue;
              const nd = to === 'air' ? null : mc.blockByName(to);
              if (to !== 'air' && !nd) continue;
              w.set(bx, by, bz, nd ? mc.pack(nd.id, 0) : 0);
              each?.(bx, by, bz);
            }
      },
      deflect: (x, y, z, r) => {
        for (const e of game.entities) {
          if (e.removed || !PROJECTILE_ENTITIES.includes((e as unknown as { typeName: string }).typeName)) continue;
          if ((e as unknown as { owner?: Entity }).owner === caster && caster) continue;
          if (Math.hypot(e.x - x, e.y - y, e.z - z) > r) continue;
          e.removed = true;
          this.fxAt(game.dimension, 'zap', e.x, e.y, e.z);
        }
      },
      fx: (kind, x, y, z, data) => this.fxAt(game.dimension, kind, x, y, z, data),
      sound: (name, x, y, z, vol = 1, pitch = 1) => game.audio.play(name, { x, y, z }, vol, pitch),
      rand: this.rng,
      get time() { return game.ticks; },
    };
    return sw;
  }

  private fxAt(dim: string, n: string, x: number, y: number, z: number, d?: number[]) {
    this.emit(dim, d ? { k: 'f', n, p: [r3(x), r3(y), r3(z)], d } : { k: 'f', n, p: [r3(x), r3(y), r3(z)] });
  }

  /** An explosion of a spell's own: hurts and throws what's near, breaks what it can, lights fires, sets off crystals. */
  blast(game: Game, caster: Entity | null, x: number, y: number, z: number, r: number, dmg: number, terrain: number, fireOn: boolean, color: number, o: { elec?: boolean; status?: Status; self?: boolean } = {}) {
    for (const e of game.entities) {
      if (!this.isLiving(e) || (this.isPlayer(e) && (e as unknown as Player).spectator)) continue;
      const cx = e.x, cy = e.y + e.height / 2, cz = e.z;
      const d = Math.max(0, Math.hypot(cx - x, cy - y, cz - z) - e.width / 2);
      if (d > r) continue;
      const f = 1 - d / r, l = Math.hypot(cx - x, cy - y, cz - z) || 1;
      const k = 0.25 + 0.75 * f;
      this.hurt(game, caster, e, dmg * (0.35 + 0.65 * f), { fire: fireOn, blast: !o.elec, elec: o.elec, self: o.self, kx: ((cx - x) / l) * k, ky: 0.2 + 0.3 * f, kz: ((cz - z) / l) * k });
      if (o.status) { this.statuses.set(e, o.status, 200, game.ticks); if (o.status === 'toxic') (e as unknown as { addEffect(id: string, d: number, a: number): void }).addEffect('poison', 80, 1); }
    }
    if (o.elec) for (let i = 0; i < 3; i++) this.fxAt(game.dimension, 'zap', x + (this.rng() - 0.5) * r, y + (this.rng() - 0.5) * r * 0.5, z + (this.rng() - 0.5) * r);
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
    // dormant crystals and propane tanks caught in it go off too
    for (const f of this.flying.get(game.dimension) ?? []) {
      if (f.dead || !f.p.dormant || Math.hypot(f.x - x, f.y - y, f.z - z) > r + 1.2) continue;
      f.p.dormant = false;
      this.live(game, f).kill();
    }
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

  /** The wand in each player's hand: mana and timers for their HUD (sent when they change), and its passives. */
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
        if (game.ticks % 10 === 0 && !p.dead) { const dim = (game as unknown as { dims: Map<string, unknown> }).dims.get(sp.dim); if (dim) this.passives(game, p, w, dim); }
      } else msg = { k: 'w', s: -1 };
      const key = JSON.stringify(msg);
      if (this.shown.get(p) === key) continue;
      this.shown.set(p, key);
      this.toPlayer(p, msg);
    }
  }

  /** What holding a wand with passive spells does (every 10 ticks). */
  private passives(game: Game, p: Player, w: WandData, dim: unknown) {
    const kinds = new Set(wandSpells(w).map((s: SpellDef) => s.passive).filter(Boolean));
    if (!kinds.size) return;
    game.inDim(dim as never, () => {
      const le = p as unknown as { addEffect(id: string, d: number, a: number): void };
      if (kinds.has('torch') || kinds.has('electricTorch')) le.addEffect('night_vision', 300, 0);
      if (kinds.has('shield')) { le.addEffect('resistance', 30, 1); this.world(game, null).deflect(p.x, p.y + 1, p.z, 2.5); }
      else if (kinds.has('shieldSector')) le.addEffect('resistance', 30, 0);
      if (kinds.has('electricTorch') && game.ticks % 20 === 0) {
        for (const e of this.foes(game, p, p.x, p.y + 1, p.z, 2.5)) { this.hurt(game, p, e, 3, { elec: true }); this.fxAt(game.dimension, 'arc', p.x, p.y + 1.4, p.z, [r3(e.x), r3(e.y + e.height / 2), r3(e.z), 0xa0e0ff]); }
      }
      if (kinds.has('ghost') && game.ticks % 30 === 0) {
        const foe = this.foes(game, p, p.x, p.y + 1, p.z, 14)[0];
        const s = SPELL_BY_ID.get('spark_bolt');
        if (foe && s) {
          const y = p.y + 2.3, d = norm(foe.x - p.x, foe.y + foe.height / 2 - y, foe.z - p.z);
          this.launch(game, makeProj(s), p.x, y, p.z, d, p, 1, 1);
        }
      }
    });
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
    this.byId.clear();
    this.runtimes.clear();
    this.dimOut.clear();
    this.playerOut.clear();
    this.statuses.reset();
    this.rigs.length = 0;
  }

  spells(): readonly SpellDef[] { return [...SPELL_BY_ID.values()]; }
  /** Projectiles in flight (tests, the console). */
  count() { let n = 0; for (const l of this.flying.values()) n += l.length; return n; }
}

// ------------------------------------------------------------------ geometry
function norm(x: number, y: number, z: number, fallback: [number, number, number] = [0, 0, 1]): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return l > 1e-6 ? [x / l, y / l, z / l] : [fallback[0], fallback[1], fallback[2]];
}

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

/** Distance from a point to a segment. */
function segDist(ax: number, ay: number, az: number, bx: number, by: number, bz: number, px: number, py: number, pz: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz);
}

export type { Orbit };
