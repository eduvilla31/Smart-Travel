import type { Lang, Poi } from '../types';
import { apiPost, hasApi } from './api';
import { loadCached, saveCached } from './storage';

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

export const NOTE_ICON: Record<ContextNote['type'], string> = {
  strike: '✊', demonstration: '📢', closure: '🚧', transport: '🚋', event: '🎉', market: '🧺', other: 'ℹ️',
};

/** Local date in the city, YYYY-MM-DD. */
export function cityDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Today's strikes, closures and events (server-side web search). Cached for 3 hours. */
export async function fetchCityContext(city: string, timezone: string, lang: Lang, stops: Poi[]): Promise<ContextNote[]> {
  if (!hasApi()) return [];
  const date = cityDate(timezone);
  const key = `context:v1:${city}:${date}:${lang}`;
  const hit = loadCached<ContextNote[]>(key, 3 * 3600 * 1000);
  if (hit) return hit;
  const res = await apiPost<{ notes: ContextNote[] }>(
    '/context',
    { date, lang, city, stops: stops.map((s) => ({ id: s.id, name: s.name.en })) },
    90000,
  );
  // Rule: a note without a source link is never shown.
  const notes = res.notes.filter((n) => /^https?:\/\//.test(n.sourceUrl));
  saveCached(key, notes);
  return notes;
}
