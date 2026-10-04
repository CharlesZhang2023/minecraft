# Overseer

A 2.5D strategy view inspired by [Reign of Nether](https://github.com/SoLegendary/reignofnether). Press **V** (or the
eye button on phones) and the camera rises into a flat, slanted, turnable view of the world. There are two ways to
play it:

- **God view**: no protagonist. Your body steps out of the world (it spectates, invisible, under the camera so the
  world loads where you look) and you rule a side: units gather food, wood and ore, put up buildings block by block,
  train more units and fight.
- **Hero view** (**Tab**): your own character, under the same camera. WASD walks relative to the screen, the
  character faces the pointer when you click, left button hits and mines, right button uses and places, the hotbar
  and inventory work as usual. Alt+click and Alt+right-click still select and order your units.

Leaving the god view puts your body back exactly where you left it (same place, game mode and flight), also after a
reload or a disconnect. Switching from god to hero does the same: the hero is where you parked them.

## Playing

1. Press **V**. Choose a side: **Villagers** or **Monsters**.
2. Place your town hall (the first one is free): it comes with three workers who build it.
3. Select workers (click, drag a box, or the *Idle workers* button) and right-click: a tree to chop wood, stone or
   ore to mine, a farm to tend, an animal to hunt, a building to build or repair. Loads go to the nearest town hall or
   stockpile.
4. The command card (bottom right) builds (*Build*), trains units from buildings, sets rally points.
5. Houses raise the population cap. Barracks and the range train soldiers; watchtowers shoot raiders.

### Desktop

| | God view | Hero view |
|---|---|---|
| Pan | WASD, arrows, screen edge, middle-drag | follows the hero |
| Zoom / turn | wheel, + -; Z X quarter turns, right-drag turns freely | same |
| Select | click, drag a box, Shift adds, double-click (or Ctrl) all of a kind | Alt+click, Alt+drag |
| Order | right-click (Shift queues) | Alt+right-click |
| Command card | its letter keys (Q E R T / F G C B) | |
| Groups | Ctrl+1..9 set, 1..9 recall (twice: look there) | |
| Look at selection | Space / Home | |
| Help | Shift+H or the ? button | same |
| Leave | V, or Exit | V, or Exit |

### Phones

God view: drag pans, pinch zooms and turns, a tap on a unit selects it (tap again: all of its kind on screen),
hold and drag box-selects, a tap elsewhere with units selected orders them (move, gather, build, attack). Building:
tap where it goes, then *Build* (*Turn*, *Cancel*). Hero view keeps the movement pad, jump and hotbar; a tap hits a
mob or uses a block, a hold mines, a sideways drag turns the camera.

## The game

**Resources**: food (farms, hunting animals, melons and pumpkins), wood (logs: a worker fells a whole trunk) and ore
(stone 2, coal 5, iron 8, gold 10, diamond 20 per block). Workers carry 10 (wood 20) at a time. You start with 150
food, 200 wood and 50 ore.

**Units** (one entity type, `overseer:unit`, with a `kind`):

| Side | Kind | Health | Damage | Notes | Cost (food/wood/ore) | From |
|---|---|---|---|---|---|---|
| Villagers | Peasant | 15 | 1 | worker | 50/0/0 | Town Hall |
| | Militia | 30 | 4 | | 60/20/20 | Barracks |
| | Knight | 55 | 6 | iron armour, 2 population | 80/0/80 | Barracks |
| | Archer | 22 | 3 | range 14 | 40/50/0 | Archery Range |
| Monsters | Ghoul | 15 | 1 | worker | 50/0/0 | Mausoleum |
| | Zombie | 40 | 4 | slow | 60/20/0 | Graveyard |
| | Creeper | 20 | blast | blows up at its target, wrecks buildings | 50/0/60 | Graveyard |
| | Skeleton | 20 | 3 | range 14 | 40/50/0 | Spider Den |
| | Spider | 26 | 3 | fast, climbs | 60/30/0 | Spider Den |

**Buildings** (names per side; blueprints in `defs.ts`): Town Hall / Mausoleum (workers, drop-off, +10 population;
300 wood 100 ore after the first), House / Haunt (+10 population), Farm / Grave Plot (48 crops around a water
source), Stockpile / Hoard (drop-off), Barracks / Graveyard, Archery Range / Spider Den, Watchtower / Bone Spire
(arrows at enemies within 16). A building's health is the number of its blocks still standing: units knock blocks
off, creepers blow holes, and below a third it collapses. Workers repair it by building it again. New buildings
must be within 40 blocks of your others.

**Fighting**: soldiers attack enemies that come near (and come back to where they stood), workers flee when hit.
Vanilla monsters go after units. Raiders (nightly waves, if the host turns raids on, or `/overseer raid`) march on
town halls, fight on the way and break buildings; they burn in the morning. Players' units only fight each other
when the host turns that on.

**Host settings** (Mods > Overseer > Config): who may use the god view, players' units fighting each other, nightly
raids, and the toggle key.

**Command** `/overseer`: `god`, `hero`, `off` switch views; `res <food> <wood> <ore>` (host) sets your resources;
`raid` (host) sends raiders at your town hall; `reset` starts your side over.

## How it's built

| File | |
|---|---|
| `main.ts` | Wiring: settings, the channel, world data, events, the monster mixin, the command, the client's handlers. |
| `defs.ts` | Data only: factions, units, buildings and their blueprints (drawn with a small shape builder), palettes, team colours, what blocks give. Runs in workers too. |
| `place.ts` | Shared by server and client: a building's blocks in world coordinates, whether a cell is done, footprints, doors, and `checkPlace` (the client's ghost and the server's check agree). |
| `state.ts` | Saved state (`worldData`: each player's side and parked body, every building) and the messages. |
| `units.ts` | The unit entity: looks and numbers from its kind. Only what drawing needs is on the entity (it's replicated); orders live in `ai.ts`. |
| `ai.ts` | Orders and behaviour, run in each unit's server tick: walking (partial paths, retried), fighting (melee, arrows with gravity aim, creeper fuses), sieges, gathering, farming, building, taking loads home. |
| `server.ts` | `Overseer`: view modes and parking bodies, commands from clients (checked: units must be the sender's, coordinates finite, costs paid), construction, health and collapse, training, towers, raids, `keepLoaded` around towns, syncing state to clients. |
| `cam.ts` | The camera (focus, slant, turn, zoom), the ray through a screen point, a voxel ray walk, picking, projecting to the screen. |
| `ctl.ts` | The client: the two `ClientView`s, mouse/keyboard/touch input, selection, smart orders, placement, the command card. |
| `hud.ts` | Drawing: rings under units, ghosts, frames, markers and rally flags in the world; bars, panels, minimap, messages and help on the HUD. |

Engine features it relies on (documented in [../README.md](../README.md)): `mod.client.setView` with `Camera.ortho`,
`freePointer`, `move`, `aim`, `hud`, `touchPad` and `brightness`; `dim.keepLoaded`; mobs drawn in player `look`s with
`armorItems`; `mc.Arrow`.

**Network**: one channel, `rts`. Clients send `mode`, `faction`, `cmd` (unit ids and an order), `place`, `train`,
`untrain`, `rally`, `demolish` and `goto`; the server answers with `st` (your side, when it changes), `b` (the
buildings of your dimension, when they change), `msg` and `mode`. Units are ordinary entities and replicate
themselves.

**Adding a unit**: an entry in `UNITS` (looks from a model and a skin or player `look`, numbers, cost, a hotkey) and
its id in a building's `trains`. **Adding a building**: a blueprint function (layers of palette letters), an entry in
`BUILDINGS` and `BUILD_ORDER`, and palette letters per side if it needs new blocks.

Tests: `shots/ov1.mjs`-`ov9.mjs` (headless; `shots/ovlib.mjs` sets up a world with a finished town hall): looking down
and the first town hall, gathering/training/houses/hero/raids, combat, each mechanic on a flat arena (melee,
archers, creeper vs building, tower, hunting, mining, farming, monsters targeting units), hero mining and placing
and the parked body, phones, two players, saving and reloading, close-ups.
