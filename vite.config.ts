import { defineConfig, type Plugin } from 'vite';
import { modsPlugin } from './tools/vite-mods.ts';
import { agentBridge } from './tools/agent/bridge.ts';

/** Writes precache.json: every file of the build, so the service worker can make the game work offline. */
const precacheList = (): Plugin => ({
  name: 'precache-list',
  apply: 'build',
  generateBundle(_, bundle) {
    // mods are fetched (and kept in IndexedDB) only when a player installs or needs them; the physics engine
    // (4 MB, only for worlds with sub-levels) is cached by the service worker the first time it's loaded
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'precache.json' && !f.startsWith('mods/') && !/(^|\/)rapier-/.test(f));
    this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
  },
});

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
    // multiplayer.json points at /signal: in development that's the deployed signaling Worker
    proxy: { '/signal': { target: 'https://mc-signal.charles2023.workers.dev', changeOrigin: true, ws: true } },
  },
  plugins: [modsPlugin(), precacheList(), agentBridge()],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 100000000 },
});
