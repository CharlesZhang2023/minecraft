# Progress

The working log for [plan.md](plan.md): what is done, the test output that shows it, the decisions taken from
plan.md's Defaults, and what is blocked. Kept up to date after every item, so it is the place to start reading.

Branch: `robotics` · Started: — · Last updated: —

## Status

| Phase | Status | Last commit |
|---|---|---|
| Baseline | not started | |
| P0 Joints | not started | |
| P1 Assemblies and URDF | not started | |
| P2 Lockstep and Gym | not started | |
| P3 Sensors and ROS | not started | |
| P4 RoboMaster | not started | |
| P5 Platform | not started | |

Status is one of: not started · in progress · done · blocked (for the user).

## Baseline

`node tools/test/all.mjs` on `main` before any change, with the dev server on port 5177: which scenarios pass and
which already fail. "No new failures" in plan.md's Acceptance is measured against this.

```
(output)
```

## P0 Joints

Each acceptance check from plan.md, ticked when it passes, with the command's output.

- [ ] Cart
- [ ] Pendulum
- [ ] No jamming
- [ ] Saving
- [ ] Removing
- [ ] Unchanged without joints
- [ ] Every phase: check, all.mjs, build, READMEs

```
(output)
```

## P1 Assemblies and URDF

- [ ] urdfparse.ts
- [ ] E2 physics settings and `subLevelSubstep`
- [ ] E3 mod services
- [ ] E4 agent methods from mods
- [ ] Mass
- [ ] diffbot
- [ ] mecanum
- [ ] gimbal
- [ ] arm6
- [ ] Teleoperation
- [ ] Every phase

```
(output)
```

## P2 Lockstep and Gym

- [ ] pause / step / reset
- [ ] Replays
- [ ] Batching (numbers: — )
- [ ] pytest and check_env
- [ ] Lander baseline (mean return: — , landing rate: — )
- [ ] Lander trained (landing rate: — )
- [ ] Node headless
- [ ] Every phase

```
(output)
```

## P3 Sensors and ROS

- [ ] Lidar
- [ ] Depth
- [ ] Segmentation
- [ ] IMU
- [ ] Link camera
- [ ] rosbridge with the stand-in server
- [ ] Real ROS 2 and Nav2
- [ ] Every phase

```
(output)
```

## P4 RoboMaster

- [ ] Field from rules.json
- [ ] Armour plates
- [ ] Heat and power limits
- [ ] Match end
- [ ] 3v3
- [ ] Dataset
- [ ] Multiplayer
- [ ] Every phase

```
(output)
```

## P5 Platform

- [ ] Policies in the page
- [ ] Shared link
- [ ] Meshes
- [ ] Legged robot (standing; walking result: — )
- [ ] Benchmark
- [ ] Every phase

```
(output)
```

## Decision log

Every choice made from plan.md's Defaults, or otherwise without the user. Newest last.

| Date | Phase | Decision | Why |
|---|---|---|---|

## Blocked

Items that need the user, with what was tried and how to finish them.

| Item | Why | Tried | To finish |
|---|---|---|---|

## Findings

Things learned about the code or the tools that the plan didn't know.
