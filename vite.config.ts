import { defineConfig, type Plugin } from 'vite';
import { modsPlugin } from './tools/vite-mods.ts';
import { packsPlugin } from './tools/vite-packs.ts';
import { agentBridge } from './tools/agent/bridge.ts';
import { fontPlugin } from './tools/vite-font.ts';
import fs from 'node:fs';

/** Writes precache.json: every file of the build, so the service worker can make the game work offline. */
const precacheList = (): Plugin => ({
  name: 'precache-list',
  apply: 'build',
  generateBundle(_, bundle) {
    // mods and packs are fetched (and kept in IndexedDB) only when a player installs or needs them; the physics engine
    // (4 MB, only for worlds with sub-levels) is cached by the service worker the first time it's loaded
    // the translations and the Unifont glyphs are fetched when a language or a script needs them, and kept by the
    // service worker from then on
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'precache.json' && !f.startsWith('mods/') && !f.startsWith('packs/') && !f.startsWith('font/') && !/(^|\/)(rapier|zh_cn|zh_tw)-/.test(f));
    // the recorded sounds' index (public/sounds, from tools/sounds/make.mjs); the sound effects and music are kept
    // by the game itself once downloaded (src/net/cdn.ts), from the CDN where it's quicker
    if (fs.existsSync('public/sounds/index.json')) files.push('sounds/index.json');
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
  plugins: [modsPlugin(), packsPlugin(), fontPlugin(), precacheList(), agentBridge()],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 100000000 },
});
