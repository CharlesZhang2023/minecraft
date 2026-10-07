// Vibrant: god rays. From each pixel, a few steps toward the sun on screen: the more of them see open sky, the more
// light streams through. (Sky pixels are the ones the world left at alpha 0.)
@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  let c = F.viewProj * vec4f(F.lightDir * 1000.0, 1.0);
  if (c.w <= 0.0 || F.dimension > 0.5 || F.lightStrength <= 0.0) { return vec4f(0.0); }
  let sun = vec2f(c.x / c.w * 0.5 + 0.5, 0.5 - c.y / c.w * 0.5);
  let STEPS = 28;
  let delta = (i.uv - sun) / f32(STEPS) * 0.9;
  var uv = i.uv - delta * noiseIGN(i.pos.xy);
  var acc = 0.0;
  var w = 1.0;
  for (var k = 0; k < STEPS; k++) {
    uv -= delta;
    if (all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0))) {
      acc += select(0.0, w, textureSampleLevel(sceneTex, nearestSamp, uv, 0.0).a < 0.5);
    }
    w *= 0.965;
  }
  // strongest looking toward the light, fading off-screen
  let toward = clamp(1.0 - length((sun - 0.5) * vec2f(F.screen.x * F.screen.w, 1.0)) * 0.9, 0.0, 1.0);
  return vec4f(vec3f(acc / f32(STEPS) * toward), 1.0);
}
