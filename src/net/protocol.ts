// What both ends must agree on to play together.
import { BLOCKS } from '../world/blocks';
import { ITEMS } from '../game/items';

/** Bump when messages change shape. */
export const PROTOCOL = 1;

/** The protocol plus the block and item lists' sizes: a different build of the game can't share a world. */
export function fingerprint() {
  return `${PROTOCOL}.${BLOCKS.length}.${ITEMS.size}`;
}

/** Player names: letters, digits, spaces and underscores, 1-16 characters. */
export function cleanName(s: unknown) {
  return String(s ?? '').replace(/[^A-Za-z0-9_ ]/g, '').trim().slice(0, 16);
}

export const MAX_PLAYERS = 8;

/** FNV-1a over a chunk's blocks: lets a client check that terrain it generated itself matches the server's. */
export function chunkHash(blocks: Uint16Array) {
  let h = 0x811c9dc5;
  for (let i = 0; i < blocks.length; i++) {
    h ^= blocks[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
