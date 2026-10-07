// Vibrant: the bright parts of the picture (glowing blocks, the sun on water), for bloom.
@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  let t = F.screen.zw;
  var c = vec3f(0.0);
  for (var y = -1; y <= 1; y += 2) { for (var x = -1; x <= 1; x += 2) {
    c += textureSampleLevel(sceneTex, linearSamp, i.uv + vec2f(f32(x), f32(y)) * t, 0.0).rgb;
  } }
  c *= 0.25;
  let l = luma(c);
  return vec4f(c * smoothstep(0.55, 1.6, l) / max(l, 1e-3) * min(l, 12.0), 1.0);
}
