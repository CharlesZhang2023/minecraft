import { defineConfig, type Plugin } from 'vite';

/** Writes precache.json: every file of the build, so the service worker can make the game work offline. */
const precacheList = (): Plugin => ({
  name: 'precache-list',
  apply: 'build',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'precache.json');
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
  plugins: [precacheList()],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 100000000 },
});
