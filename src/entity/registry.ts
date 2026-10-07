import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Entity } from './entity';
import { Zombie, Skeleton, Creeper, Spider, Pig, Cow, Sheep, Chicken, ZombiePigman, Ghast, Villager, Enderman, Slime, Squid, Bat, Wolf, Blaze, Silverfish } from './mobs';
import { ItemEntity } from './item';
import { Boat } from './boat';
import { Minecart } from './minecart';
import { Horse, Donkey, Mule } from './horse';
import { EnderDragon, EndCrystal } from './dragon';
import { ENTITIES } from '../mod/hooks';
import { SubLevel } from '../sublevel/ship';
import { isActive } from '../mod/state';
import { Piglin, PiglinBrute, Hoglin, Zoglin, Strider, MagmaCube, WitherSkeleton } from './nethermobs';
import { ItemFrame, Painting } from './hanging';
import { Shulker, ShulkerBullet, Endermite } from './endmobs';
import { Husk, Drowned, Stray, ZombieVillager, CaveSpider, Witch, Pillager, Vindicator, Evoker, EvokerFangs, Vex, Ravager, Guardian, ElderGuardian, Phantom, IronGolem, SnowGolem } from './overworldmobs';

type Ctor = new (w: World, g: Game) => Entity;
export const MOB_TYPES: Record<string, Ctor> = {
  zombie: Zombie, skeleton: Skeleton, creeper: Creeper, spider: Spider, pig: Pig, cow: Cow, sheep: Sheep, chicken: Chicken,
  zombie_pigman: ZombiePigman, 'zombie pigman': ZombiePigman, ghast: Ghast, villager: Villager, enderman: Enderman, slime: Slime, squid: Squid, bat: Bat, wolf: Wolf, blaze: Blaze,
  silverfish: Silverfish, ender_dragon: EnderDragon, end_crystal: EndCrystal, horse: Horse, donkey: Donkey, mule: Mule,
  // 1.16 (zombified piglins are the old zombie pigmen, under both names)
  zombified_piglin: ZombiePigman, 'zombified piglin': ZombiePigman, piglin: Piglin, piglin_brute: PiglinBrute, hoglin: Hoglin, zoglin: Zoglin, strider: Strider,
  magma_cube: MagmaCube, 'magma cube': MagmaCube, wither_skeleton: WitherSkeleton,
  item_frame: ItemFrame, painting: Painting,
  shulker: Shulker, shulker_bullet: ShulkerBullet as unknown as Ctor, endermite: Endermite,
  // the overworld mobs of 1.4-1.16 (Mob-based ones save under their lower-cased name, so those are aliases)
  husk: Husk, drowned: Drowned, stray: Stray, zombie_villager: ZombieVillager, 'zombie villager': ZombieVillager, cave_spider: CaveSpider, 'cave spider': CaveSpider,
  witch: Witch, pillager: Pillager, vindicator: Vindicator, evoker: Evoker, evoker_fangs: EvokerFangs as unknown as Ctor, vex: Vex, ravager: Ravager,
  guardian: Guardian, elder_guardian: ElderGuardian, 'elder guardian': ElderGuardian, phantom: Phantom,
  iron_golem: IronGolem, snow_golem: SnowGolem,
};

export function createEntity(type: string, world: World, game: Game): Entity | null {
  if (type === 'item') return new ItemEntity(world, game, { id: 1, count: 1 });
  if (type === 'boat') return new Boat(world, game);
  if (type === 'minecart') return new Minecart(world, game);
  if (type === 'sublevel') return new SubLevel(world, game);
  const C = MOB_TYPES[type];
  if (C) return new C(world, game);
  // mod entities ('mod:name')
  const m = ENTITIES.get(type);
  if (!m || !isActive(m.mod)) return null;
  const e = m.make(world, game);
  m.ctor ??= e.constructor;
  return e;
}
