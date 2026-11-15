/**
 * Reads the common forms of OpenStreetMap's opening_hours, e.g.
 *   "Mo-Fr 10:00-18:00; Sa 10:00-14:00; Su off", "Tu-Su 10:00-12:00,14:00-17:00", "24/7".
 * Anything it doesn't understand (public holidays, months, sunrise…) gives "unknown",
 * so the app never claims a place is closed when it isn't sure.
 */
export type OpenStatus =
  | { state: 'open'; closes?: string } // closes = HH:MM today, if known
  | { state: 'closed'; opens?: string } // opens = HH:MM later today, if any
  | { state: 'unknown' };

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface Rule { days: Set<number>; ranges: [number, number][]; off: boolean }

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function parseDays(spec: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
    if (!m) return null; // PH, SH, months, week numbers…: not understood
    const a = DAYS.indexOf(m[1]);
    const b = m[2] ? DAYS.indexOf(m[2]) : a;
    for (let i = a; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === b) break;
    }
  }
  return out;
}

export function parseOpeningHours(raw: string): Rule[] | null {
  const text = raw.trim();
  if (text === '24/7') return [{ days: new Set(DAYS.map((_, i) => i)), ranges: [[0, 24 * 60]], off: false }];
  const rules: Rule[] = [];
  for (const chunk of text.split(';').map((c) => c.trim()).filter(Boolean)) {
    const m = chunk.match(/^([A-Za-z,\- ]*?)\s*((?:\d{1,2}:\d{2}-\d{1,2}:\d{2}\+?,?\s*)+|off|closed)$/i);
    if (!m) return null;
    const daySpec = m[1].trim();
    const days = daySpec ? parseDays(daySpec.replace(/\s+/g, '')) : new Set(DAYS.map((_, i) => i));
    if (!days) return null;
    const off = /^(off|closed)$/i.test(m[2]);
    const ranges: [number, number][] = off
      ? []
      : m[2]
          .split(',')
          .map((r) => r.trim().replace('+', ''))
          .filter(Boolean)
          .map((r) => {
            const [a, b] = r.split('-');
            let end = toMin(b);
            const start = toMin(a);
            if (end <= start) end += 24 * 60; // past midnight
            return [start, end] as [number, number];
          });
    rules.push({ days, ranges, off });
  }
  return rules.length ? rules : null;
}

/** Weekday (0 = Monday) and minutes since midnight of a moment, in a time zone. */
export function localTime(at: Date, timeZone?: string): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { day, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function openStatus(raw: string | undefined, at: Date, timeZone?: string): OpenStatus {
  if (!raw) return { state: 'unknown' };
  const rules = parseOpeningHours(raw);
  if (!rules) return { state: 'unknown' };
  const { day, min } = localTime(at, timeZone);
  // Later rules override earlier ones for the days they mention (OSM semantics).
  let today: Rule | undefined;
  for (const r of rules) if (r.days.has(day)) today = r;
  const yesterday = (day + 6) % 7;
  let prev: Rule | undefined;
  for (const r of rules) if (r.days.has(yesterday)) prev = r;
  // Still open from a range that started yesterday and runs past midnight?
  for (const [a, b] of prev?.off ? [] : prev?.ranges ?? []) if (b > 24 * 60 && min < b - 24 * 60 && a < 24 * 60) return { state: 'open', closes: toHHMM(b) };
  if (!today) return { state: 'closed' };
  if (today.off) return { state: 'closed' };
  for (const [a, b] of today.ranges) if (min >= a && min < b) return { state: 'open', closes: b >= 24 * 60 ? undefined : toHHMM(b) };
  const later = today.ranges.map(([a]) => a).filter((a) => a > min).sort((x, y) => x - y)[0];
  return later !== undefined ? { state: 'closed', opens: toHHMM(later) } : { state: 'closed' };
}

/** Short label for a stop's opening status, or '' when there is nothing useful to say. */
export function hoursLabel(st: OpenStatus | undefined, t: (k: 'closedThen' | 'closesAt' | 'opensAt', v?: Record<string, string>) => string): string {
  if (!st || st.state === 'unknown') return '';
  if (st.state === 'closed') return st.opens ? `🔒 ${t('opensAt', { time: st.opens })}` : `🔒 ${t('closedThen')}`;
  return st.closes ? `🕔 ${t('closesAt', { time: st.closes })}` : '';
}
