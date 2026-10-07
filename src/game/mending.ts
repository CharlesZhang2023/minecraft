// Mending (kept apart from combat.ts so the item entities can use it without an import cycle).
import type { Player } from './player';
import type { ItemStack } from './items';
import { level } from './enchant';

/** Experience picked up repairs a damaged mending item (2 durability per point) before it counts as xp; returns the xp left. */
export function mend(p: Player, xp: number): number {
  const items = [p.inventory.held(), p.inventory.offhand, ...p.inventory.armor].filter((s): s is ItemStack => !!s && level(s, 'mending') > 0 && (s.damage ?? 0) > 0);
  if (!items.length) return xp;
  const s = items[Math.floor(Math.random() * items.length)];
  const fix = Math.min(s.damage ?? 0, xp * 2);
  s.damage = (s.damage ?? 0) - fix;
  return xp - Math.ceil(fix / 2);
}
