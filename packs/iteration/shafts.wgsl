// Iteration: light shafts. Along each view ray, the air the sun (or moon) reaches glows a little, more so looking
// toward the light: shadows of trees and hills cut through it.
@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  if (F.dimension > 0.5 || F.lightStrength <= 0.0) { return vec4f(0.0); }
  var end = 72.0;
  if (textureSampleLevel(sceneTex, nearestSamp, i.uv, 0.0).a > 0.5) {
    let d = sceneDepth(i.uv);
    if (d < 0.99999) { end = min(end, length(fromScreen(i.uv, d))); }
  }
  let dir = normalize(fromScreen(i.uv, 1.0));
  let STEPS = 14;
  let dt = end / f32(STEPS);
  var t = dt * noiseIGN(i.pos.xy);
  var lit = 0.0;
  for (var k = 0; k < STEPS; k++) {
    let p = dir * t;
    lit += shadowPoint(p) * cloudShadow(worldPos(p));
    t += dt;
  }
  let mu = dot(dir, F.lightDir);
  let water = select(1.0, 6.0, F.eyeInWater > 0.5 && F.eyeInWater < 1.5);
  let density = FOG_DENSITY * 0.0035 * (1.0 + F.rain * 2.0) * water;
  let g = lit / f32(STEPS) * end * density * (phaseHG(mu, 0.72) * 2.5 + 0.08);
  var col = sunIrradiance() * g * 1.5;
  if (F.eyeInWater > 0.5 && F.eyeInWater < 1.5) { col *= vec3f(0.2, 0.6, 0.8); }
  return vec4f(col, 1.0);
}
