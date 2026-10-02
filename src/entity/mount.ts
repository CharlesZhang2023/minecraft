// Things a player can ride (boats, minecarts, horses) and how the rider is carried.
import type { Entity } from './entity';
import { offset } from './entity';

export interface Mount {
  x: number; y: number; z: number; yaw: number;
  dismount(): void;
  /** The rider's view is clamped to this many degrees either side of the mount's heading (180 = free). */
  lookLimit?: number;
  /** The rider's body faces the way the mount does (boats, horses) rather than where they look (minecarts). */
  bodyFollows?: boolean;
}

/**
 * Moves the rider with its mount. Both the current and the previous-tick position follow the mount, so the
 * rider (and the camera) interpolate exactly like the mount does instead of snapping once per tick.
 */
export function carryRider(m: Entity, r: Entity, dy: number, back = 0) {
  const a = (m.yaw * Math.PI) / 180, pa = (m.pyaw * Math.PI) / 180;
  r.x = m.x + Math.sin(a) * back; r.y = m.y + dy; r.z = m.z - Math.cos(a) * back;
  r.px = m.px + Math.sin(pa) * back; r.py = m.py + dy; r.pz = m.pz - Math.cos(pa) * back;
  r.vx = r.vy = r.vz = 0;
  r.onGround = true;
  r.fallDistance = 0;
}

/** Turns the rider by the mount's turn this tick (interpolated) and keeps it looking within the limit. */
export function turnRider(m: Entity, r: Entity, turn: number, limit: number) {
  r.yaw += turn;
  if (limit >= 180) return;
  let d = r.yaw - m.yaw;
  d = ((d % 360) + 540) % 360 - 180;
  const c = Math.max(-limit, Math.min(limit, d));
  r.yaw += c - d;
  r.pyaw += c - d;
}

/** Where to put a rider getting off: beside the mount if there's room, else on top. */
export function dismountSpot(m: Entity, r: Entity): [number, number, number] {
  const a = (m.yaw * Math.PI) / 180;
  const side = m.width / 2 + r.width / 2 + 0.05;
  const rx = Math.cos(a), rz = Math.sin(a);
  const tries: [number, number][] = [[rx, rz], [-rx, -rz], [-Math.sin(a), Math.cos(a)], [Math.sin(a), -Math.cos(a)]];
  for (const [dx, dz] of tries)
    for (const dy of [0, 1, -1]) {
      const x = m.x + dx * side, z = m.z + dz * side, y = Math.floor(m.y) + dy;
      const box = offset(r.box, x - r.x, y - r.y, z - r.z);
      if (r.collisions(box).length) continue;
      // something to stand on
      const below = offset(box, 0, -0.6, 0);
      if (r.collisions(below).length) return [x, y + 0.01, z];
    }
  // nothing to stand on (out on the water): beside the mount anyway
  for (const [dx, dz] of tries) {
    const x = m.x + dx * side, z = m.z + dz * side;
    if (!r.collisions(offset(r.box, x - r.x, m.y - r.y, z - r.z)).length) return [x, m.y, z];
  }
  return [m.x, m.y + m.height + 0.05, m.z];
}
