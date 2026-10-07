// Ruined portals (1.16): a broken obsidian frame with crying obsidian in it, a splatter of netherrack and magma
// around it, a bit of gold, lava and a chest. In the overworld they stand on the ground, sink into it, lie under
// water or hide in jungles and mountains; in the Nether they sit on the lava sea or a cavern floor.
import { Random } from '../../noise';
import { B, B2, OPAQUE, BLOCKS, pack, idOf } from '../blocks';
import { BIOME, isOceanBiome } from '../biomes';
import { Start, Piece, bbox, GenAccess } from '../structure';

export function ruinedPortalPieces(g: GenAccess, cx: number, cz: number, r: Random, dim: 'overworld' | 'nether'): Start | null {
  const x = cx * 16 + 4 + r.int(8), z = cz * 16 + 4 + r.int(8);
  const giant = r.int(20) === 0;
  const w = giant ? 6 + r.int(4) : 4, h = giant ? 8 + r.int(4) : 5; // outer frame size
  const alongX = r.bool();
  const biome = g.biome(x, z);
  let y: number;
  let place: 'surface' | 'buried' | 'underwater' | 'lava' | 'floor';
  if (dim === 'nether') {
    place = r.int(2) ? 'lava' : 'floor';
    y = place === 'lava' ? 32 : Math.max(33, g.height(x, z) + 1);
  } else {
    const ground = g.height(x, z);
    if (isOceanBiome(biome) || ground < 62) { place = 'underwater'; y = ground + 1; }
    else { place = r.int(3) === 0 ? 'buried' : 'surface'; y = ground + 1 - (place === 'buried' ? 2 + r.int(3) : 0); }
  }
  const jungle = biome === BIOME.JUNGLE || biome === BIOME.BAMBOO_JUNGLE || biome === BIOME.JUNGLE_EDGE;
  const desert = biome === BIOME.DESERT;
  const spread = giant ? 9 : 6;
  const box = bbox(x - spread, y - 4, z - spread, x + w + spread, y + h + 2, z + spread);
  const piece: Piece = {
    box,
    build(ctx, pr) {
      const at = (i: number, j: number): [number, number, number] => (alongX ? [x + i, y + j, z] : [x, y + j, z + i]);
      // the ground around: netherrack, magma and (in the overworld) a little gold; the frame's base never floats
      for (let dx = -spread; dx <= spread + w; dx++)
        for (let dz = -spread; dz <= spread; dz++) {
          const px = alongX ? x + dx : x + dz, pz = alongX ? z + dz : z + dx;
          if (!ctx.inChunk(px, pz)) continue;
          const d = Math.hypot(dx - w / 2, dz) / spread;
          if (d > 1 || pr.next() < d * 0.9) continue;
          // the top solid block of the column near the portal's base
          let gy = y + 2;
          while (gy > y - 6 && !OPAQUE[idOf(ctx.get(px, gy, pz))]) gy--;
          if (gy <= y - 6) { if (place === 'lava') ctx.set(px, y - 1, pz, pr.int(4) ? B.NETHERRACK : B.MAGMA_BLOCK); continue; }
          const k = pr.int(100);
          ctx.set(px, gy, pz, k < 55 ? B.NETHERRACK : k < 75 ? B.MAGMA_BLOCK : k < 77 && dim === 'overworld' ? B.GOLD_BLOCK : desert ? B.SANDSTONE : B.NETHERRACK);
          if (k > 92 && dim === 'overworld' && !BLOCKS[idOf(ctx.get(px, gy + 1, pz))].solid) ctx.set(px, gy + 1, pz, jungle ? B2.VINE : B.NETHERRACK);
        }
      // the frame: obsidian with crying obsidian, pieces missing (more of them toward the top)
      for (let i = 0; i < w; i++)
        for (let j = 0; j < h; j++) {
          const edge = i === 0 || i === w - 1 || j === 0 || j === h - 1;
          if (!edge) continue;
          const [px, py, pz] = at(i, j);
          if (j > 0 && pr.next() < 0.12 + (j / h) * 0.3) continue;
          ctx.set(px, py, pz, pr.next() < 0.15 ? B2.CRYING_OBSIDIAN : B.OBSIDIAN);
        }
      // the inside is cleared (it may have been buried)
      for (let i = 1; i < w - 1; i++) for (let j = 1; j < h - 1; j++) { const [px, py, pz] = at(i, j); if (place !== 'underwater' && place !== 'buried') ctx.set(px, py, pz, 0); }
      // a fallen block or two of frame lying about
      for (let k = 0; k < 2; k++) {
        const px = x + pr.int(spread * 2) - spread, pz = z + pr.int(spread * 2) - spread;
        let gy = y + 3;
        while (gy > y - 5 && !OPAQUE[idOf(ctx.get(px, gy, pz))]) gy--;
        if (gy > y - 5) ctx.set(px, gy + 1, pz, B.OBSIDIAN);
      }
      // lava (not under water) and the chest
      if (place !== 'underwater') {
        const [lx, ly, lz] = at(-2, 0);
        if (OPAQUE[idOf(ctx.get(lx, ly - 1, lz))]) ctx.set(lx, ly, lz, B.LAVA);
      }
      const [qx, qy, qz] = alongX ? [x + w + 1, y, z + 1] : [x + 1, y, z + w + 1];
      ctx.chest(qx, qy, qz, 'ruined_portal', pack(B.CHEST, pr.int(4)));
      if (!OPAQUE[idOf(ctx.get(qx, qy - 1, qz))]) ctx.set(qx, qy - 1, qz, B.NETHERRACK);
    },
  };
  return { type: 'ruined_portal', x, y, z, pieces: [piece], box };
}
