import { fmtDuration, loc, type T } from '../i18n';
import type { Lang, PlannedRoute } from '../types';
import { getNarration } from './narration';
import * as speech from './speech';

/** The welcome line spoken when a tour starts (also prepared in advance). */
export function introText(route: PlannedRoute, lang: Lang, t: T): string {
  const first = route.stops[0];
  return t('tourIntro', {
    title: route.title,
    n: route.stops.length,
    time: fmtDuration(route.totalMin, t),
    first: first ? loc(first.name, lang) : '',
  });
}

/**
 * Prepare the start of a walk with the natural voice while the user is still
 * looking at the routes: the welcome, the first two stories and their "Next" lines.
 */
export async function prepareRouteStart(route: PlannedRoute, lang: Lang, t: T, seedLabel: string) {
  if (lang !== 'en') return;
  speech.prefetch([introText(route, lang, t)], lang);
  const first = route.stops.slice(0, 2);
  for (const [i, s] of first.entries()) {
    const n = await getNarration(s, lang, seedLabel).catch(() => null);
    const next = route.stops[i + 1];
    const texts = [n?.lang === 'en' ? n.short : '', next ? `${t('next')}: ${loc(next.name, 'en')}.` : t('allDone')];
    speech.prefetch(texts.filter(Boolean), lang);
  }
}
