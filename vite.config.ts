import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 100000000 },
});
