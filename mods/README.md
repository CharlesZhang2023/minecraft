# Writing mods

This is the complete guide to writing a mod for this game (a browser Minecraft written in TypeScript, drawn with WebGPU or WebGL 2).
It is written so that a developer, or an AI agent working from a copy of the repository, can build a working mod
from it alone. It explains how the game is put together, the whole mod API, how to build and test a mod, and the
mistakes that are easy to make.

Where this guide and the code disagree, the code wins. The API is defined in a handful of files, listed in
[Where things are](#where-things-are); read them when you need the exact signature of something.

Contents: [The model](#how-the-game-is-put-together) · [Quick start](#quick-start) ·
[Build and test](#build-install-and-test) · [Lifecycle](#lifecycle-and-entrypoints) · [The context](#the-context-mod) ·
[Blocks](#blocks) · [Items](#items) · [Recipes](#recipes) · [World generation](#world-generation) ·
[Entities](#entities-and-mobs) · [Commands](#commands) · [Server side](#programming-the-server-side) ·
[Events](#events) · [Client side](#programming-the-client-side) · [Rendering](#rendering) · [Views](#views-camera-and-controls) · [Sub-levels](#sub-levels-moving-structures) · [Screens](#screens) ·
[Phones](#phones-and-touch) · [Settings](#settings) · [Networking](#networking) · [Mixins](#mixins) ·
[Ids and worlds](#ids-worlds-and-missing-mods) · [Multiplayer](#multiplayer) · [Rules and pitfalls](#rules-and-pitfalls) ·
[Examples](#example-mods) · [Where things are](#where-things-are) · [Publishing](#publishing)

---

## How the game is put together

Mods plug into the game's structure, so it helps to have the overall picture first.

**Client and server, always.** Even in single-player the game runs as two halves in one page:

- The **server** (`Game`, `src/game/game.ts`) is the simulation. It owns the real world, entities, inventories,
  redstone and mob AI, and runs 20 ticks a second.
- The **client** (`Client`, `src/client/client.ts`) draws, plays sounds and reads input. Its world and entities
  are replicas the server keeps up to date. Entities on the client are "puppets" that never tick; their fields are
  copied from the server every tick.
- In multiplayer the **host's page** runs the server for everyone, and guests run only a client. Code you write for
  the server side runs on the host, including when a guest triggers it.

Every hook in this guide is either server side (it gets a `game: Game`) or client side (it gets a `client: Client`).
Change the world only on the server; the client's copy follows.

**Realms.** Your mod's code runs in more than one JavaScript environment:

- **page**: the game itself. Everything is available.
- **worker**: the mesher (builds chunk meshes) and the terrain generator run in Web Workers. Your mod's `main`
  entrypoint runs there too, so your blocks and their shapes exist in those threads, and your world generation
  runs there. Workers have no DOM, no screens and none of the page's classes. `mod.realm` tells you where you are.

**Ticks and time.** 20 server ticks a second. Durations in the API are ticks unless noted. `game.ticks` counts
server ticks, and `game.time` is the world clock (24000 per day).

**Coordinates.** `y` is up, the world is 256 blocks tall, and chunks are 16×16 columns. Entities have `x y z` at
their feet centre, plus `width`, `height` and `eyeHeight()`. `yaw` is degrees, with 0 facing +z (south) and 90
facing −x (west). `pitch` is degrees, positive looking down. `game.lookVec(yaw, pitch)` gives the unit direction.

**Directions.** There are two conventions:

- **Faces** (block models, `face` in hooks): 0 −x, 1 +x, 2 −y, 3 +y, 4 −z, 5 +z.
- **Vanilla 6-way** (redstone, `facing6`): 0 down, 1 up, 2 north (−z), 3 south (+z), 4 west (−x), 5 east (+x).
- Horizontal facing (`facing`, `mc.HORIZ`): 0 north, 1 east, 2 south, 3 west.

**Block values.** A block in the world is a 16-bit value `v = id | meta << 12`. The low 12 bits are the block
id, and the high 4 bits are its meta (orientation, growth stage and so on). Use `mc.idOf(v)`, `mc.metaOf(v)` and
`mc.pack(id, meta)`. `world.get` returns `v`, and `world.getId` returns only the id.

**Ids.** Vanilla ids are fixed constants (`mc.B.STONE`, `mc.I.STICK`). Mod blocks and items have namespaced keys
(`mymod:gizmo`), and their numeric ids are assigned per world. Read them from your refs (`ref.id`) when you need
them; never hard-code or cache them. See [Ids, worlds and missing mods](#ids-worlds-and-missing-mods).

**The game's look and size.** Textures and item sprites are 16×16 pixel art painted in code (no image files).
The GUI is drawn on a 2D canvas in "GUI units", at least 320×240 (screens) or 300×180 (HUD on phones), scaled up
by an integer. The font is a pixel font that only has printable ASCII; other characters show as `?`. Text can be
coloured with Minecraft's codes (`§c` red, `§a` green, `§7` grey, `§r` back to normal…).

---

## Quick start

A mod is a folder in `mods/`:

```
mods/
  sdk.ts           types for mods (import type only)
  mymod/
    mod.json       metadata
    main.ts        the entry module (more files are fine: relative imports are bundled)
```

`mod.json`:

```json
{
  "id": "mymod",
  "version": "1.0.0",
  "name": "My Mod",
  "description": "What it does, in a sentence or two.",
  "authors": ["you"],
  "environment": "*",
  "icon": "item:mymod:gizmo",
  "depends": { "minecraft": ">=1.0.0" }
}
```

| Field | |
|---|---|
| `id` | Required. `^[a-z0-9_-]{1,40}$`, not `minecraft`. It's the namespace of everything you register (`mymod:gizmo`). |
| `version` | Required. Semantic version (`1.2.0`). |
| `name`, `description`, `authors` | Shown in the Mods screen. |
| `environment` | `"*"` (default): needed on both sides, so every player in a game must run it (the game takes care of that). `"client"`: only changes what this player sees or does locally (a minimap); players can have it in anyone's game. |
| `icon` | A colour (`"#8a6a3a"`) or one of your items (`"item:mymod:gizmo"`). |
| `depends` | Mods (and `minecraft`, the game, version 1.0.0) with version ranges: `^1.2`, `~1.4.2`, `>=1.0 <2`, `1.x`, `*`, `a \|\| b`. Dependencies load first. |
| `breaks` | Mods this can't run with. |
| `entrypoints` | Rename the entry functions: `{ "main": "init", "client": "initClient" }`. |
| `entry` | Build only: the entry file, if not `main.ts`. |

`main.ts`:

```ts
import type { ModContext } from '../sdk';

// Common entrypoint: runs in the page AND in the workers. Register all your content here.
export function main(mod: ModContext) {
  const gizmo = mod.item('gizmo', { display: 'Gizmo', maxStack: 16 });
  const block = mod.block('gizmo_block', 'Block of Gizmo', { hardness: 2, tool: 'pickaxe', sound: 'metal' });
  mod.recipes.shaped(['GG', 'GG'], { G: gizmo }, block);
}

// Client entrypoint: runs in the page only, right after main. Textures, sprites, sounds, screens, HUD, renderers.
export function client(mod: ModContext) {
  const px = mod.mc.pixels;
  // a block's textures default to its key, so this paints the block
  mod.client.texture('mymod:gizmo_block', (r) => {
    const img = px.newImg();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(img, x, y, r.next() < 0.5 ? px.hex('#4a8acf') : px.hex('#3a6aaf'));
    return img;
  });
  // an item's sprite defaults to its key
  mod.client.itemSprite('mymod:gizmo', () => {
    const img = px.newImg();
    px.art(img, ['', '', '', '', '', '     ######', '    #oooooo#', '    #oOOOoo#', '    #oooooo#', '     ######'], { '#': px.hex('#203050'), o: px.hex('#4a8acf'), O: px.hex('#9ad0ff') });
    return img;
  });
}
```

**Imports.** Mods import **types only** from the game: `import type { … } from '../sdk'`. Everything used at run
time comes through the context object, `mod`: `mod.mc` holds the game's classes, tables and helpers. The build
**fails** if a mod imports a game file at run time. Your own files import each other normally and are bundled
into one module.

---

## Build, install and test

### The loop

1. Start the dev server: `npm run dev` (Vite; it prints the port, normally 5173). The mod repository is served at
   `/mods/index.json` and `/mods/<id>/<id>-<version>-<hash>.js`. Each request rebuilds the mods whose files changed.
2. Type-check: `npm run check` (`tsc --noEmit`; the tsconfig includes `mods/`). The mod build only strips types,
   so type errors never stop it: run the check yourself.
3. **Build errors don't stop the dev server.** A mod that fails to build is logged to the Vite console as
   `[mods] …` and is simply missing from `index.json`. If your mod isn't listed, look there.
4. In the game: title screen → **Mods** → your mod → **Install**. Installed mods are kept in the browser
   (IndexedDB) and load on every page start.
5. **Changing an installed mod:** the browser keeps running the installed copy. After editing, install it again
   (the Mods screen shows an update) and **reload the page**, since loaded code can't be swapped.

### Testing headless (Playwright)

The repository has Playwright. The game exposes hooks on `window` for tests and the console:

| | |
|---|---|
| `window.mods` | The mod loader: `installFromRepo(entry)`, `installFile(code)`, `setEnabled(id, on)`, `loaded` (Map). |
| `window.game` | The `Client`: `player`, `world`, `entities`, `ui` (`ui.screen` is the open screen), `input`, `server` (the `Game`, when this page hosts). |
| `window.sim(fn)` | Runs `fn(game, player)` inside the server, as the first player (their dimension and world). Use it to change the world and inspect the real state. |
| `window.S()` | `{ g, sp, p, d, w }`: the server, its first player, their entity, dimension and world. |
| `window.__mc` | `{ BLOCKS, ITEMS, … }`: the registries. |
| `await import('/src/…')` | In the dev server, any game module, e.g. `(await import('/src/mod/state.ts')).modState.errors.get('mymod')` for your mod's errors. |

URL parameters skip the menus: `?autoplay&seed=777&mode=1&time=6000&id=test123`. `mode` is 0 survival or
1 creative, `time` is the time of day, and `id` is the world id (a new id makes a new world). Add `&touch=1` to
force phone controls.

A template test (save it outside `mods/`, e.g. `shots/mymod.mjs`, and run `node shots/mymod.mjs`):

```js
import { chromium } from 'playwright';
const port = process.argv[2] ?? '5173';
// macOS flags; elsewhere drop them or use '--use-angle=swiftshader'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => !!window.mods && !!window.game, null, { timeout: 30000 });
// install from the dev server's repository (a fresh browser context has nothing installed)
console.log(await page.evaluate(async () => {
  const idx = await (await fetch('/mods/index.json')).json();
  return window.mods.installFromRepo(idx.mods.find((m) => m.id === 'mymod')); // null = ok, else an error message
}));
// a new world with the mod in it
await page.goto(`http://127.0.0.1:${port}/?autoplay&seed=777&mode=1&time=6000&id=t${Date.now()}`);
await page.waitForFunction(() => window.game?.arrived && !window.game.ui.screen && window.game.loadProgress() > 0.99, null, { timeout: 40000 });
// act and look on the server
const out = await page.evaluate(() => window.sim((g, p) => {
  const id = window.__mc.BLOCKS.find((b) => b.name === 'mymod:gizmo_block').id;
  g.world.set(Math.floor(p.x), Math.floor(p.y) + 3, Math.floor(p.z) + 2, id);
  return { placed: g.world.getId(Math.floor(p.x), Math.floor(p.y) + 3, Math.floor(p.z) + 2) === id };
}));
// look up a little and take a picture
await page.evaluate(() => { const p = window.game.player; p.pitch = p.ppitch = -20; window.game.input.pointerLocked = true; });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'shots/mymod.png' });
out.modErrors = await page.evaluate(async () => (await import('/src/mod/state.ts')).modState.errors.get('mymod') ?? []);
console.log(JSON.stringify(out), JSON.stringify(errs));
await browser.close();
```

Useful moves in tests:
- **Give an item:** `window.sim((g, p) => { p.inventory.main[0] = { id: <id>, count: 1 }; p.inventory.selected = 0; })`.
- **Hold the use button:** `const i = window.game.input; i.mouseDown.add(2); i.mousePressedQ.push(2);`, and later
  `i.mouseDown.delete(2)`.
- **Press a key:** `page.keyboard.press('r')`. Key bindings only fire while playing, with no screen open.
- **Spawn a mob:** `g.interact.spawnMob('mymod:beetle', x, y, z)`.
- **Two players:** in the dev server, `window.mp.host(channel)` in one tab and `window.mp.join(channel)` in another
  tab of the same browser context.
- **Phones:** use a context with `{ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }`,
  `?touch=1`, and CDP `Input.dispatchTouchEvent` for taps, drags and long presses.
- **Click inside a screen:** screens use GUI units. CSS pixels = GUI units × `ui.gui.scale` × (canvas CSS width /
  canvas width). The GUI scale changes when a screen opens, so measure after opening it.

Errors thrown by your hooks never crash the game. They are caught, logged to the console as `[mod mymod] …`, and
listed in the Mods screen and in `modState.errors`. Check those in every test.

---

## Lifecycle and entrypoints

1. At page start the loader imports every installed, enabled mod, dependencies first.
2. For each mod it runs `main(mod)` and then `client(mod)` in the page, with **the same `mod` object** and the same
   module instance. Module-level variables are therefore shared between the two, and the bundled examples pass
   state from `main` to `client` that way.
3. Every worker (mesher, terrain) imports your module again and runs only `main(mod)`, with `mod.realm === 'worker'`.
   There `mod.client.*` does nothing, `mod.mc` holds only the common part (no classes), and there's no DOM.
4. When a world opens, the mods in play are **bound**: every registered block and item gets its id for that world.
   This happens again for every world opened and when joining someone, so ids can change while your code runs.
5. Entrypoints run once per page. There's no "world start" entrypoint: use the `worldLoad` / `clientJoin` events,
   and reset any per-world state you keep (`worldClose`, `clientJoin`).

Rules that follow from this:

- **Register everything in `main`, unconditionally, every time, in the same order.** Blocks, items, recipes,
  world generation, entities, commands and channels must exist identically in every realm and on every player's
  machine. Don't register depending on settings, randomness or the realm, except as noted next.
- Classes that extend the page's classes (an entity extending `mod.mc.Mob`, a screen extending `mod.mc.Screen`)
  can only be defined in the page: wrap them in `if (mod.realm === 'page')` (entities) or define them in `client`
  (screens).
- `main` may be `async`, but registering after an `await` is too late for the workers. Register synchronously.
- A disabled mod's code stays loaded until the page reloads, but its content isn't bound and its hooks, events,
  mixins, renderers and channels stop running. That gating only covers what you registered through `mod`. Your own
  `setInterval`, `addEventListener` and other globals keep going, so don't use them: use `serverTick` /
  `clientTick`.

---

## The context (`mod`)

The full typed interface is `ModContext` in `src/mod/api.ts`.

| Member | |
|---|---|
| `mod.id`, `mod.version`, `mod.manifest`, `mod.realm` | `realm` is `'page'` or `'worker'`. |
| `mod.key(path)` | `'mymod:' + path` (keys that already have a namespace pass through). |
| `mod.log(...)`, `mod.warn(...)` | Console output tagged with the mod id. |
| `mod.block(name, display, props?, behavior?, itemProps?)` | Registers a block (and its item). Returns a `BlockRef { key, id, def, item }`. [Blocks](#blocks) |
| `mod.item(name, props, behavior?)` | Registers an item. Returns an `ItemRef { key, id, def }`. [Items](#items) |
| `mod.blockRef(key)`, `mod.itemRef(key)` | Look up a ref by key (yours or another mod's). |
| `mod.stack(item, count?)` | An `ItemStack` from a ref, a key (`'stick'`, `'mymod:gizmo'`) or an id. |
| `mod.recipes.shaped / shapeless / smelting` | [Recipes](#recipes). |
| `mod.worldgen.ore(spec)`, `mod.worldgen.feature(spec)` | [World generation](#world-generation). |
| `mod.entity(name, Class)` | A mob or other entity type (page only). [Entities](#entities-and-mobs) |
| `mod.commands.register(def)` | A chat command. [Commands](#commands) |
| `mod.on(event, fn, priority?)` | Listen to an event; returns an unregister function. [Events](#events) |
| `mod.mixin(target, method, injection)` | Hook any method of any game object. [Mixins](#mixins) |
| `mod.channel(name)` | A network channel between clients and the server. [Networking](#networking) |
| `mod.config(schema)` | Per-browser settings with a generated settings page. [Settings](#settings) |
| `mod.worldData(defaults)` | Data saved with the world, on the server: returns a getter for the current world's copy. |
| `mod.client.*` | Page-only extension points: `texture`, `itemSprite`, `sound`, `screen`, `keybind`, `touchButton`, `tileRenderer`, `entityRenderer`, `creativeTab`, `configScreen`, `openScreen`, `setView`, `view`, `ghostLayer`, `worldAction`. |
| `mod.mc` | The game's pieces (below). |

### `mod.mc`

Everywhere (page and workers), from `commonMc` in `src/mod/api.ts`:

| | |
|---|---|
| `B`, `I`, `I2`…`I6` | Vanilla block and item id constants (`B.STONE`, `I.STICK`, `I.DIAMOND`…). |
| `BLOCKS` | `BlockDef[]` by id (`BLOCKS[id].solid`, `.hardness`, `.name`…). |
| `ITEMS` | `Map<id, ItemDef>`. |
| `blockByName(name)`, `itemByName(name)` | Vanilla names (`'oak_planks'`) or mod keys (`'mymod:gizmo'`). |
| `getItem(id)`, `stack(id, count?)` | |
| `idOf`, `metaOf`, `pack` | Block value helpers. |
| `tex(name)`, `textureName(layer)` | Texture names ↔ layers. |
| `Render` | Block render types: `Cube`, `Cross` (plants), `Model` (box models), `Torch`, `Crops`, `Liquid`, `Rail`, `None`. |
| `FACE_DIRS`, `HORIZ`, `HORIZ_TO_FACE`, `FACING6` | Direction tables. |
| `box(x0, y0, z0, x1, y1, z1, tex, extra?)` | A model `Box` in 16ths. |
| `rotY(box, facing)`, `orient6(box, facing6)` | Turn boxes (horizontal / any of 6 directions). |
| `Random` | The game's seeded RNG: `new Random(seed)`, `.next()` in [0, 1), `.int(n)`. |
| `TAGS` | Ingredient tags (`planks`, `logs`, `wool`…). |
| `BIOMES` | The biomes, by the index chunks keep (`chunk.biomes[z * 16 + x]`): `BIOMES[i].name`. |
| `blockspec` | Block states in words, as commands write them: `stateOf(v)` (named properties), `parseBlock('oak_stairs[facing=east]')` / `formatBlock(v)`, `rotateBlock(v, quarterTurns)` / `mirrorBlock(v, 'x' \| 'z')` (turn a state with a structure), `partnerOf(v)` (a door's or bed's other half), `stateValues(id)`, `withState`, `familyOf`, `suggest(name)` (closest block names). |
| `shapes` | How blocks join their neighbours, as the game draws them (`nb(dx, dy, dz)` reads a neighbour): `stairShape(meta, nb)`, `chestPartnerDir`, `joins(v, nb)` (the sides a fence, pane or wall joins on), `wireConnections` / `wireClimbs`, `POT_PLANTS` (a flower pot's plant by meta). |

Page only, from `pageMc` in `src/mod/page.ts`:

| | |
|---|---|
| Classes | `Game`, `Dim`, `Client`, `World`, `Entity`, `LivingEntity`, `Mob`, `Monster`, `Animal`, `ItemEntity`, `Arrow`, `Player`, `ServerPlayer`, `Interaction`, `Commands`, `Redstone`, `BlockTicker`, `Inventory`, `UI`, `Screen`, `Button`, `Slider`, `TextField`, `ContainerScreen`, `Hud`, `Renderer`, `EntityRenderer`. Use them to subclass, to `instanceof`-check, or as mixin targets. |
| `modelBoxes`, `collisionShapes`, `selectionShapes` | A block state's boxes and shapes. |
| `math` | `mat4()`, `identity`, `translate`, `scale`, `rotateX/Y/Z`, `multiply`, `invert`… (column-major `Float32Array`). |
| `pixels` | Painting 16×16 images: `newImg()`, `hex('#rrggbb')`, `set(img, x, y, rgb, a?)`, `get`, `shade(rgb, f)`, `mix(a, b, t)`, `art(img, rows, palette)`, `copy`, `paletteNoise(img, r, palette)`, `blobField(r)`. |
| `getTexture(name)` | A block texture's pixels (to paint over, e.g. ore on `getTexture('stone')`). |
| `synth`, `SAMPLE_RATE` | Sound synthesis: `noise(n, r)`, `tone(n, f0, f1, 'sine'\|'saw'\|'square'\|'tri', vib?, vibF?)`, `lowpass(b, hz)`, `highpass`, `bandpass(b, lo, hi)`, `env(b, attack, decay, curve)`, `mixInto(a, b, gain, offset)`, `normalize(b, peak)`. |
| `blockCtx(game, x, y, z)` | The context block hooks get, for any block. Server side, in the current dimension. |
| `storage`, `rleEncode`, `rleDecode` | Saved worlds in this browser: `listWorlds()`, `saveWorld(meta)`, `chunkKeys(storeId)`, `loadChunk(storeId, 'cx,cz')`, `saveChunks(storeId, [[key, chunk]])`. A world's Overworld chunks are stored under its id, the others under `id~nether` and `id~end`; a chunk's `blocks` are run-length coded (`rleDecode(c.blocks, 65536)`). Mark chunks you make yourself `foreign: true` (not this game's generator: players joining get them whole). Write only worlds that aren't open. To have a world's own terrain without opening it, `new mc.World(seed, id, dim, 'local').generateExtra(cx, cz)` (then `destroy()` it). |
| `device` | `device.touch`: the player is using a finger, not a mouse. |
| `client`, `game` | Getters: this page's client, and its running simulation (null when not hosting or not playing). Prefer the `client` / `game` your hooks receive. |

---

## Blocks

```ts
const lamp = mod.block('lamp_post', 'Lamp Post',
  { render: mod.mc.Render.Model, light: 12, hardness: 1, tool: 'pickaxe', sound: 'metal', tex: 'mymod:lamp' },
  { /* behaviour hooks, below */ },
  { tab: 'Decoration Blocks' },           // optional item properties
);
```

**Properties** (`BlockOpts`, from `BlockDef` in `src/world/blocks.ts`); all are optional:

| | |
|---|---|
| Textures | `tex` (all faces), `top`, `bottom`, `side`, `front`. The default is the block's key (`mymod:lamp_post`), so painting a texture with that name covers every face. `front` makes a cube that turns its front toward the player who places it (meta 0-3). |
| `render` | `Render.Cube` (default), `Render.Model` (your `model` hook's boxes), `Render.Cross` (a plant), … |
| `hardness` | Mining time (stone 1.5, dirt 0.5, obsidian 50; −1 unbreakable). |
| `tool`, `harvestLevel` | `'pickaxe' \| 'axe' \| 'shovel' \| 'hoe' \| 'sword' \| 'shears'`. The level needed to drop anything (0 wood, 1 stone, 2 iron, 3 diamond); −1 (default) means any. |
| `blastResistance` | Explosions (default hardness × 5; stone 30). |
| `sound` | `'stone' \| 'wood' \| 'grass' \| 'gravel' \| 'sand' \| 'glass' \| 'cloth' \| 'snow' \| 'metal' \| 'slime' \| 'none'`. |
| `light` | Light emitted, 0-15. |
| `opaque`, `solid`, `translucent`, `lightOpacity` | Defaults: cubes are opaque and solid, models are solid and not opaque. |
| `gravity`, `flammable`, `replaceable`, `climbable`, `slipperiness`, `needsSupport` | |
| `drop` | `undefined` (default): drops itself. `null`: nothing. `'name'`: another item. For anything else, use the `drops` hook. |
| `item` | `false`: no item and not in the creative inventory. |

**Behaviour hooks** (`BlockBehavior` in `src/mod/types.ts`); all are optional and run on the server unless noted:

```ts
{
  placementMeta: (c) => c.facing,                       // meta to place with, or null to refuse the spot
  onPlaced: (c) => {},                                  // c.player may be null
  onUse: (c) => { c.setMeta(c.meta ^ 8); return true; },// right-click; true = handled (no placing)
  onBreak: (c) => {},                                   // after it's gone; c still describes it
  drops: ({ id, meta, tool, rng, silk }) => [mod.stack('mymod:gizmo', 1 + rng.int(2))],
  canStay: (c) => mod.mc.BLOCKS[c.neighbor(0, -1, 0) & 0xfff].solid,   // false = it breaks
  neighborChanged: (c) => {},
  randomTick: (c) => {},                                // now and then (crops grow this way)
  scheduledTick: (c) => {},                             // after c.schedule(ticks)
  tile: { create: (c) => ({ energy: 0 }), tick: (c, tile) => {}, contents: (tile) => [] },
  redstone: { power: (c, dir, strong) => 0, update: (c) => {} },
  model: (meta, nb, faces) => [/* Box[] in 16ths */],   // also runs in the mesher worker
  collision: (meta, nb) => [/* Shape[] in block units */],
  selection: (meta, nb) => [],
}
```

- **Block contexts** (`BlockCtx`): `game`, `world`, `x y z`, `v id meta` (as they were when the hook was called),
  `setMeta(meta)` (keeps the tile entity), `set(v)` (replaces the block), `tile()`, `tileChanged()`,
  `schedule(delay)`, `neighbor(dx, dy, dz)` (a packed value), `power()`, `powerFrom(side6)`, `updateRedstone()`.
  `onUse` gets a `PlayerBlockCtx`, which adds `player`, `held` (the stack in hand), `face` and
  `openScreen(id, ...args)`. `placementMeta` gets a `PlaceCtx`: `player`, `x y z` (where it goes), `face`,
  `facing` (0-3, the way the player looks), `facing6` (toward the player), `hitY` and `held`.
- **Tile entities.** With a `tile` spec, the block gets a plain JSON object when placed (`create`). It is saved
  with the chunk, ticked every tick while loaded (`tick`), and sent to players who can see it **when you call
  `c.tileChanged()`**. Client code reads it with `client.world.getTile(x, y, z)`. The game stores the block's key
  in `tile.type`, so don't use that field. When the block breaks, `contents(tile)` is dropped (by default the
  tile's `items` array, if it has one).
- **Redstone.** `power(c, dir, strong)` is the power (0-15) your block sends toward its neighbour in vanilla 6-way
  direction `dir`. `update(c)` runs when redstone around it changes. Read input with `c.power()` / `c.powerFrom(side6)`,
  and call `c.updateRedstone()` after your output changes.
- **Models.** `model(meta, nb, faces)` returns `Box`es in 16ths: `{ x0, y0, z0, x1, y1, z1, tex: number[6] }` with one
  texture layer per face (−x +x −y +y −z +z). `faces` holds the block's texture layers (`faces[0]` …, `faces[6]` is
  `front` if set). Use `mc.box(…)`, and turn boxes with `mc.rotY(box, facing)`. `nb(dx, dy, dz)` reads neighbours,
  to connect to them. **The model hook runs in the mesher worker, so it must only use its arguments** and plain
  constants: no closures over page state, and nothing random. Without `collision`, a model block collides as a full
  cube. `collision` and `selection` return `Shape`s in block units (0-1).
- Textures for blocks are registered client side: `mod.client.texture(name, painter)`, where the painter is
  `(r: Random) => Img`. Paint deterministically from `r`.

---

## Items

```ts
const wand = mod.item('wand', { display: 'Wand', maxStack: 1, rarity: 'rare', tab: 'Tools' }, {
  use: (c) => { /* right-click in the air */ return true; },
  tooltip: (stack, lines) => { lines.push('§7Point and click'); },
});
```

**Properties** (`ItemProps`; see `ItemDef` in `src/game/items.ts`):

| | |
|---|---|
| `display` | Required. The name. |
| `maxStack` | Default 64. |
| `sprite` | Item sprite name; default is the item's key. Paint it with `mod.client.itemSprite(key, () => Img, outline?)`. |
| `durability`, `tool: { type, level, speed, damage }`, `attack` | Tools and weapons (diamond pickaxe: level 3, speed 8). |
| `food: { hunger, saturation }`, `drink` | Eaten or drunk with a held right-click. |
| `armor: { slot: 0-3, points }` | Helmet, chest, legs, boots. |
| `fuel` | Furnace burn ticks. |
| `rarity` | `'common' \| 'uncommon' \| 'rare' \| 'epic'` (name colour). |
| `egg: 'mymod:beetle'` | A spawn egg for that entity type. |
| `places: ref or key` | Places a block (seeds and the like). |
| `tab` | Creative tab: a vanilla tab's name (`'Building Blocks'`, `'Decoration Blocks'`, `'Redstone'`, `'Transportation'`, `'Miscellaneous'`, `'Foodstuffs'`, `'Tools'`, `'Combat'`, `'Brewing'`, `'Materials'`) or your own tab's id (`'mymod:things'`). By default it goes in your mod's tab. |

**Behaviour hooks** (`ItemBehavior`); they run on the server except `tooltip`. The context (`ItemCtx`) has `game`,
`world`, `player`, `stack` (the held stack), `consume(n)` (not in creative) and `damage(n)` (tool wear):

| | |
|---|---|
| `use(c)` | Right-click in the air. Return true if it did something (the arm swings). |
| `useOnBlock(c)` | Right-click on a block, before the block's own use. `c.x y z face v`. Return true if handled. |
| `useTick(c)` | **Hold-to-use** (wands, beams, chargers): every tick while the use button is held, with `c.ticks` from 0. It replaces every other right-click use: blocks aren't opened and nothing is placed. On phones, press-and-hold uses it instead of mining, and a tap is a short press. |
| `useStop(c)` | The button was let go (or the item put away) after `c.ticks` ticks. |
| `hitEntity(c)` | Hit an entity with it (`c.target`). |
| `tooltip(stack, lines)` | Client: add lines to the tooltip. |

**Data on a stack: `stack.tag`.** An `ItemStack` is `{ id, count, damage?, ench?, name?, tag? }`. `tag` is your
mod's own JSON (a wand keeps its spells there). It is saved with inventories, sent to players, and copied with
the stack, and two stacks only stack when their tags are equal. **Never change a tag in place**, because several
stacks can share one object. Put a new stack in the slot instead:

```ts
const inv = player.inventory, i = inv.selected, s = inv.main[i]!;
inv.main[i] = { ...s, tag: { ...s.tag, charge: ((s.tag?.charge as number) ?? 0) + 1 } };
```

Inventories (`player.inventory`): `main` (36 slots: 0-8 hotbar, 9-35 storage), `armor` (4), `selected`,
`held()`, `setHeld(s)`, `add(stack)` (returns how many didn't fit), `count(id)`, `remove(id, n)`. Change them on
the server; the owner's client gets the change automatically.

---

## Recipes

```ts
mod.recipes.shaped(['RRR', ' S ', ' S '], { R: 'mymod:ruby', S: 'stick' }, pickaxe);  // count defaults to 1
mod.recipes.shapeless(['paper', 'lapis_lazuli', '#wool'], scroll, 2);
mod.recipes.smelting(ore, ruby, 0.7);                                                  // xp
```

An ingredient (`Ingredient`) is a vanilla name (`'stick'`, `'iron_ingot'`, `'oak_planks'`), a key
(`'mymod:ruby'`), a ref, an id, a tag (`'#planks'`, `'#logs'`, `'#wool'`, `'#coals'`, `'#saplings'`, `'#leaves'`,
`'#sand'`, `'#flowers'`, `'#stone_crafting_materials'`), or an array of these (any of them). Patterns are rows of
up to 3 characters, with a space for an empty cell. Recipes rebuild whenever ids are bound, so refs are fine.
Vanilla names are the snake_case names in `src/world/blocks.ts` and `src/game/items.ts`.

---

## World generation

Generation runs in the terrain worker for every new chunk, on the host and on any player who generates terrain
locally. It must therefore be **deterministic**: use only `c.rng` (seeded by the world, the chunk and your
feature's name), never `Math.random`.

```ts
mod.worldgen.ore({ block: oreRef, size: 6, count: 3, minY: 4, maxY: 28 });   // vanilla-style veins in stone
mod.worldgen.feature({
  name: 'crystal_spires',
  dims: ['overworld'],                           // default; also 'nether', 'end'
  generate(c) {                                  // c: ChunkGenCtx, local coordinates 0-15, y 0-255
    if (c.rng.next() > 0.1) return;
    const x = c.rng.int(16), z = c.rng.int(16), y = c.height(x, z);
    if (y < 0) return;
    const id = mod.blockRef('crystal')!.id;      // read ids at generation time, not registration time
    for (let k = 1; k <= 4; k++) c.set(x, y + k, z, id);
  },
});
```

`ChunkGenCtx`: `cx`, `cz`, `seed`, `dim`, `rng`, `get(x, y, z)`, `set(x, y, z, v)`, `height(x, z)` (top non-air,
−1 if none), `biome(x, z)`. Writes outside the chunk are ignored, so keep features within the chunk.

---

## Entities and mobs

Entity types are page-only classes. Define them inside `if (mod.realm === 'page')` in `main`:

```ts
if (mod.realm === 'page') {
  const { Monster, I } = mod.mc;
  class Ghoul extends Monster {
    typeName = 'mymod:ghoul';                  // MUST equal 'mod:name' as registered (saving and /summon use it)
    override model = 'biped';                  // reuse a vanilla model and skin (or draw your own, below)
    override skin = 'zombie';
    override burnsInDay = true;
    constructor(world: ConstructorParameters<typeof Monster>[0], game: ConstructorParameters<typeof Monster>[1]) {
      super(world, game);
      this.maxHealth = this.health = 30;
      this.attackDamage = 5;
      this.speedAttr = 0.28;
    }
    override drops() { return [mod.stack(I.BONE)]; }
  }
  mod.entity('ghoul', Ghoul);
}
mod.item('ghoul_spawn_egg', { display: 'Spawn Ghoul', egg: 'mymod:ghoul' });
```

- **Base classes.** `Mob` (abstract `ai()`; you write the behaviour), `Animal` (wanders, follows `temptItems`,
  breeds), and `Monster` (hostile: targets players within `aggroRange`, chases at `chaseSpeed`, hits for
  `attackDamage`). `LivingEntity` and `Entity` are lower level. Read `src/entity/mobs.ts`. Useful fields and
  methods: `width`, `height`, `maxHealth`, `health`, `speedAttr`, `xp`, `hostile`, `burnsInDay`, `persist` (saved
  with the world; true for mobs), `eyeHeight()`, `drops()`, `damage(n, source, attacker)`, `heal(n)`,
  `addEffect(id, ticks, amp)`, `moveToward(x, z, speed)`, `wander(speed)`, `setPathTo(x, y, z, speed)`,
  `lookTarget`, `nearestPlayer(range)`.
- **Constructor.** It must be `(world, game)` and call `super(world, game)`. The class is also used to build the
  client's puppet, so keep the constructor free of side effects.
- **Saving.** `Mob` saves `type`, position, yaw, health and baby. For more, override `extraJSON()` (return plain
  data) and `loadExtra(d)`.
- **Replication.** Every own field of the entity (the ones you declare) is copied to the clients' puppets whenever
  it changes, except class instances and functions. Fields that hold an entity are sent as references. Don't keep
  big or fast-changing private data in fields: put it in a `WeakMap` keyed by the entity (the Wands dummy does
  this). Puppets never tick, so drawing code must use replicated fields only.
- **Looks.** Without a renderer, a mob is drawn with `model` and `skin`. Models: `'biped'`, `'bipedThin'`,
  `'creeper'`, `'spider'`, `'pig'`, `'cow'`, `'sheep'`, `'chicken'`, `'enderman'`, `'slime'`, `'wolf'`, `'squid'`,
  `'bat'`, `'villager'`, `'ghast'`, `'blaze'`, `'silverfish'`, `'horse'`. Skins usually share their mob's name
  (`'zombie'`, `'skeleton'`, `'pigman'`…). To draw your own, use `mod.client.entityRenderer('ghoul', (r, e) => …)`
  (see [Rendering](#rendering) and the Rubies beetle). A biped mob with a `look` field (a player skin preset such as
  `'knight'`, or an imported skin) is drawn in that player skin, and one with `armorItems` (four `{ id }` or null:
  helmet, chest, legs, boots) wears that armour; `heldItem` (an item id) is drawn in its hand.
- **Spawning.** Spawn eggs (`egg`), `/summon mymod:ghoul`, and `game.interact.spawnMob('mymod:ghoul', x, y, z)`
  all work. There's no natural-spawning API: spawn from `serverTick` yourself if you want that.
- **Attacks and damage.** `entity.damage(amount, source, attacker)` returns whether it applied. Sources include
  `'player'`, `'mob'`, `'magic'` (ignores armour), `'explosion'`, `'fire'` (fire-immune mobs ignore it),
  `'arrow'`, `'fall'` and `'kill'`. Living things ignore hits for half a second after one lands.

---

## Commands

```ts
mod.commands.register({
  name: 'heal', aliases: ['h'], usage: '/heal [amount]', description: 'heal yourself',
  permission: 'host',                                // 'host' (default) or 'all'
  run({ game, player, args, rest, reply, coord }) {
    const n = args[0] ? Number(args[0]) : 20;
    if (!Number.isFinite(n)) throw new Error('Usage: /heal [amount]');   // replies in red
    player.heal(n);
    return `Healed ${n}`;                            // or string[], or reply('...') as you go
  },
});
```

`coord('~2', 0)` parses a `~`-relative coordinate (axis 0 x, 1 y, 2 z). `permission: 'host'` lets only the host
run the command, or everyone when the host turned cheats on for all. Commands run on the server as the player who
typed them.

---

## Programming the server side

Server hooks (block and item hooks, events marked server, channel `onServer`, commands) receive the simulation,
`game: Game` (`src/game/game.ts`). The game tracks **who is acting** and **which dimension** is being simulated, and
`game.world`, `game.entities` and `game.player` follow from that:

- In a player's action (item hooks, `onUse`, commands, channel messages, `useBlock` and the like), `game.player` is
  that player and `game.world` is their dimension.
- In `serverTick` / `serverTickStart`, **no dimension is selected (`game.world` may be null)**. Loop over the
  dimensions yourself: `for (const d of game.dims.values()) game.inDim(d, () => { /* game.world is d's */ })`, or
  act as a player: `game.asActor(sp, () => …)` for `sp` in `game.players`.

What `game` offers (a cheat sheet; read the file for more):

| | |
|---|---|
| `game.world` | `get(x, y, z)` → packed value, `getId`, `set(x, y, z, v)`, `getTile`, `setTile`, `getLight(x, y, z)` → `[sky, block]`, `topSolidY(x, z)`, `isLoaded(x, z)`, `dimension`. |
| `game.entities` | Everything in the current dimension, players included. `game.addEntity(e)` adds one. |
| `game.players` | `ServerPlayer`s: `.entity` (the `Player`), `.name`, `.dim`, `.owner` (the host). `game.playersHere()`, `game.playerEntities()`, `game.playerOf(entity)`, `game.nearestPlayer(pos, range)`. |
| `game.player` | The acting player's entity (or the first player in this dimension). |
| `game.ticks`, `game.time`, `game.dimension`, `game.dims`, `game.meta` (saved world info) | |
| `game.interact` | `spawnMob(type, x, y, z)`, `explode(x, y, z, power, fire, source)`, `destroyBlocks(list, { drops, fire, fx })`, `breakBlock(x, y, z)` (as the acting player), `dropBlockItems`. |
| `game.dropItem(x, y, z, stack)`, `game.spawnXpAt(x, y, z, n)` | |
| `game.audio.play(name, pos, volume?, pitch?)` | Played for every player in earshot (`pos` null: only the acting player). Names are vanilla sounds (`'click'`, `'pop'`, `'explode'`, `'bow'`, `'dig.stone'`, `'step.stone'`, `'zombie.say'`…; the full list is `tools/sounds/vanilla.mjs`: recorded when the game has the vanilla set, else synthesised) or ones a mod registered. |
| `game.particles.<method>(…)` | Sent to the players who can see it: `smoke(x, y, z, big?)`, `flame`, `crit`, `explosion`, `heart`, `spell(x, y, z, rgb)`, `blockBreak(x, y, z, id)`, `drip(x, y, z, lava)`… (`src/game/particles.ts`). |
| `game.ui` | The acting player's UI: `chat.add(msg)`, `hud.actionBar(msg)`. `game.say(msg)` tells everyone. |
| `game.commands.run('/time set 0')` | Run a command as the acting player. |
| `game.ticker.schedule(x, y, z, delay)` | A scheduled block tick. |
| `game.lookVec(yaw, pitch)`, `game.eyePos()` | |

**`destroyBlocks`.** `game.interact.destroyBlocks(list, { drops, fire, fx })` breaks blocks the way an explosion
does. TNT primes, containers spill, neighbours update once at the end, and mod blocks get `onBreak`. Each block
drops its items with probability `drops` (0-1), as if mined with the right tool. `fire` lights some of the gaps,
and `fx` is `'break'`, `'smoke'` or `'none'`. Prefer it over a loop of `world.set(…, 0)`.

**Keeping places loaded.** The world is simulated around players. To keep somewhere else ticking (a town whose
owner looks elsewhere), set `dim.keepLoaded = [{ x, z, r }]` on a dimension (`game.dims`): block coordinates and a
radius in chunks. Keep the list short and the radii small; it only counts while someone is in that dimension.

**`worldData`.** `const data = mod.worldData(() => ({ next: 1, list: {} }))` returns a getter. `data()` is the
current world's object, created from the defaults the first time. Change it in place: it is saved with the world.
It lives on the server only, so send what clients need over a channel.

---

## Events

`mod.on(name, fn, priority?)`; higher priority runs first. The catalogue with exact argument types is in
`src/mod/events.ts`.

| Event | Side | Arguments | Return |
|---|---|---|---|
| `worldLoad`, `worldSave`, `worldClose` | server | `game` | |
| `serverTickStart`, `serverTick` | server | `game` (no dimension selected: see above) | |
| `playerJoin`, `playerLeave`, `playerRespawn` | server | `game, player` | |
| `chat` | server | `{ game, player, message }` | `'fail'` swallows it |
| `useBlock` | server | `{ game, player, x, y, z, v, face, held }` | `'success'` handled, `'fail'` refused, `'pass'` / nothing carries on |
| `useItem` | server | `{ game, player, stack }` | same |
| `attackEntity` | server | `{ game, player, target }` | same |
| `breakBlock` | server | `{ game, player, x, y, z, v }` (before) | `'fail'` keeps the block |
| `blockBroken`, `blockPlaced` | server | `{ game, player, x, y, z, v }` | |
| `entityDamage` | server | `{ game, entity, amount, source }` | `'fail'` cancels |
| `entityDeath` | server | `{ game, entity, source }` | |
| `subLevelTick` | server | `{ game, ship, dt }`, each moving sub-level before the physics step | push it ([Sub-levels](#sub-levels-moving-structures)) |
| `clientTick`, `clientJoin` | client | `client` | |
| `clientClick` | client | `{ client, button, target }`: a click in the world (0 attack, 2 use) at the block in reach (`target`, or null) | `'success'` / `'fail'` keeps it from the server (and holding that button does nothing until it's let go): tools that act on the client, like picking an area's corners |
| `screenOpen` | client | `{ screen }` | |
| `tooltip` | client | `{ stack, lines }` | |
| `hudRender` | client | `{ ctx, client, width, height, partial }` | draw in GUI units |
| `worldRender` | client | a `RenderContext` | |
| `worldRenderGlow` | client | a `RenderContext` | |

Listeners only run while their mod is in play. The first listener to return a value other than `'pass'`
decides the outcome.

---

## Programming the client side

Client hooks receive `client: Client` (`src/client/client.ts`): `client.player` (yours), `client.world` (a
**read-only replica**), `client.entities` (puppets), `client.ui` (`open(screen)`, `close()`, `screen`, `gui`,
`chat.add(msg)`), `client.input`, `client.options`, `client.audio.play(name, pos?, volume?, pitch?)` (only you
hear it), `client.particles` (local particles: same methods as above), `client.renderer` (`cam`, `viewProj`,
`backend`: `'webgpu'` or `'webgl2'`), `client.ticks` and `client.partial` (the fraction of a tick, for smooth
drawing). Mods draw through a `RenderContext` (renderers, `worldRender`, `worldRenderGlow`), never through the GPU
API, so the same mod looks the same with either backend.

**Textures and sprites.** These are registered from `client`, before the texture atlas is built at load:

```ts
mod.client.texture('mymod:glow', (r) => img);                 // block texture / render sprite (16x16 RGBA, alpha OK)
mod.client.texture('mymod:photo', 'data:image/png;base64,…'); // or an image URL (data: or same-origin), scaled to 16x16
mod.client.itemSprite('mymod:gizmo', () => img, '#202020');   // item sprite, optional outline colour
```

`Img` is a `Uint8ClampedArray` of 16×16 RGBA. Paint it with `mod.mc.pixels`. A texture that only your renderers
use still has to be registered this way, because that is what gives it a layer in the atlas. Resource packs can replace
it: `mymod:glow` is `assets/mymod/textures/block/glow.png` (or `item/glow.png`) in a pack (see `packs/README.md`).
Shader packs light your blocks and renderers like the game's own; a texture whose name ends in `_leaves`, or is
one of the game's plants, sways with them.

**Sounds.** `mod.client.sound('mymod:zap', (r) => Float32Array)` takes mono samples at `mc.SAMPLE_RATE` (22050).
Build them with `mod.mc.synth`, for example
`synth.normalize(synth.env(synth.tone(Math.floor(SAMPLE_RATE * 0.2), 900, 300, 'square'), 0.002, 0.18, 3), 0.4)`.
Play the sound from the server with `game.audio.play('mymod:zap', pos)`, or locally with `client.audio.play`.

**HUD.** `mod.on('hudRender', ({ ctx, client, width, height, partial }) => …)` draws on a 2D canvas in GUI units
after the game's HUD. Use `client.ui.gui`: `text(ctx, s, x, y, colour?, shadow?)`, `textCenter`, `font.width(s)`,
`panel`, `slot`, `button`, `tooltip(ctx, lines, x, y)`. Draw an item with `client.ui.drawItem(ctx, stack, x, y)`.
On phones the hearts sit top left and the food bar top right (`mod.mc.device.touch`). To place text over a point in
the world, project it with `client.renderer.viewProj` (camera-relative: subtract `client.renderer.cam`); the Wands
mod's `hud.ts` has a `project` function.

**Creative tabs.** `mod.client.creativeTab('things', 'My Things', () => iconItemId, () => stacks)`. Every mod with
items gets a tab by default. Stacks can carry tags (ready-made wands, for example).

---

## Rendering

Renderers draw into the world every frame, in world coordinates, through a `RenderContext` (`src/mod/render.ts`):

- `mod.client.tileRenderer(blockRef or key, (r, tile, x, y, z, v) => …)`: for each tile entity of that block near
  the camera (animated machine parts).
- `mod.client.entityRenderer('name', (r, entity) => …)`: draws a mod entity instead of the default model.
  Interpolate with `entity.lerpX(r.partial)` and friends.
- `mod.on('worldRender', (r) => …)`: anything else, solid.
- `mod.on('worldRenderGlow', (r) => …)`: **light**. What you draw is added onto the scene (overlapping glows get
  brighter, nothing gets darker), at full brightness, fading into the fog. Draw white sprites with soft alpha,
  tinted with `color`.

`RenderContext`:

| | |
|---|---|
| `r.boxes(boxes, x, y, z, m?, light?, color?)` | Boxes in 16ths (like block models) for the block cell at (x, y, z). `m` (from `mod.mc.math`, block units: 0..1 is the cell) transforms them first, e.g. spin about the centre: translate(0.5, 0.5, 0.5) · rotateY(a) · translate(−0.5, −0.5, −0.5). `color` is 0xRRGGBB. |
| `r.block(v, x, y, z)` | Any block state's model at a cell. |
| `r.item(id, x, y, z, m?)` | An item, as dropped items look, centred at a point. |
| `r.billboard(x, y, z, size, layer, color?, light?, alpha?)` | A camera-facing square, `size` blocks wide. |
| `r.quad(corners12, layer, uv?, color?, alpha?, light?)` | A quad from four world-space corners. |
| `r.tex(name)` | A texture's layer. Item sprites are `'item/<sprite>'`. |
| `r.light(x, y, z)` | `[sky, block]` light. `[15, 15]` is full bright. |
| `r.partial`, `r.time`, `r.cam`, `r.client` | `time` is ticks plus the fraction, for animation. |

**World actions.** `mod.client.worldAction({ label, needsWorld?, run(ui, world, back) })` adds a button to the world
list's **More...** screen (Singleplayer): importing a world from elsewhere, exporting the one picked (`needsWorld`).
`run` gets the picked world's meta (or null) and `back()`, which reopens the list.

**Ghost blocks.** `const layer = mod.client.ghostLayer()` makes a layer of blocks that are drawn in the world but
aren't in it: a schematic's preview, a building to come. Fill it a chunk column at a time with
`layer.setColumn(cx, cz, blocks)`, where `blocks` is a `Uint16Array` of 16 × 16 × 256 packed values indexed like a
chunk's (`(y * 16 + z) * 16 + x`, 0 is nothing), and `setColumn(cx, cz, null)` removes it. Columns are meshed in the
background by the game's own mesher (the same models, connections, culling and textures as real blocks) and drawn
with the world's chunks, solid, while your mod is in play. Nothing collides with them and aiming passes through.
Set `layer.visible`, or `layer.clear()`. The game empties every layer when the player changes world or dimension.
Only send columns that changed: each one is meshed again (with its neighbours if its edges changed).

Tips: look up texture layers once (they don't change after load). Very large or very close glows wash out the
screen, so shrink them near the camera. Skip far-away things.

---

## Views (camera and controls)

A mod can take over how the world is seen and played: a top-down or isometric view, a strategy game's free mouse
pointer, a cutscene. `mod.client.setView(view)` installs a `ClientView` (`src/client/view.ts`), and
`setView(null)` gives first-person play back. One view is active at a time (setting one replaces another mod's), it
only works while its mod is in play, and errors in it are reported like any hook's. Every member is optional:

| | |
|---|---|
| `camera(cam, client, partial)` | Change this frame's `Camera` after the game has set it up: `x y z`, `yaw`/`pitch` (radians), `fov`. Setting `cam.ortho = n` switches to a flat (orthographic) projection showing `n` blocks above and below the middle of the screen; the camera then sits at the point looked at (fog is measured from there) and draws what's within the far distance in front of and behind it. There's no sky or clouds in that mode, and nothing tints the screen for the camera being in water or a wall. |
| `showSelf` | Draw our own player (as in third person) and no first-person hand. |
| `freePointer` | No pointer lock and no crosshair. Mouse clicks, drags, moves and the wheel in the world (and on phones every touch that misses the game's buttons) go to `onPointer`. |
| `onPointer(e, client)` | `e.type` `down`/`move`/`up`/`wheel`/`cancel`, `e.x e.y` in GUI units, `e.button` (0 left, 1 middle, 2 right), `e.d` wheel steps, `e.touch` a finger's id (null for the mouse). Several fingers can be down. |
| `key(e, client)` | Sees each key pressed while playing before the game does; return true to keep it (the game's own keys and mod key bindings then don't see it). Held keys still show in `client.input.isDown`. |
| `look(dx, dy, client)` | Mouse-look movement, instead of turning the player. |
| `move(inp, client)` | Turn the movement keys (`forward`, `strafe`, `jump`, `sneak`, `sprint`) into the player's walking; for example camera-relative walking, or nothing at all. |
| `aim(client)` | Where the player aims (a unit direction from the eyes; the server picks the block or mob along it, within reach) and which buttons it holds and pressed this tick (0 attack/mine, 2 use/place). Replaces the crosshair and the mouse. Return null to aim at nothing. |
| `hud` | `'none'` hides the game's HUD (hotbar, health, crosshair), keeping chat, messages and mods' `hudRender`. |
| `touchPad` | Phones: keep the movement pad, jump button and hotbar (there's a character to walk). Without it they're hidden. |
| `brightness` | Light the world up this much (0-1, like night vision), so a dark scene stays readable. |

The player still exists while a view is on: the world loads around it and the server simulates around it, so a view
that roams (a strategy camera) moves the player along (the Overseer puts its player in spectator mode and carries
it under the camera). Picking what's under the pointer is up to the view: the Overseer's `cam.ts` has the ray
through a screen point for a flat projection, a voxel ray walk and a point-to-screen projection.

---

## Sub-levels (moving structures)

The game has moving block structures built in, the way Valkyrien Skies and Sable add them to Minecraft: airships,
boats, cars, drawbridges. A **sub-level** is a set of ordinary blocks living in its own **plot** in the
**shipyard**, a strip of every dimension far to the east (block x 320000 and on) that is never generated. Its
**pose** places those blocks in the world. Because they're real blocks in real chunks, every block keeps working on
a sub-level: chests and furnaces, redstone, tile entities, your mod's machines and their tile renderers. Players
walk on sub-levels and ride along as they move and turn, aim at their blocks, break and place them; entities that
appear in a plot (a broken block's drop) are moved out to where that spot really is.

Physics is Rapier (WebAssembly, loaded the first time a world has a sub-level, on the host only). Each sub-level is
a rigid body made of its blocks, colliding with the terrain around it and with other sub-levels. Gravity is 11 m/s²
(Sable's), masses are in kpg (a plain block weighs 1; wood, wool and glass less, stone and metal more), and blocks
under water are pushed up by the water they displace. Air resistance grows with the square of the speed.

**Coordinates.** A sub-level's blocks have **local** coordinates: their position in its plot. Its pose maps them to
the world: `world = R * (local - L) + T`, with `L` the pivot (local, near the centre of mass), `T` where the pivot is
(the entity's `x y z`) and `R` its rotation (a quaternion). In block hooks, `c.x c.y c.z` of a block on a sub-level
are local. Use `game.sublevels.containing(x, y, z)` to find the sub-level, and `s.toWorld(x, y, z)` /
`s.toLocal(x, y, z)` to go between the two.

**The sub-level** (`SubLevel`, an entity, `mod.mc.SubLevel`; `world.ships` lists them on the server and on every
client):

| | |
|---|---|
| `x y z`, `q` (`qx qy qz qw`), `lx ly lz` | Pivot in the world, rotation, pivot in local coordinates. |
| `pose()`, `poseAt(partial)` | The pose now, or between ticks (for drawing). |
| `toWorld(x, y, z)`, `toLocal(x, y, z)` | Map points. Directions: `mod.mc.pose.dirToWorld(pose, x, y, z)`. |
| `bounds` | Local block bounds `[x0, y0, z0, x1, y1, z1]` (inclusive). `radius()`: everything is within it of the pivot. |
| `lin`, `ang` | Velocity (m/s) and angular velocity (rad/s), world axes. |
| `mass`, `blockCount`, `label`, `owner`, `anchored` | |
| `data` | Your mod's own data for it (saved with it, and replicated to clients: keep it small). |

**On the server**, `game.sublevels`:

| | |
|---|---|
| `assemble(cells, { owner?, label?, anchor? })` | Turn world blocks (`[x, y, z][]`) into a sub-level. Returns `{ ship }` or `{ error }`. `mod.mc.gatherStructure(world, x, y, z)` gives the blocks connected to one (without the ground), as a Physics Assembler would take them. |
| `disassemble(ship, { force? })` | Put its blocks back into the world, turned to the nearest quarter turn. Returns why not (too tilted, something in the way), or null. Blocks turn with it: your blocks with a facing should have a `rotate(meta, turns)` hook. |
| `remove(ship)` | Take it away (its blocks stay behind in its plot, unused). |
| `list(dim?)`, `get(id)`, `containing(x, y, z)`, `worldPos(x, y, z)` | Find sub-levels; map a shipyard point to the world. |
| `applyForce(ship, fx, fy, fz, px, py, pz)` | Push (kpg·m/s², world directions) at a world point, for this tick. |
| `applyLocalForce(ship, fx, fy, fz, lx, ly, lz)` | The same in the sub-level's own directions at a local point: a thruster. |
| `applyTorque(ship, tx, ty, tz)`, `velocityAt(ship, px, py, pz)` | |
| `setVelocity(ship, lin, ang)`, `teleport(ship, x, y, z, q?)`, `anchor(ship, on)`, `markDirty(ship)` | |

Push sub-levels from the **`subLevelTick`** event, which runs once a tick for every moving sub-level just before the
physics step: `mod.on('subLevelTick', ({ game, ship, dt }) => game.sublevels.applyLocalForce(ship, 0, 220, 0, x, y, z))`.
Forces applied at other times are dropped. Your parts can find themselves cheaply from their tile entity's `tick`:
note the part there and use the list in `subLevelTick` (the Aeronautics mod does this).

Also in `mod.mc`: `pose` (quaternion helpers: `qrot`, `qmul`, `slerp`, `qyaw`, `toWorld`, `toLocal`...),
`airPressure(y)` (1 at sea level, less higher up, none above 320), `setBlockPhysics(id, { mass, friction,
restitution, volume })` for your blocks, `blockPhysics(v)`, `PHYS` (gravity and the other settings),
`ridingShip(entity)` (the sub-level an entity stands on, on either side). Rays: a `BlockHit` on a sub-level has
`ship` set and local coordinates, on the client (`client.target`) and the server (`game.target`).

For trying things by hand there's `/sublevel` (host): `assemble` (what you look at, or a box `x1 y1 z1 x2 y2 z2`),
`land`, `list`, `push id vx vy vz`, `spin`, `tp`, `anchor`, `name`, `remove`.

---

## Screens

Screens are 2D canvas UIs in GUI units. Subclass `mod.mc.Screen`; screen classes are page-only, so define them in
`client` (or in a function called from it). A complete example, a block that opens a panel with a button that asks
the server to do something:

```ts
import type { ModContext, UI, Ctx, Channel } from '../sdk';

let press: Channel<{ x: number; y: number; z: number }>;

export function main(mod: ModContext) {
  press = mod.channel('press');                              // channels: in main, on both sides
  mod.block('panel_block', 'Panel Block', {}, {
    onUse: (c) => { c.openScreen('mymod:panel', c.x, c.y, c.z); return true; },
  });
  press.onServer((d, player, game) => {
    if (![d?.x, d?.y, d?.z].every(Number.isInteger)) return;
    if (Math.hypot(player.x - d.x, player.y - d.y, player.z - d.z) > 8) return;
    game.audio.play('pop', { x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 });
  });
}

export function client(mod: ModContext) {
  const { Screen, Button } = mod.mc;
  class Panel extends Screen {
    constructor(ui: UI, private bx: number, private by: number, private bz: number) { super(ui); }
    override init() {                                        // runs again when the GUI is resized: lay out here
      const cx = Math.floor(this.gui.w / 2);
      this.widgets = [new Button(this.ui, cx - 50, 60, 100, 20, 'Press me', () => press.toServer({ x: this.bx, y: this.by, z: this.bz }))];
    }
    override render(ctx: Ctx, mx: number, my: number) {
      this.backgroundGradient(ctx);
      this.gui.textCenter(ctx, 'My Panel', this.gui.w / 2, 40, '#ffffff');
      super.render(ctx, mx, my);                             // draws the widgets
    }
    override tick() { if (this.onServer) return; /* client-only work */ }
  }
  mod.client.screen('panel', (ui, x, y, z) => new Panel(ui, Number(x), Number(y), Number(z)));
}
```

- **Opening.** The server opens a registered screen for a player with `c.openScreen('mymod:panel', ...args)` in a
  block's `onUse` (the arguments must be JSON-safe). The client can open any screen itself:
  `client.ui.open(new Panel(…))`, or `mod.client.openScreen(screen)`.
- **Server copies.** A screen the server opens is also built on the server, as a "twin". Keep constructors light,
  and check `this.onServer` in `init` and `tick` before touching the client. Screens you open yourself on the
  client have no twin.
- **Input.** Override `mouseDown(mx, my, button)` (button 0 left, 2 right; return true if handled),
  `mouseMove(mx, my)`, `mouseUp(mx, my, button)`, `wheel(dir)`, `key(e: KeyboardEvent)` (Escape closes by default)
  and `char(c)`. Widgets: `Button`, `Slider`, `TextField` (when focused, phones show their keyboard).
- **Flags.** `pausesGame`, `darkens`, `hidesSelection`, `touchTools` (the Split/Shift helper buttons for slot
  screens on phones), `touchScrolls` (a vertical finger drag sends `wheel` instead of clicks).
- **Container screens** (`mod.mc.ContainerScreen`) are slot UIs: implement `buildSlots()` (push `Slot`s with `get`
  and `set`; `addPlayerSlots()` adds the inventory) and set `title`, `pw` and `ph`. A container screen opened by the
  server is mirrored: the server's twin replays the player's clicks, so items stay authoritative. Its slots should
  read and write server state (for example a tile entity's `items` array) through `get` and `set`.
- **Everything else** a screen does that should change the world goes to the server over a channel, as above
  (Computers' terminal and Wands' editor do this).

---

## Phones and touch

The game is played on phones too, so check your mod there (`?touch=1`; see testing above).

- **Taps are clicks.** A finger has no hover and no right button, so anything you show on hover needs a tap
  equivalent (tap to select, tap again to act). Drags arrive as `mouseDown` → `mouseMove` → `mouseUp`. A long press
  (about 300 ms without moving) is the usual way to start a drag, and a vertical swipe usually scrolls. Check
  `mod.mc.device.touch` to choose.
- **Sizes.** A screen can be as small as about 320×240 GUI units (the in-world HUD on a phone as small as
  300×180). Lay out from `this.gui.w` / `this.gui.h` in `init`, and keep touch targets at least about 16-18 units.
- **Keys.** Phones have none, so every key binding needs a touch button:

```ts
mod.client.touchButton('edit', {
  visible: (client) => !!client.player && !client.ui.screen && holdsMyThing(client),
  onPress: (client) => openEditor(client),
  icon: (ctx, x, y, w, h) => { /* draw in GUI units */ },   // or label: 'Edit'
});
```

  Visible buttons stack up from the jump button, bottom right.
- **Hold-to-use items** (`useTick`) work with press and hold. With touch aiming, the server's aim direction for the
  player follows the finger.

---

## Settings

```ts
const cfg = mod.config({
  enabled: { type: 'boolean', default: true, label: 'Enabled', description: 'Shown on the settings page' },
  size: { type: 'number', default: 80, min: 48, max: 128, step: 8, label: 'Size' },
  mode: { type: 'enum', default: 'a', options: ['a', 'b'], labels: ['First', 'Second'], label: 'Mode' },
  title: { type: 'string', default: 'Hi', maxLength: 20, label: 'Title' },
  toggleKey: { type: 'key', default: 'KeyM', label: 'Toggle Key' },
});
mod.client.keybind('toggleKey', 'KeyM', (client) => { cfg.enabled = !cfg.enabled; });
```

- `cfg` is a live object of values. The Mods screen generates a settings page for the schema and saves changes
  (per browser, in `localStorage`). Assigning a value in code changes it for this session but doesn't save it.
- Call `mod.config` **once** (in `main`, so workers see the values too) and share the object with `client`.
- Settings belong to each browser. Server-side settings ("when hosting…") are therefore the host's: read them in
  server code and they apply to everyone in the host's game.
- **Key bindings** use `KeyboardEvent.code` (`'KeyR'`, `'Digit1'`). A binding whose name matches a `key` setting
  can be rebound on the settings page. Bindings fire only while playing, with no screen open. The game already uses
  W A S D, Space, Shift, Ctrl, E, Q, F, T, `/`, 1-9, Escape and F1-F5.
- `mod.client.configScreen((parent) => screen)` replaces the generated page.

---

## Networking

```ts
// main (both sides must create the channel)
const ping = mod.channel<{ x: number; y: number; z: number }>('ping');
ping.onServer((d, player, game) => {
  // from a player's client: check everything (types, ranges, distance, permission) before acting
  if (![d?.x, d?.y, d?.z].every(Number.isInteger)) return;
  if (Math.hypot(player.x - d.x, player.y - d.y, player.z - d.z) > 8) return;
  game.world!.set(d.x, d.y, d.z, mod.blockRef('gizmo_block')!.id);
  ping.toPlayer(player, d);                  // answer that player
});
// client
ping.onClient((d, client) => client.ui.chat.add(`§aDone at ${d.x}, ${d.y}, ${d.z}`));
ping.toServer({ x: 1, y: 64, z: 2 });
```

| | |
|---|---|
| `toServer(data)` | Client → server. `onServer(fn(data, player, game))` runs as that player (their dimension). |
| `toPlayer(player, data)` | Server → one player's client. |
| `toAll(game, data, near?)` | Server → every player (or those in `near`'s dimension). |
| `onClient(fn(data, client))` | |

- Payloads are JSON-safe values (no class instances, functions or Maps).
- **A guest's messages to the host are limited** to 64 KB of JSON each and about 20 per second (bursts of 40),
  shared across all mod channels. Batch: send one message per tick with a list, not one per item.
- **Treat every client message as untrusted.** It runs on the host's machine and can come from a modified client.
  Validate shapes, numbers, ranges, distances and rights. Decide from the server's own state (the item in the slot,
  the player's mode), never from what the message claims.
- Other ways state reaches clients without channels: entity fields (replicated automatically), tile entities
  (`tileChanged()`), inventories and stack tags, sounds and particles.

---

## Mixins

When there's no event or hook for what you need, wrap a method of the game. The game's classes only exist in the
page, so install mixins in `client` or inside `if (mod.realm === 'page')`:

```ts
if (mod.realm === 'page') mod.mixin(mod.mc.Player.prototype, 'jump', {
  before(self, args, ci) { if (self.sneaking) ci.cancel(); },            // ci.cancel(value) skips the original
  after(self, ret, args) { self.vy *= 1.2; },                            // return a value to replace the result
  // around(self, original, args) { return original(...args); },
  priority: 0,                                                           // higher runs outermost
});
```

Pass a class's `prototype` for its methods, or an object for its own. Several mods can hook the same method.
Injections of inactive mods are skipped, and a throwing injection is reported without breaking the game. Mixins
reach deep into the game's internals, so prefer events and hooks where they exist, and test after game updates.

---

## Ids, worlds and missing mods

- Mod block ids are 2048-4095 (a block's item has the same id); mod item ids start at 4096. They are **bound per
  world**: a world records which key got which id, so adding mods or changing their order never reshuffles a
  saved world. Each world opened (and each host joined) binds again, and ids may differ between worlds.
- Keep refs and read `.id` when you need it. Don't store raw ids anywhere that outlives the world (settings, other
  worlds), and don't capture `ref.id` at registration time (it's −1 then).
- If a world's mod is missing, the player is warned before playing. Its blocks and items stay as "missing"
  placeholders and come back when the mod returns.

---

## Multiplayer

The host's mods (except client-only ones) are the game's mods. A joining player gets the list, then:

1. uses the mods they already have, at the same hash;
2. downloads the ones in the site's repository (hash-checked);
3. gets any others, such as the host's file-installed mods, from the host over the game connection, after agreeing.

The player then runs exactly that set, plus their own client-only mods, and takes the host's id numbering before
any chunk arrives. Leaving restores their own mods. Your `"*"` mod therefore always runs the same code on every
machine in a game: the host does the server side for everyone, and each player's page does its own client side.

---

## Rules and pitfalls

1. **Types-only imports from the game.** Use `import type … from '../sdk'` and get everything at run time from
   `mod`/`mod.mc`. A runtime import of a game file fails the build.
2. **Register in `main`, always, synchronously, in the same order**, in every realm. Anything that touches the
   page's classes (`mod.mc.Mob`, `mod.mc.Player`…: entity subclasses, mixins, `instanceof` checks at load) is
   guarded by `mod.realm === 'page'` (those classes are `undefined` in workers), and client things go in `client`.
3. **Never cache numeric ids** of mod content. Read `ref.id` when you need it.
4. **Change the world on the server only** (`game` from a hook or event). `client.world` and `client.entities` are
   replicas: edits there are lost or ignored.
5. **`serverTick` has no dimension selected.** Use `game.inDim(dim, …)` or `game.asActor(sp, …)` before touching
   `game.world` or `game.entities`.
6. **Validate every channel message on the server.** It is input from someone else's machine.
7. **Entities:** `typeName` must be `'mymod:name'` as registered. The constructor must be `(world, game)` and
   free of side effects. Every own field is replicated, so keep big or private data off the entity.
8. **Stack tags are immutable.** Replace the stack; never change `stack.tag` in place.
9. **Workers:** `main` runs without a DOM and without page classes. Block `model`/`collision`/`selection` hooks
   and world features run there: keep them pure and deterministic (`c.rng`, not `Math.random`).
10. **JSON-safe data** in tile entities, `worldData`, stack tags, screen arguments and channel payloads.
11. **Textures** must be registered in `client` before use. Block textures default to the block key and item
    sprites to the item key. Renderers look up layers with `r.tex(name)`.
12. **The font is ASCII-only.** `∞`, `…` and `•` render as `?`; write `INF`, `...`, `-`.
13. **No timers or global listeners.** Use `serverTick` / `clientTick`, which stop when the mod is disabled.
14. **Reset per-world state** you keep in module variables on `worldClose` (server) and `clientJoin` (client).
15. **Think about phones** for every UI: taps instead of hover, no right-click, touch buttons for key bindings,
    small GUI sizes.
16. **Type-check** (`npm run check`) and **test in the browser**: the build doesn't check types, and errors in
    hooks are caught and only logged.

---

## Example mods

Each example is a complete mod in this folder; read the one closest to what you're building.

| Mod | Files | Shows |
|---|---|---|
| `ruby` (Rubies) | `main.ts` | Ore and world generation, items and tools, recipes and smelting, drops, a mob with its own renderer and spawn egg, an event listener, a command, painted textures and sprites. |
| `computer` (Computers) | `main.ts`, `shell.ts`, `terminal.ts` | A tile entity holding files and a program, a server-opened screen, channels for typing and saving (with validation), redstone in and out per side, per-world data, a sound, a setting. |
| `kinetic` (Kinetics) | `main.ts` | Machines: power spread through neighbouring tile entities, animated tile renderers (spinning shafts, crank, windmill sails, millstone), custom shapes, a HUD readout. |
| `minimap` (Minimap) | `main.ts` | A client-only mod (`"environment": "client"`): HUD drawing, a rebindable key, a generated settings page. |
| `overseer` (Overseer) | `main.ts` (wiring), `defs.ts` (units, buildings, blueprints), `cam.ts`, `ctl.ts`, `hud.ts`, `units.ts`, `ai.ts`, `server.ts`, `place.ts`, `state.ts` | A view (`setView`): a flat 2.5D camera, a free pointer with mouse and touch gestures, camera-relative walking and pointer aiming for a hero. A strategy game on top: one mob class for many unit kinds drawn in player skins and armour, server-side unit AI (paths, fights, gathering, building block by block), shared placement rules for the client's ghost and the server's check, `keepLoaded`, a mixin that makes monsters target units, a command, host settings. Its own tour is [`overseer/README.md`](overseer/README.md). |
| `aeronautics` (Aeronautics) | `main.ts` (wiring), `blocks.ts`, `flight.ts`, `client.ts`, `art.ts` | Sub-levels: assembling and landing structures, forces from the `subLevelTick` event (propellers, hot-air balloons found by a layered flood fill, levitite, gyroscopes), parts that find their sub-level from their tile ticks, a view that turns the movement keys into a pilot's controls sent over a channel, flight readouts on the HUD, tile renderers spinning on moving ships, a hold-to-use tool that drags sub-levels. Its own guide is [`aeronautics/README.md`](aeronautics/README.md). |
| `blueprints` (Blueprints) | `main.ts` (wiring), `nbt.ts`, `model.ts`, `vanilla.ts`, `tiles.ts`, `formats.ts`, `library.ts`, `placement.ts`, `state.ts`, `capture.ts`, `ghost.ts`, `render.ts`, `paste.ts`, `server.ts`, `blocks.ts`, `ui.ts` | Schematics like Litematica: ghost blocks (`ghostLayer`) compared with the world column by column, a client-side tool (`clientClick`), files read and written in Java Edition's formats (NBT, gzip, Litematica, Sponge, structure files) with the game's blocks in Java's words (`blockspec`, `shapes`), IndexedDB, screens with scrolling lists, a paste streamed to the server in small checked batches, an easy-place request the server checks. Its own guide is [`blueprints/README.md`](blueprints/README.md). |
| `wands` (Wands) | `main.ts` (wiring), `spelldefs.ts` + `catalog/*.ts` (data), `engine.ts`, `motion.ts`, `server.ts`, `status.ts`, `blocks.ts`, `fx.ts`, `hud.ts`, `editor.ts`, `dummy.ts`, `art.ts`, `icons.ts` | A large mod: hold-to-use items with data in `stack.tag`; server-side projectiles sent as compact per-tick events that each client flies itself; glow rendering; a phone-friendly editor screen with drag and drop, tap-to-move and undo, whose edits the server checks; a touch button; host settings; a mob drawn by its own renderer with private data kept off the entity. Its own reference is [`wands/README.md`](wands/README.md), and every spell is listed in [`wands/SPELLS.md`](wands/SPELLS.md). |

## Where things are

| File | |
|---|---|
| `mods/sdk.ts` | The types mods import. |
| `src/mod/api.ts` | `ModContext`, `ClientApi`, `Channel`, `commonMc`. |
| `src/mod/page.ts` | `pageMc` (page classes and helpers), the client extension points. |
| `src/mod/types.ts` | Block and item behaviours and their contexts, the manifest. |
| `src/mod/hooks.ts` | Commands, world generation, touch buttons and the other extension tables. |
| `src/mod/events.ts` | The event catalogue. |
| `src/mod/render.ts` | `RenderContext`. |
| `src/mod/config.ts`, `src/mod/mixin.ts`, `src/mod/registry.ts`, `src/mod/loader.ts` | Settings, mixins, ids, loading. |
| `src/world/blocks.ts`, `src/game/items.ts` | Block and item definitions, vanilla names and ids. |
| `src/game/game.ts`, `src/game/interact.ts` | The server: world, players, actions, explosions. |
| `src/entity/*.ts` | Entities and mobs. |
| `src/client/client.ts`, `src/ui/*.ts` | The client, screens, HUD, GUI helpers, touch controls. |
| `src/client/view.ts` | `ClientView`: what a mod's view can take over. |
| `src/client/ghosts.ts` | Ghost block layers (`mod.client.ghostLayer()`). |
| `src/agent/blockspec.ts` | Block states in words (`mod.mc.blockspec`). |
| `src/sublevel/*.ts` | Sub-levels: `ship.ts` (the entity), `server.ts` (`game.sublevels`, physics), `collide.ts` (walking and riding, rays), `pose.ts`, `shipyard.ts`. |
| `tools/vite-mods.ts` | How mods are built and served. |

## Publishing

Add the folder to `mods/` and deploy the site. `npm run build` writes
`dist/mods/<id>/<id>-<version>-<hash>.js` and `dist/mods/index.json`; the repository is plain static files.
Bump `version` when you change a mod, so players see an update. A built mod file (from `dist/mods/` or the dev
server's `/mods/…` URL) can also be shared directly: players add it with **Mods → Add from File…**.
