// The schematics this browser keeps (IndexedDB): saved from the world or imported from files. Every world and
// server this player joins sees the same library, like Litematica's schematics folder.
import type { Schematic } from './model';
import { bounds, countBlocks } from './model';

export interface Summary {
  id: string;
  name: string;
  author: string;
  size: [number, number, number];
  blocks: number;
  regions: number;
  source: Schematic['source'];
  modified: number;
}

const DB = 'blueprints', STORE = 'schematics', LIST = 'summaries';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.result.createObjectStore(LIST, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(mode: IDBTransactionMode) {
  return (await open()).transaction([STORE, LIST], mode);
}

export function summarize(s: Schematic): Summary {
  return { id: s.id, name: s.name, author: s.author, size: bounds(s).size, blocks: countBlocks(s), regions: s.regions.length, source: s.source, modified: s.modified };
}

/** Every schematic, newest first (summaries only: the blocks stay on disk until one is loaded). */
export async function list(): Promise<Summary[]> {
  const all = await req((await tx('readonly')).objectStore(LIST).getAll() as IDBRequest<Summary[]>);
  return all.sort((a, b) => b.modified - a.modified);
}

/** Store a schematic (gives it an id if it has none); returns the id. */
export async function put(s: Schematic): Promise<string> {
  if (!s.id) s.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const t = await tx('readwrite');
  t.objectStore(STORE).put(s);
  t.objectStore(LIST).put(summarize(s));
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  cache.set(s.id, s);
  return s.id;
}

const cache = new Map<string, Schematic>();
export async function get(id: string): Promise<Schematic | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const s = (await req((await tx('readonly')).objectStore(STORE).get(id))) as Schematic | undefined;
  if (s) cache.set(id, s);
  return s ?? null;
}

export async function remove(id: string) {
  const t = await tx('readwrite');
  t.objectStore(STORE).delete(id);
  t.objectStore(LIST).delete(id);
  cache.delete(id);
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

export async function rename(id: string, name: string) {
  const s = await get(id);
  if (!s) return;
  s.name = name;
  s.modified = Date.now();
  await put(s);
}
