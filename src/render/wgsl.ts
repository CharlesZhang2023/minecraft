// WGSL sources for the WebGPU backend: the same lighting, fog and looks as the WebGL shaders (glshaders.ts).
//
// Bindings, shared by every pipeline:
//   group 0: the scene (view-projection, lightmap and fog settings), a dynamic offset into the frame's uniforms
//   group 1: the pipeline's textures
//   group 2: this draw's settings, a dynamic offset into the frame's uniforms
//   group 3: (shader packs only) the frame, the shadow map, noise, materials, the scene behind the water
// The matrices are made for WebGL's clip space (z from -w to w); `clipZ` moves z to WebGPU's 0..w, giving the same
// depths.
//
// The world's shaders (chunks, dynamic geometry, entities, sky, distant terrain) are built in two ways: the game's
// own look, or with a shader pack's library (`pack`), where lighting and fog come from the pack's functions.

const SCENE = /* wgsl */ `
struct Scene {
  viewProj: mat4x4f,
  skyLightCol: vec3f, sunBright: f32,  // world sun brightness: 0.2 (night) .. 1 (day)
  ambientCol: vec3f, ambient: f32,     // dimension ambient light (0 overworld, 0.1 nether)
  fogColor: vec3f, gamma: f32,
  fogSky: vec3f, flicker: f32,         // sky colour: distant fog blends toward it with view elevation; block light multiplier
  fog: vec2f, nightVision: f32, _pad: f32, // fog start, end
};
@group(0) @binding(0) var<uniform> S: Scene;

// Minecraft 1.8 lightmap brightness table
fn ltable(l: f32) -> f32 { let f = 1.0 - clamp(l, 0.0, 15.0) / 15.0; return (1.0 - f) / (f * 3.0 + 1.0) * (1.0 - S.ambient) + S.ambient; }
fn lightmap(skyL: f32, blkL: f32) -> vec3f {
  let f = S.sunBright * 0.95 + 0.05;
  let s = ltable(skyL) * f;
  let b = ltable(blkL) * S.flicker;
  let sc = vec3f(s * (f * 0.65 + 0.35), s * (f * 0.65 + 0.35), s) * S.skyLightCol;
  let bc = vec3f(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
  var c = clamp((sc + bc + S.ambientCol) * 0.96 + 0.03, vec3f(0.0), vec3f(1.0));
  if (S.nightVision > 0.0) { let m = max(c.r, max(c.g, c.b)); c = mix(c, c / max(m, 1e-3), S.nightVision); }
  let inv = 1.0 - c;
  c = mix(c, 1.0 - inv * inv * inv * inv, S.gamma);
  return clamp(c * 0.96 + 0.03, vec3f(0.0), vec3f(1.0));
}
fn fogAmount(p: vec3f) -> f32 { return clamp((length(p) - S.fog.x) / (S.fog.y - S.fog.x), 0.0, 1.0); }
fn applyFog(c: vec3f, p: vec3f) -> vec3f {
  let d = length(p);
  let up = p.y / max(d, 1e-3);
  let fc = mix(S.fogColor, S.fogSky, smoothstep(-0.02, 0.35, up));
  return mix(c, fc, fogAmount(p));
}
`;

/** The vertex position's z for WebGPU (and, with a shader pack asking for it, the frame's sub-pixel jitter). */
const clip = (pack: string | undefined) => pack
  ? /* wgsl */ `fn clipZ(p: vec4f) -> vec4f { return vec4f(p.x + F.jitter.x * p.w, p.y + F.jitter.y * p.w, (p.z + p.w) * 0.5, p.w); }`
  : /* wgsl */ `fn clipZ(p: vec4f) -> vec4f { return vec4f(p.x, p.y, (p.z + p.w) * 0.5, p.w); }`;

const head = (pack: string | undefined) => `${SCENE}\n${clip(pack)}\n${pack ?? ''}\n`;

/** World chunks (and sub-levels' chunks, turned about their pivot); with a pack, also the shadow map's programs. */
export const chunkSrc = (pack?: string) => /* wgsl */ `${head(pack)}
struct Draw { rot: mat3x3f, offset: vec3f, alphaCut: f32, pre: vec3f, trans: f32 };
@group(1) @binding(0) var tex: texture_2d_array<f32>;
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
struct In { @location(0) pos: vec4u, @location(1) uvl: vec4u, @location(2) col: vec4f };
struct V {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
  @location(2) light: vec2f,
  @location(3) dist: vec3f,
  @location(4) @interpolate(flat) layer: u32,
  @location(5) @interpolate(flat) masked: u32,
};
fn chunkPos(i: In) -> vec3f {
  var p = D.rot * (vec3f(i.pos.xyz) / 128.0 - 16.0 + D.pre) + D.offset;
  ${pack ? 'p = packWave(p, material(i.pos.w & 0x7fffu), 1.0 - f32(i.uvl.y) / 128.0);' : ''}
  return p;
}
@vertex fn vs(i: In) -> V {
  var o: V;
  let p = chunkPos(i);
  o.pos = clipZ(S.viewProj * vec4f(p, 1.0));
  o.uv = vec2f(i.uvl.xy) / 128.0;
  o.layer = i.pos.w & 0x7fffu;
  o.masked = i.pos.w >> 15u;
  o.col = i.col;
  o.light = vec2f(i.uvl.zw) / 16.0;
  o.dist = p;
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  var t = textureSample(tex, samp, i.uv, i.layer);
  ${pack ? 'let dx = dpdx(i.dist); let dy = dpdy(i.dist);' : ''}
  if (t.a < D.alphaCut) { discard; }
  var c: vec3f;
  if (i.masked == 1u) {
    // grass tops and the like: the colour tints only the see-through part of the texture
    let m = select(0.0, 1.0, t.a < 0.999);
    c = t.rgb * mix(vec3f(1.0), i.col.rgb, m);
    t.a = 1.0;
  } else { c = t.rgb * i.col.rgb; }
  ${pack ? `
  var s: Surface;
  s.albedo = c; s.alpha = t.a; s.pos = i.dist; s.normal = faceNormal(dx, dy, i.dist);
  s.light = i.light; s.shade = i.col.a; s.layer = i.layer; s.flags = material(i.layer); s.kind = KIND_TERRAIN;
  s.screen = i.pos.xy * F.screen.zw; s.uv = i.uv; s.depth = i.pos.z;
  if (D.trans > 0.5) { let r = packTranslucent(s); return vec4f(packFog(r.rgb, s), r.a); }
  return vec4f(packFog(packShade(s), s), t.a);` : `
  c *= lightmap(i.light.x, i.light.y) * i.col.a;
  return vec4f(applyFog(c, i.dist), t.a);`}
}
${pack ? `
// the shadow map: the same geometry seen from the sun (or moon), squeezed toward the middle
struct SV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) layer: u32 };
@vertex fn vsShadow(i: In) -> SV {
  var o: SV;
  let p = chunkPos(i);
  let s = F.shadowMat * vec4f(p, 1.0);
  o.pos = vec4f(distortShadow(s.xy), s.z, 1.0);
  o.uv = vec2f(i.uvl.xy) / 128.0;
  o.layer = i.pos.w & 0x7fffu;
  return o;
}
@fragment fn fsShadow(i: SV) {
  let t = textureSample(tex, samp, i.uv, i.layer);
  if (t.a < 0.5 || (material(i.layer) & MAT_WATER) != 0u) { discard; }
}` : ''}`;

/** Geometry built each frame (particles, items, entities' blocks, mods' drawing) with the block textures. */
export const dynSrc = (pack?: string) => /* wgsl */ `${head(pack)}
struct Draw { model: mat4x4f, overlay: vec4f, alphaCut: f32, fullbright: f32, wrap: f32, additive: f32, kind: f32, _a: f32, _b: f32, _c: f32 };
@group(1) @binding(0) var tex: texture_2d_array<f32>;
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
struct In { @location(0) pos: vec3f, @location(1) uv: vec3f, @location(2) col: vec4f, @location(3) light: vec2f };
struct V {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
  @location(2) light: vec2f,
  @location(3) dist: vec3f,
  @location(4) @interpolate(flat) layer: u32,
};
@vertex fn vs(i: In) -> V {
  var o: V;
  let p = D.model * vec4f(i.pos, 1.0);
  o.pos = clipZ(S.viewProj * p);
  o.uv = i.uv.xy;
  o.layer = u32(round(i.uv.z));
  o.col = i.col;
  o.light = i.light * 15.0;
  o.dist = p.xyz;
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  var uv = i.uv;
  if (D.wrap > 0.5) { uv = fract(uv); }
  let t = textureSample(tex, samp, uv, i.layer);
  ${pack ? 'let dx = dpdx(i.dist); let dy = dpdy(i.dist);' : ''}
  if (t.a < D.alphaCut) { discard; }
  var c = t.rgb * i.col.rgb;
  ${pack ? `
  if (D.fullbright < 0.5) {
    var s: Surface;
    s.albedo = c; s.alpha = t.a * i.col.a; s.pos = i.dist; s.normal = faceNormal(dx, dy, i.dist);
    s.light = i.light; s.shade = 1.0; s.layer = i.layer; s.flags = material(i.layer); s.kind = u32(D.kind);
    s.screen = i.pos.xy * F.screen.zw; s.uv = uv; s.depth = i.pos.z;
    c = mix(packShade(s), D.overlay.rgb, D.overlay.a);
    return vec4f(packFog(c, s), s.alpha);
  }
  c = mix(c, D.overlay.rgb, D.overlay.a) * select(1.0, EMISSIVE_BOOST, D.additive > 0.5);` : `
  c *= mix(lightmap(i.light.x, i.light.y), vec3f(1.0), D.fullbright);
  c = mix(c, D.overlay.rgb, D.overlay.a);`}
  // added light fades out into the fog instead of turning fog-coloured
  if (D.additive > 0.5) { return vec4f(c, t.a * i.col.a * (1.0 - fogAmount(i.dist))); }
  return vec4f(applyFog(c, i.dist), t.a * i.col.a);
}`;

/** Entity models with their skins, lit by two fixed lights like the classic entity lighting. */
export const entitySrc = (pack?: string) => /* wgsl */ `${head(pack)}
struct Draw { model: mat4x4f, overlay: vec4f, light: vec2f, alpha: f32, kind: f32 };
@group(1) @binding(0) var skin: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
struct In { @location(0) pos: vec3f, @location(1) uv: vec2f, @location(2) normal: vec3f };
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) shade: f32, @location(2) dist: vec3f, @location(3) normal: vec3f };
@vertex fn vs(i: In) -> V {
  var o: V;
  let p = D.model * vec4f(i.pos, 1.0);
  o.pos = clipZ(S.viewProj * p);
  o.uv = i.uv;
  let n = normalize(mat3x3f(D.model[0].xyz, D.model[1].xyz, D.model[2].xyz) * i.normal);
  let l = 0.4 + 0.6 * max(0.0, dot(n, normalize(vec3f(0.2, 1.0, -0.7)))) * 0.7 + 0.6 * max(0.0, dot(n, normalize(vec3f(-0.2, 1.0, 0.7)))) * 0.45;
  o.shade = min(1.0, l);
  o.dist = p.xyz;
  o.normal = n;
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  let t = textureSample(skin, samp, i.uv);
  if (t.a < 0.1) { discard; }
  ${pack ? `
  var s: Surface;
  s.albedo = t.rgb; s.alpha = t.a * D.alpha; s.pos = i.dist; s.normal = normalize(i.normal);
  s.light = D.light; s.shade = i.shade; s.layer = 0u; s.flags = 0u; s.kind = u32(D.kind);
  s.screen = i.pos.xy * F.screen.zw; s.uv = i.uv; s.depth = i.pos.z;
  let c = mix(packShade(s), D.overlay.rgb, D.overlay.a);
  return vec4f(packFog(c, s), s.alpha);` : `
  var c = t.rgb * i.shade * lightmap(D.light.x, D.light.y);
  c = mix(c, D.overlay.rgb, D.overlay.a);
  return vec4f(applyFog(c, i.dist), t.a * D.alpha);`}
}`;

/** The sky behind everything: a gradient with the sunrise glow and stars, or the End's box. */
export const skySrc = (pack?: string) => /* wgsl */ `${head(pack)}
struct Draw { invViewProj: mat4x4f, skyColor: vec3f, stars: f32, voidColor: vec3f, celestial: f32, sunrise: vec4f, sunDir: vec3f, end: f32, endLod: f32 };
@group(1) @binding(0) var endSky: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
struct V { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> V {
  var o: V;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.ndc = p;
  o.pos = vec4f(p, 0.99995, 1.0);
  return o;
}
fn starHash(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
@fragment fn fs(i: V) -> @location(0) vec4f {
  let w = D.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let d = normalize(w.xyz / w.w);
  let up = d.y;
  if (D.end > 0.5) {
    // the End: a mottled dark purple box around the world (cube-map cells, vanilla style)
    let a = abs(d);
    var uv: vec2f; var face: f32;
    if (a.x >= a.y && a.x >= a.z) { uv = d.zy / a.x; face = select(1.0, 0.0, d.x > 0.0); }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = select(3.0, 2.0, d.y > 0.0); }
    else { uv = d.xy / a.z; face = select(5.0, 4.0, d.z > 0.0); }
    // vanilla: the end_sky texture tiled 16 times across each face of a box, tinted to 40/255
    let st = (uv * 0.5 + 0.5) * 16.0 + vec2f(face * 0.37, face * 0.61);
    let e = textureSampleLevel(endSky, samp, st, D.endLod).rgb * (40.0 / 255.0);
    return vec4f(e, ${pack ? '0.0' : '1.0'});
  }
  ${pack ? '// (alpha 0 marks the sky for the pack passes)\n  return vec4f(packSky(d), 0.0);\n}' : `  var c = mix(S.fogColor, D.skyColor, smoothstep(-0.02, 0.35, up));
  if (up < -0.02) { c = mix(S.fogColor, D.voidColor, smoothstep(-0.02, -0.25, up)); }
  // sunrise/sunset glow
  let sh = normalize(vec3f(D.sunDir.x, 0.0, D.sunDir.z) + 1e-5);
  let toward = max(0.0, dot(normalize(vec3f(d.x, 0.0, d.z) + 1e-5), sh));
  let glow = D.sunrise.a * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(up - 0.05)));
  c = mix(c, D.sunrise.rgb, clamp(glow, 0.0, 1.0));
  // stars rotate with the sky
  if (D.stars > 0.0 && up > -0.1) {
    let an = D.celestial * 6.2831853;
    let r = vec3f(d.x, d.y * cos(an) - d.z * sin(an), d.y * sin(an) + d.z * cos(an));
    let cell = floor(r * 180.0);
    let h = starHash(cell);
    if (h > 0.9975) {
      let f = fract(r * 180.0) - 0.5;
      let m = step(max(abs(f.x), max(abs(f.y), abs(f.z))), 0.5) * (0.5 + 0.5 * starHash(cell + 7.0));
      c += vec3f(m * D.stars);
    }
  }
  return vec4f(c, 1.0);
}`}`;

/** The sun and moon. */
export const SUN = /* wgsl */ `${SCENE}
struct Draw { alpha: f32, boost: f32, _b: f32, _c: f32 };
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
struct In { @location(0) pos: vec3f, @location(1) uv: vec2f };
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(i: In) -> V {
  var o: V;
  o.uv = i.uv;
  let p = S.viewProj * vec4f(i.pos, 1.0);
  o.pos = vec4f(p.xy, p.w * 0.999975, p.w);
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f { let t = textureSample(tex, samp, i.uv); return vec4f(t.rgb * max(D.boost, 1.0), t.a * D.alpha); }`;

export const CLOUD = /* wgsl */ `${SCENE}
fn clipZ(p: vec4f) -> vec4f { return vec4f(p.x, p.y, (p.z + p.w) * 0.5, p.w); }
struct Draw { offset: vec3f, range: f32, color: vec3f, _p: f32 };
@group(2) @binding(0) var<uniform> D: Draw;
struct In { @location(0) pos: vec3f, @location(1) shade: f32 };
struct V { @builtin(position) pos: vec4f, @location(0) shade: f32, @location(1) dist: f32 };
@vertex fn vs(i: In) -> V {
  var o: V;
  let p = i.pos + D.offset;
  o.pos = clipZ(S.viewProj * vec4f(p, 1.0));
  o.shade = i.shade;
  o.dist = length(p.xz);
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  let a = 0.8 * (1.0 - smoothstep(D.range * 0.6, D.range, i.dist));
  return vec4f(D.color * i.shade, a);
}`;

export const LINE = /* wgsl */ `${SCENE}
fn clipZ(p: vec4f) -> vec4f { return vec4f(p.x, p.y, (p.z + p.w) * 0.5, p.w); }
struct Draw { color: vec4f };
@group(2) @binding(0) var<uniform> D: Draw;
@vertex fn vs(@location(0) pos: vec3f) -> @builtin(position) vec4f { return clipZ(S.viewProj * vec4f(pos, 1.0)); }
@fragment fn fs() -> @location(0) vec4f { return D.color; }`;

/** Screen-space overlay (underwater tint, vignette, fire/hurt/portal effects), and clearing a rectangle. */
export const OVERLAY = /* wgsl */ `${SCENE}
struct Draw { color: vec4f, vignette: f32, depth: f32, _a: f32, _b: f32 };
@group(2) @binding(0) var<uniform> D: Draw;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> V {
  var o: V;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.uv = p * 0.5 + 0.5;
  o.pos = vec4f(p, D.depth, 1.0);
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  let d = i.uv - 0.5;
  let v = smoothstep(0.35, 0.85, length(d) * 1.2) * D.vignette;
  return vec4f(mix(D.color.rgb, vec3f(0.0), v / max(D.color.a + v, 1e-4)), max(D.color.a, v));
}`;

// Distant terrain (LOD tiles): flat-coloured boxes lit by the sky, hidden wherever a real chunk is drawn.
export const lodSrc = (pack?: string) => /* wgsl */ `${head(pack)}
struct Draw { offset: vec3f, cell: f32, tileChunk: vec2i, tileCell: vec2i, maskCenter: vec2i, water: f32, pixelSize: f32, snow: vec3f, _p: f32 };
@group(1) @binding(0) var mask: texture_2d<f32>; // chunks drawn in full (64x64, wrapping)
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var<uniform> D: Draw;
// one instance per quad (see LodTileMesh): its corners are made here
struct In { @location(0) box: vec4i, @location(1) quad: vec2u, @location(2) col: vec4f }; // box: x, z, y0, y1 (y in 1/8 blocks); quad: length along the face, face | lights << 8
struct V {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) dist: vec3f,
  @location(2) cellPos: vec2f,
  @location(3) light: f32,
  @location(4) @interpolate(flat) face: u32,
  @location(5) @interpolate(flat) snow: u32, // a snowy top (its colour is what's under the snow)
};
@vertex fn vs(i: In, @builtin(vertex_index) vi: u32) -> V {
  // unit-box corners per face, counter-clockwise seen from outside (as the chunk mesher)
  var CORNERS = array<vec3f, 24>(
    vec3f(0,0,0), vec3f(0,0,1), vec3f(0,1,1), vec3f(0,1,0),
    vec3f(1,0,1), vec3f(1,0,0), vec3f(1,1,0), vec3f(1,1,1),
    vec3f(0,0,0), vec3f(1,0,0), vec3f(1,0,1), vec3f(0,0,1),
    vec3f(0,1,0), vec3f(0,1,1), vec3f(1,1,1), vec3f(1,1,0),
    vec3f(1,0,0), vec3f(0,0,0), vec3f(0,1,0), vec3f(1,1,0),
    vec3f(0,0,1), vec3f(1,0,1), vec3f(1,1,1), vec3f(0,1,1));
  var TRI = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
  var o: V;
  let face = i.quad.y & 7u; // (the low byte also has the snow and ledge bits)
  let c = CORNERS[face * 4u + TRI[vi]];
  let len = f32(i.quad.x);
  let lo = vec3f(f32(i.box.x), f32(i.box.z) / 8.0, f32(i.box.y));
  let h = f32(i.box.w - i.box.z) / 8.0;
  var size: vec3f;
  if (face <= 1u) { size = vec3f(0.0, h, len); }
  else if (face <= 3u) { size = vec3f(len, 0.0, D.cell); }
  else { size = vec3f(len, h, 0.0); }
  let local = lo + c * size;
  let p = local + D.offset;
  o.pos = clipZ(S.viewProj * vec4f(p, 1.0));
  o.col = i.col;
  o.dist = p;
  let lights = i.quad.y >> 8u;
  o.light = f32(select(lights & 15u, lights >> 4u, c.y > 0.5));
  o.face = face;
  o.snow = (i.quad.y >> 3u) & 1u;
  // a point just inside the cell this face belongs to (walls sit on the line between two cells)
  var n = vec2f(0.0);
  if (face == 0u) { n = vec2f(-1.0, 0.0); } else if (face == 1u) { n = vec2f(1.0, 0.0); } else if (face == 4u) { n = vec2f(0.0, -1.0); } else if (face == 5u) { n = vec2f(0.0, 1.0); }
  o.cellPos = local.xz - n * 0.05;
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  let c = D.tileChunk + vec2i(floor(i.cellPos / 16.0));
  let rel = c - D.maskCenter;
  if (abs(rel.x) < 32 && abs(rel.y) < 32 && textureLoad(mask, vec2i(c.x & 63, c.y & 63), 0).r > 0.5) { discard; }
  var shade = 0.8;
  if (i.face <= 1u) { shade = 0.6; } else if (i.face == 2u) { shade = 0.5; } else if (i.face == 3u) { shade = 1.0; }
  // a little brightness noise per cell, so flat ground doesn't look painted
  let cell = D.tileCell + vec2i(floor(i.cellPos / D.cell));
  var h = (bitcast<u32>(cell.x) * 0x8da6b343u) ^ (bitcast<u32>(cell.y) * 0xd8163841u);
  h = (h ^ (h >> 13u)) * 0x5bd1e995u;
  h = h ^ (h >> 15u);
  let n = (f32(h & 1023u) / 1023.0 - 0.5) * 0.07;
  var base = i.col.rgb;
  if (i.snow == 1u) {
    // snow seen almost edge-on, or so far off that a cell's top is under a couple of pixels tall, makes white slivers
    // that blink as the camera moves: it's left out there (we see what's under it), fading in as it faces us
    let d = length(i.dist);
    let sinUp = abs(i.dist.y) / d; // how steeply we look at the top
    let tall = D.cell * sinUp / (d * D.pixelSize);
    base = mix(base, D.snow, smoothstep(0.05, 0.12, sinUp) * smoothstep(0.75, 2.5, tall));
  }
  ${pack ? `
  var NORMALS = array<vec3f, 6>(vec3f(-1, 0, 0), vec3f(1, 0, 0), vec3f(0, -1, 0), vec3f(0, 1, 0), vec3f(0, 0, -1), vec3f(0, 0, 1));
  var s: Surface;
  s.albedo = base * (1.0 + n); s.alpha = select(1.0, i.col.a, D.water > 0.5); s.pos = i.dist; s.normal = NORMALS[min(i.face, 5u)];
  s.light = vec2f(i.light, 0.0); s.shade = shade; s.layer = 0u; s.flags = select(0u, MAT_WATER, D.water > 0.5); s.kind = KIND_LOD;
  s.screen = i.pos.xy * F.screen.zw; s.uv = vec2f(0.0); s.depth = i.pos.z;
  if (D.water > 0.5) { let r = packTranslucent(s); return vec4f(packFog(r.rgb, s), r.a); }
  return vec4f(packFog(packShade(s), s), 1.0);` : `
  let col = base * shade * (1.0 + n) * lightmap(i.light, 0.0);
  return vec4f(applyFog(col, i.dist), select(1.0, i.col.a, D.water > 0.5));`}
}`;

export const CHUNK = chunkSrc(), DYN = dynSrc(), ENTITY = entitySrc(), SKY = skySrc(), LOD = lodSrc();
