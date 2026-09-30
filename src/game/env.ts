import type { EnvState } from '../render/renderer';
import { clamp } from '../math';

/** Minecraft's celestial angle from world time (0 = sunrise). */
export function celestialAngle(time: number): number {
  const t = (time % 24000) / 24000;
  let f = t - 0.25;
  if (f < 0) f += 1;
  if (f > 1) f -= 1;
  const f2 = f;
  f = 1 - (Math.cos(f * Math.PI) + 1) / 2;
  return f2 + (f - f2) / 3;
}

export interface EnvInput {
  time: number;
  renderDistance: number;
  underwater: boolean;
  inLava: boolean;
  blind: number;
  rain: number;
  thunder: number;
  cameraY: number;
  gamma: number;
  clouds: boolean;
  skyTemp: number; // biome temperature-ish for sky tint
  flicker: number;
  ticks: number;
}

export function computeEnv(i: EnvInput): EnvState {
  const angle = celestialAngle(i.time);
  const c = Math.cos(angle * Math.PI * 2);
  let bright = clamp(c * 2 + 0.5, 0, 1);
  bright *= 1 - i.rain * 5 / 16;
  bright *= 1 - i.thunder * 5 / 16;

  // sky colour (plains-like temperature)
  const temp = clamp(i.skyTemp / 3, -1, 1);
  const hue = 0.62222224 - temp * 0.05, sat = 0.5 + temp * 0.1;
  const base = hsbToRgb(hue, sat, 1);
  const rainGray = (x: number) => x * (1 - i.rain * 0.75) + (x * 0.3 + 0.59 * x + 0.11 * x) * 0.6 * i.rain * 0.75;
  const sky: [number, number, number] = [rainGray(base[0] * bright), rainGray(base[1] * bright), rainGray(base[2] * bright)];

  // fog colour
  let fog: [number, number, number] = [0.7529412 * (bright * 0.94 + 0.06), 0.84705883 * (bright * 0.94 + 0.06), 1.0 * (bright * 0.91 + 0.09)];
  // blend fog toward sky colour depending on render distance
  const rd = clamp(i.renderDistance, 2, 32);
  const m = 1 - Math.pow(0.25 + (0.75 * rd) / 32, 0.25);
  fog = [fog[0] + (sky[0] - fog[0]) * m, fog[1] + (sky[1] - fog[1]) * m, fog[2] + (sky[2] - fog[2]) * m];
  if (i.rain > 0) {
    const r = 1 - i.rain * 0.5;
    fog = [fog[0] * r, fog[1] * r, fog[2] * (1 - i.rain * 0.4)];
  }

  // sunrise / sunset
  let sunrise: [number, number, number, number] = [0, 0, 0, 0];
  const band = 0.4;
  if (c >= -band && c <= band) {
    const f4 = (c / band) * 0.5 + 0.5;
    let f5 = 1 - (1 - Math.sin(f4 * Math.PI)) * 0.99;
    f5 *= f5;
    sunrise = [f4 * 0.3 + 0.7, f4 * f4 * 0.7 + 0.2, f4 * f4 * 0.0 + 0.2, f5 * (1 - i.rain)];
    // horizon fog picks up the glow when looking toward the sun (approximated globally)
    fog = [fog[0] + (sunrise[0] - fog[0]) * sunrise[3] * 0.25, fog[1] + (sunrise[1] - fog[1]) * sunrise[3] * 0.25, fog[2] + (sunrise[2] - fog[2]) * sunrise[3] * 0.25];
  }

  // stars
  let stars = clamp(1 - (c * 2 + 0.25), 0, 1);
  stars = stars * stars * 0.5 * (1 - i.rain);

  // lightmap: sun brightness
  let sunB = clamp(1 - (c * 2 + 0.2), 0, 1);
  sunB = 1 - sunB;
  sunB *= 1 - i.rain * 5 / 16;
  sunB = sunB * 0.8 + 0.2;
  const skyLightCol: [number, number, number] = [1, 1, 1];

  const R = i.renderDistance * 16;
  let fogStart = R * 0.75, fogEnd = R;
  let fogCol = fog;
  // below y ~ 32 the void colour darkens the fog
  // vanilla only shows the dark lower sky when the eye is below the horizon (sea level)
  const vt = clamp((63 - i.cameraY) / 8, 0, 1);
  const voidCol: [number, number, number] = [fog[0] * (1 - vt * 0.8), fog[1] * (1 - vt * 0.8), fog[2] * (1 - vt * 0.4)];
  if (i.underwater) {
    fogCol = [0.02 + 0.08 * bright, 0.08 + 0.2 * bright, 0.25 + 0.4 * bright];
    fogStart = -8;
    fogEnd = 48;
  }
  if (i.inLava) {
    fogCol = [0.6, 0.1, 0.0];
    fogStart = 0;
    fogEnd = 2;
  }
  if (i.blind > 0) {
    fogCol = [0, 0, 0];
    fogStart = 0;
    fogEnd = 5;
  }
  if (i.cameraY < 16 && !i.underwater && !i.inLava) {
    const d = clamp(i.cameraY / 16, 0, 1);
    fogCol = [fogCol[0] * d, fogCol[1] * d, fogCol[2] * d];
  }

  const cloudB = clamp(c * 2 + 0.5, 0, 1);
  const cloudColor: [number, number, number] = [
    (cloudB * 0.9 + 0.1) * (1 - i.rain * 0.4),
    (cloudB * 0.9 + 0.1) * (1 - i.rain * 0.4),
    (cloudB * 0.85 + 0.15) * (1 - i.rain * 0.4),
  ];
  return {
    skyColor: i.underwater ? fogCol : sky,
    fogColor: fogCol,
    voidColor: voidCol,
    sunrise: i.underwater ? [0, 0, 0, 0] : sunrise,
    celestial: angle,
    sunBright: sunB,
    skyLightCol,
    stars: i.underwater ? 0 : stars,
    fogStart,
    fogEnd,
    gamma: i.gamma,
    flicker: i.flicker,
    cloudColor,
    clouds: i.clouds,
    cloudOffset: i.ticks * 0.03,
    moonPhase: Math.floor(i.time / 24000) % 8,
    rain: i.rain,
    ambient: 0,
    ambientCol: [0, 0, 0],
  };
}

/** The Nether: no sky, dense reddish fog, dim ambient light. */
export function netherEnv(renderDistance: number, gamma: number, flicker: number, underLava: boolean): EnvState {
  const fog: [number, number, number] = underLava ? [0.6, 0.1, 0] : [0.2, 0.03, 0.03];
  const far = renderDistance * 16;
  return {
    skyColor: fog, fogColor: fog, voidColor: fog, sunrise: [0, 0, 0, 0], celestial: 0.5, sunBright: 1, skyLightCol: [1, 1, 1], stars: 0,
    fogStart: underLava ? 0 : far * 0.05, fogEnd: underLava ? 2 : Math.min(far, 192) * 0.5, gamma, flicker, cloudColor: [0, 0, 0], clouds: false,
    cloudOffset: 0, moonPhase: 0, rain: 0, ambient: 0.1, ambientCol: [0.05, 0.02, 0.01], noSky: true,
  };
}

export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/** Sky darkening amount used for mob spawning / daylight checks (0..11). */
export function skyDarken(time: number, rain = 0): number {
  const c = Math.cos(celestialAngle(time) * Math.PI * 2);
  let f = 1 - (c * 2 + 0.5);
  f = clamp(f, 0, 1);
  f = 1 - f;
  f *= 1 - rain * 5 / 16;
  f = 1 - f;
  return Math.floor(f * 11);
}
