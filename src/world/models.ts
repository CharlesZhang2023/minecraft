// Box models for non-cube blocks. Shared by the mesher (rendering), physics (collision) and raycasting.
import { B, BLOCKS, OPAQUE, Render, T, idOf, metaOf, isStairs, isSlab, isFence, HORIZ, FACING6, FACING6_TO_FACE } from './blocks';

export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number; // in 1/16 units
  tex: number[]; // per face texture layer (6)
  rot?: number[]; // per face uv rotation (0-3)
  skip?: number; // bitmask of faces not to draw
  cullSame?: boolean; // cull boundary faces against the same block id
  uv?: (number[] | null)[]; // per face explicit uv rect [u0, v0, u1, v1] (16ths), before rotation
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

/** A 2x5x2 redstone torch post (repeaters/comparators) using the flame end of the torch texture. */
function torchBox(x: number, y: number, z: number, t: number, h = 5): Box {
  const side = [7, 6, 9, 6 + h];
  return box(x, y, z, x + 2, y + h, z + 2, t, { skip: 1 << 2, uv: [side, side, null, [7, 6, 9, 8], side, side] });
}

/** Is a repeater locked by a powered repeater/comparator pointing into its side? */
export function repeaterLocked(meta: number, nb: Neighbor): boolean {
  const facing = meta & 3;
  for (const s of [(facing + 1) & 3, (facing + 3) & 3]) {
    const [dx, dz] = HORIZ[s];
    const v = nb(dx, 0, dz), id = idOf(v), m = metaOf(v);
    const pointsIn = (m & 3) === ((s + 2) & 3);
    if (pointsIn && (id === B.POWERED_REPEATER || (id === B.COMPARATOR && (m & 8)))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- 6-way orientation
const FACE_N: number[][] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const faceOfDir = (d: number[]) => FACE_N.findIndex((n) => n[0] === d[0] && n[1] === d[1] && n[2] === d[2]);
/** World direction that texture-up (decreasing v) points to on face f with uv rotation r. */
const UPDIR: number[][][] = FACE_N.map((n, f) => {
  const uvAt = (p: number[]): [number, number] => {
    const [x, y, z] = p;
    let u: number, v: number;
    switch (f) {
      case 0: u = z; v = 1 - y; break;
      case 1: u = 1 - z; v = 1 - y; break;
      case 2: case 3: u = x; v = z; break;
      case 4: u = 1 - x; v = 1 - y; break;
      default: u = x; v = 1 - y;
    }
    return [u, v];
  };
  const axes = [0, 1, 2].filter((a) => n[a] === 0);
  return [0, 1, 2, 3].map((r) => {
    const rv = (p: number[]) => { let [u, v] = uvAt(p); for (let k = 0; k < r; k++) { const t = u; u = 1 - v; v = t; } return v; };
    const c = [0.5, 0.5, 0.5];
    for (const a of axes) {
      const p = c.slice(); p[a] += 0.1;
      const dv = rv(p) - rv(c);
      if (Math.abs(dv) > 1e-6) { const d = [0, 0, 0]; d[a] = dv < 0 ? 1 : -1; return d; }
    }
    return [0, 1, 0];
  });
});
/** uv rotation for face f so that texture-up points along dir. */
export function rotFor(f: number, dir: readonly number[]): number {
  for (let r = 0; r < 4; r++) { const u = UPDIR[f][r]; if (u[0] === dir[0] && u[1] === dir[1] && u[2] === dir[2]) return r; }
  return 0;
}
// rotation matrices taking +y to each FACING6 direction (rows applied to column vectors)
const ROT6: number[][][] = [
  [[1, 0, 0], [0, -1, 0], [0, 0, -1]], // down
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], // up
  [[1, 0, 0], [0, 0, 1], [0, -1, 0]], // north: y -> -z
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], // south: y -> +z
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]], // west: y -> -x
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], // east: y -> +x
];
const mul = (m: number[][], v: readonly number[]) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

/** Rotate a box authored facing up (+y) to a FACING6 direction; side textures keep "up" toward the front. */
export function orient6(b: Box, facing: number): Box {
  const m = ROT6[facing];
  const a = mul(m, [b.x0 - 8, b.y0 - 8, b.z0 - 8]), c = mul(m, [b.x1 - 8, b.y1 - 8, b.z1 - 8]);
  const tex = new Array(6).fill(0), rot = new Array(6).fill(0), uv: (number[] | null)[] = new Array(6).fill(null);
  let skip = 0;
  const front = mul(m, [0, 1, 0]);
  for (let f = 0; f < 6; f++) {
    const nf = faceOfDir(mul(m, FACE_N[f]));
    tex[nf] = b.tex[f];
    if (b.skip && b.skip & (1 << f)) skip |= 1 << nf;
    if (b.uv?.[f]) uv[nf] = b.uv[f];
    // authored "up" of this face's texture, carried through the rotation
    const authoredUp = f === 2 || f === 3 ? [0, 0, -1] : [0, 1, 0];
    const upDir = f === 2 || f === 3 ? mul(m, authoredUp) : front;
    rot[nf] = (rotFor(nf, upDir) + (b.rot?.[f] ?? 0)) & 3;
  }
  return {
    ...b,
    x0: Math.min(a[0], c[0]) + 8, y0: Math.min(a[1], c[1]) + 8, z0: Math.min(a[2], c[2]) + 8,
    x1: Math.max(a[0], c[0]) + 8, y1: Math.max(a[1], c[1]) + 8, z1: Math.max(a[2], c[2]) + 8,
    tex, rot, skip, uv: b.uv ? uv : undefined,
  };
}

/** Piston head (plate + arm) facing a FACING6 direction; offset shifts it back toward the base (moving pistons). */
export function pistonHeadBoxes(facing: number, sticky: boolean, _offset: number): Box[] {
  const front = sticky ? T.pistonTopSticky : T.pistonTop;
  const s = T.pistonSide;
  const arm = [0, 4, 16, 8];
  return [
    orient6(box(0, 12, 0, 16, 16, 16, [s, s, T.pistonTop, front, s, s]), facing),
    orient6(box(6, -4, 6, 10, 12, 10, [s, s, s, s, s, s], { skip: 0b001100, uv: [arm, arm, null, null, arm, arm], rot: [1, 1, 0, 0, 1, 1] }), facing),
  ];
}

/** Face textures and uv rotations for 6-way oriented cubes (dispenser, dropper, observer). */
export function facing6CubeFaces(id: number, meta: number, tex: Int32Array, rot: Int8Array) {
  const fc = meta & 7;
  const def = BLOCKS[id];
  const frontFace = FACING6_TO_FACE[fc];
  const backFace = frontFace ^ 1;
  const vertical = fc < 2;
  if (id === B.OBSERVER) {
    const dir = FACING6[fc];
    const back = [-dir[0], -dir[1], -dir[2]];
    for (let f = 0; f < 6; f++) {
      tex[f] = def.faces[0];
      rot[f] = rotFor(f, back);
    }
    tex[frontFace] = def.faces[6];
    tex[backFace] = meta & 8 ? T.observerBackOn : T.observerBack;
    rot[frontFace] = rot[backFace] = vertical ? rotFor(frontFace, [0, 0, -1]) : 0;
    // the two faces whose texture "up" would be along the axis use the top texture
    for (let f = 0; f < 6; f++) if (f !== frontFace && f !== backFace && (f >> 1) === (vertical ? 2 : 1)) tex[f] = def.faces[3];
    return;
  }
  for (let f = 0; f < 6; f++) { tex[f] = f === 2 || f === 3 ? T.furnaceTop : def.faces[0]; rot[f] = 0; }
  if (vertical) {
    for (let f = 0; f < 6; f++) tex[f] = T.furnaceTop;
    tex[frontFace] = id === B.DISPENSER ? T.dispenserFrontV : T.dropperFrontV;
  } else tex[frontFace] = def.faces[6];
}

/** Which horizontal sides (N,E,S,W) a redstone wire connects to (including up/down steps). */
export function wireConnections(nb: Neighbor): boolean[] {
  const comp = (v: number) => {
    const id = idOf(v);
    return id === B.REDSTONE_WIRE || id === B.LEVER || id === B.STONE_BUTTON || id === B.STONE_PRESSURE_PLATE || id === B.REDSTONE_TORCH || id === B.UNLIT_REDSTONE_TORCH || id === B.REDSTONE_BLOCK;
  };
  const aboveOpaque = OPAQUE[idOf(nb(0, 1, 0))] === 1;
  return HORIZ.map(([dx, dz]) => {
    if (comp(nb(dx, 0, dz))) return true;
    if (!aboveOpaque && idOf(nb(dx, 1, dz)) === B.REDSTONE_WIRE) return true;
    if (OPAQUE[idOf(nb(dx, 0, dz))] !== 1 && idOf(nb(dx, -1, dz)) === B.REDSTONE_WIRE) return true;
    return false;
  });
}

const connectsFence = (self: number, v: number) => {
  const id = idOf(v);
  return id === self || OPAQUE[id] === 1;
};
const connectsPane = (v: number) => {
  const id = idOf(v);
  return id === B.GLASS_PANE || id === B.GLASS || id === B.IRON_BARS || OPAQUE[id] === 1;
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
    case B.ENDER_CHEST: {
      const b = box(1, 0, 1, 15, 14, 15, [T.enderChestSide, T.enderChestSide, T.enderChestTop, T.enderChestTop, T.enderChestFront, T.enderChestSide]);
      return [rotY(b, meta & 3)];
    }
    case B.END_PORTAL_FRAME: {
      const t = T.endFrameSide;
      const out = [box(0, 0, 0, 16, 13, 16, [t, t, T.endStone, T.endFrameTop, t, t])];
      if (meta & 4) out.push(box(4, 13, 4, 12, 16, 12, T.endFrameEye));
      return out;
    }
    case B.END_PORTAL:
      return [box(0, 0, 0, 16, 12, 16, T.endPortal, { skip: 0b110111 })];
    case B.DRAGON_EGG: {
      // an egg built from stacked slices (widest near the bottom third)
      const t = f[0];
      const slices: [number, number, number][] = [[0, 1, 6], [1, 2, 8], [2, 3, 10], [3, 5, 14], [5, 8, 16], [8, 10, 14], [10, 12, 12], [12, 14, 10], [14, 15, 6], [15, 16, 4]];
      return slices.map(([y0, y1, w]) => box(8 - w / 2, y0, 8 - w / 2, 8 + w / 2, y1, 8 + w / 2, t));
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
    case B.OAK_FENCE:
    case B.NETHER_BRICK_FENCE: {
      const t = f[0];
      const boxes = [box(6, 0, 6, 10, 16, 10, t)];
      if (nb) {
        const dirs: [number, number, number, number, number, number, number, number][] = [
          [0, -1, 7, 0, 9, 6, 0, 0], [1, 0, 10, 7, 16, 9, 0, 0], [0, 1, 7, 10, 9, 16, 0, 0], [-1, 0, 0, 7, 6, 9, 0, 0],
        ];
        for (const [dx, dz, x0, z0, x1, z1] of dirs)
          if (connectsFence(id, nb(dx, 0, dz))) {
            boxes.push(box(x0, 12, z0, x1, 15, z1, t));
            boxes.push(box(x0, 6, z0, x1, 9, z1, t));
          }
      }
      return boxes;
    }
    case B.GLASS_PANE:
    case B.IRON_BARS: {
      const t = f[0], e = id === B.IRON_BARS ? T.ironBarsTop : T.glassPaneTop;
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
    case B.SOUL_SAND:
      return [box(0, 0, 0, 16, 14, 16, f[0])];
    case B.NETHER_PORTAL:
      return meta & 1 ? [box(6, 0, 0, 10, 16, 16, T.portal, { cullSame: true })] : [box(0, 0, 6, 16, 16, 10, T.portal, { cullSame: true })];
    case B.REDSTONE_WIRE: {
      const h = 0.25;
      const out: Box[] = [box(0, 0, 0, 16, h, 16, T.dustDot, { skip: 0b110011 })];
      if (nb) {
        const conn = wireConnections(nb);
        const arms: [number, number, number, number, number][] = [[0, 0, 16, 8, 0], [8, 0, 16, 16, 1], [0, 8, 16, 16, 0], [0, 0, 8, 16, 1]];
        HORIZ.forEach((_, i) => {
          if (!conn[i]) return;
          const [ax0, az0, ax1, az1, r] = [arms[i][0], arms[i][1], arms[i][2], arms[i][3], arms[i][4]];
          out.push(box(ax0, 0.01, az0, ax1, h + 0.01, az1, T.dustLine, { skip: 0b110111, rot: [0, 0, 0, r, 0, 0] }));
        });
      }
      return out;
    }
    case B.LEVER: {
      const on = (meta & 8) !== 0, at = meta & 7;
      if (at === 0) return [box(5, 0, 4, 11, 3, 12, T.cobble), box(7, 3, on ? 5 : 9, 9, 11, on ? 7 : 11, T.lever)];
      return [rotY(box(5, 4, 0, 11, 12, 3, T.cobble), (at - 1) & 3), rotY(box(7, on ? 9 : 5, 3, 9, on ? 11 : 7, 11, T.lever), (at - 1) & 3)];
    }
    case B.STONE_BUTTON: {
      const pressed = (meta & 8) !== 0, at = meta & 7;
      if (at === 0) return [box(5, 0, 6, 11, pressed ? 1 : 2, 10, T.stone)];
      return [rotY(box(5, 6, 0, 11, 10, pressed ? 1 : 2, T.stone), (at - 1) & 3)];
    }
    case B.ENCHANTING_TABLE:
      return [box(0, 0, 0, 16, 12, 16, [f[0], f[1], f[2], f[3], f[4], f[5]])];
    case B.STONE_PRESSURE_PLATE:
      return [box(1, 0, 1, 15, meta ? 0.5 : 1, 15, T.stone)];
    case B.LILY_PAD:
      return [box(0, 0, 0, 16, 0.25, 16, T.lilyPad, { skip: 0b110011, rot: [0, 0, meta & 3, meta & 3, 0, 0] })];
    case B.REPEATER:
    case B.POWERED_REPEATER: {
      const on = id === B.POWERED_REPEATER, facing = meta & 3, delay = (meta >> 2) & 3;
      const tt = on ? T.repeaterTorchOn : T.repeaterTorchOff;
      const out = [rotY(box(0, 0, 0, 16, 2, 16, [T.smoothStone, T.smoothStone, T.smoothStone, f[3], T.smoothStone, T.smoothStone]), facing)];
      out.push(rotY(torchBox(7, 2, 2, tt), facing));
      const locked = nb ? repeaterLocked(meta, nb) : false;
      if (locked) out.push(rotY(box(2, 2, 6 + delay * 2, 14, 4, 8 + delay * 2, T.bedrock), facing));
      else out.push(rotY(torchBox(7, 2, 6 + delay * 2, tt), facing));
      return out;
    }
    case B.COMPARATOR: {
      const facing = meta & 3, sub = (meta & 4) !== 0, on = (meta & 8) !== 0;
      const top = on ? T.comparatorOn : f[3];
      const tb = on ? T.repeaterTorchOn : T.repeaterTorchOff;
      return [
        rotY(box(0, 0, 0, 16, 2, 16, [T.smoothStone, T.smoothStone, T.smoothStone, top, T.smoothStone, T.smoothStone]), facing),
        rotY(torchBox(4, 2, 11, tb), facing),
        rotY(torchBox(10, 2, 11, tb), facing),
        rotY(torchBox(7, sub ? 2 : 0, 2, sub ? T.repeaterTorchOn : T.repeaterTorchOff, sub ? 5 : 4), facing),
      ];
    }
    case B.HOPPER: {
      const o = f[0], t = f[3], ins = T.hopperInside;
      const out = [
        box(0, 10, 0, 16, 11, 16, [o, o, o, ins, o, o]),
        box(0, 11, 0, 2, 16, 16, [o, ins, o, t, o, o]),
        box(14, 11, 0, 16, 16, 16, [ins, o, o, t, o, o]),
        box(2, 11, 0, 14, 16, 2, [o, o, o, t, o, ins]),
        box(2, 11, 14, 14, 16, 16, [o, o, o, t, ins, o]),
        box(4, 4, 4, 12, 10, 12, o),
      ];
      const fc = meta & 7;
      if (fc === 0 || fc === 1) out.push(box(6, 0, 6, 10, 4, 10, o));
      else {
        const [dx, , dz] = FACING6[fc];
        out.push(box(dx > 0 ? 12 : dx < 0 ? 0 : 6, 4, dz > 0 ? 12 : dz < 0 ? 0 : 6, dx > 0 ? 16 : dx < 0 ? 4 : 10, 8, dz > 0 ? 16 : dz < 0 ? 4 : 10, o));
      }
      return out;
    }
    case B.PISTON:
    case B.STICKY_PISTON: {
      const fc = meta & 7, ext = (meta & 8) !== 0;
      const front = id === B.STICKY_PISTON ? T.pistonTopSticky : T.pistonTop;
      if (!ext) return [orient6(box(0, 0, 0, 16, 16, 16, [T.pistonSide, T.pistonSide, f[2], front, T.pistonSide, T.pistonSide]), fc)];
      return [orient6(box(0, 0, 0, 16, 12, 16, [T.pistonSide, T.pistonSide, f[2], T.pistonInner, T.pistonSide, T.pistonSide]), fc)];
    }
    case B.PISTON_HEAD:
      return pistonHeadBoxes(meta & 7, (meta & 8) !== 0, 0);
    case B.SLIME_BLOCK:
      return [box(0, 0, 0, 16, 16, 16, f[0], { cullSame: true }), box(3, 3, 3, 13, 13, 13, f[0], { uv: [[3, 3, 13, 13], [3, 3, 13, 13], [3, 3, 13, 13], [3, 3, 13, 13], [3, 3, 13, 13], [3, 3, 13, 13]] })];
    case B.BREWING_STAND: {
      const b = T.brewingStandBase, st = f[0];
      const out = [
        box(7, 0, 7, 9, 14, 9, st, { uv: [[7, 2, 9, 16], [7, 2, 9, 16], [7, 14, 9, 16], [7, 0, 9, 2], [7, 2, 9, 16], [7, 2, 9, 16]] }),
        box(9, 0, 5, 15, 2, 11, b), box(2, 0, 1, 8, 2, 7, b), box(2, 0, 9, 8, 2, 15, b),
      ];
      // bottle planes: east, north-west, south-west; left half of the texture = bottle, right half = empty arm
      const full = (k: number) => (meta & (1 << k)) !== 0;
      const r = (k: number): number[] => (full(k) ? [0, 0, 8, 16] : [16, 0, 8, 16]);
      out.push(box(8, 0, 8, 16, 16, 8, st, { skip: 0b001111, uv: [null, null, null, null, r(0), r(0)] }));
      out.push(box(8, 0, 0, 8, 16, 8, st, { skip: 0b111100, uv: [r(1), r(1), null, null, null, null] }));
      out.push(box(8, 0, 8, 8, 16, 16, st, { skip: 0b111100, uv: [r(2), r(2), null, null, null, null] }));
      return out;
    }
    case B.ANVIL: {
      const facing = meta & 3, dmg = (meta >> 2) & 3;
      const top = dmg === 1 ? T.anvilTopChipped : dmg === 2 ? T.anvilTopDamaged : f[3];
      const a = f[0];
      return [
        rotY(box(2, 0, 2, 14, 4, 14, a), facing),
        rotY(box(4, 4, 3, 12, 5, 13, a), facing),
        rotY(box(6, 5, 4, 10, 10, 12, a), facing),
        rotY(box(3, 10, 0, 13, 16, 16, [a, a, a, top, a, a], { rot: [0, 0, 1, 1, 0, 0] }), facing),
      ];
    }
  }
  return [box(0, 0, 0, 16, 16, 16, f.slice(0, 6))];
}

// ---------------------------------------------------------------- collision / selection shapes
export interface Shape { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
const FULL: Shape[] = [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }];
const cl = (v: number) => Math.max(0, Math.min(1, v / 16));
const toShape = (b: Box): Shape => ({ x0: cl(b.x0), y0: cl(b.y0), z0: cl(b.z0), x1: cl(b.x1), y1: cl(b.y1), z1: cl(b.z1) });

export function collisionShapes(v: number, nb?: Neighbor): Shape[] {
  const id = idOf(v);
  const def = BLOCKS[id];
  if (!def.solid) return [];
  if (def.render === Render.Cube) return FULL;
  if (isFence(id)) {
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
  if (id === B.SOUL_SAND) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 14 / 16, z1: 1 }];
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
