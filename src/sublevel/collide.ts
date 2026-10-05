// Entities and sub-levels: walking on them and into them, riding along as they move, and rays that hit their
// blocks. Each sub-level is handled in its own frame: the entity's box and motion are turned into the sub-level's
// local (plot) coordinates, clipped against its blocks there exactly as against the world, and turned back
// (Valkyrien Skies' approach). Works the same on the server and on clients, from the sub-levels the world knows.
import type { Entity } from '../entity/entity';
import type { World } from '../world/world';
import type { AABB } from '../math';
import { BLOCKS, idOf } from '../world/blocks';
import { collisionShapes } from '../world/models';
import type { SubLevel } from './ship';
import { type Pose, type Vec3, toLocal, toWorld, dirToLocal, dirToWorld, qyaw, qrot } from './pose';

/** Collision boxes of a sub-level's blocks (local coordinates) overlapping a local box. */
export function localBoxes(w: World, box: AABB, out: AABB[] = []): AABB[] {
  const x0 = Math.floor(box.x0) - 1, x1 = Math.floor(box.x1) + 1;
  const y0 = Math.max(0, Math.floor(box.y0) - 1), y1 = Math.min(255, Math.floor(box.y1) + 1);
  const z0 = Math.floor(box.z0) - 1, z1 = Math.floor(box.z1) + 1;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++) {
        const v = w.get(x, y, z);
        if (v === 0 || !BLOCKS[idOf(v)].solid) continue;
        for (const s of collisionShapes(v, (dx, dy, dz) => w.get(x + dx, y + dy, z + dz))) {
          const b = { x0: x + s.x0, y0: y + s.y0, z0: z + s.z0, x1: x + s.x1, y1: y + s.y1, z1: z + s.z1 };
          if (b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1 && b.z1 > box.z0 && b.z0 < box.z1) out.push(b);
        }
      }
  return out;
}

/** Are a sub-level's blocks here yet (a client gets its plot's chunks a little after the sub-level itself)? */
function blocksHere(w: World, s: SubLevel): boolean {
  const [x0, , z0, x1, , z1] = s.bounds;
  for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) if (!w.getChunk(cx, cz)?.ready) return false;
  return true;
}
/** What to collide with: its blocks, or until they arrive, the box around them (nobody falls through meanwhile). */
function shipBoxes(w: World, s: SubLevel, box: AABB): AABB[] {
  if (blocksHere(w, s)) return localBoxes(w, box);
  const b = s.localBox();
  return b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1 && b.z1 > box.z0 && b.z0 < box.z1 ? [b] : [];
}

/** Sub-levels whose blocks could be within `reach` of a point. */
export function shipsNear(w: World, x: number, y: number, z: number, reach: number): SubLevel[] {
  const out: SubLevel[] = [];
  for (const s of w.ships) {
    if (s.removed || s.plot < 0) continue;
    const r = s.radius() + reach;
    const dx = s.x - x, dy = s.y - y, dz = s.z - z;
    if (dx * dx + dy * dy + dz * dz <= r * r) out.push(s);
  }
  return out;
}

/** The local axis-aligned box around a world box (its corners turned into the sub-level's frame). */
function localAround(p: Pose, b: AABB): AABB {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const v: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 8; i++) {
    toLocal(p, i & 1 ? b.x1 : b.x0, i & 2 ? b.y1 : b.y0, i & 4 ? b.z1 : b.z0, v);
    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z);
    x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

/** Is anything of a sub-level inside this world box (sneaking: is there still floor there)? */
export function shipsOverlap(w: World, b: AABB): boolean {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
  for (const s of shipsNear(w, cx, cy, cz, Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0))) {
    const lb = localAround(s.pose(), b);
    if (shipBoxes(w, s, lb).length) return true;
  }
  return false;
}

// Like the world's clipping, but a box a hair inside another (turning into a sub-level's frame and back isn't exact)
// still counts as resting on it, and is put back on its surface.
const EPS = 2e-3;
function clipY(b: AABB, box: AABB, d: number) {
  if (box.x1 <= b.x0 + EPS || box.x0 >= b.x1 - EPS || box.z1 <= b.z0 + EPS || box.z0 >= b.z1 - EPS) return d;
  if (d > 0 && box.y1 <= b.y0 + EPS) { const m = b.y0 - box.y1; if (m < d) d = m; }
  else if (d < 0 && box.y0 >= b.y1 - EPS) { const m = b.y1 - box.y0; if (m > d) d = m; }
  return d;
}
function clipX(b: AABB, box: AABB, d: number) {
  if (box.y1 <= b.y0 + EPS || box.y0 >= b.y1 - EPS || box.z1 <= b.z0 + EPS || box.z0 >= b.z1 - EPS) return d;
  if (d > 0 && box.x1 <= b.x0 + EPS) { const m = b.x0 - box.x1; if (m < d) d = m; }
  else if (d < 0 && box.x0 >= b.x1 - EPS) { const m = b.x1 - box.x0; if (m > d) d = m; }
  return d;
}
function clipZ(b: AABB, box: AABB, d: number) {
  if (box.x1 <= b.x0 + EPS || box.x0 >= b.x1 - EPS || box.y1 <= b.y0 + EPS || box.y0 >= b.y1 - EPS) return d;
  if (d > 0 && box.z1 <= b.z0 + EPS) { const m = b.z0 - box.z1; if (m < d) d = m; }
  else if (d < 0 && box.z0 >= b.z1 - EPS) { const m = b.z1 - box.z0; if (m > d) d = m; }
  return d;
}
const off = (b: AABB, x: number, y: number, z: number): AABB => ({ x0: b.x0 + x, y0: b.y0 + y, z0: b.z0 + z, x1: b.x1 + x, y1: b.y1 + y, z1: b.z1 + z });
const grow = (b: AABB, dx: number, dy: number, dz: number): AABB => ({
  x0: dx < 0 ? b.x0 + dx : b.x0, x1: dx > 0 ? b.x1 + dx : b.x1,
  y0: dy < 0 ? b.y0 + dy : b.y0, y1: dy > 0 ? b.y1 + dy : b.y1,
  z0: dz < 0 ? b.z0 + dz : b.z0, z1: dz > 0 ? b.z1 + dz : b.z1,
});

/** Minecraft's box clipping (y, x, z, then a step up) against `boxes`; returns the motion allowed. */
function clipMove(boxes: AABB[], box0: AABB, dx: number, dy: number, dz: number, step: number, groundish: boolean, w: World, sdxz: [number, number]) {
  let box = box0;
  const ody = dy;
  for (const b of boxes) dy = clipY(b, box, dy);
  box = off(box, 0, dy, 0);
  for (const b of boxes) dx = clipX(b, box, dx);
  box = off(box, dx, 0, 0);
  for (const b of boxes) dz = clipZ(b, box, dz);
  const [sdx, sdz] = sdxz;
  if (step > 0 && (groundish || (ody !== dy && ody < 0)) && (sdx !== dx || sdz !== dz)) {
    let sdy = step, b2 = box0;
    const bs = localBoxes(w, grow(b2, sdx, sdy, sdz));
    for (const b of bs) sdy = clipY(b, b2, sdy);
    b2 = off(b2, 0, sdy, 0);
    let ndx = sdx, ndz = sdz;
    for (const b of bs) ndx = clipX(b, b2, ndx);
    b2 = off(b2, ndx, 0, 0);
    for (const b of bs) ndz = clipZ(b, b2, ndz);
    b2 = off(b2, 0, 0, ndz);
    let down = -sdy;
    for (const b of bs) down = clipY(b, b2, down);
    if (ndx * ndx + ndz * ndz > dx * dx + dz * dz) return { dx: ndx, dy: sdy + down, dz: ndz, stepped: true };
  }
  return { dx, dy, dz, stepped: false };
}

/** What riding a sub-level means for an entity: which one, and its pose when we last moved along with it. */
interface Ride { ship: SubLevel; pose: Pose; air: number }
const RIDES = new WeakMap<Entity, Ride>();

/** The sub-level an entity stands on (or just jumped from), if any. */
export function ridingShip(e: Entity): SubLevel | null {
  const r = RIDES.get(e);
  return r && !r.ship.removed ? r.ship : null;
}

export interface ShipClip {
  dx: number; dy: number; dz: number;
  /** landed on (or is standing on) a sub-level */
  ground: boolean;
  /** stopped by a sub-level's blocks, in world directions: velocity along these goes */
  stops: Vec3[];
}

/**
 * Clip an entity's motion against the sub-levels around it. The world's own blocks are done after, by Entity.move.
 */
export function clipAgainstShips(e: Entity, dx: number, dy: number, dz: number): ShipClip {
  const out: ShipClip = { dx, dy, dz, ground: false, stops: [] };
  const w = e.world;
  const len = Math.hypot(dx, dy, dz);
  const ships = shipsNear(w, e.x, e.y + e.height / 2, e.z, len + e.height + 2);
  if (!ships.length) return out;
  const hw = e.width / 2, hh = e.height / 2;
  for (const s of ships) {
    const p = s.pose();
    // the entity's box, centred, in the sub-level's frame (kept upright in it)
    const c = toLocal(p, e.x, e.y + hh, e.z);
    const box: AABB = { x0: c.x - hw, y0: c.y - hh, z0: c.z - hw, x1: c.x + hw, y1: c.y + hh, z1: c.z + hw };
    const ld = dirToLocal(p, out.dx, out.dy, out.dz);
    // sunk a little into it (it rose into us, or we arrived a moment before it did): step up out of it
    const inside = shipBoxes(w, s, { x0: box.x0 + EPS, y0: box.y0 + EPS, z0: box.z0 + EPS, x1: box.x1 - EPS, y1: box.y1 - EPS, z1: box.z1 - EPS });
    if (inside.length) {
      let top = -Infinity;
      for (const b of inside) top = Math.max(top, b.y1);
      const push = top - box.y0;
      if (push > 0 && push < 1.05 && qrot(p.q, 0, 1, 0).y > 0.7) {
        const lifted = { ...box, y0: box.y0 + push, y1: box.y1 + push };
        if (!shipBoxes(w, s, { x0: lifted.x0 + EPS, y0: lifted.y0 + EPS, z0: lifted.z0 + EPS, x1: lifted.x1 - EPS, y1: lifted.y1 - EPS, z1: lifted.z1 - EPS }).length) {
          const up = dirToWorld(p, 0, push - ld.y, 0);
          out.dx += up.x; out.dy += up.y; out.dz += up.z;
          out.ground = true;
          ride(e, s);
          continue;
        }
      }
    }
    const boxes = shipBoxes(w, s, grow(box, ld.x, ld.y, ld.z));
    if (!boxes.length) continue;
    const up = qrot(p.q, 0, 1, 0);
    const groundish = (e.onGround && RIDES.get(e)?.ship === s) || false;
    const r = clipMove(boxes, box, ld.x, ld.y, ld.z, up.y > 0.7 ? e.stepHeight : 0, groundish, w, [ld.x, ld.z]);
    const wd = dirToWorld(p, r.dx, r.dy, r.dz);
    out.dx = wd.x; out.dy = wd.y; out.dz = wd.z;
    if (r.dy !== ld.y && !r.stepped) {
      out.stops.push(dirToWorld(p, 0, 1, 0));
      // landing on it: it's our floor (if it's roughly the right way up)
      if (ld.y < 0 && up.y > 0.5) { out.ground = true; ride(e, s); }
    }
    if (r.stepped && up.y > 0.7) { out.ground = true; ride(e, s); }
    if (r.dx !== ld.x) out.stops.push(dirToWorld(p, 1, 0, 0));
    if (r.dz !== ld.z) out.stops.push(dirToWorld(p, 0, 0, 1));
  }
  return out;
}

function ride(e: Entity, s: SubLevel) {
  const r = RIDES.get(e);
  if (r && r.ship === s) { r.air = 0; return; }
  RIDES.set(e, { ship: s, pose: s.pose(), air: 0 });
}

/** Standing on the ground of the world: no longer riding anything. */
export function leaveShip(e: Entity) {
  RIDES.delete(e);
}

/**
 * Move an entity along with the sub-level it rides, by however far that moved and turned since the last time.
 * Called once a tick, before the entity's own move. Airborne riders keep riding for a while (a jump on a deck
 * lands on the deck), unless they're well clear of it.
 */
export function carry(e: Entity) {
  const r = RIDES.get(e);
  if (!r) return;
  const s = r.ship;
  if (s.removed || !e.world.ships.includes(s)) { RIDES.delete(e); return; }
  if (!e.onGround) {
    r.air++;
    const d = Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z);
    if (r.air > 100 || d > s.radius() + 6) { RIDES.delete(e); return; }
  }
  const now = s.pose(), was = r.pose;
  if (now.tx === was.tx && now.ty === was.ty && now.tz === was.tz && now.q.x === was.q.x && now.q.y === was.q.y && now.q.z === was.q.z && now.q.w === was.q.w && now.lx === was.lx && now.ly === was.ly && now.lz === was.lz) return;
  const l = toLocal(was, e.x, e.y, e.z);
  const n = toWorld(now, l.x, l.y, l.z);
  // moved along without being pushed into anything of the world (an entity stays out of terrain the ship hits)
  e.x = n.x; e.y = n.y; e.z = n.z;
  let dyaw = qyaw(now.q) - qyaw(was.q);
  if (dyaw > 180) dyaw -= 360;
  if (dyaw < -180) dyaw += 360;
  e.yaw += dyaw;
  r.pose = now;
}

/** A sub-level block hit by a ray: the hit's block and point are local (plot) coordinates. */
export interface ShipHit { ship: SubLevel; x: number; y: number; z: number; face: number; t: number; hx: number; hy: number; hz: number }

/**
 * The nearest sub-level block along a world ray, within maxDist. `cast` is the world raycast (passed in to avoid
 * an import cycle) run in local coordinates.
 */
export function raycastShips<H extends { t: number; x: number; y: number; z: number; face: number; hx: number; hy: number; hz: number }>(
  w: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number,
  cast: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => H | null,
): (H & { ship: SubLevel }) | null {
  let best: (H & { ship: SubLevel }) | null = null;
  for (const s of shipsNear(w, ox, oy, oz, maxDist + 1)) {
    const p = s.pose();
    const o = toLocal(p, ox, oy, oz), d = dirToLocal(p, dx, dy, dz);
    const h = cast(o.x, o.y, o.z, d.x, d.y, d.z, best ? best.t : maxDist);
    if (h && (!best || h.t < best.t)) best = Object.assign(h, { ship: s });
  }
  return best;
}
