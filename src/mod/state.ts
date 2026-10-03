// Which mods are in play right now, and what went wrong with them. Shared by every part of the mod system.

export const modState = {
  /** Mods active in this session: their content is bound to ids and their hooks run. Others may be loaded but sleep. */
  active: new Set<string>(),
  /** 'page' (the game itself) or 'worker' (mesher / terrain generator threads). */
  realm: 'page' as 'page' | 'worker',
  /** Recent errors per mod, shown in the Mods screen. */
  errors: new Map<string, string[]>(),
};

/** Hooks without a mod (the game's own) always run. */
export const isActive = (mod: string | null | undefined) => !mod || modState.active.has(mod);

export function reportError(mod: string | null, where: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[mod ${mod ?? '?'}] ${where}:`, e);
  if (!mod) return;
  const list = modState.errors.get(mod) ?? [];
  list.push(`${where}: ${msg}`);
  if (list.length > 20) list.shift();
  modState.errors.set(mod, list);
}

/** Run a mod's code: an error is reported against the mod and the game carries on with `fallback`. */
export function guard<T>(mod: string | null | undefined, where: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    reportError(mod ?? null, where, e);
    return fallback;
  }
}
