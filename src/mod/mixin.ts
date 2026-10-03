// Mixins, the browser way: wrap any method of any game class (or object) with code that runs before it, after it,
// or around it. Like Fabric's Mixin injections, several mods can hook the same method; each injection belongs to a
// mod and is skipped while that mod isn't active, and a throwing injection is reported without breaking the game.
import { isActive, reportError } from './state';

/** Passed to `before` injections: cancel() skips the original method (and later injections), returning `value`. */
export interface CallbackInfo<R> { cancelled: boolean; value: R | undefined; cancel(value?: R): void }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...a: any[]) => any;

export interface Injection<T, F extends AnyFn> {
  /** Before the method: may cancel it. */
  before?(self: T, args: Parameters<F>, ci: CallbackInfo<ReturnType<F>>): void;
  /** After it: may replace the return value by returning something other than undefined. */
  after?(self: T, ret: ReturnType<F>, args: Parameters<F>): ReturnType<F> | void;
  /** Instead of it: call `original(...args)` (or not) yourself. */
  around?(self: T, original: F, args: Parameters<F>): ReturnType<F>;
  /** Higher runs first (outermost). */
  priority?: number;
}

interface Entry { mod: string; inj: Injection<unknown, AnyFn>; priority: number }
const CHAINS = Symbol('mixins');

type Hooked = AnyFn & { [CHAINS]?: Entry[] };

/**
 * Hook `target[method]`. For a class's methods pass its prototype (`mc.Player.prototype`); statics: the class.
 * Returns a function that removes the injection.
 */
export function inject<T extends object, K extends keyof T>(mod: string, target: T, method: K, inj: T[K] extends AnyFn ? Injection<T, T[K]> : never): () => void {
  const host = target as unknown as Record<PropertyKey, Hooked>;
  let fn = host[method as PropertyKey];
  if (typeof fn !== 'function') throw new Error(`mixin: ${String(method)} is not a method`);
  if (!fn[CHAINS] || !Object.prototype.hasOwnProperty.call(host, method)) {
    const original = fn as AnyFn;
    const chain: Entry[] = [];
    const wrapper: Hooked = function (this: unknown, ...args: unknown[]) {
      return run(chain, 0, this, original, args);
    };
    wrapper[CHAINS] = chain;
    Object.defineProperty(wrapper, 'name', { value: original.name });
    host[method as PropertyKey] = wrapper;
    fn = wrapper;
  }
  const chain = fn[CHAINS]!;
  const e: Entry = { mod, inj: inj as Injection<unknown, AnyFn>, priority: inj.priority ?? 0 };
  const i = chain.findIndex((o) => o.priority < e.priority);
  if (i < 0) chain.push(e);
  else chain.splice(i, 0, e);
  return () => { const k = chain.indexOf(e); if (k >= 0) chain.splice(k, 1); };
}

function run(chain: Entry[], i: number, self: unknown, original: AnyFn, args: unknown[]): unknown {
  // skip injections of inactive mods
  while (i < chain.length && !isActive(chain[i].mod)) i++;
  if (i >= chain.length) return original.apply(self, args);
  const { mod, inj } = chain[i];
  let called = false;
  const next = (...a: unknown[]) => { called = true; return run(chain, i + 1, self, original, a); };
  if (inj.before) {
    const ci: CallbackInfo<unknown> = { cancelled: false, value: undefined, cancel(v) { this.cancelled = true; this.value = v; } };
    try { inj.before(self, args as never, ci); } catch (e) { reportError(mod, 'mixin before', e); }
    if (ci.cancelled) return ci.value;
  }
  let ret: unknown;
  if (inj.around) {
    try { ret = inj.around(self, next as AnyFn, args as never); } catch (e) { reportError(mod, 'mixin around', e); if (!called) ret = next(...args); }
  } else ret = next(...args);
  if (inj.after) {
    try {
      const r = inj.after(self, ret as never, args as never);
      if (r !== undefined) ret = r;
    } catch (e) { reportError(mod, 'mixin after', e); }
  }
  return ret;
}
