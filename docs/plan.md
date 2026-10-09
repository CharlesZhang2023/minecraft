# Plan: robots, physics and a research platform

Turn the game into a place where robots can be built, imported and trained: block-built machines in the spirit of
Besiege and Scrap Mechanic, robots loaded from URDF files, a Gymnasium interface for reinforcement learning, a
ROS 2 bridge, and a RoboMaster game mode on top. Everything builds on what the game already has: Rapier sub-levels,
the agent bridge and the mod SDK.

## Why here

Isaac Sim, MuJoCo, Gazebo and Genesis already do accurate physics and realistic rendering better than a voxel game
ever will. What this game has that they don't:

| | |
|---|---|
| Editable worlds | Anyone can build a test course in minutes; Java Edition maps come in through the Blueprints mod. |
| Free ground truth | Every block has an id: segmentation, depth and occupancy are exact without labelling. |
| A natural scale | One block is one metre: steps, ramps and obstacles are standard parts. |
| People in the loop | Players and robots share a world in multiplayer: teleoperation, human-vs-policy matches. |
| LLM-friendly | Language models know Minecraft well, and the agent API already lets them read and change the world. |
| Cheap lidar | A ray through a voxel grid is a few array lookups. |
| A link, not an install | It runs in a browser. A trained policy can run in the page and be shared as a URL. |

The pitch: **an embodied-AI sandbox whose worlds anyone can edit, where people can play alongside the robots, and
where tasks can be written in plain language.** The game does the world and the interaction; Rapier does the
physics.

## What exists

| | Where | Use here |
|---|---|---|
| Rapier (WebAssembly, `@dimforge/rapier3d-compat` 0.21) | `src/sublevel/server.ts` | The physics engine. No second one. |
| Sub-levels: block structures as rigid bodies, saved and replicated as entities | `src/sublevel/` | One link of a robot or machine. |
| Terrain as voxel colliders, a 16x16x16 section at a time near moving bodies, rebuilt on change | `src/sublevel/server.ts` | Collision with the world is done. |
| `subLevelTick`: mods push sub-levels with forces once a tick before the step | `src/sublevel/server.ts`, `mods/aeronautics/flight.ts` | Where actuators hook in. |
| Agent bridge: HTTP / MCP / `mc`, `eval`, `task`, pictures from any camera | `src/agent/`, `tools/agent/` | Remote control, the RGB camera, the base of the Gym API. |
| `mc launch`: a headless browser with its own world | `tools/agent/launch.mjs` | Headless runs from day one. |
| Blueprints: schematics and whole worlds to and from Java Edition | `mods/blueprints` | Test courses from existing maps. |
| Multiplayer, the Overseer top-down view, the Computer mod | `src/net`, `mods/overseer`, `mods/computer` | Matches, a radar/commander view, in-game programming. |
| Kinetics: rotational power in the spirit of Create (hand crank, windmill bearing, shafts, millstone) | `mods/kinetic` | A source of speed for motor blocks, and something for motors to drive. Speed spreads along lined-up shafts; there is no stress or power accounting. |

## Architecture

```
             ┌──────────────── game tab (or headless browser) ────────────────┐
URDF file ──▶│  Assembly: links + joints + actuators + sensors                 │
built in  ──▶│      links are sub-levels (blocks) or primitive/mesh bodies     │
the game     │      joints are Rapier joints with motors                       │
             │  terrain voxel colliders (exists)                               │
             │  sensors: link cameras (shot) · voxel lidar · IMU · encoders    │
             └────┬──────────────────┬──────────────────┬──────────────────────┘
                  │ agent bridge     │ rosbridge (ws)   │ ONNX Runtime Web
                  ▼                  ▼                  ▼
            Python Gymnasium     ROS 2 nodes        policies in the page
```

### Assemblies

Today a sub-level is one rigid body. A robot or a machine is several bodies joined together. One structure covers
both:

```ts
interface Assembly {
  id: string;
  links: Link[];          // a sub-level (blocks) or a body of primitives / a mesh (URDF)
  joints: Joint[];        // revolute, continuous, prismatic, fixed; limits; a motor
  actuators: Actuator[];  // torque and speed limits, PD gains, a power model
  sensors: Sensor[];
}
```

Two ways in, one physics:

1. **Built in the game** (Besiege, Scrap Mechanic, Crossout): hinge, bearing and motor blocks join two sub-levels.
   This is also how the "more vehicles" and contraption ideas get done.
2. **Imported from URDF** (research): one file, one robot.

So the first step is joints between sub-levels, not URDF: both paths stand on it.

Joints are Rapier impulse joints (`createImpulseJoint`) with motors (`configureMotorPosition`,
`configureMotorVelocity`); multibody joints are worth trying for long chains (arms, legs), where they are stiffer.
Links of one assembly don't collide with their neighbours (collision groups), or every joint jams.

## Code layout

Most of this can be mods, but not all of it. Three things about the mod system decide where the line is
(`mods/README.md`):

- Mods import **types only** from the game; everything at run time comes through `mod.mc`. The Rapier world is
  private to `src/sublevel/server.ts`: mods can push sub-levels (`applyForce`, `applyTorque`) but can't join them.
- Mods can't add agent methods, so lockstep and the Gym API can't live in a mod.
- Mods have no way to call each other: `depends` only orders loading.

So two layers: the engine gets general features, the way sub-levels are built in "for mods to build on", and the
mods hold the content.

### Engine (`src/`)

| | What | Where | Phase |
|---|---|---|---|
| **E1 Joints** | Joints and motors between sub-levels on `game.sublevels`; collision groups for joined bodies; joints saved and replicated | `src/sublevel` | P0 |
| **E2 Physics settings** | Gravity, units and substeps per world; a per-substep event (`subLevelSubstep`) so actuators run every substep, not once a tick | `src/sublevel` | P1 |
| **E3 Mod services** | Mods offering each other APIs: `mod.provide('robotics', api)`, `mod.require('robotics')` | `src/mod` | P1 |
| **E4 Agent methods** | Mods registering agent methods (`robot.*`); lockstep `sim.pause` / `sim.step` / `world.reset` | `src/agent` | P1 (registering), P2 (lockstep) |
| **E5 Mesh models** | Drawing outside meshes (STL, OBJ) for mods, in both renderer backends | `src/render` | P5 |

### Mods (`mods/`)

| Mod | What | Needs | For |
|---|---|---|---|
| **`mechanics`** | Hinge, bearing and motor blocks: machines and vehicles built in the game, Besiege-style | E1; `kinetic` optional | Players |
| **`robotics`** | Assemblies, URDF, actuators, sensors (lidar, IMU, link cameras), `/robot`, teleoperation, `robot.*` agent methods, rosbridge | E1-E4 | Research, developers |
| **`gym`** | Tasks and environments: the lunar lander, legged locomotion, reward functions, batched environments | E4; `robotics` optional | Reinforcement learning |
| **`robomaster`** | Field, robots, ballistics, armour plates, referee system, matches, auto-aim datasets | `robotics` | RoboMaster teams |

The Python package (`gymnasium.Env` and the client) lives in `python/`, outside the mods.

Why four:

- **Not one.** The audiences differ: someone building a Besiege machine doesn't want URDF, someone training a
  policy doesn't want a referee system. RoboMaster's rules change every year and shouldn't touch the platform. In
  multiplayer every player runs the same mods (`environment: "*"`), so smaller mods mean installing only what a
  world uses.
- **Not more.** Every split is another API between mods to keep stable. ROS stays a setting of `robotics` until it
  is big enough, or wanted on its own, to be split out.
- **`gym` apart from `robotics`.** Not every task has a robot (the lander, the Game of Life, NetLogo-style models),
  and one robot runs many tasks.

`mechanics` may offer its motors to the Aeronautics helm and take speed from Kinetics shafts through E3, as
options: neither mod should require another. Before E3 exists, a motor can read a shaft's speed from its tile
entity (`speed`), but that ties `mechanics` to Kinetics' internals.

## Settings to change

| | Now | Plan |
|---|---|---|
| Gravity | `PHYS.gravity = 11` (Sable's default) | A research setting per world: 9.81 |
| Mass | kpg, a plain block is 1, guessed from the block's material | Kilograms for URDF links; a fixed conversion for block-built ones |
| Rate | 20 TPS, `PHYS.substeps = 3`: about 60 Hz | Substeps set per world (10-20 with robots: 200-400 Hz); actuators run every substep, not once a tick |
| Scale | Sub-levels are whole blocks (1 m) | URDF links use their own shapes. Block-built small robots may need scaled sub-levels (1/4 or 1/8 blocks) |
| Thread | The simulation runs on the page's main thread | Fine for P0-P2. Many robots or substeps will need the server in a Worker |
| Determinism | `@dimforge/rapier3d-compat` | `@dimforge/rapier3d-deterministic-compat` (also 0.21.0, the same API), chosen per world when `loadPhysics()` imports the engine. The goal is replays that are exact **in the same browser**: the game's own forces (air, water, pressure, mods) are plain JavaScript (`Math.exp` and friends), which other JavaScript engines may round differently. Exact replays across browsers are not a goal. |

## URDF

- **Parsing**: `DOMParser` reads URDF in the page. Xacro is expanded beforehand (`xacro robot.xacro > robot.urdf`),
  not in the game.
- **Collision**: from `<collision>` boxes, cylinders and spheres only, as Rapier colliders. No mesh collision.
- **Drawing**: primitives first (from `<visual>`, or from `<collision>` when there's no visual). STL and OBJ meshes
  later: the renderer loads no outside models today, so that is a new mesh pipeline in both the WebGPU and WebGL 2
  backends.
- **Joints**: revolute, continuous and prismatic become Rapier joints with motors and limits; fixed joints merge
  links into one body.
- **Mecanum wheels**: Rapier has no anisotropic friction and rollers are expensive. Drive the chassis with forces
  from a kinematic model, with friction and power limits. That suits RoboMaster, where chassis power is a rule.
- **Units**: metres and kilograms as written; the game's block grid is already metres.
- **First robots**: a differential-drive cart, a mecanum chassis, a two-axis gimbal, a 6-axis arm. Legged robots
  (Unitree Go2's URDF is public) come last.
- **In the game**: `/robot spawn <file>`, WASD teleoperation, joint states on the F3 screen.

## Sensors

| Sensor | How |
|---|---|
| RGB camera | `shot` from a camera fixed to a link |
| Depth, segmentation | A render pass writing depth and block ids |
| Lidar | DDA through the voxel grid for terrain; Rapier `castRay` for sub-levels and robots |
| IMU, joint encoders, contacts | Read from Rapier bodies and joints |

## Reinforcement learning

The agent bridge runs in real time at 20 TPS. Training needs lockstep.

1. **New agent methods**: `sim.pause`, `sim.step` (run n ticks as fast as possible, then answer), `robot.observe`,
   `robot.act`, `world.reset` (back to a saved snapshot).
2. **A Python package** (`python/`): a `gymnasium.Env` calling those methods over HTTP. Slow, but it works end to end.
3. **Throughput**: a round trip per step gives hundreds of steps a second, enough for debugging and demos, not for
   tens of millions of PPO steps. In order of effort:
   - several headless browser contexts in parallel (Playwright);
   - batched environments in one tab: N isolated robots, one `step` moves them all, observations come back as one
     `Float32Array`;
   - the simulation in Node without rendering. `src/sublevel/` uses no `window` or `document`, and `audio.ts`
     touches `document` and `AudioContext` only inside methods. What stops it today: bundling `src/game/game.ts`
     for Node (`tools/test/run.mjs`) fails because the server's world starts Vite inline workers
     (`src/world/world.ts:5`, `src/world/lod.ts:9`, `?worker&inline`). Node needs a stand-in for them
     (`worker_threads`), or a training world that only loads saved chunks and never generates terrain.
4. **Rewards and tasks**: a JavaScript function evaluated each tick, the way `task` already runs code.
5. **First environment: a lunar lander.** A thrust-driven sub-level landing on terrain, using the propeller and
   thrust logic of `mods/aeronautics`.
6. **Policies in the browser**: export to ONNX, run with ONNX Runtime Web. A link shows the policy running, or
   lets someone play against it. No other robotics simulator can do this.

## ROS 2

A browser can't run `rclpy`, but the game tab already connects out to local WebSockets. Use rosbridge
(`ws://localhost:9090`, JSON):

- publish `/tf`, `/joint_states`, `/scan`, `/imu`, `/clock`, `/camera/image/compressed`;
- subscribe to `/cmd_vel` and joint commands;
- `/clock` follows the simulation, so nodes run with `use_sim_time` and lockstep works with ROS too.

Target demo: Nav2 navigating a map imported from Java Edition.

## RoboMaster (`mods/robomaster`)

RoboMaster suits the game: the field is regular geometry, the match is already a game, and teams need simulation.

- **Robots**: infantry (mecanum or balancing), hero, engineer, sentry, aerial, radar station.
- **Gimbal and launcher**: yaw and pitch axes; projectiles with gravity, drag and spread in muzzle speed (building
  on the projectiles in `mods/wands`).
- **Referee system**: armour-plate hits (collider plus impact direction), health, barrel heat, chassis power,
  buff zones, the power rune, outposts and bases.
- **Field**: built in blocks from the rule manual's drawings. All numbers in a config file, not in code, because
  the rules change every year.
- **For teams**:
  - auto-aim datasets: random robot poses, lighting, distance and occlusion, then batched `shot`s, with labels
    from the plates' projected corners;
  - sentry navigation and decisions, through the Gym API or ROS;
  - operator practice: first-person matches in multiplayer;
  - ballistic compensation, checked against the same projectile model;
  - whole-match strategy runs; the radar station uses the Overseer view.

## Phases

| Phase | Deliverable | Code | Demo |
|---|---|---|---|
| **P0 Joints** | Hinge, bearing and motor blocks; Rapier joints between sub-levels; joints saved with the world and replicated | E1, `mechanics` | A block-built four-wheeled cart driven by motors over terrain; a pendulum |
| **P1 Assemblies and URDF** | The `Assembly` structure; URDF with primitives; the research settings (9.81, kg, substeps) | E2, E3, E4 (registering), `robotics` | Differential cart, mecanum chassis, gimbal and arm, driven with WASD |
| **P2 Lockstep and Gym** | `pause` / `step` / `reset`; the Python package; batched environments | E4 (lockstep), `gym`, `python/` | The lunar lander, trained with PPO |
| **P3 Sensors and ROS** | Link cameras, lidar, depth and segmentation; rosbridge | `robotics` | Nav2 in an imported map |
| **P4 RoboMaster** | Infantry, ballistics, plates, referee system, field, matches, dataset generator | `robomaster` | A 3v3 match in multiplayer |
| **P5 Platform** | ONNX policies in the page, shared links, URDF meshes, legged robots, a benchmark task set | E5, `robotics`, `gym` | A trained policy shared as a link |

### P0 in detail

- E1 in `src/sublevel/server.ts`: a joint table per space; `createImpulseJoint` between two sub-levels' bodies; collision
  groups so joined bodies don't push each other apart; joints removed when either side lands or is removed.
- Saving: joints as their own records (two sub-level ids, anchors in each one's local frame, axis, limits, motor),
  saved with the world. Sub-levels already save and replicate as entities; joints need the same.
- `mods/mechanics` (like `mods/aeronautics` in size): hinge, bearing and motor blocks. A motor block takes its target
  speed from redstone strength (or, through E3, from an Aeronautics helm or a Kinetics shaft if those mods are
  there).
- Assembling: `game.sublevels.assemble(cells)` takes the blocks it's given; which blocks belong together is the
  caller's choice (the Physics Assembler belongs to Aeronautics). `mechanics` gathers its own: the flood fill
  stops at a hinge or bearing, the far side becomes its own sub-level, and the two are joined there.
- Check: `mc launch`, build a cart with `mc build`, start it with redstone, follow it with `mc shot`.

## Risks

| Risk | Answer |
|---|---|
| Rapier's accuracy for legged robots | Wheels first; legs last. If Rapier isn't good enough, evaluate MuJoCo compiled to WebAssembly then. |
| Main-thread time | Move the server simulation into a Worker once robots or substeps make frames drop. |
| Training in Node | The server's world starts Vite inline workers; replace them in Node or train on saved chunks only (see Reinforcement learning). |
| Joints jamming between neighbouring links | Collision groups per assembly from P0. |
| Joints and Java Edition | Blueprints exports blocks only; exported machines lose their joints. Say so in the export screen. |
| Too much at once | Strict order. Nothing from P4 or P5 before P2 works end to end. |

## Research directions

- **Open-ended, user-built environments**: generalisation across maps players made, not maps researchers made.
- **Tasks from language**: a language model writes the task, the course and the reward in a voxel world.
- **Sim-to-real for RoboMaster sentries**: trained here, tested on the real robot.
- **Mixed human and AI matches**: people and policies in the same multiplayer game.
