import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setRouterGapMs } from '../routing';
import { translate } from '../../i18n';
import type { Preferences } from '../../types';
import { haversineM } from '../geo';
import { cityById, importance, classify, mergePlaces } from '../places';

const CITY = cityById('basel');
const SEED_POIS = CITY.pois;
import { planRoutes, selectStops, budgets } from '../planner';
import { analyseForecast, type ForecastData } from '../weather';
import { buildFromExtract, cleanForSpeech, sentences } from '../narration';

beforeAll(() => {
  // No network in tests: every service "fails", so the app's fallbacks are exercised.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  setRouterGapMs(0);
});

const sp = (id: string) => {
  const s = CITY.startPoints.find((x) => x.id === id)!;
  return { lat: s.lat, lng: s.lng, name: s.name.en };
};
const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
const prefs = (p: Partial<Preferences> = {}): Preferences => ({
  lang: 'en', cityId: 'basel', limitBy: 'duration', durationMin: 120, distanceKm: 5, interests: ['historic'],
  startId: 'marktplatz', end: 'loop', pace: 'normal', avoidStairs: false, ...p,
});

function forecast(prob: number, code = 3): ForecastData {
  const time = Array.from({ length: 24 }, (_, i) => `2026-06-01T${String(i).padStart(2, '0')}:00`);
  return {
    current: { time: '2026-06-01T13:15', temperature_2m: 18, precipitation: 0, weather_code: 3, wind_speed_10m: 10 },
    hourly: {
      time,
      temperature_2m: time.map(() => 18),
      precipitation_probability: time.map((_, i) => (i >= 15 ? prob : 10)),
      precipitation: time.map((_, i) => (i >= 15 && prob > 50 ? 1.2 : 0)),
      weather_code: time.map((_, i) => (i >= 15 && prob > 50 ? 63 : code)),
      wind_speed_10m: time.map(() => 10),
    },
  };
}

describe('places (milestone 2)', () => {
  it('ranks the big Basel sights near Basel SBB', () => {
    const sbb = sp('sbb');
    const near = SEED_POIS.filter((p) => haversineM(p, sbb) < 2500).sort((a, b) => importance(b) - importance(a));
    const top = near.slice(0, 15).map((p) => p.id);
    for (const id of ['muenster', 'rathaus', 'spalentor', 'tinguely-brunnen']) expect(top).toContain(id);
  });

  it('classifies OSM tags into interests', () => {
    expect(classify({ tourism: 'artwork', artwork_type: 'mural', name: 'x' })?.interests).toContain('streetart');
    expect(classify({ tourism: 'museum', name: 'x' })).toMatchObject({ indoor: true });
    expect(classify({ historic: 'city_gate', name: 'x' })?.interests).toEqual(expect.arrayContaining(['historic', 'architecture']));
    expect(classify({ shop: 'bakery', name: 'x' })).toBeNull();
  });

  it('merges an OSM twin into the seed entry instead of duplicating it', () => {
    const seed = SEED_POIS.filter((p) => p.id === 'spalentor');
    const osm = [{ ...seed[0], id: 'osm-way-1', name: { en: 'Spalentor' }, source: 'osm' as const, wiki: [], osmUrl: 'https://www.openstreetmap.org/way/1', openingHours: 'Mo-Su' }];
    const merged = mergePlaces(seed, osm);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('spalentor');
    expect(merged[0].openingHours).toBe('Mo-Su');
  });
});

describe('route builder (milestone 3)', () => {
  it('2-hour historical loop from Marktplatz returns to start and fits the budget', async () => {
    const routes = await planRoutes({
      pois: SEED_POIS, prefs: prefs(), start: sp('marktplatz'), station: sp('sbb'),
      weather: null, ignoreWeather: false, t, lang: 'en',
    });
    const r = routes[0];
    console.log(routes.map((x) => `${x.variant}: ${x.stops.length} stops, ${x.distanceKm} km, ${x.totalMin} min`).join('\n'));
    expect(r.variant).toBe('default');
    expect(r.path[0]).toMatchObject({ lat: sp('marktplatz').lat });
    expect(r.path[r.path.length - 1]).toMatchObject({ lat: sp('marktplatz').lat });
    expect(r.stops.length).toBeGreaterThanOrEqual(8);
    expect(r.totalMin).toBeLessThanOrEqual(125);
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it('never places two stops so close they would trigger together', () => {
    const b = budgets(prefs({ durationMin: 240, interests: ['historic', 'artists', 'architecture'] }));
    const stops = selectStops({ pois: SEED_POIS, start: sp('marktplatz'), end: sp('marktplatz'), weights: { historic: 1, artists: 1 }, ...b });
    for (const a of stops) for (const c of stops) if (a !== c) expect(haversineM(a, c)).toBeGreaterThanOrEqual(45);
  });

  it('respects a distance limit', async () => {
    const routes = await planRoutes({
      pois: SEED_POIS, prefs: prefs({ limitBy: 'distance', distanceKm: 3 }), start: sp('marktplatz'), station: sp('sbb'),
      weather: null, ignoreWeather: false, t, lang: 'en',
    });
    for (const r of routes) expect(r.distanceKm).toBeLessThanOrEqual(3.3);
  });
});

describe('weather (milestone 5)', () => {
  it('detects rain inside the walking window and proposes a shorter, indoor route that says why', async () => {
    const w = analyseForecast(forecast(80), 180);
    expect(w.rainExpected).toBe(true);
    expect(w.rainFrom).toBe('15:00');
    const routes = await planRoutes({
      pois: SEED_POIS, prefs: prefs({ interests: ['historic', 'artists'] }), start: sp('marktplatz'), station: sp('sbb'),
      weather: w, ignoreWeather: false, t, lang: 'en',
    });
    const rain = routes[0];
    console.log(rain.reasons.join('\n'));
    expect(rain.variant).toBe('rain');
    expect(rain.totalMin).toBeLessThan(routes[1].totalMin);
    expect(rain.stops[rain.stops.length - 1].indoor).toBe(true);
    expect(rain.reasons[0]).toMatch(/Rain is likely around 15:00/);
  });

  it('ignores rain outside the walking window', () => {
    expect(analyseForecast(forecast(80), 60).rainExpected).toBe(false);
  });
});

describe('narration text', () => {
  it('cleans and splits Wikipedia text for speech', () => {
    expect(cleanForSpeech('Basel Minster (German: Basler Münster) is a church[1].')).toBe('Basel Minster is a church.');
    expect(sentences('Built c. 1400 by St. Alban. It is red.')).toHaveLength(2);
    const extract = 'The Spalentor is a gate. It was built around 1400. It is in Basel.\n== History ==\nMore facts here. And more.\n== References ==\nIgnore me.';
    const n = buildFromExtract(extract, 'Spalentor', 'en');
    expect(n.short.startsWith('The Spalentor')).toBe(true);
    expect(n.short + n.long).not.toMatch(/Ignore me/);
  });
});

describe('livelier stories from Wikipedia', () => {
  it('keeps the opening, prefers stories and skips register-like sentences', async () => {
    const { buildFromExtract, sentenceScore } = await import('../narration');
    const extract = [
      'Kiyomizu-dera is a Buddhist temple in eastern Kyoto.',
      'The temple is administered by the Kita-Hossō school and its address is 1-294 Kiyomizu.',
      'According to legend, the temple was founded in 778 after a monk dreamed of a waterfall.',
      'Renovation work took place in 1633, 1957, 2008 and 2020, costing 4.1 million yen.',
      'Its famous wooden stage juts out over the hillside and offers views of the whole city.',
      'Visitors drink from the three streams of the Otowa waterfall, each said to grant a different wish.',
    ].join(' ');
    const n = buildFromExtract(extract, 'Kiyomizu-dera', 'en');
    expect(n.short.startsWith('Kiyomizu-dera is a Buddhist temple')).toBe(true);
    expect(n.short).toContain('legend');
    expect(n.short).not.toContain('address');
    expect(`${n.short} ${n.long ?? ''}`).not.toContain('Renovation work');
    expect(sentenceScore('Its famous wooden stage offers views of the city.', 3)).toBeGreaterThan(sentenceScore('The station is operated by the company on line 3.', 3));
  });
});
