// Resource packs (Java Edition layout): their block, item and particle textures (with .mcmeta animations) and the
// sun and moon, matched to the game's textures by name. Packs listed first win.
//
// Not used from packs: block models and blockstates (the game's blocks have their own shapes), random texture
// variants, OptiFine's connected textures, mob/entity textures, sounds, GUI and fonts.
import { ZipArchive, decodeImage } from './zip';
import { blockPaths, itemPaths, particlePaths } from './names';
import { resize, type TexOverride } from '../render/overrides';
import type { Img } from '../render/pixels';
import type { PackPackage } from './types';

/** Vanilla's default water colour: modern packs' water is grey, tinted per biome. */
const WATER = [0x3f, 0x76, 0xe4];

interface Source { zip: ZipArchive; root: string }

export interface ResourceResult {
  blocks: Map<string, TexOverride>;
  items: Map<string, TexOverride>;
  sky: Map<string, { w: number; h: number; img: Img }>;
  /** How many of the game's textures a pack replaced, and the biggest texture size. */
  replaced: number;
  res: number;
}

/** Open the packs' zips (each may keep its files in one folder). */
async function sources(pkgs: PackPackage[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const p of pkgs) {
    const zip = new ZipArchive(p.data);
    const meta = zip.names().find((n) => /^([^/]+\/)?pack\.mcmeta$/.test(n));
    out.push({ zip, root: meta ? meta.slice(0, -'pack.mcmeta'.length) : '' });
  }
  return out;
}

/** The first pack holding one of these files (paths under assets/<ns>/textures/). */
function find(srcs: Source[], paths: string[], ns = 'minecraft'): { src: Source; path: string } | null {
  for (const src of srcs) for (const p of paths) {
    const full = `${src.root}assets/${ns}/textures/${p}`;
    if (src.zip.has(full)) return { src, path: full };
  }
  return null;
}

/** A texture (and its animation) at a power-of-two size. */
async function load(src: Source, path: string): Promise<TexOverride | null> {
  const bytes = await src.zip.read(path);
  if (!bytes) return null;
  const im = await decodeImage(bytes);
  const w = im.w;
  if (w < 1 || im.h < w) return null;
  const size = Math.min(256, 2 ** Math.round(Math.log2(w)));
  const n = Math.floor(im.h / w);
  const frame = (i: number) => {
    const f = new Uint8ClampedArray(w * w * 4);
    f.set(im.data.subarray(i * w * w * 4, (i + 1) * w * w * 4));
    return w === size ? f : resampleTo(f, w, size);
  };
  const o: TexOverride = { img: frame(0), size };
  if (n > 1) {
    // a strip of frames: .mcmeta says how long each shows and in what order
    let meta: { animation?: { frametime?: number; frames?: (number | { index: number; time?: number })[] } } = {};
    try { const t = await src.zip.text(path + '.mcmeta'); if (t) meta = JSON.parse(t); } catch { /* defaults */ }
    const ft = Math.max(1, meta.animation?.frametime ?? 1);
    const order = meta.animation?.frames?.length ? meta.animation.frames : [...Array(n).keys()];
    o.frames = [...Array(n).keys()].map(frame);
    o.steps = order.map((f) => (typeof f === 'number' ? { frame: f % n, ticks: ft } : { frame: (f.index ?? 0) % n, ticks: Math.max(1, f.time ?? ft) })).filter((s) => s.frame >= 0);
  }
  return o;
}

/** Any square size to another (not just powers of two). */
function resampleTo(img: Img, from: number, to: number): Img {
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) {
    const s = (Math.floor((y * from) / to) * from + Math.floor((x * from) / to)) * 4, d = (y * to + x) * 4;
    out[d] = img[s]; out[d + 1] = img[s + 1]; out[d + 2] = img[s + 2]; out[d + 3] = img[s + 3];
  }
  return out;
}

const each = (o: TexOverride, f: (img: Img) => void) => { f(o.img); for (const fr of o.frames ?? []) if (fr !== o.img) f(fr); };

/**
 * Read the packs (first = highest priority) for the given texture and item sprite names. Returns what they replace.
 */
export async function loadResourcePacks(pkgs: PackPackage[], textures: string[], items: string[]): Promise<ResourceResult> {
  const srcs = await sources(pkgs);
  const blocks = new Map<string, TexOverride>(), itemMap = new Map<string, TexOverride>(), sky = new Map<string, { w: number; h: number; img: Img }>();
  if (!srcs.length) return { blocks, items: itemMap, sky, replaced: 0, res: 16 };
  const jobs: Promise<void>[] = [];
  const want = (name: string, paths: string[], into: Map<string, TexOverride>, ns = 'minecraft', fix?: (o: TexOverride) => Promise<void> | void) => {
    const hit = find(srcs, paths, ns);
    if (!hit) return;
    jobs.push(load(hit.src, hit.path).then(async (o) => {
      if (!o) return;
      if (fix) await fix(o);
      into.set(name, o);
    }).catch((e) => console.warn('resource pack:', hit.path, e)));
  };
  for (const name of textures) {
    if (name.startsWith('item/')) continue;
    const ns = name.includes(':') ? name.split(':')[0] : 'minecraft', base = name.includes(':') ? name.split(':')[1] : name;
    if (name.startsWith('particle_')) { want(name, particlePaths(name), blocks); continue; }
    if (ns !== 'minecraft') { want(name, [`block/${base}.png`, `item/${base}.png`], blocks, ns); continue; }
    if (name === 'grass_side' || name === 'grass_side_overlay') {
      // the side with its grey overlay on top, the overlay's pixels marked (alpha 254) to take the biome's colour
      want(name, blockPaths('grass_side'), blocks, ns, async (o) => {
        const ov = find(srcs, blockPaths('grass_side_overlay'));
        const over = ov ? await load(ov.src, ov.path) : null;
        if (!over) return;
        const m = over.size === o.size ? over.img : resampleTo(over.img, over.size, o.size);
        each(o, (img) => { for (let i = 0; i < img.length; i += 4) if (m[i + 3] > 127) { img[i] = m[i]; img[i + 1] = m[i + 1]; img[i + 2] = m[i + 2]; img[i + 3] = 254; } });
      });
      continue;
    }
    if (name === 'water_still' || name === 'water_flow') {
      want(name, blockPaths(name), blocks, ns, (o) => each(o, (img) => {
        // grey water takes vanilla's default blue (the game's water isn't tinted per biome)
        let sat = 0;
        for (let i = 0; i < img.length; i += 4) sat += Math.max(img[i], img[i + 1], img[i + 2]) - Math.min(img[i], img[i + 1], img[i + 2]);
        if (sat / (img.length / 4) > 24) return;
        for (let i = 0; i < img.length; i += 4) { img[i] = (img[i] * WATER[0]) / 255; img[i + 1] = (img[i + 1] * WATER[1]) / 255; img[i + 2] = (img[i + 2] * WATER[2]) / 255; img[i + 3] = Math.min(img[i + 3], 190); }
      }));
      continue;
    }
    want(name, blockPaths(name), blocks, ns);
  }
  for (const name of items) {
    const ns = name.includes(':') ? name.split(':')[0] : 'minecraft', base = name.includes(':') ? name.split(':')[1] : name;
    want(name, ns === 'minecraft' ? itemPaths(base) : [`item/${base}.png`], itemMap, ns);
  }
  for (const [k, path] of [['sun', 'environment/sun.png'], ['moon', 'environment/moon_phases.png']]) {
    const hit = find(srcs, [path]);
    if (hit) jobs.push(hit.src.zip.read(hit.path).then(async (b) => { if (b) { const im = await decodeImage(b); sky.set(k, { w: im.w, h: im.h, img: im.data }); } }).catch(() => {}));
  }
  await Promise.all(jobs);
  let res = 16;
  for (const o of [...blocks.values(), ...itemMap.values()]) res = Math.max(res, o.size);
  return { blocks, items: itemMap, sky, replaced: blocks.size + itemMap.size, res };
}

export { resize };
