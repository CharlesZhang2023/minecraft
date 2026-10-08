// The language tables: every translation keeps its English's placeholders ({0}, {1}...) and formatting codes, the
// Traditional Chinese table has the same strings and is up to date with the Simplified ones.
//   node tools/test/run.mjs tools/test/translations.ts
import { spawnSync } from 'node:child_process';
import zhCN from '../../src/i18n/zh_cn';
import zhTW from '../../src/i18n/zh_tw';
import { check, done } from './check';

const marks = (s: string) => [...(s.match(/\{\d+\}/g) ?? [])].sort().join(' ');
const codes = (s: string) => (s.match(/§./g) ?? []).length;
for (const [name, table] of [['zh_cn', zhCN], ['zh_tw', zhTW]] as const) {
  const bad = Object.entries(table).filter(([en, zh]) => marks(en) !== marks(zh) || codes(en) !== codes(zh) || !zh.trim());
  check(bad.length === 0, `${name}: placeholders and formatting codes kept (${bad.slice(0, 5).map(([en, zh]) => `${en} -> ${zh}`).join(' | ')})`);
}
const cn = Object.keys(zhCN), tw = new Set(Object.keys(zhTW));
check(cn.length === tw.size && cn.every((k) => tw.has(k)), `zh_tw has the same ${cn.length} strings as zh_cn (${tw.size})`);
const r = spawnSync('node', ['tools/test/run.mjs', 'tools/i18n/zh_tw.ts', '--check'], { encoding: 'utf8' });
check(r.status === 0, `zh_tw.ts is made from the current tables (${(r.stderr || r.stdout).trim()})`);
done();
