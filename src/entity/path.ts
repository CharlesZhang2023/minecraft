// Small A* pathfinder over walkable block positions.
import type { World } from '../world/world';
import { BLOCKS, B, idOf } from '../world/blocks';

export interface PathNode { x: number; y: number; z: number }

function passable(w: World, x: number, y: number, z: number, avoidWater: boolean): boolean {
  const id = idOf(w.get(x, y, z));
  if (id === B.AIR) return true;
  const d = BLOCKS[id];
  if (d.fluid) return !avoidWater || id === B.WATER;
  if (id === B.FIRE || id === B.CACTUS || id === B.LAVA) return false;
  if (id === B.OAK_DOOR) return false;
  return !d.solid;
}
function standable(w: World, x: number, y: number, z: number): boolean {
  const id = idOf(w.get(x, y - 1, z));
  const d = BLOCKS[id];
  if (id === B.OAK_FENCE || id === B.NETHER_BRICK_FENCE || id === B.CACTUS || id === B.LAVA || id === B.FIRE) return false;
  return d.solid || id === B.WATER;
}
function danger(w: World, x: number, y: number, z: number): boolean {
  const id = w.getId(x, y, z);
  return id === B.LAVA || id === B.FIRE || id === B.CACTUS || w.getId(x, y - 1, z) === B.LAVA;
}

export function findPath(w: World, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, height: number, maxNodes = 400, maxDrop = 3): PathNode[] | null {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const clear = (x: number, y: number, z: number) => {
    for (let h = 0; h < height; h++) if (!passable(w, x, y + h, z, false)) return false;
    return true;
  };
  const open: { x: number; y: number; z: number; g: number; f: number }[] = [];
  const came = new Map<string, string>();
  const gScore = new Map<string, number>();
  const h = (x: number, y: number, z: number) => Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(z - tz);
  open.push({ x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz) });
  gScore.set(key(sx, sy, sz), 0);
  let best = open[0];
  let bestH = h(sx, sy, sz);
  let expanded = 0;
  while (open.length && expanded < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    expanded++;
    const ch = h(cur.x, cur.y, cur.z);
    if (ch < bestH) { bestH = ch; best = cur; }
    if (cur.x === tx && cur.z === tz && Math.abs(cur.y - ty) <= 1) { best = cur; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, nz = cur.z + dz;
      let ny = cur.y;
      if (clear(nx, ny, nz)) {
        // drop down
        let drop = 0;
        while (!standable(w, nx, ny, nz) && drop <= maxDrop && ny > 1) { ny--; drop++; }
        if (drop > maxDrop || !standable(w, nx, ny, nz)) continue;
      } else if (clear(nx, ny + 1, nz) && passable(w, cur.x, cur.y + height, cur.z, false) && standable(w, nx, ny + 1, nz)) {
        ny++;
      } else continue;
      if (danger(w, nx, ny, nz)) continue;
      const k = key(nx, ny, nz);
      const g = cur.g + 1 + (w.getId(nx, ny, nz) === B.WATER ? 2 : 0);
      if (g >= (gScore.get(k) ?? Infinity)) continue;
      gScore.set(k, g);
      came.set(k, key(cur.x, cur.y, cur.z));
      open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz) * 1.1 });
    }
  }
  if (best.x === sx && best.y === sy && best.z === sz) return null;
  const path: PathNode[] = [];
  let k: string | undefined = key(best.x, best.y, best.z);
  while (k && k !== key(sx, sy, sz)) {
    const [x, y, z] = k.split(',').map(Number);
    path.unshift({ x, y, z });
    k = came.get(k);
  }
  return path;
}
