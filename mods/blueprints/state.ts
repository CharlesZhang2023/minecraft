// What this player has going on (client side): the area selection, the placements and the display settings.
// Kept per world and dimension in this browser, so they're back the next time the world is opened.
import type { Client } from '../sdk';
import type { Vec3 } from './model';
import { Placement, type PlacementData } from './placement';
import * as lib from './library';

/** A box of the selection: two corners, both inside it. */
export interface Box { a: Vec3; b: Vec3 }
export type LayerMode = 'all' | 'single' | 'below' | 'above';

export const state = {
  boxes: [] as Box[],
  /** The box the next corners go to. */
  active: 0,
  placements: [] as Placement[],
  selected: '' as string,
  layer: { mode: 'all' as LayerMode, y: 64 },
  ghosts: true,
  highlights: true,
  easyPlace: false,
  /** What the wand does: pick corners, or move the selected placement where it's clicked. */
  wand: 'area' as 'area' | 'move',
  /** The world and dimension this is for. */
  key: '',
  /** Bumped by every change (screens and the ghosts watch it). */
  version: 0,
};

export const boxMin = (b: Box): Vec3 => [Math.min(b.a[0], b.b[0]), Math.min(b.a[1], b.b[1]), Math.min(b.a[2], b.b[2])];
export const boxMax = (b: Box): Vec3 => [Math.max(b.a[0], b.b[0]), Math.max(b.a[1], b.b[1]), Math.max(b.a[2], b.b[2])];
export const boxSize = (b: Box): Vec3 => { const a = boxMin(b), c = boxMax(b); return [c[0] - a[0] + 1, c[1] - a[1] + 1, c[2] - a[2] + 1]; };

export const selectedPlacement = () => state.placements.find((p) => p.data.id === state.selected) ?? null;

/** Is height y shown by the layer setting? */
export function layerShows(y: number): boolean {
  const l = state.layer;
  switch (l.mode) {
    case 'single': return y === l.y;
    case 'below': return y <= l.y;
    case 'above': return y >= l.y;
  }
  return true;
}

export function worldKey(client: Client): string {
  const w = client.world;
  return w ? `${w.worldId}:${w.dimension}` : '';
}

function storageKey(k: string) { return `blueprints:world:${k}`; }

export function changed() {
  state.version++;
  save();
}

function save() {
  if (!state.key) return;
  const data = {
    boxes: state.boxes, active: state.active, selected: state.selected, layer: state.layer,
    placements: state.placements.map((p) => p.data),
  };
  try { localStorage.setItem(storageKey(state.key), JSON.stringify(data)); } catch { /* private mode: just this session */ }
}

/** Switch to a world's selection and placements (loading their schematics). */
export async function load(key: string) {
  state.key = key;
  state.boxes = [];
  state.active = 0;
  state.placements = [];
  state.selected = '';
  state.version++;
  if (!key) return;
  let data: { boxes?: Box[]; active?: number; selected?: string; layer?: typeof state.layer; placements?: PlacementData[] } = {};
  try { data = JSON.parse(localStorage.getItem(storageKey(key)) ?? '{}'); } catch { /* nothing kept */ }
  state.boxes = Array.isArray(data.boxes) ? data.boxes : [];
  state.active = Math.min(data.active ?? 0, state.boxes.length);
  state.selected = data.selected ?? '';
  if (data.layer) state.layer = data.layer;
  for (const pd of data.placements ?? []) {
    const s = await lib.get(pd.schematicId).catch(() => null);
    if (state.key !== key) return;
    if (s) state.placements.push(new Placement(pd, s));
  }
  state.version++;
}

export function addPlacement(p: Placement) {
  state.placements.push(p);
  state.selected = p.data.id;
  changed();
}
export function removePlacement(id: string) {
  state.placements = state.placements.filter((p) => p.data.id !== id);
  if (state.selected === id) state.selected = state.placements[0]?.data.id ?? '';
  changed();
}
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
