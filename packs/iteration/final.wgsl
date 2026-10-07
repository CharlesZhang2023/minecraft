// Iteration: exposure that follows the light of the day, bloom, a filmic curve and a little grain.
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }

@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  var c = textureSampleLevel(taaTex, linearSamp, i.uv, 0.0).rgb;
  if (BLOOM) {
    c += (textureSampleLevel(bloom1Tex, linearSamp, i.uv, 0.0).rgb * 0.5 + textureSampleLevel(bloom2Tex, linearSamp, i.uv, 0.0).rgb * 0.3 + textureSampleLevel(bloom3Tex, linearSamp, i.uv, 0.0).rgb * 0.3) * 0.35;
  }
  // eyes adjusting: dark nights and caves are brought up some (not all the way)
  var light = luma(sunIrradiance() + skyIrradiance());
  if (F.dimension > 0.5) { light = 0.6; }
  let exposure = EXPOSURE * 1.15 / (0.35 + 0.85 * pow(light, 0.6));
  c = aces(c * exposure);
  c = pow(c, vec3f(1.0 / 2.2));
  c = mix(vec3f(luma(c)), c, SATURATION);
  let d = i.uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.3;
  c += (noiseHash12(i.pos.xy + F.frame * 17.0) - 0.5) * 0.012;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
