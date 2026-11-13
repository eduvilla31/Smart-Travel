import baselSeed from '../data/basel-seed.json';
import veniceSeed from '../data/venice-seed.json';
import type { CityData, Interest, LatLng, Poi } from '../types';
import { haversineM } from './geo';
import { fetchJson, loadCached, saveCached } from './storage';

const withSource = (c: unknown): CityData => {
  const city = c as CityData;
  return { ...city, pois: city.pois.map((p) => ({ ...p, source: 'seed' as const })) };
};

/** Supported cities. To add one, drop a seed file in src/data and list it here. */
export const CITIES: CityData[] = [withSource(baselSeed), withSource(veniceSeed)];
export const cityById = (id: string): CityData => CITIES.find((c) => c.city.id === id) ?? CITIES[0];

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const DAY = 24 * 3600 * 1000;

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function distanceToCityKm(city: CityData, p: LatLng): number {
  const [lat, lng] = city.city.center;
  return haversineM(p, { lat, lng }) / 1000;
}

export const inCity = (city: CityData, p: LatLng) => distanceToCityKm(city, p) <= city.city.radiusKm;

/** The supported city this position is inside, if any. */
export const cityAt = (p: LatLng): CityData | undefined => CITIES.find((c) => inCity(c, p));

function overpassQuery(c: LatLng, r: number): string {
  const a = `(around:${Math.round(r)},${c.lat.toFixed(5)},${c.lng.toFixed(5)})`;
  return `[out:json][timeout:25];
(
  nwr${a}[historic][name];
  nwr${a}[tourism~"^(museum|artwork|attraction|viewpoint|gallery)$"][name];
  nwr${a}[amenity=place_of_worship][name][wikidata];
  nwr${a}[amenity=fountain][name];
  nwr${a}[amenity~"^(marketplace|theatre|arts_centre)$"][name];
  nwr${a}[leisure~"^(park|garden)$"][name];
  nwr${a}[place=square][name];
  nwr${a}[man_made=bridge][name][wikidata];
);
out center tags 400;`;
}

/** Map OSM tags to our interest categories. */
export function classify(tags: Record<string, string>): { interests: Interest[]; indoor: boolean } | null {
  const s = new Set<Interest>();
  let indoor = false;
  const { historic, tourism, amenity, leisure, place, man_made, artwork_type } = tags;
  const minorHistoric = ['boundary_stone', 'wayside_cross', 'milestone', 'memorial', 'heritage', 'yes'];
  if (historic && !(minorHistoric.includes(historic) && !tags.wikidata)) s.add('historic');
  if (['castle', 'city_gate', 'church', 'monastery', 'building', 'tower'].includes(historic ?? '')) s.add('architecture');
  if (tourism === 'museum' || tourism === 'gallery') { s.add('artists'); indoor = true; }
  if (tourism === 'artwork') {
    if (['mural', 'graffiti', 'street_art'].includes(artwork_type ?? '')) s.add('streetart');
    else s.add('artists');
  }
  if (tourism === 'viewpoint') s.add('parks');
  if (tourism === 'attraction') s.add('local');
  if (amenity === 'place_of_worship') { s.add('architecture'); s.add('historic'); indoor = true; }
  if (amenity === 'fountain') s.add(tags.wikidata ? 'historic' : 'local');
  if (amenity === 'marketplace') { s.add('food'); s.add('local'); }
  if (amenity === 'theatre' || amenity === 'arts_centre') { s.add('artists'); s.add('local'); indoor = true; }
  if (leisure === 'park' || leisure === 'garden') s.add('parks');
  if (place === 'square') s.add('local');
  if (man_made === 'bridge') { s.add('architecture'); s.add('local'); }
  if (tags.building && ['cathedral', 'church', 'civic', 'museum'].includes(tags.building)) s.add('architecture');
  if (!s.size) return null;
  return { interests: [...s], indoor };
}

function osmToPoi(e: OsmElement): Poi | null {
  const tags = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (lat == null || lng == null || !tags.name) return null;
  const c = classify(tags);
  if (!c) return null;
  const wiki: string[] = [];
  if (tags.wikipedia) wiki.push(tags.wikipedia);
  return {
    id: `osm-${e.type}-${e.id}`,
    lat,
    lng,
    name: { en: tags['name:en'] ?? tags.name, es: tags['name:es'] ?? tags['name:en'] ?? tags.name },
    interests: c.interests,
    indoor: c.indoor,
    priority: tags.wikidata ? 2 : 1,
    wiki,
    wikidata: tags.wikidata,
    source: 'osm',
    osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    openingHours: tags.opening_hours,
  };
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');

function sharesWord(a: string, b: string): boolean {
  const stop = new Set(['basel', 'der', 'die', 'das', 'the', 'of', 'und', 'and', 'st', 'brunnen']);
  const wa = new Set(norm(a).split(/\s+/).filter((w) => w.length > 3 && !stop.has(w)));
  return norm(b).split(/\s+/).some((w) => wa.has(w));
}

const loc = (p: Poi) => p.name.es ?? p.name.en;

/** Merge OSM places into the curated seed, dropping duplicates. */
export function mergePlaces(seedPois: Poi[], osm: Poi[]): Poi[] {
  const out = seedPois.map((p) => ({ ...p }));
  const byQid = new Map<string, Poi>();
  for (const o of osm) {
    // Same place as a seed entry? Enrich the seed entry instead.
    const twin = out.find(
      (s) =>
        (o.wikidata && s.wikidata === o.wikidata) ||
        (haversineM(s, o) < 60 && (sharesWord(s.name.en, o.name.en) || sharesWord(loc(s), o.name.en))) ||
        haversineM(s, o) < 25,
    );
    if (twin) {
      if (twin.source === 'seed') {
        twin.wikidata ??= o.wikidata;
        twin.osmUrl ??= o.osmUrl;
        twin.openingHours ??= o.openingHours;
        if (o.wiki[0] && !twin.wiki.includes(o.wiki[0])) twin.wiki.push(o.wiki[0]);
      }
      continue;
    }
    if (o.wikidata) {
      if (byQid.has(o.wikidata)) continue;
      byQid.set(o.wikidata, o);
    }
    out.push(o);
  }
  return out;
}


/** Count Wikidata sitelinks (how many Wikipedias cover the place): a notability signal. */
async function enrichWithWikidata(pois: Poi[]): Promise<void> {
  const ids = [...new Set(pois.map((p) => p.wikidata).filter((q): q is string => !!q && /^Q\d+$/.test(q)))];
  const counts = new Map<string, { n: number; titles: Record<string, string> }>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url =
      'https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&format=json&origin=*' +
      `&ids=${batch.join('|')}`;
    try {
      const all = await fetchJson<{ entities: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(url);
      for (const [q, ent] of Object.entries(all.entities ?? {})) {
        const links = ent.sitelinks ?? {};
        const titles: Record<string, string> = {};
        for (const lang of ['en', 'es', 'de']) if (links[`${lang}wiki`]) titles[lang] = links[`${lang}wiki`].title;
        counts.set(q, { n: Object.keys(links).filter((k) => k.endsWith('wiki')).length, titles });
      }
    } catch {
      /* notability is optional */
    }
  }
  for (const p of pois) {
    const c = p.wikidata ? counts.get(p.wikidata) : undefined;
    if (!c) continue;
    p.sitelinks = c.n;
    for (const [lang, title] of Object.entries(c.titles)) {
      const key = `${lang}:${title}`;
      if (!p.wiki.includes(key)) p.wiki.push(key);
    }
  }
}

export interface PlacesResult { pois: Poi[]; live: boolean }

/**
 * Candidate places around `center`: the curated seed (always) plus live
 * OpenStreetMap results, cached for a day.
 */
export async function loadPlaces(city: CityData, center: LatLng, radiusM: number): Promise<PlacesResult> {
  const r = Math.min(Math.max(radiusM, 800), 3500);
  const key = `places:v2:${city.city.id}:${center.lat.toFixed(3)},${center.lng.toFixed(3)}:${Math.round(r / 250) * 250}`;
  const cached = loadCached<Poi[]>(key, DAY);
  if (cached) return { pois: cached, live: true };

  const seedNearby = city.pois.filter((p) => haversineM(p, center) <= r + 500);
  let osm: Poi[] = [];
  let live = false;
  for (const endpoint of OVERPASS) {
    try {
      const body = 'data=' + encodeURIComponent(overpassQuery(center, r));
      const res = await fetchJson<{ elements: OsmElement[] }>(
        endpoint,
        { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
        20000,
      );
      osm = res.elements.map(osmToPoi).filter((p): p is Poi => !!p);
      live = true;
      break;
    } catch {
      /* try next mirror */
    }
  }
  if (!live) return { pois: seedNearby, live: false };

  // Unnamed-in-Wikidata OSM objects are mostly minor; keep the best of them only.
  const merged = mergePlaces(seedNearby, osm);
  await enrichWithWikidata(merged);
  const ranked = merged
    .map((p) => ({ p, s: importance(p) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 90)
    .map((x) => x.p);
  saveCached(key, ranked);
  return { pois: ranked, live: true };
}

/** 0..~10: how notable a place is, independent of the user's interests. */
export function importance(p: Poi): number {
  let s = 0;
  if (p.source === 'seed') s += 2 + p.priority * 1.5; // curated: 3.5..6.5
  if (p.wikidata) s += 1;
  if (p.wiki.length) s += 1;
  if (p.sitelinks) s += Math.min(4, Math.log2(1 + p.sitelinks));
  return s;
}
