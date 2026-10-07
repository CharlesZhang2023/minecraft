// Villagers of 1.14-1.16: thirteen professions, each taken by claiming a free workstation nearby; five levels
// (novice to master) reached by trading, each opening two new trades from vanilla's tables; restocking at the
// workstation; farmers who harvest and replant. Unemployed villagers look for work; nitwits never do.
import type { Villager, Trade } from './mobs';
import { B, B2, BLOCKS, idOf, metaOf, pack } from '../world/blocks';
import { I, I3, itemId, getItem, stack, TOOLS, ARMOR } from '../game/items';
import { ENCHANTS, rollEnchants } from '../game/enchant';
import { Random } from '../noise';

/** Profession -> its workstation block (by name, resolved lazily). */
export const PROFESSION_SITES: Record<string, string> = {
  armorer: 'blast_furnace', butcher: 'smoker', cartographer: 'cartography_table', cleric: 'brewing_stand', farmer: 'composter',
  fisherman: 'barrel', fletcher: 'fletching_table', leatherworker: 'cauldron', librarian: 'lectern', mason: 'stonecutter',
  shepherd: 'loom', toolsmith: 'smithing_table', weaponsmith: 'grindstone',
};
export const PROFESSION_NAMES = Object.keys(PROFESSION_SITES);
const siteIds = new Map<number, string>();
function siteProfession(id: number): string | undefined {
  if (!siteIds.size) for (const [p, n] of Object.entries(PROFESSION_SITES)) { const b = BLOCKS.find((x) => x?.name === n); if (b) siteIds.set(b.id, p); }
  return siteIds.get(id);
}
/** Professions of villagers saved before 1.14 professions. */
export const OLD_PROFESSIONS: Record<string, string> = { priest: 'cleric', smith: 'toolsmith' };
export const LEVEL_XP = [0, 10, 70, 150, 250];
export const LEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];

// ------------------------------------------------------------------ trades (vanilla 1.16, by level)
type Make = (r: Random) => Trade;
const E = () => I.EMERALD;
const id = (n: string) => itemId(n);
const T = (cost: [number, number], result: [number, number], max: number, xp: number, cost2?: [number, number]): Trade => ({ cost, cost2, result, uses: 0, max, xp } as Trade);
/** The villager buys `n` of something for one emerald. */
const buy = (name: string, n: number, max = 16, xp = 2): Make => () => T([id(name), n], [E(), 1], max, xp);
/** The villager sells `n` of something for `price` emeralds (optionally plus another item). */
const sell = (price: number, name: string, n = 1, max = 12, xp = 1, extra?: [string, number]): Make => () => T([E(), price], [id(name), n], max, xp, extra ? [id(extra[0]), extra[1]] : undefined);
/** An enchanted tool or armour piece (vanilla: enchantment level 5-19, price grows with it). */
const enchanted = (base: number, name: string, max = 3, xp = 15): Make => (r) => {
  const lv = 5 + r.int(15);
  const s = stack(id(name));
  const ench = rollEnchants(s, lv, r);
  return { ...T([E(), Math.min(64, base + lv)], [id(name), 1], max, xp), ench } as Trade;
};
/** An enchanted book: a random (non-curse) enchantment and level; doubled price for treasure ones. */
const book: Make = (r) => {
  const pool = ENCHANTS.filter((e) => !e.curse && e.id !== 'soul_speed');
  const e = pool[r.int(pool.length)];
  const lvl = 1 + r.int(e.max);
  let price = 2 + r.int(5 + lvl * 10) + 3 * lvl;
  if (e.treasure) price *= 2;
  return { ...T([E(), Math.min(64, price)], [I3.ENCHANTED_BOOK, 1], 12, 1, [I.BOOK, 1]), ench: { [e.id]: lvl } } as Trade;
};
const pick = (...ms: Make[]): Make => (r) => ms[r.int(ms.length)](r);
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const anyColor = (r: Random) => COLORS[r.int(16)];

export const TRADES: Record<string, Make[][]> = {
  armorer: [
    [buy('coal', 15), sell(5, 'iron_helmet'), sell(9, 'iron_chestplate'), sell(7, 'iron_leggings'), sell(4, 'iron_boots')],
    [buy('iron_ingot', 4, 12, 10), sell(36, 'bell', 1, 12, 5), sell(3, 'chainmail_boots', 1, 12, 5), sell(7, 'chainmail_leggings', 1, 12, 5)],
    [buy('lava_bucket', 1, 12, 20), buy('diamond', 1, 12, 20), sell(1, 'chainmail_helmet', 1, 12, 10), sell(4, 'chainmail_chestplate', 1, 12, 10), sell(5, 'shield', 1, 12, 10)],
    [enchanted(14, 'diamond_leggings'), enchanted(8, 'diamond_boots')],
    [enchanted(8, 'diamond_helmet', 3, 30), enchanted(16, 'diamond_chestplate', 3, 30)],
  ],
  butcher: [
    [buy('chicken', 14), buy('porkchop', 7), buy('rabbit', 4), sell(1, 'rabbit_stew')],
    [buy('coal', 15, 16, 2), sell(1, 'cooked_porkchop', 5, 16, 5), sell(1, 'cooked_chicken', 8, 16, 5)],
    [buy('mutton', 7, 16, 20), buy('beef', 10, 16, 20)],
    [buy('dried_kelp_block', 10, 12, 30)],
    [buy('sweet_berries', 10, 12, 30)],
  ],
  cartographer: [
    [buy('paper', 24), sell(7, 'map')],
    [buy('glass_pane', 11, 16, 10), sell(13, 'map', 1, 12, 5, ['compass', 1])],
    [buy('compass', 1, 12, 20), sell(14, 'map', 1, 12, 10, ['compass', 1])],
    [sell(7, 'item_frame', 1, 12, 15)],
    [sell(8, 'painting', 3, 12, 30)],
  ],
  cleric: [
    [buy('rotten_flesh', 32), sell(1, 'redstone', 2)],
    [buy('gold_ingot', 3, 12, 10), sell(1, 'lapis_lazuli', 1, 12, 5)],
    [buy('rabbit_foot', 2, 12, 20), sell(4, 'glowstone', 1, 12, 10)],
    [buy('scute', 4, 12, 30), buy('glass_bottle', 9, 12, 30), sell(5, 'ender_pearl', 1, 12, 15)],
    [buy('nether_wart', 22, 12, 30), sell(3, 'experience_bottle', 1, 12, 30)],
  ],
  farmer: [
    [buy('wheat', 20), buy('potato', 26), buy('carrot', 22), buy('beetroot', 15), sell(1, 'bread', 6, 16, 1)],
    [buy('pumpkin', 6, 12, 10), sell(1, 'pumpkin_pie', 4, 12, 5), sell(1, 'apple', 4, 16, 5)],
    [sell(3, 'cookie', 18, 12, 10), buy('melon', 4, 12, 20)],
    [sell(1, 'cake', 1, 12, 15), sell(1, 'suspicious_stew', 1, 12, 15)],
    [sell(3, 'golden_carrot', 3, 12, 30), sell(4, 'glistering_melon_slice', 3, 12, 30)],
  ],
  fisherman: [
    [buy('string', 20), buy('coal', 10), sell(1, 'cooked_cod', 6, 16, 1, ['cod', 6]), sell(3, 'cod_bucket', 1, 16, 1)],
    [buy('cod', 15, 16, 10), sell(1, 'cooked_salmon', 6, 16, 5, ['salmon', 6]), sell(2, 'campfire', 1, 12, 5)],
    [buy('salmon', 13, 16, 20), enchanted(3, 'fishing_rod', 3, 10)],
    [buy('tropical_fish', 6, 12, 30)],
    [buy('pufferfish', 4, 12, 30), buy('oak_boat', 1, 12, 30)],
  ],
  fletcher: [
    [buy('stick', 32), sell(1, 'arrow', 16), sell(1, 'flint', 10, 12, 1, ['gravel', 10])],
    [buy('flint', 26, 12, 10), sell(2, 'bow', 1, 12, 5)],
    [buy('string', 14, 16, 20), sell(3, 'crossbow', 1, 12, 10)],
    [buy('feather', 24, 16, 30), enchanted(2, 'bow')],
    [buy('tripwire_hook', 8, 12, 30), enchanted(3, 'crossbow', 3, 15), (r) => T([E(), 2], [id('tipped_arrow_' + ['slowness', 'poison', 'swiftness', 'healing', 'strength'][r.int(5)]) || I.ARROW, 5], 12, 30, [I.ARROW, 5])],
  ],
  leatherworker: [
    [buy('leather', 6), sell(3, 'leather_leggings'), sell(7, 'leather_chestplate')],
    [buy('flint', 26, 12, 10), sell(5, 'leather_helmet', 1, 12, 5), sell(4, 'leather_boots', 1, 12, 5)],
    [buy('rabbit_hide', 9, 12, 20), sell(7, 'leather_chestplate', 1, 12, 10)],
    [buy('scute', 4, 12, 30), sell(6, 'leather_horse_armor', 1, 12, 15)],
    [sell(6, 'saddle', 1, 12, 30), sell(5, 'leather_helmet', 1, 12, 30)],
  ],
  librarian: [
    [buy('paper', 24), sell(9, 'bookshelf'), book],
    [buy('book', 4, 12, 10), sell(1, 'lantern', 1, 12, 5), book],
    [buy('ink_sac', 5, 12, 20), sell(1, 'glass', 4, 12, 10), book],
    [buy('writable_book', 2, 12, 30), sell(5, 'compass', 1, 12, 15), sell(4, 'clock', 1, 12, 15), book],
    [sell(20, 'name_tag', 1, 12, 30)],
  ],
  mason: [
    [buy('clay_ball', 10), sell(1, 'brick', 10, 16, 1)],
    [buy('stone', 20, 16, 10), sell(1, 'chiseled_stone_bricks', 4, 16, 5)],
    [buy('granite', 16, 16, 20), buy('andesite', 16, 16, 20), buy('diorite', 16, 16, 20), sell(1, 'polished_andesite', 4, 16, 10), sell(1, 'polished_diorite', 4, 16, 10), sell(1, 'polished_granite', 4, 16, 10)],
    [buy('quartz', 12, 12, 30), (r) => T([E(), 1], [id(anyColor(r) + '_terracotta'), 1], 12, 15), (r) => T([E(), 1], [id(anyColor(r) + '_glazed_terracotta'), 1], 12, 15)],
    [sell(1, 'quartz_pillar', 1, 12, 30), sell(1, 'quartz_block', 1, 12, 30)],
  ],
  shepherd: [
    [buy('white_wool', 18), buy('brown_wool', 18), buy('black_wool', 18), buy('gray_wool', 18), sell(2, 'shears')],
    [(r) => T([id(anyColor(r) + '_dye'), 12], [E(), 1], 16, 10), (r) => T([E(), 1], [id(anyColor(r) + '_wool'), 1], 16, 5), (r) => T([E(), 1], [id(anyColor(r) + '_carpet'), 4], 16, 5)],
    [(r) => T([id(anyColor(r) + '_dye'), 12], [E(), 1], 16, 20), (r) => T([E(), 3], [id(anyColor(r) + '_bed'), 1], 12, 10)],
    [(r) => T([id(anyColor(r) + '_dye'), 12], [E(), 1], 16, 30), sell(2, 'painting', 3, 12, 15)],
    [sell(2, 'painting', 3, 12, 30)],
  ],
  toolsmith: [
    [buy('coal', 15), sell(1, 'stone_axe'), sell(1, 'stone_shovel'), sell(1, 'stone_pickaxe'), sell(1, 'stone_hoe')],
    [buy('iron_ingot', 4, 12, 10), sell(36, 'bell', 1, 12, 5)],
    [buy('flint', 30, 12, 20), enchanted(1, 'iron_axe', 3, 10), enchanted(2, 'iron_shovel', 3, 10), enchanted(3, 'iron_pickaxe', 3, 10), sell(4, 'diamond_hoe', 1, 3, 10)],
    [buy('diamond', 1, 12, 30), enchanted(12, 'diamond_axe'), enchanted(5, 'diamond_shovel')],
    [enchanted(13, 'diamond_pickaxe', 3, 30)],
  ],
  weaponsmith: [
    [buy('coal', 15), sell(3, 'iron_axe'), enchanted(2, 'iron_sword')],
    [buy('iron_ingot', 4, 12, 10), sell(36, 'bell', 1, 12, 5)],
    [buy('flint', 24, 12, 20)],
    [buy('diamond', 1, 12, 30), enchanted(12, 'diamond_axe', 3, 15)],
    [enchanted(8, 'diamond_sword', 3, 30)],
  ],
};

/** Two new trades for reaching a level (fewer if the pool is small), skipping items that don't exist. */
export function newTrades(prof: string, level: number, seed: number): Trade[] {
  const pool = TRADES[prof]?.[level - 1];
  if (!pool) return [];
  const r = new Random(seed ^ (level * 7919));
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out: Trade[] = [];
  for (const i of order) {
    if (out.length >= 2) break;
    const t = pool[i](r);
    if (!t.result[0] || !t.cost[0] || (t.cost2 && !t.cost2[0])) continue;
    out.push(t);
  }
  return out;
}

/** A trade was made: the villager gains experience, and on reaching the next level learns new trades. */
export function villagerTraded(v: Villager, t: Trade) {
  v.tradeXp += t.xp ?? 2;
  if (v.level < 5 && v.tradeXp >= LEVEL_XP[v.level]) {
    v.level++;
    v.trades = [...(v.trades ?? []), ...newTrades(v.profession, v.level, v.id * 31 + v.level)];
    v.addEffect('regeneration', 200, 0);
    v.game.audio.play('villager.yes', v, 1, 1.2);
    for (let i = 0; i < 6; i++) v.game.particles?.spell(v.x + (Math.random() - 0.5), v.y + 1.8, v.z + (Math.random() - 0.5), 0x80ff40);
  }
}

// ------------------------------------------------------------------ the day of a villager
/** Workstations claimed by some villager ("x,y,z"). Rebuilt from the villagers' own records on every check. */
function claimed(v: Villager): Set<string> {
  const out = new Set<string>();
  for (const e of v.game.entities) {
    const o = e as unknown as Villager;
    if (o !== v && o.jobSite && (o as unknown as { typeName?: string }).typeName === 'Villager') out.add(`${o.jobSite.x},${o.jobSite.y},${o.jobSite.z}`);
  }
  return out;
}
/** Run each tick (server): find work, keep the workstation, restock, farm. */
export function villagerTick(v: Villager) {
  if (v.baby || v.noAi) return;
  const w = v.world;
  // an old save's profession names
  if (OLD_PROFESSIONS[v.profession]) v.profession = OLD_PROFESSIONS[v.profession];
  // the job site: lost if it's broken (unless the villager has traded), found if unemployed
  if (v.age % 100 === (v.id % 100)) {
    if (v.jobSite) {
      const prof = siteProfession(w.getId(v.jobSite.x, v.jobSite.y, v.jobSite.z));
      if (prof !== v.profession && w.chunkAt(v.jobSite.x, v.jobSite.z)) {
        v.jobSite = null;
        if (v.tradeXp === 0 && v.level <= 1) { v.profession = ''; v.trades = null; }
      }
    }
    if (!v.jobSite && v.profession !== 'nitwit') {
      const taken = claimed(v);
      const x0 = Math.floor(v.x), y0 = Math.floor(v.y), z0 = Math.floor(v.z);
      let best: { x: number; y: number; z: number; prof: string } | null = null, bd = 1e9;
      for (let dx = -16; dx <= 16; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -16; dz <= 16; dz++) {
        const prof = siteProfession(w.getId(x0 + dx, y0 + dy, z0 + dz));
        if (!prof || taken.has(`${x0 + dx},${y0 + dy},${z0 + dz}`)) continue;
        if (v.profession && v.profession !== prof) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = { x: x0 + dx, y: y0 + dy, z: z0 + dz, prof }; }
      }
      if (best) {
        v.jobSite = { x: best.x, y: best.y, z: best.z };
        if (!v.profession) { v.profession = best.prof; v.trades = null; v.level = 1; v.tradeXp = 0; for (let i = 0; i < 5; i++) v.game.particles?.spell(v.x, v.y + 2, v.z, 0x80ff40); }
      }
    }
  }
  // twice a day at work: restock (vanilla: up to twice a day when standing at the job site)
  const day = v.game.time % 24000;
  if (v.jobSite && (day === 2000 || day === 9000) && v.trades) for (const t of v.trades) t.uses = 0;
  // farmers bring in ripe crops and replant
  if (v.profession === 'farmer' && v.age % 40 === 0) farm(v);
}
function farm(v: Villager) {
  const w = v.world, x0 = Math.floor(v.x), y0 = Math.floor(v.y), z0 = Math.floor(v.z);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 0; dy++) {
    const x = x0 + dx, y = y0 + dy, z = z0 + dz;
    const val = w.get(x, y, z), cid = idOf(val);
    const ripe = (cid === B.WHEAT || cid === B.CARROTS || cid === B.POTATOES) && metaOf(val) >= 7 || cid === B2.BEETROOTS && metaOf(val) >= 3;
    if (!ripe) continue;
    w.set(x, y, z, pack(cid, 0));
    v.game.particles?.blockBreak(x + 0.5, y + 0.3, z + 0.5, cid);
    v.game.audio.play('dig.grass', { x: x + 0.5, y, z: z + 0.5 }, 0.6, 1);
    return;
  }
  // walk toward the nearest ripe crop now and then
  if (!v.path && Math.random() < 0.3) {
    for (let k = 0; k < 20; k++) {
      const x = x0 + Math.floor(Math.random() * 17) - 8, z = z0 + Math.floor(Math.random() * 17) - 8;
      for (let dy = -2; dy <= 2; dy++) {
        const val = w.get(x, y0 + dy, z), cid = idOf(val);
        if ((cid === B.WHEAT || cid === B.CARROTS || cid === B.POTATOES) && metaOf(val) >= 7) { v.setPathTo(x, y0 + dy, z, 0.04); return; }
      }
    }
  }
}

/** Trades of a villager (made on first look): the novice level's, plus each level it has reached. */
export function villagerTrades(v: Villager): Trade[] {
  if (OLD_PROFESSIONS[v.profession]) v.profession = OLD_PROFESSIONS[v.profession];
  if (v.trades) return v.trades;
  if (!v.profession || v.profession === 'nitwit' || !TRADES[v.profession]) return (v.trades = []);
  const out: Trade[] = [];
  for (let l = 1; l <= Math.max(1, v.level); l++) out.push(...newTrades(v.profession, l, v.id * 31 + l));
  return (v.trades = out);
}
void getItem; void TOOLS; void ARMOR; void stack;
