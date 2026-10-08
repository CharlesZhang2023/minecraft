// Enchantments: 1.8 selection weights and levels, enchanted books, and anvil combination costs.
import { getItem, ItemStack, I, I2, I3, itemId } from './items';
import { Random } from '../noise';
import { B } from '../world/blocks';
import { tc } from '../i18n/i18n';

export interface EnchDef { id: string; name: string; max: number; weight: number; applies: (s: ItemStack) => boolean; group?: string; /** Only from loot, trading and fishing (never the table). */ treasure?: boolean; curse?: boolean }

const toolType = (s: ItemStack) => getItem(s.id).tool?.type ?? '';
const digger = (s: ItemStack) => ['pickaxe', 'axe', 'shovel'].includes(toolType(s));
const tool = (s: ItemStack) => digger(s) || toolType(s) === 'shears';
const sword = (s: ItemStack) => toolType(s) === 'sword';
const bow = (s: ItemStack) => s.id === I.BOW;
const rod = (s: ItemStack) => s.id === I2.FISHING_ROD;
// elytra sit in the chest slot but protect nothing: they only take Unbreaking
const armor = (s: ItemStack) => !!getItem(s.id).armor?.points;
const helmet = (s: ItemStack) => getItem(s.id).armor?.slot === 0;
const chest = (s: ItemStack) => getItem(s.id).armor?.slot === 1 && armor(s);
const boots = (s: ItemStack) => getItem(s.id).armor?.slot === 3;
const damageable = (s: ItemStack) => !!getItem(s.id).durability;
const wearable = (s: ItemStack) => getItem(s.id).armor !== undefined || s.id === B.PUMPKIN;
const trident = (s: ItemStack) => getItem(s.id).name === 'trident';
const crossbow = (s: ItemStack) => getItem(s.id).name === 'crossbow';

export const ENCHANTS: EnchDef[] = [
  { id: 'protection', name: 'Protection', max: 4, weight: 10, applies: armor, group: 'protection' },
  { id: 'fire_protection', name: 'Fire Protection', max: 4, weight: 5, applies: armor, group: 'protection' },
  { id: 'feather_falling', name: 'Feather Falling', max: 4, weight: 5, applies: boots },
  { id: 'blast_protection', name: 'Blast Protection', max: 4, weight: 2, applies: armor, group: 'protection' },
  { id: 'projectile_protection', name: 'Projectile Protection', max: 4, weight: 5, applies: armor, group: 'protection' },
  { id: 'respiration', name: 'Respiration', max: 3, weight: 2, applies: helmet },
  { id: 'aqua_affinity', name: 'Aqua Affinity', max: 1, weight: 2, applies: helmet },
  { id: 'thorns', name: 'Thorns', max: 3, weight: 1, applies: chest },
  { id: 'depth_strider', name: 'Depth Strider', max: 3, weight: 2, applies: boots },
  { id: 'sharpness', name: 'Sharpness', max: 5, weight: 10, applies: sword, group: 'damage' },
  { id: 'smite', name: 'Smite', max: 5, weight: 5, applies: sword, group: 'damage' },
  { id: 'bane_of_arthropods', name: 'Bane of Arthropods', max: 5, weight: 5, applies: sword, group: 'damage' },
  { id: 'knockback', name: 'Knockback', max: 2, weight: 5, applies: sword },
  { id: 'fire_aspect', name: 'Fire Aspect', max: 2, weight: 2, applies: sword },
  { id: 'looting', name: 'Looting', max: 3, weight: 2, applies: sword },
  { id: 'efficiency', name: 'Efficiency', max: 5, weight: 10, applies: tool },
  { id: 'silk_touch', name: 'Silk Touch', max: 1, weight: 1, applies: digger, group: 'mining' },
  { id: 'unbreaking', name: 'Unbreaking', max: 3, weight: 5, applies: damageable },
  { id: 'fortune', name: 'Fortune', max: 3, weight: 2, applies: digger, group: 'mining' },
  { id: 'power', name: 'Power', max: 5, weight: 10, applies: bow },
  { id: 'punch', name: 'Punch', max: 2, weight: 2, applies: bow },
  { id: 'flame', name: 'Flame', max: 1, weight: 2, applies: bow },
  { id: 'infinity', name: 'Infinity', max: 1, weight: 1, applies: bow },
  { id: 'luck_of_the_sea', name: 'Luck of the Sea', max: 3, weight: 2, applies: rod },
  { id: 'lure', name: 'Lure', max: 3, weight: 2, applies: rod },
  // 1.9-1.16
  { id: 'frost_walker', name: 'Frost Walker', max: 2, weight: 2, applies: boots, group: 'boots_fluid', treasure: true },
  { id: 'mending', name: 'Mending', max: 1, weight: 2, applies: damageable, group: 'infinite', treasure: true },
  { id: 'binding_curse', name: 'Curse of Binding', max: 1, weight: 1, applies: wearable, treasure: true, curse: true },
  { id: 'vanishing_curse', name: 'Curse of Vanishing', max: 1, weight: 1, applies: damageable, treasure: true, curse: true },
  { id: 'sweeping', name: 'Sweeping Edge', max: 3, weight: 2, applies: sword },
  { id: 'loyalty', name: 'Loyalty', max: 3, weight: 5, applies: trident, group: 'riptide' },
  { id: 'impaling', name: 'Impaling', max: 5, weight: 2, applies: trident },
  { id: 'riptide', name: 'Riptide', max: 3, weight: 2, applies: trident, group: 'riptide2' },
  { id: 'channeling', name: 'Channeling', max: 1, weight: 1, applies: trident, group: 'riptide2' },
  { id: 'multishot', name: 'Multishot', max: 1, weight: 2, applies: crossbow, group: 'piercing' },
  { id: 'quick_charge', name: 'Quick Charge', max: 3, weight: 5, applies: crossbow },
  { id: 'piercing', name: 'Piercing', max: 4, weight: 10, applies: crossbow, group: 'piercing' },
  { id: 'soul_speed', name: 'Soul Speed', max: 3, weight: 1, applies: boots, treasure: true },
];
export const ENCH_BY_ID = new Map(ENCHANTS.map((e) => [e.id, e]));

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** An enchantment and its level as shown, in the player's language. */
export const enchName = (id: string, lvl: number) => `${tc('enchantment', ENCH_BY_ID.get(id)?.name ?? id)}${ENCH_BY_ID.get(id)?.max === 1 && lvl === 1 ? '' : ' ' + (ROMAN[lvl] ?? lvl)}`;
/** Effective level of an enchantment on a tool/armour piece (stored book enchantments don't count). */
export const level = (s: ItemStack | null | undefined, id: string) => (s && s.id !== I3.ENCHANTED_BOOK ? s.ench?.[id] ?? 0 : 0);
export const isBook = (s: ItemStack | null | undefined) => !!s && s.id === I3.ENCHANTED_BOOK;
export const canEnchant = (s: ItemStack | null) => !!s && s.count === 1 && !s.ench && (s.id === I.BOOK || ENCHANTS.some((e) => e.applies(s)));
/** Two enchantments that can't share an item (Protection types, damage types, Silk Touch/Fortune). */
const PAIRS = [['depth_strider', 'frost_walker'], ['infinity', 'mending'], ['riptide', 'loyalty'], ['riptide', 'channeling'], ['multishot', 'piercing']];
export const conflicts = (a: string, b: string) => {
  if (a === b) return false;
  if (PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x))) return true;
  const ga = ENCH_BY_ID.get(a)?.group, gb = ENCH_BY_ID.get(b)?.group;
  return !!ga && ga === gb;
};

/** Level costs for the three slots (1.8 formula). */
export function slotCosts(r: Random, shelves: number): [number, number, number] {
  shelves = Math.min(15, shelves);
  const base = 1 + r.int(8) + (shelves >> 1) + r.int(shelves + 1);
  return [Math.max(Math.floor(base / 3), 1), Math.floor((base * 2) / 3) + 1, Math.max(base, shelves * 2)];
}

/** Enchantments granted for a given level cost (books may receive any enchantment). */
export function rollEnchants(s: ItemStack, cost: number, r: Random): Record<string, number> {
  const book = s.id === I.BOOK;
  const enchantability = book ? 1 : 10;
  let lvl = cost + 1 + r.int(Math.floor(enchantability / 4) + 1) + r.int(Math.floor(enchantability / 4) + 1);
  lvl = Math.max(1, Math.round(lvl * (1 + (r.next() + r.next() - 1) * 0.15)));
  const pool = ENCHANTS.filter((e) => !e.treasure && (book || e.applies(s)));
  const out: Record<string, number> = {};
  const pick = () => {
    const avail = pool.filter((e) => !(e.id in out) && !Object.keys(out).some((k) => conflicts(k, e.id)));
    const total = avail.reduce((a, e) => a + e.weight, 0);
    if (!total) return;
    let k = r.int(total);
    for (const e of avail) {
      if ((k -= e.weight) < 0) {
        out[e.id] = Math.max(1, Math.min(e.max, Math.ceil((lvl / 30) * e.max)));
        return;
      }
    }
  };
  pick();
  while (r.int(50) <= lvl) {
    pick();
    lvl = Math.floor(lvl / 2);
  }
  // enchanted books keep all but one random enchantment (vanilla 1.8)
  const keys = Object.keys(out);
  if (book && keys.length > 1) delete out[keys[r.int(keys.length)]];
  return out;
}

/** A random enchanted book as found in loot (one enchantment, random level). */
export function randomBook(r: Random): ItemStack {
  const e = ENCHANTS[r.int(ENCHANTS.length)];
  return { id: I3.ENCHANTED_BOOK, count: 1, ench: { [e.id]: 1 + r.int(e.max) } };
}

// ------------------------------------------------------------------ anvil
function repairMaterial(s: ItemStack): number | undefined {
  const mats: Record<string, number> = {
    wooden: B.OAK_PLANKS, stone: B.COBBLESTONE, iron: I.IRON_INGOT, golden: I.GOLD_INGOT, diamond: I.DIAMOND, leather: I.LEATHER, elytra: itemId('phantom_membrane'), netherite: itemId('netherite_ingot'), chainmail: I.IRON_INGOT, turtle: itemId('scute'), shield: B.OAK_PLANKS, trident: 0,
  };
  return mats[getItem(s.id).name.split('_')[0]];
}
/** Anvil cost multiplier by enchantment rarity (weight 10/5/2/1 -> 1/2/4/8). */
const rarityCost = (id: string) => ({ 10: 1, 5: 2, 2: 4, 1: 8 } as Record<number, number>)[ENCH_BY_ID.get(id)?.weight ?? 10] ?? 1;

export interface AnvilResult { out: ItemStack; cost: number; useRight: number }

/** Combine left + right (+ optional new name). Returns null if nothing would change. */
export function anvilCombine(left: ItemStack | null, right: ItemStack | null, name: string | null): AnvilResult | null {
  if (!left) return null;
  const d = getItem(left.id);
  const out: ItemStack = { ...left, ...(left.ench ? { ench: { ...left.ench } } : {}) };
  let cost = 0, useRight = 0;
  const prior = left.repair ?? 0;
  if (right) {
    const rightBook = isBook(right);
    const mat = repairMaterial(left);
    if (d.durability && mat !== undefined && right.id === mat && (left.damage ?? 0) > 0) {
      // repair with raw material: 25% durability per item
      let dmg = left.damage ?? 0, n = 0;
      while (dmg > 0 && n < right.count) { dmg = Math.max(0, dmg - Math.floor(d.durability / 4)); n++; cost++; }
      out.damage = dmg;
      useRight = n;
    } else if (right.id === left.id || rightBook) {
      if (!rightBook && d.durability && (left.damage ?? 0) > 0) {
        const keep = d.durability - (left.damage ?? 0) + (d.durability - (right.damage ?? 0)) + Math.floor(d.durability * 0.12);
        out.damage = Math.max(0, d.durability - keep);
        cost += 2;
      }
      let any = false;
      for (const [id, lvl] of Object.entries(right.ench ?? {})) {
        const e = ENCH_BY_ID.get(id);
        if (!e) continue;
        const ok = isBook(left) || e.applies(left);
        if (!ok || Object.keys(out.ench ?? {}).some((k) => conflicts(k, id))) { cost++; continue; }
        const cur = out.ench?.[id] ?? 0;
        const nl = Math.min(e.max, cur === lvl ? cur + 1 : Math.max(cur, lvl));
        if (nl !== cur) any = true;
        out.ench = { ...(out.ench ?? {}), [id]: nl };
        let m = rarityCost(id);
        if (rightBook) m = Math.max(1, Math.floor(m / 2));
        cost += m * nl;
      }
      if (!any && cost === 0 && out.damage === left.damage) return null;
      useRight = 1;
    } else return null;
  }
  if (name !== null && name !== (left.name ?? '') && name !== '') { out.name = name; cost += 1; }
  else if (name === '' && left.name) { delete out.name; cost += 1; }
  if (cost <= 0) return null;
  cost += prior;
  out.repair = prior * 2 + 1;
  return { out, cost, useRight };
}
