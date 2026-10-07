// Rideable boat with the modern (1.9+) handling: W/S row forward and back, A/D turn the boat, it floats at a
// steady waterline and glides on ice.
import { Entity } from './entity';
import type { World } from '../world/world';
import type { Game } from '../game/game';
import { B, BLOCKS, idOf, metaOf } from '../world/blocks';
import { I, I2, ItemStack, BOATS } from '../game/items';
import type { Player } from '../game/player';
import { carryRider, dismountSpot, turnRider, type Mount } from './mount';

type Status = 'water' | 'under' | 'underFlowing' | 'land' | 'air';

/** Feet of a seated rider, relative to the boat. */
export const BOAT_SEAT = -0.45;

export class Boat extends Entity implements Mount {
  /** Its wood (oak, spruce, birch, jungle, acacia, dark oak): the planks it's drawn and dropped as. */
  wood = 'oak';
  typeName = 'Boat';
  persist = true;
  rider: Player | null = null;
  lookLimit = 105;
  bodyFollows = true;
  damageTaken = 0;
  hurtTime = 0;
  hurtDir = 1;
  /** Turn speed in degrees per tick (eases out like the boat's speed). */
  turn = 0;
  /** Oar strokes: [left, right] angle and their previous-tick values for interpolation. */
  paddle = [0, 0];
  pPaddle = [0, 0];
  private status: Status = 'air';
  private waterLevel = 0;
  private glide = 0;
  constructor(world: World, public game: Game) {
    super(world);
    this.width = 1.375;
    this.height = 0.5625;
    this.stepHeight = 0;
  }

  /** Surface height of the water in a block (a full block when there's more water on top). */
  private surface(x: number, y: number, z: number): number {
    const v = this.world.get(x, y, z);
    if (idOf(v) !== B.WATER) return -Infinity;
    if (idOf(this.world.get(x, y + 1, z)) === B.WATER) return y + 1;
    let l = metaOf(v);
    if (l >= 8) l = 0;
    return y + 1 - (l + 1) / 9;
  }

  private findStatus(): Status {
    const b = this.box;
    const x0 = Math.floor(b.x0), x1 = Math.ceil(b.x1), z0 = Math.floor(b.z0), z1 = Math.ceil(b.z1);
    // the whole hull under water?
    const top = Math.floor(b.y1 + 0.001);
    let under = false, flowing = false;
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++)
        if (b.y1 + 0.001 < this.surface(x, top, z)) {
          under = true;
          if ((metaOf(this.world.get(x, top, z)) & 7) !== 0) flowing = true;
        }
    if (under) return flowing ? 'underFlowing' : 'under';
    // floating: the bottom is in water
    const yb = Math.floor(b.y0);
    let level = -Infinity;
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) level = Math.max(level, this.surface(x, yb, z));
    if (b.y0 < level) { this.waterLevel = level; return 'water'; }
    // on the ground: average slipperiness under the hull (ice boats are fast)
    const yg = Math.floor(b.y0 - 0.001);
    let sum = 0, n = 0;
    for (let x = x0; x < x1; x++)
      for (let z = z0; z < z1; z++) {
        const id = this.world.getId(x, yg, z);
        if (!BLOCKS[id].solid) continue;
        sum += BLOCKS[id].slipperiness; n++;
      }
    if (n && b.y0 - (yg + 1) < 0.01) { this.glide = sum / n; return 'land'; }
    return 'air';
  }

  override tick() {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damageTaken > 0) this.damageTaken--;
    const prev = this.status;
    this.status = this.findStatus();
    let gravity = -0.04, lift = 0, momentum = 0.05;
    if (prev === 'air' && this.status === 'water') {
      // landing on water from above: settle at the waterline instead of plunging in
      this.y = this.waterLevel - this.height * 0.65;
      this.vy = 0;
    }
    switch (this.status) {
      case 'water': lift = (this.waterLevel - this.y) / this.height; momentum = 0.9; break;
      case 'underFlowing': gravity = -7e-4; momentum = 0.9; break;
      case 'under': lift = 0.01; momentum = 0.45; break;
      case 'air': momentum = 0.9; break;
      case 'land': momentum = this.glide; break;
    }
    this.vx *= momentum; this.vz *= momentum;
    this.turn *= momentum;
    this.vy += gravity;
    if (lift > 0) { this.vy += lift * 0.06153846; this.vy *= 0.75; }

    // rowing
    this.pPaddle = [...this.paddle];
    const r = this.rider;
    let speed = 0, rowL = false, rowR = false;
    if (r) {
      const f = r.forward, s = r.strafe; // strafe: left is positive
      this.turn -= s / 0.98;
      if (Math.abs(s) > 0.1 && Math.abs(f) < 0.1) speed += 0.005;
      if (f > 0) speed += 0.04 * Math.min(1, f / 0.98);
      else if (f < 0) speed -= 0.005;
      rowL = f > 0.1 || s < -0.1 || f < -0.1;
      rowR = f > 0.1 || s > 0.1 || f < -0.1;
    }
    this.yaw += this.turn;
    const a = (this.yaw * Math.PI) / 180;
    this.vx += -Math.sin(a) * speed;
    this.vz += Math.cos(a) * speed;
    const back = r && r.forward < -0.1 ? -1 : 1;
    if (rowL) this.paddle[0] += 0.3926991 * back; else this.paddle[0] += (Math.round(this.paddle[0] / Math.PI) * Math.PI - this.paddle[0]) * 0.2;
    if (rowR) this.paddle[1] += 0.3926991 * back; else this.paddle[1] += (Math.round(this.paddle[1] / Math.PI) * Math.PI - this.paddle[1]) * 0.2;

    this.move(this.vx, this.vy, this.vz);
    if (this.status === 'water' || this.status === 'under' || this.status === 'underFlowing') this.fallDistance = 0;

    if (r) {
      turnRider(this, r, this.turn, this.lookLimit);
      carryRider(this, r, BOAT_SEAT);
    }
    // spray from the bow at speed
    const sp = Math.hypot(this.vx, this.vz);
    if (this.status === 'water' && sp > 0.2 && this.game.particles && Math.random() < sp) {
      const fx = this.x - Math.sin(a) * 0.9, fz = this.z + Math.cos(a) * 0.9;
      this.game.particles.splash(fx + (Math.random() - 0.5) * 0.8, this.waterLevel, fz + (Math.random() - 0.5) * 0.8);
    }
    if (this.y < -64) this.removed = true;
  }

  /** Falling more than three blocks onto land smashes the boat into planks and sticks. */
  override onLand(fall: number) {
    if (fall <= 3 || this.status === 'water' || this.removed) return;
    const rider = this.rider as { creative?: boolean } | null;
    this.dismount();
    this.removed = true;
    if (rider?.creative) return;
    this.game.dropItem(this.x, this.y + 0.5, this.z, { id: B.OAK_PLANKS, count: 3 } as ItemStack);
    this.game.dropItem(this.x, this.y + 0.5, this.z, { id: I.STICK, count: 2 } as ItemStack);
  }

  useLabel(p: Player) { return this.rider || p.sneaking || p.riding ? null : 'Board'; }
  interact(game: Game): boolean {
    const p = game.player!;
    if (this.rider || p.sneaking || p.riding) return false;
    this.rider = p;
    p.riding = this;
    p.sprinting = false;
    carryRider(this, p, BOAT_SEAT);
    return true;
  }

  dismount() {
    const r = this.rider;
    if (!r) return;
    r.riding = null;
    this.rider = null;
    const [x, y, z] = dismountSpot(this, r);
    r.setPos(x, y, z);
  }

  attacked(creative: boolean) {
    this.hurtTime = 10;
    this.hurtDir = -this.hurtDir;
    this.damageTaken += 10;
    if (creative || this.damageTaken > 40) this.breakBoat(!creative);
  }

  private breakBoat(drop: boolean) {
    this.dismount();
    this.removed = true;
    if (drop) this.game.dropItem(this.x, this.y + 0.5, this.z, { id: this.wood === 'oak' ? I2.BOAT : BOATS[this.wood] ?? I2.BOAT, count: 1 } as ItemStack);
    this.game.playBlockSound(B.OAK_PLANKS, Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), 'break');
  }

  /** Height of the hidden "no water" plane inside the hull (stops the water surface showing in the boat). */
  get maskY() { return 0.42; }

  toJSON() {
    return { type: 'boat', x: this.x, y: this.y, z: this.z, yaw: this.yaw, wood: this.wood };
  }
  load(d: { x: number; y: number; z: number; yaw: number; wood?: string }) {
    this.wood = d.wood ?? 'oak';
    this.setPos(d.x, d.y, d.z);
    this.yaw = this.pyaw = d.yaw;
  }
}
