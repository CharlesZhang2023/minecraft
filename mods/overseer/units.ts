// The unit entity: one mob type for every kind of unit (its `kind` picks the looks and numbers from defs.ts).
// Every own field here is copied to players' puppets, so only what drawing and the HUD need lives on it; the
// server's orders and plans are kept off it, in ai.ts.
import type { ModContext, Entity, World, Game, ItemStack } from '../sdk';
import { UNITS, type UnitDef } from './defs';

/** What the server's AI plugs in (the class itself only knows how to look and count). */
export const hooks = {
  think: (_u: UnitEntity) => {},
  damaged: (_u: UnitEntity, _attacker: Entity | null) => {},
  friendly: (_u: UnitEntity, _attacker: Entity | null): boolean => false,
  died: (_u: UnitEntity, _attacker: Entity | null) => {},
  save: (_u: UnitEntity): Record<string, unknown> => ({}),
  load: (_u: UnitEntity, _d: Record<string, unknown>) => {},
};

/** The parts of a unit other files use (the class is built in the page only). */
export interface UnitEntity extends Entity {
  kind: string;
  owner: string;
  team: number;
  task: string;
  carry: number;
  carryRes: string;
  health: number;
  maxHealth: number;
  dead: boolean;
  yaw: number;
  pitch: number;
  heldItem: number;
  swell: number;
  swellDir: number;
  lookTarget: { x: number; y: number; z: number } | null;
  path: { x: number; y: number; z: number }[] | null;
  forward: number;
  strafe: number;
  jumping: boolean;
  aiSpeed: number;
  onGround: boolean;
  collidedH: boolean;
  inWater: boolean;
  attackCooldown: number;
  def(): UnitDef;
  setKind(kind: string, fresh?: boolean): void;
  setPathTo(x: number, y: number, z: number, speed: number): boolean;
  moveToward(x: number, z: number, speed: number): void;
  canSee(e: Entity): boolean;
  swing(): void;
  eyeHeight(): number;
  damage(amount: number, source: string, attacker?: Entity | null): boolean;
  heal(n: number): void;
  distanceTo(e: Entity): number;
}

export const isUnit = (e: unknown): e is UnitEntity => !!e && (e as { typeName?: string }).typeName === 'overseer:unit';

export function defineUnit(mod: ModContext) {
  const { Mob, itemByName } = mod.mc;
  const itemId = (name?: string | null) => (name ? itemByName(name)?.id ?? 0 : 0);

  class Unit extends Mob implements UnitEntity {
    typeName = 'overseer:unit';
    kind = 'peasant';
    owner = '';
    /** Team colour (index into TEAMS), -1 for raiders. */
    team = 0;
    /** What it's doing, for the HUD ("Chopping wood"). */
    task = '';
    carry = 0;
    carryRes = '';
    look: string | undefined = undefined;
    slim = false;
    armsPose: string | undefined = undefined;
    armorItems: ({ id: number } | null)[] | undefined = undefined;
    swell = 0;
    swellDir = 0;

    constructor(world: World, game: Game) {
      super(world, game);
      this.persist = true;
      this.burnsInDay = false;
      this.setKind('peasant');
    }

    def(): UnitDef { return UNITS[this.kind] ?? UNITS.peasant; }

    /** Become a kind of unit (`fresh`: at full health, as when trained). */
    setKind(kind: string, fresh = true) {
      const d = UNITS[kind] ?? UNITS.peasant;
      this.kind = d.id;
      this.model = d.model;
      this.skin = d.skin ?? 'steve';
      this.look = d.look;
      this.slim = !!d.slim;
      this.armsPose = d.arms;
      this.heldItem = itemId(d.held);
      this.armorItems = d.armor ? d.armor.map((n) => (n ? { id: itemId(n) } : null)) : undefined;
      this.width = d.width;
      this.height = d.height;
      this.maxHealth = d.hp;
      if (fresh || this.health > d.hp || this.health <= 0) this.health = d.hp;
      this.speedAttr = d.speed;
      this.sayName = d.sounds?.say ?? '';
      this.hurtName = d.sounds?.hurt ?? 'hurt';
      this.deathName = d.sounds?.death ?? 'hurt';
      this.soundPitch = d.sounds?.pitch ?? 1;
      this.xp = 0;
      this.setPos(this.x, this.y, this.z);
    }

    override eyeHeight() { return this.def().eye; }
    override ai() { hooks.think(this); }
    override isOnLadder() { return this.kind === 'spider' ? this.collidedH : super.isOnLadder(); }
    override damage(amount: number, source: Parameters<InstanceType<typeof Mob>['damage']>[1], attacker?: Entity | null): boolean {
      if (hooks.friendly(this, attacker ?? null)) return false;
      // armour softens hits a little
      const armor = this.armorItems?.filter(Boolean).length ?? 0;
      return super.damage(armor ? amount * (1 - armor * 0.08) : amount, source, attacker);
    }
    override onDamaged(attacker: Entity | null) { hooks.damaged(this, attacker); }
    override die(source: Parameters<InstanceType<typeof Mob>['die']>[0], attacker: Entity | null) {
      super.die(source, attacker);
      hooks.died(this, attacker);
    }
    override drops(): ItemStack[] { return []; }
    override despawnCheck() {}
    override extraJSON() { return { kind: this.kind, owner: this.owner, team: this.team, carry: this.carry, carryRes: this.carryRes, ...hooks.save(this) }; }
    override loadExtra(d: Record<string, unknown>) {
      this.setKind(String(d.kind ?? 'peasant'), false);
      this.owner = String(d.owner ?? '');
      this.team = Number(d.team ?? 0) | 0;
      this.carry = Math.max(0, Number(d.carry ?? 0) || 0);
      this.carryRes = String(d.carryRes ?? '');
      hooks.load(this, d);
    }
  }
  mod.entity('unit', Unit);
  return Unit;
}
