// Small raster helpers for 16x16 procedural pixel art.
import { Random, hashString } from '../noise';

export const S = 16;
export type Img = Uint8ClampedArray;
export type RGB = [number, number, number];

export function newImg(w = S, h = S): Img {
  return new Uint8ClampedArray(w * h * 4);
}

export function hex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function set(img: Img, x: number, y: number, c: RGB, a = 255, w = S) {
  if (x < 0 || y < 0 || x >= w || y >= img.length / 4 / w) return;
  const i = (y * w + x) * 4;
  img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = a;
}
export function get(img: Img, x: number, y: number, w = S): [number, number, number, number] {
  const i = (y * w + x) * 4;
  return [img[i], img[i + 1], img[i + 2], img[i + 3]];
}

export function rngFor(name: string) {
  return new Random(hashString('tex:' + name) ^ 0x51f15e);
}

export function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as RGB;
}

/** Tileable blobby noise field in [0,1], 16x16. */
export function blobField(r: Random, passes = 1, w = S, h = S): Float32Array {
  let f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = r.next();
  for (let p = 0; p < passes; p++) {
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
            s += f[((y + dy + h) % h) * w + ((x + dx + w) % w)] * wgt;
          }
        g[y * w + x] = s / 16;
      }
    f = g;
  }
  // normalise
  let mn = 1e9, mx = -1e9;
  for (const v of f) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mn) / (mx - mn || 1);
  return f;
}

/** Fill using palette picked from a noise field blended with per-pixel jitter. */
export function paletteNoise(img: Img, r: Random, pal: RGB[], opts: { passes?: number; jitter?: number; bias?: number } = {}) {
  const f = blobField(r, opts.passes ?? 1);
  const jitter = opts.jitter ?? 0.35;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = f[y * S + x] * (1 - jitter) + r.next() * jitter + (opts.bias ?? 0);
      v = Math.max(0, Math.min(0.9999, v));
      set(img, x, y, pal[Math.floor(v * pal.length)]);
    }
}

/** Draw pixel-art from rows of characters mapped via a palette. '.' = transparent. */
export function art(img: Img, rows: string[], pal: Record<string, RGB | [number, number, number, number]>, ox = 0, oy = 0, w = S) {
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = pal[ch];
      if (!c) continue;
      set(img, x + ox, y + oy, [c[0], c[1], c[2]], c.length > 3 ? (c as number[])[3] : 255, w);
    }
}

export function copy(src: Img): Img {
  return new Uint8ClampedArray(src);
}

/** Voronoi cells, tileable. Returns [cellIndex, edgeDistance] per pixel. */
export function voronoi(r: Random, n: number): { cell: Int32Array; edge: Float32Array; pts: [number, number][] } {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([r.next() * S, r.next() * S]);
  const cell = new Int32Array(S * S), edge = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let i = 0; i < n; i++)
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x + 0.5 - (pts[i][0] + ox * S), dy = y + 0.5 - (pts[i][1] + oy * S);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; best = i; }
            else if (d < d2) d2 = d;
          }
      cell[y * S + x] = best;
      edge[y * S + x] = d2 - d1;
    }
  return { cell, edge, pts };
}
