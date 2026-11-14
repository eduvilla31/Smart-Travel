/**
 * Smart Travel API: a small Cloudflare Worker that holds the Anthropic API key
 * and serves three endpoints to the PWA:
 *   POST /narrate   Wikipedia-grounded stop narration (short + long), cached 30 days
 *   POST /identify  photo + GPS + nearby candidates -> what am I looking at?
 *   POST /context   today's strikes / closures / events, via web search, cached 3 hours
 */
import Anthropic from '@anthropic-ai/sdk';
import { fetchArticle, resolveArticle, type WikiText } from './wiki';

export interface Env {
  ANTHROPIC_API_KEY: string;
  /** Comma-separated origins allowed to call the API (e.g. https://you.github.io). */
  ALLOWED_ORIGINS?: string;
  /** Optional shared code friends type into the app, so strangers can't spend your credits. */
  ACCESS_CODE?: string;
  /** Set to "true" to run without an access code (anyone with the URL can then spend your credits). */
  OPEN_ACCESS?: string;
  /** claude-haiku-5-5 (default, cheapest) or claude-opus-5-5 (best quality, about 40x the price). */
  MODEL?: string;
  /** Set when this code runs inside the phone app with the user's own key. */
  browser?: boolean;
}

const DEFAULT_MODEL = 'claude-haiku-5-5';
// On Opus, if a safety classifier declines a request, the API retries it on Anthropic's
// recommended fallback model. Haiku has no server-side fallback, so it is sent without.
const FALLBACK_BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01'];
const isHaiku = (model: string) => model.startsWith('claude-haiku');
const modelOf = (env: Env) => env.MODEL || DEFAULT_MODEL;
const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', de: 'German' };

type Lang = 'en' | 'es' | 'de';
type Params = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, 'model'>;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------- plumbing ----------

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] ?? 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cache a JSON result in the Workers cache, keyed by endpoint + request body. */
async function cached<T>(name: string, keyMaterial: string, ttlSec: number, make: () => Promise<T>): Promise<T> {
  // The cache is best-effort: if it is unavailable, just do the work.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`https://cache.smart-travel.internal/${name}/${await sha256(keyMaterial)}`);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit.json() as Promise<T>;
  const value = await make();
  await cache?.put(key, new Response(JSON.stringify(value), { headers: { 'Cache-Control': `max-age=${ttlSec}` } })).catch(() => undefined);
  return value;
}

async function ask(env: Env, params: Params): Promise<Anthropic.Beta.BetaMessage> {
  // In "own key" mode the app calls Claude straight from the phone; the key never leaves that device.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, dangerouslyAllowBrowser: !!env.browser });
  const model = modelOf(env);
  const res = await client.beta.messages.create({
    model,
    ...(isHaiku(model) ? {} : { betas: FALLBACK_BETAS, fallbacks: 'default' as const }),
    ...params,
  });
  if (res.stop_reason === 'refusal') throw new HttpError(422, 'The model declined this request.');
  return res;
}

function jsonOutput<T>(res: Anthropic.Beta.BetaMessage): T {
  const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
  if (!text) throw new HttpError(502, 'No answer from the model.');
  return JSON.parse(text.text) as T;
}

const asLang = (l: unknown): Lang => (l === 'es' || l === 'de' ? l : 'en');

/** Keep user- and map-supplied text from breaking out of the prompt's XML tags. */
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// ---------- /narrate ----------

interface NarrateIn { name: string; wiki?: string[]; lang?: string; facts?: string }
export interface NarrateOut { short: string; long: string; lang: Lang; sourceUrl?: string; sourceLabel: string }

const NARRATE_SCHEMA = {
  type: 'object',
  properties: {
    short: { type: 'string', description: 'About 80 words, 30 to 60 seconds spoken.' },
    long: { type: 'string', description: 'About 300 words that continue the short text without repeating it. Empty if the source has nothing more.' },
  },
  required: ['short', 'long'],
  additionalProperties: false,
} as const;

function narrationSystem(lang: Lang): string {
  return [
    `You write narration for a self-guided audio walking tour. It is read aloud by a phone's text-to-speech voice to someone standing in front of the place, wearing headphones. Write in ${LANG_NAME[lang]}.`,
    'Sound like a friendly local guide talking, not an encyclopedia: short spoken sentences, one or two memorable facts, and a hint of what to look at when the source mentions something visible.',
    'Use only facts stated in the SOURCE text. Do not add dates, names, numbers or claims that are not in it. If the source is thin, write less rather than filling in.',
    'Plain text only: no markdown, lists, headings, parentheses, pronunciation guides or reference marks. Write numbers and years the way they should be spoken.',
  ].join('\n');
}

async function narrate(env: Env, input: NarrateIn): Promise<NarrateOut> {
  const lang = asLang(input.lang);
  if (!input.name) throw new HttpError(400, 'name is required');
  input = { ...input, name: clean(input.name), facts: input.facts?.slice(0, 6000), wiki: (input.wiki ?? []).slice(0, 6).map((w) => clean(w)) };
  let source: WikiText | null = null;
  const target = input.wiki?.length ? await resolveArticle(input.wiki, lang) : null;
  if (target) source = await fetchArticle(target.lang, target.title, { maxChars: 10000 }).catch(() => null);
  const text = source?.text ?? input.facts ?? '';
  if (text.length < 80) throw new HttpError(404, 'No source text for this place.');

  const res = await ask(env, {
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: NARRATE_SCHEMA } },
    system: narrationSystem(lang),
    messages: [
      {
        role: 'user',
        content: `PLACE: ${input.name}\n\nSOURCE${source ? ` (Wikipedia, ${source.lang}: ${source.title})` : ''}:\n<source>\n${text}\n</source>\n\nWrite the short and the long narration for this stop.`,
      },
    ],
  });
  const out = jsonOutput<{ short: string; long: string }>(res);
  return {
    short: out.short.trim(),
    long: out.long.trim(),
    lang,
    sourceUrl: source?.url,
    sourceLabel: source ? `Wikipedia (${source.lang.toUpperCase()}): ${source.title}` : 'Smart Travel notes',
  };
}

// ---------- /identify ----------

interface Candidate { id: string; name: string; wiki?: string[]; distanceM: number; bearingDeg: number; facts?: string }
interface IdentifyIn {
  image: string; // base64, no data: prefix
  mediaType?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number | null;
  lang?: string;
  city?: string;
  candidates: Candidate[];
}
export interface IdentifyOut {
  status: 'identified' | 'uncertain' | 'not_found';
  candidateId: string | null;
  name: string;
  short: string;
  alternatives: { candidateId: string; name: string }[];
  sourceUrl?: string;
  lang: Lang;
}

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['identified', 'uncertain', 'not_found'] },
    candidateId: { type: 'string', description: 'id of the identified candidate, or empty string' },
    name: { type: 'string' },
    short: { type: 'string', description: 'Two or three spoken sentences.' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: { candidateId: { type: 'string' }, name: { type: 'string' } },
        required: ['candidateId', 'name'],
        additionalProperties: false,
      },
    },
  },
  required: ['status', 'candidateId', 'name', 'short', 'alternatives'],
  additionalProperties: false,
} as const;

function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

async function identify(env: Env, input: IdentifyIn): Promise<IdentifyOut> {
  const lang = asLang(input.lang);
  if (typeof input.image !== 'string' || !input.image || input.image.length > 2_800_000) throw new HttpError(400, 'Image missing or larger than about 2 MB.');
  if (!isNum(input.lat) || !isNum(input.lng)) throw new HttpError(400, 'lat and lng are required');
  const mediaType = (['image/jpeg', 'image/png', 'image/webp'] as const).find((m) => m === input.mediaType) ?? 'image/jpeg';
  const city = clean(input.city || 'the city', 60);
  const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
    .slice(0, 10)
    .filter((c) => c && typeof c.id === 'string' && isNum(c.distanceM) && isNum(c.bearingDeg))
    .map((c) => ({ ...c, id: clean(c.id, 80), name: clean(c.name), wiki: (c.wiki ?? []).slice(0, 6).map((w) => clean(w)) }));

  // Short facts for the closest candidates, fetched in parallel.
  const facts = await Promise.all(
    candidates.map(async (c, i) => {
      if (i >= 6 || !c.wiki?.length) return c.facts ? { text: c.facts.slice(0, 1200) } : null;
      try {
        const t = await resolveArticle(c.wiki, lang);
        const a = t && (await fetchArticle(t.lang, t.title, { intro: true, maxChars: 1500 }));
        return a ? { text: a.text, url: a.url } : c.facts ? { text: c.facts.slice(0, 1200) } : null;
      } catch {
        return c.facts ? { text: c.facts.slice(0, 1200) } : null;
      }
    }),
  );

  const list = candidates
    .map((c, i) => {
      const dir = `${Math.round(c.distanceM)} m ${compass(c.bearingDeg)} (bearing ${Math.round(c.bearingDeg)}°)`;
      return `<candidate id="${c.id}" name="${c.name}" position="${dir}">\n${facts[i]?.text ?? '(no facts available)'}\n</candidate>`;
    })
    .join('\n');
  const heading = typeof input.heading === 'number' ? `${Math.round(input.heading)}° (${compass(input.heading)})` : 'unknown';

  const res = await ask(env, {
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: IDENTIFY_SCHEMA } },
    system: [
      `You identify buildings, statues and monuments in photos taken by a tourist in ${city}. Answer in ${LANG_NAME[lang]}.`,
      'You get the photo, the phone position, compass heading (may be unknown or off by 30°), and nearby places with their distance and direction.',
      'Say "identified" only when the photo clearly matches one candidate AND its position is consistent with where the phone is pointing. Otherwise say "uncertain" and give the two most likely candidates in alternatives. Say "not_found" if no candidate fits.',
      "The short text is two or three sentences to be read aloud. Use only facts from that candidate's text; you may describe what is visible in the photo. When uncertain, say you're not sure and name the two options. Plain text, no markdown.",
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: input.image } },
          {
            type: 'text',
            text: `Phone position: ${input.lat.toFixed(5)}, ${input.lng.toFixed(5)} (±${Math.round(input.accuracy ?? 30)} m). Facing: ${heading}.\n\nNearby places:\n${list || '(none)'}\n\nWhat is in the photo?`,
          },
        ],
      },
    ],
  });
  const out = jsonOutput<Omit<IdentifyOut, 'sourceUrl' | 'lang'>>(res);
  const known = new Set(candidates.map((c) => c.id));
  const idx = candidates.findIndex((c) => c.id === out.candidateId);
  return {
    status: out.status,
    candidateId: known.has(out.candidateId ?? '') ? out.candidateId : null,
    name: out.name,
    short: out.short,
    alternatives: out.alternatives.filter((a) => known.has(a.candidateId)).slice(0, 2),
    sourceUrl: idx >= 0 ? facts[idx]?.url : undefined,
    lang,
  };
}

// ---------- /context ----------

interface ContextIn { date: string; lang?: string; city?: string; country?: string; stops?: { id: string; name: string }[] }
export interface ContextNote {
  type: 'strike' | 'demonstration' | 'closure' | 'transport' | 'event' | 'market' | 'other';
  effect: 'blocks' | 'enriches' | 'info';
  title: string;
  summary: string;
  area: string;
  timeWindow: string;
  affectsStopIds: string[];
  sourceUrl: string;
  sourceTitle: string;
}

const REPORT_TOOL: Anthropic.Beta.BetaTool = {
  name: 'report_context',
  description: 'Report what is happening in the city today that matters to someone on a walking tour. Call this exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['strike', 'demonstration', 'closure', 'transport', 'event', 'market', 'other'] },
            effect: { type: 'string', enum: ['blocks', 'enriches', 'info'], description: 'blocks = walkers should avoid the affected stops' },
            title: { type: 'string' },
            summary: { type: 'string', description: 'One sentence.' },
            area: { type: 'string' },
            timeWindow: { type: 'string' },
            affectsStopIds: { type: 'array', items: { type: 'string' } },
            sourceUrl: { type: 'string', description: 'URL of a search result that states this.' },
            sourceTitle: { type: 'string' },
          },
          required: ['type', 'effect', 'title', 'summary', 'area', 'timeWindow', 'affectsStopIds', 'sourceUrl', 'sourceTitle'],
          additionalProperties: false,
        },
      },
    },
    required: ['notes'],
    additionalProperties: false,
  },
};

async function cityContext(env: Env, input: ContextIn): Promise<{ date: string; notes: ContextNote[] }> {
  const lang = asLang(input.lang);
  const city = clean(input.city || 'Basel', 60);
  const country = clean(input.country || '', 60);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) throw new HttpError(400, 'date must be YYYY-MM-DD');
  const stops = (Array.isArray(input.stops) ? input.stops : []).slice(0, 80).map((s) => ({ id: clean(s.id, 80), name: clean(s.name) }));
  const stopList = stops.map((s) => `${s.id}: ${s.name}`).join('\n');

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content:
        `Today is ${input.date}. Search the web for anything happening in ${city}${country ? `, ${country}` : ''} today that affects or enriches a walking tour of the city centre: strikes, demonstrations, street or bridge closures, public transport disruptions, flooding or other weather warnings, markets, festivals, big sports events.\n\n` +
        `Tour stops (id: name):\n${stopList}\n\n` +
        `Only include items that a search result you actually found states, dated for today. Use that result's URL as sourceUrl. If nothing relevant is found, report an empty list. Write title and summary in ${LANG_NAME[lang]}. Then call report_context once.`,
    },
  ];
  // Haiku uses the basic web search tool; larger models get the newer one that filters results itself.
  const search: Anthropic.Beta.BetaToolUnion = isHaiku(modelOf(env))
    ? { type: 'web_search_20250305', name: 'web_search', max_uses: 6 }
    : { type: 'web_search_20260209', name: 'web_search', max_uses: 6 };
  const tools: Anthropic.Beta.BetaToolUnion[] = [search, REPORT_TOOL];

  const seenUrls = new Set<string>();
  let nudged = false;
  for (let turn = 0; turn < 6; turn++) {
    const res = await ask(env, { max_tokens: 16000, output_config: { effort: 'medium' }, tools, messages });
    for (const b of res.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) seenUrls.add(r.url);
    }
    const report = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'report_context');
    if (report) {
      const notes = ((report.input as { notes?: ContextNote[] }).notes ?? [])
        // Rule: no source link, no note. And the link must be one the search really returned.
        .filter((n) => /^https?:\/\//.test(n.sourceUrl) && seenUrls.has(n.sourceUrl))
        .map((n) => ({ ...n, affectsStopIds: n.affectsStopIds.filter((id) => stops.some((s) => s.id === id)) }));
      return { date: input.date, notes };
    }
    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'pause_turn') continue; // server-side search still running
    if (nudged) break;
    nudged = true;
    messages.push({ role: 'user', content: 'Please call report_context now with what you found (an empty list is fine).' });
  }
  return { date: input.date, notes: [] };
}

// ---------- router ----------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');

    try {
      if (req.method === 'GET' && (path === '' || path === '/health')) {
        return json({ ok: true, model: modelOf(env), accessCode: !!env.ACCESS_CODE }, 200, cors);
      }
      if (req.method !== 'POST') throw new HttpError(404, 'Not found');
      if (!env.ANTHROPIC_API_KEY) throw new HttpError(500, 'ANTHROPIC_API_KEY is not set on the worker.');
      // Locked by default: without an access code anyone who finds the URL could spend the owner's credits.
      if (!env.ACCESS_CODE && env.OPEN_ACCESS !== 'true') throw new HttpError(503, 'Server is locked: set the ACCESS_CODE secret (or OPEN_ACCESS="true").');
      if (env.ACCESS_CODE && req.headers.get('X-Access-Code') !== env.ACCESS_CODE) throw new HttpError(401, 'Wrong access code.');
      if (Number(req.headers.get('Content-Length') ?? 0) > 4_000_000) throw new HttpError(413, 'Request too large.');

      const raw = await req.text();
      const body = JSON.parse(raw || '{}');
      switch (path) {
        case '/narrate':
          return json(await cached('narrate-v2', modelOf(env) + raw, 30 * 86400, () => narrate(env, body)), 200, cors);
        case '/identify':
          return json(await identify(env, body), 200, cors);
        case '/context':
          return json(
            await cached('context-v2', JSON.stringify([modelOf(env), body.date, body.lang, body.city, body.country, (body.stops ?? []).length]), 3 * 3600, () => cityContext(env, body)),
            200,
            cors,
          );
        default:
          throw new HttpError(404, 'Not found');
      }
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      if (e instanceof Anthropic.RateLimitError) return json({ error: 'Rate limited, try again in a minute.' }, 429, cors);
      if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status}` }, 502, cors);
      if (e instanceof SyntaxError) return json({ error: 'Invalid JSON' }, 400, cors);
      return json({ error: 'Internal error' }, 500, cors);
    }
  },
};

export { narrate, identify, cityContext };
