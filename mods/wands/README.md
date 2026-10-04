# Wands: reference

Noita's wands and spells as a mod: 425 of Noita's spells (all of them but one), wearing Noita's own icons, cast from
wands built in a Spell Lab-style editor. This file is the reference for the mod itself: how a wand fires, what
spells can do, the items, settings and messages, and how to add or change a spell. **[SPELLS.md](SPELLS.md) lists
every spell** with its exact numbers, behaviour, definition line and code. Read [`../README.md`](../README.md) for
the mod API in general (contexts, realms, items, channels, screens, testing).

SPELLS.md is generated from the catalogue by `spell-list.mjs`; this file is written by hand. If the code and this
file disagree, the code wins. Fix the file when you notice.

## Files

| File | Runs in | What it holds |
|---|---|---|
| `mod.json` | | Manifest: id `wands`, entry `main.ts`. |
| `main.ts` | page + workers (`main`), page (`client`) | Wiring: settings, spell, wand, scroll and dummy items, material blocks, recipes, channels `fx` and `edit`, event hooks (curses on blows), HUD, editor keybind, touch button, creative tabs. |
| `spelldefs.ts` | everywhere | **What a spell is**: the types (`SpellDef`, `Proj`, `Shot`, `CastCtx`, `SpellWorld`, `Live`, `HitInfo`, `SpawnRule`, `Orbit`, `Steer`, `Status`, `Visual`), `BASE` (a plain projectile's numbers), `makeProj` / `cloneProj`, the registry `S` and the helpers spells are defined with (`proj`, `stat`, `modifier`, `multi`, `other`, `utility`, `def`, `sec`, `landing`, `isCopy`). |
| `catalog/projectiles.ts` | everywhere | Projectile spells, and the hidden helper projectiles they make. |
| `catalog/statics.ts` | everywhere | Static projectiles: explosions, fields and circles, barriers, clouds, holes, swarms, projectile fields. |
| `catalog/materials.ts` | everywhere | Materials: streams of liquid or powder, seas, expanding circles, Touches. |
| `catalog/modifiers.ts` | everywhere | Projectile modifiers, and the helper projectiles some of them cast. |
| `catalog/casting.ts` | everywhere | Multicasts, "other" spells (triggers, copies, requirements, notes), utility spells, passives. |
| `spells.ts` | everywhere | Loads the catalogue in order and exports `SPELLS`, `SPELL_BY_ID`, `SPELL_INDEX` (network numbers), `TYPE_ORDER`, `TYPE_NAMES`, `TYPE_COLORS`, plus everything in `spelldefs.ts`. Import spells from here. |
| `icons.ts` | page (client) | Generated: Noita's 422 spell icons (16x16), packed losslessly into 49 KB: a shared palette, and per icon its own few colours, the box around its visible pixels, a visibility bit per pixel and 0-6 colour bits per visible pixel. `NAMES` gives the order (the Noita spells' English names). |
| `iconcodec.ts` | page (client) | `decodeIcons`: unpacks `icons.ts` into 256 RGBA pixels per icon. No game imports. |
| `wand.ts` | everywhere | `WandData` / `WandStats` (stored in `stack.tag.wand`), tiers, stat rolls, the starter and Spell Lab wands, `fixUses`, tooltip lines, stat limits, `sanitize`. |
| `engine.ts` | everywhere | The deck: `Runtime`, `newRuntime`, `catchUp` (mana, timers, use regen), `fire`, `finalProjs`, and `previewCycle` for the editor. Pure logic. |
| `motion.ts` | server + clients | Projectile flight shared by both sides: `rayBlocks` (voxel walk), `displacement` (sine/spiral), `steer` (gravity, drag, accel, chaos, homing, and the steering both sides can work out), `orbitAt`, `bounce`, `rayEnd`. |
| `server.ts` | page (server) | `SpellServer`: casting from a held wand, flying projectiles, spawn rules, orbits, steering, arcs, trails, hits, damage, explosions, digging, conditions, rigged creatures, passives, the `SpellWorld` hooks see, editor edits, HUD state, sending events. |
| `status.ts` | page (server) | `Statuses`: the conditions creatures carry (wet, oiled, toxic, cursed...) and their colours. |
| `blocks.ts` | everywhere | The material blocks spells make: puddles (`wands:acid`, `oil`, `blood`, `slime`, `toxic`, `alcohol`, `urine`, `gunpowder`, `cement`), `wands:gas`, `wands:magic_wall`. |
| `fx.ts` | page (client) | `SpellFx`: client copies of projectiles, glows, flashes, lightning, beams, mists, worms, icon sprites, voxel clouds, damage numbers, condition drips. |
| `hud.ts` | page (client) | Mana and recharge bars, the held wand's spell strip, damage numbers, dummy DPS readouts. |
| `editor.ts` | page (client) | The Spell Lab-style wand editor screen (mouse and touch). |
| `dummy.ts` | page | The target dummy mob (`wands:dummy`) and its renderer. |
| `art.ts` | page (client) | Spell cards (Noita's icon on a card back in the type's colour; painted glyphs `G` for spells without one), icon sprites for projectiles, wand and scroll sprites, glow textures, sounds (including the kantele and ocarina notes). |
| `spell-list.mjs` | Node | Writes SPELLS.md. Not bundled. |
| `tools/make_icons.py` | Python | Rebuilds `icons.ts` from the Noita wiki's saved Spells page. Not bundled. |

## How a wand fires

A wand's spells are a **deck of cards**, in slot order (shuffled if the wand shuffles). Each press of the wand is a
**cast**:

1. The cast starts with the wand's own cast delay, recharge time and spread. **Always-cast** spells play first, for
   free.
2. The wand **draws** `Spells/Cast` (`multi`) cards. What a card does when drawn depends on its type:
   - **Projectile, static, material:** adds a projectile to the cast. If the spell has a **trigger**, it draws
     `triggerDraw` (normally 1) more cards into a new cast it carries (its **payload**). The payload is released
     when the trigger fires: `hit` when it hits something, `timer` after N ticks of flight, `expire` when it ends
     for any reason. Cards of these types with a `play` (Random Projectile, the notes) run it instead.
   - **Modifier:** adds its `mod(p)` to the cast (it changes every projectile of that cast, payloads excluded),
     runs its `cast(ctx, shot)` if it has one (recoil, Mana to Damage...), then draws one more card.
   - **Multicast:** draws `draw` more cards into the same cast. Scatter spells add spread (formations take a
     little away). Formations turn the drawn projectiles by fixed yaw/pitch offsets, repeating if more come out
     than the formation has entries.
   - **Other and utility:** run their own `play(ctx, shot)`. It can draw, take a card without playing it, skip
     cards unpaid, peek ahead, play copies, read the caster's state, set flags on the cast, or end the cycle early.
   - **Passive:** draws one more card (like a modifier that changes nothing). Passives act while the wand is held.
3. Every card's `delay` and `reload` are added to the cast's totals. Mana is paid per card as it's drawn.
   - A card the wand can't afford is **skipped**: it goes to the discard pile and the next card is tried.
   - A card with no uses left is skipped the same way.
4. **When the deck runs out mid-cast**, the discard pile goes back on the deck **once**, reshuffled if the wand
   shuffles. Cards already in hand stay out, and the wand recharges after this cast. When the deck is empty after a
   cast, the wand also recharges.
   - **Recharge:** the deck is rebuilt and the wand waits `max(0, total recharge)` ticks (Slow But Steady fixes it
     at 30).
   - **Otherwise:** the wand waits `max(0, total cast delay)` ticks before the next cast.
5. The cast's own effects happen: recoil, the blood Blood Magic costs, Cessation ending everything the caster has
   out, Spells To X turning it all into X.
6. Projectiles are released from the wand tip toward the point the player aims at (48-block ray), or from the
   nearest enemy (Teleporting Cast), the aim point (Teleport / clouds), a few blocks ahead flying back (Inner Spell),
   or further ahead (Long-Distance / Warp Cast). Holding the use button keeps casting whenever the wand is ready.

**Requirements** (`if_*` cards) test a condition: low health, five or more enemies within 16 blocks, ten or more of
your projectiles out, or every other cast. If it holds, the next card is drawn and an Otherwise branch right after it
is skipped up to its Endpoint. If not, cards are skipped (unpaid) up to an Otherwise, whose cards are then cast, or
up to an Endpoint.

**What a `play` can read** (`CastCtx`): the wand's spells, the spells before the current card, the spells of the
caster's other wands, the wand's mana (and spend it), the caster's health share, enemies near, projectiles out, the
gold carried, and an every-other switch kept per wand.

Other rules:

- **Mana** regenerates at `regen` per second, also while the wand isn't held (it catches up on the next use).
- **Limited uses** are counted per slot in `WandData.uses`. One use comes back every 300 ticks while any slot is
  below full.
- **Editing a wand** rebuilds its deck and recharges it (at most 1 s).
- **Endless mana and uses** apply to the Spell Lab wand (`inf`) and to any wand in creative mode while the host's
  *Creative: Endless Mana* setting is on.
- **Limits:** copies of copies stop at depth 24 or 256 projectiles per cast. Payloads nest at most 8 deep;
  projectiles casting projectiles, 5 generations deep. At most 600 projectiles fly per dimension.

## What projectiles can do

### Damage

- **Contact damage** is `dmg x dmgMul`. A critical hit (chance `crit`, or always on a creature with one of the
  `critOn` conditions; `burning` and `wet` are read from the creature) does three times that.
  - Damage source is `magic` (`explosion` for blasts), so armour and fire immunity don't stop it.
  - Spell damage ignores the usual half-second of invulnerability after a hit.
  - Conditions make it hurt more: cursed x1.25; the weakening curses x2 for projectiles, explosions, electricity
    or blows (blows and other explosions through the `entityDamage` event); fire on an oiled creature x1.5.
- **Explosions** (`explR > 0`, when the projectile ends):
  - Damage is `explDmg x dmgMul`, from 100% at the centre to 35% at the edge, with knockback.
  - Blocks within `0.85 x explR` with blast resistance `<= terrain x 5` are destroyed, with a ragged edge.
    Fluids and unbreakable blocks are kept.
  - **Dormant** projectiles (crystals, propane tanks) within the blast go off too.
- **Shock** (`elec`): hurts everything within 2.5 blocks of where it ends.
- **Aura:** hurts what comes within `aura` blocks every 5 ticks while it flies (dark flames, barriers, Damage Field).
- **Freeze:** slowness on hit; water near the end point turns to ice.
- **Fire:** sets entities alight (unless fire-immune or wet) and lights fires where it hits blocks.
- **Healing** projectiles heal instead of hurting. **Life steal** heals the caster by a share of the damage.
- `selfHit` projectiles can hurt their own caster (after their first 8 ticks); others never do unless the host
  turned on self damage.

### Flight

- **Digging:** drills dig blocks of hardness `<= digHard` as they meet them, up to `digCount`. With `digR > 0` they
  dig a ball instead. `eater` projectiles eat everything around them as they go.
- **Pierce:** passes through entities, hitting each one at most every 10 ticks. **Ghost:** passes through blocks.
- **Fuse:** the projectile ends only when its life runs out. It bounces off walls while it has bounces left, and
  stops against them after that.
- **Paths** (`sine`, `spiral`, `chaos`, `accel`) and **steering** (`steer`): turning down or up after 5 ticks,
  ping-pong, flying level, floating over the ground, avoiding walls, blinking ahead (phasing), homing variants,
  aiming at what the caster aims at, boomerangs, auto-aim at the nearest foe, teleporting onto a foe that comes
  near. Steering only the server can follow sends clients the projectile's position every 3 ticks.
- **Orbits** (`orbit`): circling the cast point, the caster, or another projectile (the Orbit modifiers put four
  helpers around each projectile; they end with it).
- **Static spells** (speed 0) appear 1.5 blocks in front of the wand, or where a trigger releases them. Clouds
  (`aim`) appear at the aim point, 20 blocks at most, then rise 4 blocks. Meteors (`sky`) fall from 22 blocks above
  the aim point.
- **A payload released off a wall** comes back out along the reflected direction; a static projectile's payload
  goes the way it was cast.

### Casting more

- **Spawn rules** (`spawns`): a projectile casts more spells when it bounces, ends, ends on a block or creature,
  every N ticks, when it starts falling, when it slows down, or when it kills. Each rule names a spell (or `self`:
  a copy that never copies again), how many, which way (same, reflected, random, ring, up, down, sideways, back, a
  hemisphere off the surface, a cone, at foes), and how often at most.
- **Chain Spell:** when the projectile ends a copy carries on, five times.
- **Arcs** (`arcs`): every 3 ticks, lines of lightning, fire, poison or gunpowder join each projectile of a cast to
  the next, and hurt or stain what they cross.
- **Trails** (`trails`): fire, burning, or a material (water, acid, oil, toxic sludge, gunpowder) dropped on the
  ground below every other tick.
- **Transmutation** (`transmute`) where it ends: blood to acid, lava to blood, water to poison, toxic to acid, ground
  to sand, chaos, or liquids exploding.

### Conditions and materials

- **Conditions** (`status.ts`) are kept by the server per creature, with an end time. Spells put them on what they
  hit (`inflict`), explosions and mists spread them, and creatures pick them up standing in a puddle (or water:
  wet). Every 5 ticks they act: toxic and venom poison, slimy slows, petrified holds still, drunk staggers, wet puts
  out fire, charmed creatures pick a fight with their own kind, and the Personal modifiers' conditions make a
  creature throw fireballs, call lightning, lash out with tentacles or pull things in. Clients see drips of the
  condition's colour.
- **Material blocks** (`blocks.ts`) are thin puddles that need ground under them and slowly dry up. Acid eats the
  block below, oil and alcohol burn, gunpowder explodes near fire, cement sets into stone, flammable gas hangs in
  the air and explodes near fire, magic walls vanish after their time.
- **Rigged creatures** (Summon Deercoy) explode when hurt, or after their time.
- **Passives** act every 10 ticks while their wand is held: Torch (night vision), Electric Torch (also shocks
  enemies close by), Energy Shield (resistance, and creatures' arrows and fireballs nearby are removed), Energy
  Shield Sector (less resistance), Tiny Ghost (a spark bolt at the nearest enemy every 1.5 s).

## Host settings

`terrain`, `selfDamage`, `pvp` and `creativeInfinite` are read from the **host's** settings and apply to the whole
game:

| Key | Default | Effect |
|---|---|---|
| `terrain` | on | Explosions, drills, materials and placed blocks change the world. Off: spells break and place no blocks (they still light and put out fires). |
| `selfDamage` | off | Your own spells hurt you. Off: they only push you. |
| `pvp` | on | Players' spells can hurt other players. |
| `creativeInfinite` | on | Wands never run out of mana or uses in creative. |

The other settings are for each player's own screen: `editKey` (R), `damageNumbers`, `hudStrip`, and `effects`
(`fancy` or `fast`).

## Wands

A wand is an item whose stack carries `tag.wand: WandData`:

```ts
interface WandStats { shuffle: boolean; multi: number; delay: number; reload: number; mana: number; regen: number; cap: number; spread: number; speed: number }
interface WandData { uid?: string; tier: number; s: WandStats; spells: (string | null)[]; always: string[]; uses?: (number | null)[]; inf?: boolean; rev: number }
```

- **`spells`:** one entry per slot (`cap` long). Each entry is a spell id or `null`.
- **`always`:** at most 4 always-cast spells.
- **`delay` and `reload`** are in ticks. **`regen`** is mana per second. **`spread`** is in degrees.
  **`speed`** multiplies projectile speed.
- **`uid` and the server's runtime:** the server keeps each wand's runtime (deck, mana, timers) in memory under
  `uid`, so it resets when the world reloads. Give a wand a new `uid` and it starts fresh.
- **Attuning:** a wand without `uid` is **attuned** by the server when first held or within half a second of
  entering an inventory. Its stats are rolled for its tier unless it already has data, and it gets a `uid`.
- **Replace, don't mutate:** never change a stack's `tag` in place. Build a new stack with `withWand(stack, w)`
  and put it in the slot.

| Item | Tier | Recipe (shaped, diagonal) | Rolls |
|---|---|---|---|
| `wands:wand_apprentice` | 0 | lapis lazuli, stick, stick | cap 2-4, 1 spell/cast, 80-160 mana |
| `wands:wand_adept` | 1 | diamond, gold ingot, stick | cap 4-7, 1-2 spells/cast, 160-320 mana |
| `wands:wand_master` | 2 | emerald, blaze rod, blaze rod | cap 6-12, 1-3 spells/cast, 300-650 mana |
| `wands:wand_archmage` | 3 | ender eye, diamond, blaze rod | cap 10-20, 1-4 spells/cast, 600-1300 mana |
| `wands:wand_starter` | 4 | none (creative) | fixed: spark bolt x2, bouncing burst, cap 4 |
| `wands:wand_lab` | 5 | none (creative) | Spell Lab: cap 26, no delay, endless mana and uses |

- **Recipe layout:** the top item, then the band, then the shaft, as `['  T', ' B ', 'S  ']`.
- **Random rolls** (`ROLL` in `wand.ts`) also set shuffle, delay, recharge, regen, spread and speed. They can add
  an always-cast spell.
- **Starting spells:** rolled wands start with one or two kinds of attack projectile (spells with damage or an
  explosion, without a trigger, hooks, a fuse, self-harm, digging or few uses), sometimes with a modifier in front
  of them.
- **Spell tiers:** spells up to the wand's tier + 1 can appear.

## Spells as items

- **Items:** each visible spell is an item `wands:<spell id>` (stack 16). Its rarity follows the spell's tier. Its
  card is Noita's icon on a back in the type's colour (projectile red, static orange, modifier blue, multicast teal,
  material green, other gold, utility purple, passive dark green).
- **Survival:** you put spells into wands in the editor. The server checks every edit: added spells must come out
  of your inventory, and removed ones go back in (or drop if it's full).
- **Creative:** the editor offers every spell and editable stats.

Other items:

| Item | Recipe | Use |
|---|---|---|
| `wands:arcane_scroll` | paper + lapis lazuli + redstone (shapeless) | Use: becomes a random spell of tier <= 3. Rarer spells come up less often. |
| `wands:greater_arcane_scroll` | paper + glowstone dust + ender pearl + lapis lazuli | Use: a random spell of any tier. |
| `wands:target_dummy` | hay block over stick | Places a dummy (mob `wands:dummy`) that never dies and shows DPS, total and peak. Sneak-hit it to pick it up. |

**Mob drops:** hostile mobs killed by a player drop a random spell 4% of the time. Spell tier depends on where:

- Overworld above y 45: up to tier 2.
- y 20 to 45: up to tier 3.
- Below y 20: up to tier 4.
- Other dimensions: up to tier 5.

**Creative tabs:** `wands:wands` holds ready-made wands, scrolls and the dummy. `wands:spells` holds every spell,
by type.

## Editor (Spell Lab style)

Open it with **R** (setting `editKey`) or the wand touch button on phones.

- **Header:** tabs for each wand in your inventory, search, undo/redo, clear, the wand box (saved layouts, kept in
  `localStorage` under `wands.box`) and close.
- **Palette:** type filters (all, then the eight types) and the spells: all of them in creative, owned ones with
  counts in survival. With 425 spells, search and the filters matter: the palette scrolls.
- **Stats:** the wand's stats, with +/- buttons in creative.
- **Cast preview:** `previewCycle` from `engine.ts`.
- **Wand slots:** grouped by cast.

Input:

- **Mouse:** drag and drop, or click a spell and then where it goes. Right-click removes. Shift with +/- changes
  stats in bigger steps.
- **Touch:** tap-tap to move, long-press to drag, swipe to scroll.

Every change is sent to the server as the whole new layout (`edit` channel). The screen keeps its own copy until
the server confirms the revision.

## Network messages

Both channels carry plain JSON and are checked on receipt.

- **`wands:edit`** (client -> server): `{ slot, spells, always?, s? }`.
  - The server takes the tier from the item in that slot, never from the message.
  - It runs `sanitize` and applies stats and always-cast spells only in creative.
- **`wands:fx`** (server -> client): one array of events per player per tick.
  - Projectiles aren't entities. Each client flies its own copy with `motion.ts`.
  - The server reports ends, and positions every 8 ticks for homing and chaotic projectiles (every 3 for steering
    only it can follow). Orbits are flown by clients from the same centre.

| `k` | Meaning |
|---|---|
| `s` | Spawn: id, spell index (`SPELL_INDEX`), position, velocity, colour, size, gravity, life, bounces, homing, path, seed, drag, bounce keep, ghost, fuse, rainbow, dig, owner; and when set, `st` (steering), `ob` (orbit: around, radius, speed, phase, parent id, centre) and `iv` (invisible). |
| `e` | End: id, position, reason (`block`, `entity`, `expire`, `gone`). |
| `y` | Sync: id, position, velocity (after a bounce, or periodically when steering). |
| `x` | Explosion: position, radius, colour. |
| `f` | Named effect: `zap`, `heal`, `tp`, `strike` (top height), `arc` (other end and colour), `st` (condition drips: colour, width), `quake`. |
| `d` | Damage number for the caster: position, amount, crit. |
| `w` | Held wand state for the HUD: slot, mana, max, delay, recharge, deck order, endless. `s: -1` means no wand. |
| `a` | Edit acknowledgement: revision, ok, message. |

`SPELL_INDEX` is a spell's position in `SPELLS`. Both sides must run the same mod version, so add spells at the end
of their section and don't reorder the list in a version that has to talk to an older one.

## Adding a spell

1. **Define it in the catalogue file for its type** (`catalog/*.ts`), with that file's helpers:
   - `proj(id, name, tier, mana, desc, icon, projFields, extra)` for projectiles (`withTrigger` makes trigger and
     timer variants of one).
   - `stat(...)` for static spells. It sets `speed 0`, `ghost`, `pierce`. Each file has more helpers for its
     families: `boom`, `field`, `cloud`, `hole`, `swarm`, `pfield` in statics; `material`, `sea`, `circle`, `touch`
     in materials; `mod`, `onBounce`, `thrower`, `larpa`, `orbit`, `trail`, `arc`, `curse`, `personal`, `tm`,
     `glimmer` in modifiers.
   - `modifier(id, name, tier, mana, desc, icon, (p) => {...}, extra)`. To add to a projectile's lists, push onto
     them (`p.spawns.push({...})`, `p.steer.push('aim')`): every projectile has its own copies.
   - `multi(id, name, tier, mana, desc, icon, draw, { scatter | formation })`.
   - `other(...)` / `utility(...)` with a `play(ctx, shot)`; passives with `def({ type: 'passive', passive: kind, play })`
     and the kind handled in `SpellServer.passives`.
   - `extra` takes `delay`, `reload`, `uses`, `trigger`, `timer`, `triggerDraw`, `tick`, `hit`, `touch`, `cast`,
     `hidden`, `noita`, `sprite`, `marker`.
   - The id must be unique, lowercase with underscores. It becomes the item id `wands:<id>`, which saved worlds
     refer to, so don't rename a shipped spell.
   - Noita's numbers convert like this: cast delay and recharge seconds x 20 (`sec(s)`), lifetimes (frames) x 0.4,
     explosion radius about `sqrt(r) / 2` blocks.
2. **Projectile fields** are `Partial<Proj>` (every field is documented in `spelldefs.ts`). Anything left out takes
   the `BASE` value: speed 1, life 20, size 0.15, no damage.
   - Units: ticks, blocks per tick, half-hearts, degrees.
   - Keep `life x speed` within about 80 blocks.
   - Much needs no code: `spawns` (cast more on events), `steer`, `orbit`, `inflict`, `critOn`, `explodeOn`, `arcs`,
     `trails`, `transmute`, `aura`, `eater`, `dormant`, `selfHit`, `lifeSteal`, `data` (numbers for your hooks).
3. **Behaviour beyond the fields** goes in hooks, which run on the server only and must use `SpellWorld` (`w`),
   never the game directly:
   - `tick(l, w)` runs every tick of flight, `hit(l, h, w)` when the projectile ends, `touch(l, e, w)` when it hits
     a creature (before the damage).
   - `l` is the live projectile (id, position, velocity, age, life, origin, caster, `p` its numbers, `kill()`,
     `remove()`, `sync()` after moving it by hand). `h` tells where and why it ended (`block`, `entity`, `expire`)
     with the face normal.
   - `w` offers `blast`, `dig`, `near`, `foes`, `hurt`, `heal`, `effect`, `status`, `has`, `id`, `solid`, `place`,
     `temp`, `ignite`, `teleportCaster`, `teleport`, `pull`, `spawn` (another spell's projectile, with overrides),
     `projs`, `mine`, `replace`, `mob`, `rig`, `polymorph`, `aim`, `transmute`, `deflect`, `fx`, `sound`, `rand` and
     `time`.
   - Block names are vanilla names (`'water'`, `'cobblestone'`) or the mod's (`'wands:oil'`). `place` respects the
     `terrain` setting.
4. **Icon:** the card shows the Noita icon whose name is `noita` (default: the spell's `name`; matched ignoring
   case). `noita: ''` means none: then `icon` `{ g, c, c2?, n? }` is painted instead (`g` a glyph painter in
   `art.ts`, listed in SPELLS.md). New Noita icons come from `tools/make_icons.py`.
5. **Visual:** reuse one of the visuals listed in SPELLS.md (`icon` draws the spell's Noita icon as a sprite;
   hidden helpers set `sprite` to borrow another spell's). For a new one:
   - Add it to `Visual` in `spelldefs.ts`.
   - Draw it in `fx.ts`: particles in flight in `trail`, the glowing body in `drawGlow`, the burst when it ends in
     `impact`, and solid things in `drawSolid`.
6. **Rolls:** wands only roll plain damaging projectiles (no trigger, hooks, fuse or self-harm). Scrolls and mob
   drops can give any non-hidden spell up to their tier. Set `hidden: true` for helper projectiles that should have
   no item (like `death_ray`).
7. **Regenerate the list:** `node mods/wands/spell-list.mjs` (writes SPELLS.md). Then type-check with
   `npx tsc --noEmit`.
8. **Test** with a dev server, following the template in `../README.md`. With the mod installed and a world
   loaded, put the spell in a Spell Lab wand from the page, then hold the use button:

```js
await page.evaluate((list) => window.sim((g, p) => {
  const lab = [...window.__mc.ITEMS.values()].find((d) => d.name === 'wands:wand_lab');
  p.inventory.main[0] = { id: lab.id, count: 1, tag: { wand: { uid: 'test' + Math.random(), tier: 5, rev: 0, always: [], inf: true,
    s: { shuffle: false, multi: 1, delay: 2, reload: 2, mana: 10000, regen: 10000, cap: 8, spread: 0, speed: 1 },
    spells: [...list, ...new Array(8 - list.length).fill(null)] } } };
  p.inventory.selected = 0;
}), ['my_spell', 'spark_bolt']);
await page.evaluate(() => { const i = window.game.input; i.mouseDown.add(2); i.mousePressedQ.push(2); });
// ...wait, release with window.game.input.mouseDown.delete(2), then check:
// (await import('/src/mod/state.ts')).modState.errors.get('wands') is empty,
// window.__wands.fx.seen counts what the client drew, window.__wands.server is the SpellServer
// (its `flying` map holds what's in flight by dimension; `statuses.has(entity, 'toxic', game.ticks)`).
```

## Changing other things

- **A new spell type:** add it to `SpellType` (`spelldefs.ts`), `TYPE_ORDER`, `TYPE_NAMES` and `TYPE_COLORS`
  (`spells.ts`), handle it in `Cast.playSpell` in `engine.ts`, and give it a filter icon in `editor.ts`.
- **New `CastCtx` abilities** (for `play` and `cast`): add them to the interface in `spelldefs.ts` and implement
  them in `Cast` in `engine.ts` (things about the caster come in through `FireOpts`, filled in by
  `SpellServer.useTick`). The editor's preview runs the same code, so it stays right.
- **A new `SpellWorld` ability:** add it to the interface in `spelldefs.ts` and implement it in
  `SpellServer.world()` in `server.ts`.
- **A new steering, spawn event or condition:** `Steer` / `SpawnRule['on']` / `Status` in `spelldefs.ts`; steering
  both sides can compute goes in `motion.ts` `steer`, server-only steering in `SpellServer.serverSteer` (and in
  `SERVER_STEER`), spawn events are fired with `spawnOn`, conditions act in `SpellServer.conditions` (and get a
  colour in `status.ts`).
- **A new material block:** add it to `PUDDLES` (or its own `mod.block`) in `blocks.ts`.
- **A new effect for clients:** send it with `w.fx(kind, x, y, z, data)` and draw it in `SpellFx.named` in
  `fx.ts`.
- **A new projectile field:** add it to `Proj` and `BASE` (and to `makeProj` / `cloneProj` if it's a list). If
  clients need it to fly their copy, also add it to the `s` event in `SpellServer.launch` and read it in
  `SpellFx.handle`.
- **Balance:** wand rolls are `ROLL` in `wand.ts`. Editor stat limits are `STAT_LIMITS` in `wand.ts`. Use regen is
  `USE_REGEN` in `engine.ts`.

## Spell list

Every spell, with its numbers, behaviour, definition and code: **[SPELLS.md](SPELLS.md)** (generated; don't edit it
by hand).

What's not ported, and where the port is an approximation:

- **Not ported:** "???" (Noita's unidentified spell).
- **Fluids** are puddles: Noita's liquids flow and mix, these lie where they land. Seas of acid, oil and the like
  are pools of puddles; flammable gas is a cloud of gas blocks.
- **Guesses** where the wiki gives no numbers or effect: most damage values (scaled to Minecraft health: a spark bolt
  does 3, a zombie has 20), Deadly Heal (life steal), the -plicate spells (2 to 7 copies in a letter-shaped
  formation), Requirement - Projectile Spells (ten of your projectiles out), Myriad Spell (26 cards), Summon Portal
  (a pair: in by you, out where you aim), The End of Everything (a slow orb ending in seven huge explosions).
- **Stand-ins:** Deercoy is a cow, fish are squid, Summon Egg hatches a random vanilla creature, polymorph uses
  vanilla creatures, Touch of Gold? leaves urine, and the Weakening Curse - Melee doubles blows.
