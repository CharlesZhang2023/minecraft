// The context a mod's entrypoints receive: one object per mod, namespacing everything it registers under its id.
// Built for both realms: in workers the page-only parts (commands, screens, renderers...) are inert, so a mod's
// `main` can run unchanged in the page and in the mesher / terrain workers.
import { Render, B, BLOCKS, TEXTURES, pack, idOf, metaOf, HORIZ, FACE_DIRS, FACING6, HORIZ_TO_FACE, tex, blockByName, type BlockOpts } from '../world/blocks';
import { I, I2, I3, I4, I5, I6, ITEMS, getItem, stack, itemByName, type ItemStack } from '../game/items';
import { MOD_RECIPES, TAGS, type Ingredient } from '../game/recipes';
import { rotY, orient6 } from '../world/models';
import { Random } from '../noise';
import { registerBlock, registerItem, modBlock, modItem, type BlockRef, type ItemRef, type ItemProps } from './registry';
import { Events, type EventName, type EventFn } from './events';
import { inject, type Injection } from './mixin';
import {
  COMMANDS, CHANNELS, ENTITIES, FEATURES, MAX_PAYLOAD, live,
  type CommandDef, type EntityFactory, type FeatureSpec, type OreSpec, type ScreenFactory, type TileRenderer, type EntityRendererFn,
} from './hooks';
import { defineConfig, type ConfigSchema, type ConfigValues } from './config';
import { modState } from './state';
import type { ModManifest, BlockBehavior, ItemBehavior } from './types';
import type { Game } from '../game/game';
import type { Client } from '../client/client';
import type { Player } from '../game/player';
import type { Screen } from '../ui/screen';
import type { Img } from '../render/pixels';
import type { PageMc } from './page';

/** The game's own pieces that work everywhere (the page and workers). */
export const commonMc = {
  B, BLOCKS, I, I2, I3, I4, I5, I6, ITEMS, Render, getItem, stack, itemByName, blockByName, pack, idOf, metaOf, tex,
  HORIZ, FACE_DIRS, FACING6, HORIZ_TO_FACE, rotY, orient6, Random, TAGS,
  /** A texture layer's name (BlockDef.faces holds layers). */
  textureName: (layer: number) => TEXTURES[layer],
  /** A box in 16ths with one texture layer (or one per face: -x +x -y +y -z +z). */
  box: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number | number[], extra: Partial<import('../world/models').Box> = {}) =>
    ({ x0, y0, z0, x1, y1, z1, tex: Array.isArray(t) ? t : [t, t, t, t, t, t], ...extra }),
};
/** Everything mods can reach of the game. In workers only the common part exists. */
export type Mc = typeof commonMc & PageMc;

export interface Channel<T = unknown> {
  readonly name: string;
  /** Server: a player's client sent this (check it: it came over the network). */
  onServer(fn: (data: T, player: Player, game: Game) => void): void;
  /** Client: the server sent this. */
  onClient(fn: (data: T, client: Client) => void): void;
  toServer(data: T): void;
  toPlayer(player: Player, data: T): void;
  /** Every player in the game (or only those in `player`'s dimension when given). */
  toAll(game: Game, data: T, near?: Player): void;
}

/** Page-only extension points (no-ops in workers). */
export interface ClientApi {
  /** A 16x16 block texture: a painter (deterministic) or a PNG/data URL. Use it in block props: { tex: 'mymod:name' }. */
  texture(name: string, src: ((r: Random) => Img) | string): void;
  /** A 16x16 item sprite (item props: sprite defaults to the item's key). */
  itemSprite(name: string, src: (() => Img) | string, outline?: string): void;
  /** A synthesised sound (mono samples at 22050 Hz), played by name: game.audio.play('mymod:beep', pos). */
  sound(name: string, gen: (r: Random) => Float32Array): void;
  /** A screen the server can open for a player (PlayerBlockCtx.openScreen / openScreenFor) or the client itself. */
  screen(id: string, make: ScreenFactory): void;
  keybind(name: string, defaultKey: string, onPress: (client: Client) => void): void;
  /** Draw a block's tile entity every frame (animated parts: spinning shafts, screens...). */
  tileRenderer(block: BlockRef | string, draw: TileRenderer): void;
  /** Draw a mod entity (by type name). */
  entityRenderer(type: string, draw: EntityRendererFn): void;
  /** A creative-inventory tab (by default each mod with items gets one named after it). */
  creativeTab(id: string, name: string, icon: () => number, items?: () => ItemStack[]): void;
  /** A settings screen of your own instead of the generated one. */
  configScreen(make: (parent: Screen) => Screen): void;
  /** Show a screen now (page only). */
  openScreen(s: Screen | null): void;
}

export interface ModContext {
  readonly id: string;
  readonly version: string;
  readonly manifest: ModManifest;
  readonly realm: 'page' | 'worker';
  /** The game's classes, registries and helpers. */
  readonly mc: Mc;
  /** 'mymod:path' */
  key(path: string): string;
  log(...a: unknown[]): void;
  warn(...a: unknown[]): void;

  // ---- content
  block(name: string, display: string, props?: BlockOpts, behavior?: BlockBehavior, item?: Partial<ItemProps>): BlockRef;
  item(name: string, props: ItemProps, behavior?: ItemBehavior): ItemRef;
  /** A mod entity type (page): saved, replicated to players, /summon-able as 'mymod:name'. */
  entity(name: string, make: EntityFactory | (new (world: import('../world/world').World, game: Game) => import('../entity/entity').Entity)): void;
  blockRef(key: string): BlockRef | undefined;
  itemRef(key: string): ItemRef | undefined;
  /** Item stack from a ref, key or id. */
  stack(item: ItemRef | BlockRef | string | number, count?: number): ItemStack;
  recipes: {
    /** Pattern rows of key characters (space = empty), like vanilla: shaped(['RR', 'RR'], { R: 'mymod:ruby' }, 'mymod:ruby_block'). */
    shaped(pattern: string[], key: Record<string, Ingredient>, result: Ingredient, count?: number): void;
    shapeless(ingredients: Ingredient[], result: Ingredient, count?: number): void;
    smelting(input: Ingredient, result: Ingredient, xp?: number): void;
  };
  worldgen: {
    feature(spec: FeatureSpec): void;
    ore(spec: OreSpec): void;
  };
  commands: { register(def: CommandDef): void };

  // ---- hooks
  on<K extends EventName>(event: K, fn: EventFn<K>, priority?: number): () => void;
  mixin<T extends object, K extends keyof T>(target: T, method: K, inj: T[K] extends (...a: never[]) => unknown ? Injection<T, T[K] & ((...a: any[]) => any)> : never): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  channel<T = unknown>(name: string): Channel<T>;

  // ---- settings and data
  /** This browser's settings for the mod (shown on its Config screen in the Mods menu). */
  config<S extends ConfigSchema>(schema: S): ConfigValues<S>;
  /** Data saved with the world (server side): call the returned function for the current world's copy. */
  worldData<T extends object>(defaults: () => T): () => T;

  readonly client: ClientApi;
}

const noop = () => {};

export function createContext(manifest: ModManifest, mc: Mc, client: ClientApi | null): ModContext {
  const id = manifest.id;
  const key = (p: string) => (p.includes(':') ? p : `${id}:${p}`);
  const toStack = (it: ItemRef | BlockRef | string | number, count = 1): ItemStack => {
    if (typeof it === 'number') return stack(it, count);
    if (typeof it === 'string') {
      const d = itemByName(it.includes(':') ? it : key(it)) ?? itemByName(it);
      if (!d) throw new Error(`Unknown item ${it}`);
      return stack(d.id, count);
    }
    return stack(it.id, count);
  };
  const worker = modState.realm === 'worker';
  const inertClient: ClientApi = {
    texture: noop, itemSprite: noop, sound: noop, screen: noop, keybind: noop, tileRenderer: noop, entityRenderer: noop,
    creativeTab: noop, configScreen: noop, openScreen: noop,
  };
  const ctx: ModContext = {
    id, version: manifest.version, manifest, realm: modState.realm, mc,
    key,
    log: (...a) => console.log(`[${id}]`, ...a),
    warn: (...a) => console.warn(`[${id}]`, ...a),
    block: (name, display, props, behavior, item) => registerBlock(id, key(name), display, props, behavior, item),
    item: (name, props, behavior) => registerItem(id, key(name), props, behavior),
    entity: (name, make) => {
      // a class (constructed with world, game) or a factory function
      const isClass = /^class[\s{]/.test(Function.prototype.toString.call(make));
      const C = make as new (w: unknown, g: unknown) => import('../entity/entity').Entity;
      ENTITIES.set(key(name), isClass ? { mod: id, make: (w, g) => new C(w, g), ctor: C } : { mod: id, make: make as EntityFactory });
    },
    blockRef: (k) => modBlock(key(k)),
    itemRef: (k) => modItem(key(k)),
    stack: toStack,
    recipes: {
      shaped: (pattern, k, result, count = 1) => { MOD_RECIPES.push({ mod: id, kind: 'shaped', pattern, key: k, out: result, count }); },
      shapeless: (ings, result, count = 1) => { MOD_RECIPES.push({ mod: id, kind: 'shapeless', ingredients: ings, out: result, count }); },
      smelting: (input, result, xp = 0.1) => { MOD_RECIPES.push({ mod: id, kind: 'smelting', input, out: result, count: 1, xp }); },
    },
    worldgen: {
      feature: (spec) => { FEATURES.push({ mod: id, key: key(spec.name), spec }); },
      ore: (o) => { FEATURES.push({ mod: id, key: key('ore/' + (typeof o.block === 'string' ? o.block : o.block.key)), spec: oreFeature(o) }); },
    },
    commands: {
      register: (def) => {
        for (const n of [def.name, ...(def.aliases ?? [])]) {
          const k = n.toLowerCase().replace(/^\//, '');
          if (COMMANDS.has(k) && COMMANDS.get(k)!.mod !== id) console.warn(`[${id}] command /${k} replaces ${COMMANDS.get(k)!.mod}'s`);
          COMMANDS.set(k, { mod: id, def });
        }
      },
    },
    on: (event, fn, priority = 0) => (Events[event] as unknown as { register(f: unknown, m: string, p: number): () => void }).register(fn, id, priority),
    mixin: (target, method, inj) => inject(id, target, method, inj as never),
    channel: <T>(name: string): Channel<T> => {
      const c = key(name);
      const h = CHANNELS.get(c) ?? { mod: id };
      CHANNELS.set(c, h);
      return {
        name: c,
        onServer: (fn) => { h.server = fn as never; },
        onClient: (fn) => { h.client = fn as never; },
        toServer: (data) => {
          const json = JSON.stringify(data ?? null);
          if (json.length > MAX_PAYLOAD) throw new Error(`payload on ${c} is too big (${json.length} bytes)`);
          live.client?.conn?.send({ t: 'mod', c, d: data as unknown });
        },
        toPlayer: (player, data) => { (player as unknown as { sp?: { send(m: unknown): void } }).sp?.send({ t: 'mod', c, d: data }); },
        toAll: (game, data, near) => {
          const dim = near ? (near as unknown as { sp?: { dim: string } }).sp?.dim : undefined;
          for (const sp of game.players) if (!dim || sp.dim === dim) sp.send({ t: 'mod', c, d: data as unknown });
        },
      };
    },
    config: (schema) => defineConfig(id, schema),
    worldData: <T extends object>(defaults: () => T) => () => {
      const meta = live.game?.meta;
      if (!meta) return defaults();
      const all = (meta.modData ??= {});
      return ((all[id] as T | undefined) ??= defaults());
    },
    client: worker || !client ? inertClient : client,
  };
  return ctx;
}

/** Vanilla's ore veins (WorldGenMinable): an ellipsoid swept between two points, replacing stone. */
function oreFeature(o: OreSpec): FeatureSpec {
  const dims = o.dims ?? ['overworld'];
  return {
    name: 'ore',
    dims,
    generate(c) {
      const ore = typeof o.block === 'string' ? blockByName(o.block)?.id : o.block.id;
      if (ore === undefined || ore < 0) return;
      const repl = new Set((o.replace ?? [c.dim === 'nether' ? 'netherrack' : c.dim === 'end' ? 'end_stone' : 'stone']).map((n) => blockByName(n)?.id ?? -1));
      const r = c.rng;
      for (let n = 0; n < o.count; n++) {
        const x = r.int(16), y = o.minY + r.int(Math.max(1, o.maxY - o.minY)), z = r.int(16);
        const size = o.size;
        const ang = r.next() * Math.PI;
        const x0 = x + Math.sin(ang) * size / 8, x1 = x - Math.sin(ang) * size / 8;
        const z0 = z + Math.cos(ang) * size / 8, z1 = z - Math.cos(ang) * size / 8;
        const y0 = y + r.int(3) - 2, y1 = y + r.int(3) - 2;
        for (let i = 0; i <= size; i++) {
          const cx = x0 + (x1 - x0) * i / size, cy = y0 + (y1 - y0) * i / size, cz = z0 + (z1 - z0) * i / size;
          const rad = ((Math.sin(i * Math.PI / size) + 1) * (r.next() * size / 16) + 1) / 2;
          for (let bx = Math.floor(cx - rad); bx <= Math.floor(cx + rad); bx++)
            for (let by = Math.floor(cy - rad); by <= Math.floor(cy + rad); by++)
              for (let bz = Math.floor(cz - rad); bz <= Math.floor(cz + rad); bz++) {
                if (bx < 0 || bx > 15 || bz < 0 || bz > 15 || by < 1 || by > 255) continue;
                const dx = (bx + 0.5 - cx) / rad, dy = (by + 0.5 - cy) / rad, dz = (bz + 0.5 - cz) / rad;
                if (dx * dx + dy * dy + dz * dz >= 1) continue;
                if (repl.has(idOf(c.get(bx, by, bz)))) c.set(bx, by, bz, ore);
              }
        }
      }
    },
  };
}
