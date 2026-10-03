// Mod settings: a mod declares a schema, gets an object of live values, and the Mods screen builds a settings
// page from the schema (Cloth Config / Mod Menu style). Values are this browser's, kept in localStorage.

export type ConfigEntry =
  | { type: 'boolean'; default: boolean; label?: string; description?: string }
  | { type: 'number'; default: number; min: number; max: number; step?: number; label?: string; description?: string }
  | { type: 'enum'; default: string; options: string[]; labels?: string[]; label?: string; description?: string }
  | { type: 'string'; default: string; maxLength?: number; label?: string; description?: string }
  /** A key binding: a KeyboardEvent.code such as 'KeyM'. */
  | { type: 'key'; default: string; label?: string; description?: string };
export type ConfigSchema = Record<string, ConfigEntry>;
type ValueOf<E extends ConfigEntry> = E extends { type: 'boolean' } ? boolean : E extends { type: 'number' } ? number : string;
export type ConfigValues<S extends ConfigSchema> = { [K in keyof S]: ValueOf<S[K]> };

export interface ModConfig { mod: string; schema: ConfigSchema; values: Record<string, unknown>; save(): void; reset(): void; listeners: (() => void)[] }
export const CONFIGS = new Map<string, ModConfig>();

const storeKey = (mod: string) => 'mcw.modcfg.' + mod;
/** Values handed to workers (they have no localStorage of their own to read). */
export let workerConfigValues: Record<string, Record<string, unknown>> = {};
export const setWorkerConfigValues = (v: Record<string, Record<string, unknown>>) => { workerConfigValues = v; };

function valid(e: ConfigEntry, v: unknown): boolean {
  switch (e.type) {
    case 'boolean': return typeof v === 'boolean';
    case 'number': return typeof v === 'number' && Number.isFinite(v) && v >= e.min && v <= e.max;
    case 'enum': return typeof v === 'string' && e.options.includes(v);
    default: return typeof v === 'string';
  }
}

export function defineConfig<S extends ConfigSchema>(mod: string, schema: S): ConfigValues<S> {
  let stored: Record<string, unknown> = workerConfigValues[mod] ?? {};
  try {
    if (typeof localStorage !== 'undefined') stored = JSON.parse(localStorage.getItem(storeKey(mod)) ?? '{}') ?? {};
  } catch { /* corrupt: defaults */ }
  const values: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(schema)) values[k] = valid(e, stored[k]) ? stored[k] : e.default;
  const cfg: ModConfig = {
    mod, schema, values, listeners: [],
    save() {
      try { localStorage.setItem(storeKey(mod), JSON.stringify(values)); } catch { /* private mode */ }
      for (const l of cfg.listeners) l();
    },
    reset() {
      for (const [k, e] of Object.entries(schema)) values[k] = e.default;
      cfg.save();
    },
  };
  CONFIGS.set(mod, cfg);
  return values as ConfigValues<S>;
}

export function allConfigValues(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [m, c] of CONFIGS) out[m] = { ...c.values };
  return out;
}
