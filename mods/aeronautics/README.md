# Aeronautics

Physics contraptions in the spirit of [Create: Aeronautics](https://github.com/Creators-of-Aeronautics/Simulated-Project),
built on the game's sub-levels (moving block structures kept in a shipyard plot, the way Valkyrien Skies and Sable
do it, simulated with Rapier). Build something, put a Physics Assembler in it, and it becomes a single moving object
you can stand on, fly, sail and land again.

## Playing

1. **Build** your ship out of anything: a deck, railings, a cabin, chests. Everything joined to the assembler
   through block faces comes along, except the ground (grass, dirt, stone, sand, water, ores...), so it can sit on a
   hill.
2. **Physics Assembler**: right-click it (or give it a redstone pulse) to assemble. Use it again on a ship to land
   it: the ship has to be about level, and it snaps to the nearest quarter turn, with doors, stairs, propellers and
   the helm turned to match.
3. **Lift**, one of:
   - **Hot Air Burner** under a **Hot Air Envelope** balloon (16 colours). The hot air pools under the roof and fills
     down, a layer at a time, as far as the sides are closed in, so a balloon can be open underneath like a real
     one. Each block of hot air lifts 1.5 kpg (a plain block weighs 1), a little less higher up where the air is
     thin. It fills and cools over a few seconds. Right-click a burner to set its heat (0, 5, 10, 15), or power it
     with redstone.
   - **Levitite**: each crystal holds up to 10 kpg of the ship. With enough of it the ship floats where you leave
     it, and the air feels thick around it at low speed, so it settles instead of drifting.
4. **Propellers** push the ship the way you were looking when you placed them (their blades spin on the other
   side). They run on redstone (strength 1-15) or from the helm.
5. **Helm**: right-click it to steer. W/S drive the propellers lined up with the helm (forward and reverse),
   A/D turn, jump climbs and sneak sinks (propellers pointing up or down, and the burners). Let go of jump and sneak
   and the burners hold your height. R (or "Let go" on phones) leaves the helm.
6. **Gyroscopic Stabilizer**: keeps the ship upright and stops it rocking. More of them, stronger.
7. **Physics Staff** (creative): hold use on a ship to drag it about; sneak + use anchors it in place (or lets it go).

The HUD shows the ship's speed, height, heading, lift against its weight and the propellers' thrust while you're
on it or at its helm, and what a burner or propeller is doing when you look at it.

Boats float: anything lighter than the water it displaces (wood, wool) stays up. Ships collide with the ground and
with each other, keep their chests and machines working, and are saved with the world.

## Recipes

| | |
|---|---|
| Physics Assembler | iron, redstone, iron / planks, slime ball, planks / iron, planks, iron |
| Propeller | a plus of planks around an iron ingot |
| Hot Air Burner | iron in a U around a furnace |
| Hot Air Envelope (2) | two wool of a colour and a string |
| Levitite (2) | end stone, glowstone dust, ender pearl |
| Helm | a plus of sticks around planks |
| Gyroscopic Stabilizer | gold and iron around redstone |

## How it works

- `blocks.ts`: the blocks, their models (the propeller is authored pointing up and turned with `orient6`; the helm
  turned with `rotY`) and recipes. Every part has a tile entity whose `tick` notes it on its sub-level: that's how a
  ship's parts are found without scanning its blocks. Parts with a facing have a `rotate` hook, so landing turned
  keeps them right.
- `flight.ts`: the server. In `subLevelTick` each ship gets its propellers' thrust (at their blocks, so off-centre
  ones turn it), its balloons' lift (at the centre of the hot air, above the centre of mass, which keeps a balloon
  ship hanging upright), levitite (lifting from just above the centre of mass, which makes a levitite raft level
  itself), gyroscope torque, the pilot's turning and the staff's pull. Balloons are found again every second: up the
  chimney to the roof, everything under the roof hot air can rise into, then down a closed-in layer at a time. With a
  pilot, burner heat is set for a target climb rate (0 when nothing is held), so the ship holds its height.
- `client.ts`: tile renderers for the blades and the gyroscope ring (they run on moving ships too: the game draws a
  sub-level's tiles turned with it), the burner's flame, the helm's view (`setView` with `move`: the movement keys
  become controls sent over the `helm` channel, a few times a second while nothing changes), and the readouts.
- `art.ts`: painted textures and synthesised sounds.

The numbers (thrust, lift per block of hot air, levitite's hold) are at the top of `flight.ts`; the engine's (gravity,
drag, water) are `mod.mc.PHYS`.
