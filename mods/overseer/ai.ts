// Unit orders and the behaviour that carries them out: walking, fighting, gathering, farming, building and taking
// loads home. Runs on the server, inside each unit's tick (game.world is the unit's dimension).
import type { Entity } from '../sdk';
import { CARRY, CROPS, RAIDERS, resourceOf, type Res } from './defs';
import { isUnit, type UnitEntity } from './units';
import { cellOk, counts, distToRect, door, rect, type ACell } from './place';
import type { Overseer } from './server';
import type { BState } from './state';

export type OrderKind = 'idle' | 'move' | 'amove' | 'attack' | 'hold' | 'gather' | 'hunt' | 'build' | 'farm' | 'return' | 'follow' | 'siege';
export interface Order {
  t: OrderKind;
  x?: number; y?: number; z?: number;
  /** Entity id (attack, hunt, follow). */
  e?: number;
  /** Building id (build, farm, siege). */
  b?: number;
  res?: Res;
}

interface Living extends Entity {
  dead: boolean;
  health: number;
  maxHealth: number;
  eyeHeight(): number;
  damage(n: number, source: string, attacker?: Entity | null): boolean;
  hostile?: boolean;
  spectator?: boolean;
  creative?: boolean;
}

interface Brain {
  order: Order;
  queue: Order[];
  /** The enemy being fought (ordered, or found nearby). */
  fight: Living | null;
  /** Where an idle unit stands (it comes back here after a chase). */
  home: { x: number; y: number; z: number } | null;
  /** The block being worked on: gathered, tended, or broken off an enemy building. */
  block: [number, number, number] | null;
  work: number;
  /** Next pathfinding allowed at this tick, and the goal it was for. */
  pathAt: number;
  goal: string;
  scanAt: number;
  /** The job to go back to after taking a load home. */
  resume: Order | null;
  pickedAt: number;
  /** Walking: how close it has come to the goal, and since when it hasn't come closer. */
  best: number;
  bestAt: number;
  /** Raiders sent at night burn in the morning. */
  night: boolean;
  /** Blocks this unit couldn't get to (skipped when looking for the next one). */
  skip: Set<string>;
  /** A worker that was hit runs from its attacker for a moment. */
  flee: { x: number; z: number; until: number } | null;
}

const brains = new WeakMap<UnitEntity, Brain>();
const SEARCH = 8;

export class Brains {
  constructor(private ov: Overseer) {}

  brain(u: UnitEntity): Brain {
    let b = brains.get(u);
    if (!b) {
      b = { order: { t: 'idle' }, queue: [], fight: null, home: { x: u.x, y: u.y, z: u.z }, block: null, work: 0, pathAt: 0, goal: '', scanAt: (u.id * 7) % 10, resume: null, pickedAt: 0, best: Infinity, bestAt: 0, night: !this.ov.game?.isDaytime(), skip: new Set(), flee: null };
      brains.set(u, b);
    }
    return b;
  }

  /** Give a unit an order (queued after its current ones with `queue`). */
  command(u: UnitEntity, o: Order, queue = false) {
    const b = this.brain(u);
    if (queue && (b.order.t !== 'idle' || b.queue.length)) { b.queue.push(o); return; }
    b.queue = [];
    this.start(u, b, o);
  }
  private start(u: UnitEntity, b: Brain, o: Order) {
    b.order = o;
    b.fight = null;
    b.block = null;
    b.work = 0;
    b.goal = '';
    b.pathAt = 0;
    u.path = null;
    u.swell = 0; u.swellDir = 0;
    if (o.t === 'idle' || o.t === 'hold') b.home = { x: u.x, y: u.y, z: u.z };
    if (o.t !== 'return') b.resume = null;
    if (o.t !== 'return') b.skip.clear();
  }
  /** This order is done: the next queued one, or stand here. */
  private next(u: UnitEntity, b: Brain) {
    const n = b.queue.shift();
    this.start(u, b, n ?? { t: 'idle' });
  }
  orderOf(u: UnitEntity): Order { return this.brain(u).order; }

  /** For saving: the order worth keeping across a reload. */
  save(u: UnitEntity): Record<string, unknown> {
    const b = brains.get(u);
    if (!b) return {};
    const o = b.order.t === 'return' && b.resume ? b.resume : b.order;
    return ['gather', 'build', 'farm', 'move', 'amove', 'hold', 'siege'].includes(o.t) ? { order: { ...o } } : {};
  }
  load(u: UnitEntity, d: Record<string, unknown>) {
    const o = d.order as Order | undefined;
    if (o && typeof o.t === 'string') this.start(u, this.brain(u), { ...o });
  }

  // ------------------------------------------------------------------------------------------------ the tick
  think(u: UnitEntity) {
    const g = this.ov.game!;
    if (u.dead) return;
    const b = this.brain(u);
    const t = g.ticks;
    this.separate(u, t);
    // raiders burn away in the morning
    if (u.owner === RAIDERS && b.night && g.isDaytime() && (t + u.id) % 40 === 0 && g.world!.topSolidY(Math.floor(u.x), Math.floor(u.z)) < u.y + 1) (u as unknown as { fireTicks: number }).fireTicks = 200;
    const d = u.def();
    const o = b.order;
    if (b.flee) {
      if (t > b.flee.until) b.flee = null;
      else { u.task = 'Fleeing'; u.path = null; u.moveToward(u.x + (u.x - b.flee.x) * 4, u.z + (u.z - b.flee.z) * 4, d.speed * 1.2); return; }
    }
    switch (o.t) {
      case 'idle': {
        u.task = u.carry ? `Carrying ${u.carry} ${u.carryRes}` : 'Idle';
        if (d.aggro > 0) {
          if (!this.valid(b.fight) || this.leashed(u, b)) b.fight = null;
          if (!b.fight && t >= b.scanAt) { b.scanAt = t + 10; b.fight = this.scan(u, d.aggro); }
          if (b.fight) { u.task = 'Fighting'; this.fight(u, b, b.fight, true); break; }
        }
        if (b.home && Math.hypot(b.home.x - u.x, b.home.z - u.z) > 2.5) this.go(u, b, b.home.x, b.home.y, b.home.z, 1.5);
        break;
      }
      case 'hold': {
        u.task = 'Holding';
        if (!this.valid(b.fight) || u.distanceTo(b.fight!) > (d.range ?? 2.5) + 0.5) b.fight = null;
        if (!b.fight && t >= b.scanAt) { b.scanAt = t + 10; b.fight = this.scan(u, Math.max(d.range ?? 2.5, 3)); }
        if (b.fight) this.fight(u, b, b.fight, false);
        break;
      }
      case 'move':
        u.task = 'Moving';
        if (this.go(u, b, o.x!, o.y!, o.z!, 1.2)) this.next(u, b);
        break;
      case 'amove': {
        u.task = 'Attack-moving';
        if (d.aggro > 0) {
          if (!this.valid(b.fight) || u.distanceTo(b.fight!) > d.aggro * 1.5) b.fight = null;
          if (!b.fight && t >= b.scanAt) { b.scanAt = t + 10; b.fight = this.scan(u, d.aggro); }
          if (b.fight) { this.fight(u, b, b.fight, true); break; }
        }
        // raiders head for their target's buildings once they get there
        if (this.go(u, b, o.x!, o.y!, o.z!, 2)) {
          if (u.owner === RAIDERS) { const s = this.ov.nearestEnemyBuilding(u, 48); if (s) { this.start(u, b, { t: 'siege', b: s.id }); break; } }
          this.next(u, b);
        }
        break;
      }
      case 'attack': case 'hunt': case 'follow': {
        const e = this.ov.entity(o.e!) as Living | null;
        if (!this.valid(e)) { this.next(u, b); break; }
        if (o.t === 'follow') {
          u.task = 'Following';
          this.go(u, b, e!.x, e!.y, e!.z, 3);
          if (d.aggro > 0 && t >= b.scanAt) { b.scanAt = t + 10; const f = this.scan(u, d.aggro); if (f) this.command(u, { t: 'attack', e: f.id }); }
          break;
        }
        u.task = o.t === 'hunt' ? 'Hunting' : 'Attacking';
        this.fight(u, b, e!, true);
        break;
      }
      case 'siege': this.siege(u, b, o); break;
      case 'gather': this.gather(u, b, o); break;
      case 'farm': this.farm(u, b, o); break;
      case 'build': this.build(u, b, o); break;
      case 'return': this.goHome(u, b); break;
    }
  }

  // ------------------------------------------------------------------------------------------------ moving
  /** Walk toward a spot; true once within `near` blocks (horizontally, and within a few vertically). */
  private go(u: UnitEntity, b: Brain, x: number, y: number, z: number, near: number): boolean {
    const g = this.ov.game!;
    const dx = x - u.x, dz = z - u.z, d = Math.hypot(dx, dz);
    if (d <= near && Math.abs(y - u.y) < 3.5) { u.path = null; return true; }
    const speed = u.def().speed;
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    if (key !== b.goal) { b.best = Infinity; b.bestAt = g.ticks; }
    // no closer for a few seconds: as close as it gets (a goal up a cliff, inside a crowd, across water)
    if (d < b.best - 0.3) { b.best = d; b.bestAt = g.ticks; }
    else if (g.ticks - b.bestAt > 100 && d < near + 4) { u.path = null; return true; }
    if (key !== b.goal || g.ticks >= b.pathAt || (!u.path && g.ticks >= b.pathAt - 30)) {
      b.goal = key;
      // far goals: a fresh partial path every couple of seconds, staggered across units
      b.pathAt = g.ticks + (d > 24 ? 40 : 60) + ((u.id * 13) % 20);
      u.setPathTo(x, y, z, speed);
    }
    if (!u.path) u.moveToward(x, z, speed);
    u.aiSpeed = speed;
    return false;
  }
  /** Units of a side don't stand inside each other. */
  private separate(u: UnitEntity, t: number) {
    if ((t + u.id) % 3) return;
    for (const o of this.ov.unitsHere()) {
      if (o === u || o.dead) continue;
      const dx = u.x - o.x, dz = u.z - o.z, d2 = dx * dx + dz * dz, r = (u.width + o.width) * 0.45;
      if (d2 >= r * r || Math.abs(u.y - o.y) > 1.5) continue;
      const d = Math.sqrt(d2) || 0.01, f = ((r - d) / r) * 0.06;
      const vx = d2 ? dx / d : Math.cos(u.id), vz = d2 ? dz / d : Math.sin(u.id);
      (u as unknown as { vx: number }).vx += vx * f;
      (u as unknown as { vz: number }).vz += vz * f;
    }
  }

  // ------------------------------------------------------------------------------------------------ fighting
  private valid(e: Living | null | undefined): boolean {
    return !!e && !e.removed && !e.dead && !e.spectator && !(e as { creative?: boolean }).creative;
  }
  /** An idle soldier doesn't chase forever: past this it goes back to where it was standing. */
  private leashed(u: UnitEntity, b: Brain) {
    const h = b.home, f = b.fight;
    return !!h && !!f && Math.hypot(f.x - h.x, f.z - h.z) > u.def().aggro * 1.6;
  }
  /** The closest enemy within range that the unit can see. */
  scan(u: UnitEntity, range: number): Living | null {
    let best: Living | null = null, bd = range;
    for (const e of this.ov.game!.entities) {
      if (e === u || !this.ov.isEnemy(u, e)) continue;
      const l = e as Living;
      if (!this.valid(l)) continue;
      const d = u.distanceTo(e);
      if (d < bd && (d < 4 || u.canSee(e))) { bd = d; best = l; }
    }
    return best;
  }
  /** Close in and hit, shoot or blow up. `move` false: only from where it stands. */
  private fight(u: UnitEntity, b: Brain, t: Living, move: boolean) {
    const d = u.def(), g = this.ov.game!;
    u.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
    const dist = u.distanceTo(t);
    if (d.explode) {
      if (dist < 2.6) { this.fuse(u, t.x, t.y, t.z); return; }
      u.swell = Math.max(0, u.swell - 1);
      if (move) this.go(u, b, t.x, t.y, t.z, 1.5);
      return;
    }
    if (d.range) {
      if (dist <= d.range && u.canSee(t)) {
        u.path = null;
        u.yaw = (Math.atan2(t.z - u.z, t.x - u.x) * 180) / Math.PI - 90;
        if (dist < 4 && move) { u.forward = -0.6; u.aiSpeed = d.speed; }
        if (u.attackCooldown <= 0) { u.attackCooldown = d.cooldown; this.shoot(u, t.x, t.y + t.height * 0.55, t.z, d.damage); }
      } else if (move) this.go(u, b, t.x, t.y, t.z, Math.min(d.range - 2, 8));
      return;
    }
    const reach = u.width * 2 * u.width * 2 + t.width + 0.6;
    const dx = t.x - u.x, dz = t.z - u.z;
    if (dx * dx + dz * dz <= reach && Math.abs(t.y - u.y) < 2) {
      u.path = null;
      u.yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
      if (u.attackCooldown <= 0) {
        u.attackCooldown = d.cooldown;
        u.swing();
        t.damage(d.damage, 'mob', u);
      }
    } else if (move) {
      // close enough: walk straight at it rather than along a path to where it was
      if (dx * dx + dz * dz < 9) { u.path = null; u.moveToward(t.x, t.z, d.speed); }
      else this.go(u, b, t.x, t.y, t.z, 1);
    }
    void g;
  }
  /** An arrow at a point. */
  shoot(u: { x: number; y: number; z: number; eyeHeight(): number; id: number } & Entity, tx: number, ty: number, tz: number, dmg: number, owner?: string) {
    const g = this.ov.game!, mc = this.ov.mod.mc;
    const a = new mc.Arrow(g.world!, g, isUnit(u) ? u : null);
    const ey = u.y + u.eyeHeight() - 0.1;
    a.setPos(u.x, ey, u.z);
    const dx = tx - u.x, dz = tz - u.z, h = Math.hypot(dx, dz);
    const ang = aimAngle(h, ty - ey, 1.6);
    a.shoot(dx, Math.tan(ang) * h, dz, 1.6, 1);
    a.pickup = false;
    a.damageBase = dmg / 1.7;
    if (owner) (a as unknown as { overseerOwner: string }).overseerOwner = owner;
    g.addEntity(a);
    g.audio.play('bow', u, 0.8, 1 / (Math.random() * 0.4 + 0.8));
  }
  /** A creeper's fuse: swell for a second and a half, then burst. */
  private fuse(u: UnitEntity, x: number, y: number, z: number) {
    u.path = null;
    if (u.swellDir <= 0) { u.swellDir = 1; this.ov.game!.audio.play('fuse', u, 1, 0.5); }
    u.swell++;
    if (u.swell >= 30) this.ov.explode(u, x, y, z);
  }

  /** Breaking an enemy building, block by block. */
  private siege(u: UnitEntity, b: Brain, o: Order) {
    const g = this.ov.game!, d = u.def();
    const bs = this.ov.building(o.b!);
    if (!bs || bs.dim !== g.world!.dimension) { this.next(u, b); return; }
    u.task = 'Attacking a building';
    // defend itself on the way
    if (d.aggro > 0 && g.ticks >= b.scanAt) { b.scanAt = g.ticks + 15; const f = this.scan(u, Math.min(6, d.aggro)); if (f) b.fight = f; }
    if (this.valid(b.fight) && u.distanceTo(b.fight!) < 8) { this.fight(u, b, b.fight!, true); return; }
    b.fight = null;
    const w = g.world!;
    if (!b.block || g.ticks > b.pickedAt + 60 || !w.getId(b.block[0], b.block[1], b.block[2])) {
      const c = this.ov.nearestBlockOf(bs, u.x, u.y, u.z);
      if (!c) { this.next(u, b); return; }
      b.block = [c.x, c.y, c.z];
      b.pickedAt = g.ticks;
    }
    const [bx, by, bz] = b.block;
    const reach = d.range ? Math.min(d.range, 10) : 2.8;
    const dist = Math.hypot(bx + 0.5 - u.x, by + 0.5 - (u.y + u.eyeHeight()), bz + 0.5 - u.z);
    if (d.explode) {
      if (Math.hypot(bx + 0.5 - u.x, bz + 0.5 - u.z) < 2.2) this.fuse(u, bx + 0.5, by + 0.5, bz + 0.5);
      else this.go(u, b, bx + 0.5, by, bz + 0.5, 1.5);
      return;
    }
    if (dist > reach) { this.go(u, b, bx + 0.5, by, bz + 0.5, d.range ? reach - 1 : 1.5); return; }
    u.path = null;
    u.lookTarget = { x: bx + 0.5, y: by + 0.5, z: bz + 0.5 };
    u.yaw = (Math.atan2(bz + 0.5 - u.z, bx + 0.5 - u.x) * 180) / Math.PI - 90;
    if (u.attackCooldown > 0) return;
    u.attackCooldown = d.cooldown;
    if (d.range) this.shoot(u, bx + 0.5, by + 0.5, bz + 0.5, 0);
    else u.swing();
    // tougher units knock more off
    const n = Math.max(1, Math.round(d.damage / 3));
    this.ov.damageBuilding(bs, u, n, b.block);
    b.block = null;
  }

  // ------------------------------------------------------------------------------------------------ working
  private inReach(u: UnitEntity, x: number, y: number, z: number) {
    return Math.hypot(x + 0.5 - u.x, z + 0.5 - u.z) <= 2.6 && y + 0.5 - u.y <= 4.6 && u.y - y <= 3;
  }
  /** Stand and work a block: swing now and then. True when `ticks` of work are done. */
  private workAt(u: UnitEntity, b: Brain, x: number, y: number, z: number, ticks: number) {
    const g = this.ov.game!;
    u.path = null;
    u.lookTarget = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
    u.yaw = (Math.atan2(z + 0.5 - u.z, x + 0.5 - u.x) * 180) / Math.PI - 90;
    b.work++;
    if (b.work % 8 === 1) {
      u.swing();
      const id = g.world!.getId(x, y, z);
      if (id) g.playBlockSound(id, x, y, z, 'hit');
    }
    if (b.work < ticks) return false;
    b.work = 0;
    return true;
  }

  private gather(u: UnitEntity, b: Brain, o: Order) {
    const g = this.ov.game!, w = g.world!, mc = this.ov.mod.mc;
    if (!u.def().worker) { this.go(u, b, o.x!, o.y!, o.z!, 2) && this.next(u, b); return; }
    const res = o.res!;
    const cap = res === 'wood' ? CARRY * 2 : CARRY;
    if (u.carry >= cap || (u.carry > 0 && u.carryRes !== res)) { this.toHome(u, b, o); return; }
    const kind = (x: number, y: number, z: number) => resourceOf(mc.BLOCKS[w.getId(x, y, z)]?.name ?? '');
    if (!b.block || kind(...b.block)?.res !== res) {
      b.block = this.findResource(u, o.x!, o.y!, o.z!, res);
      b.work = 0;
      if (!b.block) {
        if (u.carry > 0) { this.toHome(u, b, o); return; }
        u.task = `No ${res} left here`;
        this.next(u, b);
        return;
      }
    }
    const [x, y, z] = b.block;
    const r = kind(x, y, z)!;
    u.task = res === 'wood' ? 'Chopping wood' : res === 'ore' ? 'Mining' : 'Gathering food';
    u.heldItem = this.ov.toolFor(res);
    if (!this.inReach(u, x, y, z)) {
      // as close as it gets and still out of reach: try another block
      if (this.go(u, b, x + 0.5, y, z + 0.5, 1.2)) { b.skip.add(`${x},${y},${z}`); b.block = null; }
      b.work = 0;
      return;
    }
    // a whole trunk comes down at once (taking as long as its logs one by one)
    const list: [number, number, number][] = [[x, y, z]];
    if (res === 'wood') for (let k = 1; k < 14 && kind(x, y + k, z)?.res === 'wood'; k++) list.push([x, y + k, z]);
    if (!this.workAt(u, b, x, y, z, r.ticks * list.length)) return;
    g.interact!.destroyBlocks(list, { drops: 0, fx: 'break' });
    u.carry += r.amount * list.length;
    u.carryRes = res;
    o.x = x + 0.5; o.y = y; o.z = z + 0.5;
    b.block = null;
  }

  /** The nearest exposed block of a resource around a spot (not part of anyone's building). */
  private findResource(u: UnitEntity, ax: number, ay: number, az: number, res: Res): [number, number, number] | null {
    const w = this.ov.game!.world!, mc = this.ov.mod.mc, skip = brains.get(u)?.skip;
    const cx = Math.floor(ax), cy = Math.floor(ay), cz = Math.floor(az);
    let best: [number, number, number] | null = null, bd = Infinity;
    const open = (x: number, y: number, z: number) => !mc.BLOCKS[w.getId(x, y, z)].opaque;
    for (let dy = -4; dy <= 6; dy++)
      for (let dz = -SEARCH; dz <= SEARCH; dz++)
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          const x = cx + dx, y = cy + dy, z = cz + dz;
          const id = w.getId(x, y, z);
          if (!id) continue;
          const r = resourceOf(mc.BLOCKS[id].name);
          if (!r || r.res !== res) continue;
          if (!(open(x + 1, y, z) || open(x - 1, y, z) || open(x, y + 1, z) || open(x, y, z + 1) || open(x, y, z - 1))) continue;
          const d = Math.hypot(x + 0.5 - u.x, (y - u.y) * 1.5, z + 0.5 - u.z);
          if (d >= bd || this.ov.inBuilding(x, y, z) || skip?.has(`${x},${y},${z}`)) continue;
          bd = d; best = [x, y, z];
        }
    return best;
  }

  private farm(u: UnitEntity, b: Brain, o: Order) {
    const g = this.ov.game!, w = g.world!, mc = this.ov.mod.mc;
    const bs = this.ov.building(o.b!);
    if (!bs || !bs.built || bs.dim !== w.dimension) { this.next(u, b); return; }
    if (!u.def().worker) { this.next(u, b); return; }
    if (u.carry >= CARRY || (u.carry > 0 && u.carryRes !== 'food')) { this.toHome(u, b, o); return; }
    u.task = 'Farming';
    u.heldItem = this.ov.toolFor('farm');
    const crops = this.ov.cells(bs).filter((c) => c.c === 'Y');
    if (!crops.length) { this.next(u, b); return; }
    const age = (c: ACell) => { const v = w.get(c.x, c.y, c.z); return CROPS[mc.BLOCKS[mc.idOf(v)].name] !== undefined ? mc.metaOf(v) : -1; };
    if (!b.block || !crops.some((c) => c.x === b.block![0] && c.y === b.block![1] && c.z === b.block![2])) {
      // ripe ones first, then any (spread out by the unit's id); it stays on one crop until it's harvested
      const ripe = crops.filter((c) => age(c) >= 7);
      const pool = ripe.length ? ripe : crops;
      const pick = pool.slice().sort((a, c) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(c.x - u.x, c.z - u.z))[(u.id * 3 + g.ticks) % Math.min(pool.length, 4)];
      b.block = [pick.x, pick.y, pick.z];
      b.work = 0;
    }
    const [x, y, z] = b.block;
    if (Math.hypot(x + 0.5 - u.x, z + 0.5 - u.z) > 2.2 || Math.abs(y - u.y) > 2) {
      // can't get there: another crop
      if (this.go(u, b, x + 0.5, y, z + 0.5, 1.2)) b.block = null;
      return;
    }
    if (!this.workAt(u, b, x, y, z, 16)) return;
    const v = w.get(x, y, z), id = mc.idOf(v), name = mc.BLOCKS[id].name;
    if (CROPS[name] !== undefined) {
      const m = mc.metaOf(v);
      if (m >= 7) {
        w.set(x, y, z, mc.pack(id, 0));
        g.particles?.blockBreak(x, y, z, id);
        u.carry += CROPS[name];
        u.carryRes = 'food';
      } else w.set(x, y, z, mc.pack(id, Math.min(7, m + 1 + (Math.random() < 0.5 ? 1 : 0))));
      if (m >= 7) b.block = null;
    } else if (!id && mc.BLOCKS[w.getId(x, y - 1, z)].name === 'farmland') w.set(x, y, z, mc.B.WHEAT);
    else b.block = null;
  }

  private build(u: UnitEntity, b: Brain, o: Order) {
    const g = this.ov.game!;
    const bs = this.ov.building(o.b!);
    if (!bs || bs.dim !== g.world!.dimension) { this.next(u, b); return; }
    if (!u.def().worker) { this.next(u, b); return; }
    if (!this.ov.needsWork(bs)) {
      this.ov.complete(bs);
      if (bs.type === 'farm') this.start(u, b, { t: 'farm', b: bs.id });
      else this.next(u, b);
      return;
    }
    u.task = bs.built ? 'Repairing' : 'Building';
    u.heldItem = this.ov.toolFor('build');
    const [x0, z0, x1, z1] = rect(bs);
    const inside = u.x > x0 && u.x < x1 + 1 && u.z > z0 && u.z < z1 + 1;
    if (inside || distToRect(bs, u.x, u.z) > 2.5) {
      // stand just outside, on the near side (the door when inside or far)
      const dr = door(bs).out;
      const far = distToRect(bs, u.x, u.z) > 10;
      const tx = inside || far ? dr.x + 0.5 : Math.min(x1 + 1.5, Math.max(x0 - 0.5, u.x));
      const tz = inside || far ? dr.z + 0.5 : Math.min(z1 + 1.5, Math.max(z0 - 0.5, u.z));
      this.go(u, b, tx, bs.y + 1, tz, 0.8);
      return;
    }
    u.path = null;
    b.work++;
    if (b.work % 6 !== 0) return;
    const c = this.ov.buildStep(bs);
    if (c) {
      u.swing();
      u.lookTarget = { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 };
    }
  }

  // ------------------------------------------------------------------------------------------------ loads
  private toHome(u: UnitEntity, b: Brain, o: Order) {
    b.resume = o;
    b.order = { t: 'return' };
    b.goal = '';
    b.block = null;
    b.work = 0;
  }
  private goHome(u: UnitEntity, b: Brain) {
    if (u.carry <= 0) { const r = b.resume; b.resume = null; if (r) this.start(u, b, r); else this.next(u, b); return; }
    const drop = this.ov.nearestDropoff(u);
    u.task = `Carrying ${u.carry} ${u.carryRes}`;
    u.heldItem = this.ov.carryItem(u.carryRes);
    if (!drop) { u.task = 'Nowhere to take this'; return; }
    if (distToRect(drop, u.x, u.z) <= 1.8) {
      this.ov.deposit(u);
      const r = b.resume;
      b.resume = null;
      if (r) this.start(u, b, r);
      else this.next(u, b);
      return;
    }
    const dr = door(drop).out;
    this.go(u, b, dr.x + 0.5, dr.y, dr.z + 0.5, 1.2);
  }
}

/**
 * The launch angle that lands an arrow (1.6 blocks a tick, slowed 1% and pulled down 0.05 a tick, like the game's)
 * `dy` above or below a point `h` blocks away: a few steps of bisection over the flight.
 */
export function aimAngle(h: number, dy: number, speed: number) {
  const heightAt = (a: number) => {
    let x = 0, y = 0, vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
    for (let t = 0; t < 200 && x < h; t++) { x += vx; y += vy; vx *= 0.99; vy = vy * 0.99 - 0.05; }
    return x >= h ? y : -Infinity;
  };
  let lo = Math.atan2(dy, h) - 0.2, hi = Math.min(1.2, Math.atan2(dy, h) + 0.8);
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) / 2;
    if (heightAt(m) < dy) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

/** Is this cell a counted, still-standing part of the building? */
export function standing(ov: Overseer, bs: BState, c: ACell) {
  return counts(c) && cellOk(ov.mod.mc, ov.game!.world!, c);
}

/** Something hit a unit: soldiers turn on whoever did it. */
export function retaliate(ov: Overseer, br: Brains, u: UnitEntity, attacker: Entity | null) {
  const src = (attacker as unknown as { shooter?: Entity | null })?.shooter ?? attacker;
  if (!src || src === u) return;
  ov.alert(u.owner, 'Your units are under attack', u.x, u.z);
  const b = br.brain(u);
  // workers run; soldiers turn on whoever hit them
  if (u.def().worker && src instanceof ov.mod.mc.LivingEntity) { b.flee = { x: src.x, z: src.z, until: (ov.game?.ticks ?? 0) + 50 }; return; }
  if (u.def().aggro <= 0) return;
  if (b.order.t === 'idle' || b.order.t === 'amove' || b.order.t === 'siege' || (b.order.t === 'hold' && u.def().range)) {
    if (!b.fight && ov.isEnemy(u, src)) b.fight = src as unknown as Living;
  }
}
export type { Living };
