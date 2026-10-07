// IndexedDB persistence for worlds, chunks and player data.

const DB_NAME = 'webcraft';
const DB_VERSION = 3;

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  gameMode: number; // 0 survival, 1 creative
  hardcore: boolean;
  created: number;
  lastPlayed: number;
  time: number;
  player?: unknown;
  spawn?: [number, number, number];
  difficulty?: number;
  entities?: unknown[];
  netherEntities?: unknown[];
  dimension?: 'overworld' | 'nether' | 'end';
  endEntities?: unknown[];
  dragonKilled?: boolean;
  /** The first dragon died but the fountain wasn't loaded yet: the egg still has to be placed. */
  dragonEggPending?: boolean;
  enderChest?: unknown[];
  endPoemSeen?: boolean;
  /** End gateways opened by dragon kills and their return gateways on the outer islands. */
  gateways?: import('./gateways').Gateway[];
  /** Islands made for gateways that pointed into empty void, built once their chunk loads. */
  endIslands?: { x: number; y: number; z: number; seed: number; built?: boolean }[];
  achievements?: string[];
  /** Everyone else who has played here (multiplayer), by name: position, inventory, dimension, achievements. */
  players?: Record<string, Record<string, unknown>>;
  /** The terrain generator version the world was made with (worlds from before this was recorded count as 1). */
  generatorVersion?: number;
  /** Let players other than the host use commands. */
  cheatsForAll?: boolean;
  /** Game rule keepInventory: players keep their items and experience when they die. */
  keepInventory?: boolean;
  /** Mods: which id each mod block / item key has in this world (see mod/registry.ts). */
  registry?: import('../mod/registry').RegistryMap;
  /** Mods last played with, id -> version (to warn when one is missing). */
  mods?: Record<string, string>;
  /** Mods' own per-world data (ModContext.worldData), by mod id. */
  modData?: Record<string, unknown>;
  /** Sub-levels: how many shipyard plots have been handed out (plots aren't reused). */
  plots?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      // downloaded / imported mods, by the SHA-256 of their code
      if (!db.objectStoreNames.contains('mods')) db.createObjectStore('mods', { keyPath: 'sha256' });
      // resource and shader packs, the same way
      if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'sha256' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // a newer version of the game in another tab wants to upgrade the database: let it (we reopen on next use)
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('Storage: waiting for another tab with an older version of the game to close');
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        let result: T;
        if (r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const Storage = {
  async listWorlds(): Promise<WorldMeta[]> {
    try {
      const all = await tx<WorldMeta[]>('worlds', 'readonly', (s) => s.getAll() as IDBRequest<WorldMeta[]>);
      return (all ?? []).sort((a, b) => b.lastPlayed - a.lastPlayed);
    } catch {
      return [];
    }
  },
  saveWorld(meta: WorldMeta) {
    return tx('worlds', 'readwrite', (s) => s.put(meta)).catch(() => undefined);
  },
  async deleteWorld(id: string) {
    await tx('worlds', 'readwrite', (s) => s.delete(id));
    await tx('chunks', 'readwrite', (s) => s.delete(IDBKeyRange.bound(id + ':', id + ':￿')));
  },
  async chunkKeys(worldId: string): Promise<Set<string>> {
    try {
      const keys = await tx<IDBValidKey[]>('chunks', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(worldId + ':', worldId + ':￿')));
      return new Set((keys ?? []).map((k) => String(k).slice(worldId.length + 1)));
    } catch {
      return new Set();
    }
  },
  loadChunk(worldId: string, key: string): Promise<SavedChunk | undefined> {
    return tx<SavedChunk>('chunks', 'readonly', (s) => s.get(worldId + ':' + key) as IDBRequest<SavedChunk>).catch(() => undefined);
  },
  getMod(sha: string): Promise<import('../mod/types').ModPackage | undefined> {
    return tx<import('../mod/types').ModPackage>('mods', 'readonly', (s) => s.get(sha) as IDBRequest<import('../mod/types').ModPackage>).catch(() => undefined);
  },
  putMod(pkg: import('../mod/types').ModPackage) {
    return tx('mods', 'readwrite', (s) => s.put(pkg));
  },
  deleteMod(sha: string) {
    return tx('mods', 'readwrite', (s) => s.delete(sha)).catch(() => undefined);
  },
  async listMods(): Promise<import('../mod/types').ModPackage[]> {
    try {
      return (await tx<import('../mod/types').ModPackage[]>('mods', 'readonly', (s) => s.getAll() as IDBRequest<import('../mod/types').ModPackage[]>)) ?? [];
    } catch {
      return [];
    }
  },
  getPack(sha: string): Promise<import('../packs/types').PackPackage | undefined> {
    return tx<import('../packs/types').PackPackage>('packs', 'readonly', (s) => s.get(sha) as IDBRequest<import('../packs/types').PackPackage>).catch(() => undefined);
  },
  putPack(pkg: import('../packs/types').PackPackage) {
    return tx('packs', 'readwrite', (s) => s.put(pkg));
  },
  deletePack(sha: string) {
    return tx('packs', 'readwrite', (s) => s.delete(sha)).catch(() => undefined);
  },
  async listPacks(): Promise<import('../packs/types').PackPackage[]> {
    try {
      return (await tx<import('../packs/types').PackPackage[]>('packs', 'readonly', (s) => s.getAll() as IDBRequest<import('../packs/types').PackPackage[]>)) ?? [];
    } catch {
      return [];
    }
  },
  saveChunks(worldId: string, list: [string, SavedChunk][]) {
    if (!list.length) return Promise.resolve();
    return tx('chunks', 'readwrite', (s) => {
      for (const [k, v] of list) s.put(v, worldId + ':' + k);
    }).catch((e) => console.warn('save failed', e));
  },
};

/** A chunk's generated state: its hash, and the original values at the indices players changed. */
export interface SavedBase { h: number; i: Uint16Array; v: Uint16Array }

export interface SavedChunk {
  blocks: Uint16Array; // RLE encoded pairs (value, count)
  biomes: Uint8Array;
  tiles?: unknown;
  /** Saves from before multiplayer deltas don't have it (the server regenerates the chunk to work it out). */
  base?: SavedBase;
}

export function rleEncode(a: Uint16Array): Uint16Array {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return Uint16Array.from(out);
}

export function rleDecode(r: Uint16Array, size: number): Uint16Array {
  const out = new Uint16Array(size);
  let o = 0;
  for (let i = 0; i < r.length; i += 2) {
    out.fill(r[i], o, o + r[i + 1]);
    o += r[i + 1];
  }
  return out;
}
