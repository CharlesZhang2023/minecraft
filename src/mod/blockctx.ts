// Context objects the game hands to mod block and item hooks (server side, inside the acting dimension).
import { idOf, metaOf, pack, BLOCKS, FACING6 } from '../world/blocks';
import { F6_D6 } from '../game/redstone';
import type { Game } from '../game/game';
import type { Player } from '../game/player';
import type { ItemStack } from '../game/items';
import type { BlockCtx, PlayerBlockCtx, ItemCtx } from './types';
import { guard } from './state';

export function blockCtx(game: Game, x: number, y: number, z: number, v = game.world!.get(x, y, z)): BlockCtx {
  const w = game.world!;
  return {
    game, world: w, x, y, z, v, id: idOf(v), meta: metaOf(v),
    setMeta: (m) => { w.set(x, y, z, pack(idOf(w.get(x, y, z)), m & 15)); },
    set: (nv) => { w.set(x, y, z, nv); },
    tile: <T extends object>() => w.getTile(x, y, z) as T | undefined,
    tileChanged: () => {
      const c = w.chunkAt(x, z);
      if (c) c.modified = true;
      w.onTileChange(x, y, z);
    },
    schedule: (d) => game.ticker?.schedule(x, y, z, Math.max(1, d | 0)),
    neighbor: (dx, dy, dz) => w.get(x + dx, y + dy, z + dz),
    power: () => game.redstone.inputAt(x, y, z),
    powerFrom: (side) => {
      const d = FACING6[side];
      return d ? game.redstone.powerFrom(x + d[0], y + d[1], z + d[2], F6_D6[side ^ 1]) : 0;
    },
    updateRedstone: () => game.redstone.update(x, y, z),
  };
}

export function playerBlockCtx(game: Game, player: Player, x: number, y: number, z: number, face: number, held: ItemStack | null): PlayerBlockCtx {
  return {
    ...blockCtx(game, x, y, z),
    player, held, face,
    openScreen: (id, ...args) => (game.ui as unknown as { openMod(id: string, ...a: unknown[]): void }).openMod(id, ...args),
  };
}

export function itemCtx(game: Game, player: Player, stack: ItemStack, consume: (n: number) => void, damage: (n: number) => void): ItemCtx {
  return { game, world: game.world!, player, stack, consume: (n = 1) => consume(n), damage: (n = 1) => damage(n) };
}

/** A block's mod hook, guarded: errors are the mod's, never the game's. */
export function callBlock<T>(id: number, where: string, fn: () => T, fallback: T): T {
  return guard(BLOCKS[id].mod, where, fn, fallback);
}
