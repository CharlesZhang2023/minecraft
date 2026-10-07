// Iteration: ambient occlusion. Points around each surface (in the hemisphere over it) that are behind something
// on screen darken it a little: corners, crevices, under leaves.
fn viewPos(uv: vec2f) -> vec3f { return fromScreen(uv, sceneDepth(uv)); }

@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  let d = sceneDepth(i.uv);
  if (d >= 0.99999 || textureSampleLevel(sceneTex, nearestSamp, i.uv, 0.0).a < 0.5) { return vec4f(1.0); }
  let p = fromScreen(i.uv, d);
  let dist = length(p);
  if (dist < 1.2 || dist > 96.0) { return vec4f(1.0); }
  let px = 2.0 * F.screen.zw;
  let n0 = cross(viewPos(i.uv + vec2f(px.x, 0.0)) - p, viewPos(i.uv + vec2f(0.0, px.y)) - p);
  var n = normalize(n0);
  if (dot(n, p) > 0.0) { n = -n; }
  // a tangent frame turned by noise per pixel
  let a = noiseIGN(i.pos.xy) * 6.2831853;
  var t = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let b = cross(n, t);
  t = t * cos(a) + b * sin(a);
  let b2 = cross(n, t);
  let R = 0.55;
  var occ = 0.0;
  for (var k = 0; k < 8; k++) {
    let fk = f32(k);
    let ang = fk * 2.399963;
    let rr = (fk + 0.5) / 8.0;
    let h = sqrt(1.0 - rr);
    let dir = t * cos(ang) * sqrt(rr) + b2 * sin(ang) * sqrt(rr) + n * h;
    let q = p + dir * R * (0.3 + 0.7 * rr);
    let sq = toScreen(q);
    if (any(sq.xy < vec2f(0.0)) || any(sq.xy > vec2f(1.0))) { continue; }
    let sd = sceneDepth(sq.xy);
    let diff = linearDepth(sq.z) - linearDepth(sd);
    if (diff > 0.02 && diff < R * 2.0) { occ += 1.0 - smoothstep(R, R * 2.0, diff); }
  }
  return vec4f(vec3f(1.0 - occ / 8.0 * 0.75), 1.0);
}
