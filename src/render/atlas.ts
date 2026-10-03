import { GL } from './gl';
import { TEXTURES, tex } from '../world/blocks';
import { buildBlockTextures, ANIMATED, animatedFrame } from './textures';
import { Img, S } from './pixels';

/** Block textures as a TEXTURE_2D_ARRAY (one 16x16 layer per texture) with mip-maps. */
export class BlockAtlas {
  texture: WebGLTexture;
  layers: number;
  private anim: { layer: number; frames: Img[]; speed: number }[] = [];
  /** Each layer's average colour (its 1x1 mip level), r g b a in 0..255. */
  private averages: [number, number, number, number][] = [];

  constructor(private gl: GL, extra: { name: string; img: Img }[] = []) {
    // extra textures (item sprites used as particles, etc.)
    for (const e of extra) tex(e.name);
    const imgs = buildBlockTextures();
    for (const e of extra) imgs[TEXTURES.indexOf(e.name)] = e.img;
    this.layers = TEXTURES.length;
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    const levels = 5;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, S, S, this.layers);
    for (let i = 0; i < this.layers; i++) this.uploadLayer(i, imgs[i]);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels - 1);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const [name, a] of Object.entries(ANIMATED)) {
      const layer = TEXTURES.indexOf(name);
      if (layer < 0) continue;
      const frames: Img[] = [];
      for (let f = 0; f < a.frames; f++) frames.push(animatedFrame(name, f));
      this.anim.push({ layer, frames, speed: a.speed });
    }
  }

  /** Upload a layer plus hand-built mips (alpha-aware box filter keeps cutout textures from vanishing). */
  private uploadLayer(layer: number, img: Img) {
    const gl = this.gl;
    let size = S;
    let cur = img;
    for (let level = 0; level < 5; level++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, cur);
      if (size === 1) break;
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
    }
    this.averages[layer] = [cur[0], cur[1], cur[2], cur[3]];
  }

  /** The average colour of a texture, by name. */
  average(name: string): [number, number, number, number] | undefined {
    const i = TEXTURES.indexOf(name);
    return i < 0 ? undefined : this.averages[i];
  }

  tick(ticks: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    for (const a of this.anim) {
      if (ticks % a.speed !== 0) continue;
      const f = Math.floor(ticks / a.speed) % a.frames.length;
      this.uploadLayer(a.layer, a.frames[f]);
    }
  }
}
