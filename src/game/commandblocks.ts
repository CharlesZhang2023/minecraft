// Command blocks (1.4-1.16): an impulse block runs its command once when powered, a repeating one every tick while
// powered (or always, when set to), and a chain block runs when the block pointing into it has run. Conditional
// ones only run if the block behind them succeeded. Coordinates (~) and selector distances are the block's own,
// @s is nobody, and commands written without a target act on the nearest player. Comparators read the last
// success count.
import type { Game } from './game';
import { BLOCKS, COMMAND_BLOCKS, FACING6, idOf, metaOf } from '../world/blocks';
import type { World } from '../world/world';

export interface CommandTile { type: 'command'; cmd: string; auto: boolean; powered: boolean; success: number; last: string }
const [IMPULSE, CHAIN, REPEAT] = COMMAND_BLOCKS;
export const commandTile = (w: World, x: number, y: number, z: number): CommandTile => {
  const t = w.getTile(x, y, z) as unknown as CommandTile | undefined;
  if (t?.type === 'command') return t;
  const n: CommandTile = { type: 'command', cmd: '', auto: idOf(w.get(x, y, z)) === CHAIN, powered: false, success: 0, last: '' };
  w.setTile(x, y, z, n as never);
  return n;
};

/** Run one block's command (if its conditions hold); then whatever chain it points into. */
function execute(g: Game, x: number, y: number, z: number, depth = 0) {
  const w = g.world!, v = w.get(x, y, z), id = idOf(v), m = metaOf(v);
  if (!COMMAND_BLOCKS.includes(id) || depth > 64) return;
  const t = commandTile(w, x, y, z);
  if (id === CHAIN && depth === 0) return;
  const [dx, dy, dz] = FACING6[m & 7];
  let ok = true;
  if (m & 8) {
    // conditional: the block behind must be a command block that just succeeded
    const bx = x - dx, by = y - dy, bz = z - dz;
    const bt = COMMAND_BLOCKS.includes(w.getId(bx, by, bz)) ? commandTile(w, bx, by, bz) : null;
    ok = !!bt && bt.success > 0;
  }
  if (ok && t.cmd.trim()) {
    const out = runAsWorld(g, t.cmd, x, y, z);
    t.last = out[0]?.replace(/§./g, '') ?? '';
    t.success = out.some((l) => l.startsWith('§c')) ? 0 : 1;
  } else t.success = 0;
  w.setTile(x, y, z, t as never);
  g.redstone.update(x, y, z);
  // the chain: the block this one points into, if it's a chain block that's set to run
  const nx = x + dx, ny = y + dy, nz = z + dz;
  if (w.getId(nx, ny, nz) === CHAIN) {
    const nt = commandTile(w, nx, ny, nz);
    if (nt.auto || g.redstone.isPowered(nx, ny, nz)) execute(g, nx, ny, nz, depth + 1);
  }
}
/** Run a command from the block (its position for ~ and selectors; the nearest player when no target is given). */
function runAsWorld(g: Game, cmd: string, x: number, y: number, z: number): string[] {
  const near = g.players.filter((q) => q.dim === g.world!.dimension).sort((a, b) => Math.hypot(a.entity.x - x, a.entity.y - y, a.entity.z - z) - Math.hypot(b.entity.x - x, b.entity.y - y, b.entity.z - z))[0];
  const at = { x: x + 0.5, y, z: z + 0.5 }, src = { self: null, name: '@' };
  return near ? g.asActor(near, () => g.commands.run(cmd, at, src)) : g.commands.run(cmd, at, src);
}

/** Redstone around a command block changed: impulse blocks fire on the rising edge, repeating ones start ticking. */
export function commandRedstone(g: Game, x: number, y: number, z: number) {
  const w = g.world!, id = w.getId(x, y, z), t = commandTile(w, x, y, z);
  const powered = g.redstone.isPowered(x, y, z);
  if (powered === t.powered) return;
  t.powered = powered;
  w.setTile(x, y, z, t as never);
  if (powered && !t.auto && id !== CHAIN) g.ticker!.schedule(x, y, z, 1);
}
/** The scheduled run: once for impulse blocks, again next tick for repeating ones that are still on. */
export function commandTick(g: Game, x: number, y: number, z: number) {
  const w = g.world!, id = w.getId(x, y, z), t = commandTile(w, x, y, z);
  if (id === IMPULSE) execute(g, x, y, z);
  else if (id === REPEAT && (t.auto || t.powered)) { execute(g, x, y, z); g.ticker!.schedule(x, y, z, 1); }
}
/** "Always active" was switched on, or the block placed: start it if it should run. */
export function commandKick(g: Game, x: number, y: number, z: number) {
  const w = g.world!, id = w.getId(x, y, z), t = commandTile(w, x, y, z);
  if ((t.auto || t.powered) && id !== CHAIN) g.ticker!.schedule(x, y, z, 1);
}

for (const id of COMMAND_BLOCKS) BLOCKS[id].behavior = {
  ...BLOCKS[id].behavior,
  redstone: { update: (c) => commandRedstone(c.game as unknown as Game, c.x, c.y, c.z) },
  // (power arriving from a wire or a block next to it shows up as a neighbour change)
  neighborChanged: (c) => commandRedstone(c.game as unknown as Game, c.x, c.y, c.z),
  scheduledTick: (c) => commandTick(c.game as unknown as Game, c.x, c.y, c.z),
};
