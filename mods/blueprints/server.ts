// The server's side: pasting (creative players with commands allowed), taking the last paste back, and easy
// placing one block at a time (anyone, with the item in their hotbar unless they're in creative). Every message
// comes from a player's machine, so each is checked before the world changes: shapes, sizes, distance, rights.
import type { Channel, Game, Mc, Player } from '../sdk';
import { materials, isFree } from './blocks';

/** Client -> server: one box of blocks to paste (at most 16 along each side). */
export interface PasteBatch {
  op: 'batch';
  job: string;
  n: number;
  at: [number, number, number];
  size: [number, number, number];
  /** Block names this batch uses (`oak_stairs:5`, `mymod:gizmo`). */
  pal: string[];
  /** Base64 of 16-bit little-endian palette indices, x fastest then z then y; 0xffff leaves the block alone. */
  data: string;
  /** Tile entities: [cell index, the game's tile JSON]. */
  tiles?: [number, Record<string, unknown>][];
  /** 'all' puts every block; 'empty' only fills cells that are free. */
  mode: 'all' | 'empty';
}
export type PasteMsg = PasteBatch | { op: 'undo' } | { op: 'end'; job: string };
/** Server -> client. */
export type PasteReply =
  | { op: 'done'; job: string; n: number; placed: number }
  | { op: 'later'; job: string; n: number }
  | { op: 'denied'; job: string; why: string }
  | { op: 'undone'; n: number };
/** Client -> server: put one block where the schematic wants it. */
export interface PlaceMsg { x: number; y: number; z: number; b: string; slot: number }

const MAX_SIDE = 16;
const MAX_UNDO = 4_000_000;
/** Tile types a paste may set (the game's containers and the like), besides mods' own blocks' tiles. */
const TILE_TYPES = new Set(['chest', 'hopper', 'dispenser', 'dropper', 'furnace', 'brewing', 'sign', 'spawner', 'command', 'banner', 'jukebox', 'lectern', 'beehive', 'campfire']);

/** The blocks a paste replaced (x, y, z, old value in fours) and their tiles, to take it back. */
interface Undo { job: string; cells: number[]; tiles: Map<string, unknown> }
const undos = new WeakMap<Player, Undo>();

export function serverSide(mc: Mc, paste: Channel<PasteMsg>, reply: Channel<PasteReply>, place: Channel<PlaceMsg>) {
  const canPaste = (game: Game, player: Player) => {
    const sp = game.playerOf(player);
    return !!sp && player.creative && (sp.owner || !!game.meta?.cheatsForAll);
  };

  paste.onServer((d, player, game) => {
    if (!d || typeof d !== 'object') return;
    if (d.op === 'undo') {
      if (!canPaste(game, player)) return;
      const u = undos.get(player);
      if (!u) return;
      undos.delete(player);
      const w = game.world!, t = game.ticker!;
      t.suppress = true;
      try {
        for (let k = u.cells.length - 4; k >= 0; k -= 4) {
          const [x, y, z, v] = u.cells.slice(k, k + 4);
          w.set(x, y, z, v);
          const tile = u.tiles.get(`${x},${y},${z}`);
          if (tile) w.setTile(x, y, z, tile as never);
        }
      } finally { t.suppress = false; }
      reply.toPlayer(player, { op: 'undone', n: u.cells.length / 4 });
      return;
    }
    if (d.op === 'end') return;
    if (d.op !== 'batch') return;
    const job = String(d.job).slice(0, 40), n = Number(d.n) | 0;
    if (!canPaste(game, player)) { reply.toPlayer(player, { op: 'denied', job, why: 'Pasting needs creative mode and permission to use commands' }); return; }
    const at = d.at, size = d.size;
    if (!Array.isArray(at) || !Array.isArray(size) || ![...at, ...size].every(Number.isInteger)) return;
    if (size.some((s) => s < 1 || s > MAX_SIDE) || at[1] < 0 || at[1] + size[1] > 256) return;
    if (!Array.isArray(d.pal) || d.pal.length > 4096 || typeof d.data !== 'string') return;
    const w = game.world!;
    // only where the server has the world loaded: the client tries again later
    for (const [x, z] of [[at[0], at[2]], [at[0] + size[0] - 1, at[2] + size[2] - 1]]) if (!w.isLoaded(x, z)) { reply.toPlayer(player, { op: 'later', job, n }); return; }
    const vals = d.pal.map((s) => { try { return typeof s === 'string' ? mc.blockspec.parseBlock(s) : -1; } catch { return -1; } });
    let raw: Uint8Array;
    try { raw = Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0)); } catch { return; }
    const cells = size[0] * size[1] * size[2];
    if (raw.length !== cells * 2) return;
    const idx = new Uint16Array(raw.buffer);
    const tiles = new Map<number, Record<string, unknown>>();
    if (Array.isArray(d.tiles)) for (const e of d.tiles.slice(0, cells)) if (Array.isArray(e) && Number.isInteger(e[0]) && e[1] && typeof e[1] === 'object') tiles.set(e[0], e[1]);
    // a new paste replaces what the last one could take back
    let u = undos.get(player);
    if (!u || u.job !== job) { u = { job, cells: [], tiles: new Map() }; undos.set(player, u); }
    const t = game.ticker!;
    let placed = 0;
    t.suppress = true;
    try {
      for (let i = 0; i < cells; i++) {
        const k = idx[i];
        if (k === 0xffff) continue;
        const v = vals[k];
        if (v === undefined || v < 0) continue;
        const x = at[0] + (i % size[0]), z = at[2] + (Math.floor(i / size[0]) % size[2]), y = at[1] + Math.floor(i / (size[0] * size[2]));
        const old = w.get(x, y, z);
        if (d.mode === 'empty' && !isFree(old)) continue;
        const tile = tiles.get(i);
        if (old === v && !tile) continue;
        if (u.cells.length < MAX_UNDO * 4) {
          u.cells.push(x, y, z, old);
          const ot = w.getTile(x, y, z);
          if (ot) u.tiles.set(`${x},${y},${z}`, JSON.parse(JSON.stringify(ot)));
        }
        w.set(x, y, z, v);
        if (old !== v) game.interact!.initTile(x, y, z, v);
        if (tile) setTile(game, x, y, z, v, tile);
        placed++;
      }
    } finally { t.suppress = false; }
    reply.toPlayer(player, { op: 'done', job, n, placed });
  });

  /** A pasted tile: only the kinds the block takes, as plain JSON of a sane size. */
  function setTile(game: Game, x: number, y: number, z: number, v: number, tile: Record<string, unknown>) {
    const type = String(tile.type ?? ''), def = mc.BLOCKS[v & 0xfff];
    if (!(TILE_TYPES.has(type) || (def?.mod && type === def.name))) return;
    const cur = game.world!.getTile(x, y, z) as { type?: string } | undefined;
    if (cur && cur.type !== type) return;
    const json = JSON.stringify(tile);
    if (json.length > 32_000) return;
    game.world!.setTile(x, y, z, JSON.parse(json));
  }

  place.onServer((d, player, game) => {
    if (!d || ![d.x, d.y, d.z, d.slot].every(Number.isInteger) || typeof d.b !== 'string') return;
    if (player.spectator || player.dead || player.gameMode === 2) return;
    const w = game.world!;
    const { x, y, z } = d;
    if (y < 0 || y > 255 || !w.isLoaded(x, z)) return;
    const eye = { x: player.x, y: player.y + player.eyeHeight(), z: player.z };
    if ((x + 0.5 - eye.x) ** 2 + (y + 0.5 - eye.y) ** 2 + (z + 0.5 - eye.z) ** 2 > 7 * 7) return;
    let v: number;
    try { v = mc.blockspec.parseBlock(d.b); } catch { return; }
    if (!(v & 0xfff) || !isFree(w.get(x, y, z))) return;
    const cost = materials(v);
    if (!cost.length) return;
    const inv = player.inventory;
    if (!player.creative) {
      if (d.slot < 0 || d.slot > 8) return;
      const s = inv.main[d.slot];
      if (!s || s.id !== cost[0][0] || s.count < cost[0][1]) return;
      inv.selected = d.slot;
    }
    if (!game.ticker!.canStay(x, y, z, v)) return;
    const blocks: [number, number, number, number][] = [[x, y, z, v]];
    const partner = mc.blockspec.partnerOf(v);
    if (partner) {
      const [dx, dy, dz, pv] = partner;
      if (!isFree(w.get(x + dx, y + dy, z + dz))) return;
      blocks.push([x + dx, y + dy, z + dz, pv]);
    }
    for (const [bx, by, bz, bv] of blocks) { w.set(bx, by, bz, bv); game.interact!.initTile(bx, by, bz, bv); }
    game.playBlockSound(v & 0xfff, x, y, z, 'place');
    if (!player.creative) {
      const s = inv.main[d.slot]!;
      inv.main[d.slot] = s.count > cost[0][1] ? { ...s, count: s.count - cost[0][1] } : null;
    }
  });
}
