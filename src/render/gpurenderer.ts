// WebGPU backend.
//
// A frame is recorded into one command encoder and sent at `endFrame`. Settings for each draw (and the scene's: view,
// lightmap, fog) go into a ring of 256-byte uniform slots picked with dynamic offsets; geometry made during the frame
// (particles, entities, lines, the sun) goes into a vertex ring. Both are written to the GPU once, just before the
// frame is submitted. If a frame needs more than the rings hold, what's recorded so far is sent and drawing carries
// on into the same picture. Pipelines are made the first time a combination of shader and state is used.
//
// The GPU can be lost (driver reset, the tab in the background on a phone): a new device is made, and `onRestore`
// tells the game to send its chunks, distant terrain and textures again; skins and models come back by themselves.
import * as W from './wgsl';
import { FRAME_FLOATS, gbufferLibrary, passSource, materialFlags, noise2D, noise3DData, resolve, locate, type Assembled } from './gpupack';
import { TEXTURES } from '../world/blocks';
import { invert, mat4 } from '../math';
import type { ShaderPackSource, ShaderPass } from '../packs/types';
import type { AtlasTarget } from './atlas';
import { Renderer, IDENT, IDENT3, LOD_MASK, quadIndices, sunImage, moonImage, endSkyImage, mipChain, type EnvState, type ChunkMesh, type ChunkDraw, type Tex, type ModelMesh, type DynOpts, type ModelOpts, type LodPass, type SkyParams } from './renderer';
import type { DynMesh } from './dynmesh';
import type { Chunk } from '../world/world';
import type { ShipDraw } from './renderer';
import type { MeshResult } from '../world/mesher';
import type { Mat4 } from '../math';
import { S, Img } from './pixels';

type Kind = 'chunk' | 'dyn' | 'entity' | 'sky' | 'sun' | 'cloud' | 'line' | 'overlay' | 'lod';
type TexKind = 'array' | '2d' | 'none';
type Blend = 'none' | 'alpha' | 'add';
interface State { blend?: Blend; depthTest?: boolean; depthWrite?: boolean; cull?: boolean; colorWrite?: boolean; bias?: boolean; /** only behind what's drawn (depth greater, not written) */ hidden?: boolean }

const SLOT = 256;
const DEPTH: GPUTextureFormat = 'depth32float';

const HDR: GPUTextureFormat = 'rgba16float';

const KINDS: Record<Kind, { src: string; pack?: (lib: string) => string; tex: TexKind; buffers: GPUVertexBufferLayout[]; topology?: GPUPrimitiveTopology }> = {
  chunk: {
    src: W.CHUNK, pack: W.chunkSrc, tex: 'array',
    buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, format: 'uint16x4', offset: 0 }, { shaderLocation: 1, format: 'uint8x4', offset: 8 }, { shaderLocation: 2, format: 'unorm8x4', offset: 12 }] }],
  },
  dyn: {
    src: W.DYN, pack: W.dynSrc, tex: 'array',
    buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }, { shaderLocation: 1, format: 'float32x3', offset: 12 }, { shaderLocation: 2, format: 'unorm8x4', offset: 24 }, { shaderLocation: 3, format: 'unorm8x2', offset: 28 }] }],
  },
  entity: {
    src: W.ENTITY, pack: W.entitySrc, tex: '2d',
    buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }, { shaderLocation: 1, format: 'float32x2', offset: 12 }, { shaderLocation: 2, format: 'float32x3', offset: 20 }] }],
  },
  sky: { src: W.SKY, pack: W.skySrc, tex: '2d', buffers: [] },
  sun: {
    src: W.SUN, tex: '2d',
    buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }, { shaderLocation: 1, format: 'float32x2', offset: 12 }] }],
  },
  cloud: {
    src: W.CLOUD, tex: 'none',
    buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }, { shaderLocation: 1, format: 'float32', offset: 12 }] }],
  },
  line: { src: W.LINE, tex: 'none', topology: 'line-list', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, format: 'float32x3', offset: 0 }] }] },
  overlay: { src: W.OVERLAY, tex: 'none', buffers: [] },
  lod: {
    src: W.LOD, pack: W.lodSrc, tex: '2d',
    buffers: [{ arrayStride: 16, stepMode: 'instance', attributes: [{ shaderLocation: 0, format: 'sint16x4', offset: 0 }, { shaderLocation: 1, format: 'uint16x2', offset: 8 }, { shaderLocation: 2, format: 'unorm8x4', offset: 12 }] }],
  },
};

/** CPU-side data written to one GPU buffer at the end of each frame (or sooner, if it fills up). */
class Ring {
  cpu!: ArrayBuffer;
  f32!: Float32Array;
  i32!: Int32Array;
  u8!: Uint8Array;
  gpu!: GPUBuffer;
  used = 0;
  /** What this frame has used so far, over all its submits. */
  frame = 0;
  /** It filled up this frame: made big enough for the whole frame when it ends. */
  short = false;
  constructor(private device: GPUDevice, public size: number, private usage: number, private label: string) { this.make(); }
  private make() {
    this.cpu = new ArrayBuffer(this.size);
    this.f32 = new Float32Array(this.cpu);
    this.i32 = new Int32Array(this.cpu);
    this.u8 = new Uint8Array(this.cpu);
    this.gpu = this.device.createBuffer({ size: this.size, usage: this.usage | GPUBufferUsage.COPY_DST, label: this.label });
  }
  fits(bytes: number, align: number) { return Math.ceil(this.used / align) * align + bytes <= this.size; }
  alloc(bytes: number, align: number) {
    const o = Math.ceil(this.used / align) * align;
    this.used = o + bytes;
    return o;
  }
  upload(queue: GPUQueue) {
    if (this.used) queue.writeBuffer(this.gpu, 0, this.cpu, 0, Math.ceil(this.used / 4) * 4);
    this.frame += this.used;
    this.used = 0;
  }
  /** At least `need` bytes (with room to spare); true when the GPU buffer is new (so are its bind groups). */
  grow(need: number): boolean {
    let size = this.size;
    while (size < need * 1.25) size *= 2;
    if (size === this.size) return false;
    this.gpu.destroy();
    this.size = size;
    this.make();
    return true;
  }
  /** The frame is over: if it didn't fit, grow to what it used. */
  endFrame(): boolean {
    const grew = this.short && this.grow(this.frame);
    this.frame = 0;
    this.short = false;
    return grew;
  }
}

interface GPUChunk extends ChunkMesh { opaqueBuf: GPUBuffer | null; transBuf: GPUBuffer | null; gen: number }
interface GPULod { buf: GPUBuffer; opaque: number; bytes: number; gen: number }
interface GPUTex extends Tex { img: Img; tex: GPUTexture | null; bg: GPUBindGroup | null; gen: number }
interface GPUModel extends ModelMesh { verts: Float32Array; buf: GPUBuffer | null; gen: number }

/** A full-screen pass of the shader pack in use. */
interface PackPass { def: ShaderPass; inputs: string[]; bgl: GPUBindGroupLayout; pipe: GPURenderPipeline | null; scale: number; on: boolean }
/** The shader pack in use, compiled. */
interface ActivePack {
  src: ShaderPackSource;
  name: string;
  lib: Assembled;
  modules: Map<Kind, GPUShaderModule>;
  bgl: GPUBindGroupLayout;
  layouts: Record<TexKind, GPUPipelineLayout>;
  passLayout: GPUBindGroupLayout;
  passes: PackPass[];
  final: PackPass;
  shadowPipe: GPURenderPipeline | null;
  shadow: { on: boolean; res: number; dist: number };
  clouds: boolean;
  sun: boolean;
  jitter: boolean;
}
/** Textures a shader pack draws with, sized to the screen. */
interface PackFrame {
  w: number; h: number; key: string;
  scene: GPUTexture; opaqueColor: GPUTexture; opaqueDepth: GPUTexture; lodDepth: GPUTexture;
  targets: Map<string, GPUTexture>; history: Map<string, GPUTexture>;
  packBG: GPUBindGroup; passBG: GPUBindGroup; inputs: Map<string, GPUBindGroup>;
}

export class GPURenderer extends Renderer {
  readonly backend = 'webgpu' as const;
  device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private info = '';
  /** Bumped when the device is made again: older GPU objects are gone. */
  private gen = 0;
  private ready = false;
  private errors = 0;

  private uni!: Ring;
  private vtx!: Ring;
  private indexBuf!: GPUBuffer;
  private bglScene!: GPUBindGroupLayout;
  private bglDraw!: GPUBindGroupLayout;
  private bglTex!: Record<TexKind, GPUBindGroupLayout>;
  private layouts!: Record<TexKind, GPUPipelineLayout>;
  private modules = new Map<Kind, GPUShaderModule>();
  private pipelines = new Map<string, GPURenderPipeline>();
  private sceneBG!: GPUBindGroup;
  private drawBG!: GPUBindGroup;
  private emptyBG!: GPUBindGroup;
  private atlasSampler!: GPUSampler;
  private nearest!: GPUSampler;
  private repeatLinear!: GPUSampler;
  private atlasBG: GPUBindGroup | null = null;
  private sunTex: GPUTex | null = null;
  private moonTex: GPUTex | null = null;
  private endSkyBG!: GPUBindGroup;
  private lodMask!: GPUTexture;
  private lodMaskBG!: GPUBindGroup;
  private cloudBuf: GPUBuffer | null = null;
  private cloudUploaded = -1;
  private depthTex: GPUTexture | null = null;
  private depthGen = 0;
  /** What draws now write to: the canvas's format, or HDR while a shader pack's world is drawn. */
  private colorFormat: GPUTextureFormat = 'bgra8unorm';
  private canvasView: GPUTextureView | null = null;

  // shader packs
  private pack: ActivePack | null = null;
  private packSrc: ShaderPackSource | null = null;
  private pf: PackFrame | null = null;
  private packPipes = new WeakSet<GPURenderPipeline>();
  private curPack = false;
  private sceneOpen = false;
  private shadowDone = false;
  private transDone = false;
  private shadowActive = false;
  private frameBuf: GPUBuffer | null = null;
  private frameData = new Float32Array(FRAME_FLOATS);
  private prevVP = mat4();
  private prevCam = [0, 0, 0];
  private frameNo = 0;
  private shadowTex: GPUTexture | null = null;
  private dummyDepth: GPUTexture | null = null;
  private noiseTex2: GPUTexture | null = null;
  private noiseTex3: GPUTexture | null = null;
  private materialsTex: GPUTexture | null = null;
  private cmpSampler: GPUSampler | null = null;
  private linearClamp: GPUSampler | null = null;

  // the frame being recorded
  private encoder: GPUCommandEncoder | null = null;
  private pass: GPURenderPassEncoder | null = null;
  private target: GPUTextureView | null = null;
  private targetW = 1;
  private targetH = 1;
  private inset: [number, number, number, number] | null = null;
  /** Destroyed once the frame using them is sent. */
  private trash: (GPUBuffer | GPUTexture)[] = [];
  // what's bound, so it isn't bound again
  private curPipe: GPURenderPipeline | null = null;
  private curScene = -1;
  private curTex: GPUBindGroup | null = null;
  private curVB: GPUBuffer | null = null;
  private curVBOff = -1;
  // the scene slot written last, and what was in it
  private sceneOff = -1;
  private sceneVP = new Float32Array(16);
  private sceneEnv: EnvState | null = null;

  private constructor(canvas: HTMLCanvasElement) { super(canvas); }

  /** A WebGPU renderer, or an error when this browser or GPU can't do it (before the canvas is touched). */
  static async create(canvas: HTMLCanvasElement): Promise<GPURenderer> {
    const r = new GPURenderer(canvas);
    await r.initDevice();
    return r;
  }

  describe() { return 'WebGPU' + (this.info ? ` (${this.info})` : ''); }

  private async initDevice() {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('no WebGPU adapter');
    // the block textures are one array layer each (several hundred with item sprites and mods)
    if (adapter.limits.maxTextureArrayLayers < 1024) throw new Error(`the GPU allows ${adapter.limits.maxTextureArrayLayers} texture layers`);
    const device = await adapter.requestDevice({ requiredLimits: {
      maxTextureArrayLayers: Math.min(4096, adapter.limits.maxTextureArrayLayers),
      // shader packs' passes read many textures
      maxSampledTexturesPerShaderStage: Math.min(32, adapter.limits.maxSampledTexturesPerShaderStage),
    } });
    const ai = adapter.info;
    this.info = [ai?.vendor, ai?.architecture || ai?.device].filter(Boolean).join(' ');
    device.addEventListener('uncapturederror', (e) => {
      if (this.errors++ < 20) console.error('WebGPU:', (e as GPUUncapturedErrorEvent).error.message);
    });
    void device.lost.then((info) => {
      if (this.device !== device) return;
      console.warn('WebGPU device lost:', info.reason, info.message);
      this.ready = false;
      this.encoder = null;
      this.pass = null;
      // a new device, and everything on the GPU again
      const retry = (n: number) => this.initDevice().then(() => {
        this.gen++;
        this.onRestore?.();
        if (this.packSrc) void this.setShaderPack(this.packSrc);
      }, (err) => {
        console.error('WebGPU: could not get the GPU back', err);
        if (n < 5) setTimeout(() => retry(n + 1), 1000 * (n + 1));
      });
      retry(0);
    });
    this.device = device;
    if (!this.context) {
      this.canvas.setAttribute('data-gfx', 'webgpu');
      const ctx = this.canvas.getContext('webgpu');
      if (!ctx) throw new Error('no WebGPU canvas context');
      this.context = ctx;
    }
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.makeResources();
    this.ready = true;
  }

  private makeResources() {
    const d = this.device;
    this.pipelines.clear();
    this.modules.clear();
    this.cloudBuf = null;
    this.cloudUploaded = -1;
    this.depthTex = null;
    this.atlasBG = null;
    this.pack = null;
    this.pf = null;
    this.frameBuf = this.shadowTex = this.dummyDepth = this.noiseTex2 = this.noiseTex3 = this.materialsTex = null;
    this.cmpSampler = this.linearClamp = this.repeatSampler = null;
    this.shadowPassBG = null;
    this.uni = new Ring(d, 1 << 21, GPUBufferUsage.UNIFORM, 'uniforms');
    this.vtx = new Ring(d, 1 << 22, GPUBufferUsage.VERTEX, 'frame vertices');
    const idx = quadIndices();
    this.indexBuf = d.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, label: 'quad indices' });
    d.queue.writeBuffer(this.indexBuf, 0, idx);
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.bglScene = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
    this.bglDraw = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
    const texBGL = (dim: GPUTextureViewDimension) => d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: dim } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} }],
    });
    this.bglTex = { array: texBGL('2d-array'), '2d': texBGL('2d'), none: d.createBindGroupLayout({ entries: [] }) };
    this.layouts = {
      array: d.createPipelineLayout({ bindGroupLayouts: [this.bglScene, this.bglTex.array, this.bglDraw] }),
      '2d': d.createPipelineLayout({ bindGroupLayouts: [this.bglScene, this.bglTex['2d'], this.bglDraw] }),
      none: d.createPipelineLayout({ bindGroupLayouts: [this.bglScene, this.bglTex.none, this.bglDraw] }),
    };
    this.uniformGroups();
    this.emptyBG = d.createBindGroup({ layout: this.bglTex.none, entries: [] });
    this.atlasSampler = d.createSampler({ magFilter: 'nearest', minFilter: 'nearest', mipmapFilter: 'linear', maxAnisotropy: 1 });
    this.nearest = d.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    this.repeatLinear = d.createSampler({ magFilter: 'nearest', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
    this.sunTex ??= this.makeTexture(sunImage(), 32) as GPUTex;
    this.moonTex ??= this.makeTexture(moonImage(), 32) as GPUTex;
    // End sky: tiling noise with mipmaps, so the fine grain doesn't shimmer
    const mips = mipChain(endSkyImage(), 128);
    const end = d.createTexture({ size: [128, 128], mipLevelCount: mips.length, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'end sky' });
    mips.forEach((m, l) => d.queue.writeTexture({ texture: end, mipLevel: l }, m, { bytesPerRow: (128 >> l) * 4 }, [128 >> l, 128 >> l]));
    this.endSkyBG = this.texGroup('2d', end.createView(), this.repeatLinear);
    this.lodMask = d.createTexture({ size: [LOD_MASK, LOD_MASK], format: 'r8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'distant terrain mask' });
    this.lodMaskBG = this.texGroup('2d', this.lodMask.createView(), this.nearest);
    // the shaders now, so their errors show up at start
    for (const k of Object.keys(KINDS) as Kind[]) this.module(k);
    this.warmUp();
  }

  private uniformGroups() {
    const d = this.device;
    this.sceneBG = d.createBindGroup({ layout: this.bglScene, entries: [{ binding: 0, resource: { buffer: this.uni.gpu, size: SLOT } }] });
    this.drawBG = d.createBindGroup({ layout: this.bglDraw, entries: [{ binding: 0, resource: { buffer: this.uni.gpu, size: SLOT } }] });
  }

  private texGroup(kind: TexKind, view: GPUTextureView, sampler: GPUSampler) {
    return this.device.createBindGroup({ layout: this.bglTex[kind], entries: [{ binding: 0, resource: view }, { binding: 1, resource: sampler }] });
  }

  private module(kind: Kind) {
    let m = this.modules.get(kind);
    if (!m) {
      m = this.device.createShaderModule({ code: KINDS[kind].src, label: kind });
      this.modules.set(kind, m);
      void m.getCompilationInfo().then((ci) => {
        for (const msg of ci.messages) if (msg.type === 'error') console.error(`WGSL ${kind}:${msg.lineNum}:${msg.linePos} ${msg.message}`);
      });
    }
    return m;
  }

  private pipeline(kind: Kind, s: State = {}): GPURenderPipeline {
    const packed = this.packed(kind);
    const key = pipelineKey(kind, s, this.colorFormat, packed);
    let p = this.pipelines.get(key);
    if (!p) {
      p = this.device.createRenderPipeline(this.pipelineDesc(kind, s, this.colorFormat, packed));
      this.pipelines.set(key, p);
      if (packed) this.packPipes.add(p);
    }
    return p;
  }

  /** Whether this kind of draw uses the shader pack's version of its shader (the world, while it's being drawn). */
  private packed(kind: Kind) { return !!this.pack && !!KINDS[kind].pack && this.colorFormat === HDR; }

  /** Pipelines most frames use, made in the background so the first frames don't wait for them. */
  private warmUp() {
    const device = this.device;
    for (const [kind, s] of WARM) {
      const key = pipelineKey(kind, s, this.format, false);
      if (this.pipelines.has(key)) continue;
      device.createRenderPipelineAsync(this.pipelineDesc(kind, s, this.format, false)).then((p) => {
        if (this.device === device && !this.pipelines.has(key)) this.pipelines.set(key, p);
      }, (e) => console.error('WebGPU pipeline', key, e));
    }
  }

  private pipelineDesc(kind: Kind, s: State, format: GPUTextureFormat, packed: boolean, pk = this.pack): GPURenderPipelineDescriptor {
    const blend = s.blend ?? 'none', dt = s.depthTest !== false, dw = dt && s.depthWrite !== false && !s.hidden, cull = !!s.cull, cw = s.colorWrite !== false, bias = !!s.bias;
    const k = KINDS[kind], module = packed ? pk!.modules.get(kind)! : this.module(kind);
    const BLENDS: Record<Blend, GPUBlendState | undefined> = {
      none: undefined,
      alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
      add: { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } },
    };
    const topology = k.topology ?? 'triangle-list';
    return {
      label: pipelineKey(kind, s, format, packed),
      layout: packed ? pk!.layouts[k.tex] : this.layouts[k.tex],
      vertex: { module, entryPoint: 'vs', buffers: k.buffers },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: BLENDS[blend], writeMask: cw ? GPUColorWrite.ALL : 0 }] },
      primitive: { topology, cullMode: cull ? 'back' : 'none', frontFace: 'ccw' },
      depthStencil: { format: DEPTH, depthWriteEnabled: dw, depthCompare: !dt ? 'always' : s.hidden ? 'greater' : 'less-equal', ...(bias && topology === 'triangle-list' ? { depthBias: -10, depthBiasSlopeScale: -1 } : {}) },
    };
  }

  // ------------------------------------------------------------------ resources
  protected atlasTarget(): AtlasTarget {
    let tex: GPUTexture | null = null, res = S;
    const gen = this.gen;
    return {
      all: (levels, size) => {
        if (!this.ready) return;
        res = size;
        const layers = levels[0].length / (size * size * 4);
        tex = this.device.createTexture({ size: [size, size, layers], mipLevelCount: levels.length, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'block atlas' });
        for (let l = 0, sz = size; l < levels.length; l++, sz >>= 1) this.device.queue.writeTexture({ texture: tex, mipLevel: l }, levels[l], { bytesPerRow: sz * 4, rowsPerImage: sz }, [sz, sz, layers]);
        this.atlasBG = this.texGroup('array', tex.createView({ dimension: '2d-array' }), this.atlasSampler);
        this.atlasLayers = layers;
      },
      layer: (layer, mips) => {
        if (!tex || gen !== this.gen) return;
        for (let l = 0, size = res; l < mips.length; l++, size >>= 1) this.device.queue.writeTexture({ texture: tex, mipLevel: l, origin: [0, 0, layer] }, mips[l], { bytesPerRow: size * 4 }, [size, size, 1]);
      },
      destroy: () => { if (tex) this.discard(tex); tex = null; },
    };
  }
  private atlasLayers = 0;

  protected skyImages(sun: { img: Img; w: number }, moon: { img: Img; w: number }) {
    if (this.sunTex) this.freeTexture(this.sunTex);
    if (this.moonTex) this.freeTexture(this.moonTex);
    this.sunTex = this.makeTexture(sun.img, sun.w) as GPUTex;
    this.moonTex = this.makeTexture(moon.img, moon.w) as GPUTex;
  }

  makeTexture(img: Img, w: number): Tex {
    return { w, h: img.length / 4 / w, img, tex: null, bg: null, gen: -1 } as GPUTex;
  }

  /** A skin's bind group, made (again) on the current device when needed. */
  private texBG(t: GPUTex) {
    if (t.gen !== this.gen || !t.bg) {
      const tex = this.device.createTexture({ size: [t.w, t.h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      this.device.queue.writeTexture({ texture: tex }, t.img, { bytesPerRow: t.w * 4 }, [t.w, t.h]);
      t.tex = tex;
      t.bg = this.texGroup('2d', tex.createView(), this.nearest);
      t.gen = this.gen;
    }
    return t.bg;
  }

  freeTexture(t: Tex) {
    const g = t as GPUTex;
    if (g.tex && g.gen === this.gen) this.discard(g.tex);
    g.tex = null;
    g.bg = null;
  }

  createModel(verts: Float32Array): ModelMesh {
    return { quads: verts.length / 32, verts, buf: null, gen: -1 } as GPUModel;
  }

  private modelBuf(m: GPUModel) {
    if (m.gen !== this.gen || !m.buf) {
      m.buf = this.device.createBuffer({ size: Math.max(4, m.verts.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(m.buf, 0, m.verts);
      m.gen = this.gen;
    }
    return m.buf;
  }

  /** Free a GPU object once nothing being drawn uses it. */
  private discard(o: GPUBuffer | GPUTexture) {
    if (this.encoder) this.trash.push(o);
    else o.destroy();
  }

  /** A vertex buffer holding `data`, reusing `old` when it's big enough (and not much too big). */
  private vertexBuffer(data: ArrayBuffer, old: GPUBuffer | null, label: string): GPUBuffer | null {
    if (!data.byteLength) { if (old) this.discard(old); return null; }
    if (old && old.size >= data.byteLength && old.size <= data.byteLength * 2) {
      this.device.queue.writeBuffer(old, 0, data);
      return old;
    }
    if (old) this.discard(old);
    const size = Math.ceil((data.byteLength * 1.25) / 64) * 64;
    const b = this.device.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label });
    this.device.queue.writeBuffer(b, 0, data);
    return b;
  }

  // ------------------------------------------------------------------ chunk meshes
  uploadChunk(c: Chunk, r: MeshResult) {
    if (!this.ready) return;
    let g = c.mesh as GPUChunk | null;
    if (g && g.gen !== this.gen) { this.chunkBytes -= g.bytes; g = null; }
    if (!g) {
      g = { opaqueBuf: null, transBuf: null, opaqueSections: r.opaqueSections, transSections: r.transSections, opaque: 0, trans: 0, bytes: 0, gen: this.gen };
      c.mesh = g;
    }
    this.chunkBytes -= g.bytes;
    g.opaqueBuf = this.vertexBuffer(r.opaque, g.opaqueBuf, 'chunk');
    g.transBuf = this.vertexBuffer(r.trans, g.transBuf, 'chunk (translucent)');
    g.opaqueSections = r.opaqueSections;
    g.transSections = r.transSections;
    g.opaque = r.opaque.byteLength / 64;
    g.trans = r.trans.byteLength / 64;
    g.bytes = r.opaque.byteLength + r.trans.byteLength;
    this.chunkBytes += g.bytes;
  }

  freeChunk(c: Chunk) {
    const g = c.mesh as GPUChunk | null;
    if (!g) return;
    if (g.gen === this.gen) {
      if (g.opaqueBuf) this.discard(g.opaqueBuf);
      if (g.transBuf) this.discard(g.transBuf);
    }
    this.chunkBytes -= g.bytes;
    c.mesh = null;
  }

  uploadLod(data: ArrayBuffer, opaque: number): GPULod {
    const buf = this.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'distant terrain' });
    if (data.byteLength) this.device.queue.writeBuffer(buf, 0, data);
    this.lodBytes += data.byteLength;
    return { buf, opaque, bytes: data.byteLength, gen: this.gen };
  }

  freeLod(m: unknown) {
    const g = m as GPULod;
    if (g.gen === this.gen) this.discard(g.buf);
    this.lodBytes -= g.bytes;
  }

  // ------------------------------------------------------------------ frame
  beginFrame(env: EnvState) {
    if (this.encoder) this.endFrame();
    this.env = env;
    if (!this.ready) return;
    const tex = this.context.getCurrentTexture();
    if (!this.depthTex || this.depthTex.width !== tex.width || this.depthTex.height !== tex.height) {
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({ size: [tex.width, tex.height], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC, label: 'depth' });
      this.depthGen++;
    }
    this.canvasView = tex.createView();
    this.target = this.canvasView;
    this.colorFormat = this.format;
    this.targetW = tex.width;
    this.targetH = tex.height;
    this.inset = null;
    this.encoder = this.device.createCommandEncoder();
    if (this.pack) {
      // a shader pack: the world is drawn in HDR into a texture of its own, and the pack's passes make the picture
      this.packFrame(tex.width, tex.height);
      this.writeFrame(env);
      this.target = this.pf!.scene.createView();
      this.colorFormat = HDR;
      this.sceneOpen = true;
      this.shadowDone = false;
      this.transDone = false;
      {
        // no distant terrain until it's drawn (and copied) this frame
        this.encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.pf!.lodDepth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } }).end();
        this.lodCopied = false;
      }
    }
    this.openPass(env.fogColor, true);
  }

  private openPass(clear: [number, number, number] | null, clearDepth: boolean) {
    this.pass = this.encoder!.beginRenderPass({
      // (a shader pack's scene keeps alpha 0 where nothing was drawn: the sky)
      colorAttachments: [{ view: this.target!, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: clear ? { r: clear[0], g: clear[1], b: clear[2], a: this.sceneOpen ? 0 : 1 } : undefined }],
      depthStencilAttachment: { view: this.depthTex!.createView(), depthLoadOp: clearDepth ? 'clear' : 'load', depthStoreOp: 'store', depthClearValue: 1 },
    });
    this.pass.setIndexBuffer(this.indexBuf, 'uint32');
    this.curPipe = null;
    this.curScene = -1;
    this.curTex = null;
    this.curVB = null;
    this.curVBOff = -1;
    this.curPack = false;
    if (this.inset) this.applyInset();
  }

  /** Send what's recorded so far (the rings are full) and carry on drawing into the same picture. */
  private flush() {
    if (!this.encoder || !this.pass) return;
    this.pass.end();
    this.submit();
    this.encoder = this.device.createCommandEncoder();
    this.openPass(null, false);
  }

  private submit() {
    this.uni.upload(this.device.queue);
    this.vtx.upload(this.device.queue);
    this.device.queue.submit([this.encoder!.finish()]);
    this.encoder = null;
    this.pass = null;
    this.sceneOff = -1;
    for (const o of this.trash) o.destroy();
    this.trash.length = 0;
  }

  endFrame() {
    if (!this.encoder || !this.pass) return;
    this.finishScene();
    this.pass.end();
    this.submit();
    this.target = null;
    if (this.uni.endFrame()) this.uniformGroups();
    this.vtx.endFrame();
  }

  clearDepth() {
    if (!this.pass) return;
    this.pass.end();
    this.openPass(null, true);
  }

  beginInset(x: number, y: number, w: number, h: number) {
    if (!this.pass) return;
    // (over the shader pack's finished picture)
    this.finishScene();
    const x0 = Math.max(0, Math.min(this.targetW, x)), y0 = Math.max(0, Math.min(this.targetH, y));
    const x1 = Math.max(x0, Math.min(this.targetW, x + w)), y1 = Math.max(y0, Math.min(this.targetH, y + h));
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    this.inset = [x0, y0, x1 - x0, y1 - y0];
    this.applyInset();
    // cleared to black, and the depth with it
    this.overlayDraw([0, 0, 0, 1], 0, 1, this.clearPipeline());
  }

  private applyInset() {
    const [x, y, w, h] = this.inset!;
    this.pass!.setViewport(x, y, w, h, 0, 1);
    this.pass!.setScissorRect(x, y, w, h);
  }

  endInset() {
    if (!this.pass || !this.inset) return;
    this.inset = null;
    this.pass.setViewport(0, 0, this.targetW, this.targetH, 0, 1);
    this.pass.setScissorRect(0, 0, this.targetW, this.targetH);
  }

  // ------------------------------------------------------------------ drawing helpers
  /** Room for `slots` uniform slots and `bytes` of vertices in this pass, sending what's recorded if not. */
  private room(slots: number, bytes = 0) {
    const u = this.uni.fits(slots * SLOT, SLOT), v = this.vtx.fits(bytes, 16);
    if (u && v) return;
    if (!u) this.uni.short = true;
    if (!v) this.vtx.short = true;
    this.flush();
    // one mesh bigger than the whole ring: big enough for it now (nothing is recorded that uses the old one)
    if (!this.vtx.fits(bytes, 16)) this.vtx.grow(bytes);
  }

  /** The scene slot for this view-projection and the current lightmap/fog settings (written when they change). */
  private scene(vp: Mat4): number {
    if (this.sceneOff >= 0 && this.sceneEnv === this.env && sameMat(this.sceneVP, vp)) return this.sceneOff;
    const o = this.uni.alloc(SLOT, SLOT), f = this.uni.f32, i = o >> 2, e = this.env;
    f.set(vp, i);
    f[i + 16] = e.skyLightCol[0]; f[i + 17] = e.skyLightCol[1]; f[i + 18] = e.skyLightCol[2]; f[i + 19] = e.sunBright;
    f[i + 20] = e.ambientCol[0]; f[i + 21] = e.ambientCol[1]; f[i + 22] = e.ambientCol[2]; f[i + 23] = e.ambient;
    f[i + 24] = e.fogColor[0]; f[i + 25] = e.fogColor[1]; f[i + 26] = e.fogColor[2]; f[i + 27] = e.gamma;
    f[i + 28] = e.skyColor[0]; f[i + 29] = e.skyColor[1]; f[i + 30] = e.skyColor[2]; f[i + 31] = e.flicker;
    f[i + 32] = e.fogStart; f[i + 33] = e.fogEnd; f[i + 34] = e.nightVision ?? 0;
    this.sceneVP.set(vp);
    this.sceneEnv = e;
    this.sceneOff = o;
    return o;
  }

  /** A draw slot: its float index into `uni.f32` (and byte offset). */
  private slot(): [number, number] {
    const o = this.uni.alloc(SLOT, SLOT);
    this.uni.f32.fill(0, o >> 2, (o + SLOT) >> 2);
    return [o >> 2, o];
  }

  private bind(pipe: GPURenderPipeline, sceneOff: number, tex: GPUBindGroup | null, drawOff: number) {
    const p = this.pass!;
    if (pipe !== this.curPipe) {
      p.setPipeline(pipe);
      this.curPipe = pipe;
      // the shader pack's frame, shadow map, noise...
      if (this.packPipes.has(pipe) && !this.curPack && this.pf) { p.setBindGroup(3, this.pf.packBG); this.curPack = true; }
    }
    if (sceneOff !== this.curScene) { p.setBindGroup(0, this.sceneBG, [sceneOff]); this.curScene = sceneOff; }
    const t = tex ?? this.emptyBG;
    if (t !== this.curTex) { p.setBindGroup(1, t); this.curTex = t; }
    p.setBindGroup(2, this.drawBG, [drawOff]);
  }

  private vertexBufferAt(buf: GPUBuffer, offset: number, size?: number) {
    if (buf === this.curVB && offset === this.curVBOff) return;
    this.pass!.setVertexBuffer(0, buf, offset, size);
    this.curVB = buf;
    this.curVBOff = offset;
  }

  /** Copy bytes into the frame's vertex ring (room must have been made). */
  private frameVerts(bytes: Uint8Array) {
    const o = this.vtx.alloc(bytes.byteLength, 16);
    this.vtx.u8.set(bytes, o);
    return o;
  }

  // ------------------------------------------------------------------ passes
  protected skyPass(sp: SkyParams) {
    if (!this.pass) return;
    this.room(2);
    const e = this.env, sc = this.scene(this.viewProj), [i, o] = this.slot(), f = this.uni.f32;
    f.set(this.invViewProj, i);
    f.set(e.skyColor, i + 16); f[i + 19] = sp.stars;
    f.set(e.voidColor, i + 20); f[i + 23] = sp.celestial;
    f.set(e.sunrise, i + 24);
    f.set(sp.sunDir, i + 28); f[i + 31] = sp.end ? 1 : 0;
    f[i + 32] = sp.endLod;
    this.bind(this.pipeline('sky', { depthTest: false }), sc, this.endSkyBG, o);
    this.pass.draw(3);
  }

  protected sunPass(verts: Float32Array, tex: 'sun' | 'moon', alpha: number) {
    if (!this.pass || (tex === 'sun' && this.pack && !this.pack.sun && this.sceneOpen)) return;
    const bytes = new Uint8Array(verts.buffer, verts.byteOffset, verts.byteLength);
    this.room(2, bytes.byteLength);
    const sc = this.scene(this.viewProj), [i, o] = this.slot();
    this.uni.f32[i] = alpha;
    const vo = this.frameVerts(bytes);
    this.bind(this.pipeline('sun', { depthTest: false, blend: 'add' }), sc, this.texBG((tex === 'sun' ? this.sunTex : this.moonTex)!), o);
    this.vertexBufferAt(this.vtx.gpu, vo, bytes.byteLength);
    this.pass.drawIndexed(6);
  }

  protected chunkPass(pass: 'opaque' | 'trans', draws: ChunkDraw[]) {
    if (!this.pass || !this.atlasBG) return;
    if (pass === 'trans') this.copyOpaque();
    const pipe = this.pipeline('chunk', pass === 'opaque' ? { cull: true } : { cull: true, blend: 'alpha' });
    const cut = pass === 'opaque' ? 0.5 : 0.01;
    for (const d of draws) {
      const g = d.mesh as GPUChunk;
      const buf = pass === 'opaque' ? g.opaqueBuf : g.transBuf;
      if (!buf || g.gen !== this.gen) continue;
      this.room(2);
      const sc = this.scene(this.viewProj), [i, o] = this.slot(), f = this.uni.f32, r = d.rot;
      f[i] = r[0]; f[i + 1] = r[1]; f[i + 2] = r[2];
      f[i + 4] = r[3]; f[i + 5] = r[4]; f[i + 6] = r[5];
      f[i + 8] = r[6]; f[i + 9] = r[7]; f[i + 10] = r[8];
      f[i + 12] = d.ox; f[i + 13] = d.oy; f[i + 14] = d.oz; f[i + 15] = cut;
      f[i + 16] = d.px; f[i + 17] = d.py; f[i + 18] = d.pz; f[i + 19] = pass === 'trans' ? 1 : 0;
      this.bind(pipe, sc, this.atlasBG, o);
      this.vertexBufferAt(buf, 0);
      for (let k = 0; k < d.runs.length; k += 2) this.pass.drawIndexed((d.runs[k + 1] - d.runs[k]) * 6, 1, d.runs[k] * 6);
    }
  }

  protected lodPass(lp: LodPass) {
    if (!this.pass) return;
    const cam = this.cam;
    this.device.queue.writeTexture({ texture: this.lodMask }, lp.mask, { bytesPerRow: LOD_MASK }, [LOD_MASK, LOD_MASK]);
    const each = (water: boolean) => {
      const pipe = this.pipeline('lod', water ? { cull: true, blend: 'alpha' } : { cull: true });
      for (const t of lp.tiles) {
        const n = water ? t.water : t.opaque, m = t.mesh as GPULod;
        if (!n || m.gen !== this.gen) continue;
        this.room(2);
        const sc = this.scene(this.lodViewProj), [i, o] = this.slot(), f = this.uni.f32, k = this.uni.i32;
        f[i] = t.x - cam.x; f[i + 1] = -cam.y; f[i + 2] = t.z - cam.z; f[i + 3] = t.cell;
        k[i + 4] = t.x >> 4; k[i + 5] = t.z >> 4;
        k[i + 6] = Math.floor(t.x / t.cell); k[i + 7] = Math.floor(t.z / t.cell);
        k[i + 8] = lp.mcx; k[i + 9] = lp.mcz;
        f[i + 10] = water ? 1 : 0; f[i + 11] = lp.pixel;
        f.set(lp.snow, i + 12);
        this.bind(pipe, sc, this.lodMaskBG, o);
        this.vertexBufferAt(m.buf, 0);
        this.pass!.draw(6, n, 0, water ? m.opaque : 0);
      }
    };
    each(false);
    each(true);
    // a shader pack's passes need to know how far distant terrain is: its depth, kept before it's cleared
    if (this.pf && this.sceneOpen && this.pass) {
      this.pass.end();
      this.pass = null;
      this.encoder!.copyTextureToTexture({ texture: this.depthTex! }, { texture: this.pf.lodDepth }, [this.pf.w, this.pf.h]);
      const inv = mat4();
      invert(inv, this.lodViewProj);
      this.device.queue.writeBuffer(this.frameBuf!, 176 * 4, inv);
      this.lodCopied = true;
      this.openPass(null, true);
      return;
    }
    this.clearDepth();
  }
  private lodCopied = false;

  drawDyn(mesh: DynMesh, o: DynOpts = {}) {
    if (mesh.count === 0 || !this.pass || !this.atlasBG) return;
    const bytes = mesh.bytes();
    this.room(2, bytes.byteLength);
    const sc = this.scene(o.viewProj ?? this.viewProj), [i, off] = this.slot(), f = this.uni.f32;
    f.set(o.model ?? IDENT, i);
    if (o.overlay) f.set(o.overlay, i + 16);
    f[i + 20] = o.alphaCut ?? (o.blend ? 0.01 : 0.5);
    f[i + 21] = o.fullbright ? 1 : 0;
    f[i + 22] = o.wrap ? 1 : 0;
    f[i + 23] = o.additive ? 1 : 0;
    f[i + 24] = o.viewProj && o.viewProj !== this.viewProj ? 3 : 1;
    const vo = this.frameVerts(bytes);
    const pipe = this.pipeline('dyn', {
      blend: o.blend ? (o.additive ? 'add' : 'alpha') : 'none', depthTest: o.depthTest !== false, depthWrite: o.depthWrite !== false,
      cull: o.cull !== false, colorWrite: o.colorWrite !== false, bias: !!o.polygonOffset,
    });
    this.bind(pipe, sc, this.atlasBG, off);
    this.vertexBufferAt(this.vtx.gpu, vo, bytes.byteLength);
    this.pass.drawIndexed((mesh.count / 4) * 6);
  }

  drawModel(m: ModelMesh, tex: Tex, mo: ModelOpts) {
    if (!this.pass) return;
    this.room(2);
    const g = m as GPUModel, sc = this.scene(mo.viewProj), [i, o] = this.slot(), f = this.uni.f32;
    f.set(mo.model, i);
    f.set(mo.overlay, i + 16);
    f[i + 20] = mo.light[0]; f[i + 21] = mo.light[1]; f[i + 22] = mo.alpha; f[i + 23] = mo.viewProj !== this.viewProj ? 3 : 2;
    this.bind(this.pipeline('entity', { ...(mo.blend ? { blend: 'alpha' as const } : {}), ...(mo.hidden ? { hidden: true } : {}) }), sc, this.texBG(tex as GPUTex), o);
    this.vertexBufferAt(this.modelBuf(g), 0);
    this.pass.drawIndexed(g.quads * 6);
  }

  drawLines(verts: Float32Array, color: [number, number, number, number], xray = false) {
    if (!this.pass || verts.length < 6) return;
    const bytes = new Uint8Array(verts.buffer, verts.byteOffset, verts.byteLength);
    this.room(2, bytes.byteLength);
    const sc = this.scene(this.viewProj), [i, o] = this.slot();
    this.uni.f32.set(color, i);
    const vo = this.frameVerts(bytes);
    this.bind(this.pipeline('line', { blend: 'alpha', depthTest: !xray, depthWrite: false }), sc, null, o);
    this.vertexBufferAt(this.vtx.gpu, vo, bytes.byteLength);
    this.pass.draw(verts.length / 3);
  }

  protected cloudPass(ox: number, oy: number, oz: number, range: number) {
    if (!this.pass || (this.pack && !this.pack.clouds)) return;
    if (this.cloudUploaded !== this.cloudVersion || !this.cloudBuf) {
      const data = this.cloudVerts;
      if (this.cloudBuf) this.discard(this.cloudBuf);
      this.cloudBuf = this.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, label: 'clouds' });
      this.device.queue.writeBuffer(this.cloudBuf, 0, data);
      this.cloudUploaded = this.cloudVersion;
    }
    this.room(2);
    const e = this.env, sc = this.scene(this.viewProj), [i, o] = this.slot(), f = this.uni.f32;
    f[i] = ox; f[i + 1] = oy; f[i + 2] = oz; f[i + 3] = range;
    f.set(e.cloudColor, i + 4);
    const n = (this.cloudVerts.length / 16) * 6;
    // depth first, then colour where it's nearest: no double blending inside the cloud layer
    this.bind(this.pipeline('cloud', { cull: true, colorWrite: false }), sc, null, o);
    this.vertexBufferAt(this.cloudBuf, 0);
    this.pass.drawIndexed(n);
    this.bind(this.pipeline('cloud', { cull: true, blend: 'alpha', depthWrite: false }), sc, null, o);
    this.pass.drawIndexed(n);
  }

  drawOverlay(color: [number, number, number, number], vignette = 0) {
    if (color[3] <= 0 && vignette <= 0) return;
    if (!this.pass) return;
    this.overlayDraw(color, vignette, 0, this.pipeline('overlay', { depthTest: false, blend: 'alpha' }));
  }

  private overlayDraw(color: [number, number, number, number], vignette: number, depth: number, pipe: GPURenderPipeline) {
    this.room(2);
    const sc = this.scene(this.viewProj), [i, o] = this.slot(), f = this.uni.f32;
    f.set(color, i); f[i + 4] = vignette; f[i + 5] = depth;
    this.bind(pipe, sc, null, o);
    this.pass!.draw(3);
  }

  /** Writes colour and depth 1 everywhere in the viewport, whatever the depth was (clearing an inset). */
  private clearPipeline() {
    let p = this.pipelines.get('clear|' + this.format);
    if (p) return p;
    const module = this.module('overlay');
    p = this.device.createRenderPipeline({
      label: 'clear',
      layout: this.layouts.none,
      vertex: { module, entryPoint: 'vs', buffers: [] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'always' },
    });
    this.pipelines.set('clear|' + this.format, p);
    return p;
  }

  // ------------------------------------------------------------------ shader packs
  override shaderPackName() { return this.pack?.name ?? ''; }

  override async setShaderPack(src: ShaderPackSource | null): Promise<string> {
    this.packSrc = src;
    if (!src) { this.dropPack(); return ''; }
    if (!this.ready) return 'The GPU is not ready';
    try {
      const pk = await this.compilePack(src);
      if (this.packSrc !== src) return '';
      this.dropPack();
      this.pack = pk;
      return '';
    } catch (e) {
      if (this.packSrc === src) this.packSrc = null;
      return (e as Error).message;
    }
  }

  private dropPack() {
    this.pack = null;
    for (const k of [...this.pipelines.keys()]) if (k.endsWith('|pack')) this.pipelines.delete(k);
    if (this.pf) for (const t of [this.pf.scene, this.pf.opaqueColor, this.pf.opaqueDepth, this.pf.lodDepth, ...this.pf.targets.values(), ...this.pf.history.values()]) this.discard(t);
    this.pf = null;
  }

  /** Compile a shader pack: every program and pipeline, so a mistake shows now (as the pack's file and line). */
  private async compilePack(src: ShaderPackSource): Promise<ActivePack> {
    const d = this.device, b = src.bundle, m = b.manifest, values = src.values;
    const errors: string[] = [];
    const check = async (mod: GPUShaderModule, a: Assembled, offset: number) => {
      const ci = await mod.getCompilationInfo();
      for (const msg of ci.messages) if (msg.type === 'error') errors.push(`${locate(a, msg.lineNum - offset)}: ${msg.message}`);
    };
    const lib = gbufferLibrary(src);
    const modules = new Map<Kind, GPUShaderModule>();
    // (mistakes are reported from the compilation info, as the pack's own files and lines, not as uncaught errors)
    d.pushErrorScope('validation');
    const checks: Promise<void>[] = [];
    for (const kind of ['chunk', 'dyn', 'entity', 'sky', 'lod'] as Kind[]) {
      const code = KINDS[kind].pack!(lib.code);
      const offset = code.slice(0, code.indexOf(lib.code)).split('\n').length - 1;
      const mod = d.createShaderModule({ code, label: `${m.id} ${kind}` });
      modules.set(kind, mod);
      checks.push(check(mod, lib, offset));
    }
    // full-screen passes: their inputs are 'scene', earlier passes, and <pass>Prev for passes keeping history
    const known = new Set(['scene']);
    const passes: PackPass[] = [];
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const inputLayout = (n: number) => d.createBindGroupLayout({ entries: [...Array(n).keys()].map((i) => ({ binding: i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const } })) });
    for (const def of m.passes ?? []) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(def.name) || def.name === 'scene') throw new Error(`Bad pass name '${def.name}'`);
      const inputs = def.inputs ?? ['scene'];
      if (def.history) known.add(def.name + 'Prev');
      for (const i of inputs) if (!known.has(i)) throw new Error(`Pass ${def.name} reads '${i}', which isn't made before it`);
      known.add(def.name);
      passes.push({ def, inputs, bgl: inputLayout(inputs.length), pipe: null, scale: Math.max(0.0625, Math.min(1, def.scale ?? 1)), on: def.enabled ? !!values[def.enabled] : true });
    }
    // the final pass reads what its program names (<name>Tex)
    const finalSrc = b.files[m.final];
    const finalInputs = [...known].filter((n) => new RegExp(`\\b${n}Tex\\b`).test(finalSrc));
    if (!finalInputs.length) finalInputs.push('scene');
    const final: PackPass = { def: { name: 'final', file: m.final }, inputs: finalInputs, bgl: inputLayout(finalInputs.length), pipe: null, scale: 1, on: true };
    const passModules = new Map<PackPass, GPUShaderModule>();
    for (const p of [...passes, final]) {
      const a = passSource(src, p.def.file, p.inputs);
      const mod = d.createShaderModule({ code: a.code, label: `${m.id} ${p.def.name}` });
      passModules.set(p, mod);
      checks.push(check(mod, a, 0));
    }
    await Promise.all(checks);
    await d.popErrorScope();
    if (errors.length) throw new Error([...new Set(errors)].slice(0, 4).join('\n'));

    // bindings: group 3 of the world's shaders, group 0 of the passes
    const tex = (binding: number, sampleType: GPUTextureSampleType, viewDimension: GPUTextureViewDimension = '2d'): GPUBindGroupLayoutEntry => ({ binding, visibility: VF, texture: { sampleType, viewDimension } });
    const smp = (binding: number, type: GPUSamplerBindingType = 'filtering'): GPUBindGroupLayoutEntry => ({ binding, visibility: VF, sampler: { type } });
    const bgl = d.createBindGroupLayout({ label: 'pack world', entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } }, tex(1, 'depth'), smp(2, 'comparison'), tex(3, 'float'), smp(4), tex(5, 'float', '3d'), smp(6),
      tex(7, 'uint'), tex(8, 'float'), tex(9, 'depth'),
    ] });
    const passLayout = d.createBindGroupLayout({ label: 'pack passes', entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } }, smp(1), smp(2), tex(3, 'depth'), tex(4, 'depth'), tex(5, 'depth'), smp(6, 'comparison'),
      tex(7, 'float'), smp(8), tex(9, 'float', '3d'), tex(10, 'uint'), tex(11, 'depth'),
    ] });
    const layouts = {
      array: d.createPipelineLayout({ bindGroupLayouts: [this.bglScene, this.bglTex.array, this.bglDraw, bgl] }),
      '2d': d.createPipelineLayout({ bindGroupLayouts: [this.bglScene, this.bglTex['2d'], this.bglDraw, bgl] }),
      none: d.createPipelineLayout({ bindGroupLayouts: [this.bglScene, this.bglTex.none, this.bglDraw, bgl] }),
    };
    const shadow = { on: resolve(m.shadow?.enabled, values, !!m.shadow), res: resolve(m.shadow?.resolution, values, 2048), dist: resolve(m.shadow?.distance, values, 96) };
    shadow.res = Math.max(256, Math.min(d.limits.maxTextureDimension2D, 2 ** Math.round(Math.log2(shadow.res))));
    const pk: ActivePack = {
      src, name: m.name ?? m.id, lib, modules, bgl, layouts, passLayout, passes, final, shadowPipe: null, shadow,
      clouds: resolve(m.vanillaClouds, values, true), sun: resolve(m.vanillaSun, values, true), jitter: resolve(m.jitter, values, false),
    };
    // every pipeline now (in the background): a bad one rejects here
    const jobs: Promise<unknown>[] = [];
    const chunk = modules.get('chunk')!;
    if (shadow.on) jobs.push(d.createRenderPipelineAsync({
      label: 'shadow', layout: layouts.array,
      vertex: { module: chunk, entryPoint: 'vsShadow', buffers: KINDS.chunk.buffers },
      fragment: { module: chunk, entryPoint: 'fsShadow', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less-equal', depthBias: 1, depthBiasSlopeScale: 1.5 },
    }).then((p) => { pk.shadowPipe = p; }));
    for (const p of [...passes, final]) {
      const mod = passModules.get(p)!;
      jobs.push(d.createRenderPipelineAsync({
        label: `${m.id} ${p.def.name}`,
        layout: d.createPipelineLayout({ bindGroupLayouts: [passLayout, p.bgl] }),
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: p === final ? this.format : HDR }] },
        primitive: { topology: 'triangle-list' },
      }).then((pipe) => { p.pipe = pipe; }));
    }
    const made: [string, GPURenderPipeline, boolean][] = [];
    for (const [kind, st] of WARM) {
      const packed = !!KINDS[kind].pack;
      jobs.push(d.createRenderPipelineAsync(this.pipelineDesc(kind, st, HDR, packed, pk)).then((p) => { made.push([pipelineKey(kind, st, HDR, packed), p, packed]); }));
    }
    try { await Promise.all(jobs); } catch (e) { throw new Error((e as Error).message.split('\n').slice(0, 3).join('\n')); }
    for (const [k, p, packed] of made) { this.pipelines.set(k, p); if (packed) this.packPipes.add(p); }
    return pk;
  }

  /** Noise, materials, the shadow map and the frame's uniforms (made once, or when they change). */
  private packResources(pk: ActivePack) {
    const d = this.device;
    this.frameBuf ??= d.createBuffer({ size: FRAME_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'frame' });
    this.cmpSampler ??= d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
    this.linearClamp ??= d.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    if (!this.noiseTex2) {
      this.noiseTex2 = d.createTexture({ size: [256, 256], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'noise' });
      d.queue.writeTexture({ texture: this.noiseTex2 }, noise2D(), { bytesPerRow: 1024 }, [256, 256]);
    }
    const uses3D = Object.values(pk.src.bundle.files).some((f) => /\bnoise3\s*\(|\bnoise3D\b/.test(f));
    if (!this.noiseTex3 || (uses3D && this.noiseTex3.width === 1)) {
      const n = uses3D ? 64 : 1;
      this.noiseTex3?.destroy();
      this.noiseTex3 = d.createTexture({ size: [n, n, n], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'cloud noise' });
      d.queue.writeTexture({ texture: this.noiseTex3 }, uses3D ? noise3DData(n) : new Uint8Array(4), { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    }
    const layers = Math.max(1, this.atlasLayers);
    if (!this.materialsTex || this.materialsTex.width !== layers) {
      this.materialsTex?.destroy();
      this.materialsTex = d.createTexture({ size: [layers, 1], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, label: 'materials' });
      const flags = materialFlags(TEXTURES.slice(0, layers));
      d.queue.writeTexture({ texture: this.materialsTex }, flags, { bytesPerRow: layers * 4 }, [layers, 1]);
    }
    const res = pk.shadow.on ? pk.shadow.res : 1;
    if (!this.shadowTex || this.shadowTex.width !== res) {
      this.shadowTex?.destroy();
      this.shadowTex = d.createTexture({ size: [res, res], format: DEPTH, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING, label: 'shadow map' });
    }
    this.dummyDepth ??= d.createTexture({ size: [1, 1], format: DEPTH, usage: GPUTextureUsage.TEXTURE_BINDING, label: 'no shadow' });
  }

  /** The shader pack's screen-sized textures and bind groups (made again when the screen or what they use changes). */
  private packFrame(w: number, h: number) {
    const pk = this.pack!, d = this.device;
    this.packResources(pk);
    const key = `${w}x${h}|${this.depthGen}|${this.materialsTex!.width}|${this.shadowTex!.width}|${this.noiseTex3!.width}`;
    if (this.pf?.key === key) return;
    if (this.pf) for (const t of [this.pf.scene, this.pf.opaqueColor, this.pf.opaqueDepth, this.pf.lodDepth, ...this.pf.targets.values(), ...this.pf.history.values()]) this.discard(t);
    const U = GPUTextureUsage;
    const make = (label: string, ww: number, hh: number, format: GPUTextureFormat, usage: number) => d.createTexture({ label, size: [Math.max(1, ww), Math.max(1, hh)], format, usage });
    const scene = make('scene', w, h, HDR, U.RENDER_ATTACHMENT | U.TEXTURE_BINDING | U.COPY_SRC);
    const opaqueColor = make('opaque scene', w, h, HDR, U.TEXTURE_BINDING | U.COPY_DST);
    const opaqueDepth = make('opaque depth', w, h, DEPTH, U.TEXTURE_BINDING | U.COPY_DST);
    const lodDepth = make('distant terrain depth', w, h, DEPTH, U.TEXTURE_BINDING | U.COPY_DST | U.RENDER_ATTACHMENT);
    const targets = new Map<string, GPUTexture>(), history = new Map<string, GPUTexture>();
    const named = new Map<string, GPUTexture>([['scene', scene]]);
    for (const p of pk.passes) {
      const pw = Math.floor(w * p.scale), ph = Math.floor(h * p.scale);
      if (p.def.history) { const t = make(p.def.name + ' history', pw, ph, HDR, U.TEXTURE_BINDING | U.COPY_DST); history.set(p.def.name, t); named.set(p.def.name + 'Prev', t); }
      if (p.on) { const t = make(p.def.name, pw, ph, HDR, U.RENDER_ATTACHMENT | U.TEXTURE_BINDING | U.COPY_SRC); targets.set(p.def.name, t); named.set(p.def.name, t); }
      else named.set(p.def.name, named.get(p.inputs[0]) ?? scene);
    }
    const group = (layout: GPUBindGroupLayout, res: GPUBindingResource[]) => d.createBindGroup({ layout, entries: res.map((resource, binding) => ({ binding, resource })) });
    const frame = { buffer: this.frameBuf! };
    const packBG = group(pk.bgl, [frame, this.shadowTex!.createView(), this.cmpSampler!, this.noiseTex2!.createView(), this.repeatLinearClampless(), this.noiseTex3!.createView({ dimension: '3d' }), this.linearClamp!, this.materialsTex!.createView(), opaqueColor.createView(), opaqueDepth.createView()]);
    const passBG = group(pk.passLayout, [frame, this.linearClamp!, this.nearest, this.depthTex!.createView(), opaqueDepth.createView(), this.shadowTex!.createView(), this.cmpSampler!, this.noiseTex2!.createView(), this.repeatLinearClampless(), this.noiseTex3!.createView({ dimension: '3d' }), this.materialsTex!.createView(), lodDepth.createView()]);
    const inputs = new Map<string, GPUBindGroup>();
    for (const p of [...pk.passes, pk.final]) inputs.set(p.def.name, group(p.bgl, p.inputs.map((n) => named.get(n)!.createView())));
    this.pf = { w, h, key, scene, opaqueColor, opaqueDepth, lodDepth, targets, history, packBG, passBG, inputs };
    // the shadow pass binds the same, but not the shadow map it draws into
    this.shadowPassBG = group(pk.bgl, [frame, this.dummyDepth!.createView(), this.cmpSampler!, this.noiseTex2!.createView(), this.repeatLinearClampless(), this.noiseTex3!.createView({ dimension: '3d' }), this.linearClamp!, this.materialsTex!.createView(), opaqueColor.createView(), opaqueDepth.createView()]);
  }
  private shadowPassBG: GPUBindGroup | null = null;
  private repeatSampler: GPUSampler | null = null;
  /** Wrapping, smooth (noise lookups). */
  private repeatLinearClampless() {
    return (this.repeatSampler ??= this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }));
  }

  /** The frame's uniforms (F) for the shader pack. */
  private writeFrame(env: EnvState) {
    const f = this.frameData, pk = this.pack!, cam = this.cam;
    f.fill(0);
    f.set(this.viewProj, 0);
    f.set(this.invViewProj, 16);
    f.set(this.proj, 32);
    const ip = mat4(); invert(ip, this.proj); f.set(ip, 48);
    f.set(this.view, 64);
    const first = this.frameNo === 0;
    f.set(first ? this.viewProj : this.prevVP, 80);
    const a = env.celestial * Math.PI * 2;
    const sun = [-Math.sin(a), Math.cos(a), 0], moon = [-sun[0], -sun[1], 0];
    const useSun = sun[1] > 0, light = useSun ? sun : moon;
    const dim = env.dim === 'nether' ? 1 : env.dim === 'end' ? 2 : 0;
    const strength = dim ? 0 : smooth(0, 0.12, Math.abs(light[1])) * (useSun ? 1 : 0.2) * (1 - (env.rain ?? 0) * 0.85);
    this.shadowActive = pk.shadow.on && dim === 0 && strength > 0.002;
    // shadow space: x along the light's path across the sky, y = world z (the sun moves in the x-y plane), depth along the light
    const R = pk.shadow.dist, Dz = 256, texel = (2 * R) / pk.shadow.res;
    const fx = -light[0], fy = -light[1];
    const rl = Math.hypot(fy, fx) || 1, rx = fy / rl, ry = -fx / rl; // cross(f, z)
    const cx = cam.x * rx + cam.y * ry, cz = cam.z;
    const ox = cx - Math.floor(cx / texel) * texel, oz = cz - Math.floor(cz / texel) * texel;
    const sm = new Float32Array(16);
    sm[0] = rx / R; sm[4] = ry / R; sm[8] = 0; sm[12] = ox / R;
    sm[1] = 0; sm[5] = 0; sm[9] = 1 / R; sm[13] = oz / R;
    sm[2] = fx / (2 * Dz); sm[6] = fy / (2 * Dz); sm[10] = 0; sm[14] = 0.5;
    sm[15] = 1;
    f.set(sm, 96);
    f.set(sun, 112); f[115] = (env.ticks ?? 0) / 20;
    f.set(moon, 116); f[119] = env.rain ?? 0;
    f.set(light, 120); f[123] = Math.max(0, Math.min(1, (env.sunBright - 0.2) / 0.8));
    const wrap = (v: number) => ((v % 8192) + 8192) % 8192;
    f[124] = wrap(cam.x); f[125] = wrap(cam.y); f[126] = wrap(cam.z); f[127] = this.frameNo;
    f[128] = first ? 0 : cam.x - this.prevCam[0]; f[129] = first ? 0 : cam.y - this.prevCam[1]; f[130] = first ? 0 : cam.z - this.prevCam[2]; f[131] = env.eyeInWater ?? 0;
    f.set(env.skyColor, 132); f[135] = env.fogStart;
    f.set(env.fogColor, 136); f[139] = env.fogEnd;
    f.set(env.voidColor, 140); f[143] = env.stars;
    f.set(env.sunrise, 144);
    f[148] = this.targetW; f[149] = this.targetH; f[150] = 1 / this.targetW; f[151] = 1 / this.targetH;
    if (pk.jitter) {
      const k = (this.frameNo % 8) + 1;
      f[152] = ((halton(k, 2) - 0.5) * 2) / this.targetW; f[153] = ((halton(k, 3) - 0.5) * 2) / this.targetH;
    }
    f[154] = this.near; f[155] = this.far;
    f[156] = env.sunBright; f[157] = env.nightVision ?? 0; f[158] = dim; f[159] = R;
    f[160] = this.shadowActive ? 1 : 0; f[161] = env.thunder ?? 0; f[162] = env.gamma; f[163] = env.celestial;
    f[164] = pk.shadow.res; f[165] = strength; f[166] = env.ambient; f[167] = env.flicker;
    f.set(env.skyLightCol, 168); f[171] = env.ticks ?? 0;
    f.set(env.ambientCol, 172); f[175] = env.moonPhase;
    // (distant terrain's projection is only known when it's drawn: written then, see lodPass)
    f.set(this.invViewProj, 176);
    this.device.queue.writeBuffer(this.frameBuf!, 0, f);
    this.prevVP.set(this.viewProj);
    this.prevCam = [cam.x, cam.y, cam.z];
    this.frameNo++;
  }

  /** The shadow map: the solid chunks around the camera, seen from the sun (or moon). */
  protected override prepareShadows(chunks: Iterable<Chunk>, ships: ShipDraw[]) {
    const pk = this.pack, pf = this.pf;
    if (!pk || !pf || !this.pass || !this.sceneOpen || this.shadowDone || !this.atlasBG || !this.shadowActive || !pk.shadowPipe) return;
    this.shadowDone = true;
    const cam = this.cam, R = pk.shadow.dist + 24;
    const list: { g: GPUChunk; ox: number; oy: number; oz: number; rot: Float32Array; px: number; py: number; pz: number }[] = [];
    for (const c of chunks) {
      const g = c.mesh as GPUChunk | null;
      if (!g || !g.opaqueBuf || g.gen !== this.gen || c.cx >= 20000) continue;
      const ox = c.cx * 16 - cam.x, oz = c.cz * 16 - cam.z;
      if (Math.abs(ox + 8) > R || Math.abs(oz + 8) > R) continue;
      list.push({ g, ox, oy: -cam.y, oz, rot: IDENT3, px: 0, py: 0, pz: 0 });
    }
    for (const sd of ships) for (const c of sd.chunks) {
      const g = c.mesh as GPUChunk | null;
      if (!g || !g.opaqueBuf || g.gen !== this.gen) continue;
      if (Math.abs(sd.tx - cam.x) > R + 32 || Math.abs(sd.tz - cam.z) > R + 32) continue;
      list.push({ g, ox: sd.tx - cam.x, oy: sd.ty - cam.y, oz: sd.tz - cam.z, rot: sd.rot, px: c.cx * 16 - sd.lx, py: -sd.ly, pz: c.cz * 16 - sd.lz });
    }
    const n = Math.min(list.length, Math.floor(this.uni.size / SLOT) - 4);
    this.room(n + 1);
    const sc = this.scene(this.viewProj);
    this.pass.end();
    const sp = this.encoder!.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex!.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 } });
    sp.setPipeline(pk.shadowPipe);
    sp.setBindGroup(0, this.sceneBG, [sc]);
    sp.setBindGroup(1, this.atlasBG);
    sp.setBindGroup(3, this.shadowPassBG!);
    sp.setIndexBuffer(this.indexBuf, 'uint32');
    for (let k = 0; k < n; k++) {
      const d = list[k], [i, o] = this.slot(), f = this.uni.f32, r = d.rot;
      f[i] = r[0]; f[i + 1] = r[1]; f[i + 2] = r[2];
      f[i + 4] = r[3]; f[i + 5] = r[4]; f[i + 6] = r[5];
      f[i + 8] = r[6]; f[i + 9] = r[7]; f[i + 10] = r[8];
      f[i + 12] = d.ox; f[i + 13] = d.oy; f[i + 14] = d.oz; f[i + 15] = 0.5;
      f[i + 16] = d.px; f[i + 17] = d.py; f[i + 18] = d.pz;
      sp.setBindGroup(2, this.drawBG, [o]);
      sp.setVertexBuffer(0, d.g.opaqueBuf!);
      sp.drawIndexed(d.g.opaque * 6);
    }
    sp.end();
    this.openPass(null, false);
  }

  /** Before water and glass: a copy of the world drawn so far, and its depth, for them to look through. */
  private copyOpaque() {
    if (!this.pack || !this.pf || !this.sceneOpen || this.transDone || !this.pass) return;
    this.transDone = true;
    this.pass.end();
    this.copyScene();
    this.openPass(null, false);
  }

  private copyScene() {
    const pf = this.pf!, enc = this.encoder!;
    enc.copyTextureToTexture({ texture: pf.scene }, { texture: pf.opaqueColor }, [pf.w, pf.h]);
    enc.copyTextureToTexture({ texture: this.depthTex! }, { texture: pf.opaqueDepth }, [pf.w, pf.h]);
  }

  /** The world is drawn: the pack's passes make the picture on the screen; what's drawn after goes over it. */
  private finishScene() {
    const pk = this.pack, pf = this.pf;
    if (!pk || !pf || !this.sceneOpen || !this.pass) return;
    this.pass.end();
    this.pass = null;
    this.sceneOpen = false;
    const enc = this.encoder!;
    if (!this.transDone) { this.transDone = true; this.copyScene(); }
    const run = (p: PackPass, view: GPUTextureView) => {
      const rp = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      rp.setPipeline(p.pipe!);
      rp.setBindGroup(0, pf.passBG);
      rp.setBindGroup(1, pf.inputs.get(p.def.name)!);
      rp.draw(3);
      rp.end();
    };
    for (const p of pk.passes) {
      if (!p.on) continue;
      const t = pf.targets.get(p.def.name)!;
      run(p, t.createView());
      const h = pf.history.get(p.def.name);
      if (h) enc.copyTextureToTexture({ texture: t }, { texture: h }, [t.width, t.height]);
    }
    run(pk.final, this.canvasView!);
    this.target = this.canvasView;
    this.colorFormat = this.format;
    this.openPass(null, false);
  }

  /** Testing: lose the GPU device, as a driver reset would. */
  loseDevice() { this.device.destroy(); }
}

function pipelineKey(kind: Kind, s: State, format: string, packed: boolean) {
  const dt = s.depthTest !== false;
  return `${kind}|${s.blend ?? 'none'}|${+dt}${+(dt && s.depthWrite !== false)}${+!!s.cull}${+(s.colorWrite !== false)}${+!!s.bias}${+!!s.hidden}|${format}${packed ? '|pack' : ''}`;
}

/** The shader and state combinations drawn every frame (see the passes below). */
const WARM: [Kind, State][] = [
  ['sky', { depthTest: false }], ['sun', { depthTest: false, blend: 'add' }],
  ['chunk', { cull: true }], ['chunk', { cull: true, blend: 'alpha' }],
  ['lod', { cull: true }], ['lod', { cull: true, blend: 'alpha' }],
  ['cloud', { cull: true, colorWrite: false }], ['cloud', { cull: true, blend: 'alpha', depthWrite: false }],
  ['dyn', { cull: false }], ['dyn', { cull: true }], ['dyn', { cull: false, blend: 'alpha', depthWrite: false }], ['dyn', { cull: true, blend: 'alpha', bias: true }],
  ['dyn', { cull: false, blend: 'add', depthWrite: false }], ['dyn', { cull: false, colorWrite: false }],
  ['entity', {}], ['entity', { blend: 'alpha' }], ['line', { blend: 'alpha', depthWrite: false }], ['overlay', { depthTest: false, blend: 'alpha' }],
];

function halton(i: number, b: number) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function sameMat(a: Float32Array, b: Float32Array) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
