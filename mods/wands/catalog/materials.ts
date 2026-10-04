// Material spells: they make stuff. Streams of liquid or powder that stay where they land, seas and circles of it,
// and Touches that turn everything close to you into one material. Noita's liquids are fluid simulations; here
// most of them are thin puddles (mod blocks, blocks.ts) that stain what stands in them.
import { def, stat, landing, hexCol, type Icon, type Proj, type SpellDef, type SpellWorld, type Live, type HitInfo } from '../spelldefs.ts';

const I = (c: string, g = 'drop'): Icon => ({ g, c });
const material = (id: string, name: string, tier: number, mana: number, desc: string, icon: Icon, p: Partial<Proj>, hit: SpellDef['hit'], extra: Partial<SpellDef> = {}) =>
  def({ id, name, type: 'material', tier, mana, desc, icon, proj: { speed: 0.8, gravity: 0.06, life: 30, spread: 4, size: 0.1, ...p }, hit, delay: -5, reload: -3, ...extra });
/** A puddle where it lands (and, over fire, it puts it out or feeds it). */
const pour = (block: string) => (_l: Live, h: HitInfo, w: SpellWorld) => {
  const [x, y, z] = landing(h);
  const id = w.id(x, y, z);
  if (id === 'fire' && block !== 'wands:oil') { w.place(x, y, z, 'air'); return; }
  if (!w.solid(x, y, z) && id !== block && w.solid(x, y - 1, z)) w.place(x, y, z, block);
};

material('water', 'Water', 0, 0, 'A splash of water. Puts out fires, cools lava.', I('#3070ff'), { visual: 'liquid', color: 0x3070ff, inflict: [['wet', 200]] }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  const id = w.id(x, y, z), below = w.id(x, y - 1, z);
  if (id === 'fire') w.place(x, y, z, 'air');
  else if (below === 'lava') w.place(x, y - 1, z, 'obsidian');
  else if (!w.solid(x, y, z) && id !== 'water') w.place(x, y, z, 'water', 5);
  if (h.entity) h.entity.fireTicks = 0;
});
material('lava', 'Lava', 2, 20, 'A splash of lava. Hot.', I('#ff5010'), { visual: 'liquid', color: 0xff5010, fire: true }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  if (!w.solid(x, y, z) && w.id(x, y, z) !== 'lava') w.place(x, y, z, w.id(x, y, z) === 'water' ? 'obsidian' : 'lava', 6);
}, { noita: '' });
material('acid', 'Acid', 2, 0, 'Drops of acid: they eat into the ground and what they touch.', I('#a0ff40'), { visual: 'liquid', dmg: 2, color: 0xa0ff40, inflict: [['toxic', 60]] }, (l, h, w) => {
  if (h.reason === 'block' && w.rand() < 0.25) w.dig(h.x - h.nx * 0.5, h.y - h.ny * 0.5, h.z - h.nz * 0.5, 0.5, 2.5);
  else pour('wands:acid')(l, h, w);
});
material('blood', 'Blood', 1, 0, 'Blood from nothing.', I('#c01818'), { visual: 'liquid', color: 0xc01818, inflict: [['bloody', 200]] }, pour('wands:blood'), { uses: 250 });
material('oil', 'Oil', 1, 0, 'Slick, flammable oil.', I('#403830'), { visual: 'liquid', color: 0x50402c, inflict: [['oiled', 200]] }, pour('wands:oil'));
material('cement', 'Cement', 2, 0, 'Wet cement: it sets into stone.', I('#a0a0a0'), { visual: 'sand', color: 0xa0a0a0 }, pour('wands:cement'));
material('sand', 'Sand', 0, 5, 'Conjures sand. It falls.', I('#e0d090', 'sand'), { visual: 'sand', color: 0xe0d090 }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  if (!w.solid(x, y, z)) w.place(x, y, z, 'sand');
}, { delay: 0, reload: 0, noita: '' });
material('snow', 'Snow', 1, 5, 'A flurry of snow: covers the ground, freezes water.', I('#ffffff', 'snowflake'), { visual: 'snow', color: 0xeef8ff, freeze: true }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  if (w.id(x, y - 1, z) === 'water') w.place(x, y - 1, z, 'ice');
  else if (!w.solid(x, y, z) && w.solid(x, y - 1, z) && w.id(x, y, z) === 'air') w.place(x, y, z, 'snow');
}, { delay: 0, reload: 0, noita: '' });
material('chunk_of_soil', 'Chunk of Soil', 0, 5, 'A clod of earth: it makes a little mound where it lands.', I('#806040', 'rock'), { visual: 'rock', speed: 0.7, gravity: 0.05, life: 40, spread: 0, color: 0x806040, size: 0.22 }, (_l, h, w) => {
  const [x, y, z] = landing(h);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) {
    if (dx * dx + dz * dz + dy * dy * 2 > 2.2) continue;
    if (!w.solid(x + dx, y + dy, z + dz)) w.place(x + dx, y + dy, z + dz, 'dirt');
  }
}, { delay: 0, reload: 0, noita: 'Chunk Of Soil' });

// ---- seas: a pool of something where it's cast
const sea = (id: string, name: string, tier: number, block: string, color: string, noita: string, desc?: string, uses = 3) =>
  stat(id, name, tier, 140, desc ?? `Conjures a pool of ${block.replace('wands:', '')} where it's cast.`, I(color, 'sea'), { visual: 'blast', life: 1, color: hexCol(color), size: 1 }, {
    type: 'material', delay: 5, uses, noita,
    hit(l, _h, w) {
      const cx = Math.floor(l.x), cy = Math.floor(l.y), cz = Math.floor(l.z);
      for (let dx = -3; dx <= 3; dx++)
        for (let dz = -3; dz <= 3; dz++) {
          if (dx * dx + dz * dz > 10) continue;
          for (let dy = 0; dy >= -2; dy--) if (!w.solid(cx + dx, cy + dy, cz + dz)) w.place(cx + dx, cy + dy, cz + dz, block);
        }
    },
  });
sea('sea_of_water', 'Sea of Water', 3, 'water', '#3070ff', 'Sea Of Water');
sea('sea_of_lava', 'Sea of Lava', 4, 'lava', '#ff5010', 'Sea Of Lava');
sea('sea_of_acid', 'Sea of Acid', 4, 'wands:acid', '#a0ff40', 'Sea Of Acid');
sea('sea_of_oil', 'Sea of Oil', 3, 'wands:oil', '#403830', 'Sea Of Oil');
sea('sea_of_alcohol', 'Sea of Alcohol', 3, 'wands:alcohol', '#e0d080', 'Sea Of Alcohol');
sea('sea_of_flammable_gas', 'Sea of Flammable Gas', 4, 'wands:gas', '#c0e0a0', 'Sea Of Flammable Gas', 'A cloud of flammable gas. Don\'t light it near yourself.');
sea('sea_of_mimicium', 'Sea of Mimicium', 5, 'wands:slime', '#b0ffb0', 'Sea of Mimicium', 'A pool of a strange, clinging liquid.', 2);
stat('summon_swamp', 'Summon Swamp', 3, 140, 'Conjures a little swamp: water, mud and lily pads.', I('#507030', 'sea'), { visual: 'blast', life: 1, color: 0x507030, size: 1 }, {
  type: 'material', delay: 5, uses: 3,
  hit(l, _h, w) {
    const cx = Math.floor(l.x), cy = Math.floor(l.y), cz = Math.floor(l.z);
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) {
        const d = dx * dx + dz * dz;
        if (d > 18) continue;
        if (d > 10) { if (!w.solid(cx + dx, cy - 1, cz + dz)) w.place(cx + dx, cy - 1, cz + dz, 'grass_block'); continue; }
        w.place(cx + dx, cy - 1, cz + dz, 'water');
        if (!w.solid(cx + dx, cy - 2, cz + dz)) w.place(cx + dx, cy - 2, cz + dz, 'dirt');
        if (w.rand() < 0.15 && w.id(cx + dx, cy, cz + dz) === 'air') w.place(cx + dx, cy, cz + dz, 'lily_pad');
      }
  },
});

// ---- circles: a ring of something spreading out
const circle = (id: string, name: string, tier: number, mana: number, desc: string, color: string, act: (x: number, y: number, z: number, w: SpellWorld) => void, uses: number, onIn?: (e: import('../../sdk').Entity, w: SpellWorld) => void) =>
  stat(id, name, tier, mana, desc, I(color, 'circle'), { visual: 'field', life: 60, color: hexCol(color), size: 3 }, {
    type: 'material', delay: 7, uses,
    tick(l, w) {
      if (l.age % 3) return;
      const r = 1 + (l.age / 60) * 3;
      for (let k = 0; k < 6; k++) {
        const a = w.rand() * Math.PI * 2, x = Math.floor(l.x + Math.cos(a) * r), z = Math.floor(l.z + Math.sin(a) * r);
        for (let y = Math.floor(l.y) + 1; y > l.y - 3; y--) if (w.solid(x, y - 1, z)) { act(x, y, z, w); break; }
      }
      if (onIn && l.age % 10 === 0) for (const e of w.near(l.x, l.y, l.z, r, true)) onIn(e, w);
    },
  });
circle('circle_of_fire', 'Circle of Fire', 2, 20, 'An expanding ring of burning air.', '#ff6020', (x, y, z, w) => w.ignite(x, y, z), 15, (e, w) => w.hurt(e, 1, { fire: true }));
circle('circle_of_acid', 'Circle of Acid', 3, 40, 'An expanding ring of dripping acid.', '#a0ff40', (x, y, z, w) => { if (w.id(x, y, z) === 'air') w.place(x, y, z, 'wands:acid'); }, 4, (e, w) => { w.hurt(e, 1); w.status(e, 'toxic', 60); });
circle('circle_of_oil', 'Circle of Oil', 2, 20, 'An expanding ring of oil.', '#403830', (x, y, z, w) => { if (w.id(x, y, z) === 'air') w.place(x, y, z, 'wands:oil'); }, 15, (e, w) => w.status(e, 'oiled', 200));
circle('circle_of_water', 'Circle of Water', 1, 20, 'An expanding ring of water.', '#3070ff', (x, y, z, w) => { const id = w.id(x, y, z); if (id === 'fire') w.place(x, y, z, 'air'); else if (id === 'air') w.place(x, y, z, 'water', 6); }, 15, (e, w) => { e.fireTicks = 0; w.status(e, 'wet', 200); });

// ---- touches: everything near you becomes one material (creatures suffer for it; you too, unless you're careful)
const touch = (id: string, name: string, tier: number, mana: number, uses: number, desc: string, color: string, to: string | ((name: string, w: SpellWorld) => string | null), creature: (e: import('../../sdk').Entity, w: SpellWorld) => void, noita: string) =>
  stat(id, name, tier, mana, desc, I(color, 'circle'), { visual: 'blast', life: 1, color: hexCol(color), size: 2 }, {
    type: 'material', uses, noita,
    hit(l, _h, w) {
      const fn = typeof to === 'string' ? (n: string) => (n === 'air' || n === 'bedrock' ? null : to) : (n: string) => to(n, w);
      w.transmute(l.x, l.y, l.z, 3, fn);
      for (const e of w.near(l.x, l.y, l.z, 3, true)) creature(e, w);
      w.fx('tp', l.x, l.y + 1, l.z);
    },
  });
touch('touch_of_gold', 'Touch of Gold', 5, 300, 1, 'Turns everything close by into gold, creatures included.', '#ffd040', 'gold_block', (e, w) => w.hurt(e, 40), 'Touch Of Gold');
touch('touch_of_gold_q', 'Touch of Gold?', 4, 190, 4, 'Turns everything close by into... not gold.', '#e0e040', (n) => (n === 'air' || n === 'bedrock' ? null : 'wands:urine'), (e, w) => w.status(e, 'wet', 200), 'Touch of Gold?');
touch('touch_of_grass', 'Touch of Grass', 3, 190, 4, 'Turns everything close by into earth and grass.', '#60c040', (n) => (n === 'air' || n === 'bedrock' ? null : n === 'grass_block' ? null : 'dirt'), () => {}, 'Touch of Grass');
touch('touch_of_water', 'Touch of Water', 4, 280, 5, 'Turns everything close by into water.', '#3070ff', 'water', (e, w) => { e.fireTicks = 0; w.status(e, 'wet', 400); }, 'Touch Of Water');
touch('touch_of_blood', 'Touch of Blood', 4, 270, 3, 'Turns everything close by into blood.', '#c01818', 'wands:blood', (e, w) => w.status(e, 'bloody', 400), 'Touch Of Blood');
touch('touch_of_oil', 'Touch of Oil', 4, 260, 5, 'Turns everything close by into oil.', '#403830', 'wands:oil', (e, w) => w.status(e, 'oiled', 400), 'Touch Of Oil');
touch('touch_of_spirits', 'Touch of Spirits', 4, 240, 5, 'Turns everything close by into strong spirits.', '#e0d080', 'wands:alcohol', (e, w) => w.status(e, 'drunk', 400), 'Touch Of Spirits');
touch('touch_of_smoke', 'Touch of Smoke', 4, 230, 5, 'Turns everything close by into smoke: it simply goes away.', '#a0a0a0', 'air', () => {}, 'Touch Of Smoke');
