// Ready-made wands for the wand box: test cases for the spell interpreter, after a list of Noita wand presets.
// They're plain spell lists (this mod's ids; the Noita ids they stand for are in the comments): every behaviour
// comes from the generic casting rules, nothing here is special-cased. Cast them with debug on (/wanddebug) to see
// each cast's tree, or press Tree in the wand box to print the first casts of a preset without firing.

export interface Preset { name: string; note: string; spells: string[] }

export const PRESETS: Preset[] = [
  // BURST_4, LIGHT_BULLET x4
  { name: 'Multicast', note: 'One cast: Quadruple Spell draws four spark bolts into the same block.', spells: ['quadruple_spell', 'spark_bolt', 'spark_bolt', 'spark_bolt', 'spark_bolt'] },
  // BURST_4, DAMAGE, LIGHT_BULLET x4
  { name: 'Modifier + multicast', note: 'Damage Plus is in the block: all four bolts get it.', spells: ['quadruple_spell', 'damage_plus', 'spark_bolt', 'spark_bolt', 'spark_bolt', 'spark_bolt'] },
  // DAMAGE, SPEED, SPREAD_REDUCE, BUCKSHOT
  { name: 'Multi-projectile spell', note: 'One Triplicate Bolt card, three projectiles: every one gets damage, speed and accuracy.', spells: ['damage_plus', 'speed_up', 'reduce_spread', 'triplicate_bolt'] },
  // LIGHT_BULLET_TRIGGER, CHAINSAW
  { name: 'Basic trigger', note: 'The chainsaw is cast where the bolt hits, not at the wand.', spells: ['spark_bolt_trigger', 'chainsaw'] },
  // LIGHT_BULLET_TRIGGER, SCATTER_4, HORIZONTAL_ARC, BUCKSHOT, DIGGER, CHAINSAW, CHAINSAW
  { name: 'Trigger + multicast payload', note: 'The payload is a block of its own: scatter, a path modifier, a triplicate, a digger, two chainsaws.', spells: ['spark_bolt_trigger', 'scatter_4', 'horizontal_path', 'triplicate_bolt', 'digging_bolt', 'chainsaw', 'chainsaw'] },
  // LIGHT_BULLET_TRIGGER, BURST_4, SLOW_BULLET, TNTBOX, TNTBOX_BIG, PROPANE_TANK
  { name: 'Triggered explosives', note: 'A multicast payload of four different things.', spells: ['spark_bolt_trigger', 'quadruple_spell', 'energy_orb', 'explosive_box', 'large_explosive_box', 'propane_tank'] },
  // SPITTER_TIMER, CHAIN_BOLT
  { name: 'Timer payload', note: 'The chain bolt leaves from the spitter when its timer runs out.', spells: ['spitter_timer', 'chain_bolt'] },
  // PINGPONG_PATH, LUMINOUS_DRILL, BURST_2
  { name: 'Ping-pong drill', note: 'A path modifier on the drill; the drill still shortens the cast delay.', spells: ['ping_pong_path', 'luminous_drill', 'double_spell'] },
  // PINGPONG_PATH, SPEED, CHAINSAW, BURST_2
  { name: 'Ping-pong chainsaw', note: 'A faster, ping-ponging chainsaw that still sets the wand\'s timing.', spells: ['ping_pong_path', 'speed_up', 'chainsaw', 'double_spell'] },
  // BURST_2, LIGHT_BULLET_TRIGGER, HORIZONTAL_ARC, MANA_REDUCE, SCATTER_4, SPITTER x2, DIGGER x2, CHAINSAW, BURST_2
  { name: 'Trigger machine gun', note: 'Stress test: nesting, mana, chainsaw timing, deck progression and wrapping.', spells: ['double_spell', 'spark_bolt_trigger', 'horizontal_path', 'add_mana', 'scatter_4', 'spitter', 'spitter', 'digging_bolt', 'digging_bolt', 'chainsaw', 'double_spell'] },
  // TELEPORT_PROJECTILE_SHORT
  { name: 'Short teleport', note: 'You teleport where the small teleport bolt lands.', spells: ['small_teleport_bolt'] },
  // LONG_DISTANCE_CAST, TELEPORT_PROJECTILE_SHORT
  { name: 'Remote teleport', note: 'Long-Distance Cast moves where the teleport bolt starts.', spells: ['long_distance_cast', 'small_teleport_bolt'] },
  // BURST_2, LUMINOUS_DRILL, TELEPORT_PROJECTILE_SHORT
  { name: 'Drill teleport', note: 'A drill and a teleport bolt in one cast.', spells: ['double_spell', 'luminous_drill', 'small_teleport_bolt'] },
  // HOMING_SHORT, GLOWING_BOLT
  { name: 'Homing pinpoint', note: 'A slow piercing light that homes: it stays on a target, hitting it again and again.', spells: ['short_range_homing', 'pinpoint_of_light'] },
  // LIGHT_BULLET_TRIGGER, HOMING_SHORT, BALL_LIGHTNING
  { name: 'Trigger + homing payload', note: 'The homing belongs to the payload\'s ball lightning, not to the spark bolt.', spells: ['spark_bolt_trigger', 'short_range_homing', 'ball_lightning'] },
  // HOMING, AREA_DAMAGE, MIST_SLIME
  { name: 'Homing damage mist', note: 'Two modifiers on one mist: it homes, and it hurts what it touches.', spells: ['homing', 'damage_field', 'slime_mist'] },
  // LIGHT_BULLET_TRIGGER, HOMING_SHORT, ORBIT_LASERS, MIST_SLIME
  { name: 'Triggered orbiting mist', note: 'Inside the payload: a mist that homes with plasma beams circling it.', spells: ['spark_bolt_trigger', 'short_range_homing', 'plasma_beam_orbit', 'slime_mist'] },
  // LIGHT_BULLET_TRIGGER, HOMING_SHORT, LASER_EMITTER_CUTTER
  { name: 'Triggered plasma', note: 'The plasma cutter starts where the bolt hits, and it (not the bolt) homes.', spells: ['spark_bolt_trigger', 'short_range_homing', 'plasma_cutter'] },
  // HOMING, LASER_EMITTER
  { name: 'Direct homing plasma', note: 'Compare with Triggered plasma: here the homing is in the outer block.', spells: ['homing', 'plasma_beam'] },
  // HOMING, SUMMON_ROCK
  { name: 'Homing rock', note: 'A heavy rock that falls toward monsters.', spells: ['homing', 'summon_rock'] },
  // BURST_2, AIR_BULLET, SUMMON_ROCK
  { name: 'Accelerated rock', note: 'The burst of air pushes the rock cast with it.', spells: ['double_spell', 'burst_of_air', 'summon_rock'] },
  // LIGHT_BULLET_TRIGGER, HEAL_BULLET
  { name: 'Healing trigger', note: 'A healing bolt released where the spark bolt hits.', spells: ['spark_bolt_trigger', 'healing_bolt'] },
];
