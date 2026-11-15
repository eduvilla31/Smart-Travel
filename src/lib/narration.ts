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
  // Still nothing: ask Wikidata which Wikipedias cover this place (OpenStreetMap often
  // only links the local-language article, e.g. Japanese in Japan).
  if (poi.wikidata && /^Q\d+$/.test(poi.wikidata)) {
    try {
      const d = await fetchJson<{ entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=sitelinks&sitefilter=${lang}wiki|enwiki&ids=${poi.wikidata}`,
      );
      const links = d.entities?.[poi.wikidata]?.sitelinks ?? {};
      if (links[`${lang}wiki`]) return { lang, title: links[`${lang}wiki`].title };
      if (links.enwiki) return { lang: 'en', title: links.enwiki.title };
    } catch {
      /* fall through */
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

// Sentences a listener enjoys: stories, superlatives, things to look at.
const LIVELY =
  /\b(legend|story|tale|myth|said to|believed|famous|known for|nicknamed|named after|oldest|tallest|largest|biggest|first|only|unique|hidden|secret|ghost|miracle|tradition|festival|ritual|view|views|overlook|statue|fresco|mosaic|painted|carved|gold|golden|tower|dome|bell|garden|visitors|pilgrims|emperor|king|queen|monk|artist|poet|built by|designed by|destroyed|fire|earthquake|war|survived|rebuilt|leyenda|historia|famos|conocid|más antigu|más alt|primer|único|vista|estatua|torre|cúpula|jardín|visitantes|rey|reina|artista|incendio|terremoto|guerra)/i;
// Sentences that sound like a register: administration, renovations, addresses, statistics.
const DRY =
  /\b(renovat|refurbish|restoration work|listed (building|as)|heritage register|cultural property|designated|administ|municipal|managed by|operated by|owned by|company|corporation|subsidiary|located at|address|postal|coordinates|population|census|square kilomet|hectares|km²|ward|district of|prefecture|county|line|platform|timetable|ridership|passengers|budget|million (yen|dollars|euros)|according to|citation|ISBN|retrieved|official website|is served by|bus stop|parking|admission fee|opening hours|renovación|restauración|administra|municipal|ubicad|dirección|población|habitantes|gestionad|propiedad de)/i;

/** How good a sentence is to listen to (higher is better). Exported for tests. */
export function sentenceScore(sentence: string, index: number): number {
  let score = 0;
  if (LIVELY.test(sentence)) score += 3;
  if (DRY.test(sentence)) score -= 4;
  const numbers = (sentence.match(/\d[\d.,]*/g) ?? []).length;
  if (numbers > 2) score -= numbers - 2; // lists of figures are hard to follow by ear
  const words = sentence.split(/\s+/).length;
  if (words > 45) score -= 2; // very long sentences lose the listener
  if (words < 6) score -= 1;
  return score - index * 0.15; // earlier sentences are usually more relevant
}

/** Pick the best sentences within a word budget, keeping their original order. */
function pick(list: { s: string; i: number }[], maxWords: number, minCount: number): { s: string; i: number }[] {
  const ranked = [...list].sort((a, b) => sentenceScore(b.s, b.i) - sentenceScore(a.s, a.i));
  const out: { s: string; i: number }[] = [];
  let words = 0;
  for (const c of ranked) {
    const w = c.s.split(/\s+/).length;
    if (out.length >= minCount && (words + w > maxWords || sentenceScore(c.s, c.i) < -2)) continue;
    out.push(c);
    words += w;
    if (words >= maxWords) break;
  }
  return out.sort((a, b) => a.i - b.i);
}

export function buildFromExtract(extract: string, name: string, lang: Lang, title = name) {
  const all = sentences(cleanForSpeech(bodyParagraphs(extract).join(' '))).map((s, i) => ({ s, i }));
  if (!all.length) return { short: '', long: undefined };
  // The first sentence says what the place is: always keep it, then add the liveliest ones.
  const [opening, ...rest] = all;
  const shortPicks = [opening, ...pick(rest.slice(0, 25), SHORT_WORDS - opening.s.split(/\s+/).length, 1)].sort((a, b) => a.i - b.i);
  const used = new Set(shortPicks.map((x) => x.i));
  const longPicks = pick(rest.filter((x) => !used.has(x.i)).slice(0, 60), LONG_WORDS, 2);
  const lead = lang === 'es' ? `Parada: ${name}.` : `Next stop: ${name}.`;
  // Skip the lead-in when the first sentence already names the place.
  const first = opening.s.toLowerCase();
  const namesIt = [name, title].some((n) => first.includes(n.toLowerCase().split(/ \(|,/)[0]));
  const short = shortPicks.map((x) => x.s).join(' ');
  const long = longPicks.map((x) => x.s).join(' ');
  return {
    short: namesIt ? short : `${lead} ${short}`,
    long: long || undefined,
  };
}

function seedNarration(poi: Poi, lang: Lang, label: string): Narration | null {
  const t = poi.text?.[lang] ?? poi.text?.en;
  if (!t) return null;
  const textLang: Lang = poi.text?.[lang] ? lang : 'en';
  // A Spanish entry without a long text borrows nothing: the long version stays empty.
  return { short: t.short, long: t.long, lang: textLang, sourceLabel: poi.source === 'wiki' ? 'Wikipedia (EN)' : label, sourceUrl: poi.osmUrl };
}

/**
 * Narration for a stop. Wikipedia first (facts come only from the article),
 * then the hand-written seed notes, then a minimal line from the name.
 */
export async function getNarration(poi: Poi, lang: Lang, seedLabel: string): Promise<Narration> {
  const key = `narr:v4:${lang}:${poi.id}`;
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
        const built = buildFromExtract(page.extract, poi.name[target.lang] ?? poi.name.en, target.lang, page.title);
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
