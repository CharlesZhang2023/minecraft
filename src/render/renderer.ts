// WebGL2 world renderer.
import { GL, program, Program, DynMesh } from './gl';
import * as SH from './shaders';
import { BlockAtlas } from './atlas';
import { Mat4, mat4, perspective, lookDir, multiply, invert, identity } from '../math';
import type { Chunk } from '../world/world';
import type { MeshResult } from '../world/mesher';
import { Random } from '../noise';
import { Img } from './pixels';

export interface Camera {
  x: number; y: number; z: number;
  yaw: number; pitch: number; // radians
  fov: number; // degrees
  roll?: number;
  bobX?: number; bobY?: number;
}

interface ChunkGPU {
  opaqueVao: WebGLVertexArrayObject | null;
  opaqueVbo: WebGLBuffer | null;
  transVao: WebGLVertexArrayObject | null;
  transVbo: WebGLBuffer | null;
  opaqueSections: Int32Array;
  transSections: Int32Array;
  bytes: number;
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
}

const MAX_QUADS = 1 << 18;

export class Renderer {
  gl: GL;
  atlas!: BlockAtlas;
  chunkProg: Program;
  dynProg: Program;
  entityProg: Program;
  skyProg: Program;
  sunProg: Program;
  cloudProg: Program;
  lineProg: Program;
  overlayProg: Program;
  indexBuffer: WebGLBuffer;
  proj: Mat4 = mat4();
  view: Mat4 = mat4();
  viewProj: Mat4 = mat4();
  invViewProj: Mat4 = mat4();
  private tmp = mat4();
  private planes = new Float32Array(24);
  width = 1;
  height = 1;
  cam: Camera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 70 };
  chunkBytes = 0;
  drawnChunks = 0;
  dyn: DynMesh;
  lineVao: WebGLVertexArrayObject;
  lineVbo: WebGLBuffer;
  sunTex: WebGLTexture;
  moonTex: WebGLTexture;
  sunVao: WebGLVertexArrayObject;
  sunVbo: WebGLBuffer;
  cloudVao: WebGLVertexArrayObject;
  cloudVbo: WebGLBuffer;
  cloudCount = 0;
  private cloudCell = [1e9, 1e9];
  private cloudMap: Uint8Array;
  emptyVao: WebGLVertexArrayObject;
  env!: EnvState;

  constructor(public canvas: HTMLCanvasElement) {
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

    // shared quad index buffer
    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const o = q * 6, v = q * 4;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.dyn = new DynMesh(gl);
    gl.bindVertexArray(this.dyn.vao);
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

    // sun & moon
    this.sunTex = this.makeTexture(sunImage(), 32);
    this.moonTex = this.makeTexture(moonImage(), 32);
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
    this.cloudMap = makeCloudMap();
  }

  initAtlas(extra: { name: string; img: Img }[]) {
    this.atlas = new BlockAtlas(this.gl, extra);
  }

  makeTexture(img: Img | HTMLCanvasElement, size: number, filter: number = this.gl.NEAREST): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (img instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, img.length / 4 / size, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // ------------------------------------------------------------------ chunk meshes
  uploadChunk(c: Chunk, r: MeshResult) {
    const gl = this.gl;
    let g = c.mesh as ChunkGPU | null;
    if (!g) {
      g = { opaqueVao: null, opaqueVbo: null, transVao: null, transVbo: null, opaqueSections: r.opaqueSections, transSections: r.transSections, bytes: 0 };
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
    g.bytes = r.opaque.byteLength + r.trans.byteLength;
    this.chunkBytes += g.bytes;
  }

  freeChunk(c: Chunk) {
    const g = c.mesh as ChunkGPU | null;
    if (!g) return;
    const gl = this.gl;
    if (g.opaqueVao) gl.deleteVertexArray(g.opaqueVao);
    if (g.opaqueVbo) gl.deleteBuffer(g.opaqueVbo);
    if (g.transVao) gl.deleteVertexArray(g.transVao);
    if (g.transVbo) gl.deleteBuffer(g.transVbo);
    this.chunkBytes -= g.bytes;
    c.mesh = null;
  }

  // ------------------------------------------------------------------ camera
  setupCamera(cam: Camera, near = 0.05, far = 1000) {
    this.cam = cam;
    perspective(this.proj, (cam.fov * Math.PI) / 180, this.width / this.height, near, far);
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
    this.extractPlanes();
  }

  private extractPlanes() {
    const m = this.viewProj, p = this.planes;
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

  /** AABB in camera-relative coordinates */
  boxVisible(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
      const x = a > 0 ? x1 : x0, y = b > 0 ? y1 : y0, z = c > 0 ? z1 : z0;
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  }

  chunkVisible(cx: number, cz: number) {
    const x0 = cx * 16 - this.cam.x, z0 = cz * 16 - this.cam.z;
    return this.boxVisible(x0, -this.cam.y, z0, x0 + 16, 256 - this.cam.y, z0 + 16);
  }

  setCommonUniforms(p: Program) {
    const gl = this.gl, e = this.env;
    gl.uniform1f(p.u.u_sunBright, e.sunBright);
    gl.uniform3fv(p.u.u_skyLightCol, e.skyLightCol);
    gl.uniform1f(p.u.u_gamma, e.gamma);
    gl.uniform1f(p.u.u_flicker, e.flicker);
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
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  drawSky() {
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
    const a = e.celestial * Math.PI * 2;
    gl.uniform3f(u.u_sunDir, -Math.sin(a), Math.cos(a), 0);
    gl.uniform1f(u.u_stars, e.stars);
    gl.uniform1f(u.u_celestial, e.celestial);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // sun & moon
    if (e.rain < 1) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(this.sunProg.prog);
      gl.uniformMatrix4fv(this.sunProg.u.u_viewProj, false, this.viewProj);
      gl.uniform1f(this.sunProg.u.u_alpha, 1 - e.rain);
      const quad = (dirSign: number, size: number, tex: WebGLTexture, uv: number[]) => {
        const s = Math.sin(a), c = Math.cos(a);
        const dx = -s * dirSign, dy = c * dirSign;
        const D = 100;
        // tangent axes: along the sun path (perp to dir in the xy plane) and z
        const tx = c, ty = s;
        const cx = dx * D, cy = dy * D;
        const verts = new Float32Array([
          cx - tx * size, cy - ty * size, -size, uv[0], uv[1],
          cx - tx * size, cy - ty * size, size, uv[0], uv[3],
          cx + tx * size, cy + ty * size, size, uv[2], uv[3],
          cx + tx * size, cy + ty * size, -size, uv[2], uv[1],
        ]);
        gl.bindVertexArray(this.sunVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.sunVbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
      };
      gl.activeTexture(gl.TEXTURE0);
      quad(1, 30, this.sunTex, [0, 0, 1, 1]);
      const ph = e.moonPhase % 8;
      const mu = (ph % 4) / 4, mv = Math.floor(ph / 4) / 2;
      quad(-1, 20, this.moonTex, [mu, mv, mu + 0.25, mv + 0.5]);
    }
    gl.disable(gl.BLEND);
  }

  drawChunks(chunks: Iterable<Chunk>, pass: 'opaque' | 'trans') {
    const gl = this.gl;
    const cam = this.cam;
    const p = this.chunkProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.viewProj);
    this.setCommonUniforms(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);
    gl.uniform1i(p.u.u_tex, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    if (pass === 'opaque') {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.uniform1f(p.u.u_alphaCut, 0.5);
    } else {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
      gl.uniform1f(p.u.u_alphaCut, 0.01);
    }
    const list: [number, Chunk][] = [];
    for (const c of chunks) {
      const g = c.mesh as ChunkGPU | null;
      if (!g) continue;
      if (pass === 'opaque' ? !g.opaqueVao : !g.transVao) continue;
      if (!this.chunkVisible(c.cx, c.cz)) continue;
      const dx = c.cx * 16 + 8 - cam.x, dz = c.cz * 16 + 8 - cam.z;
      list.push([dx * dx + dz * dz, c]);
    }
    list.sort((a, b) => (pass === 'opaque' ? a[0] - b[0] : b[0] - a[0]));
    let drawn = 0;
    for (const [, c] of list) {
      const g = c.mesh as ChunkGPU;
      const ox = c.cx * 16 - cam.x, oz = c.cz * 16 - cam.z;
      gl.uniform3f(p.u.u_offset, ox, -cam.y, oz);
      gl.bindVertexArray(pass === 'opaque' ? g.opaqueVao : g.transVao);
      const secs = pass === 'opaque' ? g.opaqueSections : g.transSections;
      const order = pass === 'opaque' || cam.y > 128 ? [...Array(16).keys()] : [...Array(16).keys()];
      let runStart = -1, runEnd = -1;
      const flush = () => {
        if (runStart >= 0 && runEnd > runStart) {
          gl.drawElements(gl.TRIANGLES, (runEnd - runStart) * 6, gl.UNSIGNED_INT, runStart * 24);
          drawn++;
        }
        runStart = runEnd = -1;
      };
      for (const s of order) {
        const a = secs[s], b = secs[s + 1];
        if (b <= a) continue;
        if (!this.boxVisible(ox, s * 16 - cam.y, oz, ox + 16, s * 16 + 16 - cam.y, oz + 16)) { flush(); continue; }
        if (runStart < 0) { runStart = a; runEnd = b; }
        else if (a === runEnd) runEnd = b;
        else { flush(); runStart = a; runEnd = b; }
      }
      flush();
    }
    if (pass === 'opaque') this.drawnChunks = list.length;
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return drawn;
  }

  /** Draw the dynamic mesh (particles, items, falling blocks...) with the block atlas. */
  drawDyn(mesh: DynMesh, opts: { blend?: boolean; model?: Mat4; overlay?: [number, number, number, number]; cull?: boolean; fullbright?: boolean; depthTest?: boolean; alphaCut?: number; viewProj?: Mat4; wrap?: boolean } = {}) {
    if (mesh.count === 0) return;
    const gl = this.gl;
    mesh.upload();
    const p = this.dynProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, opts.viewProj ?? this.viewProj);
    gl.uniformMatrix4fv(p.u.u_model, false, opts.model ?? IDENT);
    this.setCommonUniforms(p);
    gl.uniform4fv(p.u.u_overlay, opts.overlay ?? [0, 0, 0, 0]);
    gl.uniform1f(p.u.u_fullbright, opts.fullbright ? 1 : 0);
    gl.uniform1f(p.u.u_wrap, opts.wrap ? 1 : 0);
    gl.uniform1f(p.u.u_alphaCut, opts.alphaCut ?? (opts.blend ? 0.01 : 0.5));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.texture);
    gl.uniform1i(p.u.u_tex, 0);
    if (opts.depthTest === false) gl.disable(gl.DEPTH_TEST);
    else gl.enable(gl.DEPTH_TEST);
    if (opts.cull === false) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    if (opts.blend) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, (mesh.count / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  drawLines(verts: Float32Array, color: [number, number, number, number]) {
    const gl = this.gl;
    gl.useProgram(this.lineProg.prog);
    gl.uniformMatrix4fv(this.lineProg.u.u_viewProj, false, this.viewProj);
    gl.uniform4fv(this.lineProg.u.u_color, color);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------ clouds
  drawClouds(height: number) {
    const e = this.env;
    if (!e.clouds) return;
    const gl = this.gl;
    const CELL = 12;
    const wx = this.cam.x + e.cloudOffset, wz = this.cam.z + 3.96; // cloud-space camera position
    const ccx = Math.floor(wx / CELL), ccz = Math.floor(wz / CELL);
    if (ccx !== this.cloudCell[0] || ccz !== this.cloudCell[1]) {
      this.cloudCell = [ccx, ccz];
      this.buildClouds(ccx, ccz);
    }
    const p = this.cloudProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, this.viewProj);
    gl.uniform3f(p.u.u_offset, ccx * CELL - wx, height - this.cam.y, ccz * CELL - wz);
    gl.uniform3fv(p.u.u_color, e.cloudColor);
    gl.uniform1f(p.u.u_range, 26 * CELL);
    gl.uniform3fv(p.u.u_fogColor, e.fogColor);
    gl.uniform2f(p.u.u_fog, 1e5, 1e5 + 1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(this.cloudVao);
    // pass 1: depth only, pass 2: colour where depth matches -> no double blending inside the cloud layer
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.drawElements(gl.TRIANGLES, (this.cloudCount / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, (this.cloudCount / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

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
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
    this.cloudCount = out.length / 4;
  }

  /** Full-screen colour overlay (underwater, damage, etc.) */
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

  /** Projection for the first-person hand (fixed fov, own depth range). */
  handViewProj(fov = 70): Mat4 {
    const p = mat4();
    perspective(p, (fov * Math.PI) / 180, this.width / this.height, 0.05, 10);
    return p;
  }
}

const IDENT = mat4();

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

function sunImage(): Img {
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

function moonImage(): Img {
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
