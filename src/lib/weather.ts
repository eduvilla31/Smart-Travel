import { fetchJson } from './storage';
import type { Lang } from '../types';

const RAIN_PROB = 50; // % in any hour of the walk
const RAIN_MM = 0.3; // mm in any hour of the walk
const HOT_C = 28;
const WINDY_KMH = 40;

const CODES: Record<number, [string, string, string]> = {
  0: ['☀️', 'clear sky', 'cielo despejado'],
  1: ['🌤️', 'mainly clear', 'casi despejado'],
  2: ['⛅', 'partly cloudy', 'parcialmente nublado'],
  3: ['☁️', 'overcast', 'nublado'],
  45: ['🌫️', 'fog', 'niebla'],
  48: ['🌫️', 'freezing fog', 'niebla helada'],
  51: ['🌦️', 'light drizzle', 'llovizna ligera'],
  53: ['🌦️', 'drizzle', 'llovizna'],
  55: ['🌧️', 'heavy drizzle', 'llovizna intensa'],
  56: ['🌧️', 'freezing drizzle', 'llovizna helada'],
  57: ['🌧️', 'freezing drizzle', 'llovizna helada'],
  61: ['🌧️', 'light rain', 'lluvia ligera'],
  63: ['🌧️', 'rain', 'lluvia'],
  65: ['🌧️', 'heavy rain', 'lluvia intensa'],
  66: ['🌧️', 'freezing rain', 'lluvia helada'],
  67: ['🌧️', 'freezing rain', 'lluvia helada'],
  71: ['🌨️', 'light snow', 'nieve ligera'],
  73: ['🌨️', 'snow', 'nieve'],
  75: ['❄️', 'heavy snow', 'nevada intensa'],
  77: ['🌨️', 'snow grains', 'granos de nieve'],
  80: ['🌦️', 'rain showers', 'chubascos'],
  81: ['🌧️', 'rain showers', 'chubascos'],
  82: ['⛈️', 'violent showers', 'chubascos fuertes'],
  85: ['🌨️', 'snow showers', 'chubascos de nieve'],
  86: ['🌨️', 'snow showers', 'chubascos de nieve'],
  95: ['⛈️', 'thunderstorm', 'tormenta'],
  96: ['⛈️', 'thunderstorm with hail', 'tormenta con granizo'],
  99: ['⛈️', 'thunderstorm with hail', 'tormenta con granizo'],
};

export function describeCode(code: number, lang: Lang): { icon: string; text: string } {
  const c = CODES[code] ?? ['🌡️', 'weather', 'tiempo'];
  return { icon: c[0], text: lang === 'es' ? c[2] : c[1] };
}

export const isWetCode = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

export interface ForecastData {
  /** IANA time zone of the location (Open-Meteo resolves it when asked for "auto"). */
  timezone?: string;
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    precipitation_sum: number[];
  };
  current: { time: string; temperature_2m: number; precipitation: number; weather_code: number; wind_speed_10m: number };
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    precipitation: number[];
    weather_code: number[];
    wind_speed_10m: number[];
  };
}

export interface HourInfo { time: string; prob: number; mm: number; code: number; temp: number; wind: number }

export interface WeatherAnalysis {
  currentCode: number;
  currentTemp: number;
  hours: HourInfo[];
  maxProb: number;
  totalMm: number;
  maxTemp: number;
  maxWind: number;
  wetNow: boolean;
  rainExpected: boolean;
  /** First hour (HH:MM) of the walk when rain becomes likely. */
  rainFrom?: string;
  rainFromProb?: number;
  hot: boolean;
  windy: boolean;
  /** Set when planning for a later day, e.g. "tomorrow" or "Thursday". */
  dayLabel?: string;
}

export async function fetchForecast(lat: number, lng: number, timezone: string): Promise<ForecastData> {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    '&current=temperature_2m,precipitation,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum' +
    `&forecast_days=7&timezone=${encodeURIComponent(timezone)}`;
  return fetchJson<ForecastData>(url, { cache: 'no-store' }, 10000);
}

/** Look at the hours the walk covers, starting `offsetMin` from now. */
export function analyseForecast(data: ForecastData, durationMin: number, offsetMin = 0): WeatherAnalysis {
  const { current: cur, hourly: h } = data;
  let i0 = h.time.findIndex((t) => t.slice(0, 13) === cur.time.slice(0, 13));
  if (i0 < 0) i0 = 0;
  i0 += Math.floor(offsetMin / 60);
  const n = Math.max(1, Math.ceil(durationMin / 60) + 1);
  const hours: HourInfo[] = [];
  for (let i = i0; i < Math.min(h.time.length, i0 + n); i++) {
    hours.push({
      time: h.time[i].slice(11, 16),
      prob: h.precipitation_probability[i] ?? 0,
      mm: h.precipitation[i] ?? 0,
      code: h.weather_code[i],
      temp: h.temperature_2m[i],
      wind: h.wind_speed_10m?.[i] ?? 0,
    });
  }
  const wetHour = (x: HourInfo) => x.prob >= RAIN_PROB || x.mm >= RAIN_MM || isWetCode(x.code);
  const first = hours.find(wetHour);
  const wetNow = offsetMin === 0 && (isWetCode(cur.weather_code) || cur.precipitation > 0);
  const maxTemp = Math.max(cur.temperature_2m, ...hours.map((x) => x.temp));
  const maxWind = Math.max(0, ...hours.map((x) => x.wind));
  return {
    currentCode: cur.weather_code,
    currentTemp: Math.round(cur.temperature_2m),
    hours,
    maxProb: Math.max(0, ...hours.map((x) => x.prob)),
    totalMm: Math.round(hours.reduce((s, x) => s + x.mm, 0) * 10) / 10,
    maxTemp: Math.round(maxTemp),
    maxWind: Math.round(maxWind),
    wetNow,
    rainExpected: wetNow || !!first,
    rainFrom: first?.time,
    rainFromProb: first?.prob,
    hot: maxTemp >= HOT_C,
    windy: maxWind >= WINDY_KMH,
  };
}

/** Minutes until rain is likely, within the next `withinMin` minutes, or null. */
export function minutesUntilRain(data: ForecastData, withinMin = 60): number | null {
  const a = analyseForecast(data, withinMin);
  if (a.wetNow) return 0;
  if (!a.rainFrom) return null;
  const now = new Date(data.current.time);
  const [hh, mm] = a.rainFrom.split(':').map(Number);
  const at = new Date(now);
  at.setHours(hh, mm, 0, 0);
  if (at < now) return 0;
  const diff = Math.round((at.getTime() - now.getTime()) / 60000);
  return diff <= withinMin ? diff : null;
}

// ---------- the week ahead ----------

export type DayKind = 'outdoor' | 'mixed' | 'indoor';

export interface DayPlan {
  date: string; // YYYY-MM-DD
  index: number; // 0 = today
  code: number;
  tMax: number;
  tMin: number;
  rainProb: number;
  rainMm: number;
  kind: DayKind;
  /** Driest 3-hour daytime window, e.g. 10–13 (hours, local time). */
  best: { from: number; to: number; prob: number } | null;
}

const DAY_FROM = 8; // walks between 8:00 and 20:00
const DAY_TO = 20;

/** Summarise the 7-day forecast: how good each day is for walking, and its best hours. */
export function analyseWeek(data: ForecastData): DayPlan[] {
  const d = data.daily;
  if (!d) return [];
  const h = data.hourly;
  const nowHour = data.current.time.slice(0, 13);
  return d.time.map((date, index) => {
    const rainProb = d.precipitation_probability_max[index] ?? 0;
    const rainMm = Math.round((d.precipitation_sum[index] ?? 0) * 10) / 10;
    // hourly values for this day's walking hours (today: from now on)
    const hours: { hour: number; prob: number; mm: number }[] = [];
    h.time.forEach((t, i) => {
      if (!t.startsWith(date)) return;
      const hour = Number(t.slice(11, 13));
      if (hour < DAY_FROM || hour >= DAY_TO || (index === 0 && t.slice(0, 13) < nowHour)) return;
      hours.push({ hour, prob: h.precipitation_probability[i] ?? 0, mm: h.precipitation[i] ?? 0 });
    });
    let best: DayPlan['best'] = null;
    let bestScore = Infinity;
    for (let i = 0; i + 3 <= hours.length; i++) {
      const w = hours.slice(i, i + 3);
      if (w[2].hour - w[0].hour !== 2) continue;
      const prob = Math.max(...w.map((x) => x.prob));
      const score = prob + 20 * w.reduce((sum, x) => sum + x.mm, 0); // rain amount counts too
      if (score < bestScore) {
        bestScore = score;
        best = { from: w[0].hour, to: w[2].hour + 1, prob };
      }
    }
    const kind: DayKind =
      rainProb >= 65 || rainMm >= 5 ? (best && best.prob < 30 ? 'mixed' : 'indoor') : rainProb < 35 && rainMm < 1 ? 'outdoor' : 'mixed';
    return {
      date,
      index,
      code: d.weather_code[index],
      tMax: Math.round(d.temperature_2m_max[index]),
      tMin: Math.round(d.temperature_2m_min[index]),
      rainProb,
      rainMm,
      kind,
      best,
    };
  });
}

/** Minutes from now until a day's best walking window starts (0 for today, or if unknown). */
export function minutesUntilDay(data: ForecastData, day: DayPlan): number {
  if (day.index === 0 || !day.best) return 0;
  const now = new Date(data.current.time);
  const at = new Date(`${day.date}T${String(day.best.from).padStart(2, '0')}:00`);
  return Math.max(0, Math.round((at.getTime() - now.getTime()) / 60000));
}

export type WeekAdvice =
  | { kind: 'allDry' }
  | { kind: 'todayBest' }
  | { kind: 'wetTodayDryLater'; day: DayPlan }
  | { kind: 'bestHoursToday'; from: number; to: number }
  | { kind: 'wetWeek'; day: DayPlan | null }
  | { kind: 'none' };

/** One piece of advice: do more today, wait for a dry day, or pick the best hours. */
export function weekAdvice(days: DayPlan[]): WeekAdvice {
  if (!days.length) return { kind: 'none' };
  const [today, ...later] = days;
  const nextDry = later.find((d) => d.kind === 'outdoor');
  if (days.every((d) => d.kind === 'outdoor')) return { kind: 'allDry' };
  if (today.kind === 'outdoor' && later.slice(0, 2).some((d) => d.kind !== 'outdoor')) return { kind: 'todayBest' };
  if (today.kind === 'indoor' && nextDry) return { kind: 'wetTodayDryLater', day: nextDry };
  if (today.kind === 'mixed' && today.best) return { kind: 'bestHoursToday', from: today.best.from, to: today.best.to };
  if (today.kind === 'indoor') {
    const leastWet = later.filter((d) => d.kind === 'mixed').sort((a, b) => a.rainProb - b.rainProb)[0] ?? null;
    return { kind: 'wetWeek', day: leastWet };
  }
  return { kind: 'none' };
}
