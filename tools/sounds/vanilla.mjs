// Which of the vanilla sound files (assets/minecraft/sounds/ of a Java Edition resource pack) play each of the game's
// sound names. `{a-b}` expands to a numbered range, `{,2-4}` also takes the file without a number. A name may instead
// be an alias of another (sharing its audio) with its own pitch or volume, like vanilla's SoundTypes: metal is stone
// played higher. `vol` and `pitch` multiply what the game asks for.
// Names the game has but this table lacks keep their synthesised sound.

/** @typedef {{ files?: string | string[], alias?: string, vol?: number, pitch?: number }} SoundDef */

/** @type {Record<string, SoundDef>} */
export const SOUNDS = {
  // ------------------------------------------------------------ blocks: break (dig), place, footsteps and hitting (step)
  'dig.stone': { files: 'dig/stone{1-4}' }, 'step.stone': { files: 'step/stone{1-6}' },
  'dig.wood': { files: 'dig/wood{1-4}' }, 'step.wood': { files: 'step/wood{1-6}' },
  'dig.grass': { files: 'dig/grass{1-4}' }, 'step.grass': { files: 'step/grass{1-6}' },
  'dig.gravel': { files: 'dig/gravel{1-4}' }, 'step.gravel': { files: 'step/gravel{1-4}' },
  'dig.sand': { files: 'dig/sand{1-4}' }, 'step.sand': { files: 'step/sand{1-5}' },
  'dig.snow': { files: 'dig/snow{1-4}' }, 'step.snow': { files: 'step/snow{1-4}' },
  'dig.cloth': { files: 'dig/cloth{1-4}' }, 'step.cloth': { files: 'step/cloth{1-4}' },
  'dig.glass': { files: 'random/glass{1-3}' }, 'place.glass': { alias: 'dig.stone' }, 'step.glass': { alias: 'step.stone' },
  'dig.metal': { alias: 'dig.stone', pitch: 1.5 }, 'place.metal': { alias: 'dig.stone', pitch: 1.5 }, 'step.metal': { alias: 'step.stone', pitch: 1.5 },
  'dig.slime': { files: 'mob/slime/big{1-4}' }, 'step.slime': { files: 'mob/slime/small{1-5}' },

  // ------------------------------------------------------------ the player, items, interface
  hurt: { files: 'damage/hit{1-3}' },
  'fall.small': { files: 'damage/fallsmall' }, 'fall.big': { files: 'damage/fallbig' },
  click: { files: 'random/click' },
  pop: { files: 'random/pop' },
  orb: { files: 'random/orb' },
  levelup: { files: 'random/levelup' },
  eat: { files: 'random/eat{1-3}' },
  burp: { files: 'random/burp' },
  drink: { files: 'random/drink' },
  bow: { files: 'random/bow' },
  arrowHit: { files: 'random/bowhit{1-4}' },
  'glass.break': { alias: 'dig.glass' },
  fizz: { files: 'random/fizz' },
  fuse: { files: 'random/fuse' },
  explode: { files: 'random/explode{1-4}' },
  fire: { files: 'fire/ignite' },
  fireball: { files: 'mob/ghast/fireball4' },
  'bucket.fill': { files: 'item/bucket/fill{1-3}' }, 'bucket.empty': { files: 'item/bucket/empty{1-3}' },
  'bucket.fillLava': { files: 'item/bucket/fill_lava{1-3}' }, 'bucket.emptyLava': { files: 'item/bucket/empty_lava{1-3}' },
  'bottle.fill': { files: 'item/bottle/fill{1-4}' },
  'bobber.splash': { files: 'random/splash' },
  shears: { files: 'mob/sheep/shear' },

  // ------------------------------------------------------------ blocks that do things
  'door.open': { files: 'block/wooden_door/open{,2-4}' }, 'door.close': { files: 'block/wooden_door/close{,2-6}' },
  door: { alias: 'door.open' },
  chestOpen: { files: 'block/chest/open' }, chestClose: { files: 'block/chest/close{,2-3}' },
  'piston.out': { files: 'tile/piston/out' }, 'piston.in': { files: 'tile/piston/in' },
  'anvil.use': { files: 'random/anvil_use' }, 'anvil.land': { files: 'random/anvil_land' },
  brew: { files: 'block/brewing_stand/brew{1-2}' },
  portalTrigger: { files: 'portal/trigger' }, portalTravel: { files: 'portal/travel' }, portal: { files: 'portal/portal' },
  'fire.ambient': { files: 'fire/fire' },
  'lava.pop': { files: 'liquid/lavapop' }, 'lava.ambient': { files: 'liquid/lava' },
  'water.ambient': { files: 'liquid/water' },

  // ------------------------------------------------------------ water, weather, ambience
  splash: { files: 'liquid/splash{,2}' },
  swim: { files: 'liquid/swim{1-4}' },
  thunder: { files: 'ambient/weather/thunder{1-3}' },
  rain: { files: 'ambient/weather/rain{1-4}' },
  cave: { files: 'ambient/cave/cave{1-13}' },
  wind: { files: 'item/elytra/elytra_loop' },
  fireworkLaunch: { files: 'fireworks/launch1' },
  fireworkBlast: { files: 'fireworks/blast1' }, fireworkLargeBlast: { files: 'fireworks/largeBlast1' }, fireworkTwinkle: { files: 'fireworks/twinkle1' },

  // ------------------------------------------------------------ mobs
  'zombie.say': { files: 'mob/zombie/say{1-3}' }, 'zombie.hurt': { files: 'mob/zombie/hurt{1-2}' }, 'zombie.death': { files: 'mob/zombie/death' }, 'zombie.step': { files: 'mob/zombie/step{1-5}' },
  'skeleton.say': { files: 'mob/skeleton/say{1-3}' }, 'skeleton.hurt': { files: 'mob/skeleton/hurt{1-4}' }, 'skeleton.death': { files: 'mob/skeleton/death' }, 'skeleton.step': { files: 'mob/skeleton/step{1-4}' },
  'creeper.hurt': { files: 'mob/creeper/say{1-4}' }, 'creeper.death': { files: 'mob/creeper/death' },
  'spider.say': { files: 'mob/spider/say{1-4}' }, 'spider.hurt': { alias: 'spider.say' }, 'spider.death': { files: 'mob/spider/death' }, 'spider.step': { files: 'mob/spider/step{1-4}' },
  'pig.say': { files: 'mob/pig/say{1-3}' }, 'pig.hurt': { alias: 'pig.say' }, 'pig.death': { files: 'mob/pig/death' }, 'pig.step': { files: 'mob/pig/step{1-5}' },
  'cow.say': { files: 'mob/cow/say{1-4}' }, 'cow.hurt': { files: 'mob/cow/hurt{1-3}' }, 'cow.death': { alias: 'cow.hurt' }, 'cow.step': { files: 'mob/cow/step{1-4}' },
  'sheep.say': { files: 'mob/sheep/say{1-3}' }, 'sheep.hurt': { alias: 'sheep.say' }, 'sheep.death': { alias: 'sheep.say' }, 'sheep.step': { files: 'mob/sheep/step{1-5}' },
  'chicken.say': { files: 'mob/chicken/say{1-3}' }, 'chicken.hurt': { files: 'mob/chicken/hurt{1-2}' }, 'chicken.death': { alias: 'chicken.hurt' }, 'chicken.step': { files: 'mob/chicken/step{1-2}' },
  'chicken.plop': { files: 'mob/chicken/plop' },
  'wolf.say': { files: 'mob/wolf/bark{1-3}' }, 'wolf.growl': { files: 'mob/wolf/growl{1-3}' }, 'wolf.whine': { files: 'mob/wolf/whine' }, 'wolf.pant': { files: 'mob/wolf/panting' },
  'wolf.hurt': { files: 'mob/wolf/hurt{1-3}' }, 'wolf.death': { files: 'mob/wolf/death' }, 'wolf.step': { files: 'mob/wolf/step{1-5}' },
  'enderman.idle': { files: 'mob/endermen/idle{1-5}' }, 'enderman.hurt': { files: 'mob/endermen/hit{1-4}' }, 'enderman.death': { files: 'mob/endermen/death' },
  'enderman.stare': { files: 'mob/endermen/stare' }, 'enderman.scream': { files: 'mob/endermen/scream{1-4}' }, 'enderman.teleport': { files: 'mob/endermen/portal{,2}' },
  'silverfish.say': { files: 'mob/silverfish/say{1-4}' }, 'silverfish.hit': { files: 'mob/silverfish/hit{1-3}' }, 'silverfish.kill': { files: 'mob/silverfish/kill' }, 'silverfish.step': { files: 'mob/silverfish/step{1-4}' },
  'slime.jump': { files: 'mob/slime/big{1-4}' }, 'slime.small': { files: 'mob/slime/small{1-5}' }, 'slime.squish': { alias: 'slime.jump' },
  'bat.idle': { files: 'mob/bat/idle{1-4}' }, 'bat.hurt': { files: 'mob/bat/hurt{1-4}' }, 'bat.death': { files: 'mob/bat/death' },
  'villager.idle': { files: 'mob/villager/idle{1-3}' }, 'villager.trade': { files: 'mob/villager/haggle{1-3}' }, 'villager.yes': { files: 'mob/villager/yes{1-3}' },
  'villager.no': { files: 'mob/villager/no{1-3}' }, 'villager.hurt': { files: 'mob/villager/hit{1-4}' }, 'villager.death': { files: 'mob/villager/death' },
  'ghast.moan': { files: 'mob/ghast/moan{1-7}' }, 'ghast.scream': { files: 'mob/ghast/scream{1-5}' }, 'ghast.death': { files: 'mob/ghast/death' },
  'ghast.charge': { files: 'mob/ghast/charge' }, 'ghast.fireball': { alias: 'fireball' },
  'pigman.say': { files: 'mob/zombiepig/zpig{1-4}' }, 'pigman.hurt': { files: 'mob/zombiepig/zpighurt{1-2}' }, 'pigman.death': { files: 'mob/zombiepig/zpigdeath' }, 'pigman.angry': { files: 'mob/zombiepig/zpigangry{1-4}' },
  'blaze.breathe': { files: 'mob/blaze/breathe{1-4}' }, 'blaze.hurt': { files: 'mob/blaze/hit{1-4}' }, 'blaze.death': { files: 'mob/blaze/death' }, 'blaze.shoot': { alias: 'fireball' },
  'dragon.growl': { files: 'mob/enderdragon/growl{1-4}' }, 'dragon.flap': { files: 'mob/enderdragon/wings{1-6}' }, 'dragon.hit': { files: 'mob/enderdragon/hit{1-4}' }, 'dragon.death': { files: 'mob/enderdragon/end' },
  'horse.say': { files: 'mob/horse/idle{1-3}' }, 'horse.hurt': { files: 'mob/horse/hit{1-4}' }, 'horse.death': { files: 'mob/horse/death' }, 'horse.angry': { files: 'mob/horse/angry1' },
  'horse.breathe': { files: 'mob/horse/breathe{1-3}' }, 'horse.step': { files: 'mob/horse/soft{1-6}' }, 'horse.stepWood': { files: 'mob/horse/wood{1-6}' }, 'horse.gallop': { files: 'mob/horse/gallop{1-4}' },
  'horse.jump': { files: 'mob/horse/jump' }, 'horse.land': { files: 'mob/horse/land' }, 'horse.saddle': { files: 'mob/horse/leather' }, 'horse.armor': { files: 'mob/horse/armor' },
  'horse.eat': { files: 'entity/horse/eat{1-5}' },
  'donkey.say': { files: 'mob/horse/donkey/idle{1-3}' }, 'donkey.hurt': { files: 'mob/horse/donkey/hit{1-3}' }, 'donkey.death': { files: 'mob/horse/donkey/death' }, 'donkey.angry': { files: 'mob/horse/donkey/angry{1-2}' },
};

/** Music, by when it plays (vanilla's MusicTicker types). Each track is its own file, streamed when it plays. */
export const MUSIC = {
  menu: 'music/menu/menu{1-4}',
  game: ['music/game/calm{1-3}', 'music/game/hal{1-4}', 'music/game/nuance{1-2}', 'music/game/piano{1-3}'],
  creative: 'music/game/creative/creative{1-5}',
  nether: 'music/game/nether/nether{1-4}',
  end: 'music/game/end/end',
  boss: 'music/game/end/boss',
  credits: 'music/game/end/credits',
};

/** `dig/stone{1-4}` -> dig/stone1 ... dig/stone4; `x{,2-3}` -> x, x2, x3. */
export function expand(pattern) {
  const m = /^(.*)\{([^}]*)\}(.*)$/.exec(pattern);
  if (!m) return [pattern];
  const out = [];
  for (const part of m[2].split(',')) {
    if (part === '') out.push(m[1] + m[3]);
    else if (part.includes('-')) { const [a, b] = part.split('-').map(Number); for (let i = a; i <= b; i++) out.push(m[1] + i + m[3]); }
    else out.push(m[1] + part + m[3]);
  }
  return out;
}

export const filesOf = (f) => (Array.isArray(f) ? f : f ? [f] : []).flatMap(expand);
