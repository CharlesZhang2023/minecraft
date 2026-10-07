// Procedurally synthesised sound effects and ambient music (WebAudio).
import { Random } from '../noise';
import { moreSounds } from './audio2';

const SR = 22050;
type Buf = Float32Array;

function noise(n: number, r: Random): Buf {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = r.next() * 2 - 1;
  return b;
}
function lowpass(b: Buf, cutoff: number): Buf {
  const rc = 1 / (2 * Math.PI * cutoff), dt = 1 / SR, a = dt / (rc + dt);
  const o = new Float32Array(b.length);
  let y = 0;
  for (let i = 0; i < b.length; i++) { y += a * (b[i] - y); o[i] = y; }
  return o;
}
function highpass(b: Buf, cutoff: number): Buf {
  const rc = 1 / (2 * Math.PI * cutoff), dt = 1 / SR, a = rc / (rc + dt);
  const o = new Float32Array(b.length);
  let y = 0, px = 0;
  for (let i = 0; i < b.length; i++) { y = a * (y + b[i] - px); px = b[i]; o[i] = y; }
  return o;
}
function bandpass(b: Buf, lo: number, hi: number) { return lowpass(highpass(b, lo), hi); }
function env(b: Buf, attack: number, decay: number, curve = 2): Buf {
  const n = b.length, a = Math.max(1, Math.floor(attack * SR));
  for (let i = 0; i < n; i++) {
    const e = i < a ? i / a : Math.pow(Math.max(0, 1 - (i - a) / Math.max(1, decay * SR)), curve);
    b[i] *= e;
  }
  return b;
}
function normalize(b: Buf, peak = 0.9): Buf {
  let m = 0;
  for (const v of b) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
}
function tone(n: number, f0: number, f1: number, type: 'sine' | 'saw' | 'square' | 'tri', vib = 0, vibF = 5): Buf {
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f0 * Math.pow(f1 / f0, t) * (1 + Math.sin((i / SR) * vibF * 6.283) * vib);
    ph += f / SR;
    const p = ph % 1;
    b[i] = type === 'sine' ? Math.sin(p * 6.283) : type === 'saw' ? p * 2 - 1 : type === 'square' ? (p < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(p - 0.5);
  }
  return b;
}
function mixInto(a: Buf, b: Buf, gain = 1, offset = 0) {
  for (let i = 0; i < b.length && i + offset < a.length; i++) a[i + offset] += b[i] * gain;
  return a;
}
function grains(n: number, r: Random, count: number, lo: number, hi: number, grainLen: number): Buf {
  const out = new Float32Array(n);
  for (let k = 0; k < count; k++) {
    const len = Math.floor(grainLen * SR * (0.5 + r.next()));
    const g = env(bandpass(noise(len, r), lo, hi), 0.001, len / SR, 3);
    mixInto(out, g, 0.5 + r.next() * 0.5, Math.floor(r.next() * (n - len)));
  }
  return out;
}

type Gen = (r: Random) => Buf;
/** Mods: add a synthesised sound (mono samples at 22050 Hz) by name. */
export function registerSound(name: string, gen: (r: Random) => Float32Array) {
  GENS[name] = gen;
}
export const SAMPLE_RATE = SR;
export const synth = { noise, lowpass, highpass, bandpass, env, normalize, tone, mixInto } as const;

const GENS: Record<string, Gen> = {
  'dig.stone': (r) => normalize(env(bandpass(noise(SR * 0.25, r), 800, 3500), 0.002, 0.2, 3)),
  'dig.wood': (r) => {
    const n = SR * 0.25;
    const b = env(bandpass(noise(n, r), 200, 1200), 0.002, 0.18, 3);
    mixInto(b, env(tone(n, 180 + r.next() * 60, 120, 'tri'), 0.002, 0.12, 3), 0.6);
    return normalize(b);
  },
  'dig.grass': (r) => normalize(env(grains(SR * 0.3, r, 30, 1500, 6000, 0.02), 0.01, 0.28, 1.5)),
  'dig.gravel': (r) => normalize(env(grains(SR * 0.3, r, 40, 400, 3000, 0.015), 0.005, 0.28, 1.5)),
  'dig.sand': (r) => normalize(env(grains(SR * 0.3, r, 60, 2000, 8000, 0.01), 0.02, 0.28, 1.2)),
  'dig.snow': (r) => normalize(env(grains(SR * 0.3, r, 50, 1000, 5000, 0.012), 0.02, 0.28, 1.5)),
  'dig.cloth': (r) => normalize(env(lowpass(noise(SR * 0.25, r), 700), 0.02, 0.2, 2)),
  'dig.glass': (r) => {
    const n = SR * 0.6;
    const b = env(highpass(noise(n, r), 3000), 0.001, 0.15, 3);
    for (let k = 0; k < 6; k++) mixInto(b, env(tone(Math.floor(SR * 0.3), 2000 + r.next() * 3000, 1800 + r.next() * 2000, 'sine'), 0.001, 0.25, 4), 0.25, Math.floor(r.next() * SR * 0.15));
    return normalize(b);
  },
  'dig.metal': (r) => {
    const n = SR * 0.4;
    const b = env(bandpass(noise(n, r), 1500, 6000), 0.001, 0.1, 3);
    mixInto(b, env(tone(n, 1200 + r.next() * 300, 1100, 'sine'), 0.001, 0.35, 3), 0.5);
    mixInto(b, env(tone(n, 2650, 2600, 'sine'), 0.001, 0.3, 3), 0.3);
    return normalize(b);
  },
  pop: (r) => normalize(env(tone(SR * 0.08, 900 + r.next() * 300, 1600, 'sine'), 0.002, 0.07, 2), 0.5),
  click: () => normalize(env(tone(SR * 0.04, 1800, 900, 'square'), 0.001, 0.03, 3), 0.35),
  hurt: (r) => {
    const n = SR * 0.25;
    const b = env(tone(n, 260, 130, 'saw', 0.02, 30), 0.005, 0.22, 2);
    mixInto(b, env(bandpass(noise(n, r), 300, 1500), 0.002, 0.15, 3), 0.4);
    return normalize(lowpass(b, 1400));
  },
  explode: (r) => {
    const n = SR * 2.2;
    const b = env(lowpass(noise(n, r), 400), 0.005, 2.0, 3);
    mixInto(b, env(lowpass(noise(n, r), 120), 0.01, 1.4, 2), 1.5);
    mixInto(b, env(tone(n, 60, 25, 'sine'), 0.005, 1.0, 2), 0.8);
    return normalize(b, 1);
  },
  fizz: (r) => normalize(env(highpass(noise(SR * 0.6, r), 2500), 0.01, 0.55, 1.5), 0.5),
  splash: (r) => normalize(env(grains(SR * 0.6, r, 80, 500, 5000, 0.02), 0.01, 0.5, 2)),
  swim: (r) => normalize(env(grains(SR * 0.35, r, 30, 300, 2500, 0.02), 0.05, 0.3, 2), 0.5),
  bow: (r) => {
    const n = SR * 0.35;
    const b = env(tone(n, 320, 180, 'tri'), 0.002, 0.2, 3);
    mixInto(b, env(bandpass(noise(n, r), 600, 3000), 0.001, 0.25, 2), 0.5);
    return normalize(b);
  },
  arrowHit: (r) => normalize(env(bandpass(noise(SR * 0.15, r), 300, 2000), 0.001, 0.12, 3)),
  eat: (r) => normalize(env(grains(SR * 0.2, r, 12, 800, 4000, 0.02), 0.005, 0.18, 1.5), 0.6),
  burp: () => normalize(env(tone(SR * 0.4, 110, 80, 'saw', 0.1, 25), 0.03, 0.35, 2)),
  door: (r) => {
    const n = SR * 0.4;
    const b = env(tone(n, 300 + r.next() * 50, 200, 'saw', 0.05, 40), 0.01, 0.3, 2);
    mixInto(b, env(bandpass(noise(n, r), 150, 800), 0.001, 0.1, 3), 1);
    return normalize(lowpass(b, 1500), 0.7);
  },
  chestOpen: (r) => normalize(lowpass(env(tone(SR * 0.5, 180, 260, 'saw', 0.04, 30), 0.02, 0.45, 2), 900 + r.next() * 100), 0.6),
  chestClose: (r) => {
    const b = env(bandpass(noise(SR * 0.2, r), 100, 700), 0.001, 0.15, 3);
    return normalize(b, 0.7);
  },
  levelup: () => {
    const n = SR * 0.9;
    const b = new Float32Array(n);
    [523, 659, 784, 1046].forEach((f, i) => mixInto(b, env(tone(SR * 0.5, f, f, 'tri'), 0.005, 0.45, 2), 0.4, i * SR * 0.09));
    return normalize(b, 0.6);
  },
  orb: (r) => normalize(env(tone(SR * 0.12, 1400 + r.next() * 600, 2200, 'sine'), 0.002, 0.1, 2), 0.3),
  fuse: (r) => normalize(env(highpass(noise(SR * 1.2, r), 1800), 0.05, 1.1, 0.8), 0.6),
  fire: (r) => normalize(env(grains(SR * 0.8, r, 20, 200, 3000, 0.01), 0.1, 0.7, 1), 0.4),
  // mobs
  'zombie.say': (r) => normalize(lowpass(env(tone(SR * 0.8, 95 + r.next() * 20, 70, 'saw', 0.08, 7), 0.08, 0.7, 1.5), 600)),
  'zombie.hurt': (r) => normalize(lowpass(env(tone(SR * 0.35, 150 + r.next() * 30, 90, 'saw', 0.1, 20), 0.01, 0.3, 2), 900)),
  'zombie.death': (r) => normalize(lowpass(env(tone(SR * 1.0, 120 + r.next() * 10, 50, 'saw', 0.1, 6), 0.02, 0.95, 1.5), 700)),
  'skeleton.say': (r) => normalize(env(grains(SR * 0.4, r, 10, 1500, 5000, 0.015), 0.005, 0.35, 1.5), 0.6),
  'skeleton.hurt': (r) => normalize(env(grains(SR * 0.25, r, 14, 800, 4000, 0.015), 0.003, 0.22, 1.5), 0.7),
  'creeper.hurt': (r) => normalize(env(highpass(noise(SR * 0.3, r), 1200), 0.005, 0.25, 2), 0.6),
  'spider.say': (r) => normalize(env(bandpass(noise(SR * 0.5, r), 900, 3500), 0.02, 0.45, 1.5), 0.5),
  'pig.say': (r) => {
    const n = SR * 0.3;
    const b = env(tone(n, 260 + r.next() * 60, 200, 'square', 0.06, 35), 0.01, 0.25, 2);
    return normalize(bandpass(b, 200, 1600), 0.7);
  },
  'cow.say': (r) => {
    const n = SR * 1.1;
    const b = env(tone(n, 140 + r.next() * 20, 110, 'saw', 0.02, 5), 0.1, 0.95, 1.2);
    return normalize(bandpass(b, 90, 900), 0.8);
  },
  'sheep.say': (r) => {
    const n = SR * 0.8;
    const b = env(tone(n, 340 + r.next() * 40, 310, 'saw', 0.09, 11), 0.05, 0.7, 1.5);
    return normalize(bandpass(b, 250, 2500), 0.7);
  },
  'chicken.say': (r) => {
    const n = SR * 0.35;
    const b = new Float32Array(n);
    for (let k = 0; k < 3; k++) mixInto(b, env(tone(Math.floor(SR * 0.07), 900 + r.next() * 300, 600, 'square'), 0.002, 0.06, 2), 0.5, Math.floor(k * SR * 0.09));
    return normalize(bandpass(b, 400, 3000), 0.6);
  },
  'animal.hurt': (r) => normalize(bandpass(env(tone(SR * 0.25, 400 + r.next() * 100, 250, 'square', 0.1, 30), 0.005, 0.22, 2), 200, 2000), 0.7),
  portalTrigger: (r) => {
    const n = SR * 2.5;
    const b = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      ph += (220 + 300 * t + Math.sin(i / SR * 9) * 30) / SR;
      b[i] = Math.sin(ph * 6.283) * 0.3 * Math.sin(t * Math.PI);
    }
    mixInto(b, env(bandpass(noise(n, r), 300, 2000), 0.5, 2, 1), 0.4);
    return normalize(b, 0.6);
  },
  portalTravel: (r) => {
    const n = SR * 3;
    const b = env(bandpass(noise(n, r), 200, 1500), 0.3, 2.5, 1.2);
    mixInto(b, env(tone(n, 440, 110, 'sine', 0.05, 5), 0.3, 2.6, 1.2), 0.6);
    return normalize(b, 0.7);
  },
  'enderman.idle': (r) => normalize(bandpass(env(tone(SR * 0.8, 120 + r.next() * 40, 90, 'saw', 0.3, 13), 0.1, 0.65, 1.5), 80, 900), 0.6),
  'enderman.hurt': (r) => normalize(bandpass(env(tone(SR * 0.5, 300 + r.next() * 100, 150, 'saw', 0.3, 30), 0.01, 0.45, 2), 100, 2500), 0.7),
  'enderman.death': (r) => normalize(bandpass(env(tone(SR * 1.5, 250, 60, 'saw', 0.3, 20), 0.02, 1.4, 1.5), 80, 2000), 0.7),
  'enderman.stare': (r) => {
    const n = SR * 1.2;
    const b = env(tone(n, 600 + r.next() * 100, 900, 'saw', 0.25, 45), 0.05, 1.1, 1.2);
    mixInto(b, env(highpass(noise(n, r), 2000), 0.05, 1.1, 1.2), 0.3);
    return normalize(b, 0.6);
  },
  'enderman.teleport': (r) => {
    const n = SR * 0.5;
    const b = env(tone(n, 1400 + r.next() * 200, 250, 'sine', 0.05, 30), 0.005, 0.45, 1.5);
    mixInto(b, env(bandpass(noise(n, r), 400, 3000), 0.005, 0.3, 2), 0.4);
    return normalize(b, 0.6);
  },
  'silverfish.say': (r) => normalize(bandpass(env(tone(SR * 0.12, 3400 + r.next() * 600, 2600, 'square'), 0.002, 0.1, 2), 1500, 6000), 0.4),
  'silverfish.hit': (r) => normalize(bandpass(env(tone(SR * 0.16, 2800 + r.next() * 400, 1400, 'square'), 0.002, 0.14, 2), 1200, 5000), 0.5),
  'silverfish.kill': (r) => normalize(bandpass(env(tone(SR * 0.3, 2200, 500, 'saw'), 0.002, 0.28, 2), 600, 4000), 0.6),
  'dragon.growl': (r) => {
    const n = SR * 2.6;
    const b = env(tone(n, 110 + r.next() * 30, 55, 'saw', 0.35, 6), 0.25, 2.2, 1.4);
    mixInto(b, env(bandpass(noise(n, r), 150, 900), 0.2, 2.2, 1.5), 0.6);
    mixInto(b, env(tone(n, 260, 120, 'saw', 0.5, 9), 0.4, 1.8, 1.5), 0.25);
    return normalize(bandpass(b, 50, 1800), 0.8);
  },
  'dragon.flap': (r) => normalize(env(lowpass(noise(SR * 0.7, r), 260), 0.12, 0.55, 2), 0.7),
  'dragon.hit': (r) => {
    const n = SR * 0.7;
    const b = env(tone(n, 340 + r.next() * 60, 120, 'saw', 0.2, 18), 0.005, 0.6, 1.8);
    mixInto(b, env(bandpass(noise(n, r), 200, 2500), 0.003, 0.3, 2), 0.5);
    return normalize(bandpass(b, 80, 2800), 0.75);
  },
  'dragon.death': (r) => {
    const n = SR * 4.5;
    const b = env(tone(n, 200, 28, 'saw', 0.3, 5), 0.05, 4.2, 1.2);
    mixInto(b, env(lowpass(noise(n, r), 300), 0.4, 4, 1.2), 0.7);
    mixInto(b, env(tone(n, 600, 90, 'saw', 0.4, 11), 0.1, 3.2, 1.6), 0.3);
    return normalize(b, 0.85);
  },
  'slime.jump': (r) => normalize(lowpass(env(grains(SR * 0.25, r, 6, 100, 900, 0.04), 0.005, 0.22, 2), 800), 0.7),
  'slime.squish': (r) => normalize(lowpass(env(grains(SR * 0.35, r, 10, 80, 700, 0.05), 0.005, 0.3, 1.5), 700), 0.7),
  'wolf.say': (r) => {
    const n = SR * 0.4;
    const b = new Float32Array(n);
    for (let k = 0; k < 2; k++) mixInto(b, env(tone(Math.floor(SR * 0.12), 500 + r.next() * 150, 350, 'saw', 0.05, 20), 0.005, 0.11, 2), 0.6, Math.floor(k * SR * 0.16));
    return normalize(bandpass(b, 250, 2500), 0.6);
  },
  // horses: a whinny that rises then falls with a fast trill, snorts, hoof clops on the ground
  'horse.say': (r) => {
    const n = SR * 1.0;
    const b = new Float32Array(n);
    const f0 = 700 + r.next() * 150;
    mixInto(b, env(tone(Math.floor(SR * 0.35), f0 * 0.7, f0 * 1.25, 'saw', 0.06, 28), 0.03, 0.3, 1.2), 0.7);
    mixInto(b, env(tone(Math.floor(SR * 0.6), f0 * 1.2, f0 * 0.45, 'saw', 0.14, 24), 0.01, 0.58, 1.6), 0.8, Math.floor(SR * 0.3));
    return normalize(bandpass(b, 300, 4000), 0.6);
  },
  'horse.hurt': (r) => normalize(bandpass(env(tone(SR * 0.35, 900 + r.next() * 150, 500, 'saw', 0.12, 30), 0.005, 0.32, 2), 300, 3500), 0.6),
  'horse.angry': (r) => {
    const n = SR * 0.9;
    const b = env(bandpass(noise(n, r), 250, 1400), 0.01, 0.3, 2);
    mixInto(b, env(tone(Math.floor(SR * 0.55), 950 + r.next() * 100, 420, 'saw', 0.16, 26), 0.01, 0.5, 1.6), 0.9, Math.floor(SR * 0.3));
    return normalize(bandpass(b, 200, 4000), 0.65);
  },
  'horse.breathe': (r) => normalize(env(bandpass(noise(SR * 0.5, r), 200, 1200), 0.1, 0.4, 1.5), 0.35),
  'horse.step': (r) => {
    const b = new Float32Array(SR * 0.16);
    mixInto(b, env(bandpass(noise(SR * 0.05, r), 300, 2200), 0.001, 0.05, 3), 1);
    mixInto(b, env(tone(SR * 0.05, 260 + r.next() * 60, 180, 'tri'), 0.001, 0.05, 3), 0.6);
    return normalize(b, 0.5);
  },
  'horse.gallop': (r) => {
    const b = new Float32Array(SR * 0.3);
    for (let k = 0; k < 3; k++) mixInto(b, env(bandpass(noise(SR * 0.05, r), 250, 2000), 0.001, 0.05, 3), 0.7 + r.next() * 0.3, Math.floor((k * 0.07 + r.next() * 0.02) * SR));
    return normalize(b, 0.55);
  },
  'horse.jump': (r) => normalize(env(bandpass(noise(SR * 0.4, r), 150, 1100), 0.01, 0.35, 1.5), 0.5),
  'horse.land': (r) => normalize(env(lowpass(noise(SR * 0.3, r), 500), 0.002, 0.25, 2.5), 0.7),
  'horse.saddle': (r) => normalize(env(bandpass(noise(SR * 0.35, r), 400, 2400), 0.02, 0.3, 1.5), 0.5),
  'horse.armor': (r) => {
    const b = new Float32Array(SR * 0.5);
    for (let k = 0; k < 4; k++) mixInto(b, env(tone(SR * 0.2, 1800 + r.next() * 1200, 1500, 'square'), 0.001, 0.18, 3), 0.4, Math.floor(r.next() * SR * 0.25));
    return normalize(bandpass(b, 800, 6000), 0.45);
  },
  'horse.eat': (r) => normalize(env(grains(SR * 0.4, r, 14, 300, 2500, 0.03), 0.01, 0.38, 1.4), 0.5),
  // donkey: a two-part hee-haw
  'donkey.say': (r) => {
    const b = new Float32Array(SR * 1.2);
    for (let k = 0; k < 2; k++) {
      mixInto(b, env(tone(Math.floor(SR * 0.28), 900 + r.next() * 80, 1100, 'saw', 0.05, 30), 0.02, 0.25, 1.4), 0.6, Math.floor(k * SR * 0.6));
      mixInto(b, env(tone(Math.floor(SR * 0.3), 260 + r.next() * 30, 200, 'saw', 0.04, 20), 0.03, 0.27, 1.4), 0.9, Math.floor((k * 0.6 + 0.28) * SR));
    }
    return normalize(bandpass(b, 150, 3500), 0.6);
  },
  'minecart.roll': (r) => normalize(env(bandpass(noise(SR * 1.0, r), 150, 1500), 0.2, 0.8, 1), 0.3),
  'wolf.hurt': (r) => normalize(bandpass(env(tone(SR * 0.3, 900 + r.next() * 100, 600, 'saw', 0.1, 25), 0.005, 0.28, 2), 300, 3000), 0.6),
  'bat.idle': (r) => {
    const n = SR * 0.25;
    const b = new Float32Array(n);
    for (let k = 0; k < 3; k++) mixInto(b, env(tone(Math.floor(SR * 0.04), 3000 + r.next() * 1500, 2500, 'sine'), 0.002, 0.035, 2), 0.5, Math.floor(k * SR * 0.07));
    return normalize(b, 0.4);
  },
  cave: (r) => {
    const n = SR * 5;
    const b = env(lowpass(noise(n, r), 180), 1.5, 3.5, 1);
    mixInto(b, env(tone(n, 55 + r.next() * 30, 40 + r.next() * 40, 'sine', 0.03, 0.5), 1.2, 3.8, 1), 0.7);
    const n2 = Math.floor(SR * 2.5);
    mixInto(b, env(tone(n2, 300 + r.next() * 400, 150 + r.next() * 200, 'sine', 0.1, 3), 0.8, 1.6, 1.5), 0.25, Math.floor(SR * (0.5 + r.next() * 2)));
    return normalize(b, 0.7);
  },
  'villager.idle': (r) => {
    const n = SR * 0.45;
    const b = env(tone(n, 180 + r.next() * 40, 140 + r.next() * 60, 'saw', 0.06, 9), 0.03, 0.4, 1.5);
    return normalize(bandpass(b, 150, 1400), 0.6);
  },
  'villager.trade': (r) => {
    const n = SR * 0.5;
    const b = env(tone(n, 170 + r.next() * 20, 230, 'saw', 0.05, 8), 0.02, 0.45, 1.5);
    return normalize(bandpass(b, 150, 1500), 0.6);
  },
  'villager.yes': (r) => normalize(bandpass(env(tone(SR * 0.35, 220 + r.next() * 20, 300, 'saw', 0.04, 8), 0.01, 0.3, 1.5), 150, 1500), 0.6),
  'villager.no': (r) => normalize(bandpass(env(tone(SR * 0.4, 260 + r.next() * 20, 150, 'saw', 0.04, 8), 0.01, 0.35, 1.5), 150, 1500), 0.6),
  'villager.hurt': (r) => normalize(bandpass(env(tone(SR * 0.3, 300 + r.next() * 40, 200, 'saw', 0.1, 20), 0.005, 0.25, 2), 150, 2000), 0.7),
  'ghast.moan': (r) => normalize(env(tone(SR * 2.2, 520 + r.next() * 200, 380, 'sine', 0.08, 5.5), 0.3, 1.8, 1.2), 0.5),
  'ghast.scream': (r) => {
    const b = env(tone(SR * 0.9, 900 + r.next() * 200, 600, 'saw', 0.1, 12), 0.02, 0.8, 1.5);
    return normalize(bandpass(b, 400, 4000), 0.6);
  },
  'ghast.death': (r) => normalize(bandpass(env(tone(SR * 1.8, 800 + r.next() * 100, 250, 'saw', 0.12, 8), 0.02, 1.7, 1.3), 300, 3000), 0.6),
  'ghast.charge': (r) => normalize(env(tone(SR * 0.6, 500 + r.next() * 100, 700, 'sine', 0.2, 18), 0.05, 0.5, 1.5), 0.4),
  'ghast.fireball': (r) => {
    const n = SR * 0.8;
    const b = env(lowpass(noise(n, r), 900), 0.01, 0.7, 2);
    mixInto(b, env(tone(n, 180, 60, 'saw'), 0.01, 0.5, 2), 0.5);
    return normalize(b, 0.8);
  },
  'pigman.say': (r) => normalize(lowpass(env(tone(SR * 0.6, 150 + r.next() * 30, 110, 'square', 0.08, 25), 0.03, 0.55, 1.5), 700), 0.7),
  'pigman.hurt': (r) => normalize(lowpass(env(tone(SR * 0.35, 260 + r.next() * 40, 160, 'square', 0.1, 30), 0.01, 0.3, 2), 1000), 0.7),
  'pigman.angry': (r) => normalize(lowpass(env(tone(SR * 0.7, 320 + r.next() * 40, 180, 'saw', 0.15, 35), 0.01, 0.65, 1.5), 1500), 0.8),
  // redstone devices, brewing, anvils
  'piston.out': (r) => {
    const n = SR * 0.35;
    const b = env(bandpass(noise(n, r), 150, 1800), 0.002, 0.25, 2.5);
    mixInto(b, env(tone(n, 220, 90, 'saw'), 0.002, 0.2, 3), 0.6);
    return normalize(lowpass(b, 2200), 0.8);
  },
  'piston.in': (r) => {
    const n = SR * 0.3;
    const b = env(bandpass(noise(n, r), 120, 1400), 0.002, 0.22, 2.5);
    mixInto(b, env(tone(n, 160, 260, 'saw'), 0.002, 0.18, 3), 0.5);
    return normalize(lowpass(b, 1800), 0.7);
  },
  'dig.slime': (r) => {
    const n = SR * 0.3;
    const b = env(lowpass(grains(n, r, 10, 150, 900, 0.03), 900), 0.01, 0.25, 2);
    mixInto(b, env(tone(n, 180 + r.next() * 60, 90, 'sine', 0.2, 18), 0.01, 0.25, 2), 0.8);
    return normalize(b, 0.7);
  },
  drink: (r) => normalize(env(grains(SR * 0.25, r, 6, 200, 1200, 0.04), 0.01, 0.2, 1.5), 0.6),
  'glass.break': (r) => {
    const n = SR * 0.6;
    const b = env(highpass(grains(n, r, 60, 2000, 9000, 0.01), 1500), 0.001, 0.5, 2);
    mixInto(b, env(bandpass(noise(n, r), 2500, 8000), 0.001, 0.2, 3), 0.6);
    return normalize(b, 0.8);
  },
  brew: (r) => normalize(env(grains(SR * 1.2, r, 25, 150, 1200, 0.05), 0.2, 0.9, 1.2), 0.5),
  'anvil.use': (r) => {
    const n = SR * 0.6;
    const b = env(tone(n, 1150 + r.next() * 40, 1100, 'sine'), 0.001, 0.55, 3);
    mixInto(b, env(tone(n, 2890, 2880, 'sine'), 0.001, 0.35, 3), 0.5);
    mixInto(b, env(bandpass(noise(n, r), 1500, 6000), 0.001, 0.05, 3), 0.8);
    return normalize(b, 0.7);
  },
  'anvil.land': (r) => {
    const n = SR * 0.8;
    const b = env(tone(n, 700, 680, 'sine'), 0.001, 0.7, 3);
    mixInto(b, env(lowpass(noise(n, r), 800), 0.001, 0.2, 3), 1.2);
    return normalize(b, 0.9);
  },
  'blaze.breathe': (r) => normalize(env(lowpass(noise(SR * 1.2, r), 700), 0.3, 0.9, 1.2), 0.5),
  'blaze.hurt': (r) => normalize(env(bandpass(tone(SR * 0.35, 380 + r.next() * 60, 240, 'saw', 0.2, 40), 200, 3000), 0.005, 0.3, 2), 0.7),
  'blaze.death': (r) => normalize(env(bandpass(tone(SR * 1.2, 420, 90, 'saw', 0.2, 30), 150, 2500), 0.005, 1.1, 1.5), 0.7),
  'blaze.shoot': (r) => {
    const n = SR * 0.4;
    const b = env(lowpass(noise(n, r), 1800), 0.005, 0.35, 2);
    mixInto(b, env(tone(n, 300, 120, 'saw'), 0.005, 0.3, 2), 0.4);
    return normalize(b, 0.6);
  },
  thunder: (r) => {
    const n = SR * 3;
    const b = env(lowpass(noise(n, r), 250), 0.01, 2.8, 1.5);
    mixInto(b, env(lowpass(noise(Math.floor(SR * 0.3), r), 2000), 0.001, 0.3, 2), 0.8);
    return normalize(b, 1);
  },
  rain: (r) => normalize(highpass(lowpass(noise(SR * 2, r), 6000), 800), 0.4),
  // fireworks: the hiss of the launch, the crack (or boom) of the burst, and the crackle of twinkling stars after it
  fireworkLaunch: (r) => {
    const n = SR * 1.1;
    const b = env(bandpass(noise(n, r), 1200, 7000), 0.08, 0.95, 1.6);
    mixInto(b, env(tone(n, 260, 900, 'saw', 0.05, 12), 0.15, 0.8, 2), 0.12);
    return normalize(b, 0.6);
  },
  fireworkBlast: (r) => {
    const n = SR * 1.4;
    const b = env(lowpass(noise(n, r), 3500), 0.001, 0.25, 3);
    mixInto(b, env(lowpass(noise(n, r), 300), 0.002, 1.2, 2.5), 1.2);
    return normalize(b, 0.9);
  },
  fireworkLargeBlast: (r) => {
    const n = SR * 2.4;
    const b = env(lowpass(noise(n, r), 2500), 0.001, 0.35, 3);
    mixInto(b, env(lowpass(noise(n, r), 160), 0.004, 2.1, 2), 1.8);
    mixInto(b, env(tone(n, 70, 30, 'sine'), 0.002, 1.2, 2), 0.6);
    return normalize(b, 1);
  },
  fireworkTwinkle: (r) => {
    const n = SR * 2.2, b = new Float32Array(n);
    // a scatter of tiny pops, starting once the sparks start to flicker
    for (let k = 0; k < 90; k++) {
      const len = Math.floor(SR * (0.004 + r.next() * 0.01));
      const at = Math.floor(SR * (0.55 + Math.pow(r.next(), 1.6) * 1.5));
      mixInto(b, env(highpass(noise(len, r), 2500), 0.0005, len / SR, 4), 0.4 + r.next() * 0.6, at);
    }
    return normalize(b, 0.7);
  },
  wind: (r) => {
    // two seconds that loop: filtered noise swelling slowly, the end crossfaded into the start
    const n = SR * 2, x = Math.floor(SR * 0.25);
    const raw = bandpass(noise(n + x, r), 180, 1400);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = raw[i] * (0.75 + 0.25 * Math.sin((i / n) * Math.PI * 2));
    for (let i = 0; i < x; i++) b[i] = b[i] * (i / x) + raw[n + i] * (1 - i / x) * 0.75;
    return normalize(b, 0.7);
  },
};

// the 1.9 - 1.16 sounds (audio2.ts)
moreSounds((name, g) => { GENS[name] = g; }, { noise, lowpass, highpass, bandpass, env, normalize, tone, mixInto }, SR);

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  musicGain!: GainNode;
  reverb!: ConvolverNode;
  private buffers = new Map<string, AudioBuffer[]>();
  volume = 1;
  musicVolume = 0.5;
  private rng = new Random(1234);
  private musicTimer = 20 * 30;
  private musicPlaying = false;
  private rainNode: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  listener = { x: 0, y: 0, z: 0, yaw: 0 };

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.musicGain = c.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(3.5);
    this.reverb.connect(this.musicGain);
    this.musicGain.connect(this.master);
    this.setVolume(this.volume, this.musicVolume);
  }

  setVolume(v: number, music: number) {
    this.volume = v;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.master.gain.value = v;
    this.musicGain.gain.value = music * 0.6;
  }

  private impulse(sec: number): AudioBuffer {
    const c = this.ctx!;
    const n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
    }
    return b;
  }

  private get(name: string): AudioBuffer | null {
    if (!this.ctx) return null;
    let list = this.buffers.get(name);
    if (!list) {
      const g = GENS[name];
      if (!g) return null;
      list = [];
      const variants = name.startsWith('dig.') || name.includes('.say') ? 4 : 2;
      for (let v = 0; v < variants; v++) {
        const data = g(new Random(hashName(name) + v * 7919));
        const buf = this.ctx.createBuffer(1, data.length, SR);
        buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        list.push(buf);
      }
      this.buffers.set(name, list);
    }
    return list[this.rng.int(list.length)];
  }

  setListener(x: number, y: number, z: number, yaw: number) {
    this.listener = { x, y, z, yaw };
  }

  /** Play a sound; position is optional (null = non-positional, e.g. UI). */
  play(name: string, pos: { x: number; y: number; z: number } | null = null, volume = 1, pitch = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const buf = this.get(name);
    if (!buf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const g = c.createGain();
    let vol = volume;
    let pan = 0;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = 16 * Math.max(1, volume);
      if (d > range) return;
      vol *= Math.max(0, 1 - d / range);
      // stereo pan from listener yaw
      const yaw = (this.listener.yaw * Math.PI) / 180;
      const rx = -Math.cos(yaw), rz = -Math.sin(yaw);
      pan = d > 0.1 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.7 : 0;
    }
    g.gain.value = Math.min(1.5, vol);
    src.connect(g);
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    src.start();
  }

  private windNode: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  /** The rush of air while gliding (0 stops it). */
  setWind(volume: number, pitch: number) {
    if (!this.ctx) return;
    if (volume > 0 && !this.windNode) {
      const buf = this.get('wind');
      if (!buf) return;
      this.windNode = this.ctx.createBufferSource();
      this.windNode.buffer = buf;
      this.windNode.loop = true;
      this.windGain = this.ctx.createGain();
      this.windNode.connect(this.windGain);
      this.windGain.connect(this.sfx);
      this.windNode.start();
    }
    if (this.windGain && this.windNode) {
      this.windGain.gain.value = volume * 0.6;
      this.windNode.playbackRate.value = pitch;
    }
    if (volume <= 0 && this.windNode) {
      this.windNode.stop();
      this.windNode = null;
      this.windGain = null;
    }
  }

  setRain(strength: number) {
    if (!this.ctx) return;
    if (strength > 0 && !this.rainNode) {
      const buf = this.get('rain');
      if (!buf) return;
      this.rainNode = this.ctx.createBufferSource();
      this.rainNode.buffer = buf;
      this.rainNode.loop = true;
      this.rainGain = this.ctx.createGain();
      this.rainNode.connect(this.rainGain);
      this.rainGain.connect(this.sfx);
      this.rainNode.start();
    }
    if (this.rainGain) this.rainGain.gain.value = strength * 0.25;
    if (strength <= 0 && this.rainNode) {
      this.rainNode.stop();
      this.rainNode = null;
      this.rainGain = null;
    }
  }

  // ------------------------------------------------------------------ generative music
  /** Called every game tick. Occasionally plays a slow, sparse piano piece. */
  tickMusic(menu: boolean) {
    if (!this.ctx || this.musicVolume <= 0) return;
    if (this.musicPlaying) return;
    if (--this.musicTimer > 0) return;
    this.musicTimer = (menu ? 20 * 60 : 20 * (300 + this.rng.int(600)));
    this.playPiece();
  }

  playPiece() {
    if (!this.ctx) return;
    const c = this.ctx;
    this.musicPlaying = true;
    const r = this.rng;
    // pick a key and a gentle progression (I - vi - IV - V style voicings with 7ths/9ths)
    const root = 48 + r.int(7);
    const scale = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19];
    const progressions = [[0, 9, 5, 7], [0, 5, 9, 4], [0, 4, 5, 7], [9, 5, 0, 7]];
    const prog = progressions[r.int(progressions.length)];
    const beat = 0.55 + r.next() * 0.35;
    let t = c.currentTime + 0.5;
    const bars = 8 + r.int(8);
    for (let b = 0; b < bars; b++) {
      const chordRoot = root + prog[b % prog.length];
      // left hand: soft chord
      for (const iv of [0, 7, 16]) this.note(chordRoot - 12 + iv, t, beat * 3.5, 0.12);
      // right hand: sparse melody notes
      const notes = 2 + r.int(4);
      for (let k = 0; k < notes; k++) {
        if (r.next() < 0.25) continue;
        const nt = t + (k * 4 * beat) / notes + (r.next() < 0.3 ? beat / 2 : 0);
        this.note(root + 12 + scale[r.int(scale.length)] + (r.next() < 0.2 ? 12 : 0), nt, beat * 2.5, 0.16);
      }
      t += beat * 4;
    }
    setTimeout(() => (this.musicPlaying = false), (t - c.currentTime + 4) * 1000);
  }

  private note(midi: number, when: number, dur: number, vol: number) {
    const c = this.ctx!;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, when + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 1.5);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    g.connect(lp);
    lp.connect(this.reverb);
    lp.connect(this.musicGain);
    for (const [mult, amp] of [[1, 1], [2, 0.35], [3, 0.12], [4.01, 0.06]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const og = c.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(g);
      o.start(when);
      o.stop(when + dur + 2);
    }
  }
}

function hashName(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export const SOUND_FOR: Record<string, string> = {
  stone: 'dig.stone', wood: 'dig.wood', grass: 'dig.grass', gravel: 'dig.gravel', sand: 'dig.sand',
  glass: 'dig.glass', cloth: 'dig.cloth', snow: 'dig.snow', metal: 'dig.metal', slime: 'dig.slime', none: '',
};
