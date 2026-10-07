// Registry sanity: unique names, vanilla ids below the item range, every texture has a painter, families wired up.
//   node tools/test/run.mjs tools/test/registry.ts
import { BLOCKS, TEXTURES, BLOCK_COUNT, SHAPE, Shape, blockByName } from '../../src/world/blocks';
import { ITEMS, VANILLA_ITEM_COUNT, itemByName } from '../../src/game/items';
import { hasTexture } from '../../src/render/textures';
import { getItemSprite } from '../../src/render/itemsprites';
import { check, done } from './check';

const names = new Set<string>();
for (const b of BLOCKS.slice(0, BLOCK_COUNT)) {
  check(!names.has(b.name), 'duplicate block name ' + b.name);
  names.add(b.name);
}
check(BLOCK_COUNT < 1000, `vanilla blocks must stay below the item ids (${BLOCK_COUNT})`);
const itemNames = new Set<string>();
for (const it of ITEMS.values()) {
  check(!itemNames.has(it.name), 'duplicate item name ' + it.name);
  itemNames.add(it.name);
}
// slabs/stairs/walls name a base block that exists; logs name a stripped form that exists
for (const b of BLOCKS.slice(0, BLOCK_COUNT)) {
  if (b.base) check(!!blockByName(b.base), `${b.name}: base ${b.base} missing`);
  if (b.stripped) check(!!blockByName(b.stripped), `${b.name}: stripped ${b.stripped} missing`);
  if (b.sapling) check(!!blockByName(b.sapling), `${b.name}: sapling ${b.sapling} missing`);
  if (typeof b.drop === 'string') check(!!itemByName(b.drop), `${b.name}: drop ${b.drop} missing`);
}
const missing = TEXTURES.filter((t) => !t.startsWith('item/') && !hasTexture(t) && !['air', 'unused_1', 'moving_piston'].includes(t));
check(missing.length === 0, `textures without a painter (${missing.length}): ${missing.join(' ')}`);
const noSprite = [...ITEMS.values()].filter((it) => it.sprite && !getItemSprite(it.sprite)).map((it) => it.sprite);
check(noSprite.length === 0, `items without a sprite (${noSprite.length}): ${noSprite.join(' ')}`);
const shapes: Record<string, number> = {};
for (let i = 0; i < BLOCK_COUNT; i++) shapes[Shape[SHAPE[i]]] = (shapes[Shape[SHAPE[i]]] ?? 0) + 1;
console.log(`blocks ${BLOCK_COUNT}, items ${VANILLA_ITEM_COUNT}, textures ${TEXTURES.length}`);
console.log(JSON.stringify(shapes));
done();
