---
name: minecraft-world
description: Look at and change the world of this repository's Minecraft game while it runs - build structures, edit terrain, run commands, spawn mobs, take pictures, follow chat, script behaviour. Use when asked to build, show, inspect, test or play something in the game world (not to edit the game's source code).
---

# Working in the game world

The game runs in a browser tab served by the Vite dev server; the agent harness (`tools/agent/`, docs in
`tools/agent/README.md`, every method in `tools/agent/API.md`) reaches into that tab.

## Connecting

- With the `minecraft` MCP server enabled, use its tools: `status`, `look` (pictures come back as images), `map`,
  `build`, `fill`, `set`, `shape`, `read`, `command`, `entities`, `undo`, `log`, `eval`, and `call` for any other method.
- Otherwise use the CLI with Bash: `node tools/agent/mc.mjs <method> ...` (`mc help`, `mc help <method>`). Pictures
  are saved to files (the path is printed): look at them with the Read tool.
- `status` first. If nothing is connected and the person wants their own game on https://mc.iloveust.com, use
  `online` (MCP) / `node tools/agent/mc.mjs online` and give them the link it prints to open (or they paste it in Options > More... > Agent); their tab then connects
  to this computer. For a world of your own, `launch` (MCP) / `node tools/agent/mc.mjs launch --new mode=creative`
  opens a headless browser. When the person has the game open, the tools act on their world
  as the host: say what you are about to do, mark areas (`mark`), keep changes undoable, and don't move their player
  (`tp`) or switch their world (`open`) unless asked. Tests and scripts must pick their own tab by name
  (`?agent=<name>`), never "any tab on the site".
- Several dev servers can run (the person's and test ones): `sessions` lists the tabs; set `MC_PORT` to pick a server.

## Coordinates

x grows east, z grows south, y up (0-255, sea level 63). `~` is relative to the player (`"~ ~-1 ~5"`).
`map` prints a top-down text map with rulers (north up, rows labelled with z), `slice` a side view; use them to find
ground and free space. `call surface` gives ground heights. Build on the ground's y + 1.

## Building well

1. Look first: `status`, `map` (radius 24-48, `heights=true` for terrain), a `look` with `view=iso` or `view=orbit`.
2. Pick a spot; clear it if needed (`fill ... air`, or `fill ... grass_block` to flatten; trees: `replace=plants`
   or fill air above the ground).
3. Build with `build` blueprints (layers bottom-up, rows north→south, characters west→east; `.` = air, space =
   leave as is) for detailed parts, `fill` (modes hollow/walls/outline/frame) for big boxes, `shape` for round things.
   Use block states for stairs/doors/logs (`oak_stairs[facing=east,half=top]`, `oak_door[facing=south]`).
4. Check every stage with a picture (`view=orbit center=... distance=... side=sw|se|ne|nw`, `view=top cut=<y>` for a
   floor plan) and `read` for exact blocks. Fix what looks wrong; `undo` takes back whole steps.
5. Light it (torches/glowstone/lanterns) so mobs don't spawn inside, and tell the person in chat (`call chat`).

Blocks: `call catalog kind=blocks filter=...` lists names; unknown names fail with suggestions. Writes don't trigger
physics unless `physics=true` (needed for redstone to update, water/lava to flow, sand to fall).

## Beyond blocks

- `command` runs any game command as the host (`/time set day`, `/weather clear`, `/give`, `/effect`, `/gamemode`).
- `call spawn` / `entities` / `call entity` (set fields, e.g. `noAi`) / `call kill` manage mobs.
- `call act` does what the player would (break with drops, use/place on a face, attack); `call inventory` edits it.
- `eval` runs JavaScript in the game tab (`world`, `server`, `player`, `mc`, `block()`, `api.<method>()`);
  `call task` keeps code running every few ticks (animations, machines). Prefer API methods for block changes so
  they can be undone.
- `log` (with `since` and `wait`) follows chat, blocks players change, deaths, joins: use it to react to the people
  playing.
