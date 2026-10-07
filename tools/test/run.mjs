#!/usr/bin/env node
// node tools/test/run.mjs <file.ts> [args...]: bundle a TypeScript file of the game and run it in Node.
import { runTs } from './loader.mjs';

const [file, ...args] = process.argv.slice(2);
if (!file) {
  console.error('usage: node tools/test/run.mjs <file.ts> [args...]');
  process.exit(2);
}
await runTs(file, args);
