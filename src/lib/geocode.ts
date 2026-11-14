import type { CityData, Lang, LatLng, StartPoint } from '../types';
import { haversineM } from './geo';
import { fetchJson, load, save } from './storage';

/**
 * Find any city in the world with OpenStreetMap's Nominatim (free, no key).
 * Its usage policy: no search-as-you-type, at most one request per second, cache results.
 */
const NOMINATIM = 'https://nominatim.openstreetmap.org';

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  category?: string;
  type?: string;
  boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
}

export interface PlaceResult extends LatLng {
  name: string;
  label: string;
  country: string;
  countryCode: string;
  /** A whole country or region: too big to walk, the user should pick a city in it. */
  tooBig: boolean;
  radiusKm: number;
}

// Only whole countries are refused. A state or prefecture (Tokyo is one) is centred on its main place.
const BIG = new Set(['country', 'continent']);

/** Remove chatty lead-ins so "I'm in Kyoto" searches for "Kyoto". */
export function cleanQuery(q: string): string {
  return q
    .trim()
    .replace(/^(hey,?\s*)?(i'?m|i am|we'?re|we are|estoy|estamos)\s+(in|at|near|en|cerca de)\s+/i, '')
    .replace(/^(near|cerca de|en|in)\s+/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function toResult(r: NominatimResult): PlaceResult {
  const a = r.address ?? {};
  const name = r.name || a.city || a.town || a.village || r.display_name.split(',')[0];
  const [s, n, w, e] = (r.boundingbox ?? []).map(Number);
  // Half the box diagonal, kept between a walkable 5 km and 40 km.
  const half = r.boundingbox ? haversineM({ lat: s, lng: w }, { lat: n, lng: e }) / 2000 : 10;
  return {
    lat: Number(r.lat),
    lng: Number(r.lon),
    name,
    label: r.display_name,
    country: a.country ?? '',
    countryCode: (a.country_code ?? '').toLowerCase(),
    tooBig: BIG.has(r.addresstype ?? '') || BIG.has(r.type ?? ''),
    radiusKm: Math.min(40, Math.max(5, half)),
  };
}

export async function searchPlaces(query: string, lang: Lang): Promise<PlaceResult[]> {
  const q = cleanQuery(query);
  if (q.length < 2) return [];
  // Not cached: what you type is never stored on the phone.
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&addressdetails=1&accept-language=${lang}&q=${encodeURIComponent(q)}`;
  return (await fetchJson<NominatimResult[]>(url, {}, 12000)).map(toResult);
}

/** Which town or city is this position in? */
export async function reverseCity(p: LatLng, lang: Lang): Promise<PlaceResult | null> {
  // Rounded to ~1 km: enough to name the city, without sending the exact position.
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=${lang}&lat=${p.lat.toFixed(2)}&lon=${p.lng.toFixed(2)}`;
  const r = await fetchJson<NominatimResult & { error?: string }>(url, {}, 12000);
  if (r.error) return null;
  const res = toResult(r);
  // Centre the city on its place point if Nominatim gave a boundary; otherwise on the user.
  return { ...res, tooBig: false, lat: res.lat || p.lat, lng: res.lng || p.lng };
}

export const isCustomCity = (id: string) => id.startsWith('custom:');

/** Search only inside a city (a box around its centre), e.g. a hotel or square to start from. */
export async function searchInCity(query: string, city: CityData, lang: Lang, limit = 6): Promise<PlaceResult[]> {
  const q = cleanQuery(query);
  if (q.length < 2) return [];
  const [lat, lng] = city.city.center;
  const km = Math.min(city.city.radiusKm, 20);
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((lat * Math.PI) / 180));
  const box = [lng - dLng, lat + dLat, lng + dLng, lat - dLat].map((n) => n.toFixed(4)).join(',');
  const url =
    `${NOMINATIM}/search?format=jsonv2&limit=${limit}&addressdetails=1&accept-language=${lang}` +
    `&viewbox=${box}&bounded=1&q=${encodeURIComponent(q)}`;
  return (await fetchJson<NominatimResult[]>(url, {}, 12000)).map(toResult);
}

const STATION = /\b(railway|train|metro|subway|underground) station\b|\bstation (in|on|of)\b|^gare\b|\bhauptbahnhof\b/i;

/**
 * Good start and end points in a searched city: its main stations. Wikipedia's
 * nearby articles ranked by length put the big hubs first (Tokyo Station before
 * small local stops); a plain "<city> station" search is the backup.
 */
export async function cityHubs(city: CityData, lang: Lang): Promise<StartPoint[]> {
  const [lat, lng] = city.city.center;
  const out: StartPoint[] = [];
  const add = (name: string, plat: number, plng: number) => {
    if (out.length >= 3 || out.some((o) => o.name.en.toLowerCase() === name.toLowerCase() || haversineM(o, { lat: plat, lng: plng }) < 150)) return;
    out.push({ id: `hub-${plat.toFixed(4)},${plng.toFixed(4)}`, name: { en: name, es: name }, lat: plat, lng: plng });
  };
  try {
    const url =
      'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch' +
      `&ggscoord=${lat.toFixed(5)}%7C${lng.toFixed(5)}&ggsradius=10000&ggslimit=500&prop=description%7Cinfo%7Ccoordinates&colimit=max`;
    const res = await fetchJson<{ query?: { pages?: Record<string, { title: string; description?: string; length?: number; coordinates?: { lat: number; lon: number }[] }> } }>(url, {}, 15000);
    Object.values(res.query?.pages ?? {})
      .filter((p) => p.coordinates?.[0] && STATION.test(`${p.title} ${p.description ?? ''}`))
      .sort((a, b) => (b.length ?? 0) - (a.length ?? 0))
      .forEach((p) => add(p.title, p.coordinates![0].lat, p.coordinates![0].lon));
  } catch {
    /* fall back to the plain search */
  }
  if (out.length < 3) {
    try {
      for (const r of await searchInCity(`${city.city.name.en} station`, city, lang, 3)) add(r.name, r.lat, r.lng);
    } catch {
      /* no suggestions beyond the centre */
    }
  }
  return out;
}

/** A city with no curated places: everything comes from OpenStreetMap and Wikipedia. */
export function makeCity(r: PlaceResult, names?: Partial<Record<Lang, string>>): CityData {
  const en = names?.en ?? r.name;
  const es = names?.es ?? r.name;
  return {
    city: {
      id: `custom:${r.lat.toFixed(3)},${r.lng.toFixed(3)}`,
      name: { en, es },
      country: r.country,
      center: [r.lat, r.lng],
      radiusKm: r.radiusKm,
      timezone: 'auto', // resolved from the weather service
      detourFactor: 1.35,
      triggerRadiusM: 30,
      stationId: 'centre',
      noStation: true,
    },
    startPoints: [{ id: 'centre', name: { en: `${en} (centre)`, es: `${es} (centro)` }, lat: r.lat, lng: r.lng }],
    pois: [],
  };
}

/**
 * Only the city in use right now is kept, so the app opens where you left it.
 * No list of past searches is stored.
 */
export function currentCity(id: string): CityData | undefined {
  const c = load<CityData | null>('currentCity', null);
  return c && c.city.id === id ? c : undefined;
}

export function setCurrentCity(c: CityData) {
  save('currentCity', c);
}

/** Remove searched cities and cached searches that older versions kept. */
export function forgetSearchHistory() {
  try {
    localStorage.removeItem('recentCities');
    for (const k of Object.keys(localStorage)) if (k.startsWith('geo:') || k.startsWith('rev:')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
