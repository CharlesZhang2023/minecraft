// The shipyard: a far-off strip of every dimension where sub-levels keep their blocks (the Valkyrien Skies and Sable
// way). Each sub-level owns a plot there; its blocks are ordinary blocks in ordinary chunks (so tile entities,
// redstone, containers and every block's behaviour work unchanged), and its pose says where they appear in the
// world. Shipyard chunks are never generated: they start out empty, on the server and on every client alike.

/** First shipyard chunk column (block x 320000). Nothing is ever generated from here east. */
export const SHIPYARD_CX = 20000;
export const SHIPYARD_X = SHIPYARD_CX * 16;
/** Plots are this many chunks apart, so neighbours never touch. */
export const PLOT_STRIDE = 32;
const ROWS = 1024;

export const isShipyardChunk = (cx: number) => cx >= SHIPYARD_CX;
export const isShipyardX = (x: number) => x >= SHIPYARD_X;

/** The block in the middle of plot `i` (its x and z; any height). */
export function plotCenter(i: number): { x: number; z: number } {
  const col = Math.floor(i / ROWS), row = i % ROWS;
  return { x: (SHIPYARD_CX + PLOT_STRIDE / 2 + col * PLOT_STRIDE) * 16 + 8, z: (-ROWS / 2 * PLOT_STRIDE + row * PLOT_STRIDE) * 16 + 8 };
}

/** Which plot a shipyard block belongs to (-1 outside the shipyard). */
export function plotAt(x: number, z: number): number {
  if (!isShipyardX(x)) return -1;
  const col = Math.floor((Math.floor(x / 16) - SHIPYARD_CX) / PLOT_STRIDE);
  const row = Math.floor((Math.floor(z / 16) + ROWS / 2 * PLOT_STRIDE + PLOT_STRIDE / 2) / PLOT_STRIDE);
  if (row < 0 || row >= ROWS) return -1;
  return col * ROWS + row;
}

/** The most blocks a plot's structure may span across (it must fit well inside the plot). */
export const MAX_SPAN = (PLOT_STRIDE - 4) * 16;
