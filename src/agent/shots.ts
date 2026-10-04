// Pictures for the agent API: the player's view, or a camera anywhere (perspective, orbiting a point, flat isometric,
// straight down), with the area around it streamed and drawn first. And markers: outlined boxes in the world.
import type { Camera, Renderer } from '../render/renderer';
import type { Agent, P3 } from './agent';

type Params = Record<string, unknown>;

export interface Marker { id: string; lo: P3; hi: P3; color: [number, number, number, number]; label?: string; until: number }

const SIDES: Record<string, number> = { s: 0, south: 0, sw: 45, southwest: 45, w: 90, west: 90, nw: 135, northwest: 135, n: 180, north: 180, ne: 225, northeast: 225, e: 270, east: 270, se: 315, southeast: 315 };
/**
 * The compass side a camera stands on as a yaw (degrees, the game's: 0 looks south, 90 west, 180 north, 270 east).
 * A camera on the south side looks north.
 */
function sideYaw(side: unknown, def: string): number {
  const s = side === undefined ? def : side;
  if (typeof s === 'number') return s;
  const k = String(s).toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (k in SIDES) return (SIDES[k] + 180) % 360;
  const n = parseFloat(k);
  if (Number.isFinite(n)) return n;
  throw new Error(`side: n, ne, e, se, s, sw, w, nw or degrees (not '${String(s)}')`);
}

/** Yaw and pitch (degrees, the game's) to look from one point at another. */
export function lookAngles(from: P3, to: P3): [number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const h = Math.hypot(dx, dz);
  return [(Math.atan2(-dx, dz) * 180) / Math.PI, (Math.atan2(-dy, h) * 180) / Math.PI];
}
const dirOf = (yaw: number, pitch: number): P3 => {
  const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  return [-Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)];
};

export class Shots {
  markers = new Map<string, Marker>();
  private viewUntil = 0;
  private nextMark = 1;

  constructor(private a: Agent) {
    const g = a.game;
    g.overlays.push((r, cam) => this.drawMarkers(r, cam));
  }

  // ------------------------------------------------------------------ markers
  mark(p: Params) {
    const [lo, hi] = this.a.box(p.from, p.to);
    const id = String(p.id ?? `m${this.nextMark++}`);
    const hex = String(p.color ?? '#ffd400').replace('#', '');
    const n = parseInt(hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex, 16);
    if (!Number.isFinite(n)) throw new Error('color: #rrggbb');
    const ttl = Number(p.ttl ?? 0);
    this.markers.set(id, { id, lo, hi, color: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1], label: p.label ? String(p.label) : undefined, until: ttl > 0 ? performance.now() + ttl * 1000 : Infinity });
    return { id, from: lo, to: hi };
  }
  unmark(p: Params) {
    if (p.id === undefined) { const n = this.markers.size; this.markers.clear(); return { removed: n }; }
    return { removed: this.markers.delete(String(p.id)) ? 1 : 0 };
  }
  private drawMarkers(r: Renderer, cam: Camera) {
    if (!this.markers.size) return;
    const now = performance.now();
    for (const m of [...this.markers.values()]) {
      if (now > m.until) { this.markers.delete(m.id); continue; }
      const e = 0.01;
      const X0 = m.lo[0] - e - cam.x, Y0 = m.lo[1] - e - cam.y, Z0 = m.lo[2] - e - cam.z;
      const X1 = m.hi[0] + 1 + e - cam.x, Y1 = m.hi[1] + 1 + e - cam.y, Z1 = m.hi[2] + 1 + e - cam.z;
      const L = new Float32Array([
        X0, Y0, Z0, X1, Y0, Z0, X1, Y0, Z0, X1, Y0, Z1, X1, Y0, Z1, X0, Y0, Z1, X0, Y0, Z1, X0, Y0, Z0,
        X0, Y1, Z0, X1, Y1, Z0, X1, Y1, Z0, X1, Y1, Z1, X1, Y1, Z1, X0, Y1, Z1, X0, Y1, Z1, X0, Y1, Z0,
        X0, Y0, Z0, X0, Y1, Z0, X1, Y0, Z0, X1, Y1, Z0, X1, Y0, Z1, X1, Y1, Z1, X0, Y0, Z1, X0, Y1, Z1,
      ]);
      // faint through blocks, solid where seen
      r.drawLines(L, [m.color[0], m.color[1], m.color[2], 0.35], true);
      r.drawLines(L, m.color);
    }
  }
  /** Where a world point lands on the canvas (pixels), or null behind the camera. */
  project(x: number, y: number, z: number): [number, number] | null {
    const r = this.a.game.renderer, m = r.viewProj, c = r.cam;
    const px = x - c.x, py = y - c.y, pz = z - c.z;
    const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (cw <= 1e-6) return null;
    return [((cx / cw + 1) / 2) * r.canvas.width, ((1 - cy / cw) / 2) * r.canvas.height];
  }

  // ------------------------------------------------------------------ pictures
  /** Stream and draw the chunks around (x, z) too, waiting until those within `r` chunks are drawn. */
  private async see(x: number, z: number, r: number) {
    const g = this.a.game;
    const pr = g.player!;
    const far = Math.hypot(pr.x - x, pr.z - z) / 16 + r > g.world!.renderDistance - 1;
    // (a guest's tab can't ask the host to send more: it draws what it has)
    const sp = g.server?.players.find((p) => p.owner);
    if (far && sp) {
      const v = { x, z, r: r + 1 };
      sp.views = [v];
      g.views = [v];
      this.viewUntil = performance.now() + 30000;
    }
    const w = g.world!;
    const ccx = Math.floor(x) >> 4, ccz = Math.floor(z) >> 4;
    const done = () => {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + 0.5) continue;
        const c = w.getChunk(ccx + dx, ccz + dz);
        if (!c || !c.ready || c.meshedVersion < 0) return false;
      }
      return true;
    };
    const ok = await this.a.until(done, far && !sp ? 1500 : 20000);
    // a couple more frames so fresh meshes are uploaded and lighting settles
    for (let i = 0; i < 3; i++) await this.a.nextFrame();
    return ok;
  }
  /** Stop streaming extra areas once pictures haven't been taken for a while. */
  tick() {
    if (this.viewUntil && performance.now() > this.viewUntil) {
      this.viewUntil = 0;
      const g = this.a.game;
      g.views = [];
      const sp = g.server?.players.find((p) => p.owner);
      if (sp) sp.views = [];
    }
  }

  async shot(p: Params) {
    const a = this.a, g = a.game;
    const pl = g.player;
    if (!pl || !g.world) throw new Error('No world is open');
    const view = String(p.view ?? 'player');
    const fov = Number(p.fov ?? 70);
    let cam: Partial<Camera> | null = null;
    let focus: [number, number, number] | null = null; // x, z, chunk radius
    const eye: P3 = [pl.x, pl.y + pl.eyeHeight(), pl.z];
    switch (view) {
      case 'player': break;
      case 'camera': {
        const at = p.pos !== undefined ? a.pos(p.pos) : eye;
        let yaw = Number(p.yaw ?? pl.yaw), pitch = Number(p.pitch ?? pl.pitch);
        if (p.lookAt !== undefined) [yaw, pitch] = lookAngles(at, a.pos(p.lookAt, 'lookAt'));
        cam = { x: at[0], y: at[1], z: at[2], yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, fov };
        const d = dirOf(yaw, pitch);
        focus = [at[0] + d[0] * 24, at[2] + d[2] * 24, 3];
        break;
      }
      case 'orbit': {
        const c = p.center !== undefined ? a.pos(p.center, 'center') : a.pos('~ ~ ~');
        const dist = Number(p.distance ?? 24);
        const yaw = sideYaw(p.side ?? p.angle, 'se'), pitch = Number(p.pitch ?? 30);
        const d = dirOf(yaw, pitch);
        const at: P3 = [c[0] - d[0] * dist, c[1] - d[1] * dist, c[2] - d[2] * dist];
        cam = { x: at[0], y: at[1], z: at[2], yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, fov };
        focus = [c[0], c[2], Math.min(6, Math.ceil(dist / 16) + 1)];
        break;
      }
      case 'iso': case 'top': {
        const c = p.center !== undefined ? a.pos(p.center, 'center') : a.pos('~ ~ ~');
        const size = Math.max(4, Math.min(512, Number(p.size ?? 48)));
        const r = g.renderer;
        const yaw = view === 'top' ? 180 : sideYaw(p.side ?? p.angle, 'se');
        const pitch = view === 'top' ? 90 : Number(p.pitch ?? 35.264);
        cam = { x: c[0], y: c[1], z: c[2], yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, fov, ortho: ((size / 2) * r.height) / r.width };
        // a floor plan: nothing above `cut` (the camera sits just over that layer and draws only what's below it)
        if (view === 'top' && p.cut !== undefined) Object.assign(cam, { y: Math.floor(Number(p.cut)) + 1.02, near: 0, depth: Math.max(2, Number(p.depth ?? 24)), background: [0.1, 0.1, 0.12] });
        focus = [c[0], c[2], Math.min(10, Math.ceil(size / 2 / 16) + 1)];
        break;
      }
      default: throw new Error('view: player | camera | orbit | iso | top');
    }
    // a coordinate grid: lines every `grid` blocks on a level, labelled where they cross
    const step = Math.floor(Number(p.grid ?? 0));
    let grid: { step: number; y: number; x0: number; z0: number; x1: number; z1: number } | null = null;
    if (step > 0) {
      const mid = view === 'player' || view === 'camera' ? (p.lookAt !== undefined ? a.pos(p.lookAt) : [pl.x, pl.y, pl.z]) : p.center !== undefined ? a.pos(p.center) : [pl.x, pl.y, pl.z];
      const ext = view === 'iso' || view === 'top' ? Number(p.size ?? 48) / 2 + step : view === 'orbit' ? Number(p.distance ?? 24) : 32;
      const gy = p.gridY !== undefined ? Number(p.gridY) : Math.floor(mid[1]);
      const lo = (v: number) => Math.floor((v - ext) / step) * step, hi = (v: number) => Math.ceil((v + ext) / step) * step;
      grid = { step, y: gy, x0: lo(mid[0]), z0: lo(mid[2]), x1: hi(mid[0]), z1: hi(mid[2]) };
    }
    const drawGrid = (r: Renderer, c: Camera) => {
      if (!grid) return;
      const L: number[] = [], y = grid.y + 0.02 - c.y;
      for (let x = grid.x0; x <= grid.x1; x += grid.step) L.push(x - c.x, y, grid.z0 - c.z, x - c.x, y, grid.z1 - c.z);
      for (let z = grid.z0; z <= grid.z1; z += grid.step) L.push(grid.x0 - c.x, y, z - c.z, grid.x1 - c.x, y, z - c.z);
      r.drawLines(new Float32Array(L), [1, 1, 1, 0.55], true);
    };
    let complete = true;
    if (focus) complete = await this.see(focus[0], focus[1], focus[2]);
    else await this.a.nextFrame();
    // draw this frame from our camera and take it before anything else is drawn
    const hideMarks = p.mark === false;
    const keep = new Map(this.markers);
    if (hideMarks) this.markers.clear();
    const hud = !!p.hud && view === 'player';
    const hideHud = g.hideHud;
    let out: { mime: string; data: string; width: number; height: number };
    try {
      g.cameraOverride = cam;
      if (!hud) g.hideHud = true;
      if (grid) g.overlays.push(drawGrid);
      g.render();
      out = this.capture(p, hud, grid);
    } finally {
      const k = g.overlays.indexOf(drawGrid);
      if (k >= 0) g.overlays.splice(k, 1);
      g.cameraOverride = null;
      g.hideHud = hideHud;
      if (hideMarks) for (const [k, v] of keep) this.markers.set(k, v);
    }
    return { ...out, view, ...(complete ? {} : { note: 'Some chunks were still loading' }) };
  }

  private capture(p: Params, hud: boolean, grid: { step: number; y: number; x0: number; z0: number; x1: number; z1: number } | null) {
    const g = this.a.game, src = g.renderer.canvas;
    const want = Math.max(64, Math.min(src.width, Number(p.width ?? 960)));
    const k = want / src.width;
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * k);
    c.height = Math.round(src.height * k);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    if (hud) ctx.drawImage(g.ctx.canvas, 0, 0, c.width, c.height);
    // grid labels where lines cross, skipping ones that would overlap
    if (grid) {
      const fs = Math.max(10, Math.round(c.width / 90));
      ctx.font = `${fs}px sans-serif`;
      ctx.textAlign = 'center';
      const taken: [number, number, number, number][] = [];
      for (let x = grid.x0; x <= grid.x1; x += grid.step) for (let z = grid.z0; z <= grid.z1; z += grid.step) {
        const s = this.project(x, grid.y + 0.02, z);
        if (!s) continue;
        const px = s[0] * k, py = s[1] * k;
        if (px < 0 || py < fs || px > c.width || py > c.height) continue;
        const t = `${x},${z}`, tw = ctx.measureText(t).width + 4;
        const box: [number, number, number, number] = [px - tw / 2, py - fs, px + tw / 2, py + 3];
        if (taken.some((b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3])) continue;
        taken.push(box);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(box[0], box[1], tw, fs + 3);
        ctx.fillStyle = '#fff';
        ctx.fillText(t, px, py);
      }
      // which way is north
      const o = this.project((grid.x0 + grid.x1) / 2, grid.y, (grid.z0 + grid.z1) / 2), n = this.project((grid.x0 + grid.x1) / 2, grid.y, (grid.z0 + grid.z1) / 2 - grid.step);
      if (o && n) {
        const dx = n[0] - o[0], dy = n[1] - o[1], d = Math.hypot(dx, dy) || 1;
        const cx = c.width - 34, cy = 34;
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - (dx / d) * 18, cy - (dy / d) * 18); ctx.lineTo(cx + (dx / d) * 18, cy + (dy / d) * 18); ctx.stroke();
        ctx.font = `bold ${fs + 2}px sans-serif`;
        ctx.fillText('N', cx + (dx / d) * 28, cy + (dy / d) * 28 + 5);
      }
    }
    // marker labels
    if (p.mark !== false) {
      ctx.font = `bold ${Math.max(11, Math.round(c.width / 70))}px sans-serif`;
      ctx.textAlign = 'center';
      for (const m of this.markers.values()) {
        if (!m.label) continue;
        const s = this.project((m.lo[0] + m.hi[0] + 1) / 2, m.hi[1] + 1.4, (m.lo[2] + m.hi[2] + 1) / 2);
        if (!s) continue;
        const [x, y] = [s[0] * k, s[1] * k];
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        const tw = ctx.measureText(m.label).width;
        ctx.fillRect(x - tw / 2 - 4, y - parseInt(ctx.font.split(' ')[1]) - 2, tw + 8, parseInt(ctx.font.split(' ')[1]) + 8);
        ctx.fillStyle = `rgb(${m.color.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})`;
        ctx.fillText(m.label, x, y);
      }
    }
    const png = String(p.format ?? 'jpeg') === 'png';
    const url = c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88);
    return { mime: png ? 'image/png' : 'image/jpeg', data: url.slice(url.indexOf(',') + 1), width: c.width, height: c.height };
  }
}
