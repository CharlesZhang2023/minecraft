// Renders item icons (isometric blocks, flat sprites) to canvases, cached per GUI scale.
import { getItem } from '../game/items';
import { BLOCKS, B, TEXTURES, Render, isLeaves, isStairs, isSlab, pack } from '../world/blocks';
import { getTexture } from '../render/textures';
import { getItemSprite } from '../render/itemsprites';
import { modelBoxes, Box } from '../world/models';
import { Img } from '../render/pixels';

const GRASS_TINT = 0x7cbd6b;
const FOLIAGE_TINT = 0x48b518;
const texCanvasCache = new Map<string, HTMLCanvasElement>();

function imgToCanvas(img: Img, tint?: number, maskedOnly = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = img.length / 64;
  const ctx = c.getContext('2d')!;
  const d = ctx.createImageData(16, c.height);
  for (let i = 0; i < img.length; i += 4) {
    let r = img[i], g = img[i + 1], b = img[i + 2];
    const a = img[i + 3];
    if (tint !== undefined && (!maskedOnly || (a > 0 && a < 255))) {
      r = (r * ((tint >> 16) & 255)) / 255;
      g = (g * ((tint >> 8) & 255)) / 255;
      b = (b * (tint & 255)) / 255;
    }
    d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b;
    d.data[i + 3] = maskedOnly && a > 0 ? 255 : a;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

function layerCanvas(layer: number, tint?: number, masked = false): HTMLCanvasElement {
  const key = layer + ':' + tint + ':' + masked;
  let c = texCanvasCache.get(key);
  if (!c) {
    c = imgToCanvas(getTexture(TEXTURES[layer]), tint, masked);
    texCanvasCache.set(key, c);
  }
  return c;
}

function tintOf(id: number): number | undefined {
  const d = BLOCKS[id];
  if (d.tint === 'grass') return GRASS_TINT;
  if (d.tint === 'foliage') return FOLIAGE_TINT;
  if (d.tint === 'spruce') return 0x619961;
  if (d.tint === 'birch') return 0x80a755;
  return undefined;
}

export class IconCache {
  private cache = new Map<number, HTMLCanvasElement>();
  size = 32;

  setScale(guiScale: number) {
    const s = Math.max(16, 16 * guiScale);
    if (s !== this.size) {
      this.size = s;
      this.cache.clear();
    }
  }

  get(id: number): HTMLCanvasElement {
    let c = this.cache.get(id);
    if (!c) {
      c = this.render(id);
      this.cache.set(id, c);
    }
    return c;
  }

  private render(id: number): HTMLCanvasElement {
    const S = this.size;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const it = getItem(id);
    if (it.sprite || it.flatBlock || !it.block) {
      let src: HTMLCanvasElement | null = null;
      if (it.sprite) {
        const img = getItemSprite(it.sprite);
        if (img) src = imgToCanvas(img);
      }
      if (!src && it.block) {
        const def = BLOCKS[it.block];
        const layer = def.faces[0];
        src = layerCanvas(layer, def.tint !== 'none' ? tintOf(def.id) : undefined);
      }
      if (src) ctx.drawImage(src, 0, 0, S, S);
      return c;
    }
    this.drawBlock(ctx, it.block, S / 64);
    return c;
  }

  /** Isometric block render. Coordinates designed on a 64px canvas. */
  private drawBlock(ctx: CanvasRenderingContext2D, id: number, k: number) {
    const def = BLOCKS[id];
    let boxes: Box[];
    if (def.render === Render.Model || isStairs(id) || isSlab(id)) {
      let meta = 0;
      if (isStairs(id)) meta = 3; // face the viewer's right
      if (id === B.CHEST) meta = 2;
      boxes = modelBoxes(pack(id, meta));
      if (id === B.OAK_FENCE || id === B.NETHER_BRICK_FENCE) boxes = [
        { x0: 2, y0: 0, z0: 6, x1: 6, y1: 16, z1: 10, tex: def.faces.slice(0, 6) },
        { x0: 10, y0: 0, z0: 6, x1: 14, y1: 16, z1: 10, tex: def.faces.slice(0, 6) },
        { x0: 6, y0: 12, z0: 7, x1: 10, y1: 15, z1: 9, tex: def.faces.slice(0, 6) },
        { x0: 6, y0: 6, z0: 7, x1: 10, y1: 9, z1: 9, tex: def.faces.slice(0, 6) },
      ];
    } else {
      const faces = def.faces.slice(0, 6);
      if (def.faces.length > 6) faces[5] = def.faces[6]; // show the front face toward the viewer
      boxes = [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 16, z1: 16, tex: faces }];
    }
    boxes.sort((a, b) => a.x1 + a.z1 - (b.x1 + b.z1) || a.y0 - b.y0);
    const tint = tintOf(id);
    const leaves = isLeaves(id);
    for (const b of boxes) {
      const top = b.tex[3], south = b.tex[5], east = b.tex[1];
      const isGrass = id === B.GRASS;
      // top
      this.face(ctx, k, layerCanvas(top, isGrass || leaves || tint !== undefined ? tint : undefined), [1.75, 0.875, -1.75, 0.875, 32, 4 + (16 - b.y1) * 1.875], b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0, 1.0);
      // south (left)
      this.face(ctx, k, layerCanvas(south, isGrass ? tint : leaves ? tint : undefined, isGrass), [1.75, 0.875, 0, 1.875, 32 - b.z1 * 1.75, 4 + b.z1 * 0.875], b.x0, 16 - b.y1, b.x1 - b.x0, b.y1 - b.y0, 0.8);
      // east (right)
      this.face(ctx, k, layerCanvas(east, isGrass ? tint : leaves ? tint : undefined, isGrass), [1.75, -0.875, 0, 1.875, 32 + (b.x1 - 16) * 1.75, 4 + (b.x1 + 16) * 0.875], 16 - b.z1, 16 - b.y1, b.z1 - b.z0, b.y1 - b.y0, 0.6);
    }
  }

  private face(ctx: CanvasRenderingContext2D, k: number, src: HTMLCanvasElement, m: number[], sx: number, sy: number, sw: number, sh: number, shade: number) {
    if (sw <= 0 || sh <= 0) return;
    ctx.save();
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    // slight overdraw hides seams between faces
    ctx.drawImage(src, sx, sy, sw, sh, sx - 0.02, sy - 0.02, sw + 0.04, sh + 0.04);
    if (shade < 1) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
      ctx.fillRect(sx - 0.02, sy - 0.02, sw + 0.04, sh + 0.04);
    }
    ctx.restore();
  }
}
