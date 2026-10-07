// Iteration: half the size again, smoothed (13 bilinear taps, the usual bloom downsample). Reads its one input.
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(input0, linearSamp, uv, 0.0).rgb; }
@fragment fn fs(i: PassIn) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(input0));
  let u = i.uv;
  let corners = tap(u + t * vec2f(-2.0, -2.0)) + tap(u + t * vec2f(2.0, -2.0)) + tap(u + t * vec2f(-2.0, 2.0)) + tap(u + t * vec2f(2.0, 2.0));
  let sides = tap(u + t * vec2f(0.0, -2.0)) + tap(u + t * vec2f(-2.0, 0.0)) + tap(u + t * vec2f(2.0, 0.0)) + tap(u + t * vec2f(0.0, 2.0));
  let inner = tap(u + t * vec2f(-1.0, -1.0)) + tap(u + t * vec2f(1.0, -1.0)) + tap(u + t * vec2f(-1.0, 1.0)) + tap(u + t * vec2f(1.0, 1.0));
  let o = tap(u) * 0.125 + corners * 0.03125 + sides * 0.0625 + inner * 0.125;
  return vec4f(o, 1.0);
}
