// What the agent API offers: every method, its parameters and what it answers. Plain data, read by the game tab
// (src/agent), the `mc` command and the MCP server (tools/agent), so all three describe the same thing.
// Keep it to erasable TypeScript (Node loads this file directly).

export type ParamType = 'pos' | 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
export interface ParamSpec { type: ParamType; desc: string; required?: boolean }
export interface MethodSpec {
  group: string;
  summary: string;
  params: Record<string, ParamSpec>;
  returns: string;
  example?: Record<string, unknown>;
  /** Changes the world (refused for guests, recorded for undo when it sets blocks). */
  writes?: boolean;
}

const pos = (desc: string, required = false): ParamSpec => ({ type: 'pos', desc, required });
const BLOCK_DESC = 'A block: name (`stone`, `minecraft:stone`, `Stone Bricks`), raw meta (`oak_log:1`) or named states (`oak_stairs[facing=east,half=top]`, `furnace[facing=south]`, `oak_log[axis=x]`, `stone_slab[half=top]`, `oak_door[facing=north]` puts both halves, `red_bed[facing=east]` both parts, `torch[facing=up|north..]`, `piston[facing=up]`).';
const PHYSICS: ParamSpec = { type: 'boolean', desc: 'Let the world react (sand falls, water flows, redstone updates, unsupported torches pop). Default false: blocks stay exactly as placed. Tile blocks (chests, furnaces) work either way.' };
const DIM: ParamSpec = { type: 'string', desc: 'overworld | nether | end (default: the player\'s dimension; it must be loaded)' };

export const POS_HELP = 'Positions are [x, y, z] arrays, {x, y, z} objects or "x y z" strings; `~` is relative to the player ("~ ~-1 ~5"). x grows east, z grows south, y up (0-255, sea level 63).';

export const METHODS: Record<string, MethodSpec> = {
  // ---------------------------------------------------------------- session
  status: {
    group: 'session', summary: 'The world, the player, time, weather, other players, mods, and whether the game is paused.', params: {},
    returns: '{ world: {name, id, seed, mode, dimension, time, day, weather, paused}, player: {name, pos, yaw, pitch, facing, health, food, gameMode, held, lookingAt}, players, mods, session }',
  },
  help: {
    group: 'session', summary: 'This catalogue (or one method in detail).', params: { method: { type: 'string', desc: 'One method name' } },
    returns: '{ methods } or one method spec',
  },
  worlds: { group: 'session', summary: 'Saved worlds in this browser.', params: {}, returns: '[{ id, name, seed, mode, lastPlayed }]' },
  open: {
    group: 'session', summary: 'Open a saved world, or create a new one, and wait until the player stands in it.',
    params: {
      world: { type: 'string', desc: 'Id or name of a saved world' },
      new: { type: 'object', desc: '{ name?, seed?, mode?: "survival"|"creative"|0|1, time? } to create a world (default creative)' },
    },
    returns: '{ id, name, seed }', example: { new: { name: 'Agent build', seed: 42, mode: 'creative' } },
  },
  save: { group: 'session', summary: 'Save the world now (it also autosaves every minute).', params: {}, returns: '{ saved: true }' },
  resume: { group: 'session', summary: 'Close any open screen or pause menu so time runs again.', params: {}, returns: '{ paused }' },
  awake: {
    group: 'session', summary: 'Keep the game running while its tab is in the background (browsers stop hidden tabs). It always runs during a request.',
    params: { on: { type: 'boolean', desc: 'true to keep running', required: true } }, returns: '{ awake }',
  },

  // ---------------------------------------------------------------- commands and chat
  command: {
    group: 'chat', summary: 'Run game commands as the host (`/help` lists them: time, weather, give, summon, tp, gamemode, effect, enchant, gamerule, locate...). The slash is optional.',
    params: { cmd: { type: 'string', desc: 'One command' }, cmds: { type: 'array', desc: 'Several commands, run in order' } },
    returns: '{ output: string[] } (one list per command for `cmds`)', example: { cmd: '/time set day' }, writes: true,
  },
  chat: {
    group: 'chat', summary: 'Say something in the game\'s chat, under a name of your own, for everyone playing to read.',
    params: { msg: { type: 'string', desc: 'The message', required: true }, as: { type: 'string', desc: 'Name shown (default "Claude")' } },
    returns: '{ said }',
  },
  log: {
    group: 'chat', summary: 'What happened lately: chat lines, blocks players broke or placed, deaths, players joining and leaving, task errors. Use `since` with the last `cursor` to get only new events; `wait` waits for one.',
    params: {
      since: { type: 'number', desc: 'Only events after this cursor' },
      types: { type: 'array', desc: 'Only these: chat, place, break, death, join, leave, task, agent' },
      wait: { type: 'number', desc: 'Seconds to wait for something new (max 300)' },
      limit: { type: 'number', desc: 'At most this many (default 100, newest kept)' },
    },
    returns: '{ cursor, events: [{ seq, t (game tick), type, ... }] }',
  },

  // ---------------------------------------------------------------- blocks
  block: {
    group: 'blocks', summary: 'One block: its name and state, light, biome, and what a container holds.',
    params: { pos: pos('Where', true), dim: DIM }, returns: '{ pos, block, name, meta, state, solid, light: [sky, block], biome, tile? }',
  },
  set: {
    group: 'blocks', summary: 'Put blocks at exact positions. ' + BLOCK_DESC,
    params: {
      pos: pos('One position (with `block`)'), block: { type: 'string', desc: 'The block for `pos`' },
      blocks: { type: 'array', desc: 'Many: [[x, y, z, block], ...]' }, physics: PHYSICS, dim: DIM,
    },
    returns: '{ changed }', example: { blocks: [[0, 64, 0, 'stone'], [1, 64, 0, 'oak_stairs[facing=east]']] }, writes: true,
  },
  fill: {
    group: 'blocks', summary: 'Fill a box (corners inclusive). Modes: fill, hollow (shell, inside air), outline (shell, inside kept), walls (sides only), frame (edges only). `replace` only changes blocks matching it.',
    params: {
      from: pos('One corner', true), to: pos('The opposite corner', true), block: { type: 'string', desc: BLOCK_DESC, required: true },
      mode: { type: 'string', desc: 'fill | hollow | outline | walls | frame (default fill)' },
      replace: { type: 'string', desc: 'Only replace these: a block name, a comma list, or "solid" / "air" / "liquid" / "plants"' },
      physics: PHYSICS, dim: DIM,
    },
    returns: '{ changed, volume }', example: { from: '~-5 ~-1 ~-5', to: '~5 ~-1 ~5', block: 'smooth_stone' }, writes: true,
  },
  build: {
    group: 'blocks', summary: 'Build a structure drawn as text: `layers` from the bottom up, each a list of rows from north to south, each character a block from `palette` going east. Space = leave as is, "." = air (unless the palette says otherwise). `read` gives regions back in this format. Facing states turn with `rotate`.',
    params: {
      origin: pos('Where the first character of the first row of the bottom layer goes (the north-west-bottom corner)', true),
      layers: { type: 'array', desc: 'string[][] (or string[] with rows separated by newlines)', required: true },
      palette: { type: 'object', desc: '{ "char": "block" }', required: true },
      rotate: { type: 'number', desc: 'Quarter turns clockwise seen from above (0-3); the footprint turns around the origin corner' },
      anchor: { type: 'string', desc: 'corner (default) | center (origin is the bottom-centre)' },
      physics: PHYSICS, dim: DIM,
    },
    returns: '{ changed, from, to }',
    example: { origin: [10, 64, 10], palette: { '#': 'cobblestone', 'p': 'oak_planks', 'd': 'oak_door[facing=south]' }, layers: [['###', '#p#', '###'], ['# #', ' d ', '# #']] },
    writes: true,
  },
  shape: {
    group: 'blocks', summary: 'Solid or hollow shapes: sphere (radius or rx/ry/rz), dome (upper half), cylinder (radius, height, axis), cone and pyramid (radius/size, height), line (from, to, thickness), torus (radius, tube).',
    params: {
      kind: { type: 'string', desc: 'sphere | dome | cylinder | cone | pyramid | line | torus', required: true },
      center: pos('Centre (the base centre for cylinder, cone, pyramid, dome)'), from: pos('line start'), to: pos('line end'),
      radius: { type: 'number', desc: 'Radius (pyramid: half the base side)' }, rx: { type: 'number', desc: 'Sphere radius along x' }, ry: { type: 'number', desc: 'along y' }, rz: { type: 'number', desc: 'along z' },
      height: { type: 'number', desc: 'Height of cylinder, cone, pyramid' }, axis: { type: 'string', desc: 'cylinder/torus axis: y (default), x, z' },
      tube: { type: 'number', desc: 'torus tube radius' }, thickness: { type: 'number', desc: 'line thickness (default 1)' },
      block: { type: 'string', desc: BLOCK_DESC, required: true }, hollow: { type: 'boolean', desc: 'Only the shell (1 block thick)' },
      replace: { type: 'string', desc: 'As in fill' }, physics: PHYSICS, dim: DIM,
    },
    returns: '{ changed }', example: { kind: 'sphere', center: '~ ~10 ~', radius: 6, block: 'glass', hollow: true }, writes: true,
  },
  clone: {
    group: 'blocks', summary: 'Copy a box to another place (optionally turned).',
    params: {
      from: pos('Source corner', true), to: pos('Opposite source corner', true), dest: pos('Where the source\'s north-west-bottom corner goes', true),
      rotate: { type: 'number', desc: 'Quarter turns clockwise' }, air: { type: 'boolean', desc: 'Copy air too (default true)' }, physics: PHYSICS, dim: DIM,
    },
    returns: '{ changed }', writes: true,
  },
  read: {
    group: 'blocks', summary: 'Read a box as text layers + palette (the same format `build` takes), bottom layer first. Big boxes: keep under ~40x40x40 to stay readable.',
    params: { from: pos('Corner', true), to: pos('Opposite corner', true), dim: DIM },
    returns: '{ origin, size: [w, h, d], palette, layers }',
  },
  container: {
    group: 'blocks', summary: 'What a chest, furnace, hopper, dispenser... holds, optionally changing it.',
    params: { pos: pos('The container', true), set: { type: 'object', desc: '{ "slot": "item [count]" or null }, e.g. {"0": "diamond 64", "13": "golden_apple"}' }, clear: { type: 'boolean', desc: 'Empty it first' }, dim: DIM },
    returns: '{ type, size, items: [{ slot, item, count }] }', writes: true,
  },
  count: {
    group: 'blocks', summary: 'How many of each block a box holds (most first): what an area is made of, how much ore, whether a build is complete.',
    params: { from: pos('Corner', true), to: pos('Opposite corner', true), states: { type: 'boolean', desc: 'Count each state separately (stairs facing east vs west...)' }, dim: DIM },
    returns: '{ volume, air, blocks: [{ block, count }] }',
  },
  undo: {
    group: 'blocks', summary: 'Take back the last block changes made through this API (set, fill, build, shape, clone, undo-able commands do not count).',
    params: { steps: { type: 'number', desc: 'How many changes (default 1)' } }, returns: '{ undone, restored }', writes: true,
  },
  history: { group: 'blocks', summary: 'The changes `undo` can take back, newest first.', params: {}, returns: '[{ step, what, blocks, at }]' },

  // ---------------------------------------------------------------- looking
  map: {
    group: 'look', summary: 'A top-down text map: each character is the highest block of a column (legend included), `@` the player. Optional height digits. Use it to find flat ground, water, trees, builds.',
    params: {
      center: pos('Middle (default: the player)'), radius: { type: 'number', desc: 'Blocks each way (default 24, max 96)' },
      scale: { type: 'number', desc: 'Blocks per character (default 1)' }, heights: { type: 'boolean', desc: 'Also a map of surface heights (last digit of y, with a base)' },
      dim: DIM,
    },
    returns: '{ x0, z0, x1, z1, rows, legend, heights? }',
  },
  slice: {
    group: 'look', summary: 'A vertical cut through the world as text (rows top to bottom): what you would see from the side. Give a box one block thick in x or z.',
    params: { from: pos('Corner', true), to: pos('Opposite corner', true), dim: DIM }, returns: '{ axis, rows, legend }',
  },
  find: {
    group: 'look', summary: 'Find blocks by name (or "ore", "log", "water"...) near a point, nearest first.',
    params: { block: { type: 'string', desc: 'Name, comma list, or a word contained in names', required: true }, center: pos('Default: the player'), radius: { type: 'number', desc: 'Default 32 (max 96)' }, limit: { type: 'number', desc: 'Default 20' }, dim: DIM },
    returns: '[{ pos, block, dist }]',
  },
  surface: {
    group: 'look', summary: 'Ground height (top solid block, ignoring trees) at columns, to stand builds on.',
    params: { at: { type: 'array', desc: 'Columns: [[x, z], ...] (or one [x, z])', required: true }, dim: DIM }, returns: '[{ x, z, y, block }]',
  },
  shot: {
    group: 'look', summary: 'A picture of the game. Views: "player" (what the player sees), "camera" (from `pos` looking at `lookAt`, or yaw/pitch), "orbit" (looking at `center` from its `side`, `pitch` degrees down, `distance` away), "iso" (flat isometric view of `center`, `size` blocks across), "top" (flat, straight down, north up). Areas far from the player are loaded and drawn first.',
    params: {
      view: { type: 'string', desc: 'player | camera | orbit | iso | top (default player)' },
      pos: pos('camera: where the camera is'), lookAt: pos('camera: what it looks at'), yaw: { type: 'number', desc: 'camera: degrees (0 = south, 90 = west, 180 = north, 270 = east)' }, pitch: { type: 'number', desc: 'Degrees down (camera, orbit, iso)' },
      center: pos('orbit/iso/top: the middle of the picture'), side: { type: 'string', desc: 'orbit/iso: which side of the centre the camera is on: n, ne, e, se (default), s, sw, w, nw' },
      cut: { type: 'number', desc: 'top: hide everything above this y (a floor plan of a building, a cave level)' },
      depth: { type: 'number', desc: 'top with cut: how far below the cut to show (default 24)' },
      distance: { type: 'number', desc: 'orbit: blocks from centre (default 24)' }, size: { type: 'number', desc: 'iso/top: blocks shown across (default 48)' },
      grid: { type: 'number', desc: 'Draw a coordinate grid every this many blocks (e.g. 8), with x,z labels, at height `gridY` (default: the centre\'s y) — to tell where things in the picture are' },
      gridY: { type: 'number', desc: 'Height of the grid' },
      fov: { type: 'number', desc: 'Field of view (default 70)' }, width: { type: 'number', desc: 'Picture width in pixels (default 960)' },
      format: { type: 'string', desc: 'jpeg (default) | png' }, hud: { type: 'boolean', desc: 'Include the HUD (player view only)' }, mark: { type: 'boolean', desc: 'Draw markers (default true)' },
    },
    returns: '{ mime, data (base64), width, height }',
  },
  mark: {
    group: 'look', summary: 'Outline a box in the world for the people playing (and pictures) to see: a plot, a problem, the next step. Stays until removed or `ttl` runs out.',
    params: { from: pos('Corner', true), to: pos('Opposite corner (default: same block)'), color: { type: 'string', desc: '#rrggbb (default yellow)' }, label: { type: 'string', desc: 'Text shown above it' }, id: { type: 'string', desc: 'Name to replace or remove it later' }, ttl: { type: 'number', desc: 'Seconds (default: forever)' } },
    returns: '{ id }',
  },
  unmark: { group: 'look', summary: 'Remove markers (one by id, or all).', params: { id: { type: 'string', desc: 'Marker id; omit for all' } }, returns: '{ removed }' },

  // ---------------------------------------------------------------- entities
  entities: {
    group: 'entities', summary: 'Mobs, players, items, vehicles near a point.',
    params: { center: pos('Default: the player'), radius: { type: 'number', desc: 'Default 32' }, type: { type: 'string', desc: 'Only this type (zombie, item, player, overseer:unit...)' }, limit: { type: 'number', desc: 'Default 50' }, dim: DIM },
    returns: '[{ id, type, name?, pos, health?, dist, ... }]',
  },
  entity: {
    group: 'entities', summary: 'One entity in detail, optionally changing fields (pos, health, name, noAi, yaw, any field the entity has).',
    params: { id: { type: 'number', desc: 'Entity id', required: true }, set: { type: 'object', desc: 'Fields to change, e.g. {"pos": [0,70,0], "health": 20, "noAi": true}' } },
    returns: 'The entity\'s fields', writes: true,
  },
  spawn: {
    group: 'entities', summary: 'Create mobs or other entities (types: zombie, skeleton, creeper, spider, pig, cow, sheep, chicken, villager, wolf, horse, enderman, slime, blaze, boat, minecart, item, mods\' `mod:name`).',
    params: { type: { type: 'string', desc: 'Entity type', required: true }, pos: pos('Where (default: in front of the player)'), count: { type: 'number', desc: 'How many (default 1, max 100)' }, data: { type: 'object', desc: 'Fields to set on each (e.g. {"baby": true}); items: {"item": "diamond", "count": 3}' }, dim: DIM },
    returns: '{ ids }', writes: true,
  },
  kill: {
    group: 'entities', summary: 'Remove entities: by id, or by type within a radius. Players are never removed.',
    params: { id: { type: 'number', desc: 'One entity' }, ids: { type: 'array', desc: 'Several' }, type: { type: 'string', desc: 'All of a type ("hostile", "item", "zombie"...)' }, center: pos('With type: around here'), radius: { type: 'number', desc: 'With type (default 32)' }, dim: DIM },
    returns: '{ removed }', writes: true,
  },

  // ---------------------------------------------------------------- the player
  player: { group: 'player', summary: 'The player in detail: position, look, health, food, xp, effects, inventory and armour.', params: {}, returns: '{ ... , inventory: [{ slot, item, count }], armor }' },
  tp: {
    group: 'player', summary: 'Move the player (and optionally turn them).',
    params: { pos: pos('Where (feet)', true), yaw: { type: 'number', desc: 'Degrees' }, pitch: { type: 'number', desc: 'Degrees' }, lookAt: pos('Turn to face this'), dim: DIM },
    returns: '{ pos }', writes: true,
  },
  face: { group: 'player', summary: 'Turn the player to look at a point or direction.', params: { at: pos('Point to look at'), yaw: { type: 'number', desc: 'Degrees' }, pitch: { type: 'number', desc: 'Degrees' } }, returns: '{ yaw, pitch, lookingAt }' },
  inventory: {
    group: 'player', summary: 'Read or change the player\'s inventory (slots 0-8 hotbar, 9-35 storage).',
    params: { set: { type: 'object', desc: '{ "slot": "item [count]" or null }, e.g. {"0": "diamond_sword", "1": "torch 64"}' }, select: { type: 'number', desc: 'Hotbar slot to hold' }, clear: { type: 'boolean', desc: 'Empty it first' } },
    returns: '{ selected, slots, armor }', writes: true,
  },
  walk: {
    group: 'player', summary: 'Walk the player to a place on foot (path finding, jumping up steps), as if the movement keys were pressed. The game must be running (`resume` if a menu is open).',
    params: { to: pos('Where to go (a block to stand in)', true), sprint: { type: 'boolean', desc: 'Sprint' }, timeout: { type: 'number', desc: 'Seconds to give up after (default from the path length)' } },
    returns: '{ arrived, pos, steps, note? }', writes: true,
  },
  act: {
    group: 'player', summary: 'Do what the player would do with the held item, as a survival player would (drops, tool wear, sounds): break a block, use or place on a block face, attack or use an entity.',
    params: { action: { type: 'string', desc: 'break | use (right-click a block face: place, open, flip) | attack | interact (right-click an entity) | useItem (eat, throw, shoot...)', required: true }, pos: pos('The block'), face: { type: 'string', desc: 'Face clicked: up, down, north, south, east, west (default up)' }, id: { type: 'number', desc: 'Entity id for attack / interact' } },
    returns: '{ ok, ... }', writes: true,
  },

  // ---------------------------------------------------------------- programming
  eval: {
    group: 'code', summary: 'Run JavaScript inside the game tab: an expression, or an async function body that `return`s its answer. In scope: game (the client), server (the simulation), sp, player, world, dim, mc (BLOCKS, ITEMS, B, I, blockByName, itemByName, pack, idOf, metaOf...), api (every method here as a function: await api.fill({...})), block (name -> packed), name (packed -> name), sim(fn) (run fn(server, player) as the player), print(...) (collected into `printed`).',
    params: { code: { type: 'string', desc: 'JavaScript', required: true }, args: { type: 'any', desc: 'Passed as `args`' } },
    returns: '{ result, printed }', example: { code: 'return world.getId(0, 64, 0)' }, writes: true,
  },
  task: {
    group: 'code', summary: 'Keep running code every few game ticks (animations, machines, behaviours) until stopped. The code is a function body run inside the simulation with the names eval has (server, player, world, mc, block, name, api...) plus n (runs so far), state (an object kept between runs) and log(...) (to the log). Return "stop" to end it; an error stops it (see `tasks`).',
    params: { name: { type: 'string', desc: 'Its name (replaces one of the same name)', required: true }, code: { type: 'string', desc: 'Function body; omit with stop' }, every: { type: 'number', desc: 'Ticks between runs (default 1; 20 ticks = 1 s)' }, stop: { type: 'boolean', desc: 'Stop it' }, times: { type: 'number', desc: 'Stop after this many runs' } },
    returns: '{ tasks }', writes: true,
  },
  tasks: { group: 'code', summary: 'Running tasks.', params: {}, returns: '[{ name, every, runs, error? }]' },
  wait: { group: 'code', summary: 'Let the game run for a while (ticks or seconds), e.g. for crops, mobs or redstone to act.', params: { ticks: { type: 'number', desc: 'Game ticks (20 per second)' }, seconds: { type: 'number', desc: 'Or seconds' } }, returns: '{ ticks }' },

  // ---------------------------------------------------------------- catalogue
  catalog: {
    group: 'session', summary: 'Names of blocks, items, entities or biomes (filtered), to know what exists.',
    params: { kind: { type: 'string', desc: 'blocks | items | entities | biomes (default blocks)' }, filter: { type: 'string', desc: 'Substring to match' } },
    returns: 'string[]',
  },
};
