// Advancements in a running world: items carried earn the Minecraft tab's first steps (and the client hears of it),
// kills and other events earn theirs, "every one of" ones count progress, structures are recognised where the player
// stands, and L opens the screen.
//   node tools/test/advancements.mjs
import { openWorld, wait } from './browser.mjs';

const t = await openWorld({ seed: 31, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

await t.page.evaluate(async () => {
  const { I, stack, itemId } = await import('/src/game/items.ts');
  const { B } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    p.inventory.main[1] = stack(B.CRAFTING_TABLE);
    p.inventory.main[2] = stack(B.COBBLESTONE, 10);
    p.inventory.main[3] = stack(I.IRON_INGOT, 3);
    p.inventory.main[4] = stack(itemId('iron_pickaxe'));
  });
});
await wait(1800);
const items = await t.page.evaluate(async () => {
  const server = await window.sim((g) => ['story/root', 'story/mine_stone', 'story/smelt_iron', 'story/iron_tools', 'story/mine_diamond'].map((id) => g.players[0].achievements.has('adv:' + id)));
  const client = ['story/root', 'story/smelt_iron'].map((id) => window.game.achievements.has('adv:' + id));
  return { server, client };
});
ok(items.server.slice(0, 4).every(Boolean) && !items.server[4], `carrying a crafting table, cobblestone, iron and an iron pickaxe earns the first steps (${items.server})`);
ok(items.client.every(Boolean), 'and the client is told');

const events = await t.page.evaluate(() => window.sim((g, p) => {
  const a = g.players[0].achievements;
  const z = g.interact.spawnMob('zombie', p.x + 2, p.y, p.z);
  z.damage(100, 'player', p);
  a.event('eat', { ate: 'apple' });
  a.event('breed', { bred: 'Cow' });
  a.event('kill', { type: 'Skeleton', distance: 60, source: 'arrow', kill: 'Skeleton' });
  return ['adventure/root', 'adventure/kill_a_mob', 'husbandry/root', 'husbandry/breed_an_animal', 'adventure/sniper_duel', 'adventure/trade'].map((id) => a.has('adv:' + id)).concat([a.progressOf({ id: 'adventure/kill_all_mobs', every: () => ['Zombie', 'Skeleton', 'Creeper'] })[0]]);
}));
ok(events.slice(0, 5).every(Boolean) && !events[5], `kills, eating and breeding earn theirs (${events.slice(0, 6)})`);
ok(events[6] === 2, `"every one of" ones count progress (${events[6]} of 3 kinds killed)`);

const where = await t.page.evaluate(async () => {
  const { structuresAt } = await import('/src/game/advscan.ts');
  const { WorldGen } = await import('/src/world/worldgen.ts');
  const { nearestStart } = await import('/src/world/structure.ts');
  const { OVERWORLD_STRUCTURES } = await import('/src/world/structures/overworld.ts');
  const gen = new WorldGen(31);
  const type = OVERWORLD_STRUCTURES.find((s) => s.name === 'desert_pyramid');
  const s = nearestStart(type, gen, 0, 0, 30);
  if (!s) return null;
  const inside = structuresAt('overworld', 31, (s.box.x0 + s.box.x1) / 2, s.y + 2, (s.box.z0 + s.box.z1) / 2);
  const outside = structuresAt('overworld', 31, s.box.x0 - 200, s.y + 2, s.box.z0 - 200);
  return { inside: [...inside], outside: [...outside] };
});
ok(where && where.inside.includes('desert_pyramid') && !where.outside.includes('desert_pyramid'), `standing in a structure is recognised (${JSON.stringify(where)})`);

await t.page.keyboard.press('KeyL');
await wait(500);
const scr = await t.page.evaluate(() => window.game.ui.screen?.constructor?.name ?? null);
ok(scr === 'AdvancementsScreen', `L opens the advancements (${scr})`);
await t.shot('advancements');
await t.page.evaluate(() => { window.game.ui.screen.tab = 'adventure'; });
await wait(300);
await t.shot('advancements-adventure');

ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
