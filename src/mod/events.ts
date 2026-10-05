// Events (Fabric API style callbacks): the game fires them at its hook points, mods register listeners.
// A listener belongs to a mod and only runs while that mod is active; a throwing listener is reported, not fatal.
import type { Game } from '../game/game';
import type { Client } from '../client/client';
import type { Player } from '../game/player';
import type { Entity } from '../entity/entity';
import type { ItemStack } from '../game/items';
import type { Screen } from '../ui/screen';
import type { Ctx } from '../ui/gui';
import type { ActionResult } from './types';
import type { RenderContext } from './render';
import type { SubLevel } from '../sublevel/ship';
import { isActive, reportError } from './state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
interface Listener<F extends Fn> { fn: F; mod: string | null; priority: number; errors: number }

export class Event<F extends Fn> {
  private list: Listener<F>[] = [];
  constructor(readonly name: string) {}

  /** Higher priority runs first. Returns a function that removes the listener. */
  register(fn: F, mod: string | null = null, priority = 0): () => void {
    const l: Listener<F> = { fn, mod, priority, errors: 0 };
    const i = this.list.findIndex((o) => o.priority < priority);
    if (i < 0) this.list.push(l);
    else this.list.splice(i, 0, l);
    return () => { const k = this.list.indexOf(l); if (k >= 0) this.list.splice(k, 1); };
  }

  /** Cheap check before building an event's arguments. */
  get any() {
    return this.list.length > 0;
  }

  /**
   * Call the listeners in order. The first one to return something other than undefined or 'pass' decides (later
   * ones don't run) and that is returned; notifications just return undefined.
   */
  fire(...args: Parameters<F>): Exclude<ReturnType<F>, void | 'pass'> | undefined {
    for (const l of this.list) {
      if (!isActive(l.mod) || l.errors > 50) continue;
      try {
        const r = l.fn(...args);
        if (r !== undefined && r !== 'pass') return r;
      } catch (e) {
        l.errors++;
        reportError(l.mod, `event ${this.name}`, e);
      }
    }
    return undefined;
  }
}

// ------------------------------------------------------------------ the catalogue
/** Server side: everything runs inside the simulation (`game`), which may be this page's or, for guests, the host's. */
export interface BlockEventCtx { game: Game; player: Player; x: number; y: number; z: number; v: number }

const ev = <F extends Fn>(name: string) => new Event<F>(name);

export const Events = {
  // world lifecycle (server)
  worldLoad: ev<(game: Game) => void>('worldLoad'),
  worldSave: ev<(game: Game) => void>('worldSave'),
  worldClose: ev<(game: Game) => void>('worldClose'),
  serverTickStart: ev<(game: Game) => void>('serverTickStart'),
  serverTick: ev<(game: Game) => void>('serverTick'),
  // players (server)
  playerJoin: ev<(game: Game, player: Player) => void>('playerJoin'),
  playerLeave: ev<(game: Game, player: Player) => void>('playerLeave'),
  playerRespawn: ev<(game: Game, player: Player) => void>('playerRespawn'),
  /** A chat message (not a command). 'fail' swallows it. */
  chat: ev<(c: { game: Game; player: Player; message: string }) => ActionResult | void>('chat'),
  // interaction (server). 'success' = handled (the game does nothing more), 'fail' = refused.
  useBlock: ev<(c: BlockEventCtx & { face: number; held: ItemStack | null }) => ActionResult | void>('useBlock'),
  useItem: ev<(c: { game: Game; player: Player; stack: ItemStack }) => ActionResult | void>('useItem'),
  attackEntity: ev<(c: { game: Game; player: Player; target: Entity }) => ActionResult | void>('attackEntity'),
  /** Before a player breaks a block: 'fail' keeps it. */
  breakBlock: ev<(c: BlockEventCtx) => ActionResult | void>('breakBlock'),
  blockBroken: ev<(c: BlockEventCtx) => void>('blockBroken'),
  blockPlaced: ev<(c: BlockEventCtx) => void>('blockPlaced'),
  /** A living thing is about to take damage: 'fail' cancels it. */
  entityDamage: ev<(c: { game: Game; entity: Entity; amount: number; source: string }) => ActionResult | void>('entityDamage'),
  entityDeath: ev<(c: { game: Game; entity: Entity; source: string }) => void>('entityDeath'),
  /** Each moving sub-level, once a tick before the physics step: push it with game.sublevels.applyForce & co. */
  subLevelTick: ev<(c: { game: Game; ship: SubLevel; dt: number }) => void>('subLevelTick'),
  // client
  clientTick: ev<(client: Client) => void>('clientTick'),
  /** Joined a world (single-player or someone else's): the registries are bound, the world is about to load. */
  clientJoin: ev<(client: Client) => void>('clientJoin'),
  /** Draw on the HUD (GUI units, after the game's own HUD). */
  hudRender: ev<(c: { ctx: Ctx; client: Client; width: number; height: number; partial: number }) => void>('hudRender'),
  /** Draw into the world after entities (opaque pass), see RenderContext. */
  worldRender: ev<(r: RenderContext) => void>('worldRender'),
  /** Draw glowing things (spells, beams): added onto the scene, full bright, after everything else in the world. */
  worldRenderGlow: ev<(r: RenderContext) => void>('worldRenderGlow'),
  tooltip: ev<(c: { stack: ItemStack; lines: string[] }) => void>('tooltip'),
  screenOpen: ev<(c: { screen: Screen | null }) => void>('screenOpen'),
};
export type EventName = keyof typeof Events;
export type EventFn<K extends EventName> = (typeof Events)[K] extends Event<infer F> ? F : never;
