// Where the Pocket Edition style touch controls sit, in GUI units. Shared by the touch layer (hit tests,
// buttons) and the HUD (the hotbar shrinks to fit between the D-pad and the jump button).

/** D-pad button size, cell pitch and screen margin. */
export const PAD_B = 22, PAD_S = 24, PAD_M = 4;

/** Top-left corner of the D-pad's 3x3 grid. */
export function padOrigin(h: number): [number, number] {
  return [PAD_M, h - 3 * PAD_S];
}

/** The hotbar: as many of the 9 slots as fit between the side controls, then a "..." cell for the inventory. */
export function touchHotbar(w: number, h: number) {
  const side = PAD_M + 3 * PAD_S + 2;
  const n = Math.max(3, Math.min(9, Math.floor((w - 2 * side - 2) / 20) - 1));
  const width = (n + 1) * 20 + 2;
  return { x: Math.floor(w / 2 - width / 2), y: h - 22, n, w: width };
}
