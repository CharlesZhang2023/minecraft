// The strategy game on the server: each player's side and view mode, their commands (checked: they come from
// other people's machines), buildings going up block by block, training, towers, raids, and telling every client
// what it needs to draw its HUD.
import type { ModContext, Game, Entity, Player, Channel } from '../sdk';
import {
  BUILDINGS, UNITS, RES, RAIDERS, START_RES, POP_CAP, TEAMS, FACTIONS, canAfford, costText, resourceOf,
  type Cost, type Res,
} from './defs';
import { cellsAt, cellOk, counts, checkPlace, door, distToRect, groundY, rect, type ACell, type Placed } from './place';
import { isUnit, hooks, type UnitEntity } from './units';
import { Brains, retaliate, type Order } from './ai';
import { castBlocks } from './cam';
import type { BState, BInfo, Mode, PState, SInfo, ToClient, ToServer, WData } from './state';

type UnitClass = new (world: NonNullable<Game['world']>, game: Game) => UnitEntity;

export interface HostSettings { allow: string; pvp: boolean; raids: boolean }

const MAX_UNITS_PER_CMD = 200;
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export class Overseer {
  game: Game | null = null;
  brains: Brains;
  private cellCache = new Map<number, ACell[]>();
  /** Cells that wouldn't stay put when placed (skipped so building can't loop on them), per building. */
  private stuck = new Map<number, { key: string; n: number; skip: Set<string> }>();
  private unitLists = new Map<unknown, UnitEntity[]>();
  private lastSent = new Map<string, string>();
  private lastBuildings = new Map<string, string>();
  private alerts = new Map<string, number>();
  private stalled = new Set<number>();
  private lastNight = -1;

  constructor(public mod: ModContext, private data: () => WData, private ch: Channel<ToServer | ToClient>, private Unit: UnitClass | null, public settings: () => HostSettings) {
    this.brains = new Brains(this);
    hooks.think = (u) => this.brains.think(u);
    hooks.damaged = (u, a) => retaliate(this, this.brains, u, a);
    hooks.friendly = (u, a) => this.friendly(u, a);
    hooks.died = (u) => { if (u.owner && u.owner !== RAIDERS) this.dirtyState(u.owner); };
    hooks.save = (u) => this.brains.save(u);
    hooks.load = (u, d) => this.brains.load(u, d);
  }

  get mc() { return this.mod.mc; }
  wd(): WData {
    const d = this.data();
    d.players ??= {};
    d.buildings ??= [];
    d.next ??= 1;
    return d;
  }
  reset() {
    this.cellCache.clear();
    this.stuck.clear();
    this.unitLists.clear();
    this.lastSent.clear();
    this.lastBuildings.clear();
    this.alerts.clear();
    this.lastNight = -1;
  }

  // ------------------------------------------------------------------------------------------------ lookups
  ps(name: string): PState {
    const all = this.wd().players;
    let p = all[name];
    if (!p) {
      const used = new Set(Object.values(all).map((q) => q.team));
      let team = 0;
      while (used.has(team) && team < TEAMS.length - 1) team++;
      p = all[name] = { faction: null, team, res: { ...START_RES }, mode: 'off', park: null, started: false };
    }
    return p;
  }
  nameOf(p: Entity | null | undefined): string | null {
    return this.game?.playerOf(p)?.name ?? null;
  }
  building(id: number): BState | null {
    return this.wd().buildings.find((b) => b.id === id) ?? null;
  }
  buildingsIn(dim: string) { return this.wd().buildings.filter((b) => b.dim === dim); }
  cells(b: BState): ACell[] {
    let c = this.cellCache.get(b.id);
    if (!c) { c = cellsAt(this.mc, b as Placed); this.cellCache.set(b.id, c); }
    return c;
  }
  entity(id: number): Entity | null {
    return this.game?.entities.find((e) => e.id === id && !e.removed) ?? null;
  }
  /** Units in the dimension being simulated (gathered once a tick). */
  unitsHere(): UnitEntity[] {
    const w = this.game?.world;
    if (!w) return [];
    let l = this.unitLists.get(w);
    if (!l) { l = this.game!.entities.filter(isUnit) as UnitEntity[]; this.unitLists.set(w, l); }
    return l;
  }
  /** Is (x, y, z) part of any building here? (workers leave those blocks alone) */
  inBuilding(x: number, y: number, z: number) {
    const dim = this.game!.world!.dimension;
    for (const b of this.wd().buildings) {
      if (b.dim !== dim) continue;
      const [x0, z0, x1, z1] = rect(b);
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= b.y - 1 && y < b.y + BUILDINGS[b.type].blueprint.h) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------------ sides
  /** Would unit `u` fight `e` without being told to? */
  isEnemy(u: UnitEntity, e: Entity): boolean {
    const raider = u.owner === RAIDERS, pvp = this.settings().pvp;
    if (isUnit(e)) return e.owner !== u.owner && (raider || e.owner === RAIDERS || pvp);
    if (e instanceof this.mc.Player) {
      const p = e as Player;
      if (p.dead || p.spectator || p.creative) return false;
      const n = this.nameOf(p);
      return raider || (pvp && n !== u.owner);
    }
    if (e instanceof this.mc.Monster) return !raider;
    return false;
  }
  /** Damage from your own side doesn't land (arrows into a crowd, a stray swing). */
  private friendly(u: UnitEntity, a: Entity | null): boolean {
    if (!a) return false;
    const tag = (a as unknown as { overseerOwner?: string }).overseerOwner;
    if (tag !== undefined) return tag === u.owner;
    const src = (a as unknown as { shooter?: Entity | null }).shooter ?? a;
    if (isUnit(src)) return src.owner === u.owner;
    if (src instanceof this.mc.Player) return this.nameOf(src) === u.owner;
    return false;
  }
  /** The owner's (or for raiders, anyone's) nearest building within range. */
  nearestEnemyBuilding(u: UnitEntity, range: number): BState | null {
    const dim = this.game!.world!.dimension;
    let best: BState | null = null, bd = range;
    for (const b of this.wd().buildings) {
      if (b.dim !== dim || b.owner === u.owner) continue;
      if (u.owner !== RAIDERS && !this.settings().pvp) continue;
      const d = distToRect(b, u.x, u.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------------ economy
  addRes(owner: string, r: Res, n: number) {
    const p = this.ps(owner);
    p.res[r] = Math.max(0, (p.res[r] ?? 0) + n);
    this.dirtyState(owner);
  }
  pay(owner: string, c: Cost): boolean {
    const p = this.ps(owner);
    if (!canAfford(p.res, c)) return false;
    for (const r of RES) p.res[r] -= c[r] ?? 0;
    this.dirtyState(owner);
    return true;
  }
  refund(owner: string, c: Cost, f = 1) {
    for (const r of RES) if (c[r]) this.addRes(owner, r, Math.floor((c[r] ?? 0) * f));
  }
  /** Population used and allowed, for an owner (all dimensions). */
  pop(owner: string): [number, number] {
    let used = 0, max = 0;
    for (const d of this.game!.dims.values()) for (const e of d.entities) if (isUnit(e) && !e.dead && e.owner === owner) used += UNITS[e.kind]?.pop ?? 1;
    for (const b of this.wd().buildings) if (b.owner === owner && b.built) max += BUILDINGS[b.type].pop ?? 0;
    return [used, Math.min(POP_CAP, max)];
  }
  toolFor(job: string): number {
    const n = job === 'wood' ? 'stone_axe' : job === 'ore' ? 'stone_pickaxe' : job === 'farm' || job === 'food' ? 'stone_hoe' : job === 'build' ? 'wooden_axe' : '';
    return n ? this.mc.itemByName(n)?.id ?? 0 : 0;
  }
  carryItem(res: string): number {
    const n = res === 'wood' ? 'oak_log' : res === 'ore' ? 'cobblestone' : res === 'food' ? 'wheat' : '';
    return n ? this.mc.itemByName(n)?.id ?? 0 : 0;
  }
  nearestDropoff(u: UnitEntity): BState | null {
    const dim = this.game!.world!.dimension;
    let best: BState | null = null, bd = Infinity;
    for (const b of this.wd().buildings) {
      if (b.owner !== u.owner || b.dim !== dim || !b.built || !BUILDINGS[b.type].dropoff) continue;
      const d = distToRect(b, u.x, u.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  deposit(u: UnitEntity) {
    if (u.carry > 0 && (RES as string[]).includes(u.carryRes)) this.addRes(u.owner, u.carryRes as Res, u.carry);
    u.carry = 0;
    u.carryRes = '';
    u.heldItem = 0;
  }

  // ------------------------------------------------------------------------------------------------ buildings
  /** Is anything left to place or clear (that can be placed)? */
  needsWork(b: BState): boolean {
    const w = this.game!.world!, skip = this.stuck.get(b.id)?.skip;
    return this.cells(b).some((c) => !cellOk(this.mc, w, c) && !skip?.has(`${c.x},${c.y},${c.z}`));
  }
  /** The next block of a building: clear an obstacle or place a block (with the ground filled in under it). */
  buildStep(b: BState): ACell | null {
    const w = this.game!.world!, g = this.game!, mc = this.mc;
    let st = this.stuck.get(b.id);
    if (!st) { st = { key: '', n: 0, skip: new Set() }; this.stuck.set(b.id, st); }
    for (const c of this.cells(b)) {
      if (cellOk(mc, w, c)) continue;
      const key = `${c.x},${c.y},${c.z}`;
      if (st.skip.has(key)) continue;
      if (st.key === key && ++st.n > 3) { st.skip.add(key); continue; }
      if (st.key !== key) { st.key = key; st.n = 0; }
      if (c.y === b.y) this.foundation(c.x, c.y, c.z);
      // farmland turns to dirt under anything solid, and crops only stand on farmland
      if (c.c === 'A' && mc.BLOCKS[w.getId(c.x, c.y + 1, c.z)].opaque) w.set(c.x, c.y + 1, c.z, 0);
      if (c.c === 'Y' && w.getId(c.x, c.y - 1, c.z) !== mc.B.FARMLAND) w.set(c.x, c.y - 1, c.z, mc.B.FARMLAND);
      if (c.v && mc.BLOCKS[mc.idOf(c.v)].solid) this.shove(c);
      const old = w.getId(c.x, c.y, c.z);
      if (old && c.c !== '.' && mc.BLOCKS[old].solid) g.interact!.destroyBlocks([[c.x, c.y, c.z]], { drops: 0, fx: 'break' });
      w.set(c.x, c.y, c.z, c.v);
      if (c.v) g.playBlockSound(mc.idOf(c.v), c.x, c.y, c.z, 'place');
      else if (old) g.particles?.blockBreak(c.x, c.y, c.z, old);
      this.recount(b);
      return c;
    }
    return null;
  }
  /** Fill the gap under a floor block with dirt, down to the ground. */
  private foundation(x: number, y: number, z: number) {
    const w = this.game!.world!, mc = this.mc;
    for (let k = 1; k <= 8; k++) {
      const id = w.getId(x, y - k, z);
      if (id && mc.BLOCKS[id].solid && !mc.BLOCKS[id].name.endsWith('_leaves')) break;
      w.set(x, y - k, z, mc.B.DIRT);
    }
  }
  /** Anything standing where a solid block goes is moved out of the way. */
  private shove(c: ACell) {
    for (const e of this.game!.entities) {
      if (e.removed || !(e instanceof this.mc.LivingEntity)) continue;
      const bx = e.box;
      if (bx.x1 <= c.x || bx.x0 >= c.x + 1 || bx.z1 <= c.z || bx.z0 >= c.z + 1 || bx.y1 <= c.y || bx.y0 >= c.y + 1) continue;
      e.setPos(e.x, c.y + 1.01, e.z);
    }
  }
  recount(b: BState) {
    const w = this.game!.world!;
    let hp = 0, max = 0;
    for (const c of this.cells(b)) if (counts(c)) { max++; if (cellOk(this.mc, w, c)) hp++; }
    b.hp = hp;
    b.max = max;
  }
  complete(b: BState) {
    this.recount(b);
    if (b.built) return;
    b.built = true;
    this.say(b.owner, `${this.nameOfType(b)} finished`, b);
    this.dirtyState(b.owner);
  }
  private nameOfType(b: BState) { return BUILDINGS[b.type].names[b.faction]; }
  /** A standing block of the building nearest a point. */
  nearestBlockOf(b: BState, x: number, y: number, z: number): ACell | null {
    const w = this.game!.world!;
    let best: ACell | null = null, bd = Infinity;
    for (const c of this.cells(b)) {
      if (!counts(c) || !cellOk(this.mc, w, c)) continue;
      const d = Math.hypot(c.x + 0.5 - x, (c.y - y) * 0.7, c.z + 0.5 - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  /** Knock blocks off a building (an attack). */
  damageBuilding(b: BState, by: UnitEntity | null, n: number, at: [number, number, number] | null) {
    const w = this.game!.world!;
    const list: [number, number, number][] = [];
    const cs = this.cells(b).filter((c) => counts(c) && cellOk(this.mc, w, c));
    if (at) { const i = cs.findIndex((c) => c.x === at[0] && c.y === at[1] && c.z === at[2]); if (i >= 0) list.push([at[0], at[1], at[2]]); }
    // then the ones nearest it
    const ax = at ? at[0] : by?.x ?? b.x, ay = at ? at[1] : by?.y ?? b.y, az = at ? at[2] : by?.z ?? b.z;
    cs.sort((p, q) => Math.hypot(p.x - ax, p.y - ay, p.z - az) - Math.hypot(q.x - ax, q.y - ay, q.z - az));
    for (const c of cs) { if (list.length >= n) break; if (!list.some((l) => l[0] === c.x && l[1] === c.y && l[2] === c.z)) list.push([c.x, c.y, c.z]); }
    this.game!.interact!.destroyBlocks(list, { drops: 0, fx: 'break' });
    this.recount(b);
    this.alert(b.owner, `Your ${this.nameOfType(b)} is under attack`, b.x, b.z);
    this.checkRuin(b);
  }
  /** A building down to a third of its blocks collapses. */
  private checkRuin(b: BState) {
    if (!b.built || b.hp > b.max * 0.35) return;
    this.removeBuilding(b, true);
    this.say(b.owner, `Your ${this.nameOfType(b)} was destroyed`, b, true);
  }
  removeBuilding(b: BState, collapse: boolean) {
    const d = this.wd();
    const i = d.buildings.indexOf(b);
    if (i < 0) return;
    d.buildings.splice(i, 1);
    if (collapse) {
      const w = this.game!.world!;
      const list = this.cells(b).filter((c) => c.c !== '.' && cellOk(this.mc, w, c)).map((c) => [c.x, c.y, c.z] as [number, number, number]);
      this.game!.interact!.destroyBlocks(list, { drops: 0, fx: 'smoke' });
      this.game!.audio.play('explode', { x: b.x, y: b.y + 2, z: b.z }, 0.6, 0.6);
    }
    this.cellCache.delete(b.id);
    this.stuck.delete(b.id);
    this.dirtyState(b.owner);
  }

  // ------------------------------------------------------------------------------------------------ explosions
  explode(u: UnitEntity, x: number, y: number, z: number) {
    const g = this.game!, r = u.def().explode ?? 3;
    g.particles?.explosion(x, y, z);
    for (let i = 0; i < 6; i++) g.particles?.smoke(x + (Math.random() - 0.5) * r, y + Math.random() * 2, z + (Math.random() - 0.5) * r, true);
    g.audio.play('explode', { x, y, z }, 1, 1);
    for (const e of [...g.entities]) {
      if (e === u || e.removed || !(e instanceof this.mc.LivingEntity)) continue;
      if (!this.isEnemy(u, e) && !(e instanceof this.mc.Animal)) continue;
      const d = Math.hypot(e.x - x, e.y + e.height / 2 - y, e.z - z);
      if (d > r + 1) continue;
      (e as unknown as { damage: (n: number, s: string, a: Entity) => boolean }).damage(Math.round(16 * (1 - d / (r + 1))) + 2, 'explosion', u);
    }
    // enemy buildings in the blast lose their blocks
    for (const b of this.wd().buildings) {
      if (b.dim !== g.world!.dimension || b.owner === u.owner || (u.owner !== RAIDERS && b.owner !== RAIDERS && !this.settings().pvp)) continue;
      if (distToRect(b, x, z) > r + 1) continue;
      const w = g.world!;
      const hit = this.cells(b).filter((c) => counts(c) && cellOk(this.mc, w, c) && Math.hypot(c.x + 0.5 - x, c.y + 0.5 - y, c.z + 0.5 - z) <= r + 0.5);
      g.interact!.destroyBlocks(hit.map((c) => [c.x, c.y, c.z] as [number, number, number]), { drops: 0, fx: 'smoke' });
      this.recount(b);
      this.alert(b.owner, `Your ${this.nameOfType(b)} is under attack`, b.x, b.z);
      this.checkRuin(b);
    }
    u.damage(1000, 'kill', null);
    u.removed = true;
  }

  // ------------------------------------------------------------------------------------------------ messages
  private dirty = new Set<string>();
  dirtyState(owner: string) { this.dirty.add(owner); }
  /** A message for one player (in their HUD feed, with an optional spot to jump to). */
  say(owner: string, m: string, at?: { x: number; z: number } | null, alert = false) {
    const sp = this.game?.players.find((p) => p.name === owner);
    if (sp) this.ch.toPlayer(sp.entity, { t: 'msg', m, x: at?.x, z: at?.z, alert });
  }
  /** "Under attack", at most every ten seconds per player. */
  alert(owner: string, m: string, x: number, z: number) {
    if (!owner || owner === RAIDERS) return;
    const t = this.game!.ticks;
    if ((this.alerts.get(owner) ?? -1e9) > t - 200) return;
    this.alerts.set(owner, t);
    this.say(owner, m, { x, z }, true);
  }

  // ------------------------------------------------------------------------------------------------ view modes
  allowed(name: string, owner: boolean) {
    return owner || this.settings().allow !== 'host' || !name;
  }
  setMode(p: Player, m: Mode) {
    const g = this.game!, sp = g.playerOf(p);
    if (!sp || !['off', 'god', 'hero'].includes(m)) return;
    const st = this.ps(sp.name);
    if (m === 'god' && (!this.allowed(sp.name, sp.owner) || p.dead)) {
      if (!p.dead) this.say(sp.name, 'The host only lets themselves use the overseer view');
      this.ch.toPlayer(p, { t: 'mode', m: st.mode === 'god' ? 'off' : st.mode });
      return;
    }
    if (m === 'god' && !st.park) {
      st.park = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, gm: p.gameMode, flying: p.flying, dim: sp.dim };
      p.setGameMode(3);
    } else if (m !== 'god' && st.park) this.restore(p, st);
    st.mode = m;
    this.dirtyState(sp.name);
    this.ch.toPlayer(p, { t: 'mode', m });
  }
  /** Put a player back in their body (where it was parked, as it was). */
  restore(p: Player, st: PState) {
    const k = st.park;
    if (!k) return;
    st.park = null;
    p.setGameMode(k.gm);
    p.flying = k.flying && p.canFly;
    p.yaw = k.yaw; p.pitch = k.pitch;
    p.setPos(k.x, k.y, k.z);
    const sp = this.game?.playerOf(p);
    if (sp?.pendingArrival) { sp.pendingArrival.x = k.x; sp.pendingArrival.y = k.y; sp.pendingArrival.z = k.z; }
  }

  // ------------------------------------------------------------------------------------------------ commands
  receive(d: ToServer, p: Player, g: Game) {
    this.game = g;
    if (!d || typeof d !== 'object' || typeof d.t !== 'string') return;
    const name = this.nameOf(p);
    if (!name) return;
    const st = this.ps(name);
    switch (d.t) {
      case 'mode': this.setMode(p, d.m); return;
      case 'faction': {
        if (!FACTIONS.includes(d.f)) return;
        if (st.faction && (st.started || this.wd().buildings.some((b) => b.owner === name))) return;
        st.faction = d.f;
        this.dirtyState(name);
        return;
      }
      case 'goto': {
        if (st.mode !== 'god' || !fin(d.x) || !fin(d.y) || !fin(d.z)) return;
        p.setPos(d.x, Math.max(1, Math.min(250, d.y)), d.z);
        return;
      }
      case 'place': return this.place(d, p, name, st);
      case 'train': {
        const b = this.building(d.b);
        if (!b || b.owner !== name || !b.built || typeof d.u !== 'string') return;
        const def = UNITS[d.u];
        if (!def || !BUILDINGS[b.type].trains?.[b.faction]?.includes(d.u)) return;
        if (b.queue.length >= 5) { this.say(name, 'The queue is full'); return; }
        if (!this.pay(name, def.cost)) { this.say(name, `Not enough resources (${costText(def.cost)})`); return; }
        b.queue.push({ u: d.u, t: 0 });
        return;
      }
      case 'untrain': {
        const b = this.building(d.b);
        if (!b || b.owner !== name || !Number.isInteger(d.i) || d.i < 0 || d.i >= b.queue.length) return;
        const [q] = b.queue.splice(d.i, 1);
        this.refund(name, UNITS[q.u]?.cost ?? {});
        return;
      }
      case 'rally': {
        const b = this.building(d.b);
        if (!b || b.owner !== name || !fin(d.x) || !fin(d.y) || !fin(d.z)) return;
        b.rally = Math.hypot(d.x - b.x, d.z - b.z) < 200 ? [d.x, d.y, d.z] : null;
        return;
      }
      case 'demolish': {
        const b = this.building(d.b);
        if (!b || b.owner !== name) return;
        if (!b.built) this.refund(name, b.paid, b.hp <= 1 ? 1 : 0.5);
        for (const q of b.queue) this.refund(name, UNITS[q.u]?.cost ?? {});
        this.removeBuilding(b, true);
        return;
      }
      case 'cmd': return this.order(d, p, name);
    }
  }

  private myUnits(ids: unknown, name: string): UnitEntity[] {
    if (!Array.isArray(ids)) return [];
    const want = new Set(ids.slice(0, MAX_UNITS_PER_CMD).filter((i) => Number.isInteger(i)));
    return this.game!.entities.filter((e) => want.has(e.id) && isUnit(e) && e.owner === name && !e.dead) as UnitEntity[];
  }

  private order(d: Extract<ToServer, { t: 'cmd' }>, p: Player, name: string) {
    const us = this.myUnits(d.u, name);
    if (!us.length) return;
    const q = !!d.q, w = this.game!.world!;
    const at = fin(d.x) && fin(d.y) && fin(d.z) ? { x: d.x, y: d.y, z: d.z } : null;
    const all = (o: Order | ((u: UnitEntity, i: number) => Order)) => us.forEach((u, i) => this.brains.command(u, typeof o === 'function' ? o(u, i) : o, q));
    switch (d.c) {
      case 'stop': all({ t: 'idle' }); return;
      case 'hold': all({ t: 'hold' }); return;
      case 'return': all((u) => (u.carry > 0 ? { t: 'return' } : { t: 'idle' })); return;
      case 'move': case 'amove': {
        if (!at) return;
        // to the ground there (a click on a treetop means the foot of the tree)
        if (w.isLoaded(at.x, at.z)) at.y = groundY(this.mc, w, Math.floor(at.x), Math.floor(at.z)) + 1;
        // spread out around the spot, in a loose square
        const n = us.length, side = Math.ceil(Math.sqrt(n));
        all((u, i) => {
          const ox = n > 1 ? ((i % side) - (side - 1) / 2) * 1.4 : 0, oz = n > 1 ? (Math.floor(i / side) - (side - 1) / 2) * 1.4 : 0;
          return { t: d.c as 'move' | 'amove', x: at.x + ox, y: at.y, z: at.z + oz };
        });
        return;
      }
      case 'attack': case 'follow': {
        if (Number.isInteger(d.b)) {
          const b = this.building(d.b!);
          if (!b || b.owner === name) return;
          if (b.owner !== RAIDERS && !this.settings().pvp) { this.say(name, 'Attacking other players is off (host setting)'); return; }
          all({ t: 'siege', b: b.id });
          return;
        }
        const e = this.entity(d.e!);
        if (!e || !(e instanceof this.mc.LivingEntity)) return;
        if (d.c === 'follow') { all({ t: 'follow', e: e.id }); return; }
        if (isUnit(e) && e.owner === name) return;
        const theirs = isUnit(e) ? e.owner : e instanceof this.mc.Player ? this.nameOf(e) : null;
        if (theirs && theirs !== RAIDERS && !this.settings().pvp) { this.say(name, 'Attacking other players is off (host setting)'); return; }
        all((u) => ({ t: u.def().worker && e instanceof this.mc.Animal ? 'hunt' : 'attack', e: e.id }));
        return;
      }
      case 'gather': {
        if (!at) return;
        const bx = Math.floor(at.x), by = Math.floor(at.y), bz = Math.floor(at.z);
        const r = resourceOf(this.mc.BLOCKS[w.getId(bx, by, bz)]?.name ?? '');
        if (!r) return;
        all((u) => (u.def().worker ? { t: 'gather', x: bx + 0.5, y: by, z: bz + 0.5, res: r.res } : { t: 'move', x: bx + 0.5, y: by + 1, z: bz + 0.5 }));
        return;
      }
      case 'build': case 'farm': {
        const b = this.building(d.b!);
        if (!b || b.owner !== name) return;
        const farm = d.c === 'farm' && b.built && BUILDINGS[b.type].farm;
        all((u) => (u.def().worker ? { t: farm ? 'farm' : 'build', b: b.id } : { t: 'move', ...door(b).out }));
        return;
      }
    }
  }

  private place(d: Extract<ToServer, { t: 'place' }>, p: Player, name: string, st: PState) {
    const def = BUILDINGS[d.type];
    if (!def || !st.faction || !Number.isInteger(d.x) || !Number.isInteger(d.z) || !Number.isInteger(d.rot)) return;
    const g = this.game!, w = g.world!, dim = w.dimension;
    const own = this.wd().buildings.filter((b) => b.owner === name && b.dim === dim);
    const first = !this.wd().buildings.some((b) => b.owner === name);
    const others = this.wd().buildings.filter((b) => b.dim === dim) as Placed[];
    const chk = checkPlace(this.mc, w, d.type, d.x, d.z, d.rot & 3, others, own as Placed[], first);
    if (!chk.ok) { this.say(name, chk.why ?? 'Can\'t build there'); return; }
    const free = first && d.type === 'town_centre' && !st.started;
    if (!free && !this.pay(name, def.cost)) { this.say(name, `Not enough resources (${costText(def.cost)})`); return; }
    const b: BState = {
      id: this.wd().next++, type: d.type, owner: name, faction: st.faction, team: st.team, dim,
      x: d.x, y: chk.y, z: d.z, rot: d.rot & 3, built: false, hp: 0, max: 0, queue: [], rally: null, paid: free ? {} : { ...def.cost },
    };
    this.wd().buildings.push(b);
    this.recount(b);
    const workers = this.myUnits(d.u, name).filter((u) => u.def().worker);
    for (const u of workers) this.brains.command(u, { t: 'build', b: b.id }, !!d.q);
    if (free) {
      // the first town hall comes with a few workers to build it
      st.started = true;
      const kind = BUILDINGS.town_centre.trains![st.faction][0];
      for (let i = 0; i < 3; i++) {
        const u = this.spawnUnit(name, kind, b, i);
        if (u) this.brains.command(u, { t: 'build', b: b.id });
      }
    }
    this.dirtyState(name);
  }

  /** A new unit outside a building's door. */
  spawnUnit(owner: string, kind: string, b: { type: string; x: number; y: number; z: number; rot: number }, i = 0): UnitEntity | null {
    if (!this.Unit) return null;
    const g = this.game!, w = g.world!;
    const out = door(b).out;
    const x = out.x + 0.5 + ((i % 3) - 1) * 0.8, z = out.z + 0.5 + (Math.floor(i / 3) % 3) * 0.8;
    const y = groundY(this.mc, w, Math.floor(x), Math.floor(z)) + 1;
    const u = new this.Unit(w, g);
    u.setKind(kind);
    u.owner = owner;
    u.team = owner === RAIDERS ? -1 : this.ps(owner).team;
    u.setPos(x, y, z);
    g.addEntity(u);
    this.unitLists.delete(w);
    this.dirtyState(owner);
    return u;
  }

  // ------------------------------------------------------------------------------------------------ ticking
  tick(g: Game) {
    this.game = g;
    this.unitLists.clear();
    const t = g.ticks;
    for (const dim of g.dims.values()) {
      if (!g.players.some((p) => p.dim === dim.world.dimension)) continue;
      g.inDim(dim, () => this.tickDim(t));
    }
    if (t % 5 === 0) this.sync(g);
  }

  private tickDim(t: number) {
    const g = this.game!, w = g.world!, dimName = w.dimension;
    const list = this.buildingsIn(dimName);
    // keep the towns ticking while their owners look elsewhere
    if (t % 20 === 0) {
      const seen = new Set<string>();
      const dim = [...g.dims.values()].find((d) => d.world === w)!;
      dim.keepLoaded = [];
      for (const b of list) {
        const k = `${b.x >> 5},${b.z >> 5}`;
        if (seen.has(k) || seen.size > 12) continue;
        seen.add(k);
        dim.keepLoaded.push({ x: b.x, z: b.z, r: 3 });
      }
    }
    for (const b of list) {
      if (!w.isLoaded(b.x, b.z)) continue;
      if (t % 20 === (b.id % 20)) { this.recount(b); this.checkRuin(b); }
      if (b.built) {
        this.train(b);
        const def = BUILDINGS[b.type];
        if (def.tower && t % 25 === b.id % 25) this.tower(b, def.tower);
      }
    }
    if (dimName === 'overworld' && this.settings().raids) this.raids();
  }

  private train(b: BState) {
    const q = b.queue[0];
    if (!q) { this.stalled.delete(b.id); return; }
    const def = UNITS[q.u];
    if (!def) { b.queue.shift(); return; }
    if (q.t < def.time) { q.t++; return; }
    const [used, max] = this.pop(b.owner);
    if (used + def.pop > max) {
      if (!this.stalled.has(b.id)) { this.stalled.add(b.id); this.say(b.owner, 'Not enough room: build more houses'); }
      return;
    }
    this.stalled.delete(b.id);
    b.queue.shift();
    const u = this.spawnUnit(b.owner, q.u, b);
    if (!u) return;
    this.game!.audio.play('pop', u, 0.6, 0.8);
    if (b.rally) {
      const [x, y, z] = b.rally;
      const r = resourceOf(this.mc.BLOCKS[this.game!.world!.getId(Math.floor(x), Math.floor(y), Math.floor(z))]?.name ?? '');
      if (r && def.worker) this.brains.command(u, { t: 'gather', x: Math.floor(x) + 0.5, y: Math.floor(y), z: Math.floor(z) + 0.5, res: r.res });
      else this.brains.command(u, { t: def.worker ? 'move' : 'amove', x, y: y + 1, z });
    }
  }

  private tower(b: BState, range: number) {
    const g = this.game!;
    // from just above the top, clear of its own blocks
    const top = { x: rect(b)[0] + 1.5, y: b.y + BUILDINGS[b.type].blueprint.h + 0.6, z: rect(b)[1] + 1.5 };
    let best: Entity | null = null, bd = Infinity;
    const probe = { owner: b.owner, def: () => UNITS.archer } as unknown as UnitEntity;
    for (const e of g.entities) {
      if (e.removed || !(e instanceof this.mc.LivingEntity) || (e as unknown as { dead: boolean }).dead) continue;
      if (!this.isEnemy(probe, e)) continue;
      // range across the ground (a tall tower still reaches what's at its feet)
      const d = Math.hypot(e.x - top.x, e.y - top.y, e.z - top.z);
      if (Math.hypot(e.x - top.x, e.z - top.z) >= range || d >= bd) continue;
      // only what it can see (an arrow into a hill helps nobody)
      const ty = e.y + e.height * 0.6, dir = { x: (e.x - top.x) / d, y: (ty - top.y) / d, z: (e.z - top.z) / d };
      const hit = castBlocks(g.world!, top, dir, d, (id) => this.mc.BLOCKS[id].solid);
      if (hit && hit.t < d - 1.2) continue;
      bd = d; best = e;
    }
    if (!best) return;
    const shooter = { ...top, y: top.y - 1.6, eyeHeight: () => 1.6, id: b.id } as unknown as UnitEntity;
    this.brains.shoot(shooter, best.x, best.y + best.height * 0.6, best.z, 4, b.owner);
  }

  /** Nightly raids on everyone's town (host setting): monsters spawn a way off and march in. */
  private raids() {
    const g = this.game!, tod = g.time % 24000;
    const night = Math.floor(g.time / 24000);
    if (tod < 13000 || tod > 13100 || this.lastNight === night) return;
    this.lastNight = night;
    const w = g.world!;
    for (const b of this.wd().buildings) {
      if (b.type !== 'town_centre' || b.dim !== 'overworld' || !b.built) continue;
      const n = Math.min(24, 2 + Math.floor(night * 1.5));
      const a = Math.random() * Math.PI * 2, cx = b.x + Math.cos(a) * 36, cz = b.z + Math.sin(a) * 36;
      if (!w.isLoaded(cx, cz)) continue;
      const kinds = ['zombie', 'zombie', 'skeleton', 'spider', 'creeper'];
      for (let i = 0; i < n; i++) {
        const x = Math.floor(cx + (Math.random() - 0.5) * 8), z = Math.floor(cz + (Math.random() - 0.5) * 8);
        const u = this.spawnUnit(RAIDERS, kinds[i % kinds.length], { type: 'stockpile', x, y: groundY(this.mc, w, x, z), z, rot: 0 });
        if (u) this.brains.command(u, { t: 'amove', ...door(b).out });
      }
      this.say(b.owner, `A raid of ${n} monsters is coming!`, { x: cx, z: cz }, true);
    }
  }

  /** Each player's side, and the buildings of their dimension, when they change. */
  private sync(g: Game) {
    for (const sp of g.players) {
      const st = this.ps(sp.name);
      const [pop, popMax] = this.pop(sp.name);
      const s: SInfo = { me: sp.name, faction: st.faction, team: st.team, res: st.res, pop, popMax, mode: st.mode, started: st.started, pvp: this.settings().pvp, raids: this.settings().raids };
      const js = JSON.stringify(s);
      if (this.lastSent.get(sp.name) !== js) { this.lastSent.set(sp.name, js); this.ch.toPlayer(sp.entity, { t: 'st', s }); }
      if (g.ticks % 10) continue;
      const list: BInfo[] = this.buildingsIn(sp.dim).map((b) => ({
        id: b.id, type: b.type, owner: b.owner, faction: b.faction, team: b.team, x: b.x, y: b.y, z: b.z, rot: b.rot,
        built: b.built, hp: b.hp, max: b.max, rally: b.owner === sp.name ? b.rally : null,
        queue: b.owner === sp.name ? b.queue.map((q) => ({ u: q.u, f: Math.min(1, q.t / (UNITS[q.u]?.time ?? 1)) })) : [],
        prog: b.max ? b.hp / b.max : 0, stalled: this.stalled.has(b.id) || undefined,
      }));
      const lj = JSON.stringify(list);
      if (this.lastBuildings.get(sp.name) !== lj) { this.lastBuildings.set(sp.name, lj); this.ch.toPlayer(sp.entity, { t: 'b', list }); }
    }
    this.dirty.clear();
  }

  /** Monsters go for units too (not just players), and units' kills of animals feed their side. */
  monsterLooks(m: { target: unknown; id: number; x: number; y: number; z: number; aggroRange: number; canSee(e: Entity): boolean; distanceTo(e: Entity): number }) {
    const g = this.game;
    if (!g || m.target || (g.ticks + m.id) % 10) return;
    let best: UnitEntity | null = null, bd = m.aggroRange;
    for (const u of this.unitsHere()) {
      if (u.dead || u.owner === RAIDERS) continue;
      const d = m.distanceTo(u);
      if (d < bd && (d < 4 || m.canSee(u))) { bd = d; best = u; }
    }
    if (best) m.target = best;
  }
  onDeath(e: Entity, attacker: Entity | null) {
    const src = (attacker as unknown as { shooter?: Entity | null })?.shooter ?? attacker;
    if (!isUnit(src) || !(e instanceof this.mc.Animal)) return;
    if (!src.def().worker) return;
    src.carry = (src.carryRes === 'food' ? src.carry : 0) + 15;
    src.carryRes = 'food';
    this.brains.command(src, { t: 'return' });
  }
}
