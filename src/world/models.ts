// Box models for non-cube blocks. Shared by the mesher (rendering), physics (collision) and raycasting.
import { B, B2, BLOCKS, OPAQUE, REDSTONE, Render, T, T2, idOf, metaOf, isStairs, isFence, HORIZ, FACING6, FACING6_TO_FACE, SHAPE, Shape as BS, BED_TEX, SHULKER_BOXES, WOOD } from './blocks';

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
export function rotY(b: Box, facing: number): Box {
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

const wireComp = (v: number) => {
  const id = idOf(v);
  return id === B.REDSTONE_WIRE || id === B.LEVER || SHAPE[id] === BS.Button || SHAPE[id] === BS.Plate || id === B.REDSTONE_TORCH || id === B.UNLIT_REDSTONE_TORCH || id === B.REDSTONE_BLOCK || id === B.DETECTOR_RAIL || id === B2.TARGET || id === B2.DAYLIGHT_DETECTOR || REDSTONE[id] === 1;
};

/** Which horizontal sides (N,E,S,W) a redstone wire connects to (including up/down steps). */
export function wireConnections(nb: Neighbor): boolean[] {
  const aboveOpaque = OPAQUE[idOf(nb(0, 1, 0))] === 1;
  return HORIZ.map(([dx, dz]) => {
    if (wireComp(nb(dx, 0, dz))) return true;
    if (!aboveOpaque && idOf(nb(dx, 1, dz)) === B.REDSTONE_WIRE) return true;
    if (OPAQUE[idOf(nb(dx, 0, dz))] !== 1 && idOf(nb(dx, -1, dz)) === B.REDSTONE_WIRE) return true;
    return false;
  });
}

/** Sides (N,E,S,W) where the wire climbs the face of a solid block to dust on top of it. */
export function wireClimbs(nb: Neighbor): boolean[] {
  if (OPAQUE[idOf(nb(0, 1, 0))] === 1) return [false, false, false, false];
  return HORIZ.map(([dx, dz]) => OPAQUE[idOf(nb(dx, 0, dz))] === 1 && idOf(nb(dx, 1, dz)) === B.REDSTONE_WIRE);
}

const wooden = (id: number) => BLOCKS[id].material === 'wood' || BLOCKS[id].material === 'nether_wood';
/** A fence gate in direction `dir` (HORIZ) lines up with a fence or wall there (its axis runs across `dir`). */
const gateAligned = (v: number, dir: number) => SHAPE[idOf(v)] === BS.Gate && ((metaOf(v) & 1) !== (dir & 1));
/** Does a fence connect toward its neighbour v in direction dir: same kind of fence, a gate, or a solid block? */
const connectsFence = (self: number, v: number, dir = 0) => {
  const id = idOf(v);
  if (OPAQUE[id] === 1) return true;
  if (SHAPE[id] === BS.Fence) return id === self || (wooden(self) && wooden(id));
  return gateAligned(v, dir);
};
const connectsPane = (v: number) => {
  const id = idOf(v);
  return SHAPE[id] === BS.Pane || SHAPE[id] === BS.Wall || id === B.GLASS || OPAQUE[id] === 1 || BLOCKS[id].name.endsWith('stained_glass');
};
const connectsWall = (v: number, dir: number) => {
  const id = idOf(v);
  return SHAPE[id] === BS.Wall || SHAPE[id] === BS.Pane || OPAQUE[id] === 1 || gateAligned(v, dir);
};

/** Stair shapes: straight, outer corner left/right, inner corner left/right (vanilla's rules). */
export const enum StairShape { Straight, OuterLeft, OuterRight, InnerLeft, InnerRight }
export function stairShape(meta: number, nb: Neighbor | undefined): StairShape {
  if (!nb) return StairShape.Straight;
  const facing = meta & 3, half = meta & 4;
  const ccw = (facing + 3) & 3;
  const stairAt = (dir: number) => { const [dx, dz] = HORIZ[dir]; const v = nb(dx, 0, dz); return isStairs(idOf(v)) && (metaOf(v) & 4) === half ? metaOf(v) & 3 : -1; };
  // a different stair (or none) at dir: this one may turn toward it
  const differs = (dir: number) => stairAt(dir) !== facing;
  const behind = stairAt(facing);
  if (behind >= 0 && (behind & 1) !== (facing & 1) && differs((behind + 2) & 3)) return behind === ccw ? StairShape.OuterLeft : StairShape.OuterRight;
  const front = stairAt((facing + 2) & 3);
  if (front >= 0 && (front & 1) !== (facing & 1) && differs(front)) return front === ccw ? StairShape.InnerLeft : StairShape.InnerRight;
  return StairShape.Straight;
}

/** Boxes of the block families (shape-driven), or null for the shapes models leave to the per-block cases. */
function familyBoxes(id: number, meta: number, nb: Neighbor | undefined, f: number[]): Box[] | null {
  const faces = [f[0], f[1], f[2], f[3], f[4], f[5]];
  switch (SHAPE[id]) {
    case BS.Slab: {
      if (meta === 2) return [box(0, 0, 0, 16, 16, 16, faces)];
      const top = meta === 1;
      return [box(0, top ? 8 : 0, 0, 16, top ? 16 : 8, 16, faces)];
    }
    case BS.Stairs: {
      const facing = meta & 3, up = (meta & 4) !== 0;
      const y0 = up ? 0 : 8, y1 = up ? 8 : 16;
      const out = [up ? box(0, 8, 0, 16, 16, 16, faces) : box(0, 0, 0, 16, 8, 16, faces)];
      const parts: number[][] = [];
      switch (stairShape(meta, nb)) {
        case StairShape.Straight: parts.push([0, 0, 16, 8]); break;
        case StairShape.OuterLeft: parts.push([0, 0, 8, 8]); break;
        case StairShape.OuterRight: parts.push([8, 0, 16, 8]); break;
        case StairShape.InnerLeft: parts.push([0, 0, 16, 8], [0, 8, 8, 16]); break;
        case StairShape.InnerRight: parts.push([0, 0, 16, 8], [8, 8, 16, 16]); break;
      }
      for (const [x0, z0, x1, z1] of parts) out.push(rotY(box(x0, y0, z0, x1, y1, z1, faces), facing));
      // the rotation turned the side textures with it: stone-like stairs keep top/bottom straight
      for (const b of out) b.rot = undefined;
      return out;
    }
    case BS.Fence: {
      const t = f[0];
      const boxes = [box(6, 0, 6, 10, 16, 10, t)];
      if (nb) {
        const dirs: [number, number, number, number, number, number][] = [[0, -1, 7, 0, 9, 6], [1, 0, 10, 7, 16, 9], [0, 1, 7, 10, 9, 16], [-1, 0, 0, 7, 6, 9]];
        dirs.forEach(([dx, dz, x0, z0, x1, z1], d) => {
          if (connectsFence(id, nb(dx, 0, dz), d)) { boxes.push(box(x0, 12, z0, x1, 15, z1, t)); boxes.push(box(x0, 6, z0, x1, 9, z1, t)); }
        });
      }
      return boxes;
    }
    case BS.Wall: {
      const t = f[0];
      const conn = [false, false, false, false];
      if (nb) HORIZ.forEach(([dx, dz], d) => (conn[d] = connectsWall(nb(dx, 0, dz), d)));
      const above = nb ? idOf(nb(0, 1, 0)) : 0;
      const tall = OPAQUE[above] === 1 || SHAPE[above] === BS.Wall;
      const h = tall ? 16 : 14;
      const straight = (conn[0] && conn[2] && !conn[1] && !conn[3]) || (conn[1] && conn[3] && !conn[0] && !conn[2]);
      const boxes: Box[] = [];
      if (!straight || above !== 0) boxes.push(box(4, 0, 4, 12, 16, 12, t));
      if (conn[0]) boxes.push(box(5, 0, 0, 11, h, straight ? 8 : 4, t));
      if (conn[2]) boxes.push(box(5, 0, straight ? 8 : 12, 11, h, 16, t));
      if (conn[1]) boxes.push(box(straight ? 8 : 12, 0, 5, 16, h, 11, t));
      if (conn[3]) boxes.push(box(0, 0, 5, straight ? 8 : 4, h, 11, t));
      if (!boxes.length) boxes.push(box(4, 0, 4, 12, 16, 12, t));
      return boxes;
    }
    case BS.Gate: {
      const facing = meta & 3, open = (meta & 4) !== 0;
      const t = f[0];
      // a gate between two walls sits lower, like the walls' sides
      let dy = 0;
      if (nb) { const [lx, lz] = HORIZ[(facing + 1) & 3]; if (SHAPE[idOf(nb(lx, 0, lz))] === BS.Wall || SHAPE[idOf(nb(-lx, 0, -lz))] === BS.Wall) dy = -3; }
      const b = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => box(x0, y0 + dy, z0, x1, y1 + dy, z1, t);
      const out = [b(0, 5, 7, 2, 16, 9), b(14, 5, 7, 16, 16, 9)];
      if (!open) out.push(b(2, 6, 7, 14, 9, 9), b(2, 12, 7, 14, 15, 9), b(6, 9, 7, 10, 12, 9));
      else out.push(b(0, 6, 1, 2, 9, 7), b(0, 12, 1, 2, 15, 7), b(0, 9, 1, 2, 12, 3), b(14, 6, 1, 16, 9, 7), b(14, 12, 1, 16, 15, 7), b(14, 9, 1, 16, 12, 3));
      return out.map((x) => rotY(x, facing));
    }
    case BS.Pane: {
      const t = f[0], e = id === B.IRON_BARS ? T.ironBarsTop : id === B.GLASS_PANE ? T.glassPaneTop : f[3];
      const conn = [false, false, false, false];
      if (nb) HORIZ.forEach(([dx, dz], i) => (conn[i] = connectsPane(nb(dx, 0, dz))));
      if (!conn.some((c) => c)) conn.fill(true);
      const tx = [t, t, e, e, t, t];
      const boxes: Box[] = [box(7, 0, 7, 9, 16, 9, tx)];
      if (conn[0]) boxes.push(box(7, 0, 0, 9, 16, 7, tx, { skip: 1 << 5 }));
      if (conn[2]) boxes.push(box(7, 0, 9, 9, 16, 16, tx, { skip: 1 << 4 }));
      if (conn[1]) boxes.push(box(9, 0, 7, 16, 16, 9, tx, { skip: 1 << 0 }));
      if (conn[3]) boxes.push(box(0, 0, 7, 7, 16, 9, tx, { skip: 1 << 1 }));
      return boxes;
    }
    case BS.Door: {
      const upper = (meta & 8) !== 0, open = (meta & 4) !== 0;
      const t = upper ? f[3] : f[0];
      // a closed door stands on the edge of the block opposite the facing direction
      return [rotY(box(0, 0, 13, 16, 16, 16, t), ((meta & 3) + (open ? 1 : 0)) % 4)];
    }
    case BS.Trapdoor: {
      const facing = meta & 3, top = (meta & 4) !== 0, open = (meta & 8) !== 0;
      const t = f[0];
      if (open) return [rotY(box(0, 0, 13, 16, 16, 16, t), facing)];
      return [top ? box(0, 13, 0, 16, 16, 16, t) : box(0, 0, 0, 16, 3, 16, t)];
    }
    case BS.Button: {
      const pressed = (meta & 8) !== 0, at = meta & 7, d = pressed ? 1 : 2;
      if (at === 0) return [box(5, 0, 6, 11, d, 10, f[0])];
      if (at === 5) return [box(5, 16 - d, 6, 11, 16, 10, f[0])];
      return [rotY(box(5, 6, 0, 11, 10, d, f[0]), (at - 1) & 3)];
    }
    case BS.Plate:
      return [box(1, 0, 1, 15, meta ? 0.5 : 1, 15, f[0])];
    case BS.Carpet:
      return [box(0, 0, 0, 16, 1, 16, f[0])];
    case BS.Sign: {
      const facing = Math.round(meta / 4) & 3;
      return [box(7, 0, 7, 9, 9, 9, f[0]), rotY(box(0, 9, 7, 16, 17, 9, f[0]), facing)];
    }
    case BS.WallSign:
      return [rotY(box(0, 4, 0, 16, 12, 2, f[0]), meta & 3)];
    case BS.Banner:
      return [box(7.4, 0, 7.4, 8.6, 16, 8.6, f[0])];
    case BS.WallBanner:
      return [rotY(box(0, 14, 0, 16, 16, 2, f[0]), meta & 3)];
    case BS.Lantern: {
      const hang = meta & 1 ? 1 : 0;
      const t = f[0], side = [4, 3, 12, 10];
      return [
        box(5, hang, 5, 11, 7 + hang, 11, t, { uv: [side, side, [5, 4, 11, 10], [5, 4, 11, 10], side, side] }),
        box(6, 7 + hang, 6, 10, 9 + hang, 10, t, { uv: [[6, 2, 10, 4], [6, 2, 10, 4], null, [6, 2, 10, 4], [6, 2, 10, 4], [6, 2, 10, 4]] }),
        ...(hang ? [box(7.5, 10, 7, 8.5, 16, 9, t, { uv: [[6, 0, 8, 3], [6, 0, 8, 3], null, null, [6, 0, 8, 3], [6, 0, 8, 3]] })] : []),
      ];
    }
    case BS.Chain: {
      const thin = id === B2.END_ROD ? 1 : 1.5;
      const a = 8 - thin, b = 8 + thin;
      const axis = meta % 3;
      if (axis === 1) return [box(0, a, a, 16, b, b, f[0], { rot: [0, 0, 1, 1, 1, 1] })];
      if (axis === 2) return [box(a, a, 0, b, b, 16, f[0], { rot: [1, 1, 0, 0, 0, 0] })];
      return [box(a, 0, a, b, 16, b, f[0])];
    }
    case BS.Campfire: {
      const log = T2.campfireLog, lit = (meta & 4) === 0;
      const out = [box(1, 0, 0, 5, 4, 16, log), box(11, 0, 0, 15, 4, 16, log), box(0, 3, 1, 16, 7, 5, log), box(0, 3, 11, 16, 7, 15, log), box(5, 0, 0, 11, 1, 16, log)];
      if (lit) out.push(box(8, 1, 1, 8, 15, 15, f[3]), box(1, 1, 8, 15, 15, 8, f[3]));
      return out.map((x) => rotY(x, meta & 3));
    }
    case BS.Bed: {
      const head = (meta & 8) !== 0, facing = meta & 3;
      const tx = BED_TEX[id] ?? [T.bedHeadTop, T.bedFootTop, T.bedHeadSide, T.bedFootSide, T.bedHeadEnd, T.bedFootEnd];
      const top = head ? tx[0] : tx[1], side = head ? tx[2] : tx[3], end = head ? tx[4] : tx[5];
      return [rotY(box(0, 0, 0, 16, 9, 16, [side, side, T.bedBottom, top, end, end], { skip: head ? 1 << 5 : 1 << 4 }), facing)];
    }
    case BS.Head: case BS.WallHead: {
      const face = T2.headFace[f[0]] ?? f[0];
      const t = [f[0], f[0], f[0], f[0], f[0], face];
      if (SHAPE[id] === BS.Head) return [rotY(box(4, 0, 4, 12, 8, 12, t), (Math.round(meta / 4) + 2) & 3)];
      return [rotY(box(4, 4, 0, 12, 12, 8, t), meta & 3)];
    }
    case BS.CoralFan: {
      const at = meta & 7;
      if (at === 0) return [box(8, 0, 0, 8, 12, 16, f[0], { cullSame: false }), box(0, 0, 8, 16, 12, 8, f[0])];
      return [rotY(box(0, 4, 0, 16, 4, 14, f[0]), (at - 1) & 3)];
    }
    case BS.Vine: {
      const out: Box[] = [];
      const e = 0.8;
      if (meta & 1) out.push(box(0, 0, e, 16, 16, e, f[0]));
      if (meta & 2) out.push(box(16 - e, 0, 0, 16 - e, 16, 16, f[0]));
      if (meta & 4) out.push(box(0, 0, 16 - e, 16, 16, 16 - e, f[0]));
      if (meta & 8) out.push(box(e, 0, 0, e, 16, 16, f[0]));
      if (!out.length) out.push(box(0, 16 - e, 0, 16, 16 - e, 16, f[0]));
      return out;
    }
  }
  return null;
}

/** Boxes of the 1.9-1.16 blocks with models of their own (null: not one of them). */
function newBlockBoxes(id: number, meta: number, nb: Neighbor | undefined, f: number[]): Box[] | null {
  const faces = [f[0], f[1], f[2], f[3], f[4], f[5]];
  switch (id) {
    case B2.GRASS_PATH: return [box(0, 0, 0, 16, 15, 16, faces)];
    case B2.HONEY_BLOCK: return [box(0, 0, 0, 16, 16, 16, faces, { cullSame: true }), box(1, 1, 1, 15, 15, 15, faces)];
    case B2.SEA_PICKLE: {
      const n = (meta & 3) + 1;
      const spots = [[6, 6], [2, 9], [9, 2], [9, 9]];
      return spots.slice(0, n).map(([x, z], i) => box(x, 0, z, x + 4, 6 - (i & 1), z + 4, f[0]));
    }
    case B2.TURTLE_EGG: {
      const n = (meta & 3) + 1;
      const spots = [[5, 5], [1, 9], [9, 1], [9, 9]];
      return spots.slice(0, n).map(([x, z]) => box(x, 0, z, x + 5, 7, z + 5, f[0]));
    }
    case B2.CONDUIT: return [box(5, 5, 5, 11, 11, 11, f[0])];
    case B2.COCOA: {
      const age = Math.min(2, meta >> 2), w = 4 + age * 2, h = 5 + age * 2;
      const t = T2.cocoa[age];
      return [rotY(box(8 - w / 2, 12 - h, 1, 8 + w / 2, 12, 1 + w, t), meta & 3)];
    }
    case B2.CHORUS_PLANT: {
      const out = [box(3, 3, 3, 13, 13, 13, f[0])];
      if (nb) {
        const c = (v: number) => { const i = idOf(v); return i === B2.CHORUS_PLANT || i === B2.CHORUS_FLOWER || i === B.END_STONE; };
        if (c(nb(0, 1, 0))) out.push(box(4, 13, 4, 12, 16, 12, f[0]));
        if (c(nb(0, -1, 0))) out.push(box(4, 0, 4, 12, 3, 12, f[0]));
        if (c(nb(0, 0, -1))) out.push(box(4, 4, 0, 12, 12, 3, f[0]));
        if (c(nb(0, 0, 1))) out.push(box(4, 4, 13, 12, 12, 16, f[0]));
        if (c(nb(-1, 0, 0))) out.push(box(0, 4, 4, 3, 12, 12, f[0]));
        if (c(nb(1, 0, 0))) out.push(box(13, 4, 4, 16, 12, 12, f[0]));
      }
      return out;
    }
    case B2.CHORUS_FLOWER: return [box(2, 0, 2, 14, 14, 14, meta >= 5 ? T2.chorusDead : f[0])];
    case B2.BAMBOO: return [box(6.5, 0, 6.5, 9.5, 16, 9.5, [f[0], f[0], f[3], f[3], f[0], f[0]], { uv: [[6, 0, 9, 16], [6, 0, 9, 16], null, null, [6, 0, 9, 16], [6, 0, 9, 16]] })];
    case B2.CAKE: {
      const bites = Math.min(6, meta);
      return [box(1 + bites * 2, 0, 1, 15, 8, 15, [bites ? f[6] : f[0], f[1], f[2], f[3], f[4], f[5]])];
    }
    case B2.SCAFFOLDING: {
      const t = f[0];
      return [box(0, 14, 0, 16, 16, 16, [t, t, f[2], f[3], t, t]), box(0, 0, 0, 2, 14, 2, t), box(14, 0, 0, 16, 14, 2, t), box(0, 0, 14, 2, 14, 16, t), box(14, 0, 14, 16, 14, 16, t)];
    }
    case B2.STONECUTTER: return [box(0, 0, 0, 16, 9, 16, faces)];
    case B2.GRINDSTONE: {
      const g = f[0];
      return [rotY(box(4, 4, 2, 12, 16, 14, [g, g, g, g, f[3], f[3]]), meta & 3), box(2, 0, 6, 4, 7, 10, g), box(12, 0, 6, 14, 7, 10, g)];
    }
    case B2.COMPOSTER: {
      const t = f[0], lvl = Math.min(8, meta);
      const out = [box(0, 0, 0, 16, 2, 16, [t, t, f[2], t, t, t]), box(0, 2, 0, 2, 16, 16, t), box(14, 2, 0, 16, 16, 16, t), box(2, 2, 0, 14, 16, 2, t), box(2, 2, 14, 14, 16, 16, t)];
      if (lvl) out.push(box(2, 2, 2, 14, Math.min(15, 2 + lvl * 1.7), 14, lvl >= 8 ? T2.compostReady : T2.compost));
      return out;
    }
    case B2.CAULDRON: {
      const t = f[0], lvl = meta & 3, lava = (meta & 4) !== 0;
      const out = [box(0, 3, 0, 16, 4, 16, [t, t, f[2], T2.cauldronInner, t, t]), box(0, 0, 0, 2, 16, 16, [t, t, t, f[3], t, t]), box(14, 0, 0, 16, 16, 16, [t, t, t, f[3], t, t]), box(2, 0, 0, 14, 16, 2, [t, t, t, f[3], t, t]), box(2, 0, 14, 14, 16, 16, [t, t, t, f[3], t, t])];
      if (lvl) out.push(box(2, 4, 2, 14, 6 + lvl * 3, 14, lava ? T2.lava : T2.water, { skip: 0b110111 }));
      return out;
    }
    case B2.FLOWER_POT: {
      const out = [box(5, 0, 5, 11, 6, 11, f[0])];
      const plant = POT_PLANTS[meta];
      if (plant) {
        const pt = BLOCKS[plant].faces[0];
        out.push(box(8, 4, 4, 8, 16, 12, pt), box(4, 4, 8, 12, 16, 8, pt));
      }
      return out;
    }
    case B2.BEACON: return [box(0, 0, 0, 16, 16, 16, T2.beaconGlass), box(2, 0.1, 2, 14, 3, 14, T2.obsidian), box(3, 3, 3, 13, 13, 13, f[0])];
    case B2.DAYLIGHT_DETECTOR: return [box(0, 0, 0, 16, 6, 16, [f[0], f[1], f[2], meta & 8 ? T2.daylightInverted : f[3], f[4], f[5]])];
    case B2.TRIPWIRE_HOOK: return [rotY(box(6, 1, 0, 10, 9, 2, f[0]), meta & 3), rotY(box(7, 5, 2, 9, 6, 8, f[0]), meta & 3)];
    case B2.TRIPWIRE: {
      // along x unless the wire continues north or south
      const alongZ = !!nb && [nb(0, 0, -1), nb(0, 0, 1)].some((v) => idOf(v) === B2.TRIPWIRE || idOf(v) === B2.TRIPWIRE_HOOK);
      return [alongZ ? box(7.5, 1, 0, 8.5, 1.5, 16, f[0]) : box(0, 1, 7.5, 16, 1.5, 8.5, f[0])];
    }
    case B2.BELL: return [box(4, 4, 4, 12, 13, 12, f[0]), box(5, 13, 5, 11, 14, 11, f[0]), rotY(box(2, 14, 7, 14, 16, 9, f[0]), meta & 3)];
    case B2.LECTERN: return [box(0, 0, 0, 16, 2, 16, T2.lecternBase), box(4, 2, 4, 12, 13, 12, f[0]), rotY(box(0, 12, 0, 16, 16, 16, faces), meta & 3), ...(meta & 4 ? [rotY(box(3, 16, 4, 13, 17, 12, T2.lecternBook), meta & 3)] : [])];
    case B2.SHULKER_BOX: return [box(0, 0, 0, 16, 16, 16, faces)];
    case B2.TRAPPED_CHEST: {
      const b = box(1, 0, 1, 15, 14, 15, [T.chestSide, T.chestSide, T.chestTop, T.chestTop, f[6], T.chestSide]);
      return [rotY(b, meta & 3)];
    }
  }
  if (SHULKER_IDS.has(id)) return [box(0, 0, 0, 16, 16, 16, faces)];
  return null;
}
const SHULKER_IDS = new Set(SHULKER_BOXES);
/** What a flower pot holds, by meta (0 = empty). */
export const POT_PLANTS: number[] = [0, B.OAK_SAPLING, B.SPRUCE_SAPLING, B.BIRCH_SAPLING, WOOD.jungle.sapling, WOOD.acacia.sapling, WOOD.dark_oak.sapling, B.DANDELION, B.POPPY, B2.BLUE_ORCHID, B.CORNFLOWER, B.RED_MUSHROOM, B.BROWN_MUSHROOM, B.DEAD_BUSH, B.FERN, B.CACTUS];

export function modelBoxes(v: number, nb?: Neighbor): Box[] {
  const id = idOf(v), meta = metaOf(v);
  const def = BLOCKS[id];
  const f = def.faces;
  const mb = def.behavior?.model;
  if (mb) {
    try { return mb(meta, nb, f); } catch (e) { console.error(`[mod ${def.mod}] model of ${def.name}:`, e); return [box(0, 0, 0, 16, 16, 16, f[0])]; }
  }
  if (SHAPE[id] !== BS.Cube) {
    const fam = familyBoxes(id, meta, nb, f);
    if (fam) return fam;
  }
  if (id >= B2.CRIMSON_NYLIUM) {
    const nb2 = newBlockBoxes(id, meta, nb, f);
    if (nb2) return nb2;
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
    case B.END_GATEWAY:
      return [box(0, 0, 0, 16, 16, 16, T.endPortal)];
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
    case B.SOUL_SAND:
      return [box(0, 0, 0, 16, 14, 16, f[0])];
    case B.NETHER_PORTAL:
      return meta & 1 ? [box(6, 0, 0, 10, 16, 16, T.portal, { cullSame: true })] : [box(0, 0, 6, 16, 16, 10, T.portal, { cullSame: true })];
    case B.REDSTONE_WIRE: {
      // one quad on the ground (a texture per connection shape) plus a line up the face of any block it climbs
      const h = 0.25;
      if (!nb) return [box(0, 0, 0, 16, h, 16, T.dustDot, { skip: 0b110111 })];
      const conn = wireConnections(nb), up = wireClimbs(nb);
      let mask = 0;
      conn.forEach((c, i) => { if (c) mask |= 1 << i; });
      const out: Box[] = [box(0, 0, 0, 16, h, 16, T.dust[mask], { skip: 0b110111 })];
      // N, E, S, W: a thin plate against that side, showing only its face toward this block
      const plates: [number, number, number, number, number][] = [[0, 0, 16, h, 0b011111], [16 - h, 0, 16, 16, 0b111110], [0, 16 - h, 16, 16, 0b101111], [0, 0, h, 16, 0b111101]];
      up.forEach((u, i) => {
        if (!u) return;
        const [x0, z0, x1, z1, skip] = plates[i];
        out.push(box(x0, 0, z0, x1, 16, z1, T.dustLine, { skip }));
      });
      return out;
    }
    case B.LEVER: {
      const on = (meta & 8) !== 0, at = meta & 7;
      if (at === 0) return [box(5, 0, 4, 11, 3, 12, T.cobble), box(7, 3, on ? 5 : 9, 9, 11, on ? 7 : 11, T.lever)];
      return [rotY(box(5, 4, 0, 11, 12, 3, T.cobble), (at - 1) & 3), rotY(box(7, on ? 9 : 5, 3, 9, on ? 11 : 7, 11, T.lever), (at - 1) & 3)];
    }
    case B.ENCHANTING_TABLE:
      return [box(0, 0, 0, 16, 12, 16, [f[0], f[1], f[2], f[3], f[4], f[5]])];
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
  if (def.behavior?.collision) return def.behavior.collision(metaOf(v), nb);
  if (def.render === Render.Cube) return FULL;
  if (isFence(id) || SHAPE[id] === BS.Wall) {
    return modelBoxes(v, nb).map(toShape).map((s) => ({ ...s, y0: 0, y1: 1.5 }));
  }
  if (SHAPE[id] === BS.Gate) {
    // closed: a thin 1.5-high barrier across the gate's line; open: nothing
    if (metaOf(v) & 4) return [];
    return (metaOf(v) & 1) ? [{ x0: 6 / 16, y0: 0, z0: 0, x1: 10 / 16, y1: 1.5, z1: 1 }] : [{ x0: 0, y0: 0, z0: 6 / 16, x1: 1, y1: 1.5, z1: 10 / 16 }];
  }
  if (SHAPE[id] === BS.Carpet) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 16, z1: 1 }];
  if (id === B2.HONEY_BLOCK) return [{ x0: 1 / 16, y0: 0, z0: 1 / 16, x1: 15 / 16, y1: 15 / 16, z1: 15 / 16 }];
  if (id === B2.SCAFFOLDING) return [{ x0: 0, y0: 14 / 16, z0: 0, x1: 1, y1: 1, z1: 1 }];
  if (id === B2.SOUL_SOIL || id === B2.BUBBLE_COLUMN) return id === B2.SOUL_SOIL ? FULL : [];
  if (id === B.LADDER) {
    const d = metaOf(v) & 3;
    const t = 3 / 16;
    return [[{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: t }], [{ x0: 1 - t, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }], [{ x0: 0, y0: 0, z0: 1 - t, x1: 1, y1: 1, z1: 1 }], [{ x0: 0, y0: 0, z0: 0, x1: t, y1: 1, z1: 1 }]][d];
  }
  if (id === B.LILY_PAD) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 64, z1: 1 }];
  if (id === B.SNOW) return [];
  if (id === B.SOUL_SAND) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 14 / 16, z1: 1 }];
  if (def.render === Render.Model) return modelBoxes(v, nb).map(toShape);
  return FULL;
}

export function selectionShapes(v: number, nb?: Neighbor): Shape[] {
  const id = idOf(v);
  const def = BLOCKS[id];
  if (def.behavior?.selection) return def.behavior.selection(metaOf(v), nb);
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
    case Render.Rail: {
      const s = metaOf(v) & (id === B.RAIL ? 15 : 7);
      return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: s >= 2 && s <= 5 ? 10 / 16 : 2 / 16, z1: 1 }];
    }
    case Render.Model: {
      if (id === B.REDSTONE_WIRE) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 16, z1: 1 }];
      const shapes = modelBoxes(v, nb).map(toShape).map((s) => {
        // flat planes (vines, fans, fire) still need something to aim at
        const t = 1 / 16;
        if (s.x1 - s.x0 < t) { s.x0 = Math.max(0, s.x0 - t / 2); s.x1 = Math.min(1, s.x1 + t / 2); }
        if (s.y1 - s.y0 < t) { s.y0 = Math.max(0, s.y0 - t / 2); s.y1 = Math.min(1, s.y1 + t / 2); }
        if (s.z1 - s.z0 < t) { s.z0 = Math.max(0, s.z0 - t / 2); s.z1 = Math.min(1, s.z1 + t / 2); }
        return s;
      });
      if (id === B.LADDER) return collisionShapes(v, nb);
      if (id === B.LILY_PAD) return [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 1 / 16, z1: 1 }];
      return shapes;
    }
  }
  return [];
}
