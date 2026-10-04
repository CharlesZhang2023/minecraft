// The target dummy (Spell Lab's damage dummy): a straw training dummy that takes any amount of punishment and
// shows the damage per second it's taking. Sneak and hit it to pack it up again.
import type { ModContext, RenderContext, Entity } from '../sdk';

/** Hits each dummy took recently (kept off the entity so they aren't sent over the network every tick). */
const log = new WeakMap<object, { t: number; a: number }[]>();

/** The dummy itself (page realm, main entrypoint). Returns a test for "is this a dummy". */
export function registerDummy(mod: ModContext, dropItem: () => number): (e: unknown) => boolean {
  if (mod.realm !== 'page') return () => false;
  const { Mob } = mod.mc;
  class TargetDummy extends Mob {
    typeName = 'wands:dummy';
    /** What the HUD shows: damage per second over the current burst, its total, the best second. */
    dps = 0;
    total = 0;
    peak = 0;
    constructor(world: ConstructorParameters<typeof Mob>[0], game: ConstructorParameters<typeof Mob>[1]) {
      super(world, game);
      this.width = 0.7;
      this.height = 1.9;
      this.maxHealth = this.health = 1000;
      this.speedAttr = 0;
      this.xp = 0;
    }
    ai() {}
    override eyeHeight() { return 1.6; }
    override knockback() {}
    override drops() { return []; }
    override damage(amount: number, source: Parameters<InstanceType<typeof Mob>['damage']>[1], attacker?: Entity | null): boolean {
      if (source === 'kill' || source === 'void') return super.damage(amount, source, attacker);
      this.health = this.maxHealth;
      const ok = super.damage(amount, source, attacker);
      this.health = this.maxHealth;
      this.dead = false;
      if (ok && this.world.role === 'server') {
        let l = log.get(this);
        if (!l) log.set(this, (l = []));
        l.push({ t: this.age, a: amount });
      }
      return ok;
    }
    override tick() {
      this.vx = 0; this.vz = 0;
      super.tick();
      this.health = this.maxHealth;
      if (this.world.role !== 'server' || this.age % 5) return;
      const l = log.get(this) ?? [];
      // a burst ends three seconds after the last hit; its numbers stay up a while longer
      while (l.length && this.age - l[l.length - 1].t > 60 && this.age - l[0].t > 200) l.shift();
      if (!l.length) { if (this.total) { this.total = this.dps = this.peak = 0; } return; }
      const last = l[l.length - 1].t;
      if (this.age - last > 60) return;
      let start = l[0].t;
      for (let i = l.length - 1; i > 0; i--) if (l[i].t - l[i - 1].t > 60) { start = l[i].t; break; }
      const inBurst = l.filter((h) => h.t >= start);
      const sum = inBurst.reduce((n, h) => n + h.a, 0);
      const secs = Math.max(1, (this.age - start) / 20);
      const second = inBurst.filter((h) => this.age - h.t < 20).reduce((n, h) => n + h.a, 0);
      this.total = Math.round(sum * 100) / 100;
      this.dps = Math.round((sum / secs) * 100) / 100;
      this.peak = Math.max(this.peak, Math.round(second * 100) / 100);
    }
  }
  mod.entity('dummy', TargetDummy);

  // sneak-hit: pack it up
  mod.on('attackEntity', ({ game, player, target }) => {
    if (!(target instanceof TargetDummy) || !player.sneaking) return 'pass';
    target.removed = true;
    if (!player.creative) game.dropItem(target.x, target.y + 0.5, target.z, mod.stack(dropItem()));
    game.audio.play('dig.grass', { x: target.x, y: target.y + 1, z: target.z }, 1, 0.8);
    return 'success';
  });

  return (e: unknown) => e instanceof TargetDummy;
}

/** How it looks (client entrypoint). */
export function dummyRenderer(mod: ModContext) {
  // a straw dummy on a post, wobbling when it's hit
  mod.client.entityRenderer('dummy', (r: RenderContext, e) => {
    const d = e as unknown as { lerpX(t: number): number; lerpY(t: number): number; lerpZ(t: number): number; bodyYaw: number; hurtTime: number };
    const t = r.partial, M = mod.mc.math, m = M.mat4();
    const x = d.lerpX(t), y = d.lerpY(t), z = d.lerpZ(t);
    const straw = r.tex('wands:straw'), sack = r.tex('wands:burlap'), face = r.tex('wands:dummy_face'), post = r.tex('wands:post');
    const S6 = (i: number) => [i, i, i, i, i, i];
    const parts = [
      { x0: 3, y0: 0, z0: 3, x1: 13, y1: 1, z1: 13, tex: S6(post) },
      { x0: 7, y0: 1, z0: 7, x1: 9, y1: 14, z1: 9, tex: S6(post) },
      { x0: -2, y0: 18, z0: 7, x1: 18, y1: 20, z1: 9, tex: S6(post) },
      { x0: 3.5, y0: 12, z0: 5, x1: 12.5, y1: 24, z1: 11, tex: [sack, sack, straw, straw, sack, sack] },
      { x0: 4.5, y0: 24, z0: 5.5, x1: 11.5, y1: 30.5, z1: 10.5, tex: [sack, sack, straw, straw, sack, face] },
    ];
    M.identity(m);
    M.translate(m, m, 0.5, 0, 0.5);
    M.rotateY(m, m, (-d.bodyYaw * Math.PI) / 180);
    if (d.hurtTime > 0) M.rotateX(m, m, Math.sin((d.hurtTime - t) * 1.6) * 0.18 * ((d.hurtTime - t) / 10));
    M.translate(m, m, -0.5, 0, -0.5);
    r.boxes(parts, x - 0.5, y, z - 0.5, m, undefined, d.hurtTime > 0 ? 0xffb0b0 : 0xffffff);
  });
}
