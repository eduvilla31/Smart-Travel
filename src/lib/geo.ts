import type { LatLng } from '../types';

export const DETOUR_FACTOR = 1.3; // streets are not straight lines

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Estimated walking distance in km (straight line x detour factor). */
export const walkKm = (a: LatLng, b: LatLng) => (haversineM(a, b) * DETOUR_FACTOR) / 1000;

export function pathLengthM(path: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversineM(path[i - 1], path[i]);
  return m;
}

/** Point at `distM` metres along a polyline. */
export function pointAlong(path: LatLng[], distM: number): { point: LatLng; done: boolean } {
  let left = distM;
  for (let i = 1; i < path.length; i++) {
    const seg = haversineM(path[i - 1], path[i]);
    if (left <= seg) {
      const f = seg === 0 ? 0 : left / seg;
      return {
        point: {
          lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * f,
          lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * f,
        },
        done: false,
      };
    }
    left -= seg;
  }
  return { point: path[path.length - 1], done: true };
}

/** Compass bearing from a to b in degrees (0 = north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest difference between two bearings, 0..180. */
export const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
