import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Entity } from './entity';
import { Zombie, Skeleton, Creeper, Spider, Pig, Cow, Sheep, Chicken, ZombiePigman, Ghast, Villager, Enderman, Slime, Squid, Bat, Wolf, Blaze, Silverfish } from './mobs';
import { ItemEntity } from './item';
import { Boat } from './boat';
import { Minecart } from './minecart';
import { Horse, Donkey, Mule } from './horse';
import { EnderDragon, EndCrystal } from './dragon';

type Ctor = new (w: World, g: Game) => Entity;
export const MOB_TYPES: Record<string, Ctor> = {
  zombie: Zombie, skeleton: Skeleton, creeper: Creeper, spider: Spider, pig: Pig, cow: Cow, sheep: Sheep, chicken: Chicken,
  zombie_pigman: ZombiePigman, 'zombie pigman': ZombiePigman, ghast: Ghast, villager: Villager, enderman: Enderman, slime: Slime, squid: Squid, bat: Bat, wolf: Wolf, blaze: Blaze,
  silverfish: Silverfish, ender_dragon: EnderDragon, end_crystal: EndCrystal, horse: Horse, donkey: Donkey, mule: Mule,
};

export function createEntity(type: string, world: World, game: Game): Entity | null {
  if (type === 'item') return new ItemEntity(world, game, { id: 1, count: 1 });
  if (type === 'boat') return new Boat(world, game);
  if (type === 'minecart') return new Minecart(world, game);
  const C = MOB_TYPES[type];
  return C ? new C(world, game) : null;
}
