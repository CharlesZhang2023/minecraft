// Aeronautics: physics contraptions in the spirit of Create: Aeronautics, on the game's sub-levels (moving block
// structures that keep their blocks in a shipyard plot, like Valkyrien Skies and Sable, simulated with Rapier).
//
// - blocks.ts   the blocks and items, their shapes and recipes (also runs in the mesher workers)
// - flight.ts   the server: what propellers, hot air, levitite, gyroscopes, the helm and the staff do to a sub-level
// - client.ts   spinning parts, the helm's controls and the flight readouts
// - art.ts      textures and sounds
import type { ModContext, Channel, PlayerBlockCtx, BlockCtx } from '../sdk';
import { registerBlocks, type Hooks, type Refs } from './blocks';
import { setupFlight, type HelmMsg, type HelmSet, type BurnerTile } from './flight';
import { setupClient } from './client';

let refs: Refs;
let helm: Channel<HelmMsg | HelmSet>;

export function main(mod: ModContext) {
  const H = {} as Hooks;
  helm = mod.channel<HelmMsg | HelmSet>('helm');
  refs = registerBlocks(mod, H);
  if (mod.realm !== 'page') return;
  const f = setupFlight(mod, refs, helm);

  /** Lift the structure the assembler is part of, or land the sub-level it's on. */
  const assembleOrLand = (c: BlockCtx, player: PlayerBlockCtx['player'] | null) => {
    const g = c.game, sl = g.sublevels;
    const say = (msg: string) => { if (player) g.ui.hud.actionBar(msg); };
    const ship = sl.containing(c.x, c.y, c.z);
    if (ship) {
      const err = sl.disassemble(ship);
      say(err ? `§cCan't land: ${err}` : '§aLanded: it\'s part of the world again');
      if (!err) g.audio.play('aeronautics:assemble', { x: ship.x, y: ship.y, z: ship.z }, 0.8, 0.7);
      return;
    }
    const cells = mod.mc.gatherStructure(c.world, c.x, c.y, c.z);
    if (!cells) { say(`§cToo big (more than ${mod.mc.PHYS.maxBlocks} blocks): is it joined to the ground?`); return; }
    const r = sl.assemble(cells, { owner: (player as { name?: string } | null)?.name ?? '', anchor: [c.x, c.y, c.z] });
    if (r.error || !r.ship) { say(`§c${r.error}`); return; }
    say(`§aAssembled: ${r.ship.blockCount} blocks, ${r.ship.mass.toFixed(0)} kpg`);
    g.audio.play('aeronautics:assemble', { x: r.ship.x, y: r.ship.y, z: r.ship.z }, 0.8, 1);
  };

  Object.assign(H, {
    assemblerUse: (c) => { assembleOrLand(c, c.player); return true; },
    // a redstone pulse does the same (on the next tick, not in the middle of the redstone update)
    assemblerRedstone: (c) => {
      const t = c.tile<{ on: boolean; pending: boolean }>();
      if (!t) return;
      const on = c.power() > 0;
      if (on && !t.on) t.pending = true;
      t.on = on;
    },
    assemblerTick: (c, t) => { if (t.pending) { t.pending = false; assembleOrLand(c, null); } },
    propTick: (c, t) => f.propTick(c, t as never),
    burnerTick: (c, t) => f.burnerTick(c, t as never),
    burnerUse: (c) => {
      const t = c.tile<BurnerTile>();
      if (!t) return false;
      t.lvl = t.lvl >= 15 ? 0 : Math.min(15, Math.floor(t.lvl / 5) * 5 + 5);
      c.tileChanged();
      c.game.ui.hud.actionBar(`Burner heat: ${t.lvl}/15${c.power() ? ' (redstone sets it while powered)' : ''}`);
      return true;
    },
    part: (c, kind) => { f.note(c, kind); },
    helmUse: (c) => { f.takeHelm(c); return true; },
    staffTick: (c) => { if (c.ticks === 0) f.grab(c.game, c.player, c.player.sneaking); },
    staffStop: (c) => f.release(c.player),
  } satisfies Hooks);
}

export function client(mod: ModContext) {
  setupClient(mod, refs, helm);
}
