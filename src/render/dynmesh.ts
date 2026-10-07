/**
 * Growable geometry built on the CPU every frame (particles, items, entities' block parts, mods' drawing): quads of
 * pos(3 floats) uv(3 floats: u, v, layer) colour(4 bytes) light(2 bytes) = 32 bytes a vertex. The renderer copies it
 * to the GPU when it's drawn, whichever backend that is.
 */
export class DynMesh {
  data = new ArrayBuffer(1 << 16);
  f32 = new Float32Array(this.data);
  u8 = new Uint8Array(this.data);
  count = 0;
  reset() { this.count = 0; }
  private grow() {
    const nd = new ArrayBuffer(this.data.byteLength * 2);
    new Uint8Array(nd).set(this.u8);
    this.data = nd;
    this.f32 = new Float32Array(nd);
    this.u8 = new Uint8Array(nd);
  }
  /** light: sky, block in 0..15; col 0xRRGGBB; a alpha 0..1 */
  v(x: number, y: number, z: number, u: number, v: number, layer: number, col: number, a: number, sky: number, blk: number) {
    if ((this.count + 1) * 32 > this.data.byteLength) this.grow();
    const o = this.count * 8;
    const f = this.f32;
    f[o] = x; f[o + 1] = y; f[o + 2] = z; f[o + 3] = u; f[o + 4] = v; f[o + 5] = layer;
    const b = o * 4 + 24;
    const u8 = this.u8;
    u8[b] = (col >> 16) & 255; u8[b + 1] = (col >> 8) & 255; u8[b + 2] = col & 255; u8[b + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    u8[b + 4] = Math.round(sky * 17); u8[b + 5] = Math.round(blk * 17);
    this.count++;
  }
  /** The vertices written so far. */
  bytes() { return this.u8.subarray(0, this.count * 32); }
}
