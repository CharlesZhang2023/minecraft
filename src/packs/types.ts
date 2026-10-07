// Resource packs (textures, in the vanilla Java Edition format) and shader packs (WGSL programs for the WebGPU
// renderer). Both come from the pack repository next to the game (packs/index.json) or from a file, and are kept
// in the browser like mods.

export type PackKind = 'resource' | 'shader';

export interface PackManifest {
  id: string;
  kind: PackKind;
  version: string;
  name?: string;
  description?: string;
  authors?: string[];
  /** A data: URL (the pack's pack.png) or a #rrggbb colour. */
  icon?: string;
  /** Where it came from, for packs made by other people (shown in the list). */
  credit?: string;
}

/** A pack kept in this browser. Resource packs are their zip; shader packs their bundle (JSON text). */
export interface PackPackage {
  manifest: PackManifest;
  sha256: string;
  data: ArrayBuffer;
  source: 'repo' | 'file';
  added: number;
}

export interface PackRepoEntry extends PackManifest { sha256: string; size: number; file: string }
export interface PackRepoIndex { schemaVersion: 1; packs: PackRepoEntry[] }

// ------------------------------------------------------------------ shader packs

/** A shader setting: shown on the pack's settings screen, and a `const` with its id in every program. */
export type ShaderSetting =
  | { id: string; name: string; type: 'bool'; default: boolean; description?: string }
  | { id: string; name: string; type: 'number'; default: number; min: number; max: number; step?: number; description?: string }
  | { id: string; name: string; type: 'enum'; default: number; options: number[]; labels?: string[]; description?: string };

export type SettingValue = boolean | number;
/** A number, or the id of a setting giving it. */
export type Ref<T> = T | string;

/** A full-screen pass after the world is drawn. */
export interface ShaderPass {
  name: string;
  file: string;
  /** Textures it reads, as `<name>Tex`: 'scene' (the world), earlier passes, or `<pass>Prev` for a pass with `history`. */
  inputs?: string[];
  /** Its size against the screen (bloom passes are smaller). */
  scale?: number;
  /** A bool setting turning it on and off (it then passes its first input through). */
  enabled?: string;
  /** Keep last frame's output (as `<name>Prev`): temporal effects. */
  history?: boolean;
}

export interface ShaderManifest extends PackManifest {
  kind: 'shader';
  settings?: ShaderSetting[];
  /** Prepended to every program. */
  common?: string[];
  /** The world's shading: packShade (required), packWave, packTranslucent, packSky, packFog. */
  gbuffers: string;
  shadow?: { enabled?: Ref<boolean>; resolution?: Ref<number>; distance?: Ref<number> };
  passes?: ShaderPass[];
  /** The last pass, onto the screen. */
  final: string;
  /** Draw the game's own clouds (packs with volumetric clouds turn them off). */
  vanillaClouds?: Ref<boolean>;
  /** Draw the game's square sun (packs drawing the sun in their sky turn it off; the moon stays). */
  vanillaSun?: Ref<boolean>;
  /** Shift the view a fraction of a pixel each frame (for temporal anti-aliasing in the pack's passes). */
  jitter?: Ref<boolean>;
}

/** A shader pack as stored: its manifest and its files' text. */
export interface ShaderBundle { manifest: ShaderManifest; files: Record<string, string> }

/** A shader pack ready for the renderer: the bundle and the chosen settings. */
export interface ShaderPackSource { bundle: ShaderBundle; values: Record<string, SettingValue> }

export const VALID_PACK_ID = /^[a-z0-9_-]{1,40}$/;
