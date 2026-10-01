// Interactions that belong to the End: eyes in portal frames, thrown eyes, crystals, the dragon egg.
import type { Game } from './game';
import { B, pack, idOf, metaOf } from '../world/blocks';
import { FRAME_RING } from '../world/stronghold';
import { EyeOfEnder } from '../entity/eye';
import { EndCrystal } from '../entity/dragon';
import { Random } from '../noise';

const rng = new Random(Date.now() & 0xffff);

/** Put an eye into a frame; completes the portal when all twelve hold one. Returns whether the eye was used. */
export function eyeOnFrame(g: Game, x: number, y: number, z: number): boolean {
  const w = g.world!, v = w.get(x, y, z);
  if (idOf(v) !== B.END_PORTAL_FRAME || metaOf(v) & 4) return false;
  w.set(x, y, z, pack(B.END_PORTAL_FRAME, metaOf(v) | 4));
  g.audio.play('click', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 1, 0.6);
  for (let i = 0; i < 8; i++) g.particles?.spell(x + 0.5 + (rng.next() - 0.5) * 0.5, y + 1 + rng.next() * 0.3, z + 0.5 + (rng.next() - 0.5) * 0.5, 0x50d890);
  for (const [rx, rz] of FRAME_RING) {
    const cx = x - rx, cz = z - rz;
    if (!FRAME_RING.every(([ax, az]) => { const f = w.get(cx + ax, y, cz + az); return idOf(f) === B.END_PORTAL_FRAME && (metaOf(f) & 4) !== 0; })) continue;
    const changes: [number, number, number, number][] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) changes.push([cx + dx, y, cz + dz, B.END_PORTAL]);
    g.interact!.setAll(changes);
    g.audio.play('portalTrigger', { x: cx + 0.5, y: y + 0.5, z: cz + 0.5 }, 1.5, 0.7);
    for (let i = 0; i < 40; i++) g.particles?.spell(cx + 0.5 + (rng.next() - 0.5) * 3, y + 0.8, cz + 0.5 + (rng.next() - 0.5) * 3, 0x70e0ff);
    return true;
  }
  return true;
}

/** Throw an Eye of Ender: it flies toward the nearest stronghold. */
export function throwEye(g: Game) {
  const p = g.player!;
  const e = new EyeOfEnder(g.world!, g, g.meta?.seed ?? 0);
  e.setPos(p.x, p.y + p.height * 0.5, p.z);
  e.retarget();
  g.addEntity(e);
  g.audio.play('bow', p, 0.5, 0.5);
}

/** Right-click or knock: the dragon egg hops to a nearby empty spot. */
export function teleportEgg(g: Game, x: number, y: number, z: number) {
  const w = g.world!;
  const v = w.get(x, y, z);
  if (idOf(v) !== B.DRAGON_EGG) return;
  for (let i = 0; i < 1000; i++) {
    const nx = x + rng.int(16) - rng.int(16), ny = y + rng.int(8) - rng.int(8), nz = z + rng.int(16) - rng.int(16);
    if (ny < 1 || ny > 250 || w.getId(nx, ny, nz) !== B.AIR) continue;
    w.set(x, y, z, B.AIR);
    w.set(nx, ny, nz, v);
    for (let k = 0; k < 128; k++) {
      const f = rng.next();
      g.particles?.spell(x + (nx - x) * f + (rng.next() - 0.5) * 0.3 + 0.5, y + (ny - y) * f + rng.next() - 0.5 + 0.5, z + (nz - z) * f + (rng.next() - 0.5) * 0.3 + 0.5, 0xb030ff);
    }
    g.audio.play('enderman.teleport', { x: nx + 0.5, y: ny + 0.5, z: nz + 0.5 }, 0.8, 1);
    return;
  }
}

/** Place an End Crystal on top of obsidian or bedrock. */
export function placeCrystal(g: Game, x: number, y: number, z: number): boolean {
  const w = g.world!;
  const id = w.getId(x, y, z);
  if (id !== B.OBSIDIAN && id !== B.BEDROCK) return false;
  if (w.getId(x, y + 1, z) !== B.AIR || w.getId(x, y + 2, z) !== B.AIR) return false;
  for (const e of g.entities) if (e instanceof EndCrystal && !e.removed && Math.abs(e.x - (x + 0.5)) < 1 && Math.abs(e.z - (z + 0.5)) < 1 && Math.abs(e.y - (y + 1)) < 2) return false;
  const c = new EndCrystal(w, g);
  c.setPos(x + 0.5, y + 1, z + 0.5);
  g.addEntity(c);
  g.audio.play('dig.glass', { x: x + 0.5, y: y + 1, z: z + 0.5 }, 0.7, 1);
  return true;
}
