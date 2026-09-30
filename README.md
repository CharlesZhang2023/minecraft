# Minecraft Web

A from-scratch recreation of Minecraft (Java Edition, roughly 1.8-era mechanics) that runs in the browser.
It uses raw WebGL2 and TypeScript, has no runtime dependencies, and ships no asset files. Textures, item sprites,
mob skins, the font, sounds and music are all generated procedurally at startup.

> Fan-made, non-commercial recreation. Not an official Minecraft product; not affiliated with Mojang or Microsoft.

## Running

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # single ~450 KB bundle in dist/ (worker inlined)
npm run preview
```

Click the game to capture the mouse. Worlds save automatically to IndexedDB.

## Features

**World**
- Infinite terrain made of 3D density noise with MC-style trilinear interpolation: continents, oceans,
  rivers, beaches, hills and mountains with overhangs.
- 17 biomes: plains, forest, flower forest, birch forest, taiga, snowy taiga and plains, desert, savanna,
  swamp, mountains, oceans, rivers and beaches. Grass and foliage colours blend between biomes.
- Classic worm caves and ravines (a port of the original carver), lava lakes deep underground, and ore veins
  (coal, iron, gold, redstone, lapis, diamond, emerald) plus granite, diorite and andesite blobs.
- Trees that cross chunk borders deterministically: oak, big oak, birch, spruce and pine. Also flowers, grass,
  ferns, cacti, sugar cane, pumpkins, lily pads, snow and ice.
- Dungeons with spawners and loot chests.
- **Villages** with a well, roads, houses, a smithy, a library, farms, lamp posts and villagers who trade.
- **The Nether**: netherrack caverns, a lava sea, glowstone, soul sand, quartz, fire and red fog. Obsidian
  portals of any valid size are detected and linked with the 8:1 coordinate scale. A destination portal is found
  or built for you.

**Rendering**
- Chunk meshes are built in Web Workers. Lighting is computed statelessly per 3×3 chunk neighbourhood (sky light
  plus block light flood fill), with smooth lighting, ambient occlusion and the Minecraft 1.8 lightmap
  (warm flickering torchlight).
- A texture array with mipmaps and animated water, lava, fire and portal textures. Fancy cutout leaves and
  translucent water and ice.
- Day and night cycle with sunrise glow, a square sun, moon phases and stars. Fancy 3D clouds, rain and snow,
  thunder flashes, and fog that blends into the sky.
- Entity models use Minecraft's box-UV skin layout and vanilla animations. The first-person hand and held items
  use the 1.8 transforms. Also view bobbing, F5 third person, entity shadows, armor layers and block-break cracks
  and particles.

**Gameplay**
- Vanilla movement physics: walking, sprinting, sneaking with edge protection, jumping, swimming, ladders and
  creative flight.
- Survival mode with health, hunger and saturation, fall, drowning, lava, fire and cactus damage, XP, and death
  and respawn. Hardcore mode is also available.
- Mining uses the real hardness and tool formula with harvest levels and tool durability.
- Placement rules for logs, stairs, slabs, torches, ladders, doors, beds, chests and furnaces.
- More than 150 crafting recipes (shaped, shapeless and mirrored), furnace smelting, chests, beds and sleeping,
  farming (hoe, seeds, crop growth, bone meal), buckets, flint and steel, TNT, a bow, snowballs, eggs and ender
  pearls.
- Block updates: flowing water and lava (the vanilla flow algorithm, infinite sources, obsidian and cobblestone
  generation), falling sand and gravel, leaf decay, grass spread, spreading fire, crop, cactus and sugar cane
  growth.
- Mobs with A* pathfinding:
  - Hostile: zombies (burn in daylight), skeletons (archers), creepers (they swell, then explode), spiders,
    endermen (stare aggro, teleporting, block stealing), slimes (split on death), ghasts (fireballs you can punch
    back) and zombie pigmen (group anger).
  - Passive: pigs, cows (milkable), sheep (shearable, eat grass) and chickens (lay eggs). Passive mobs breed and
    can be tempted with food.
- Rideable boats, 1.8-style achievements with popups, and chat commands.

**Interface**
- The title screen shows a live rotating panorama world, a stone logo and splash text. World select and create
  screens with seeds, game modes and hardcore. Options for FOV, render distance, brightness, sensitivity, GUI
  scale, clouds, particles and volume.
- Survival inventory with 2×2 crafting and a live player preview, a crafting table, a furnace, chests, and a
  tabbed, searchable creative inventory.
- Vanilla slot semantics: split stacks, place one item, drag-distribute, shift-click, double-click collect,
  number-key swap and Q drop.
- HUD: hearts, hunger, armor and air bars, XP bar, a hotbar with pickup animation, an F3 debug screen, chat,
  F2 screenshots and F1 to hide the HUD.
- Synthesized sound effects: per-material digging and footsteps, mob voices, explosions, fizzes and portals.
  Generative ambient piano music.

## Controls

| Action | Key |
|---|---|
| Move / jump / sneak / sprint | WASD / Space / Shift / Ctrl or double-tap W |
| Break · place/use · pick block | Left · Right · Middle mouse |
| Hotbar | 1–9, mouse wheel |
| Inventory · drop (stack) | E · Q (Ctrl+Q) |
| Chat · command | T · / |
| Fly (creative) | Double-tap Space |
| Perspective · debug · hide HUD · screenshot | F5 · F3 · F1 · F2 |

**Commands:** `/gamemode`, `/time set|add`, `/weather`, `/tp`, `/give`, `/summon`, `/kill`, `/difficulty`, `/seed`,
`/spawnpoint`, `/setblock`, `/fill`, `/clear`, `/xp`, `/gamerule doDaylightCycle`, `/heal`, `/help`.

## Architecture

```
src/world    blocks registry, worldgen (overworld, nether, villages), mesher + lighting (worker), chunk streaming
src/render   WebGL2 renderer, shaders, texture array, procedural textures & sprites, entity models & renderer
src/game     game loop (20 TPS), player, interaction, block ticks, items, recipes, audio synth, storage, portals
src/entity   entity physics (vanilla collision), living entities, mobs & AI, pathfinding, spawning, boats
src/ui       bitmap font, GUI primitives, isometric item icons, HUD, menus, containers, trading
tools/       headless Playwright scenario runner used for visual regression screenshots
```
