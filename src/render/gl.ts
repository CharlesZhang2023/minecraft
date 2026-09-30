export type GL = WebGL2RenderingContext;

export interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error('Shader compile error: ' + log + '\n' + numbered);
  }
  return s;
}

export function program(gl: GL, vs: string, fs: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u };
}

/** Growable dynamic float geometry: pos(3) uv(3: u,v,layer) color(4 bytes) light(2 bytes) packed as 7 floats + 4 bytes = 32 bytes. */
export class DynMesh {
  data = new ArrayBuffer(1 << 16);
  f32 = new Float32Array(this.data);
  u8 = new Uint8Array(this.data);
  count = 0;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  constructor(private gl: GL) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 32, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.UNSIGNED_BYTE, true, 32, 28);
    gl.bindVertexArray(null);
  }
  reset() { this.count = 0; }
  private grow() {
    const nd = new ArrayBuffer(this.data.byteLength * 2);
    new Uint8Array(nd).set(this.u8);
    this.data = nd;
    this.f32 = new Float32Array(nd);
    this.u8 = new Uint8Array(nd);
  }
  /** light: sky, block in 0..15; col 0xRRGGBB; a alpha 0..1 */
  v(x: number, y: number, z: number, u: number, v: number, layer: number, col: number, a: number, sky: number, blk: number) {
    if ((this.count + 1) * 32 > this.data.byteLength) this.grow();
    const o = this.count * 8;
    const f = this.f32;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = u; f[o + 4] = v; f[o + 5] = layer;
    const b = o * 4 + 24;
    const u8 = this.u8;
    u8[b] = (col >> 16) & 255; u8[b + 1] = (col >> 8) & 255; u8[b + 2] = col & 255; u8[b + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    u8[b + 4] = Math.round(sky * 17); u8[b + 5] = Math.round(blk * 17);
    this.count++;
  }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.u8.subarray(0, this.count * 32), gl.DYNAMIC_DRAW);
  }
}
