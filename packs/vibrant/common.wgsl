// Vibrant: colours of the light and the sky, shared by the world's shading and the passes. Everything is lit in
// linear colour (the game's colours to the power 2.2) and turned back for the screen in final.wgsl.

fn toLinear(c: vec3f) -> vec3f { return pow(max(c, vec3f(0.0)), vec3f(2.2)); }

/** Sunlight: deep orange near the horizon, warm white high up; moonlight cool and faint. */
fn sunColor() -> vec3f {
  if (F.sunDir.y > 0.0) {
    let h = F.sunDir.y;
    return mix(vec3f(1.0, 0.45, 0.16), vec3f(1.05, 0.95, 0.82), smoothstep(0.0, 0.45, h)) * mix(1.0, 0.35, F.rain);
  }
  return vec3f(0.42, 0.55, 0.9) * 0.6 * mix(1.0, 0.4, F.rain);
}

/** Light from the open sky (falls on everything the sky light reaches). */
fn skyAmbient() -> vec3f {
  // the sky's colour, but not all of its blue: shade outdoors is cool, not blue
  let sky = toLinear(F.skyColor);
  let day = mix(vec3f(luma(sky)), sky, 0.45) * 0.8 + vec3f(0.07, 0.075, 0.085);
  let night = vec3f(0.02, 0.026, 0.045);
  return mix(night, day, F.daylight) * mix(1.0, 0.7, F.rain);
}

fn packSky(d: vec3f) -> vec3f {
  var c = toLinear(vanillaSky(d));
  c = max(mix(vec3f(luma(c)), c, 1.25), vec3f(0.0));
  // a deeper blue overhead, the light gathered around the sun
  let up = max(d.y, 0.0);
  c *= mix(vec3f(1.0), vec3f(0.75, 0.9, 1.25), up * F.daylight);
  let sd = max(dot(d, F.sunDir), 0.0);
  c += sunColor() * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.5) * F.daylight * (1.0 - F.rain * 0.8) * step(-0.1, d.y);
  let md = max(dot(d, F.moonDir), 0.0);
  c += vec3f(0.3, 0.4, 0.7) * pow(md, 24.0) * 0.08 * (1.0 - F.daylight);
  c += vec3f(vanillaStars(d) * 0.6);
  return c;
}
