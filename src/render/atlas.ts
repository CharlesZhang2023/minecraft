import { TEXTURES, tex } from '../world/blocks';
import { buildBlockTextures, ANIMATED, animatedFrame } from './textures';
import { Img, S } from './pixels';
import { OVERRIDES, resize, type TexOverride } from './overrides';

/** Where a backend keeps the block textures: one square layer per texture, each with its mip levels. */
export interface AtlasTarget {
  /** Every layer at once: `levels[l]` holds all layers of mip level l, one after another; `size` is level 0's. */
  all(levels: Uint8Array[], size: number): void;
  /** One layer's mip levels (animated textures, every few ticks). */
  layer(layer: number, mips: Img[]): void;
  destroy(): void;
}

/** The biggest layer size (resource packs with bigger textures are scaled down to it). */
export const MAX_ATLAS_RES = 128;

interface Anim { layer: number; frames: Img[]; steps: { frame: number; ticks: number }[]; period: number; shown: number }

/**
 * Block textures (and item sprites, used for particles and dropped items) as an array texture with mip-maps, the same
 * for every backend: the images, the mips and the animation are made here, the backend only stores them. Layers are
 * 16x16 (the game's own textures), or as big as the biggest resource pack texture in use (the rest scaled up).
 */
export class BlockAtlas {
  layers: number;
  /** Size of a layer, in pixels. */
  res = S;
  levels = 5;
  private anim: Anim[] = [];
  /** Each layer's average colour (its 1x1 mip level), r g b a in 0..255. */
  private averages: [number, number, number, number][] = [];

  constructor(public target: AtlasTarget, extra: { name: string; img: Img }[] = [], maxRes = MAX_ATLAS_RES) {
    // extra textures (item sprites used as particles, etc.)
    for (const e of extra) tex(e.name);
    const imgs = buildBlockTextures();
    for (const e of extra) imgs[TEXTURES.indexOf(e.name)] = e.img;
    this.layers = TEXTURES.length;
    const packTex = (name: string): TexOverride | undefined => OVERRIDES.blocks.get(name) ?? (name.startsWith('item/') ? OVERRIDES.items.get(name.slice(5)) : undefined);
    for (const n of TEXTURES) { const o = packTex(n); if (o) this.res = Math.max(this.res, Math.min(maxRes, o.size)); }
    const res = this.res;
    this.levels = Math.log2(res) + 1;
    const levels: Uint8Array[] = [];
    for (let l = 0, size = res; l < this.levels; l++, size >>= 1) levels.push(new Uint8Array(size * size * 4 * this.layers));
    for (let i = 0; i < this.layers; i++) {
      const o = packTex(TEXTURES[i]);
      const m = this.mips(i, o ? resize(o.img, o.size, res) : resize(imgs[i], S, res));
      for (let l = 0; l < this.levels; l++) levels[l].set(m[l], m[l].length * i);
      if (o?.frames && o.steps?.length) {
        const frames = o.frames.map((f) => resize(f, o.size, res));
        this.anim.push({ layer: i, frames, steps: o.steps, period: o.steps.reduce((a, s) => a + s.ticks, 0), shown: -1 });
      }
    }
    target.all(levels, res);
    for (const [name, a] of Object.entries(ANIMATED)) {
      const layer = TEXTURES.indexOf(name);
      // a pack's texture (animated or not) replaces the game's animation
      if (layer < 0 || packTex(name)) continue;
      const frames: Img[] = [];
      for (let f = 0; f < a.frames; f++) frames.push(resize(animatedFrame(name, f), S, res));
      this.anim.push({ layer, frames, steps: frames.map((_, i) => ({ frame: i, ticks: a.speed })), period: frames.length * a.speed, shown: -1 });
    }
  }

  /** A layer plus hand-built mips (alpha-aware box filter keeps cutout textures from vanishing). */
  private mips(layer: number, img: Img): Img[] {
    let size = this.res;
    let cur = img;
    const out: Img[] = [cur];
    while (size > 1) {
      const ns = size >> 1;
      const next = new Uint8ClampedArray(ns * ns * 4);
      for (let y = 0; y < ns; y++)
        for (let x = 0; x < ns; x++) {
          let r = 0, g = 0, b = 0, a = 0, n = 0, amax = 0;
          for (let k = 0; k < 4; k++) {
            const sx = x * 2 + (k & 1), sy = y * 2 + (k >> 1);
            const i = (sy * size + sx) * 4;
            const al = cur[i + 3];
            a += al;
            amax = Math.max(amax, al);
            if (al > 0) { r += cur[i]; g += cur[i + 1]; b += cur[i + 2]; n++; }
          }
          const o = (y * ns + x) * 4;
          next[o] = n ? r / n : 0;
          next[o + 1] = n ? g / n : 0;
          next[o + 2] = n ? b / n : 0;
          let alpha = a / 4;
          if (n === 4 && amax >= 254) {
            alpha = 255;
            for (let k = 0; k < 4; k++) alpha = Math.min(alpha, cur[((y * 2 + (k >> 1)) * size + x * 2 + (k & 1)) * 4 + 3]);
          } else if (amax === 255 && n >= 2) alpha = 255; // keep coverage of cutout textures
          next[o + 3] = alpha;
        }
      cur = next;
      size = ns;
      out.push(cur);
    }
    this.averages[layer] = [cur[0], cur[1], cur[2], cur[3]];
    return out;
  }

  /** The average colour of a texture, by name. */
  average(name: string): [number, number, number, number] | undefined {
    const i = TEXTURES.indexOf(name);
    return i < 0 ? undefined : this.averages[i];
  }

  tick(ticks: number) {
    for (const a of this.anim) {
      let t = ticks % a.period, f = a.steps[0].frame;
      for (const s of a.steps) { if (t < s.ticks) { f = s.frame; break; } t -= s.ticks; }
      if (f === a.shown) continue;
      a.shown = f;
      this.target.layer(a.layer, this.mips(a.layer, a.frames[f]));
    }
  }

  destroy() { this.target.destroy(); }
}
