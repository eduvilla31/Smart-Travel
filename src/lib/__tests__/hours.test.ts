import { describe, expect, it } from 'vitest';
import { openStatus } from '../openingHours';

// 2026-11-16 is a Monday. Times are given in Europe/Zurich.
const at = (iso: string) => new Date(iso);
const tz = 'Europe/Zurich';

describe('opening hours', () => {
  it('reads weekday ranges and day-off rules', () => {
    const oh = 'Tu-Su 10:00-18:00; Mo off';
    expect(openStatus(oh, at('2026-11-16T12:00:00+01:00'), tz)).toEqual({ state: 'closed' }); // Monday
    expect(openStatus(oh, at('2026-11-17T12:00:00+01:00'), tz)).toEqual({ state: 'open', closes: '18:00' });
    expect(openStatus(oh, at('2026-11-17T09:00:00+01:00'), tz)).toEqual({ state: 'closed', opens: '10:00' });
  });

  it('handles split days, lists of days and 24/7', () => {
    expect(openStatus('Mo-Fr 09:00-12:00,14:00-18:00; Sa 10:00-16:00', at('2026-11-16T13:00:00+01:00'), tz)).toEqual({ state: 'closed', opens: '14:00' });
    expect(openStatus('Mo,We,Fr 08:00-20:00', at('2026-11-18T19:00:00+01:00'), tz)).toEqual({ state: 'open', closes: '20:00' });
    expect(openStatus('24/7', at('2026-11-16T03:00:00+01:00'), tz).state).toBe('open');
  });

  it('handles opening past midnight', () => {
    expect(openStatus('Fr-Sa 20:00-02:00', at('2026-11-22T01:00:00+01:00'), tz)).toMatchObject({ state: 'open', closes: '02:00' }); // early Sunday
  });

  it('says unknown rather than guessing', () => {
    expect(openStatus('Mo-Fr 10:00-18:00; PH off', at('2026-11-16T12:00:00+01:00'), tz).state).toBe('unknown');
    expect(openStatus('Apr-Oct: 09:00-19:00', at('2026-11-16T12:00:00+01:00'), tz).state).toBe('unknown');
    expect(openStatus(undefined, at('2026-11-16T12:00:00+01:00'), tz).state).toBe('unknown');
  });
});
