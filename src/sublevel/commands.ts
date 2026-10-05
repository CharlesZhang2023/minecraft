// Gathering a structure to assemble, and the /sublevel command (for building and testing sub-levels by hand).
import type { Game } from '../game/game';
import type { World } from '../world/world';
import type { Player } from '../game/player';
import { BLOCKS, B, idOf } from '../world/blocks';
import { SubLevel } from './ship';
import { PHYS } from './server';
import { qyaw } from './pose';

/** The ground: never pulled along into a sub-level (so assembling a ship doesn't take the hill it sits on). */
const GROUND = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'farmland', 'stone', 'granite', 'diorite', 'andesite', 'sand', 'red_sand',
  'gravel', 'clay', 'bedrock', 'water', 'lava', 'netherrack', 'soul_sand', 'end_stone', 'snow', 'ice', 'packed_ice', 'short_grass', 'fern', 'tall_grass',
  'large_fern', 'dead_bush', 'obsidian', 'sandstone', 'terracotta', 'mossy_cobblestone', 'gravel']);
export function isGround(v: number): boolean {
  const def = BLOCKS[idOf(v)];
  return !def || def.fluid || GROUND.has(def.name) || /_ore$/.test(def.name);
}

/**
 * The blocks connected to (x, y, z) through their faces, the ground excepted: what a Physics Assembler there
 * would lift. Null if there are more than `limit` (it's probably joined to the landscape).
 */
export function gatherStructure(w: World, x: number, y: number, z: number, limit = PHYS.maxBlocks): [number, number, number][] | null {
  const seen = new Set<string>(), out: [number, number, number][] = [];
  const queue: [number, number, number][] = [[x, y, z]];
  seen.add(x + ',' + y + ',' + z);
  while (queue.length) {
    const [cx, cy, cz] = queue.pop()!;
    const v = w.get(cx, cy, cz);
    if (!v || (isGround(v) && !(cx === x && cy === y && cz === z))) continue;
    if (!w.chunkAt(cx, cz)) return null;
    out.push([cx, cy, cz]);
    if (out.length > limit) return null;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz;
      if (ny < 0 || ny > 255) continue;
      const k = nx + ',' + ny + ',' + nz;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  return out;
}

/** The sub-level nearest to a player (or by id). */
function pick(g: Game, p: Player, arg: string | undefined): SubLevel {
  const list = g.sublevels.list();
  if (arg && /^\d+$/.test(arg)) {
    const s = list.find((o) => o.id === Number(arg));
    if (!s) throw new Error(`No sub-level ${arg}`);
    return s;
  }
  const s = [...list].sort((a, b) => a.distanceTo(p) - b.distanceTo(p))[0];
  if (!s) throw new Error('There are no sub-levels here');
  return s;
}

export function sublevelCommand(g: Game, p: Player, args: string[], coord: (s: string, base: number) => number): string[] {
  const sub = (args[0] ?? 'list').toLowerCase();
  const w = g.world!, sl = g.sublevels;
  switch (sub) {
    case 'assemble': {
      let cells: [number, number, number][] | null;
      if (args.length >= 7) {
        const [x0, y0, z0, x1, y1, z1] = args.slice(1, 7).map((a, i) => Math.floor(coord(a, [p.x, p.y, p.z][i % 3])));
        if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite)) throw new Error('Usage: /sublevel assemble <x1 y1 z1 x2 y2 z2>');
        cells = [];
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
          for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(255, Math.max(y0, y1)); y++)
            for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) if (w.get(x, y, z) && idOf(w.get(x, y, z)) !== B.BEDROCK) cells.push([x, y, z]);
      } else {
        const t = g.target;
        if (!t || t.ship) throw new Error('Look at a block of the structure (or give a box: /sublevel assemble x1 y1 z1 x2 y2 z2)');
        cells = gatherStructure(w, t.x, t.y, t.z);
        if (!cells) throw new Error(`Too big (over ${PHYS.maxBlocks} blocks): is it joined to the ground?`);
      }
      const r = sl.assemble(cells, { owner: g.playerOf(p)?.name ?? '' });
      if (r.error) throw new Error(r.error);
      return [`Assembled sub-level ${r.ship!.id}: ${r.ship!.blockCount} blocks, ${r.ship!.mass.toFixed(1)} kpg`];
    }
    case 'land': case 'disassemble': {
      const s = pick(g, p, args[1]);
      const err = sl.disassemble(s, { force: args.includes('force') });
      if (err) throw new Error(`Can't land: ${err}`);
      return [`Sub-level ${s.id} is part of the world again`];
    }
    case 'remove': {
      const s = pick(g, p, args[1]);
      sl.remove(s);
      return [`Removed sub-level ${s.id}`];
    }
    case 'anchor': {
      const s = pick(g, p, args[1]);
      const on = args[2] ? args[2] !== 'off' : !s.anchored;
      sl.anchor(s, on);
      return [`Sub-level ${s.id} ${on ? 'anchored' : 'free'}`];
    }
    case 'push': {
      const s = pick(g, p, args[1]);
      const v = args.slice(2, 5).map(Number);
      if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error('Usage: /sublevel push <id> <vx> <vy> <vz> (m/s)');
      sl.setVelocity(s, [s.lin[0] + v[0], s.lin[1] + v[1], s.lin[2] + v[2]]);
      return [`Pushed sub-level ${s.id}`];
    }
    case 'spin': {
      const s = pick(g, p, args[1]);
      const v = args.slice(2, 5).map(Number);
      if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error('Usage: /sublevel spin <id> <wx> <wy> <wz> (rad/s)');
      sl.setVelocity(s, null, [v[0], v[1], v[2]]);
      return [`Spun sub-level ${s.id}`];
    }
    case 'tp': {
      const s = pick(g, p, args[1]);
      const c = args.slice(2, 5).map((a, i) => coord(a, [p.x, p.y, p.z][i]));
      if (c.length !== 3 || !c.every(Number.isFinite)) throw new Error('Usage: /sublevel tp <id> <x> <y> <z>');
      sl.teleport(s, c[0], c[1], c[2]);
      return [`Moved sub-level ${s.id}`];
    }
    case 'name': {
      const s = pick(g, p, args[1]);
      s.label = args.slice(2).join(' ').slice(0, 32);
      return [`Named sub-level ${s.id} "${s.label}"`];
    }
    case 'list': {
      const list = sl.list();
      if (!list.length) return ['No sub-levels in this dimension'];
      return list.map((s) => `§e${s.id}§r ${s.label ? '"' + s.label + '" ' : ''}${s.blockCount} blocks, ${s.mass.toFixed(0)} kpg at ${s.x.toFixed(1)} ${s.y.toFixed(1)} ${s.z.toFixed(1)}, heading ${qyaw(s.q).toFixed(0)}, ${Math.hypot(...s.lin).toFixed(1)} m/s${s.anchored ? ', anchored' : ''}`);
    }
    case 'physics': return sl.stats().map((s) => JSON.stringify(s));
    default:
      throw new Error('Usage: /sublevel <assemble|land|list|anchor|push|spin|tp|name|remove|physics> [id] ...');
  }
}
