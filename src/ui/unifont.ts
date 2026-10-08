// Glyphs beyond the bitmap font's ASCII (Chinese, and anything typed in other scripts), from GNU Unifont like
// Minecraft's: 16 pixels high, drawn at half size so a character is as tall as the GUI font. They arrive in sets (a
// language's characters, see tools/vite-font.ts) and, for anything else, by 256-character page on first use.

export interface Glyph {
  /** 1 = narrow (8x16), 2 = wide (16x16). */
  kind: number;
  /** Rows of 16 bits (high bit leftmost). */
  rows: Uint16Array;
  /** First and last inked column, in Unifont pixels (empty glyphs: 0 and -1). */
  left: number;
  right: number;
  /** Advance in GUI pixels, the 1-pixel gap included. */
  advance: number;
}

const glyphs = new Map<number, Glyph>();
const pagesAsked = new Set<number>();
let index: Promise<{ pages: string; sets: Record<string, string> } | null> | null = null;
const listeners: (() => void)[] = [];

/** Bumped whenever glyphs arrive, so text drawn into cached pictures (signs) can be redrawn. */
export let glyphVersion = 0;

/** Call `fn` whenever new glyphs arrive. */
export function onGlyphs(fn: () => void) { listeners.push(fn); }

function add(cp: number, kind: number, bytes: Uint8Array, at: number): number {
  const rows = new Uint16Array(16);
  let left = 16, right = -1;
  for (let y = 0; y < 16; y++) {
    const v = kind === 2 ? (bytes[at + y * 2] << 8) | bytes[at + y * 2 + 1] : bytes[at + y] << 8;
    rows[y] = v;
    for (let x = 0; x < 16; x++) if (v & (0x8000 >> x)) { left = Math.min(left, x); right = Math.max(right, x); }
  }
  if (right < 0) left = 0;
  // punctuation keeps its whole cell (a trimmed "，" or "…" would crowd the words around it)
  if (right >= 0 && isPunctuation(cp)) { left = 0; right = kind === 2 ? 15 : 7; }
  // like Minecraft: the inked width at half size, plus the gap; blank glyphs (spaces) keep their cell width
  const advance = right < 0 ? (kind === 2 ? 8 : 4) : Math.ceil((right - left + 1) / 2) + 1;
  glyphs.set(cp, { kind, rows, left, right, advance });
  return at + (kind === 2 ? 32 : 16);
}

function arrived() {
  glyphVersion++;
  for (const fn of listeners) fn();
}

function fontIndex() {
  return (index ??= fetch(new URL('font/index.json', document.baseURI)).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}

async function fetchBytes(file: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(new URL(file, document.baseURI));
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** Load a set of glyphs by name ('base', or a language's code). Resolves when they're in (or couldn't be had). */
export async function loadGlyphSet(name: string): Promise<void> {
  const file = (await fontIndex())?.sets[name];
  const b = file ? await fetchBytes(file) : null;
  if (!b) return;
  for (let at = 0; at + 3 <= b.length;) at = add(b[at] | (b[at + 1] << 8), b[at + 2], b, at + 3);
  arrived();
}

async function loadPage(page: number) {
  const pages = (await fontIndex())?.pages;
  const b = pages ? await fetchBytes(`${pages}${page.toString(16).padStart(2, '0')}.bin`) : null;
  if (!b) return;
  let at = 256;
  for (let i = 0; i < 256; i++) {
    if (!b[i]) continue;
    if (glyphs.has(page * 256 + i)) at += b[i] === 2 ? 32 : 16;
    else at = add(page * 256 + i, b[i], b, at);
  }
  arrived();
}

/** The glyph for a code point, or undefined while it's being fetched (or if Unifont has none). */
export function glyph(cp: number): Glyph | undefined {
  const g = glyphs.get(cp);
  if (g || cp > 0xffff || typeof document === 'undefined') return g;
  const page = cp >> 8;
  if (!pagesAsked.has(page)) {
    pagesAsked.add(page);
    void loadPage(page);
  }
  return undefined;
}

/** General, CJK and full-width punctuation. */
function isPunctuation(cp: number): boolean {
  return (cp >= 0x2010 && cp <= 0x2027) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff01 && cp <= 0xff0f) || (cp >= 0xff1a && cp <= 0xff20) || (cp >= 0xff3b && cp <= 0xff40) || (cp >= 0xff5b && cp <= 0xff65);
}

/** Is this character drawn full width (CJK and the like), going by its range? For sizing text before its glyph arrives. */
export function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6);
}
