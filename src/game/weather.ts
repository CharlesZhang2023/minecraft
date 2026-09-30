import type { Game } from './game';
import { Random } from '../noise';
import { tex, B, OPAQUE, isLeaves } from '../world/blocks';
import { BIOME } from '../world/biomes';
import { Img, newImg, set } from '../render/pixels';

export const WEATHER_TEX = { rain: tex('weather_rain'), snow: tex('weather_snow') };

export function rainTexture(): Img {
  const img = newImg();
  const r = new Random(5);
  for (let k = 0; k < 7; k++) {
    const x = r.int(16), y0 = r.int(16), len = 3 + r.int(4);
    for (let i = 0; i < len; i++) set(img, x, (y0 + i) % 16, [150, 170, 230], 170 + r.int(60));
  }
  return img;
}
export function snowTexture(): Img {
  const img = newImg();
  const r = new Random(6);
  for (let k = 0; k < 10; k++) {
    const x = r.int(15), y = r.int(15);
    set(img, x, y, [255, 255, 255], 240);
    if (r.bool()) set(img, x + 1, y, [240, 240, 255], 200);
  }
  return img;
}

export class Weather {
  raining = false;
  thundering = false;
  rainTime = 12000 + Math.floor(Math.random() * 168000);
  thunderTime = 12000 + Math.floor(Math.random() * 168000);
  rain = 0;
  thunder = 0;
  flash = 0;
  private rng = new Random(Date.now() & 0xffff);

  constructor(private game: Game) {}

  setWeather(kind: 'clear' | 'rain' | 'thunder', duration = 6000) {
    this.raining = kind !== 'clear';
    this.thundering = kind === 'thunder';
    this.rainTime = duration;
    this.thunderTime = duration;
  }

  tick() {
    if (--this.rainTime <= 0) {
      this.raining = !this.raining;
      this.rainTime = this.raining ? 12000 + this.rng.int(12000) : 12000 + this.rng.int(168000);
    }
    if (--this.thunderTime <= 0) {
      this.thundering = !this.thundering;
      this.thunderTime = this.thundering ? 3600 + this.rng.int(12000) : 12000 + this.rng.int(168000);
    }
    this.rain += (this.raining ? 0.01 : -0.01);
    this.rain = Math.max(0, Math.min(1, this.rain));
    this.thunder += (this.thundering && this.raining ? 0.01 : -0.01);
    this.thunder = Math.max(0, Math.min(1, this.thunder));
    if (this.flash > 0) this.flash--;
    const g = this.game, p = g.player!;
    if (this.thunder > 0.9 && this.rng.int(3000) === 0) {
      this.flash = 4;
      const d = 30 + this.rng.next() * 120;
      setTimeout(() => g.audio.play('thunder', null, Math.max(0.2, 1 - d / 200) * 1.5, 0.8 + this.rng.next() * 0.2), d * 3);
    }
    if (this.rain <= 0) return;
    // splash particles & sound
    const w = g.world!;
    const n = Math.floor(this.rain * this.rain * 60);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(p.x) + this.rng.int(21) - 10, z = Math.floor(p.z) + this.rng.int(21) - 10;
      const top = w.topSolidY(x, z);
      if (top < 0 || Math.abs(top - p.y) > 10 || this.isCold(x, z) || !this.canRainIn(x, z)) continue;
      g.particles!.rain(x + this.rng.next(), top + 1.05, z + this.rng.next());
    }
    // snow accumulates / water freezes in cold biomes
    if (this.rng.int(4) === 0) {
      const x = Math.floor(p.x) + this.rng.int(64) - 32, z = Math.floor(p.z) + this.rng.int(64) - 32;
      if (this.isCold(x, z)) {
        const y = w.topSolidY(x, z);
        const id = w.getId(x, y, z);
        if (id === B.WATER && w.meta(x, y, z) === 0) w.set(x, y, z, B.ICE);
        else if ((OPAQUE[id] || isLeaves(id)) && w.getId(x, y + 1, z) === B.AIR && w.getLight(x, y + 1, z)[1] < 10) w.set(x, y + 1, z, B.SNOW);
      }
    }
  }

  isCold(x: number, z: number) {
    const b = this.game.biomeAt(x, z);
    return b.cold || this.game.world!.topSolidY(x, z) > 150;
  }
  canRainIn(x: number, z: number) {
    const b = this.game.biomeAt(x, z);
    return b.id !== BIOME.DESERT && b.id !== BIOME.SAVANNA;
  }
  rainAt(x: number, y: number, z: number) {
    if (this.rain <= 0) return false;
    const fx = Math.floor(x), fz = Math.floor(z);
    if (!this.canRainIn(fx, fz)) return false;
    return this.game.world!.topSolidY(fx, fz) < y;
  }

  render(t: number) {
    if (this.rain <= 0) return;
    const g = this.game, r = g.renderer, cam = g.cam, w = g.world!;
    const m = r.dyn;
    m.reset();
    const R = 10;
    const cx = Math.floor(cam.x), cz = Math.floor(cam.z);
    const time = g.ticks + t;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx, z = cz + dz;
        if (dx * dx + dz * dz > R * R) continue;
        if (!this.canRainIn(x, z)) continue;
        const top = w.topSolidY(x, z) + 1;
        const y0 = Math.max(top, Math.floor(cam.y) - R), y1 = Math.max(top, Math.floor(cam.y) + R);
        if (y1 <= y0) continue;
        const snow = this.isCold(x, z);
        const layer = snow ? WEATHER_TEX.snow : WEATHER_TEX.rain;
        const h = ((x * 3121 + z * 45238971) >>> 0) % 32;
        const speed = snow ? 0.02 : 0.55;
        const vo = -((time + h) * speed) % 1 * (snow ? 1 : 4);
        const uo = snow ? Math.sin((time + h) * 0.02) * 0.2 : 0;
        const [sky, blk] = w.getLight(x, top, z);
        const a = this.rain * (1 - Math.hypot(dx, dz) / R) * (snow ? 1 : 0.8);
        const px = x + 0.5 - cam.x, pz = z + 0.5 - cam.z;
        // quad facing the camera around the column axis
        const ang = Math.atan2(pz, px) + Math.PI / 2;
        const ox = Math.cos(ang) * 0.5, oz = Math.sin(ang) * 0.5;
        const vy0 = (y0 / 4) * (snow ? 0.5 : 1) + vo, vy1 = (y1 / 4) * (snow ? 0.5 : 1) + vo;
        m.v(px - ox, y0 - cam.y, pz - oz, uo, vy1, layer, 0xffffff, a, sky, blk);
        m.v(px + ox, y0 - cam.y, pz + oz, 1 + uo, vy1, layer, 0xffffff, a, sky, blk);
        m.v(px + ox, y1 - cam.y, pz + oz, 1 + uo, vy0, layer, 0xffffff, a, sky, blk);
        m.v(px - ox, y1 - cam.y, pz - oz, uo, vy0, layer, 0xffffff, a, sky, blk);
      }
    const gl = r.gl;
    gl.depthMask(false);
    r.drawDyn(m, { blend: true, cull: false, wrap: true });
    gl.depthMask(true);
    if (this.flash > 0) r.drawOverlay([1, 1, 1, 0.3 * this.flash / 4]);
  }
}
