// Shared set-up for the browser tests in tools/test: a headless Chromium on the dev server, a fresh world, and
// helpers to run code in the simulation and take pictures. Pictures go to output/tests (gitignored).
//   const t = await openWorld({ port: 5177, seed: 7, mode: 1 });  ... await t.close();
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export const OUT = 'output/tests';
mkdirSync(OUT, { recursive: true });
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openWorld({ port = process.env.MC_PORT ?? '5177', seed = 12345, mode = 1, time = 6000, extra = '', width = 1000, height = 600, dim } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?autoplay&seed=${seed}&mode=${mode}&time=${time}&id=t${Date.now()}${extra}`);
  await page.waitForFunction(() => window.game?.arrived && !window.game.ui.screen && window.game.loadProgress() > 0.99, null, { timeout: 60000 });
  const t = {
    page, browser, errors,
    /** Run fn(g, p, args) inside the simulation as the first player. */
    sim: (fn, args) => page.evaluate(([src, a]) => window.sim((g, p) => (0, eval)(src)(g, p, a)), [fn.toString(), args ?? null]),
    /** Evaluate in the page with the game's modules at hand: fn({ blocks, items, ... }, args). */
    run: (fn, args) => page.evaluate(async ([src, a]) => {
      const mods = { blocks: await import('/src/world/blocks.ts'), items: await import('/src/game/items.ts') };
      return (0, eval)(src)(mods, a);
    }, [fn.toString(), args ?? null]),
    shot: (name) => page.screenshot({ path: `${OUT}/${name}.png` }),
    /** Fix the camera (degrees; pitch > 0 looks down) and hide the HUD; look(null) gives it back. */
    look: (x, y, z, yaw = 180, pitch = 30, fov = 70) => page.evaluate(([x, y, z, yaw, pitch, fov]) => {
      const g = window.game;
      if (x === null) { g.cameraOverride = null; g.hideHud = false; return; }
      g.cameraOverride = { x, y, z, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180, fov };
      g.hideHud = true;
    }, [x, y, z, yaw, pitch, fov]),
    /** Let the world settle (meshes, ticks). */
    settle: async (ms = 1500) => { await wait(ms); await page.waitForFunction(() => window.game.loadProgress() > 0.99, null, { timeout: 30000 }); },
    close: () => browser.close(),
  };
  if (dim) await t.sim((g, p, d) => g.travel?.(d, true), dim);
  return t;
}
