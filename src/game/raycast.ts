import type { World } from '../world/world';
import { BLOCKS, idOf, metaOf, B } from '../world/blocks';
import { selectionShapes } from '../world/models';
import { rayAABB } from '../math';

export interface BlockHit {
  x: number; y: number; z: number;
  face: number; // 0..5 (-x,+x,-y,+y,-z,+z)
  t: number;
  hx: number; hy: number; hz: number; // hit point
}

export function raycastBlocks(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, fluids = false): BlockHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
  let t = 0;
  for (let i = 0; i < 200 && t <= maxDist; i++) {
    const v = world.get(x, y, z);
    const id = idOf(v);
    if (id !== 0) {
      const def = BLOCKS[id];
      if (def.selectable || (fluids && def.fluid && metaOf(v) === 0)) {
        const shapes = def.fluid ? [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }] : selectionShapes(v, (a, b, c) => world.get(x + a, y + b, z + c));
        let best: BlockHit | null = null;
        for (const s of shapes) {
          const r = rayAABB(ox, oy, oz, dx, dy, dz, { x0: x + s.x0, y0: y + s.y0, z0: z + s.z0, x1: x + s.x1, y1: y + s.y1, z1: z + s.z1 }, maxDist);
          if (r && r.face >= 0 && (!best || r.t < best.t)) best = { x, y, z, face: r.face, t: r.t, hx: ox + dx * r.t, hy: oy + dy * r.t, hz: oz + dz * r.t };
        }
        if (best) return best;
      }
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; }
    else { z += sz; t = tmz; tmz += tdz; }
  }
  return null;
}

export function isReplaceable(id: number) {
  return BLOCKS[id].replaceable || id === B.AIR;
}
