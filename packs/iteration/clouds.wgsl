// Iteration: volumetric clouds, marched through the cloud layer: light from the sun (dimmed by the cloud between),
// light from the sky, forward-scattering silver linings. rgb = light added, a = how much of what's behind remains.
@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  // (no clouds in the Nether and the End, nor seen from under water)
  if (F.dimension > 0.5 || F.eyeInWater > 0.5) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let dir = normalize(fromScreen(i.uv, 1.0));
  // the world or distant terrain stops the ray where it is
  let maxT = sceneDistance(i.uv);
  let cam = F.camPos;
  if (abs(dir.y) < 1e-4) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let ta = (CLOUD_LO - cam.y) / dir.y;
  let tb = (CLOUD_HI - cam.y) / dir.y;
  var t0 = max(min(ta, tb), 0.0);
  var t1 = min(max(ta, tb), maxT);
  t1 = min(t1, t0 + 2500.0);
  if (t1 <= t0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let steps = i32(CLOUD_STEPS);
  let dt = (t1 - t0) / f32(steps);
  var t = t0 + dt * noiseIGN(i.pos.xy);
  let mu = dot(dir, F.lightDir);
  let phase = mix(phaseHG(mu, 0.75), phaseHG(mu, -0.25), 0.35) * 2.0;
  let sun = sunIrradiance() * 4.5;
  let amb = skyIrradiance() * 1.25;
  var T = 1.0;
  var L = vec3f(0.0);
  for (var k = 0; k < steps; k++) {
    let p = cam + dir * t;
    let d = cloudDensity(p);
    if (d > 0.001) {
      // toward the light: how much cloud is in the way
      var od = 0.0;
      for (var j = 1; j <= 4; j++) {
        let s = f32(j * j) * 9.0;
        od += cloudDensity(p + F.lightDir * s) * s * 0.55;
      }
      let lightT = exp(-od) * (1.0 - exp(-od * 2.0 - d * 30.0));
      let h = clamp((p.y - CLOUD_LO) / (CLOUD_HI - CLOUD_LO), 0.0, 1.0);
      let S = (sun * lightT * phase + amb * (0.4 + 0.6 * h)) * d;
      let Tk = exp(-d * dt);
      L += T * S * (1.0 - Tk) / d;
      T *= Tk;
      if (T < 0.02) { break; }
    }
    t += dt;
  }
  // far clouds fade into the haze
  let fade = exp(-t0 * 0.00045 * (1.0 + F.rain * 2.0));
  let air = atmosphere(vec3f(dir.x, max(dir.y, 0.0), dir.z));
  L = mix(air * (1.0 - T), L, fade);
  return vec4f(L, T);
}
