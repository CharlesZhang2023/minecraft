// The End's mobs beyond endermen: shulkers (box-shelled guardians of End cities: they sit on a block face, peek
// out, fire homing bullets that make you float, hide in their shell to shrug off hits, and teleport away when
// hurt) and endermites.
import { GoalMob, swim, wander, meleeAttack, nearestTarget, aiRng } from './ai';
import { Entity } from './entity';
import { LivingEntity, DamageSource } from './living';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { Player } from '../game/player';
import { BLOCKS, OPAQUE } from '../world/blocks';
import { I7, ItemStack, stack } from '../game/items';

const rng = aiRng;

export class Shulker extends GoalMob {
  kind = 'shulker';
  typeName = 'Shulker';
  override model = 'shulker';
  override skin = 'shulker';
  override sayName = 'shulker.say';
  override hurtName = 'shulker.hurt';
  override deathName = 'shulker.death';
  override hostile = true;
  override persist = true;
  override persistentHostile = true;
  /** How far the lid is open (0 shut .. 1 wide), and where it's heading. */
  peek = 0;
  pPeek = 0;
  peekTarget = 0;
  private peekTimer = 0;
  private shootTimer = 20;
  /** Colour index into the dyes (-1: the purple End city kind). */
  color = -1;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 1; this.height = 1;
    this.maxHealth = this.health = 30;
    this.stepHeight = 0;
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Player, 16));
  }
  override eyeHeight() { return 0.5; }
  override preTick() { super.preTick(); this.pPeek = this.peek; }
  override tick() {
    // a shulker sits still in its block (snapped to the cell), shell and all
    this.vx = this.vz = 0;
    this.vy = 0;
    this.x = Math.floor(this.x) + 0.5; this.z = Math.floor(this.z) + 0.5;
    this.y = Math.floor(this.y + 0.01);
    this.px = this.x; this.pz = this.z; this.py = this.y;
    super.tick();
    if (this.dead) return;
    // fell off: whatever it sat on is gone
    if (!OPAQUE[this.world.getId(Math.floor(this.x), Math.floor(this.y) - 1, Math.floor(this.z))] && this.age % 20 === 0) this.teleport();
    this.peek += (this.peekTarget - this.peek) * 0.15;
  }
  override ai() {
    super.ai();
    const t = this.target;
    if (t && !t.dead && this.distanceTo(t) < 20) {
      this.peekTarget = 1;
      this.lookTarget = { x: t.x, y: t.y + t.eyeHeight(), z: t.z };
      if (--this.shootTimer <= 0) {
        this.shootTimer = 20 + rng.int(10) * 10;
        const b = new ShulkerBullet(this.world, this.game, this, t);
        b.setPos(this.x, this.y + 0.5, this.z);
        this.game.addEntity(b);
        this.game.audio.play('shulker.shoot', this, 2, (rng.next() - rng.next()) * 0.2 + 1);
      }
    } else if (--this.peekTimer <= 0) {
      // now and then it peeks out for a while on its own
      this.peekTimer = 40 + rng.int(80);
      this.peekTarget = rng.int(3) === 0 ? 0.3 + rng.next() * 0.3 : 0;
    }
  }
  /** Shut, its shell keeps most damage off (vanilla: 20 armour while closed). */
  override damage(amount: number, source: DamageSource, attacker?: Entity | null): boolean {
    if (this.peek < 0.1 && (source === 'arrow' || source === 'player' || source === 'mob')) {
      if (source === 'arrow') return false;
      amount *= 0.2;
    }
    const r = super.damage(amount, source, attacker);
    if (r && !this.dead && this.health < this.maxHealth / 2 && rng.int(4) === 0) this.teleport();
    return r;
  }
  /** Jump to another block face nearby (up to 8 blocks): a solid block with room above. */
  teleport() {
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(this.x) + rng.int(17) - 8, y = Math.floor(this.y) + rng.int(17) - 8, z = Math.floor(this.z) + rng.int(17) - 8;
      if (y < 1 || y > 250) continue;
      if (BLOCKS[this.world.getId(x, y, z)].solid || !OPAQUE[this.world.getId(x, y - 1, z)]) continue;
      if (this.game.entities.some((e) => e instanceof Shulker && e !== this && Math.floor(e.x) === x && Math.floor(e.y) === y && Math.floor(e.z) === z)) continue;
      this.game.audio.play('enderman.teleport', this, 1, 1);
      this.setPos(x + 0.5, y, z + 0.5);
      this.peek = this.peekTarget = 0;
      return;
    }
  }
  override drops(): ItemStack[] { return rng.next() < 0.5 ? [stack(I7.SHULKER_SHELL)] : []; }
  override despawnCheck() {}
  override extraJSON() { return { color: this.color }; }
  override loadExtra(d: Record<string, unknown>) { this.color = (d.color as number) ?? -1; }
}

/** A shulker bullet: drifts toward its target one axis at a time, steering as it goes; makes what it hits float. */
export class ShulkerBullet extends Entity {
  typeName = 'Shulker Bullet';
  persist = false;
  targetId = 0;
  private steps = 0;
  private dir = [0, 0, 0];
  constructor(world: World, public game: Game, public shooter: Entity | null, target?: LivingEntity) {
    super(world);
    this.width = this.height = 0.3125;
    if (target) this.targetId = target.id;
  }
  private target(): LivingEntity | null {
    const t = this.game.entities.find((e) => e.id === this.targetId);
    return t instanceof LivingEntity && !t.dead && !t.removed ? t : null;
  }
  override tick() {
    this.age++;
    if (this.age > 400) { this.removed = true; return; }
    const t = this.target();
    // pick a new axis step now and then (vanilla: moves in blocky straight lines, re-aimed every few steps)
    if (--this.steps <= 0 && t) {
      const dx = t.x - this.x, dy = t.y + t.height / 2 - this.y, dz = t.z - this.z;
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      this.dir = ax >= ay && ax >= az ? [Math.sign(dx), 0, 0] : ay >= az ? [0, Math.sign(dy), 0] : [0, 0, Math.sign(dz)];
      this.steps = 10 + rng.int(5);
    }
    const sp = 0.15;
    this.vx += (this.dir[0] * sp - this.vx) * 0.2;
    this.vy += (this.dir[1] * sp - this.vy) * 0.2;
    this.vz += (this.dir[2] * sp - this.vz) * 0.2;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    if (this.age % 2 === 0) this.game.particles?.add({ x: this.x, y: this.y, z: this.z, layer: 0, size: 0.05, life: 8, col: 0xffffff, gravity: 0, collide: false, kind: 'spark', fullbright: true } as never);
    // hits a block: pops
    if (OPAQUE[this.world.getId(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))]) { this.pop(); return; }
    // hits an entity: damage and levitation
    for (const e of this.game.entities) {
      if (e === this || e === this.shooter || e.removed || !(e instanceof LivingEntity) || e.dead) continue;
      if (Math.abs(e.x - this.x) < e.width / 2 + 0.2 && this.y > e.y - 0.2 && this.y < e.y + e.height + 0.2 && Math.abs(e.z - this.z) < e.width / 2 + 0.2) {
        if (e.damage(4, 'mob', this.shooter ?? this)) e.addEffect('levitation', 200, 0);
        this.pop();
        return;
      }
    }
  }
  pop() {
    this.removed = true;
    this.game.audio.play('shulker.bullet', this, 1, 1);
    for (let i = 0; i < 6; i++) this.game.particles?.smoke(this.x, this.y, this.z, true);
  }
  /** It can be shot or punched out of the air. */
  attacked() { this.pop(); }
}

export class Endermite extends GoalMob {
  kind = 'endermite';
  typeName = 'Endermite';
  override model = 'silverfish';
  override skin = 'endermite';
  override sayName = 'silverfish.say';
  override hurtName = 'silverfish.hit';
  override deathName = 'silverfish.kill';
  override hostile = true;
  override arthropod = true;
  /** Endermites crumble away after two minutes. */
  lifetime = 0;
  constructor(world: World, game: Game) {
    super(world, game);
    this.width = 0.4; this.height = 0.3;
    this.maxHealth = this.health = 8;
    this.attackDamage = 2;
    this.goals.push(swim(0), meleeAttack(1, 0.1), wander(6, 0.05));
    this.targetGoals.push(nearestTarget(1, (_m, e) => e instanceof Player, 16));
  }
  override eyeHeight() { return 0.13; }
  override tick() {
    super.tick();
    if (this.dead) return;
    if (++this.lifetime > 2400) this.removed = true;
    if (this.age % 4 === 0) this.game.particles?.add({ x: this.x, y: this.y + 0.1, z: this.z, vy: 0.02, layer: 0, size: 0.04, life: 15, col: 0xb040f0, gravity: 0, collide: false, kind: 'portal' } as never);
  }
}
