// WebGL 2 backend: for browsers without WebGPU (and when chosen in Options > More... > Graphics).
import { GL, program, Program } from './glutil';
import * as SH from './glshaders';
import type { AtlasTarget } from './atlas';
import { Renderer, IDENT, IDENT3, LOD_MASK, quadIndices, endSkyImage, type EnvState, type ChunkMesh, type ChunkDraw, type Tex, type ModelMesh, type DynOpts, type ModelOpts, type LodPass, type SkyParams } from './renderer';
import type { DynMesh } from './dynmesh';
import type { Chunk } from '../world/world';
import type { MeshResult } from '../world/mesher';
import { S, Img } from './pixels';

interface GLChunk extends ChunkMesh {
  opaqueVao: WebGLVertexArrayObject | null;
  opaqueVbo: WebGLBuffer | null;
  transVao: WebGLVertexArrayObject | null;
  transVbo: WebGLBuffer | null;
}
/** A distant-terrain tile's vertex buffer. */
interface GLLod { vao: WebGLVertexArrayObject; waterVao: WebGLVertexArrayObject; vbo: WebGLBuffer; bytes: number }
interface GLTex extends Tex { t: WebGLTexture }
interface GLModel extends ModelMesh { vao: WebGLVertexArrayObject; vbo: WebGLBuffer }

export class GLRenderer extends Renderer {
  readonly backend = 'webgl2' as const;
  gl: GL;
  private chunkProg: Program;
  private dynProg: Program;
  private entityProg: Program;
  private skyProg: Program;
  private sunProg: Program;
  private cloudProg: Program;
  private lineProg: Program;
  private overlayProg: Program;
  private lodProg: Program;
  private endSkyTex: WebGLTexture;
  private lodMaskTex: WebGLTexture;
  private indexBuffer: WebGLBuffer;
  private dynVao: WebGLVertexArrayObject;
  private dynVbo: WebGLBuffer;
  private lineVao: WebGLVertexArrayObject;
  private lineVbo: WebGLBuffer;
  private sunTex: WebGLTexture | null = null;
  private moonTex: WebGLTexture | null = null;
  private sunVao: WebGLVertexArrayObject;
  private sunVbo: WebGLBuffer;
  private cloudVao: WebGLVertexArrayObject;
  private cloudVbo: WebGLBuffer;
  private cloudUploaded = -1;
  private emptyVao: WebGLVertexArrayObject;

  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.chunkProg = program(gl, SH.CHUNK_VS, SH.CHUNK_FS);
    this.dynProg = program(gl, SH.DYN_VS, SH.DYN_FS);
    this.entityProg = program(gl, SH.ENTITY_VS, SH.ENTITY_FS);
    this.skyProg = program(gl, SH.SKY_VS, SH.SKY_FS);
    this.sunProg = program(gl, SH.SUN_VS, SH.SUN_FS);
    this.cloudProg = program(gl, SH.CLOUD_VS, SH.CLOUD_FS);
    this.lineProg = program(gl, SH.LINE_VS, SH.LINE_FS);
    this.overlayProg = program(gl, SH.OVERLAY_VS, SH.OVERLAY_FS);
    this.lodProg = program(gl, SH.LOD_VS, SH.LOD_FS);
    this.lodMaskTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lodMaskTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, LOD_MASK, LOD_MASK);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

    // shared quad index buffer
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices(), gl.STATIC_DRAW);

    // dynamic meshes: pos(3) uv(3) colour(4 bytes) light(2 bytes) in 32 bytes
    this.dynVao = gl.createVertexArray()!;
    this.dynVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.dynVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 32, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, true, 32, 28);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);

    this.lineVao = gl.createVertexArray()!;
    this.lineVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    this.emptyVao = gl.createVertexArray()!;

    // End sky: tiling noise with mipmaps, so the fine grain doesn't shimmer
    this.endSkyTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.endSkyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, endSkyImage());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.sunVao = gl.createVertexArray()!;
    this.sunVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.sunVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sunVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);

    // clouds
    this.cloudVao = gl.createVertexArray()!;
    this.cloudVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.cloudVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);
  }

  describe() {
    const gl = this.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    return 'WebGL 2' + (name ? ` (${name.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 48)})` : '');
  }

  // ------------------------------------------------------------------ resources
  protected atlasTarget(): AtlasTarget {
    const gl = this.gl;
    let res = S;
    const t = gl.createTexture()!;
    return {
      all: (levels, size) => {
        res = size;
        const layers = levels[0].length / (size * size * 4);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels.length, gl.RGBA8, size, size, layers);
        for (let l = 0, sz = size; l < levels.length; l++, sz >>= 1) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, 0, sz, sz, layers, gl.RGBA, gl.UNSIGNED_BYTE, levels[l]);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels.length - 1);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.atlasTex = t;
      },
      layer: (layer, mips) => {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        for (let l = 0, size = res; l < mips.length; l++, size >>= 1) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, mips[l]);
      },
      destroy: () => gl.deleteTexture(t),
    };
  }
  private atlasTex: WebGLTexture | null = null;

  protected skyImages(sun: { img: Img; w: number }, moon: { img: Img; w: number }) {
    const gl = this.gl;
    if (this.sunTex) gl.deleteTexture(this.sunTex);
    if (this.moonTex) gl.deleteTexture(this.moonTex);
    this.sunTex = (this.makeTexture(sun.img, sun.w) as GLTex).t;
    this.moonTex = (this.makeTexture(moon.img, moon.w) as GLTex).t;
  }

  makeTexture(img: Img, size: number): Tex {
    const gl = this.gl;
    const t = gl.createTexture()!;
    const h = img.length / 4 / size;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { w: size, h, t } as GLTex;
  }

  freeTexture(t: Tex) { this.gl.deleteTexture((t as GLTex).t); }

  createModel(verts: Float32Array): ModelMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);
    return { quads: verts.length / 32, vao, vbo } as GLModel;
  }

  // ------------------------------------------------------------------ chunk meshes
  uploadChunk(c: Chunk, r: MeshResult) {
    const gl = this.gl;
    let g = c.mesh as GLChunk | null;
    if (!g) {
      g = { opaqueVao: null, opaqueVbo: null, transVao: null, transVbo: null, opaqueSections: r.opaqueSections, transSections: r.transSections, opaque: 0, trans: 0, bytes: 0 };
      c.mesh = g;
    }
    this.chunkBytes -= g.bytes;
    const mk = (data: ArrayBuffer, vao: WebGLVertexArrayObject | null, vbo: WebGLBuffer | null): [WebGLVertexArrayObject | null, WebGLBuffer | null] => {
      if (data.byteLength === 0) {
        if (vao) gl.deleteVertexArray(vao);
        if (vbo) gl.deleteBuffer(vbo);
        return [null, null];
      }
      if (!vao) {
        vao = gl.createVertexArray()!;
        vbo = gl.createBuffer()!;
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, 16, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 16, 8);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 16, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      } else {
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return [vao, vbo];
    };
    [g.opaqueVao, g.opaqueVbo] = mk(r.opaque, g.opaqueVao, g.opaqueVbo);
    [g.transVao, g.transVbo] = mk(r.trans, g.transVao, g.transVbo);
    g.opaqueSections = r.opaqueSections;
    g.transSections = r.transSections;
    g.opaque = r.opaque.byteLength / 64;
    g.trans = r.trans.byteLength / 64;
    g.bytes = r.opaque.byteLength + r.trans.byteLength;
    this.chunkBytes += g.bytes;
  }

  freeChunk(c: Chunk) {
    const g = c.mesh as GLChunk | null;
    if (!g) return;
    const gl = this.gl;
    if (g.opaqueVao) gl.deleteVertexArray(g.opaqueVao);
    if (g.opaqueVbo) gl.deleteBuffer(g.opaqueVbo);
    if (g.transVao) gl.deleteVertexArray(g.transVao);
    if (g.transVbo) gl.deleteBuffer(g.transVbo);
    this.chunkBytes -= g.bytes;
    c.mesh = null;
  }

  private setCommonUniforms(p: Program) {
    const gl = this.gl, e = this.env;
    gl.uniform1f(p.u.u_sunBright, e.sunBright);
    gl.uniform3fv(p.u.u_skyLightCol, e.skyLightCol);
    gl.uniform1f(p.u.u_gamma, e.gamma);
    gl.uniform1f(p.u.u_flicker, e.flicker);
    gl.uniform1f(p.u.u_ambient, e.ambient);
    gl.uniform3fv(p.u.u_ambientCol, e.ambientCol);
    gl.uniform1f(p.u.u_nightVision, e.nightVision ?? 0);
    gl.uniform3fv(p.u.u_fogColor, e.fogColor);
    gl.uniform3fv(p.u.u_fogSky, e.skyColor);
    gl.uniform2f(p.u.u_fog, e.fogStart, e.fogEnd);
  }

  // ------------------------------------------------------------------ frame
  beginFrame(env: EnvState) {
    const gl = this.gl;
    this.env = env;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  endFrame() { /* WebGL shows what was drawn when the task ends */ }

  clearDepth() {
    const gl = this.gl;
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  beginInset(x: number, y: number, w: number, h: number) {
    const gl = this.gl, sy = this.height - y - h;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, sy, w, h);
    gl.viewport(x, sy, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  endInset() {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.width, this.height);
  }

  protected skyPass(sp: SkyParams) {
    const gl = this.gl, e = this.env;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg.prog);
    const u = this.skyProg.u;
    gl.uniformMatrix4fv(u.u_invViewProj, false, this.invViewProj);
    gl.uniform3fv(u.u_skyColor, e.skyColor);
    gl.uniform3fv(u.u_fogColor, e.fogColor);
    gl.uniform3fv(u.u_voidColor, e.voidColor);
    gl.uniform4fv(u.u_sunrise, e.sunrise);
    gl.uniform3fv(u.u_sunDir, sp.sunDir);
    gl.uniform1f(u.u_stars, sp.stars);
    gl.uniform1f(u.u_celestial, sp.celestial);
    gl.uniform1f(u.u_end, sp.end ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.endSkyTex);
    gl.uniform1i(u.u_endSky, 0);
    gl.uniform1f(u.u_endLod, sp.endLod);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  protected sunPass(verts: Float32Array, tex: 'sun' | 'moon', alpha: number) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(this.sunProg.prog);
    gl.uniformMatrix4fv(this.sunProg.u.u_viewProj, false, this.viewProj);
    gl.uniform1f(this.sunProg.u.u_alpha, alpha);
    gl.bindVertexArray(this.sunVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sunVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex === 'sun' ? this.sunTex : this.moonTex);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  protected chunkPass(pass: 'opaque' | 'trans', draws: ChunkDraw[]) {
    const gl = this.gl;
    const p = this.chunkProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.viewProj);
    this.setCommonUniforms(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.depthMask(true);
    if (pass === 'opaque') {
      gl.disable(gl.BLEND);
      gl.uniform1f(p.u.u_alphaCut, 0.5);
    } else {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(p.u.u_alphaCut, 0.01);
    }
    let rot: Float32Array | null = null;
    for (const d of draws) {
      if (d.rot !== rot) { rot = d.rot; gl.uniformMatrix3fv(p.u.u_rot, false, rot); }
      gl.uniform3f(p.u.u_offset, d.ox, d.oy, d.oz);
      gl.uniform3f(p.u.u_pre, d.px, d.py, d.pz);
      const g = d.mesh as GLChunk;
      gl.bindVertexArray(pass === 'opaque' ? g.opaqueVao : g.transVao);
      for (let i = 0; i < d.runs.length; i += 2) gl.drawElements(gl.TRIANGLES, (d.runs[i + 1] - d.runs[i]) * 6, gl.UNSIGNED_INT, d.runs[i] * 24);
    }
    gl.uniformMatrix3fv(p.u.u_rot, false, IDENT3);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  // ------------------------------------------------------------------ distant terrain
  uploadLod(data: ArrayBuffer, opaque: number): GLLod {
    const gl = this.gl;
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    // one instance per quad; WebGL2 has no base instance, so the water quads get a second VAO pointing past the ground
    const vaoAt = (first: number) => {
      const vao = gl.createVertexArray()!, o = first * 16;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 4, gl.SHORT, 16, o);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribIPointer(1, 2, gl.UNSIGNED_SHORT, 16, o + 8);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 16, o + 12);
      gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
      return vao;
    };
    this.lodBytes += data.byteLength;
    return { vao: vaoAt(0), waterVao: vaoAt(opaque), vbo, bytes: data.byteLength };
  }

  freeLod(m: unknown) {
    const g = m as GLLod, gl = this.gl;
    gl.deleteVertexArray(g.vao);
    gl.deleteVertexArray(g.waterVao);
    gl.deleteBuffer(g.vbo);
    this.lodBytes -= g.bytes;
  }

  protected lodPass(lp: LodPass) {
    const gl = this.gl, cam = this.cam, p = this.lodProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.lodViewProj);
    gl.uniform1f(p.u.u_pixelSize, lp.pixel);
    gl.uniform3fv(p.u.u_snow, lp.snow);
    this.setCommonUniforms(p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lodMaskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LOD_MASK, LOD_MASK, gl.RED, gl.UNSIGNED_BYTE, lp.mask);
    gl.uniform1i(p.u.u_mask, 1);
    gl.uniform2i(p.u.u_maskCenter, lp.mcx, lp.mcz);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    const each = (water: boolean) => {
      gl.uniform1f(p.u.u_water, water ? 1 : 0);
      for (const t of lp.tiles) {
        const n = water ? t.water : t.opaque;
        if (!n) continue;
        gl.uniform3f(p.u.u_offset, t.x - cam.x, -cam.y, t.z - cam.z);
        gl.uniform2i(p.u.u_tileChunk, t.x >> 4, t.z >> 4);
        gl.uniform2i(p.u.u_tileCell, Math.floor(t.x / t.cell), Math.floor(t.z / t.cell));
        gl.uniform1f(p.u.u_cell, t.cell);
        const m = t.mesh as GLLod;
        gl.bindVertexArray(water ? m.waterVao : m.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      }
    };
    gl.disable(gl.BLEND);
    each(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    each(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  // ------------------------------------------------------------------ dynamic geometry
  drawDyn(mesh: DynMesh, opts: DynOpts = {}) {
    if (mesh.count === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.bytes(), gl.DYNAMIC_DRAW);
    const p = this.dynProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, opts.viewProj ?? this.viewProj);
    gl.uniformMatrix4fv(p.u.u_model, false, opts.model ?? IDENT);
    this.setCommonUniforms(p);
    gl.uniform4fv(p.u.u_overlay, opts.overlay ?? [0, 0, 0, 0]);
    gl.uniform1f(p.u.u_fullbright, opts.fullbright ? 1 : 0);
    gl.uniform1f(p.u.u_wrap, opts.wrap ? 1 : 0);
    gl.uniform1f(p.u.u_additive, opts.additive ? 1 : 0);
    gl.uniform1f(p.u.u_alphaCut, opts.alphaCut ?? (opts.blend ? 0.01 : 0.5));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTex);
    gl.uniform1i(p.u.u_tex, 0);
    if (opts.depthTest === false) gl.disable(gl.DEPTH_TEST);
    else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); }
    if (opts.cull === false) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    gl.depthMask(opts.depthWrite !== false);
    if (opts.colorWrite === false) gl.colorMask(false, false, false, false);
    if (opts.polygonOffset) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -10); }
    if (opts.blend) {
      gl.enable(gl.BLEND);
      if (opts.additive) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.bindVertexArray(this.dynVao);
    gl.drawElements(gl.TRIANGLES, (mesh.count / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  drawModel(m: ModelMesh, tex: Tex, o: ModelOpts) {
    const gl = this.gl, p = this.entityProg, g = m as GLModel;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, o.viewProj);
    this.setCommonUniforms(p);
    gl.uniform2f(p.u.u_light, o.light[0], o.light[1]);
    gl.uniform4fv(p.u.u_overlay, o.overlay);
    gl.uniform1f(p.u.u_alpha, o.alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (tex as GLTex).t);
    gl.uniform1i(p.u.u_skin, 0);
    gl.uniformMatrix4fv(p.u.u_model, false, o.model);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    if (o.blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.quads * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    if (o.blend) gl.disable(gl.BLEND);
  }

  drawLines(verts: Float32Array, color: [number, number, number, number], xray = false) {
    const gl = this.gl;
    gl.useProgram(this.lineProg.prog);
    gl.uniformMatrix4fv(this.lineProg.u.u_viewProj, false, this.viewProj);
    gl.uniform4fv(this.lineProg.u.u_color, color);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (xray) gl.disable(gl.DEPTH_TEST);
    else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); }
    gl.depthMask(false);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  protected cloudPass(ox: number, oy: number, oz: number, range: number) {
    const e = this.env, gl = this.gl;
    if (this.cloudUploaded !== this.cloudVersion) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.cloudVerts, gl.STATIC_DRAW);
      this.cloudUploaded = this.cloudVersion;
    }
    const p = this.cloudProg, n = (this.cloudVerts.length / 16) * 6;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.viewProj);
    gl.uniform3f(p.u.u_offset, ox, oy, oz);
    gl.uniform3fv(p.u.u_color, e.cloudColor);
    gl.uniform1f(p.u.u_range, range);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(this.cloudVao);
    // pass 1: depth only, pass 2: colour where depth matches -> no double blending inside the cloud layer
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  drawOverlay(color: [number, number, number, number], vignette = 0) {
    if (color[3] <= 0 && vignette <= 0) return;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.overlayProg.prog);
    gl.uniform4fv(this.overlayProg.u.u_color, color);
    gl.uniform1f(this.overlayProg.u.u_vignette, vignette);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
  }
}
