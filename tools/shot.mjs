// Usage: node tools/shot.mjs <url-query> <out.png> [waitMs] [js-to-eval-after-load]
import { chromium } from 'playwright';

const [, , query = '', out = 'shots/shot.png', wait = '8000', evalJs = ''] = process.argv;
const url = `http://127.0.0.1:5173/${query}`;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(parseInt(wait));
if (evalJs) {
  const r = await page.evaluate(evalJs);
  if (r !== undefined) console.log('eval:', JSON.stringify(r).slice(0, 2000));
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 40).join('\n'));
await browser.close();
