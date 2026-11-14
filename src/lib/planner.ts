import { fmtDuration, loc, type T } from '../i18n';
import {
  PACE_KMH,
  type Interest,
  type Lang,
  type LatLng,
  type PlannedRoute,
  type Poi,
  type Preferences,
} from '../types';
import { haversineM, walkKm } from './geo';
import { importance } from './places';
import { walkingPath } from './routing';
import { describeCode, type WeatherAnalysis } from './weather';

export const DWELL_MIN = 4; // minutes spent at each stop
export const MAX_STOPS = 12;
const MIN_FILL = 6; // below this, non-matching places may fill the route
const ANCHORS = 3; // top sights reserved before filling by value

export type Weights = Partial<Record<Interest, number>>;
type Place = LatLng & { name: string };

export interface SelectInput {
  pois: Poi[];
  start: LatLng;
  /** Fixed end point; undefined = route ends at its last stop. */
  end?: LatLng;
  budgetMin: number;
  maxKm: number;
  kmh: number;
  weights: Weights;
  indoorBonus?: number;
  parkBonus?: number;
  avoidStairs?: boolean;
  radiusKm: number;
}

export function interestMatch(p: Poi, w: Weights): number {
  const vals = p.interests.map((i) => w[i] ?? 0).sort((a, b) => b - a);
  if (!vals.length || vals[0] === 0) return 0;
  return vals[0] + 0.25 * (vals[1] ?? 0);
}

export function scorePoi(p: Poi, input: Pick<SelectInput, 'weights' | 'indoorBonus' | 'parkBonus'>): number {
  let s = interestMatch(p, input.weights) * 6 + importance(p);
  if (p.indoor) s += input.indoorBonus ?? 0;
  if (p.interests.includes('parks')) s += input.parkBonus ?? 0;
  return s;
}

function pathKm(start: LatLng, stops: LatLng[], end?: LatLng): number {
  const pts = [start, ...stops, ...(end ? [end] : [])];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += walkKm(pts[i - 1], pts[i]);
  return km;
}

const minutesFor = (km: number, stops: number, kmh: number) => (km / kmh) * 60 + stops * DWELL_MIN;

/** Cheapest place to insert `p` into start → stops → end. */
function bestInsertion(start: LatLng, stops: Poi[], p: Poi, end?: LatLng) {
  const pts: LatLng[] = [start, ...stops, ...(end ? [end] : [])];
  let best = { idx: 0, delta: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const d = walkKm(pts[i], p) + walkKm(p, pts[i + 1]) - walkKm(pts[i], pts[i + 1]);
    if (d < best.delta) best = { idx: i, delta: d };
  }
  if (!end) {
    const d = walkKm(pts[pts.length - 1], p);
    if (d < best.delta) best = { idx: stops.length, delta: d };
  }
  return best;
}

/** 2-opt: reverse sub-sequences while it shortens the walk (start and end stay fixed). */
export function twoOpt<P extends LatLng>(start: LatLng, stops: P[], end?: LatLng): P[] {
  let route = stops.slice();
  let best = pathKm(start, route, end);
  for (let pass = 0, improved = true; improved && pass < 40; pass++) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++)
      for (let k = i + 1; k < route.length; k++) {
        const cand = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
        const km = pathKm(start, cand, end);
        if (km + 1e-9 < best) {
          route = cand;
          best = km;
          improved = true;
        }
      }
  }
  return route;
}

/** Pick the highest-scoring places that fit the time and distance budget. */
export function selectStops(input: SelectInput): Poi[] {
  const { start, end, budgetMin, maxKm, kmh, radiusKm } = input;
  const pool = input.pois
    .filter((p) => haversineM(start, p) <= radiusKm * 1000)
    .filter((p) => !(input.avoidStairs && p.stairs))
    .map((p) => ({ p, match: interestMatch(p, input.weights), score: scorePoi(p, input) }))
    .sort((a, b) => b.score - a.score);

  let stops: Poi[] = [];
  // Greedy by value: how interesting a place is per minute it adds (walking + visiting).
  // The power above 1 keeps famous sights in, without letting one far-away landmark eat the walk.
  const fill = (candidates: typeof pool) => {
    while (stops.length < MAX_STOPS) {
      let best: { p: Poi; idx: number; value: number } | null = null;
      const baseKm = pathKm(start, stops, end);
      for (const c of candidates) {
        if (stops.includes(c.p)) continue;
        // Two stops 30 m apart would trigger together: skip near-duplicates.
        if (stops.some((s) => haversineM(s, c.p) < 45)) continue;
        const ins = bestInsertion(start, stops, c.p, end);
        const km = baseKm + ins.delta;
        if (km > maxKm || minutesFor(km, stops.length + 1, kmh) > budgetMin) continue;
        const value = c.score ** 1.6 / ((ins.delta / kmh) * 60 + DWELL_MIN);
        if (!best || value > best.value) best = { p: c.p, idx: ins.idx, value };
      }
      if (!best) return;
      stops.splice(best.idx, 0, best.p);
    }
  };
  // Anchors first: the top sights for these interests, if each fits within half the walk.
  for (const c of pool.filter((x) => x.match > 0).slice(0, ANCHORS)) {
    if (stops.some((s) => haversineM(s, c.p) < 45)) continue;
    const ins = bestInsertion(start, stops, c.p, end);
    const km = pathKm(start, stops, end) + ins.delta;
    if (km <= maxKm / 2 && minutesFor(km, stops.length + 1, kmh) <= budgetMin / 2) stops.splice(ins.idx, 0, c.p);
  }
  fill(pool.filter((c) => c.match > 0));
  if (stops.length < MIN_FILL) fill(pool);
  stops = twoOpt(start, stops, end);
  return stops;
}

export interface PlanContext {
  pois: Poi[];
  prefs: Preferences;
  start: Place;
  station: Place;
  weather: WeatherAnalysis | null;
  ignoreWeather: boolean;
  /** Stops to avoid today (closures, demonstrations), with a short reason. */
  blocked?: { id: string; title: string }[];
  t: T;
  lang: Lang;
}

export function budgets(prefs: Preferences) {
  const kmh = PACE_KMH[prefs.pace];
  const budgetMin = prefs.limitBy === 'duration' ? prefs.durationMin : 8 * 60;
  const maxKm = prefs.limitBy === 'distance' ? prefs.distanceKm : (kmh * prefs.durationMin) / 60;
  const effKm = Math.min(maxKm, (kmh * budgetMin) / 60);
  const radiusKm = Math.min(3.5, Math.max(0.8, effKm / (prefs.end === 'loop' ? 2.4 : 1.6)));
  return { kmh, budgetMin, maxKm, radiusKm };
}

const VARIANT_WEIGHTS: Record<'classic' | 'urban' | 'museums', Weights> = {
  classic: { historic: 1, architecture: 0.8, local: 0.3 },
  urban: { streetart: 1, local: 0.7, food: 0.4 },
  museums: { artists: 1, architecture: 0.3 },
};

function overlap(a: Poi[], b: Poi[]): number {
  if (!a.length || !b.length) return 0;
  const ids = new Set(a.map((p) => p.id));
  return b.filter((p) => ids.has(p.id)).length / Math.max(a.length, b.length);
}

/** Build one route: select stops, fetch the walking path, trim if the real path is too long. */
async function buildOne(
  variant: PlannedRoute['variant'],
  sel: SelectInput,
  ctx: PlanContext,
  endPlace: Place | undefined,
  extraReasons: string[] = [],
): Promise<PlannedRoute> {
  let stops = selectStops(sel);
  let walk = await walkingPath([sel.start, ...stops, ...(endPlace ? [endPlace] : [])]);
  for (let tries = 0; tries < 3 && stops.length > 3; tries++) {
    const min = minutesFor(walk.distanceKm, stops.length, sel.kmh);
    if (walk.distanceKm <= sel.maxKm * 1.08 && min <= sel.budgetMin * 1.08) break;
    // Drop the stop that costs the most walking for what it offers, then re-route.
    const pts = [sel.start, ...stops, ...(endPlace ? [endPlace] : [])];
    const saving = (i: number) => {
      const prev = pts[i];
      const next = pts[i + 2];
      const here = pts[i + 1];
      return next ? walkKm(prev, here) + walkKm(here, next) - walkKm(prev, next) : walkKm(prev, here);
    };
    const worst = stops.reduce((a, b, i) => {
      const ia = stops.indexOf(a);
      return saving(i) / scorePoi(b, sel) > saving(ia) / scorePoi(a, sel) ? b : a;
    });
    stops = stops.filter((s) => s !== worst);
    walk = await walkingPath([sel.start, ...stops, ...(endPlace ? [endPlace] : [])]);
  }
  const last = stops[stops.length - 1];
  const end: Place = endPlace ?? (last ? { lat: last.lat, lng: last.lng, name: loc(last.name, ctx.lang) } : ctx.start);
  const walkMin = Math.round((walk.distanceKm / sel.kmh) * 60);
  const totalMin = walkMin + stops.length * DWELL_MIN;
  const { t } = ctx;
  const reasons = [...extraReasons];
  reasons.push(
    stops.length < 4
      ? t('reasonShort', { n: stops.length })
      : t('reasonFits', { stops: stops.length, time: fmtDuration(totalMin, t), km: walk.distanceKm.toFixed(1) }),
  );
  return {
    id: `${variant}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    variant,
    title: t(`variant_${variant}`),
    start: ctx.start,
    end,
    stops,
    path: walk.path,
    steps: walk.steps,
    distanceKm: Math.round(walk.distanceKm * 10) / 10,
    walkMin,
    totalMin,
    routed: walk.routed,
    reasons,
  };
}

/** Default route + themed alternatives, with weather applied last. */
export async function planRoutes(ctxIn: PlanContext): Promise<PlannedRoute[]> {
  let ctx = ctxIn;
  const { prefs, t, lang } = ctx;
  const b = budgets(prefs);
  const endPlace = prefs.end === 'loop' ? ctx.start : prefs.end === 'station' ? ctx.station : undefined;
  const weights: Weights = Object.fromEntries(prefs.interests.map((i) => [i, 1]));
  const w = ctx.ignoreWeather ? null : ctx.weather;

  // City context first: drop stops that are blocked today, and say so.
  const blocked = new Map((ctx.blocked ?? []).map((b) => [b.id, b.title]));
  const pois = ctx.pois.filter((p) => !blocked.has(p.id));
  const contextNotes = ctx.pois
    .filter((p) => blocked.has(p.id) && haversineM(ctx.start, p) <= b.radiusKm * 1000)
    .map((p) => t('reasonContext', { stop: loc(p.name, lang), title: blocked.get(p.id)! }));
  ctx = { ...ctx, pois };

  const base: SelectInput = {
    pois: ctx.pois,
    start: ctx.start,
    end: endPlace,
    budgetMin: b.budgetMin,
    maxKm: b.maxKm,
    kmh: b.kmh,
    weights,
    avoidStairs: prefs.avoidStairs,
    radiusKm: b.radiusKm,
  };

  const weatherNotes: string[] = [...contextNotes];
  if (w?.hot) {
    base.parkBonus = 3;
    weatherNotes.push(t('reasonHeat', { temp: w.maxTemp }));
  }
  if (w?.windy) weatherNotes.push(t('reasonWind', { wind: w.maxWind }));

  const results: PlannedRoute[] = [];

  if (w?.rainExpected) {
    // Shorter, indoor-heavy, ending at a covered stop.
    const why = w.wetNow
      ? t('rainNow', { desc: describeCode(w.currentCode, lang).text })
      : t('rainAt', { time: w.rainFrom ?? '', prob: w.rainFromProb ?? w.maxProb });
    const planned = prefs.limitBy === 'duration' ? prefs.durationMin : Math.round((b.maxKm / b.kmh) * 60 + 8 * DWELL_MIN);
    const rainBudget = Math.max(45, Math.round(planned * 0.7));
    const rainSel: SelectInput = { ...base, budgetMin: rainBudget, maxKm: b.maxKm * 0.7, indoorBonus: 6 };
    const shelter = ctx.pois
      .filter((p) => p.indoor && haversineM(ctx.start, p) <= b.radiusKm * 700)
      .sort((x, y) => scorePoi(y, rainSel) - scorePoi(x, rainSel))[0];
    const shelterPlace = shelter ? { lat: shelter.lat, lng: shelter.lng, name: loc(shelter.name, lang) } : endPlace;
    const rain = await buildOne('rain', { ...rainSel, end: shelterPlace, pois: ctx.pois.filter((p) => p !== shelter) }, ctx, shelterPlace);
    if (shelter) {
      // the shelter is the final stop, not just an end point
      rain.stops = [...rain.stops, shelter];
      rain.totalMin += DWELL_MIN;
    }
    const indoor = rain.stops.filter((s) => s.indoor).length;
    rain.reasons = [
      ...contextNotes,
      t('reasonRainShort', { why, min: rain.totalMin, orig: fmtDuration(planned, t), end: rain.end.name }),
      t('reasonRainIndoor', { why: '', indoor, stops: rain.stops.length }).trim(),
      ...rain.reasons.slice(-1),
    ];
    results.push(rain);
  }

  const def = await buildOne('default', base, ctx, endPlace, weatherNotes);
  results.push(def);

  for (const v of ['classic', 'urban', 'museums'] as const) {
    const r = await buildOne(v, { ...base, weights: VARIANT_WEIGHTS[v] }, ctx, endPlace, weatherNotes);
    if (r.stops.length >= 3 && results.every((x) => overlap(x.stops, r.stops) < 0.8)) results.push(r);
  }
  return results;
}
