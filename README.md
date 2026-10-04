# Minecraft Web

A from-scratch recreation of Minecraft (Java Edition, roughly 1.8-era mechanics) that runs in the browser.
It uses raw WebGL2 and TypeScript, has no runtime dependencies, and ships no asset files. Textures, item sprites,
mob skins, the font, sounds and music are all generated procedurally at startup.

> Fan-made, non-commercial recreation. Not an official Minecraft product; not affiliated with Mojang or Microsoft.

## Play online

**[Play Minecraft Web](https://mc.iloveust.com/)**

Open the link in a desktop browser with WebGL2 support. Worlds are saved locally in your browser.

## Running

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # production build in dist/ (worker inlined)
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
- **Redstone**: dust that carries signal strength (15 down to 1, with step up/down), levers, buttons, pressure plates,
  redstone torches acting as delayed inverters, lamps and redstone blocks. It can power doors and ignite TNT.
- **Enchanting**: an enchanting table powered by nearby bookshelves, with the 1.8 cost formula and lapis.
  Enchantments show a glint and have real effects: Efficiency, Unbreaking, Fortune, Sharpness, Knockback,
  Fire Aspect, Power, Punch, Flame, Infinity, Protection and Feather Falling.
- **Redstone devices**: repeaters (delay, locking), comparators (compare/subtract, container reading), observers,
  pistons and sticky pistons (12-block push limit, slime-block chains, moving-block animation), dispensers, droppers,
  hoppers, slime blocks (bounce) and torch burnout, built on vanilla weak/strong power rules.
- **Brewing and potions**: brewing stand with blaze-powder fuel, nether wart, 30+ potion types (extended, strengthened,
  splash), status effects with HUD icons, particles and night vision. Blazes and Nether fortresses supply the ingredients.
- **Anvils and books**: enchanted books (loot, librarians, enchanting table), anvil combining, repair and renaming,
  plus 25 enchantments including Silk Touch, Looting, Respiration and Depth Strider.
- **Creative**: 1.8-style tabs (Redstone, Transportation, Brewing, ...), spawn eggs for 17 mobs, `/effect` and `/enchant`.
- **Fishing**: the bobber waits, then bubbles approach and the fish bites. Loot is fish, junk or treasure, and cod
  and salmon can be cooked.
- Mobs with A* pathfinding:
  - Hostile: zombies (burn in daylight), skeletons (archers), creepers (they swell, then explode), spiders,
    endermen (stare aggro, teleporting, block stealing), slimes (split on death), ghasts (fireballs you can punch
    back) and zombie pigmen (group anger).
  - Passive: pigs, cows (milkable), sheep (shearable, eat grass) and chickens (lay eggs). Passive mobs breed and
    can be tempted with food.
  - Tameable wolves: feed them bones, then they sit, follow, teleport to you and defend you. Wild packs turn
    angry when attacked.
  - Ambient: squid in oceans and bats in caves. Villagers have professions and trade.
- **The End**: find a stronghold (underground stone-brick complexes on rings around the origin, with libraries,
  prison cells, fountains and loot chests) and throw Eyes of Ender (blaze powder + ender pearl) to track one
  down; `/locate stronghold` also works. Slot eyes into the twelve portal frames in the portal room (lava well,
  silverfish spawner) to open the End portal.
  - A floating end-stone island under a purple void sky, ten obsidian pillars topped with End Crystals (three
    caged in iron bars), the bedrock exit fountain, outer islands far away, and endermen.
  - The **Ender Dragon**: 200 HP, a flying boss with a multi-part body (only head hits do full damage), wings that
    shove, a bite that hurts, block smashing (but not obsidian, bedrock or end stone), and healing beams from the
    crystals — destroy a crystal and the dragon takes 10. A boss bar, a spinning death with experience rain,
    the exit portal, a dragon egg that teleports when poked, and a credits scroll on the first trip home.
  - Also: Ender Chests (one shared inventory), End Crystals, iron bars, silverfish, and `/dimension end`.
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

**Mods**
- A Fabric-style mod system: mods add blocks, items, mobs, commands, screens, settings, renderers and world
  generation through a per-mod context, events and mixins. Ids are namespaced and bound per world, and the
  terrain and mesher workers run mods too.
- The **Mods** screen installs mods from the site's mod repository (static files, hash-checked, kept in the
  browser) or from a file, and turns them on or off. Each mod gets a generated settings page.
- Multiplayer: guests are switched to the host's mods automatically. Client-only mods stay with each player.
- Example mods: Rubies (ore, tools, a mob), Computers (a scriptable terminal with redstone), Kinetics
  (rotational power with animated machines), Minimap, and Wands (below). See [mods/README.md](mods/README.md) to
  write your own.
- **Wands** brings in Noita's wands and spells: 425 of them, nearly all of Noita's, with Noita's icons. A wand fires
  its spells like a deck of cards, so they combine: projectiles, modifiers, multicasts and formations, triggers and
  timers, larpas and orbits, requirements, Greek letters and Divide By, materials and puddles that stain creatures,
  clouds, fields and black holes, curses, passives and music notes. Hold the use button (press and hold on phones) to cast. The editor (R, or the wand
  button on phones) is modelled on the Spell Lab mod: drag or tap spells, see what each cast fires, edit the stats in
  creative, and keep layouts in a wand box. A target dummy measures damage per second. Wands are crafted, spells
  come from arcane scrolls and monsters, and it all works in multiplayer.

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
`/spawnpoint`, `/setblock`, `/fill`, `/clear`, `/xp`, `/gamerule doDaylightCycle`, `/heal`, `/effect`, `/enchant`,
`/locate stronghold`, `/dimension overworld|nether|end`, `/help`.

## Architecture

```
src/world    blocks registry, worldgen (overworld, nether, the End, villages, strongholds), mesher + lighting (worker), chunk streaming
src/render   WebGL2 renderer, shaders, texture array, procedural textures & sprites, entity models & renderer
src/game     game loop (20 TPS), player, interaction, block ticks, items, recipes, audio synth, storage, portals
src/entity   entity physics (vanilla collision), living entities, mobs & AI, pathfinding, spawning, boats
src/ui       bitmap font, GUI primitives, isometric item icons, HUD, menus, containers, trading
src/mod      mod loader, registries and per-world id binding, events, mixins, mod API, repository client
mods/        the mod repository (example mods + SDK types), built by tools/vite-mods.ts
tools/       headless Playwright scenario runner used for visual regression screenshots
```

## Mobile / touch

The game detects phones and tablets (or `?touch=1`) and switches to touch controls; a mouse or keyboard switches it back.

- **World**: floating stick on the left (push past the rim to sprint), drag the right side to look, tap to use/place, long-press to mine. Buttons for Jump, Sneak (toggle), Attack, Use, plus Pause / Chat / Inventory / Drop / Camera / Fullscreen. Tap the hotbar to select a slot.
- **Menus and containers**: taps are clicks, dragging scrolls lists, sliders drag. **Split** acts as right-click and **Shift** as shift-click; **X** closes.
- **Text fields** raise the soft keyboard; the layout follows the visual viewport and re-flows on rotation.
- Phones default to a shorter render distance and cap the pixel ratio at 2. A web manifest and icons let you "Add to Home Screen" for fullscreen landscape play.
