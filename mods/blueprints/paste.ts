// Pasting a placement: cut into boxes of at most 16x16x16 (a chunk section), each sent to the server as one small
// message with its own palette, a few per tick (a guest's messages to the host are limited). Boxes in chunks the
// server hasn't loaded come back "later" and are sent again once the player is nearer.
import type { Client } from '../sdk';
import type { Channel } from '../sdk';
import { SKIP, UNKNOWN, type Placement } from './placement';
import type { PasteBatch, PasteMsg, PasteReply } from './server';
import { gameName, NEWEST } from './vanilla';
import { tileFromNbt, embeddedTile } from './tiles';
import type { TileData } from './model';

export type PasteMode = 'all' | 'solid' | 'empty';

interface Job {
  id: string;
  name: string;
  queue: PasteBatch[];
  /** Sent and not answered yet, by batch number. */
  waiting: Map<number, PasteBatch>;
  /** Answered "later", with the tick to try again. */
  later: { b: PasteBatch; at: number }[];
  total: number;
  done: number;
  placed: number;
  unknown: number;
}
let job: Job | null = null;
let channel: Channel<PasteMsg>;
let notify: (msg: string) => void = () => {};

export function initPaste(c: Channel<PasteMsg>, say: (msg: string) => void) { channel = c; notify = say; }
export const pasting = () => job;

/** Build every batch of a placement and start sending. */
export function startPaste(p: Placement, mode: PasteMode) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const queue: PasteBatch[] = [];
  let unknown = 0;
  // tiles by region and cell
  const tileMaps = p.schematic.regions.map((r) => new Map<number, TileData>(r.tiles.map((t) => [t.i, t])));
  const dv = p.schematic.dataVersion || NEWEST;
  for (let y0 = p.min[1] & ~15; y0 <= p.max[1]; y0 += 16)
    for (let z0 = p.min[2] & ~15; z0 <= p.max[2]; z0 += 16)
      for (let x0 = p.min[0] & ~15; x0 <= p.max[0]; x0 += 16) {
        const lo = [Math.max(x0, p.min[0]), Math.max(y0, p.min[1], 0), Math.max(z0, p.min[2])];
        const hi = [Math.min(x0 + 15, p.max[0]), Math.min(y0 + 15, p.max[1], 255), Math.min(z0 + 15, p.max[2])];
        if (hi[1] < lo[1]) continue;
        const size: [number, number, number] = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
        const cells = size[0] * size[1] * size[2];
        const idx = new Uint16Array(cells).fill(0xffff);
        const pal: string[] = [], palIdx = new Map<number, number>();
        const tiles: [number, Record<string, unknown>][] = [];
        let any = false;
        for (let i = 0; i < cells; i++) {
          const x = lo[0] + (i % size[0]), z = lo[2] + (Math.floor(i / size[0]) % size[2]), y = lo[1] + Math.floor(i / (size[0] * size[2]));
          const c = p.cellAt(x, y, z);
          if (!c) continue;
          const v = p.values[c.ri][c.region.blocks[c.i]];
          if (v === SKIP) continue;
          if (v === UNKNOWN) { unknown++; continue; }
          if (v === 0 && mode === 'solid') continue;
          let k = palIdx.get(v);
          if (k === undefined) { k = pal.length; pal.push(gameName(v)); palIdx.set(v, k); }
          idx[i] = k;
          any = true;
          const t = tileMaps[c.ri].get(c.i);
          if (t) {
            const state = c.region.palette[c.region.blocks[c.i]];
            const json = t.game ?? embeddedTile(t.nbt) ?? (t.nbt ? tileFromNbt(t.nbt, state.name, dv) : null);
            if (json) tiles.push([i, json]);
          }
        }
        if (!any) continue;
        const bytes = new Uint8Array(idx.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode(...bytes.subarray(i, i + 4096));
        queue.push({ op: 'batch', job: id, n: queue.length, at: [lo[0], lo[1], lo[2]], size, pal, data: btoa(bin), tiles: tiles.length ? tiles : undefined, mode: mode === 'empty' ? 'empty' : 'all' });
      }
  // the batch with the most tiles might not fit in one message: drop tiles that don't (rare: chests full of books)
  for (const b of queue) while (b.tiles && JSON.stringify(b).length > 60_000) { b.tiles.pop(); if (!b.tiles.length) b.tiles = undefined; }
  job = { id, name: p.data.name, queue, waiting: new Map(), later: [], total: queue.length, done: 0, placed: 0, unknown };
  if (!queue.length) { job = null; notify('§eNothing to paste'); }
}

export function cancelPaste() {
  if (!job) return;
  notify(`§ePaste of ${job.name} stopped (${job.done}/${job.total} parts done)`);
  job = null;
}

export function undoPaste() { channel.toServer({ op: 'undo' }); }

/** Send the next batches (each client tick). */
export function tickPaste(client: Client) {
  if (!job) return;
  // a guest's messages are limited to about 20 a second: one a tick; the host has no limit
  const perTick = client.server ? 6 : 1;
  const now = client.ticks;
  lastTicks = now;
  for (let k = 0; k < job.later.length; k++) if (job.later[k].at <= now) { job.queue.push(job.later[k].b); job.later.splice(k--, 1); }
  for (let n = 0; n < perTick && job.queue.length && job.waiting.size < 16; n++) {
    const b = job.queue.shift()!;
    job.waiting.set(b.n, b);
    channel.toServer(b);
  }
}

export function onPasteReply(r: PasteReply) {
  if (r.op === 'undone') { notify(`§aTook back ${r.n.toLocaleString()} blocks`); return; }
  if (!job || r.job !== job.id) return;
  if (r.op === 'denied') { notify('§c' + r.why); job = null; return; }
  const b = job.waiting.get(r.n);
  if (!b) return;
  job.waiting.delete(r.n);
  if (r.op === 'later') { job.later.push({ b, at: (lastTicks ?? 0) + 40 }); return; }
  job.done++;
  job.placed += r.placed;
  if (job.done === job.total) {
    notify(`§aPasted ${job.name}: ${job.placed.toLocaleString()} blocks${job.unknown ? `, §e${job.unknown} unknown blocks left out` : ''}`);
    channel.toServer({ op: 'end', job: job.id });
    job = null;
  }
}
let lastTicks: number | null = null;
