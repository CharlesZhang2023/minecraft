import type { World } from '../world/world';
import type { Game } from '../game/game';
import type { Entity } from './entity';
import { Zombie, Skeleton, Creeper, Spider, Pig, Cow, Sheep, Chicken, ZombiePigman, Ghast, Villager } from './mobs';
import { ItemEntity } from './item';
import { Boat } from './boat';

type Ctor = new (w: World, g: Game) => Entity;
export const MOB_TYPES: Record<string, Ctor> = {
  zombie: Zombie, skeleton: Skeleton, creeper: Creeper, spider: Spider, pig: Pig, cow: Cow, sheep: Sheep, chicken: Chicken,
  zombie_pigman: ZombiePigman, 'zombie pigman': ZombiePigman, ghast: Ghast, villager: Villager,
};

export function createEntity(type: string, world: World, game: Game): Entity | null {
  if (type === 'item') return new ItemEntity(world, game, { id: 1, count: 1 });
  if (type === 'boat') return new Boat(world, game);
  const C = MOB_TYPES[type];
  return C ? new C(world, game) : null;
}
