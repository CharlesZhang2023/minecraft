// Sub-levels on the server: assembling blocks into a moving structure and back, and the physics that moves them.
// Physics is Rapier (WebAssembly, loaded the first time a world has a sub-level): every sub-level is a rigid body
// made of its blocks (a voxel collider for full blocks, boxes for the rest), and the terrain around each one is
// added as voxel colliders a 16x16x16 section at a time, rebuilt when blocks there change. Mods push sub-levels with
// forces (propellers, balloons...) from the `subLevelTick` event, once a tick before the step.
import type { Game, Dim } from '../game/game';
import type { World } from '../world/world';
import { SubLevel } from './ship';
import { BLOCKS, B, idOf, metaOf, pack, CHUNK_H } from '../world/blocks';
import { collisionShapes } from '../world/models';
import { rotateBlock } from '../agent/blockspec';
import { plotAt, plotCenter, isShipyardX, MAX_SPAN } from './shipyard';
import { type Pose, type Quat, type Vec3, toWorld, qaxis, qyaw, qtilt, qrot, dirToWorld, QI } from './pose';
import { leaveShip } from './collide';
import { Events } from '../mod/events';

type RapierModule = typeof import('@dimforge/rapier3d-compat').default;
type RWorld = InstanceType<RapierModule['World']>;
type RBody = InstanceType<RapierModule['RigidBody']>;
type RCollider = InstanceType<RapierModule['Collider']>;

let RAPIER: RapierModule | null = null;
let loading: Promise<void> | null = null;
let loadError = '';
/** Start loading the physics engine (once); resolves when it's ready. */
export function loadPhysics(): Promise<void> {
  loading ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const R = m.default;
    await R.init();
    RAPIER = R;
  }).catch((e) => { loadError = String((e as Error)?.message ?? e); console.error('physics engine failed to load', e); });
  return loading;
}
export const physicsReady = () => !!RAPIER;

// ------------------------------------------------------------------ physical properties of blocks
/** What a block weighs and how it behaves in a collision. Mass in kpg: a plain block is 1. */
export interface BlockPhysics {
  mass: number;
  friction: number;
  restitution: number;
  /** how much water it displaces (1 = a full block) */
  volume: number;
}
const PROPS = new Map<number, Partial<BlockPhysics>>();
const cache = new Map<number, BlockPhysics>();
/** Set a block's physical properties (mods: for their own blocks). */
export function setBlockPhysics(id: number, p: Partial<BlockPhysics>) {
  PROPS.set(id, { ...PROPS.get(id), ...p });
  cache.delete(id);
}
export function blockPhysics(v: number): BlockPhysics {
  const id = idOf(v);
  let p = cache.get(id);
  if (!p) {
    const def = BLOCKS[id], n = def?.name ?? '';
    // by kind, the way Sable's tags do it: light things (wood, wool), heavy ones (stone, metal)
    let mass = 1, friction = 0.6, restitution = 0, volume = 1;
    if (!def || id === 0) mass = volume = 0;
    else if (def.fluid) { mass = 0; volume = 0; }
    else if (/wool|carpet|envelope|web|leaves|sponge|hay/.test(n)) mass = 0.25;
    else if (/plank|log|wood|fence|door|trapdoor|ladder|sign|chest|crafting|bookshelf|barrel|bed|wheel|propeller|helm/.test(n)) mass = 0.5;
    else if (/glass|ice|torch|lever|button|rail|flower|sapling|grass$|tallgrass|fern|mushroom|redstone_dust|wire|carrot|wheat|potato|reeds|vine/.test(n)) mass = 0.3;
    else if (/iron|gold|diamond|emerald|anvil|lapis_block|redstone_block|beacon|cauldron/.test(n)) mass = 4;
    else if (/stone|cobble|brick|ore|obsidian|sandstone|quartz|prismarine|netherrack|end_stone|furnace|dispenser|dropper|piston|terracotta|clay|concrete/.test(n)) mass = 2;
    else if (/dirt|sand|gravel|grass|farmland|mycelium|podzol|snow|soul/.test(n)) mass = 1.5;
    if (/slab/.test(n)) { mass *= 0.5; volume = 0.5; }
    if (/ice/.test(n)) friction = 0.02;
    if (/slime/.test(n)) restitution = 0.8;
    if (!def?.solid) volume = 0;
    p = { mass, friction, restitution, volume, ...PROPS.get(id) };
    cache.set(id, p);
  }
  return p;
}

// ------------------------------------------------------------------ settings
export const PHYS = {
  /** m/s^2 (Sable's default) */
  gravity: 11,
  /** drag on all motion (per second) */
  linearDamping: 0.09,
  angularDamping: 0.6,
  /** air resistance: force per square metre of cross-section per (m/s)^2 */
  airDrag: 0.3,
  /** water: what a block's worth of it weighs (kpg), and the extra drag in it */
  waterDensity: 1,
  waterDrag: 0.8,
  substeps: 3,
  maxBlocks: 6000,
};

/** Air pressure (1 at sea level, thinner going up, none above the build limit): balloons lose lift with height. */
export function airPressure(y: number): number {
  if (y >= 320) return 0;
  const p = Math.exp(-(y - 63) * 0.004);
  return Math.min(1.5, y > 280 ? p * (320 - y) / 40 : p);
}

// ------------------------------------------------------------------ per sub-level and per dimension
interface Body {
  body: RBody;
  colliders: RCollider[];
  dirty: boolean;
  /** local block centres with mass and volume, for buoyancy: x, y, z, mass, volume */
  cells: Float32Array;
  waiting: boolean;
  /** this tick's pushes from mods: world force at world point */
  forces: number[];
  torques: number[];
}
interface Section { colliders: RCollider[]; dirty: boolean; used: number }
interface Space { world: RWorld; bodies: Map<SubLevel, Body>; sections: Map<string, Section>; tick: number }

export interface AssembleResult { ship?: SubLevel; error?: string }

/** The server's sub-levels: one per Game. */
export class SubLevels {
  private spaces = new Map<Dim, Space>();
  constructor(private game: Game) {}

  /** Every sub-level in a dimension (the one being simulated by default). */
  list(dim: Dim | null = this.game.dim): SubLevel[] {
    return dim ? dim.world.ships : [];
  }
  get(id: number): SubLevel | null {
    for (const d of this.game.dims.values()) for (const s of d.world.ships) if (s.id === id) return s;
    return null;
  }
  /** The sub-level whose plot holds this (shipyard) block. */
  containing(x: number, _y: number, z: number, w: World | null = this.game.world): SubLevel | null {
    if (!w || !isShipyardX(x)) return null;
    const plot = plotAt(Math.floor(x), Math.floor(z));
    return w.ships.find((s) => s.plot === plot && !s.removed) ?? null;
  }
  /** Where a point is in the world: shipyard points are mapped through their sub-level's pose. */
  worldPos(x: number, y: number, z: number, w: World | null = this.game.world): Vec3 {
    const s = this.containing(x, y, z, w);
    return s ? s.toWorld(x, y, z) : { x, y, z };
  }

  // ------------------------------------------------------------------ forces (from mods, during subLevelTick)
  /** Push with a force (kpg*m/s^2, world directions) at a world point, for this tick. */
  applyForce(s: SubLevel, fx: number, fy: number, fz: number, px = s.x, py = s.y, pz = s.z) {
    const b = this.bodyOf(s);
    if (!b || ![fx, fy, fz, px, py, pz].every(Number.isFinite)) return;
    b.forces.push(fx, fy, fz, px, py, pz);
  }
  /** Push with a force in the sub-level's own directions, at one of its (local) points: a propeller's thrust. */
  applyLocalForce(s: SubLevel, fx: number, fy: number, fz: number, lx: number, ly: number, lz: number) {
    const f = dirToWorld(s.pose(), fx, fy, fz), p = s.toWorld(lx, ly, lz);
    this.applyForce(s, f.x, f.y, f.z, p.x, p.y, p.z);
  }
  /** Twist (world axis, kpg*m^2/s^2), for this tick. */
  applyTorque(s: SubLevel, tx: number, ty: number, tz: number) {
    const b = this.bodyOf(s);
    if (!b || ![tx, ty, tz].every(Number.isFinite)) return;
    b.torques.push(tx, ty, tz);
  }
  /** How fast a world point of the sub-level moves (m/s). */
  velocityAt(s: SubLevel, px: number, py: number, pz: number): Vec3 {
    const [vx, vy, vz] = s.lin, [wx, wy, wz] = s.ang;
    const rx = px - s.x, ry = py - s.y, rz = pz - s.z;
    return { x: vx + wy * rz - wz * ry, y: vy + wz * rx - wx * rz, z: vz + wx * ry - wy * rx };
  }
  /** Set its motion outright (m/s, rad/s). */
  setVelocity(s: SubLevel, lin: [number, number, number] | null, ang: [number, number, number] | null = null) {
    const b = this.bodyOf(s);
    if (lin && lin.every(Number.isFinite)) { s.lin = [...lin]; b?.body.setLinvel({ x: lin[0], y: lin[1], z: lin[2] }, true); }
    if (ang && ang.every(Number.isFinite)) { s.ang = [...ang]; b?.body.setAngvel({ x: ang[0], y: ang[1], z: ang[2] }, true); }
  }
  /** Move it somewhere (and turn it), keeping its motion unless `stop`. */
  teleport(s: SubLevel, x: number, y: number, z: number, q: Quat | null = null, stop = true) {
    s.setPos(x, y, z);
    if (q) { s.q = q; s.pqx = q.x; s.pqy = q.y; s.pqz = q.z; s.pqw = q.w; }
    const b = this.bodyOf(s);
    if (b) {
      b.body.setTranslation({ x, y, z }, true);
      if (q) b.body.setRotation(q, true);
      if (stop) { b.body.setLinvel({ x: 0, y: 0, z: 0 }, true); b.body.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    }
    if (stop) { s.lin = [0, 0, 0]; s.ang = [0, 0, 0]; }
  }
  /** Hold it still (or let it go). */
  anchor(s: SubLevel, on: boolean) {
    s.anchored = on;
    const b = this.bodyOf(s);
    if (b) this.setFrozen(b, on, s);
    if (on) { s.lin = [0, 0, 0]; s.ang = [0, 0, 0]; }
  }
  /** Its blocks changed in a way the physics should know about now (mods: after editing it directly). */
  markDirty(s: SubLevel) {
    const b = this.bodyOf(s);
    if (b) b.dirty = true;
  }

  private bodyOf(s: SubLevel): Body | undefined {
    for (const sp of this.spaces.values()) { const b = sp.bodies.get(s); if (b) return b; }
    return undefined;
  }

  // ------------------------------------------------------------------ assembling
  /**
   * Turn these world blocks into a sub-level: they move to a new plot in the shipyard and from now on appear where
   * its pose puts them (at first, exactly where they were).
   */
  assemble(cells: [number, number, number][], opts: { owner?: string; label?: string; anchor?: [number, number, number] } = {}): AssembleResult {
    const g = this.game, w = g.world, dim = g.dim;
    if (!w || !dim || !g.meta) return { error: 'no world' };
    if (!cells.length) return { error: 'nothing to assemble' };
    if (cells.length > PHYS.maxBlocks) return { error: `too big: ${cells.length} blocks (at most ${PHYS.maxBlocks})` };
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const [x, y, z] of cells) {
      if (isShipyardX(x)) return { error: 'already part of a sub-level' };
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
    }
    if (x1 - x0 >= MAX_SPAN || z1 - z0 >= MAX_SPAN) return { error: 'too wide' };
    const plot = g.meta.plots ?? 0;
    const pc = plotCenter(plot);
    const [ax, , az] = opts.anchor ?? [Math.round((x0 + x1) / 2), 0, Math.round((z0 + z1) / 2)];
    const sx = pc.x - ax, sz = pc.z - az;
    // the plot's chunks, made ready (empty) now
    for (let cx = ((x0 + sx) >> 4) - 1; cx <= ((x1 + sx) >> 4) + 1; cx++)
      for (let cz = ((z0 + sz) >> 4) - 1; cz <= ((z1 + sz) >> 4) + 1; cz++)
        if (!w.ensureVoid(cx, cz)) return { error: 'the shipyard is still loading: try again' };
    g.meta.plots = plot + 1;
    // mass and its centre: the pivot
    let m = 0, mx = 0, my = 0, mz = 0, n = 0;
    for (const [x, y, z] of cells) {
      const v = w.get(x, y, z);
      if (!v) continue;
      const bm = Math.max(0.05, blockPhysics(v).mass);
      m += bm; mx += (x + 0.5) * bm; my += (y + 0.5) * bm; mz += (z + 0.5) * bm; n++;
    }
    if (!n) return { error: 'nothing to assemble' };
    // move the blocks: copied into the plot first, then taken out of the world, without block updates in between
    const ticker = dim.ticker, was = ticker.suppress;
    ticker.suppress = true;
    const inSet = new Set(cells.map(([x, y, z]) => x + ',' + y + ',' + z));
    try {
      for (const [x, y, z] of cells) {
        const v = w.get(x, y, z);
        if (!v) continue;
        const t = w.getTile(x, y, z);
        w.set(x + sx, y, z + sz, v);
        if (t) w.setTile(x + sx, y, z + sz, t);
      }
      for (const [x, y, z] of cells) { w.setTile(x, y, z, undefined); w.set(x, y, z, B.AIR); }
    } finally {
      ticker.suppress = was;
    }
    // the world around the hole notices (water flows in, sand falls)
    for (const [x, y, z] of cells)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
        if (!inSet.has(x + dx + ',' + (y + dy) + ',' + (z + dz))) ticker.neighborChanged(x + dx, y + dy, z + dz);
    const s = new SubLevel(w, g);
    s.plot = plot;
    s.lx = mx / m + sx; s.ly = my / m; s.lz = mz / m + sz;
    s.setPos(mx / m, my / m, mz / m);
    s.q = QI; s.pqx = s.pqy = s.pqz = 0; s.pqw = 1;
    s.bounds = [x0 + sx, y0, z0 + sz, x1 + sx, y1, z1 + sz];
    s.blockCount = n;
    s.mass = m;
    s.owner = opts.owner ?? '';
    s.label = opts.label ?? '';
    g.addEntity(s);
    w.ships = [...w.ships, s];
    void loadPhysics();
    return { ship: s };
  }

  /**
   * Put a sub-level's blocks back into the world, turned to the nearest quarter turn. Fails (with why) if it's
   * tilted too far or something is in the way.
   */
  disassemble(s: SubLevel, opts: { force?: boolean } = {}): string | null {
    const g = this.game, w = s.world, dim = [...g.dims.values()].find((d) => d.world === w);
    if (!dim) return 'not loaded';
    const p = s.pose();
    if (!opts.force && qtilt(p.q) > (25 * Math.PI) / 180) return 'it has to be level to land';
    // quarter turns about +y (counter-clockwise seen from above; the game's yaw counts the other way)
    const turns = ((Math.round(-qyaw(p.q) / 90) % 4) + 4) % 4;
    const snapped: Pose = { ...p, q: qaxis(0, 1, 0, (turns * Math.PI) / 2) };
    const [bx0, by0, bz0, bx1, by1, bz1] = s.bounds;
    // where each block goes: one reference block's spot, the rest by whole-block offsets turned with it
    const ref = toWorld(snapped, bx0 + 0.5, by0 + 0.5, bz0 + 0.5);
    const rx = Math.floor(ref.x), ry = Math.floor(ref.y), rz = Math.floor(ref.z);
    const rot = (dx: number, dz: number): [number, number] => {
      const r = qrot(snapped.q, dx, 0, dz);
      return [Math.round(r.x), Math.round(r.z)];
    };
    const moves: [number, number, number, number, number, number, number][] = [];
    for (let x = bx0; x <= bx1; x++)
      for (let y = by0; y <= by1; y++)
        for (let z = bz0; z <= bz1; z++) {
          const v = w.get(x, y, z);
          if (!v) continue;
          const [ox, oz] = rot(x - bx0, z - bz0);
          const tx = rx + ox, ty = ry + (y - by0), tz = rz + oz;
          if (ty < 0 || ty >= CHUNK_H) return 'it would stick out of the world';
          if (!w.chunkAt(tx, tz)) return 'the ground there isn\'t loaded';
          const there = w.get(tx, ty, tz), def = BLOCKS[idOf(there)];
          if (!opts.force && there && !def.replaceable && !def.fluid) return `something is in the way at ${tx} ${ty} ${tz}`;
          moves.push([x, y, z, tx, ty, tz, v]);
        }
    const ticker = dim.ticker, was = ticker.suppress;
    ticker.suppress = true;
    try {
      for (const [x, y, z, tx, ty, tz, v] of moves) {
        const t = w.getTile(x, y, z);
        w.set(tx, ty, tz, turnBlock(v, (4 - turns) % 4));
        if (t) w.setTile(tx, ty, tz, t);
      }
      for (const [x, y, z] of moves) { w.setTile(x, y, z, undefined); w.set(x, y, z, B.AIR); }
    } finally {
      ticker.suppress = was;
    }
    for (const [, , , tx, ty, tz] of moves) ticker.neighborChanged(tx, ty, tz);
    this.remove(s);
    return null;
  }

  /** Take a sub-level away (its blocks stay in its plot, unused). */
  remove(s: SubLevel) {
    s.removed = true;
    s.world.ships = s.world.ships.filter((o) => o !== s);
    for (const sp of this.spaces.values()) {
      const b = sp.bodies.get(s);
      if (b) { sp.world.removeRigidBody(b.body); sp.bodies.delete(s); }
    }
    for (const e of [...this.game.dims.values()].flatMap((d) => d.entities)) leaveShipIf(e, s);
  }

  // ------------------------------------------------------------------ every tick
  /** Where shipyard chunks must stay loaded in a dimension (plots of sub-levels near players). */
  centers(dim: Dim): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    const ps = this.game.players.filter((p) => p.dim === dim.world.dimension).map((p) => p.entity);
    const far = (this.game.simDistance + 3) * 16;
    for (const s of dim.world.ships) {
      if (!ps.some((p) => Math.abs(p.x - s.x) < far + s.radius() && Math.abs(p.z - s.z) < far + s.radius())) continue;
      const c = s.plotChunks();
      const r = Math.ceil(Math.max(c.cx1 - c.cx0, c.cz1 - c.cz0) / 2 * 1.42);
      out.push({ x: ((c.cx0 + c.cx1) / 2) * 16 + 8, z: ((c.cz0 + c.cz1) / 2) * 16 + 8, r });
    }
    return out;
  }

  /** Before the dimension's entities tick: find the sub-levels, push them and step the physics. */
  tick(dim: Dim) {
    const w = dim.world;
    const ships = dim.entities.filter((e): e is SubLevel => e instanceof SubLevel && !e.removed);
    if (ships.length !== w.ships.length || ships.some((s, i) => s !== w.ships[i])) w.ships = ships;
    this.kick(dim);
    if (!ships.length) { this.dropSpace(dim); return; }
    void loadPhysics();
    if (!RAPIER) {
      for (const s of ships) this.hold(s);
      return;
    }
    const sp = this.space(dim);
    sp.tick++;
    // bodies for new sub-levels, none for gone ones
    for (const [s, b] of sp.bodies) if (!ships.includes(s)) { sp.world.removeRigidBody(b.body); sp.bodies.delete(s); }
    // (a sub-level's blocks have to be loaded before it has a shape)
    const live = ships.filter((s) => sp.bodies.has(s) || (plotReady(w, s) && this.addBody(sp, s)));
    for (const s of ships) if (!live.includes(s)) this.hold(s);
    const dt = 1 / 20;
    for (const s of live) {
      const b = sp.bodies.get(s)!;
      if (b.dirty && plotReady(w, s)) this.rebuild(sp, s, b);
      if (s.removed) continue;
      // the terrain it could touch this tick has to be there (and loaded), or it waits where it is
      const ready = !s.anchored && this.terrainAround(sp, w, s, b);
      this.setFrozen(b, !ready, s);
      b.forces.length = 0;
      b.torques.length = 0;
    }
    // mods push (propellers, balloons, controllers)
    const moving = live.filter((s) => !s.removed && !sp.bodies.get(s)!.waiting);
    if (Events.subLevelTick.any) for (const s of moving) Events.subLevelTick.fire({ game: this.game, ship: s, dt });
    for (const s of moving) {
      const b = sp.bodies.get(s);
      if (!b) continue;
      const body = b.body;
      body.resetForces(false);
      body.resetTorques(false);
      this.water(w, s, b);
      this.air(s, b);
      const f = b.forces, t = b.torques;
      let wake = false;
      for (let i = 0; i < f.length; i += 6) { body.addForceAtPoint({ x: f[i], y: f[i + 1], z: f[i + 2] }, { x: f[i + 3], y: f[i + 4], z: f[i + 5] }, false); wake = true; }
      for (let i = 0; i < t.length; i += 3) { body.addTorque({ x: t[i], y: t[i + 1], z: t[i + 2] }, false); wake = true; }
      if (wake) body.wakeUp();
    }
    sp.world.timestep = dt / PHYS.substeps;
    for (let i = 0; i < PHYS.substeps; i++) sp.world.step();
    for (const s of live) {
      const b = sp.bodies.get(s);
      s.px = s.x; s.py = s.y; s.pz = s.z;
      s.pqx = s.qx; s.pqy = s.qy; s.pqz = s.qz; s.pqw = s.qw;
      if (!b || b.waiting) continue;
      const t = b.body.translation(), r = b.body.rotation(), v = b.body.linvel(), a = b.body.angvel();
      if (![t.x, t.y, t.z, r.x, r.y, r.z, r.w].every(Number.isFinite)) { this.teleport(s, s.x, s.y + 1, s.z, QI); continue; }
      s.x = t.x; s.y = t.y; s.z = t.z;
      s.qx = r.x; s.qy = r.y; s.qz = r.z; s.qw = r.w;
      s.lin = [v.x, v.y, v.z];
      s.ang = [a.x, a.y, a.z];
      // fell out of the world: it's gone
      if (s.y < -128) this.remove(s);
    }
    // terrain no sub-level has needed for a while goes
    if (sp.tick % 100 === 0) {
      for (const [k, sec] of sp.sections) if (sp.tick - sec.used > 200) { for (const c of sec.colliders) sp.world.removeCollider(c, false); sp.sections.delete(k); }
    }
  }

  /** After the entities ticked: anything that turned up in the shipyard (dropped by a block broken there...). */
  afterTick(dim: Dim) {
    this.kick(dim);
  }

  /** Sable's "kicking": entities in a plot are moved out to where that point of the sub-level is in the world. */
  private kick(dim: Dim) {
    for (const e of dim.entities) {
      if (!isShipyardX(e.x) || e instanceof SubLevel) continue;
      const s = this.containing(e.x, e.y, e.z, dim.world);
      if (!s) { if (!(e as { sp?: unknown }).sp) e.removed = true; continue; }
      const p = s.toWorld(e.x, e.y, e.z);
      const v = dirToWorld(s.pose(), e.vx, e.vy, e.vz);
      const sv = this.velocityAt(s, p.x, p.y, p.z);
      e.x = e.px = p.x; e.y = e.py = p.y; e.z = e.pz = p.z;
      e.vx = v.x + sv.x / 20; e.vy = v.y + sv.y / 20; e.vz = v.z + sv.z / 20;
    }
  }

  /** A block changed somewhere: the sub-level or the terrain it's in gets rebuilt. */
  blockChanged(dim: Dim, x: number, y: number, z: number) {
    const sp = this.spaces.get(dim);
    if (isShipyardX(x)) {
      const s = this.containing(x, y, z, dim.world);
      if (!s) return;
      // grow the bounds to take in new blocks
      const b = s.bounds;
      if (x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5]) {
        s.bounds = [Math.min(b[0], x), Math.min(b[1], y), Math.min(b[2], z), Math.max(b[3], x), Math.max(b[4], y), Math.max(b[5], z)];
      }
      const body = sp?.bodies.get(s);
      if (body) body.dirty = true;
      return;
    }
    if (!sp) return;
    const sec = sp.sections.get(secKey(x >> 4, y >> 4, z >> 4));
    if (sec) sec.dirty = true;
    // a block on a section's edge changes how its neighbours' voxels join up: rebuild those too
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = sp.sections.get(secKey((x + dx) >> 4, (y + dy) >> 4, (z + dz) >> 4));
      if (n) n.dirty = true;
    }
  }

  // ------------------------------------------------------------------ physics internals
  private space(dim: Dim): Space {
    let sp = this.spaces.get(dim);
    if (!sp) {
      const R = RAPIER!;
      const world = new R.World({ x: 0, y: -PHYS.gravity, z: 0 });
      world.integrationParameters.numSolverIterations = 6;
      sp = { world, bodies: new Map(), sections: new Map(), tick: 0 };
      this.spaces.set(dim, sp);
    }
    return sp;
  }
  private dropSpace(dim: Dim) {
    const sp = this.spaces.get(dim);
    if (!sp) return;
    sp.world.free();
    this.spaces.delete(dim);
  }
  /** A dimension was unloaded: its physics goes with it. */
  forget(dim: Dim) {
    this.dropSpace(dim);
  }
  /** Forget everything (the world closed). */
  dispose() {
    for (const d of [...this.spaces.keys()]) this.dropSpace(d);
  }

  /** Not simulated this tick: stays exactly where it is. */
  private hold(s: SubLevel) {
    s.px = s.x; s.py = s.y; s.pz = s.z;
    s.pqx = s.qx; s.pqy = s.qy; s.pqz = s.qz; s.pqw = s.qw;
  }

  private addBody(sp: Space, s: SubLevel): boolean {
    const R = RAPIER!;
    const desc = R.RigidBodyDesc.dynamic().setTranslation(s.x, s.y, s.z).setRotation(s.q)
      .setLinvel(s.lin[0], s.lin[1], s.lin[2]).setAngvel({ x: s.ang[0], y: s.ang[1], z: s.ang[2] })
      .setLinearDamping(PHYS.linearDamping).setAngularDamping(PHYS.angularDamping).setCcdEnabled(true).setCanSleep(true);
    const body = sp.world.createRigidBody(desc);
    const b: Body = { body, colliders: [], dirty: true, cells: new Float32Array(0), waiting: false, forces: [], torques: [] };
    sp.bodies.set(s, b);
    this.rebuild(sp, s, b);
    return true;
  }

  /** The body's shape and mass from its blocks (after any change to them). */
  private rebuild(sp: Space, s: SubLevel, b: Body) {
    const R = RAPIER!, w = s.world;
    b.dirty = false;
    for (const c of b.colliders) sp.world.removeCollider(c, false);
    b.colliders = [];
    const [x0, y0, z0, x1, y1, z1] = s.bounds;
    const vox: number[] = [], cells: number[] = [];
    let m = 0, cx = 0, cy = 0, cz = 0, n = 0;
    // inertia about the pivot: sum of m * (r.r I - r r^T) plus each block's own (m/6 for a unit cube)
    let ixx = 0, iyy = 0, izz = 0;
    let nx0 = Infinity, ny0 = Infinity, nz0 = Infinity, nx1 = -Infinity, ny1 = -Infinity, nz1 = -Infinity;
    const boxes: [number, number, number, number, number, number, number, number][] = [];
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const v = w.get(x, y, z);
          if (!v) continue;
          n++;
          nx0 = Math.min(nx0, x); ny0 = Math.min(ny0, y); nz0 = Math.min(nz0, z); nx1 = Math.max(nx1, x); ny1 = Math.max(ny1, y); nz1 = Math.max(nz1, z);
          const ph = blockPhysics(v);
          const bm = ph.mass;
          const rx = x + 0.5 - s.lx, ry = y + 0.5 - s.ly, rz = z + 0.5 - s.lz;
          if (bm > 0) {
            m += bm; cx += rx * bm; cy += ry * bm; cz += rz * bm;
            ixx += bm * (ry * ry + rz * rz + 1 / 6); iyy += bm * (rx * rx + rz * rz + 1 / 6); izz += bm * (rx * rx + ry * ry + 1 / 6);
          }
          if (ph.volume > 0 || bm > 0) cells.push(x + 0.5, y + 0.5, z + 0.5, bm, ph.volume);
          const def = BLOCKS[idOf(v)];
          if (!def.solid) continue;
          const shapes = collisionShapes(v, (dx, dy, dz) => w.get(x + dx, y + dy, z + dz));
          const sh = shapes[0];
          if (shapes.length === 1 && sh.x0 === 0 && sh.y0 === 0 && sh.z0 === 0 && sh.x1 === 1 && sh.y1 === 1 && sh.z1 === 1 && ph.friction === 0.6 && ph.restitution === 0) vox.push(x - x0, y - y0, z - z0);
          else for (const q of shapes) boxes.push([x + q.x0 - s.lx, y + q.y0 - s.ly, z + q.z0 - s.lz, x + q.x1 - s.lx, y + q.y1 - s.ly, z + q.z1 - s.lz, ph.friction, ph.restitution]);
        }
    if (n) s.bounds = [nx0, ny0, nz0, nx1, ny1, nz1];
    s.blockCount = n;
    s.mass = m;
    b.cells = Float32Array.from(cells);
    if (!n) { this.remove(s); return; }
    if (vox.length) {
      const d = R.ColliderDesc.voxels(new Int32Array(vox), { x: 1, y: 1, z: 1 }).setTranslation(x0 - s.lx, y0 - s.ly, z0 - s.lz).setDensity(0).setFriction(0.6);
      b.colliders.push(sp.world.createCollider(d, b.body));
    }
    for (const [ax, ay, az, bx, by, bz, fr, re] of boxes) {
      const hx = Math.max(0.01, (bx - ax) / 2), hy = Math.max(0.01, (by - ay) / 2), hz = Math.max(0.01, (bz - az) / 2);
      const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2).setDensity(0).setFriction(fr).setRestitution(re);
      b.colliders.push(sp.world.createCollider(d, b.body));
    }
    // mass: at least a little, so an empty frame still behaves
    const mass = Math.max(0.5, m);
    const com = m > 0 ? { x: cx / m, y: cy / m, z: cz / m } : { x: 0, y: 0, z: 0 };
    // move the inertia from the pivot to the centre of mass (diagonal only: good enough for blocks)
    const c2 = com.x * com.x + com.y * com.y + com.z * com.z;
    const inertia = { x: Math.max(0.1, ixx - mass * (c2 - com.x * com.x)), y: Math.max(0.1, iyy - mass * (c2 - com.y * com.y)), z: Math.max(0.1, izz - mass * (c2 - com.z * com.z)) };
    b.body.setAdditionalMassProperties(mass, com, inertia, QI, true);
    b.body.wakeUp();
  }

  private setFrozen(b: Body, frozen: boolean, s: SubLevel) {
    if (b.waiting === frozen) return;
    b.waiting = frozen;
    b.body.setEnabled(!frozen);
    if (frozen) this.hold(s);
    else b.body.wakeUp();
  }

  /** Terrain colliders around a sub-level's next position; false if some of that ground isn't loaded. */
  private terrainAround(sp: Space, w: World, s: SubLevel, b: Body): boolean {
    const p = s.pose();
    const [x0, y0, z0, x1, y1, z1] = s.bounds;
    let ax0 = Infinity, ay0 = Infinity, az0 = Infinity, ax1 = -Infinity, ay1 = -Infinity, az1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = toWorld(p, i & 1 ? x1 + 1 : x0, i & 2 ? y1 + 1 : y0, i & 4 ? z1 + 1 : z0);
      ax0 = Math.min(ax0, c.x); ay0 = Math.min(ay0, c.y); az0 = Math.min(az0, c.z);
      ax1 = Math.max(ax1, c.x); ay1 = Math.max(ay1, c.y); az1 = Math.max(az1, c.z);
    }
    // how far it can get in a tick, and a block more
    const reach = 1.5 + Math.hypot(s.lin[0], s.lin[1], s.lin[2]) / 20 + Math.hypot(s.ang[0], s.ang[1], s.ang[2]) / 20 * s.radius();
    const sx0 = Math.floor((ax0 - reach) / 16), sx1 = Math.floor((ax1 + reach) / 16);
    const sz0 = Math.floor((az0 - reach) / 16), sz1 = Math.floor((az1 + reach) / 16);
    const sy0 = Math.max(0, Math.floor((ay0 - reach) / 16)), sy1 = Math.min(15, Math.floor((ay1 + reach) / 16));
    if ((sx1 - sx0 + 1) * (sz1 - sz0 + 1) > 400) return false; // flung impossibly fast: hold it
    for (let cx = sx0; cx <= sx1; cx++)
      for (let cz = sz0; cz <= sz1; cz++) {
        if (!w.chunkAt(cx * 16, cz * 16)) return false;
        if (ay1 + reach < 0 || ay0 - reach > 255) continue;
        for (let sy = sy0; sy <= sy1; sy++) {
          const k = secKey(cx, sy, cz);
          let sec = sp.sections.get(k);
          if (!sec) { sec = { colliders: [], dirty: true, used: sp.tick }; sp.sections.set(k, sec); }
          sec.used = sp.tick;
          if (sec.dirty) this.buildSection(sp, w, cx, sy, cz, sec);
        }
      }
    void b;
    return true;
  }

  private buildSection(sp: Space, w: World, cx: number, sy: number, cz: number, sec: Section) {
    const R = RAPIER!;
    sec.dirty = false;
    for (const c of sec.colliders) sp.world.removeCollider(c, false);
    sec.colliders = [];
    const vox: number[] = [];
    const bx = cx * 16, by = sy * 16, bz = cz * 16;
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const v = w.get(bx + x, by + y, bz + z);
          if (!v) continue;
          const def = BLOCKS[idOf(v)];
          if (!def.solid) continue;
          const shapes = collisionShapes(v, (dx, dy, dz) => w.get(bx + x + dx, by + y + dy, bz + z + dz));
          const sh = shapes[0];
          if (shapes.length === 1 && sh.x0 === 0 && sh.y0 === 0 && sh.z0 === 0 && sh.x1 === 1 && sh.y1 === 1 && sh.z1 === 1) {
            // a block buried on every side can't be touched
            if (BLOCKS[w.getId(bx + x + 1, by + y, bz + z)].opaque && BLOCKS[w.getId(bx + x - 1, by + y, bz + z)].opaque && BLOCKS[w.getId(bx + x, by + y + 1, bz + z)].opaque
              && BLOCKS[w.getId(bx + x, by + y - 1, bz + z)].opaque && BLOCKS[w.getId(bx + x, by + y, bz + z + 1)].opaque && BLOCKS[w.getId(bx + x, by + y, bz + z - 1)].opaque) {
              vox.push(x, y, z); // still a voxel (so faces between voxels stay inside), cheap anyway
              continue;
            }
            vox.push(x, y, z);
          } else {
            const ph = blockPhysics(v);
            for (const q of shapes) {
              const d = R.ColliderDesc.cuboid(Math.max(0.01, (q.x1 - q.x0) / 2), Math.max(0.01, (q.y1 - q.y0) / 2), Math.max(0.01, (q.z1 - q.z0) / 2))
                .setTranslation(bx + x + (q.x0 + q.x1) / 2, by + y + (q.y0 + q.y1) / 2, bz + z + (q.z0 + q.z1) / 2).setFriction(ph.friction).setRestitution(ph.restitution);
              sec.colliders.push(sp.world.createCollider(d));
            }
          }
        }
    if (vox.length) sec.colliders.push(sp.world.createCollider(R.ColliderDesc.voxels(new Int32Array(vox), { x: 1, y: 1, z: 1 }).setTranslation(bx, by, bz).setFriction(0.7)));
  }

  /**
   * Air resistance, growing with the square of the speed, against the sub-level's cross-section along each of its
   * own axes (a long, narrow ship slips forward more easily than sideways), weaker where the air is thin.
   */
  private air(s: SubLevel, b: Body) {
    const [vx, vy, vz] = s.lin;
    if (vx * vx + vy * vy + vz * vz < 0.01) return;
    const p = s.pose(), v = qrot({ x: -p.q.x, y: -p.q.y, z: -p.q.z, w: p.q.w }, vx, vy, vz);
    const [x0, y0, z0, x1, y1, z1] = s.bounds;
    const sx = x1 - x0 + 1, sy = y1 - y0 + 1, sz = z1 - z0 + 1;
    const k = PHYS.airDrag * 0.6 * airPressure(s.y);
    const f = dirToWorld(p, -k * sy * sz * v.x * Math.abs(v.x), -k * sx * sz * v.y * Math.abs(v.y), -k * sx * sy * v.z * Math.abs(v.z));
    const c = b.body.worldCom();
    b.forces.push(f.x, f.y, f.z, c.x, c.y, c.z);
  }

  /** Floating: each block under water is pushed up by the water it displaces, and dragged. */
  private water(w: World, s: SubLevel, b: Body) {
    const c = b.cells, p = s.pose();
    if (!c.length) return;
    // quick test: is any water near at all?
    const r = s.radius();
    let any = false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      for (let dy = -r; dy <= r; dy += 2) if (BLOCKS[w.getId(Math.floor(s.x + dx), Math.floor(s.y + dy), Math.floor(s.z + dz))].fluid) { any = true; break; }
      if (any) break;
    }
    if (!any) return;
    const step = Math.max(1, Math.floor(c.length / 5 / 1500));
    const f = PHYS.waterDensity * PHYS.gravity * step;
    const pt: Vec3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < c.length; i += 5 * step) {
      const vol = c[i + 4];
      if (vol <= 0) continue;
      toWorld(p, c[i], c[i + 1], c[i + 2], pt);
      const v = w.get(Math.floor(pt.x), Math.floor(pt.y), Math.floor(pt.z)), id = idOf(v);
      if (id !== B.WATER) continue;
      // how deep this block sits: partly, near the surface
      let level = metaOf(v);
      if (level >= 8) level = 0;
      const top = idOf(w.get(Math.floor(pt.x), Math.floor(pt.y) + 1, Math.floor(pt.z))) === B.WATER ? Math.floor(pt.y) + 1 : Math.floor(pt.y) + 1 - (level + 1) / 9;
      const sub = Math.max(0, Math.min(1, top - (pt.y - 0.5)));
      if (sub <= 0) continue;
      const vel = this.velocityAt(s, pt.x, pt.y, pt.z);
      const k = vol * sub;
      b.forces.push(-vel.x * PHYS.waterDrag * k * step, f * k - vel.y * PHYS.waterDrag * k * step, -vel.z * PHYS.waterDrag * k * step, pt.x, pt.y, pt.z);
    }
  }

  /** Debug: what the physics knows. */
  stats() {
    return [...this.spaces.entries()].map(([d, sp]) => ({
      dim: d.world.dimension, bodies: sp.bodies.size, sections: sp.sections.size, colliders: sp.world.colliders.len(), ready: !!RAPIER, error: loadError,
      list: [...sp.bodies.entries()].map(([s, b]) => ({ id: s.id, waiting: b.waiting, sleeping: b.body.isSleeping(), enabled: b.body.isEnabled(), mass: b.body.mass(), y: b.body.translation().y })),
    }));
  }
}

const secKey = (cx: number, sy: number, cz: number) => cx + ',' + sy + ',' + cz;

/** Are all of a sub-level's plot chunks loaded? */
function plotReady(w: World, s: SubLevel) {
  const [x0, , z0, x1, , z1] = s.bounds;
  for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) if (!w.getChunk(cx, cz)?.ready) return false;
  return true;
}

function leaveShipIf(e: import('../entity/entity').Entity, _s: SubLevel) {
  leaveShip(e);
}

/** A block turned by quarter turns (mods' blocks can say how with their `rotate` hook). */
export function turnBlock(v: number, turns: number): number {
  if (!turns) return v;
  const def = BLOCKS[idOf(v)];
  const r = def?.behavior?.rotate;
  if (r) return pack(idOf(v), r(metaOf(v), turns) & 15);
  return rotateBlock(v, turns);
}

