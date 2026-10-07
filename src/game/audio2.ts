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
  void highpass;
}
