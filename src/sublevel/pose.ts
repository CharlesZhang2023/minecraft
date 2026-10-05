// Poses of sub-levels: where a moving block structure is and how it's turned. A sub-level's blocks live in its plot
// (see shipyard.ts) at fixed "local" coordinates; its pose maps them into the world:
//   world = R * (local - L) + T
// with L the local point the structure turns about (its pivot, near the centre of mass), T where that point is in
// the world and R the rotation (a unit quaternion).

export interface Quat { x: number; y: number; z: number; w: number }
export interface Vec3 { x: number; y: number; z: number }

export const QI: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Rotate v by q. */
export function qrot(q: Quat, x: number, y: number, z: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  out.x = x + q.w * tx + (q.y * tz - q.z * ty);
  out.y = y + q.w * ty + (q.z * tx - q.x * tz);
  out.z = z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}
/** Rotate v by the inverse of q. */
export function qrotInv(q: Quat, x: number, y: number, z: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  return qrot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x, y, z, out);
}
export function qmul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export const qconj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qnorm(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}
/** Rotation of `rad` about the axis (unit). */
export function qaxis(ax: number, ay: number, az: number, rad: number): Quat {
  const s = Math.sin(rad / 2);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(rad / 2) };
}
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (d > 0.9995) return qnorm({ x: a.x + (bx - a.x) * t, y: a.y + (by - a.y) * t, z: a.z + (bz - a.z) * t, w: a.w + (bw - a.w) * t });
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return { x: a.x * wa + bx * wb, y: a.y * wa + by * wb, z: a.z * wa + bz * wb, w: a.w * wa + bw * wb };
}
/** Heading in degrees, the game's way (0 faces +z, 90 faces -x): where the local +z axis points. */
export function qyaw(q: Quat): number {
  const f = qrot(q, 0, 0, 1);
  return (Math.atan2(-f.x, f.z) * 180) / Math.PI;
}
/** How far (radians) the local up axis leans away from the world's up. */
export function qtilt(q: Quat): number {
  const u = qrot(q, 0, 1, 0);
  return Math.acos(Math.max(-1, Math.min(1, u.y)));
}

/** A rigid placement: world = R * (local - L) + T. */
export interface Pose {
  /** where the pivot is in the world */
  tx: number; ty: number; tz: number;
  q: Quat;
  /** the pivot, in local (plot) coordinates */
  lx: number; ly: number; lz: number;
}

export function toWorld(p: Pose, x: number, y: number, z: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  qrot(p.q, x - p.lx, y - p.ly, z - p.lz, out);
  out.x += p.tx; out.y += p.ty; out.z += p.tz;
  return out;
}
export function toLocal(p: Pose, x: number, y: number, z: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  qrotInv(p.q, x - p.tx, y - p.ty, z - p.tz, out);
  out.x += p.lx; out.y += p.ly; out.z += p.lz;
  return out;
}
/** A direction from local to world. */
export const dirToWorld = (p: Pose, x: number, y: number, z: number, out?: Vec3) => qrot(p.q, x, y, z, out);
export const dirToLocal = (p: Pose, x: number, y: number, z: number, out?: Vec3) => qrotInv(p.q, x, y, z, out);

/** Column-major 3x3 rotation matrix of q (for shaders). */
export function qmat3(q: Quat, out = new Float32Array(9)): Float32Array {
  const { x, y, z, w } = q;
  out[0] = 1 - 2 * (y * y + z * z); out[1] = 2 * (x * y + z * w); out[2] = 2 * (x * z - y * w);
  out[3] = 2 * (x * y - z * w); out[4] = 1 - 2 * (x * x + z * z); out[5] = 2 * (y * z + x * w);
  out[6] = 2 * (x * z + y * w); out[7] = 2 * (y * z - x * w); out[8] = 1 - 2 * (x * x + y * y);
  return out;
}
/**
 * Column-major 4x4 taking points relative to the pivot (local - L) to camera-relative world points. (Plot
 * coordinates are large, so geometry is built relative to the pivot to stay precise in 32-bit floats.)
 */
export function poseMat4(p: Pose, cx: number, cy: number, cz: number, out = new Float32Array(16)): Float32Array {
  const r = qmat3(p.q);
  out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; out[3] = 0;
  out[4] = r[3]; out[5] = r[4]; out[6] = r[5]; out[7] = 0;
  out[8] = r[6]; out[9] = r[7]; out[10] = r[8]; out[11] = 0;
  out[12] = p.tx - cx; out[13] = p.ty - cy; out[14] = p.tz - cz; out[15] = 1;
  return out;
}
