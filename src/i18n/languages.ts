// Loading a language: its table (a chunk of its own) and the glyphs its text needs.
import { useTable, language, type LangCode } from './i18n';
import { loadGlyphSet } from '../ui/unifont';

const TABLES: Record<Exclude<LangCode, 'en_us'>, () => Promise<{ default: Record<string, string> }>> = {
  zh_cn: () => import('./zh_cn'),
  zh_tw: () => import('./zh_tw'),
};

/** Switch the game's language (an unknown code means English). Resolves once its text and glyphs are in. */
export async function setLanguage(code: string): Promise<void> {
  const load = TABLES[code as keyof typeof TABLES];
  if (!load) {
    useTable('en_us', null);
    return;
  }
  if (code === language()) return;
  const [mod] = await Promise.all([load(), loadGlyphSet(code)]);
  useTable(code as LangCode, mod.default);
}
