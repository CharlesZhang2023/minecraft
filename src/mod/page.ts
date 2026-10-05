// The page side of the mod API: the game's classes and helpers mods can build on (subclass an entity, a screen,
// hook a method with a mixin), and the client extension points (textures, sounds, screens, renderers).
import { Game, Dim } from '../game/game';
import { Client } from '../client/client';
import { World } from '../world/world';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { Mob, Monster, Animal } from '../entity/mobs';
import { ItemEntity, Arrow } from '../entity/item';
import { Player } from '../game/player';
import { Interaction } from '../game/interact';
import { Commands } from '../game/commands';
import { Redstone } from '../game/redstone';
import { BlockTicker } from '../game/blockticks';
import { Inventory } from '../game/inventory';
import { UI } from '../ui/ui';
import { Screen, Button, Slider, TextField } from '../ui/screen';
import { ContainerScreen } from '../ui/containers';
import { Hud } from '../ui/hud';
import { Renderer } from '../render/renderer';
import { EntityRenderer } from '../render/entityrender';
import { ServerPlayer } from '../server/splayer';
import * as math from '../math';
import * as pixels from '../render/pixels';
import { registerTexture, getTexture } from '../render/textures';
import { registerItemSprite } from '../render/itemsprites';
import { registerSound, synth, SAMPLE_RATE } from '../game/audio';
import { modelBoxes, collisionShapes, selectionShapes } from '../world/models';
import { SCREENS, KEYBINDS, TILE_RENDERERS, ENTITY_RENDERERS, CREATIVE_TABS, CONFIG_SCREENS, TOUCH_BUTTONS, VIEW, live } from './hooks';
import type { ClientApi } from './api';
import { blockCtx } from './blockctx';
import { tex } from '../world/blocks';
import type { Img } from '../render/pixels';
import { Random } from '../noise';
import { device } from '../game/device';
import { SubLevel } from '../sublevel/ship';
import * as pose from '../sublevel/pose';
import { airPressure, setBlockPhysics, blockPhysics, PHYS } from '../sublevel/server';
import { ridingShip } from '../sublevel/collide';
import { gatherStructure } from '../sublevel/commands';

/** The game's classes and helpers (page only). */
export const pageMc = {
  Game, Dim, Client, World, Entity, LivingEntity, Mob, Monster, Animal, ItemEntity, Arrow, Player, ServerPlayer, Interaction, Commands,
  Redstone, BlockTicker, Inventory, UI, Screen, Button, Slider, TextField, ContainerScreen, Hud, Renderer, EntityRenderer,
  modelBoxes, collisionShapes, selectionShapes,
  math, pixels, synth, SAMPLE_RATE,
  /** Touch or mouse mode (`device.touch`), so screens can tell a finger from a mouse. */
  device,
  /** A block texture's pixels by name (16x16 RGBA), e.g. to paint a mod texture over 'stone'. */
  getTexture,
  /** The context block hooks get, for any block (server side: inside the simulation's current dimension). */
  blockCtx,
  /**
   * Sub-levels (moving block structures): the entity class (`world.ships` lists them on both sides; the server's
   * `game.sublevels` assembles them and pushes them), pose maths (quaternions, local <-> world), block physics
   * properties, air pressure, the physics settings, the connected structure a block belongs to, and which
   * sub-level an entity is standing on.
   */
  SubLevel, pose, airPressure, setBlockPhysics, blockPhysics, PHYS, gatherStructure, ridingShip,
  /** The page's client and running simulation (null when not playing / not hosting). */
  get client() { return live.client; },
  get game() { return live.game; },
};
export type PageMc = typeof pageMc;

/** Asset decodes still running (the atlas waits for them). */
export const pendingAssets: Promise<unknown>[] = [];

/** Decode an image URL (data: or same-origin) to 16x16 RGBA (nearest-neighbour if it isn't 16x16). */
async function decode(url: string, w = 16, h = 16): Promise<Img> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(bmp, 0, 0, w, h);
  return new Uint8ClampedArray(g.getImageData(0, 0, w, h).data);
}

export function clientApi(mod: string): ClientApi {
  return {
    texture(name, src) {
      // a layer in the block atlas now, even if no block names it (textures only renderers use)
      tex(name);
      if (typeof src === 'function') { registerTexture(name, src); return; }
      const p = decode(src).then((img) => registerTexture(name, () => pixels.copy(img))).catch((e) => console.warn(`[${mod}] texture ${name}:`, e));
      pendingAssets.push(p);
    },
    itemSprite(name, src, outline) {
      if (typeof src === 'function') { registerItemSprite(name, src, outline); return; }
      const p = decode(src).then((img) => registerItemSprite(name, () => pixels.copy(img), outline)).catch((e) => console.warn(`[${mod}] sprite ${name}:`, e));
      pendingAssets.push(p);
    },
    sound(name, gen) { registerSound(name, gen); },
    screen(id, make) { SCREENS.set(id.includes(':') ? id : `${mod}:${id}`, { mod, make }); },
    keybind(name, key, onPress) { KEYBINDS.push({ mod, name, key, onPress }); },
    tileRenderer(block, draw) { TILE_RENDERERS.set(typeof block === 'string' ? block : block.key, { mod, draw }); },
    entityRenderer(type, draw) { ENTITY_RENDERERS.set(type.includes(':') ? type : `${mod}:${type}`, { mod, draw }); },
    creativeTab(id, name, icon, items) {
      const key = id.includes(':') ? id : `${mod}:${id}`;
      const i = CREATIVE_TABS.findIndex((t) => t.id === key);
      const tab = { mod, id: key, name, icon, items: items ?? (() => []) };
      if (i >= 0) CREATIVE_TABS[i] = tab;
      else CREATIVE_TABS.push(tab);
    },
    configScreen(make) { CONFIG_SCREENS.set(mod, make); },
    openScreen(s) { live.client?.ui.open(s); },
    touchButton(id, def) {
      const key = id.includes(':') ? id : `${mod}:${id}`;
      const i = TOUCH_BUTTONS.findIndex((b) => b.id === key);
      if (i >= 0) TOUCH_BUTTONS.splice(i, 1);
      TOUCH_BUTTONS.push({ ...def, mod, id: key });
    },
    setView(view) {
      const was = VIEW.view;
      if (!view && VIEW.mod !== mod) return;
      VIEW.mod = view ? mod : '';
      VIEW.view = view;
      live.client?.viewChanged(was);
    },
    view() { return VIEW.mod === mod ? VIEW.view : null; },
  };
}

export { Random };
