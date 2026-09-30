import type { Game } from './game';
import { SMELTING } from './recipes';
import { getItem, ItemStack, stack, I } from './items';
import { B, idOf, metaOf, pack } from '../world/blocks';

export interface FurnaceTile {
  type: 'furnace';
  slots: (ItemStack | null)[]; // input, fuel, output
  burn: number;
  burnMax: number;
  cook: number;
  xp?: number;
}

export const COOK_TIME = 200;

function canSmelt(t: FurnaceTile): boolean {
  const inp = t.slots[0];
  if (!inp) return false;
  const r = SMELTING[inp.id];
  if (!r) return false;
  const out = t.slots[2];
  if (!out) return true;
  if (out.id !== r.out) return false;
  return out.count < getItem(out.id).maxStack;
}

/** Tick every furnace in loaded chunks. */
export function tickFurnaces(game: Game) {
  const w = game.world!;
  for (const c of w.chunks.values()) {
    if (!c.ready || !c.tiles.size) continue;
    for (const [i, tile] of c.tiles) {
      if (tile.type !== 'furnace') continue;
      const t = tile as unknown as FurnaceTile;
      const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
      const wasBurning = t.burn > 0;
      let changed = false;
      if (t.burn > 0) t.burn--;
      if (t.burn === 0 && canSmelt(t)) {
        const fuel = t.slots[1];
        const ticks = fuel ? getItem(fuel.id).fuel ?? 0 : 0;
        if (ticks > 0) {
          t.burn = t.burnMax = ticks;
          changed = true;
          fuel!.count--;
          if (fuel!.count <= 0) t.slots[1] = getItem(fuel!.id).name === 'lava_bucket' ? stack(I.BUCKET) : null;
        }
      }
      if (t.burn > 0 && canSmelt(t)) {
        t.cook++;
        if (t.cook >= COOK_TIME) {
          t.cook = 0;
          const inp = t.slots[0]!;
          const r = SMELTING[inp.id];
          if (t.slots[2]) t.slots[2].count++;
          else t.slots[2] = stack(r.out);
          t.xp = (t.xp ?? 0) + r.xp;
          inp.count--;
          if (inp.count <= 0) t.slots[0] = null;
          changed = true;
        }
      } else if (t.cook > 0) t.cook = Math.max(0, t.cook - 2);
      if (wasBurning !== t.burn > 0) {
        const v = w.get(x, y, z);
        if (idOf(v) === B.FURNACE || idOf(v) === B.LIT_FURNACE) {
          // swap the block without dropping the tile entity
          const tile2 = c.tiles.get(i)!;
          w.set(x, y, z, pack(t.burn > 0 ? B.LIT_FURNACE : B.FURNACE, metaOf(v)));
          c.tiles.set(i, tile2);
        }
      }
      if (changed) c.modified = true;
    }
  }
}

