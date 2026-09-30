// Nether portals: frame detection, lighting, destination search and construction.
import type { World } from '../world/world';
import { B, BLOCKS, OPAQUE, pack, idOf, metaOf } from '../world/blocks';

export interface PortalFrame { x: number; y: number; z: number; width: number; height: number; axis: 0 | 1 }

const inside = (id: number) => id === B.AIR || id === B.FIRE || id === B.NETHER_PORTAL;

/** Detect an obsidian frame whose interior contains (x,y,z). axis 0: frame spans X, 1: spans Z. */
export function detectFrame(w: World, x: number, y: number, z: number, axis: 0 | 1): PortalFrame | null {
  const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
  if (!inside(w.getId(x, y, z))) return null;
  let yy = y;
  for (let n = 0; n < 22 && yy > 1 && inside(w.getId(x, yy - 1, z)); n++) yy--;
  if (w.getId(x, yy - 1, z) !== B.OBSIDIAN) return null;
  let lx = x, lz = z;
  for (let n = 0; n < 22 && inside(w.getId(lx - dx, yy, lz - dz)); n++) { lx -= dx; lz -= dz; }
  if (w.getId(lx - dx, yy, lz - dz) !== B.OBSIDIAN) return null;
  let width = 0;
  while (width < 22 && inside(w.getId(lx + dx * width, yy, lz + dz * width))) {
    if (w.getId(lx + dx * width, yy - 1, lz + dz * width) !== B.OBSIDIAN) return null;
    width++;
  }
  if (width < 2 || width > 21 || w.getId(lx + dx * width, yy, lz + dz * width) !== B.OBSIDIAN) return null;
  let height = 0;
  outer: for (; height < 22; height++) {
    const y2 = yy + height;
    if (w.getId(lx - dx, y2, lz - dz) !== B.OBSIDIAN || w.getId(lx + dx * width, y2, lz + dz * width) !== B.OBSIDIAN) break;
    for (let i = 0; i < width; i++) if (!inside(w.getId(lx + dx * i, y2, lz + dz * i))) break outer;
  }
  if (height < 3 || height > 21) return null;
  for (let i = 0; i < width; i++) if (w.getId(lx + dx * i, yy + height, lz + dz * i) !== B.OBSIDIAN) return null;
  return { x: lx, y: yy, z: lz, width, height, axis };
}

export function frameBlocks(f: PortalFrame): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const dx = f.axis === 0 ? 1 : 0, dz = f.axis === 0 ? 0 : 1;
  for (let i = 0; i < f.width; i++)
    for (let j = 0; j < f.height; j++) out.push([f.x + dx * i, f.y + j, f.z + dz * i, pack(B.NETHER_PORTAL, f.axis)]);
  return out;
}

/** Try to light a portal from a position inside a frame. */
export function findFrameAt(w: World, x: number, y: number, z: number): PortalFrame | null {
  return detectFrame(w, x, y, z, 0) ?? detectFrame(w, x, y, z, 1);
}

/** A portal block stays only while it is enclosed along its axis. */
export function portalCanStay(w: World, x: number, y: number, z: number): boolean {
  const axis = metaOf(w.get(x, y, z)) & 1;
  const ok = (id: number) => id === B.NETHER_PORTAL || id === B.OBSIDIAN;
  if (!ok(w.getId(x, y - 1, z)) || !ok(w.getId(x, y + 1, z))) return false;
  if (axis === 0) return ok(w.getId(x - 1, y, z)) && ok(w.getId(x + 1, y, z));
  return ok(w.getId(x, y, z - 1)) && ok(w.getId(x, y, z + 1));
}

/** Search loaded chunks around (x,z) for an existing portal; returns the lowest portal block. */
export function findPortal(w: World, x: number, z: number, radius: number): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestD = Infinity;
  const r2 = radius * radius;
  for (const c of w.chunks.values()) {
    if (!c.ready) continue;
    const ccx = c.cx * 16 + 8, ccz = c.cz * 16 + 8;
    if ((ccx - x) ** 2 + (ccz - z) ** 2 > (radius + 12) ** 2) continue;
    const b = c.blocks;
    for (let i = 0; i < b.length; i++) {
      if ((b[i] & 0xfff) !== B.NETHER_PORTAL) continue;
      const bx = c.cx * 16 + (i & 15), bz = c.cz * 16 + ((i >> 4) & 15), by = i >> 8;
      if (idOf(w.get(bx, by - 1, bz)) === B.NETHER_PORTAL) continue;
      const d = (bx - x) ** 2 + (bz - z) ** 2;
      if (d <= r2 && d < bestD) { bestD = d; best = [bx, by, bz]; }
    }
  }
  return best;
}

/** Build a 4x5 obsidian portal near (x,y,z), returning where the player should stand. */
export function buildPortal(w: World, x: number, y: number, z: number, minY: number, maxY: number, set: (c: [number, number, number, number][]) => void): [number, number, number] {
  const fits = (px: number, py: number, pz: number) => {
    for (let i = -1; i <= 2; i++)
      for (let j = 0; j <= 3; j++)
        for (let k = -1; k <= 1; k++) {
          const id = w.getId(px + i, py + j, pz + k);
          if (id !== B.AIR && !BLOCKS[id].replaceable) return false;
          if (BLOCKS[id].fluid) return false;
        }
    for (let i = -1; i <= 2; i++) for (let k = -1; k <= 1; k++) if (!OPAQUE[w.getId(px + i, py - 1, pz + k)]) return false;
    return true;
  };
  let found: [number, number, number] | null = null;
  outer: for (let r = 0; r <= 16; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let yy = maxY; yy >= minY; yy--) if (fits(x + dx, yy, z + dz)) { found = [x + dx, yy, z + dz]; break outer; }
      }
  let [px, py, pz] = found ?? [x, Math.max(minY, Math.min(maxY, y)), z];
  const changes: [number, number, number, number][] = [];
  if (!found) {
    // no room: carve a chamber and a platform
    for (let i = -2; i <= 3; i++)
      for (let k = -2; k <= 2; k++) {
        changes.push([px + i, py - 1, pz + k, B.OBSIDIAN]);
        for (let j = 0; j <= 4; j++) changes.push([px + i, py + j, pz + k, B.AIR]);
      }
  }
  for (let i = -1; i <= 2; i++)
    for (let j = -1; j <= 3; j++) {
      const frame = i === -1 || i === 2 || j === -1 || j === 3;
      changes.push([px + i, py + j, pz, frame ? B.OBSIDIAN : pack(B.NETHER_PORTAL, 0)]);
    }
  set(changes);
  return [px + 1, py, pz + 0.5];
}
