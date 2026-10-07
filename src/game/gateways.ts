// End gateways (vanilla 1.9+): each Ender Dragon kill opens a gateway floating in a ring 96 blocks from the
// middle of the main island. Flying into one (or throwing an ender pearl through it) takes you ~1000 blocks
// out to the outer islands, where a return gateway is built ten blocks above where you land.
import type { Game } from './game';
import type { World } from '../world/world';
import { B } from '../world/blocks';
import { Random } from '../noise';
import { EndGen } from '../world/endgen';

export interface Gateway {
  x: number; y: number; z: number;
  /** Where it sends you; worked out (and the return gateway made) the first time it's used. */
  exit?: [number, number, number];
  built?: boolean;
}

const MAIN_RING = 96, MAIN_Y = 75, OUTER = 1024;

let gen: EndGen | null = null;
function terrain(seed: number) {
  if (!gen || gen.seed !== seed) gen = new EndGen(seed);
  return gen;
}

/** Ring positions in the order the dragon kills open them (shuffled per world like vanilla). */
function ringSpot(seed: number, n: number): [number, number] {
  const order = Array.from({ length: 20 }, (_, i) => i);
  const r = new Random(seed ^ 0x6a7e);
  for (let i = order.length - 1; i > 0; i--) { const j = r.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const a = 2 * (-Math.PI + 0.15707963 * order[n % 20]);
  return [Math.floor(MAIN_RING * Math.cos(a)), Math.floor(MAIN_RING * Math.sin(a))];
}

/** The dragon died: open the next gateway in the ring (up to 20). */
export function openGateway(g: Game) {
  const meta = g.meta;
  if (!meta) return;
  const list = (meta.gateways ??= []);
  const main = list.filter((gw) => Math.hypot(gw.x, gw.z) < 500).length;
  if (main >= 20) return;
  const [x, z] = ringSpot(meta.seed, main);
  list.push({ x, y: MAIN_Y, z });
  g.gatewayBeam = { x, y: MAIN_Y, z, until: g.ticks + 200 };
  buildPending(g);
}

/** Gateway frame: the portal block between bedrock caps, open on all four sides. */
function build(w: World, x: number, y: number, z: number) {
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -1; dz <= 1; dz++) {
        const cx = dx === 0, cz = dz === 0, mid = dy === 0, cap = Math.abs(dy) === 2;
        let v: number = B.AIR;
        if (cx && cz && mid) v = B.END_GATEWAY;
        else if (mid) v = B.AIR;
        else if (cap && cx && cz) v = B.BEDROCK;
        else if ((cx || cz) && !cap) v = B.BEDROCK;
        w.set(x + dx, y + dy, z + dz, v);
      }
}

/** Build gateways whose chunks have loaded since they were made (World.set ignores unloaded chunks). */
export function buildPending(g: Game) {
  const w = g.world, meta = g.meta;
  if (!w || w.dimension !== 'end' || !meta?.gateways) return;
  for (const gw of meta.gateways) {
    if (gw.built || !w.chunkAt(gw.x - 1, gw.z - 1) || !w.chunkAt(gw.x + 1, gw.z + 1) || !w.chunkAt(gw.x - 1, gw.z + 1) || !w.chunkAt(gw.x + 1, gw.z - 1)) continue;
    build(w, gw.x, gw.y, gw.z);
    gw.built = true;
  }
  for (const isl of meta.endIslands ?? []) {
    if (isl.built || [[-8, -8], [8, -8], [-8, 8], [8, 8]].some(([dx, dz]) => !w.chunkAt(isl.x + dx, isl.z + dz))) continue;
    smallIsland(w, isl.x, isl.y, isl.z, isl.seed);
    isl.built = true;
  }
}

/** A little end stone island (vanilla EndIslandFeature), for gateways that point into empty void. */
function smallIsland(w: World, x: number, y: number, z: number, seed: number) {
  const r = new Random(seed);
  let rad = r.int(3) + 4;
  for (let dy = 0; rad > 0.5; dy--) {
    for (let dx = -Math.floor(rad); dx <= Math.ceil(rad); dx++)
      for (let dz = -Math.floor(rad); dz <= Math.ceil(rad); dz++)
        if (dx * dx + dz * dz <= (rad + 1) * (rad + 1)) w.set(x + dx, y + dy, z + dz, B.END_STONE);
    rad -= r.int(2) + 0.5;
  }
}

/** Top of the natural terrain at (x, z), or null over the void. */
function surface(seed: number, x: number, z: number): number | null {
  const c = terrain(seed).column(x, z);
  return c ? c[1] + 1 : null;
}

/** Work out where a gateway leads, making the return gateway (or an island to land on) as needed. */
function resolveExit(g: Game, gw: Gateway): [number, number, number] {
  const meta = g.meta!;
  const seed = meta.seed;
  if (Math.hypot(gw.x, gw.z) < 500) {
    // out along the gateway's bearing to the first land past 1024 blocks
    const d = Math.hypot(gw.x, gw.z) || 1, ux = gw.x / d, uz = gw.z / d;
    let land: [number, number, number] | null = null;
    for (let t = OUTER; t < OUTER + 1024 && !land; t += 16) {
      const x = Math.round(ux * t), z = Math.round(uz * t);
      if (surface(seed, x, z) === null) continue;
      // the highest ground near there
      let best: [number, number, number] | null = null;
      for (let ox = -16; ox <= 16; ox += 2)
        for (let oz = -16; oz <= 16; oz += 2) {
          const top = surface(seed, x + ox, z + oz);
          if (top !== null && (!best || top > best[1])) best = [x + ox, top, z + oz];
        }
      land = best;
    }
    if (!land) {
      // nothing out there: make an island to land on
      const x = Math.round(ux * OUTER), z = Math.round(uz * OUTER);
      (meta.endIslands ??= []).push({ x, y: 60, z, seed: (seed ^ (x * 31 + z)) >>> 0 });
      land = [x, 61, z];
    }
    meta.gateways!.push({ x: land[0], y: land[1] + 10, z: land[2], exit: [gw.x, gw.y, gw.z] });
    return land;
  }
  // an outer gateway with no link (old save): back to the main island
  return [0, 0, 0];
}

/** Ground to stand on near a main-ring gateway: walk in toward the island until there's land. */
function nearMainIsland(seed: number, x: number, z: number): [number, number, number] {
  const d = Math.hypot(x, z) || 1;
  for (let t = 0; t < d; t++) {
    const px = Math.round(x - (x / d) * t), pz = Math.round(z - (z / d) * t);
    const top = surface(seed, px, pz);
    if (top !== null) return [px, top, pz];
  }
  return [0, 65, 0];
}

/** Something went into the gateway at (x, y, z): send the player through. */
export function enterGateway(g: Game, x: number, y: number, z: number) {
  const meta = g.meta, p = g.player;
  if (!meta || !p || g.portalCooldown > 0) return;
  const list = (meta.gateways ??= []);
  let gw = list.find((e) => e.x === x && e.y === y && e.z === z);
  if (!gw) { gw = { x, y, z, built: true }; list.push(gw); }
  let to: [number, number, number];
  if (Math.hypot(gw.x, gw.z) < 500) {
    if (!gw.exit) gw.exit = resolveExit(g, gw);
    to = gw.exit;
  } else {
    const back = gw.exit ?? [0, MAIN_Y, 0];
    to = nearMainIsland(meta.seed, back[0], back[2]);
  }
  g.portalCooldown = 40;
  g.gatewayBeam = { x, y, z, until: g.ticks + 40 };
  p.setPos(to[0] + 0.5, to[1], to[2] + 0.5);
  p.vx = p.vy = p.vz = 0;
  g.achievements.event('gateway');
  g.audio.play('portalTravel', null, 0.5, 1.4);
  buildPending(g);
}
