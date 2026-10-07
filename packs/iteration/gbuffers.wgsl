// Iteration: how the world is lit. Sun and sky light from the atmosphere, contact-hardening soft shadows and cloud
// shadows, wet ground and puddles in the rain, glossy metal and gems, and water with refraction, reflections,
// absorption and raindrop ripples.

fn packWave(p: vec3f, flags: u32, top: f32) -> vec3f {
  if (!WAVING) { return p; }
  let w = worldPos(p);
  let t = F.time;
  let wind = 0.8 + F.rain * 1.6 + F.thunder;
  if ((flags & MAT_LEAVES) != 0u) {
    let o = vec3f(sin(t * 1.4 + w.x * 0.8 + w.y * 0.5), sin(t * 1.1 + w.z * 0.7) * 0.3, sin(t * 1.7 + w.z * 0.6 + w.y * 0.4));
    return p + o * 0.025 * wind;
  }
  if ((flags & MAT_PLANT) != 0u && top > 0.5) {
    let gust = 0.5 + 0.5 * noise2(w.xz * 0.05 + vec2f(t * 0.2, 0.0));
    let o = vec2f(sin(t * 2.0 + w.x * 0.6 + w.z * 0.3), sin(t * 1.6 + w.z * 0.8));
    return p + vec3f(o.x, 0.0, o.y) * 0.07 * wind * gust;
  }
  return p;
}

fn blockLight(blk: f32) -> vec3f {
  let b = blk / 15.0;
  return vec3f(1.0, 0.55, 0.24) * (pow(b, 4.0) * 0.9 + pow(b, 9.0) * 0.9) * F.flicker / 1.5;
}

/** Soft shadows: how far the nearest caster is decides how wide the penumbra is. */
fn softShadow(p: vec3f, n: vec3f) -> f32 {
  var r = 1.0;
  if (PCSS) {
    let c = shadowCoord(p + n * 0.05);
    var blocker = 0.0;
    var found = 0.0;
    for (var i = 0; i < 4; i++) {
      let a = f32(i) * 1.5708 + 0.4;
      let o = vec2f(cos(a), sin(a)) * 6.0 / F.shadowRes;
      let d = textureLoad(shadowMap, vec2i(clamp(c.xy + o, vec2f(0.0), vec2f(0.9999)) * F.shadowRes), 0);
      if (d < c.z - 0.0008) { blocker += d; found += 1.0; }
    }
    if (found > 0.0) { r = clamp((c.z - blocker / found) * 512.0 * 0.35, 0.6, 7.0); }
  }
  return shadowAt(p, n, r);
}

/** Wetness of an upward surface in the rain (puddles where the noise is low). */
fn wetness(s: Surface) -> f32 {
  if (!WET || F.rain <= 0.0 || s.normal.y < 0.9 || s.kind != KIND_TERRAIN) { return 0.0; }
  let open = smoothstep(13.5, 14.8, s.light.x);
  let w = worldPos(s.pos).xz;
  let puddle = smoothstep(0.55, 0.35, noiseFbm(w * 0.18));
  return F.rain * open * mix(0.45, 1.0, puddle);
}

/** Rings spreading from raindrops: a normal tilt for wet and water surfaces. */
fn ripples(w: vec2f) -> vec2f {
  var n = vec2f(0.0);
  let t = F.time * 1.6;
  for (var layer = 0; layer < 2; layer++) {
    let q = w * (1.3 + f32(layer) * 0.9) + f32(layer) * 17.0;
    let cell = floor(q);
    for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
      let c = cell + vec2f(f32(x), f32(y));
      let r = noise2v(c * 7.13);
      let phase = fract(t * (0.7 + r.z * 0.6) + r.w);
      let center = c + r.xy;
      let d = q - center;
      let len = length(d);
      let ring = sin((len - phase) * 28.0) * smoothstep(0.0, 0.08, phase) * (1.0 - phase) * smoothstep(phase + 0.12, phase, len) * smoothstep(phase - 0.25, phase, len);
      n += d / max(len, 1e-3) * ring;
    } }
  }
  return n * 0.35 * F.rain;
}

fn packShade(s: Surface) -> vec3f {
  var albedo = toLinear(s.albedo);
  if (F.dimension > 0.5) {
    var c = albedo * toLinear(vanillaLight(s.light.x, s.light.y)) * s.shade * 1.15;
    if ((s.flags & MAT_EMISSIVE) != 0u) { c += albedo * 1.8; }
    return c;
  }
  let sky = s.light.x / 15.0;
  let wet = wetness(s);
  albedo *= mix(1.0, 0.55, wet);
  var n = s.normal;
  if (wet > 0.0) { let rp = ripples(worldPos(s.pos).xz) * wet; n = normalize(vec3f(rp.x, 1.0, rp.y)); }
  var direct = vec3f(0.0);
  var sh = 0.0;
  if (s.kind != KIND_HAND && F.lightStrength > 0.0) {
    var ndl: f32;
    if ((s.flags & (MAT_PLANT | MAT_LEAVES)) != 0u) { ndl = 0.5 + 0.5 * max(F.lightDir.y, 0.0); }
    else { ndl = max(dot(s.normal, F.lightDir), 0.0); }
    if (s.kind == KIND_ENTITY || s.kind == KIND_DYN) { ndl = ndl * 0.75 + 0.25; }
    if (ndl > 0.0) {
      let open = smoothstep(0.4, 0.9, sky);
      sh = softShadow(s.pos, s.normal) * open * cloudShadow(worldPos(s.pos));
      direct = sunIrradiance() * ndl * sh;
    }
  }
  if (s.kind == KIND_HAND) { direct = sunIrradiance() * sky * sky * 0.6; }
  let ambient = skyIrradiance() * sky * sky;
  let torch = blockLight(s.light.y);
  let minimum = vec3f(0.0035, 0.004, 0.006) + toLinear(F.ambientCol) * 0.5;
  var c = albedo * (direct * mix(1.0, s.shade, 0.3) + (ambient + torch + minimum) * s.shade);
  if (F.nightVision > 0.0) { c = mix(c, albedo * 0.8, F.nightVision * 0.7); }
  if ((s.flags & MAT_EMISSIVE) != 0u) { c += albedo * EMISSIVE_BOOST * 2.0 * luma(albedo + 0.2); }
  // shine: the sky and the sun mirrored in wet ground, metal and gems
  var gloss = wet * 0.9;
  if ((s.flags & (MAT_METAL | MAT_GEM | MAT_ICE)) != 0u) { gloss = max(gloss, 0.5); }
  if (gloss > 0.0 && s.kind == KIND_TERRAIN) {
    let v = normalize(s.pos);
    let r = reflect(v, n);
    let fres = 0.04 + 0.96 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
    c = mix(c, atmosphere(r) * sky, fres * gloss);
    let h = normalize(F.lightDir - v);
    c += sunIrradiance() * pow(max(dot(n, h), 0.0), mix(40.0, 400.0, gloss)) * 6.0 * gloss * sh;
  }
  return c;
}

fn waveHeight(w: vec2f) -> f32 {
  let t = F.time;
  return noise2(w * 0.35 + vec2f(t * 0.2, t * 0.13)) + noise2(w * 0.8 - vec2f(t * 0.27, -t * 0.2)) * 0.45 + noise2(w * 1.7 + vec2f(-t * 0.4, t * 0.45)) * 0.2;
}
fn waterNormal(w: vec2f) -> vec3f {
  let e = 0.08;
  let h = waveHeight(w);
  let k = 0.06 + F.rain * 0.08;
  let rp = ripples(w);
  return normalize(vec3f((h - waveHeight(w + vec2f(e, 0.0))) * k / e + rp.x, 1.0, (h - waveHeight(w + vec2f(0.0, e))) * k / e + rp.y));
}

fn reflectScene(p: vec3f, r: vec3f) -> vec4f {
  var hit = vec4f(0.0);
  var stp = 0.5 + length(p) * 0.015;
  var q = p + r * stp * noiseIGN(toScreen(p).xy * F.screen.xy);
  for (var i = 0; i < 32; i++) {
    q += r * stp;
    let sc = toScreen(q);
    if (any(sc.xy < vec2f(0.0)) || any(sc.xy > vec2f(1.0)) || sc.z >= 1.0) { break; }
    let d = textureLoad(opaqueDepth, vec2i(sc.xy * F.screen.xy), 0);
    if (d < 0.99999 && sc.z > d) {
      let thick = linearDepth(sc.z) - linearDepth(d);
      if (thick < stp * 2.5 + 0.5) {
        let edge = 1.0 - smoothstep(0.8, 1.0, max(abs(sc.x * 2.0 - 1.0), abs(sc.y * 2.0 - 1.0)));
        hit = vec4f(textureSampleLevel(opaqueColor, linearSamp, sc.xy, 0.0).rgb, edge);
      }
      break;
    }
    stp *= 1.15;
  }
  return hit;
}

fn packTranslucent(s: Surface) -> vec4f {
  let v = normalize(s.pos);
  if ((s.flags & MAT_WATER) == 0u) {
    var c = packShade(s);
    let f = 0.04 + 0.96 * pow(1.0 - max(dot(-v, s.normal), 0.0), 5.0);
    c = mix(c, atmosphere(reflect(v, s.normal)) * (s.light.x / 15.0), f * 0.6);
    return vec4f(c, max(s.alpha, f * 0.6));
  }
  var n = s.normal;
  if (n.y > 0.5) { n = waterNormal(worldPos(s.pos).xz); }
  let up = n.y > 0.0 && v.y < 0.0;
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
  let sky = s.light.x / 15.0;
  if (s.kind == KIND_LOD) {
    return vec4f(mix(vec3f(0.01, 0.03, 0.05) * skyIrradiance() * 4.0, atmosphere(reflect(v, n)) * sky, fres), 0.9);
  }
  let uv = s.screen + n.xz * 0.012 * (1.0 - fres);
  var under = textureSampleLevel(opaqueColor, linearSamp, uv, 0.0).rgb;
  var dUnder = textureLoad(opaqueDepth, vec2i(uv * F.screen.xy), 0);
  if (dUnder < s.depth) { under = textureSampleLevel(opaqueColor, linearSamp, s.screen, 0.0).rgb; dUnder = textureLoad(opaqueDepth, vec2i(s.screen * F.screen.xy), 0); }
  let thick = select(linearDepth(dUnder) - linearDepth(s.depth), 64.0, dUnder >= 0.99999);
  // clear water: red goes first, then green; what's left is a deep teal-blue
  let absorb = exp(-max(thick, 0.0) * vec3f(0.55, 0.16, 0.09));
  let scatterCol = vec3f(0.02, 0.09, 0.13) * (skyIrradiance() * 1.5 + sunIrradiance() * 0.2) + blockLight(s.light.y) * 0.04;
  let body = under * absorb + scatterCol * (1.0 - absorb);
  let r = reflect(v, n);
  var refl = packSky(r) * mix(0.1, 1.0, sky);
  if (WATER_SSR && up) { let w = reflectScene(s.pos, r); refl = mix(refl, w.rgb, w.a); }
  var c = mix(body, refl, select(fres * 0.5, fres, up));
  // the sun on the waves (GGX)
  let h = normalize(F.lightDir - v);
  let nh = max(dot(n, h), 0.0);
  let a2 = 0.0016;
  let dn = nh * nh * (a2 - 1.0) + 1.0;
  let ggx = a2 / (PI * dn * dn);
  c += sunIrradiance() * ggx * fres * 2.0 * shadowAt(s.pos, vec3f(0.0, 1.0, 0.0), 1.0) * cloudShadow(worldPos(s.pos));
  return vec4f(c, 1.0);
}

fn packFog(c: vec3f, s: Surface) -> vec3f {
  if (s.kind == KIND_HAND) { return c; }
  let d = length(s.pos);
  if (F.eyeInWater > 0.5 && F.eyeInWater < 1.5) {
    let t = exp(-d * vec3f(0.22, 0.07, 0.05));
    return c * t + vec3f(0.01, 0.05, 0.07) * skyIrradiance() * 2.0 * (1.0 - t);
  }
  if (F.eyeInWater > 1.5) { return mix(c, vec3f(0.9, 0.25, 0.03), 1.0 - exp(-d * 0.8)); }
  let dir = s.pos / max(d, 1e-3);
  if (F.dimension > 0.5) { return mix(c, toLinear(F.fogColor), vanillaFogAmount(s.pos)); }
  // the air between: light scattered in from the sky, a little of what's behind lost
  let ext = FOG_DENSITY * 0.0007 * (1.0 + F.rain * 5.0);
  let t = exp(-d * ext);
  let air = atmosphere(vec3f(dir.x, max(dir.y, 0.0) * 0.5 + 0.02, dir.z));
  var c2 = c * t + air * (1.0 - t);
  // the end of the loaded world fades into the sky
  return mix(c2, packSky(vec3f(dir.x, max(dir.y, 0.01), dir.z)), vanillaFogAmount(s.pos));
}
