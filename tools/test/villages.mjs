// Villages of 1.14-1.16 in a running world: generated villages with bells, beds and workstations; villagers
// claiming workstations for their profession, levelling up by trading, losing an unused job; raids (Bad Omen in a
// village, waves, Hero of the Village); patrols. Picture of a village in output/tests.
//   node tools/test/villages.mjs [seed]
import { openWorld, wait } from './browser.mjs';

const seed = Number(process.argv[2] ?? 31);
const t = await openWorld({ seed, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// a generated village: bell, beds, workstations
const vil = await t.page.evaluate(async (seed) => {
  const { WorldGen } = await import('/src/world/worldgen.ts');
  const { regionVillage } = await import('/src/world/village.ts');
  const { BLOCKS } = await import('/src/world/blocks.ts');
  const g = new WorldGen(seed);
  let v = null;
  for (let r = 0; r < 8 && !v; r++) for (let rx = -r; rx <= r && !v; rx++) for (let rz = -r; rz <= r && !v; rz++) v = regionVillage(g, rx, rz);
  if (!v) return null;
  const counts = {};
  const profs = {};
  for (let cx = (v.x >> 4) - 3; cx <= (v.x >> 4) + 3; cx++) for (let cz = (v.z >> 4) - 3; cz <= (v.z >> 4) + 3; cz++) {
    const c = g.generate(cx, cz);
    for (const b of c.blocks) { const n = BLOCKS[b & 0xfff].name; if (['bell', 'red_bed', 'composter', 'lectern', 'smoker', 'blast_furnace', 'barrel', 'cartography_table', 'fletching_table', 'cauldron', 'stonecutter', 'loom', 'smithing_table', 'grindstone', 'brewing_stand'].includes(n)) counts[n] = (counts[n] ?? 0) + 1; }
    for (const s of c.spawns ?? []) if (s.type === 'villager') profs[s.data?.profession] = (profs[s.data?.profession] ?? 0) + 1;
  }
  return { x: v.x, z: v.z, style: v.style, counts, profs };
}, seed);
console.log(vil);
ok(!!vil, 'a village generates near spawn');
ok(vil && vil.counts.bell === 1, 'with a bell at its meeting point');
ok(vil && Object.keys(vil.counts).filter((k) => k !== 'bell' && k !== 'red_bed').length >= 3, 'and workstations of several professions');
ok(vil && Object.keys(vil.profs).length >= 2, `villagers of matching professions (${vil && Object.keys(vil.profs).join(' ')})`);

// a villager takes a free workstation, trades, levels up, and loses an unused job when it's broken
const jobs = await t.page.evaluate(async () => {
  const { BLOCKS } = await import('/src/world/blocks.ts');
  return window.sim((g, p) => {
    const w = g.world, x = Math.floor(p.x) + 4, y = Math.floor(p.y), z = Math.floor(p.z) + 4;
    const site = (n) => BLOCKS.find((b) => b?.name === n).id;
    // the job check runs once every 100 ticks of the villager's age
    const live = (v, n) => { for (let i = 0; i < n; i++) { v.age++; v.tick(); } };
    w.set(x, y, z, site('lectern'));
    const v = g.interact.spawnMob('villager', x + 1.5, y, z + 0.5);
    live(v, 120);
    const prof = v.profession, hasSite = !!v.jobSite;
    const trades = v.ensureTrades().length;
    const x2 = x + 6;
    w.set(x2, y, z, site('composter'));
    const v2 = g.interact.spawnMob('villager', x2 + 1.5, y, z + 0.5);
    live(v2, 120);
    const farmer = v2.profession;
    w.set(x2, y, z, 0);
    live(v2, 120);
    return { prof, site: hasSite, trades, farmer, after: v2.profession };
  });
});
ok(jobs.prof === 'librarian' && jobs.site, `a villager next to a lectern becomes a librarian (${jobs.prof})`);
ok(jobs.trades >= 2, `with novice trades (${jobs.trades})`);
ok(jobs.farmer === 'farmer' && jobs.after === '', 'an untraded villager loses its job when the workstation goes');

const levels = await t.page.evaluate(async () => {
  const { villagerTraded, newTrades } = await import('/src/entity/villagers.ts');
  return window.sim((g, p) => {
    const v = g.interact.spawnMob('villager', p.x + 2, p.y, p.z - 3);
    v.profession = 'toolsmith';
    const t0 = v.ensureTrades().length;
    // the screen calls villagerTraded after each trade
    for (let i = 0; i < 6; i++) villagerTraded(v, { cost: [1, 1], result: [1, 1], uses: 0, max: 9, xp: 2 });
    const all = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'];
    const counts = all.map((pr) => [1, 2, 3, 4, 5].map((l) => newTrades(pr, l, 7).length));
    return { t0, level: v.level, t1: v.trades.length, empty: all.filter((_, i) => counts[i].some((n) => n === 0)) };
  });
});
ok(levels.level === 2 && levels.t1 > levels.t0, `trading levels a villager up and opens new trades (${levels.t0} -> ${levels.t1})`);
ok(levels.empty.length === 0, 'every profession has trades at every level ' + levels.empty.join(' '));

// raids: Bad Omen near a bell starts one; the first wave arrives; winning makes heroes
const raid = await t.page.evaluate(async () => {
  const { B2 } = await import('/src/world/blocks.ts');
  const raids = await import('/src/game/raids.ts');
  return window.sim((g, p) => {
    g.options.difficulty = 2;
    const w = g.world, x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z) - 6;
    w.set(x, y, z, B2.BELL);
    for (let i = 0; i < 3; i++) g.interact.spawnMob('villager', x + 2 + i, y, z + 2);
    p.addEffect('bad_omen', 120000, 0);
    const r = { next: Math.random, int: (n) => Math.floor(Math.random() * n) };
    const t0 = g.ticks;
    g.ticks = 20 * 1000;
    raids.tickRaids(g, r);
    const started = raids.activeRaids(g).length === 1 && !p.effects.has('bad_omen');
    const rd = raids.activeRaids(g)[0];
    if (!rd) { g.ticks = t0; return { started }; }
    rd.cooldown = 1;
    raids.tickRaids(g, r);
    const wave1 = g.entities.filter((e) => e.raid === rd.id && !e.dead);
    const kinds = [...new Set(wave1.map((e) => e.typeName))];
    // win: clear every wave
    for (let k = 0; k < 10 && raids.activeRaids(g).length; k++) {
      for (const e of g.entities) if (e.raid === rd.id) { e.health = 0; e.dead = true; e.removed = true; }
      rd.cooldown = 1;
      raids.tickRaids(g, r);
    }
    g.ticks = t0;
    for (const e of g.entities) if (e.raid === rd.id) e.removed = true;
    return { started, wave1: wave1.length, kinds, waves: rd.waves, hero: p.effects.has('hero_of_the_village'), over: raids.activeRaids(g).length === 0, discount: raids.heroDiscount(p, 10) };
  });
});
ok(raid.started, 'Bad Omen in a village starts a raid');
ok(raid.wave1 >= 4, `the first wave arrives (${raid.wave1}: ${raid.kinds?.join(', ')})`);
ok(raid.over && raid.hero, `winning all ${raid.waves} waves makes the player a Hero of the Village`);
ok(raid.discount < 10, `heroes trade cheaper (10 -> ${raid.discount})`);

// a patrol: pillagers with a captain
const patrol = await t.page.evaluate(async () => {
  const raids = await import('/src/game/raids.ts');
  return window.sim((g, p) => {
    for (const e of g.entities) if (e.typeName === 'Villager') e.removed = true;
    p.setPos(p.x + 70, p.y, p.z);
    const r = { next: Math.random, int: (n) => Math.floor(Math.random() * n) };
    let ms = [];
    for (let k = 0; k < 20 && !ms.length; k++) ms = raids.spawnPatrol(g, r, p);
    return { n: ms.length, captain: ms.some((m) => m.captain), patrol: ms.every((m) => m.patrol) };
  });
});
ok(patrol.n >= 2 && patrol.captain && patrol.patrol, `a patrol of ${patrol.n} pillagers with a captain`);

// picture of the village
if (vil) {
  await t.page.evaluate(([x, z]) => window.sim((g, p) => { p.setGameMode(1); p.flying = true; p.setPos(x, 110, z); }), [vil.x, vil.z]);
  await wait(2500);
  await t.settle(6000, 20000);
  await t.look(vil.x - 28, 100, vil.z - 28, -45, 30, 70);
  await wait(1500);
  await t.shot('village');
}
ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
