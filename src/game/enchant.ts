// Enchantments (1.8-style selection, a practical subset of effects).
import { getItem, ItemStack } from './items';
import { Random } from '../noise';

export interface EnchDef { id: string; name: string; max: number; weight: number; applies: (s: ItemStack) => boolean }

const tool = (s: ItemStack) => ['pickaxe', 'axe', 'shovel', 'shears'].includes(getItem(s.id).tool?.type ?? '');
const sword = (s: ItemStack) => getItem(s.id).tool?.type === 'sword';
const bow = (s: ItemStack) => getItem(s.id).name === 'bow';
const armor = (s: ItemStack) => !!getItem(s.id).armor;
const boots = (s: ItemStack) => getItem(s.id).armor?.slot === 3;
const damageable = (s: ItemStack) => !!getItem(s.id).durability;

export const ENCHANTS: EnchDef[] = [
  { id: 'efficiency', name: 'Efficiency', max: 5, weight: 10, applies: tool },
  { id: 'unbreaking', name: 'Unbreaking', max: 3, weight: 5, applies: damageable },
  { id: 'fortune', name: 'Fortune', max: 3, weight: 2, applies: (s) => tool(s) && getItem(s.id).tool?.type !== 'shears' },
  { id: 'sharpness', name: 'Sharpness', max: 5, weight: 10, applies: sword },
  { id: 'knockback', name: 'Knockback', max: 2, weight: 5, applies: sword },
  { id: 'fire_aspect', name: 'Fire Aspect', max: 2, weight: 2, applies: sword },
  { id: 'power', name: 'Power', max: 5, weight: 10, applies: bow },
  { id: 'punch', name: 'Punch', max: 2, weight: 2, applies: bow },
  { id: 'flame', name: 'Flame', max: 1, weight: 2, applies: bow },
  { id: 'infinity', name: 'Infinity', max: 1, weight: 1, applies: bow },
  { id: 'protection', name: 'Protection', max: 4, weight: 10, applies: armor },
  { id: 'feather_falling', name: 'Feather Falling', max: 4, weight: 5, applies: boots },
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const enchName = (id: string, lvl: number) => `${ENCHANTS.find((e) => e.id === id)?.name ?? id} ${ROMAN[lvl] ?? lvl}`;
export const level = (s: ItemStack | null | undefined, id: string) => (s?.ench?.[id] ?? 0);
export const canEnchant = (s: ItemStack | null) => !!s && s.count === 1 && !s.ench && ENCHANTS.some((e) => e.applies(s));

/** Level costs for the three slots (1.8 formula). */
export function slotCosts(r: Random, shelves: number): [number, number, number] {
  shelves = Math.min(15, shelves);
  const base = 1 + r.int(8) + (shelves >> 1) + r.int(shelves + 1);
  return [Math.max(Math.floor(base / 3), 1), Math.floor((base * 2) / 3) + 1, Math.max(base, shelves * 2)];
}

/** Enchantments granted for a given level cost. */
export function rollEnchants(s: ItemStack, cost: number, r: Random): Record<string, number> {
  const enchantability = 10;
  let lvl = cost + 1 + r.int(enchantability / 4 + 1) + r.int(enchantability / 4 + 1);
  lvl = Math.max(1, Math.round(lvl * (1 + (r.next() + r.next() - 1) * 0.15)));
  const pool = ENCHANTS.filter((e) => e.applies(s));
  const out: Record<string, number> = {};
  const pick = () => {
    const avail = pool.filter((e) => !(e.id in out) && !(e.id === 'fortune' && 'silk' in out));
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
  return out;
}
