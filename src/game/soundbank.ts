// Recorded sounds (the vanilla set made by tools/sounds/make.mjs), standing in for the synthesised ones where the
// bank has them. The bank is one file: "MCSB", a u32 header length, the header (JSON), then each sound file (Ogg
// Opus) back to back. It's fetched at start-up; each file is decoded the first time it plays and dropped again
// when decoded audio passes a budget (a second of decoded sound is ~190 KB), so phones keep only what's in use.

export interface BankSound {
  /** Its variants (blob indices), one picked at random each time. */
  v: number[];
  vol?: number;
  pitch?: number;
}

interface Header { v: 1; sounds: Record<string, BankSound>; blobs: [number, number][] }

export interface SoundIndex {
  v: 1;
  credit?: string;
  sfx?: string;
  sfxSize?: number;
  /** Music tracks by kind (menu, game, creative, nether, end, boss, credits). */
  music?: Record<string, string[]>;
}

/** Sounds kept decoded whatever the budget: the ones heard all the time. */
const HOT = /^(dig|step|place)\.|^(click|pop|hurt|orb|swim|splash|bow|arrowHit|eat|rain)$/;
const BUDGET = 24 << 20;

export class SoundBank {
  private sounds: Map<string, BankSound>;
  private blobs: [number, number][];
  private decoded = new Map<number, AudioBuffer>();
  private pending = new Map<number, Promise<AudioBuffer | null>>();
  private hot = new Set<number>();
  private lastUse = new Map<number, number>();
  private bytes = 0;
  /** Set when the browser can't decode the bank (then the synthesised sounds play). */
  failed = false;

  private constructor(private data: ArrayBuffer, private start: number, h: Header) {
    this.sounds = new Map(Object.entries(h.sounds));
    this.blobs = h.blobs;
    for (const [name, s] of this.sounds) if (HOT.test(name)) for (const b of s.v) this.hot.add(b);
  }

  static parse(data: ArrayBuffer): SoundBank {
    const dv = new DataView(data);
    if (data.byteLength < 8 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'MCSB') throw new Error('not a sound bank');
    const n = dv.getUint32(4, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 8, n))) as Header;
    if (h.v !== 1) throw new Error('sound bank version ' + h.v);
    return new SoundBank(data, 8 + n, h);
  }

  has(name: string) { return !this.failed && this.sounds.has(name); }
  sound(name: string) { return this.failed ? undefined : this.sounds.get(name); }
  names() { return [...this.sounds.keys()]; }

  /** A variant's audio if it's decoded (and it starts decoding if not). */
  now(ctx: BaseAudioContext, blob: number): AudioBuffer | null {
    const b = this.decoded.get(blob);
    if (b) { this.lastUse.set(blob, performance.now()); return b; }
    void this.decode(ctx, blob);
    return null;
  }

  decode(ctx: BaseAudioContext, blob: number): Promise<AudioBuffer | null> {
    const have = this.decoded.get(blob);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(blob);
    if (!p) {
      const [off, len] = this.blobs[blob];
      // decodeAudioData takes (detaches) its buffer: give it a copy
      const bytes = this.data.slice(this.start + off, this.start + off + len);
      p = ctx.decodeAudioData(bytes).then((buf) => {
        this.pending.delete(blob);
        this.decoded.set(blob, buf);
        this.lastUse.set(blob, performance.now());
        this.bytes += buf.length * buf.numberOfChannels * 4;
        this.trim();
        return buf;
      }, (e) => {
        this.pending.delete(blob);
        // the first sound tried tells whether this browser decodes Ogg Opus at all
        if (!this.decoded.size) { this.failed = true; console.warn('sound bank: cannot decode, using synthesised sounds', e); }
        return null;
      });
      this.pending.set(blob, p);
    }
    return p;
  }

  /** Decode the sounds heard all the time, a few at a time. */
  async warm(ctx: BaseAudioContext) {
    const list = [...this.hot];
    for (let i = 0; i < list.length && !this.failed; i += 8) await Promise.all(list.slice(i, i + 8).map((b) => this.decode(ctx, b)));
  }

  private trim() {
    if (this.bytes <= BUDGET) return;
    const cold = [...this.decoded.keys()].filter((b) => !this.hot.has(b)).sort((a, b) => this.lastUse.get(a)! - this.lastUse.get(b)!);
    for (const b of cold) {
      if (this.bytes <= BUDGET * 0.75) break;
      const buf = this.decoded.get(b)!;
      this.bytes -= buf.length * buf.numberOfChannels * 4;
      this.decoded.delete(b);
    }
  }

  stats() { return { decoded: this.decoded.size, bytes: this.bytes, blobs: this.blobs.length, names: this.sounds.size, failed: this.failed }; }
}

/** The vanilla sound set next to the game (sounds/index.json), or null when there's none. */
export async function loadSoundIndex(base: string): Promise<SoundIndex | null> {
  try {
    const r = await fetch(base + 'sounds/index.json', { cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    const idx = (await r.json()) as SoundIndex;
    return idx.v === 1 ? idx : null;
  } catch {
    return null;
  }
}

export async function loadSoundBank(base: string, idx: SoundIndex): Promise<SoundBank | null> {
  if (!idx.sfx) return null;
  try {
    const r = await fetch(base + 'sounds/' + idx.sfx);
    if (!r.ok) return null;
    return SoundBank.parse(await r.arrayBuffer());
  } catch (e) {
    console.warn('sound bank', e);
    return null;
  }
}
