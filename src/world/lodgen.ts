// Distant terrain ("Distant Horizons" style): the mesh of one low-detail tile, made in a worker straight from the
// generator's noise. Each tile is a square of LOD_CELLS x LOD_CELLS cells; a cell is a column of terrain `cell` blocks
// across, drawn as a box (its top plus the walls down to lower neighbours). Nothing here knows about loaded chunks, so
// player-made changes don't show up in distant terrain.
import type { WorldGen } from './worldgen';
import { B, B2, STONE2, SEA_LEVEL, isLeaves } from './blocks';
import { BIOMES, BIOME } from './biomes';

export const LOD_CELLS = 32;
/** Detail levels: level 0 has 2-block cells, each level up doubles the cell (and tile) size. */
export const LOD_LEVELS = 6;
export const lodCell = (level: number) => 2 << level;
export const lodTileSize = (level: number) => LOD_CELLS * lodCell(level);

/** Average colours of the block textures the tiles are painted with, by texture name (r, g, b, a in 0..255). */
export type LodPalette = Record<string, [number, number, number, number]>;
export const LOD_TEXTURES = ['grass_top', 'dirt', 'stone', 'sand', 'gravel', 'podzol_top', 'coarse_dirt', 'snow', 'ice', 'water_still', 'sandstone', 'oak_leaves', 'spruce_leaves', 'red_sand', 'mycelium_top', 'terracotta', 'orange_terracotta'];

export interface LodTileMesh {
  /**
   * One 16-byte record per quad, expanded to its corners on the GPU: int16 x, z, y0, y1 (y in 1/8 blocks); uint16 the
   * length along the face (x for tops and north/south walls, z for east/west walls; tops are one cell deep); uint8 face
   * (0 -X, 1 +X, 2 -Y, 3 +Y, 4 -Z, 5 +Z), plus 8 for a snowy top (stored with the colour under the snow; the shader
   * adds the snow where it isn't seen edge-on, see LOD_FS); uint8 sky light at the top << 4 | at the bottom; then r, g, b, a bytes.
   */
  data: ArrayBuffer;
  opaque: number; // quads of solid ground (drawn first)
  water: number; // quads of water surface after them (drawn blended)
  minY: number;
  maxY: number;
}

type RGB = [number, number, number];
interface Cell {
  top: number; // top of the solid part, 1/8 blocks
  color: RGB;
  light: number; // sky light on the top face (less on the floor of deep water)
  bands: [number, RGB][]; // what the walls show below the top: [thickness in 1/8 blocks, colour], then stone
  water: boolean; // open water above (the surface is a separate quad)
  snowTop: boolean; // snow on top: `color` is what's under it (the wall's colour), the shader whitens it
  canopy: { bottom: number; top: number; color: RGB; snow: boolean } | null; // tree tops floating over the ground (1/8 blocks)
}

const SPRUCE_COL = 0x619961, BIRCH_COL = 0x80a755;
const WATER_TOP = SEA_LEVEL * 8 + 7; // the surface of a still water block, in 1/8 blocks
export const LOD_QUAD_BYTES = 16;

class MeshOut {
  buf = new ArrayBuffer(LOD_QUAD_BYTES * 2048);
  i16 = new Int16Array(this.buf);
  u16 = new Uint16Array(this.buf);
  u8 = new Uint8Array(this.buf);
  quads = 0;
  private grow() {
    const b = new ArrayBuffer(this.buf.byteLength * 2);
    new Uint8Array(b).set(this.u8);
    this.buf = b;
    this.i16 = new Int16Array(b);
    this.u16 = new Uint16Array(b);
    this.u8 = new Uint8Array(b);
  }
  /** A quad on face `f` of the box [x0,x1] x [y0,y1] x [z0,z1] (y in 1/8 blocks); `light` gives sky light by height. */
  quad(f: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: RGB, a: number, light: (y: number) => number) {
    if ((this.quads + 1) * LOD_QUAD_BYTES > this.buf.byteLength) this.grow();
    const o = this.quads * 8, b = this.quads * LOD_QUAD_BYTES;
    this.i16[o] = x0;
    this.i16[o + 1] = z0;
    this.i16[o + 2] = y0;
    this.i16[o + 3] = y1;
    this.u16[o + 4] = (f & 7) <= 1 ? z1 - z0 : x1 - x0;
    this.u8[b + 10] = f;
    this.u8[b + 11] = (light(y1) << 4) | light(y0);
    this.u8[b + 12] = c[0]; this.u8[b + 13] = c[1]; this.u8[b + 14] = c[2]; this.u8[b + 15] = a;
    this.quads++;
  }
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tint = (c: RGB, col: number): RGB => [(c[0] * ((col >> 16) & 255)) / 255, (c[1] * ((col >> 8) & 255)) / 255, (c[2] * (col & 255)) / 255];
const same = (a: RGB, b: RGB) => (a[0] | 0) === (b[0] | 0) && (a[1] | 0) === (b[1] | 0) && (a[2] | 0) === (b[2] | 0);
/** Sky light under water: two levels less per block of water above. */
const waterLight = (y: number) => (y >= WATER_TOP ? 15 : Math.max(0, Math.round(15 - (2 * (WATER_TOP - y)) / 8)));
const fullLight = () => 15;

/** The tree type a biome mostly grows, for forests too far away to place each tree. */
function biomeLeaves(biome: number) {
  if (biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA || biome === BIOME.SNOWY_PLAINS || biome === BIOME.GIANT_TREE_TAIGA) return B.SPRUCE_LEAVES;
  if (biome === BIOME.BIRCH_FOREST || biome === BIOME.TALL_BIRCH_FOREST) return B.BIRCH_LEAVES;
  return B.OAK_LEAVES;
}

export function buildLodTile(gen: WorldGen, pal: LodPalette, level: number, tx: number, tz: number): LodTileMesh {
  const s = lodCell(level), N = LOD_CELLS, T = N * s;
  const x0 = tx * T, z0 = tz * T;
  const M = N + 2; // a ring of neighbour cells around the tile, for its edge walls
  // cells 8+ blocks wide are sampled in the middle (on the generator's 4-block grid), smaller ones at a corner
  const off = s >= 8 ? s / 2 : 0;
  const g = gen.surfaceGrid(x0 - s + off, z0 - s + off, s, M);
  const C = (n: string): RGB => { const c = pal[n] ?? [255, 0, 255, 255]; return [c[0], c[1], c[2]]; };
  const stone = C('stone'), dirt = C('dirt'), sand = C('sand'), gravel = C('gravel'), snow = C('snow'), ice = C('ice');
  const water = pal.water_still ?? [40, 70, 200, 180];
  const leafColor = (id: number, biome: number): RGB =>
    id === B.SPRUCE_LEAVES ? tint(C('spruce_leaves'), SPRUCE_COL) : id === B.BIRCH_LEAVES ? tint(C('oak_leaves'), BIRCH_COL) : tint(C('oak_leaves'), BIOMES[biome].foliage);

  // near tiles show the real trees: the generator grows them, and we keep the highest leaf of every block column
  let canopy: Int16Array | null = null, canopyLow: Int16Array | null = null, canopyLeaf: Uint16Array | null = null;
  const W = M * s, bx0 = x0 - s, bz0 = z0 - s;
  if (s <= 4) {
    canopy = new Int16Array(W * W).fill(-1);
    canopyLow = new Int16Array(W * W).fill(999);
    canopyLeaf = new Uint16Array(W * W);
    const set = (x: number, y: number, z: number, v: number) => {
      const id = v & 0xfff;
      if (!isLeaves(id)) return;
      const lx = x - bx0, lz = z - bz0;
      if (lx < 0 || lz < 0 || lx >= W || lz >= W) return;
      const i = lz * W + lx;
      if (y > canopy![i]) { canopy![i] = y; canopyLeaf![i] = id; }
      if (y < canopyLow![i]) canopyLow![i] = y;
    };
    for (let cz = Math.floor((bz0 - 4) / 16); cz <= Math.floor((bz0 + W + 4) / 16); cz++)
      for (let cx = Math.floor((bx0 - 4) / 16); cx <= Math.floor((bx0 + W + 4) / 16); cx++) gen.treesOf(cx, cz, set);
  }

  const cells: Cell[] = new Array(M * M);
  let minY = 1e9, maxY = -1e9;
  for (let k = 0; k < M; k++)
    for (let i = 0; i < M; i++) {
      const j = k * M + i;
      const h = g.height[j], biome = g.biome[j], b = BIOMES[biome];
      let top = g.top[j];
      const wet = h < SEA_LEVEL;
      if (wet && top === B.GRASS) top = B.DIRT;
      const frozen = wet && b.cold;
      const snowy = !wet && (b.cold || h > 152);
      // the ground
      let color: RGB, bands: [number, RGB][];
      switch (top) {
        case B.GRASS: {
          const grass = tint(C('grass_top'), b.grass);
          color = grass;
          // under snow: a shaded grey-white (what distant snow seen edge-on shows instead, see LOD_FS), not dirt or sand
          bands = [[8, snowy ? mix(snow, [118, 128, 140], 0.3) : mix(dirt, grass, 0.3)], [24, dirt]];
          break;
        }
        case B.PODZOL: color = C('podzol_top'); bands = [[32, dirt]]; break;
        case B.COARSE_DIRT: color = C('coarse_dirt'); bands = [[32, dirt]]; break;
        case B.SAND: color = sand; bands = biome === BIOME.DESERT ? [[32, sand], [24, C('sandstone')]] : [[32, sand]]; break;
        case B.GRAVEL: color = gravel; bands = [[32, gravel]]; break;
        case B.DIRT: color = dirt; bands = [[32, dirt]]; break;
        case B2.MYCELIUM: color = C('mycelium_top'); bands = [[32, dirt]]; break;
        case B.SNOW_BLOCK: color = snow; bands = [[16, snow]]; break;
        // badlands: red sand over stripes of terracotta
        case STONE2.RED_SAND: color = C('red_sand'); bands = [[8, C('red_sand')], [24, C('orange_terracotta')], [16, C('terracotta')], [24, C('orange_terracotta')]]; break;
        default: color = stone; bands = [];
      }
      let cellTop = (h + 1) * 8;
      let light = wet ? waterLight(cellTop) : 15;
      // (no extra height for the snow layer: a 1/8-block step is a sliver far away, and slivers flicker)
      let snowTop = snowy;
      if (snowy) color = bands.length ? bands[0][1] : stone;
      // trees
      const soil = !wet && (top === B.GRASS || top === B.PODZOL || top === B.COARSE_DIRT);
      let crown: Cell['canopy'] = null;
      if (canopy && soil) {
        // most of the cell under leaves: a block of leaves floating at the height of the tree tops
        let n = 0, hi = -1, lo = 999, leaf = B.OAK_LEAVES;
        for (let dz = 0; dz < s; dz++)
          for (let dx = 0; dx < s; dx++) {
            const q = (k * s + dz) * W + i * s + dx;
            if (canopy[q] > h) { n++; lo = Math.min(lo, canopyLow![q]); if (canopy[q] > hi) { hi = canopy[q]; leaf = canopyLeaf![q]; } }
          }
        const lc = leafColor(leaf, biome);
        if (n * 10 >= s * s * 4) {
          const bottom = Math.max(lo * 8, cellTop), top = (hi + 1) * 8;
          if (bottom <= cellTop) {
            bands = [[top - cellTop, lc], ...bands];
            cellTop = top;
            color = lc;
            snowTop = b.cold;
          } else crown = { bottom, top, color: lc, snow: b.cold };
        } else if (n && !snowTop) color = mix(color, lc, n / (s * s));
      } else if (!canopy && soil && b.treeDensity >= 0.25) {
        // too far to place each tree: a forest is a canopy a few blocks up
        const cover = Math.min(0.9, b.treeDensity * 0.9);
        const lc = leafColor(biomeLeaves(biome), biome);
        const up = Math.round(cover * 5) * 8;
        bands = [[up, lc], ...bands];
        cellTop += up;
        // seen from far off, a snowy forest is snow on the tops and dark needles between
        color = b.cold ? mix(lc, snow, 0.6) : mix(color, lc, cover);
        snowTop = false;
      }
      if (frozen) {
        // ice on top, the water under it, then the floor
        bands = [[8, ice], [WATER_TOP - 8 - cellTop + 1, [water[0], water[1], water[2]]], [8, color], ...bands];
        cellTop = (SEA_LEVEL + 1) * 8;
        color = ice;
        light = 15;
      }
      cells[j] = { top: cellTop, color, light, bands, water: wet && !frozen, snowTop, canopy: crown };
    }

  const out = new MeshOut(), wout = new MeshOut();
  const at = (i: number, k: number) => cells[k * M + i];
  // cell brightness noise is applied in the shader (so equal neighbouring tops can share one quad)
  const DIRS: [number, number, number][] = [[-1, 0, 0], [1, 0, 1], [0, -1, 4], [0, 1, 5]];
  const topFace = (i: number, k: number) => (at(i, k).snowTop ? 3 | 8 : 3);
  for (let k = 1; k <= N; k++) {
    // tops: runs of equal cells along x become one quad
    for (let i = 1; i <= N; ) {
      const c = at(i, k);
      let e = i + 1;
      const fc = topFace(i, k);
      while (e <= N && at(e, k).top === c.top && at(e, k).light === c.light && topFace(e, k) === fc && same(at(e, k).color, c.color)) e++;
      const lx0 = (i - 1) * s, lx1 = (e - 1) * s, lz0 = (k - 1) * s;
      const lt = c.light;
      out.quad(fc, lx0, c.top, lz0, lx1, c.top, lz0 + s, c.color, 255, () => lt);
      i = e;
    }
    // water surface
    for (let i = 1; i <= N; ) {
      if (!at(i, k).water) { i++; continue; }
      let e = i + 1;
      while (e <= N && at(e, k).water) e++;
      wout.quad(3, (i - 1) * s, WATER_TOP, (k - 1) * s, (e - 1) * s, WATER_TOP, k * s, [water[0], water[1], water[2]], water[3], fullLight);
      i = e;
    }
    // walls down to lower neighbours; the tile's outer walls hang lower (a skirt), hiding cracks against a neighbouring
    // tile of another detail level
    for (let i = 1; i <= N; i++) {
      const c = at(i, k);
      const lx = (i - 1) * s, lz = (k - 1) * s;
      minY = Math.min(minY, c.top);
      maxY = Math.max(maxY, c.top);
      for (const [dx, dz, f] of DIRS) {
        const n = at(i + dx, k + dz);
        const edge = i + dx === 0 || i + dx === M - 1 || k + dz === 0 || k + dz === M - 1;
        // near the player, the full chunks next door may be lower than this rough version of them: walls on chunk
        // borders go deep, so the land beyond never shows a gap
        const fx = x0 + lx + (dx === 1 ? s : 0), fz = z0 + lz + (dz === 1 ? s : 0);
        const chunkSide = s <= 4 && (dx ? fx % 16 === 0 : fz % 16 === 0);
        let bottom = n.top;
        if (edge) bottom = Math.min(n.top, c.top) - 32 * s;
        else if (chunkSide) bottom = Math.max(0, Math.min(n.top, c.top) - 48 * 8);
        else if (n.top >= c.top) continue;
        if (bottom >= c.top) continue;
        minY = Math.min(minY, bottom);
        const lightFn = n.water ? waterLight : fullLight;
        // the wall, cut where the cell's layers change colour
        let y = c.top;
        const layers: [number, RGB][] = [...c.bands, [1e9, stone]];
        for (const [th, col] of layers) {
          const yb = Math.max(bottom, y - th);
          if (yb < y) {
            const ax = dx === 1 ? lx + s : lx, az = dz === 1 ? lz + s : lz;
            if (dx) out.quad(f, ax, yb, lz, ax, y, lz + s, col, 255, lightFn);
            else out.quad(f, lx, yb, az, lx + s, y, az, col, 255, lightFn);
          }
          y -= th;
          if (y <= bottom) break;
        }
      }
      // tree tops: a box of leaves, its sides wherever the neighbour has no ground or leaves there
      const cr = c.canopy;
      if (cr) {
        maxY = Math.max(maxY, cr.top);
        out.quad(cr.snow ? 3 | 8 : 3, lx, cr.top, lz, lx + s, cr.top, lz + s, cr.color, 255, fullLight);
        out.quad(2, lx, cr.bottom, lz, lx + s, cr.bottom, lz + s, cr.color, 255, fullLight);
        for (const [dx, dz, f] of DIRS) {
          const n = at(i + dx, k + dz);
          const ax = dx === 1 ? lx + s : lx, az = dz === 1 ? lz + s : lz;
          const wall = (y0: number, y1: number) => {
            if (y1 <= y0) return;
            if (dx) out.quad(f, ax, y0, lz, ax, y1, lz + s, cr.color, 255, fullLight);
            else out.quad(f, lx, y0, az, lx + s, y1, az, cr.color, 255, fullLight);
          };
          const lo = Math.max(cr.bottom, n.top);
          if (!n.canopy) wall(lo, cr.top);
          else { wall(lo, Math.min(cr.top, n.canopy.bottom)); wall(Math.max(lo, n.canopy.top), cr.top); }
        }
      }
    }
  }
  const opaque = out.quads, waterQuads = wout.quads;
  const data = new ArrayBuffer((opaque + waterQuads) * LOD_QUAD_BYTES);
  const u8 = new Uint8Array(data);
  u8.set(out.u8.subarray(0, opaque * LOD_QUAD_BYTES));
  u8.set(wout.u8.subarray(0, waterQuads * LOD_QUAD_BYTES), opaque * LOD_QUAD_BYTES);
  if (waterQuads) maxY = Math.max(maxY, WATER_TOP);
  return { data, opaque, water: waterQuads, minY: Math.floor(minY / 8), maxY: Math.ceil(maxY / 8) };
}
