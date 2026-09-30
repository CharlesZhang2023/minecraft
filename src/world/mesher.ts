// Chunk lighting + meshing. Runs in workers.
//
// Lighting is computed statelessly from a 3x3 chunk neighbourhood: light travels at most 15 blocks,
// so a 48x48 region around the centre chunk contains every light source that can reach it.
import {
  B, BLOCKS, OPAQUE, LIGHT_OPACITY, LIGHT_EMIT, RENDER, Render, T, idOf, metaOf, HORIZ, HORIZ_TO_FACE, isLog, isLeaves, BlockDef, cropTexture, isFacing6Cube,
} from './blocks';
import { BIOMES } from './biomes';
import { modelBoxes, facing6CubeFaces } from './models';

const R = 48;
const RA = R * R;
const H = 256;
const RSIZE = RA * H;
const rb = new Uint16Array(RSIZE);
const sky = new Uint8Array(RSIZE);
const blk = new Uint8Array(RSIZE);
const QCAP = 1 << 21, QMASK = QCAP - 1;
const queue = new Int32Array(QCAP);
const hm = new Int16Array(RA);
const biomeRegion = new Uint8Array(RA);
const grassCol = new Int32Array(256);
const foliageCol = new Int32Array(256);

export interface MeshResult {
  light: Uint8Array;
  opaque: ArrayBuffer;
  opaqueSections: Int32Array; // 17 quad offsets
  trans: ArrayBuffer;
  transSections: Int32Array;
  heightmap: Uint8Array;
}

// ------------------------------------------------------------------ vertex buffer
class Buf {
  buf = new ArrayBuffer(1 << 20);
  u16 = new Uint16Array(this.buf);
  u8 = new Uint8Array(this.buf);
  verts = 0;
  reset() { this.verts = 0; }
  ensure(n: number) {
    if ((this.verts + n) * 16 <= this.buf.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.buf.byteLength * 2, (this.verts + n) * 16));
    new Uint8Array(nb).set(this.u8.subarray(0, this.verts * 16));
    this.buf = nb;
    this.u16 = new Uint16Array(nb);
    this.u8 = new Uint8Array(nb);
  }
  /** positions in blocks (chunk-local), uv in texels (0..16) */
  v(x: number, y: number, z: number, u: number, vv: number, layer: number, s: number, bl: number, col: number, a: number) {
    const o = this.verts++;
    const o16 = o * 8, o8 = o * 16;
    this.u16[o16] = Math.round((x + 16) * 16);
    this.u16[o16 + 1] = Math.round((y + 16) * 16);
    this.u16[o16 + 2] = Math.round((z + 16) * 16);
    this.u16[o16 + 3] = layer;
    this.u8[o8 + 8] = Math.round(u * 8);
    this.u8[o8 + 9] = Math.round(vv * 8);
    this.u8[o8 + 10] = Math.round(s * 16);
    this.u8[o8 + 11] = Math.round(bl * 16);
    this.u8[o8 + 12] = (col >> 16) & 255;
    this.u8[o8 + 13] = (col >> 8) & 255;
    this.u8[o8 + 14] = col & 255;
    this.u8[o8 + 15] = Math.round(a * 255);
  }
  take(): ArrayBuffer {
    return this.buf.slice(0, this.verts * 16);
  }
}
const opaqueBuf = new Buf();
const transBuf = new Buf();

// ------------------------------------------------------------------ face tables
// [x, y, z, u, v] per vertex, CCW seen from outside; v = 0 is the top of the texture.
const FACE_VERTS: number[][][] = [
  [[0, 0, 0, 0, 1], [0, 0, 1, 1, 1], [0, 1, 1, 1, 0], [0, 1, 0, 0, 0]],
  [[1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0]],
  [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [1, 0, 1, 1, 1], [0, 0, 1, 0, 1]],
  [[0, 1, 0, 0, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1], [1, 1, 0, 1, 0]],
  [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]],
  [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [1, 1, 1, 1, 0], [0, 1, 1, 0, 0]],
];
const NORMALS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
const off = (dx: number, dy: number, dz: number) => dx + dz * R + dy * RA;
const FACE_OFF = NORMALS.map(([x, y, z]) => off(x, y, z));
const SHADE = [0.6, 0.6, 0.5, 1.0, 0.8, 0.8];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
// For each face & vertex: offsets (relative to the block) of side1, side2, corner cells
const AO_OFF: number[][][] = FACE_VERTS.map((verts, f) => {
  const n = NORMALS[f];
  const axis = n[0] ? 0 : n[1] ? 1 : 2;
  const tangents = [0, 1, 2].filter((a) => a !== axis);
  return verts.map((vtx) => {
    const d1 = [0, 0, 0], d2 = [0, 0, 0];
    d1[tangents[0]] = vtx[tangents[0]] ? 1 : -1;
    d2[tangents[1]] = vtx[tangents[1]] ? 1 : -1;
    const s1 = off(n[0] + d1[0], n[1] + d1[1], n[2] + d1[2]);
    const s2 = off(n[0] + d2[0], n[1] + d2[1], n[2] + d2[2]);
    const c = off(n[0] + d1[0] + d2[0], n[1] + d1[1] + d2[1], n[2] + d1[2] + d2[2]);
    return [s1, s2, c];
  });
});

// ------------------------------------------------------------------ helpers
function mixColors(cols: number[]): number {
  let r = 0, g = 0, b = 0;
  for (const c of cols) { r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; }
  const n = cols.length;
  return ((r / n) << 16) | ((g / n) << 8) | (b / n);
}
const WHITE = 0xffffff;
const SPRUCE_COL = 0x619961;
const BIRCH_COL = 0x80a755;

function tintFor(def: BlockDef, col: number): number {
  switch (def.tint) {
    case 'grass': return grassCol[col];
    case 'foliage': return foliageCol[col];
    case 'spruce': return SPRUCE_COL;
    case 'birch': return BIRCH_COL;
  }
  return WHITE;
}

function hashPos(x: number, y: number, z: number) {
  let h = Math.imul(x, 3129871) ^ Math.imul(z, 116129781) ^ y;
  h = Math.imul(h, h * 42317861 + h * 11);
  return (h >> 16) & 0xffff;
}

/** Light for blocks that are themselves light-opaque but not full cubes (slabs, stairs, farmland). */
function ownLight(i: number): [number, number] {
  if (LIGHT_OPACITY[rb[i] & 0xfff] < 15) return [sky[i], blk[i]];
  let s = 0, b = 0;
  for (let f = 0; f < 6; f++) {
    const n = i + FACE_OFF[f];
    if (n < 0 || n >= RSIZE) continue;
    if (sky[n] > s) s = sky[n];
    if (blk[n] > b) b = blk[n];
  }
  return [s, b];
}

// ------------------------------------------------------------------ lighting
function propagate(arr: Uint8Array, qh: number, qt: number) {
  while (qh !== qt) {
    const i = queue[qh];
    qh = (qh + 1) & QMASK;
    const l = arr[i];
    if (l <= 1) continue;
    const x = i % R, z = ((i / R) | 0) % R, y = (i / RA) | 0;
    for (let f = 0; f < 6; f++) {
      if (f === 0 && x === 0) continue;
      if (f === 1 && x === R - 1) continue;
      if (f === 2 && y === 0) continue;
      if (f === 3 && y === H - 1) continue;
      if (f === 4 && z === 0) continue;
      if (f === 5 && z === R - 1) continue;
      const n = i + FACE_OFF[f];
      const op = LIGHT_OPACITY[rb[n] & 0xfff];
      if (op >= 15) continue;
      const nl = l - (op > 1 ? op : 1);
      if (nl > arr[n]) {
        arr[n] = nl;
        queue[qt] = n;
        qt = (qt + 1) & QMASK;
      }
    }
  }
}

function computeLight(hasSky: boolean) {
  sky.fill(0);
  blk.fill(0);
  let qt = 0;
  if (hasSky) {
  // direct sky light down each column
  for (let col = 0; col < RA; col++) {
    let l = 15;
    let h = 0;
    for (let y = H - 1; y >= 0; y--) {
      const i = col + y * RA;
      const op = LIGHT_OPACITY[rb[i] & 0xfff];
      if (op) {
        l -= op;
        if (h === 0) h = y + 1;
        if (l <= 0) break;
      }
      sky[i] = l;
      if (l < 15) { queue[qt] = i; qt = (qt + 1) & QMASK; }
    }
    hm[col] = h;
  }
  // seed cells that can spread sideways into darker neighbouring columns
  for (let z = 0; z < R; z++)
    for (let x = 0; x < R; x++) {
      const col = x + z * R;
      const h0 = hm[col];
      let hmax = h0;
      if (x > 0) hmax = Math.max(hmax, hm[col - 1]);
      if (x < R - 1) hmax = Math.max(hmax, hm[col + 1]);
      if (z > 0) hmax = Math.max(hmax, hm[col - R]);
      if (z < R - 1) hmax = Math.max(hmax, hm[col + R]);
      for (let y = h0; y < hmax; y++) { queue[qt] = col + y * RA; qt = (qt + 1) & QMASK; }
    }
  propagate(sky, 0, qt);
  }
  // block light
  qt = 0;
  for (let i = 0; i < RSIZE; i++) {
    const v = rb[i];
    if (v === 0) continue;
    const e = LIGHT_EMIT[v & 0xfff];
    if (e) { blk[i] = e; queue[qt] = i; qt = (qt + 1) & QMASK; }
  }
  propagate(blk, 0, qt);
}

// ------------------------------------------------------------------ fluids
function fluidCornerHeight(i: number, fluid: number, cx: number, cz: number): number {
  let sum = 0, cnt = 0;
  for (let j = 0; j < 4; j++) {
    const dx = cx - (j & 1) - 0, dz = cz - ((j >> 1) & 1);
    const n = i + (dx) + (dz) * R;
    if ((rb[n + RA] & 0xfff) === fluid) return 1;
    const v = rb[n];
    const id = v & 0xfff;
    if (id === fluid) {
      let l = v >>> 12;
      if (l >= 8) l = 0;
      const pa = (l + 1) / 9;
      if (l === 0) { sum += pa * 10; cnt += 10; }
      sum += pa;
      cnt++;
    } else if (!BLOCKS[id].solid) {
      sum += 1;
      cnt++;
    }
  }
  return cnt ? 1 - sum / cnt : 0;
}

// ------------------------------------------------------------------ main entry
export function buildChunk(chunks: Uint16Array[], biomes: Uint8Array[], hasSky = true): MeshResult {
  // assemble region
  for (let k = 0; k < 9; k++) {
    const ox = (k % 3) * 16, oz = ((k / 3) | 0) * 16;
    const c = chunks[k];
    const bm = biomes[k];
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) biomeRegion[ox + x + (oz + z) * R] = bm[z * 16 + x];
    for (let y = 0; y < H; y++)
      for (let z = 0; z < 16; z++) {
        const src = (z << 4) | (y << 8);
        rb.set(c.subarray(src, src + 16), ox + (oz + z) * R + y * RA);
      }
  }
  computeLight(hasSky);

  // biome colour blending (5x5)
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const gs: number[] = [], fs: number[] = [];
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const b = BIOMES[biomeRegion[x + 16 + dx + (z + 16 + dz) * R]] ?? BIOMES[0];
          gs.push(b.grass);
          fs.push(b.foliage);
        }
      grassCol[z * 16 + x] = mixColors(gs);
      foliageCol[z * 16 + x] = mixColors(fs);
    }

  opaqueBuf.reset();
  transBuf.reset();
  const opaqueSections = new Int32Array(17);
  const transSections = new Int32Array(17);
  const heightmap = new Uint8Array(256);

  // top of non-air content in centre chunk, to skip empty sky quickly
  let maxY = 0;
  for (let y = H - 1; y >= 0 && !maxY; y--)
    for (let z = 0; z < 16 && !maxY; z++) {
      const base = 16 + (z + 16) * R + y * RA;
      for (let x = 0; x < 16; x++) if (rb[base + x]) { maxY = y; break; }
    }

  for (let y = 0; y < H; y++) {
    if ((y & 15) === 0) {
      opaqueSections[y >> 4] = opaqueBuf.verts >> 2;
      transSections[y >> 4] = transBuf.verts >> 2;
    }
    if (y > maxY) continue;
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const i = x + 16 + (z + 16) * R + y * RA;
        const v = rb[i];
        if (v === 0) continue;
        const id = v & 0xfff;
        const r = RENDER[id];
        if (r === Render.None) continue;
        heightmap[z * 16 + x] = y;
        const def = BLOCKS[id];
        const col = z * 16 + x;
        switch (r) {
          case Render.Cube: meshCube(i, v, id, def, x, y, z, col); break;
          case Render.Liquid: meshLiquid(i, v, id, x, y, z); break;
          case Render.Cross: meshCross(i, id, def, x, y, z, col); break;
          case Render.Torch: meshTorch(i, v, x, y, z); break;
          case Render.Crops: meshCrops(i, v, x, y, z); break;
          case Render.Model: meshModel(i, v, id, def, x, y, z, col); break;
        }
      }
  }
  opaqueSections[16] = opaqueBuf.verts >> 2;
  transSections[16] = transBuf.verts >> 2;

  // extract centre light
  const light = new Uint8Array(16 * 16 * H);
  for (let y = 0; y < H; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const i = x + 16 + (z + 16) * R + y * RA;
        light[x | (z << 4) | (y << 8)] = (sky[i] << 4) | blk[i];
      }
  return { light, opaque: opaqueBuf.take(), opaqueSections, trans: transBuf.take(), transSections, heightmap };
}

// ------------------------------------------------------------------ cubes
const faceTex = new Int32Array(6);
const faceRot = new Int8Array(6);

function meshCube(i: number, v: number, id: number, def: BlockDef, x: number, y: number, z: number, col: number) {
  const meta = v >>> 12;
  const buf = def.translucent ? transBuf : opaqueBuf;
  for (let f = 0; f < 6; f++) { faceTex[f] = def.faces[f]; faceRot[f] = 0; }
  if (isFacing6Cube(id)) facing6CubeFaces(id, meta, faceTex, faceRot);
  else if (def.faces.length > 6) faceTex[HORIZ_TO_FACE[meta & 3]] = def.faces[6];
  if (isLog(id) && meta) {
    const top = def.faces[3];
    const side = def.faces[0];
    for (let f = 0; f < 6; f++) faceTex[f] = side;
    if (meta === 1) { faceTex[0] = faceTex[1] = top; faceRot[2] = faceRot[3] = 1; faceRot[4] = faceRot[5] = 1; }
    else { faceTex[4] = faceTex[5] = top; faceRot[0] = faceRot[1] = 1; }
  }
  const tint = tintFor(def, col);
  let snowy = false;
  if (id === B.GRASS) {
    const above = rb[i + RA] & 0xfff;
    snowy = above === B.SNOW || above === B.SNOW_BLOCK;
  }
  for (let f = 0; f < 6; f++) {
    const n = i + FACE_OFF[f];
    if (f === 2 && y === 0) continue;
    const nv = rb[n];
    const nid = nv & 0xfff;
    if (OPAQUE[nid]) continue;
    if (def.cullSelf && nid === id) continue;
    let tex = faceTex[f];
    let c = WHITE;
    let masked = 0;
    if (id === B.GRASS) {
      if (f === 3) c = tint;
      else if (f !== 2) {
        if (snowy) tex = T.grassSideSnowed;
        else { c = tint; masked = 0x8000; }
      }
    } else if (def.tint !== 'none') c = tint;
    emitCubeFace(buf, i, x, y, z, f, tex | masked, c, faceRot[f]);
  }
}

const ls = [0, 0, 0, 0], lb = [0, 0, 0, 0], la = [0, 0, 0, 0];

function emitCubeFace(buf: Buf, i: number, x: number, y: number, z: number, f: number, layer: number, col: number, rot: number) {
  const n = i + FACE_OFF[f];
  const aoOff = AO_OFF[f];
  const baseS = sky[n], baseB = blk[n];
  for (let k = 0; k < 4; k++) {
    const [o1, o2, oc] = aoOff[k];
    const s1 = OPAQUE[rb[i + o1] & 0xfff], s2 = OPAQUE[rb[i + o2] & 0xfff];
    const cOcc = s1 && s2 ? 1 : OPAQUE[rb[i + oc] & 0xfff];
    let ss = baseS, bb = baseB, cnt = 1;
    if (!s1) { ss += sky[i + o1]; bb += blk[i + o1]; cnt++; }
    if (!s2) { ss += sky[i + o2]; bb += blk[i + o2]; cnt++; }
    if (!cOcc) { ss += sky[i + oc]; bb += blk[i + oc]; cnt++; }
    ls[k] = ss / cnt;
    lb[k] = bb / cnt;
    const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cOcc);
    la[k] = SHADE[f] * AO_CURVE[ao];
  }
  const verts = FACE_VERTS[f];
  buf.ensure(4);
  // flip the triangulation when it makes the AO gradient look better
  const flip = la[0] + la[2] < la[1] + la[3];
  for (let kk = 0; kk < 4; kk++) {
    const k = flip ? (kk + 1) & 3 : kk;
    const vt = verts[k];
    let u = vt[3], vv = vt[4];
    for (let r = 0; r < rot; r++) { const t = u; u = 1 - vv; vv = t; }
    buf.v(x + vt[0], y + vt[1], z + vt[2], u * 16, vv * 16, layer, ls[k], lb[k], col, la[k]);
  }
}

// ------------------------------------------------------------------ liquids
function meshLiquid(i: number, v: number, id: number, x: number, y: number, z: number) {
  const water = id === B.WATER;
  const buf = water ? transBuf : opaqueBuf;
  const def = BLOCKS[id];
  const aboveSame = (rb[i + RA] & 0xfff) === id;
  let h00 = 1, h10 = 1, h11 = 1, h01 = 1;
  if (!aboveSame) {
    h00 = fluidCornerHeight(i, id, 0, 0);
    h10 = fluidCornerHeight(i, id, 1, 0);
    h11 = fluidCornerHeight(i, id, 1, 1);
    h01 = fluidCornerHeight(i, id, 0, 1);
  }
  const still = def.faces[3], flow = def.faces[0];
  const meta = v >>> 12;
  const aS = sky[i + RA], aB = blk[i + RA];
  const s = Math.max(sky[i], aS), b = Math.max(blk[i], aB);
  if (!aboveSame) {
    const tex = meta === 0 ? still : flow;
    buf.ensure(8);
    // top, visible from above and below
    buf.v(x, y + h00, z, 0, 0, tex, s, b, WHITE, 1);
    buf.v(x, y + h01, z + 1, 0, 16, tex, s, b, WHITE, 1);
    buf.v(x + 1, y + h11, z + 1, 16, 16, tex, s, b, WHITE, 1);
    buf.v(x + 1, y + h10, z, 16, 0, tex, s, b, WHITE, 1);
    buf.v(x, y + h00, z, 0, 0, tex, s, b, WHITE, 0.5);
    buf.v(x + 1, y + h10, z, 16, 0, tex, s, b, WHITE, 0.5);
    buf.v(x + 1, y + h11, z + 1, 16, 16, tex, s, b, WHITE, 0.5);
    buf.v(x, y + h01, z + 1, 0, 16, tex, s, b, WHITE, 0.5);
  }
  // sides
  const corner: Record<string, number> = { '00': h00, '10': h10, '11': h11, '01': h01 };
  for (let f = 0; f < 6; f++) {
    if (f === 3) continue;
    const n = i + FACE_OFF[f];
    const nid = rb[n] & 0xfff;
    if (nid === id || OPAQUE[nid]) continue;
    if (f === 2 && y === 0) continue;
    const ns = Math.max(sky[n], 0), nb = blk[n];
    const verts = FACE_VERTS[f];
    buf.ensure(4);
    for (const vt of verts) {
      let yy = vt[1];
      let vv = vt[4] * 16;
      if (f !== 2 && yy === 1) {
        yy = corner[`${vt[0]}${vt[2]}`];
        vv = (1 - yy) * 16;
      }
      buf.v(x + vt[0], y + yy, z + vt[2], vt[3] * 16, f === 2 ? vt[4] * 16 : vv, f === 2 ? still : flow, ns, nb, WHITE, SHADE[f]);
    }
  }
}

// ------------------------------------------------------------------ plants
function quadBoth(buf: Buf, p: number[][], uv: number[][], layer: number, s: number, b: number, col: number, a: number) {
  buf.ensure(8);
  for (let k = 0; k < 4; k++) buf.v(p[k][0], p[k][1], p[k][2], uv[k][0], uv[k][1], layer, s, b, col, a);
  for (let k = 3; k >= 0; k--) buf.v(p[k][0], p[k][1], p[k][2], uv[k][0], uv[k][1], layer, s, b, col, a);
}
const CROSS_UV = [[0, 16], [16, 16], [16, 0], [0, 0]];

function meshCross(i: number, id: number, def: BlockDef, x: number, y: number, z: number, col: number) {
  let ox = 0, oz = 0;
  if (id === B.TALL_GRASS || id === B.FERN || (id >= B.DANDELION && id <= B.ALLIUM)) {
    const h = hashPos(x, 0, z);
    ox = ((h & 15) / 15 - 0.5) * 0.4;
    oz = (((h >> 4) & 15) / 15 - 0.5) * 0.4;
  }
  const s = sky[i], b = blk[i];
  const c = tintFor(def, col);
  const tex = def.faces[0];
  const d = 0.45;
  const x0 = x + 0.5 - d + ox, x1 = x + 0.5 + d + ox, z0 = z + 0.5 - d + oz, z1 = z + 0.5 + d + oz;
  const buf = opaqueBuf;
  if (id === B.FIRE) {
    // fire: faces on each side plus the cross
    const e = 0.02;
    quadBoth(buf, [[x + e, y, z], [x + e, y, z + 1], [x + e, y + 1.3, z + 1], [x + e, y + 1.3, z]], CROSS_UV, tex, s, 15, c, 1);
    quadBoth(buf, [[x + 1 - e, y, z + 1], [x + 1 - e, y, z], [x + 1 - e, y + 1.3, z], [x + 1 - e, y + 1.3, z + 1]], CROSS_UV, tex, s, 15, c, 1);
    quadBoth(buf, [[x + 1, y, z + e], [x, y, z + e], [x, y + 1.3, z + e], [x + 1, y + 1.3, z + e]], CROSS_UV, tex, s, 15, c, 1);
    quadBoth(buf, [[x, y, z + 1 - e], [x + 1, y, z + 1 - e], [x + 1, y + 1.3, z + 1 - e], [x, y + 1.3, z + 1 - e]], CROSS_UV, tex, s, 15, c, 1);
  }
  quadBoth(buf, [[x0, y, z0], [x1, y, z1], [x1, y + 1, z1], [x0, y + 1, z0]], CROSS_UV, tex, s, b, c, 1);
  quadBoth(buf, [[x0, y, z1], [x1, y, z0], [x1, y + 1, z0], [x0, y + 1, z1]], CROSS_UV, tex, s, b, c, 1);
}

function meshCrops(i: number, v: number, x: number, y: number, z: number) {
  const tex = cropTexture(v & 0xfff, metaOf(v));
  const s = sky[i], b = blk[i];
  const yb = y - 1 / 16, yt = y + 15 / 16;
  for (const p of [4, 12]) {
    const px = x + p / 16, pz = z + p / 16;
    quadBoth(opaqueBuf, [[px, yb, z], [px, yb, z + 1], [px, yt, z + 1], [px, yt, z]], CROSS_UV, tex, s, b, WHITE, 0.9);
    quadBoth(opaqueBuf, [[x, yb, pz], [x + 1, yb, pz], [x + 1, yt, pz], [x, yt, pz]], CROSS_UV, tex, s, b, WHITE, 0.9);
  }
}

function meshTorch(i: number, v: number, x: number, y: number, z: number) {
  const meta = metaOf(v);
  const s = sky[i], b = blk[i];
  const tex = BLOCKS[v & 0xfff].faces[0];
  let ox = 0, oz = 0, lx = 0, lz = 0, oy = 0;
  if (meta >= 1 && meta <= 4) {
    const [dx, dz] = HORIZ[meta - 1]; // direction of the wall
    ox = dx * 0.36; oz = dz * 0.36; oy = 0.2;
    lx = -dx * 0.4; lz = -dz * 0.4;
  }
  const P = (px: number, py: number, pz: number): number[] => [x + px + ox + lx * py, y + py + oy, z + pz + oz + lz * py];
  const buf = opaqueBuf;
  const a = 7 / 16, c = 9 / 16;
  buf.ensure(24);
  const quad = (pts: number[][], uv: number[][], shade: number) => {
    for (let k = 0; k < 4; k++) buf.v(pts[k][0], pts[k][1], pts[k][2], uv[k][0], uv[k][1], tex, s, b, WHITE, shade);
  };
  quad([P(a, 0, 0), P(a, 0, 1), P(a, 1, 1), P(a, 1, 0)], [[0, 16], [16, 16], [16, 0], [0, 0]], 0.8);
  quad([P(c, 0, 1), P(c, 0, 0), P(c, 1, 0), P(c, 1, 1)], [[0, 16], [16, 16], [16, 0], [0, 0]], 0.8);
  quad([P(1, 0, a), P(0, 0, a), P(0, 1, a), P(1, 1, a)], [[0, 16], [16, 16], [16, 0], [0, 0]], 0.9);
  quad([P(0, 0, c), P(1, 0, c), P(1, 1, c), P(0, 1, c)], [[0, 16], [16, 16], [16, 0], [0, 0]], 0.9);
  const t = 10 / 16;
  quad([P(a, t, a), P(a, t, c), P(c, t, c), P(c, t, a)], [[7, 6], [7, 8], [9, 8], [9, 6]], 1);
  quad([P(a, 0, a), P(c, 0, a), P(c, 0, c), P(a, 0, c)], [[7, 14], [9, 14], [9, 16], [7, 16]], 0.5);
}

// ------------------------------------------------------------------ models
function meshModel(i: number, v: number, id: number, def: BlockDef, x: number, y: number, z: number, col: number) {
  const nb = (dx: number, dy: number, dz: number) => rb[i + dx + dz * R + dy * RA];
  const boxes = modelBoxes(v, nb);
  const own = ownLight(i);
  const tint = def.tint !== 'none' ? tintFor(def, col) : WHITE;
  const buf = def.translucent ? transBuf : opaqueBuf;
  for (const bx of boxes) {
    const mn = [bx.x0 / 16, bx.y0 / 16, bx.z0 / 16], mx = [bx.x1 / 16, bx.y1 / 16, bx.z1 / 16];
    for (let f = 0; f < 6; f++) {
      if (bx.skip && bx.skip & (1 << f)) continue;
      const boundary = (f === 0 && bx.x0 === 0) || (f === 1 && bx.x1 === 16) || (f === 2 && bx.y0 === 0) || (f === 3 && bx.y1 === 16) || (f === 4 && bx.z0 === 0) || (f === 5 && bx.z1 === 16);
      let s = own[0], b = own[1];
      if (boundary) {
        const n = i + FACE_OFF[f];
        const nid = rb[n] & 0xfff;
        if (OPAQUE[nid]) continue;
        if (bx.cullSame && nid === id) continue;
        if (LIGHT_OPACITY[nid] < 15) { s = sky[n]; b = blk[n]; }
      }
      const verts = FACE_VERTS[f];
      const rot = bx.rot ? bx.rot[f] : 0;
      const rect = bx.uv ? bx.uv[f] : null;
      buf.ensure(4);
      for (const vt of verts) {
        const px = vt[0] ? mx[0] : mn[0], py = vt[1] ? mx[1] : mn[1], pz = vt[2] ? mx[2] : mn[2];
        let u: number, vv: number;
        if (rect) {
          // explicit rect: map the face's corners onto it (same orientation as the default mapping)
          const [du, dv] = faceUV(f, vt[0], vt[1], vt[2]);
          u = rect[0] + (rect[2] - rect[0]) * du;
          vv = rect[1] + (rect[3] - rect[1]) * dv;
        } else switch (f) {
          case 0: u = pz * 16; vv = 16 - py * 16; break;
          case 1: u = 16 - pz * 16; vv = 16 - py * 16; break;
          case 2: case 3: u = px * 16; vv = pz * 16; break;
          case 4: u = 16 - px * 16; vv = 16 - py * 16; break;
          default: u = px * 16; vv = 16 - py * 16;
        }
        for (let r = 0; r < rot; r++) { const t = u; u = 16 - vv; vv = t; }
        buf.v(x + px, y + py, z + pz, u, vv, bx.tex[f], s, b, id === B.LILY_PAD ? tint : id === B.REDSTONE_WIRE ? wireColor(v >>> 12) : WHITE, SHADE[f]);
      }
    }
  }
  void isLeaves;
}

/** Normalised (0..1) uv of a face corner in the default orientation. */
function faceUV(f: number, cx: number, cy: number, cz: number): [number, number] {
  switch (f) {
    case 0: return [cz, 1 - cy];
    case 1: return [1 - cz, 1 - cy];
    case 2: case 3: return [cx, cz];
    case 4: return [1 - cx, 1 - cy];
    default: return [cx, 1 - cy];
  }
}

function wireColor(p: number): number {
  const f = p / 15;
  const r = p === 0 ? 0.3 : f * 0.6 + 0.4;
  const g = Math.max(0, f * f * 0.7 - 0.5), b = Math.max(0, f * f * 0.6 - 0.7);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
