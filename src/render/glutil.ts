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
