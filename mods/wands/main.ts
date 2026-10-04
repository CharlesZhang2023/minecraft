// Wands: Noita's wand and spell system. Wands are items with stats and spell slots; spells are items too (cards
// you put into wands). Holding the use button fires the wand: it draws its spells like a deck of cards, so
// modifiers, multicasts and triggers combine into whatever you can think of. The wand editor (R, or the wand
// button on phones) is modelled on the Spell Lab mod: every spell at hand in creative, editable stats, a preview
// of what each cast fires, a box for saved layouts, and a target dummy that counts your damage per second.
import type { ModContext, Channel, ItemRef, Client, Player, Game, ItemStack } from '../sdk';
import { SPELLS, SPELL_BY_ID, TYPE_ORDER, type SpellDef } from './spells';
import { TIERS, LAB_TIER, STARTER_TIER, wandOf, wandTooltip, labWand, starterWand, rollWand, spellPool, type WandData } from './wand';
import { SpellServer, type FxEvent } from './server';
import { SpellFx } from './fx';
import { drawWandHud, type WandState } from './hud';
import { editorScreen, type EditMsg, type EditorDeps } from './editor';
import { registerArt } from './art';
import { registerDummy, dummyRenderer } from './dummy';
import { registerBlocks } from './blocks';

interface Shared {
  cfg: { editKey: string; terrain: boolean; selfDamage: boolean; pvp: boolean; creativeInfinite: boolean; damageNumbers: boolean; hudStrip: boolean; effects: string };
  fx: Channel<FxEvent[]>;
  edit: Channel<EditMsg>;
  spellItems: Map<string, ItemRef>;
  wandItems: ItemRef[];
  spellOfItem(id: number): string | undefined;
  tierOf(id: number): number | undefined;
  isDummy(e: unknown): boolean;
  scroll: ItemRef;
  greater: ItemRef;
  dummy: ItemRef;
}
let shared: Shared | null = null;

const RARITY = (s: SpellDef) => (s.tier >= 4 ? 'epic' : s.tier >= 3 ? 'rare' : s.tier >= 2 ? 'uncommon' : 'common') as 'epic' | 'rare' | 'uncommon' | 'common';

export function main(mod: ModContext) {
  const cfg = mod.config({
    editKey: { type: 'key', default: 'KeyR', label: 'Wand Editor Key' },
    damageNumbers: { type: 'boolean', default: true, label: 'Damage Numbers', description: 'Show the damage your spells do' },
    hudStrip: { type: 'boolean', default: true, label: 'Wand Spells on HUD', description: 'Show the held wand\'s spells under its mana bar' },
    effects: { type: 'enum', default: 'fancy', options: ['fancy', 'fast'], labels: ['Fancy', 'Fast'], label: 'Spell Effects', description: 'Fast: fewer particles (slower phones)' },
    terrain: { type: 'boolean', default: true, label: 'Spells Change Terrain', description: 'When hosting: explosions, drills and materials alter the world' },
    selfDamage: { type: 'boolean', default: false, label: 'Self Damage', description: 'When hosting: your own explosions hurt you (as in Noita)' },
    pvp: { type: 'boolean', default: true, label: 'Spells Hurt Players', description: 'When hosting: spells can hurt other players' },
    creativeInfinite: { type: 'boolean', default: true, label: 'Creative: Endless Mana', description: 'When hosting: wands never run dry in creative mode' },
  });

  // ---- spells: one item per spell, a card to slot into wands
  const spellItems = new Map<string, ItemRef>();
  for (const s of SPELLS) {
    if (s.hidden) continue;
    spellItems.set(s.id, mod.item(s.id, { display: s.name, maxStack: 16, rarity: RARITY(s), tab: 'wands:spells' }, {
      tooltip: (_st, lines) => {
        lines.push(`§8${s.type === 'static' ? 'Static projectile' : s.type[0].toUpperCase() + s.type.slice(1)}`);
        lines.push(`§7${s.desc}`);
        lines.push(`§9Mana ${s.mana}${s.uses ? `  §eUses ${s.uses}` : ''}`);
      },
    }));
  }
  const itemToSpell = new Map<number, string>();
  let mapKey = '';
  const spellOfItem = (id: number) => {
    // ids are bound per world: rebuild the reverse table when they move
    const k = `${spellItems.get('spark_bolt')!.id}:${spellItems.get('wand_refresh')!.id}`;
    if (k !== mapKey) { mapKey = k; itemToSpell.clear(); for (const [sid, ref] of spellItems) itemToSpell.set(ref.id, sid); }
    return itemToSpell.get(id);
  };

  // ---- wands
  let server: SpellServer | null = null;
  const wandItems = TIERS.map((t, tier) => mod.item(t.key, { display: t.name, maxStack: 1, rarity: t.rarity, tab: 'wands:wands' }, {
    useTick: (c) => server?.useTick(c.game, c.player, tier),
    tooltip: (st, lines) => wandTooltip(wandOf(st), lines),
  }));
  const tierOf = (id: number) => { const i = wandItems.findIndex((w) => w.id === id); return i >= 0 ? i : undefined; };

  // ---- scrolls: read one to learn a random spell
  const readScroll = (maxTier: number) => (c: { game: Game; player: Player; consume(n?: number): void }) => {
    const pool = spellPool(maxTier).filter((s) => spellItems.has(s.id));
    // rarer spells come up less often
    const weights = pool.map((s) => 1 / (1 + s.tier * s.tier * 0.6));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = pool[0];
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
    c.consume(1);
    const st = mod.stack(spellItems.get(pick.id)!);
    if (c.player.inventory.add(st) > 0) c.game.dropItem(c.player.x, c.player.y + 1, c.player.z, st);
    c.game.audio.play('wands:learn', { x: c.player.x, y: c.player.y + 1, z: c.player.z }, 0.8, 1);
    (c.game.ui as unknown as { hud?: { actionBar?(m: string): void } }).hud?.actionBar?.(`§dThe scroll turns into §f${pick.name}`);
    return true;
  };
  const scroll = mod.item('arcane_scroll', { display: 'Arcane Scroll', maxStack: 16, rarity: 'uncommon', tab: 'wands:wands' }, {
    use: readScroll(2), tooltip: (_s, l) => { l.push('§7Use it to turn it into a random spell'); },
  });
  const greater = mod.item('greater_arcane_scroll', { display: 'Greater Arcane Scroll', maxStack: 16, rarity: 'rare', tab: 'wands:wands' }, {
    use: readScroll(5), tooltip: (_s, l) => { l.push('§7Use it to turn it into a random spell,', '§7maybe a powerful one'); },
  });
  const dummy = mod.item('target_dummy', { display: 'Target Dummy', maxStack: 16, egg: 'wands:dummy', tab: 'wands:wands' }, {
    tooltip: (_s, l) => { l.push('§7Place it to test your spells', '§7Sneak and hit it to take it back'); },
  });

  // ---- recipes
  const wandRecipe = (tier: number, top: string, band: string, shaft: string) =>
    mod.recipes.shaped(['  T', ' B ', 'S  '], { T: top, B: band, S: shaft }, wandItems[tier]);
  wandRecipe(0, 'lapis_lazuli', 'stick', 'stick');
  wandRecipe(1, 'diamond', 'gold_ingot', 'stick');
  wandRecipe(2, 'emerald', 'blaze_rod', 'blaze_rod');
  wandRecipe(3, 'ender_eye', 'diamond', 'blaze_rod');
  mod.recipes.shapeless(['paper', 'lapis_lazuli', 'redstone'], scroll);
  mod.recipes.shapeless(['paper', 'glowstone_dust', 'ender_pearl', 'lapis_lazuli'], greater);
  mod.recipes.shaped(['H', 'S'], { H: 'hay_block', S: 'stick' }, dummy);

  registerBlocks(mod);
  const isDummy = registerDummy(mod, () => dummy.id);
  const fx = mod.channel<FxEvent[]>('fx');
  const edit = mod.channel<EditMsg>('edit');

  if (mod.realm === 'page') {
    server = new SpellServer(mod, cfg, fx, (id) => spellItems.get(id)?.id, tierOf, isDummy);
    // each cast's spell tree in your chat: what was drawn, what it made, what it cost
    mod.commands.register({
      name: 'wanddebug', usage: '/wanddebug [on|off]', description: 'print each wand cast as a spell tree', permission: 'all',
      run({ player, args }) {
        const sv = server!, on = args[0] === 'on' ? true : args[0] === 'off' ? false : !sv.debug.has(player);
        if (on) sv.debug.add(player); else sv.debug.delete(player);
        return on ? 'Wand debug on: every cast prints its spell tree' : 'Wand debug off';
      },
    });
    // weakening curses on blows and on other explosions: the hit lands twice as hard
    let doubling = false;
    mod.on('entityDamage', ({ game, entity, amount, source }) => {
      const sv = server!;
      if (doubling || sv.inHurt) return;
      const curse = source === 'explosion' ? 'curseExpl' : source === 'player' || source === 'mob' ? 'curseMelee' : null;
      if (!curse || !sv.statuses.has(entity, curse, game.ticks)) return;
      doubling = true;
      const le = entity as unknown as { damage(n: number, s: string, a: unknown): boolean };
      le.damage(amount * 2, source, null);
      doubling = false;
      return 'fail';
    });
    mod.on('serverTick', (game) => server!.tick(game));
    mod.on('worldClose', () => server!.reset());
    edit.onServer((d, player, game) => {
      if (!d || typeof d !== 'object') return;
      server!.edit(game, player, d);
    });
    // monsters now and then drop a spell; deeper ones better spells
    mod.on('entityDeath', ({ game, entity }) => {
      const e = entity as unknown as { hostile?: boolean; lastAttacker?: unknown; x: number; y: number; z: number };
      if (!e.hostile || !(e.lastAttacker instanceof mod.mc.Player) || Math.random() > 0.04) return;
      const tier = game.dimension !== 'overworld' ? 4 : e.y < 20 ? 3 : e.y < 45 ? 2 : 1;
      const pool = spellPool(tier).filter((s) => spellItems.has(s.id));
      const s = pool[Math.floor(Math.random() * pool.length)];
      if (s) game.dropItem(e.x, e.y + 0.5, e.z, mod.stack(spellItems.get(s.id)!));
    });
  }

  shared = { cfg, fx, edit, spellItems, wandItems, spellOfItem, tierOf, isDummy, scroll, greater, dummy };
  // tests and the console
  if (mod.realm === 'page') (globalThis as unknown as { __wands: unknown }).__wands = { server, shared };
}

export function client(mod: ModContext) {
  const s = shared!;
  registerArt(mod, TIERS.map((t) => t.key));
  dummyRenderer(mod);
  const fx = new SpellFx(mod.mc.BLOCKS);
  let state: WandState | null = null;
  const acks: EditorDeps['acks'] = { on: null };
  Object.assign((globalThis as unknown as { __wands: object }).__wands ?? {}, { fx, state: () => state });

  s.fx.onClient((list, client) => {
    if (!Array.isArray(list)) return;
    for (const e of list) {
      if (e.k === 'w') state = e.s >= 0 ? (e as WandState) : null;
      else if (e.k === 'a') acks.on?.(e.rev, !!e.ok, e.msg);
      else fx.handle(e, client);
    }
  });
  mod.on('clientTick', (client) => { fx.quality = s.cfg.effects === 'fast' ? 0.5 : 1; fx.tick(client); });
  mod.on('clientJoin', () => { fx.reset(); state = null; });
  let texReady = false;
  mod.on('worldRenderGlow', (r) => {
    if (!texReady) {
      texReady = true;
      Object.assign(fx.T, { glow: r.tex('wands:glow'), core: r.tex('wands:core'), star: r.tex('wands:star'), ring: r.tex('wands:ring'), bomb: r.tex('wands:bomb'), dyn: r.tex('wands:dynamite'), holy: r.tex('wands:holy'), rock: r.tex('cobblestone'), void: r.tex('wands:void'), cloud: r.tex('wands:cloud'), storm: r.tex('wands:stormcloud'), flesh: r.tex('wands:flesh') });
    }
    fx.drawGlow(r);
  });
  mod.on('worldRender', (r) => { if (texReady) fx.drawSolid(r, mod.mc.math); });
  mod.on('hudRender', ({ ctx, client, width, height, partial }) => {
    drawWandHud(ctx, client, width, height, partial, {
      fx, state: () => state, spellItem: (id) => s.spellItems.get(id)?.id, cfg: s.cfg, isDummy: s.isDummy, touch: () => mod.mc.device.touch,
    });
  });

  // ---- the editor
  const Editor = editorScreen(mod, {
    edit: s.edit, acks,
    spellItem: (id) => s.spellItems.get(id)?.id,
    spellOfItem: s.spellOfItem,
    tierOf: s.tierOf,
    touch: () => mod.mc.device.touch,
    editKey: () => s.cfg.editKey,
  });
  const open = (client: Client) => {
    const p = client.player;
    if (!p || p.dead || client.ui.screen) return;
    const inv = p.inventory.main;
    let slot = s.tierOf(inv[p.inventory.selected]?.id ?? -1) !== undefined ? p.inventory.selected : inv.findIndex((st) => !!st && s.tierOf(st.id) !== undefined);
    if (slot < 0) { client.ui.chat.add('§7You have no wand. Craft one: a stick, a stick and lapis lazuli in a diagonal.'); return; }
    if (slot > 35) slot = 0;
    client.ui.open(new Editor(client.ui, slot));
  };
  mod.client.keybind('editKey', 'KeyR', open);
  const holdingWand = (c: Client) => { const st = c.player?.inventory.held(); return !!st && s.tierOf(st.id) !== undefined; };
  mod.client.touchButton('edit', {
    visible: (c) => holdingWand(c) && !c.ui.screen,
    onPress: open,
    icon: (ctx, x, y, w, h) => {
      // a little wand with a sparkle
      const cx = Math.floor(x + w / 2), cy = Math.floor(y + h / 2);
      ctx.fillStyle = '#c89858';
      for (let i = 0; i < 9; i++) ctx.fillRect(cx - 5 + i, cy + 4 - i, 2, 2);
      ctx.fillStyle = '#80b0ff';
      ctx.fillRect(cx + 3, cy - 6, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx + 4, cy - 8, 1, 1); ctx.fillRect(cx + 7, cy - 5, 1, 1); ctx.fillRect(cx + 1, cy - 5, 1, 1);
    },
  });

  // ---- creative tabs: wands (with ready-made ones) and every spell by type
  const stackOf = (ref: ItemRef, w?: WandData): ItemStack => (w ? { id: ref.id, count: 1, tag: { wand: w } } : { id: ref.id, count: 1 });
  mod.client.creativeTab('wands', 'Wands', () => s.wandItems[3].id, () => [
    stackOf(s.wandItems[LAB_TIER], labWand()),
    stackOf(s.wandItems[STARTER_TIER], starterWand()),
    ...[0, 1, 2, 3].map((t) => stackOf(s.wandItems[t])),
    ...[0, 1, 2, 3].map((t) => stackOf(s.wandItems[t], rollWand(t))),
    stackOf(s.scroll), stackOf(s.greater), stackOf(s.dummy),
  ]);
  mod.client.creativeTab('spells', 'Spells', () => s.spellItems.get('spark_bolt')!.id, () =>
    TYPE_ORDER.flatMap((t) => SPELLS.filter((x) => x.type === t && s.spellItems.has(x.id)).map((x) => ({ id: s.spellItems.get(x.id)!.id, count: 1 }))));
  void SPELL_BY_ID;
}
