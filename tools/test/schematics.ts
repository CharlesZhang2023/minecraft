// The Blueprints mod's file side, without a browser: every block state of the game in Java Edition's words and
// back, every state through every file format and target version (exactly, with the game's own names along, and
// as Java alone would read it), the renames between versions, Litematica's bit packing and negative sizes,
// Sponge version 3, and block entities (chests with enchanted items, signs) in each version's shape.
//   node tools/test/run.mjs tools/test/schematics.ts
import { commonMc } from '../../src/mod/api';
import { initVanilla, toJava, fromJava, gameName, upgrade, downgrade, VERSIONS } from '../../mods/blueprints/vanilla';
import { initFormats, readSchematic, writeSchematic } from '../../mods/blueprints/formats';
import { stateKey, type Schematic, type BlockState } from '../../mods/blueprints/model';
import { tileToNbt, tileFromNbt } from '../../mods/blueprints/tiles';
import * as N from '../../mods/blueprints/nbt';
import { check, eq, done } from './check';

initVanilla(commonMc as never);
initFormats(gameName);
const { BLOCKS, pack } = commonMc;
const id = (n: string) => BLOCKS.findIndex((b) => b?.name === n);

// ------------------------------------------------------------------ every state, both ways
/** One block value for each distinct Java state. */
const states: number[] = [];
let lossless = 0;
for (let i = 0; i < BLOCKS.length; i++) {
  const d = BLOCKS[i];
  if (!d || d.missing || d.mod || d.name.startsWith('unused_')) continue;
  const seen = new Set<string>();
  for (let m = 0; m < 16; m++) {
    const v = pack(i, m), j = toJava(v), k = stateKey(j);
    if (seen.has(k)) continue;
    seen.add(k);
    states.push(v);
    const back = fromJava({ name: j.name, props: j.props });
    if (back === v) lossless++;
    else check(false, `${d.name}:${m} is ${k} in Java, which comes back as ${back === null ? 'nothing' : gameName(back)}`);
  }
}
console.log(`${lossless} distinct states come back from their Java names`);
check(toJava(pack(id('oak_stairs'), 5)).props.facing === 'east', 'stairs face east');
eq(stateKey(toJava(pack(id('redstone_torch'), 2))), 'minecraft:redstone_wall_torch[facing=west,lit=true]', 'a wall torch is its own Java block');
eq(stateKey(toJava(pack(id('repeater'), 0))), 'minecraft:repeater[delay=1,facing=south,locked=false,powered=false]', 'a repeater faces its input in Java');
eq(stateKey(toJava(pack(id('cauldron'), 2))), 'minecraft:water_cauldron[level=2]', 'cauldrons with water');
eq(stateKey(toJava(pack(id('flower_pot'), 8))), 'minecraft:potted_poppy', 'pots with plants');

// ------------------------------------------------------------------ versions
eq(downgrade({ name: 'minecraft:short_grass', props: {} }, 2586).name, 'minecraft:grass', 'short grass was grass in 1.16');
eq(downgrade({ name: 'minecraft:short_grass', props: {} }, 3700).name, 'minecraft:short_grass', '...and short grass in 1.20.4');
eq(downgrade({ name: 'minecraft:iron_chain', props: {} }, 4556).name, 'minecraft:iron_chain', 'iron chain in 1.21.10');
eq(downgrade({ name: 'minecraft:iron_chain', props: {} }, 4440).name, 'minecraft:chain', 'chain before 1.21.9');
eq(downgrade({ name: 'minecraft:dirt_path', props: {} }, 2586).name, 'minecraft:grass_path', 'grass path in 1.16');
eq(stateKey(downgrade({ name: 'minecraft:water_cauldron', props: { level: '2' } }, 2586)), 'minecraft:cauldron[level=2]', 'a cauldron of water in 1.16');
eq(stateKey(upgrade({ name: 'minecraft:cauldron', props: { level: '3' } }, 2586)), 'minecraft:water_cauldron[level=3]', '...and back');
eq(upgrade({ name: 'minecraft:grass', props: {} }, 3465).name, 'minecraft:short_grass', 'grass from 1.20.1 is short grass');
eq(upgrade({ name: 'minecraft:sign', props: {} }, 1631).name, 'minecraft:oak_sign', 'signs from 1.13 are oak signs');
eq(stateKey(upgrade({ name: 'minecraft:cobblestone_wall', props: { north: 'true', south: 'false' } }, 2230)), 'minecraft:cobblestone_wall[north=low,south=none]', 'walls before 1.16');

// ------------------------------------------------------------------ every state through every format and version
// plus a state only this game tells apart (a lily pad's turn): the game's own name carries it in .litematic and .nbt
const variant = pack(id('lily_pad'), 2);
const pal: BlockState[] = [{ name: 'minecraft:air', props: {} }];
for (const v of [...states, variant]) { const j = toJava(v); j.game = gameName(v); pal.push(j); }
const n = pal.length;
const w = Math.ceil(Math.sqrt(n)), all: Schematic = {
  id: '', name: 'Every block', author: 'test', description: '', created: 1, modified: 2, dataVersion: 0, source: 'game',
  regions: [{ name: 'All', pos: [0, 0, 0], size: [w, 1, Math.ceil(n / w)], palette: pal, blocks: new Uint16Array(w * Math.ceil(n / w)), tiles: [], entities: [] }],
};
all.regions[0].blocks.forEach((_, i, a) => { a[i] = i < n ? i : 0; });
for (const fmt of ['litematic', 'schem', 'nbt'] as const) {
  for (const [vname, dv] of VERSIONS) {
    const out = await writeSchematic(all, fmt, dv);
    const r = (await readSchematic(out.data, 'x')).schematic.regions[0];
    let exact = 0, java = 0, expected = 0;
    for (let i = 1; i < n; i++) {
      const st = r.palette[r.blocks[i]], want = pal[i];
      // .schem has no structure voids (they're air there) and one block per Java state: what that version's Java
      // can't tell apart (a lava cauldron before 1.17) stays what Java says
      const javaWant = fromJava(upgrade(downgrade({ name: want.name, props: want.props }, dv), dv));
      if (fmt === 'schem' && (want.name === 'minecraft:structure_void' || want.game === gameName(variant) || javaWant !== fromJava(want))) continue;
      expected++;
      if (fromJava(st) === fromJava(want)) exact++;
      else if (process.env.DEBUG) console.log('  exact', fmt, vname, stateKey(want), want.game, '->', stateKey(st), st.game);
      // as Java would read it: no game names, and only what that version can say
      if (fromJava({ name: st.name, props: st.props }) === javaWant) java++;
      else if (process.env.DEBUG) console.log('  java', fmt, vname, stateKey(want), '->', stateKey(st));
    }
    eq(exact, expected, `${fmt} for ${vname}: every block comes back exactly`);
    eq(java, expected, `${fmt} for ${vname}: every block comes back by its Java name`);
  }
}

// ------------------------------------------------------------------ Litematica: bit packing, negative sizes
{
  // 5 palette entries (3 bits): entries straddle the longs
  const names = ['air', 'stone', 'dirt', 'oak_planks', 'glass'];
  const size = [-7, 3, 5];
  const vals = Array.from({ length: 7 * 3 * 5 }, (_, i) => (i * 7) % 5);
  const longs = new BigInt64Array(Math.ceil((vals.length * 3) / 64));
  vals.forEach((v, i) => { const bit = BigInt(i * 3); const k = Number(bit / 64n), o = bit % 64n; longs[k] |= BigInt.asIntN(64, BigInt(v) << o); if (o > 61n) longs[k + 1] |= BigInt(v) >> (64n - o); });
  const root = N.comp({
    MinecraftDataVersion: N.int(3700), Version: N.int(6),
    Metadata: N.comp({ Name: N.str('Packed'), Author: N.str('t') }),
    Regions: N.comp({
      R: N.comp({
        Position: N.comp({ x: N.int(10), y: N.int(0), z: N.int(0) }),
        Size: N.comp({ x: N.int(size[0]), y: N.int(size[1]), z: N.int(size[2]) }),
        BlockStatePalette: N.list('compound', names.map((x) => N.comp({ Name: N.str('minecraft:' + x) }))),
        BlockStates: N.longs(longs),
        TileEntities: N.list('compound', []), Entities: N.list('compound', []),
      }),
    }),
  });
  const s = (await readSchematic(await N.writeFile(root), 'p.litematic')).schematic, r = s.regions[0];
  eq(r.pos.join(), '4,0,0', 'a negative size reaches back from the position');
  let same = 0;
  for (let i = 0; i < vals.length; i++) if (r.palette[r.blocks[i]].name === 'minecraft:' + names[vals[i]]) same++;
  eq(same, vals.length, 'bits that straddle longs unpack');
}

// ------------------------------------------------------------------ Sponge version 3
{
  const pal3 = N.comp({ 'minecraft:air': N.int(0), 'minecraft:oak_stairs[facing=west,half=top,shape=straight,waterlogged=false]': N.int(1), 'minecraft:chest[facing=north,type=single,waterlogged=false]': N.int(2) });
  const root = N.comp({
    Schematic: N.comp({
      Version: N.int(3), DataVersion: N.int(3700), Width: N.short(3), Height: N.short(1), Length: N.short(1),
      Blocks: N.comp({
        Palette: pal3, Data: N.bytes(Int8Array.from([0, 1, 2])),
        BlockEntities: N.list('compound', [N.comp({ Pos: N.ints([2, 0, 0]), Id: N.str('minecraft:chest'), Data: N.comp({ Items: N.list('compound', [N.comp({ Slot: N.byte(4), id: N.str('minecraft:diamond'), Count: N.byte(7) })]) }) })]),
      }),
    }),
  });
  const s = (await readSchematic(await N.writeFile(root), 'v3.schem')).schematic, r = s.regions[0];
  eq(gameName(fromJava(r.palette[r.blocks[1]])!), 'oak_stairs:7', 'Sponge v3 blocks');
  const t = tileFromNbt(r.tiles[0].nbt!, 'minecraft:chest', 3700) as { items: ({ count: number } | null)[] };
  eq(t?.items[4]?.count, 7, 'Sponge v3 block entities');
}

// ------------------------------------------------------------------ block entities by version
{
  const diamond = commonMc.itemByName('diamond_sword')!.id;
  const chest = { type: 'chest', items: [{ id: diamond, count: 1, damage: 5, ench: { sharpness: 3 }, name: 'Edge' }, null] };
  for (const dv of [2586, 3700, 3839, 4671]) {
    const nbt = tileToNbt(chest, 'minecraft:chest', dv)!;
    const item = N.items(N.get(nbt, 'Items'))[0];
    if (dv >= 3837) check(N.get(item, 'count') && N.get(item, 'components'), `items have components from 1.20.5 (${dv})`);
    else check(N.get(item, 'Count') && N.get(item, 'tag'), `items have tags before 1.20.5 (${dv})`);
    const back = tileFromNbt(nbt, 'minecraft:chest', dv) as { items: { id: number; damage?: number; ench?: Record<string, number>; name?: string }[] };
    const s = back.items[0];
    check(s.id === diamond && s.damage === 5 && s.ench?.sharpness === 3 && s.name === 'Edge', `an enchanted, named, worn sword survives (${dv}): ${JSON.stringify(s)}`);
  }
  const sign = { type: 'sign', lines: ['one', 'two', '', ''] };
  for (const dv of [2586, 3700, 4671]) {
    const nbt = tileToNbt(sign, 'minecraft:oak_sign', dv)!;
    check(dv >= 3463 ? !!N.get(nbt, 'front_text') : !!N.get(nbt, 'Text1'), `signs in ${dv}'s shape`);
    eq((tileFromNbt(nbt, 'minecraft:oak_sign', dv) as { lines: string[] }).lines.join('|'), 'one|two||', `sign text comes back (${dv})`);
  }
}

done();
