# Blueprints

Schematics in the spirit of Litematica: save part of the world, bring in schematics made in Java Edition, show
them where you want to build as ghost blocks, check your work against them, and take your builds back to Java
Edition. Whole worlds go both ways too.

## Using it

Craft a **Blueprint Wand** (a stick and paper, or take it from the Tools tab in creative). Press **B** (on phones,
the **BP** button) for the Blueprints menu.

**Saving an area.** Hold the wand, left-click one corner and right-click the opposite one. Then open
Menu → **Save Selection**, give it a name and save. **Add Another Box** makes the next corners a new box, so one
schematic can hold several boxes (Litematica's sub-regions). Saved schematics go to this browser's library and can
be used in any world.

**Placing a schematic.** Menu → **Schematics**, pick one, **Place Here**. Blocks still to be placed show as ghost
blocks. In **Placements** you can move a placement to you, nudge it a block at a time along X, Y or Z, turn it,
mirror it, hide it or remove it. With the wand in **Move placement** mode (switch it in the menu), right-clicking a
block moves the selected placement there.

**Building from it.**
- **Layers** shows one layer at a time, everything at and below a height, or everything at and above it.
- **Highlights** colour every difference near you:
  - light blue: missing
  - red: wrong block
  - orange: right block, wrong state (turned or set differently)
  - magenta: something where the schematic has air
  - purple: a block this game doesn't have
- **Verify** counts the differences and lists the nearest ones.
- **Material List** shows how many of each item the placement needs, how many are still to be placed, and how many
  you're carrying.
- **Easy Place**: right-click a ghost block and the right block goes there, in the right state, taken from your
  hotbar. It works in survival too.

**Pasting.** In creative, with permission to use commands (the host, or anyone when the host allows cheats for
all), **Paste** builds the whole placement, chest contents and sign text included. **Undo Paste** takes the last
paste back. The paste mode decides what gets replaced:
- **All**: an exact copy, air included.
- **No air**: the schematic's air leaves the world alone.
- **Into air**: only empty places are filled.

## Files and Java Edition

**Import File** in the Schematics screen reads:

| Format | From | Notes |
|---|---|---|
| `.litematic` | Litematica | Every sub-region, block entities and entities. Format versions 4-7 (Minecraft 1.13 and newer). |
| `.schem` | WorldEdit, FAWE, Sponge | Sponge versions 1, 2 and 3. |
| `.nbt` | Structure blocks, `/place template`, data packs | Cells the file doesn't list are left alone when placed, as in Java. Both the old `Name`/`Properties` palette keys and the newest `id`/`properties` keys are read. |

Schematics from any Java version since 1.13 are read. Blocks renamed along the way are brought up to date, for
example:
- `grass` → `short_grass`
- `grass_path` → `dirt_path`
- `chain` → `iron_chain`
- `sign` → `oak_sign`
- old wall connections
- cauldron levels

Pre-1.13 files (numeric block ids) can't be read: open them in WorldEdit or Litematica on 1.13 or newer and save
them again.

**Export** writes any schematic as `.litematic`, `.schem` or `.nbt` for the Java Edition version shown on the
**For Java** button (1.16.5 to 1.21.11; the default, 1.20.4, opens in 1.20.4 and everything newer). The file then
uses that version's names and data:
- block names
- container items (item "components" from 1.20.5 on)
- sign text (two-sided from 1.20, plain text from 1.21.5)
- the Litematica format version (5, 6 or 7)

Notes on the formats:
- `.schem` and `.nbt` hold one box: several boxes are merged into the box around them all.
- Structure blocks load at most 48 blocks along each side. `/place template` (1.19+) loads larger ones.

**Nothing is lost going round.** A block of this game that Java can't tell apart, such as a lily pad's turn,
travels as this game's own name alongside the Java one. Tile entities without a Java counterpart travel the same
way. Java ignores these extras, and the file comes back exactly. Stairs corners, fence and wall sides, chest halves
and redstone wire connections are worked out when saving, so builds look right in Java straight away.

## Whole worlds

On the world list (Singleplayer), **More...** has **Import Java World** and **Export to Java**.

**Importing** takes a world from Java Edition 1.13 or newer, including 26.x's new folder layout. Pick either its
folder (the one in `.minecraft/saves`) or a `.zip` of that folder; on phones, use the `.zip`. It becomes a new world
in the list, with:
- the chunks within the distance you choose of where the player was (or everything)
- the Nether and the End, if you want them
- the mobs there
- the player: where they were, their inventory, armour, game mode and experience
- spawn and the time of day

Things to know about imports:
- **Heights:** this game holds y 0 to 255. A 1.18+ world's blocks below 0 and above 255 stay behind, and bedrock
  goes at y 0.
- **Newer blocks:** blocks newer than this game get the nearest block it has. Deepslate becomes stone, tuff
  becomes andesite, copper becomes terracotta and red sandstone, cherry and mangrove wood become birch and
  jungle, and so on. Small decorations it has nothing for are left out. Your own stand-ins (Unknown Blocks)
  apply here too.
- **Beyond the imported area** this game makes its own terrain from the seed, so there's a seam where the two
  meet.

**Exporting** downloads a `.zip` holding a Java 1.20.4 world. Unzip it into `.minecraft/saves`. Every newer Java
version opens it, upgrading it to its own format as it does with any older world. It holds:
- every chunk anyone changed
- every chunk within the distance you choose of the player, made now if nobody went there
- the mobs, chest contents and every other block entity
- the player with their inventory
- spawn, time and game mode

Beyond that area, Java generates its own terrain, so there's a seam there too.

## Other mods' blocks

- **This game's mods:** their blocks are saved under their keys (`kinetic:shaft`) and come back as long as the
  mod is installed.
- **Java Edition mods** (`create:shaft` and the like): blocks this game has no match for are kept in the schematic
  and exported again unchanged. They show as a purple-and-black placeholder, and pasting skips them.
- **Stand-ins:** Menu → **Unknown Blocks** lets you pick a block of this game for each unknown one (`stone`,
  `oak_stairs[facing=east]`). This browser remembers the choice, and placements use it at once.

## For tinkerers

`window.blueprints` in the browser console holds the mod's state and tools:
- `state` (selection, placements, settings)
- `library` (`list()`, `get(id)`, `put(s)`, `remove(id)`)
- `read(bytes, fileName)` / `write(schematic, format, dataVersion)`
- `capture(client, name)`, `paste(mode)`, `undo()`
- `totals()` (the verifier's counts)
- `aim()` (what easy place would fill)
- `worlds` (`openZip`, `scan`, `import`, `export`)
- `open(name)`

Tests:
- `node tools/test/run.mjs tools/test/schematics.ts`: every block state through every format and version.
- `node tools/test/run.mjs tools/test/javaworlds.ts`: Java chunks of every layout, region files, zips, level.dat.
- `node tools/test/blueprints.mjs` and `node tools/test/javaworld.mjs`: in a browser, with the dev server running.

## Not yet

- Entities in a schematic are kept and exported again, but not placed in the world, and saving an area doesn't
  record the entities in it.
- Schematics and worlds made before Minecraft 1.13 can't be read.
- Importing worlds brings mobs, but not other entities (item frames, armour stands, boats, dropped items).
  Villagers come back as plain villagers.
- A Java block state this game can't show exactly (a cauldron of powder snow, a stair's waterlogging in a block
  that can't hold water) takes the nearest state the game has.
