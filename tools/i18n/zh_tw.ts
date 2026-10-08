// Makes src/i18n/zh_tw.ts (Traditional Chinese, Taiwan) from the Simplified Chinese tables, with OpenCC (Simplified to
// Traditional with Taiwan's characters and phrases: 网络 -> 網路, 默认 -> 預設), then FIXES for what it gets wrong here.
//   npm run i18n            (write it)
//   npm run i18n -- --check (fail if it's out of date)
import { Converter } from 'opencc-js';
import { readFileSync, writeFileSync } from 'node:fs';
import zhCN from '../../src/i18n/zh_cn';

/** After conversion: characters and words OpenCC picks wrongly for the game's words. */
const FIXES: [string, string][] = [
  ['鍾', '鐘'], // 钟: a bell, not the surname
  ['臺', '台'], // workstations: 工作台, 附魔台 (Taiwan writes 台)
  ['巖', '岩'], // stone names: 閃長岩, 玄武岩
  ['程式碼', '代碼'], // a code to join with (代码) isn't program code
  ['游玩', '遊玩'],
  ['攝像頭', '相機'],
  ['獲取', '取得'],
  ['自定義', '自訂'],
  ['視場角', '視野'],
  // Taiwan's quotation marks
  ['“', '「'], ['”', '」'], ['‘', '『'], ['’', '』'],
];

const OUT = 'src/i18n/zh_tw.ts';
const convert = Converter({ from: 'cn', to: 'twp' });
const fix = (s: string) => FIXES.reduce((t, [a, b]) => t.split(a).join(b), s);

const lines = Object.entries(zhCN).map(([en, zh]) => `  ${JSON.stringify(en)}: ${JSON.stringify(fix(convert(zh)))},`);
const text = `// Traditional Chinese (台灣), made from the Simplified Chinese tables (zh_cn.ts, zh_cn_names.ts) by
// tools/i18n/zh_tw.ts: \`npm run i18n\`. Don't edit this file: change those, or the fixes in the tool, and run it again.
export default {
${lines.join('\n')}
} as Record<string, string>;
`;

if (process.argv.includes('--check')) {
  let old = '';
  try { old = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
  if (old !== text) {
    console.error(`${OUT} is out of date: run npm run i18n`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date (${lines.length} strings)`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT} (${lines.length} strings)`);
}
