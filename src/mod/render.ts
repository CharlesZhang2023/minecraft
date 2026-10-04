// Drawing for mods: tile entity renderers (animated machine parts), entity renderers and world render hooks all
// get a RenderContext that writes into the frame's dynamic mesh, in world coordinates, lit like the world.
import type { Client } from '../client/client';
import type { DynMesh } from '../render/gl';
import { FACE_CORNERS, faceUV16, type EntityRenderer } from '../render/entityrender';
import type { Box } from '../world/models';
import { TEXTURES, BLOCKS, OPAQUE, FACE_DIRS, tex as texIndex } from '../world/blocks';
import { Mat4, mat4, identity, translate, multiply } from '../math';
import { TILE_RENDERERS, ENTITY_RENDERERS } from './hooks';
import { guard, isActive } from './state';
import { netType } from '../net/replicate';
import type { Entity } from '../entity/entity';

export interface RenderContext {
  /** Fraction of the current tick, for smooth motion. */
  readonly partial: number;
  /** Game ticks including the fraction: use it to animate. */
  readonly time: number;
  readonly cam: { readonly x: number; readonly y: number; readonly z: number };
  readonly client: Client;
  /** A texture layer by name (block textures; item sprites are 'item/<sprite>'). */
  tex(name: string): number;
  /** Sky and block light (0-15) at a block. */
  light(x: number, y: number, z: number): [number, number];
  /**
   * Boxes in 16ths (like block models) for the block at (x, y, z). `m`, in block units (0..1 is the block), moves
   * them first: e.g. turn around the block's centre for a spinning shaft.
   */
  boxes(boxes: Box[], x: number, y: number, z: number, m?: Mat4 | null, light?: [number, number], color?: number): void;
  /** Any block state's model at a world position (its corner). */
  block(v: number, x: number, y: number, z: number, light?: [number, number]): void;
  /** An item as dropped items look, centred at (x, y, z); `m` scales / turns it. */
  item(id: number, x: number, y: number, z: number, m?: Mat4 | null, light?: [number, number]): void;
  /** A camera-facing square. */
  billboard(x: number, y: number, z: number, size: number, layer: number, color?: number, light?: [number, number], alpha?: number): void;
  /** A quad from four world-space corners (counter-clockwise), uv in 0..1. */
  quad(p: readonly number[], layer: number, uv?: readonly number[], color?: number, alpha?: number, light?: [number, number]): void;
}

const NORMALS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];

export function makeRenderContext(client: Client, er: EntityRenderer, mesh: DynMesh, partial: number): RenderContext {
  const cam = client.renderer.cam, w = client.world!;
  /** Light at a block, or (inside a solid block, where it's dark) the brightest around it. */
  const light = (x: number, y: number, z: number): [number, number] => {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    let [s, b] = w.getLight(bx, by, bz);
    if (!OPAQUE[w.getId(bx, by, bz)]) return [s, b];
    for (const [dx, dy, dz] of FACE_DIRS) {
      const [s2, b2] = w.getLight(bx + dx, by + dy, bz + dz);
      if (s2 > s) s = s2;
      if (b2 > b) b = b2;
    }
    return [s, b];
  };
  const tmp = mat4();
  const r: RenderContext = {
    partial,
    time: client.ticks + partial,
    cam,
    client,
    tex: (name) => { const i = TEXTURES.indexOf(name); return i >= 0 ? i : texIndex(name); },
    light,
    boxes(boxes, x, y, z, m, lt, color = 0xffffff) {
      const [sky, blk] = lt ?? light(x, y, z);
      const ox = x - cam.x, oy = y - cam.y, oz = z - cam.z;
      for (const b of boxes) {
        for (let f = 0; f < 6; f++) {
          if (b.skip && b.skip & (1 << f)) continue;
          // shade by where the face points after the transform
          let [nx, ny, nz] = NORMALS[f];
          if (m) {
            const tx = m[0] * nx + m[4] * ny + m[8] * nz, ty = m[1] * nx + m[5] * ny + m[9] * nz, tz = m[2] * nx + m[6] * ny + m[10] * nz;
            const l = Math.hypot(tx, ty, tz) || 1;
            nx = tx / l; ny = ty / l; nz = tz / l;
          }
          const sh = nx * nx * 0.6 + ny * ny * (ny > 0 ? 1 : 0.5) + nz * nz * 0.8;
          const c = (((color >> 16) & 255) * sh) << 16 | (((color >> 8) & 255) * sh) << 8 | ((color & 255) * sh);
          const rect = b.uv?.[f], rot = b.rot?.[f] ?? 0;
          for (const k of FACE_CORNERS[f]) {
            const px = k[0] ? b.x1 : b.x0, py = k[1] ? b.y1 : b.y0, pz = k[2] ? b.z1 : b.z0;
            let u: number, vv: number;
            if (rect) {
              const d = faceUV16(f, k[0] * 16, k[1] * 16, k[2] * 16);
              u = rect[0] + ((rect[2] - rect[0]) * d[0]) / 16;
              vv = rect[1] + ((rect[3] - rect[1]) * d[1]) / 16;
            } else [u, vv] = faceUV16(f, px, py, pz);
            for (let q = 0; q < rot; q++) { const t = u; u = 16 - vv; vv = t; }
            let X = px / 16, Y = py / 16, Z = pz / 16;
            if (m) {
              const tx = m[0] * X + m[4] * Y + m[8] * Z + m[12], ty = m[1] * X + m[5] * Y + m[9] * Z + m[13], tz = m[2] * X + m[6] * Y + m[10] * Z + m[14];
              X = tx; Y = ty; Z = tz;
            }
            mesh.v(ox + X, oy + Y, oz + Z, u / 16, vv / 16, b.tex[f], c | 0, 1, sky, blk);
          }
        }
      }
    },
    block(v, x, y, z, lt) {
      const [sky, blk] = lt ?? light(x, y, z);
      er.blockModel(mesh, v, x - cam.x, y - cam.y, z - cam.z, sky, Math.max(blk, BLOCKS[v & 0xfff].light));
    },
    item(id, x, y, z, m, lt) {
      const [sky, blk] = lt ?? light(x, y, z);
      identity(tmp);
      translate(tmp, tmp, x - cam.x, y - cam.y, z - cam.z);
      if (m) multiply(tmp, tmp, m);
      er.appendItem(mesh, id, tmp, sky, blk);
    },
    billboard(x, y, z, size, layer, color = 0xffffff, lt, alpha = 1) {
      const [sky, blk] = lt ?? light(x, y, z);
      const s = size, X = x - cam.x, Y = y - cam.y, Z = z - cam.z;
      const rx = -Math.cos(cam.yaw) * s / 2, rz = -Math.sin(cam.yaw) * s / 2;
      const ux = -Math.sin(cam.yaw) * Math.sin(cam.pitch) * s / 2, uy = Math.cos(cam.pitch) * s / 2, uz = Math.cos(cam.yaw) * Math.sin(cam.pitch) * s / 2;
      mesh.v(X - rx - ux, Y - uy, Z - rz - uz, 0, 1, layer, color, alpha, sky, blk);
      mesh.v(X + rx - ux, Y - uy, Z + rz - uz, 1, 1, layer, color, alpha, sky, blk);
      mesh.v(X + rx + ux, Y + uy, Z + rz + uz, 1, 0, layer, color, alpha, sky, blk);
      mesh.v(X - rx + ux, Y + uy, Z - rz + uz, 0, 0, layer, color, alpha, sky, blk);
    },
    quad(p, layer, uv = [0, 0, 1, 1], color = 0xffffff, alpha = 1, lt) {
      const [sky, blk] = lt ?? light(p[0], p[1], p[2]);
      const us = [uv[0], uv[2], uv[2], uv[0]], vs = [uv[3], uv[3], uv[1], uv[1]];
      for (let i = 0; i < 4; i++) mesh.v(p[i * 3] - cam.x, p[i * 3 + 1] - cam.y, p[i * 3 + 2] - cam.z, us[i], vs[i], layer, color, alpha, sky, blk);
    },
  };
  return r;
}

/** Tile entity renderers for the tiles near the camera. */
export function drawModTiles(r: RenderContext) {
  if (!TILE_RENDERERS.size) return;
  const w = r.client.world!, cam = r.cam;
  const ccx = Math.floor(cam.x) >> 4, ccz = Math.floor(cam.z) >> 4;
  for (const c of w.chunks.values()) {
    if (!c.ready || !c.tiles.size || Math.abs(c.cx - ccx) > 4 || Math.abs(c.cz - ccz) > 4) continue;
    for (const [i, t] of c.tiles) {
      const tr = TILE_RENDERERS.get(t.type);
      if (!tr || !isActive(tr.mod)) continue;
      const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
      if ((x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2 > 64 * 64) continue;
      const v = c.blocks[i];
      guard(tr.mod, 'tile renderer', () => tr.draw(r, t as Record<string, unknown>, x, y, z, v), undefined);
    }
  }
}

/** A mod entity's renderer, if it has one. */
export function modEntityRenderer(e: Entity) {
  if (!ENTITY_RENDERERS.size) return null;
  const t = netType(e);
  const er = t ? ENTITY_RENDERERS.get(t) : undefined;
  return er && isActive(er.mod) ? er : null;
}
