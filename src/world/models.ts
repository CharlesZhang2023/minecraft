// Box models for non-cube blocks. Shared by the mesher (rendering), physics (collision) and raycasting.
import { B, BLOCKS, OPAQUE, Render, T, idOf, metaOf, isStairs, isSlab, HORIZ } from './blocks';

export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number; // in 1/16 units
  tex: number[]; // per face texture layer (6)
  rot?: number[]; // per face uv rotation (0-3)
  skip?: number; // bitmask of faces not to draw
  cullSame?: boolean; // cull boundary faces against the same block id
}

export type Neighbor = (dx: number, dy: number, dz: number) => number;

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: number[] | number, extra: Partial<Box> = {}): Box => ({
  x0, y0, z0, x1, y1, z1, tex: Array.isArray(tex) ? tex : [tex, tex, tex, tex, tex, tex], ...extra,
});

/** rotate a box (in 16ths) around the block's vertical axis by facing (0 = north, as authored). */
function rotY(b: Box, facing: number): Box {
  let { x0, z0, x1, z1 } = b;
  for (let i = 0; i < facing; i++) {
    // 90° clockwise seen from above: (x, z) -> (16 - z, x)
    const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;
    x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
  }
  // rotate side face textures accordingly: face order -x,+x,-y,+y,-z,+z
  const t = b.tex.slice();
  const ring = [4, 1, 5, 0]; // north, east, south, west faces in clockwise order
  const out = t.slice();
  for (let i = 0; i < 4; i++) out[ring[(i + facing) % 4]] = t[ring[i]];
  const skip = b.skip ?? 0;
  let ns = skip & 0b001100;
  for (let i = 0; i < 4; i++) if (skip & (1 << ring[i])) ns |= 1 << ring[(i + facing) % 4];
  return { ...b, x0, x1, z0, z1, tex: out, skip: ns, rot: [0, 0, facing, facing, 0, 0] };
}

const connectsFence = (v: number) => {
  const id = idOf(v);
  return id === B.OAK_FENCE || (OPAQUE[id] === 1);
};
const connectsPane = (v: number) => {
  const id = idOf(v);
  return id === B.GLASS_PANE || id === B.GLASS || OPAQUE[id] === 1;
};

export function modelBoxes(v: number, nb?: Neighbor): Box[] {
  const id = idOf(v), meta = metaOf(v);
  const def = BLOCKS[id];
  const f = def.faces;
  if (isSlab(id)) {
    const top = meta === 1;
    return [box(0, top ? 8 : 0, 0, 16, top ? 16 : 8, 16, [f[0], f[1], f[2], f[3], f[4], f[5]])];
  }
  if (isStairs(id)) {
    const facing = meta & 3, upside = (meta & 4) !== 0;
    const t = f[0];
    const lower = upside ? box(0, 8, 0, 16, 16, 16, t) : box(0, 0, 0, 16, 8, 16, t);
    const upper = upside ? box(0, 0, 0, 16, 8, 8, t) : box(0, 8, 0, 16, 16, 8, t);
    return [lower, rotY(upper, facing)];
  }
  switch (id) {
    case B.FARMLAND:
      return [box(0, 0, 0, 16, 15, 16, [f[0], f[1], f[2], meta ? T.farmlandMoist : f[3], f[4], f[5]])];
    case B.SNOW:
      return [box(0, 0, 0, 16, 2, 16, f[0])];
    case B.CACTUS:
      return [box(1, 0, 1, 15, 16, 15, [f[0], f[1], f[2], f[3], f[4], f[5]], { cullSame: true })];
    case B.CHEST: {
      const b = box(1, 0, 1, 15, 14, 15, [T.chestSide, T.chestSide, T.chestTop, T.chestTop, T.chestFront, T.chestSide]);
      return [rotY(b, meta & 3)];
    }
    case B.LADDER: {
      // meta = direction of the supporting wall
      const b = box(0, 0, 0, 16, 16, 1, T.ladder, { skip: 0b001111 });
      return [rotY(b, meta & 3)];
    }
    case B.OAK_DOOR: {
      const upper = (meta & 8) !== 0, open = (meta & 4) !== 0;
      const facing = meta & 3;
      const t = upper ? T.doorTop : T.doorBottom;
      // closed door stands on the edge of the block opposite the facing direction
      const b = box(0, 0, 13, 16, 16, 16, [t, t, t, t, t, t]);
      return [rotY(b, (facing + (open ? 1 : 0)) % 4)];
    }
    case B.BED: {
      const head = (meta & 8) !== 0, facing = meta & 3;
      const top = head ? T.bedHeadTop : T.bedFootTop;
      const side = head ? T.bedHeadSide : T.bedFootSide;
      const end = head ? T.bedHeadEnd : T.bedFootEnd;
      // authored facing north: head at north end
      const b = box(0, 0, 0, 16, 9, 16, [side, side, T.bedBottom, top, head ? end : end, head ? end : end], { skip: head ? 1 << 5 : 1 << 4 });
      const r = rotY(b, facing);
      return [r];
    }
    case B.OAK_FENCE: {
      const t = f[0];
      const boxes = [box(6, 0, 6, 10, 16, 10, t)];
      if (nb) {
        const dirs: [number, number, number, number, number, number, number, number][] = [
          [0, -1, 7, 0, 9, 6, 0, 0], [1, 0, 10, 7, 16, 9, 0, 0], [0, 1, 7, 10, 9, 16, 0, 0], [-1, 0, 0, 7, 6, 9, 0, 0],
        ];
        for (const [dx, dz, x0, z0, x1, z1] of dirs)
          if (connectsFence(nb(dx, 0, dz))) {
            boxes.push(box(x0, 12, z0, x1, 15, z1, t));
            boxes.push(box(x0, 6, z0, x1, 9, z1, t));
          }
      }
      return boxes;
    }
    case B.GLASS_PANE: {
      const t = f[0], e = T.glassPaneTop;
      const conn = [false, false, false, false];
      if (nb) HORIZ.forEach(([dx, dz], i) => (conn[i] = connectsPane(nb(dx, 0, dz))));
      if (!conn.some((c) => c)) conn.fill(true);
      const boxes: Box[] = [box(7, 0, 7, 9, 16, 9, [t, t, e, e, t, t])];
      if (conn[0]) boxes.push(box(7, 0, 0, 9, 16, 7, [t, t, e, e, t, t], { skip: 1 << 5 }));
      if (conn[2]) boxes.push(box(7, 0, 9, 9, 16, 16, [t, t, e, e, t, t], { skip: 1 << 4 }));
      if (conn[1]) boxes.push(box(9, 0, 7, 16, 16, 9, [t, t, e, e, t, t], { skip: 1 << 0 }));
      if (conn[3]) boxes.push(box(0, 0, 7, 7, 16, 9, [t, t, e, e, t, t], { skip: 1 << 1 }));
      return boxes;
    }
    case B.LILY_PAD:
      return [box(0, 0, 0, 16, 0.25, 16, T.lilyPad, { skip: 0b110011, rot: [0, 0, meta & 3, meta & 3, 0, 0] })];
  }
  return [box(0, 0, 0, 16, 16, 16, f.slice(0, 6))];
}

// ---------------------------------------------------------------- collision / selection shapes
export interface Shape { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
const FULL: Shape[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }];
const toShape = (b: Box): Shape => ({ x0: b.x0 / 16, y0: b.y0 / 16, z0: b.z0 / 16, x1: b.x1 / 16, y1: b.y1 / 16, z1: b.z1 / 16 });

export function collisionShapes(v: number, nb?: Neighbor): Shape[] {
  const id = idOf(v);
  const def = BLOCKS[id];
  if (!def.solid) return [];
  if (def.render === Render.Cube) return FULL;
  if (id === B.OAK_FENCE) {
    return modelBoxes(v, nb).map(toShape).map((s) => ({ ...s, y0: 0, y1: 1.5 }));
  }
  if (id === B.LADDER) {
    const d = metaOf(v) & 3;
    const t = 3 / 16;
    return [[{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: t }], [{ x0: 1 - t, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }], [{ x0: 0, y0: 0, z0: 1 - t, x1: 1, y1: 1, z1: 1 }], [{ x0: 0, y0: 0, z0: 0, x1: t, y1: 1, z1: 1 }]][d];
  }
  if (id === B.OAK_DOOR) return modelBoxes(v, nb).map(toShape);
  if (id === B.LILY_PAD) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 64, z1: 1 }];
  if (id === B.SNOW) return [];
  if (def.render === Render.Model) return modelBoxes(v, nb).map(toShape);
  return FULL;
}

export function selectionShapes(v: number, nb?: Neighbor): Shape[] {
  const id = idOf(v);
  const def = BLOCKS[id];
  switch (def.render) {
    case Render.Cube: return FULL;
    case Render.Cross:
      if (id === B.SUGAR_CANE) return [{ x0: 2 / 16, y0: 0, z0: 2 / 16, x1: 14 / 16, y1: 1, z1: 14 / 16 }];
      if (id === B.TALL_GRASS || id === B.FERN) return [{ x0: 2 / 16, y0: 0, z0: 2 / 16, x1: 14 / 16, y1: 13 / 16, z1: 14 / 16 }];
      if (id === B.COBWEB) return FULL;
      return [{ x0: 5 / 16, y0: 0, z0: 5 / 16, x1: 11 / 16, y1: 10 / 16, z1: 11 / 16 }];
    case Render.Crops: return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: (2 + metaOf(v) * 2) / 16, z1: 1 }];
    case Render.Torch: {
      const m = metaOf(v);
      if (m === 0) return [{ x0: 6 / 16, y0: 0, z0: 6 / 16, x1: 10 / 16, y1: 10 / 16, z1: 10 / 16 }];
      const [dx, dz] = HORIZ[(m - 1) & 3];
      const cx = 0.5 + dx * 0.34, cz = 0.5 + dz * 0.34;
      return [{ x0: cx - 0.16, y0: 0.2, z0: cz - 0.16, x1: cx + 0.16, y1: 0.8, z1: cz + 0.16 }];
    }
    case Render.Model: {
      const shapes = modelBoxes(v, nb).map(toShape);
      if (id === B.LADDER) return collisionShapes(v, nb);
      if (id === B.LILY_PAD) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 16, z1: 1 }];
      return shapes;
    }
  }
  return [];
}
