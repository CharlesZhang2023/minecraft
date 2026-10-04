// The 2.5D camera: a flat (orthographic) projection looking down at a point on the ground from a fixed slant,
// turned in quarter steps or freely, zoomed by how much of the world fits on screen. Also the geometry the view
// needs: the ray under a point on screen, what it hits, and where a world point lands on screen.
import type { Client, Camera, Entity, World, Mc } from '../sdk';

export const ZOOM_MIN = 5;
export const ZOOM_MAX = 48;

export interface Hit {
  /** A block, the face side it was hit from, and the point on it. */
  block: { x: number; y: number; z: number; face: number } | null;
  entity: Entity | null;
  /** Where the ray met something (the block, the entity, or the ground plane at the focus height). */
  point: { x: number; y: number; z: number };
  /** Distance along the ray (smaller is nearer the viewer). */
  t: number;
}

export class RtsCam {
  /** The point looked at. */
  x = 0; y = 64; z = 0;
  /** Degrees, Minecraft's convention (0 looks south, +z). 135 shows the north-east, like Reign of Nether. */
  yaw = 135;
  yawTo = 135;
  pitch = 50;
  /** Half the height of the view, in blocks. */
  zoom = 16;
  zoomTo = 16;
  /** Smoothed ground height under the focus. */
  private groundY = 64;
  private last = 0;

  /** Point at a spot (instantly). */
  jump(x: number, z: number, y?: number) {
    this.x = x; this.z = z;
    if (y !== undefined) this.y = this.groundY = y;
  }

  /** Per frame: ease the turn and zoom, and slide the focus height to the ground under it. */
  update(w: World, mc: Mc, follow: { x: number; y: number; z: number } | null, dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    let dy = wrap(this.yawTo - this.yaw);
    if (Math.abs(dy) < 0.05) dy = 0;
    this.yaw += dy * k;
    this.zoom += (this.zoomTo - this.zoom) * k;
    if (follow) {
      this.x += (follow.x - this.x) * Math.min(1, k * 1.5);
      this.z += (follow.z - this.z) * Math.min(1, k * 1.5);
      this.groundY = follow.y;
    } else {
      // average the ground over a few spots so the view doesn't bob over every tree and ditch
      let s = 0, n = 0;
      for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
        const gy = ground(w, mc, Math.floor(this.x + ox), Math.floor(this.z + oz));
        if (gy > 0) { s += gy; n++; }
      }
      if (n) this.groundY = s / n + 1;
    }
    this.y += (this.groundY - this.y) * Math.min(1, k * 0.8);
  }

  /** Frame time since the last call, in seconds (capped). */
  dt() {
    const now = performance.now();
    const d = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    return d;
  }

  apply(cam: Camera) {
    cam.x = this.x; cam.y = this.y; cam.z = this.z;
    cam.yaw = (this.yaw * Math.PI) / 180;
    cam.pitch = (this.pitch * Math.PI) / 180;
    cam.ortho = this.zoom;
    cam.roll = 0; cam.bobX = 0; cam.bobY = 0;
  }

  /** Unit vectors: where the camera looks, screen right, screen up; and along the ground: up-screen and right. */
  axes() {
    const y = (this.yaw * Math.PI) / 180, p = (this.pitch * Math.PI) / 180;
    const f = { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) };
    const r = { x: -Math.cos(y), y: 0, z: -Math.sin(y) };
    const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
    return { f, r, u, fwd: { x: -Math.sin(y), z: Math.cos(y) } };
  }

  /** The ray under a point on screen (fractions of its width and height): from in front of everything, inward. */
  ray(sx: number, sy: number, aspect: number) {
    const { f, r, u } = this.axes();
    const a = (sx * 2 - 1) * this.zoom * aspect, b = (1 - sy * 2) * this.zoom;
    const back = 160;
    return {
      o: { x: this.x + r.x * a + u.x * b - f.x * back, y: this.y + r.y * a + u.y * b - f.y * back, z: this.z + r.z * a + u.z * b - f.z * back },
      d: f,
    };
  }

  /** Move the focus by screen-relative amounts (blocks right and up the screen). */
  pan(right: number, up: number) {
    const { r, fwd } = this.axes();
    this.x += r.x * right + fwd.x * up;
    this.z += r.z * right + fwd.z * up;
  }

  /** Turn a quarter (or any amount when free) and snap the target to it. */
  turn(deg: number, snap = true) {
    let t = this.yawTo + deg;
    if (snap) t = Math.round((t - 45) / 90) * 90 + 45;
    this.yawTo = t;
  }
}

export function wrap(d: number) {
  d %= 360;
  if (d >= 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** The top of the ground (not counting trees and plants) at a column of the client's world. */
export function ground(w: World, mc: Mc, x: number, z: number) {
  let y = w.topSolidY(x, z);
  while (y > 0) {
    const id = w.getId(x, y, z), n = mc.BLOCKS[id].name;
    if (id && mc.BLOCKS[id].solid && !n.endsWith('_leaves') && !n.endsWith('_log')) break;
    if (mc.BLOCKS[id].fluid) break;
    y--;
  }
  return y;
}

/** Walk a ray through the blocks (a voxel DDA): the first block that `stop` accepts. */
export function castBlocks(w: World, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxT: number, stop: (id: number, x: number, y: number, z: number) => boolean) {
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
  const tdx = d.x ? Math.abs(1 / d.x) : Infinity, tdy = d.y ? Math.abs(1 / d.y) : Infinity, tdz = d.z ? Math.abs(1 / d.z) : Infinity;
  let tx = d.x ? ((sx > 0 ? x + 1 - o.x : o.x - x) * tdx) : Infinity;
  let ty = d.y ? ((sy > 0 ? y + 1 - o.y : o.y - y) * tdy) : Infinity;
  let tz = d.z ? ((sz > 0 ? z + 1 - o.z : o.z - z) * tdz) : Infinity;
  let t = 0, face = -1;
  while (t <= maxT) {
    if (y >= 0 && y < 256) {
      const id = w.getId(x, y, z);
      if (id && stop(id, x, y, z)) return { x, y, z, t, face };
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = sx > 0 ? 0 : 1; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; face = sy > 0 ? 2 : 3; }
    else { z += sz; t = tz; tz += tdz; face = sz > 0 ? 4 : 5; }
  }
  return null;
}

/** A ray against a box: the entry distance, or null. */
export function rayBox(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let a = (lo - oo) / dd, c = (hi - oo) / dd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t1 < 0 ? null : Math.max(0, t0);
}

/** What's under a screen point: entities (a little forgiving, and a few blocks deep behind leaves) and blocks. */
export function pick(client: Client, mc: Mc, cam: RtsCam, sx: number, sy: number, opts: { entities?: (e: Entity) => boolean; blockStop?: (id: number) => boolean } = {}): Hit {
  const w = client.world!;
  const aspect = client.renderer.width / client.renderer.height;
  const { o, d } = cam.ray(sx, sy, aspect);
  const stop = opts.blockStop ?? ((id: number) => mc.BLOCKS[id].solid || !!mc.BLOCKS[id].fluid);
  const bh = castBlocks(w, o, d, 420, (id) => stop(id));
  let best: Entity | null = null, bt = Infinity;
  const list = [...client.entities];
  if (client.player && client.view?.showSelf) list.push(client.player);
  for (const e of list) {
    if (e.removed || (opts.entities && !opts.entities(e))) continue;
    const g = 0.25, b = e.box;
    const t = rayBox(o, d, { x0: b.x0 - g, y0: b.y0 - g, z0: b.z0 - g, x1: b.x1 + g, y1: b.y1 + g, z1: b.z1 + g });
    // units hidden a little way behind leaves or a roof edge can still be picked
    if (t === null || (bh && t > bh.t + 6)) continue;
    if (t < bt) { bt = t; best = e; }
  }
  if (best) return { block: null, entity: best, point: { x: best.x, y: best.y + best.height / 2, z: best.z }, t: bt };
  if (bh) return { block: { x: bh.x, y: bh.y, z: bh.z, face: bh.face }, entity: null, point: { x: o.x + d.x * bh.t, y: o.y + d.y * bh.t, z: o.z + d.z * bh.t }, t: bh.t };
  // nothing: the plane at the focus height
  const t = d.y ? (cam.y - o.y) / d.y : 0;
  return { block: null, entity: null, point: { x: o.x + d.x * t, y: cam.y, z: o.z + d.z * t }, t };
}

/** Where a world point lands on screen, in GUI units (null when behind the clip planes). */
export function project(client: Client, x: number, y: number, z: number, guiW: number, guiH: number): [number, number] | null {
  const r = client.renderer, m = r.viewProj, c = r.cam;
  const px = x - c.x, py = y - c.y, pz = z - c.z;
  const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
  const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
  const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
  if (cw <= 1e-6) return null;
  return [((cx / cw + 1) / 2) * guiW, ((1 - cy / cw) / 2) * guiH];
}
