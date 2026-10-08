// Translations in a running world: every name of a thing has a Chinese one, and the screens, tooltips and chat show
// no English left over (what the font draws is recorded while each screen is open). Also: Traditional Chinese is made
// from the Simplified tables, messages made on the server are translated where they're shown, and the Chinese glyphs
// load.
//   node tools/test/i18n.mjs [zh_cn|zh_tw]
import { openWorld, wait } from './browser.mjs';
import { readdirSync, readFileSync, existsSync } from 'node:fs';

/** Packs' and mods' names and descriptions (shown as their authors wrote them), as patterns for their first words. */
const packDescriptions = () => [['packs', 'pack.json'], ['mods', 'mod.json']].flatMap(([dir, file]) => readdirSync(dir)
  .filter((d) => existsSync(`${dir}/${d}/${file}`)).map((d) => JSON.parse(readFileSync(`${dir}/${d}/${file}`, 'utf8')))
  .flatMap((m) => [m.name, m.description]).filter(Boolean)
  .map((s) => new RegExp('^' + s.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));

const lang = process.argv[2] ?? 'zh_cn';
const t = await openWorld({ seed: 4242, mode: 1, extra: `&lang=${lang}` });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// English that stays: names of things that aren't translated, key names, technical words and players' own text
const KEEP = /^([IVX]+|ABC|Minecraft|Web|Edition|WebGPU|WebGL|TypeScript|WebAudio|Claude|Code|Wi-Fi|Ctrl|Shift|TNT|C418|ID|keepInventory|doDaylightCycle|help|mc|online|node|tools|agent|mjs|Steve|Alex|fps|Mojang|PNG|zip|LAN|GUI|FOV|HUD|Test|World|pack|mcmeta|json|true|false|Vibrant|Iteration|Pastoral|ABC234)$/;
const english = (s) => (s.replace(/§./g, '').match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? []).filter((w) => !KEEP.test(w));

// ---- names: blocks, items, mobs, biomes, effects, enchantments, advancements
const names = await t.page.evaluate(async () => {
  const { t: tr, tc } = await import('/src/i18n/i18n.ts');
  const { BLOCKS, BLOCK_COUNT } = await import('/src/world/blocks.ts');
  const { ITEMS } = await import('/src/game/items.ts');
  const { BIOMES } = await import('/src/world/biomes.ts');
  const { EFFECTS } = await import('/src/game/potiondata.ts');
  const { ENCHANTS } = await import('/src/game/enchant.ts');
  const { ADVANCEMENTS } = await import('/src/game/advancements.ts');
  const { MOB_TYPES } = await import('/src/entity/registry.ts');
  const out = [];
  const check = (kind, en, zh) => { if (zh === en && !/^(TNT|Minecraft|Unused)$/.test(en)) out.push(`${kind}: ${en}`); };
  for (const b of BLOCKS.slice(1, BLOCK_COUNT)) check('block', b.display, tr(b.display));
  for (const it of ITEMS.values()) if (!it.mod && !it.missing) check('item', it.display, tr(it.display));
  for (const b of BIOMES) check('biome', b.name, tr(b.name));
  for (const e of Object.values(EFFECTS)) check('effect', e.name, tc('effect', e.name));
  for (const e of ENCHANTS) check('enchantment', e.name, tc('enchantment', e.name));
  for (const a of ADVANCEMENTS) { check('advancement', a.title, tr(a.title)); check('advancement', a.desc, tr(a.desc)); }
  const mobs = new Set();
  window.sim((g) => { for (const type of Object.keys(MOB_TYPES)) { const e = g.newEntity?.(type); if (e?.typeName) mobs.add(e.typeName); } });
  for (const m of mobs) check('mob', m, tr(m));
  return { missing: out, total: BLOCK_COUNT + ITEMS.size, mobs: mobs.size, wither: [tr('Wither'), tc('effect', 'Wither')] };
});
ok(names.missing.length === 0, `every name has a translation (${names.missing.length} missing${names.missing.length ? ': ' + names.missing.slice(0, 20).join(', ') : ''}; ${names.mobs} mobs)`);
ok(names.wither[0] !== names.wither[1], `the Wither and the effect are named apart (${names.wither.join(' / ')})`);

// ---- what the font draws on each screen
await t.page.evaluate(() => {
  // (the game's own Font class: a module imported here could be another copy of it)
  const Font = Object.getPrototypeOf(window.game.gui.font);
  const drawn = (window.__drawn = new Set());
  const draw = Font.draw;
  Font.draw = function (ctx, text, ...rest) { drawn.add(text); return draw.call(this, ctx, text, ...rest); };
});
const leftovers = new Map(), seen = [];
const collect = async (where) => {
  await wait(250);
  const texts = await t.page.evaluate(() => { const a = [...window.__drawn]; window.__drawn.clear(); return a; });
  for (const s of texts) for (const w of english(s)) if (!leftovers.has(s)) leftovers.set(s, where);
  seen.push(`${where} ${texts.length}`);
  return texts.length;
};
const client = (fn, args) => t.page.evaluate(([src, a]) => (0, eval)(src)(window.game, a), [fn.toString(), args ?? null]);

// the menus (the client's own screens)
const MENUS = ['OptionsScreen', 'MoreOptionsScreen', 'DistantTerrainScreen', 'ControlsScreen', 'LanguageScreen', 'PauseScreen', 'SelectWorldScreen', 'CreateWorldScreen', 'SleepScreen'];
for (const name of MENUS) {
  await t.page.evaluate(async (name) => { const M = await import('/src/ui/menus.ts'); const ui = window.game.ui; ui.open(new M[name](ui, ui.screen ?? new M.PauseScreen(ui))); }, name);
  await collect(name);
}
await t.page.evaluate(async () => {
  const ui = window.game.ui;
  const M = await import('/src/ui/menus.ts'), MP = await import('/src/ui/multiplayer.ts'), S = await import('/src/ui/stats.ts'), A = await import('/src/ui/advancements.ts');
  const { tm } = await import('/src/i18n/i18n.ts');
  window.__screens = [
    () => new M.DeathScreen(ui, tm('{0} was slain by {1}', 'Alex', tm('Zombie'))),
    () => new M.DisconnectedScreen(ui, 'You were kicked from the game'),
    () => new MP.MultiplayerScreen(ui, new M.PauseScreen(ui)),
    () => new MP.HostScreen(ui, new M.PauseScreen(ui)),
    () => { const s = new S.StatsScreen(ui, new M.PauseScreen(ui)); return s; },
    () => { const s = new S.StatsScreen(ui, new M.PauseScreen(ui)); s.tab = 'items'; return s; },
    () => { const s = new S.StatsScreen(ui, new M.PauseScreen(ui)); s.tab = 'mobs'; return s; },
    ...['story', 'nether', 'end', 'adventure', 'husbandry'].map((tab) => () => { const s = new A.AdvancementsScreen(ui); s.tab = tab; return s; }),
    // (splashes stay in English, as in the real game)
    () => Object.assign(new M.TitleScreen(ui), { splash: '' }),
  ];
});
const nScreens = await t.page.evaluate(() => window.__screens.length);
for (let i = 0; i < nScreens; i++) {
  await t.page.evaluate((i) => window.game.ui.open(window.__screens[i]()), i);
  await collect(`screen ${i}`);
}
for (const kind of ['resource', 'shader']) {
  await t.page.evaluate(async (kind) => { const P = await import('/src/ui/packs.ts'); const M = await import('/src/ui/menus.ts'); const ui = window.game.ui; ui.open(new P.PackScreen(ui, new M.PauseScreen(ui), kind)); }, kind);
  await wait(800);
  await collect(`${kind} packs`);
}
await t.page.evaluate(async () => { const m = await import('/src/ui/mods.ts'); const M = await import('/src/ui/menus.ts'); const ui = window.game.ui; ui.open(new m.ModsScreen(ui, new M.PauseScreen(ui))); });
await wait(800);
await collect('mods');
for (const mod of ['skinscreen', 'agentscreen']) {
  await t.page.evaluate(async (mod) => { const m = await import(`/src/ui/${mod}.ts`); const M = await import('/src/ui/menus.ts'); const ui = window.game.ui; const C = Object.values(m).find((v) => typeof v === 'function' && /Screen$/.test(v.name)); ui.open(new C(ui, new M.PauseScreen(ui))); }, mod);
  await collect(mod);
}
await client((g) => g.ui.close());

// containers and workstations (opened by the server, like a right-click)
const STATIONS = [
  ['crafting_table', 'openCrafting', false], ['furnace', 'openFurnace'], ['smoker', 'openFurnace'], ['blast_furnace', 'openFurnace'], ['chest', 'openChest'],
  ['ender_chest', 'openEnderChest'], ['enchanting_table', 'openEnchant'], ['hopper', 'openHopper'], ['dispenser', 'openDispenser', true, false], ['dropper', 'openDispenser', true, true],
  ['brewing_stand', 'openBrewing'], ['anvil', 'openAnvil'], ['smithing_table', 'openSmithing'], ['stonecutter', 'openStonecutter'], ['beacon', 'openBeacon'],
  ['grindstone', 'openGrindstone'], ['loom', 'openLoom'], ['cartography_table', 'openCartography'], ['command_block', 'openCommandBlock'], ['structure_block', 'openStructureBlock'],
  ['jigsaw', 'openJigsaw'], ['oak_sign', 'openSign'],
];
for (const [block, opener, coords = true, extra] of STATIONS) {
  await t.page.evaluate(async ([block, opener, coords, extra]) => {
    const { blockByName } = await import('/src/world/blocks.ts');
    window.sim((g, p) => {
      const x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z);
      g.world.set(x, y, z, blockByName(block).id);
      if (coords) g.ui[opener](x, y, z, ...(extra === undefined ? [] : [extra])); else g.ui[opener]();
    });
  }, [block, opener, coords, extra]);
  await wait(300);
  await collect(block);
  await client((g) => { g.ui.screen?.close(); });
}
// the inventory, every creative tab, and a villager's trades
await client((g) => g.ui.openInventory());
for (let tab = 0; tab < 12; tab++) {
  await client((g, tab) => { const s = g.ui.screen; if (s && 'tab' in s) { s.tab = tab; s.init?.(); } }, tab);
  await collect(`creative tab ${tab}`);
}
await client((g) => g.ui.close());
// (the villager must have reached this client before its trades open)
await t.page.evaluate(() => window.sim((g, p) => { const v = g.interact.spawnMob('villager', p.x + 1.5, p.y, p.z); v.profession = 'librarian'; v.noAi = true; window.__villager = v; }));
await wait(600);
await t.page.evaluate(() => window.sim((g) => g.ui.openTrade(window.__villager)));
await wait(400);
await collect('trading');
await t.page.evaluate(() => window.sim((g) => g.ui.close()));
await wait(300);

// every item's tooltip
const tips = await t.page.evaluate(async () => {
  const { tooltipLines } = await import('/src/ui/containers.ts');
  const { localize } = await import('/src/i18n/i18n.ts');
  const { ITEMS } = await import('/src/game/items.ts');
  const out = [];
  for (const it of ITEMS.values()) if (!it.mod && !it.missing) for (const l of tooltipLines({ id: it.id, count: 1, damage: it.durability ? 3 : undefined, ...(it.name === 'firework_rocket' ? { fw: { flight: 2, ex: [{ shape: 1, colors: [0xff0000], fade: [0x00ff00], trail: true, twinkle: true }] } } : {}) })) out.push(localize(l));
  return out;
});
for (const s of tips) for (const w of english(s)) if (!leftovers.has(s)) leftovers.set(s, 'tooltip');

// chat: what the server says (commands, joins, deaths), shown in this player's language
await client((g) => {
  for (const c of ['/give @s diamond 2', '/time set day', '/weather clear', '/effect give @s speed 5 1', '/xp add @s 3 levels', '/summon zombie', '/kill @e[type=zombie]', '/gamerule keepInventory true', '/difficulty easy', '/locate stronghold', '/seed', '/heal', '/tp @s ~ ~ ~', '/nonsense', '/give @s nothing'])
    g.conn.send({ t: 'chat', msg: c });
});
await wait(800);
await t.page.evaluate(async () => { const M = await import('/src/ui/menus.ts'); const ui = window.game.ui; ui.open(new M.ChatScreen(ui, '')); });
await collect('chat');
const chat = await client((g) => g.ui.chat.lines.map((l) => l.text).slice(0, 12));
ok(chat.some((l) => /钻石|鑽石/.test(l)), `/give says what it gave in ${lang} (${chat[chat.length - 1]})`);

console.log('  strings drawn: ' + seen.join(', '));
ok(seen.every((s) => !s.endsWith(' 0')), 'every screen drew some text');
// players' and packs' own words, and ids
const OWN = [/^English \(United States\)$/, /minecraft:/, /[“「]nothing[”」]/, ...packDescriptions()];
for (const s of [...leftovers.keys()]) if (OWN.some((r) => r.test(s))) leftovers.delete(s);
for (const [s, where] of leftovers) console.log(`  english left (${where}): ${JSON.stringify(s)}`);
ok(leftovers.size === 0, `no English left on the screens, tooltips and chat (${leftovers.size} strings)`);
ok(t.errors.length === 0, `no errors (${t.errors.slice(0, 3).join(' | ')})`);
await t.shot(`i18n-${lang}`);
await t.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log('\nall ok');
