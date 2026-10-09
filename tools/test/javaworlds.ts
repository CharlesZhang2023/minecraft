// Java Edition worlds for the Blueprints mod, without a browser: a chunk of every kind of block written the 1.18+
// way and read back; chunks in the older layouts (1.13's numeric biomes, entries packed across longs before 1.16,
// 1.16-1.17's "Level" compound) and the newest snapshots' (names as plain strings, `status`); stand-ins for newer
// blocks; region files and zips; level.dat and the player with their inventory.
//   node tools/test/run.mjs tools/test/javaworlds.ts
import { commonMc } from '../../src/mod/api';
import { initVanilla, toJava } from '../../mods/blueprints/vanilla';
import { initJavaWorld, readChunk, writeChunk, writeLevel, readLevel, playerToJava, playerFromJava, mobToJava, mobFromJava, worldBlock, biomeFromJava } from '../../mods/blueprints/javaworld';
import { RegionWriter, regionChunks, readRegionChunk } from '../../mods/blueprints/anvil';
import { ZipWriter, openZip } from '../../mods/blueprints/zip';
import * as N from '../../mods/blueprints/nbt';
import { check, eq, done } from './check';

initVanilla(commonMc as never);
initJavaWorld(commonMc as never);
const { BLOCKS, pack } = commonMc;
const id = (n: string) => BLOCKS.findIndex((b) => b?.name === n);
const name = (v: number) => `${BLOCKS[v & 0xfff].name}:${v >>> 12}`;

// ------------------------------------------------------------------ one chunk of everything, 1.18+ and back
const states: number[] = [];
for (let i = 1; i < BLOCKS.length; i++) {
  const d = BLOCKS[i];
  if (!d || d.missing || d.mod || d.name.startsWith('unused') || d.name === 'structure_void') continue;
  const seen = new Set<string>();
  for (let m = 0; m < 16; m++) { const v = pack(i, m), k = JSON.stringify(toJava(v)); if (!seen.has(k)) { seen.add(k); states.push(v); } }
}
const col = new Uint16Array(65536);
// one state every other block (so neighbours don't change what Java says of them), from y 1 up
states.forEach((v, k) => { const i = 256 + k * 2; if (i < 65536) col[i] = v; });
// (Java keeps biomes in 4 x 4 x 4 cells)
const biomes = new Uint8Array(256).map((_, i) => ((((i & 15) >> 2) + ((i >> 6) * 4)) % 7) + 1);
const chest = col.findIndex((v) => (v & 0xfff) === id('chest'));
const tiles: [number, Record<string, unknown>][] = [[chest, { type: 'chest', items: [{ id: commonMc.itemByName('diamond')!.id, count: 4 }, ...new Array(26).fill(null)] }]];
const javaChunk = writeChunk(3, -2, { blocks: col, biomes, tiles }, (x, y, z) => (x >> 4 === 3 && z >> 4 === -2 && y >= 0 && y < 256 ? col[(y * 16 + (z & 15)) * 16 + (x & 15)] : 0));
const back = readChunk(N.parse(N.write(javaChunk)).root, 'overworld')!;
let same = 0, diff = 0;
for (let i = 256; i < 65536; i++) {
  if (back.blocks[i] === col[i]) same++;
  else if (diff++ < 5) console.log('  differs at', i, name(col[i]), '->', name(back.blocks[i]));
}
eq(diff, 0, `every block state comes back from a Java chunk (${same} cells)`);
eq(back.blocks[0], pack(id('bedrock'), 0), 'bedrock where a 1.18 world goes on below');
check(back.biomes.every((b, i) => b === biomes[i]), 'biomes come back');
eq((back.tiles.find(([i]) => i === chest)?.[1] as { items: { count: number }[] })?.items[0]?.count, 4, 'the chest keeps its diamonds');

// ------------------------------------------------------------------ older layouts
const packAcross = (vals: number[], bits: number) => {
  // before 1.16: entries back to back across longs
  const longs = new BigInt64Array(Math.ceil((vals.length * bits) / 64));
  vals.forEach((v, i) => { const b = BigInt(i * bits), k = Number(b / 64n), o = b % 64n; longs[k] |= BigInt.asIntN(64, BigInt(v) << o); if (o + BigInt(bits) > 64n) longs[k + 1] |= BigInt(v) >> (64n - o); });
  return longs;
};
const packWhole = (vals: number[], bits: number) => {
  const per = Math.floor(64 / bits), longs = new BigInt64Array(Math.ceil(vals.length / per));
  vals.forEach((v, i) => { const l = Math.floor(i / per); longs[l] |= BigInt.asIntN(64, BigInt(v) << BigInt((i % per) * bits)); });
  return longs;
};
{
  // 1.13 (5 bits per entry, across longs), numeric biomes in 2D
  const names = ['air', 'stone', 'dirt', 'grass_block', 'oak_planks', 'glass', 'cobblestone', 'sand', 'gravel', 'oak_log', 'bricks', 'tnt', 'bookshelf', 'obsidian', 'glowstone', 'ice', 'clay'];
  const vals = Array.from({ length: 4096 }, (_, i) => (i * 13) % names.length);
  const pal = N.list('compound', names.map((n) => N.comp({ Name: N.str('minecraft:' + n) })));
  const level = N.comp({ xPos: N.int(0), zPos: N.int(0), Status: N.str('postprocessed'), Biomes: N.ints(new Array(256).fill(2)), Sections: N.list('compound', [N.comp({ Y: N.byte(4), Palette: pal, BlockStates: N.longs(packAcross(vals, 5)) })]) });
  const c = readChunk(N.comp({ DataVersion: N.int(1631), Level: level }), 'overworld')!;
  let ok = 0;
  for (let i = 0; i < 4096; i++) if (BLOCKS[c.blocks[4 * 4096 + i] & 0xfff].name === names[vals[i]]) ok++;
  eq(ok, 4096, '1.13 chunks (entries across longs)');
  eq(commonMc.BIOMES[c.biomes[0]].name, 'Desert', '1.13 biome numbers');
}
{
  // 1.16 (the Level compound, whole entries per long), 3D biome numbers
  const names = ['air', 'stone', 'grass_path', 'grass', 'cobblestone_wall'];
  const vals = Array.from({ length: 4096 }, (_, i) => i % 5);
  const pal = N.list('compound', names.map((n) => N.comp({ Name: N.str('minecraft:' + n), ...(n === 'cobblestone_wall' ? { Properties: N.comp({ north: N.str('true') }) } : {}) })));
  const level = N.comp({ Status: N.str('full'), Biomes: N.ints(new Array(1024).fill(5)), Sections: N.list('compound', [N.comp({ Y: N.byte(2), Palette: pal, BlockStates: N.longs(packWhole(vals, 4)) })]) });
  const c2 = readChunk(N.comp({ DataVersion: N.int(2586), Level: level }), 'overworld')!;
  eq(BLOCKS[c2.blocks[2 * 4096 + 2] & 0xfff].name, 'grass_path', '1.16 grass paths');
  eq(BLOCKS[c2.blocks[2 * 4096 + 3] & 0xfff].name, 'short_grass', '1.16 grass is short grass');
  eq(commonMc.BIOMES[c2.biomes[0]].name, 'Taiga', '1.16 biome numbers in 3D');
}
{
  // the newest snapshots: palette entries as names, `status`, `id`/`properties`; and blocks newer than this game
  const pal = N.list('compound', [N.comp({ id: N.str('minecraft:air') }), N.comp({ id: N.str('minecraft:oak_stairs'), properties: N.comp({ facing: N.str('west'), half: N.str('top') }) }), N.comp({ id: N.str('minecraft:deepslate_bricks') }), N.comp({ id: N.str('minecraft:cherry_planks') }), N.comp({ id: N.str('minecraft:waxed_oxidized_cut_copper_stairs'), properties: N.comp({ facing: N.str('south') }) })]);
  const vals = Array.from({ length: 4096 }, (_, i) => i % 5);
  const root = N.comp({ DataVersion: N.int(5122), status: N.str('minecraft:full'), sections: N.list('compound', [N.comp({ Y: N.byte(5), block_states: N.comp({ palette: pal, data: N.longs(packWhole(vals, 4)) }), biomes: N.comp({ palette: N.list('string', [N.str('minecraft:cherry_grove')]) }) })]) });
  const c = readChunk(root, 'overworld')!;
  const at = (i: number) => name(c.blocks[5 * 4096 + i]);
  eq(at(1), 'oak_stairs:7', 'stairs from the newest format');
  eq(at(2), 'stone_bricks:0', 'deepslate bricks stand in as stone bricks');
  eq(at(3), 'birch_planks:0', 'cherry planks stand in as birch');
  eq(BLOCKS[c.blocks[5 * 4096 + 4] & 0xfff].name, 'red_sandstone_stairs', 'oxidized cut copper stairs stand in as red sandstone stairs');
  eq(commonMc.BIOMES[biomeFromJava('minecraft:cherry_grove', 'overworld')].name, 'Flower Forest', 'a cherry grove is a flower forest here');
  eq(name(worldBlock({ name: 'minecraft:sculk_vein', props: {} })), 'air:0', 'thin newer things are left out');
}

// ------------------------------------------------------------------ region files and zips
{
  const w = new RegionWriter();
  await w.add(3, -2, javaChunk);
  await w.add(4, -2, N.comp({ DataVersion: N.int(3700), xPos: N.int(4) }));
  const bytes = w.finish();
  const list = regionChunks(bytes);
  eq(list.length, 2, 'a region file holds its chunks');
  const first = await readRegionChunk(bytes, list.find(([i]) => i === 3 + 30 * 32)![1]);
  eq(N.num(N.get(first!, 'zPos')), -2, 'and gives them back');
  const z = new ZipWriter();
  await z.add('World/region/r.0.-1.mca', bytes);
  await z.add('World/level.dat', new Uint8Array([1, 2, 3]));
  const ar = await openZip(z.finish());
  check(ar.names.includes('World/region/r.0.-1.mca'), 'zips list their files');
  eq((await ar.read('World/region/r.0.-1.mca')).length, bytes.length, 'and read them back');
}

// ------------------------------------------------------------------ level.dat and the player
{
  const sword = commonMc.itemByName('diamond_sword')!.id, helmet = commonMc.itemByName('iron_helmet')!.id;
  const p = { x: 10.5, y: 70, z: -3.5, yaw: 90, pitch: 10, health: 15, food: 18, saturation: 3, gameMode: 1, flying: true, xpLevel: 7, xpProgress: 0.5, xpTotal: 100,
    inventory: { main: [{ id: sword, count: 1, ench: { sharpness: 2 } }, ...new Array(35).fill(null)], armor: [{ id: helmet, count: 1 }, null, null, null], offhand: { id: commonMc.itemByName('torch')!.id, count: 10 }, selected: 0 } };
  const lvl = writeLevel({ name: 'Round Trip', seed: 123456789012345n, spawn: [8, 70, 8], time: 6000, gameMode: 1, hardcore: false, allowCommands: true, player: playerToJava(p, 'nether') });
  const read = readLevel(N.parse(await N.inflate(await N.writeFile(lvl))).root);
  eq(read.seedText, '123456789012345', 'the seed (a Java long)');
  eq(read.spawn.join(), '8,70,8', 'spawn');
  const pl = playerFromJava(read.player!, read.dataVersion);
  eq(pl.dim, 'nether', 'the player\'s dimension');
  const inv = pl.player.inventory as { main: { id: number; ench?: Record<string, number> }[]; armor: { id: number }[]; offhand: { count: number } };
  check(inv.main[0]?.id === sword && inv.main[0]?.ench?.sharpness === 2, 'the enchanted sword in the hotbar');
  eq(inv.armor[0]?.id, helmet, 'the helmet');
  eq(inv.offhand?.count, 10, 'the torches in the off hand');
  check(pl.player.flying === true && pl.player.gameMode === 1, 'creative and flying');
  const mob = mobFromJava(mobToJava({ type: 'zombie pigman', x: 1, y: 70, z: 2, yaw: 45, health: 12, baby: true })!, 3700)!;
  check(mob.type === 'zombified_piglin' && mob.baby === true && mob.health === 12, `mobs go round (${JSON.stringify(mob)})`);
}
done();
