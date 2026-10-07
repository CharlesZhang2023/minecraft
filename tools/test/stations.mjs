// Workstations and the new functional blocks in a running world: smokers cook food only (twice as fast), blast
// furnaces ores only, the smithing table upgrades diamond gear to netherite, the stonecutter cuts, the grindstone
// disenchants, composters fill up into bone meal, targets and trapped chests power redstone, campfires cook.
//   node tools/test/stations.mjs
import { openWorld } from './browser.mjs';

const t = await openWorld({ seed: 77, mode: 0 });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };
const r = await t.page.evaluate(async () => {
  const { itemByName, stack, TOOLS } = await import('/src/game/items.ts');
  const { blockByName } = await import('/src/world/blocks.ts');
  const { tickFurnaces } = await import('/src/game/furnace.ts');
  const m = await import('/src/game/stations.ts');
  const id = (n) => (itemByName(n) ?? blockByName(n)).id;
  return window.sim((g, p) => {
    const w = g.world, out = {};
    const x = Math.floor(p.x) + 2, y = 150, z = Math.floor(p.z);
    for (let dx = -3; dx < 12; dx++) for (let dz = -3; dz < 6; dz++) { w.set(x + dx, y - 1, z + dz, 1); for (let dy = 0; dy < 3; dy++) w.set(x + dx, y + dy, z + dz, 0); }
    // smoker: beef cooks in 100 ticks, iron ore is refused
    const place = (bx, name) => { w.set(bx, y, z, id(name)); g.interact.initTile(bx, y, z, id(name)); return w.getTile(bx, y, z); };
    const sm = place(x, 'smoker');
    sm.slots = [stack(id('beef'), 2), stack(id('coal'), 1), null];
    for (let i = 0; i < 105; i++) tickFurnaces(g);
    out.smokerCooked = sm.slots[2]?.id === id('cooked_beef') ? sm.slots[2].count : 0;
    out.smokerLit = (w.get(x, y, z) >>> 12) & 4;
    const bf = place(x + 1, 'blast_furnace');
    bf.slots = [stack(id('beef'), 1), stack(id('coal'), 1), null];
    for (let i = 0; i < 120; i++) tickFurnaces(g);
    out.blastRefusedFood = !bf.slots[2];
    bf.slots[0] = stack(id('iron_ore'), 1);
    for (let i = 0; i < 105; i++) tickFurnaces(g);
    out.blastIron = bf.slots[2]?.id === id('iron_ingot');
    // smithing table screen (the server's twin)
    g.ui.openSmithing(x + 2, y, z);
    const sc = g.ui.screen;
    sc.items[0] = { id: TOOLS.diamond_sword, count: 1, damage: 100, ench: { sharpness: 3 } };
    sc.items[1] = stack(id('netherite_ingot'), 1);
    const res = sc.result();
    out.smith = res && res.id === TOOLS.netherite_sword && res.damage === 100 && res.ench?.sharpness === 3;
    g.ui.close();
    // stonecutter
    g.ui.openStonecutter(x + 3, y, z);
    const st = g.ui.screen;
    st.items[0] = stack(id('stone'), 5);
    out.cut = st.options().map((s) => s.id);
    out.cutBricks = out.cut.includes(id('stone_bricks'));
    g.ui.close();
    // grindstone
    g.ui.openGrindstone(x + 4, y, z);
    const gr = g.ui.screen;
    gr.items[0] = { id: TOOLS.iron_pickaxe, count: 1, ench: { efficiency: 2, vanishing_curse: 1 } };
    const gres = gr.result();
    out.grind = gres && !gres.ench?.efficiency && gres.ench?.vanishing_curse === 1;
    g.ui.close();
    // composter: 100%-chance cake fills a level each time
    w.set(x + 5, y, z, id('composter'));
    p.inventory.main[p.inventory.selected] = stack(id('cake'), 8);
    const hands = g.interact.hands();
    {
      for (let i = 0; i < 7; i++) m.stationUse(hands, x + 5, y, z, w.get(x + 5, y, z), p.inventory.held());
      out.composterLevel = w.get(x + 5, y, z) >>> 12;
      // target block hit dead centre: full power
      w.set(x + 6, y, z, id('target'));
      g.interact.initTile(x + 6, y, z, id('target'));
      m.hitTarget(g, x + 6, y, z, x + 6.5, y + 0.5, z, true);
      out.targetPower = g.redstone.emit(x + 6, y, z, 0, false);
      // trapped chest opened: powers redstone
      w.set(x + 8, y, z, id('trapped_chest'));
      g.interact.initTile(x + 8, y, z, id('trapped_chest'));
      g.ui.openChest(x + 8, y, z);
      out.trappedPowered = g.redstone.isPowered(x + 8, y - 1, z) || g.redstone.emit(x + 8, y, z, 3, false) > 0;
      g.ui.close();
      out.trappedAfter = g.redstone.emit(x + 8, y, z, 3, false);
      // campfire cooks a porkchop in 600 ticks
      w.set(x + 9, y, z, id('campfire'));
      g.interact.initTile(x + 9, y, z, id('campfire'));
      p.inventory.main[p.inventory.selected] = stack(id('porkchop'), 1);
      m.stationUse(hands, x + 9, y, z, w.get(x + 9, y, z), p.inventory.held());
      for (let i = 0; i < 310; i++) m.tickStations(g);
      out.campfire = g.entities.some((e) => e.item?.id === id('cooked_porkchop'));
      return out;
    }
  });
});
console.log(JSON.stringify(r));
ok(r.smokerCooked === 1 && r.smokerLit, 'smoker: cooks beef in 100 ticks and lights up');
ok(r.blastRefusedFood && r.blastIron, 'blast furnace: no food, smelts iron ore');
ok(r.smith, 'smithing table: diamond sword + netherite ingot = netherite sword (keeps wear and enchantments)');
ok(r.cutBricks, 'stonecutter: stone offers stone bricks');
ok(r.grind, 'grindstone: strips enchantments but keeps curses');
ok(r.composterLevel === 7, `composter: seven cakes fill it (${r.composterLevel})`);
ok(r.targetPower === 15, `target: a centre hit gives 15 (${r.targetPower})`);
ok(r.trappedPowered && r.trappedAfter === 0, 'trapped chest: powered while open, not after');
ok(r.campfire, 'campfire: cooks a porkchop');
ok(t.errors.length === 0, 'no page errors ' + t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exitCode = fails.length ? 1 : 0;
