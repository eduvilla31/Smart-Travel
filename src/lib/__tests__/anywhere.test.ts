import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../../i18n';
import type { Preferences } from '../../types';
import { setDetourFactor } from '../geo';
import { cleanQuery, makeCity, searchPlaces } from '../geocode';
import { classifyWiki, loadPlaces } from '../places';
import { planRoutes } from '../planner';
import { setRouterGapMs } from '../routing';
import { voiceScore } from '../speech';

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v);
afterEach(() => vi.unstubAllGlobals());

describe('searching any city', () => {
  it('strips chatty lead-ins', () => {
    expect(cleanQuery("I'm in Kyoto")).toBe('Kyoto');
    expect(cleanQuery('Hey, I am in Japan.')).toBe('Japan');
    expect(cleanQuery('estoy en Tokio')).toBe('Tokio');
    expect(cleanQuery('near Shibuya crossing')).toBe('Shibuya crossing');
  });

  it('turns search results into walkable cities and flags whole countries', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json([
        { lat: '35.0116', lon: '135.7681', name: 'Kyoto', display_name: 'Kyoto, Kyoto Prefecture, Japan', addresstype: 'city', boundingbox: ['34.87', '35.32', '135.56', '135.88'], address: { country: 'Japan', country_code: 'jp' } },
        { lat: '36.57', lon: '139.24', name: 'Japan', display_name: 'Japan', addresstype: 'country', boundingbox: ['20.2', '45.7', '122.7', '154.2'], address: { country: 'Japan', country_code: 'jp' } },
      ]),
    );
    const [kyoto, japan] = await searchPlaces("I'm in Kyoto", 'en');
    expect(kyoto).toMatchObject({ name: 'Kyoto', country: 'Japan', tooBig: false });
    expect(kyoto.radiusKm).toBeGreaterThan(5);
    expect(kyoto.radiusKm).toBeLessThanOrEqual(40);
    expect(japan.tooBig).toBe(true);
    const city = makeCity(kyoto);
    expect(city.city.id).toBe('custom:35.012,135.768');
    expect(city.city.timezone).toBe('auto');
    expect(city.city.noStation).toBe(true);
    expect(city.pois).toEqual([]);
    expect(city.startPoints[0].name.en).toBe('Kyoto (centre)');
  });
});

describe('places from Wikipedia (backup when OpenStreetMap is down)', () => {
  it('keeps sights and drops stations, wards and events (real Kyoto descriptions)', () => {
    expect(classifyWiki('Kiyomizu-dera', 'Buddhist temple in Kyoto, Japan')).toMatchObject({ interests: expect.arrayContaining(['historic']), indoor: false });
    expect(classifyWiki('Yasaka Shrine', 'Shinto shrine in Gion District, Kyoto, Japan')?.interests).toContain('architecture');
    expect(classifyWiki('Nishiki Market', 'Marketplace in downtown Kyoto, Japan')?.interests).toContain('food');
    expect(classifyWiki('Kyoto Municipal Museum of Art', 'Museum in Kyoto, Japan')?.interests).toContain('artists');
    expect(classifyWiki('Gion', 'Geisha district in Kyoto, Japan')?.interests).toContain('local');
    expect(classifyWiki('Kyoto-kawaramachi Station', 'Railway station in Kyoto, Japan')).toBeNull();
    expect(classifyWiki('Higashiyama-ku, Kyoto', 'Ward of Kyoto in Japan')).toBeNull();
    expect(classifyWiki('Ikedaya incident', '1864 violent confrontation between activists')).toBeNull();
    expect(classifyWiki('Mindar', 'Buddhist android preacher')).toBeNull();
  });

  it('plans a walk in a searched city using only Wikipedia places', async () => {
    setRouterGapMs(0);
    const sights = [
      ['Kiyomizu-dera', 'Buddhist temple in Kyoto, Japan', 34.9949, 135.785, 26768],
      ['Yasaka Shrine', 'Shinto shrine in Gion District, Kyoto, Japan', 35.0036, 135.7786, 7750],
      ['Chion-in', 'Buddhist temple in Kyoto Prefecture, Japan', 35.0054, 135.7831, 11193],
      ['Kennin-ji', 'Historic Zen Buddhist temple in Kyoto, Japan', 35.0007, 135.7733, 9818],
      ['Kōdai-ji', 'Temple in Kyoto, Japan', 35.0006, 135.7811, 9686],
      ['Nishiki Market', 'Marketplace in downtown Kyoto, Japan', 35.005, 135.7649, 6242],
      ['Gion', 'Geisha district in Kyoto, Japan', 35.0035, 135.775, 10173],
      ['Kyoto Municipal Museum of Art', 'Museum in Kyoto, Japan', 35.0122, 135.7826, 7794],
      ['Shōren-in', 'Buddhist temple in Kyoto, Japan', 35.0078, 135.7818, 10281],
      ['Kyoto-kawaramachi Station', 'Railway station in Kyoto, Japan', 35.0037, 135.7688, 8143],
    ] as const;
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('generator=geosearch'))
        return Response.json({ query: { pages: Object.fromEntries(sights.map(([title, description, lat, lon, length], i) => [i, { pageid: i, title, description, length, coordinates: [{ lat, lon }] }])) } });
      throw new Error('offline'); // Overpass and the router are down
    });
    const kyoto = makeCity({ lat: 35.0037, lng: 135.7788, name: 'Kyoto', label: 'Kyoto, Japan', country: 'Japan', countryCode: 'jp', tooBig: false, radiusKm: 20 });
    setDetourFactor(kyoto.city.detourFactor);
    const start = { lat: 35.0037, lng: 135.7788, name: 'Kyoto (centre)' };
    const places = await loadPlaces(kyoto, start, 3000);
    expect(places.live).toBe(true);
    expect(places.pois.map((p) => p.name.en)).not.toContain('Kyoto-kawaramachi Station');
    expect(places.pois[0].name.en).toBe('Kiyomizu-dera'); // longest article ranks first
    expect(places.pois[0].text?.en?.short).toBe('Kiyomizu-dera: Buddhist temple in Kyoto, Japan.');
    expect(places.pois.find((p) => p.name.en.includes('Museum'))?.indoor).toBe(true);
    const prefs: Preferences = { lang: 'en', cityId: kyoto.city.id, limitBy: 'duration', durationMin: 120, distanceKm: 5, interests: ['historic', 'artists'], startId: 'centre', end: 'loop', pace: 'normal', avoidStairs: false };
    const routes = await planRoutes({ pois: places.pois, prefs, start, station: start, weather: null, ignoreWeather: false, t, lang: 'en' });
    expect(routes[0].stops.length).toBeGreaterThanOrEqual(6);
    expect(routes[0].stops.map((s) => s.name.en)).toContain('Kiyomizu-dera');
  });
});

describe('natural voice choice', () => {
  const v = (name: string, lang: string, localService = true, voiceURI = name) => ({ name, lang, localService, voiceURI });
  it('ranks Premium and Enhanced voices first and buries novelty voices', () => {
    const voices = [
      v('Albert', 'en-US'),
      v('Samantha', 'en-US'),
      v('Daniel (Enhanced)', 'en-GB'),
      v('Zoe (Premium)', 'en-US', true, 'com.apple.voice.premium.en-US.Zoe'),
      v('Google UK English Female', 'en-GB', false),
      v('Mónica', 'es-ES'),
    ];
    const ranked = [...voices].sort((a, b) => voiceScore(b, 'en') - voiceScore(a, 'en')).map((x) => x.name);
    expect(ranked[0]).toBe('Zoe (Premium)');
    expect(ranked[1]).toBe('Daniel (Enhanced)');
    expect(ranked.indexOf('Google UK English Female')).toBeLessThan(ranked.indexOf('Samantha'));
    expect(voiceScore(voices[0], 'en')).toBeLessThan(voiceScore(voices[1], 'en'));
    expect(voiceScore(voices[5], 'en')).toBe(-1000); // Spanish voice never reads English
  });
});

describe('safe links and servers', () => {
  it('only lets plain https links through', async () => {
    const { safeUrl, isAllowedServer } = await import('../safe');
    expect(safeUrl('https://news.example/a')).toBe('https://news.example/a');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,<b>x</b>')).toBeUndefined();
    expect(safeUrl('http://news.example/a')).toBeUndefined();
    expect(safeUrl('not a url')).toBeUndefined();
    expect(isAllowedServer('https://smart-travel-api.me.workers.dev')).toBe(true);
    expect(isAllowedServer('http://smart-travel-api.me.workers.dev')).toBe(false);
    expect(isAllowedServer('https://evil.example')).toBe(false);
    expect(isAllowedServer('http://localhost:8787')).toBe(true);
  });
});
