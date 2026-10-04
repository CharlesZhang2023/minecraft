// Types for writing mods: `import type { ModContext } from '../sdk'`. Types only — a mod reaches the game at run
// time through its context (`mod.mc`, `mod.block(...)`, `mod.on(...)`...), never by importing the game's files.
export type { ModContext, Channel, ClientApi, Mc } from '../src/mod/api';
export type {
  ModManifest, BlockBehavior, ItemBehavior, BlockCtx, PlayerBlockCtx, PlaceCtx, DropCtx, ItemCtx, TileSpec, ActionResult,
} from '../src/mod/types';
export type { BlockRef, ItemRef, ItemProps } from '../src/mod/registry';
export type { RenderContext } from '../src/mod/render';
export type { CommandDef, CommandCtx, FeatureSpec, OreSpec, ChunkGenCtx, TouchButtonDef } from '../src/mod/hooks';
export type { ConfigSchema, ConfigEntry } from '../src/mod/config';
export type { Injection, CallbackInfo } from '../src/mod/mixin';
export type { EventName } from '../src/mod/events';
export type { Box, Shape, Neighbor } from '../src/world/models';
export type { BlockOpts, BlockDef } from '../src/world/blocks';
export type { ItemStack, ItemDef } from '../src/game/items';
export type { Ingredient } from '../src/game/recipes';
export type { Slot } from '../src/ui/containers';
export type { Inventory } from '../src/game/inventory';
export type { Img } from '../src/render/pixels';
export type { Mat4 } from '../src/math';
export type { Game } from '../src/game/game';
export type { Client } from '../src/client/client';
export type { ClientView, ViewPointer, ViewAim, MoveInput } from '../src/client/view';
export type { Camera } from '../src/render/renderer';
export type { Player } from '../src/game/player';
export type { Entity } from '../src/entity/entity';
export type { World } from '../src/world/world';
export type { Screen } from '../src/ui/screen';
export type { UI } from '../src/ui/ui';
export type { Ctx } from '../src/ui/gui';
