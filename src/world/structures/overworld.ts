// Overworld structures of 1.16 (besides villages and strongholds, which have their own builders): desert
// pyramids, jungle temples, swamp huts, igloos, pillager outposts, ocean ruins, shipwrecks, buried treasure,
// mineshafts, woodland mansions, ocean monuments, desert wells, fossils and ruined portals. Each is laid out by
// its start (deterministic from the seed and region) and built chunk by chunk from pieces.
import { Random } from '../../noise';
import { B, B2, STONE2, WOOD, OPAQUE, BLOCKS, SEA_LEVEL, pack, idOf, CARPETS } from '../blocks';
import { BIOME, isOceanBiome } from '../biomes';
import { StructureType, Start, Piece, BuildCtx, bbox, BBox, union, fill, shell, pillarDown, GenAccess, template, placeTemplate, templateBox } from '../structure';
import { ruinedPortalPieces } from './ruins';

const X = STONE2;
const solid = (ctx: BuildCtx, x: number, y: number, z: number) => OPAQUE[idOf(ctx.get(x, y, z))] === 1;
const startOf = (type: string, x: number, y: number, z: number, pieces: Piece[]): Start => {
  let box = pieces[0].box;
  for (const p of pieces) box = union(box, p.box);
  return { type, x, y, z, pieces, box };
};
/** A piece from a box and a build function. */
const piece = (box: BBox, build: (ctx: BuildCtx, r: Random) => void): Piece => ({ box, build });
/** The lowest ground height under a rectangle (structures sit on the lowest corner, like vanilla's). */
const minHeight = (g: GenAccess, x0: number, z0: number, x1: number, z1: number) => Math.min(g.height(x0, z0), g.height(x1, z0), g.height(x0, z1), g.height(x1, z1), g.height((x0 + x1) >> 1, (z0 + z1) >> 1));

// ------------------------------------------------------------------ desert pyramid
function desertPyramid(g: GenAccess, cx: number, cz: number): Start | null {
  const x = cx * 16, z = cz * 16;
  if (g.biome(x + 10, z + 10) !== BIOME.DESERT) return null;
  const y = minHeight(g, x, z, x + 20, z + 20);
  if (y < SEA_LEVEL) return null;
  const SS = B.SANDSTONE, CUT = B.SMOOTH_SANDSTONE, CHIS = X.CHISELED_SANDSTONE, ORANGE = 1;
  return startOf('desert_pyramid', x, y, z, [piece(bbox(x, y - 14, z, x + 20, y + 15, z + 20), (ctx, r) => {
    // the foundation down to the sand, then the stepped pyramid
    for (let dx = 0; dx <= 20; dx++) for (let dz = 0; dz <= 20; dz++) pillarDown(ctx, x + dx, y - 1, z + dz, SS);
    for (let k = 0; k <= 9; k++) fill(ctx, bbox(x + k, y + k, z + k, x + 20 - k, y + k, z + 20 - k), SS);
    // hollow it: the hall inside, under two-block-thick steps
    for (let k = 1; k <= 7; k++) fill(ctx, bbox(x + k + 2, y + k, z + k + 2, x + 18 - k, y + k, z + 18 - k), 0);
    // corner towers with orange terracotta stripes, the entrance in the north face
    for (const [tx, tz] of [[x, z], [x + 16, z]]) {
      fill(ctx, bbox(tx, y, tz, tx + 4, y + 10, tz + 4), (xx, yy, zz) => (xx === tx || xx === tx + 4 || zz === tz || zz === tz + 4 ? (yy % 3 === 0 ? CUT : SS) : 0));
      fill(ctx, bbox(tx + 1, y + 11, tz + 1, tx + 3, y + 11, tz + 3), CUT);
      ctx.set(tx + 2, y + 7, tz, pack(TERRA[ORANGE]));
    }
    fill(ctx, bbox(x + 8, y + 1, z, x + 12, y + 4, z + 4), 0);
    for (let dx = 9; dx <= 11; dx++) ctx.set(x + dx, y + 5, z, CHIS);
    // the floor of the hall: blue and orange terracotta in a cross
    for (let dx = 8; dx <= 12; dx++) for (let dz = 8; dz <= 12; dz++) ctx.set(x + dx, y, z + dz, dx === 10 && dz === 10 ? pack(TERRA[11]) : (dx === 10 || dz === 10) ? pack(TERRA[ORANGE]) : CUT);
    // the treasure room under it: four chests and a pressure plate wired to TNT
    const ty = y - 12;
    shell(ctx, bbox(x + 7, ty - 1, z + 7, x + 13, y, z + 13), SS, 0);
    fill(ctx, bbox(x + 10, ty, z + 10, x + 10, y - 1, z + 10), 0);
    ctx.set(x + 10, ty, z + 10, B.STONE_PRESSURE_PLATE);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) ctx.set(x + 10 + dx, ty - 2, z + 10 + dz, B.TNT);
    for (const [dx, dz, f] of [[10, 8, 2], [10, 12, 0], [8, 10, 1], [12, 10, 3]] as const) ctx.chest(x + dx, ty, z + dz, 'desert_pyramid', pack(B.CHEST, f));
    for (let k = 0; k < 4; k++) ctx.set(x + 7 + r.int(7), ty + 2 + r.int(3), z + 7, CHIS);
  })]);
}
const TERRA = (() => { const out: number[] = []; for (const b of BLOCKS) if (b && /_terracotta$/.test(b.name) && !b.name.includes('glazed')) out.push(b.id); return out; })();

// ------------------------------------------------------------------ jungle temple
const JUNGLE_TEMPLE = template([
  ['MMMMMMMMMMMMMMM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MMMMMMMMMMMMMMM'],
  ['MMMMMMM.MMMMMMM', 'M.............M', 'M.MMMMMMMMMMM.M', 'M.M.........M.M', 'M.M.........M.M', 'M.M.........M.M', 'M.M.........M.M', 'M.M.........M.M', 'M.MMMMMMMMMMM.M', 'M.............M', 'MMMMMMMMMMMMMMM'],
  ['MMMMMMM.MMMMMMM', 'M.............M', 'M.M.........M.M', 'M.............M', 'M.............M', 'M.............M', 'M.............M', 'M.............M', 'M.M.........M.M', 'M.............M', 'MMMMMMMMMMMMMMM'],
  ['MMMMMMMMMMMMMMM', 'M.............M', 'M.MMMMMMMMMMM.M', 'M.............M', 'M.............M', 'M.............M', 'M.............M', 'M.............M', 'M.MMMMMMMMMMM.M', 'M.............M', 'MMMMMMMMMMMMMMM'],
  ['MMMMMMMMMMMMMMM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCC.......CCCM', 'MCCC.......CCCM', 'MCCC.......CCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MCCCCCCCCCCCCCM', 'MMMMMMMMMMMMMMM'],
  ['   MMMMMMMMM   ', '   M.......M   ', '   M.......M   ', '   M.......M   ', '   M.......M   ', '   M.......M   ', '   M.......M   ', '   MMMMMMMMM   '],
  ['   CCCCCCCCC   ', '   CCCCCCCCC   ', '   CCCCCCCCC   ', '   CCCCCCCCC   ', '   CCCCCCCCC   ', '   CCCCCCCCC   ', '   CCCCCCCCC   ', '   CCCCCCCCC   '],
], { M: B.MOSSY_COBBLESTONE, C: B.COBBLESTONE });
function jungleTemple(g: GenAccess, cx: number, cz: number): Start | null {
  const x = cx * 16, z = cz * 16;
  const b = g.biome(x + 7, z + 5);
  if (b !== BIOME.JUNGLE && b !== BIOME.BAMBOO_JUNGLE) return null;
  const y = minHeight(g, x, z, x + 14, z + 10);
  if (y < SEA_LEVEL) return null;
  const box = templateBox(JUNGLE_TEMPLE, x, y, z, 0);
  return startOf('jungle_temple', x, y, z, [piece(bbox(box.x0, y - 4, box.z0, box.x1, box.y1, box.z1), (ctx, r) => {
    for (let dx = 0; dx < 15; dx++) for (let dz = 0; dz < 11; dz++) pillarDown(ctx, x + dx, y - 1, z + dz, B.COBBLESTONE);
    placeTemplate(ctx, JUNGLE_TEMPLE, x, y, z, 0, (v) => (idOf(v) === B.COBBLESTONE && r.int(3) === 0 ? B.MOSSY_COBBLESTONE : v));
    // a basement with the hidden chest behind the lever puzzle, and a tripwire trap with an arrow dispenser
    shell(ctx, bbox(x + 2, y - 4, z + 2, x + 12, y, z + 8), B.MOSSY_COBBLESTONE, 0);
    ctx.set(x + 7, y, z + 1, 0); ctx.set(x + 7, y - 1, z + 2, pack(B.COBBLESTONE_STAIRS, 0));
    for (let k = 0; k < 3; k++) ctx.set(x + 5 + k * 2, y - 2, z + 2, pack(B.LEVER, 3));
    ctx.chest(x + 11, y - 3, z + 7, 'jungle_temple', pack(B.CHEST, 3));
    ctx.chest(x + 3, y - 3, z + 3, 'jungle_temple', pack(B.CHEST, 1));
    ctx.set(x + 7, y - 3, z + 5, pack(B2.TRIPWIRE_HOOK, 3)); ctx.set(x + 6, y - 3, z + 5, B2.TRIPWIRE); ctx.set(x + 5, y - 3, z + 5, pack(B2.TRIPWIRE_HOOK, 1));
    ctx.chest(x + 9, y - 3, z + 4, 'jungle_temple_dispenser', pack(B.DISPENSER, 3));
    // vines over the outside
    for (let k = 0; k < 30; k++) { const vx = x - 1 + r.int(17), vz = z + r.int(11); if (!solid(ctx, vx, y + 2 + r.int(4), vz)) ctx.set(vx, y + 2 + r.int(4), vz - 1, pack(B2.VINE, 4)); }
  })]);
}

// ------------------------------------------------------------------ swamp hut
function swampHut(g: GenAccess, cx: number, cz: number): Start | null {
  const x = cx * 16 + 4, z = cz * 16 + 4;
  if (g.biome(x + 3, z + 3) !== BIOME.SWAMP) return null;
  const y = Math.max(SEA_LEVEL, g.height(x + 3, z + 3)) + 2;
  const P = WOOD.spruce.planks, LOG = WOOD.oak.log;
  return startOf('swamp_hut', x, y, z, [piece(bbox(x, y - 8, z, x + 6, y + 6, z + 8), (ctx) => {
    for (const [dx, dz] of [[1, 2], [5, 2], [1, 7], [5, 7]]) { for (let k = 1; k < 8; k++) { if (solid(ctx, x + dx, y - k, z + dz)) break; ctx.set(x + dx, y - k, z + dz, LOG); } ctx.set(x + dx, y, z + dz, LOG); }
    fill(ctx, bbox(x + 1, y, z + 2, x + 5, y, z + 7), P);
    fill(ctx, bbox(x + 1, y + 1, z + 2, x + 5, y + 3, z + 7), (xx, yy, zz) => (xx === x + 1 || xx === x + 5 || zz === z + 2 || zz === z + 7 ? ((yy === y + 2 && (zz === z + 4 || zz === z + 5) && (xx === x + 1 || xx === x + 5)) ? B.OAK_FENCE : P) : 0));
    fill(ctx, bbox(x + 3, y + 1, z + 2, x + 3, y + 2, z + 2), 0);
    for (let dz = 1; dz <= 8; dz++) ctx.set(x, y + 4, z + dz, pack(WOOD.spruce.stairs, 1)), ctx.set(x + 6, y + 4, z + dz, pack(WOOD.spruce.stairs, 3));
    fill(ctx, bbox(x + 1, y + 4, z + 1, x + 5, y + 4, z + 8), P);
    ctx.set(x + 4, y + 1, z + 6, B2.CAULDRON);
    ctx.set(x + 2, y + 1, z + 6, B.CRAFTING_TABLE);
    ctx.set(x + 2, y + 2, z + 6, pack(B2.FLOWER_POT, 11));
    ctx.spawn('witch', x + 3.5, y + 1, z + 4.5, { persistentHostile: true });
    ctx.spawn('cat', x + 3.5, y + 1, z + 5.5, { variant: 'black' });
  })]);
}

// ------------------------------------------------------------------ igloo
function igloo(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  const x = cx * 16 + 4, z = cz * 16 + 4;
  const b = g.biome(x + 3, z + 3);
  if (b !== BIOME.SNOWY_PLAINS && b !== BIOME.SNOWY_TAIGA && b !== BIOME.ICE_SPIKES) return null;
  const y = g.height(x + 3, z + 3) + 1;
  const basement = r.bool();
  return startOf('igloo', x, y, z, [piece(bbox(x - 1, y - 12, z - 1, x + 8, y + 5, z + 8), (ctx) => {
    // a dome of snow blocks with a little entrance
    const cxw = x + 3.5, czw = z + 3.5;
    for (let dx = -1; dx <= 8; dx++) for (let dz = -1; dz <= 8; dz++) for (let dy = 0; dy <= 4; dy++) {
      const d = Math.hypot(x + dx + 0.5 - cxw, (dy - 0.5) * 1.15, z + dz + 0.5 - czw);
      if (d > 4.2) continue;
      ctx.set(x + dx, y + dy, z + dz, d > 3.2 ? B.SNOW_BLOCK : 0);
    }
    fill(ctx, bbox(x + 3, y, z - 1, x + 4, y + 1, z), 0);
    fill(ctx, bbox(x, y - 1, z, x + 7, y - 1, z + 7), B.SNOW_BLOCK);
    for (let k = 0; k < 3; k++) ctx.set(x + 2 + k, y - 1, z + 3, pack(CARPETS[0]));
    ctx.set(x + 5, y, z + 5, pack(B.BED, 0)); ctx.set(x + 5, y, z + 4, pack(B.BED, 8));
    ctx.set(x + 1, y, z + 5, pack(B.FURNACE, 1));
    ctx.set(x + 1, y, z + 4, B.CRAFTING_TABLE);
    ctx.set(x + 2, y + 2, z + 6, pack(B.TORCH, 0));
    if (basement) {
      // a trapdoor and a ladder down to the lab: a chest, a brewing stand, two cells with prisoners
      ctx.set(x + 3, y - 1, z + 3, pack(WOOD.oak.trapdoor, 0));
      const by = y - 10;
      shell(ctx, bbox(x - 1, by - 1, z - 1, x + 8, by + 3, z + 8), B.STONE_BRICKS, 0);
      for (let k = by; k < y - 1; k++) { ctx.set(x + 3, k, z + 3, pack(B.LADDER, 0)); ctx.set(x + 3, k, z + 2, B.STONE_BRICKS); }
      ctx.chest(x + 6, by, z + 6, 'igloo_chest', pack(B.CHEST, 0));
      ctx.set(x + 1, by, z + 6, B.BREWING_STAND);
      for (const dx of [1, 5]) { fill(ctx, bbox(x + dx, by, z, x + dx + 1, by + 1, z), B.IRON_BARS); }
      ctx.spawn('villager', x + 1.5, by, z + 0.5);
      ctx.spawn('zombie_villager', x + 5.5, by, z + 0.5);
    }
  })]);
}

// ------------------------------------------------------------------ pillager outpost
function outpost(g: GenAccess, cx: number, cz: number): Start | null {
  const x = cx * 16 + 4, z = cz * 16 + 4;
  const b = g.biome(x + 4, z + 4);
  if (![BIOME.PLAINS, BIOME.DESERT, BIOME.SAVANNA, BIOME.TAIGA, BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA, BIOME.SUNFLOWER_PLAINS].includes(b)) return null;
  const y = minHeight(g, x, z, x + 8, z + 8) + 1;
  if (y < SEA_LEVEL) return null;
  const D = WOOD.dark_oak, H = 24;
  return startOf('pillager_outpost', x, y, z, [piece(bbox(x - 3, y - 6, z - 3, x + 11, y + H + 3, z + 11), (ctx, r) => {
    for (let dx = 0; dx <= 8; dx++) for (let dz = 0; dz <= 8; dz++) pillarDown(ctx, x + dx, y - 1, z + dz, B.COBBLESTONE);
    // the watchtower: four floors of dark oak with birch and cobblestone, a lookout on top
    for (let fl = 0; fl < 4; fl++) {
      const fy = y + fl * 6;
      fill(ctx, bbox(x, fy, z, x + 8, fy, z + 8), fl === 0 ? B.COBBLESTONE : D.planks);
      fill(ctx, bbox(x, fy + 1, z, x + 8, fy + 5, z + 8), (xx, yy, zz) => {
        const edge = xx === x || xx === x + 8 || zz === z || zz === z + 8;
        const corner = (xx === x || xx === x + 8) && (zz === z || zz === z + 8);
        if (corner) return D.log;
        if (!edge) return 0;
        return yy === fy + 3 && (xx === x + 4 || zz === z + 4) ? D.fence : WOOD.birch.planks;
      });
      for (let k = 1; k <= 5; k++) ctx.set(x + 1, fy + k, z + 1, pack(B.LADDER, 0));
    }
    const top = y + 24;
    fill(ctx, bbox(x - 1, top, z - 1, x + 9, top, z + 9), D.planks);
    fill(ctx, bbox(x - 1, top + 1, z - 1, x + 9, top + 1, z + 9), (xx, _y, zz) => (xx === x - 1 || xx === x + 9 || zz === z - 1 || zz === z + 9 ? D.fence : 0));
    fill(ctx, bbox(x, top + 4, z, x + 8, top + 4, z + 8), D.slab);
    for (const [dx, dz] of [[0, 0], [8, 0], [0, 8], [8, 8]]) for (let k = 1; k < 4; k++) ctx.set(x + dx, top + k, z + dz, D.fence);
    ctx.chest(x + 4, top + 1, z + 4, 'pillager_outpost', pack(B.CHEST, r.int(4)));
    for (let k = 0; k < 3; k++) ctx.spawn('pillager', x + 2.5 + r.int(5), top + 1, z + 2.5 + r.int(5), { patrol: true, persistentHostile: true });
    for (let k = 0; k < 2; k++) ctx.spawn('pillager', x + 1.5 + k * 5, y + 1, z + 4.5, { persistentHostile: true });
    // a cage with an iron golem nearby, a target to shoot at
    const gx = x + 13, gz = z + 2;
    fill(ctx, bbox(gx, y, gz, gx + 3, y + 3, gz + 3), (xx, yy, zz) => (yy === y || yy === y + 3 ? D.planks : xx === gx || xx === gx + 3 || zz === gz || zz === gz + 3 ? B.IRON_BARS : 0));
    ctx.spawn('iron_golem', gx + 2, y + 1, gz + 2);
    ctx.set(x - 3, y, z + 12, B2.TARGET);
  })]);
}

// ------------------------------------------------------------------ ocean ruins
function oceanRuin(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  const x = cx * 16 + 2 + r.int(8), z = cz * 16 + 2 + r.int(8);
  const b = g.biome(x, z);
  if (!isOceanBiome(b)) return null;
  const warm = b === BIOME.WARM_OCEAN || b === BIOME.LUKEWARM_OCEAN || b === BIOME.DEEP_LUKEWARM_OCEAN;
  const big = r.int(10) < 3;
  const s = big ? 12 + r.int(5) : 5 + r.int(3);
  const y = g.height(x, z) + 1;
  if (y > SEA_LEVEL - 4) return null;
  const mat = warm ? [B.SANDSTONE, B.SMOOTH_SANDSTONE, X.CHISELED_SANDSTONE] : [B.STONE_BRICKS, B.MOSSY_STONE_BRICKS, B.CRACKED_STONE_BRICKS];
  return startOf('ocean_ruin', x, y, z, [piece(bbox(x - 1, y - 3, z - 1, x + s + 1, y + 7, z + s + 1), (ctx, pr) => {
    const blk = () => mat[pr.int(mat.length)];
    for (let dx = 0; dx <= s; dx++) for (let dz = 0; dz <= s; dz++) {
      const gy = (() => { let yy = y + 3; while (yy > y - 6 && !solid(ctx, x + dx, yy, z + dz)) yy--; return yy; })();
      ctx.set(x + dx, gy, z + dz, pr.int(4) ? blk() : B.GRAVEL);
      const edge = dx === 0 || dx === s || dz === 0 || dz === s;
      if (!edge) continue;
      // broken walls of irregular height
      const h = pr.int(big ? 5 : 3);
      for (let k = 1; k <= h; k++) ctx.set(x + dx, gy + k, z + dz, blk());
    }
    if (big) for (let k = 0; k < 3; k++) { const px = x + 2 + pr.int(s - 3), pz = z + 2 + pr.int(s - 3); for (let h = 1; h < 4; h++) ctx.set(px, y + h, pz, blk()); }
    ctx.chest(x + (s >> 1), y + 1, z + (s >> 1), big ? 'underwater_ruin_big' : 'underwater_ruin_small', pack(B.CHEST, pr.int(4)));
    for (let k = 0; k < (big ? 3 : 1); k++) ctx.spawn('drowned', x + 1.5 + pr.int(s - 1), y + 1, z + 1.5 + pr.int(s - 1));
  })]);
}

// ------------------------------------------------------------------ shipwrecks
function shipwreck(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  const x = cx * 16 + 4, z = cz * 16 + 4;
  const b = g.biome(x, z);
  const beached = b === BIOME.BEACH || b === BIOME.SNOWY_BEACH;
  if (!isOceanBiome(b) && !beached) return null;
  const y = g.height(x, z) + (beached ? 0 : 1);
  const alongX = r.bool(), upside = !beached && r.int(4) === 0, sideways = !upside && r.int(4) === 0;
  const W = WOOD[(['oak', 'spruce', 'dark_oak', 'jungle', 'birch', 'acacia'] as const)[r.int(6)]];
  const L = 22, half = 3;
  const at = (a: number, h: number, c: number): [number, number, number] => {
    let hh = h, cc = c;
    if (upside) hh = 6 - h;
    if (sideways) { const t = hh; hh = c + half; cc = t - half; }
    return alongX ? [x + a, y + hh, z + cc] : [x + cc, y + hh, z + a];
  };
  const box = alongX ? bbox(x - 1, y - 2, z - 6, x + L + 1, y + 10, z + 6) : bbox(x - 6, y - 2, z - 1, x + 6, y + 10, z + L + 1);
  return startOf('shipwreck', x, y, z, [piece(box, (ctx, pr) => {
    const S = (a: number, h: number, c: number, v: number) => { const [px, py, pz] = at(a, h, c); ctx.set(px, py, pz, v); };
    for (let a = 0; a < L; a++) {
      const w = Math.max(1, Math.round(half * Math.sin((Math.PI * (a + 1)) / (L + 1)) ** 0.5));
      if (pr.int(12) === 0) continue; // rotted gaps
      for (let c = -w; c <= w; c++) {
        S(a, 0, c, Math.abs(c) === w ? W.log : W.planks);
        if (Math.abs(c) === w) { S(a, 1, c, W.planks); if (a > 2 && a < L - 3 && pr.int(3)) S(a, 2, c, W.fence); }
      }
    }
    // the mast and the cabin
    for (let h = 1; h < 8; h++) S(11, h, 0, W.log);
    for (let a = 2; a < 6; a++) for (let c = -2; c <= 2; c++) for (let h = 1; h <= 3; h++) if (a === 2 || a === 5 || Math.abs(c) === 2 || h === 3) S(a, h, c, h === 3 ? W.slab : W.planks);
    const chestAt = (a: number, h: number, c: number, table: string) => { const [px, py, pz] = at(a, h, c); ctx.chest(px, py, pz, table, pack(B.CHEST, pr.int(4))); };
    chestAt(3, 1, 0, 'shipwreck_map');
    chestAt(16, 1, 1, 'shipwreck_supply');
    chestAt(19, 1, -1, 'shipwreck_treasure');
  })]);
}

// ------------------------------------------------------------------ buried treasure
function buriedTreasure(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  if (r.next() >= 0.01) return null;
  const x = cx * 16 + 9, z = cz * 16 + 9;
  const b = g.biome(x, z);
  if (b !== BIOME.BEACH && b !== BIOME.SNOWY_BEACH) return null;
  const y = g.height(x, z) - 2 - r.int(3);
  return startOf('buried_treasure', x, y, z, [piece(bbox(x, y, z, x, y, z), (ctx) => ctx.chest(x, y, z, 'buried_treasure', pack(B.CHEST, 0)))]);
}

// ------------------------------------------------------------------ mineshafts
function mineshaft(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  if (r.next() >= 0.4) return null;
  const x = cx * 16 + 8, z = cz * 16 + 8, y = 20 + r.int(20);
  const pieces: Piece[] = [];
  const boxes: BBox[] = [];
  const badlands = g.biome(x, z) === BIOME.BADLANDS || g.biome(x, z) === BIOME.WOODED_BADLANDS;
  const plank = badlands ? WOOD.dark_oak.planks : B.OAK_PLANKS, fence = badlands ? WOOD.dark_oak.fence : B.OAK_FENCE;
  // a central room with corridors branching off it, branching again (vanilla MineshaftPieces)
  const room = bbox(x - 5, y, z - 5, x + 5, y + 4, z + 5);
  pieces.push(piece(room, (ctx) => { fill(ctx, room, (xx, yy, zz) => (yy === room.y0 ? B.DIRT : 0)); }));
  boxes.push(room);
  const corridor = (sx: number, sy: number, sz: number, dir: number, depth: number, parent: BBox) => {
    if (depth > 6) return;
    const len = 6 + r.int(4) * 5;
    const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
    const ex = sx + dx * len, ez = sz + dz * len;
    const b = bbox(Math.min(sx, ex) - (dz ? 1 : 0), sy, Math.min(sz, ez) - (dx ? 1 : 0), Math.max(sx, ex) + (dz ? 1 : 0), sy + 2, Math.max(sz, ez) + (dx ? 1 : 0));
    // stay within the structure's reach (pieces further out would be cut off where chunks don't look for them)
    if (Math.abs(ex - x) > 70 || Math.abs(ez - z) > 70 || sy < 6) return;
    if (boxes.some((o) => o !== room && o !== parent && o.x0 <= b.x1 && o.x1 >= b.x0 && o.z0 <= b.z1 && o.z1 >= b.z0 && o.y0 <= b.y1 && o.y1 >= b.y0)) return;
    boxes.push(b);
    const seed = r.nextU32();
    pieces.push(piece(b, (ctx) => {
      const pr = new Random(seed);
      fill(ctx, b, 0);
      for (let k = 0; k <= len; k++) {
        const px = sx + dx * k, pz = sz + dz * k;
        if (k % 4 === 2) {
          // supports: two posts and a beam
          for (const w of [-1, 1]) for (let h = 0; h < 2; h++) ctx.set(px + (dz ? w : 0), sy + h, pz + (dx ? w : 0), fence);
          for (let w = -1; w <= 1; w++) ctx.set(px + (dz ? w : 0), sy + 2, pz + (dx ? w : 0), plank);
        }
        if (pr.int(3) === 0) ctx.set(px, sy, pz, pack(B.RAIL, dx ? 1 : 0));
        if (pr.int(10) === 0) ctx.set(px + (dz ? 1 : 0) * (pr.bool() ? 1 : -1), sy + 2, pz + (dx ? 1 : 0) * (pr.bool() ? 1 : -1), B.COBWEB);
        // a floor of planks where it crosses caves
        if (!solid(ctx, px, sy - 1, pz)) ctx.set(px, sy - 1, pz, plank);
      }
      if (pr.int(2) === 0) { const k = 1 + pr.int(len - 1); ctx.chest(sx + dx * k + (dz ? 1 : 0), sy, sz + dz * k + (dx ? 1 : 0), 'abandoned_mineshaft', pack(B.CHEST, dir)); }
      if (pr.int(8) === 0) { const k = 1 + pr.int(len - 1); ctx.spawner(sx + dx * k, sy, sz + dz * k, 'cave_spider'); for (let q = 0; q < 12; q++) ctx.set(sx + dx * k + pr.int(3) - 1, sy + pr.int(3), sz + dz * k + pr.int(3) - 1, B.COBWEB); }
    }));
    // branches at the end and now and then from the side
    if (r.int(4)) corridor(ex, sy + (r.int(4) === 0 ? r.int(3) - 1 : 0), ez, dir, depth + 1, b);
    if (r.int(2)) corridor(ex, sy, ez, (dir + 1) & 3, depth + 1, b);
    if (r.int(2)) corridor(ex, sy, ez, (dir + 3) & 3, depth + 1, b);
  };
  for (let d = 0; d < 4; d++) if (r.int(4)) corridor(x + [0, 6, 0, -6][d], y + 1, z + [-6, 0, 6, 0][d], d, 0, room);
  return startOf('mineshaft', x, y, z, pieces);
}

// ------------------------------------------------------------------ woodland mansion
function mansion(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  const x = cx * 16, z = cz * 16;
  if (g.biome(x + 15, z + 15) !== BIOME.DARK_FOREST) return null;
  const y = minHeight(g, x, z, x + 30, z + 30) + 1;
  if (y < SEA_LEVEL) return null;
  const D = WOOD.dark_oak, COB = B.COBBLESTONE, BIRCH = WOOD.birch.planks;
  const W = 30, Dp = 30, FL = 3, FH = 7;
  return startOf('woodland_mansion', x, y, z, [piece(bbox(x - 1, y - 8, z - 1, x + W + 1, y + FL * FH + 8, z + Dp + 1), (ctx) => {
    for (let dx = 0; dx <= W; dx++) for (let dz = 0; dz <= Dp; dz++) pillarDown(ctx, x + dx, y - 1, z + dz, COB);
    for (let f = 0; f < FL; f++) {
      const fy = y + f * FH;
      fill(ctx, bbox(x, fy, z, x + W, fy, z + Dp), f === 0 ? COB : BIRCH);
      fill(ctx, bbox(x, fy + 1, z, x + W, fy + FH - 1, z + Dp), (xx, yy, zz) => {
        const ox = xx - x, oz = zz - z, oy = yy - fy;
        const outer = ox === 0 || ox === W || oz === 0 || oz === Dp;
        const post = outer && (ox % 6 === 0) && (oz % 6 === 0 || oz === Dp);
        if (post) return D.log;
        if (outer) return oy === 3 && (ox % 3 === 1 || oz % 3 === 1) ? B.GLASS_PANE : D.planks;
        // rooms: inner walls every 10 blocks with doorways
        const wall = (ox % 10 === 0 || oz % 10 === 0);
        if (wall) return (ox % 10 === 5 || oz % 10 === 5) && oy < 3 ? 0 : D.planks;
        return 0;
      });
      // stairs up in the corner, carpets, a light in each room
      for (let k = 0; k < FH; k++) ctx.set(x + 2, fy + 1 + k, z + 2 + k, pack(D.stairs, 2));
      for (let rx = 0; rx < 3; rx++) for (let rz = 0; rz < 3; rz++) {
        const mx = x + 5 + rx * 10, mz = z + 5 + rz * 10;
        ctx.set(mx, fy + FH - 1, mz, B.GLOWSTONE);
        for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) ctx.set(mx + ox, fy + 1, mz + oz, pack(CARPETS[(rx * 3 + rz + f) % 16]));
        if ((rx + rz + f) % 3 === 0) ctx.chest(mx + 3, fy + 1, mz + 3, 'woodland_mansion', pack(B.CHEST, 0));
        if ((rx * 2 + rz + f) % 4 === 0) ctx.spawn(f === FL - 1 && rx === 1 && rz === 1 ? 'evoker' : 'vindicator', mx + 0.5, fy + 1, mz + 0.5, { persistentHostile: true });
      }
    }
    // the roof: cobblestone stairs stepping in
    const ry = y + FL * FH;
    for (let k = 0; k < 6; k++) fill(ctx, bbox(x - 1 + k, ry + k, z - 1 + k, x + W + 1 - k, ry + k, z + Dp + 1 - k), (xx, _yy, zz) => (xx === x - 1 + k || xx === x + W + 1 - k || zz === z - 1 + k || zz === z + Dp + 1 - k ? COB : 0));
  })]);
}

// ------------------------------------------------------------------ ocean monument
function monument(g: GenAccess, cx: number, cz: number): Start | null {
  const x = cx * 16 - 21, z = cz * 16 - 21;
  for (const [dx, dz] of [[0, 0], [58, 0], [0, 58], [58, 58], [29, 29]]) {
    const b = g.biome(x + dx, z + dz);
    if (b !== BIOME.DEEP_OCEAN && b !== BIOME.DEEP_COLD_OCEAN && b !== BIOME.DEEP_LUKEWARM_OCEAN && b !== BIOME.DEEP_FROZEN_OCEAN && (dx !== 29 || !isOceanBiome(b))) return null;
  }
  const y = 39, S = 57;
  const P = X.PRISMARINE, PB = X.PRISMARINE_BRICKS, DP = X.DARK_PRISMARINE, LAMP = X.SEA_LANTERN;
  return startOf('ocean_monument', x, y, z, [piece(bbox(x, y - 20, z, x + S, y + 23, z + S), (ctx, r) => {
    // the base: a broad platform on pillars down to the sea floor
    for (let dx = 0; dx <= S; dx += 7) for (let dz = 0; dz <= S; dz += 7) pillarDown(ctx, x + dx, y - 1, z + dz, P, 1);
    fill(ctx, bbox(x, y, z, x + S, y, z + S), PB);
    // the main hall: walls of prismarine, lit with sea lanterns, drained inside (vanilla monuments are full of water)
    const hall = bbox(x + 7, y + 1, z + 7, x + S - 7, y + 14, z + S - 7);
    fill(ctx, hall, (xx, yy, zz) => {
      const edge = xx === hall.x0 || xx === hall.x1 || zz === hall.z0 || zz === hall.z1 || yy === hall.y1;
      if (edge) return (xx + zz + yy) % 9 === 0 ? LAMP : (yy % 4 === 0 ? PB : P);
      return B.WATER;
    });
    // the wings and the roof steps, the entrance
    for (let k = 0; k < 6; k++) fill(ctx, bbox(x + 7 + k * 3, y + 15 + k, z + 7 + k * 3, x + S - 7 - k * 3, y + 15 + k, z + S - 7 - k * 3), (xx, _y, zz) => (xx === x + 7 + k * 3 || xx === x + S - 7 - k * 3 || zz === z + 7 + k * 3 || zz === z + S - 7 - k * 3 ? DP : null));
    for (const sx of [x, x + S - 7]) fill(ctx, bbox(sx, y + 1, z + 7, sx + 7, y + 8, z + S - 7), (xx, yy, zz) => (xx === sx || xx === sx + 7 || zz === z + 7 || zz === z + S - 7 || yy === y + 8 ? P : B.WATER));
    fill(ctx, bbox(x + 25, y + 1, z + 7, x + 32, y + 6, z + 7), B.WATER);
    // the core: eight gold blocks wrapped in dark prismarine
    const cxm = x + 28, czm = z + 28, cy = y + 4;
    fill(ctx, bbox(cxm - 2, cy - 1, czm - 2, cxm + 2, cy + 2, czm + 2), DP);
    fill(ctx, bbox(cxm - 1, cy, czm - 1, cxm, cy + 1, czm), B.GOLD_BLOCK);
    // a sponge room
    fill(ctx, bbox(x + 12, y + 1, z + 40, x + 16, y + 3, z + 44), (xx, yy, zz) => ((xx + yy + zz) % 2 ? B.SPONGE : B2.WET_SPONGE));
    // its guardians, and the three elders
    for (let k = 0; k < 6; k++) ctx.spawn('guardian', x + 10 + r.int(38) + 0.5, y + 2 + r.int(10), z + 10 + r.int(38) + 0.5);
    for (const [ex, ez] of [[14, 14], [43, 14], [28, 44]]) ctx.spawn('elder_guardian', x + ex + 0.5, y + 8, z + ez + 0.5);
  })]);
}

// ------------------------------------------------------------------ desert wells and fossils (rare features)
function desertWell(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  if (r.int(50)) return null;
  const x = cx * 16 + 6, z = cz * 16 + 6;
  if (g.biome(x, z) !== BIOME.DESERT) return null;
  const y = g.height(x + 2, z + 2);
  if (y < SEA_LEVEL) return null;
  return startOf('desert_well', x, y, z, [piece(bbox(x, y - 1, z, x + 4, y + 4, z + 4), (ctx) => {
    fill(ctx, bbox(x, y - 1, z, x + 4, y - 1, z + 4), B.SANDSTONE);
    fill(ctx, bbox(x, y, z, x + 4, y, z + 4), (xx, _y, zz) => (xx === x + 2 && zz === z + 2 ? B.WATER : (xx === x || xx === x + 4 || zz === z || zz === z + 4) ? pack(X.SANDSTONE_SLAB, 0) : B.SANDSTONE));
    fill(ctx, bbox(x + 1, y + 1, z + 1, x + 3, y + 1, z + 3), (xx, _y, zz) => (xx === x + 2 && zz === z + 2 ? B.WATER : B.SANDSTONE));
    ctx.set(x + 2, y, z + 2, B.WATER);
    for (const [dx, dz] of [[1, 1], [3, 1], [1, 3], [3, 3]]) for (let k = 2; k <= 3; k++) ctx.set(x + dx, y + k, z + dz, B.SANDSTONE);
    fill(ctx, bbox(x + 1, y + 4, z + 1, x + 3, y + 4, z + 3), pack(X.SANDSTONE_SLAB, 0));
  })]);
}
function fossil(g: GenAccess, cx: number, cz: number, r: Random): Start | null {
  if (r.int(64)) return null;
  const x = cx * 16 + 2, z = cz * 16 + 2;
  const b = g.biome(x, z);
  if (b !== BIOME.DESERT && b !== BIOME.SWAMP) return null;
  const y = g.height(x, z) - 15 - r.int(10);
  const len = 8 + r.int(5), coal = r.int(10) === 0;
  return startOf('fossil', x, y, z, [piece(bbox(x, y, z, x + len, y + 4, z + 6), (ctx, pr) => {
    for (let k = 0; k < len; k++) {
      ctx.set(x + k, y + 2, z + 3, pack(B2.BONE_BLOCK, 1));
      if (k % 2 === 0) for (let h = 0; h <= 4; h++) { ctx.set(x + k, y + h, z + 1, pack(B2.BONE_BLOCK, 0)); ctx.set(x + k, y + h, z + 5, pack(B2.BONE_BLOCK, 0)); if (h === 4) for (let w = 1; w <= 5; w++) ctx.set(x + k, y + h, z + w, pack(B2.BONE_BLOCK, 2)); }
    }
    if (coal) for (let k = 0; k < 6; k++) ctx.set(x + pr.int(len), y + pr.int(5), z + 1 + pr.int(5), B.COAL_ORE);
  })]);
}

export const OVERWORLD_STRUCTURES: StructureType[] = [
  { name: 'desert_pyramid', spacing: 32, separation: 8, salt: 14357617, reach: 2, layout: (g, cx, cz) => desertPyramid(g, cx, cz) },
  { name: 'jungle_temple', spacing: 32, separation: 8, salt: 14357619, reach: 1, layout: (g, cx, cz) => jungleTemple(g, cx, cz) },
  { name: 'swamp_hut', spacing: 32, separation: 8, salt: 14357620, reach: 1, layout: (g, cx, cz) => swampHut(g, cx, cz) },
  { name: 'igloo', spacing: 32, separation: 8, salt: 14357618, reach: 1, layout: igloo },
  { name: 'pillager_outpost', spacing: 32, separation: 8, salt: 165745296, reach: 2, layout: (g, cx, cz) => outpost(g, cx, cz) },
  { name: 'ocean_ruin', spacing: 20, separation: 8, salt: 14357621, reach: 2, layout: oceanRuin },
  { name: 'shipwreck', spacing: 24, separation: 4, salt: 165745295, reach: 2, layout: shipwreck },
  { name: 'buried_treasure', spacing: 2, separation: 1, salt: 10387320, reach: 0, layout: buriedTreasure },
  { name: 'mineshaft', spacing: 6, separation: 2, salt: 9283746, reach: 5, layout: mineshaft },
  { name: 'woodland_mansion', spacing: 80, separation: 20, salt: 10387319, reach: 3, triangular: true, layout: mansion },
  { name: 'ocean_monument', spacing: 32, separation: 5, salt: 10387313, reach: 4, triangular: true, layout: (g, cx, cz) => monument(g, cx, cz) },
  { name: 'desert_well', spacing: 4, separation: 2, salt: 12345671, reach: 1, layout: desertWell },
  { name: 'fossil', spacing: 4, separation: 2, salt: 12345672, reach: 1, layout: fossil },
  { name: 'ruined_portal', spacing: 40, separation: 15, salt: 34222645, reach: 2, layout: (g, cx, cz, r) => ruinedPortalPieces(g, cx, cz, r, 'overworld') },
];
