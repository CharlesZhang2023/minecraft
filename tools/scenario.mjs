// Usage: node tools/scenario.mjs <scenario.json>
// scenario: { query, width?, height?, steps: [{ wait?, eval?, shot?, keys?, mouse? }] }
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const sc = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: sc.width ?? 1280, height: sc.height ?? 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://127.0.0.1:5173/${sc.query ?? ''}`);
for (const st of sc.steps) {
  if (st.wait) await page.waitForTimeout(st.wait);
  if (st.eval) {
    try {
      const r = await page.evaluate(st.eval);
      if (r !== undefined && r !== null) console.log('eval:', JSON.stringify(r).slice(0, 3000));
    } catch (e) {
      console.log('eval error:', e.message);
    }
  }
  if (st.keys) for (const k of st.keys) await page.keyboard.press(k);
  if (st.after) await page.waitForTimeout(st.after);
  if (st.shot) {
    await page.screenshot({ path: st.shot });
    console.log('shot', st.shot);
  }
}
const errs = logs.filter((l) => !l.includes('[vite]') && !l.includes('[debug]'));
if (errs.length) console.log(errs.slice(0, 40).join('\n'));
await browser.close();
