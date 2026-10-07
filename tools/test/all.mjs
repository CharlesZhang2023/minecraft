// Run the 1.16 test suite one test after another and summarise: node tools/test/all.mjs [node|browser|name,name]
// (browser tests need the dev server: npx vite --port 5177 --strictPort, or MC_PORT=...; MC_GFX=webgl2 draws with WebGL 2)
import { spawnSync } from 'node:child_process';

const NODE = ['registry', 'recipes', 'nether', 'end', 'overworld'];
const BROWSER = ['families', 'stations', 'nethermobs', 'overworldmobs', 'animals', 'combat', 'progression', 'villages', 'blockrules', 'signs', 'extras', 'endcity', 'banners', 'maps', 'books', 'advancements', 'villagelife', 'bells', 'recipebook', 'commandblocks', 'dispensers', 'chests'];
const arg = process.argv[2];
const pick = !arg ? [...NODE, ...BROWSER] : arg === 'node' ? NODE : arg === 'browser' ? BROWSER : arg.split(',');
const results = [];
for (const name of pick) {
  const ts = NODE.includes(name);
  const args = ts ? ['tools/test/run.mjs', `tools/test/${name}.ts`] : [`tools/test/${name}.mjs`];
  const t0 = Date.now();
  const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
  const last = out.trim().split('\n').pop();
  results.push({ name, ok: r.status === 0, secs: ((Date.now() - t0) / 1000).toFixed(0), last, fails });
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${name.padEnd(14)} ${results.at(-1).secs}s  ${last}`);
  for (const f of fails) console.log('       ' + f);
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
