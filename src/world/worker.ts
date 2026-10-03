/// <reference lib="webworker" />
import { WorldGen } from './worldgen';
import { buildChunk, lightChunk } from './mesher';
import { NetherGen } from './nethergen';
import { EndGen } from './endgen';
import { initWorkerMods, applyFeatures, type WorkerModsMsg } from '../mod/worker';

let gen: WorldGen | null = null;
let nether: NetherGen | null = null;
let end: EndGen | null = null;

export type WorkerRequest =
  | { type: 'gen'; id: number; seed: number; cx: number; cz: number; dim: string }
  | { type: 'mesh'; id: number; cx: number; cz: number; chunks: Uint16Array[]; biomes: Uint8Array[]; sky: boolean }
  | { type: 'light'; id: number; cx: number; cz: number; chunks: Uint16Array[]; sky: boolean }
  | WorkerModsMsg;

/** Mods: set up by the page's first message; jobs wait for it. */
let ready: Promise<void> | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'mods') { ready = initWorkerMods(msg); return; }
  if (ready) ready.then(() => handle(msg));
  else handle(msg);
};

function handle(msg: Exclude<WorkerRequest, WorkerModsMsg>) {
  if (msg.type === 'gen') {
    let r;
    if (msg.dim === 'nether') {
      if (!nether || nether.seed !== msg.seed) nether = new NetherGen(msg.seed);
      r = nether.generate(msg.cx, msg.cz);
    } else if (msg.dim === 'end') {
      if (!end || end.seed !== msg.seed) end = new EndGen(msg.seed);
      r = end.generate(msg.cx, msg.cz);
    } else {
      if (!gen || gen.seed !== msg.seed) gen = new WorldGen(msg.seed);
      r = gen.generate(msg.cx, msg.cz);
    }
    applyFeatures(r.blocks, r.biomes, msg.cx, msg.cz, msg.seed, msg.dim as 'overworld');
    (self as unknown as Worker).postMessage({ type: 'gen', id: msg.id, cx: msg.cx, cz: msg.cz, blocks: r.blocks, biomes: r.biomes, spawns: r.spawns ?? [] }, [r.blocks.buffer, r.biomes.buffer]);
  } else if (msg.type === 'light') {
    const r = lightChunk(msg.chunks, msg.sky);
    (self as unknown as Worker).postMessage({ type: 'light', id: msg.id, cx: msg.cx, cz: msg.cz, ...r }, [r.light.buffer, r.heightmap.buffer]);
  } else if (msg.type === 'mesh') {
    const r = buildChunk(msg.chunks, msg.biomes, msg.sky);
    (self as unknown as Worker).postMessage(
      { type: 'mesh', id: msg.id, cx: msg.cx, cz: msg.cz, ...r },
      [r.light.buffer, r.opaque, r.trans, r.heightmap.buffer],
    );
  }
}
