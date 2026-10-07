// Iteration: temporal anti-aliasing. Each frame the view shifts by a fraction of a pixel; this blends the frame
// with the last ones (found where they were, kept within this frame's neighbourhood so moving things don't smear).
fn toYCoCg(c: vec3f) -> vec3f { return vec3f(c.r * 0.25 + c.g * 0.5 + c.b * 0.25, c.r * 0.5 - c.b * 0.5, -c.r * 0.25 + c.g * 0.5 - c.b * 0.25); }
fn fromYCoCg(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
fn tm(c: vec3f) -> vec3f { return c / (1.0 + luma(c)); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - luma(c), 1e-3); }

@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  let size = vec2i(F.screen.xy);
  let px = vec2i(i.pos.xy);
  let cur = textureLoad(compositeTex, px, 0);
  var lo = vec3f(1e9);
  var hi = vec3f(-1e9);
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let c = toYCoCg(tm(textureLoad(compositeTex, clamp(px + vec2i(x, y), vec2i(0), size - 1), 0).rgb));
    lo = min(lo, c); hi = max(hi, c);
  } }
  // where this pixel was last frame
  let d = sceneDepth(i.uv);
  let uv0 = i.uv - vec2f(F.jitter.x, -F.jitter.y) * 0.5;
  var p = fromScreen(uv0, d);
  if (d < 0.99999) { p += F.camDelta; }
  let pc = F.prevViewProj * vec4f(p, 1.0);
  let prev = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
  var hist = textureSampleLevel(taaPrevTex, linearSamp, prev, 0.0).rgb;
  let offscreen = any(prev < vec2f(0.0)) || any(prev > vec2f(1.0)) || pc.w <= 0.0;
  if (offscreen || all(hist == vec3f(0.0))) { return cur; }
  hist = itm(fromYCoCg(clamp(toYCoCg(tm(hist)), lo, hi)));
  let moved = length((prev - i.uv) * F.screen.xy);
  let k = mix(0.1, 0.35, clamp(moved / 8.0, 0.0, 1.0));
  return vec4f(mix(hist, cur.rgb, k), cur.a);
}
