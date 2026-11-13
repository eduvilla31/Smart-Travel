/** Wikipedia helpers: narration and photo answers are grounded only in this text. */

// Wikimedia asks automated clients to identify themselves with a generic agent string.
const UA = 'SmartTravel/0.6 (personal walking-tour app)';

export interface WikiText {
  title: string;
  lang: string;
  url: string;
  text: string;
}

interface QueryRes {
  query?: {
    pages?: Record<string, { title: string; missing?: string; extract?: string; langlinks?: { lang: string; '*': string }[] }>;
  };
}

async function query(lang: string, params: Record<string, string>, timeoutMs = 6000): Promise<QueryRes> {
  const q = new URLSearchParams({ format: 'json', redirects: '1', ...params });
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?${q}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  return res.json();
}

const page = (r: QueryRes) => Object.values(r.query?.pages ?? {}).find((p) => p.missing === undefined);

/** Resolve "xx:Title" entries to an article in `lang`, falling back to English, then any. */
export async function resolveArticle(wiki: string[], lang: string): Promise<{ lang: string; title: string } | null> {
  const direct = wiki.find((w) => w.startsWith(`${lang}:`));
  if (direct) return { lang, title: direct.slice(3) };
  for (const w of wiki) {
    const src = w.slice(0, 2);
    try {
      const p = page(await query(src, { action: 'query', prop: 'langlinks', lllang: lang, titles: w.slice(3) }));
      const ll = p?.langlinks?.[0]?.['*'];
      if (ll) return { lang, title: ll };
    } catch {
      /* next */
    }
  }
  const en = wiki.find((w) => w.startsWith('en:')) ?? wiki[0];
  return en ? { lang: en.slice(0, 2), title: en.slice(3) } : null;
}

const STOP = /^(see also|references|notes|further reading|external links|literature|bibliography|véase también|referencias|enlaces externos|bibliografía|notas|siehe auch|literatur|weblinks|einzelnachweise|anmerkungen)$/i;

/** Plain article text without reference sections, capped at `maxChars`. */
export async function fetchArticle(lang: string, title: string, opts: { intro?: boolean; maxChars?: number } = {}): Promise<WikiText | null> {
  const params: Record<string, string> = { action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'wiki', titles: title };
  if (opts.intro) params.exintro = '1';
  const p = page(await query(lang, params));
  if (!p?.extract) return null;
  const lines: string[] = [];
  for (const raw of p.extract.split('\n')) {
    const h = raw.trim().match(/^=+\s*(.*?)\s*=+$/);
    if (h && STOP.test(h[1])) break;
    lines.push(raw);
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, opts.maxChars ?? 12000);
  return {
    title: p.title,
    lang,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    text,
  };
}
