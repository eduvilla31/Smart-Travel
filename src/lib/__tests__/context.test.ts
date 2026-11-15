import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setRouterGapMs } from '../routing';
import { translate } from '../../i18n';
import { cityById } from '../places';

const CITY = cityById('basel');
const SEED_POIS = CITY.pois;
import { planRoutes } from '../planner';
import { guessFromPosition, nearestCandidates } from '../../components/PhotoIdentify';

beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  setRouterGapMs(0);
});

const sp = (id: string) => {
  const s = CITY.startPoints.find((x) => x.id === id)!;
  return { lat: s.lat, lng: s.lng, name: s.name.en };
};
const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);

describe('city context (milestone 7)', () => {
  it('reroutes around a blocked stop and says why', async () => {
    const routes = await planRoutes({
      pois: SEED_POIS,
      prefs: { lang: 'en', cityId: 'basel', limitBy: 'duration', durationMin: 120, distanceKm: 5, interests: ['historic'], startId: 'marktplatz', end: 'loop', pace: 'normal', avoidStairs: false },
      start: sp('marktplatz'), station: sp('sbb'), weather: null, ignoreWeather: false,
      blocked: [{ id: 'mittlere-bruecke', title: 'Demonstration on the Middle Bridge' }],
      t, lang: 'en',
    });
    for (const r of routes) expect(r.stops.map((s) => s.id)).not.toContain('mittlere-bruecke');
    expect(routes[0].reasons[0]).toBe('Middle Bridge (Mittlere Brücke) is left out today: Demonstration on the Middle Bridge.');
  });
});

describe('photo identify without the server (milestone 6 fallback)', () => {
  it('guesses the places in front of the camera', () => {
    // standing just east of the Spalentor, facing west
    const pos = { lat: 47.5581, lng: 7.5824 };
    const cands = nearestCandidates(SEED_POIS, pos);
    expect(cands[0].distanceM).toBeLessThan(150);
    const guess = guessFromPosition(cands, 270).map((p) => p.id);
    expect(guess[0]).toBe('spalentor');
    // facing east instead: the gate is behind us
    expect(guessFromPosition(cands, 90).map((p) => p.id)).not.toContain('spalentor');
  });
});

describe('opening hours in routes', () => {
  it('leaves out a museum closed for the whole walk and labels the others', async () => {
    const museums = SEED_POIS.map((p) =>
      p.id === 'kunstmuseum' ? { ...p, openingHours: 'Tu-Su 10:00-18:00; Mo off' } : p.id === 'historisches-museum' ? { ...p, openingHours: 'Mo-Su 10:00-17:00' } : p,
    );
    const routes = await planRoutes({
      pois: museums,
      prefs: { lang: 'en', cityId: 'basel', limitBy: 'duration', durationMin: 120, distanceKm: 5, interests: ['artists', 'historic'], startId: 'marktplatz', end: 'loop', pace: 'normal', avoidStairs: false },
      start: sp('marktplatz'), station: sp('sbb'), weather: null, ignoreWeather: false, t, lang: 'en',
      planStart: new Date('2026-11-16T11:00:00+01:00'), // a Monday
      timeZone: 'Europe/Zurich',
    });
    for (const r of routes) expect(r.stops.map((s) => s.id)).not.toContain('kunstmuseum');
    expect(routes[0].reasons.join(' ')).toContain('is closed at that time');
    const withHist = routes.find((r) => r.stops.some((s) => s.id === 'historisches-museum'));
    expect(withHist?.hours?.['historisches-museum']).toMatchObject({ state: 'open', closes: '17:00' });
  });
});
