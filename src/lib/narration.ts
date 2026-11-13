import type { Lang, Poi } from '../types';
import { fetchJson, loadCached, saveCached } from './storage';
import { apiPost, hasApi } from './api';

export interface Narration {
  short: string;
  long?: string;
  /** Language the text is actually in (may differ from the requested one). */
  lang: Lang;
  sourceUrl?: string;
  sourceLabel: string;
}

const WEEK = 7 * 24 * 3600 * 1000;
const SHORT_WORDS = 80;
const LONG_WORDS = 300;
const STOP_SECTIONS =
  /^(see also|references|notes|further reading|external links|literature|bibliography|véase también|referencias|enlaces externos|bibliografía|notas|siehe auch|literatur|weblinks|einzelnachweise|anmerkungen)$/i;

interface QueryPage {
  title: string;
  missing?: string;
  extract?: string;
  langlinks?: { lang: string; '*': string }[];
}
interface QueryRes { query?: { pages?: Record<string, QueryPage> } }

function api(lang: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ format: 'json', origin: '*', redirects: '1', ...params });
  return `https://${lang}.wikipedia.org/w/api.php?${q}`;
}

function firstPage(res: QueryRes): QueryPage | undefined {
  const pages = Object.values(res.query?.pages ?? {});
  return pages.find((p) => p.missing === undefined);
}

/** Find the article title in `lang`, starting from any known "xx:Title". */
async function resolveTitle(poi: Poi, lang: Lang): Promise<{ lang: Lang; title: string } | null> {
  const direct = poi.wiki.find((w) => w.startsWith(`${lang}:`));
  if (direct) return { lang, title: direct.slice(3) };
  for (const w of poi.wiki) {
    const [src, ...rest] = w.split(':');
    const title = rest.join(':');
    try {
      const res = await fetchJson<QueryRes>(api(src, { action: 'query', prop: 'langlinks', lllang: lang, titles: title }));
      const page = firstPage(res);
      const ll = page?.langlinks?.[0]?.['*'];
      if (ll) return { lang, title: ll };
    } catch {
      /* try next */
    }
  }
  // No article in the requested language: fall back to English, then any.
  const other = poi.wiki.find((w) => w.startsWith('en:')) ?? poi.wiki.find((w) => /^(en|es):/.test(w));
  if (other) return { lang: other.slice(0, 2) as Lang, title: other.slice(3) };
  return null;
}

/** Make an encyclopaedia extract easier to listen to. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, '') // [1], [citation needed]
    .replace(/\(([^()]*)\)/g, (_m, inner: string) =>
      // keep parentheses that carry dates, drop pronunciations / foreign names
      /\d{3,4}/.test(inner) && !/[;/ˈ]/.test(inner) ? `, ${inner},` : '',
    )
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Split into sentences without breaking on "St." or "c. 1400". */
export function sentences(text: string): string[] {
  const protectedText = text.replace(/\b(St|Dr|Mr|Mrs|ca|c|approx|bzw|Nr|z\.B|etc|Sr|Sra|av)\.\s/gi, '$1§ ');
  return (protectedText.match(/[^.!?]+[.!?]+["»”)]?(\s+|$)|[^.!?]+$/g) ?? [protectedText])
    .map((s) => s.replace(/§/g, '.').trim())
    .filter((s) => s.length > 1);
}

function takeWords(list: string[], from: number, maxWords: number, minSentences = 1) {
  const out: string[] = [];
  let words = 0;
  let i = from;
  for (; i < list.length; i++) {
    const w = list[i].split(/\s+/).length;
    if (out.length >= minSentences && words + w > maxWords) break;
    out.push(list[i]);
    words += w;
  }
  return { text: out.join(' '), next: i };
}

/** Body paragraphs of a plaintext extract (exsectionformat=wiki), headings removed. */
export function bodyParagraphs(extract: string): string[] {
  const paras: string[] = [];
  for (const raw of extract.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^=+\s*(.*?)\s*=+$/);
    if (h) {
      if (STOP_SECTIONS.test(h[1])) break;
      continue;
    }
    paras.push(line);
  }
  return paras;
}

export function buildFromExtract(extract: string, name: string, lang: Lang) {
  const all = sentences(cleanForSpeech(bodyParagraphs(extract).join(' ')));
  const s = takeWords(all, 0, SHORT_WORDS, 2);
  // The long version picks up where the short one stopped.
  const l = takeWords(all, s.next, LONG_WORDS, 2);
  const lead = lang === 'es' ? `Esto es ${name}.` : `This is ${name}.`;
  // Skip the lead-in when the first sentence already names the place.
  const core = name.toLowerCase().split(' (')[0];
  const namesIt = (all[0] ?? '').toLowerCase().includes(core);
  return {
    short: namesIt ? s.text : `${lead} ${s.text}`,
    long: l.text || undefined,
  };
}

function seedNarration(poi: Poi, lang: Lang, label: string): Narration | null {
  const t = poi.text?.[lang] ?? poi.text?.en;
  if (!t) return null;
  const textLang: Lang = poi.text?.[lang] ? lang : 'en';
  // A Spanish entry without a long text borrows nothing: the long version stays empty.
  return { short: t.short, long: t.long, lang: textLang, sourceLabel: label, sourceUrl: poi.osmUrl };
}

/**
 * Narration for a stop. Wikipedia first (facts come only from the article),
 * then the hand-written seed notes, then a minimal line from the name.
 */
export async function getNarration(poi: Poi, lang: Lang, seedLabel: string): Promise<Narration> {
  const key = `narr:v2:${lang}:${poi.id}`;
  const name = poi.name[lang] ?? poi.name.en;
  let result: Narration | null = loadCached<Narration>(key, WEEK);

  // 1. Claude, via the Smart Travel server, writing only from the Wikipedia article.
  if (!result && hasApi()) {
    try {
      const facts = poi.text?.[lang] ?? poi.text?.en;
      const r = await apiPost<Narration>(
        '/narrate',
        { name, wiki: poi.wiki, lang, facts: facts ? `${facts.short} ${facts.long ?? ''}`.trim() : undefined },
        45000,
      );
      if (r.short) {
        result = { ...r, long: r.long || undefined, sourceLabel: r.sourceUrl ? r.sourceLabel : seedLabel };
        saveCached(key, result);
      }
    } catch {
      /* server down or no source: fall back to the plain Wikipedia extract */
    }
  }

  // 2. The Wikipedia article itself, trimmed for speech.
  if (!result) try {
    const target = await resolveTitle(poi, lang);
    if (target) {
      const res = await fetchJson<QueryRes>(
        api(target.lang, { action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', titles: target.title }),
      );
      const page = firstPage(res);
      if (page?.extract && page.extract.length > 200) {
        const built = buildFromExtract(page.extract, poi.name[target.lang] ?? poi.name.en, target.lang);
        result = {
          ...built,
          lang: target.lang,
          sourceUrl: `https://${target.lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
          sourceLabel: `Wikipedia (${target.lang.toUpperCase()}): ${page.title}`,
        };
        // Only real Wikipedia results are cached, so an offline moment is retried later.
        saveCached(key, result);
      }
    }
  } catch {
    /* offline or blocked: fall through */
  }

  // Prefer the curated note when Wikipedia only had another language.
  const seeded = seedNarration(poi, lang, seedLabel);
  if (!result || (result.lang !== lang && seeded?.lang === lang)) result = seeded ?? result;
  return (
    result ?? {
      short: lang === 'es' ? `Esto es ${name}.` : `This is ${name}.`,
      lang,
      sourceLabel: 'OpenStreetMap',
      sourceUrl: poi.osmUrl,
    }
  );
}
