// Projectile flight, shared by the server (the real thing) and the clients (which fly their own copy of every
// projectile from the moment it was cast, so spells look smooth however far away the host is; the server's word
// on where each one ended always wins).
import type { Proj, Path, Steer, Orbit } from './spells';

/** The part of a projectile that flies. */
export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  bounces: number;
  gravity: number;
  drag: number;
  bounceKeep: number;
  homing: number;
  path: Path;
  /** Starting speed (accelerating shots cap at three times it). */
  speed0: number;
  seed: number;
  ghost: boolean;
  fuse: boolean;
  /** Steering beyond the path (the ones both sides can work out are applied in `steer`). */
  steer: Steer[];
}

export const bodyOf = (p: Proj, x: number, y: number, z: number, vx: number, vy: number, vz: number, seed: number): Body => ({
  x, y, z, vx, vy, vz, age: 0, life: p.life, bounces: p.bounces, gravity: p.gravity, drag: p.drag, bounceKeep: p.bounceKeep,
  homing: p.homing, path: p.path, speed0: Math.hypot(vx, vy, vz), seed, ghost: p.ghost, fuse: p.fuse, steer: p.steer,
});

/** Where something circling a centre is at an age. */
export function orbitAt(o: Orbit, age: number, cx: number, cy: number, cz: number): [number, number, number] {
  const a = o.phase + age * o.w;
  return [cx + Math.cos(a) * o.r, cy + (o.around === 'parent' ? Math.sin(a * 2) * 0.15 : 0), cz + Math.sin(a) * o.r];
}

/** A block a segment ran into: where, the face's normal, and the block. */
export interface BlockHit { t: number; x: number; y: number; z: number; nx: number; ny: number; nz: number; bx: number; by: number; bz: number }

/** First solid block along the segment from (x, y, z) by (dx, dy, dz) (Amanatides & Woo voxel walk). */
export function rayBlocks(x: number, y: number, z: number, dx: number, dy: number, dz: number, solid: (x: number, y: number, z: number) => boolean, skip?: (x: number, y: number, z: number) => boolean): BlockHit | null {
  let bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (solid(bx, by, bz) && !skip?.(bx, by, bz)) return { t: 0, x, y, z, nx: 0, ny: 0, nz: 0, bx, by, bz };
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tx = sx > 0 ? (bx + 1 - x) * tdx : sx < 0 ? (x - bx) * tdx : Infinity;
  let ty = sy > 0 ? (by + 1 - y) * tdy : sy < 0 ? (y - by) * tdy : Infinity;
  let tz = sz > 0 ? (bz + 1 - z) * tdz : sz < 0 ? (z - bz) * tdz : Infinity;
  for (let n = 0; n < 64; n++) {
    let t: number, nx = 0, ny = 0, nz = 0;
    if (tx <= ty && tx <= tz) { t = tx; bx += sx; tx += tdx; nx = -sx; }
    else if (ty <= tz) { t = ty; by += sy; ty += tdy; ny = -sy; }
    else { t = tz; bz += sz; tz += tdz; nz = -sz; }
    if (t > 1) return null;
    if (solid(bx, by, bz) && !skip?.(bx, by, bz)) return { t, x: x + dx * t, y: y + dy * t, z: z + dz * t, nx, ny, nz, bx, by, bz };
  }
  return null;
}

/** Deterministic noise for chaotic paths (the same on every machine). */
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** This tick's change of position: velocity, plus any wiggle the path adds on top. */
export function displacement(b: Body): [number, number, number] {
  let { vx: dx, vy: dy, vz: dz } = b;
  if (b.path === 'sine' || b.path === 'spiral') {
    const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
    // sideways (horizontal, across the flight) and "up" across the flight
    let sx = -b.vz, sz = b.vx;
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-6) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
    const fx = b.vx / sp, fy = b.vy / sp, fz = b.vz / sp;
    const ux = fy * sz, uy = fz * sx - fx * sz, uz = -fy * sx;
    const w = 0.55, a = 0.5 * w;
    const c = Math.cos(b.age * w) * a, s = Math.sin(b.age * w) * a;
    dx += sx * c; dz += sz * c;
    if (b.path === 'spiral') { dx += ux * s; dy += uy * s; dz += uz * s; }
  }
  return [dx, dy, dz];
}

/** Forces for one tick: gravity, drag, homing, the path's own steering. `target` is what homing steers to. */
export function steer(b: Body, target: { x: number; y: number; z: number } | null) {
  b.vy -= b.gravity;
  const st = b.steer;
  if (st.length) {
    const sp0 = Math.hypot(b.vx, b.vy, b.vz);
    if (st.includes('horizontal')) b.vy = 0;
    if (st.includes('flyDown') && b.age === 5) { b.vx = 0; b.vy = -sp0; b.vz = 0; }
    if (st.includes('flyUp') && b.age === 5) { b.vx = 0; b.vy = sp0; b.vz = 0; }
    if (st.includes('pingpong') && b.age > 0 && b.age % 12 === 0) { b.vx = -b.vx; b.vy = -b.vy; b.vz = -b.vz; }
    if (st.includes('accelHoming') && sp0 < b.speed0 * 3) { b.vx *= 1.06; b.vy *= 1.06; b.vz *= 1.06; }
  }
  if (b.drag !== 1) { b.vx *= b.drag; b.vy *= b.drag; b.vz *= b.drag; }
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  if (b.path === 'accel' && sp < b.speed0 * 3) { b.vx *= 1.12; b.vy *= 1.12; b.vz *= 1.12; }
  if (b.path === 'chaos' && sp > 0) {
    const k = sp * 0.45;
    b.vx += (hash(b.seed, b.age * 3) - 0.5) * 2 * k;
    b.vy += (hash(b.seed, b.age * 3 + 1) - 0.5) * 2 * k;
    b.vz += (hash(b.seed, b.age * 3 + 2) - 0.5) * 2 * k;
    const s2 = Math.hypot(b.vx, b.vy, b.vz) || 1;
    b.vx *= sp / s2; b.vy *= sp / s2; b.vz *= sp / s2;
  }
  const anti = st.includes('antiHoming');
  if (target && (b.homing > 0 || anti) && sp > 0) {
    let tx = target.x - b.x, ty = target.y - b.y, tz = target.z - b.z;
    if (anti) { tx = -tx; ty = -ty; tz = -tz; }
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx = (tx / tl) * sp; ty = (ty / tl) * sp; tz = (tz / tl) * sp;
    const k = anti ? 0.2 : b.homing;
    b.vx += (tx - b.vx) * k; b.vy += (ty - b.vy) * k; b.vz += (tz - b.vz) * k;
    const s2 = Math.hypot(b.vx, b.vy, b.vz) || 1;
    b.vx *= sp / s2; b.vy *= sp / s2; b.vz *= sp / s2;
  }
}

/** Bounce off a face: the velocity reflects, losing some speed. */
export function bounce(b: Body, h: BlockHit) {
  const k = b.bounceKeep;
  if (h.nx) b.vx = -b.vx * k; else b.vx *= k;
  if (h.ny) b.vy = -b.vy * k; else b.vy *= k;
  if (h.nz) b.vz = -b.vz * k; else b.vz *= k;
  // something resting on the ground stops jittering
  if (h.ny > 0 && Math.abs(b.vy) < 0.06) b.vy = 0;
  b.x = h.x + h.nx * 0.02;
  b.y = h.y + h.ny * 0.02;
  b.z = h.z + h.nz * 0.02;
  b.bounces--;
}

/** Point where a ray of `len` from a start first meets a solid block (or its end). */
export function rayEnd(x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, solid: (x: number, y: number, z: number) => boolean) {
  const h = rayBlocks(x, y, z, dx * len, dy * len, dz * len, solid);
  if (!h) return { x: x + dx * len, y: y + dy * len, z: z + dz * len, hit: false };
  return { x: h.x + h.nx * 0.3, y: h.y + h.ny * 0.3, z: h.z + h.nz * 0.3, hit: true };
}
