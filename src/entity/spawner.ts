// Natural mob spawning (hostiles in the dark, animals on grass) and dungeon spawners.
import type { Game } from '../game/game';
import { B, BLOCKS, OPAQUE, idOf } from '../world/blocks';
import { Mob } from './mobs';
import type { Player } from '../game/player';
import { Random } from '../noise';
import { skyDarken } from '../game/env';
import { BIOME } from '../world/biomes';

export class Spawner {
  private rng = new Random(Date.now() & 0xffff);
  private spawnedChunks = new Set<string>();

  constructor(private game: Game) {}

  /** A player to spawn around (each attempt picks one, so everybody gets mobs). */
  private pick(): Player {
    const ps = this.game.playerEntities();
    return ps[this.rng.int(ps.length)];
  }
  /** Distance to the nearest player. */
  private nearest(x: number, y: number, z: number) {
    let d = Infinity;
    for (const p of this.game.playerEntities()) d = Math.min(d, Math.hypot(x - p.x, y - p.y, z - p.z));
    return d;
  }

  tick() {
    const g = this.game, w = g.world!;
    const players = g.playerEntities().length;
    if (!players) return;
    const mobs = g.entities.filter((e) => e instanceof Mob && !e.dead) as Mob[];
    const hostiles = mobs.filter((m) => m.hostile).length;
    const animals = mobs.length - hostiles;
    const peaceful = g.options.difficulty === 0;
    if (peaceful) for (const m of mobs) if (m.hostile && m.typeName !== 'Zombified Piglin' && !m.persistentHostile) m.removed = true;
    // hostile spawning every tick (cap ~ 70 in vanilla for 17x17 chunks; scaled to our view)
    const cap = Math.round(70 * Math.min(1, ((Math.min(8, w.renderDistance) * 2 + 1) ** 2) / 289) * Math.min(players, 4));
    if ((!peaceful || w.dimension === 'nether') && hostiles < cap && g.ticks % 2 === 0) {
      for (let attempt = 0; attempt < (w.dimension === 'nether' ? 1 : 3) * Math.min(players, 4); attempt++) this.tryHostile();
    }
    // passive animals: when new chunks come in, occasionally populate them
    if (g.ticks % 20 === 0 && animals < 40 * Math.min(players, 4) && w.dimension === 'overworld') this.populateChunks();
    for (const p of g.playerEntities()) this.spawnerBlocks(p);
    if (w.dimension === 'overworld' && g.ticks % 40 === 0) this.ambient(mobs);
  }

  /** Squid in deep water, bats in dark caves. */
  private ambient(mobs: Mob[]) {
    const g = this.game, p = this.pick(), w = g.world!;
    const squid = mobs.filter((m) => m.typeName === 'Squid').length;
    const bats = mobs.filter((m) => m.typeName === 'Bat').length;
    for (let i = 0; i < 4; i++) {
      const a = this.rng.next() * Math.PI * 2, d = 20 + this.rng.next() * 40;
      const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (!w.chunkAt(x, z)) continue;
      if (squid < 8 && this.rng.int(2) === 0) {
        const y = 45 + this.rng.int(17);
        if (w.getId(x, y, z) === B.WATER && w.getId(x, y + 1, z) === B.WATER && w.getId(x, y - 1, z) === B.WATER) g.interact!.spawnMob('squid', x + 0.5, y, z + 0.5);
      } else if (bats < 6) {
        const y = 10 + this.rng.int(50);
        if (w.getId(x, y, z) !== B.AIR || w.getId(x, y + 1, z) !== B.AIR) continue;
        const [sky, blk] = w.getLight(x, y, z);
        if (sky === 0 && blk < 4 && OPAQUE[w.getId(x, y - 1, z)]) g.interact!.spawnMob('bat', x + 0.5, y, z + 0.5);
      }
    }
  }

  private spawnable(x: number, y: number, z: number, h: number): boolean {
    const w = this.game.world!;
    const below = w.getId(x, y - 1, z);
    if ((!OPAQUE[below] && below !== B.SOUL_SAND) || below === B.BEDROCK || below === B.GLASS) return false;
    for (let i = 0; i < h; i++) {
      const id = w.getId(x, y + i, z);
      if (BLOCKS[id].solid || BLOCKS[id].fluid) return false;
    }
    return true;
  }

  /** Nether spawning by biome (vanilla 1.16 weights), fortress floors, and striders on the lava sea. */
  private tryNether() {
    const g = this.game, p = this.pick(), w = g.world!;
    const a = this.rng.next() * Math.PI * 2, d = 24 + this.rng.next() * 50;
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!w.chunkAt(x, z)) return;
    const biome = g.biomeAt(x, z).id;
    // striders walk the lava sea in all the Nether's biomes
    if (this.rng.int(6) === 0) {
      const sy = 31;
      if (w.getId(x, sy, z) === B.LAVA && w.getId(x, sy + 1, z) === B.AIR && w.getId(x, sy + 2, z) === B.AIR) {
        if (g.entities.filter((e) => (e as { typeName?: string }).typeName === 'Strider').length < 8) g.interact!.spawnMob('strider', x + 0.5, sy + 1, z + 0.5);
      }
      return;
    }
    const y = 32 + this.rng.int(90);
    // fortress floors: blazes, wither skeletons and the rest of the fortress crowd
    if (this.spawnable(x, y, z, 2) && w.getId(x, y - 1, z) === B.NETHER_BRICKS) {
      const type = this.weighted([['blaze', 10], ['zombie_pigman', 5], ['wither_skeleton', 8], ['skeleton', 2], ['magma_cube', 3]]);
      if (type !== 'wither_skeleton' || this.spawnable(x, y, z, 3)) g.interact!.spawnMob(type, x + 0.5, y, z + 0.5);
      return;
    }
    const table: [string, number, number][] = biome === BIOME.CRIMSON_FOREST ? [['hoglin', 9, 4], ['zombie_pigman', 1, 4], ['piglin', 5, 4]]
      : biome === BIOME.WARPED_FOREST ? [['enderman', 1, 4]]
      : biome === BIOME.SOUL_SAND_VALLEY ? [['skeleton', 20, 5], ['ghast', 50, 1], ['enderman', 1, 4]]
      : biome === BIOME.BASALT_DELTAS ? [['magma_cube', 100, 5], ['ghast', 40, 1]]
      : [['zombie_pigman', 100, 4], ['ghast', 50, 1], ['magma_cube', 2, 4], ['enderman', 1, 4], ['piglin', 15, 4]];
    const type = this.weighted(table.map(([t, wgt]) => [t, wgt]));
    const max = table.find((t) => t[0] === type)![2];
    if (type === 'ghast') {
      // ghasts need a big open space
      for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 4; dy++) for (let dz = -2; dz <= 2; dz++) if (w.getId(x + dx, y + dy, z + dz) !== B.AIR) return;
      g.interact!.spawnMob('ghast', x + 0.5, y, z + 0.5);
      return;
    }
    if (!this.spawnable(x, y, z, type === 'enderman' ? 3 : 2)) return;
    const n = 1 + this.rng.int(max);
    for (let i = 0; i < n; i++) {
      const xx = x + this.rng.int(5) - 2, zz = z + this.rng.int(5) - 2;
      if (this.spawnable(xx, y, zz, type === 'enderman' ? 3 : 2)) g.interact!.spawnMob(type, xx + 0.5, y, zz + 0.5);
    }
  }
  private weighted(list: [string, number][]): string {
    let total = 0;
    for (const [, w] of list) total += w;
    let k = this.rng.next() * total;
    for (const [t, w] of list) { k -= w; if (k < 0) return t; }
    return list[0][0];
  }

  /** The End: endermen wander the islands in small groups (and nothing else spawns). */
  private tryEnd() {
    const g = this.game, p = this.pick(), w = g.world!;
    if (g.entities.filter((e) => (e as { typeName?: string }).typeName === 'Enderman' && !(e as { dead?: boolean }).dead).length >= 12) return;
    const a = this.rng.next() * Math.PI * 2, d = 24 + this.rng.next() * 40;
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!w.chunkAt(x, z)) return;
    const y = w.topSolidY(x, z) + 1;
    if (y < 2 || w.getId(x, y - 1, z) !== B.END_STONE || !this.spawnable(x, y, z, 3)) return;
    const n = 1 + this.rng.int(3);
    for (let i = 0; i < n; i++) {
      const xx = x + this.rng.int(5) - 2, zz = z + this.rng.int(5) - 2;
      if (w.getId(xx, y - 1, zz) === B.END_STONE && this.spawnable(xx, y, zz, 3)) g.interact!.spawnMob('enderman', xx + 0.5, y, zz + 0.5);
    }
  }

  private tryHostile() {
    const g = this.game, p = this.pick(), w = g.world!;
    if (w.dimension === 'nether') { this.tryNether(); return; }
    if (w.dimension === 'end') { this.tryEnd(); return; }
    const a = this.rng.next() * Math.PI * 2, d = 24 + this.rng.next() * 56;
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!w.chunkAt(x, z)) return;
    const top = w.topSolidY(x, z);
    const y = this.rng.int(top + 2) + 1;
    if (!this.spawnable(x, y, z, 2)) return;
    const [sky, blk] = w.getLight(x, y, z);
    const eff = Math.max(sky - skyDarken(g.time, g.weather?.rain ?? 0), blk);
    if (eff > this.rng.int(8)) return;
    if (this.nearest(x + 0.5, y, z + 0.5) < 24) return;
    const r = this.rng.int(100);
    let type = r < 28 ? 'zombie' : r < 50 ? 'skeleton' : r < 70 ? 'creeper' : r < 88 ? 'spider' : r < 95 ? 'enderman' : 'slime';
    // slimes only in "slime chunks" deep underground or in swamps
    if (type === 'slime') {
      const slimeChunk = ((Math.imul(x >> 4, 0x4c1906) + Math.imul(z >> 4, 0x5ac0db) + (g.meta?.seed ?? 0)) >>> 0) % 10 === 0;
      if (!((slimeChunk && y < 40) || g.biomeAt(x, z).name === 'Swamp')) type = 'zombie';
    }
    if (type === 'enderman' && (!this.spawnable(x, y + 2, z, 1))) return;
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
    const g = this.game, p = this.pick(), w = g.world!;
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
      const wolfy = biome.id === BIOME.TAIGA || biome.id === BIOME.SNOWY_TAIGA || biome.id === BIOME.FOREST;
      const types = wolfy && this.rng.int(3) === 0 ? ['wolf'] : biome.cold ? ['sheep', 'sheep', 'pig', 'chicken'] : ['pig', 'cow', 'sheep', 'sheep', 'chicken', 'cow'];
      let type = types[this.rng.int(types.length)];
      let count = 2 + this.rng.int(3);
      // herds of horses (now and then with a donkey) roam the plains and savanna, sharing a coat colour
      const horsey = biome.id === BIOME.PLAINS || biome.id === BIOME.SAVANNA;
      let herd = -1;
      if (horsey && this.rng.int(biome.id === BIOME.PLAINS ? 3 : 5) === 0) { type = 'horse'; count = 2 + this.rng.int(5); herd = this.rng.int(7); }
      for (let i = 0; i < count; i++) {
        const x = x0 + this.rng.int(7) - 3, z = z0 + this.rng.int(7) - 3;
        const y = w.topSolidY(x, z) + 1;
        if (y <= 0 || w.getId(x, y - 1, z) !== B.GRASS) continue;
        if (!this.spawnable(x, y, z, 2)) continue;
        if (this.nearest(x, y, z) < 16) continue;
        const m = g.interact!.spawnMob(herd >= 0 && this.rng.int(10) === 0 ? 'donkey' : type, x + 0.5, y, z + 0.5);
        if (m && herd >= 0 && (m as unknown as { kind: string }).kind === 'horse') (m as unknown as { color: number }).color = herd;
      }
    }
  }

  private spawnerBlocks(p: Player) {
    const g = this.game, w = g.world!;
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
