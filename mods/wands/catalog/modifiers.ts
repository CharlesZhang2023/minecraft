// Projectile modifiers: each changes every projectile of the cast it's in, and draws one more card. Most are a few
// numbers; others add steering, things cast on a bounce or at the end, trails, conditions put on what's hit...
import { modifier, proj, sec, hexCol, type Icon, type Proj, type SpawnRule, type SpellDef, type Status, type Steer } from '../spelldefs.ts';

const I = (c: string, g = 'plus', n?: string): Icon => ({ g, c, n });
type M = (p: Proj) => void;
/** A plain modifier from Noita's numbers: mana, cast delay (s), recharge (s). */
const mod = (id: string, name: string, tier: number, mana: number, cd: number, desc: string, icon: Icon, fn: M, extra: Partial<SpellDef> = {}) =>
  modifier(id, name, tier, mana, desc, icon, fn, { delay: cd ? sec(cd) : undefined, ...extra });
const steer = (s: Steer): M => (p) => { if (!p.steer.includes(s)) p.steer.push(s); };
const spawn = (r: SpawnRule): M => (p) => { p.spawns.push({ ...r }); };
const all = (...fs: M[]): M => (p) => { for (const f of fs) f(p); };

// ---- damage
mod('damage_plus', 'Damage Plus', 0, 5, 0.08, 'Increases the damage done by a projectile.', I('#ff5050'), (p) => { p.dmg += 3; p.crit += 0.05; });
mod('heavy_shot', 'Heavy Shot', 1, 7, 0.17, 'Greatly increases damage, at the cost of speed.', I('#a0a0b0', 'heavy'), (p) => { p.dmg += 6; p.speed *= 0.35; });
mod('light_shot', 'Light Shot', 1, 5, -0.05, 'A much faster, more accurate, but weaker projectile.', I('#e0f0ff', 'feather'), (p) => { p.speed *= 2; p.spread -= 6; p.dmg = Math.max(0, p.dmg - 1); p.explR = Math.max(0, p.explR - 0.5); });
mod('critical_plus', 'Critical Plus', 1, 5, 0, 'Increases the chance of a critical hit by 15%.', I('#ffe040', 'crit'), (p) => { p.crit += 0.15; });
mod('bloodlust', 'Bloodlust', 2, 2, 0.13, 'A hefty damage boost, but the projectile can hurt you too.', I('#c01818', 'plus'), (p) => { p.dmg += 7; p.spread += 6; p.selfHit = true; });
mod('random_damage', 'Random Damage', 2, 15, 0.08, 'The projectile\'s damage is anyone\'s guess.', I('#ff80ff', 'random'), (p) => { p.dmg *= 0.5 + Math.random() * 2.5; });
mod('mana_to_damage', 'Mana to Damage', 3, 0, 0.25, 'Turns all the wand\'s remaining mana into damage.', I('#4080ff', 'mana'), () => {}, {
  reload: sec(0.17), uses: 20,
  cast(c, shot) { const m = c.mana; c.mana = 0; shot.mods.push((p) => { p.dmg += m / 15; }); },
});
mod('damage_field', 'Damage Field', 2, 30, 0, 'The projectile hurts whatever comes close to it.', I('#ff8080', 'circle'), (p) => { p.aura = Math.max(p.aura, 1.4); });
mod('null_shot', 'Null Shot', 1, 5, -0.08, 'The projectile lasts far longer but does no damage at all.', I('#808080', 'line'), (p) => { p.dmg = 0; p.explR = 0; p.explDmg = 0; p.elec = 0; p.crit = 0; p.life += 112; });
mod('critical_on_burning', 'Critical on Burning', 1, 10, 0, 'Always a critical hit on burning creatures.', I('#ff6020', 'crit'), (p) => { p.critOn.push('burning'); }, { noita: 'Critical On Burning' });
mod('critical_on_wet', 'Critical on Wet Enemies', 1, 10, 0, 'Always a critical hit on wet creatures.', I('#3070ff', 'crit'), (p) => { p.critOn.push('wet'); }, { noita: 'Critical On Wet (Water) Enemies' });
mod('critical_on_oiled', 'Critical on Oiled Enemies', 1, 10, 0, 'Always a critical hit on oily creatures.', I('#403830', 'crit'), (p) => { p.critOn.push('oiled'); }, { noita: 'Critical On Oiled Enemies' });
mod('critical_on_bloody', 'Critical on Bloody Enemies', 1, 10, 0, 'Always a critical hit on blood-soaked creatures.', I('#c01818', 'crit'), (p) => { p.critOn.push('bloody'); }, { noita: 'Critical On Bloody Enemies' });
const explodeOn = (status: Status, r: number, dmg: number): M => (p) => { p.explodeOn.push({ status, r, dmg }); };
mod('explosion_on_drunk', 'Explosion on Drunk Enemies', 2, 20, 0, 'Explodes on hitting creatures covered in alcohol.', I('#e0d080', 'boom'), explodeOn('drunk', 2, 12), { noita: 'Explosion On Drunk Enemies' });
mod('giant_explosion_on_drunk', 'Giant Explosion on Drunk Enemies', 3, 200, 0, 'Explodes powerfully on creatures covered in alcohol.', I('#e0d080', 'boom'), explodeOn('drunk', 4, 40), { uses: 20, noita: 'Giant Explosion On Drunk Enemies' });
mod('explosion_on_slimy', 'Explosion on Slimy Enemies', 2, 20, 0, 'Explodes on hitting creatures covered in slime.', I('#60c040', 'boom'), explodeOn('slimy', 2, 12), { noita: 'Explosion On Slimy Enemies' });
mod('giant_explosion_on_slimy', 'Giant Explosion on Slimy Enemies', 3, 200, 0, 'Explodes powerfully on creatures covered in slime.', I('#60c040', 'boom'), explodeOn('slimy', 4, 40), { uses: 20, noita: 'Giant Explosion On Slimy Enemies' });
mod('charm_on_toxic', 'Charm on Toxic Sludge', 3, 70, 0, 'Creatures covered in toxic sludge that it hits turn on their own kind.', I('#90ff40', 'heal'), (p) => { p.data.charm = 1; }, { noita: 'Charm On Toxic Sludge' });

// ---- explosions
mod('explosive_projectile', 'Explosive Projectile', 2, 30, 0.67, 'The projectile explodes when it ends, more destructive to the ground.', I('#ffa040', 'boom'), (p) => { p.explR = Math.max(p.explR, 1.4) + 0.4; p.explDmg += 5; p.terrain = Math.max(p.terrain, 2.5); p.speed *= 0.75; });
mod('concentrated_explosion', 'Concentrated Explosion', 2, 40, 0.25, 'A smaller explosion, with much more damage.', I('#ff6020', 'boom'), (p) => { if (p.explR > 0) { p.explDmg *= 1.8; p.explR = Math.max(0.8, p.explR * 0.6); } });
mod('remove_explosion', 'Remove Explosion', 1, 0, -0.25, 'The projectile no longer explodes.', I('#808080', 'boom'), (p) => { p.explR = 0; p.explDmg = 0; });
mod('earthquake_shot', 'Earthquake Shot', 3, 45, 0, 'Shakes the ground where the projectile ends.', I('#a08060', 'down'), spawn({ on: 'end', spell: 'earthquake_field', dir: 'same', speed: 0, max: 1 }), { uses: 15 });
mod('liquid_detonation', 'Liquid Detonation', 3, 40, 0.33, 'Liquids near where the projectile ends explode.', I('#3070ff', 'boom'), (p) => { p.transmute.push('detonate'); });

// ---- speed, lifetime, spread
mod('speed_up', 'Speed Up', 0, 3, 0, 'Makes a projectile fly much faster.', I('#80ffff', 'speed'), (p) => { p.speed *= 2.5; });
mod('accelerating_shot', 'Accelerating Shot', 2, 20, 0.13, 'The projectile starts slow and keeps speeding up.', I('#80ffc0', 'accel'), (p) => { p.path = 'accel'; p.speed *= 0.6; p.dmg += 1; });
mod('decelerating_shot', 'Decelerating Shot', 1, 10, -0.13, 'The projectile starts fast and slows down.', I('#c0ff80', 'accel'), all((p) => { p.speed *= 1.68; p.drag *= 0.94; }, steer('decel')));
mod('increase_lifetime', 'Increase Lifetime', 2, 40, 0.22, 'The projectile lasts much longer.', I('#c0a0ff', 'lifeup'), (p) => { p.life = Math.round(p.life * 1.75) + 5; });
mod('reduce_lifetime', 'Reduce Lifetime', 1, 10, -0.25, 'The projectile fades out sooner.', I('#a080c0', 'lifedown'), (p) => { p.life = Math.max(1, Math.round(p.life * 0.5)); });
mod('nolla', 'Nolla', 2, 1, -0.25, 'The projectile ends the moment it\'s cast.', I('#ffffff', 'lifedown'), (p) => { p.life = 1; });
mod('reduce_spread', 'Reduce Spread', 0, 1, 0, 'Makes the spell more accurate.', I('#ffffff', 'spread'), (p) => { p.spread -= 60; });
mod('heavy_spread', 'Heavy Spread', 1, 2, -0.12, 'Wildly inaccurate, but the wand casts and recharges faster.', I('#ff8080', 'spread'), (p) => { p.spread += 60; }, { reload: sec(-0.25) });
mod('reduce_recharge', 'Reduce Recharge Time', 1, 12, -0.17, 'Shortens the wand\'s recharge time.', I('#c0ff80', 'recharge'), () => {}, { reload: sec(-0.33), noita: 'Reduce Recharge Time' });
mod('slow_but_steady', 'Slow But Steady', 2, 0, 0, 'The wand\'s recharge time is always one and a half seconds.', I('#a0a0ff', 'recharge'), () => {}, { cast(_c, shot) { shot.rechargeSet = 30; } });
mod('add_mana', 'Add Mana', 1, -30, 0.17, 'Gives the wand back some mana.', I('#4080ff', 'mana'), () => {});
mod('recoil', 'Recoil', 1, 5, 0, 'Each cast throws you back.', I('#ffa080', 'push'), () => {}, { cast(_c, shot) { shot.recoil += 1.4; } });
mod('recoil_damper', 'Recoil Damper', 1, 5, 0, 'Takes away the cast\'s recoil.', I('#a0a0a0', 'push'), () => {}, { cast(_c, shot) { shot.recoil = -99; } });
mod('fizzle', 'Fizzle', 0, 0, -0.17, 'A small chance for each projectile to fizzle out. Faster casting, though.', I('#a0a0a0', 'random'), (p) => { p.fizzle = Math.min(1, p.fizzle + 0.1); p.speed *= 1.2; });

// ---- paths
mod('linear_arc', 'Linear Arc', 0, 0, -0.07, 'The projectile flies in a straight line, unaffected by gravity.', I('#ffffff', 'line'), (p) => { p.gravity = 0; p.path = 'straight'; });
mod('horizontal_path', 'Horizontal Path', 1, 0, -0.1, 'The projectile flies level, whatever angle it\'s cast at.', I('#ffffff', 'line'), all((p) => { p.gravity = 0; }, steer('horizontal')));
mod('sinewave', 'Slithering Path', 1, 0, 0, 'The projectile slithers from side to side, like a snake.', I('#80ff80', 'wave'), (p) => { p.path = 'sine'; p.speed *= 2; });
mod('chaotic_arc', 'Chaotic Path', 1, 0, 0, 'The projectile flies wherever it wishes.', I('#ff80ff', 'chaos'), (p) => { p.path = 'chaos'; p.speed *= 2; });
mod('spiral_arc', 'Spiral Arc', 1, 0, -0.1, 'The projectile corkscrews through the air.', I('#80c0ff', 'spiral'), (p) => { p.path = 'spiral'; p.life = Math.round(p.life * 1.5); });
mod('ping_pong_path', 'Ping-Pong Path', 1, 0, 0, 'The projectile flies back and forth.', I('#80ffff', 'bounce'), all((p) => { p.life = Math.round(p.life * 1.25) + 4; }, steer('pingpong')), { noita: 'Ping-Pong Path' });
mod('orbiting_arc', 'Orbiting Arc', 2, 0, -0.1, 'The projectile circles the point it was cast from.', I('#c0c0ff', 'spiral'), all((p) => { p.life = Math.round(p.life * 1.25) + 4; }, steer('orbit')));
mod('true_orbit', 'True Orbit', 3, 2, -0.33, 'The projectile circles you like a planet.', I('#ffffc0', 'spiral'), all((p) => { p.life = Math.round(p.life * 1.8) + 10; }, steer('trueOrbit')));
mod('phasing_arc', 'Phasing Arc', 2, 2, -0.1, 'The projectile flies slowly, but blinks ahead every so often.', I('#c080ff', 'tp'), all((p) => { p.speed *= 0.33; p.life = Math.round(p.life * 1.8) + 10; }, steer('phasing')));
mod('fly_downwards', 'Fly Downwards', 1, 0, -0.13, 'The projectile turns straight down a moment after it\'s cast.', I('#c08060', 'down'), all((p) => { p.speed *= 1.2; }, steer('flyDown')));
mod('fly_upwards', 'Fly Upwards', 1, 0, -0.13, 'The projectile turns straight up a moment after it\'s cast.', I('#80c0ff', 'up'), all((p) => { p.speed *= 1.2; }, steer('flyUp')));
mod('gravity', 'Gravity', 0, 1, 0, 'The projectile falls like a stone.', I('#c08060', 'down'), (p) => { p.gravity += 0.05; });
mod('anti_gravity', 'Anti-gravity', 0, 1, 0, 'The projectile falls upwards.', I('#80c0ff', 'up'), (p) => { p.gravity -= 0.05; }, { noita: 'Anti-Gravity' });
mod('floating_arc', 'Floating Arc', 1, 0, 0.17, 'The projectile floats just above the ground.', I('#a0ffa0', 'line'), all((p) => { p.gravity = 0; }, steer('floating')));
mod('avoiding_arc', 'Avoiding Arc', 1, 0, 0.17, 'The projectile steers around walls.', I('#a0a0ff', 'line'), steer('avoid'));
mod('boomerang', 'Boomerang', 1, 10, 0, 'The projectile comes back to you.', I('#ffc080', 'bounce'), all((p) => { p.life = Math.round(p.life * 1.5) + 6; }, steer('boomerang')));
mod('projectile_area_teleport', 'Projectile Area Teleport', 3, 60, 0.13, 'When a creature comes near, the projectile appears right on top of it.', I('#c080ff', 'tp'), all((p) => { p.speed *= 0.75; }, steer('areaTeleport')));

// ---- homing
mod('homing', 'Homing', 2, 70, 0, 'The projectile seeks out monsters.', I('#ff8080', 'homing'), (p) => { p.homing = Math.max(p.homing, 0.25); });
mod('short_range_homing', 'Short-range Homing', 1, 40, 0, 'The projectile turns sharply toward monsters close by.', I('#ffa0a0', 'homing'), all((p) => { p.homing = Math.max(p.homing, 0.5); }, steer('shortHoming')));
mod('accelerative_homing', 'Accelerative Homing', 3, 60, 0, 'The projectile seeks out monsters, faster and faster.', I('#ff6060', 'homing'), all((p) => { p.homing = Math.max(p.homing, 0.3); }, steer('accelHoming')));
mod('rotate_towards_foes', 'Rotate Towards Foes', 2, 40, 0, 'The projectile turns once toward the nearest monster.', I('#ffc0c0', 'homing'), steer('rotateFoes'));
mod('auto_aim', 'Auto-Aim', 2, 25, 0, 'The projectile is cast straight at the nearest monster.', I('#ff4040', 'homing'), steer('autoAim'), { noita: 'Auto-Aim' });
mod('aiming_arc', 'Aiming Arc', 2, 30, 0, 'The projectile bends toward where you\'re aiming.', I('#ffffff', 'homing'), steer('aim'));
mod('wand_homing', 'Wand Homing', 3, 200, 0, 'The projectile keeps flying toward where you\'re aiming.', I('#ffff80', 'homing'), steer('wandHoming'));
mod('anti_homing', 'Anti Homing', 0, 1, -0.33, 'The projectile shies away from monsters.', I('#80ff80', 'homing'), steer('antiHoming'));

// ---- bounces
mod('bounce', 'Bounce', 0, 0, 0, 'The projectile bounces off walls.', I('#fff060', 'bounce'), (p) => { p.bounces += 10; });
mod('remove_bounce', 'Remove Bounce', 0, 0, 0, 'The projectile no longer bounces.', I('#808080', 'bounce'), (p) => { p.bounces = 0; });
const onBounce = (id: string, name: string, tier: number, mana: number, cd: number, desc: string, color: string, spell: string, n: number, dir: SpawnRule['dir'], extra: Partial<SpellDef> = {}) =>
  mod(id, name, tier, mana, cd, desc, I(color, 'bounce'), all((p) => { p.bounces = Math.max(p.bounces, 3); }, spawn({ on: 'bounce', spell, n, dir })), extra);
onBounce('bubbly_bounce', 'Bubbly Bounce', 1, 20, 0.13, 'The projectile shoots bubble sparks as it bounces.', '#80d8ff', 'bubble_spark', 2, 'reflect');
onBounce('explosive_bounce', 'Explosive Bounce', 2, 20, 0.42, 'The projectile explodes as it bounces.', '#ffa040', 'explosion_small', 1, 'same');
onBounce('lightning_bounce', 'Lightning Bounce', 3, 40, 0.42, 'The projectile releases lightning as it bounces.', '#d0e8ff', 'lightning_bolt', 1, 'reflect');
onBounce('plasma_beam_bounce', 'Plasma Beam Bounce', 3, 40, 0.2, 'The projectile fires a plasma beam as it bounces.', '#ff40ff', 'plasma_beam', 1, 'reflect');
onBounce('concentrated_light_bounce', 'Concentrated Light Bounce', 2, 30, 0.2, 'The projectile fires a beam of light as it bounces.', '#ffff80', 'concentrated_light', 1, 'reflect');
onBounce('sparkly_bounce', 'Sparkly Bounce', 1, 10, 0.15, 'The projectile throws out sparks as it bounces.', '#ffd0ff', 'glitter_spark', 3, 'reflect');
onBounce('vacuum_bounce', 'Vacuum Bounce', 3, 60, 0.67, 'The projectile makes a vacuum field where it bounces.', '#c0c0ff', 'vacuum_field', 1, 'same', { uses: 20 });
onBounce('larpa_bounce', 'Larpa Bounce', 3, 80, 0.53, 'The projectile splits into copies as it bounces.', '#ff80ff', 'self', 2, 'reflect');

// ---- casting more as it flies
const thrower = (id: string, name: string, tier: number, mana: number, uses: number, desc: string, color: string, spell: string, every: number, n: number, dir: SpawnRule['dir']) =>
  mod(id, name, tier, mana, 0, desc, I(color, 'fireball'), spawn({ on: 'tick', spell, every, n, dir }), { uses });
thrower('fireball_thrower', 'Fireball Thrower', 3, 110, 16, 'The projectile casts fireballs in random directions.', '#ff7a1a', 'fireball_small', 8, 1, 'random');
thrower('lightning_thrower', 'Lightning Thrower', 4, 110, 16, 'The projectile casts lightning in random directions.', '#d0e8ff', 'lightning_bolt', 12, 1, 'random');
thrower('two_way_fireball_thrower', 'Two-Way Fireball Thrower', 3, 130, 20, 'The projectile fires small fireballs out to both sides.', '#ff9030', 'fireball_small', 6, 2, 'perp');
thrower('plasma_beam_thrower', 'Plasma Beam Thrower', 4, 110, 16, 'The projectile fires beams of light in random directions.', '#ff40ff', 'plasma_beam', 8, 1, 'random');
thrower('tentacler', 'Tentacler', 3, 110, 16, 'The projectile lashes out at monsters with tentacles.', '#50e090', 'tentacle', 8, 1, 'foe');
mod('downwards_bolt_bundle', 'Downwards Bolt Bundle', 3, 90, 0.42, 'The projectile splits into five explosive bolts as soon as it starts to fall.', I('#ffa040', 'down'), spawn({ on: 'down', spell: 'cluster_bolt', n: 5, dir: 'down', max: 1 }));
mod('octagonal_bolt_bundle', 'Octagonal Bolt Bundle', 3, 100, 0.33, 'The projectile launches eight bolts when it slows down.', I('#ffc040', 'form'), spawn({ on: 'slow', spell: 'magic_bolt', n: 8, dir: 'ring', max: 1 }));
mod('clusterbolt', 'Clusterbolt', 2, 30, 0.33, 'The projectile releases a cluster of explosive bolts when it hits a wall.', I('#ffa040', 'explosion'), spawn({ on: 'block', spell: 'cluster_bolt', n: 6, dir: 'hemi', max: 1 }));
mod('firecrackers', 'Firecrackers', 2, 15, 0, 'The projectile lets off firecrackers when it ends.', I('#ff4040', 'explosion'), spawn({ on: 'end', spell: 'firecracker', n: 5, dir: 'random', max: 1 }));
mod('chaos_magic', 'Chaos Magic', 3, 120, 0.67, 'The projectile casts a random spell from a handful when it hits something.', I('#ff80ff', 'random'), (p) => { p.spawns.push({ on: 'end', spell: CHAOS[Math.floor(Math.random() * CHAOS.length)], n: 1, dir: 'reflect', max: 1 }); }, { uses: 30 });
const CHAOS = ['fireball', 'lightning_bolt', 'death_cross', 'black_hole', 'bomb', 'acid_ball', 'iceball', 'thunder_charge', 'glitter_bomb', 'magic_missile'];
mod('quantum_split', 'Quantum Split', 2, 10, 0.08, 'The projectile is in two places at once.', I('#c0c0ff', 'scatter', '2'), spawn({ on: 'tick', every: 1, max: 1, spell: 'self', n: 1, dir: 'cone', cone: 6 }));
mod('plasma_beam_enhancer', 'Plasma Beam Enhancer', 3, 10, 0, 'The projectile leaves a plasma beam behind it.', I('#ff40ff', 'lance'), spawn({ on: 'tick', spell: 'plasma_beam', every: 4, n: 1, dir: 'back' }));
mod('necromancy', 'Necromancy', 3, 20, 0.17, 'Creatures it kills rise as spirits that hunt your enemies.', I('#a0ffa0', 'heal'), spawn({ on: 'kill', spell: 'friendly_fly', n: 1, dir: 'up' }));

// ---- larpas: copies of the projectile
const larpa = (id: string, name: string, tier: number, mana: number, cd: number, desc: string, r: SpawnRule, extra: Partial<SpellDef> = {}) =>
  mod(id, name, tier, mana, cd, desc, I('#ff80ff', 'scatter', '2'), spawn(r), extra);
larpa('chaos_larpa', 'Chaos Larpa', 4, 100, 0.25, 'The projectile throws off copies of itself in every direction.', { on: 'tick', every: 6, spell: 'self', n: 1, dir: 'random' });
larpa('downwards_larpa', 'Downwards Larpa', 4, 120, 0.25, 'The projectile drops copies of itself as it flies.', { on: 'tick', every: 6, spell: 'self', n: 1, dir: 'down' });
larpa('upwards_larpa', 'Upwards Larpa', 4, 120, 0.25, 'The projectile sends copies of itself upward as it flies.', { on: 'tick', every: 6, spell: 'self', n: 1, dir: 'up' });
larpa('larpa_explosion', 'Larpa Explosion', 4, 90, 0.25, 'The projectile bursts into copies of itself when it ends.', { on: 'end', spell: 'self', n: 6, dir: 'random', max: 1 }, { uses: 30 });
larpa('copy_trail', 'Copy Trail', 4, 150, 0.33, 'The projectile leaves a trail of slow copies of itself.', { on: 'tick', every: 5, spell: 'self', n: 1, dir: 'same', speed: 0.2 });
mod('chain_spell', 'Chain Spell', 4, 70, 0, 'The projectile casts a copy of itself when it ends, up to five times.', I('#ffa0ff', 'tag', 'expire'), (p) => { p.data.chain = 5; p.life = Math.max(1, Math.round(p.life * 0.7)); p.spread += 10; });

// ---- orbits: things circling the projectile
const orbit = (id: string, name: string, tier: number, mana: number, desc: string, color: string, spell: string, extra: Partial<SpellDef> = {}) =>
  mod(id, name, tier, mana, 0, desc, I(color, 'spiral'), (p) => { p.data.orbit = ORBITS.indexOf(spell); }, extra);
export const ORBITS = ['orbit_fireball', 'orbit_nuke', 'orbit_saw', 'orbit_plasma', 'self'];
orbit('fireball_orbit', 'Fireball Orbit', 2, 40, 'Four fireballs circle the projectile.', '#ff7a1a', 'orbit_fireball');
orbit('nuke_orbit', 'Nuke Orbit', 5, 250, 'Four... nukes(?!) circle the projectile.', '#c0ff40', 'orbit_nuke', { uses: 3 });
orbit('sawblade_orbit', 'Sawblade Orbit', 3, 70, 'Four sawblades circle the projectile.', '#d0d0d0', 'orbit_saw');
orbit('plasma_beam_orbit', 'Plasma Beam Orbit', 4, 100, 'Four plasma beams circle the projectile.', '#ff40ff', 'orbit_plasma');
orbit('orbit_larpa', 'Orbit Larpa', 4, 90, 'Copies of the projectile circle it.', '#ff80ff', 'self');

// ---- trails
const trail = (id: string, name: string, tier: number, mana: number, desc: string, color: string, kind: string, extra: M = () => {}) =>
  mod(id, name, tier, mana, 0, desc, I(color, 'flametrail'), all((p) => { if (!p.trails.includes(kind)) p.trails.push(kind); }, extra));
trail('fire_trail', 'Fire Trail', 1, 10, 'The projectile leaves a trail of fire and sets what it hits alight.', '#ff7020', 'fire', (p) => { p.fireTrail = true; p.fire = true; });
trail('burning_trail', 'Burning Trail', 1, 5, 'The projectile burns as it flies, lighting what it hits.', '#ffa040', 'burning', (p) => { p.fire = true; });
trail('acid_trail', 'Acid Trail', 2, 15, 'The projectile leaves a trail of acid.', '#a0ff40', 'wands:acid');
trail('poison_trail', 'Poison Trail', 1, 10, 'The projectile leaves a trail of toxic sludge.', '#90ff40', 'wands:toxic');
trail('oil_trail', 'Oil Trail', 1, 10, 'The projectile leaves a trail of oil.', '#403830', 'wands:oil');
trail('water_trail', 'Water Trail', 1, 10, 'The projectile leaves a trail of water.', '#3070ff', 'water');
trail('gunpowder_trail', 'Gunpowder Trail', 2, 10, 'The projectile leaves a trail of gunpowder.', '#404040', 'wands:gunpowder');
trail('rainbow_trail', 'Rainbow Trail', 0, 0, 'The projectile leaves a trail of every colour.', '#ff80ff', 'rainbow', (p) => { p.rainbow = true; });

// ---- arcs: lines between this cast's projectiles
const arc = (id: string, name: string, tier: number, desc: string, color: string, kind: Proj['arcs'][number]) =>
  mod(id, name, tier, 15, 0, desc, I(color, 'zap'), (p) => { if (!p.arcs.includes(kind)) p.arcs.push(kind); });
arc('electric_arc', 'Electric Arc', 2, 'Arcs of lightning between the cast\'s projectiles (needs two).', '#ffff80', 'electric');
arc('fire_arc', 'Fire Arc', 2, 'Arcs of fire between the cast\'s projectiles (needs two).', '#ff7020', 'fire');
arc('poison_arc', 'Poison Arc', 2, 'Arcs of poison between the cast\'s projectiles (needs two).', '#90ff40', 'poison');
arc('gunpowder_arc', 'Gunpowder Arc', 2, 'Arcs of gunpowder between the cast\'s projectiles (needs two).', '#606060', 'gunpowder');

// ---- what it does to what it hits
mod('freeze_charge', 'Freeze Charge', 1, 10, 0, 'The projectile freezes what it hits.', I('#a0e0ff', 'snowflake'), (p) => { p.freeze = true; });
mod('electric_charge', 'Electric Charge', 1, 8, 0, 'The projectile shocks everything near where it hits.', I('#ffff60', 'zap'), (p) => { p.elec += 3; });
mod('knockback', 'Knockback', 0, 5, 0, 'The projectile knocks back what it hits.', I('#ffd080', 'push'), (p) => { p.knock += 0.8; });
mod('piercing_shot', 'Piercing Shot', 3, 140, 0, 'The projectile goes through creatures, but it can hurt you too.', I('#c0c0ff', 'pierce'), (p) => { p.pierce = true; p.selfHit = true; });
mod('drilling_shot', 'Drilling Shot', 3, 160, 0.83, 'The projectile drills through the ground.', I('#9ff8ff', 'drill'), (p) => { p.digHard = Math.max(p.digHard, 3); p.digCount += 16; }, { reload: sec(0.67) });
mod('matter_eater', 'Matter Eater', 3, 120, 0, 'The projectile eats away everything around it.', I('#a040ff', 'hole'), (p) => { p.eater = true; }, { uses: 10 });
mod('petrify', 'Petrify', 2, 10, 0, 'Creatures it hits are turned to stone for a while.', I('#a0a0a0', 'rock'), (p) => { p.inflict.push(['petrified', 60]); });
mod('venomous_curse', 'Venomous Curse', 2, 30, 0, 'Creatures it hits are poisoned for a long time.', I('#90ff40', 'heal'), (p) => { p.inflict.push(['venom', 240]); });
const curse = (id: string, name: string, desc: string, s: Status) => mod(id, name, 3, 50, 0, desc, I('#c040ff', 'crit'), (p) => { p.inflict.push([s, 300]); });
curse('curse_electricity', 'Weakening Curse - Electricity', 'Creatures it hits take double damage from electricity.', 'curseElec');
curse('curse_explosives', 'Weakening Curse - Explosives', 'Creatures it hits take double damage from explosions.', 'curseExpl');
curse('curse_melee', 'Weakening Curse - Melee', 'Creatures it hits take double damage from blows.', 'curseMelee');
curse('curse_projectiles', 'Weakening Curse - Projectiles', 'Creatures it hits take double damage from projectiles.', 'curseProj');
const personal = (id: string, name: string, desc: string, s: Status) => mod(id, name, 4, s === 'gravityWell' ? 110 : 90, 0, desc, I('#ff8040', 'fireball'), (p) => { p.inflict.push([s, 200]); }, { uses: 20 });
personal('personal_fireball_thrower', 'Personal Fireball Thrower', 'Creatures it hits throw fireballs at their friends.', 'fireThrower');
personal('personal_lightning_caster', 'Personal Lightning Caster', 'Creatures it hits become living thunderstorms.', 'lightningCaster');
personal('personal_tentacler', 'Personal Tentacler', 'Creatures it hits lash out with tentacles.', 'tentacler');
personal('personal_gravity_field', 'Personal Gravity Field', 'Creatures it hits pull everything around them in.', 'gravityWell');

// ---- transmutation where it ends
const tm = (id: string, name: string, tier: number, mana: number, cd: number, desc: string, color: string, kind: string, extra: Partial<SpellDef> = {}) =>
  mod(id, name, tier, mana, cd, desc, I(color, 'sea'), (p) => { p.transmute.push(kind); }, extra);
tm('blood_to_acid', 'Blood to Acid', 2, 30, 0.17, 'Blood near where the projectile ends turns to acid.', '#a0ff40', 'bloodToAcid', { noita: 'Blood To Acid' });
tm('lava_to_blood', 'Lava to Blood', 2, 30, 0.17, 'Lava near where the projectile ends turns to blood.', '#c01818', 'lavaToBlood', { noita: 'Lava To Blood' });
tm('water_to_poison', 'Water to Poison', 2, 30, 0.17, 'Water near where the projectile ends turns to toxic sludge.', '#90ff40', 'waterToPoison', { noita: 'Water To Poison' });
tm('toxic_to_acid', 'Toxic Sludge to Acid', 2, 50, 0.17, 'Toxic sludge near where the projectile ends turns to acid.', '#a0ff40', 'toxicToAcid', { noita: 'Toxic Sludge To Acid' });
tm('ground_to_sand', 'Ground to Sand', 3, 70, 1, 'The ground near where the projectile ends turns to sand.', '#e0d090', 'groundToSand', { uses: 8, noita: 'Ground To Sand' });
tm('chaotic_transmutation', 'Chaotic Transmutation', 3, 80, 0.33, 'Everything near where the projectile ends turns into something else.', '#ff80ff', 'chaos', { uses: 8 });

// ---- looks
const glimmer = (id: string, name: string, color: string, rainbow = false) =>
  mod(id, name, 0, 0, -0.13, 'Colours the projectile. Purely decorative, and quick.', I(color, 'glimmer'), (p) => { p.color = hexCol(color); p.rainbow = rainbow; });
glimmer('red_glimmer', 'Red Glimmer', '#ff4040');
glimmer('orange_glimmer', 'Orange Glimmer', '#ff9030');
glimmer('yellow_glimmer', 'Yellow Glimmer', '#ffe040');
glimmer('green_glimmer', 'Green Glimmer', '#40ff60');
glimmer('blue_glimmer', 'Blue Glimmer', '#4080ff');
glimmer('purple_glimmer', 'Purple Glimmer', '#c040ff');
glimmer('rainbow_glimmer', 'Rainbow Glimmer', '#ffffff', true);
mod('invisible_spell', 'Invisible Spell', 1, 0, -0.13, 'The projectile can\'t be seen.', I('#808080', 'glimmer'), (p) => { p.invisible = true; });
mod('light', 'Light', 0, 1, 0, 'The projectile shines brightly.', I('#ffffc0', 'glimmer'), (p) => { p.size *= 1.3; p.color = 0xffffd0; });

// ---- protection
mod('projectile_energy_shield', 'Projectile Energy Shield', 2, 5, 0, 'The projectile knocks other creatures\' projectiles out of the air.', I('#80ffff', 'circle'), (p) => { p.shield = true; p.speed *= 0.4; });

// ---- feeding on things
mod('essence_to_power', 'Essence to Power', 3, 110, 0.33, 'The projectile draws in experience orbs nearby and grows stronger for each.', I('#80ff40', 'plus'), (p) => { p.data.essence = 1; });
mod('spells_to_power', 'Spells to Power', 3, 110, 0.33, 'The projectile absorbs your other projectiles nearby, adding their damage to its own.', I('#ffff80', 'plus'), (p) => { p.data.spellsPower = 1; });

// ---- helpers some modifiers cast
proj('cluster_bolt', 'Cluster Bolt', 5, 0, 'An explosive little bolt.', I('#ffa040'), { visual: 'spark', dmg: 2, explR: 1, explDmg: 4, terrain: 1, speed: 0.7, life: 16, gravity: 0.03, color: 0xffa040, size: 0.1 }, { hidden: true });
proj('firecracker', 'Firecracker', 5, 0, 'A firecracker.', I('#ff4040'), { visual: 'spark', dmg: 1, explR: 0.8, explDmg: 3, speed: 0.5, life: 14, gravity: 0.03, bounces: 3, rainbow: true, color: 0xff4040, size: 0.08 }, { hidden: true });
const OB = { speed: 0, ghost: true, pierce: true, life: 400 };
proj('orbit_fireball', 'Orbiting Fireball', 5, 0, 'A fireball circling a projectile.', I('#ff7a1a'), { ...OB, visual: 'fire', dmg: 3, fire: true, explR: 1.2, explDmg: 4, terrain: 1, color: 0xff7a1a, size: 0.18 }, { hidden: true });
proj('orbit_nuke', 'Orbiting Nuke', 5, 0, 'A nuke circling a projectile.', I('#c0ff40'), { ...OB, visual: 'icon', explR: 6, explDmg: 50, terrain: 40, fire: true, color: 0xc0ff40, size: 0.3 }, { hidden: true, sprite: 'nuke' });
proj('orbit_saw', 'Orbiting Sawblade', 5, 0, 'A sawblade circling a projectile.', I('#d0d0d0'), { ...OB, visual: 'icon', dmg: 5, color: 0xd0d0d0, size: 0.25 }, { hidden: true, sprite: 'disc' });
proj('orbit_plasma', 'Orbiting Plasma', 5, 0, 'A plasma beam circling a projectile.', I('#ff40ff'), { ...OB, visual: 'beam', dmg: 4, color: 0xff40ff, size: 0.1 }, { hidden: true });
