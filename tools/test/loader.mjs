// Run one of the game's TypeScript files in Node (tests, generator checks):
//   node tools/test/run.mjs tools/test/determinism.ts [args...]
// The file is bundled with rolldown (the bundler Vite uses) into node_modules/.cache, then imported.
import { rolldown } from 'rolldown';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

export async function runTs(file, args = []) {
  const out = path.resolve('node_modules/.cache/ts-run');
  mkdirSync(out, { recursive: true });
  const bundle = await rolldown({
    input: path.resolve(file), platform: 'node', logLevel: 'warn',
    // workers and Vite-only imports aren't needed by tests
    resolve: { extensions: ['.ts', '.js', '.mjs'] },
    transform: { define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' } },
  });
  const name = path.basename(file).replace(/\.ts$/, '') + '.mjs';
  await bundle.write({ dir: out, format: 'esm', entryFileNames: name, sourcemap: 'inline' });
  await bundle.close();
  process.argv = [process.argv[0], file, ...args];
  await import(pathToFileURL(path.join(out, name)).href + '?t=' + Date.now());
}
