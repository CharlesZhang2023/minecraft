// Mods inside a worker (mesher / terrain generator): the page's first message carries its texture numbering, the
// active mods' code and the id numbering. Each mod's `main` runs here too, so its blocks (with their models) and
// world features exist in this thread exactly as in the page.
import { adoptTextures } from '../world/blocks';
import { bind, type WorkerRegistry } from './registry';
import { modState, isActive, guard, reportError } from './state';
import { createContext, commonMc, type Mc } from './api';
import { setWorkerConfigValues } from './config';
import { FEATURES, type ChunkGenCtx } from './hooks';
import { Random, hashString } from '../noise';
import type { ModManifest, ModModule } from './types';
import type { Dimension } from '../world/world';

export interface WorkerModsMsg { type: 'mods'; mods: { manifest: ModManifest; code: string }[]; registry: WorkerRegistry; configs: Record<string, Record<string, unknown>> }

export async function initWorkerMods(msg: WorkerModsMsg) {
  modState.realm = 'worker';
  setWorkerConfigValues(msg.configs ?? {});
  adoptTextures(msg.registry.textures);
  for (const m of msg.mods) {
    const url = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
    try {
      const mod = (await import(/* @vite-ignore */ url)) as ModModule;
      const main = mod[m.manifest.entrypoints?.main ?? 'main'] as ModModule['main'];
      if (main) await main(createContext(m.manifest, commonMc as Mc, null));
    } catch (e) {
      reportError(m.manifest.id, 'loading in a worker', e);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  modState.active = new Set(msg.registry.active);
  bind({ blocks: msg.registry.blocks, items: {} });
}

/** Run the active mods' world features on a freshly generated chunk (before anything hashes or saves it). */
export function applyFeatures(blocks: Uint16Array, biomes: Uint8Array, cx: number, cz: number, seed: number, dim: Dimension) {
  if (!FEATURES.length) return;
  for (const f of FEATURES) {
    if (!isActive(f.mod) || !(f.spec.dims ?? ['overworld']).includes(dim)) continue;
    const rng = new Random((hashString(f.key) ^ Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77) ^ seed) >>> 0);
    const c: ChunkGenCtx = {
      cx, cz, seed, dim, rng,
      get: (x, y, z) => (x < 0 || x > 15 || z < 0 || z > 15 || y < 0 || y > 255 ? 0 : blocks[x | (z << 4) | (y << 8)]),
      set: (x, y, z, v) => { if (x >= 0 && x <= 15 && z >= 0 && z <= 15 && y >= 0 && y <= 255) blocks[x | (z << 4) | (y << 8)] = v; },
      height: (x, z) => {
        for (let y = 255; y >= 0; y--) if (blocks[x | (z << 4) | (y << 8)] & 0xfff) return y;
        return -1;
      },
      biome: (x, z) => biomes[(z & 15) * 16 + (x & 15)],
    };
    guard(f.mod, `world feature ${f.key}`, () => f.spec.generate(c), undefined);
  }
}
