// Vibrant: how the world is lit. Sunlight with soft shadows, sky light, warm torch light, glowing things that bloom,
// plants that sway, and water that refracts what's under it and reflects the sky and the world.

fn packWave(p: vec3f, flags: u32, top: f32) -> vec3f {
  if (!WAVING) { return p; }
  let w = worldPos(p);
  let t = F.time;
  let wind = 1.0 + F.rain * 1.4 + F.thunder;
  if ((flags & MAT_LEAVES) != 0u) {
    let o = vec3f(
      sin(t * 1.6 + w.x * 0.9 + w.y * 0.6 + w.z * 0.2),
      sin(t * 1.3 + w.z * 0.8 + w.x * 0.3) * 0.4,
      sin(t * 1.9 + w.z * 0.7 + w.y * 0.4 - w.x * 0.3));
    return p + o * 0.035 * wind;
  }
  if ((flags & MAT_PLANT) != 0u && top > 0.5) {
    let gust = 0.6 + 0.4 * sin(t * 0.7 + w.x * 0.05 + w.z * 0.07);
    let o = vec2f(sin(t * 2.2 + w.x * 0.7 + w.z * 0.4), sin(t * 1.8 + w.z * 0.9 - w.x * 0.2));
    return p + vec3f(o.x, 0.0, o.y) * 0.08 * wind * gust;
  }
  return p;
}

/** Warm light from torches and lamps, in linear colour. */
fn blockLight(blk: f32) -> vec3f {
  let b = blk / 15.0;
  return vec3f(1.0, 0.6, 0.3) * (pow(b, 3.0) * 0.8 + pow(b, 8.0) * 0.7) * F.flicker / 1.5;
}

fn packShade(s: Surface) -> vec3f {
  let albedo = toLinear(s.albedo);
  // the Nether and the End have no sun: their own lighting, a little punchier
  if (F.dimension > 0.5) {
    var c = albedo * toLinear(vanillaLight(s.light.x, s.light.y)) * s.shade * 1.2;
    if ((s.flags & MAT_EMISSIVE) != 0u) { c += albedo * 1.5; }
    return c;
  }
  let sky = s.light.x / 15.0;
  var direct = vec3f(0.0);
  if (s.kind != KIND_HAND && F.lightStrength > 0.0) {
    var ndl: f32;
    if ((s.flags & (MAT_PLANT | MAT_LEAVES)) != 0u) { ndl = 0.55 + 0.45 * max(F.lightDir.y, 0.0); } // thin: lit through
    else { ndl = max(dot(s.normal, F.lightDir), 0.0); }
    if (s.kind == KIND_ENTITY || s.kind == KIND_DYN) { ndl = ndl * 0.7 + 0.3; }
    if (ndl > 0.0) {
      // the game's sky light keeps the sun out of caves where the shadow map can't see
      let open = smoothstep(0.4, 0.9, sky);
      direct = sunColor() * F.lightStrength * ndl * shadowAt(s.pos, s.normal, SOFT_SHADOWS) * open * 0.85;
    }
  }
  if (s.kind == KIND_HAND) { direct = sunColor() * F.lightStrength * sky * sky * 0.5; }
  let ambient = skyAmbient() * (sky * sky);
  let torch = blockLight(s.light.y);
  let minimum = vec3f(0.008, 0.009, 0.012) + toLinear(F.ambientCol) * 0.5;
  var c = albedo * (direct * mix(1.0, s.shade, 0.35) + (ambient + torch + minimum) * s.shade);
  if (F.nightVision > 0.0) { c = mix(c, albedo * 0.8, F.nightVision * 0.7); }
  if ((s.flags & MAT_EMISSIVE) != 0u) { c += albedo * EMISSIVE_BOOST * 1.5 * luma(albedo + 0.2); }
  // a glint of the sun on shiny things
  if ((s.flags & (MAT_METAL | MAT_GEM | MAT_ICE)) != 0u && s.kind == KIND_TERRAIN) {
    let v = normalize(s.pos);
    let h = normalize(F.lightDir - v);
    c += sunColor() * pow(max(dot(s.normal, h), 0.0), 64.0) * F.lightStrength * 1.5 * shadowAt(s.pos, s.normal, 1.0);
  }
  return c;
}

/** Small waves on the water: a height field of a few layers of noise drifting different ways. */
fn waveHeight(w: vec2f) -> f32 {
  let t = F.time;
  return noise2(w * 0.45 + vec2f(t * 0.25, t * 0.16)) + noise2(w * 0.9 - vec2f(t * 0.3, -t * 0.22)) * 0.5 + noise2(w * 1.9 + vec2f(-t * 0.42, t * 0.5)) * 0.22;
}
fn waterNormal(w: vec2f) -> vec3f {
  let e = 0.08;
  let h = waveHeight(w);
  let strength = 0.07 + F.rain * 0.12;
  return normalize(vec3f((h - waveHeight(w + vec2f(e, 0.0))) * strength / e, 1.0, (h - waveHeight(w + vec2f(0.0, e))) * strength / e));
}

/** The world reflected in the water: a march through the scene behind it, in screen space. */
fn reflectScene(p: vec3f, r: vec3f) -> vec4f {
  var hit = vec4f(0.0);
  var stp = 0.6 + length(p) * 0.02;
  var q = p + r * stp * noiseIGN(toScreen(p).xy * F.screen.xy);
  for (var i = 0; i < 28; i++) {
    q += r * stp;
    let sc = toScreen(q);
    if (any(sc.xy < vec2f(0.0)) || any(sc.xy > vec2f(1.0)) || sc.z >= 1.0) { break; }
    let d = textureLoad(opaqueDepth, vec2i(sc.xy * F.screen.xy), 0);
    if (d < 0.99999 && sc.z > d) {
      let thick = linearDepth(sc.z) - linearDepth(d);
      if (thick < stp * 2.5 + 0.5) {
        let edge = 1.0 - smoothstep(0.85, 1.0, max(abs(sc.x * 2.0 - 1.0), abs(sc.y * 2.0 - 1.0)));
        hit = vec4f(textureSampleLevel(opaqueColor, linearSamp, sc.xy, 0.0).rgb, edge);
      }
      break;
    }
    stp *= 1.18;
  }
  return hit;
}

fn packTranslucent(s: Surface) -> vec4f {
  if ((s.flags & MAT_WATER) == 0u) {
    // glass, ice, stained things: lit like the rest, a touch of sky reflection
    var c = packShade(s);
    let v = normalize(s.pos);
    let f = pow(1.0 - max(dot(-v, s.normal), 0.0), 4.0);
    c = mix(c, packSky(reflect(v, s.normal)) * (s.light.x / 15.0), f * 0.4);
    return vec4f(c, max(s.alpha, f * 0.5));
  }
  let v = normalize(s.pos);
  var n = s.normal;
  if (n.y > 0.5) { n = waterNormal(worldPos(s.pos).xz); }
  let up = n.y > 0.0 && v.y < 0.0;
  let cosv = max(dot(-v, n), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  let sky = s.light.x / 15.0;
  let waterTint = toLinear(s.albedo);
  // far water (distant terrain): no scene to look through
  if (s.kind == KIND_LOD) {
    let refl = packSky(reflect(v, n)) * sky;
    return vec4f(mix(waterTint * skyAmbient() * 0.6, refl, fres), 0.85);
  }
  // what's under the water, bent by the waves and fading into the water's colour with depth
  let uv = s.screen + n.xz * 0.012 * (1.0 - fres);
  var under = textureSampleLevel(opaqueColor, linearSamp, uv, 0.0).rgb;
  var dUnder = textureLoad(opaqueDepth, vec2i(uv * F.screen.xy), 0);
  if (dUnder < s.depth) { under = textureSampleLevel(opaqueColor, linearSamp, s.screen, 0.0).rgb; dUnder = textureLoad(opaqueDepth, vec2i(s.screen * F.screen.xy), 0); }
  let thick = select(linearDepth(dUnder) - linearDepth(s.depth), 64.0, dUnder >= 0.99999);
  let absorb = exp(-max(thick, 0.0) * vec3f(0.62, 0.2, 0.11)) * 0.92;
  let deep = waterTint * (skyAmbient() * 0.6 + sunColor() * F.lightStrength * 0.12) + blockLight(s.light.y) * waterTint * 0.3;
  let body = under * absorb + deep * (1.0 - absorb);
  // the sky and the world reflected
  let r = reflect(v, n);
  var refl = packSky(r) * mix(0.15, 1.0, sky);
  if (WATER_REFLECTIONS && up) {
    let w = reflectScene(s.pos, r);
    refl = mix(refl, w.rgb, w.a);
  }
  var c = mix(body, refl, select(fres * 0.6, fres, up));
  // the sun glittering on the waves
  let h = normalize(F.lightDir - v);
  let spec = pow(max(dot(n, h), 0.0), 600.0) * 18.0 + pow(max(dot(n, h), 0.0), 80.0) * 0.25;
  c += sunColor() * spec * F.lightStrength * shadowAt(s.pos, vec3f(0.0, 1.0, 0.0), 1.0);
  return vec4f(c, 1.0);
}

fn packFog(c: vec3f, s: Surface) -> vec3f {
  if (s.kind == KIND_HAND) { return c; }
  let d = length(s.pos);
  // under water: the light fades fast into blue
  if (F.eyeInWater > 0.5 && F.eyeInWater < 1.5) {
    let f = 1.0 - exp(-d * 0.07);
    return mix(c, toLinear(vec3f(0.05, 0.18, 0.32)) * (skyAmbient() + 0.02), f);
  }
  if (F.eyeInWater > 1.5) { return mix(c, vec3f(0.8, 0.2, 0.02), 1.0 - exp(-d * 0.8)); }
  // the game's fog (where the loaded world ends), toward this pack's sky
  let dir = s.pos / max(d, 1e-3);
  var fc = packSky(vec3f(dir.x, max(dir.y, 0.02), dir.z));
  if (F.dimension > 0.5) { fc = toLinear(F.fogColor); }
  var c2 = mix(c, fc, vanillaFogAmount(s.pos));
  // a light haze in the air toward the horizon's colour, warmer toward the sun
  if (F.dimension < 0.5) {
    let haze = (1.0 - exp(-d * 0.0011 * (1.0 + F.rain * 5.0))) * 0.55;
    let toward = pow(max(dot(dir, F.sunDir), 0.0), 4.0) * F.daylight;
    c2 = mix(c2, packSky(vec3f(dir.x, 0.03, dir.z)) * 0.85 + sunColor() * toward * 0.15, haze);
  }
  return c2;
}
