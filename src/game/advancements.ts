// Advancements (1.12-1.16): vanilla's five tabs (Minecraft, Nether, The End, Adventure, Husbandry) as data. Each one
// is earned by having an item, by a periodic look at the player (dimension, biome, structure, effects, armour,
// what they ride) or by an event the game reports (kills, trades, brewing...). They share the achievements' store
// (ids "adv:<tab>/<name>"; progress towards the "visit/eat/breed/kill every..." ones is kept as "p:<adv>:<key>").
import type { Entity } from '../entity/entity';

export type AdvTab = 'story' | 'nether' | 'end' | 'adventure' | 'husbandry';
export type Frame = 'task' | 'goal' | 'challenge';
export interface ScanCtx {
  dim: string;
  biome: string;
  /** Structures the player stands in (by type name). */
  structures: Set<string>;
  items: Set<string>;
  armor: string[];
  effects: Set<string>;
  riding: string;
  sleeping: boolean;
  /** Blocks climbed under levitation since it began. */
  levitated: number;
  screen: string;
}
export interface Adv {
  id: string;
  tab: AdvTab;
  parent?: string;
  title: string;
  desc: string;
  icon: string;
  frame?: Frame;
  /** Earned by having any of these items (inventory, armour or off hand). */
  has?: string[];
  /** Earned when the periodic look says so. */
  scan?: (c: ScanCtx) => boolean;
  /** Earned on an event (and the test on its details). */
  on?: string;
  when?: (arg: Record<string, unknown>) => boolean;
  /** "Every one of" advancements: the keys to collect, what each event or look contributes. */
  every?: () => string[];
  key?: (arg: Record<string, unknown> | ScanCtx) => string | null;
}

const HOSTILES = ['Blaze', 'Cave Spider', 'Creeper', 'Drowned', 'Elder Guardian', 'Ender Dragon', 'Enderman', 'Endermite', 'Evoker', 'Ghast', 'Guardian', 'Hoglin', 'Husk', 'Magma Cube', 'Phantom', 'Piglin', 'Piglin Brute', 'Pillager', 'Ravager', 'Shulker', 'Silverfish', 'Skeleton', 'Slime', 'Spider', 'Stray', 'Vex', 'Vindicator', 'Witch', 'Wither', 'Wither Skeleton', 'Zoglin', 'Zombie', 'Zombie Villager', 'Zombified Piglin'];
export const isHostile = (type: string) => HOSTILES.includes(type) || type === 'Zombie Pigman';
const BREEDABLE = ['Bee', 'Cat', 'Chicken', 'Cow', 'Donkey', 'Fox', 'Hoglin', 'Horse', 'Llama', 'Mooshroom', 'Mule', 'Ocelot', 'Panda', 'Pig', 'Rabbit', 'Sheep', 'Strider', 'Turtle', 'Wolf'];
const NETHER_BIOMES = ['Nether Wastes', 'Soul Sand Valley', 'Crimson Forest', 'Warped Forest', 'Basalt Deltas'];
const armorOf = (c: ScanCtx, mat: string) => c.armor.filter((n) => n.startsWith(mat + '_')).length;
/** Food items for "A Balanced Diet" (set by the game: every item with food). */
export const FOODS: string[] = [];
/** Overworld biome names for "Adventuring Time" (set by the game). */
export const OVERWORLD_BIOMES: string[] = [];

export const ADVANCEMENTS: Adv[] = [
  // ------------------------------------------------------------------ Minecraft
  { id: 'story/root', tab: 'story', title: 'Minecraft', desc: 'The heart and story of the game', icon: 'grass_block', has: ['crafting_table'] },
  { id: 'story/mine_stone', tab: 'story', parent: 'story/root', title: 'Stone Age', desc: 'Mine Stone with your new Pickaxe', icon: 'wooden_pickaxe', has: ['cobblestone', 'blackstone'] },
  { id: 'story/upgrade_tools', tab: 'story', parent: 'story/mine_stone', title: 'Getting an Upgrade', desc: 'Construct a better Pickaxe', icon: 'stone_pickaxe', has: ['stone_pickaxe'] },
  { id: 'story/smelt_iron', tab: 'story', parent: 'story/upgrade_tools', title: 'Acquire Hardware', desc: 'Smelt an Iron Ingot', icon: 'iron_ingot', has: ['iron_ingot'] },
  { id: 'story/obtain_armor', tab: 'story', parent: 'story/smelt_iron', title: 'Suit Up', desc: 'Protect yourself with a piece of iron armor', icon: 'iron_chestplate', has: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'] },
  { id: 'story/lava_bucket', tab: 'story', parent: 'story/smelt_iron', title: 'Hot Stuff', desc: 'Fill a Bucket with lava', icon: 'lava_bucket', has: ['lava_bucket'] },
  { id: 'story/iron_tools', tab: 'story', parent: 'story/smelt_iron', title: "Isn't It Iron Pick", desc: 'Upgrade your Pickaxe', icon: 'iron_pickaxe', has: ['iron_pickaxe'] },
  { id: 'story/deflect_arrow', tab: 'story', parent: 'story/obtain_armor', title: 'Not Today, Thank You', desc: 'Deflect a projectile with a Shield', icon: 'shield', on: 'deflect' },
  { id: 'story/form_obsidian', tab: 'story', parent: 'story/lava_bucket', title: 'Ice Bucket Challenge', desc: 'Obtain a block of Obsidian', icon: 'obsidian', has: ['obsidian'] },
  { id: 'story/mine_diamond', tab: 'story', parent: 'story/iron_tools', title: 'Diamonds!', desc: 'Acquire diamonds', icon: 'diamond', has: ['diamond'] },
  { id: 'story/enter_the_nether', tab: 'story', parent: 'story/form_obsidian', title: 'We Need to Go Deeper', desc: 'Build, light and enter a Nether Portal', icon: 'flint_and_steel', scan: (c) => c.dim === 'nether' },
  { id: 'story/shiny_gear', tab: 'story', parent: 'story/mine_diamond', title: 'Cover Me with Diamonds', desc: 'Diamond armor saves lives', icon: 'diamond_chestplate', has: ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'] },
  { id: 'story/enchant_item', tab: 'story', parent: 'story/mine_diamond', title: 'Enchanter', desc: 'Enchant an item at an Enchanting Table', icon: 'enchanted_book', on: 'enchant' },
  { id: 'story/cure_zombie_villager', tab: 'story', parent: 'story/enter_the_nether', title: 'Zombie Doctor', desc: 'Weaken and then cure a Zombie Villager', icon: 'golden_apple', frame: 'goal', on: 'cure' },
  { id: 'story/follow_ender_eye', tab: 'story', parent: 'story/enter_the_nether', title: 'Eye Spy', desc: 'Follow an Eye of Ender', icon: 'ender_eye', scan: (c) => c.structures.has('stronghold') },
  { id: 'story/enter_the_end', tab: 'story', parent: 'story/follow_ender_eye', title: 'The End?', desc: 'Enter the End Portal', icon: 'end_stone', scan: (c) => c.dim === 'end' },
  // ------------------------------------------------------------------ Nether
  { id: 'nether/root', tab: 'nether', title: 'Nether', desc: 'Bring summer clothes', icon: 'red_nether_bricks', scan: (c) => c.dim === 'nether' },
  { id: 'nether/return_to_sender', tab: 'nether', parent: 'nether/root', title: 'Return to Sender', desc: 'Destroy a Ghast with a fireball', icon: 'fire_charge', frame: 'challenge', on: 'kill', when: (a) => a.type === 'Ghast' && a.source === 'explosion' },
  { id: 'nether/find_bastion', tab: 'nether', parent: 'nether/root', title: 'Those Were the Days', desc: 'Enter a Bastion Remnant', icon: 'polished_blackstone_bricks', scan: (c) => c.structures.has('bastion_remnant') },
  { id: 'nether/obtain_ancient_debris', tab: 'nether', parent: 'nether/root', title: 'Hidden in the Depths', desc: 'Obtain Ancient Debris', icon: 'ancient_debris', has: ['ancient_debris'] },
  { id: 'nether/find_fortress', tab: 'nether', parent: 'nether/root', title: 'A Terrible Fortress', desc: 'Break your way into a Nether Fortress', icon: 'nether_bricks', scan: (c) => c.structures.has('fortress') },
  { id: 'nether/obtain_crying_obsidian', tab: 'nether', parent: 'nether/root', title: 'Who is Cutting Onions?', desc: 'Obtain Crying Obsidian', icon: 'crying_obsidian', has: ['crying_obsidian'] },
  { id: 'nether/ride_strider', tab: 'nether', parent: 'nether/root', title: 'This Boat Has Legs', desc: 'Ride a Strider with a Warped Fungus on a Stick', icon: 'warped_fungus_on_a_stick', scan: (c) => c.riding === 'Strider' },
  { id: 'nether/loot_bastion', tab: 'nether', parent: 'nether/find_bastion', title: 'War Pigs', desc: 'Loot a chest in a Bastion Remnant', icon: 'chest', scan: (c) => c.structures.has('bastion_remnant') && c.screen === 'ChestScreen' },
  { id: 'nether/netherite_armor', tab: 'nether', parent: 'nether/obtain_ancient_debris', title: 'Cover Me in Debris', desc: 'Get a full suit of Netherite armor', icon: 'netherite_chestplate', frame: 'challenge', scan: (c) => armorOf(c, 'netherite') === 4 },
  { id: 'nether/use_lodestone', tab: 'nether', parent: 'nether/obtain_ancient_debris', title: 'Country Lode, Take Me Home', desc: 'Use a compass on a Lodestone', icon: 'lodestone', on: 'lodestone' },
  { id: 'nether/charge_respawn_anchor', tab: 'nether', parent: 'nether/obtain_crying_obsidian', title: 'Not Quite "Nine" Lives', desc: 'Charge a Respawn Anchor to the maximum', icon: 'respawn_anchor', on: 'anchor', when: (a) => (a.charges as number) >= 4 },
  { id: 'nether/explore_nether', tab: 'nether', parent: 'nether/ride_strider', title: 'Hot Tourist Destinations', desc: 'Explore all Nether biomes', icon: 'netherite_boots', frame: 'challenge', every: () => NETHER_BIOMES, key: (c) => ((c as ScanCtx).dim === 'nether' ? (c as ScanCtx).biome : null) },
  { id: 'nether/get_wither_skull', tab: 'nether', parent: 'nether/find_fortress', title: 'Spooky Scary Skeleton', desc: 'Obtain a Wither Skeleton\'s skull', icon: 'wither_skeleton_skull', has: ['wither_skeleton_skull'] },
  { id: 'nether/obtain_blaze_rod', tab: 'nether', parent: 'nether/find_fortress', title: 'Into Fire', desc: 'Relieve a Blaze of its rod', icon: 'blaze_rod', has: ['blaze_rod'] },
  { id: 'nether/summon_wither', tab: 'nether', parent: 'nether/get_wither_skull', title: 'Withering Heights', desc: 'Summon the Wither', icon: 'nether_star', on: 'wither' },
  { id: 'nether/brew_potion', tab: 'nether', parent: 'nether/obtain_blaze_rod', title: 'Local Brewery', desc: 'Brew a potion', icon: 'potion_awkward', on: 'brew' },
  { id: 'nether/create_beacon', tab: 'nether', parent: 'nether/summon_wither', title: 'Bring Home the Beacon', desc: 'Construct and place a Beacon', icon: 'beacon', on: 'beacon' },
  { id: 'nether/create_full_beacon', tab: 'nether', parent: 'nether/create_beacon', title: 'Beaconator', desc: 'Bring a beacon to full power', icon: 'beacon', frame: 'goal', on: 'beacon', when: (a) => (a.levels as number) >= 4 },
  // ------------------------------------------------------------------ The End
  { id: 'end/root', tab: 'end', title: 'The End', desc: 'Or the beginning?', icon: 'end_stone', scan: (c) => c.dim === 'end' },
  { id: 'end/kill_dragon', tab: 'end', parent: 'end/root', title: 'Free the End', desc: 'Good luck', icon: 'dragon_head', on: 'dragon' },
  { id: 'end/dragon_egg', tab: 'end', parent: 'end/kill_dragon', title: 'The Next Generation', desc: 'Hold the Dragon Egg', icon: 'dragon_egg', frame: 'goal', has: ['dragon_egg'] },
  { id: 'end/enter_end_gateway', tab: 'end', parent: 'end/kill_dragon', title: 'Remote Getaway', desc: 'Escape the island', icon: 'ender_pearl', on: 'gateway' },
  { id: 'end/respawn_dragon', tab: 'end', parent: 'end/kill_dragon', title: 'The End... Again...', desc: 'Respawn the Ender Dragon', icon: 'end_crystal', frame: 'goal', on: 'dragon_respawn' },
  { id: 'end/dragon_breath', tab: 'end', parent: 'end/kill_dragon', title: 'You Need a Mint', desc: "Collect Dragon's Breath in a Glass Bottle", icon: 'dragon_breath', frame: 'goal', has: ['dragon_breath'] },
  { id: 'end/find_end_city', tab: 'end', parent: 'end/enter_end_gateway', title: 'The City at the End of the Game', desc: 'Go on in, what could happen?', icon: 'purpur_block', scan: (c) => c.structures.has('end_city') },
  { id: 'end/elytra', tab: 'end', parent: 'end/find_end_city', title: "Sky's the Limit", desc: 'Find Elytra', icon: 'elytra', frame: 'goal', has: ['elytra'] },
  { id: 'end/levitate', tab: 'end', parent: 'end/find_end_city', title: 'Great View From Up Here', desc: 'Levitate up 50 blocks from the attacks of a Shulker', icon: 'shulker_shell', frame: 'challenge', scan: (c) => c.levitated >= 50 },
  // ------------------------------------------------------------------ Adventure
  { id: 'adventure/root', tab: 'adventure', title: 'Adventure', desc: 'Adventure, exploration and combat', icon: 'map', on: 'kill' },
  { id: 'adventure/voluntary_exile', tab: 'adventure', parent: 'adventure/root', title: 'Voluntary Exile', desc: 'Kill a raid captain. Maybe consider staying away from villages for the time being...', icon: 'ominous_banner', on: 'kill', when: (a) => !!a.captain },
  { id: 'adventure/kill_a_mob', tab: 'adventure', parent: 'adventure/root', title: 'Monster Hunter', desc: 'Kill any hostile monster', icon: 'iron_sword', on: 'kill', when: (a) => isHostile(a.type as string) },
  { id: 'adventure/trade', tab: 'adventure', parent: 'adventure/root', title: 'What a Deal!', desc: 'Successfully trade with a Villager', icon: 'emerald', on: 'trade' },
  { id: 'adventure/ol_betsy', tab: 'adventure', parent: 'adventure/root', title: "Ol' Betsy", desc: 'Shoot a Crossbow', icon: 'crossbow', on: 'crossbow' },
  { id: 'adventure/sleep_in_bed', tab: 'adventure', parent: 'adventure/root', title: 'Sweet Dreams', desc: 'Sleep in a bed to change your respawn point', icon: 'red_bed', scan: (c) => c.sleeping },
  { id: 'adventure/throw_trident', tab: 'adventure', parent: 'adventure/kill_a_mob', title: 'A Throwaway Joke', desc: 'Throw a trident at something. Note: Throwing away your only weapon is not a good idea.', icon: 'trident', on: 'trident' },
  { id: 'adventure/shoot_arrow', tab: 'adventure', parent: 'adventure/kill_a_mob', title: 'Take Aim', desc: 'Shoot something with an arrow', icon: 'bow', on: 'arrow_hit' },
  { id: 'adventure/kill_all_mobs', tab: 'adventure', parent: 'adventure/kill_a_mob', title: 'Monsters Hunted', desc: 'Kill one of every hostile monster', icon: 'diamond_sword', frame: 'challenge', every: () => HOSTILES.filter((h) => h !== 'Ender Dragon' && h !== 'Wither' && h !== 'Elder Guardian' && h !== 'Piglin Brute' && h !== 'Zoglin'), key: (a) => ((a as Record<string, unknown>).kill as string | undefined) ?? null },
  { id: 'adventure/totem_of_undying', tab: 'adventure', parent: 'adventure/kill_a_mob', title: 'Postmortal', desc: 'Use a Totem of Undying to cheat death', icon: 'totem_of_undying', frame: 'goal', on: 'totem' },
  { id: 'adventure/summon_iron_golem', tab: 'adventure', parent: 'adventure/trade', title: 'Hired Help', desc: 'Summon an Iron Golem to help defend a village', icon: 'carved_pumpkin', frame: 'goal', on: 'golem' },
  { id: 'adventure/whos_the_pillager_now', tab: 'adventure', parent: 'adventure/ol_betsy', title: "Who's the Pillager Now?", desc: 'Give a Pillager a taste of their own medicine', icon: 'crossbow', on: 'kill', when: (a) => a.type === 'Pillager' && a.weapon === 'crossbow' },
  { id: 'adventure/hero_of_the_village', tab: 'adventure', parent: 'adventure/voluntary_exile', title: 'Hero of the Village', desc: 'Successfully defend a village from a raid', icon: 'ominous_banner', frame: 'challenge', scan: (c) => c.effects.has('hero_of_the_village') },
  { id: 'adventure/sniper_duel', tab: 'adventure', parent: 'adventure/shoot_arrow', title: 'Sniper Duel', desc: 'Kill a Skeleton from at least 50 meters away', icon: 'arrow', frame: 'challenge', on: 'kill', when: (a) => a.type === 'Skeleton' && (a.distance as number) >= 50 },
  { id: 'adventure/adventuring_time', tab: 'adventure', parent: 'adventure/sleep_in_bed', title: 'Adventuring Time', desc: 'Discover every biome', icon: 'diamond_boots', frame: 'challenge', every: () => OVERWORLD_BIOMES, key: (c) => ((c as ScanCtx).dim === 'overworld' ? (c as ScanCtx).biome : null) },
  // ------------------------------------------------------------------ Husbandry
  { id: 'husbandry/root', tab: 'husbandry', title: 'Husbandry', desc: 'The world is full of friends and food', icon: 'hay_block', on: 'eat' },
  { id: 'husbandry/safely_harvest_honey', tab: 'husbandry', parent: 'husbandry/root', title: 'Bee Our Guest', desc: 'Use a Campfire to collect Honey from a Beehive using a Bottle without aggravating the bees', icon: 'honey_bottle', on: 'honey', when: (a) => !!a.smoked },
  { id: 'husbandry/breed_an_animal', tab: 'husbandry', parent: 'husbandry/root', title: 'The Parrots and the Bats', desc: 'Breed two animals together', icon: 'wheat', on: 'breed' },
  { id: 'husbandry/tame_an_animal', tab: 'husbandry', parent: 'husbandry/root', title: 'Best Friends Forever', desc: 'Tame an animal', icon: 'lead', on: 'tame' },
  { id: 'husbandry/fishy_business', tab: 'husbandry', parent: 'husbandry/root', title: 'Fishy Business', desc: 'Catch a fish', icon: 'fishing_rod', on: 'fish', when: (a) => ['cod', 'salmon', 'tropical_fish', 'pufferfish', 'raw_fish', 'raw_salmon', 'clownfish'].includes(a.item as string) },
  { id: 'husbandry/silk_touch_nest', tab: 'husbandry', parent: 'husbandry/root', title: 'Total Beelocation', desc: 'Move a Bee Nest, with 3 bees inside, using Silk Touch', icon: 'bee_nest', on: 'silk_nest' },
  { id: 'husbandry/plant_seed', tab: 'husbandry', parent: 'husbandry/root', title: 'A Seedy Place', desc: 'Plant a seed and watch it grow', icon: 'wheat_seeds', on: 'plant' },
  { id: 'husbandry/bred_all_animals', tab: 'husbandry', parent: 'husbandry/breed_an_animal', title: 'Two by Two', desc: 'Breed all the animals!', icon: 'golden_carrot', frame: 'challenge', every: () => BREEDABLE, key: (a) => ((a as Record<string, unknown>).bred as string | undefined) ?? null },
  { id: 'husbandry/tactical_fishing', tab: 'husbandry', parent: 'husbandry/fishy_business', title: 'Tactical Fishing', desc: 'Catch a fish... without a fishing rod!', icon: 'pufferfish_bucket', on: 'bucket_fish' },
  { id: 'husbandry/balanced_diet', tab: 'husbandry', parent: 'husbandry/plant_seed', title: 'A Balanced Diet', desc: 'Eat everything that is edible, even if it\'s not good for you', icon: 'apple', frame: 'challenge', every: () => FOODS, key: (a) => ((a as Record<string, unknown>).ate as string | undefined) ?? null },
  { id: 'husbandry/obtain_netherite_hoe', tab: 'husbandry', parent: 'husbandry/plant_seed', title: 'Serious Dedication', desc: 'Use a Netherite Ingot to upgrade a Hoe, and then reevaluate your life choices', icon: 'netherite_hoe', frame: 'challenge', has: ['netherite_hoe'] },
];
export const ADV_BY_ID = new Map(ADVANCEMENTS.map((a) => [a.id, a]));
export const TABS: [AdvTab, string, string][] = [['story', 'Minecraft', 'grass_block'], ['nether', 'Nether', 'red_nether_bricks'], ['end', 'The End', 'end_stone'], ['adventure', 'Adventure', 'map'], ['husbandry', 'Husbandry', 'hay_block']];

/** Tree layout of a tab: x by depth, y by order among the leaves (in 28 x 26 cells). */
export function layout(tab: AdvTab): Map<string, [number, number]> {
  const list = ADVANCEMENTS.filter((a) => a.tab === tab);
  const kids = new Map<string, Adv[]>();
  for (const a of list) if (a.parent) { const k = kids.get(a.parent) ?? []; k.push(a); kids.set(a.parent, k); }
  const pos = new Map<string, [number, number]>();
  let row = 0;
  const place = (a: Adv, depth: number): number => {
    const ch = kids.get(a.id) ?? [];
    if (!ch.length) { pos.set(a.id, [depth, row]); return row++; }
    const ys = ch.map((c) => place(c, depth + 1));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(a.id, [depth, y]);
    return y;
  };
  for (const a of list) if (!a.parent) place(a, 0);
  return pos;
}

/** Report an event to every player within `r` blocks of `e` (breeding, taming, golems, the wither...). */
export function advanceNear(g: { players?: { entity: Entity; achievements: { event(ev: string, arg?: Record<string, unknown>): void } }[] }, e: { x: number; y: number; z: number }, ev: string, arg: Record<string, unknown> = {}, r = 16) {
  for (const sp of g.players ?? []) if ((sp.entity.x - e.x) ** 2 + (sp.entity.y - e.y) ** 2 + (sp.entity.z - e.z) ** 2 <= r * r) sp.achievements.event(ev, arg);
}
