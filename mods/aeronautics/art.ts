// Textures, item sprites and sounds, painted in code like the game's own.
import type { ModContext, Img } from '../sdk';
import { COLORS } from './blocks';

const WOOL: Record<string, string> = {
  white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c627', lime: '#70b919', pink: '#ed8dac', gray: '#3e4447',
  light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d', brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519',
};

export function paint(mod: ModContext) {
  const px = mod.mc.pixels, { hex, set, shade, mix, newImg } = px;
  type RNG = { next(): number; int(n: number): number };
  const noisy = (r: RNG, base: [number, number, number], amt: number) => {
    const img = newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) set(img, x, y, shade(base, 1 + (r.next() - 0.5) * amt));
    return img;
  };
  const border = (img: Img, c: [number, number, number], inset = 0) => {
    for (let i = inset; i < 16 - inset; i++) { set(img, i, inset, c); set(img, i, 15 - inset, c); set(img, inset, i, c); set(img, 15 - inset, i, c); }
  };
  const casing = (r: RNG) => {
    const img = noisy(r, hex('#8c8f8a'), 0.18);
    border(img, hex('#5d605c'));
    border(img, hex('#a7aaa4'), 1);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) set(img, x, y, hex('#c9a24a'));
    return img;
  };
  const brass = (r: RNG) => {
    const img = noisy(r, hex('#c49a3c'), 0.2);
    for (let i = 0; i < 16; i++) { set(img, i, (i * 3) % 16, hex('#e8c66a')); }
    border(img, hex('#8a6420'));
    return img;
  };
  mod.client.texture('aeronautics:casing', casing);
  mod.client.texture('aeronautics:brass', brass);
  mod.client.texture('aeronautics:assembler_side', (r) => {
    const img = casing(r);
    // a glass window onto the blue core
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
      const edge = x === 4 || x === 11 || y === 4 || y === 11;
      const d = Math.hypot(x - 7.5, y - 7.5);
      set(img, x, y, edge ? hex('#c49a3c') : mix(hex('#7fe8ff'), hex('#1d4f9a'), Math.min(1, d / 4)));
    }
    return img;
  });
  mod.client.texture('aeronautics:assembler_top', (r) => {
    const img = casing(r);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 4.5 && d < 6.2) set(img, x, y, shade(hex('#c49a3c'), 0.9 + r.next() * 0.2));
      else if (d < 2.6) set(img, x, y, mix(hex('#bdf6ff'), hex('#2a7bd0'), d / 2.6));
    }
    return img;
  });
  mod.client.texture('aeronautics:burner_side', (r) => {
    const img = noisy(r, hex('#3a3a3e'), 0.25);
    for (let x = 2; x < 14; x += 3) for (let y = 3; y < 13; y++) set(img, x, y, hex('#151517'));
    border(img, hex('#26262a'));
    return img;
  });
  mod.client.texture('aeronautics:burner_top', (r) => {
    const img = noisy(r, hex('#2c2c30'), 0.25);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if ((x + y) % 3 === 0) set(img, x, y, r.next() < 0.5 ? hex('#ff8a1e') : hex('#ffc94a'));
    border(img, hex('#4a4a50'));
    return img;
  });
  for (const col of COLORS) {
    mod.client.texture(`aeronautics:envelope_${col}`, (r) => {
      const base = hex(WOOL[col]);
      const img = noisy(r, base, 0.08);
      // canvas weave and stitched seams
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % 4 === 0) set(img, x, y, shade(base, 0.93));
      const seam = shade(base, col === 'black' || col === 'gray' ? 1.6 : 0.75);
      for (let i = 1; i < 16; i += 2) { set(img, i, 0, seam); set(img, 0, i, seam); }
      for (let i = 0; i < 16; i++) { set(img, i, 15, shade(base, 0.82)); set(img, 15, i, shade(base, 0.82)); }
      return img;
    });
  }
  mod.client.texture('aeronautics:levitite', (r) => {
    const img = newImg();
    const pts: [number, number][] = Array.from({ length: 7 }, () => [r.int(16), r.int(16)]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let d1 = 99, d2 = 99;
      for (const [px2, py] of pts) { const d = Math.hypot(x - px2, y - py); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      const edge = d2 - d1 < 1.2;
      const c = mix(hex('#e6c3ff'), hex('#8fe3e9'), (x + y) / 30);
      set(img, x, y, edge ? shade(c, 1.15) : shade(c, 0.78 + d1 / 20));
    }
    for (let i = 0; i < 4; i++) set(img, r.int(16), r.int(16), hex('#ffffff'));
    return img;
  });
  mod.client.texture('aeronautics:blade', (r) => {
    const img = noisy(r, hex('#c8a26a'), 0.12);
    for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) set(img, x, y, hex('#9c7a48'));
    return img;
  });
  mod.client.itemSprite('aeronautics:physics_staff', () => {
    const img = newImg();
    for (let i = 1; i < 12; i++) set(img, i, 15 - i, i < 4 ? hex('#5a3a1c') : hex('#7a5230'));
    for (let i = 3; i < 11; i++) set(img, i + 1, 15 - i, hex('#3e2810'));
    const orb: [number, number, string][] = [[12, 2, '#bdf6ff'], [13, 2, '#7fe8ff'], [12, 3, '#7fe8ff'], [13, 3, '#2a7bd0'], [11, 2, '#2a7bd0'], [12, 1, '#2a7bd0'], [14, 3, '#1d4f9a'], [13, 4, '#1d4f9a'], [11, 3, '#c49a3c'], [12, 4, '#c49a3c']];
    for (const [x, y, c] of orb) set(img, x, y, hex(c));
    return img;
  }, '#101018');

  // ---- sounds
  const { synth, SAMPLE_RATE: SR } = mod.mc;
  mod.client.sound('aeronautics:propeller', (r) => {
    const n = Math.floor(SR * 0.7);
    const b = synth.bandpass(synth.noise(n, r), 120, 700);
    for (let i = 0; i < n; i++) b[i] *= 0.55 + 0.45 * Math.sin((i / SR) * Math.PI * 2 * 14);
    return synth.normalize(synth.env(b, 0.08, 0.6, 1.5), 0.35);
  });
  mod.client.sound('aeronautics:burner', (r) => {
    const n = Math.floor(SR * 0.9);
    return synth.normalize(synth.env(synth.lowpass(synth.noise(n, r), 700), 0.1, 0.8, 1.2), 0.4);
  });
  mod.client.sound('aeronautics:assemble', (r) => {
    const n = Math.floor(SR * 0.5);
    const b = synth.tone(n, 180, 520, 'tri');
    synth.mixInto(b, synth.lowpass(synth.noise(Math.floor(SR * 0.08), r), 2000), 0.6, 0);
    return synth.normalize(synth.env(b, 0.01, 0.45, 2), 0.4);
  });
}
