import { loc, type T } from '../i18n';
import type { Lang, PlannedRoute } from '../types';
import { getNarration } from './narration';
import { neuralPref, synthesize } from './neuralVoice';
import { chunkForVoice } from './speech';

export interface OfflineProgress { done: number; total: number; phase: 'stories' | 'voice' | 'done' }

/**
 * Get a walk ready to work without internet: every stop's story (short and long text)
 * and, with the natural voice on, the spoken audio. Map tiles are cached as they are
 * viewed (OpenStreetMap's rules don't allow bulk downloading).
 */
export async function saveForOffline(route: PlannedRoute, lang: Lang, t: T, onProgress: (p: OfflineProgress) => void): Promise<void> {
  const stops = route.stops;
  const natural = lang === 'en' && neuralPref().on;
  const voiceTexts: string[] = [];
  const total = stops.length + (natural ? stops.length * 2 : 0);
  let done = 0;
  const tick = (phase: OfflineProgress['phase']) => onProgress({ done: ++done, total, phase });

  const stories = [];
  for (const s of stops) {
    stories.push(await getNarration(s, lang, t('seedSource')));
    tick('stories');
  }
  if (natural) {
    stories.forEach((n, i) => {
      if (n.lang === 'en') voiceTexts.push(n.short);
      const next = stops[i + 1];
      voiceTexts.push(next ? `${t('next')}: ${loc(next.name, 'en')}.` : t('allDone'));
    });
    const voice = neuralPref().voice;
    for (const text of voiceTexts) {
      for (const piece of chunkForVoice(text)) await synthesize(piece, voice).catch(() => undefined);
      tick('voice');
    }
  }
  onProgress({ done: total, total, phase: 'done' });
}
