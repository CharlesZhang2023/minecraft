// GLSL sources.

const LIGHTING = /* glsl */ `
uniform float u_sunBright;   // world sun brightness: 0.2 (night) .. 1 (day)
uniform vec3 u_skyLightCol;
uniform float u_gamma;
uniform float u_flicker;     // block light multiplier (~1.5 with flicker)
// Minecraft 1.8 lightmap: brightness table with 5% floor
float ltable(float l) { float f = 1.0 - clamp(l, 0.0, 15.0) / 15.0; return (1.0 - f) / (f * 3.0 + 1.0) * 0.95 + 0.05; }
vec3 lightmap(float skyL, float blkL) {
  float f = u_sunBright * 0.95 + 0.05;
  float s = ltable(skyL) * f;
  float b = ltable(blkL) * u_flicker;
  vec3 sc = vec3(s * (f * 0.65 + 0.35), s * (f * 0.65 + 0.35), s) * u_skyLightCol;
  vec3 bc = vec3(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
  vec3 c = clamp((sc + bc) * 0.96 + 0.03, 0.0, 1.0);
  vec3 inv = 1.0 - c;
  c = mix(c, 1.0 - inv * inv * inv * inv, u_gamma);
  return clamp(c * 0.96 + 0.03, 0.0, 1.0);
}
`;

const FOG = /* glsl */ `
uniform vec3 u_fogColor;
uniform vec3 u_fogSky; // sky colour: distant fog blends toward it with view elevation
uniform vec2 u_fog; // start, end
vec3 applyFog(vec3 c, vec3 p) {
  float d = length(p);
  float f = clamp((d - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  float up = p.y / max(d, 1e-3);
  vec3 fc = mix(u_fogColor, u_fogSky, smoothstep(-0.02, 0.35, up));
  return mix(c, fc, f);
}
`;

export const CHUNK_VS = /* glsl */ `#version 300 es
layout(location=0) in uvec4 a_pos;
layout(location=1) in vec4 a_uvl;
layout(location=2) in vec4 a_col;
uniform mat4 u_viewProj;
uniform vec3 u_offset;
out vec3 v_uv;
out vec4 v_col;
out vec2 v_light;
out vec3 v_dist;
flat out int v_masked;
void main() {
  vec3 p = vec3(a_pos.xyz) / 16.0 - 16.0 + u_offset;
  gl_Position = u_viewProj * vec4(p, 1.0);
  v_uv = vec3(a_uvl.xy / 128.0, float(a_pos.w & 0x7fffu));
  v_masked = int(a_pos.w >> 15u);
  v_col = a_col;
  v_light = a_uvl.zw / 16.0;
  v_dist = p;
}`;

export const CHUNK_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_alphaCut;
${LIGHTING}
${FOG}
in vec3 v_uv;
in vec4 v_col;
in vec2 v_light;
in vec3 v_dist;
flat in int v_masked;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uv);
  if (t.a < u_alphaCut) discard;
  vec3 c;
  if (v_masked == 1) {
    float m = t.a < 0.999 ? 1.0 : 0.0;
    c = t.rgb * mix(vec3(1.0), v_col.rgb, m);
    t.a = 1.0;
  } else c = t.rgb * v_col.rgb;
  c *= lightmap(v_light.x, v_light.y) * v_col.a;
  o = vec4(applyFog(c, v_dist), t.a);
}`;

export const DYN_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_uv;
layout(location=2) in vec4 a_col;
layout(location=3) in vec2 a_light;
uniform mat4 u_viewProj;
uniform mat4 u_model;
out vec3 v_uv;
out vec4 v_col;
out vec2 v_light;
out vec3 v_dist;
void main() {
  vec4 p = u_model * vec4(a_pos, 1.0);
  gl_Position = u_viewProj * p;
  v_uv = a_uv;
  v_col = a_col;
  v_light = a_light * 15.0;
  v_dist = p.xyz;
}`;

export const DYN_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_alphaCut;
uniform vec4 u_overlay;
uniform float u_fullbright;
uniform float u_wrap;
${LIGHTING}
${FOG}
in vec3 v_uv;
in vec4 v_col;
in vec2 v_light;
in vec3 v_dist;
out vec4 o;
void main() {
  vec3 uv = v_uv;
  if (u_wrap > 0.5) uv.xy = fract(uv.xy);
  vec4 t = texture(u_tex, uv);
  if (t.a < u_alphaCut) discard;
  vec3 c = t.rgb * v_col.rgb;
  c *= mix(lightmap(v_light.x, v_light.y), vec3(1.0), u_fullbright);
  c = mix(c, u_overlay.rgb, u_overlay.a);
  o = vec4(applyFog(c, v_dist), t.a * v_col.a);
}`;

export const ENTITY_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec3 a_normal;
uniform mat4 u_viewProj;
uniform mat4 u_model;
out vec2 v_uv;
out float v_shade;
out vec3 v_dist;
void main() {
  vec4 p = u_model * vec4(a_pos, 1.0);
  gl_Position = u_viewProj * p;
  v_uv = a_uv;
  vec3 n = normalize(mat3(u_model) * a_normal);
  // two fixed directional lights like the classic entity lighting
  float l = 0.4 + 0.6 * max(0.0, dot(n, normalize(vec3(0.2, 1.0, -0.7)))) * 0.7 + 0.6 * max(0.0, dot(n, normalize(vec3(-0.2, 1.0, 0.7)))) * 0.45;
  v_shade = min(1.0, l);
  v_dist = p.xyz;
}`;

export const ENTITY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_skin;
uniform vec2 u_light; // sky, block levels
uniform vec4 u_overlay;
uniform float u_alpha;
${LIGHTING}
${FOG}
in vec2 v_uv;
in float v_shade;
in vec3 v_dist;
out vec4 o;
void main() {
  vec4 t = texture(u_skin, v_uv);
  if (t.a < 0.1) discard;
  vec3 c = t.rgb * v_shade * lightmap(u_light.x, u_light.y);
  c = mix(c, u_overlay.rgb, u_overlay.a);
  o = vec4(applyFog(c, v_dist), t.a * u_alpha);
}`;

export const SKY_VS = /* glsl */ `#version 300 es
out vec2 v_ndc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  v_ndc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

export const SKY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform mat4 u_invViewProj;
uniform vec3 u_skyColor;
uniform vec3 u_fogColor;
uniform vec3 u_voidColor;
uniform vec4 u_sunrise;
uniform vec3 u_sunDir;
uniform float u_stars;
uniform float u_celestial;
in vec2 v_ndc;
out vec4 o;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec4 w = u_invViewProj * vec4(v_ndc, 1.0, 1.0);
  vec3 d = normalize(w.xyz / w.w);
  float up = d.y;
  vec3 c = mix(u_fogColor, u_skyColor, smoothstep(-0.02, 0.35, up));
  if (up < -0.02) c = mix(u_fogColor, u_voidColor, smoothstep(-0.02, -0.25, up));
  // sunrise/sunset glow
  vec3 sh = normalize(vec3(u_sunDir.x, 0.0, u_sunDir.z) + 1e-5);
  float toward = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), sh));
  float glow = u_sunrise.a * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(up - 0.05)));
  c = mix(c, u_sunrise.rgb, clamp(glow, 0.0, 1.0));
  // stars rotate with the sky
  if (u_stars > 0.0 && up > -0.1) {
    float a = u_celestial * 6.2831853;
    vec3 r = vec3(d.x, d.y * cos(a) - d.z * sin(a), d.y * sin(a) + d.z * cos(a));
    vec3 cell = floor(r * 180.0);
    float h = hash(cell);
    if (h > 0.9975) {
      vec3 f = fract(r * 180.0) - 0.5;
      float m = step(max(abs(f.x), max(abs(f.y), abs(f.z))), 0.5) * (0.5 + 0.5 * hash(cell + 7.0));
      c += vec3(m * u_stars);
    }
  }
  o = vec4(c, 1.0);
}`;

export const SUN_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
uniform mat4 u_viewProj;
out vec2 v_uv;
void main() { v_uv = a_uv; gl_Position = u_viewProj * vec4(a_pos, 1.0); gl_Position.z = gl_Position.w * 0.99995; }`;

export const SUN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_alpha;
in vec2 v_uv;
out vec4 o;
void main() { vec4 t = texture(u_tex, v_uv); o = vec4(t.rgb, t.a * u_alpha); }`;

export const CLOUD_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in float a_shade;
uniform mat4 u_viewProj;
uniform vec3 u_offset;
out float v_shade;
out float v_dist;
void main() {
  vec3 p = a_pos + u_offset;
  gl_Position = u_viewProj * vec4(p, 1.0);
  v_shade = a_shade;
  v_dist = length(p.xz);
}`;

export const CLOUD_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 u_color;
uniform float u_range;
${FOG}
in float v_shade;
in float v_dist;
out vec4 o;
void main() {
  vec3 c = u_color * v_shade;
  float a = 0.8 * (1.0 - smoothstep(u_range * 0.6, u_range, v_dist));
  o = vec4(c, a);
}`;

export const LINE_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_viewProj;
void main() { gl_Position = u_viewProj * vec4(a_pos, 1.0); }`;

export const LINE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }`;

// screen-space overlay (underwater tint, vignette, fire/hurt/portal effects)
export const OVERLAY_VS = /* glsl */ `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
export const OVERLAY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 u_color;
uniform float u_vignette;
in vec2 v_uv;
out vec4 o;
void main() {
  vec2 d = v_uv - 0.5;
  float v = smoothstep(0.35, 0.85, length(d) * 1.2) * u_vignette;
  o = vec4(mix(u_color.rgb, vec3(0.0), v / max(u_color.a + v, 1e-4)), max(u_color.a, v));
}`;
