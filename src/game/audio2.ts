// Synthesised sounds of the 1.9 - 1.16 content: note block instruments, bells, music discs (each a short tune of its
// own), and the voices of the new mobs. audio.ts calls `moreSounds` with its registry and synth helpers.
import { Random } from '../noise';

type Buf = Float32Array;
type Gen = (r: Random) => Buf;
export interface Synth {
  noise(n: number, r: Random): Buf;
  lowpass(b: Buf, cutoff: number): Buf;
  highpass(b: Buf, cutoff: number): Buf;
  bandpass(b: Buf, lo: number, hi: number): Buf;
  env(b: Buf, attack: number, decay: number, curve?: number): Buf;
  normalize(b: Buf, peak?: number): Buf;
  tone(n: number, f0: number, f1: number, type: 'sine' | 'saw' | 'square' | 'tri', vib?: number, vibF?: number): Buf;
  mixInto(a: Buf, b: Buf, gain?: number, offset?: number): Buf;
}

export function moreSounds(add: (name: string, g: Gen) => void, s: Synth, SR: number) {
  const { noise, lowpass, highpass, bandpass, env, normalize, tone, mixInto } = s;
  /** A plucked/struck note at f Hz with some harmonics. */
  const pluck = (f: number, len: number, type: 'sine' | 'tri' | 'square' | 'saw', decay: number, harm = 0.3): Buf => {
    const n = Math.floor(SR * len);
    const b = env(tone(n, f, f, type), 0.002, decay, 2.5);
    mixInto(b, env(tone(n, f * 2, f * 2, 'sine'), 0.002, decay * 0.6, 3), harm);
    return b;
  };
  // note block instruments, all at F#3-ish so the pitch argument (0.5 - 2) spans two octaves like vanilla
  const F = 185;
  add('note.harp', () => normalize(pluck(F, 1.2, 'tri', 1.1, 0.35), 0.7));
  add('note.bass', () => normalize(pluck(F / 2, 0.9, 'tri', 0.8, 0.5), 0.8));
  add('note.basedrum', (r) => normalize(mixInto(env(tone(SR * 0.3, 120, 45, 'sine'), 0.001, 0.25, 2), env(lowpass(noise(SR * 0.3, r), 300), 0.001, 0.08, 2), 0.6), 0.9));
  add('note.snare', (r) => normalize(mixInto(env(bandpass(noise(SR * 0.25, r), 1500, 6000), 0.001, 0.18, 2), env(tone(SR * 0.25, 220, 180, 'tri'), 0.001, 0.08, 2), 0.4), 0.7));
  add('note.hat', (r) => normalize(env(highpass(noise(SR * 0.12, r), 6000), 0.001, 0.08, 3), 0.5));
  add('note.bell', () => normalize(mixInto(pluck(F * 4, 1.6, 'sine', 1.5, 0.2), pluck(F * 4 * 2.76, 1.2, 'sine', 0.7, 0), 0.3), 0.6));
  add('note.flute', () => normalize(env(tone(SR * 0.9, F * 2, F * 2, 'sine', 0.01, 5), 0.06, 0.8, 1.5), 0.6));
  add('note.chime', () => normalize(mixInto(pluck(F * 4, 2, 'sine', 1.8, 0.1), pluck(F * 4 * 3.1, 1.4, 'sine', 1, 0), 0.25), 0.5));
  add('note.guitar', () => normalize(lowpass(pluck(F, 1, 'saw', 0.9, 0.3), 2000), 0.6));
  add('note.xylophone', () => normalize(pluck(F * 4, 0.5, 'sine', 0.35, 0.5), 0.7));
  add('note.iron_xylophone', () => normalize(mixInto(pluck(F, 0.8, 'square', 0.6, 0.2), pluck(F * 3, 0.6, 'sine', 0.4, 0), 0.3), 0.5));
  add('note.cow_bell', () => normalize(mixInto(pluck(F * 2, 0.5, 'square', 0.35, 0), pluck(F * 2 * 1.48, 0.5, 'square', 0.35, 0), 0.6), 0.5));
  add('note.didgeridoo', () => normalize(lowpass(env(tone(SR * 0.9, F / 2, F / 2, 'saw', 0.02, 7), 0.03, 0.8, 1.3), 700), 0.7));
  add('note.bit', () => normalize(env(tone(SR * 0.4, F, F, 'square'), 0.002, 0.35, 1.5), 0.4));
  add('note.banjo', () => normalize(highpass(pluck(F, 0.7, 'saw', 0.5, 0.5), 300), 0.6));
  add('note.pling', () => normalize(mixInto(pluck(F, 1.2, 'sine', 1.1, 0.6), pluck(F * 2, 1, 'tri', 0.8, 0), 0.4), 0.7));
  add('bell', () => {
    const n = SR * 3, b = new Float32Array(n);
    for (const [k, g] of [[1, 1], [2.4, 0.5], [3.9, 0.3], [5.4, 0.2]] as const) mixInto(b, env(tone(n, 420 * k, 420 * k, 'sine'), 0.001, 2.8 / k, 2), g);
    return normalize(b, 0.8);
  });
  add('disc.stop', (r) => normalize(env(lowpass(noise(SR * 0.1, r), 800), 0.001, 0.08, 2), 0.3));
  // music discs: each name seeds its own melody (the jukebox plays it once)
  for (const disc of ['13', 'cat', 'blocks', 'chirp', 'far', 'mall', 'mellohi', 'stal', 'strad', 'ward', '11', 'wait', 'pigstep'])
    add('disc.' + disc, () => {
      const r = new Random([...disc].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
      const scale = [0, 2, 4, 7, 9, 12, 14, 16];
      const root = 196 * Math.pow(2, r.int(5) / 12), beat = SR * (0.22 + r.next() * 0.12);
      const bars = 16, n = Math.floor(beat * bars * 4);
      const b = new Float32Array(n);
      const dark = disc === '13' || disc === '11';
      for (let i = 0; i < bars * 4; i++) {
        if (r.next() < (dark ? 0.45 : 0.15)) continue;
        const note = scale[r.int(scale.length)] - (dark ? 12 : 0);
        const f = root * Math.pow(2, note / 12);
        mixInto(b, env(tone(Math.floor(beat * 1.8), f, f, dark ? 'sine' : 'tri'), 0.004, beat / SR * 1.6, 2), 0.5, Math.floor(i * beat));
        if (i % 4 === 0) mixInto(b, env(tone(Math.floor(beat * 3.5), root / 2, root / 2, 'sine'), 0.01, beat / SR * 3.2, 1.5), 0.35, Math.floor(i * beat));
        if (disc === 'pigstep' && i % 2 === 0) mixInto(b, env(lowpass(noise(Math.floor(beat * 0.4), r), 200), 0.001, 0.08, 2), 0.6, Math.floor(i * beat));
      }
      return normalize(b, 0.6);
    });
  // ---- mob voices of the 1.4-1.16 mobs: a pitched, formant-filtered buzz (len s, f0 -> f1 Hz, band lo-hi)
  const voice = (r: Random | { next(): number }, len: number, f0: number, f1: number, lo: number, hi: number, type: 'saw' | 'square' | 'tri' | 'sine' = 'saw', vib = 0.06, rate = 8, gain = 0.6) =>
    normalize(bandpass(env(tone(Math.floor(SR * len), f0 * (0.95 + r.next() * 0.1), f1 * (0.95 + r.next() * 0.1), type, vib, rate), 0.02, len * 0.85, 1.5), lo, hi), gain);
  const grunt = (r: Random | { next(): number }, len: number, f0: number, f1: number, cut: number, gain = 0.7) => {
    const n = Math.floor(SR * len);
    const b = env(tone(n, f0 * (0.9 + r.next() * 0.2), f1, 'saw', 0.1, 12), 0.01, len * 0.8, 1.6);
    mixInto(b, env(lowpass(noise(n, r as Random), cut), 0.01, len * 0.6, 2), 0.35);
    return normalize(lowpass(b, cut), gain);
  };
  add('piglin.say', (r) => grunt(r, 0.45, 150, 110, 900));
  add('piglin.hurt', (r) => grunt(r, 0.3, 220, 140, 1400));
  add('piglin.death', (r) => grunt(r, 0.9, 170, 60, 800));
  add('piglin.admire', (r) => voice(r, 0.6, 160, 240, 200, 1500));
  add('hoglin.say', (r) => grunt(r, 0.6, 80, 60, 500, 0.8));
  add('hoglin.hurt', (r) => grunt(r, 0.35, 120, 80, 700, 0.8));
  add('hoglin.death', (r) => grunt(r, 1, 90, 40, 450, 0.8));
  add('zoglin.say', (r) => grunt(r, 0.6, 70, 50, 400, 0.8));
  add('strider.say', (r) => voice(r, 0.5, 260, 200, 200, 2000, 'square', 0.15, 14, 0.4));
  add('strider.hurt', (r) => voice(r, 0.3, 320, 220, 200, 2200, 'square', 0.2, 18, 0.45));
  add('strider.death', (r) => voice(r, 0.8, 300, 120, 200, 2000, 'square', 0.2, 10, 0.45));
  add('shulker.say', (r) => normalize(env(lowpass(noise(Math.floor(SR * 0.4), r), 600), 0.05, 0.3, 2), 0.4));
  add('shulker.hurt', (r) => voice(r, 0.25, 400, 300, 300, 3000, 'tri', 0.1, 20, 0.5));
  add('shulker.death', (r) => voice(r, 0.7, 380, 150, 300, 3000, 'tri', 0.1, 10, 0.5));
  add('shulker.shoot', (r) => normalize(env(tone(Math.floor(SR * 0.3), 900 + r.next() * 100, 500, 'sine'), 0.005, 0.25, 2), 0.4));
  add('shulker.bullet', (r) => normalize(env(highpass(noise(Math.floor(SR * 0.2), r), 2000), 0.005, 0.15, 2), 0.4));
  add('witch.idle', (r) => voice(r, 0.7, 330, 260, 300, 2500, 'saw', 0.12, 11));
  add('witch.hurt', (r) => voice(r, 0.3, 420, 300, 300, 2800, 'saw', 0.15, 16));
  add('witch.throw', (r) => normalize(env(bandpass(noise(Math.floor(SR * 0.25), r), 600, 3000), 0.01, 0.2, 2), 0.4));
  add('illager.idle', (r) => voice(r, 0.5, 150, 120, 150, 1300, 'saw', 0.05, 7));
  add('illager.hurt', (r) => voice(r, 0.3, 200, 140, 150, 1600, 'saw', 0.1, 14));
  add('illager.death', (r) => voice(r, 0.8, 180, 80, 150, 1300, 'saw', 0.08, 8));
  add('evoker.summon', (r) => normalize(mixInto(voice(r, 1.2, 140, 300, 150, 2000, 'saw', 0.04, 5), env(highpass(noise(Math.floor(SR * 1.2), r), 3000), 0.3, 0.8, 1.5), 0.3), 0.6));
  add('evoker.fangs', (r) => voice(r, 0.8, 120, 200, 120, 1500, 'saw', 0.05, 6));
  add('evoker.wololo', (r) => {
    const n = Math.floor(SR * 1.1), b = new Float32Array(n);
    [0, 0.27, 0.55, 0.8].forEach((t, i) => mixInto(b, env(tone(Math.floor(SR * 0.3), i % 2 ? 160 : 210, i % 2 ? 150 : 200, 'saw', 0.02, 6), 0.02, 0.26, 1.5), 0.8, Math.floor(SR * t)));
    return normalize(bandpass(b, 150, 1400), 0.6);
  });
  add('evoker.fangs_bite', (r) => normalize(mixInto(env(lowpass(noise(Math.floor(SR * 0.25), r), 1500), 0.002, 0.15, 3), env(tone(Math.floor(SR * 0.2), 200, 90, 'square'), 0.002, 0.12, 3), 0.5), 0.6));
  add('vex.idle', (r) => voice(r, 0.5, 900, 1100, 600, 5000, 'tri', 0.15, 20, 0.35));
  add('vex.hurt', (r) => voice(r, 0.3, 1100, 800, 600, 5000, 'tri', 0.2, 24, 0.4));
  add('vex.death', (r) => voice(r, 0.6, 1000, 400, 600, 5000, 'tri', 0.2, 16, 0.4));
  add('ravager.idle', (r) => grunt(r, 0.9, 60, 45, 350, 0.9));
  add('ravager.hurt', (r) => grunt(r, 0.4, 90, 60, 500, 0.9));
  add('ravager.death', (r) => grunt(r, 1.4, 70, 30, 300, 0.9));
  add('ravager.roar', (r) => grunt(r, 1.6, 75, 45, 600, 1));
  add('guardian.idle', (r) => voice(r, 0.6, 500, 420, 300, 3500, 'sine', 0.1, 6, 0.4));
  add('guardian.hurt', (r) => voice(r, 0.25, 600, 450, 300, 3500, 'tri', 0.15, 20, 0.5));
  add('guardian.death', (r) => voice(r, 0.9, 520, 200, 300, 3500, 'tri', 0.15, 9, 0.5));
  add('guardian.attack', (r) => normalize(env(tone(Math.floor(SR * 3), 300 + r.next() * 30, 900, 'sine', 0.01, 30), 0.3, 2.6, 1), 0.35));
  add('elder_guardian.curse', (r) => {
    const n = Math.floor(SR * 2), b = env(tone(n, 180, 120, 'saw', 0.08, 4), 0.2, 1.8, 1.2);
    mixInto(b, env(tone(n, 270, 180, 'saw', 0.08, 4), 0.2, 1.8, 1.2), 0.6);
    mixInto(b, env(bandpass(noise(n, r), 400, 2500), 0.4, 1.5, 1.5), 0.3);
    return normalize(bandpass(b, 100, 2500), 0.7);
  });
  add('phantom.idle', (r) => voice(r, 0.8, 700, 500, 400, 4000, 'saw', 0.2, 6, 0.4));
  add('phantom.hurt', (r) => voice(r, 0.3, 800, 600, 400, 4000, 'saw', 0.2, 14, 0.45));
  add('phantom.death', (r) => voice(r, 1, 750, 250, 400, 4000, 'saw', 0.2, 7, 0.45));
  add('phantom.swoop', (r) => normalize(env(bandpass(noise(Math.floor(SR * 1), r), 300, 2500), 0.4, 0.5, 1.2), 0.45));
  add('iron_golem.hurt', (r) => normalize(mixInto(env(tone(Math.floor(SR * 0.35), 220, 180, 'square'), 0.002, 0.3, 2.5), env(highpass(noise(Math.floor(SR * 0.35), r), 2500), 0.002, 0.2, 3), 0.4), 0.5));
  add('iron_golem.death', (r) => normalize(mixInto(env(tone(Math.floor(SR * 1), 160, 60, 'square'), 0.002, 0.9, 2), env(lowpass(noise(Math.floor(SR * 1), r), 900), 0.002, 0.8, 2), 0.6), 0.6));
  add('iron_golem.attack', (r) => normalize(mixInto(env(lowpass(noise(Math.floor(SR * 0.3), r), 700), 0.002, 0.2, 2.5), env(tone(Math.floor(SR * 0.3), 90, 50, 'sine'), 0.002, 0.25, 2), 0.7), 0.7));
  add('iron_golem.repair', (r) => normalize(env(tone(Math.floor(SR * 0.4), 1200 + r.next() * 200, 1400, 'square'), 0.002, 0.3, 3), 0.3));
  add('throw', (r) => normalize(env(bandpass(noise(Math.floor(SR * 0.2), r), 500, 2500), 0.02, 0.15, 2), 0.35));
  add('shears', (r) => normalize(mixInto(env(highpass(noise(Math.floor(SR * 0.12), r), 3000), 0.001, 0.05, 3), env(highpass(noise(Math.floor(SR * 0.12), r), 3000), 0.001, 0.05, 3), 0.8, Math.floor(SR * 0.06)), 0.4));
  // ---- 1.9+ combat
  const whoosh = (r: Random, len: number, lo: number, hi: number, gain: number) => normalize(env(bandpass(noise(Math.floor(SR * len), r), lo, hi), len * 0.3, len * 0.6, 1.5), gain);
  add('sweep', (r) => whoosh(r, 0.35, 800, 5000, 0.5));
  add('attack.sweep', (r) => whoosh(r, 0.35, 800, 5000, 0.5));
  add('attack.strong', (r) => normalize(mixInto(env(lowpass(noise(Math.floor(SR * 0.15), r), 1200), 0.001, 0.12, 3), env(tone(Math.floor(SR * 0.15), 160, 90, 'sine'), 0.001, 0.1, 3), 0.5), 0.6));
  add('attack.weak', (r) => normalize(env(lowpass(noise(Math.floor(SR * 0.1), r), 800), 0.001, 0.08, 3), 0.35));
  add('attack.crit', (r) => normalize(mixInto(env(highpass(noise(Math.floor(SR * 0.2), r), 2500), 0.001, 0.15, 3), env(tone(Math.floor(SR * 0.2), 900, 500, 'square'), 0.001, 0.1, 3), 0.3), 0.5));
  add('shield.block', (r) => normalize(mixInto(env(lowpass(noise(Math.floor(SR * 0.25), r), 900), 0.001, 0.2, 2.5), env(tone(Math.floor(SR * 0.25), 140, 110, 'square'), 0.001, 0.2, 2.5), 0.4), 0.7));
  add('shield.break', (r) => normalize(mixInto(env(highpass(noise(Math.floor(SR * 0.5), r), 1200), 0.001, 0.4, 2), env(tone(Math.floor(SR * 0.5), 300, 120, 'saw'), 0.001, 0.4, 2), 0.4), 0.7));
  add('crossbow.loading', (r) => normalize(env(bandpass(noise(Math.floor(SR * 0.6), r), 1500, 6000), 0.4, 0.2, 1), 0.3));
  add('crossbow.loaded', (r) => normalize(mixInto(env(highpass(noise(Math.floor(SR * 0.15), r), 3000), 0.001, 0.1, 3), env(tone(Math.floor(SR * 0.15), 1200, 900, 'square'), 0.001, 0.08, 3), 0.3), 0.5));
  add('crossbow.shoot', (r) => normalize(mixInto(env(lowpass(noise(Math.floor(SR * 0.3), r), 2500), 0.001, 0.2, 3), env(tone(Math.floor(SR * 0.3), 400, 150, 'tri'), 0.001, 0.15, 3), 0.6), 0.7));
  add('trident.throw', (r) => whoosh(r, 0.5, 400, 3000, 0.6));
  add('trident.hit', (r) => normalize(mixInto(env(tone(Math.floor(SR * 0.4), 1800, 1600, 'sine'), 0.001, 0.35, 2), env(lowpass(noise(Math.floor(SR * 0.4), r), 1500), 0.001, 0.15, 3), 0.5), 0.5));
  add('trident.return', (r) => normalize(env(tone(Math.floor(SR * 0.6), 600, 1200, 'sine', 0.05, 12), 0.05, 0.5, 1.5), 0.4));
  add('trident.riptide', (r) => normalize(mixInto(whoosh(r, 0.9, 200, 2500, 0.8), env(tone(Math.floor(SR * 0.9), 120, 400, 'saw'), 0.05, 0.8, 1.5), 0.3), 0.7));
  add('totem.use', (r) => {
    const n = Math.floor(SR * 1.6), b = new Float32Array(n);
    [0, 4, 7, 12, 16].forEach((k, i) => mixInto(b, env(tone(Math.floor(SR * 1.2), 440 * 2 ** (k / 12), 440 * 2 ** (k / 12), 'tri'), 0.01, 1, 2), 0.4, Math.floor(SR * 0.08 * i)));
    mixInto(b, env(highpass(noise(n, r), 4000), 0.3, 1.2, 1.5), 0.2);
    return normalize(b, 0.6);
  });
  add('bottle.fill', (r) => normalize(env(tone(Math.floor(SR * 0.4), 300, 900, 'sine', 0.2, 30), 0.01, 0.35, 2), 0.4));
  add('bee.loop', (r) => normalize(env(tone(Math.floor(SR * 0.6), 190 + r.next() * 20, 200, 'saw', 0.03, 30), 0.1, 0.5, 1), 0.15));
  add('bee.hurt', (r) => normalize(env(tone(Math.floor(SR * 0.25), 420, 300, 'saw', 0.1, 40), 0.005, 0.2, 2), 0.4));
  add('bee.death', (r) => normalize(env(tone(Math.floor(SR * 0.6), 400, 120, 'saw', 0.1, 30), 0.005, 0.55, 2), 0.4));
  add('bee.sting', (r) => normalize(env(highpass(noise(Math.floor(SR * 0.15), r), 3000), 0.001, 0.1, 3), 0.4));
  add('bee.enter', (r) => normalize(env(bandpass(noise(Math.floor(SR * 0.3), r), 300, 1500), 0.05, 0.2, 2), 0.3));
  add('rabbit.hop', (r) => normalize(env(lowpass(noise(Math.floor(SR * 0.08), r), 600), 0.001, 0.06, 3), 0.25));
  add('fish.flop', (r) => normalize(env(lowpass(noise(Math.floor(SR * 0.1), r), 900), 0.001, 0.08, 3), 0.35));
  add('pufferfish.blow_up', (r) => normalize(env(tone(Math.floor(SR * 0.3), 200, 500, 'sine'), 0.01, 0.25, 2), 0.4));
  add('cat.purr', (r) => normalize(lowpass(env(tone(Math.floor(SR * 1), 28, 26, 'saw', 0.3, 25), 0.1, 0.8, 1), 600), 0.4));
  add('panda.sneeze', (r) => normalize(mixInto(env(highpass(noise(Math.floor(SR * 0.4), r), 1500), 0.15, 0.2, 2), env(tone(Math.floor(SR * 0.4), 500, 300, 'saw'), 0.15, 0.2, 2), 0.3), 0.5));
  add('llama.spit', (r) => normalize(env(bandpass(noise(Math.floor(SR * 0.2), r), 1000, 4000), 0.005, 0.15, 3), 0.4));
  add('turtle.egg_crack', (r) => normalize(env(highpass(noise(Math.floor(SR * 0.1), r), 2500), 0.001, 0.07, 3), 0.4));
  add('turtle.egg_hatch', (r) => normalize(env(highpass(noise(Math.floor(SR * 0.25), r), 2000), 0.001, 0.2, 2), 0.5));
  // ---- the Wither, beacons, conduits, anchors, lodestones
  add('wither.spawn', (r) => {
    const n = Math.floor(SR * 3), b = env(tone(n, 90, 45, 'saw', 0.1, 5), 0.05, 2.8, 1.2);
    mixInto(b, env(lowpass(noise(n, r), 400), 0.02, 2.5, 1.5), 0.6);
    mixInto(b, env(tone(n, 180, 70, 'square', 0.15, 3), 0.1, 2.6, 1.3), 0.3);
    return normalize(lowpass(b, 1200), 0.9);
  });
  add('wither.ambient', (r) => normalize(lowpass(env(tone(Math.floor(SR * 1.2), 110, 80, 'saw', 0.12, 6), 0.1, 1, 1.4), 900), 0.6));
  add('wither.hurt', (r) => normalize(lowpass(env(tone(Math.floor(SR * 0.4), 200, 120, 'saw', 0.2, 18), 0.01, 0.35, 2), 1500), 0.6));
  add('wither.death', (r) => normalize(mixInto(lowpass(env(tone(Math.floor(SR * 3.5), 140, 30, 'saw', 0.2, 4), 0.05, 3.3, 1.2), 1000), env(lowpass(noise(Math.floor(SR * 3.5), r), 500), 0.1, 3, 1.3), 0.5), 0.9));
  add('wither.shoot', (r) => normalize(env(lowpass(noise(Math.floor(SR * 0.4), r), 900), 0.005, 0.35, 2), 0.6));
  add('wither.break_block', (r) => normalize(env(lowpass(noise(Math.floor(SR * 0.5), r), 1200), 0.002, 0.45, 2), 0.7));
  add('beacon.activate', (r) => normalize(env(tone(Math.floor(SR * 1.5), 300, 600, 'sine', 0.05, 8), 0.2, 1.2, 1.2), 0.5));
  add('beacon.deactivate', (r) => normalize(env(tone(Math.floor(SR * 1.2), 600, 250, 'sine', 0.05, 8), 0.05, 1.1, 1.2), 0.5));
  add('beacon.power', (r) => normalize(mixInto(env(tone(Math.floor(SR * 1), 500, 500, 'tri'), 0.01, 0.9, 1.5), env(tone(Math.floor(SR * 1), 750, 750, 'sine'), 0.01, 0.9, 1.5), 0.5), 0.5));
  add('conduit.activate', (r) => normalize(env(tone(Math.floor(SR * 2), 200, 400, 'sine', 0.1, 4), 0.3, 1.6, 1.2), 0.5));
  add('conduit.attack', (r) => normalize(env(tone(Math.floor(SR * 0.3), 900, 300, 'square'), 0.002, 0.25, 2.5), 0.4));
  add('anchor.charge', (r) => normalize(mixInto(env(tone(Math.floor(SR * 0.6), 250, 450, 'saw', 0.05, 10), 0.01, 0.5, 1.5), env(highpass(noise(Math.floor(SR * 0.6), r), 2500), 0.01, 0.4, 2), 0.3), 0.5));
  add('anchor.set', (r) => normalize(env(tone(Math.floor(SR * 0.8), 330, 330, 'tri', 0.02, 5), 0.02, 0.7, 1.5), 0.5));
  add('lodestone.lock', (r) => normalize(mixInto(env(tone(Math.floor(SR * 0.5), 700, 700, 'square'), 0.002, 0.4, 2.5), env(tone(Math.floor(SR * 0.5), 1050, 1050, 'sine'), 0.002, 0.4, 2.5), 0.5), 0.35));
  void highpass;
}
