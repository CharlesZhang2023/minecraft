// Shapes shared by the mod loader, the game's hook points and mods themselves. Types only: safe to import from
// workers (the mesher and terrain generator run mod block models and world features too).
import type { Game } from '../game/game';
import type { World } from '../world/world';
import type { Player } from '../game/player';
import type { ItemStack, ItemDef } from '../game/items';
import type { Box, Neighbor, Shape } from '../world/models';
import type { Entity } from '../entity/entity';
import type { Random } from '../noise';

// ------------------------------------------------------------------ metadata (mod.json)
/** A mod's metadata, as in its mod.json (Fabric's fabric.mod.json, trimmed to what a browser game needs). */
export interface ModManifest {
  schemaVersion: 1;
  /** Lowercase letters, digits, '_' and '-': the namespace of everything the mod registers ('computer:terminal'). */
  id: string;
  /** Semantic version, e.g. 1.2.0. */
  version: string;
  name?: string;
  description?: string;
  authors?: string[];
  /** '*' = needed on both sides (the host and every player must run it); 'client' = only changes what you see. */
  environment?: '*' | 'client';
  /** Export names of the entrypoints (default main / client). */
  entrypoints?: { main?: string; client?: string };
  /** Other mods (and 'minecraft', the game) this needs, with version ranges: { "minecraft": ">=1.0", "lib": "^2.1" }. */
  depends?: Record<string, string>;
  /** Mods this can't run with. */
  breaks?: Record<string, string>;
  /** Shown in the mod list: a colour (#rrggbb) or an item of the mod ('item:computer:computer'). */
  icon?: string;
  /** Build only: the entry source file, relative to the mod's folder (default main.ts). */
  entry?: string;
}

/** A mod as stored in the browser: its manifest and code (one ES module), identified by the code's SHA-256. */
export interface ModPackage {
  manifest: ModManifest;
  code: string;
  sha256: string;
  /** Where it came from: the game's mod repository, a file, or the host of a game you joined. */
  source: 'repo' | 'file' | 'host';
  added: number;
}

/** What a mod's module exports. Every entrypoint gets the same per-mod context. */
export interface ModModule {
  manifest?: ModManifest;
  /** Runs everywhere the game's registries live: the page and its workers (mesher, terrain). Register content here. */
  main?: (mod: import('./api').ModContext) => void | Promise<void>;
  /** Runs in the page only: screens, renderers, HUD, key bindings, textures, sounds. */
  client?: (mod: import('./api').ModContext) => void | Promise<void>;
  [k: string]: unknown;
}

// ------------------------------------------------------------------ gameplay hooks
/** Fabric's ActionResult: 'pass' lets the next handler (and finally the game) decide. */
export type ActionResult = 'pass' | 'success' | 'fail';

/** A block in a running world, seen from the simulation (server side). */
export interface BlockCtx {
  game: Game;
  world: World;
  x: number; y: number; z: number;
  /** The block's packed value, id and meta when the hook was called. */
  v: number; id: number; meta: number;
  /** Change this block's meta (keeps its tile entity), or replace it. */
  setMeta(meta: number): void;
  set(v: number): void;
  /** This block's tile entity (mod blocks with a `tile` spec get one when placed). */
  tile<T extends object = Record<string, unknown>>(): T | undefined;
  /** The tile entity changed: save it and send it to the players who can see it. */
  tileChanged(): void;
  /** Run `scheduledTick` after `delay` ticks. */
  schedule(delay: number): void;
  /** The packed block value at an offset. */
  neighbor(dx: number, dy: number, dz: number): number;
  /** Redstone power arriving here (0-15). */
  power(): number;
  /** Redstone power arriving from one side (vanilla 6-way order: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east). */
  powerFrom(side: number): number;
  /** Tell neighbouring redstone this block's output changed. */
  updateRedstone(): void;
}

/** A player acting on a block. `face` is the face clicked (0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z). */
export interface PlayerBlockCtx extends BlockCtx {
  player: Player;
  held: ItemStack | null;
  face: number;
  /** Open a mod screen for this player (registered with mod.client.screen). */
  openScreen(id: string, ...args: unknown[]): void;
}

/** Placing a block: return the meta to place it with, or null if it can't go here. */
export interface PlaceCtx {
  game: Game;
  world: World;
  player: Player;
  x: number; y: number; z: number;
  /** Face of the block that was clicked. */
  face: number;
  /** The way the player faces: 0 north, 1 east, 2 south, 3 west. */
  facing: number;
  /** 6-way facing toward the player (vanilla order: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east). */
  facing6: number;
  /** Where on the clicked face (0..1) the click landed vertically. */
  hitY: number;
  held: ItemStack;
}

export interface DropCtx { id: number; meta: number; tool: ItemDef | undefined; rng: Random; silk: boolean }

/** A tile entity: plain JSON-safe data saved with the chunk and sent to players near it. */
export interface TileSpec<T extends object = Record<string, unknown>> {
  create(c: BlockCtx): T;
  /** Every tick while the chunk is simulated. */
  tick?(c: BlockCtx, tile: T): void;
  /** Items to drop when the block is broken (default: the tile's `items` array, if any). */
  contents?(tile: T): (ItemStack | null)[];
}

/**
 * Hooks a mod block can have (Fabric's Block overrides). All optional; the game's own rules apply otherwise.
 * `model`, `collision` and `selection` also run in the mesher worker, so they must only use their arguments.
 */
export interface BlockBehavior {
  placementMeta?(c: PlaceCtx): number | null;
  onPlaced?(c: BlockCtx & { player: Player | null }): void;
  /** Right-click. Return true if it did something (the hand swings, nothing gets placed). */
  onUse?(c: PlayerBlockCtx): boolean;
  /** Broken by a player or the world, after it's gone (the context still describes what it was). */
  onBreak?(c: BlockCtx & { player: Player | null }): void;
  drops?(c: DropCtx): ItemStack[];
  /** Support rule: return false to break the block (e.g. it needs something under it). */
  canStay?(c: BlockCtx): boolean;
  neighborChanged?(c: BlockCtx): void;
  randomTick?(c: BlockCtx): void;
  scheduledTick?(c: BlockCtx): void;
  tile?: TileSpec<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  redstone?: {
    /** Power sent toward the neighbour in D6 direction `dir` (0 down, 1 up, 2 north, 3 south, 4 west, 5 east). */
    power?(c: BlockCtx, dir: number, strong: boolean): number;
    /** Redstone around it changed. */
    update?(c: BlockCtx): void;
  };
  /** Box model in 16ths (Render.Model blocks); `faces` are the block's texture layers. Runs in the mesher too. */
  model?(meta: number, nb: Neighbor | undefined, faces: number[]): Box[];
  collision?(meta: number, nb?: Neighbor): Shape[];
  selection?(meta: number, nb?: Neighbor): Shape[];
}

/** A player using an item. */
export interface ItemCtx {
  game: Game;
  world: World;
  player: Player;
  stack: ItemStack;
  /** Use up n of the held stack (not in creative). */
  consume(n?: number): void;
  /** Wear the held tool by n points. */
  damage(n?: number): void;
}

export interface ItemBehavior {
  /** Right-click in the air. Return true if it did something. */
  use?(c: ItemCtx): boolean;
  /**
   * Hold-to-use items (wands, beams...): runs every tick while the use button is held, from `ticks` 0 at the press,
   * instead of any right-click use (blocks aren't opened, nothing is placed). On phones, press and hold uses it
   * (instead of mining) and a tap is a short press.
   */
  useTick?(c: ItemCtx & { ticks: number }): void;
  /** The button was let go (or the item put away) after `ticks` ticks of useTick. */
  useStop?(c: ItemCtx & { ticks: number }): void;
  /** Right-click on a block (before the block's own use). Return true if it did something. */
  useOnBlock?(c: ItemCtx & { x: number; y: number; z: number; face: number; v: number }): boolean;
  /** Hit an entity with it. */
  hitEntity?(c: ItemCtx & { target: Entity }): void;
  /** Extra tooltip lines (client). */
  tooltip?(stack: ItemStack, lines: string[]): void;
}
