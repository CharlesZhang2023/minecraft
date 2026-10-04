// Spells about casting: multicasts (more cards in one cast), "other" spells (triggers, copies, requirements, music),
// utility spells (where and how a cast appears) and passives (what holding the wand does).
import { def, multi, other, utility, proj, makeProj, sec, isCopy, S, Shot, type Icon, type CastCtx, type SpellDef } from '../spelldefs.ts';

const I = (c: string, g: string, n?: string): Icon => ({ g, c, n });

// ---- multicasts
multi('double_spell', 'Double Spell', 0, 0, 'Casts two spells at once.', I('#80ff80', 'digit', '2'), 2);
multi('triple_spell', 'Triple Spell', 1, 2, 'Casts three spells at once.', I('#80ff80', 'digit', '3'), 3);
multi('quadruple_spell', 'Quadruple Spell', 2, 5, 'Casts four spells at once.', I('#80ff80', 'digit', '4'), 4);
multi('octuple_spell', 'Octuple Spell', 4, 30, 'Casts eight spells at once.', I('#80ff80', 'digit', '8'), 8);
multi('myriad_spell', 'Myriad Spell', 5, 50, 'Casts every spell it can at once.', I('#80ff80', 'digit', '?'), 26, { uses: 30 });
multi('scatter_2', 'Double Scatter Spell', 0, 0, 'Casts two spells at once, with a wide spread.', I('#c0ff80', 'scatter', '2'), 2, { scatter: 10 });
multi('scatter_3', 'Triple Scatter Spell', 1, 1, 'Casts three spells at once, with a wide spread.', I('#c0ff80', 'scatter', '3'), 3, { scatter: 20 });
multi('scatter_4', 'Quadruple Scatter Spell', 2, 2, 'Casts four spells at once, with a very wide spread.', I('#c0ff80', 'scatter', '4'), 4, { scatter: 40 });
const around = (n: number) => Array.from({ length: n }, (_, i) => [(i * 360) / n, 0] as [number, number]);
multi('formation_behind', 'Formation - Behind Your Back', 1, 0, 'Casts two spells: one ahead, one behind you.', I('#80ffe0', 'form', 'behind'), 2, { formation: [[0, 0], [180, 0]], scatter: -5 });
multi('formation_bifurcated', 'Formation - Bifurcated', 1, 2, 'Casts two spells in a V.', I('#80ffe0', 'form', 'bi'), 2, { formation: [[-15, 0], [15, 0]], scatter: -8 });
multi('formation_trifurcated', 'Formation - Trifurcated', 2, 3, 'Casts three spells in a fan.', I('#80ffe0', 'form', 'tri'), 3, { formation: [[-20, 0], [0, 0], [20, 0]], scatter: -5 });
multi('formation_above_below', 'Formation - Above and Below', 2, 3, 'Casts three spells: ahead, above and below.', I('#80ffe0', 'form', 'ab'), 3, { formation: [[0, 0], [0, 30], [0, -30]], scatter: -8, noita: 'Formation - Above And Below' });
multi('formation_pentagon', 'Formation - Pentagon', 3, 5, 'Casts five spells all around you.', I('#80ffe0', 'form', 'penta'), 5, { formation: around(5), scatter: -12 });
multi('formation_hexagon', 'Formation - Hexagon', 3, 6, 'Casts six spells all around you.', I('#80ffe0', 'form', 'hexa'), 6, { formation: around(6), scatter: -15 });

// ---- triggers added to the next projectile
/** Give the next projectile drawn a trigger, carrying the spell after it. */
const addTrigger = (t: 'hit' | 'timer' | 'expire', timer?: number) => (c: CastCtx, shot: Shot) => {
  const n = shot.projs.length;
  c.draw(shot, 1);
  const p = shot.projs[n];
  if (!p || p.trigger) return;
  p.trigger = t;
  p.timer = timer;
  p.payload = new Shot();
  c.draw(p.payload, 1);
};
other('add_trigger', 'Add Trigger', 2, 10, 'The next projectile casts the spell after it when it hits something.', I('#ffb040', 'tag', 'trigger'), addTrigger('hit'));
other('add_timer', 'Add Timer', 2, 20, 'The next projectile casts the spell after it a moment into its flight.', I('#ffb040', 'tag', 'timer'), addTrigger('timer', 8));
other('add_expiration', 'Add Expiration Trigger', 2, 20, 'The next projectile casts the spell after it when it ends.', I('#ffb040', 'tag', 'expire'), addTrigger('expire'));

// ---- copies
const divide = (n: number, mana: number, shrink: number, tier: number, extra: Partial<SpellDef> = {}) =>
  other(`divide_${n}`, `Divide by ${n}`, tier, mana, `Casts the next spell ${n} times, with smaller explosions.`, I('#ff80c0', 'divide', String(n)), (c, shot) => {
    const next = c.take();
    if (!next) return;
    const from = shot.projs.length;
    for (let k = 0; k < n; k++) c.play(next, shot);
    for (const p of shot.projs.slice(from)) p.explR = Math.max(0, p.explR - shrink);
  }, { delay: sec(0.33 + (n - 2) * 0.25), noita: `Divide By ${n}`, ...extra });
divide(2, 35, 0.3, 3);
divide(3, 50, 0.5, 4, { delay: sec(0.58) });
divide(4, 70, 0.8, 4, { delay: sec(0.83) });
divide(10, 200, 1.5, 5, { delay: sec(1.33), reload: sec(0.33), uses: 5 });
const greek = (id: string, name: string, tier: number, mana: number, cd: number, desc: string, play: (c: CastCtx, shot: Shot) => void) =>
  other(id, name, tier, mana, desc, I('#ffe080', 'greek', id), play, { delay: sec(cd) });
greek('alpha', 'Alpha', 4, 40, 0.25, 'Casts a copy of the first spell in the wand.', (c, shot) => { const s = c.spells.find((x) => !isCopy(x)); if (s) c.play(s, shot); });
greek('gamma', 'Gamma', 4, 40, 0.25, 'Casts a copy of the last spell in the wand.', (c, shot) => { const s = [...c.spells].reverse().find((x) => !isCopy(x)); if (s) c.play(s, shot); });
greek('tau', 'Tau', 4, 90, 0.58, 'Casts copies of the next two spells.', (c, shot) => { for (const s of c.peek(2)) if (!isCopy(s)) c.play(s, shot); });
greek('omega', 'Omega', 5, 320, 0.83, 'Casts a copy of every spell in the wand.', (c, shot) => { for (const s of c.spells) if (!isCopy(s) && s.type !== 'modifier' && !s.marker) c.play(s, shot); });
greek('mu', 'Mu', 5, 120, 0.83, 'Applies every modifier in the wand to this cast.', (c, shot) => { for (const s of c.spells) if (s.type === 'modifier' && s.mod) shot.mods.push(s.mod); c.draw(shot, 1); });
greek('phi', 'Phi', 5, 120, 0.83, 'Casts a copy of every projectile spell in the wand.', (c, shot) => { for (const s of c.spells) if (s.type === 'projectile') c.play(s, shot); });
greek('sigma', 'Sigma', 5, 120, 0.5, 'Casts a copy of every static projectile spell in the wand.', (c, shot) => { for (const s of c.spells) if (s.type === 'static') c.play(s, shot); });
greek('zeta', 'Zeta', 4, 10, 0, 'Casts a copy of a random spell from another wand you carry.', (c, shot) => {
  const list = c.others.filter((s) => !isCopy(s) && !s.marker);
  if (list.length) c.play(list[Math.floor(c.rand() * list.length)], shot);
});
other('spell_duplication', 'Spell Duplication', 5, 250, 'Casts copies of every spell before it in the wand.', I('#ffe080', 'scatter', '2'), (c, shot) => {
  for (const s of c.before) if (!isCopy(s) && !s.marker && s.type !== 'modifier') c.play(s, shot);
}, { delay: sec(0.33), reload: sec(0.33) });
const pool = (pred: (s: SpellDef) => boolean) => () => S.filter((s) => pred(s) && !s.hidden && !isCopy(s) && !s.marker && !s.passive && s.type !== 'utility');
const randomOf = (id: string, name: string, tier: number, mana: number, desc: string, c: string, from: () => SpellDef[], type: SpellDef['type'] = 'other', noita?: string) =>
  def({ id, name, type, tier, mana, desc, icon: I(c, 'random'), noita, play: (cc, shot) => { const list = from(); if (list.length) cc.play(list[Math.floor(cc.rand() * list.length)], shot); } });
randomOf('random_spell', 'Random Spell', 2, 5, 'Casts a random spell. Anything can happen.', '#ffffff', pool((s) => s.type !== 'other' && !(s.uses && s.uses <= 2)));
randomOf('random_projectile', 'Random Projectile Spell', 1, 20, 'Casts a random projectile spell.', '#7aa0ff', pool((s) => s.type === 'projectile' && !(s.uses && s.uses <= 2)), 'projectile');
randomOf('random_modifier', 'Random Modifier Spell', 1, 20, 'Applies a random modifier to the cast.', '#60e0c0', pool((s) => s.type === 'modifier' && !s.cast), 'modifier');
randomOf('random_static', 'Random Static Projectile Spell', 2, 20, 'Casts a random static projectile spell.', '#ff8060', pool((s) => s.type === 'static' && !(s.uses && s.uses <= 3)), 'static');
const copyRandom = (id: string, name: string, mana: number, desc: string, n: number, same: boolean) =>
  other(id, name, 3, mana, desc, I('#ffffff', 'random', String(n)), (c, shot) => {
    const list = c.spells.filter((s) => !isCopy(s) && !s.marker);
    if (!list.length) return;
    let s = list[Math.floor(c.rand() * list.length)];
    for (let k = 0; k < n; k++) { if (!same && k) s = list[Math.floor(c.rand() * list.length)]; c.play(s, shot); }
  });
copyRandom('copy_random_spell', 'Copy Random Spell', 20, 'Casts a copy of a random spell in the wand.', 1, true);
copyRandom('copy_random_thrice', 'Copy Random Spell Thrice', 50, 'Casts three copies of a random spell in the wand.', 3, true);
copyRandom('copy_three_random', 'Copy Three Random Spells', 40, 'Casts copies of three random spells in the wand.', 3, false);

// ---- requirements: the next spells are cast only if a condition holds (up to Otherwise / Endpoint)
/** If the condition fails, skip cards up to an Otherwise (and play on from there) or an Endpoint. */
const requirement = (id: string, name: string, desc: string, test: (c: CastCtx) => boolean) =>
  other(id, name, 2, 0, desc, I('#ffb0ff', 'tag', 'trigger'), (c, shot) => {
    if (test(c)) {
      c.draw(shot, 1);
      // the alternative, if there is one, is passed over in the same cast
      if (c.peek(1)[0]?.marker === 'else') for (let n = 0; n < 26; n++) { const s = c.skip(); if (!s || s.marker === 'end') break; }
      return;
    }
    for (let n = 0; n < 26; n++) {
      const s = c.skip();
      if (!s || s.marker === 'end') break;
      if (s.marker === 'else') break;
    }
    c.draw(shot, 1);
  });
requirement('if_projectile', 'Requirement - Projectile Spells', 'The spells after it are cast only if you have ten or more projectiles out.', (c) => c.flying >= 10);
requirement('if_hp', 'Requirement - Low Health', 'The spells after it are cast only if your health is low.', (c) => c.health < 0.25);
requirement('if_enemies', 'Requirement - Enemies', 'The spells after it are cast only if there are many enemies around.', (c) => c.enemies >= 5);
requirement('if_every_other', 'Requirement - Every Other', 'The spells after it are cast only every other time.', (c) => c.everyOther());
/** Otherwise: the condition held, so skip the alternative up to an Endpoint. */
other('if_else', 'Requirement - Otherwise', 2, 0, 'What follows is cast when the requirement before it failed.', I('#ffb0ff', 'tag', 'expire'), (c, shot) => {
  for (let n = 0; n < 26; n++) { const s = c.skip(); if (!s || s.marker === 'end') break; }
  c.draw(shot, 1);
}, { marker: 'else' });
other('if_end', 'Requirement - Endpoint', 2, 0, 'Marks where a requirement\'s spells end.', I('#ffb0ff', 'tag', 'timer'), (c, shot) => c.draw(shot, 1), { marker: 'end' });

// ---- music
const NOTES: [string, string, number][] = [
  ['kantele_a', 'Kantele - Note A', 440], ['kantele_d', 'Kantele - Note D', 587.33], ['kantele_dis', 'Kantele - Note D+', 622.25],
  ['kantele_e', 'Kantele - Note E', 659.25], ['kantele_g', 'Kantele - Note G', 783.99],
  ['ocarina_a', 'Ocarina - Note A', 880], ['ocarina_b', 'Ocarina - Note B', 987.77], ['ocarina_c', 'Ocarina - Note C', 523.25],
  ['ocarina_d', 'Ocarina - Note D', 587.33], ['ocarina_e', 'Ocarina - Note E', 659.25], ['ocarina_f', 'Ocarina - Note F', 698.46],
  ['ocarina_gsharp', 'Ocarina - Note G+', 830.61], ['ocarina_a2', 'Ocarina - Note A2', 1760],
];
/** Note pitches by spell id (art.ts makes their sounds). */
export const NOTE_PITCH = new Map(NOTES.map(([id, , hz]) => [id, hz]));
for (const [id, name] of NOTES) {
  const s: SpellDef = def({
    id, name, type: 'other', tier: 1, mana: 1, desc: 'Music for your ears!', icon: I('#ffffff', 'digit', '?'), delay: sec(0.25),
    proj: { visual: 'note', speed: 0.15, gravity: -0.01, life: 16, ghost: true, color: id.startsWith('kantele') ? 0xffe080 : 0x80e0ff, size: 0.2 },
    play: (_c, shot) => { shot.projs.push(makeProj(s)); },
    tick(l, w) { if (l.age === 1) w.sound(`wands:note_${id}`, l.x, l.y, l.z, 0.9, 1); },
  });
}

// ---- endings
other('cessation', 'Cessation', 4, 0, 'Everything you have flying ends at once. A long wait follows.', I('#808080', 'divide', '0'), (_c, shot) => { shot.cease = true; }, { delay: 200, reload: 200, uses: 25 });
other('summon_portal', 'Summon Portal', 4, 50, 'A pair of portals: step into the one by you to come out where you aimed.', I('#a040ff', 'telecast'), (_c, shot) => { shot.projs.push(makeProj(PORTAL)); }, { delay: sec(1.33), uses: 7 });
const PORTAL = proj('portal_entry', 'Portal', 5, 0, 'A portal.', I('#a040ff', 'hole'), { visual: 'portal', speed: 0, ghost: true, pierce: true, life: 300, color: 0xa040ff, size: 0.7 }, {
  hidden: true, sprite: 'summon_portal',
  tick(l, w) {
    if (l.age === 1) {
      const a = w.aim();
      if (!a) { l.remove(); return; }
      l.p.data.ex = a.x; l.p.data.ey = a.y; l.p.data.ez = a.z;
      w.spawn('portal_exit', a.x, a.y + 0.5, a.z, 0, 0, 0);
    }
    if (l.age % 2) return;
    for (const e of w.near(l.x, l.y - 0.5, l.z, 0.8)) if (!(e as unknown as { portalAt?: number }).portalAt || w.time - (e as unknown as { portalAt: number }).portalAt > 30) {
      (e as unknown as { portalAt: number }).portalAt = w.time;
      w.teleport(e, l.p.data.ex, l.p.data.ey, l.p.data.ez);
    }
  },
});
proj('portal_exit', 'Portal Exit', 5, 0, 'Where a portal comes out.', I('#ff60ff', 'hole'), { visual: 'portal', speed: 0, ghost: true, pierce: true, life: 300, color: 0xff60ff, size: 0.7 }, { hidden: true });
other('end_of_everything', 'The End of Everything', 5, 600, 'Ends everything nearby, in a very large way. You may want to be elsewhere.', I('#ffffff', 'explosion'), (_c, shot) => { shot.projs.push(makeProj(END)); }, { delay: sec(1.67), reload: sec(1.67), uses: 1, noita: 'The End Of Everything' });
const END = proj('end_of_everything_core', 'The End', 5, 0, 'The end.', I('#ffffff', 'explosion'), { visual: 'whitehole', speed: 0.12, ghost: true, pierce: true, life: 60, color: 0xffffff, size: 0.6, explR: 11, explDmg: 200, terrain: 200, fire: true }, {
  hidden: true, sprite: 'end_of_everything',
  tick(l, w) { if (l.age % 15 === 0) w.fx('tp', l.x, l.y, l.z); },
  hit(l, _h, w) { for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; w.blast(l.x + Math.cos(a) * 7, l.y, l.z + Math.sin(a) * 7, 7, 80, 60, true, 0xffffff); } },
});

// ---- utility: where and how the cast appears
utility('long_distance_cast', 'Long-Distance Cast', 1, 0, 'The spells of this cast appear further away.', I('#c0c0ff', 'far'), (c, shot) => { shot.forward += 3; c.draw(shot, 1); }, { delay: -2 });
utility('warp_cast', 'Warp Cast', 2, 20, 'The spells of this cast jump a long way ahead, stopping at walls.', I('#a0a0ff', 'far'), (c, shot) => { shot.forward += 12; shot.spread -= 6; c.draw(shot, 1); }, { delay: 3 });
utility('teleport_cast', 'Teleporting Cast', 3, 100, 'The spells of this cast appear at the nearest enemy (or where you look).', I('#a080ff', 'telecast'), (c, shot) => { shot.fromFoe = true; shot.spread += 24; c.draw(shot, 1); }, { delay: 7 });
utility('inner_spell', 'Inner Spell', 2, 10, 'The spells of this cast come at you from in front, flying back toward you.', I('#ff80ff', 'far'), (c, shot) => { shot.inner = true; shot.spread -= 24; c.draw(shot, 1); });
utility('blood_magic', 'Blood Magic', 3, -100, 'Gives the wand mana and speeds it up, paid for with your blood.', I('#c01818', 'mana'), (c, shot) => { shot.bloodCost += 3; c.draw(shot, 1); }, { delay: sec(-0.33), reload: sec(-0.33) });
utility('blood_to_power', 'Blood to Power', 3, 20, 'Pay with your blood for more damage.', I('#c01818', 'plus'), (c, shot) => { shot.bloodCost += 2; shot.mods.push((p) => { p.dmg += 8; }); c.draw(shot, 1); }, { noita: 'Blood To Power' });
utility('gold_to_power', 'Gold to Power', 3, 30, 'The more gold you carry, the more damage.', I('#ffd040', 'plus'), (c, shot) => { const g = c.gold; shot.mods.push((p) => { p.dmg += Math.min(20, g / 4); }); c.draw(shot, 1); }, { noita: 'Gold To Power' });
utility('all_seeing_eye', 'All-Seeing Eye', 3, 100, 'Lets you see in the dark for a long while.', I('#ffffff', 'homing'), (c, shot) => { shot.projs.push(makeProj(EYE)); c.draw(shot, 1); }, { uses: 10 });
const EYE = proj('all_seeing_eye_core', 'Eye', 5, 0, 'An eye.', I('#ffffff', 'homing'), { visual: 'none', speed: 0, ghost: true, life: 2 }, {
  hidden: true,
  tick(l, w) { if (l.age === 1 && l.caster) { w.effect(l.caster, 'night_vision', 1200, 0); l.remove(); } },
});
const convert = (id: string, name: string, tier: number, mana: number, cd: number, spell: string, uses?: number) =>
  utility(id, name, tier, mana, `Turns every projectile you have out into ${name.replace('Spells To ', '').toLowerCase()}.`, I('#ff80ff', 'random'), (c, shot) => { shot.convert = spell; c.draw(shot, 1); }, { delay: sec(cd), reload: sec(cd), uses });
convert('spells_to_acid', 'Spells To Acid', 3, 200, 1.67, 'acid_ball');
convert('spells_to_black_holes', 'Spells To Black Holes', 4, 200, 1.67, 'black_hole', 10);
convert('spells_to_death_crosses', 'Spells To Death Crosses', 3, 80, 0.67, 'death_cross', 15);
convert('spells_to_magic_missiles', 'Spells To Magic Missiles', 3, 100, 0.83, 'magic_missile', 10);
convert('spells_to_nukes', 'Spells To Nukes', 5, 600, 1.67, 'nuke', 2);
convert('spells_to_giga_sawblades', 'Spells To Giga Sawblades', 4, 100, 0.83, 'giga_disc');
const multiply = (id: string, name: string, mana: number, uses: number, n: number, form: [number, number][]) =>
  utility(id, name, 3, mana, `Casts the next spell ${n} times, in a ${name[0]}-shape.`, I('#ffe080', 'scatter', String(n)), (c, shot) => {
    const next = c.take();
    if (!next) return;
    const from = shot.projs.length;
    for (let k = 0; k < n; k++) c.play(next, shot);
    shot.projs.slice(from).forEach((p, i) => { const f = form[i % form.length]; p.yawOff += f[0]; p.pitchOff += f[1]; });
  }, { uses });
multiply('iplicate', 'Iplicate Spell', 40, 30, 2, [[0, 0], [0, 0]]);
multiply('yplicate', 'Yplicate Spell', 40, 30, 2, [[-12, 0], [12, 0]]);
multiply('tiplicate', 'Tiplicate Spell', 60, 25, 3, [[0, 0], [-90, 0], [90, 0]]);
multiply('wuplicate', 'Wuplicate Spell', 70, 20, 4, [[-30, 0], [-10, 0], [10, 0], [30, 0]]);
multiply('quplicate', 'Quplicate Spell', 90, 20, 5, [[0, 0], [72, 0], [144, 0], [216, 0], [288, 0]]);
multiply('peplicate', 'Peplicate Spell', 110, 20, 6, [[0, 0], [0, 25], [0, -25], [-25, 0], [25, 0], [180, 0]]);
multiply('heplicate', 'Heplicate Spell', 130, 20, 7, [[0, 0], [-15, 0], [15, 0], [-30, 0], [30, 0], [0, 20], [0, -20]]);
utility('summon_platform', 'Summon Platform', 1, 30, 'A short-lived bit of ground where the spell lands.', I('#a0a0a0', 'line'), (c, shot) => { shot.projs.push(makeProj(PLATFORM)); c.draw(shot, 1); }, { delay: sec(0.67), uses: 20 });
const PLATFORM = proj('platform_core', 'Platform', 5, 0, 'A platform.', I('#a0a0a0', 'line'), { visual: 'spark', speed: 1.2, life: 8, color: 0xc0c0ff, size: 0.12 }, {
  hidden: true,
  hit(l, h, w) {
    const x = Math.floor(h.x + h.nx * 0.5), y = Math.floor(h.y + h.ny * 0.5) - (h.reason === 'expire' ? 1 : 0), z = Math.floor(h.z + h.nz * 0.5);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (!w.solid(x + dx, y, z + dz)) w.temp(x + dx, y, z + dz, 'wands:magic_wall', 300);
    void l;
  },
});
utility('summon_wall', 'Summon Wall', 1, 40, 'A short-lived wall where the spell lands.', I('#a0a0a0', 'line'), (c, shot) => { shot.projs.push(makeProj(WALL)); c.draw(shot, 1); }, { delay: sec(0.67), uses: 20 });
const WALL = proj('wall_core', 'Wall', 5, 0, 'A wall.', I('#a0a0a0', 'line'), { visual: 'spark', speed: 1.2, life: 8, color: 0xc0c0ff, size: 0.12 }, {
  hidden: true,
  hit(l, h, w) {
    const x = Math.floor(h.x + h.nx * 0.5), y = Math.floor(h.y + h.ny * 0.5), z = Math.floor(h.z + h.nz * 0.5);
    const sp = Math.hypot(l.vx, l.vz) || 1, sx = Math.round(-l.vz / sp), sz = Math.round(l.vx / sp);
    for (let k = -2; k <= 2; k++) for (let dy = 0; dy < 3; dy++) {
      const bx = x + (sx || (sz ? 0 : 1)) * k, bz = z + sz * k;
      if (!w.solid(bx, y + dy, bz)) w.temp(bx, y + dy, bz, 'wands:magic_wall', 300);
    }
  },
});
utility('summon_taikasauva', 'Summon Taikasauva', 5, 300, 'A floating wand that circles you and fires at your enemies for a while.', I('#c080ff', 'far'), (c, shot) => { shot.projs.push(makeProj(TAIKA)); c.draw(shot, 1); }, { uses: 1 });
const TAIKA = proj('taikasauva', 'Taikasauva', 5, 0, 'A floating wand.', I('#c080ff', 'far'), {
  visual: 'icon', speed: 0, ghost: true, pierce: true, life: 600, color: 0xc080ff, size: 0.35,
  orbit: { around: 'caster', r: 1.4, w: 0.08, phase: 0 }, spawns: [{ on: 'tick', every: 8, spell: 'spark_bolt', n: 1, dir: 'foe' }],
}, { hidden: true, sprite: 'summon_taikasauva' });
utility('wand_refresh', 'Wand Refresh', 3, 20, 'The wand recharges straight away.', I('#80ffff', 'refresh'), (c) => { c.refresh = true; }, { reload: sec(-0.42) });

// ---- passives: drawn like a modifier (one more card), and while the wand is held they act on their own
const passive = (id: string, name: string, tier: number, mana: number, desc: string, c: string, kind: string) =>
  def({ id, name, type: 'passive', tier, mana, desc, icon: I(c, 'circle'), passive: kind, play: (cc, shot) => cc.draw(shot, 1) });
passive('torch', 'Torch', 0, 0, 'Holding the wand lets you see in the dark.', '#ffa040', 'torch');
passive('electric_torch', 'Electric Torch', 2, 0, 'Lets you see in the dark, and shocks whatever comes too close (you, a little, too).', '#a0e0ff', 'electricTorch');
passive('energy_shield', 'Energy Shield', 3, 10, 'Holding the wand protects you: less damage, and arrows are knocked away.', '#80ffff', 'shield');
passive('energy_shield_sector', 'Energy Shield Sector', 2, 10, 'Holding the wand protects you a little.', '#80c0ff', 'shieldSector');
passive('tiny_ghost', 'Summon Tiny Ghost', 2, 0, 'A tiny ghost follows the wand and shoots at your enemies.', '#e0e0ff', 'ghost');
