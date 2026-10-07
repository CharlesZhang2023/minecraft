// What the WebGPU renderer gives shader packs: the frame's uniforms, a library of WGSL functions (shadow lookups,
// noise, screen projection, the game's own lightmap and sky), the material of each texture, noise textures, and
// the sources of a pack's programs put together with its settings.
//
// A pack's world code (its `gbuffers` file and `common` files) may only use what the library declares (F, the
// samplers and textures below, the helpers) and its own functions: it is compiled into every world shader. Names
// starting with `vanilla`, `shadow`, `noise`, `MAT_`, `KIND_` and the WGSL entry points vs/fs are the library's.
import type { ShaderBundle, ShaderPackSource, SettingValue, Ref } from '../packs/types';

/** The frame's uniforms (F), the same in world shaders (group 3) and full-screen passes (group 0). */
export const FRAME_STRUCT = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,      // camera-relative position -> clip (WebGL-style z: use toScreen / fromScreen)
  invViewProj: mat4x4f,
  proj: mat4x4f, invProj: mat4x4f,
  view: mat4x4f,          // camera-relative position -> view space
  prevViewProj: mat4x4f,  // last frame's viewProj, for (position + camDelta)
  shadowMat: mat4x4f,     // camera-relative position -> shadow space (before distortShadow)
  sunDir: vec3f, time: f32,          // toward the sun (unit); seconds of game time
  moonDir: vec3f, rain: f32,         // rain 0..1
  lightDir: vec3f, daylight: f32,    // the sun by day, the moon by night; daylight 0 (night) .. 1 (day)
  camPos: vec3f, frame: f32,         // camera position (modulo 8192: for world-space noise); frame counter
  camDelta: vec3f, eyeInWater: f32,  // camera now minus last frame; 1 in water, 2 in lava
  skyColor: vec3f, fogStart: f32,    // the game's sky colour and fog range
  fogColor: vec3f, fogEnd: f32,
  voidColor: vec3f, stars: f32,
  sunrise: vec4f,                    // sunrise/sunset glow colour and strength
  screen: vec4f,                     // width, height, 1/width, 1/height (pixels)
  jitter: vec2f, near: f32, far: f32,
  sunBright: f32, nightVision: f32, dimension: f32, shadowDist: f32, // dimension: 0 overworld, 1 nether, 2 end
  shadowOn: f32, thunder: f32, gamma: f32, celestial: f32,
  shadowRes: f32, lightStrength: f32, ambient: f32, flicker: f32,  // lightStrength: the shadow light's (moon is weaker)
  skyLightCol: vec3f, ticks: f32,
  ambientCol: vec3f, moonPhase: f32,
  lodInvViewProj: mat4x4f,           // distant terrain's depth -> camera-relative position (see sceneDistance)
};
`;
export const FRAME_FLOATS = 192;

/** Library functions, for world shaders and passes alike. */
const HELPERS = /* wgsl */ `
const PI = 3.14159265;
const MAT_LEAVES = 1u;    // leaves
const MAT_PLANT = 2u;     // grass, flowers, crops, saplings: sway at the top
const MAT_WATER = 4u;
const MAT_LAVA = 8u;
const MAT_EMISSIVE = 16u; // gives off light (torches, glowstone, lava, fire, lamps)
const MAT_GLASS = 32u;
const MAT_ICE = 64u;
const MAT_METAL = 128u;   // iron, gold, rails...
const MAT_SNOW = 256u;
const MAT_GEM = 512u;     // diamond, emerald, quartz, polished stone
const MAT_PARTICLE = 1024u;
const KIND_TERRAIN = 0u;
const KIND_DYN = 1u;      // particles, dropped items, falling blocks, mods' drawing
const KIND_ENTITY = 2u;
const KIND_HAND = 3u;     // the first-person hand and what it holds (positions are in view space)
const KIND_LOD = 4u;      // distant terrain
const EMISSIVE_BOOST = 2.0;

/** What a world shader hands the pack to light. */
struct Surface {
  albedo: vec3f,   // texture colour times its tint (grass, leaves...)
  alpha: f32,
  pos: vec3f,      // camera-relative position (view space for KIND_HAND)
  normal: vec3f,   // facing the camera
  light: vec2f,    // sky light, block light (0..15)
  shade: f32,      // the game's ambient occlusion and face shading (1 = none)
  layer: u32,      // texture layer
  flags: u32,      // MAT_* of the texture
  kind: u32,       // KIND_*
  screen: vec2f,   // position on screen, 0..1 from the top left
  uv: vec2f,       // texture coordinates
  depth: f32,      // depth buffer value
};

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn noiseHash12(p: vec2f) -> f32 { var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn noiseHash13(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
/** Interleaved gradient noise of a pixel: a different threshold for each neighbour, for dithering. */
fn noiseIGN(pix: vec2f) -> f32 { return fract(52.9829189 * fract(dot(pix + F.frame * 5.588238, vec2f(0.06711056, 0.00583715)))); }
/** Smooth value noise (0..1), from the noise texture (256 texels across, wrapping). */
fn noise2(p: vec2f) -> f32 { return textureSampleLevel(noiseTex, repeatSamp, (p + 0.5) / 256.0, 0.0).r; }
fn noise2v(p: vec2f) -> vec4f { return textureSampleLevel(noiseTex, repeatSamp, (p + 0.5) / 256.0, 0.0); }
/** 3D cloud noise, wrapping every 1 in each direction: r = Perlin-Worley, g/b/a = Worley at 2, 4 and 8 times the detail. */
fn noise3(p: vec3f) -> vec4f { return textureSampleLevel(noise3D, repeatSamp, p, 0.0); }
fn noiseFbm(p: vec2f) -> f32 { return noise2(p) * 0.5 + noise2(p * 2.03 + 17.0) * 0.25 + noise2(p * 4.01 + 41.0) * 0.125 + noise2(p * 8.07 + 7.0) * 0.0625; }

/** World position from a camera-relative one (wraps every 8192 blocks). */
fn worldPos(p: vec3f) -> vec3f { return p + F.camPos; }
/** A camera-relative position on screen: uv from the top left, and depth (as in the depth buffer). */
fn toScreen(p: vec3f) -> vec3f {
  let c = F.viewProj * vec4f(p, 1.0);
  let n = c.xyz / c.w;
  return vec3f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5, n.z * 0.5 + 0.5);
}
/** The camera-relative position seen at a screen uv with a depth buffer value. */
fn fromScreen(uv: vec2f, depth: f32) -> vec3f {
  let w = F.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth * 2.0 - 1.0, 1.0);
  return w.xyz / w.w;
}
/** Distance to a depth buffer value along the view. */
fn linearDepth(depth: f32) -> f32 { let z = depth * 2.0 - 1.0; return 2.0 * F.near * F.far / (F.far + F.near - z * (F.far - F.near)); }
/** A flat surface's normal from the screen-space change of its position, turned toward the camera. */
fn faceNormal(dx: vec3f, dy: vec3f, p: vec3f) -> vec3f {
  var n = normalize(cross(dx, dy));
  if (dot(n, p) > 0.0) { n = -n; }
  return n;
}
fn material(layer: u32) -> u32 { return textureLoad(materials, vec2i(i32(layer), 0), 0).r; }

// ---- the game's own lighting and sky (to build on)
fn vanillaTable(l: f32) -> f32 { let f = 1.0 - clamp(l, 0.0, 15.0) / 15.0; return (1.0 - f) / (f * 3.0 + 1.0) * (1.0 - F.ambient) + F.ambient; }
/** The game's lightmap: what sky and block light levels look like (gamma and night vision included). */
fn vanillaLight(skyL: f32, blkL: f32) -> vec3f {
  let f = F.sunBright * 0.95 + 0.05;
  let s = vanillaTable(skyL) * f;
  let b = vanillaTable(blkL) * F.flicker;
  let sc = vec3f(s * (f * 0.65 + 0.35), s * (f * 0.65 + 0.35), s) * F.skyLightCol;
  let bc = vec3f(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
  var c = clamp((sc + bc + F.ambientCol) * 0.96 + 0.03, vec3f(0.0), vec3f(1.0));
  if (F.nightVision > 0.0) { let m = max(c.r, max(c.g, c.b)); c = mix(c, c / max(m, 1e-3), F.nightVision); }
  let inv = 1.0 - c;
  c = mix(c, 1.0 - inv * inv * inv * inv, F.gamma);
  return clamp(c * 0.96 + 0.03, vec3f(0.0), vec3f(1.0));
}
fn vanillaFogAmount(p: vec3f) -> f32 { return clamp((length(p) - F.fogStart) / max(F.fogEnd - F.fogStart, 1e-3), 0.0, 1.0); }
/** The game's fog (it hides where the loaded world ends). */
fn vanillaFog(c: vec3f, p: vec3f) -> vec3f {
  let d = length(p);
  let fc = mix(F.fogColor, F.skyColor, smoothstep(-0.02, 0.35, p.y / max(d, 1e-3)));
  return mix(c, fc, vanillaFogAmount(p));
}
/** The game's sky in a direction (without stars). */
fn vanillaSky(d: vec3f) -> vec3f {
  var c = mix(F.fogColor, F.skyColor, smoothstep(-0.02, 0.35, d.y));
  if (d.y < -0.02) { c = mix(F.fogColor, F.voidColor, smoothstep(-0.02, -0.25, d.y)); }
  let sh = normalize(vec3f(F.sunDir.x, 0.0, F.sunDir.z) + 1e-5);
  let toward = max(0.0, dot(normalize(vec3f(d.x, 0.0, d.z) + 1e-5), sh));
  let glow = F.sunrise.a * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.5, abs(d.y - 0.05)));
  return mix(c, F.sunrise.rgb, clamp(glow, 0.0, 1.0));
}
/** Stars (rotating with the sky), 0..1. */
fn vanillaStars(d: vec3f) -> f32 {
  if (F.stars <= 0.0 || d.y < -0.1) { return 0.0; }
  let an = F.celestial * 6.2831853;
  let r = vec3f(d.x, d.y * cos(an) - d.z * sin(an), d.y * sin(an) + d.z * cos(an));
  let cell = floor(r * 180.0);
  if (noiseHash13(cell) < 0.9975) { return 0.0; }
  let f = fract(r * 180.0) - 0.5;
  return step(max(abs(f.x), max(abs(f.y), abs(f.z))), 0.5) * (0.5 + 0.5 * noiseHash13(cell + 7.0)) * F.stars;
}

// ---- shadows from the sun (or moon): one map, squeezed toward the middle so near shadows get more of it
fn distortShadow(p: vec2f) -> vec2f { let d = length(p); return p / (d * 0.85 + 0.15); }
/** Shadow-map uv and depth of a camera-relative position. */
fn shadowCoord(p: vec3f) -> vec3f {
  let s = F.shadowMat * vec4f(p, 1.0);
  let d = distortShadow(s.xy);
  return vec3f(d.x * 0.5 + 0.5, 0.5 - d.y * 0.5, s.z);
}
/**
 * How much of the shadow light reaches a point: 1 lit, 0 in shadow; \`radius\` (in shadow-map texels) softens the edge.
 * Points past the shadow distance are lit.
 */
fn shadowAt(p: vec3f, normal: vec3f, radius: f32) -> f32 {
  if (F.shadowOn < 0.5) { return 1.0; }
  let dist = length(p);
  let fade = smoothstep(F.shadowDist * 0.8, F.shadowDist, dist);
  if (fade >= 1.0) { return 1.0; }
  // pushed off the surface along its normal, more where the map is stretched
  let s0 = F.shadowMat * vec4f(p, 1.0);
  let stretch = length(s0.xy) * 0.85 + 0.15;
  let texel = 2.0 * F.shadowDist / F.shadowRes;
  let q = p + normal * texel * (0.6 + 2.2 * stretch * stretch) + F.lightDir * texel * 0.5;
  let c = shadowCoord(q);
  if (any(c.xy < vec2f(0.0)) || any(c.xy > vec2f(1.0))) { return 1.0; }
  let bias = 0.0004 * stretch;
  let r = radius / F.shadowRes * stretch;
  let a = noiseIGN(floor(p.xz * 37.0 + p.y * 13.0) + F.screen.xy * 0.0) * 6.2831853;
  let ca = cos(a); let sa = sin(a);
  var lit = 0.0;
  var DISK = array<vec2f, 8>(vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621), vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893));
  for (var i = 0; i < 8; i++) {
    let o = DISK[i];
    let off = vec2f(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * r;
    lit += textureSampleCompareLevel(shadowMap, shadowCmp, c.xy + off, c.z - bias);
  }
  return mix(lit / 8.0, 1.0, fade);
}
/** Depth of the nearest thing toward the light (for soft shadows: how far the shadow is cast). */
fn shadowBlocker(p: vec3f) -> f32 {
  let c = shadowCoord(p);
  return textureLoad(shadowMap, vec2i(clamp(c.xy, vec2f(0.0), vec2f(0.9999)) * F.shadowRes), 0);
}
`;

/** Bindings of world shaders (group 3). */
const GBUFFER_BINDINGS = /* wgsl */ `
@group(3) @binding(0) var<uniform> F: Frame;
@group(3) @binding(1) var shadowMap: texture_depth_2d;
@group(3) @binding(2) var shadowCmp: sampler_comparison;
@group(3) @binding(3) var noiseTex: texture_2d<f32>;
@group(3) @binding(4) var repeatSamp: sampler;
@group(3) @binding(5) var noise3D: texture_3d<f32>;
@group(3) @binding(6) var linearSamp: sampler;
@group(3) @binding(7) var materials: texture_2d<u32>;
// the world behind translucent things (what was drawn before water and glass), for refraction and reflections
@group(3) @binding(8) var opaqueColor: texture_2d<f32>;
@group(3) @binding(9) var opaqueDepth: texture_depth_2d;
`;

/** Bindings of full-screen passes (group 0; their inputs are group 1). */
const PASS_BINDINGS = /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var linearSamp: sampler;
@group(0) @binding(2) var nearestSamp: sampler;
@group(0) @binding(3) var depthTex: texture_depth_2d;      // everything drawn
@group(0) @binding(4) var depthOpaque: texture_depth_2d;   // before translucent things (water)
@group(0) @binding(5) var shadowMap: texture_depth_2d;
@group(0) @binding(6) var shadowCmp: sampler_comparison;
@group(0) @binding(7) var noiseTex: texture_2d<f32>;
@group(0) @binding(8) var repeatSamp: sampler;
@group(0) @binding(9) var noise3D: texture_3d<f32>;
@group(0) @binding(10) var materials: texture_2d<u32>;
@group(0) @binding(11) var lodDepth: texture_depth_2d;     // distant terrain (drawn with a depth of its own)
struct PassIn { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> PassIn {
  var o: PassIn;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  o.pos = vec4f(p, 0.0, 1.0);
  return o;
}
/** Depth buffer values at a uv. */
fn sceneDepth(uv: vec2f) -> f32 { return textureLoad(depthTex, vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * F.screen.xy), 0); }
fn opaqueDepthAt(uv: vec2f) -> f32 { return textureLoad(depthOpaque, vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * F.screen.xy), 0); }
/** How far away what's seen at a uv is (the world or distant terrain), or 1e6 for the sky. */
fn sceneDistance(uv: vec2f) -> f32 {
  let d = sceneDepth(uv);
  if (d < 0.99999) { return length(fromScreen(uv, d)); }
  let l = textureLoad(lodDepth, vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * F.screen.xy), 0);
  if (l >= 0.99999) { return 1e6; }
  let w = F.lodInvViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, l * 2.0 - 1.0, 1.0);
  return length(w.xyz / w.w);
}
`;

/** WGSL constants for a pack's settings. */
function settingConsts(b: ShaderBundle, values: Record<string, SettingValue>): string {
  const out: string[] = [];
  for (const s of b.manifest.settings ?? []) {
    const v = values[s.id] ?? s.default;
    if (!/^[A-Z_][A-Z0-9_]*$/.test(s.id)) continue;
    if (s.type === 'bool') out.push(`const ${s.id}: bool = ${v ? 'true' : 'false'};`);
    else if (s.type === 'enum') out.push(`const ${s.id}: f32 = ${Number(v).toFixed(4)};`);
    else out.push(`const ${s.id}: f32 = ${Number(v).toFixed(6)};`);
  }
  return out.join('\n') + '\n';
}

/** A setting's value or a literal. */
export function resolve<T extends SettingValue>(v: Ref<T> | undefined, values: Record<string, SettingValue>, dflt: T): T {
  if (v === undefined) return dflt;
  if (typeof v === 'string') return (values[v] ?? dflt) as T;
  return v;
}

/** Source pieces, with where each starts, for turning compiler line numbers back into the pack's files. */
export interface Assembled { code: string; parts: { file: string; line: number }[] }

function assemble(pieces: [string, string][]): Assembled {
  let code = '', line = 1;
  const parts: { file: string; line: number }[] = [];
  for (const [file, text] of pieces) {
    parts.push({ file, line });
    const t = text.endsWith('\n') ? text : text + '\n';
    code += t;
    line += t.split('\n').length - 1;
  }
  return { code, parts };
}

/** Where line `n` of an assembled source came from. */
export function locate(a: Assembled, n: number): string {
  let p = a.parts[0];
  for (const q of a.parts) if (q.line <= n) p = q;
  return `${p.file}:${n - p.line + 1}`;
}

const DEFAULTS: [RegExp, string][] = [
  [/\bfn\s+packWave\s*\(/, 'fn packWave(p: vec3f, flags: u32, top: f32) -> vec3f { return p; }'],
  [/\bfn\s+packFog\s*\(/, 'fn packFog(c: vec3f, s: Surface) -> vec3f { if (s.kind == KIND_HAND) { return c; } return vanillaFog(c, s.pos); }'],
  [/\bfn\s+packSky\s*\(/, 'fn packSky(d: vec3f) -> vec3f { return vanillaSky(d) + vec3f(vanillaStars(d)); }'],
  [/\bfn\s+packTranslucent\s*\(/, 'fn packTranslucent(s: Surface) -> vec4f { return vec4f(packShade(s), s.alpha); }'],
];

/** The library and a pack's world code, to go at the top of each world shader. */
export function gbufferLibrary(src: ShaderPackSource): Assembled {
  const b = src.bundle, m = b.manifest;
  const user = [...(m.common ?? []), m.gbuffers].map((f) => b.files[f]).join('\n');
  const defaults = DEFAULTS.filter(([re]) => !re.test(user)).map(([, d]) => d).join('\n');
  return assemble([
    ['(frame)', FRAME_STRUCT], ['(bindings)', GBUFFER_BINDINGS], ['(library)', HELPERS], ['(settings)', settingConsts(b, src.values)],
    ...(m.common ?? []).map((f): [string, string] => [f, b.files[f]]), [m.gbuffers, b.files[m.gbuffers]], ['(defaults)', defaults + '\n'],
  ]);
}

/** A full-screen pass's whole source: the library, its inputs as `<name>Tex`, and the pass. */
export function passSource(src: ShaderPackSource, file: string, inputs: string[]): Assembled {
  const b = src.bundle, m = b.manifest;
  // each input by name (<name>Tex) and by position (input0, input1...): a program uses one or the other
  const decl = inputs.map((n, i) => `@group(1) @binding(${i}) var ${n}Tex: texture_2d<f32>;\n@group(1) @binding(${i}) var input${i}: texture_2d<f32>;`).join('\n');
  return assemble([
    ['(frame)', FRAME_STRUCT], ['(bindings)', PASS_BINDINGS + decl + '\n'], ['(library)', HELPERS], ['(settings)', settingConsts(b, src.values)],
    ...(m.common ?? []).map((f): [string, string] => [f, b.files[f]]), [file, b.files[file]],
  ]);
}

/** Each texture's MAT_* flags, by its name. */
export function materialFlags(names: string[]): Uint32Array {
  const out = new Uint32Array(Math.max(1, names.length));
  names.forEach((n0, i) => {
    const n = n0.replace(/^[a-z0-9_]+:/, '');
    let f = 0;
    if (/_leaves$|^leaves/.test(n)) f |= 1;
    if (/^(short_grass|fern|dead_bush|dandelion|poppy|cornflower|oxeye_daisy|allium|tulip|.*_sapling|wheat_stage\d|carrots_stage\d|potatoes_stage\d|beetroots_stage\d|sugar_cane|pumpkin_stem|melon_stem|tall_grass.*|large_fern.*|.*_flower|rose_bush.*|lilac.*|peony.*|sunflower.*)$/.test(n)) f |= 2;
    if (/^water_(still|flow)$/.test(n)) f |= 4;
    if (/^lava_(still|flow)$/.test(n)) f |= 8 | 16;
    if (/^(glowstone|torch|redstone_torch|fire|jack_o_lantern|redstone_lamp_on|magma_block|furnace_front_on|nether_portal|end_portal|end_rod|sea_lantern|lantern|.*_lit|particle_flame|particle_flash|particle_spark_\d|end_beam|beacon)$/.test(n)) f |= 16;
    if (/^(glass|glass_pane_top|.*_stained_glass.*)$/.test(n)) f |= 32;
    if (/^(ice|packed_ice|blue_ice)$/.test(n)) f |= 64;
    if (/^(iron_block|gold_block|iron_bars|iron_bars_top|anvil.*|.*_anvil_top|hopper_.*|rail.*|powered_rail.*|detector_rail.*|activator_rail.*|cauldron.*|minecart.*)$/.test(n)) f |= 128;
    if (/^(snow|grass_side_snowed|powder_snow)$/.test(n)) f |= 256;
    if (/^(diamond_block|emerald_block|quartz_block_.*|lapis_block|smooth_stone|obsidian|.*_ore)$/.test(n)) f |= 512;
    if (/^particle_/.test(n)) f |= 1024;
    out[i] = f;
  });
  return out;
}

/** 256x256 RGBA of smooth-ish random values (each channel its own). */
export function noise2D(): Uint8Array {
  const N = 256, out = new Uint8Array(N * N * 4);
  let s = 0x9e3779b9;
  for (let i = 0; i < out.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; out[i] = (s >>> 0) & 255; }
  return out;
}

/**
 * 64^3 tiling cloud noise: r = Perlin-Worley (soft billows with sharp edges), g/b/a = inverted Worley at 2x, 4x
 * and 8x the detail (for eroding edges).
 */
export function noise3DData(N = 64): Uint8Array {
  const out = new Uint8Array(N * N * N * 4);
  // tiling value-gradient noise
  const perm = new Uint8Array(512);
  let s = 1337;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const grad = (h: number, x: number, y: number, z: number) => { const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const perlin = (x: number, y: number, z: number, period: number) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), xf = x - X, yf = y - Y, zf = z - Z;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const h = (i: number, j: number, k: number) => perm[(perm[(perm[((X + i) % period + period) % period] + ((Y + j) % period + period) % period) & 255] + ((Z + k) % period + period) % period) & 255] & 15;
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(grad(h(0, 0, 0), xf, yf, zf), grad(h(1, 0, 0), xf - 1, yf, zf), u), l(grad(h(0, 1, 0), xf, yf - 1, zf), grad(h(1, 1, 0), xf - 1, yf - 1, zf), u), v),
      l(l(grad(h(0, 0, 1), xf, yf, zf - 1), grad(h(1, 0, 1), xf - 1, yf, zf - 1), u), l(grad(h(0, 1, 1), xf, yf - 1, zf - 1), grad(h(1, 1, 1), xf - 1, yf - 1, zf - 1), u), v),
      w,
    );
  };
  // Worley: one random point per cell, wrapping
  const worleyPts = (cells: number) => { const p = new Float32Array(cells * cells * cells * 3); for (let i = 0; i < p.length; i++) p[i] = rnd(); return p; };
  const worley = (pts: Float32Array, cells: number, x: number, y: number, z: number) => {
    const fx = x * cells, fy = y * cells, fz = z * cells, cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = (cx + dx + cells) % cells, iy = (cy + dy + cells) % cells, iz = (cz + dz + cells) % cells, k = ((iz * cells + iy) * cells + ix) * 3;
      const px = cx + dx + pts[k], py = cy + dy + pts[k + 1], pz = cz + dz + pts[k + 2];
      const d = (px - fx) ** 2 + (py - fy) ** 2 + (pz - fz) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const w4 = worleyPts(4), w8 = worleyPts(8), w16 = worleyPts(16), w32 = worleyPts(32);
  const raw = new Float32Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    let p = 0, amp = 1, tot = 0;
    for (let o = 0, f = 4; o < 4; o++, f *= 2) { p += perlin(u * f, v * f, w * f, f) * amp; tot += amp; amp *= 0.5; }
    p = p / tot * 0.5 + 0.5;
    const wf = (pts: Float32Array, c: number) => Math.max(0, 1 - worley(pts, c, u, v, w));
    const wa = wf(w4, 4) * 0.625 + wf(w8, 8) * 0.25 + wf(w16, 16) * 0.125;
    const i = ((z * N + y) * N + x) * 4;
    // Perlin remapped by Worley: billowy
    raw[i] = (p - (wa - 1)) / (2 - wa);
    raw[i + 1] = wf(w8, 8) * 0.625 + wf(w16, 16) * 0.25 + wf(w32, 32) * 0.125;
    raw[i + 2] = wf(w16, 16) * 0.625 + wf(w32, 32) * 0.375;
    raw[i + 3] = wf(w32, 32);
  }
  // each channel stretched over 0..1
  for (let c = 0; c < 4; c++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = c; i < raw.length; i += 4) { lo = Math.min(lo, raw[i]); hi = Math.max(hi, raw[i]); }
    for (let i = c; i < raw.length; i += 4) out[i] = Math.round(((raw[i] - lo) / (hi - lo || 1)) * 255);
  }
  return out;
}
