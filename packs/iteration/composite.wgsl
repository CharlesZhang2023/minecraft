// Iteration: the world with its ambient occlusion, the clouds in front of what's behind them, and the light shafts.
@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  let s = textureSampleLevel(sceneTex, nearestSamp, i.uv, 0.0);
  var c = s.rgb;
  if (SSAO && s.a > 0.5) {
    // a small blur of the half-size ambient occlusion
    let px = F.screen.zw * 2.0;
    var ao = 0.0;
    for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) { ao += textureSampleLevel(ssaoTex, linearSamp, i.uv + vec2f(f32(x), f32(y)) * px, 0.0).r; } }
    c *= ao / 9.0;
  }
  if (CLOUDS && F.dimension < 0.5) {
    let cl = textureSampleLevel(cloudsTex, linearSamp, i.uv, 0.0);
    c = c * cl.a + cl.rgb;
  }
  if (VOLUMETRIC_LIGHT) { c += textureSampleLevel(shaftsTex, linearSamp, i.uv, 0.0).rgb; }
  return vec4f(c, s.a);
}
