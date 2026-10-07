// Textures from resource packs, standing in for the game's own painted ones. The atlas uses them at their own
// resolution; everything else (GUI icons, dropped items' 3D shapes, the distant-terrain palette) sees a 16x16 copy
// through getTexture / getItemSprite, so nothing else needs to know about pack resolutions.
import { S, Img } from './pixels';

export interface TexOverride {
  /** size x size RGBA (the first frame of an animation). */
  img: Img;
  size: number;
  /** Animation frames (size x size each) and how long each shows, in ticks. */
  frames?: Img[];
  steps?: { frame: number; ticks: number }[];
  /** The 16x16 copy (made when first asked for). */
  small?: Img;
}

export const OVERRIDES = {
  blocks: new Map<string, TexOverride>(),
  items: new Map<string, TexOverride>(),
  /** The sun and the moon's phases (environment/sun.png, moon_phases.png), any size. */
  sky: new Map<string, { w: number; h: number; img: Img }>(),
};

export function setOverrides(o: { blocks: Map<string, TexOverride>; items: Map<string, TexOverride>; sky: Map<string, { w: number; h: number; img: Img }> }) {
  OVERRIDES.blocks = o.blocks;
  OVERRIDES.items = o.items;
  OVERRIDES.sky = o.sky;
}

/** 16x16 copy of an override. */
export function small(o: TexOverride): Img {
  return (o.small ??= resize(o.img, o.size, S));
}

/**
 * A square image at another size: nearest pixel going up, an alpha-aware box filter going down (cut-out textures keep
 * their coverage, like the atlas's mip-maps).
 */
export function resize(img: Img, from: number, to: number): Img {
  if (from === to) return img;
  const out = new Uint8ClampedArray(to * to * 4);
  if (to > from) {
    for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) {
      const s = (Math.floor((y * from) / to) * from + Math.floor((x * from) / to)) * 4, d = (y * to + x) * 4;
      out[d] = img[s]; out[d + 1] = img[s + 1]; out[d + 2] = img[s + 2]; out[d + 3] = img[s + 3];
    }
    return out;
  }
  const k = from / to;
  for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0, opaque = 0;
    for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) {
      const s = ((y * k + yy) * from + x * k + xx) * 4, al = img[s + 3];
      a += al;
      if (al > 0) { r += img[s]; g += img[s + 1]; b += img[s + 2]; n++; }
      if (al === 255) opaque++;
    }
    const d = (y * to + x) * 4, all = k * k;
    out[d] = n ? r / n : 0; out[d + 1] = n ? g / n : 0; out[d + 2] = n ? b / n : 0;
    out[d + 3] = opaque * 2 >= all ? 255 : a / all;
  }
  return out;
}
