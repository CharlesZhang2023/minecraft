// Minimal column-major 4x4 matrix + vector helpers.

export type Mat4 = Float32Array;

export function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function ortho(out: Mat4, l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function translate(out: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
  if (out !== a) out.set(a);
  out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
  out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
  out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
  out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
  return out;
}

export function scale(out: Mat4, a: Mat4, x: number, y: number, z: number): Mat4 {
  for (let i = 0; i < 4; i++) {
    out[i] = a[i] * x;
    out[4 + i] = a[4 + i] * y;
    out[8 + i] = a[8 + i] * z;
    out[12 + i] = a[12 + i];
  }
  return out;
}

function rotate(out: Mat4, a: Mat4, rad: number, axis: 0 | 1 | 2): Mat4 {
  const s = Math.sin(rad), c = Math.cos(rad);
  // indices of the two basis columns being rotated
  const [p, q] = axis === 0 ? [4, 8] : axis === 1 ? [8, 0] : [0, 4];
  if (out !== a) out.set(a);
  for (let i = 0; i < 4; i++) {
    const ap = a[p + i], aq = a[q + i];
    out[p + i] = ap * c + aq * s;
    out[q + i] = aq * c - ap * s;
  }
  return out;
}
export const rotateX = (out: Mat4, a: Mat4, r: number) => rotate(out, a, r, 0);
export const rotateY = (out: Mat4, a: Mat4, r: number) => rotate(out, a, r, 1);
export const rotateZ = (out: Mat4, a: Mat4, r: number) => rotate(out, a, r, 2);

export function invert(out: Mat4, a: Mat4): Mat4 | null {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function lookDir(out: Mat4, yaw: number, pitch: number): Mat4 {
  // View rotation for a camera at the origin. Minecraft convention:
  // yaw 0 looks toward +Z, yaw increases clockwise (toward -X); pitch > 0 looks down.
  identity(out);
  rotateX(out, out, pitch);
  rotateY(out, out, yaw + Math.PI);
  return out;
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function wrapDeg(d: number) {
  d %= 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface AABB {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}
export function aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
  return { x0, y0, z0, x1, y1, z1 };
}
export function aabbIntersects(a: AABB, b: AABB) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0;
}

/** Ray vs AABB slab test. Returns entry distance and face normal index or null. */
export function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB, maxT: number): { t: number; face: number } | null {
  let tmin = 0, tmax = maxT, face = -1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    let t1 = (mn[i] - o[i]) / d[i];
    let t2 = (mx[i] - o[i]) / d[i];
    let f1 = i * 2, f2 = i * 2 + 1; // face index: 0=-x 1=+x 2=-y 3=+y 4=-z 5=+z
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; const f = f1; f1 = f2; f2 = f; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, face };
}
