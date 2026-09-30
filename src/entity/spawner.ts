// Natural mob spawning (hostiles in the dark, animals on grass) and dungeon spawners.
import type { Game } from '../game/game';
import { B, BLOCKS, OPAQUE, idOf } from '../world/blocks';
import { Mob } from './mobs';
import { Random } from '../noise';
import { skyDarken } from '../game/env';
import { BIOME } from '../world/biomes';

export class Spawner {
  private rng = new Random(Date.now() & 0xffff);
  private spawnedChunks = new Set<string>();

  constructor(private game: Game) {}

  tick() {
    const g = this.game, p = g.player!, w = g.world!;
    if (!p) return;
    const mobs = g.entities.filter((e) => e instanceof Mob && !e.dead) as Mob[];
    const hostiles = mobs.filter((m) => m.hostile).length;
    const animals = mobs.length - hostiles;
    const peaceful = g.options.difficulty === 0;
    if (peaceful) for (const m of mobs) if (m.hostile) m.removed = true;
    // hostile spawning every tick (cap ~ 70 in vanilla for 17x17 chunks; scaled to our view)
    const cap = Math.round(70 * Math.min(1, ((w.renderDistance * 2 + 1) ** 2) / 289));
    if (!peaceful && hostiles < cap && g.ticks % 2 === 0) {
      for (let attempt = 0; attempt < 3; attempt++) this.tryHostile();
    }
    // passive animals: when new chunks come in, occasionally populate them
    if (g.ticks % 20 === 0 && animals < 40) this.populateChunks();
    this.spawnerBlocks();
  }

  private spawnable(x: number, y: number, z: number, h: number): boolean {
    const w = this.game.world!;
    const below = w.getId(x, y - 1, z);
    if (!OPAQUE[below] || below === B.BEDROCK || below === B.GLASS) return false;
    for (let i = 0; i < h; i++) {
      const id = w.getId(x, y + i, z);
      if (BLOCKS[id].solid || BLOCKS[id].fluid) return false;
    }
    return true;
  }

  private tryHostile() {
    const g = this.game, p = g.player!, w = g.world!;
    const a = this.rng.next() * Math.PI * 2, d = 24 + this.rng.next() * 56;
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!w.chunkAt(x, z)) return;
    const top = w.topSolidY(x, z);
    const y = this.rng.int(top + 2) + 1;
    if (!this.spawnable(x, y, z, 2)) return;
    const [sky, blk] = w.getLight(x, y, z);
    const eff = Math.max(sky - skyDarken(g.time, g.weather?.rain ?? 0), blk);
    if (eff > this.rng.int(8)) return;
    const dist = Math.hypot(x + 0.5 - p.x, y - p.y, z + 0.5 - p.z);
    if (dist < 24) return;
    const r = this.rng.int(100);
    const type = r < 30 ? 'zombie' : r < 55 ? 'skeleton' : r < 78 ? 'creeper' : 'spider';
    if (type === 'spider' && !this.spawnable(x + 1, y, z, 1)) return;
    const m = g.interact!.spawnMob(type, x + 0.5, y, z + 0.5);
    if (m) (m as Mob).yaw = this.rng.next() * 360;
    // small groups
    if (m && this.rng.int(3) === 0) {
      for (let i = 0; i < 2; i++) {
        const xx = x + this.rng.int(5) - 2, zz = z + this.rng.int(5) - 2;
        if (this.spawnable(xx, y, zz, 2)) {
          const [s2, b2] = w.getLight(xx, y, zz);
          if (Math.max(s2 - skyDarken(g.time), b2) <= 7) g.interact!.spawnMob(type, xx + 0.5, y, zz + 0.5);
        }
      }
    }
  }

  private populateChunks() {
    const g = this.game, p = g.player!, w = g.world!;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    const R = Math.min(6, w.renderDistance);
    for (let n = 0; n < 4; n++) {
      const cx = pcx + this.rng.int(R * 2 + 1) - R, cz = pcz + this.rng.int(R * 2 + 1) - R;
      const key = cx + ',' + cz;
      if (this.spawnedChunks.has(key)) continue;
      const c = w.getChunk(cx, cz);
      if (!c || !c.ready || !c.light) continue;
      this.spawnedChunks.add(key);
      if (w.savedKeys.has(key)) continue; // previously visited
      if (this.rng.int(10) >= 1) continue; // ~10% of new chunks get an animal group
      const x0 = cx * 16 + this.rng.int(16), z0 = cz * 16 + this.rng.int(16);
      const biome = g.biomeAt(x0, z0);
      if (biome.id === BIOME.DESERT || biome.id === BIOME.OCEAN || biome.id === BIOME.BEACH || biome.id === BIOME.RIVER) continue;
      const types = biome.cold ? ['sheep', 'sheep', 'pig', 'chicken'] : ['pig', 'cow', 'sheep', 'sheep', 'chicken', 'cow'];
      const type = types[this.rng.int(types.length)];
      const count = 2 + this.rng.int(3);
      for (let i = 0; i < count; i++) {
        const x = x0 + this.rng.int(7) - 3, z = z0 + this.rng.int(7) - 3;
        const y = w.topSolidY(x, z) + 1;
        if (y <= 0 || w.getId(x, y - 1, z) !== B.GRASS) continue;
        if (!this.spawnable(x, y, z, 2)) continue;
        if (Math.hypot(x - p.x, z - p.z) < 16) continue;
        g.interact!.spawnMob(type, x + 0.5, y, z + 0.5);
      }
    }
  }

  private spawnerBlocks() {
    const g = this.game, p = g.player!, w = g.world!;
    if (g.ticks % 20 !== 0) return;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    // look for spawner tiles in nearby chunks
    for (let cx = (px >> 4) - 1; cx <= (px >> 4) + 1; cx++)
      for (let cz = (pz >> 4) - 1; cz <= (pz >> 4) + 1; cz++) {
        const c = w.getChunk(cx, cz);
        if (!c || !c.ready) continue;
        for (const [i, t] of c.tiles) {
          if ((t.type as string) !== 'spawner') continue;
          const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = i >> 8;
          if (idOf(c.blocks[i]) !== B.SPAWNER) continue;
          if (Math.hypot(x - px, y - py, z - pz) > 16) continue;
          for (let k = 0; k < 3; k++) g.particles?.smoke(x + this.rng.next(), y + this.rng.next(), z + this.rng.next());
          for (let k = 0; k < 2; k++) g.particles?.flame(x + this.rng.next(), y + this.rng.next(), z + this.rng.next());
          const tt = t as unknown as { delay: number; mob: string };
          tt.delay -= 20;
          if (tt.delay > 0) continue;
          tt.delay = 200 + this.rng.int(600);
          const nearby = g.entities.filter((e) => e instanceof Mob && Math.abs(e.x - x) < 9 && Math.abs(e.z - z) < 9).length;
          if (nearby >= 6) continue;
          for (let k = 0; k < 4; k++) {
            const sx = x + this.rng.int(9) - 4, sz = z + this.rng.int(9) - 4, sy = y + this.rng.int(3) - 1;
            if (this.spawnable(sx, sy, sz, 2)) {
              const m = g.interact!.spawnMob(tt.mob, sx + 0.5, sy, sz + 0.5);
              if (m) for (let q = 0; q < 10; q++) g.particles?.smoke(sx + this.rng.next(), sy + this.rng.next() * 2, sz + this.rng.next(), true);
            }
          }
        }
      }
  }
}
