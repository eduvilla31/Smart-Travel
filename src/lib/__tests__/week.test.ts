import { describe, expect, it } from 'vitest';
import { analyseForecast, analyseWeek, minutesUntilDay, weekAdvice, type ForecastData } from '../weather';

/** A week where each day's rain chance follows `pattern` (per day), wet hours 14–17 if wet. */
function week(pattern: number[], wetHours: [number, number] = [14, 18]): ForecastData {
  const days = pattern.map((_, i) => `2026-11-${String(15 + i).padStart(2, '0')}`);
  const time: string[] = [];
  const prob: number[] = [];
  const mm: number[] = [];
  days.forEach((d, i) =>
    Array.from({ length: 24 }, (_, h) => {
      time.push(`${d}T${String(h).padStart(2, '0')}:00`);
      const wet = pattern[i] >= 50 && h >= wetHours[0] && h < wetHours[1];
      prob.push(wet ? pattern[i] : Math.min(pattern[i], 20));
      mm.push(wet ? 1.5 : 0);
    }),
  );
  return {
    current: { time: `${days[0]}T08:15`, temperature_2m: 10, precipitation: 0, weather_code: 2, wind_speed_10m: 5 },
    hourly: { time, temperature_2m: time.map(() => 10), precipitation_probability: prob, precipitation: mm, weather_code: time.map(() => 2), wind_speed_10m: time.map(() => 5) },
    daily: {
      time: days,
      weather_code: pattern.map((p) => (p >= 50 ? 63 : 1)),
      temperature_2m_max: pattern.map(() => 14),
      temperature_2m_min: pattern.map(() => 6),
      precipitation_probability_max: pattern,
      precipitation_sum: pattern.map((p) => (p >= 50 ? 6 : 0)),
    },
  };
}

describe('weather for the week', () => {
  it('rates each day and finds its driest hours', () => {
    const days = analyseWeek(week([80, 10, 60, 10, 10, 10, 10]));
    expect(days).toHaveLength(7);
    expect(days[1]).toMatchObject({ kind: 'outdoor' });
    // rain only in the afternoon: the morning is the best window, so the day is "mixed"
    expect(days[0].kind).toBe('mixed');
    expect(days[0].best!.from).toBeLessThan(14);
  });

  it('advises: wet all day today, dry tomorrow -> walk outside tomorrow', () => {
    const days = analyseWeek(week([90, 10, 10, 10, 10, 10, 10], [0, 24]));
    expect(days[0].kind).toBe('indoor');
    expect(weekAdvice(days)).toMatchObject({ kind: 'wetTodayDryLater', day: { index: 1 } });
  });

  it('advises: dry today, wet tomorrow -> do the outdoor walk today', () => {
    expect(weekAdvice(analyseWeek(week([10, 90, 90, 10, 10, 10, 10], [0, 24])))).toEqual({ kind: 'todayBest' });
  });

  it('advises: dry all week', () => {
    expect(weekAdvice(analyseWeek(week([10, 10, 10, 10, 10, 10, 10])))).toEqual({ kind: 'allDry' });
  });

  it('plans a later day from its best window', () => {
    const data = week([10, 80, 10, 10, 10, 10, 10]);
    const days = analyseWeek(data);
    const tomorrow = days[1];
    const offset = minutesUntilDay(data, tomorrow);
    expect(offset).toBeGreaterThan(20 * 60); // from 08:15 today to tomorrow's window
    const w = analyseForecast(data, 120, offset);
    expect(w.rainExpected).toBe(false); // tomorrow's best window is in the dry morning
    expect(w.wetNow).toBe(false);
  });
});
