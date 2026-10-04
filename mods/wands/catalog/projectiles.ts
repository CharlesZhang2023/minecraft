// Projectile spells: each card fires one projectile (some fire a few). Numbers follow Noita's spell table where it
// gives them (mana, uses, cast delay, recharge, spread), converted: Noita's 60 frames a second become our 20 ticks,
// lifetimes scale by 0.4 (spark bolt: 40 frames, 16 ticks), explosion radii by about √r / 2.
import { proj, sec, landing, hexCol, type Proj, type Icon, type SpellDef, type Live, type SpellWorld } from '../spelldefs.ts';

const I = (c: string, g = 'spark', n?: string): Icon => ({ g, c, n });
/** The same projectile with a trigger, a timer, or an expiration trigger. */
function withTrigger(base: SpellDef, kind: 'trigger' | 'timer' | 'expire', id: string, name: string, mana: number, desc: string, timer = 10, extra: Partial<SpellDef> = {}) {
  return proj(id, name, base.tier + 1, mana, desc, { ...base.icon, n: kind }, base.proj ?? {}, {
    delay: base.delay, reload: base.reload, uses: base.uses, tick: base.tick, hit: base.hit, touch: base.touch,
    trigger: kind === 'trigger' ? 'hit' : kind, timer: kind === 'timer' ? timer : undefined, ...extra,
  });
}

// ---- sparks, arrows, bolts
const SPARK: Partial<Proj> = { visual: 'spark', dmg: 3, crit: 0.05, speed: 1.4, life: 16, spread: -1, color: 0xd08cff, size: 0.12 };
const spark = proj('spark_bolt', 'Spark Bolt', 0, 5, 'A weak but enchanting sparkling projectile.', I('#d08cff'), SPARK, { delay: 1 });
withTrigger(spark, 'trigger', 'spark_bolt_trigger', 'Spark Bolt with Trigger', 10, 'A spark bolt that casts another spell when it hits something.');
withTrigger(spark, 'timer', 'spark_bolt_timer', 'Spark Bolt with Timer', 10, 'A spark bolt that casts another spell after a moment.', 6);
proj('spark_bolt_double', 'Spark Bolt with Double Trigger', 2, 15, 'A spark bolt that casts two more spells when it hits something.', I('#d08cff', 'spark', 'trigger'), { ...SPARK, color: 0xe0a0ff }, { delay: 1, trigger: 'hit', triggerDraw: 2, noita: 'Spark Bolt With Double Trigger' });

const ARROW: Partial<Proj> = { visual: 'arrow', dmg: 6, crit: 0.05, speed: 1.25, life: 30, spread: 2, color: 0x7af4ff, size: 0.14 };
const marrow = proj('magic_arrow', 'Magic Arrow', 0, 20, 'A handy magical arrow.', I('#7af4ff', 'arrow'), ARROW, { delay: 1 });
withTrigger(marrow, 'trigger', 'magic_arrow_trigger', 'Magic Arrow with Trigger', 35, 'A magic arrow that casts another spell when it hits something.');
withTrigger(marrow, 'timer', 'magic_arrow_timer', 'Magic Arrow with Timer', 35, 'A magic arrow that casts another spell after a moment.', 6, { noita: 'Magic Arrow With Timer' });

const BOLT: Partial<Proj> = { visual: 'bolt', dmg: 8, crit: 0.05, speed: 1.7, life: 26, spread: 5, color: 0xffc040, size: 0.18 };
const mbolt = proj('magic_bolt', 'Magic Bolt', 1, 30, 'A powerful magical bolt.', I('#ffc040', 'bolt'), BOLT, { delay: 2 });
withTrigger(mbolt, 'trigger', 'magic_bolt_trigger', 'Magic Bolt with Trigger', 40, 'A magic bolt that casts another spell when it hits something.', 10, { noita: 'Magic Bolt With Trigger' });
withTrigger(mbolt, 'timer', 'magic_bolt_timer', 'Magic Bolt with Timer', 40, 'A magic bolt that casts another spell after a moment.', 6, { noita: 'Magic Bolt With Timer' });

const BURST: Partial<Proj> = { visual: 'burst', dmg: 2, speed: 0.9, life: 50, bounces: 10, gravity: 0.03, spread: -1, color: 0xfff060, size: 0.12 };
proj('bouncing_burst', 'Bouncing Burst', 0, 5, 'A very bouncy projectile.', I('#fff060', 'burst'), BURST, { delay: -1 });
proj('bouncing_burst_trigger', 'Bouncing Burst with Trigger', 2, 10, 'A bouncy projectile that casts another spell when it ends.', I('#fff060', 'burst', 'expire'), BURST, { delay: -1, trigger: 'expire', noita: 'Bouncing Burst' });

const ORB: Partial<Proj> = { visual: 'orb', dmg: 4, explR: 1.2, explDmg: 4, speed: 0.45, life: 70, spread: 3.6, color: 0xff60d0, size: 0.3 };
const eorb = proj('energy_orb', 'Energy Orb', 1, 30, 'A slow but powerful orb of energy.', I('#ff60d0', 'orb'), ORB, { delay: 2 });
withTrigger(eorb, 'trigger', 'energy_orb_trigger', 'Energy Orb with Trigger', 50, 'An energy orb that casts another spell when it hits something.', 10, { delay: 8, noita: 'Energy Orb With A Trigger' });
withTrigger(eorb, 'timer', 'energy_orb_timer', 'Energy Orb with Timer', 50, 'An energy orb that casts another spell after a while.', 30, { noita: 'Energy Orb With A Timer' });

const SPHERE: Partial<Proj> = { visual: 'orb', dmg: 5, speed: 1.5, life: 60, gravity: 0.04, bounces: 5, bounceKeep: 0.8, color: 0x60c0ff, size: 0.16 };
const esphere = proj('energy_sphere', 'Energy Sphere', 1, 20, 'A fast, arcing projectile.', I('#60c0ff', 'orb'), SPHERE, { delay: 3 });
withTrigger(esphere, 'timer', 'energy_sphere_timer', 'Energy Sphere with Timer', 50, 'A fast, arcing projectile that casts another spell after a while.', 25, { noita: 'Energy Sphere With Timer' });

const SPIT: Partial<Proj> = { visual: 'spit', dmg: 2, speed: 1.0, life: 10, spread: 6, gravity: 0.02, color: 0xa0ff60, size: 0.1 };
const spit = proj('spitter', 'Spitter Bolt', 0, 5, 'A short-lived, weak and wobbly bolt.', I('#a0ff60', 'spit'), SPIT, { delay: 0 });
withTrigger(spit, 'timer', 'spitter_timer', 'Spitter Bolt with Timer', 10, 'A spitter bolt that casts another spell when it fades.', 8);
const LSPIT: Partial<Proj> = { ...SPIT, dmg: 4, life: 12, spread: 7.5, size: 0.14, color: 0x80ff40 };
const lspit = proj('large_spitter', 'Large Spitter Bolt', 1, 25, 'A more powerful version of Spitter Bolt.', I('#80ff40', 'spit'), LSPIT, { delay: -1 });
withTrigger(lspit, 'timer', 'large_spitter_timer', 'Large Spitter Bolt with Timer', 30, 'A large spitter bolt that casts another spell when it fades.', 10, { noita: 'Large Spitter Bolt With Timer' });
const GSPIT: Partial<Proj> = { ...SPIT, dmg: 7, life: 14, spread: 9, size: 0.18, color: 0x60ff20 };
const gspit = proj('giant_spitter', 'Giant Spitter Bolt', 2, 40, 'The most powerful version of Spitter Bolt.', I('#60ff20', 'spit'), GSPIT, { delay: -1 });
withTrigger(gspit, 'timer', 'giant_spitter_timer', 'Giant Spitter Bolt with Timer', 45, 'A giant spitter bolt that casts another spell when it fades.', 12, { noita: 'Giant Spitter Bolt With Timer' });

const BUBBLE: Partial<Proj> = { visual: 'bubble', dmg: 2, speed: 0.45, life: 40, gravity: -0.008, bounces: 3, spread: 22.9, color: 0x80d8ff, size: 0.18 };
const bubble = proj('bubble_spark', 'Bubble Spark', 0, 5, 'A bouncy bubble that floats upwards.', I('#80d8ff', 'bubble'), BUBBLE, { delay: -2 });
withTrigger(bubble, 'trigger', 'bubble_spark_trigger', 'Bubble Spark with Trigger', 16, 'A bubble that casts another spell when it pops.');
proj('arrow', 'Arrow', 0, 15, 'Summons an arrow.', I('#d8b080', 'wood'), { visual: 'wood', dmg: 5, speed: 1.6, gravity: 0.05, life: 60, spread: -20, color: 0xd8b080, size: 0.12 }, { delay: 3 });
proj('triplicate_bolt', 'Triplicate Bolt', 1, 25, 'Three bolts at once.', I('#80e0ff', 'bolt'), { visual: 'bolt', dmg: 4, speed: 1.3, life: 48, bounces: 1, spread: 14, color: 0x80e0ff, size: 0.12 }, { delay: 3, count: 3 });
proj('chain_bolt', 'Chain Bolt', 3, 80, 'A mysterious bolt that jumps from enemy to enemy.', I('#a0ffff', 'lightning'), { visual: 'bolt', dmg: 7, speed: 1.5, life: 20, spread: 14, color: 0xa0ffff, size: 0.14, data: { jumps: 5 } }, {
  delay: 15,
  touch(l, e, w) {
    const left = l.p.data.jumps ?? 0;
    if (left <= 0) return;
    const next = w.foes(e.x, e.y + e.height / 2, e.z, 9).find((f) => f !== e && f.id !== l.p.data.from);
    if (!next) return;
    const dx = next.x - e.x, dy = next.y + next.height / 2 - (e.y + e.height / 2), dz = next.z - e.z, d = Math.hypot(dx, dy, dz) || 1;
    w.spawn('chain_bolt', e.x + (dx / d) * 0.8, e.y + e.height / 2, e.z + (dz / d) * 0.8, dx / d, dy / d, dz / d, { data: { jumps: left - 1, from: e.id }, spread: 0 });
    w.fx('arc', e.x, e.y + e.height / 2, e.z, [next.x, next.y + next.height / 2, next.z, 0xa0ffff]);
  },
});

// ---- fire
const FIREBALL: Partial<Proj> = { visual: 'fire', explR: 2.2, explDmg: 9, terrain: 6, fire: true, gravity: 0.015, speed: 0.8, life: 60, spread: 4, color: 0xff7a1a, size: 0.3 };
proj('fireball', 'Fireball', 2, 70, 'A powerful exploding spell that sets things alight.', I('#ff7a1a', 'fireball'), FIREBALL, { delay: 17, uses: 15 });
const FIREBOLT: Partial<Proj> = { visual: 'fire', dmg: 3, fire: true, explR: 1.3, explDmg: 5, terrain: 2, gravity: 0.035, speed: 1.1, life: 40, bounces: 3, bounceKeep: 0.7, spread: 2.9, color: 0xff4a00, size: 0.2 };
const firebolt = proj('firebolt', 'Firebolt', 1, 50, 'A bouncy, burning bolt of fire.', I('#ff4a00', 'firebolt'), FIREBOLT, { delay: 10, uses: 25 });
withTrigger(firebolt, 'trigger', 'firebolt_trigger', 'Firebolt with Trigger', 50, 'A bouncy, explosive bolt that casts another spell when it hits something.', 10, { noita: 'Firebolt With Trigger' });
proj('large_firebolt', 'Large Firebolt', 2, 90, 'A more powerful version of Firebolt.', I('#ff6000', 'firebolt'), { ...FIREBOLT, dmg: 5, explR: 2, explDmg: 9, terrain: 4, bounces: 4, size: 0.28 }, { delay: 17, uses: 20 });
proj('giant_firebolt', 'Giant Firebolt', 3, 90, 'The most powerful version of Firebolt.', I('#ff8000', 'firebolt'), { ...FIREBOLT, dmg: 8, explR: 2.8, explDmg: 14, terrain: 6, bounces: 5, size: 0.38, speed: 0.95 }, { delay: 27, uses: 20 });
proj('odd_firebolt', 'Odd Firebolt', 2, 50, 'A somewhat peculiar bouncy, explosive bolt.', I('#ff40a0', 'firebolt'), { ...FIREBOLT, path: 'chaos', bounces: 4, color: 0xff5090 }, { delay: 10, uses: 25 });
proj('firebomb', 'Firebomb', 0, 10, 'A small bomb of fire.', I('#ff8020', 'bomb'), { visual: 'bomb', explR: 1.3, explDmg: 5, terrain: 2, fire: true, gravity: 0.05, speed: 0.7, life: 28, bounces: 999, bounceKeep: 0.5, fuse: true, spread: 2.9, color: 0xff8020, size: 0.2 }, { delay: 0 });
proj('flamethrower', 'Flamethrower', 1, 20, 'A short-ranged burst of flames.', I('#ff9030', 'fire'), { visual: 'fire', dmg: 2, fire: true, speed: 0.75, life: 11, gravity: -0.01, drag: 0.95, spread: 4, color: 0xff9030, size: 0.12, fireTrail: true }, { uses: 60 });
proj('meteor', 'Meteor', 4, 150, 'Calls a burning rock down from the sky on what you look at.', I('#ff6020', 'meteor'), { ...FIREBALL, explR: 4, explDmg: 30, terrain: 10, gravity: 0.06, speed: 1.4, life: 80, size: 0.6, sky: true, spread: 0 }, { delay: 40, uses: 10 });
proj('fireworks', 'Fireworks!', 2, 70, 'A fiery projectile that bursts into a shower of colour.', I('#ff60a0', 'fireball'), {
  visual: 'fire', speed: 0.6, path: 'accel', life: 16, explR: 1, explDmg: 4, terrain: 1, color: 0xff60a0, size: 0.18, rainbow: true,
  spawns: [{ on: 'end', spell: 'firework_spark', n: 18, dir: 'random' }],
}, { delay: 20, uses: 25, noita: 'Fireworks!' });
proj('firework_spark', 'Firework Spark', 5, 0, 'A spark of a firework.', I('#ffffff'), { visual: 'spark', dmg: 3, fire: true, speed: 0.55, life: 18, gravity: 0.02, drag: 0.95, rainbow: true, color: 0xffffff, size: 0.1 }, { hidden: true });
proj('fireball_small', 'Small Fireball', 5, 0, 'A thrown fireball.', I('#ff8040'), { visual: 'fire', explR: 1.1, explDmg: 4, terrain: 1, fire: true, speed: 0.9, life: 24, color: 0xff8040, size: 0.18 }, { hidden: true });

// ---- bombs
proj('bomb', 'Bomb', 1, 25, 'A bomb that bounces and rolls for three seconds, then explodes.', I('#3a3a3a', 'bomb'), { visual: 'bomb', explR: 3.5, explDmg: 20, terrain: 8, gravity: 0.05, speed: 0.65, life: 60, bounces: 999, bounceKeep: 0.55, drag: 0.99, fuse: true, color: 0xff9020, size: 0.3 }, { delay: 33, uses: 3 });
proj('dynamite', 'Dynamite', 2, 50, 'A stick of dynamite with a short fuse.', I('#d02020', 'dynamite'), { visual: 'dynamite', explR: 2.5, explDmg: 14, terrain: 6, gravity: 0.05, speed: 0.8, life: 30, bounces: 999, bounceKeep: 0.4, fuse: true, spread: 6, color: 0xffa040, size: 0.25 }, { delay: 17, uses: 16 });
proj('glitter_bomb', 'Glitter Bomb', 2, 70, 'A bomb that explodes into volatile fragments.', I('#ff80ff', 'bomb'), {
  visual: 'bomb', explR: 1.6, explDmg: 6, terrain: 2, gravity: 0.05, speed: 0.7, life: 24, bounces: 999, bounceKeep: 0.5, fuse: true, spread: 12, color: 0xff80ff, size: 0.25,
  spawns: [{ on: 'end', spell: 'glitter_spark', n: 14, dir: 'random' }],
}, { delay: 17, uses: 16 });
proj('glitter_spark', 'Glitter', 5, 0, 'A volatile fragment.', I('#ffffff'), { visual: 'spark', dmg: 2, explR: 0.8, explDmg: 3, speed: 0.6, life: 22, gravity: 0.015, bounces: 2, rainbow: true, color: 0xffffff, size: 0.09 }, { hidden: true });
proj('holy_bomb', 'Holy Bomb', 5, 300, 'An extremely destructive bomb. Run.', I('#ffe080', 'holy'), { visual: 'holy', explR: 7, explDmg: 60, terrain: 50, gravity: 0.05, speed: 0.5, life: 68, bounces: 999, bounceKeep: 0.5, fuse: true, color: 0xffe080, size: 0.35 }, { delay: 13, reload: 27, uses: 2 });
proj('giga_holy_bomb', 'Giga Holy Bomb', 5, 600, 'Bigger and therefore holier.', I('#ffd040', 'holy'), { visual: 'holy', explR: 9.5, explDmg: 110, terrain: 80, gravity: 0.05, speed: 0.45, life: 100, bounces: 999, bounceKeep: 0.5, fuse: true, color: 0xffd040, size: 0.5 }, { delay: 40, reload: 53, uses: 2 });
proj('nuke', 'Nuke', 5, 200, 'Take cover!', I('#c0ff40', 'bomb'), { visual: 'icon', explR: 8, explDmg: 75, terrain: 70, fire: true, gravity: 0.025, speed: 0.6, life: 140, color: 0xc0ff40, size: 0.4 }, { delay: 7, reload: 200, uses: 1 });
proj('giga_nuke', 'Giga Nuke', 5, 500, 'What do you expect?', I('#ffff40', 'bomb'), { visual: 'icon', explR: 11, explDmg: 140, terrain: 120, fire: true, gravity: 0.02, speed: 0.4, life: 140, color: 0xffff40, size: 0.55 }, { delay: 17, reload: 267, uses: 1 });
proj('bomb_cart', 'Bomb Cart', 3, 75, 'A self-propelled mine cart loaded with explosives.', I('#808080', 'bomb'), {
  visual: 'icon', explR: 3, explDmg: 18, terrain: 8, gravity: 0.06, speed: 0.45, life: 120, bounces: 999, bounceKeep: 0.85, fuse: true, steer: ['horizontal'], color: 0xa0a0a0, size: 0.4,
}, { delay: 20, uses: 6 });
proj('propane_tank', 'Propane Tank', 3, 75, 'A propane tank: it goes off when something explodes near it, or when it catches fire.', I('#9090ff', 'dynamite'), {
  visual: 'icon', explR: 4, explDmg: 30, terrain: 10, fire: true, gravity: 0.05, speed: 0.55, life: 400, bounces: 999, bounceKeep: 0.35, fuse: true, dormant: true, color: 0x9090ff, size: 0.35,
}, {
  delay: 33, uses: 10,
  tick(l, w) { if (l.age % 4 === 0 && ['fire', 'lava'].includes(w.id(Math.floor(l.x), Math.floor(l.y), Math.floor(l.z)))) l.kill(); },
});
const CRYSTAL: Partial<Proj> = { visual: 'icon', explR: 3.2, explDmg: 22, terrain: 8, gravity: 0.05, speed: 0.6, life: 600, fuse: true, bounces: 0, color: 0xff80c0, size: 0.3 };
const unstable = (l: Live, w: SpellWorld) => { if (l.age > 10 && l.age % 2 === 0 && w.near(l.x, l.y, l.z, 2, l.age < 40).length) l.kill(); };
proj('unstable_crystal', 'Unstable Crystal', 2, 20, 'A crystal that explodes when someone comes near.', I('#ff80c0', 'holy'), CRYSTAL, { delay: 10, uses: 15, tick: unstable });
proj('unstable_crystal_trigger', 'Unstable Crystal with Trigger', 3, 20, 'A crystal that explodes and casts another spell when someone comes near.', I('#ff80c0', 'holy', 'expire'), CRYSTAL, { delay: 10, uses: 15, tick: unstable, trigger: 'expire', noita: 'Unstable Crystal With Trigger' });
const DORMANT: Partial<Proj> = { ...CRYSTAL, dormant: true, life: 1200, bounces: 4, bounceKeep: 0.4, color: 0xc080ff };
proj('dormant_crystal', 'Dormant Crystal', 2, 20, 'A crystal that explodes when caught in an explosion.', I('#c080ff', 'holy'), DORMANT, { delay: 10, uses: 20 });
proj('dormant_crystal_trigger', 'Dormant Crystal with Trigger', 3, 20, 'A crystal that explodes and casts another spell when caught in an explosion.', I('#c080ff', 'holy', 'expire'), DORMANT, { delay: 10, uses: 20, trigger: 'expire', noita: 'Dormant Crystal With Trigger' });
proj('prickly_spore_pod', 'Prickly Spore Pod', 2, 20, 'A spore pod that sticks to a surface, grows, and bursts into spikes.', I('#80a040', 'bomb'), {
  visual: 'icon', explR: 1, explDmg: 3, gravity: 0.05, speed: 0.7, life: 40, fuse: true, color: 0x80a040, size: 0.22,
  spawns: [{ on: 'end', spell: 'spore_spike', n: 10, dir: 'hemi' }],
}, { delay: 13 });
proj('spore_spike', 'Spore Spike', 5, 0, 'A spike.', I('#c0e080'), { visual: 'ray', dmg: 4, speed: 1.3, life: 10, gravity: 0.02, color: 0xc0e080, size: 0.08 }, { hidden: true });

// ---- holes
proj('black_hole', 'Black Hole', 4, 180, 'A slow orb of void that eats through anything in its way.', I('#7020c0', 'hole'), { visual: 'hole', speed: 0.18, life: 70, ghost: true, pierce: true, color: 0x9040ff, size: 0.45 }, {
  delay: 27, uses: 3,
  tick(l, w) {
    if (l.age % 3 === 0) w.dig(l.x, l.y, l.z, 1.6, 30);
    for (const e of w.near(l.x, l.y, l.z, 6, true)) {
      w.pull(e, l.x, l.y, l.z, 0.06);
      if (l.age % 10 === 0 && Math.hypot(e.x - l.x, e.y + e.height / 2 - l.y, e.z - l.z) < 1.8) w.hurt(e, 3);
    }
  },
});
proj('black_hole_death', 'Black Hole with Death Trigger', 5, 200, 'A black hole that casts another spell as it collapses.', I('#7020c0', 'hole', 'expire'), { visual: 'hole', speed: 0.18, life: 70, ghost: true, pierce: true, color: 0x9040ff, size: 0.45 }, {
  delay: 30, uses: 3, trigger: 'expire', noita: 'Black Hole with Death Trigger',
  tick(l, w) {
    if (l.age % 3 === 0) w.dig(l.x, l.y, l.z, 1.6, 30);
    for (const e of w.near(l.x, l.y, l.z, 6, true)) w.pull(e, l.x, l.y, l.z, 0.06);
  },
});
proj('white_hole', 'White Hole', 4, 180, 'An orb of positive energy that pushes everything away and breaks what it touches.', I('#ffffff', 'hole'), { visual: 'whitehole', speed: 0.18, life: 70, ghost: true, pierce: true, color: 0xfff8e0, size: 0.45 }, {
  delay: 27, uses: 3,
  tick(l, w) {
    if (l.age % 3 === 0) w.dig(l.x, l.y, l.z, 1.4, 30);
    for (const e of w.near(l.x, l.y, l.z, 6, true)) {
      w.pull(e, l.x, l.y, l.z, -0.09);
      if (l.age % 10 === 0 && Math.hypot(e.x - l.x, e.y + e.height / 2 - l.y, e.z - l.z) < 2) w.hurt(e, 4);
    }
  },
});

// ---- digging and cutting
proj('digging_bolt', 'Digging Bolt', 0, 0, 'Digs through soft ground: dirt, sand, gravel, stone.', I('#d8c090', 'dig'), { visual: 'dig', dmg: 1, digHard: 2, digCount: 3, speed: 1.0, life: 8, color: 0xd8c090, size: 0.1 }, { delay: 0, reload: -3 });
proj('digging_blast', 'Digging Blast', 1, 0, 'Blasts a small hole into soft ground.', I('#c89060', 'digblast'), { visual: 'dig', dmg: 1, digHard: 2.5, digCount: 1, digR: 1.3, speed: 1.1, life: 4, color: 0xc89060, size: 0.12 }, { delay: 0, reload: -3 });
proj('chainsaw', 'Chainsaw', 1, 1, 'Cuts and digs at very close range. Makes the wand fire as fast as it can.', I('#e8e8e8', 'saw'), { visual: 'saw', dmg: 3, digHard: 1.6, digCount: 1, speed: 0.9, life: 2, spread: 6, color: 0xffffff, size: 0.1 }, { delay: -20, reload: -3 });
const DRILL: Partial<Proj> = { visual: 'drill', dmg: 4, digHard: 3.5, digCount: 6, pierce: true, speed: 2.2, life: 3, color: 0x9ff8ff, size: 0.1 };
const drill = proj('luminous_drill', 'Luminous Drill', 2, 10, 'A bright, piercing drill of light: ores and stone alike.', I('#9ff8ff', 'drill'), DRILL, { delay: -12, reload: -3 });
withTrigger(drill, 'timer', 'luminous_drill_timer', 'Luminous Drill with Timer', 30, 'A luminous drill that casts another spell after a moment.', 2, { noita: 'Luminous Drill With Timer' });
proj('plasma_cutter', 'Plasma Cutter', 3, 40, 'A plasma beam made for cutting through the ground.', I('#ff60ff', 'drill'), { visual: 'beam', dmg: 3, digHard: 3.5, digCount: 24, pierce: true, speed: 4, life: 4, color: 0xff60ff, size: 0.08 }, { reload: 3 });
proj('glowing_lance', 'Glowing Lance', 2, 30, 'A long spear of light that cuts through soft ground and everything it hits.', I('#ffffa0', 'lance'), { visual: 'lance', dmg: 10, pierce: true, digHard: 1, digCount: 6, speed: 2.2, life: 25, spread: -20, color: 0xffffa0, size: 0.1 }, { delay: 7 });
proj('holy_lance', 'Holy Lance', 4, 120, 'A fast, piercing lance that glows with power.', I('#ffe040', 'lance'), { visual: 'lance', dmg: 18, pierce: true, bounces: 3, digHard: 1.5, digCount: 8, explR: 1.5, explDmg: 6, terrain: 2, speed: 2.6, life: 40, spread: -10, color: 0xffe040, size: 0.14 }, { delay: 10 });
proj('omega_sawblade', 'Summon Omega Sawblade', 4, 70, 'That\'s a lot of sawblade.', I('#d0d0d0', 'saw'), { visual: 'icon', dmg: 14, pierce: true, bounces: 10, bounceKeep: 0.95, digHard: 2.5, digCount: 30, speed: 0.9, life: 120, spread: 6.4, color: 0xd0d0d0, size: 0.7 }, { delay: 13 });
proj('disc', 'Disc Projectile', 1, 20, 'A sharp disc that bounces and cuts through creatures.', I('#c0c0c0', 'saw'), { visual: 'icon', dmg: 5, pierce: true, bounces: 2, speed: 1.2, life: 80, spread: 2, color: 0xc0c0c0, size: 0.25 }, { delay: 3, noita: 'Disc Projectile' });
proj('giga_disc', 'Giga Disc Projectile', 3, 38, 'A large, serrated disc with a curious flight pattern.', I('#e0e0e0', 'saw'), { visual: 'icon', dmg: 10, pierce: true, bounces: 2, path: 'sine', speed: 0.9, life: 120, spread: 3.4, color: 0xe0e0e0, size: 0.45 }, { delay: 7 });
proj('worm_launcher', 'Worm Launcher', 4, 150, 'A giant worm that burrows through everything for a moment.', I('#c08070', 'tentacle'), {
  visual: 'worm', dmg: 8, pierce: true, ghost: true, path: 'sine', speed: 0.6, life: 100, spread: 20, color: 0xc08070, size: 0.5,
}, {
  delay: 27, reload: 13, uses: 10,
  tick(l, w) { if (l.age % 2 === 0) w.dig(l.x, l.y, l.z, 1.3, 3); },
});

// ---- light and beams
const LIGHT: Partial<Proj> = { visual: 'beam', dmg: 5, bounces: 10, bounceKeep: 1, speed: 4, life: 6, color: 0xffff80, size: 0.08 };
proj('concentrated_light', 'Concentrated Light', 1, 30, 'A beam of light that bounces off walls.', I('#ffff80', 'lance'), LIGHT, { delay: -7 });
proj('intense_concentrated_light', 'Intense Concentrated Light', 3, 110, 'A powerful beam of light that bounces off walls.', I('#fff040', 'lance'), { ...LIGHT, dmg: 16, life: 10, size: 0.14, spread: 2.9 }, { delay: 30 });
proj('plasma_beam', 'Plasma Beam', 2, 60, 'An instantaneous, dangerous beam of light.', I('#ff40ff', 'lance'), { visual: 'beam', dmg: 6, pierce: true, speed: 5, life: 5, color: 0xff40ff, size: 0.1 }, { delay: 2 });
proj('pinpoint_of_light', 'Pinpoint of Light', 3, 65, 'A slow, extremely concentrated point of light: it burns through what it passes, then explodes.', I('#ffffff', 'spark'), { visual: 'spark', dmg: 4, pierce: true, explR: 2.2, explDmg: 14, terrain: 1, speed: 0.45, life: 36, spread: 6, color: 0xffffe0, size: 0.12 }, { delay: 13 });
proj('lightning_bolt', 'Lightning Bolt', 3, 70, 'A bolt of lightning that strikes with a thunderclap.', I('#d0e8ff', 'lightning'), { visual: 'lightning', dmg: 6, explR: 1.6, explDmg: 8, terrain: 1.5, elec: 6, speed: 3.5, life: 12, color: 0xd0e8ff, size: 0.15 }, { delay: 17 });
proj('ball_lightning', 'Ball Lightning', 3, 70, 'Three short-ranged orbs of lightning.', I('#a0c0ff', 'orb'), { visual: 'orb', dmg: 3, elec: 5, speed: 0.8, life: 12, spread: 45, color: 0xa0c0ff, size: 0.2 }, { delay: 17, count: 3 });
proj('thunder_charge', 'Thunder Charge', 4, 120, 'A projectile with immense stored electricity.', I('#80c0ff', 'zap'), { visual: 'orb', dmg: 6, speed: 0.8, life: 40, color: 0x80c0ff, size: 0.28 }, {
  delay: 40, uses: 3,
  hit(l, h, w) {
    w.blast(h.x, h.y, h.z, 3.5, 18, 2, false, 0x80c0ff, { elec: true });
    for (let k = 0; k < 3; k++) {
      const x = h.x + (w.rand() - 0.5) * 6, z = h.z + (w.rand() - 0.5) * 6;
      w.fx('strike', x, h.y, z, [h.y + 12]);
      for (const e of w.near(x, h.y, z, 2, true)) w.hurt(e, 8);
    }
    w.sound('wands:thunder', h.x, h.y, h.z, 2, 1);
    void l;
  },
});
proj('iceball', 'Iceball', 3, 90, 'A ball of frozen fire: freezes what it hits and the water around.', I('#a0e0ff', 'orb'), { visual: 'orb', dmg: 6, freeze: true, explR: 1.8, explDmg: 8, terrain: 2, gravity: 0.02, speed: 0.9, life: 60, spread: 8, color: 0xa0e0ff, size: 0.3 }, {
  delay: 27, uses: 15,
  hit(_l, h, w) {
    w.transmute(h.x, h.y, h.z, 3, (n) => (n === 'water' ? 'ice' : n === 'lava' ? 'obsidian' : n === 'fire' ? 'air' : null));
    for (const e of w.near(h.x, h.y, h.z, 3, true)) w.effect(e, 'slowness', 80, 3);
  },
});
proj('freezing_gaze', 'Freezing Gaze', 2, 45, 'A heart-freezingly sinister aura: a fan of freezing rays.', I('#c0f0ff', 'snowflake'), { visual: 'ray', dmg: 2, freeze: true, speed: 2, life: 9, bounces: 3, spread: 22, color: 0xc0f0ff, size: 0.08 }, { delay: 7, uses: 20, count: 6 });
proj('cursed_sphere', 'Cursed Sphere', 2, 40, 'Passes through walls and brings bad luck to anyone it hits.', I('#a040ff', 'orb'), { visual: 'orb', dmg: 6, ghost: true, speed: 0.6, life: 48, spread: 8.6, color: 0x8030c0, size: 0.22, inflict: [['cursed', 200]] }, { delay: 7 });
proj('expanding_sphere', 'Expanding Sphere', 3, 70, 'A slow projectile whose damage grows the longer it flies.', I('#ff80ff', 'orb'), { visual: 'orb', dmg: 2, speed: 0.35, life: 72, spread: 8.6, color: 0xff80ff, size: 0.25 }, {
  delay: 10,
  tick(l) { l.p.dmg = Math.min(30, 2 + l.age * 0.4); },
});
proj('pollen', 'Pollen', 1, 10, 'A small, floating projectile that drifts toward nearby creatures.', I('#ffe060', 'spark'), { visual: 'spark', dmg: 2, homing: 0.08, speed: 0.3, life: 120, gravity: -0.002, bounces: 1, spread: 20, color: 0xffe060, size: 0.08 }, { delay: 1 });
proj('infestation', 'Infestation', 1, 40, 'A bunch of magical sparks that fly every which way.', I('#c0ff80', 'spark'), { visual: 'spark', dmg: 2, path: 'chaos', speed: 0.6, life: 40, bounces: 20, spread: 180, color: 0xc0ff80, size: 0.08 }, { delay: -1, count: 5 });
proj('spiral_shot', 'Spiral Shot', 2, 50, 'A mystical whirlwind of magic sparks.', I('#80ffff', 'spiral'), { visual: 'orb', dmg: 3, path: 'spiral', speed: 0.6, life: 40, color: 0x80ffff, size: 0.18, spawns: [{ on: 'tick', every: 3, spell: 'spiral_spark', n: 1, dir: 'perp' }] }, { delay: 7, uses: 15 });
proj('spiral_spark', 'Spiral Spark', 5, 0, 'A spark of a whirlwind.', I('#80ffff'), { visual: 'spark', dmg: 2, speed: 0.5, life: 10, color: 0x80ffff, size: 0.08 }, { hidden: true });
proj('dropper_bolt', 'Dropper Bolt', 2, 80, 'A bolt that drops a rain of sparks as it flies.', I('#ffd080', 'bolt'), { visual: 'bolt', dmg: 3, speed: 1, life: 60, bounces: 1, spread: 2.9, color: 0xffd080, size: 0.14, spawns: [{ on: 'tick', every: 3, spell: 'dropper_drop', dir: 'down' }] }, { delay: 13, uses: 35 });
proj('dropper_drop', 'Dropper Spark', 5, 0, 'A falling spark.', I('#ffd080'), { visual: 'spark', dmg: 3, speed: 0.3, gravity: 0.06, life: 24, color: 0xffd080, size: 0.08 }, { hidden: true });

// ---- creatures and things
proj('summon_rock', 'Rock', 2, 100, 'Conjures a heavy rock. Where it lands, it stays.', I('#8a8a8a', 'rock'), { visual: 'rock', dmg: 8, gravity: 0.06, speed: 0.7, life: 80, color: 0x9a9a9a, size: 0.4 }, {
  delay: 10, uses: 3, noita: 'Rock',
  hit(_l, h, w) {
    if (h.reason === 'block') { const [x, y, z] = landing(h); if (!w.solid(x, y, z)) w.place(x, y, z, 'cobblestone'); }
  },
});
proj('rock_spirit', 'Summon Rock Spirit', 3, 120, 'A boulder that rolls after your enemies on its own.', I('#909090', 'rock'), { visual: 'rock', dmg: 6, pierce: true, homing: 0.1, gravity: 0.05, bounces: 999, bounceKeep: 0.8, fuse: true, speed: 0.5, life: 240, color: 0x909090, size: 0.4 }, { delay: 27, uses: 10 });
proj('tentacle', 'Summon Tentacle', 2, 20, 'Calls a terrifying appendage from another dimension: it pulls what it grabs to you.', I('#50e090', 'tentacle'), { visual: 'tentacle', dmg: 3, speed: 1.8, life: 5, color: 0x50e090, size: 0.12 }, {
  delay: 13,
  hit(l, h, w) { if (h.entity && l.caster) w.pull(h.entity, l.caster.x, l.caster.y + 1, l.caster.z, 0.9); },
});
proj('tentacle_timer', 'Summon Tentacle with Timer', 3, 20, 'A tentacle that casts another spell after a moment.', I('#50e090', 'tentacle', 'timer'), { visual: 'tentacle', dmg: 3, speed: 1.8, life: 5, color: 0x50e090, size: 0.12 }, {
  delay: 13, trigger: 'timer', timer: 3, noita: 'Summon Tentacle With Timer',
  hit(l, h, w) { if (h.entity && l.caster) w.pull(h.entity, l.caster.x, l.caster.y + 1, l.caster.z, 0.9); },
});
proj('missile', 'Summon Missile', 3, 60, 'A missile!!!', I('#ffa060', 'fireball'), { visual: 'fire', explR: 2, explDmg: 10, terrain: 3, fire: true, homing: 0.15, path: 'accel', speed: 0.4, life: 60, color: 0xffa060, size: 0.2 }, { reload: 10, uses: 20, noita: 'Summon Missile' });
const MISSILE: Partial<Proj> = { visual: 'fire', explR: 1.8, explDmg: 10, terrain: 4, fire: true, homing: 0.06, path: 'accel', speed: 0.5, life: 100, color: 0xff9040, size: 0.2 };
proj('magic_missile', 'Magic Missile', 2, 70, 'A fiery, explosive missile.', I('#ff9040', 'fireball'), MISSILE, { delay: 20, uses: 10 });
proj('large_magic_missile', 'Large Magic Missile', 3, 90, 'A more powerful version of Magic Missile.', I('#ff7020', 'fireball'), { ...MISSILE, explR: 2.6, explDmg: 18, terrain: 6, size: 0.3 }, { delay: 30, uses: 8 });
proj('giant_magic_missile', 'Giant Magic Missile', 4, 120, 'The most powerful version of Magic Missile.', I('#ff5000', 'fireball'), { ...MISSILE, explR: 3.5, explDmg: 28, terrain: 8, size: 0.4 }, { delay: 40, uses: 6 });
proj('flock_of_ducks', 'Flock of Ducks', 3, 100, 'A chaotic flock of spicy ducks.', I('#ffe080', 'burst'), {
  visual: 'icon', dmg: 4, explR: 0.9, explDmg: 4, path: 'chaos', speed: 0.6, life: 70, bounces: 5, color: 0xffe080, size: 0.3, spread: 35,
}, { delay: 20, reload: 7, uses: 20, count: 5, noita: 'Flock Of Ducks' });
proj('summon_fish', 'Summon Fish', 2, 90, 'FISH!', I('#80a0ff', 'drop'), { visual: 'icon', gravity: 0.05, speed: 0.7, life: 60, color: 0x80a0ff, size: 0.3 }, {
  delay: 27, uses: 20,
  hit(_l, h, w) { const [x, y, z] = landing(h); for (let k = 0; k < 3; k++) w.mob('squid', x + 0.5 + (w.rand() - 0.5), y + 0.2, z + 0.5 + (w.rand() - 0.5)); },
});
proj('summon_deercoy', 'Summon Deercoy', 3, 120, 'A seemingly innocent deer. It explodes when hurt, or after a while.', I('#c09060', 'heal'), { visual: 'icon', gravity: 0.05, speed: 0.6, life: 30, color: 0xc09060, size: 0.3 }, {
  delay: 27, uses: 10, noita: 'Summon Deercoy',
  hit(_l, h, w) { const [x, y, z] = landing(h); const e = w.mob('cow', x + 0.5, y + 0.1, z + 0.5); if (e) w.rig(e, 3, 20, 200); },
});
const EGG: Partial<Proj> = { visual: 'icon', gravity: 0.05, speed: 0.7, life: 60, color: 0xf0f0e0, size: 0.22 };
const EGG_MOBS = ['zombie', 'skeleton', 'spider', 'creeper', 'slime', 'silverfish', 'chicken', 'pig', 'wolf', 'bat'];
proj('summon_egg', 'Summon Egg', 3, 100, 'An egg that hatches into some creature or other.', I('#f0f0e0', 'orb'), EGG, {
  uses: 2,
  hit(_l, h, w) { const [x, y, z] = landing(h); w.mob(EGG_MOBS[Math.floor(w.rand() * EGG_MOBS.length)], x + 0.5, y + 0.1, z + 0.5); w.sound('dig.stone', x, y, z, 0.6, 1.6); },
});
proj('summon_hollow_egg', 'Summon Hollow Egg', 1, 30, 'An empty egg: when it breaks, it casts the spell after it.', I('#e0e0d0', 'orb', 'trigger'), EGG, { delay: -4, trigger: 'hit' });
proj('explosive_box', 'Summon Explosive Box', 2, 40, 'A box of explosives: where it lands, TNT.', I('#c04020', 'dynamite'), { visual: 'icon', gravity: 0.05, speed: 0.6, life: 60, color: 0xc04020, size: 0.3 }, {
  uses: 15,
  hit(_l, h, w) { const [x, y, z] = landing(h); if (!w.solid(x, y, z)) w.place(x, y, z, 'tnt'); },
});
proj('large_explosive_box', 'Summon Large Explosive Box', 3, 40, 'A big box of explosives: where it lands, a heap of TNT.', I('#c04020', 'dynamite'), { visual: 'icon', gravity: 0.05, speed: 0.55, life: 60, color: 0xc04020, size: 0.4 }, {
  uses: 15,
  hit(_l, h, w) { const [x, y, z] = landing(h); for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (!w.solid(x + dx, y, z + dz)) w.place(x + dx, y, z + dz, 'tnt'); },
});

// ---- crosses
proj('death_cross', 'Death Cross', 3, 80, 'A cross that bursts into four deadly rays.', I('#ff3050', 'cross'), { visual: 'cross', dmg: 4, speed: 0.4, life: 18, color: 0xff3050, size: 0.3, spawns: [{ on: 'end', spell: 'death_ray', n: 4, dir: 'ring' }] }, { delay: 13 });
proj('death_ray', 'Death Ray', 5, 0, 'A ray of the Death Cross.', I('#ff3050'), { visual: 'ray', dmg: 8, pierce: true, speed: 2.5, life: 6, color: 0xff3050, size: 0.1 }, { hidden: true });
proj('giga_death_cross', 'Giga Death Cross', 4, 150, 'A giant, deadly cross that explodes after a short time.', I('#ff1030', 'cross'), { visual: 'cross', dmg: 6, explR: 2, explDmg: 10, terrain: 3, speed: 0.35, life: 20, color: 0xff1030, size: 0.5, spawns: [{ on: 'end', spell: 'giga_death_ray', n: 4, dir: 'ring' }] }, { delay: 23, uses: 8 });
proj('giga_death_ray', 'Giga Death Ray', 5, 0, 'A ray of the Giga Death Cross.', I('#ff1030'), { visual: 'ray', dmg: 14, pierce: true, speed: 2.5, life: 9, color: 0xff1030, size: 0.16 }, { hidden: true });
proj('plasma_cross', 'Plasma Beam Cross', 4, 80, 'Four plasma beams in a cross. They can hurt you too.', I('#ff60ff', 'cross'), { visual: 'cross', dmg: 4, speed: 0.4, life: 12, color: 0xff60ff, size: 0.3, spawns: [{ on: 'end', spell: 'plasma_ray', n: 4, dir: 'ring' }] }, { delay: 5, noita: 'Plasma Beam Cross' });
proj('plasma_ray', 'Plasma Ray', 5, 0, 'A ray of the plasma cross.', I('#ff60ff'), { visual: 'beam', dmg: 10, pierce: true, selfHit: true, speed: 4, life: 5, color: 0xff60ff, size: 0.1 }, { hidden: true });

// ---- moving people about
proj('teleport_bolt', 'Teleport Bolt', 1, 40, 'Teleports you to where it lands.', I('#8080ff', 'tp'), { visual: 'tp', speed: 2, life: 16, spread: -2, color: 0x8080ff, size: 0.16 }, { delay: 1, hit: teleportHit });
proj('small_teleport_bolt', 'Small Teleport Bolt', 0, 20, 'Teleports you a short way.', I('#a0a0ff', 'tp'), { visual: 'tp', speed: 2, life: 4, spread: -2, color: 0xa0a0ff, size: 0.12 }, { hit: teleportHit });
function teleportHit(l: Live, h: { x: number; y: number; z: number; nx: number; ny: number; nz: number }, w: SpellWorld) {
  // land on the near side of what it hit
  const k = 0.6;
  w.teleportCaster(h.x - Math.sign(l.vx) * k * (h.nx !== 0 ? 1 : 0) + h.nx * k, h.y + h.ny * k, h.z - Math.sign(l.vz) * k * (h.nz !== 0 ? 1 : 0) + h.nz * k);
}
proj('homebringer', 'Homebringer Teleport Bolt', 1, 20, 'Brings the creature it hits to you.', I('#80ffa0', 'tp'), { visual: 'tp', speed: 2, life: 16, spread: -2, color: 0x80ffa0, size: 0.14 }, {
  noita: 'Homebringer Teleport Bolt',
  touch(l, e, w) { const c = l.caster; if (c) w.teleport(e, c.x + Math.sin(-c.yaw * Math.PI / 180) * 1.5, c.y, c.z + Math.cos(-c.yaw * Math.PI / 180) * 1.5); },
});
proj('swapper', 'Swapper', 1, 5, 'Swaps places with the creature it hits.', I('#ffa0ff', 'tp'), { visual: 'tp', dmg: 1, speed: 2, life: 16, spread: -2, color: 0xffa0ff, size: 0.14 }, {
  delay: 1,
  touch(l, e, w) { const c = l.caster; if (!c) return; const [x, y, z] = [c.x, c.y, c.z]; w.teleportCaster(e.x, e.y, e.z); w.teleport(e, x, y, z); },
});
proj('return', 'Return', 2, 40, 'After a while, you\'re returned to where you cast this spell.', I('#c0a0ff', 'tp'), { visual: 'portal', speed: 0, ghost: true, pierce: true, life: 80, color: 0xc0a0ff, size: 0.3 }, {
  delay: 1,
  hit(l, _h, w) { w.teleportCaster(l.ox, l.oy - 1.2, l.oz); },
});
proj('hookbolt', 'Hookbolt', 1, 30, 'Pulls you to where it hits.', I('#d0d0d0', 'arrow'), { visual: 'arrow', dmg: 2, speed: 1.8, life: 24, color: 0xd0d0d0, size: 0.1 }, {
  delay: 4,
  hit(l, h, w) { if (l.caster && h.reason !== 'expire') w.pull(l.caster, h.x, h.y + 1, h.z, Math.min(2.2, Math.hypot(h.x - l.caster.x, h.z - l.caster.z) * 0.18 + 0.4)); },
});
proj('eldritch_portal', 'Eldritch Portal', 4, 140, 'A slow portal: what it touches is sent away to somewhere far off.', I('#8040c0', 'hole'), { visual: 'portal', pierce: true, speed: 0.3, life: 160, color: 0x8040c0, size: 0.6 }, {
  delay: 10, uses: 5,
  touch(_l, e, w) {
    const a = w.rand() * Math.PI * 2, d = 40 + w.rand() * 30;
    w.teleport(e, e.x + Math.cos(a) * d, e.y + 20, e.z + Math.sin(a) * d);
  },
});
proj('burst_of_air', 'Burst of Air', 0, 5, 'A gust that throws back whatever it meets: creatures, and other projectiles too.', I('#e0f0ff', 'push'), { visual: 'bubble', knock: 2.5, pierce: true, speed: 1.2, life: 14, spread: -2, color: 0xe8f4ff, size: 0.2 }, {
  delay: 1, noita: 'Burst Of Air',
  tick(l, w) {
    const sp = Math.hypot(l.vx, l.vy, l.vz) || 1;
    for (const o of w.projs(l.x, l.y, l.z, 1.6)) {
      if (o.id === l.id || o.p.spell.id === 'burst_of_air' || o.p.orbit) continue;
      o.vx += (l.vx / sp) * 0.5; o.vy += (l.vy / sp) * 0.5 + 0.05; o.vz += (l.vz / sp) * 0.5;
      o.sync();
    }
  },
});

// ---- healing and harm
proj('healing_bolt', 'Healing Bolt', 1, 15, 'Heals whatever it hits (not yourself).', I('#60ff80', 'heal'), { visual: 'heal', heal: 3, speed: 1.3, life: 30, spread: 2, color: 0x60ff80, size: 0.14 }, { delay: 1, uses: 20 });
proj('deadly_heal', 'Deadly Heal', 2, 20, 'Drains the life of what it hits into you.', I('#ff4060', 'heal'), { visual: 'heal', dmg: 5, lifeSteal: 1, speed: 1.3, life: 30, color: 0xff4060, size: 0.14 }, { delay: 3, uses: 20 });
const mist = (id: string, name: string, desc: string, color: string, status: 'bloody' | 'drunk' | 'slimy' | 'toxic', noita: string, uses?: number) =>
  proj(id, name, 2, 40, desc, I(color, 'cloud'), { visual: 'mist', speed: 0.25, drag: 0.97, life: 140, pierce: true, color: hexCol(color), size: 1.4, data: {} }, {
    delay: 3, uses, noita,
    tick(l, w) {
      if (l.age % 5) return;
      for (const e of w.near(l.x, l.y, l.z, 1.8)) { w.status(e, status, 200); if (status === 'toxic') w.effect(e, 'poison', 60, 0); }
    },
  });
mist('blood_mist', 'Blood Mist', 'A cloud of blood mist.', '#c02020', 'bloody', 'Blood Mist', 10);
mist('mist_of_spirits', 'Mist of Spirits', 'A cloud of potent alcohol.', '#d0c080', 'drunk', 'Mist Of Spirits');
mist('slime_mist', 'Slime Mist', 'A cloud of slimy mist.', '#60c040', 'slimy', 'Slime Mist');
mist('toxic_mist', 'Toxic Mist', 'A cloud of toxic mist.', '#90ff40', 'toxic', 'Toxic Mist');
proj('acid_ball', 'Acid Ball', 2, 20, 'A terrifying acidic projectile: it eats into what it hits.', I('#a0ff40', 'drop'), { visual: 'liquid', dmg: 5, gravity: 0.04, speed: 0.8, life: 60, color: 0xa0ff40, size: 0.2, inflict: [['toxic', 100]] }, {
  delay: 3, uses: 20,
  hit(_l, h, w) {
    w.dig(h.x, h.y, h.z, 1.3, 2.5);
    const [x, y, z] = landing(h);
    for (let k = 0; k < 4; k++) { const ax = x + Math.round((w.rand() - 0.5) * 2), az = z + Math.round((w.rand() - 0.5) * 2); if (!w.solid(ax, y, az) && w.solid(ax, y - 1, az)) w.place(ax, y, az, 'wands:acid'); }
    for (const e of w.near(h.x, h.y, h.z, 1.8)) w.hurt(e, 3);
  },
});
proj('slimeball', 'Slimeball', 1, 20, 'A dripping ball of poisonous slime.', I('#60e040', 'drop'), { visual: 'liquid', dmg: 3, gravity: 0.04, speed: 1.1, life: 60, bounces: 3, bounceKeep: 0.6, spread: 4, color: 0x60e040, size: 0.2, inflict: [['slimy', 240], ['toxic', 60]] }, {
  delay: 3,
  hit(_l, h, w) { const [x, y, z] = landing(h); if (!w.solid(x, y, z) && w.solid(x, y - 1, z)) w.place(x, y, z, 'wands:slime'); },
});
proj('glue_ball', 'Glue Ball', 1, 25, 'A sticky ball: it leaves cobwebs where it lands.', I('#f0f0d0', 'drop'), { visual: 'liquid', dmg: 1, gravity: 0.05, speed: 0.9, life: 40, bounces: 2, bounceKeep: 0.5, spread: 5, color: 0xf0f0d0, size: 0.18, inflict: [['slimy', 160]] }, {
  delay: 10,
  hit(_l, h, w) { const [x, y, z] = landing(h); if (!w.solid(x, y, z)) w.place(x, y, z, 'cobweb'); },
});
proj('path_of_dark_flame', 'Path of Dark Flame', 3, 90, 'A trail of dark, deadly flames.', I('#a040ff', 'fire'), { visual: 'fire', dmg: 3, speed: 0.7, life: 40, color: 0x8030ff, size: 0.16, spawns: [{ on: 'tick', every: 2, spell: 'dark_flame', dir: 'same', speed: 0 }] }, { delay: 7, uses: 60, noita: 'Path Of Dark Flame' });
proj('dark_flame', 'Dark Flame', 5, 0, 'A dark flame.', I('#8030ff'), { visual: 'fire', speed: 0, ghost: true, pierce: true, life: 40, aura: 1, color: 0x8030ff, size: 0.18 }, { hidden: true });
proj('earthquake', 'Earthquake', 4, 240, 'Shakes the ground: blocks fall and everything standing is thrown about.', I('#a08060', 'down'), { visual: 'rock', speed: 0.7, gravity: 0.05, life: 40, color: 0x806040, size: 0.25, spawns: [{ on: 'end', spell: 'earthquake_field', dir: 'same', speed: 0 }] }, { uses: 3 });
proj('earthquake_field', 'Quake', 5, 0, 'The ground shaking.', I('#806040'), { visual: 'none', speed: 0, ghost: true, pierce: true, life: 50, color: 0x806040, size: 0.2 }, {
  hidden: true,
  tick(l, w) {
    if (l.age % 4) return;
    for (const e of w.near(l.x, l.y, l.z, 7, true)) { if (e.onGround) { w.hurt(e, 2, { ky: 0.35, kx: (w.rand() - 0.5) * 0.3, kz: (w.rand() - 0.5) * 0.3 }); } }
    for (let k = 0; k < 3; k++) {
      const x = Math.floor(l.x + (w.rand() - 0.5) * 12), z = Math.floor(l.z + (w.rand() - 0.5) * 12);
      for (let y = Math.floor(l.y) + 4; y > l.y - 6; y--) if (w.solid(x, y, z)) { w.dig(x + 0.5, y + 0.5, z + 0.5, 0.6, 1.6); break; }
    }
    w.fx('quake', l.x, l.y, l.z);
  },
});
proj('magic_guard', 'Magic Guard', 2, 40, 'Four guarding lights circle you for a while.', I('#a0e0ff', 'orb'), { visual: 'none', speed: 0, ghost: true, life: 1 }, { delay: 7, tick: guard(4) });
proj('big_magic_guard', 'Big Magic Guard', 3, 60, 'Eight guarding lights circle you for a while.', I('#a0e0ff', 'orb'), { visual: 'none', speed: 0, ghost: true, life: 1 }, { delay: 10, tick: guard(8) });
function guard(n: number) {
  return (l: Live, w: SpellWorld) => {
    if (l.age !== 1) return;
    for (let k = 0; k < n; k++) w.spawn('guard_light', l.x, l.y, l.z, 0, 0, 0, { orbit: { around: 'caster', r: n > 4 ? 2.2 : 1.6, w: 0.22, phase: (k / n) * Math.PI * 2 } });
    l.remove();
  };
}
proj('guard_light', 'Guarding Light', 5, 0, 'A guarding light.', I('#a0e0ff'), { visual: 'orb', dmg: 3, pierce: true, ghost: true, speed: 0, life: 100, color: 0xa0e0ff, size: 0.15 }, { hidden: true });
