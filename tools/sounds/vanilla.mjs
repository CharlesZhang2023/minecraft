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
  'skeleton_horse.say': { files: 'mob/horse/skeleton/idle{1-3}' }, 'skeleton_horse.hurt': { files: 'mob/horse/skeleton/hit{1-4}' }, 'skeleton_horse.death': { files: 'mob/horse/skeleton/death' },
  'zombie_horse.say': { files: 'mob/horse/zombie/idle{1-3}' }, 'zombie_horse.hurt': { files: 'mob/horse/zombie/hit{1-4}' }, 'zombie_horse.death': { files: 'mob/horse/zombie/death' },

  // ------------------------------------------------------------ the mobs of 1.9 - 1.16
  'husk.say': { files: 'mob/husk/idle{1-3}' }, 'husk.hurt': { files: 'mob/husk/hurt{1-2}' }, 'husk.death': { files: 'mob/husk/death{1-2}' }, 'husk.step': { files: 'mob/husk/step{1-5}' },
  'drowned.say': { files: 'mob/drowned/idle{1-5}' }, 'drowned.hurt': { files: 'mob/drowned/hurt{1-3}' }, 'drowned.death': { files: 'mob/drowned/death{1-2}' }, 'drowned.step': { files: 'mob/drowned/step{1-5}' },
  'zombie_villager.say': { files: 'mob/zombie_villager/say{1-3}' }, 'zombie_villager.hurt': { files: 'mob/zombie_villager/hurt{1-2}' }, 'zombie_villager.death': { files: 'mob/zombie_villager/death' },
  'stray.say': { files: 'mob/stray/idle{1-4}' }, 'stray.hurt': { files: 'mob/stray/hurt{1-4}' }, 'stray.death': { files: 'mob/stray/death{1-2}' }, 'stray.step': { files: 'mob/stray/step{1-4}' },
  'wither_skeleton.say': { files: 'mob/wither_skeleton/idle{1-3}' }, 'wither_skeleton.hurt': { files: 'mob/wither_skeleton/hurt{1-4}' }, 'wither_skeleton.death': { files: 'mob/wither_skeleton/death{1-2}' },
  'witch.idle': { files: 'entity/witch/ambient{1-5}' }, 'witch.hurt': { files: 'entity/witch/hurt{1-3}' }, 'witch.death': { files: 'entity/witch/death{1-3}' }, 'witch.throw': { files: 'entity/witch/throw{1-3}' },
  'illager.idle': { alias: 'pillager.idle' }, 'illager.hurt': { alias: 'pillager.hurt' }, 'illager.death': { alias: 'pillager.death' },
  'pillager.idle': { files: 'mob/pillager/idle{1-4}' }, 'pillager.hurt': { files: 'mob/pillager/hurt{1-3}' }, 'pillager.death': { files: 'mob/pillager/death{1-2}' },
  'vindicator.idle': { files: 'mob/vindication_illager/idle{1-5}' }, 'vindicator.hurt': { files: 'mob/vindication_illager/hurt{1-3}' }, 'vindicator.death': { files: 'mob/vindication_illager/death{1-2}' },
  'evoker.idle': { files: 'mob/evocation_illager/idle{1-4}' }, 'evoker.hurt': { files: 'mob/evocation_illager/hurt{1-2}' }, 'evoker.death': { files: 'mob/evocation_illager/death{1-2}' },
  'evoker.fangs': { files: 'mob/evocation_illager/prepare_attack{1-2}' }, 'evoker.summon': { files: 'mob/evocation_illager/prepare_summon' },
  'evoker.wololo': { files: 'mob/evocation_illager/prepare_wololo' }, 'evoker.fangs_bite': { files: 'mob/evocation_illager/fangs' },
  'vex.idle': { files: 'mob/vex/idle{1-4}' }, 'vex.hurt': { files: 'mob/vex/hurt{1-2}' }, 'vex.death': { files: 'mob/vex/death{1-2}' },
  'ravager.idle': { files: 'mob/ravager/idle{1-8}' }, 'ravager.hurt': { files: 'mob/ravager/hurt{1-4}' }, 'ravager.death': { files: 'mob/ravager/death{1-3}' }, 'ravager.roar': { files: 'mob/ravager/roar{1-4}' },
  // (the pack has no underwater guardian voices: the ones on land stand in)
  'guardian.idle': { files: 'mob/guardian/land_idle{1-4}' }, 'guardian.hurt': { files: 'mob/guardian/guardian_hit{1-4}' }, 'guardian.death': { files: 'mob/guardian/guardian_death' },
  'guardian.attack': { files: 'mob/guardian/attack_loop' },
  'elder_guardian.idle': { files: 'mob/guardian/elder_idle{1-4}' }, 'elder_guardian.hurt': { files: 'mob/guardian/elder_hit{1-4}' }, 'elder_guardian.death': { files: 'mob/guardian/elder_death' },
  'elder_guardian.curse': { files: 'mob/guardian/curse' },
  'phantom.idle': { files: 'mob/phantom/idle{1-5}' }, 'phantom.hurt': { files: 'mob/phantom/hurt{1-3}' }, 'phantom.death': { files: 'mob/phantom/death{1-3}' }, 'phantom.swoop': { files: 'mob/phantom/swoop{1-4}' },
  'iron_golem.hurt': { files: 'mob/irongolem/hit{1-4}' }, 'iron_golem.death': { files: 'mob/irongolem/death' }, 'iron_golem.attack': { files: 'mob/irongolem/throw' }, 'iron_golem.repair': { files: 'mob/irongolem/repair' },
  'snow_golem.hurt': { files: 'entity/snowman/hurt{1-3}' }, 'snow_golem.death': { files: 'entity/snowman/death{1-3}' },
  'shulker.say': { files: 'entity/shulker/ambient{1-7}' }, 'shulker.hurt': { files: 'entity/shulker/hurt{1-4}' }, 'shulker.death': { files: 'entity/shulker/death{1-4}' },
  'shulker.shoot': { files: 'entity/shulker/shoot{1-4}' }, 'shulker.bullet': { files: 'entity/shulker_bullet/hit{1-4}' },
  'piglin.say': { files: 'mob/piglin/idle{1-5}' }, 'piglin.hurt': { files: 'mob/piglin/hurt{1-3}' }, 'piglin.death': { files: 'mob/piglin/death{1-4}' }, 'piglin.admire': { files: 'mob/piglin/admire{1-2}' },
  'piglin_brute.say': { files: 'mob/piglin_brute/idle{1-9}' }, 'piglin_brute.hurt': { files: 'mob/piglin_brute/hurt{1-4}' }, 'piglin_brute.death': { files: 'mob/piglin_brute/death{1-3}' },
  'hoglin.say': { files: 'mob/hoglin/idle{1-11}' }, 'hoglin.hurt': { files: 'mob/hoglin/hurt{1-4}' }, 'hoglin.death': { files: 'mob/hoglin/death{1-3}' },
  'zoglin.say': { files: 'mob/zoglin/idle{1-6}' }, 'zoglin.hurt': { files: 'mob/zoglin/hurt{1-3}' }, 'zoglin.death': { files: 'mob/zoglin/death{1-3}' },
  'strider.say': { files: 'mob/strider/idle{1-6}' }, 'strider.hurt': { files: 'mob/strider/hurt{1-4}' }, 'strider.death': { files: 'mob/strider/death{1-4}' },
  'magma_cube.squish': { files: 'mob/magmacube/big{1-4}' },
  'wither.ambient': { files: 'mob/wither/idle{1-4}' }, 'wither.hurt': { files: 'mob/wither/hurt{1-4}' }, 'wither.death': { files: 'mob/wither/death' },
  'wither.shoot': { files: 'mob/wither/shoot' }, 'wither.spawn': { files: 'mob/wither/spawn' }, 'wither.break_block': { files: 'mob/zombie/woodbreak' },
  'wandering_trader.idle': { files: 'mob/wandering_trader/idle{1-5}' }, 'wandering_trader.hurt': { files: 'mob/wandering_trader/hurt{1-4}' }, 'wandering_trader.death': { files: 'mob/wandering_trader/death' },
  // animals
  'llama.say': { files: 'mob/llama/idle{1-5}' }, 'llama.hurt': { files: 'mob/llama/hurt{1-3}' }, 'llama.death': { files: 'mob/llama/death{1-2}' }, 'llama.spit': { files: 'mob/llama/spit{1-2}' },
  'polar_bear.say': { files: 'mob/polarbear/idle{1-4}' }, 'polar_bear.hurt': { files: 'mob/polarbear/hurt{1-4}' }, 'polar_bear.death': { files: 'mob/polarbear/death{1-3}' },
  'rabbit.say': { files: 'mob/rabbit/idle{1-4}' }, 'rabbit.hurt': { files: 'mob/rabbit/hurt{1-4}' }, 'rabbit.death': { files: 'mob/rabbit/bunnymurder' }, 'rabbit.hop': { files: 'mob/rabbit/hop{1-4}' },
  'fox.say': { files: 'mob/fox/idle{1-6}' }, 'fox.hurt': { files: 'mob/fox/hurt{1-4}' }, 'fox.death': { files: 'mob/fox/death{1-2}' },
  'cat.say': { files: 'mob/cat/meow{1-4}' }, 'cat.hurt': { files: 'mob/cat/hitt{1-3}' }, 'cat.death': { alias: 'cat.hurt' }, 'cat.purr': { files: 'mob/cat/purr{1-3}' },
  'ocelot.say': { files: 'mob/cat/ocelot/idle{1-4}' }, 'ocelot.death': { files: 'mob/cat/ocelot/death{1-3}' },
  'parrot.say': { files: 'mob/parrot/idle{1-6}' }, 'parrot.hurt': { files: 'mob/parrot/hurt{1-2}' }, 'parrot.death': { files: 'mob/parrot/death{1-4}' },
  'panda.say': { files: 'mob/panda/idle{1-4}' }, 'panda.hurt': { files: 'mob/panda/hurt{1-6}' }, 'panda.death': { files: 'mob/panda/death{1-4}' }, 'panda.sneeze': { files: 'mob/panda/sneeze{1-3}' },
  'turtle.say': { files: 'mob/turtle/idle{1-3}' }, 'turtle.hurt': { files: 'mob/turtle/hurt{1-5}' }, 'turtle.death': { files: 'mob/turtle/death{1-3}' },
  'turtle.egg_crack': { files: 'mob/turtle/egg/egg_crack{1-5}' }, 'turtle.egg_hatch': { files: 'mob/turtle/baby/egg_hatched{1-3}' },
  'dolphin.say': { files: 'mob/dolphin/idle_water{1-10}' }, 'dolphin.hurt': { files: 'mob/dolphin/hurt{1-3}' }, 'dolphin.death': { files: 'mob/dolphin/death{1-2}' },
  'squid.say': { files: 'entity/squid/ambient{1-5}' }, 'squid.hurt': { files: 'entity/squid/hurt{1-4}' }, 'squid.death': { files: 'entity/squid/death{1-3}' },
  'fish.hurt': { files: 'entity/fish/hurt{1-4}' }, 'fish.death': { alias: 'fish.hurt' }, 'fish.flop': { files: 'entity/fish/flop{1-4}' },
  'pufferfish.hurt': { files: 'entity/pufferfish/hurt{1-2}' }, 'pufferfish.death': { files: 'entity/pufferfish/death{1-2}' }, 'pufferfish.blow_up': { files: 'entity/pufferfish/blow_up{1-2}' },
  'bee.loop': { files: 'mob/bee/loop{1-5}' }, 'bee.hurt': { files: 'mob/bee/hurt{1-3}' }, 'bee.death': { files: 'mob/bee/death{1-2}' }, 'bee.sting': { files: 'mob/bee/sting' },
  'bee.enter': { files: 'block/beehive/enter' },

  // ------------------------------------------------------------ the blocks, items and combat of 1.9 - 1.16
  'attack.crit': { files: 'entity/player/attack/crit{1-3}' }, 'attack.strong': { files: 'entity/player/attack/strong{1-6}' },
  'attack.sweep': { files: 'entity/player/attack/sweep{1-7}' }, 'attack.weak': { files: 'entity/player/attack/weak{1-4}' }, sweep: { alias: 'attack.sweep' },
  'shield.block': { files: 'item/shield/block{1-5}' }, 'shield.break': { files: 'random/break' },
  'crossbow.loading': { files: 'item/crossbow/loading_start' }, 'crossbow.loaded': { files: 'item/crossbow/loading_end' }, 'crossbow.shoot': { files: 'item/crossbow/shoot{1-3}' },
  'trident.throw': { files: 'item/trident/throw{1-2}' }, 'trident.hit': { files: 'item/trident/pierce{1-3}' },
  'trident.return': { files: 'item/trident/return{1-3}' }, 'trident.riptide': { files: 'item/trident/riptide{1-3}' },
  'totem.use': { files: 'item/totem/use_totem' },
  throw: { alias: 'bow' },
  'itemframe.add': { files: 'entity/itemframe/add_item{1-4}' }, 'itemframe.remove': { files: 'entity/itemframe/remove_item{1-4}' }, 'itemframe.rotate': { files: 'entity/itemframe/rotate_item{1-4}' },
  'lead.tie': { files: 'entity/leashknot/place{1-3}' }, 'lead.untie': { files: 'entity/leashknot/break{1-3}' },
  'shulker.open': { files: 'block/shulker_box/open' },
  'anchor.charge': { files: 'block/respawn_anchor/charge{1-3}' }, 'anchor.set': { files: 'block/respawn_anchor/set_spawn{1-3}' },
  'beacon.activate': { files: 'block/beacon/activate' }, 'beacon.deactivate': { files: 'block/beacon/deactivate' }, 'beacon.power': { files: 'block/beacon/power{1-3}' },
  'conduit.activate': { files: 'block/conduit/activate' }, 'conduit.attack': { files: 'block/conduit/attack{1-3}' },
  'lodestone.lock': { files: 'block/lodestone/lock{1-2}' },
  bell: { files: 'block/bell/bell_use0{1-2}' },
  'raid.horn': { files: 'event/raid/raidhorn_0{1-4}' },
  'minecart.roll': { files: 'minecart/base' },
  // note blocks: every instrument's sample is an F#, as the game's pitches expect
  'note.harp': { files: 'note/harp2' }, 'note.bass': { files: 'note/bass' }, 'note.basedrum': { files: 'note/bd' }, 'note.snare': { files: 'note/snare' },
  'note.hat': { files: 'note/hat' }, 'note.bell': { files: 'note/bell' }, 'note.flute': { files: 'note/flute' }, 'note.chime': { files: 'note/icechime' },
  'note.guitar': { files: 'note/guitar' }, 'note.xylophone': { files: 'note/xylobone' }, 'note.iron_xylophone': { files: 'note/iron_xylophone' },
  'note.cow_bell': { files: 'note/cow_bell' }, 'note.didgeridoo': { files: 'note/didgeridoo' }, 'note.bit': { files: 'note/bit' }, 'note.banjo': { files: 'note/banjo' },
  'note.pling': { files: 'note/pling' },
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
