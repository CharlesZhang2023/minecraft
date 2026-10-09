// Saving a selection: the boxes are read from this player's copy of the world (what they can see, tile entities
// included), each box a region, block states named the Java way with this game's exact block alongside.
import type { Client, Mc } from '../sdk';
import { type Schematic, type Region, type Vec3, PaletteBuilder, newIndices, emptySchematic } from './model';
import { toJava, gameName, NEWEST } from './vanilla';
import { type Box, boxMin, boxSize } from './state';

let mc: Mc;
export function initCapture(m: Mc) { mc = m; nbDep = null; }
export const MAX_VOLUME = 16_000_000;

/** Blocks whose Java state depends on their neighbours (stairs, fences, chests, wire...). */
let nbDep: Uint8Array | null = null;
function dependsOnNeighbours(id: number): boolean {
  if (!nbDep) {
    nbDep = new Uint8Array(4096);
    for (let i = 0; i < mc.BLOCKS.length; i++) {
      const d = mc.BLOCKS[i];
      if (!d || d.missing || d.mod) continue;
      const a = Object.keys(toJava(mc.pack(i, 0)).props).length, b = Object.keys(toJava(mc.pack(i, 0), () => 0).props).length;
      nbDep[i] = a !== b ? 1 : 0;
    }
  }
  return nbDep[id] === 1;
}

/** Which of the boxes' chunks aren't loaded (as "x, z" of a block in them); empty when all are. */
export function unloaded(client: Client, boxes: Box[]): string[] {
  const out: string[] = [];
  for (const b of boxes) {
    const lo = boxMin(b), s = boxSize(b);
    for (let cx = lo[0] >> 4; cx <= (lo[0] + s[0] - 1) >> 4; cx++)
      for (let cz = lo[2] >> 4; cz <= (lo[2] + s[2] - 1) >> 4; cz++)
        if (!client.world?.getChunk(cx, cz)?.ready) out.push(`${cx * 16}, ${cz * 16}`);
  }
  return out;
}

export function capture(client: Client, boxes: Box[], name: string, author: string): Schematic {
  const w = client.world!;
  const vol = boxes.reduce((a, b) => { const s = boxSize(b); return a + s[0] * s[1] * s[2]; }, 0);
  if (!boxes.length) throw new Error('Select an area first (the wand: left-click one corner, right-click the other)');
  if (vol > MAX_VOLUME) throw new Error(`The selection is too big (${vol.toLocaleString()} blocks; at most ${MAX_VOLUME.toLocaleString()})`);
  const missing = unloaded(client, boxes);
  if (missing.length) throw new Error(`Part of the selection isn't loaded (near ${missing[0]}): go closer and save again`);
  const s = emptySchematic(name);
  s.author = author;
  s.dataVersion = NEWEST;
  const origin: Vec3 = [Infinity, Infinity, Infinity];
  for (const b of boxes) { const m = boxMin(b); for (let a = 0; a < 3; a++) origin[a] = Math.min(origin[a], m[a]); }
  boxes.forEach((b, bi) => {
    const lo = boxMin(b), size = boxSize(b);
    const pal = new PaletteBuilder();
    const byValue = new Map<number, number>();
    const n = size[0] * size[1] * size[2];
    const idx = new Uint32Array(n);
    const region: Region = { name: boxes.length > 1 ? `Box ${bi + 1}` : 'Main', pos: [lo[0] - origin[0], lo[1] - origin[1], lo[2] - origin[2]], size, palette: [], blocks: idx, tiles: [], entities: [] };
    let i = 0;
    for (let y = 0; y < size[1]; y++)
      for (let z = 0; z < size[2]; z++)
        for (let x = 0; x < size[0]; x++, i++) {
          const wx = lo[0] + x, wy = lo[1] + y, wz = lo[2] + z;
          const v = w.get(wx, wy, wz);
          if (!v) continue;
          if (dependsOnNeighbours(v & 0xfff)) {
            const st = toJava(v, (dx, dy, dz) => w.get(wx + dx, wy + dy, wz + dz));
            st.game = gameName(v);
            idx[i] = pal.add(st);
          } else {
            let p = byValue.get(v);
            if (p === undefined) { const st = toJava(v); st.game = gameName(v); p = pal.add(st); byValue.set(v, p); }
            idx[i] = p;
          }
          const t = w.getTile(wx, wy, wz);
          if (t) region.tiles.push({ i, game: JSON.parse(JSON.stringify(t)) });
        }
    region.palette = pal.list;
    const blocks = newIndices(n, pal.list.length);
    blocks.set(idx);
    region.blocks = blocks;
    s.regions.push(region);
  });
  return s;
}
