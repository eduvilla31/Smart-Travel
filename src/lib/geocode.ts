import type { CityData, Lang, LatLng } from '../types';
import { haversineM } from './geo';
import { fetchJson, load, loadCached, save, saveCached } from './storage';

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
  const key = `geo:v1:${lang}:${q.toLowerCase()}`;
  const hit = loadCached<PlaceResult[]>(key, 7 * 86400 * 1000);
  if (hit) return hit;
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&addressdetails=1&accept-language=${lang}&q=${encodeURIComponent(q)}`;
  const res = (await fetchJson<NominatimResult[]>(url, {}, 12000)).map(toResult);
  saveCached(key, res);
  return res;
}

/** Which town or city is this position in? */
export async function reverseCity(p: LatLng, lang: Lang): Promise<PlaceResult | null> {
  const key = `rev:v1:${lang}:${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
  const hit = loadCached<PlaceResult | null>(key, 86400 * 1000);
  if (hit) return hit;
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=10&addressdetails=1&accept-language=${lang}&lat=${p.lat}&lon=${p.lng}`;
  const r = await fetchJson<NominatimResult & { error?: string }>(url, {}, 12000);
  if (r.error) return null;
  const res = toResult(r);
  // Centre the city on its place point if Nominatim gave a boundary; otherwise on the user.
  const out = { ...res, tooBig: false, lat: res.lat || p.lat, lng: res.lng || p.lng };
  saveCached(key, out);
  return out;
}

export const isCustomCity = (id: string) => id.startsWith('custom:');

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

/** The last few cities the user searched for, newest first. */
export function recentCities(): CityData[] {
  return load<CityData[]>('recentCities', []);
}

export function rememberCity(c: CityData) {
  save('recentCities', [c, ...recentCities().filter((x) => x.city.id !== c.city.id)].slice(0, 5));
}

export function findRecent(id: string): CityData | undefined {
  return recentCities().find((c) => c.city.id === id);
}
