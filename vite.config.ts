import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
    // multiplayer.json points at /signal: in development that's the deployed signaling Worker
    proxy: { '/signal': { target: 'https://mc-signal.charles2023.workers.dev', changeOrigin: true, ws: true } },
  },
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 100000000 },
});
