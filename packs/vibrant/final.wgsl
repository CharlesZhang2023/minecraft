// Vibrant: the picture. The world plus bloom and god rays, a filmic curve, back from linear colour, more vibrant
// colours and a soft vignette.
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }

@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  var c = textureSampleLevel(sceneTex, linearSamp, i.uv, 0.0).rgb;
  if (BLOOM) {
    let b = textureSampleLevel(bloom1Tex, linearSamp, i.uv, 0.0).rgb * 0.5 + textureSampleLevel(bloom2Tex, linearSamp, i.uv, 0.0).rgb * 0.3 + textureSampleLevel(bloom3Tex, linearSamp, i.uv, 0.0).rgb * 0.35;
    c += b * BLOOM_STRENGTH * 0.6;
  }
  if (GODRAYS && F.dimension < 0.5) {
    let g = textureSampleLevel(godraysTex, linearSamp, i.uv, 0.0).r;
    let under = select(1.0, 0.4, F.eyeInWater > 0.5);
    c += sunColor() * g * GODRAY_STRENGTH * F.lightStrength * (1.0 - F.rain * 0.7) * 0.35 * under;
  }
  c *= EXPOSURE * 1.1;
  c = aces(c);
  c = pow(c, vec3f(1.0 / 2.2));
  // more vibrant: saturation, gently more for colours that are already a little saturated
  let l = luma(c);
  let sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3f(l), c, SATURATION - sat * 0.3 * (SATURATION - 1.0));
  if (VIGNETTE) {
    let d = i.uv - 0.5;
    c *= 1.0 - dot(d, d) * 0.45;
  }
  // a hint of noise against banding
  c += (noiseIGN(i.pos.xy) - 0.5) / 255.0;
  return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0);
}
