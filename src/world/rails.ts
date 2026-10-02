// Rail shapes, shared by the mesher, minecart physics and track laying.
import { B, T, idOf, metaOf, isRail } from './blocks';

/** The two ends of each shape as [dx, dy, dz] (vanilla's matrix): 0 N-S, 1 E-W, 2-5 ascending E/W/N/S, 6-9 SE/SW/NW/NE. */
export const RAIL_ENDS: ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]> = [
  [[0, 0, -1], [0, 0, 1]],
  [[-1, 0, 0], [1, 0, 0]],
  [[-1, -1, 0], [1, 0, 0]],
  [[-1, 0, 0], [1, -1, 0]],
  [[0, 0, -1], [0, -1, 1]],
  [[0, -1, -1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0]],
  [[0, 0, 1], [-1, 0, 0]],
  [[0, 0, -1], [-1, 0, 0]],
  [[0, 0, -1], [1, 0, 0]],
];

export const NS = 0, EW = 1, ASC_E = 2, ASC_W = 3, ASC_N = 4, ASC_S = 5, SE = 6, SW = 7, NW = 8, NE = 9;

/** Shape of a rail block value (the special rails keep their on bit in 8). */
export const railShape = (v: number) => (idOf(v) === B.RAIL ? metaOf(v) : metaOf(v) & 7);
export const isAscending = (shape: number) => shape >= 2 && shape <= 5;
/** Normal rails can curve; powered, detector and activator rails can't. */
export const canCurve = (id: number) => id === B.RAIL;

/** Texture of a rail block value. */
export function railTexture(v: number, faces: number[]): number {
  const id = idOf(v), m = metaOf(v);
  if (id === B.RAIL) return m >= 6 ? T.railCorner : faces[0];
  if (!(m & 8)) return faces[0];
  return id === B.POWERED_RAIL ? T.poweredRailOn : id === B.DETECTOR_RAIL ? T.detectorRailOn : T.activatorRailOn;
}

export { isRail };
