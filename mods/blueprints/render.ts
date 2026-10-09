// Drawn into the world, glowing (added onto the scene, so it shows at night too): the selection's boxes and
// corners, each placement's outline, and a coloured box over every difference near the camera, in Litematica's
// colours: light blue missing, red wrong block, orange wrong state, magenta extra, purple unknown.
import type { Mc, RenderContext, Box as ModelBox } from '../sdk';
import { state, boxMin, boxMax, selectedPlacement } from './state';
import { allColumns, Mark } from './ghost';
import { layerShows } from './state';

let mc: Mc;
let white = -1;
export function initRender(m: Mc) { mc = m; }

const COLORS: Record<number, number> = {
  [Mark.Missing]: 0x0c2230, [Mark.WrongBlock]: 0x801818, [Mark.WrongState]: 0x804a10, [Mark.Extra]: 0x701a70, [Mark.Unknown]: 0x40206a,
};

export interface RenderOptions { radius: number; missing: boolean }

/** Twelve thin boxes along the edges of a cuboid of `size` blocks (drawn from its minimum corner). */
function edges(size: [number, number, number], t: number): ModelBox[] {
  const [X, Y, Z] = size.map((s) => s * 16);
  const out: ModelBox[] = [];
  const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => out.push(mc.box(x0, y0, z0, x1, y1, z1, white));
  for (const y of [0, Y]) for (const z of [0, Z]) b(-t, y - t, z - t, X + t, y + t, z + t);
  for (const x of [0, X]) for (const z of [0, Z]) b(x - t, -t, z - t, x + t, Y + t, z + t);
  for (const x of [0, X]) for (const y of [0, Y]) b(x - t, y - t, -t, x + t, y + t, Z + t);
  return out;
}

export function renderGlow(r: RenderContext, o: RenderOptions) {
  if (white < 0) white = r.tex('blueprints:white');
  const full: [number, number] = [15, 15];
  const cam = r.cam;
  const thin = (x: number, y: number, z: number) => Math.max(0.35, Math.min(2, Math.hypot(x - cam.x, y - cam.y, z - cam.z) / 24));
  // the selection: each box, its corners (the first one red, the second blue)
  state.boxes.forEach((b, i) => {
    const lo = boxMin(b), hi = boxMax(b);
    const active = i === state.active;
    r.boxes(edges([hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1], thin(lo[0], lo[1], lo[2])), lo[0], lo[1], lo[2], null, full, active ? 0xb0b0b0 : 0x606060);
    r.boxes(edges([1, 1, 1], 0.7), b.a[0], b.a[1], b.a[2], null, full, 0xc02020);
    r.boxes(edges([1, 1, 1], 0.7), b.b[0], b.b[1], b.b[2], null, full, 0x2040d0);
  });
  // placements: their outline (the selected one brighter), and the origin
  const sel = selectedPlacement();
  for (const p of state.placements) {
    if (!p.data.visible) continue;
    const size: [number, number, number] = [p.max[0] - p.min[0] + 1, p.max[1] - p.min[1] + 1, p.max[2] - p.min[2] + 1];
    r.boxes(edges(size, thin(p.min[0], p.min[1], p.min[2])), p.min[0], p.min[1], p.min[2], null, full, p === sel ? 0xb09020 : 0x405070);
    if (p === sel) r.boxes(edges([1, 1, 1], 0.9), p.data.origin[0], p.data.origin[1], p.data.origin[2], null, full, 0x20a040);
  }
  if (!state.highlights) return;
  // differences near the camera
  const R = o.radius, R2 = R * R;
  const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4, cr = Math.ceil(R / 16);
  const cube = [mc.box(-0.4, -0.4, -0.4, 16.4, 16.4, 16.4, white)];
  let drawn = 0;
  for (const c of allColumns()) {
    if (Math.abs(c.cx - ccx) > cr || Math.abs(c.cz - ccz) > cr) continue;
    for (const m of c.marks) {
      const kind = m >> 16;
      if (kind === Mark.Missing && !o.missing) continue;
      const i = m & 0xffff;
      const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
      if (!layerShows(y)) continue;
      if ((x + 0.5 - cam.x) ** 2 + (y + 0.5 - cam.y) ** 2 + (z + 0.5 - cam.z) ** 2 > R2) continue;
      r.boxes(cube, x, y, z, null, full, COLORS[kind]);
      if (++drawn > 6000) return;
    }
  }
}
