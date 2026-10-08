// Translations. The game's text is written in English, and the English is the key: `t('Done')` gives the chosen
// language's words for it, or the English when there are none. Placeholders {0}, {1}... are filled with the arguments.
//
// Text the server makes for a player (chat, the action bar, death messages) can't be translated where it's made: the
// players may each read a different language. `tm(...)` packs the English and its arguments into the string instead,
// and whoever shows it calls `localize`, which translates it there. Plain strings are looked up as they are.
//
// The language tables (src/i18n/<code>.ts, loaded when chosen: see languages.ts) map English to the translation; names
// of things (blocks, items, mobs...) are keyed by their English names too.

export type LangCode = 'en_us' | 'zh_cn' | 'zh_tw';

/** The languages to choose from, by their own names (the Language screen shows them in every language). */
export const LANGUAGES: { code: LangCode; name: string; region: string }[] = [
  { code: 'en_us', name: 'English', region: 'United States' },
  { code: 'zh_cn', name: '简体中文', region: '中国大陆' },
  { code: 'zh_tw', name: '繁體中文', region: '台灣' },
];

let table: Map<string, string> | null = null;
let current: LangCode = 'en_us';

/** Bumped whenever the language changes (for anything that keeps translated text around). */
export let langVersion = 0;

export function language(): LangCode { return current; }

/** Switch to a language whose table is loaded (null = English). */
export function useTable(code: LangCode, strings: Record<string, string> | null) {
  current = code;
  table = strings ? new Map(Object.entries(strings)) : null;
  langVersion++;
}

const START = '\u0001', END = '\u0002';

/** Words that mean different things in different places carry their kind: "effect:Wither" is not the mob, and a
 * command block's "mode:Chain" is not the block. */
const CONTEXT = /^(effect|enchantment|mode):(?=\S)/;

function lookup(en: string, tab: Map<string, string> | null): string {
  if (!tab) return en.replace(CONTEXT, '');
  const hit = tab.get(en);
  if (hit !== undefined) return hit;
  if (CONTEXT.test(en)) return lookup(en.replace(CONTEXT, ''), tab);
  // leading formatting codes ('§e' + words) and a trailing colon keep their words translatable
  const m = /^((?:§.)*)(.*?)(:?)$/s.exec(en)!;
  if (m[1] || m[3]) {
    const h = tab.get(m[2]);
    if (h !== undefined) return m[1] + h + (m[3] ? (/[　-鿿]$/.test(h) ? '：' : ':') : '');
  }
  return en;
}

function fill(s: string, args: unknown[], tab: Map<string, string> | null): string {
  return s.replace(/\{(\d+)\}/g, (all, n) => {
    const a = args[+n];
    if (a === undefined) return all;
    return typeof a === 'string' && a.includes(START) ? decode(a, tab) : String(a);
  });
}

/** This English in the current language, with {0}, {1}... filled in (arguments are shown as given, except messages
 * made with `tm`, which are translated too). */
export function t(en: string, ...args: unknown[]): string {
  const s = lookup(en, table);
  return args.length ? fill(s, args, table) : s;
}

/** A name of a kind whose English means something else elsewhere (see CONTEXT). */
export function tc(context: 'effect' | 'enchantment' | 'mode', en: string): string {
  return t(context + ':' + en);
}

/** A message to translate where it's shown (see the top of this file): English with {0}... and its arguments, which
 * can be messages too (`tm(item.display)` for a name to translate). */
export function tm(en: string, ...args: (string | number)[]): string {
  return START + JSON.stringify([en, ...args]) + END;
}

function decode(s: string, tab: Map<string, string> | null): string {
  if (!s.includes(START)) return lookup(s, tab);
  return s.replace(/\u0001(.*?)\u0002/gs, (all, json: string) => {
    try {
      const [en, ...args] = JSON.parse(json) as [string, ...unknown[]];
      return fill(lookup(en, tab), args, tab);
    } catch {
      return all;
    }
  });
}

/** Text to show (perhaps made with `tm`, perhaps plain English) in the current language. */
export function localize(s: string): string { return decode(s, table); }

/** The same in English (logs, tools). */
export function english(s: string): string { return decode(s, null); }
