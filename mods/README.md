# Writing mods

Mods add blocks, items, mobs, commands, screens, settings, renderers and world generation to the game. The
design follows Fabric's:

- **A loader and metadata.** Each mod has a `mod.json` and declares the mods it depends on, with version ranges.
- **Registries with namespaced keys** (`computer:computer`). The numeric ids are an internal detail, and each world
  keeps its own mapping.
- **Entrypoints.** `main` is common code; `client` is page-only code.
- **Events and mixins.** Events cover the usual hook points; mixins let you hook any other method of the game.

This folder is the mod repository. Every subfolder with a `mod.json` is built into one ES module. The deployed site
serves those modules, with `mods/index.json` listing each one and its SHA-256, as plain static files. Players
install mods from the **Mods** screen, which downloads them, checks the hash and keeps them in the browser. Games
with mods can be hosted and joined (see [Multiplayer](#multiplayer)).

## Quick start

```
mods/
  mymod/
    mod.json
    main.ts        (more files are fine; they are bundled)
```

`mod.json`:

```json
{
  "id": "mymod",
  "version": "1.0.0",
  "name": "My Mod",
  "description": "What it does.",
  "authors": ["you"],
  "environment": "*",
  "icon": "item:mymod:gizmo",
  "depends": { "minecraft": ">=1.0.0" }
}
```

`main.ts`:

```ts
import type { ModContext } from '../sdk';

// Common: runs in the page AND in the game's workers (mesher, terrain). Register content here.
export function main(mod: ModContext) {
  const gizmo = mod.item('gizmo', { display: 'Gizmo', maxStack: 16 });
  mod.block('gizmo_block', 'Block of Gizmo', { hardness: 2, tool: 'pickaxe', sound: 'metal' });
  mod.recipes.shaped(['GG', 'GG'], { G: gizmo }, 'mymod:gizmo_block');
}

// Page only: textures, sprites, sounds, screens, renderers, HUD, key bindings.
export function client(mod: ModContext) {
  const { pixels: px } = mod.mc;
  mod.client.texture('mymod:gizmo_block', (r) => { const img = px.newImg(); /* paint 16x16 */ return img; });
}
```

Run `npm run dev` and open the **Mods** screen (title screen → Mods). The dev server rebuilds a mod when its
files change. Install it, then open a world.

Mods import **types only** from the game (`import type ... from '../sdk'`). Everything they use at run time comes
through the context: `mod.mc` holds the game's classes and helpers. The build fails if a mod imports a game file
at run time.

## The context (`mod`)

| | |
|---|---|
| `mod.block(name, display, props, behavior?, itemProps?)` | A block. `props` are the game's block properties: `hardness`, `tool`, `harvestLevel`, `sound`, `light`, `render`, textures (`tex`, `top`, `side`, `bottom`, `front`)… Returns a `BlockRef`. |
| `mod.item(name, props, behavior?)` | An item: `display`, `maxStack`, `durability`, `tool`, `food`, `armor`, `attack`, `fuel`, `rarity`, `egg`, `tab`, `sprite`… |
| `mod.entity(name, Class)` | A mob or other entity type: saved with the world, sent to players, usable with `/summon` and spawn eggs (`egg: 'mymod:name'`). Page only. |
| `mod.recipes.shaped / shapeless / smelting` | Ingredients are item keys (`'stick'`, `'mymod:gizmo'`), tags (`'#planks'`, `'#wool'`, `'#logs'`…), refs, or lists of these. |
| `mod.worldgen.ore(spec)` / `mod.worldgen.feature(spec)` | World generation. Runs in the terrain worker on every new chunk, on the host and on players who generate terrain themselves. |
| `mod.commands.register(def)` | `/name args…`. Throw an `Error` to reply in red. `permission: 'all'` lets anyone run it; the default is the host only, or everyone when cheats are on for all. |
| `mod.on(event, fn)` | Events (below). |
| `mod.mixin(target, 'method', { before, after, around })` | Hook any method, e.g. `mod.mixin(mod.mc.Player.prototype, 'jump', …)`. |
| `mod.channel(name)` | Network messages between a player's client and the server (`toServer`, `onServer`, `toPlayer`, `toAll`, `onClient`). |
| `mod.config(schema)` | Settings with a generated settings page in the Mods screen. Saved per browser. |
| `mod.worldData(() => defaults)` | Data saved with the world, on the server. |
| `mod.client.*` | Page only: `texture`, `itemSprite`, `sound`, `screen`, `keybind`, `tileRenderer`, `entityRenderer`, `creativeTab`, `configScreen`, `openScreen`. |
| `mod.mc` | The game's pieces: `B`, `I`, `BLOCKS`, `ITEMS`, `Render`, `stack`, `box`, `rotY`, `HORIZ`, `FACING6`, `Random`, `blockCtx`… In the page also its classes (`Game`, `Client`, `Player`, `Entity`, `LivingEntity`, `Mob`, `Animal`, `Monster`, `Screen`, `Button`, `Slider`, `TextField`, `ContainerScreen`…), plus `math` (matrices), `pixels` (texture painting), `synth` (sound), `getTexture`. |

`main` also runs in workers, where `mod.realm === 'worker'` and the page-only parts do nothing. Define classes
that extend page classes, such as an entity, inside `if (mod.realm === 'page')`.

## Blocks: behaviour

The fourth argument of `mod.block` takes hooks, Fabric's block overrides. All of them are optional:

```ts
mod.block('lamp_post', 'Lamp Post', { render: mod.mc.Render.Model, light: 12, opaque: false }, {
  placementMeta: (c) => c.facing,                    // or null to refuse the spot
  onUse: (c) => { c.setMeta(c.meta ^ 8); return true; },
  onPlaced: (c) => { /* c.player, c.tile() … */ },
  onBreak: (c) => { /* after it's gone */ },
  drops: ({ silk, rng }) => [/* ItemStacks */],
  canStay: (c) => (c.neighbor(0, -1, 0) & 0xfff) !== 0,
  neighborChanged: (c) => {}, randomTick: (c) => {}, scheduledTick: (c) => {},   // c.schedule(ticks)
  tile: { create: () => ({ energy: 0 }), tick: (c, t) => { /* every tick */ c.tileChanged(); } },
  redstone: { power: (c, dir, strong) => 15, update: (c) => { /* c.power(), c.powerFrom(side) */ } },
  model: (meta, nb, faces) => [/* boxes in 16ths */],   // Render.Model shape; also runs in the mesher
  collision: (meta) => [/* shapes in block units */], selection: (meta) => [],
});
```

- **Contexts** (`c`) describe the block and act on it: `x y z v id meta`, `setMeta`, `set`, `tile()`, `tileChanged()`,
  `schedule()`, `neighbor()`, `power()`, `powerFrom(side)`, `updateRedstone()`. Player hooks add `player`, `held`,
  `face` and `openScreen(id, …args)`.
- **Tile entities** are plain JSON objects. They are saved with the chunk and sent to the players who can see that
  chunk whenever you call `tileChanged()`.
- **Models and textures.** A cube with a `front` texture turns its front toward the player who places it. `model`
  must use only its arguments, because it also runs in the mesher worker.

## Items: behaviour

`use(c)` (right-click in the air), `useOnBlock(c)`, `hitEntity(c)` and `tooltip(stack, lines)`. The context has
`stack`, `player`, `consume(n)` and `damage(n)`.

## Events

| Event | Side | Return |
|---|---|---|
| `worldLoad`, `worldSave`, `worldClose`, `serverTickStart`, `serverTick` | server | |
| `playerJoin`, `playerLeave`, `playerRespawn` | server | |
| `useBlock`, `useItem`, `attackEntity`, `breakBlock`, `chat`, `entityDamage` | server | `'success'` = handled, `'fail'` = refused, `'pass'` / nothing = carry on |
| `blockBroken`, `blockPlaced`, `entityDeath` | server | |
| `clientTick`, `clientJoin`, `screenOpen`, `tooltip` | client | |
| `hudRender` (`{ ctx, client, width, height, partial }`) | client | draw in GUI units |
| `worldRender` (a `RenderContext`) | client | |

"Server" means the simulation. In single-player that's this page; when you join someone, it's the host's page.
Listeners only run while their mod is in play, and an error in one is reported against the mod (Mods screen),
never the game.

## Rendering

`mod.client.tileRenderer(block, (r, tile, x, y, z, v) => …)` draws every frame for each tile of that block near
the camera, which is the way to animate machine parts. `mod.client.entityRenderer(type, (r, entity) => …)`
draws a mod entity. Both get a `RenderContext`:

- `r.boxes(boxes, x, y, z, matrix?)`: boxes in 16ths, optionally turned by a matrix in block units built with
  `mod.mc.math`.
- `r.block(v, x, y, z)` and `r.item(id, x, y, z, m?)`: any block state or any item.
- `r.billboard(…)`, `r.quad(…)`, `r.tex(name)`, `r.light(x, y, z)`.
- `r.time`: ticks, including the fraction of the current one, for animation.

## Screens

Register a screen with `mod.client.screen('mymod:panel', (ui, ...args) => new Panel(ui, ...args))`. The server
opens it for a player from a block's `onUse` with `c.openScreen('mymod:panel', x, y, z)`. Extend `mod.mc.Screen`, or
`mod.mc.ContainerScreen` for slots. Container screens are mirrored on the server, which replays the player's
clicks, so their items stay authoritative. For anything else, send what the player does over a channel; the
Computers mod shows how.

The server also builds its own copy of the screen. Keep constructors light, and check `this.onServer` in `init`
and `tick` if they touch the client.

## Settings

```ts
const cfg = mod.config({
  enabled: { type: 'boolean', default: true, label: 'Enabled' },
  size: { type: 'number', default: 80, min: 48, max: 128, step: 8, label: 'Size' },
  mode: { type: 'enum', default: 'a', options: ['a', 'b'], labels: ['First', 'Second'], label: 'Mode' },
  toggleKey: { type: 'key', default: 'KeyM', label: 'Toggle Key' },
});
mod.client.keybind('toggleKey', 'KeyM', () => { cfg.enabled = !cfg.enabled; }); // same name: the page rebinds it
```

## Ids, worlds and missing mods

Block ids 2048–4095 and item ids from 4096 up are bound per world. A world records which key got which id, so
adding mods or changing their load order never reshuffles a saved world. Keep `BlockRef`s and look at `.id` when
you need it; don't store raw ids across worlds. If a world's mod isn't there, the player is warned before
playing. Its blocks and items stay in place as "missing" placeholders and come back when the mod returns.

## Multiplayer

The host's mods (other than client-only ones) are the game's mods. A joining player is sent the list:

1. Mods the player already has are used as they are.
2. Mods in the repository are downloaded and checked by hash.
3. Other mods, such as a host's file-installed mod, come from the host over the game connection, and only after
   the player agrees.

The player then switches to exactly that set, plus their own client-only mods (`"environment": "client"`, such as
the Minimap), and takes the host's id numbering before any chunk arrives. Leaving restores their own mods.

Code that handles players' messages runs on the host. Check what arrives: positions, sizes, rights.

## Examples

| Mod | Shows |
|---|---|
| `ruby` (Rubies) | ore + world generation, items and tools, recipes and smelting, drops, a mob with a renderer and spawn egg, an event, a command, painted textures |
| `computer` (Computers) | a tile entity holding files and a program, a terminal screen, network channels, redstone in/out per side, per-world data, a command, a sound, a setting |
| `kinetic` (Kinetics) | machines: power spread through neighbouring tiles, animated tile renderers (shafts, crank, windmill sails, millstone), custom shapes, a HUD readout |
| `minimap` (Minimap) | a client-only mod: HUD drawing, a rebindable key, a settings page |

## Publishing

Add the folder here and deploy. The build writes `dist/mods/<id>/<id>-<version>-<hash>.js` and `dist/mods/index.json`.
A built mod file can also be shared directly; players add it with **Mods → Add from File…**.
