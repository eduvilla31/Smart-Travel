import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setRouterGapMs } from '../routing';
import { translate } from '../../i18n';
import type { Preferences } from '../../types';
import { haversineM, setDetourFactor } from '../geo';
import { CITIES, cityAt, cityById, inCity } from '../places';
import { planRoutes } from '../planner';

beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  setRouterGapMs(0);
});

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);

describe('city data', () => {
  it('has Basel and Venice, with unique ids and complete bilingual content', () => {
    expect(CITIES.map((c) => c.city.id)).toEqual(['basel', 'venice']);
    const ids = CITIES.flatMap((c) => c.pois.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CITIES) {
      expect(c.startPoints.some((s) => s.id === c.city.stationId)).toBe(true);
      for (const p of c.pois) {
        expect(inCity(c, p), `${p.id} inside ${c.city.id}`).toBe(true);
        expect(p.name.en && p.name.es, `${p.id} names`).toBeTruthy();
        expect(p.text?.en?.short && p.text?.es?.short, `${p.id} texts`).toBeTruthy();
        expect(p.interests.length).toBeGreaterThan(0);
        for (const w of p.wiki) expect(w).toMatch(/^(en|es|de|it):.+/);
      }
    }
  });

  it('detects which city a position is in', () => {
    expect(cityAt({ lat: 45.434, lng: 12.338 })?.city.id).toBe('venice');
    expect(cityAt({ lat: 47.5577, lng: 7.5875 })?.city.id).toBe('basel');
    expect(cityAt({ lat: 40.4168, lng: -3.7038 })).toBeUndefined(); // Madrid
  });
});

describe('Venice routes', () => {
  const venice = cityById('venice');
  const prefs: Preferences = { lang: 'en', cityId: 'venice', limitBy: 'duration', durationMin: 120, distanceKm: 5, interests: ['historic', 'artists'], startId: 'san-marco', end: 'loop', pace: 'normal', avoidStairs: false };
  const sp = (id: string) => {
    const s = venice.startPoints.find((x) => x.id === id)!;
    return { lat: s.lat, lng: s.lng, name: s.name.en };
  };

  it('builds a 2-hour loop from St Mark\'s Square with themed alternatives', async () => {
    setDetourFactor(venice.city.detourFactor);
    const routes = await planRoutes({ pois: venice.pois, prefs, start: sp('san-marco'), station: sp('station'), weather: null, ignoreWeather: false, t, lang: 'en' });
    const r = routes[0];
    expect(r.stops.length).toBeGreaterThanOrEqual(8);
    expect(r.totalMin).toBeLessThanOrEqual(125);
    expect(r.stops.map((s) => s.id)).toEqual(expect.arrayContaining(['basilica-san-marco', 'doges-palace', 'rialto-bridge']));
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const x of routes) for (const a of x.stops) for (const b of x.stops) if (a !== b) expect(haversineM(a, b)).toBeGreaterThanOrEqual(45);
  });

  it('can avoid the big stepped bridges and end at the station', async () => {
    const routes = await planRoutes({ pois: venice.pois, prefs: { ...prefs, avoidStairs: true, end: 'station' }, start: sp('san-marco'), station: sp('station'), weather: null, ignoreWeather: false, t, lang: 'en' });
    for (const r of routes) {
      expect(r.stops.some((s) => s.stairs)).toBe(false);
      expect(r.end.name).toBe('Santa Lucia station');
    }
  });
});
