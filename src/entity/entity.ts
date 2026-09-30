// Base entity with Minecraft-style collision and movement.
import type { World } from '../world/world';
import { AABB } from '../math';
import { BLOCKS, B, idOf, metaOf } from '../world/blocks';
import { collisionShapes } from '../world/models';

let nextId = 1;

export class Entity {
  id = nextId++;
  x = 0; y = 0; z = 0;
  px = 0; py = 0; pz = 0; // previous tick position (for interpolation)
  vx = 0; vy = 0; vz = 0;
  yaw = 0; pitch = 0; // degrees
  pyaw = 0; ppitch = 0;
  width = 0.6;
  height = 1.8;
  stepHeight = 0;
  onGround = false;
  collidedH = false;
  collidedV = false;
  inWater = false;
  inLava = false;
  inWeb = false;
  fallDistance = 0;
  dead = false;
  removed = false;
  age = 0;
  noClip = false;
  fireTicks = 0;
  sneaking = false; // prevents walking off edges
  constructor(public world: World) {}


  setPos(x: number, y: number, z: number) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
    this.onGround = false;
    this.fallDistance = 0;
  }

  get box(): AABB {
    const w = this.width / 2;
    return { x0: this.x - w, y0: this.y, z0: this.z - w, x1: this.x + w, y1: this.y + this.height, z1: this.z + w };
  }

  lerpX(t: number) { return this.px + (this.x - this.px) * t; }
  lerpY(t: number) { return this.py + (this.y - this.py) * t; }
  lerpZ(t: number) { return this.pz + (this.z - this.pz) * t; }

  preTick() {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.pyaw = this.yaw; this.ppitch = this.pitch;
    this.age++;
  }

  tick() {}

  /** All collision boxes intersecting `box`. */
  collisions(box: AABB): AABB[] {
    const out: AABB[] = [];
    const x0 = Math.floor(box.x0) - 1, x1 = Math.floor(box.x1) + 1;
    const y0 = Math.floor(box.y0) - 1, y1 = Math.floor(box.y1) + 1;
    const z0 = Math.floor(box.z0) - 1, z1 = Math.floor(box.z1) + 1;
    const w = this.world;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = y0; y <= y1; y++) {
          const v = w.getForPhysics(x, y, z);
          if (v === 0) continue;
          const def = BLOCKS[idOf(v)];
          if (!def.solid) continue;
          const shapes = collisionShapes(v, (dx, dy, dz) => w.get(x + dx, y + dy, z + dz));
          for (const s of shapes) {
            const b = { x0: x + s.x0, y0: y + s.y0, z0: z + s.z0, x1: x + s.x1, y1: y + s.y1, z1: z + s.z1 };
            if (b.x1 > box.x0 && b.x0 < box.x1 && b.y1 > box.y0 && b.y0 < box.y1 && b.z1 > box.z0 && b.z0 < box.z1) out.push(b);
          }
        }
    return out;
  }

  move(dx: number, dy: number, dz: number) {
    if (this.noClip) {
      this.x += dx; this.y += dy; this.z += dz;
      return;
    }
    if (this.inWeb) {
      this.inWeb = false;
      dx *= 0.25; dy *= 0.05; dz *= 0.25;
      this.vx = this.vy = this.vz = 0;
    }
    const odx = dx, ody = dy, odz = dz;
    let box = this.box;
    // sneaking: don't walk off edges
    if (this.onGround && this.sneaking) {
      const step = 0.05;
      const test = (ddx: number, ddz: number) => this.collisions(offset(box, ddx, -1, ddz)).length === 0;
      while (dx !== 0 && test(dx, 0)) {
        if (dx < step && dx >= -step) dx = 0;
        else if (dx > 0) dx -= step;
        else dx += step;
      }
      while (dz !== 0 && test(0, dz)) {
        if (dz < step && dz >= -step) dz = 0;
        else if (dz > 0) dz -= step;
        else dz += step;
      }
      while (dx !== 0 && dz !== 0 && test(dx, dz)) {
        if (dx < step && dx >= -step) dx = 0;
        else if (dx > 0) dx -= step;
        else dx += step;
        if (dz < step && dz >= -step) dz = 0;
        else if (dz > 0) dz -= step;
        else dz += step;
      }
    }
    const sdx = dx, sdz = dz;
    const boxes = this.collisions(expand(box, dx, dy, dz));
    for (const b of boxes) dy = clipY(b, box, dy);
    box = offset(box, 0, dy, 0);
    for (const b of boxes) dx = clipX(b, box, dx);
    box = offset(box, dx, 0, 0);
    for (const b of boxes) dz = clipZ(b, box, dz);
    box = offset(box, 0, 0, dz);

    // step up
    const onGroundish = this.onGround || (ody !== dy && ody < 0);
    if (this.stepHeight > 0 && onGroundish && (sdx !== dx || sdz !== dz)) {
      const cdx = dx, cdy = dy, cdz = dz, cbox = box;
      let sdy = this.stepHeight;
      let b2 = this.box;
      const bs = this.collisions(expand(b2, sdx, sdy, sdz));
      for (const b of bs) sdy = clipY(b, b2, sdy);
      b2 = offset(b2, 0, sdy, 0);
      let ndx = sdx, ndz = sdz;
      for (const b of bs) ndx = clipX(b, b2, ndx);
      b2 = offset(b2, ndx, 0, 0);
      for (const b of bs) ndz = clipZ(b, b2, ndz);
      b2 = offset(b2, 0, 0, ndz);
      let down = -sdy;
      for (const b of bs) down = clipY(b, b2, down);
      b2 = offset(b2, 0, down, 0);
      if (cdx * cdx + cdz * cdz >= ndx * ndx + ndz * ndz) {
        dx = cdx; dy = cdy; dz = cdz; box = cbox;
      } else {
        dx = ndx; dz = ndz; dy = sdy + down; box = b2;
      }
    }

    this.x = (box.x0 + box.x1) / 2;
    this.y = box.y0;
    this.z = (box.z0 + box.z1) / 2;
    this.collidedH = odx !== dx || odz !== dz;
    this.collidedV = ody !== dy;
    const wasOnGround = this.onGround;
    this.onGround = this.collidedV && ody < 0;
    if (odx !== dx) this.vx = 0;
    if (odz !== dz) this.vz = 0;
    // slime blocks bounce whatever lands on them (unless sneaking) and cancel fall damage
    const slime = this.onGround && this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z)) === B.SLIME_BLOCK && !this.sneaking;
    if (ody !== dy) this.vy = slime && ody < -0.08 ? -ody * (this.bounceFactor()) : 0;
    if (slime) {
      this.fallDistance = 0;
      if (Math.abs(this.vy) < 0.1) { const f = 0.4 + Math.abs(this.vy) * 0.2; this.vx *= f; this.vz *= f; }
    }
    // fall damage bookkeeping
    if (this.onGround) {
      if (this.fallDistance > 0) {
        this.onLand(this.fallDistance, wasOnGround);
        this.fallDistance = 0;
      }
    } else if (dy < 0) this.fallDistance -= dy;
  }

  onLand(_fall: number, _wasOnGround: boolean) {}
  bounceFactor() { return 1; }

  /** Update inWater/inLava flags; returns true if touching water. */
  updateFluidState() {
    const b = this.box;
    const bx = { x0: b.x0 + 0.001, y0: b.y0 + 0.001, z0: b.z0 + 0.001, x1: b.x1 - 0.001, y1: b.y1 - 0.4, z1: b.z1 - 0.001 };
    this.inWater = this.fluidIn(bx, B.WATER, true);
    this.inLava = this.fluidIn({ ...bx, y1: b.y1 - 0.4 }, B.LAVA, false);
    // cobwebs
    const x0 = Math.floor(b.x0), x1 = Math.floor(b.x1 - 0.001), y0 = Math.floor(b.y0), y1 = Math.floor(b.y1 - 0.001), z0 = Math.floor(b.z0), z1 = Math.floor(b.z1 - 0.001);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (this.world.getId(x, y, z) === B.COBWEB) this.inWeb = true;
  }

  /** Is the given fluid inside box; for water also applies current push. */
  fluidIn(b: AABB, fluid: number, push: boolean): boolean {
    const x0 = Math.floor(b.x0), x1 = Math.floor(b.x1 + 1), y0 = Math.floor(b.y0), y1 = Math.floor(b.y1 + 1), z0 = Math.floor(b.z0), z1 = Math.floor(b.z1 + 1);
    let found = false;
    let fx = 0, fz = 0;
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++) {
          const v = this.world.get(x, y, z);
          if (idOf(v) !== fluid) continue;
          let lvl = metaOf(v);
          if (lvl >= 8) lvl = 0;
          const top = y + 1 - (lvl + 1) / 9;
          if (b.y1 >= top) {
            found = true;
            if (push) {
              // flow direction: toward lower-level neighbours
              const here = lvl;
              for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const n = this.world.get(x + ddx, y, z + ddz);
                if (idOf(n) === fluid) {
                  let nl = metaOf(n);
                  if (nl >= 8) nl = 0;
                  const d = nl - here;
                  fx += ddx * d; fz += ddz * d;
                } else if (!BLOCKS[idOf(n)].solid && idOf(this.world.get(x + ddx, y - 1, z + ddz)) === fluid) {
                  fx += ddx * 8; fz += ddz * 8;
                }
              }
            }
          }
        }
    if (push && found && (fx || fz)) {
      const l = Math.hypot(fx, fz);
      this.vx += (fx / l) * 0.014 * 0.5;
      this.vz += (fz / l) * 0.014 * 0.5;
    }
    return found;
  }

  isInsideOpaque(): boolean {
    const eyeY = this.y + this.eyeHeight();
    const x = Math.floor(this.x), y = Math.floor(eyeY), z = Math.floor(this.z);
    const id = this.world.getId(x, y, z);
    return BLOCKS[id].opaque;
  }

  eyeHeight() { return this.height * 0.85; }

  distanceTo(e: { x: number; y: number; z: number }) {
    return Math.hypot(this.x - e.x, this.y - e.y, this.z - e.z);
  }
}

export function offset(b: AABB, dx: number, dy: number, dz: number): AABB {
  return { x0: b.x0 + dx, y0: b.y0 + dy, z0: b.z0 + dz, x1: b.x1 + dx, y1: b.y1 + dy, z1: b.z1 + dz };
}
export function expand(b: AABB, dx: number, dy: number, dz: number): AABB {
  return {
    x0: dx < 0 ? b.x0 + dx : b.x0, x1: dx > 0 ? b.x1 + dx : b.x1,
    y0: dy < 0 ? b.y0 + dy : b.y0, y1: dy > 0 ? b.y1 + dy : b.y1,
    z0: dz < 0 ? b.z0 + dz : b.z0, z1: dz > 0 ? b.z1 + dz : b.z1,
  };
}
function clipY(b: AABB, box: AABB, d: number) {
  if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.z1 <= b.z0 || box.z0 >= b.z1) return d;
  if (d > 0 && box.y1 <= b.y0) { const m = b.y0 - box.y1; if (m < d) d = m; }
  else if (d < 0 && box.y0 >= b.y1) { const m = b.y1 - box.y0; if (m > d) d = m; }
  return d;
}
function clipX(b: AABB, box: AABB, d: number) {
  if (box.y1 <= b.y0 || box.y0 >= b.y1 || box.z1 <= b.z0 || box.z0 >= b.z1) return d;
  if (d > 0 && box.x1 <= b.x0) { const m = b.x0 - box.x1; if (m < d) d = m; }
  else if (d < 0 && box.x0 >= b.x1) { const m = b.x1 - box.x0; if (m > d) d = m; }
  return d;
}
function clipZ(b: AABB, box: AABB, d: number) {
  if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.y1 <= b.y0 || box.y0 >= b.y1) return d;
  if (d > 0 && box.z1 <= b.z0) { const m = b.z0 - box.z1; if (m < d) d = m; }
  else if (d < 0 && box.z0 >= b.z1) { const m = b.z1 - box.z0; if (m > d) d = m; }
  return d;
}
