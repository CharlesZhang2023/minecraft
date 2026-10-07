// Iteration: the atmosphere, sunlight and clouds, shared by the world's shading and the passes. Everything is in
// linear colour (turned back for the screen in final.wgsl).

fn toLinear(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }

// ---- the sky: single scattering by air (Rayleigh) and haze (Mie), with the air mass of each direction
const BETA_R = vec3f(0.0058, 0.0135, 0.0331);
const BETA_M = vec3f(0.0040, 0.0040, 0.0040);
const H_R = 8.0;
const H_M = 1.4;
const SUN_E = 16.0;

/** Relative air mass looking up at an elevation (Kasten and Young): 1 straight up, about 38 at the horizon. */
fn airMass(cz: f32) -> f32 {
  let c = clamp(cz, 0.0, 1.0);
  return 1.0 / (c + 0.50572 * pow(max(96.07995 - degrees(acos(c)), 0.01), -1.6364));
}
/** How much of the light from a direction gets through the air (sunlight's colour at the ground). */
fn transmittance(cz: f32) -> vec3f {
  return exp(-(BETA_R * H_R + BETA_M * H_M * (1.0 + F.rain * 3.0)) * airMass(cz));
}
fn phaseR(mu: f32) -> f32 { return 0.0596831 * (1.0 + mu * mu); }
fn phaseHG(mu: f32, g: f32) -> f32 { let g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }

/** Light scattered toward us from direction d by a light (sun or moon) in direction l with strength e. */
fn scatter(d: vec3f, l: vec3f, e: f32) -> vec3f {
  let up = max(d.y, 0.0) + 0.0;
  let mu = dot(d, l);
  let haze = 1.0 + F.rain * 3.0;
  let ext = BETA_R * H_R + BETA_M * H_M * haze;
  let view = 1.0 - exp(-ext * airMass(up));
  let sunT = transmittance(l.y + 0.02);
  let ph = (BETA_R * phaseR(mu) + BETA_M * haze * phaseHG(mu, 0.76)) / (BETA_R + BETA_M * haze);
  // light scattered more than once fills the sky a little (the shade of the sky never goes black)
  let multi = (BETA_R / (BETA_R + BETA_M)) * 0.04;
  return e * smoothstep(-0.12, 0.05, l.y) * (sunT * ph + multi * sunT) * view;
}

/** The sky in a direction, without the sun's disc. */
fn atmosphere(d0: vec3f) -> vec3f {
  let d = normalize(vec3f(d0.x, max(d0.y, 0.0), d0.z));
  var c = scatter(d, F.sunDir, SUN_E) + scatter(d, F.moonDir, SUN_E * 0.012) * vec3f(0.7, 0.85, 1.2);
  c += vec3f(0.0008, 0.001, 0.0018); // starlight and the glow of the night sky
  // below the horizon: the ground's shade
  let below = smoothstep(0.0, -0.25, d0.y);
  c = mix(c, c * 0.35 + vec3f(0.002), below);
  // rain: grey
  c = mix(c, vec3f(luma(c)) * 0.75, F.rain * 0.7);
  return c;
}

/** Sunlight (or moonlight) reaching the ground. */
fn sunIrradiance() -> vec3f {
  if (F.sunDir.y > 0.0) { return transmittance(F.sunDir.y) * 1.25 * smoothstep(0.0, 0.08, F.sunDir.y) * (1.0 - F.rain * 0.75); }
  return vec3f(0.5, 0.62, 0.9) * 0.05 * smoothstep(0.0, 0.08, F.moonDir.y) * (1.0 - F.rain * 0.75);
}

/** Light from the whole sky falling on an upward surface (a few directions of it). */
fn skyIrradiance() -> vec3f {
  let a = atmosphere(vec3f(0.0, 1.0, 0.0)) + atmosphere(vec3f(0.7, 0.3, 0.0)) + atmosphere(vec3f(-0.7, 0.3, 0.0)) + atmosphere(vec3f(0.0, 0.3, 0.7));
  return a * 0.25 * 1.6;
}

fn packSky(d: vec3f) -> vec3f {
  var c = atmosphere(d);
  // the sun's disc (the game's square sun is left out) and the moon's glow
  let mu = dot(d, F.sunDir);
  c += transmittance(F.sunDir.y) * smoothstep(0.99985, 0.99992, mu) * 60.0 * (1.0 - F.rain) * step(0.0, d.y + 0.02);
  c += vec3f(0.5, 0.6, 0.8) * pow(max(dot(d, F.moonDir), 0.0), 60.0) * 0.02;
  c += vec3f(vanillaStars(d) * 0.25 * (1.0 - F.rain));
  return c;
}

// ---- clouds: a layer of billowing noise between these heights (world blocks), drifting with the wind
const CLOUD_LO = 175.0;
const CLOUD_HI = 260.0;

fn cloudDensity(w: vec3f) -> f32 {
  let h = (w.y - CLOUD_LO) / (CLOUD_HI - CLOUD_LO);
  if (h <= 0.0 || h >= 1.0) { return 0.0; }
  let t = F.time * 3.0;
  let p = (w + vec3f(t, 0.0, t * 0.35)) / 1024.0;
  let shape = noise3(vec3f(p.x, w.y / 2048.0, p.z)).r;
  // rounded bottoms, wispy tops
  let profile = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.4, h);
  // some parts of the sky are clearer than others
  let region = noise3(vec3f(p.x * 0.25, 0.37, p.z * 0.25)).g;
  let cover = mix(CLOUD_COVER * mix(0.55, 1.25, region), 0.95, F.rain * 0.85);
  var d = (shape * profile - (1.0 - cover)) / max(cover, 0.05);
  if (d <= 0.0) { return 0.0; }
  let detail = noise3(p * 7.0 + vec3f(0.0, h * 0.3, 0.0)).g;
  d = d - (1.0 - detail) * 0.35 * (1.0 - d);
  return clamp(d, 0.0, 1.0) * 0.06 * (1.0 + F.rain);
}

/** How much the clouds above shade a point from the sun (1 none). */
fn cloudShadow(w: vec3f) -> f32 {
  if (!CLOUDS || F.lightDir.y < 0.05) { return 1.0; }
  let mid = (CLOUD_LO + CLOUD_HI) * 0.5;
  let t = (mid - w.y) / F.lightDir.y;
  if (t <= 0.0) { return 1.0; }
  let d = cloudDensity(w + F.lightDir * t);
  return mix(1.0, exp(-d * 60.0), 0.85);
}

/** A point in the shadow map: 1 lit, 0 shadowed (one sample). */
fn shadowPoint(p: vec3f) -> f32 {
  if (F.shadowOn < 0.5) { return 1.0; }
  let c = shadowCoord(p);
  if (any(c.xy < vec2f(0.0)) || any(c.xy > vec2f(1.0)) || length(p) > F.shadowDist) { return 1.0; }
  return textureSampleCompareLevel(shadowMap, shadowCmp, c.xy, c.z - 0.0006);
}
