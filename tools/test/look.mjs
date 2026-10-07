// Close-ups of mobs on a platform, for checking models and skins: output/tests/look-<n>.png per group.
//   node tools/test/look.mjs kind,kind/kind,kind,... [yaw]
import { openWorld, wait } from './browser.mjs';

const groups = process.argv[2].split('/').map((g) => g.split(','));
const yaw = Number(process.argv[3] ?? 150);
const t = await openWorld({ seed: 31, mode: 1 });
for (const [gi, kinds] of groups.entries()) {
  const at = await t.sim((g, p, [kinds, yaw, gi]) => {
    const w = g.world, x0 = Math.floor(p.x) + 2 + (gi % 2) * 40, y = 150 + (gi >> 1) * 12, z0 = Math.floor(p.z) + 6;
    for (let x = -3; x < 30; x++) for (let z = -5; z < 7; z++) { w.set(x0 + x, y - 1, z0 + z, 1); for (let k = 0; k < 6; k++) w.set(x0 + x, y + k, z0 + z, 0); }
    kinds.forEach((k, i) => {
      const m = g.interact.spawnMob(k, x0 + i * 3 + 0.5, y + (['phantom', 'vex', 'bee', 'parrot'].includes(k) ? 1 : 0), z0 + 0.5);
      if (m) { m.noAi = true; m.yaw = m.bodyYaw = m.headYaw = yaw; }
    });
    return { x0, y, z0 };
  }, [kinds, yaw, gi]);
  await t.settle(1200);
  await t.look(at.x0 + (kinds.length - 1) * 1.5, at.y + 1.4, at.z0 - 2.5 - kinds.length * 1.1, 0, 12, 60);
  await wait(700);
  await t.shot('look-' + gi);
}
if (t.errors.length) console.log(t.errors);
await t.close();
