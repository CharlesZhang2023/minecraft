/// <reference lib="webworker" />
// Builds distant-terrain tiles (see lodgen.ts) off the main thread.
import { WorldGen } from './worldgen';
import { buildLodTile, type LodPalette } from './lodgen';

export type LodWorkerRequest =
  | { type: 'init'; seed: number; palette: LodPalette }
  | { type: 'tile'; key: string; level: number; tx: number; tz: number };

let gen: WorldGen | null = null;
let palette: LodPalette = {};

self.onmessage = (e: MessageEvent<LodWorkerRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new WorldGen(m.seed);
    palette = m.palette;
  } else if (m.type === 'tile' && gen) {
    const r = buildLodTile(gen, palette, m.level, m.tx, m.tz);
    (self as unknown as Worker).postMessage({ type: 'tile', key: m.key, ...r }, [r.data]);
  }
};
