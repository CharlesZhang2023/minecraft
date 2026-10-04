// Static projectiles: they stay where they're cast (just in front of the wand, or where a trigger releases them).
// Fields act on what is inside them; clouds float up above where you aim and rain; holes grow and swallow.
import { stat, proj, hexCol, type Icon, type Live, type SpellWorld, type SpellDef, type Status } from '../spelldefs.ts';

const I = (c: string, g = 'circle', n?: string): Icon => ({ g, c, n });

// ---- explosions
const boom = (id: string, name: string, tier: number, mana: number, desc: string, color: string, r: number, dmg: number, terrain: number, extra: Partial<SpellDef> = {}, o: { fire?: boolean; elec?: boolean; status?: Status } = {}) =>
  stat(id, name, tier, mana, desc, I(color, 'explosion'), { visual: 'blast', life: 1, color: hexCol(color), size: 0.5, explR: o.status || o.elec ? 0 : r, explDmg: dmg, terrain, fire: !!o.fire }, {
    delay: 1, ...extra,
    hit: o.status || o.elec ? (l, h, w) => w.blast(h.x, h.y, h.z, r, dmg * l.p.dmgMul, terrain, !!o.fire, hexCol(color), { elec: o.elec, status: o.status }) : undefined,
  });
boom('explosion', 'Explosion', 2, 80, 'An explosion right where it\'s cast.', '#ffa040', 2.5, 12, 6);
boom('explosion_brimstone', 'Explosion of Brimstone', 1, 10, 'A small, fiery explosion.', '#ff6020', 2, 6, 2, {}, { fire: true });
boom('magical_explosion', 'Magical Explosion', 3, 80, 'A large explosion that doesn\'t harm the ground.', '#c060ff', 3.2, 16, 0);
boom('explosion_thunder', 'Explosion of Thunder', 3, 110, 'An electric explosion.', '#a0c0ff', 2.8, 12, 2, { delay: 5 }, { elec: true });
boom('explosion_poison', 'Explosion of Poison', 2, 30, 'A poisonous explosion.', '#90ff40', 2, 4, 0, {}, { status: 'toxic' });
boom('explosion_spirits', 'Explosion of Spirits', 2, 30, 'An explosion of strong spirits: everything caught in it is drunk.', '#e0d080', 2.2, 4, 0, {}, { status: 'drunk' });
boom('explosion_small', 'Small Explosion', 5, 0, 'A small explosion.', '#ffa040', 1.3, 5, 2, { hidden: true, noita: 'Explosion' });

// ---- fields: circles on the ground that act on what is inside
const field = (id: string, name: string, tier: number, mana: number, desc: string, color: string, tick: SpellDef['tick'], extra: Partial<SpellDef> = {}, r = 3) =>
  stat(id, name, tier, mana, desc, I(color), { visual: 'field', life: 160, color: hexCol(color), size: r }, { tick, delay: 5, uses: 15, ...extra });
const every = (n: number, f: (l: Live, w: SpellWorld) => void) => (l: Live, w: SpellWorld) => { if (l.age % n === 0) f(l, w); };
field('circle_of_vigour', 'Circle of Vigour', 2, 80, 'A healing circle: everyone inside recovers.', '#60ff60', every(10, (l, w) => { for (const e of w.near(l.x, l.y, l.z, 3)) w.heal(e, 1); }), { uses: 2 });
field('circle_of_stillness', 'Circle of Stillness', 2, 50, 'Everything inside slows to a crawl.', '#80c0ff', every(10, (l, w) => { for (const e of w.near(l.x, l.y, l.z, 3, true)) w.effect(e, 'slowness', 30, 3); }));
field('circle_of_buoyancy', 'Circle of Buoyancy', 1, 10, 'A field of levitation: everything inside floats up.', '#a0e0ff', (l, w) => { for (const e of w.near(l.x, l.y, l.z, 3)) { e.vy = Math.max(e.vy, 0.12); e.fallDistance = 0; } });
field('circle_of_displacement', 'Circle of Displacement', 2, 30, 'A field of teleportation: what is inside is thrown about.', '#c080ff', every(20, (l, w) => {
  for (const e of w.near(l.x, l.y, l.z, 3)) w.teleport(e, e.x + (w.rand() - 0.5) * 8, e.y + 1, e.z + (w.rand() - 0.5) * 8);
}));
field('circle_of_thunder', 'Circle of Thunder', 3, 60, 'A field of electricity: it shocks what is inside.', '#ffff80', every(10, (l, w) => {
  for (const e of w.near(l.x, l.y, l.z, 3, true)) { w.hurt(e, 3); w.fx('zap', e.x, e.y + e.height / 2, e.z); }
}));
field('circle_of_fervour', 'Circle of Fervour', 2, 30, 'A field of fury: everyone inside hits harder and moves faster.', '#ff6040', every(10, (l, w) => {
  for (const e of w.near(l.x, l.y, l.z, 3)) { w.effect(e, 'strength', 40, 1); w.effect(e, 'speed', 40, 1); w.status(e, 'fervour', 40); }
}));
field('circle_of_shielding', 'Circle of Shielding', 2, 20, 'A field of protection: arrows and fireballs can\'t get in.', '#80ffff', (l, w) => {
  if (l.age % 10 === 0) for (const e of w.near(l.x, l.y, l.z, 3)) w.effect(e, 'resistance', 30, 1);
  w.deflect(l.x, l.y, l.z, 3.5);
}, { uses: 10 });
field('circle_of_transmogrification', 'Circle of Transmogrification', 3, 50, 'A field of sheep-like magic.', '#ffffff', every(10, (l, w) => {
  for (const e of w.near(l.x, l.y, l.z, 3, true)) if (!(e as unknown as { inventory?: unknown }).inventory && (e as unknown as { typeName: string }).typeName !== 'Sheep') w.polymorph(e, 'sheep');
}), { uses: 5 });
const MORPHS = ['sheep', 'pig', 'chicken', 'cow', 'zombie', 'skeleton', 'spider', 'creeper', 'slime', 'wolf', 'bat', 'silverfish'];
field('circle_of_metamorphosis', 'Circle of Unstable Metamorphosis', 3, 20, 'A field of transformation: what is inside becomes something else.', '#ff80ff', every(20, (l, w) => {
  for (const e of w.near(l.x, l.y, l.z, 3, true)) if (!(e as unknown as { inventory?: unknown }).inventory) w.polymorph(e, MORPHS[Math.floor(w.rand() * MORPHS.length)]);
}), { uses: 10, noita: 'Circle of Unstable Metamorphosis' });
stat('glittering_field', 'Glittering Field', 2, 90, 'Small explosions pop up all over a large area.', I('#ff80ff', 'explosion'), { visual: 'none', life: 60, aim: true, color: 0xff80ff, size: 4 }, {
  delay: 3, uses: 20,
  tick: every(3, (l, w) => {
    const a = w.rand() * Math.PI * 2, d = Math.sqrt(w.rand()) * 4;
    w.blast(l.x + Math.cos(a) * d, l.y + w.rand() * 2, l.z + Math.sin(a) * d, 1, 4 * l.p.dmgMul, 0, false, [0xff60ff, 0x60ffff, 0xffff60][Math.floor(w.rand() * 3)]);
  }),
});

// ---- barriers: lines of light that hurt what passes (you too)
const barrier = (id: string, name: string, tier: number, desc: string, shape: [number, number][], extra: Partial<SpellDef> = {}) =>
  stat(id, name, tier, 70, desc, I('#80ff80', 'line'), { visual: 'none', life: 2, color: 0x80ff80 }, {
    delay: 2, ...extra,
    tick(l, w) {
      if (l.age !== 1) return;
      // across the way it was cast: the caster's facing gives "sideways"
      const c = l.caster, yaw = c ? (-c.yaw * Math.PI) / 180 : 0, sx = Math.cos(yaw), sz = Math.sin(yaw);
      for (const [a, b] of shape) w.spawn('barrier_node', l.x + sx * a, l.y + b, l.z + sz * a, 0, 0, 0);
      l.remove();
    },
  });
const line = (n: number, f: (i: number) => [number, number]) => Array.from({ length: n }, (_, i) => f(i - (n - 1) / 2));
barrier('horizontal_barrier', 'Horizontal Barrier', 2, 'A thin, horizontal barrier that harms passing creatures, including you.', line(9, (i) => [i * 0.6, 0]));
barrier('vertical_barrier', 'Vertical Barrier', 2, 'A thin, vertical barrier that harms passing creatures, including you.', line(7, (i) => [0, i * 0.6]));
barrier('square_barrier', 'Square Barrier', 3, 'A square barrier that harms passing creatures, including you.', [...line(6, (i) => [i * 0.6, -1.5]), ...line(6, (i) => [i * 0.6, 1.5]), ...line(5, (i) => [-1.8, i * 0.6]), ...line(5, (i) => [1.8, i * 0.6])], { delay: 7, uses: 20 });
proj('barrier_node', 'Barrier', 5, 0, 'Part of a barrier.', I('#80ff80'), { visual: 'spark', speed: 0, ghost: true, pierce: true, life: 100, aura: 0.45, selfHit: true, color: 0x80ff80, size: 0.14 }, { hidden: true });

// ---- clouds: they rise above where you aim and rain on what's below
const cloud = (id: string, name: string, tier: number, mana: number, desc: string, color: string, rain: (x: number, y: number, z: number, w: SpellWorld) => void, onBelow: ((e: import('../../sdk').Entity, w: SpellWorld) => void) | null, extra: Partial<SpellDef> = {}) =>
  stat(id, name, tier, mana, desc, I(color, 'cloud'), { visual: 'cloud', life: 160, color: hexCol(color), size: 2, aim: true }, {
    delay: 5, uses: 10, ...extra,
    tick(l, w) {
      if (l.age === 1) l.y += 4;
      if (l.age % 5) return;
      for (let k = 0; k < 3; k++) {
        const x = Math.floor(l.x + (w.rand() - 0.5) * 5), z = Math.floor(l.z + (w.rand() - 0.5) * 5);
        for (let y = Math.floor(l.y); y > l.y - 14; y--) if (w.solid(x, y - 1, z) || w.id(x, y, z) !== 'air') { rain(x, y, z, w); break; }
      }
      if (onBelow) for (const e of w.near(l.x, l.y - 5, l.z, 3.5)) onBelow(e, w);
    },
  });
const puddle = (block: string) => (x: number, y: number, z: number, w: SpellWorld) => {
  const id = w.id(x, y, z);
  if (id === 'fire') w.place(x, y, z, 'air');
  else if (id === 'air' && w.rand() < 0.4) w.place(x, y, z, block);
};
cloud('rain_cloud', 'Rain Cloud', 1, 30, 'A cloud that rains on what\'s below it, putting out fires.', '#9aa0b0', (x, y, z, w) => {
  const id = w.id(x, y, z);
  if (id === 'fire') w.place(x, y, z, 'air');
  else if (id === 'lava') w.place(x, y, z, 'obsidian');
}, (e, w) => { e.fireTicks = 0; w.status(e, 'wet', 100); });
cloud('oil_cloud', 'Oil Cloud', 2, 20, 'A cloud that rains oil.', '#403830', puddle('wands:oil'), (e, w) => w.status(e, 'oiled', 200), { uses: 15 });
cloud('blood_cloud', 'Blood Cloud', 2, 60, 'A cloud that rains blood.', '#a01818', puddle('wands:blood'), (e, w) => w.status(e, 'bloody', 200), { uses: 3 });
cloud('acid_cloud', 'Acid Cloud', 3, 90, 'A cloud that rains acid: it eats into the ground and what stands on it.', '#80e040', (x, y, z, w) => {
  if (w.rand() < 0.15) w.dig(x + 0.5, y - 0.5, z + 0.5, 0.5, 2);
  else puddle('wands:acid')(x, y, z, w);
}, (e, w) => { w.hurt(e, 1); w.status(e, 'toxic', 60); }, { uses: 8 });
stat('thundercloud', 'Thundercloud', 3, 90, 'A storm cloud that strikes lightning below it.', I('#606878', 'cloud'), { visual: 'cloud', life: 140, color: 0x5a6070, size: 2.2, aim: true }, {
  delay: 10, uses: 5,
  tick(l, w) {
    if (l.age === 1) l.y += 4;
    if (l.age % 20 !== 10) return;
    const x = l.x + (w.rand() - 0.5) * 6, z = l.z + (w.rand() - 0.5) * 6;
    let y = Math.floor(l.y);
    while (y > l.y - 20 && !w.solid(Math.floor(x), y - 1, Math.floor(z))) y--;
    w.fx('strike', x, y, z, [l.y]);
    w.sound('wands:thunder', x, y, z, 2, 0.9 + w.rand() * 0.2);
    for (const e of w.near(x, y, z, 2, true)) w.hurt(e, 6 * l.p.dmgMul, { fire: w.rand() < 0.3 });
    if (w.rand() < 0.3) w.ignite(Math.floor(x), y, Math.floor(z));
  },
});

// ---- rains of things from the sky
const sade = (id: string, name: string, desc: string, spell: string) =>
  stat(id, name, 5, 225, desc, I('#ff8040', 'meteor'), { visual: 'none', life: 100, aim: true, color: 0xff8040 }, {
    delay: 33, reload: 20, uses: 2,
    tick: every(10, (l, w) => {
      const tx = l.x + (w.rand() - 0.5) * 12, tz = l.z + (w.rand() - 0.5) * 12;
      const sx = tx + (w.rand() - 0.5) * 6, sz = tz + (w.rand() - 0.5) * 6, sy = l.y + 24;
      const d = Math.hypot(tx - sx, l.y - sy, tz - sz) || 1;
      w.spawn(spell, sx, sy, sz, (tx - sx) / d, (l.y - sy) / d, (tz - sz) / d, { sky: false });
    }),
  });
sade('meteorisade', 'Meteorisade', '"Alea iacta est": meteors rain down around where you aim.', 'meteor');
sade('matosade', 'Matosade', 'Giant worms rain down around where you aim.', 'worm_launcher');

// ---- holes that grow
const hole = (id: string, name: string, tier: number, mana: number, desc: string, white: boolean, grow: number, life: number, extra: Partial<SpellDef>) =>
  stat(id, name, tier, mana, desc, I(white ? '#ffffff' : '#7020c0', 'hole'), { visual: white ? 'whitehole' : 'hole', life, color: white ? 0xfff8e0 : 0x9040ff, size: 0.6 }, {
    uses: 6, ...extra,
    tick(l, w) {
      const r = Math.min(grow, 1.4 + l.age * 0.03);
      if (l.age % 4 === 0) w.dig(l.x, l.y, l.z, r, 40);
      for (const e of w.near(l.x, l.y, l.z, r * 3, true)) {
        w.pull(e, l.x, l.y, l.z, white ? -0.12 : 0.08);
        if (l.age % 10 === 0 && Math.hypot(e.x - l.x, e.y + e.height / 2 - l.y, e.z - l.z) < r + 0.8) w.hurt(e, 5 * l.p.dmgMul);
      }
    },
  });
hole('giga_black_hole', 'Giga Black Hole', 4, 240, 'A growing orb of void that swallows everything in its reach.', false, 3.5, 200, { delay: 27 });
hole('omega_black_hole', 'Omega Black Hole', 5, 500, 'Even light dies eventually...', false, 6, 300, { delay: 40, reload: 33 });
hole('giga_white_hole', 'Giga White Hole', 4, 240, 'A growing orb of positive energy that destroys everything in its reach.', true, 3.5, 200, { delay: 27 });
hole('omega_white_hole', 'Omega White Hole', 5, 500, 'A massive orb of positive energy that destroys everything in its reach.', true, 6, 300, { delay: 40, reload: 33 });

// ---- swarms: little allies that hunt your enemies
const swarm = (id: string, name: string, tier: number, mana: number, desc: string, bug: string, n: number, extra: Partial<SpellDef> = {}) =>
  stat(id, name, tier, mana, desc, I('#404040', 'burst'), { visual: 'none', life: 2 }, {
    delay: 20, reload: 7, ...extra,
    tick(l, w) {
      if (l.age !== 1) return;
      for (let k = 0; k < n; k++) w.spawn(bug, l.x, l.y + 0.5, l.z, w.rand() - 0.5, 0.3, w.rand() - 0.5);
      l.remove();
    },
  });
const BUG = { pierce: true, homing: 0.25, path: 'chaos' as const, speed: 0.4, bounces: 99, bounceKeep: 1, gravity: 0 };
swarm('summon_fly_swarm', 'Summon Fly Swarm', 1, 60, 'Five flies to aid you in battle.', 'fly', 5);
swarm('summon_firebug_swarm', 'Summon Firebug Swarm', 2, 70, 'Four fire bugs to aid you in battle.', 'firebug', 4);
swarm('summon_wasp_swarm', 'Summon Wasp Swarm', 3, 80, 'Six wasps to aid you in battle.', 'wasp', 6);
swarm('summon_friendly_fly', 'Summon Friendly Fly', 3, 120, 'A friendly fly that hunts your enemies for a long time.', 'friendly_fly', 1, { delay: 27, reload: 13 });
proj('fly', 'Fly', 5, 0, 'A fly.', I('#303030'), { ...BUG, visual: 'spark', dmg: 2, life: 300, color: 0x404040, size: 0.07 }, { hidden: true });
proj('firebug', 'Fire Bug', 5, 0, 'A fire bug.', I('#ff8020'), { ...BUG, visual: 'fire', dmg: 2, fire: true, life: 340, color: 0xff8020, size: 0.08 }, { hidden: true });
proj('wasp', 'Wasp', 5, 0, 'A wasp.', I('#ffd020'), { ...BUG, visual: 'spark', dmg: 3, life: 440, inflict: [['toxic', 40]], color: 0xffd020, size: 0.07 }, { hidden: true });
proj('friendly_fly', 'Friendly Fly', 5, 0, 'A friendly fly.', I('#60ff60'), { ...BUG, visual: 'spark', dmg: 3, life: 720, color: 0x60ff60, size: 0.09 }, { hidden: true });

// ---- fields that act on projectiles
const pfield = (id: string, name: string, tier: number, mana: number, desc: string, color: string, act: (l: Live, other: Live, w: SpellWorld) => void, extra: Partial<SpellDef> = {}) =>
  stat(id, name, tier, mana, desc, I(color), { visual: 'field', life: 200, color: hexCol(color), size: 4 }, {
    delay: 5, uses: 3, ...extra,
    tick(l, w) { for (const o of w.projs(l.x, l.y, l.z, 4)) if (o !== l && !o.p.spell.id.startsWith('projectile_')) act(l, o, w); },
  });
pfield('projectile_gravity_field', 'Projectile Gravity Field', 3, 120, 'Projectiles caught in the field are drawn to its centre.', '#c080ff', (l, o) => {
  const dx = l.x - o.x, dy = l.y - o.y, dz = l.z - o.z, d = Math.hypot(dx, dy, dz) || 1;
  o.vx += (dx / d) * 0.08; o.vy += (dy / d) * 0.08; o.vz += (dz / d) * 0.08;
  if (o.age % 4 === 0) o.sync();
});
pfield('projectile_thunder_field', 'Projectile Thunder Field', 4, 140, 'Projectiles caught in the field turn into lightning.', '#a0c0ff', (_l, o, w) => { if (o.p.spell.id !== 'lightning_bolt') w.replace(o, 'lightning_bolt'); });
pfield('projectile_transmutation_field', 'Projectile Transmutation Field', 3, 120, 'Projectiles caught in the field turn into harmless critters.', '#ffffff', (_l, o, w) => { w.mob('chicken', o.x, o.y, o.z); o.remove(); }, { uses: 6 });
stat('vacuum_field', 'Vacuum Field', 2, 50, 'Sucks nearby projectiles and creatures into the middle of the field at once.', I('#c0c0ff'), { visual: 'field', life: 8, color: 0xc0c0ff, size: 1.5 }, {
  delay: 3, uses: 20,
  tick(l, w) {
    if (l.age !== 1) return;
    for (const e of w.near(l.x, l.y, l.z, 6, true)) w.teleport(e, l.x, l.y - 0.5, l.z);
    for (const o of w.projs(l.x, l.y, l.z, 6)) if (o !== l) { o.x = l.x; o.y = l.y; o.z = l.z; o.sync(); }
  },
});
const LIQUIDS = ['water', 'lava', 'wands:acid', 'wands:oil', 'wands:blood', 'wands:slime', 'wands:toxic', 'wands:alcohol', 'wands:urine'];
stat('liquid_vacuum_field', 'Liquid Vacuum Field', 2, 40, 'Sucks up the liquids around it.', I('#4080ff'), { visual: 'field', life: 100, color: 0x4080ff, size: 4 }, {
  delay: 3, uses: 20,
  tick: every(5, (l, w) => w.transmute(l.x, l.y, l.z, Math.min(4, 1 + l.age / 20), (n) => (LIQUIDS.includes(n) ? 'air' : null))),
});
stat('powder_vacuum_field', 'Powder Vacuum Field', 2, 50, 'Sucks up the sand, gravel and snow around it.', I('#e0d090'), { visual: 'field', life: 100, color: 0xe0d090, size: 4 }, {
  delay: 3, uses: 20,
  tick: every(5, (l, w) => w.transmute(l.x, l.y, l.z, Math.min(4, 1 + l.age / 20), (n) => (['sand', 'gravel', 'snow', 'wands:gunpowder', 'snow_block'].includes(n) ? 'air' : null))),
});

// ---- the rest
stat('explosive_detonator', 'Explosive Detonator', 2, 50, 'All your nearby explosive spells go off at once.', I('#ff4040', 'explosion'), { visual: 'blast', life: 2, color: 0xff4040, size: 0.4 }, {
  tick(l, w) {
    if (l.age !== 1) return;
    for (const o of w.mine()) if (o !== l && o.p.explR > 0 && Math.hypot(o.x - l.x, o.y - l.y, o.z - l.z) < 16) o.kill();
  },
});
stat('delayed_spellcast', 'Delayed Spellcast', 2, 20, 'A magical phenomenon that casts three more spells after a short while.', I('#ffd080', 'tag', 'timer'), { visual: 'portal', life: 30, color: 0xffd080, size: 0.3 }, { delay: 3, trigger: 'timer', timer: 20, triggerDraw: 3 });
stat('muodonmuutos', 'Muodonmuutos', 5, 220, 'Baa. Everything around turns into sheep.', I('#ffffff', 'circle'), { visual: 'blast', life: 1, color: 0xffffff, size: 1 }, {
  delay: 47, reload: 80, uses: 3,
  hit(l, _h, w) { for (const e of w.near(l.x, l.y, l.z, 8, true)) if (!(e as unknown as { inventory?: unknown }).inventory) w.polymorph(e, 'sheep'); w.fx('tp', l.x, l.y, l.z); },
});
stat('destruction', 'Destruction', 5, 240, 'Everything hostile around you takes grievous harm.', I('#ff2020', 'explosion'), { visual: 'blast', life: 1, color: 0xff2020, size: 1 }, {
  delay: 50, reload: 80, uses: 5,
  hit(l, _h, w) {
    for (const e of w.foes(l.x, l.y, l.z, 18)) {
      const le = e as unknown as { maxHealth: number };
      w.hurt(e, Math.max(6, le.maxHealth * 0.6) * l.p.dmgMul);
      w.fx('strike', e.x, e.y, e.z, [e.y + 10]);
    }
    w.sound('wands:thunder', l.x, l.y, l.z, 2, 0.6);
  },
});
