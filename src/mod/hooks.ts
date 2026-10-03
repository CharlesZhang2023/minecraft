// What mods have plugged into the game, kept as plain tables the game's hook points read. Nothing here imports
// the game's heavier modules, so the worker realm can share it (it only uses the world features).
import type { Game } from '../game/game';
import type { Client } from '../client/client';
import type { Player } from '../game/player';
import type { World, Dimension } from '../world/world';
import type { Entity } from '../entity/entity';
import type { UI } from '../ui/ui';
import type { Screen } from '../ui/screen';
import type { ItemStack } from '../game/items';
import type { Random } from '../noise';
import type { RenderContext } from './render';
import type { BlockRef } from './registry';

// ------------------------------------------------------------------ commands
export interface CommandCtx {
  game: Game;
  player: Player;
  /** The words after the command name. */
  args: string[];
  /** Everything after the command name. */
  rest: string;
  /** Send a chat line to whoever ran the command. */
  reply(msg: string): void;
  /** A '~'-relative coordinate (index 0 x, 1 y, 2 z). */
  coord(s: string | undefined, axis: 0 | 1 | 2): number;
}
export interface CommandDef {
  name: string;
  aliases?: string[];
  /** e.g. '/computer <list|tp>' (shown by /help). */
  usage?: string;
  description?: string;
  /** 'host' (the default): the host, or everyone when cheats are on for all; 'all': anyone. */
  permission?: 'host' | 'all';
  /** Throw an Error to reply with its message in red; return lines to reply with them. */
  run(c: CommandCtx): void | string | string[];
}
export const COMMANDS = new Map<string, { mod: string; def: CommandDef }>();

// ------------------------------------------------------------------ networking
export interface ChannelHandlers { mod: string; server?: (data: unknown, player: Player, game: Game) => void; client?: (data: unknown, client: Client) => void }
export const CHANNELS = new Map<string, ChannelHandlers>();
/** Largest payload (as JSON) a player may send on a mod channel. */
export const MAX_PAYLOAD = 64 * 1024;

// ------------------------------------------------------------------ client extension points
export type ScreenFactory = (ui: UI, ...args: unknown[]) => Screen;
export const SCREENS = new Map<string, { mod: string; make: ScreenFactory }>();
export interface KeyBinding { mod: string; name: string; key: string; onPress(client: Client): void }
export const KEYBINDS: KeyBinding[] = [];
export type TileRenderer = (r: RenderContext, tile: Record<string, unknown>, x: number, y: number, z: number, v: number) => void;
/** By block key. */
export const TILE_RENDERERS = new Map<string, { mod: string; draw: TileRenderer }>();
export type EntityRendererFn = (r: RenderContext, e: Entity) => void;
/** By entity type name. */
export const ENTITY_RENDERERS = new Map<string, { mod: string; draw: EntityRendererFn }>();
export interface CreativeTab { mod: string; id: string; name: string; icon: () => number; items: () => ItemStack[] }
export const CREATIVE_TABS: CreativeTab[] = [];
export const CONFIG_SCREENS = new Map<string, (parent: Screen) => Screen>();

// ------------------------------------------------------------------ entities
export type EntityFactory = (world: World, game: Game) => Entity;
/** By type name ('mod:name'): what saves, spawn eggs, /summon and guests' puppets are made from. */
export const ENTITIES = new Map<string, { mod: string; make: EntityFactory; ctor?: unknown }>();

// ------------------------------------------------------------------ world generation (runs in the terrain worker)
/** A chunk just generated, in local coordinates (0-15, 0-255, 0-15). */
export interface ChunkGenCtx {
  cx: number; cz: number;
  seed: number;
  dim: Dimension;
  /** Seeded from the world seed, the chunk and the feature's name. */
  rng: Random;
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, v: number): void;
  /** Highest non-air y in a column (-1 if none). */
  height(x: number, z: number): number;
  /** Biome index (world/biomes.ts BIOMES) of a column. */
  biome(x: number, z: number): number;
}
export interface FeatureSpec {
  /** Unique within the mod. */
  name: string;
  /** Default: the overworld only. */
  dims?: Dimension[];
  generate(c: ChunkGenCtx): void;
}
export const FEATURES: { mod: string; key: string; spec: FeatureSpec }[] = [];
export interface OreSpec {
  block: BlockRef | string;
  /** Vein size (vanilla iron 9, diamond 8, coal 17). */
  size: number;
  /** Veins per chunk. */
  count: number;
  minY: number;
  maxY: number;
  dims?: Dimension[];
  /** What it replaces (block keys / names); default stone (netherrack in the Nether, end stone in the End). */
  replace?: string[];
}

/** Display names of loaded mods, by id. */
export const MOD_NAMES = new Map<string, string>();

/** The page's client and running simulation, for API calls that need them (set by the game). */
export const live = { client: null as Client | null, game: null as Game | null };

// ------------------------------------------------------------------ the mod session (implemented by the loader)
/** A mod as a host describes it to guests. */
export interface HostModInfo { id: string; version: string; sha256: string; name?: string }
/**
 * How the game talks to the mod loader without importing it (the loader imports the whole game). The defaults are
 * what a page without the loader would do: no mods.
 */
export const session = {
  /** The first message for a new worker so it numbers blocks like this page (null: nothing to set up). */
  workerInit: (): unknown => null,
  /** Mods every player must run in a game hosted here. */
  hostMods: (): HostModInfo[] => [],
  /** What a joining guest tells the host it has (informative). */
  offered: (): HostModInfo[] => [],
  /** A guest asked for one of the host's mods. */
  packageFor: async (_id: string): Promise<{ manifest: unknown; code: string; sha256: string } | null> => null,
  /** Joining a host: get and switch to its mods. Resolves to an error message, or null when ready. */
  syncWithHost: async (_mods: HostModInfo[], _request: (id: string) => Promise<{ manifest: unknown; code: string } | null>, _confirm: (names: string[]) => Promise<boolean>): Promise<string | null> => null,
  /** Back to this browser's own mods (left someone else's game). */
  restore: () => {},
  /** A world is opening here: the mods in play and their ids for it. */
  beginWorld: (_meta: import('../game/storage').WorldMeta) => {},
  /** Mods a saved world was played with that aren't enabled now. */
  missingFor: (_meta: import('../game/storage').WorldMeta): string[] => [],
};
