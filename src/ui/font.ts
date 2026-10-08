// Minecraft-style bitmap font rendered from hand-authored glyphs; other characters (Chinese...) come from Unifont.
import { glyph, isWide, type Glyph } from './unifont';

const G: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '###..', '#....', '#....', '#....', '#####'],
  F: ['#####', '#....', '###..', '#....', '#....', '#....', '#....'],
  G: ['.####', '#....', '#..##', '#...#', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['....#', '....#', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '####.', '#....', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#...#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '....#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '####.'],
  c: ['.....', '.....', '.###.', '#...#', '#....', '#...#', '.###.'],
  d: ['....#', '....#', '.##.#', '#..##', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.####'],
  f: ['..##', '.#..', '####', '.#..', '.#..', '.#..', '.#..'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '.####', '....#', '####.'],
  h: ['#....', '#....', '#.##.', '##..#', '#...#', '#...#', '#...#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  j: ['....#', '.....', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#...#', '#...#'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '#.##.', '##..#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.##.#', '#..##', '#...#', '.####', '....#', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#..', '.#..', '####', '.#..', '.#..', '.#..', '..##'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.####'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '.####', '....#', '####.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#...#', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...##', '..#.#', '.#..#', '#...#', '#####', '....#', '....#'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '#...#', '....#', '...#.', '..#..', '..#..', '..#..'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '"': ['#.#', '#.#', '...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  $: ['..#..', '.####', '#....', '.###.', '....#', '####.', '..#..'],
  '%': ['#...#', '#..#.', '...#.', '..#..', '.#...', '.#..#', '#...#'],
  '&': ['..#..', '.#.#.', '..#..', '.##.#', '#..#.', '#..#.', '.##.#'],
  "'": ['#', '#', '.'],
  '(': ['..##', '.#..', '#...', '#...', '#...', '.#..', '..##'],
  ')': ['##..', '..#.', '...#', '...#', '...#', '..#.', '##..'],
  '*': ['.....', '.....', '#..#.', '.##..', '#..#.', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ',': ['.', '.', '.', '.', '.', '#', '#', '#'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  ':': ['.', '#', '.', '.', '.', '.', '#'],
  ';': ['.', '#', '.', '.', '.', '.', '#', '#'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '=': ['.....', '.....', '#####', '.....', '.....', '#####', '.....'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '@': ['.####.', '#....#', '#.##.#', '#.##.#', '#.####', '#.....', '.####.'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  '\\': ['#....', '.#...', '.#...', '..#..', '...#.', '...#.', '....#'],
  ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '^': ['..#..', '.#.#.', '#...#', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '`': ['#.', '.#', '..'],
  '{': ['..##', '.#..', '.#..', '#...', '.#..', '.#..', '..##'],
  '|': ['#', '#', '#', '#', '#', '#', '#', '#'],
  '}': ['##..', '..#.', '..#.', '...#', '..#.', '..#.', '##..'],
  '~': ['.##..#', '#..##.', '......'],
  '█': ['#####', '#####', '#####', '#####', '#####', '#####', '#####', '#####'],
};

const CELL = 8;
const COLS = 16;
/** Unifont glyphs drawn lately are kept in a cache of 16x16 cells (and a copy of it per colour). */
const U_COLS = 64, U_ROWS = 16, U_CELLS = U_COLS * U_ROWS;

export const COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

export class Font {
  private atlas: HTMLCanvasElement;
  private widths = new Map<string, number>();
  private index = new Map<string, number>();
  private tinted = new Map<string, HTMLCanvasElement>();
  lineHeight = 9;

  constructor() {
    const chars = Object.keys(G);
    const rows = Math.ceil((chars.length + 1) / COLS);
    this.atlas = document.createElement('canvas');
    this.atlas.width = COLS * CELL;
    this.atlas.height = rows * CELL;
    const ctx = this.atlas.getContext('2d')!;
    const img = ctx.createImageData(this.atlas.width, this.atlas.height);
    chars.forEach((ch, n) => {
      const g = G[ch];
      const ox = (n % COLS) * CELL, oy = Math.floor(n / COLS) * CELL;
      let w = 0;
      g.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '#') {
            const i = ((oy + y) * this.atlas.width + ox + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = img.data[i + 3] = 255;
          }
        }
        w = Math.max(w, row.length);
      });
      this.widths.set(ch, w);
      this.index.set(ch, n);
    });
    ctx.putImageData(img, 0, 0);
    this.widths.set(' ', 3);
  }

  private tint(color: string): HTMLCanvasElement {
    let c = this.tinted.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = this.atlas.width;
    c.height = this.atlas.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.atlas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    this.tinted.set(color, c);
    return c;
  }

  /** Width of one character, gap included (`ch` is one code point). */
  charWidth(ch: string): number {
    const w = this.widths.get(ch);
    if (w !== undefined) return w + 1;
    const cp = ch.codePointAt(0)!;
    return glyph(cp)?.advance ?? (isWide(cp) ? 9 : 6);
  }

  width(text: string): number {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '§' && i + 1 < text.length) { i++; continue; }
      const cp = text.codePointAt(i)!;
      if (cp > 0xffff) i++;
      w += this.charWidth(cp > 0xffff ? String.fromCodePoint(cp) : ch);
    }
    return Math.max(0, w - 1);
  }

  /** Draw text at (x,y) in GUI pixels. Supports §-colour codes. */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#FFFFFF', shadow = true, scale = 1) {
    if (shadow) this.drawRaw(ctx, text, x + scale, y + scale, color, true, scale);
    this.drawRaw(ctx, text, x, y, color, false, scale);
  }

  private drawRaw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, isShadow: boolean, scale: number) {
    let cur = color;
    let cx = x;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '§' && i + 1 < text.length) {
        const code = text[++i].toLowerCase();
        if (COLORS[code]) cur = COLORS[code];
        else if (code === 'r') cur = color;
        continue;
      }
      const cp = text.codePointAt(i)!;
      if (cp > 0xffff) i++;
      const tint = isShadow ? shadowOf(cur) : cur;
      if (this.index.has(ch) || cp < 0x80) {
        if (ch !== ' ') {
          const n = this.index.get(ch) ?? this.index.get('?')!;
          const w = this.widths.get(ch) ?? 5;
          ctx.drawImage(this.tint(tint), (n % COLS) * CELL, Math.floor(n / COLS) * CELL, w, CELL, cx, y, w * scale, CELL * scale);
        }
        cx += this.charWidth(ch) * scale;
        continue;
      }
      const g = glyph(cp);
      if (g && g.right >= 0) {
        const cell = this.cellOf(cp, g), src = this.uniTint(tint, cell);
        const w = g.right - g.left + 1;
        ctx.drawImage(src, (cell % U_COLS) * 16 + g.left, Math.floor(cell / U_COLS) * 16, w, 16, cx, y, (w / 2) * scale, CELL * scale);
      }
      cx += (g?.advance ?? (isWide(cp) ? 9 : 6)) * scale;
    }
  }

  // ---- Unifont glyphs: a cache of cells (least recently used goes), tinted per colour cell by cell
  private uni: HTMLCanvasElement | null = null;
  private uniCell = new Map<number, number>();
  private cellCp = new Int32Array(U_CELLS).fill(-1);
  private cellUsed = new Float64Array(U_CELLS);
  /** Bumped when a cell gets a new glyph: tinted copies redo that cell. */
  private cellVer = new Int32Array(U_CELLS);
  private uniTints = new Map<string, { c: HTMLCanvasElement; ver: Int32Array }>();
  private uses = 0;

  private cellOf(cp: number, g: Glyph): number {
    let cell = this.uniCell.get(cp);
    if (cell === undefined) {
      cell = 0;
      for (let i = 1; i < U_CELLS && this.cellCp[cell] >= 0; i++) if (this.cellCp[i] < 0 || this.cellUsed[i] < this.cellUsed[cell]) cell = i;
      if (this.cellCp[cell] >= 0) this.uniCell.delete(this.cellCp[cell]);
      this.cellCp[cell] = cp;
      this.uniCell.set(cp, cell);
      this.cellVer[cell]++;
      if (!this.uni) {
        this.uni = document.createElement('canvas');
        this.uni.width = U_COLS * 16;
        this.uni.height = U_ROWS * 16;
      }
      const ctx = this.uni.getContext('2d')!, img = ctx.createImageData(16, 16);
      for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) if (g.rows[yy] & (0x8000 >> xx)) img.data.fill(255, (yy * 16 + xx) * 4, (yy * 16 + xx) * 4 + 4);
      ctx.putImageData(img, (cell % U_COLS) * 16, Math.floor(cell / U_COLS) * 16);
    }
    this.cellUsed[cell] = ++this.uses;
    return cell;
  }

  private uniTint(color: string, cell: number): HTMLCanvasElement {
    let t = this.uniTints.get(color);
    if (!t) {
      const c = document.createElement('canvas');
      c.width = U_COLS * 16;
      c.height = U_ROWS * 16;
      t = { c, ver: new Int32Array(U_CELLS) };
      this.uniTints.set(color, t);
    }
    if (t.ver[cell] !== this.cellVer[cell]) {
      t.ver[cell] = this.cellVer[cell];
      const x = (cell % U_COLS) * 16, y = Math.floor(cell / U_COLS) * 16, ctx = t.c.getContext('2d')!;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, 16, 16);
      ctx.clip();
      ctx.clearRect(x, y, 16, 16);
      ctx.drawImage(this.uni!, x, y, 16, 16, x, y, 16, 16);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 16, 16);
      ctx.restore();
    }
    return t.c;
  }

  drawCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = '#FFFFFF', shadow = true, scale = 1) {
    this.draw(ctx, text, Math.round(cx - (this.width(text) * scale) / 2), y, color, shadow, scale);
  }

  /** Word-wrap text to a maximum width. Lines break at spaces, and between Chinese characters (not before closing
   * punctuation or after opening punctuation). */
  wrap(text: string, maxW: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      // unbreakable pieces and the spaces before each
      const toks: { s: string; gap: string }[] = [];
      let gap = '', code = '';
      const chars = [...para];
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (ch === ' ') { gap += ' '; continue; }
        // a colour code sticks to the character after it
        if (ch === '§' && i + 1 < chars.length) { code += ch + chars[++i]; continue; }
        const prev = toks[toks.length - 1], wide = isWide(ch.codePointAt(0)!);
        const prevCh = prev ? prev.s[prev.s.length - 1] : '';
        const joins = !!prev && !gap && ((!wide && !isWide(prevCh.codePointAt(0)!)) || NO_START.includes(ch) || NO_END.includes(prevCh));
        if (joins) prev.s += code + ch;
        else toks.push({ s: code + ch, gap });
        gap = code = '';
      }
      let line = '';
      for (const t of toks) {
        const next = line ? line + t.gap + t.s : t.s;
        if (this.width(next) > maxW && line) { out.push(line); line = t.s; }
        else line = next;
      }
      out.push(line + code);
    }
    return out;
  }
}

/** Punctuation that can't start a line, and that can't end one. */
const NO_START = '，。、！？：；）」』》〉】…％,.!?:;)]}%';
const NO_END = '（「『《〈【([{';

const shadowCache = new Map<string, string>();
function shadowOf(c: string): string {
  let s = shadowCache.get(c);
  if (s) return s;
  const v = parseInt(c.slice(1), 16);
  const r = ((v >> 16) & 255) >> 2, g = ((v >> 8) & 255) >> 2, b = (v & 255) >> 2;
  s = '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  shadowCache.set(c, s);
  return s;
}
