// What the server keeps for the strategy game, saved with the world: each player's side (faction, colour,
// resources, view mode) and every building. Units are ordinary entities and save themselves.
import type { FactionId, Res } from './defs';

export type Mode = 'off' | 'god' | 'hero';

export interface Park {
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** Game mode before the overseer's view (it's spectator while looking down). */
  gm: number;
  flying: boolean;
  dim: string;
}

export interface PState {
  faction: FactionId | null;
  team: number;
  res: Record<Res, number>;
  mode: Mode;
  /** Where the player's body is while they look down as the overseer. */
  park: Park | null;
  /** Has had their free first town hall. */
  started: boolean;
}

export interface BState {
  id: number;
  type: string;
  owner: string;
  faction: FactionId;
  team: number;
  dim: string;
  /** North-west corner of the footprint at ground level (layer 0), and quarter turns. */
  x: number; y: number; z: number; rot: number;
  built: boolean;
  /** Blocks standing / blocks in the finished building (the building's health). */
  hp: number;
  max: number;
  /** Units being trained: kind and ticks done. */
  queue: { u: string; t: number }[];
  rally: [number, number, number] | null;
  /** Paid for (refunds on cancelling). */
  paid: Partial<Record<Res, number>>;
}

export interface WData {
  players: Record<string, PState>;
  buildings: BState[];
  next: number;
}

/** What a client is told about a building. */
export interface BInfo {
  id: number; type: string; owner: string; faction: FactionId; team: number;
  x: number; y: number; z: number; rot: number;
  built: boolean; hp: number; max: number;
  queue: { u: string; f: number }[];
  rally: [number, number, number] | null;
  /** Construction progress 0-1 (blocks done / all steps). */
  prog: number;
  /** Production is waiting for room (population). */
  stalled?: boolean;
}

/** What a client is told about its own side. */
export interface SInfo {
  /** The player's own name (what units' and buildings' `owner` says). */
  me: string;
  faction: FactionId | null;
  team: number;
  res: Record<Res, number>;
  pop: number;
  popMax: number;
  mode: Mode;
  started: boolean;
  /** Host settings that change what the client offers. */
  pvp: boolean;
  raids: boolean;
}

/** Messages between the clients and the server, on the one channel. */
export type ToServer =
  | { t: 'mode'; m: Mode }
  | { t: 'faction'; f: FactionId }
  | { t: 'cmd'; u: number[]; c: 'move' | 'amove' | 'attack' | 'stop' | 'hold' | 'gather' | 'build' | 'farm' | 'follow' | 'return'; x?: number; y?: number; z?: number; e?: number; b?: number; q?: boolean }
  | { t: 'place'; type: string; x: number; z: number; rot: number; u: number[]; q?: boolean }
  | { t: 'train'; b: number; u: string }
  | { t: 'untrain'; b: number; i: number }
  | { t: 'rally'; b: number; x: number; y: number; z: number }
  | { t: 'demolish'; b: number }
  | { t: 'goto'; x: number; y: number; z: number };

export type ToClient =
  | { t: 'st'; s: SInfo }
  | { t: 'b'; list: BInfo[] }
  | { t: 'msg'; m: string; x?: number; z?: number; alert?: boolean }
  | { t: 'mode'; m: Mode };
