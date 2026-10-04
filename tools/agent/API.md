# Agent API reference

Generated from `src/agent/spec.ts` by `node tools/agent/api-doc.mjs`; see [README.md](README.md) for how to connect.

Positions are [x, y, z] arrays, {x, y, z} objects or "x y z" strings; `~` is relative to the player ("~ ~-1 ~5"). x grows east, z grows south, y up (0-255, sea level 63).

Every method answers JSON. Call one with `mc <method> key=value ...`, the MCP tool `call` (`{ "method": ..., "params": {...} }`), `await mc.call(method, params)` from Node, or `await api.<method>(params)` inside `mc eval`.

## Session and world

### `status`

The world, the player, time, weather, other players, mods, and whether the game is paused.

Returns { world: {name, id, seed, mode, dimension, time, day, weather, paused}, player: {name, pos, yaw, pitch, facing, health, food, gameMode, held, lookingAt}, players, mods, session }.

### `help`

This catalogue (or one method in detail).

| Parameter | Type | |
|---|---|---|
| `method` | string | One method name |

Returns { methods } or one method spec.

### `worlds`

Saved worlds in this browser.

Returns [{ id, name, seed, mode, lastPlayed }].

### `open`

Open a saved world, or create a new one, and wait until the player stands in it.

| Parameter | Type | |
|---|---|---|
| `world` | string | Id or name of a saved world |
| `new` | object | { name?, seed?, mode?: "survival"\|"creative"\|0\|1, time? } to create a world (default creative) |

Returns { id, name, seed }.

```json
{"new":{"name":"Agent build","seed":42,"mode":"creative"}}
```

### `save`

Save the world now (it also autosaves every minute).

Returns { saved: true }.

### `resume`

Close any open screen or pause menu so time runs again.

Returns { paused }.

### `awake`

Keep the game running while its tab is in the background (browsers stop hidden tabs). It always runs during a request.

| Parameter | Type | |
|---|---|---|
| `on` **required** | boolean | true to keep running |

Returns { awake }.

### `catalog`

Names of blocks, items, entities or biomes (filtered), to know what exists.

| Parameter | Type | |
|---|---|---|
| `kind` | string | blocks \| items \| entities \| biomes (default blocks) |
| `filter` | string | Substring to match |

Returns string[].

## Commands, chat and events

### `command` (changes the world)

Run game commands as the host (`/help` lists them: time, weather, give, summon, tp, gamemode, effect, enchant, gamerule, locate...). The slash is optional.

| Parameter | Type | |
|---|---|---|
| `cmd` | string | One command |
| `cmds` | array | Several commands, run in order |

Returns { output: string[] } (one list per command for `cmds`).

```json
{"cmd":"/time set day"}
```

### `chat`

Say something in the game's chat, under a name of your own, for everyone playing to read.

| Parameter | Type | |
|---|---|---|
| `msg` **required** | string | The message |
| `as` | string | Name shown (default "Claude") |

Returns { said }.

### `log`

What happened lately: chat lines, blocks players broke or placed, deaths, players joining and leaving, task errors. Use `since` with the last `cursor` to get only new events; `wait` waits for one.

| Parameter | Type | |
|---|---|---|
| `since` | number | Only events after this cursor |
| `types` | array | Only these: chat, place, break, death, join, leave, task, agent |
| `wait` | number | Seconds to wait for something new (max 300) |
| `limit` | number | At most this many (default 100, newest kept) |

Returns { cursor, events: [{ seq, t (game tick), type, ... }] }.

## Blocks

### `block`

One block: its name and state, light, biome, and what a container holds.

| Parameter | Type | |
|---|---|---|
| `pos` **required** | pos | Where |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { pos, block, name, meta, state, solid, light: [sky, block], biome, tile? }.

### `set` (changes the world)

Put blocks at exact positions. A block: name (`stone`, `minecraft:stone`, `Stone Bricks`), raw meta (`oak_log:1`) or named states (`oak_stairs[facing=east,half=top]`, `furnace[facing=south]`, `oak_log[axis=x]`, `stone_slab[half=top]`, `oak_door[facing=north]` puts both halves, `red_bed[facing=east]` both parts, `torch[facing=up|north..]`, `piston[facing=up]`).

| Parameter | Type | |
|---|---|---|
| `pos` | pos | One position (with `block`) |
| `block` | string | The block for `pos` |
| `blocks` | array | Many: [[x, y, z, block], ...] |
| `physics` | boolean | Let the world react (sand falls, water flows, redstone updates, unsupported torches pop). Default false: blocks stay exactly as placed. Tile blocks (chests, furnaces) work either way. |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { changed }.

```json
{"blocks":[[0,64,0,"stone"],[1,64,0,"oak_stairs[facing=east]"]]}
```

### `fill` (changes the world)

Fill a box (corners inclusive). Modes: fill, hollow (shell, inside air), outline (shell, inside kept), walls (sides only), frame (edges only). `replace` only changes blocks matching it.

| Parameter | Type | |
|---|---|---|
| `from` **required** | pos | One corner |
| `to` **required** | pos | The opposite corner |
| `block` **required** | string | A block: name (`stone`, `minecraft:stone`, `Stone Bricks`), raw meta (`oak_log:1`) or named states (`oak_stairs[facing=east,half=top]`, `furnace[facing=south]`, `oak_log[axis=x]`, `stone_slab[half=top]`, `oak_door[facing=north]` puts both halves, `red_bed[facing=east]` both parts, `torch[facing=up\|north..]`, `piston[facing=up]`). |
| `mode` | string | fill \| hollow \| outline \| walls \| frame (default fill) |
| `replace` | string | Only replace these: a block name, a comma list, or "solid" / "air" / "liquid" / "plants" |
| `physics` | boolean | Let the world react (sand falls, water flows, redstone updates, unsupported torches pop). Default false: blocks stay exactly as placed. Tile blocks (chests, furnaces) work either way. |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { changed, volume }.

```json
{"from":"~-5 ~-1 ~-5","to":"~5 ~-1 ~5","block":"smooth_stone"}
```

### `build` (changes the world)

Build a structure drawn as text: `layers` from the bottom up, each a list of rows from north to south, each character a block from `palette` going east. Space = leave as is, "." = air (unless the palette says otherwise). `read` gives regions back in this format. Facing states turn with `rotate`.

| Parameter | Type | |
|---|---|---|
| `origin` **required** | pos | Where the first character of the first row of the bottom layer goes (the north-west-bottom corner) |
| `layers` **required** | array | string[][] (or string[] with rows separated by newlines) |
| `palette` **required** | object | { "char": "block" } |
| `rotate` | number | Quarter turns clockwise seen from above (0-3); the footprint turns around the origin corner |
| `anchor` | string | corner (default) \| center (origin is the bottom-centre) |
| `physics` | boolean | Let the world react (sand falls, water flows, redstone updates, unsupported torches pop). Default false: blocks stay exactly as placed. Tile blocks (chests, furnaces) work either way. |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { changed, from, to }.

```json
{"origin":[10,64,10],"palette":{"#":"cobblestone","p":"oak_planks","d":"oak_door[facing=south]"},"layers":[["###","#p#","###"],["# #"," d ","# #"]]}
```

### `shape` (changes the world)

Solid or hollow shapes: sphere (radius or rx/ry/rz), dome (upper half), cylinder (radius, height, axis), cone and pyramid (radius/size, height), line (from, to, thickness), torus (radius, tube).

| Parameter | Type | |
|---|---|---|
| `kind` **required** | string | sphere \| dome \| cylinder \| cone \| pyramid \| line \| torus |
| `center` | pos | Centre (the base centre for cylinder, cone, pyramid, dome) |
| `from` | pos | line start |
| `to` | pos | line end |
| `radius` | number | Radius (pyramid: half the base side) |
| `rx` | number | Sphere radius along x |
| `ry` | number | along y |
| `rz` | number | along z |
| `height` | number | Height of cylinder, cone, pyramid |
| `axis` | string | cylinder/torus axis: y (default), x, z |
| `tube` | number | torus tube radius |
| `thickness` | number | line thickness (default 1) |
| `block` **required** | string | A block: name (`stone`, `minecraft:stone`, `Stone Bricks`), raw meta (`oak_log:1`) or named states (`oak_stairs[facing=east,half=top]`, `furnace[facing=south]`, `oak_log[axis=x]`, `stone_slab[half=top]`, `oak_door[facing=north]` puts both halves, `red_bed[facing=east]` both parts, `torch[facing=up\|north..]`, `piston[facing=up]`). |
| `hollow` | boolean | Only the shell (1 block thick) |
| `replace` | string | As in fill |
| `physics` | boolean | Let the world react (sand falls, water flows, redstone updates, unsupported torches pop). Default false: blocks stay exactly as placed. Tile blocks (chests, furnaces) work either way. |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { changed }.

```json
{"kind":"sphere","center":"~ ~10 ~","radius":6,"block":"glass","hollow":true}
```

### `clone` (changes the world)

Copy a box to another place (optionally turned).

| Parameter | Type | |
|---|---|---|
| `from` **required** | pos | Source corner |
| `to` **required** | pos | Opposite source corner |
| `dest` **required** | pos | Where the source's north-west-bottom corner goes |
| `rotate` | number | Quarter turns clockwise |
| `air` | boolean | Copy air too (default true) |
| `physics` | boolean | Let the world react (sand falls, water flows, redstone updates, unsupported torches pop). Default false: blocks stay exactly as placed. Tile blocks (chests, furnaces) work either way. |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { changed }.

### `read`

Read a box as text layers + palette (the same format `build` takes), bottom layer first. Big boxes: keep under ~40x40x40 to stay readable.

| Parameter | Type | |
|---|---|---|
| `from` **required** | pos | Corner |
| `to` **required** | pos | Opposite corner |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { origin, size: [w, h, d], palette, layers }.

### `container` (changes the world)

What a chest, furnace, hopper, dispenser... holds, optionally changing it.

| Parameter | Type | |
|---|---|---|
| `pos` **required** | pos | The container |
| `set` | object | { "slot": "item [count]" or null }, e.g. {"0": "diamond 64", "13": "golden_apple"} |
| `clear` | boolean | Empty it first |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { type, size, items: [{ slot, item, count }] }.

### `count`

How many of each block a box holds (most first): what an area is made of, how much ore, whether a build is complete.

| Parameter | Type | |
|---|---|---|
| `from` **required** | pos | Corner |
| `to` **required** | pos | Opposite corner |
| `states` | boolean | Count each state separately (stairs facing east vs west...) |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { volume, air, blocks: [{ block, count }] }.

### `undo` (changes the world)

Take back the last block changes made through this API (set, fill, build, shape, clone, undo-able commands do not count).

| Parameter | Type | |
|---|---|---|
| `steps` | number | How many changes (default 1) |

Returns { undone, restored }.

### `history`

The changes `undo` can take back, newest first.

Returns [{ step, what, blocks, at }].

## Looking

### `map`

A top-down text map: each character is the highest block of a column (legend included), `@` the player. Optional height digits. Use it to find flat ground, water, trees, builds.

| Parameter | Type | |
|---|---|---|
| `center` | pos | Middle (default: the player) |
| `radius` | number | Blocks each way (default 24, max 96) |
| `scale` | number | Blocks per character (default 1) |
| `heights` | boolean | Also a map of surface heights (last digit of y, with a base) |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { x0, z0, x1, z1, rows, legend, heights? }.

### `slice`

A vertical cut through the world as text (rows top to bottom): what you would see from the side. Give a box one block thick in x or z.

| Parameter | Type | |
|---|---|---|
| `from` **required** | pos | Corner |
| `to` **required** | pos | Opposite corner |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { axis, rows, legend }.

### `find`

Find blocks by name (or "ore", "log", "water"...) near a point, nearest first.

| Parameter | Type | |
|---|---|---|
| `block` **required** | string | Name, comma list, or a word contained in names |
| `center` | pos | Default: the player |
| `radius` | number | Default 32 (max 96) |
| `limit` | number | Default 20 |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns [{ pos, block, dist }].

### `surface`

Ground height (top solid block, ignoring trees) at columns, to stand builds on.

| Parameter | Type | |
|---|---|---|
| `at` **required** | array | Columns: [[x, z], ...] (or one [x, z]) |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns [{ x, z, y, block }].

### `shot`

A picture of the game. Views: "player" (what the player sees), "camera" (from `pos` looking at `lookAt`, or yaw/pitch), "orbit" (looking at `center` from its `side`, `pitch` degrees down, `distance` away), "iso" (flat isometric view of `center`, `size` blocks across), "top" (flat, straight down, north up). Areas far from the player are loaded and drawn first.

| Parameter | Type | |
|---|---|---|
| `view` | string | player \| camera \| orbit \| iso \| top (default player) |
| `pos` | pos | camera: where the camera is |
| `lookAt` | pos | camera: what it looks at |
| `yaw` | number | camera: degrees (0 = south, 90 = west, 180 = north, 270 = east) |
| `pitch` | number | Degrees down (camera, orbit, iso) |
| `center` | pos | orbit/iso/top: the middle of the picture |
| `side` | string | orbit/iso: which side of the centre the camera is on: n, ne, e, se (default), s, sw, w, nw |
| `cut` | number | top: hide everything above this y (a floor plan of a building, a cave level) |
| `depth` | number | top with cut: how far below the cut to show (default 24) |
| `distance` | number | orbit: blocks from centre (default 24) |
| `size` | number | iso/top: blocks shown across (default 48) |
| `grid` | number | Draw a coordinate grid every this many blocks (e.g. 8), with x,z labels, at height `gridY` (default: the centre's y) — to tell where things in the picture are |
| `gridY` | number | Height of the grid |
| `fov` | number | Field of view (default 70) |
| `width` | number | Picture width in pixels (default 960) |
| `format` | string | jpeg (default) \| png |
| `hud` | boolean | Include the HUD (player view only) |
| `mark` | boolean | Draw markers (default true) |

Returns { mime, data (base64), width, height }.

### `mark`

Outline a box in the world for the people playing (and pictures) to see: a plot, a problem, the next step. Stays until removed or `ttl` runs out.

| Parameter | Type | |
|---|---|---|
| `from` **required** | pos | Corner |
| `to` | pos | Opposite corner (default: same block) |
| `color` | string | #rrggbb (default yellow) |
| `label` | string | Text shown above it |
| `id` | string | Name to replace or remove it later |
| `ttl` | number | Seconds (default: forever) |

Returns { id }.

### `unmark`

Remove markers (one by id, or all).

| Parameter | Type | |
|---|---|---|
| `id` | string | Marker id; omit for all |

Returns { removed }.

## Entities

### `entities`

Mobs, players, items, vehicles near a point.

| Parameter | Type | |
|---|---|---|
| `center` | pos | Default: the player |
| `radius` | number | Default 32 |
| `type` | string | Only this type (zombie, item, player, overseer:unit...) |
| `limit` | number | Default 50 |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns [{ id, type, name?, pos, health?, dist, ... }].

### `entity` (changes the world)

One entity in detail, optionally changing fields (pos, health, name, noAi, yaw, any field the entity has).

| Parameter | Type | |
|---|---|---|
| `id` **required** | number | Entity id |
| `set` | object | Fields to change, e.g. {"pos": [0,70,0], "health": 20, "noAi": true} |

Returns The entity's fields.

### `spawn` (changes the world)

Create mobs or other entities (types: zombie, skeleton, creeper, spider, pig, cow, sheep, chicken, villager, wolf, horse, enderman, slime, blaze, boat, minecart, item, mods' `mod:name`).

| Parameter | Type | |
|---|---|---|
| `type` **required** | string | Entity type |
| `pos` | pos | Where (default: in front of the player) |
| `count` | number | How many (default 1, max 100) |
| `data` | object | Fields to set on each (e.g. {"baby": true}); items: {"item": "diamond", "count": 3} |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { ids }.

### `kill` (changes the world)

Remove entities: by id, or by type within a radius. Players are never removed.

| Parameter | Type | |
|---|---|---|
| `id` | number | One entity |
| `ids` | array | Several |
| `type` | string | All of a type ("hostile", "item", "zombie"...) |
| `center` | pos | With type: around here |
| `radius` | number | With type (default 32) |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { removed }.

## The player

### `player`

The player in detail: position, look, health, food, xp, effects, inventory and armour.

Returns { ... , inventory: [{ slot, item, count }], armor }.

### `tp` (changes the world)

Move the player (and optionally turn them).

| Parameter | Type | |
|---|---|---|
| `pos` **required** | pos | Where (feet) |
| `yaw` | number | Degrees |
| `pitch` | number | Degrees |
| `lookAt` | pos | Turn to face this |
| `dim` | string | overworld \| nether \| end (default: the player's dimension; it must be loaded) |

Returns { pos }.

### `face`

Turn the player to look at a point or direction.

| Parameter | Type | |
|---|---|---|
| `at` | pos | Point to look at |
| `yaw` | number | Degrees |
| `pitch` | number | Degrees |

Returns { yaw, pitch, lookingAt }.

### `inventory` (changes the world)

Read or change the player's inventory (slots 0-8 hotbar, 9-35 storage).

| Parameter | Type | |
|---|---|---|
| `set` | object | { "slot": "item [count]" or null }, e.g. {"0": "diamond_sword", "1": "torch 64"} |
| `select` | number | Hotbar slot to hold |
| `clear` | boolean | Empty it first |

Returns { selected, slots, armor }.

### `walk` (changes the world)

Walk the player to a place on foot (path finding, jumping up steps), as if the movement keys were pressed. The game must be running (`resume` if a menu is open).

| Parameter | Type | |
|---|---|---|
| `to` **required** | pos | Where to go (a block to stand in) |
| `sprint` | boolean | Sprint |
| `timeout` | number | Seconds to give up after (default from the path length) |

Returns { arrived, pos, steps, note? }.

### `act` (changes the world)

Do what the player would do with the held item, as a survival player would (drops, tool wear, sounds): break a block, use or place on a block face, attack or use an entity.

| Parameter | Type | |
|---|---|---|
| `action` **required** | string | break \| use (right-click a block face: place, open, flip) \| attack \| interact (right-click an entity) \| useItem (eat, throw, shoot...) |
| `pos` | pos | The block |
| `face` | string | Face clicked: up, down, north, south, east, west (default up) |
| `id` | number | Entity id for attack / interact |

Returns { ok, ... }.

## Code

### `eval` (changes the world)

Run JavaScript inside the game tab: an expression, or an async function body that `return`s its answer. In scope: game (the client), server (the simulation), sp, player, world, dim, mc (BLOCKS, ITEMS, B, I, blockByName, itemByName, pack, idOf, metaOf...), api (every method here as a function: await api.fill({...})), block (name -> packed), name (packed -> name), sim(fn) (run fn(server, player) as the player), print(...) (collected into `printed`).

| Parameter | Type | |
|---|---|---|
| `code` **required** | string | JavaScript |
| `args` | any | Passed as `args` |

Returns { result, printed }.

```json
{"code":"return world.getId(0, 64, 0)"}
```

### `task` (changes the world)

Keep running code every few game ticks (animations, machines, behaviours) until stopped. The code is a function body run inside the simulation with the names eval has (server, player, world, mc, block, name, api...) plus n (runs so far), state (an object kept between runs) and log(...) (to the log). Return "stop" to end it; an error stops it (see `tasks`).

| Parameter | Type | |
|---|---|---|
| `name` **required** | string | Its name (replaces one of the same name) |
| `code` | string | Function body; omit with stop |
| `every` | number | Ticks between runs (default 1; 20 ticks = 1 s) |
| `stop` | boolean | Stop it |
| `times` | number | Stop after this many runs |

Returns { tasks }.

### `tasks`

Running tasks.

Returns [{ name, every, runs, error? }].

### `wait`

Let the game run for a while (ticks or seconds), e.g. for crops, mobs or redstone to act.

| Parameter | Type | |
|---|---|---|
| `ticks` | number | Game ticks (20 per second) |
| `seconds` | number | Or seconds |

Returns { ticks }.

