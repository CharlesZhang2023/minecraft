// Unpacks icons.ts (the format is described in tools/make_icons.py): every Noita icon as 16x16 RGBA, by name.
// Pure: no game imports, so tools and tests can run it too.

/** Each icon's pixels (256 x RGBA), keyed by the spell's English name in lower case. */
export function decodeIcons(names: string[], palette: string, data: string): Map<string, Uint8Array> {
  const b64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const pal = b64(palette), bytes = b64(data);
  let pos = 0;
  const read = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v |= ((bytes[pos >> 3] >> (pos & 7)) & 1) << i;
    return v;
  };
  const out = new Map<string, Uint8Array>();
  for (const name of names) {
    const n = read(6), local: number[] = [];
    for (let i = 0; i < n; i++) local.push(read(11));
    const cbits = n > 1 ? Math.ceil(Math.log2(n)) : 0;
    const x0 = read(4), y0 = read(4), x1 = read(4), y1 = read(4);
    const px = new Uint8Array(256 * 4);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!read(1)) continue;
        const c = local[cbits ? read(cbits) : 0];
        px.set(pal.subarray(c * 4, c * 4 + 4), (y * 16 + x) * 4);
      }
    out.set(name.toLowerCase(), px);
  }
  return out;
}
