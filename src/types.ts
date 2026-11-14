export type Lang = 'en' | 'es';
export const LANGS: Lang[] = ['en', 'es'];

export type Interest =
  | 'historic'
  | 'streetart'
  | 'artists'
  | 'architecture'
  | 'food'
  | 'parks'
  | 'local';

export const INTERESTS: Interest[] = ['historic', 'streetart', 'artists', 'architecture', 'food', 'parks', 'local'];

export interface LatLng { lat: number; lng: number }

export type Localized = Partial<Record<Lang, string>> & { en: string };

export interface StopText { short: string; long?: string }

/** A point of interest, from the curated seed and/or OpenStreetMap. */
export interface Poi extends LatLng {
  id: string;
  name: Localized;
  interests: Interest[];
  indoor: boolean;
  /** 1..3 editorial importance (seed) or derived from OSM/Wikidata. */
  priority: number;
  /** Wikipedia titles as "lang:Title", tried in order. */
  wiki: string[];
  wikidata?: string;
  /** Wikidata sitelink count: a proxy for how notable a place is. */
  sitelinks?: number;
  stairs?: boolean;
  /** Coordinates not checked against Wikidata. */
  approx?: boolean;
  /** Hand-written fallback narration (used when Wikipedia is unreachable). */
  text?: Partial<Record<Lang, StopText>>;
  source: 'seed' | 'osm' | 'wiki';
  /** Wikipedia article length: a rough notability signal for places found via Wikipedia. */
  articleLength?: number;
  osmUrl?: string;
  openingHours?: string;
}

export interface StartPoint extends LatLng { id: string; name: Localized }

export interface CityData {
  city: {
    id: string;
    name: Localized;
    country: string;
    center: [number, number];
    radiusKm: number;
    timezone: string;
    /** Walking distance / straight-line distance (canals and rivers force detours). */
    detourFactor: number;
    /** How close you must be for a stop's narration to start. */
    triggerRadiusM: number;
    /** Start point used for "end at the station". */
    stationId: string;
    /** Searched cities have no known station, so "end at the station" is hidden. */
    noStation?: boolean;
  };
  startPoints: StartPoint[];
  pois: Poi[];
}

export type EndMode = 'loop' | 'oneway' | 'station';
export type Pace = 'slow' | 'normal' | 'fast';
export const PACE_KMH: Record<Pace, number> = { slow: 3.5, normal: 4.5, fast: 5.5 };

export interface Preferences {
  lang: Lang;
  cityId: string;
  limitBy: 'duration' | 'distance';
  durationMin: number;
  distanceKm: number;
  interests: Interest[];
  startId: string; // 'gps' or a StartPoint id
  end: EndMode;
  pace: Pace;
  avoidStairs: boolean;
}

export interface RouteStep {
  location: LatLng;
  type: string;
  modifier?: string;
  name: string;
  distanceM: number;
}

export interface PlannedRoute {
  id: string;
  variant: 'default' | 'classic' | 'urban' | 'museums' | 'rain';
  title: string;
  start: LatLng & { name: string };
  end: LatLng & { name: string };
  stops: Poi[];
  /** Walking path; straight lines if the routing service failed. */
  path: LatLng[];
  steps: RouteStep[];
  distanceKm: number;
  walkMin: number;
  totalMin: number;
  routed: boolean;
  /** One-sentence explanations of why the route looks the way it does. */
  reasons: string[];
}

export interface SavedTour {
  id: string;
  cityId?: string;
  date: string;
  title: string;
  stops: string[];
  distanceKm: number;
  minutes: number;
  /** Kept so the tour can be walked again. */
  route?: PlannedRoute;
}

/** A tour in progress, saved so a reload or signal loss doesn't lose it. */
export interface ActiveTour {
  cityId: string;
  route: PlannedRoute;
  status: Record<string, 'visited' | 'skipped'>;
  startedAt: number;
  savedAt: number;
}
