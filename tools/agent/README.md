# Agent harness

Programs on this computer, and AI agents like Claude Code, can look at the game and change it: read and write
blocks, build from text blueprints, run commands, spawn and steer entities, act as the player, take pictures from
anywhere, follow chat and events, and run JavaScript inside the game. Three ways in, one API underneath:

| | |
|---|---|
| **MCP** (`tools/agent/mcp.mjs`) | Tools for AI agents. Registered for Claude Code in [`.mcp.json`](../../.mcp.json): `look` returns pictures, `map` text maps, `build` takes blueprints, `call` reaches every method. |
| **`mc` command** (`tools/agent/mc.mjs`) | The same from a terminal: `node tools/agent/mc.mjs status` (or `npm run mc -- status`). |
| **Node** (`tools/agent/client.mjs`) | `const mc = await connect(); await mc.fill({...})` for scripts. |

The full method list is in [API.md](API.md) (generated from [`src/agent/spec.ts`](../../src/agent/spec.ts)).

## Your game on mc.iloveust.com

```sh
node tools/agent/mc.mjs online          # starts the bridge on this computer, prints a link like
                                        #   https://mc.iloveust.com/#agent=<token>
```

Open that link in Chrome or Edge (the tab you play in). Once the top right shows a green **Agent**, `mc` and Claude
Code's `minecraft` tools act on the world in that tab: open or create worlds, build, take pictures, chat. With Claude
Code, the MCP tool `online` does the same and hands you the link.

- **Nothing runs on the game's server.** The tab connects *out* to `ws://127.0.0.1:47821` on your own computer; the
  site only serves the (static) agent code, which is fetched only when a tab is opened with a pairing link.
- The bridge listens on 127.0.0.1 only, accepts game tabs only from `https://mc.iloveust.com` (and localhost) that
  show the pairing token, and accepts requests only from local programs with its API token.
- The link's token is never sent to the server (it's in the `#` part) and is removed from the address bar. The tab
  stays paired across reloads until it's closed; `#agent=off` unpairs it. `mc online rotate` makes a new token (old
  links stop working), `mc online stop` stops the bridge.
- `--port` and `--site` pick another port or address (e.g. a self-hosted copy).
- Chrome may ask whether the site may "access other apps and services on this device": allow it.

## How it fits together

```
mc / MCP server / script ──HTTP──▶ dev server: bridge plugin ──Vite's WebSocket──▶ game tab: src/agent ──▶ the world
     (tools/agent)          │      (tools/agent/bridge.ts)                          (runs the simulation)
                            └────▶ mc online: local bridge ◀──ws://127.0.0.1── the deployed game, paired by link
                                   (tools/agent/online.mjs)
```

- **The game tab does the work.** In single-player (and when hosting) the simulation runs in the page, so the agent
  code there (`src/agent/`) changes the world directly, as the host player: changes reach other players like any
  host's. A tab that joined someone else's world can only look (`status`, `shot` of what it has loaded, `log`,
  `eval`).
- **The bridge** is a Vite plugin of the dev server. Every game tab it serves says hello over Vite's own hot-reload
  WebSocket and becomes a *session*; requests go to the session asked for, or to the one most likely being
  watched (an open world, hosted, focused, visible).
- **Dev server or pairing link only.** The plugin runs only in `vite` (serve); a built game loads `src/agent` (its own
  chunk) only when opened with a pairing link from `mc online`.
- **Local only.** Requests must come from this computer (loopback), carry a token the plugin writes to
  `node_modules/.mc-agent/<port>.json` (mode 600), and have no `Origin` header, so a web page can't reach the game
  through it.

## Getting a session

Either open the game from the dev server in a browser (`npm run dev`, then the page): that tab is a session, and an
agent works in the world you're looking at. Or let the agent have its own:

```sh
node tools/agent/mc.mjs launch               # a dev server if none runs + a headless browser, session "agent"
node tools/agent/mc.mjs launch bob --new seed=42 mode=creative name="Bob's world"
node tools/agent/mc.mjs launch --headed      # the same, in a visible window
node tools/agent/mc.mjs launch --mods overseer,wands
node tools/agent/mc.mjs sessions             # what's connected (* = the one `mc` talks to)
node tools/agent/mc.mjs use <id>             # talk to that one from now on (`use` alone: choose automatically)
node tools/agent/mc.mjs stop [name]          # close background browsers
```

A background browser keeps its own profile (worlds, mods) in `node_modules/.mc-agent/profile-<name>`. When the
dev server reloads the page (code changed), an agent's tab opens its world again by itself.

Background tabs: browsers stop animation frames in hidden tabs, so while requests are being answered the game is
stepped from a worker timer instead (`awake on=true` keeps it running between requests). A paused game (menu open)
still loads areas the agent asks for; `resume` closes the menu.

## The `mc` command

```sh
mc status                                    # world, player, time, what's open
mc map 32                                    # top-down text map, 32 blocks around the player
mc map center=100,64,-40 radius=48 scale=2 heights=true
mc slice 0 50 10 40 90 10                    # a side view (a box one block thick)
mc shot                                      # what the player sees -> output/agent/shot-....jpg
mc shot view=orbit center=10,70,10 distance=30 side=sw  out.png
mc shot view=iso center=10,70,10 size=40     # flat isometric
mc shot view=top center=10,70,10 size=32 cut=71   # a floor plan: nothing above y 71 (depth=24 below it)
mc shot view=iso center=10,70,10 grid=8      # with a labelled x,z grid every 8 blocks (and a north arrow)
mc block 10 64 10                            # one block, its state, light, biome, contents
mc fill ~-5 ~-1 ~-5 ~5 ~-1 ~5 smooth_stone   # ~ = relative to the player
mc fill 0 64 0 10 70 10 stone_bricks mode=hollow
mc set 3 65 0 'oak_stairs[facing=east,half=top]'
mc shape sphere center=0,90,0 radius=8 block=glass hollow=true
mc build house.json origin=20,64,20 rotate=1   # a text blueprint (see below)
mc read 20 64 20 30 70 30 house.json         # a box as a blueprint (prints it, saves it)
mc count 0 0 0 15 64 15                      # what a box is made of
mc container 4 64 2 set='{"0":"diamond 5"}'  # a chest's contents
mc clone 20 64 20 30 70 30 dest=50,64,20 rotate=2
mc undo 2                                    # take back the last two changes
mc cmd "/time set night"                     # any game command, as the host
mc say "Building the bridge now"             # into the game's chat, as <Claude>
mc log --follow                              # chat, blocks players change, deaths, joins...
mc spawn villager pos=10,65,10 count=3 data='{"noAi":true}'
mc entities 20 type=hostile
mc tp 0 80 0 lookAt=10,64,10
mc act break 4 64 2                          # as the player (survival drops, tool wear)
mc walk 30 64 12                             # walk there on foot (path finding)
mc eval 'world.getId(0, 64, 0)'              # JavaScript in the game tab
mc eval -f script.js
mc task spin 'world.set(0, 90, 0, block(n % 2 ? "glowstone" : "stone"))' every=10
mc help fill                                 # one method in detail
```

Arguments are `key=value` (values are JSON when they look like it) or, for common methods, plain words in order
(`mc fill x y z x y z block mode`). `--json` prints raw answers; `--session <id>` picks a tab; environment `MC_PORT`
or `MC_URL` picks a dev server when several run.

## Blocks

Names are the game's (`mc catalog blocks filter=stairs`): `stone`, `oak_planks`, `minecraft:glass`, display names
work too (`"Stone Bricks"`). States: `name:meta` for the raw value, or named properties:

| Blocks | Properties |
|---|---|
| stairs | `facing` (north/east/south/west: the side the tall back is on), `half` (bottom/top) |
| slabs | `half` (bottom/top) |
| logs | `axis` (y/x/z) |
| furnaces, chests, pumpkins, crafting tables | `facing` (where the front looks) |
| doors | `facing`, `half` (lower/upper), `open`; putting a lower half adds the upper one |
| beds | `facing` (toward the head), `part` (foot/head); putting the foot adds the head |
| torches, levers, buttons | `facing` (up, or the direction it points away from its wall), `powered` |
| ladders | `facing` (away from the wall) |
| repeaters, comparators | `facing` (the way the signal goes) |
| pistons, dispensers, droppers, observers, hoppers | `facing` (down/up/north/south/west/east) |
| leaves | `persistent` (placed leaves don't decay unless false) |

Unknown names fail with suggestions. Writes don't set off physics unless `physics=true` (sand stays up, water stays
still, redstone isn't updated); containers get their contents either way.

## Text blueprints

`build` takes, and `read` gives, a structure as text: `layers` from the bottom up, each a list of rows from north to
south, each character a block going east, and a `palette`. A space leaves the world's block, `.` is air.

```json
{
  "palette": { "#": "cobblestone", "p": "oak_planks", "d": "oak_door[facing=south]", "g": "glass_pane",
               "s": "oak_stairs[facing=north]", "S": "oak_stairs[facing=south]" },
  "layers": [
    ["#####", "#####", "#####", "#####"],
    ["#ppp#", "#...#", "#...#", "##d##"],
    ["#ppp#", "g...g", "#...#", "##.##"],
    ["#ppp#", "#...#", "#...#", "#####"],
    ["sssss", "ppppp", "ppppp", "SSSSS"]
  ]
}
```

`rotate` turns it clockwise (seen from above) in quarter turns, facing states included; `anchor=center` puts the
origin at the bottom centre instead of the north-west-bottom corner.

## Code in the game

`eval` runs JavaScript in the game tab: an expression, or a function body that `return`s. In scope: `game` (the
client), `server` (the simulation), `player`, `world` (the player's dimension), `dim`, `sp` (the player's
connection), `mc` (`BLOCKS`, `ITEMS`, `B`, `I`, `blockByName`, `itemByName`, `pack`, `idOf`, `metaOf`...),
`block("name")` → packed block, `name(v)` → its name, `api.<method>(params)` (every method above), `sim(fn)` (run
inside the simulation as the player), `print(...)`.

`task` keeps code running every few ticks (with the same names plus `n`, `state` and `log`): animations, machines,
creatures with behaviour. `world.set` there is raw (no undo, no physics suppression).

## Node

```js
import { connect } from './tools/agent/client.mjs';
const mc = await connect();                       // MC_PORT / MC_SESSION apply
const { player } = await mc.status();
await mc.build({ origin: player.block, palette: { '#': 'stone' }, layers: [['###']] });
const pic = await mc.shot({ view: 'iso', size: 30 });   // { mime, data (base64), width, height }
```

`launch()` and `ensureServer()` in `launch.mjs` start a background browser and a dev server.

## Files

| File | |
|---|---|
| `src/agent/spec.ts` | The method catalogue (read by the tab, `mc` and the MCP server). |
| `src/agent/index.ts` | The tab's connection: hello, requests, the worker timer for background tabs, reopening after reloads. |
| `src/agent/agent.ts` | Who and where (the host player, dimensions, positions), loading areas, the undo journal, the event log. |
| `src/agent/world.ts` | Block reads and writes, blueprints, shapes, maps, slices, searches. |
| `src/agent/shots.ts` | Pictures from any camera, markers. |
| `src/agent/blockspec.ts` | Block names and states, rotation, palette characters. |
| `src/agent/methods.ts` | The method table: session, chat, entities, player, eval, tasks. |
| `tools/agent/bridge.ts` | The hub (sessions, requests, the local API) and the dev server plugin. |
| `tools/agent/online.mjs` | The standalone bridge for built games (`mc online`), with its small WebSocket server. |
| `tools/agent/client.mjs`, `mc.mjs`, `mcp.mjs`, `launch.mjs` | Node side. `api-doc.mjs` regenerates API.md. |

Engine pieces it added: `ServerPlayer.views` and `Client.views` (stream and draw places away from the player),
`Client.cameraOverride` and `Client.overlays`, `Camera.near` (cut views), `Interaction.initTile` / `useNow`,
`ServerPlayer.select`, `Client.steer` (walking the player), `Mob.noAi`, `drawLines(..., xray)`.

Tests: `shots/agent1.mjs` (background tab, pause, far areas, reload), `agent2.mjs` (the methods), `agent3.mjs` (two
players), `agent4.mjs <site>` (a tab paired with `mc online`), `agentlna.mjs` (the deployed site may reach the bridge).
