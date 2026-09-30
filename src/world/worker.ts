/// <reference lib="webworker" />
import { WorldGen } from './worldgen';
import { buildChunk } from './mesher';

let gen: WorldGen | null = null;

export type WorkerRequest =
  | { type: 'gen'; id: number; seed: number; cx: number; cz: number }
  | { type: 'mesh'; id: number; cx: number; cz: number; chunks: Uint16Array[]; biomes: Uint8Array[] };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'gen') {
    if (!gen || gen.seed !== msg.seed) gen = new WorldGen(msg.seed);
    const r = gen.generate(msg.cx, msg.cz);
    (self as unknown as Worker).postMessage({ type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, blocks: r.blocks, biomes: r.biomes }, [r.blocks.buffer, r.biomes.buffer]);
  } else if (msg.type === 'mesh') {
    const r = buildChunk(msg.chunks, msg.biomes);
    (self as unknown as Worker).postMessage(
      { type: 'mesh', id: msg.id, cx: msg.cx, cz: msg.cz, ...r },
      [r.light.buffer, r.opaque, r.trans, r.heightmap.buffer],
    );
  }
};
