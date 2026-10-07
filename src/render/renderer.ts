// The world renderer: what every backend shares (camera, culling, which chunk sections to draw and in what order,
// distant terrain tiles, the sky's sun and moon, clouds) and the drawing calls the game makes. WebGPU
// (gpurenderer.ts) and WebGL 2 (glrenderer.ts) do the drawing; `createRenderer` (backend.ts) picks one.
import { BlockAtlas, type AtlasTarget } from './atlas';
import { DynMesh } from './dynmesh';
import { Mat4, mat4, perspective, ortho, lookDir, multiply, invert, identity } from '../math';
import type { Chunk } from '../world/world';
import { isShipyardChunk } from '../sublevel/shipyard';
import type { MeshResult } from '../world/mesher';
import type { LodDraw } from '../world/lod';
import { Random } from '../noise';
import { Img } from './pixels';
import { OVERRIDES } from './overrides';
import type { ShaderPackSource } from '../packs/types';

export interface Camera {
  x: number; y: number; z: number;
  yaw: number; pitch: number; // radians
  fov: number; // degrees
  /**
   * A flat (orthographic) projection showing this many blocks above and below the middle of the view, for
   * top-down and isometric views. The camera then sits at the point it looks at (fog is measured from there), and
   * things within `far` blocks in front of and behind it are drawn.
   */
  ortho?: number;
  /** Flat projections: draw only what is at least this far in front of the camera (0 cuts away all in front of it). */
  near?: number;
  /** Flat projections: draw nothing farther than this in front of the camera. */
  depth?: number;
  /** The colour behind everything (and of the fog), instead of the sky's: cut views show cut solid blocks in it. */
  background?: [number, number, number];
  roll?: number;
  bobX?: number; bobY?: number;
}

export interface EnvState {
  skyColor: [number, number, number];
  fogColor: [number, number, number];
  voidColor: [number, number, number];
  sunrise: [number, number, number, number];
  celestial: number; // 0..1
  sunBright: number; // lightmap sky multiplier
  skyLightCol: [number, number, number];
  stars: number;
  fogStart: number;
  fogEnd: number;
  gamma: number;
  flicker: number;
  cloudColor: [number, number, number];
  clouds: boolean;
  cloudOffset: number;
  moonPhase: number;
  rain: number;
  ambient: number;
  ambientCol: [number, number, number];
  noSky?: boolean;
  nightVision?: number;
  // for shader packs
  ticks?: number;
  dim?: 'overworld' | 'nether' | 'end';
  /** 1 in water, 2 in lava */
  eyeInWater?: number;
  thunder?: number;
}

/** A chunk's meshes on the GPU (each backend adds its buffers): where each 16-block section's quads start. */
export interface ChunkMesh {
  opaqueSections: Int32Array;
  transSections: Int32Array;
  opaque: number; // quads
  trans: number;
  bytes: number;
}

/** A sub-level to draw: its chunks, its rotation (column-major 3x3) and where its pivot is (world and local). */
export interface ShipDraw { rot: Float32Array; tx: number; ty: number; tz: number; lx: number; ly: number; lz: number; chunks: Chunk[] }

/** One chunk to draw: its mesh, placed (`offset`) and turned (`rot` about the pivot, `pre` from it), and the runs of quads to draw. */
export interface ChunkDraw {
  mesh: ChunkMesh;
  ox: number; oy: number; oz: number;
  rot: Float32Array;
  px: number; py: number; pz: number;
  /** [first quad, end quad] pairs */
  runs: number[];
}

/** A texture made by `makeTexture` (entity skins). */
export interface Tex { readonly w: number; readonly h: number }
/** A model part's vertices (`createModel`): pos(3) uv(2) normal(3) floats, in quads. */
export interface ModelMesh { readonly quads: number }

export interface DynOpts {
  blend?: boolean;
  /** Added light (glows, spells): fades out into the fog instead of turning fog-coloured. */
  additive?: boolean;
  model?: Mat4;
  overlay?: [number, number, number, number];
  cull?: boolean;
  fullbright?: boolean;
  depthTest?: boolean;
  /** false: drawn without writing depth (things seen through other blended things). */
  depthWrite?: boolean;
  /** false: depth only (masks). */
  colorWrite?: boolean;
  /** Pulled toward the camera (decals over the faces they lie on: cracks). */
  polygonOffset?: boolean;
  alphaCut?: number;
  viewProj?: Mat4;
  /** Texture coordinates repeat (rain and snow columns). */
  wrap?: boolean;
}

export interface ModelOpts {
  viewProj: Mat4;
  model: Mat4;
  light: [number, number];
  overlay: [number, number, number, number];
  alpha: number;
  blend?: boolean;
}

/** Distant-terrain tile drawing parameters (set up by `drawLod`). */
export interface LodPass {
  tiles: LodDraw[];
  mask: Uint8Array;
  mcx: number; mcz: number;
  snow: [number, number, number];
  pixel: number;
}

export interface SkyParams { end: boolean; sunDir: [number, number, number]; stars: number; celestial: number; endLod: number }

/** Chunks across the distant-terrain mask (centred on the player, wrapping). */
export const LOD_MASK = 64;
/** Quads in the shared index buffer: the most one draw can have. */
export const MAX_QUADS = 1 << 18;

export abstract class Renderer {
  /** 'webgpu' or 'webgl2' */
  abstract readonly backend: 'webgpu' | 'webgl2';
  atlas!: BlockAtlas;
  proj: Mat4 = mat4();
  view: Mat4 = mat4();
  viewProj: Mat4 = mat4();
  invViewProj: Mat4 = mat4();
  protected planes = new Float32Array(24);
  protected lodProj = mat4();
  protected lodViewProj = mat4();
  private lodPlanes = new Float32Array(24);
  width = 1;
  height = 1;
  cam: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 70 };
  chunkBytes = 0;
  drawnChunks = 0;
  lodBytes = 0;
  drawnLod = 0;
  /** The frame's scratch mesh (particles, entities, selection cracks...). */
  dyn = new DynMesh();
  env!: EnvState;
  /** The GPU was lost and is back: everything uploaded (chunks, distant terrain, the atlas) has to be made again. */
  onRestore: (() => void) | null = null;
  // clouds: rebuilt on the CPU when the camera crosses a cell, uploaded by the backend when `cloudVersion` changes
  protected cloudVerts = new Float32Array(0);
  protected cloudVersion = 0;
  private cloudCell = [1e9, 1e9];
  private cloudMap = makeCloudMap();

  constructor(public canvas: HTMLCanvasElement) {}

  /** For F3: the backend and what it runs on. */
  abstract describe(): string;

  /**
   * Draw with a shader pack (null: the game's own look). Resolves with an error message ('' when it's in use);
   * on an error the game's own look stays.
   */
  async setShaderPack(src: ShaderPackSource | null): Promise<string> {
    return src ? 'Shader packs need WebGPU (Options > More... > Graphics)' : '';
  }
  /** The shader pack in use, if any. */
  shaderPackName(): string { return ''; }

  // ------------------------------------------------------------------ resources
  /** Build the block atlas (again: mods that add textures, a restored GPU); the old one is freed. */
  initAtlas(extra: { name: string; img: Img }[]) {
    const old = this.atlas;
    this.atlas = new BlockAtlas(this.atlasTarget(), extra);
    old?.destroy();
    // the sun and moon: a resource pack's, or the game's own
    const sun = OVERRIDES.sky.get('sun'), moon = OVERRIDES.sky.get('moon');
    this.skyImages(sun ? { img: sun.img, w: sun.w } : { img: sunImage(), w: 32 }, moon ? { img: moon.img, w: moon.w } : { img: moonImage(), w: 32 });
  }
  protected abstract atlasTarget(): AtlasTarget;
  /** The sun's texture, and the moon's (its 8 phases in 4 columns and 2 rows). */
  protected abstract skyImages(sun: { img: Img; w: number }, moon: { img: Img; w: number }): void;

  abstract makeTexture(img: Img, w: number): Tex;
  abstract freeTexture(t: Tex): void;
  abstract createModel(verts: Float32Array): ModelMesh;

  abstract uploadChunk(c: Chunk, r: MeshResult): void;
  abstract freeChunk(c: Chunk): void;
  /** A tile's quads (16 bytes each, see LodTileMesh); the water quads follow the `opaque` ground quads. */
  abstract uploadLod(data: ArrayBuffer, opaque: number): unknown;
  abstract freeLod(m: unknown): void;

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // ------------------------------------------------------------------ camera
  near = 0.05;
  far = 1000;
  setupCamera(cam: Camera, near = 0.05, far = 1000) {
    this.cam = cam;
    this.near = near;
    this.far = far;
    if (cam.ortho) {
      const h = cam.ortho, w = (h * this.width) / this.height;
      ortho(this.proj, -w, w, -h, h, cam.near ?? -far, cam.depth ?? far);
    } else perspective(this.proj, (cam.fov * Math.PI) / 180, this.width / this.height, near, far);
    lookDir(this.view, cam.yaw, cam.pitch);
    if (cam.roll) {
      const r = mat4();
      identity(r);
      const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
      r[0] = c; r[1] = s; r[4] = -s; r[5] = c;
      multiply(this.view, r, this.view);
    }
    if (cam.bobX || cam.bobY) {
      // view bobbing: translate after rotation
      const t = mat4();
      t[12] = cam.bobX ?? 0;
      t[13] = cam.bobY ?? 0;
      multiply(this.view, t, this.view);
    }
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
    extractPlanes(this.viewProj, this.planes);
  }

  /** AABB in camera-relative coordinates */
  boxVisible(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    return boxInPlanes(this.planes, x0, y0, z0, x1, y1, z1);
  }

  chunkVisible(cx: number, cz: number) {
    const x0 = cx * 16 - this.cam.x, z0 = cz * 16 - this.cam.z;
    return this.boxVisible(x0, -this.cam.y, z0, x0 + 16, 256 - this.cam.y, z0 + 16);
  }

  /** Projection for the first-person hand (fixed fov, own depth range). */
  handViewProj(fov = 70): Mat4 {
    const p = mat4();
    perspective(p, (fov * Math.PI) / 180, this.width / this.height, 0.05, 10);
    return p;
  }

  // ------------------------------------------------------------------ frame
  /** Start a frame: clear to the fog colour. Everything drawn until `endFrame` shows together. */
  abstract beginFrame(env: EnvState): void;
  /** Send the frame to the screen. */
  abstract endFrame(): void;
  /** Forget what's in front (the first-person hand is drawn over everything). */
  abstract clearDepth(): void;
  /** Draw into a rectangle of the screen (device pixels from the top left), cleared to black, until `endInset`. */
  abstract beginInset(x: number, y: number, w: number, h: number): void;
  abstract endInset(): void;

  /** The sky: gradient, sunrise glow and stars, then the sun and moon. */
  drawSky() {
    const e = this.env;
    const a = e.celestial * Math.PI * 2;
    this.skyPass({ end: false, sunDir: [-Math.sin(a), Math.cos(a), 0], stars: e.stars, celestial: e.celestial, endLod: 0 });
    if (e.rain >= 1) return;
    const quad = (dirSign: number, size: number, uv: number[]) => {
      const s = Math.sin(a), c = Math.cos(a);
      const dx = -s * dirSign, dy = c * dirSign;
      const D = 100;
      // tangent axes: along the sun path (perp to dir in the xy plane) and z
      const tx = c, ty = s;
      const cx = dx * D, cy = dy * D;
      return new Float32Array([
        cx - tx * size, cy - ty * size, -size, uv[0], uv[1],
        cx - tx * size, cy - ty * size, size, uv[0], uv[3],
        cx + tx * size, cy + ty * size, size, uv[2], uv[3],
        cx + tx * size, cy + ty * size, -size, uv[2], uv[1],
      ]);
    };
    this.sunPass(quad(1, 30, [0, 0, 1, 1]), 'sun', 1 - e.rain);
    const ph = e.moonPhase % 8;
    const mu = (ph % 4) / 4, mv = Math.floor(ph / 4) / 2;
    this.sunPass(quad(-1, 20, [mu, mv, mu + 0.25, mv + 0.5]), 'moon', 1 - e.rain);
  }

  /** The End's sky: a dark mottled purple box with no sun, moon or stars. */
  drawEndSky() {
    // about one texel per pixel at the middle of a face (2048 texels across 90 degrees)
    const fov = ((this.cam?.fov ?? 70) * Math.PI) / 180;
    this.skyPass({ end: true, sunDir: [0, 1, 0], stars: 0, celestial: 0, endLod: Math.max(0, Math.log2((2048 * Math.tan(fov / 2)) / this.height) - 0.3) });
  }
  protected abstract skyPass(p: SkyParams): void;
  /** A sun or moon quad (pos 3, uv 2 floats a vertex, around the camera), added on. */
  protected abstract sunPass(verts: Float32Array, tex: 'sun' | 'moon', alpha: number): void;

  /** Chunks near to far (opaque) or far to near (translucent), section runs that are in view, then sub-levels' chunks. */
  drawChunks(chunkList: Iterable<Chunk>, pass: 'opaque' | 'trans', ships: ShipDraw[] = []) {
    const cam = this.cam;
    // (often an iterator, and the shadows go through it too)
    const chunks = Array.isArray(chunkList) ? chunkList : [...chunkList];
    if (pass === 'opaque') this.prepareShadows(chunks, ships);
    const list: [number, Chunk][] = [];
    for (const c of chunks) {
      const g = c.mesh as ChunkMesh | null;
      if (!g || !(pass === 'opaque' ? g.opaque : g.trans)) continue;
      // sub-levels' chunks are drawn where their sub-level is, below
      if (isShipyardChunk(c.cx)) continue;
      if (!this.chunkVisible(c.cx, c.cz)) continue;
      const dx = c.cx * 16 + 8 - cam.x, dz = c.cz * 16 + 8 - cam.z;
      list.push([dx * dx + dz * dz, c]);
    }
    list.sort((a, b) => (pass === 'opaque' ? a[0] - b[0] : b[0] - a[0]));
    const draws: ChunkDraw[] = [];
    const runsOf = (g: ChunkMesh, visible: (s: number) => boolean) => {
      const secs = pass === 'opaque' ? g.opaqueSections : g.transSections;
      const runs: number[] = [];
      let runStart = -1, runEnd = -1;
      const flush = () => {
        if (runStart >= 0 && runEnd > runStart) runs.push(runStart, runEnd);
        runStart = runEnd = -1;
      };
      for (let s = 0; s < 16; s++) {
        const a = secs[s], b = secs[s + 1];
        if (b <= a) continue;
        if (!visible(s)) { flush(); continue; }
        if (runStart < 0) { runStart = a; runEnd = b; }
        else if (a === runEnd) runEnd = b;
        else { flush(); runStart = a; runEnd = b; }
      }
      flush();
      return runs;
    };
    for (const [, c] of list) {
      const ox = c.cx * 16 - cam.x, oz = c.cz * 16 - cam.z, g = c.mesh as ChunkMesh;
      const runs = runsOf(g, (s) => this.boxVisible(ox, s * 16 - cam.y, oz, ox + 16, s * 16 + 16 - cam.y, oz + 16));
      if (runs.length) draws.push({ mesh: g, ox, oy: -cam.y, oz, rot: IDENT3, px: 0, py: 0, pz: 0, runs });
    }
    if (pass === 'opaque') this.drawnChunks = list.length;
    // sub-levels: each chunk turned about the pivot, then put where the pivot is
    for (const sd of ships) {
      const r = sd.rot;
      for (const c of sd.chunks) {
        const g = c.mesh as ChunkMesh | null;
        if (!g || !(pass === 'opaque' ? g.opaque : g.trans)) continue;
        const px = c.cx * 16 - sd.lx, py = -sd.ly, pz = c.cz * 16 - sd.lz;
        const runs = runsOf(g, (s) => {
          // the section's centre, turned and placed, in a box big enough for any turn
          const lx = px + 8, ly = py + s * 16 + 8, lz = pz + 8;
          const x = r[0] * lx + r[3] * ly + r[6] * lz + sd.tx - cam.x, y = r[1] * lx + r[4] * ly + r[7] * lz + sd.ty - cam.y, z = r[2] * lx + r[5] * ly + r[8] * lz + sd.tz - cam.z;
          return this.boxVisible(x - 14, y - 14, z - 14, x + 14, y + 14, z + 14);
        });
        if (runs.length) draws.push({ mesh: g, ox: sd.tx - cam.x, oy: sd.ty - cam.y, oz: sd.tz - cam.z, rot: r, px, py, pz, runs });
      }
    }
    if (draws.length) this.chunkPass(pass, draws);
  }
  protected abstract chunkPass(pass: 'opaque' | 'trans', draws: ChunkDraw[]): void;
  /** Before the world's solid chunks: a backend drawing shadows renders its shadow map here. */
  protected prepareShadows(_chunks: Iterable<Chunk>, _ships: ShipDraw[]): void { /* none */ }

  /**
   * Distant terrain, drawn after the sky and before the chunks, with its own (much deeper) projection. `mask` marks the
   * chunks drawn in full (LOD_MASK x LOD_MASK, indexed by chunk coordinates modulo LOD_MASK, around chunk mcx, mcz):
   * distant terrain is hidden there. `snow` is the colour of snow on tree tops (0..255). The depth buffer is cleared
   * afterwards, so the chunks always draw over it.
   */
  drawLod(tiles: readonly LodDraw[], mask: Uint8Array, mcx: number, mcz: number, far: number, snow: [number, number, number]) {
    const cam = this.cam;
    perspective(this.lodProj, (cam.fov * Math.PI) / 180, this.width / this.height, 8, far);
    multiply(this.lodViewProj, this.lodProj, this.view);
    extractPlanes(this.lodViewProj, this.lodPlanes);
    const masked = (cx: number, cz: number) => Math.abs(cx - mcx) < LOD_MASK / 2 && Math.abs(cz - mcz) < LOD_MASK / 2 && mask[(cz & (LOD_MASK - 1)) * LOD_MASK + (cx & (LOD_MASK - 1))] > 0;
    const covered = (t: LodDraw) => {
      if (t.size > 256) return false;
      for (let cz = t.z >> 4; cz < (t.z + t.size) >> 4; cz++) for (let cx = t.x >> 4; cx < (t.x + t.size) >> 4; cx++) if (!masked(cx, cz)) return false;
      return true;
    };
    const vis = tiles.filter((t) => t.mesh && boxInPlanes(this.lodPlanes, t.x - cam.x, t.minY - cam.y, t.z - cam.z, t.x + t.size - cam.x, t.maxY - cam.y, t.z + t.size - cam.z) && !covered(t));
    this.drawnLod = vis.length;
    if (!vis.length) return;
    const pixel = (2 * Math.tan((cam.fov * Math.PI) / 360)) / this.height;
    this.lodPass({ tiles: vis, mask, mcx, mcz, snow: [snow[0] / 255, snow[1] / 255, snow[2] / 255], pixel });
  }
  protected abstract lodPass(p: LodPass): void;

  /** Draw the dynamic mesh (particles, items, falling blocks...) with the block atlas. */
  abstract drawDyn(mesh: DynMesh, opts?: DynOpts): void;
  /** A model part with a skin (entities). */
  abstract drawModel(m: ModelMesh, tex: Tex, opts: ModelOpts): void;
  /** Line segments (pairs of camera-relative points); `xray` draws them through blocks too. */
  abstract drawLines(verts: Float32Array, color: [number, number, number, number], xray?: boolean): void;
  /** Full-screen colour overlay (underwater, damage, etc.) */
  abstract drawOverlay(color: [number, number, number, number], vignette?: number): void;

  // ------------------------------------------------------------------ clouds
  drawClouds(height: number) {
    const e = this.env;
    if (!e.clouds) return;
    const CELL = 12;
    const wx = this.cam.x + e.cloudOffset, wz = this.cam.z + 3.96; // cloud-space camera position
    const ccx = Math.floor(wx / CELL), ccz = Math.floor(wz / CELL);
    if (ccx !== this.cloudCell[0] || ccz !== this.cloudCell[1]) {
      this.cloudCell = [ccx, ccz];
      this.buildClouds(ccx, ccz);
    }
    if (this.cloudVerts.length) this.cloudPass(ccx * CELL - wx, height - this.cam.y, ccz * CELL - wz, 26 * CELL);
  }
  /** Clouds (`cloudVerts`: pos 3 + shade 1 floats a vertex) at this offset from the camera: depth first, then colour where it's nearest. */
  protected abstract cloudPass(ox: number, oy: number, oz: number, range: number): void;

  private buildClouds(ccx: number, ccz: number) {
    const CELL = 12, H = 4, R = 26;
    const out: number[] = [];
    const has = (x: number, z: number) => this.cloudMap[(z & 255) * 256 + (x & 255)] === 1;
    const q = (pts: number[][], shade: number) => { for (const p of pts) out.push(p[0], p[1], p[2], shade); };
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const cx = ccx + dx, cz = ccz + dz;
        if (!has(cx, cz)) continue;
        const x0 = dx * CELL, x1 = x0 + CELL, z0 = dz * CELL, z1 = z0 + CELL;
        q([[x0, H, z0], [x0, H, z1], [x1, H, z1], [x1, H, z0]], 1.0);
        q([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 0.7);
        if (!has(cx - 1, cz)) q([[x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0]], 0.9);
        if (!has(cx + 1, cz)) q([[x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1]], 0.9);
        if (!has(cx, cz - 1)) q([[x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0]], 0.8);
        if (!has(cx, cz + 1)) q([[x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]], 0.8);
      }
    this.cloudVerts = new Float32Array(out);
    this.cloudVersion++;
  }
}

export const IDENT = mat4();
export const IDENT3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Quad index buffer contents: 0 1 2, 0 2 3 for every quad. */
export function quadIndices(): Uint32Array {
  const idx = new Uint32Array(MAX_QUADS * 6);
  for (let q = 0; q < MAX_QUADS; q++) {
    const o = q * 6, v = q * 4;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  return idx;
}

function extractPlanes(m: Mat4, p: Float32Array) {
  const rows = [
    [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
    [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
    [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
    [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
    [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
    [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
  ];
  rows.forEach((r, i) => {
    const l = Math.hypot(r[0], r[1], r[2]);
    p[i * 4] = r[0] / l; p[i * 4 + 1] = r[1] / l; p[i * 4 + 2] = r[2] / l; p[i * 4 + 3] = r[3] / l;
  });
}

function boxInPlanes(p: Float32Array, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  for (let i = 0; i < 6; i++) {
    const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
    const x = a > 0 ? x1 : x0, y = b > 0 ? y1 : y0, z = c > 0 ? z1 : z0;
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}

function makeCloudMap(): Uint8Array {
  const m = new Uint8Array(256 * 256);
  const r = new Random(0xc10d);
  // blobby noise via repeated smoothing of random seeds
  let f = new Float32Array(256 * 256).map(() => r.next());
  for (let pass = 0; pass < 3; pass++) {
    const g = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += f[((y + dy) & 255) * 256 + ((x + dx) & 255)];
        g[y * 256 + x] = s / 9;
      }
    f = g;
  }
  for (let i = 0; i < m.length; i++) m[i] = f[i] > 0.52 ? 1 : 0;
  return m;
}

export function sunImage(): Img {
  const img = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
      const i = (y * 32 + x) * 4;
      if (d < 5) { img[i] = 255; img[i + 1] = 255; img[i + 2] = d < 4 ? 235 : 200; img[i + 3] = 255; }
      else if (d < 14) { const a = Math.pow(1 - (d - 5) / 9, 1.6) * 0.55; img[i] = 255; img[i + 1] = 225; img[i + 2] = 140; img[i + 3] = a * 255; }
    }
  return img;
}

export function moonImage(): Img {
  // 4x2 phases, each 8x16 px region upscaled
  const W = 32, H = 32;
  const img = new Uint8ClampedArray(W * H * 4);
  const r = new Random(77);
  const craters = Array.from({ length: 64 }, () => r.next());
  for (let ph = 0; ph < 8; ph++) {
    const ox = (ph % 4) * 8, oy = Math.floor(ph / 4) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++) {
        const lx = x * 2 - 8 + 1, ly = y - 8 + 0.5;
        // moon is a square-ish disc; phase shadow slides across
        const inDisc = Math.abs(lx) < 6 && Math.abs(ly) < 6;
        if (!inDisc) continue;
        const phaseX = ph <= 4 ? -6 + ph * 3 : 6 - (ph - 4) * 3;
        const lit = ph === 0 ? true : ph === 4 ? false : ph < 4 ? lx > phaseX - 6 + (ph * 3) - 6 : lx < -phaseX + 6 - ((ph - 4) * 3) + 6;
        const i = ((oy + y) * W + ox + x) * 4;
        const cr = craters[(y * 8 + x) % 64] > 0.8 ? 0.8 : 1;
        const c = lit ? 220 * cr : 40;
        img[i] = c; img[i + 1] = c; img[i + 2] = c + (lit ? 10 : 20); img[i + 3] = lit ? 255 : 90;
      }
  }
  return img;
}

/** 128x128 tiling texture for the End's sky: grey-violet static over soft blotches, like vanilla's end_sky. */
export function endSkyImage(): Uint8Array {
  const N = 128, img = new Uint8Array(N * N * 4);
  let seed = 0x5eed1234;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  // tileable value noise at a few scales
  const layer = (cells: number) => {
    const g = new Float32Array(cells * cells).map(() => rnd());
    return (x: number, y: number) => {
      const fx = (x / N) * cells, fy = (y / N) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (a: number, b: number) => g[((b + cells) % cells) * cells + ((a + cells) % cells)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const big = layer(4), mid = layer(16), fine = layer(64);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = 0.42 + big(x, y) * 0.22 + mid(x, y) * 0.16 + fine(x, y) * 0.1 + (rnd() - 0.5) * 0.28;
      const i = (y * N + x) * 4;
      img[i] = Math.max(0, Math.min(255, v * 235));
      img[i + 1] = Math.max(0, Math.min(255, v * 212));
      img[i + 2] = Math.max(0, Math.min(255, v * 255));
      img[i + 3] = 255;
    }
  return img;
}

/** Box-filtered mip chain of an RGBA image (square, power of two), smallest last. */
export function mipChain(img: Uint8Array | Uint8ClampedArray, size: number): Uint8Array[] {
  const out: Uint8Array[] = [new Uint8Array(img.buffer, img.byteOffset, img.byteLength)];
  let cur = out[0];
  for (let s = size; s > 1; s >>= 1) {
    const n = s >> 1, next = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        for (let c = 0; c < 4; c++) {
          const i = (y * 2 * s + x * 2) * 4 + c;
          next[(y * n + x) * 4 + c] = (cur[i] + cur[i + 4] + cur[i + s * 4] + cur[i + s * 4 + 4] + 2) >> 2;
        }
    out.push(next);
    cur = next;
  }
  return out;
}
