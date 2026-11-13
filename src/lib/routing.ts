import type { LatLng, RouteStep } from '../types';
import { walkKm } from './geo';
import { fetchJson } from './storage';

/**
 * Walking paths from the FOSSGIS OSRM foot router (keyless, fair-use).
 * OpenRouteService needs an API key, which must live on a server, so it
 * comes later with the backend.
 */
const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/';

export interface WalkPath {
  path: LatLng[];
  distanceKm: number;
  steps: RouteStep[];
  routed: boolean;
}

interface OsrmRes {
  code: string;
  routes: {
    distance: number;
    geometry: { coordinates: [number, number][] };
    legs: {
      steps: {
        distance: number;
        name: string;
        maneuver: { type: string; modifier?: string; location: [number, number] };
      }[];
    }[];
  }[];
}

export function straightPath(points: LatLng[]): WalkPath {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += walkKm(points[i - 1], points[i]);
  return { path: points, distanceKm: km, steps: [], routed: false };
}

// The router's fair-use policy is one request per second: space our calls out.
let minGapMs = 1100;
let nextSlot = 0;
/** Tests switch the spacing off. */
export function setRouterGapMs(ms: number) {
  minGapMs = ms;
}
async function politely<T>(call: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + minGapMs;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return call();
}

export async function walkingPath(points: LatLng[]): Promise<WalkPath> {
  if (points.length < 2) return straightPath(points);
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${FOOT_ROUTER}${coords}?overview=full&geometries=geojson&steps=true`;
  try {
    // One more try after a pause: a throttled answer arrives without CORS headers and looks like a network error.
    const res = await politely(() => fetchJson<OsrmRes>(url, {}, 12000)).catch(() => politely(() => fetchJson<OsrmRes>(url, {}, 12000)));
    const r = res.routes?.[0];
    if (res.code !== 'Ok' || !r) throw new Error('no route');
    const steps: RouteStep[] = [];
    for (const leg of r.legs)
      for (const s of leg.steps) {
        if (['new name', 'notification'].includes(s.maneuver.type)) continue;
        steps.push({
          location: { lat: s.maneuver.location[1], lng: s.maneuver.location[0] },
          type: s.maneuver.type,
          modifier: s.maneuver.modifier,
          name: s.name,
          distanceM: s.distance,
        });
      }
    return {
      path: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceKm: r.distance / 1000,
      steps,
      routed: true,
    };
  } catch {
    return straightPath(points);
  }
}
