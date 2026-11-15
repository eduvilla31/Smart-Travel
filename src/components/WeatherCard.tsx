import { loc, useI18n, type T } from '../i18n';
import { useCity } from '../city';
import type { Lang } from '../types';
import { describeCode, weekAdvice, type DayPlan, type WeatherAnalysis } from '../lib/weather';

interface Props {
  weather: WeatherAnalysis | null;
  week: DayPlan[];
  planDay: number;
  setPlanDay: (i: number) => void;
  weatherError: boolean;
  ignoreWeather: boolean;
  setIgnoreWeather: (v: boolean) => void;
}

/** "Today", "Tomorrow", "Wed"…; inSentence gives "today"/"tomorrow" for use mid-sentence. */
export function dayName(d: DayPlan, lang: Lang, t: T, long = false, inSentence = false): string {
  if (d.index === 0) return inSentence ? t('today').toLowerCase() : t('today');
  if (d.index === 1) return inSentence ? t('tomorrow').toLowerCase() : t('tomorrow');
  return new Intl.DateTimeFormat(lang, { weekday: long ? 'long' : 'short' }).format(new Date(`${d.date}T12:00`));
}

const KIND_ICON = { outdoor: '👍', mixed: '⛅', indoor: '🏛️' } as const;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function adviceText(days: DayPlan[], lang: Lang, t: T): string {
  const a = weekAdvice(days);
  switch (a.kind) {
    case 'allDry':
      return t('weekAllDry');
    case 'todayBest':
      return t('weekTodayBest');
    case 'wetTodayDryLater':
      return t('weekWetTodayDryLater', { day: dayName(a.day, lang, t, true, true) });
    case 'bestHoursToday':
      return t('weekBestHours', { from: hh(a.from), to: hh(a.to) });
    case 'wetWeek':
      return a.day ? t('weekWetLeastDay', { day: dayName(a.day, lang, t, true) }) : t('weekWet');
    default:
      return '';
  }
}

/** Today's weather plus the week ahead; tap a day to plan the walk for it. */
export default function WeatherCard({ weather, week, planDay, setPlanDay, weatherError, ignoreWeather, setIgnoreWeather }: Props) {
  const { t, lang } = useI18n();
  const city = useCity();
  if (!weather)
    return (
      <section className="card weather" aria-live="polite">
        <div className="weather-row">
          <span className="weather-icon">{weatherError ? '❔' : '⏳'}</span>
          <div className="weather-title">{weatherError ? t('weatherFailed') : t('weatherChecking')}</div>
        </div>
      </section>
    );
  const d = describeCode(weather.currentCode, lang);
  const rainy = weather.rainExpected && !ignoreWeather;
  const chosen = week[planDay];
  const advice = adviceText(week, lang, t);

  return (
    <section className={`card weather${rainy ? ' rainy' : ''}`} aria-live="polite">
      <div className="weather-row">
        <span className="weather-icon">{d.icon}</span>
        <div>
          <div className="weather-title">
            {loc(city.city.name, lang)}: {weather.currentTemp}°C, {d.text}
          </div>
          <div className="muted small">{t('weatherWindow', { prob: weather.maxProb, temp: weather.maxTemp })}</div>
        </div>
      </div>

      {week.length > 0 && (
        <>
          <h3 className="week-title">{t('thisWeek')}</h3>
          <div className="week" role="radiogroup" aria-label={t('planFor')}>
            {week.map((day) => (
              <button
                key={day.date}
                type="button"
                role="radio"
                aria-checked={day.index === planDay}
                className={`day ${day.kind}`}
                onClick={() => setPlanDay(day.index)}
              >
                <span className="day-name">{dayName(day, lang, t)}</span>
                <span className="day-icon" aria-hidden="true">{describeCode(day.code, lang).icon}</span>
                <span className="day-temp">
                  {day.tMax}° <span className="muted">{day.tMin}°</span>
                </span>
                <span className={`day-rain${day.rainProb >= 50 ? ' wet' : ''}`}>💧{day.rainProb}%</span>
                <span className="day-kind" title={t(`kind_${day.kind}`)}>{KIND_ICON[day.kind]}</span>
              </button>
            ))}
          </div>
          {advice && <p className="week-advice">💡 {advice}</p>}
          {chosen && (
            <p className="muted small">
              {t('planningFor', { day: dayName(chosen, lang, t, true) })} · {t(`kind_${chosen.kind}`)}
              {chosen.best ? ` · ${t('bestHours', { from: hh(chosen.best.from), to: hh(chosen.best.to) })}` : ''}
            </p>
          )}
        </>
      )}

      {weather.hours.length > 0 && (
        <div className="hours" aria-hidden="true">
          {weather.hours.map((h) => (
            <div key={h.time} className="hour">
              <span>{h.time}</span>
              <span>{describeCode(h.code, lang).icon}</span>
              <span className={h.prob >= 50 ? 'wet' : ''}>{h.prob}%</span>
            </div>
          ))}
        </div>
      )}
      {weather.rainExpected && (
        <div className="rain-advice">
          <p>
            {weather.wetNow
              ? t('rainNow', { desc: d.text })
              : weather.dayLabel
                ? t('rainAtDay', { day: weather.dayLabel, time: weather.rainFrom ?? '', prob: weather.rainFromProb ?? weather.maxProb })
                : t('rainAt', { time: weather.rainFrom ?? '', prob: weather.rainFromProb ?? weather.maxProb })}{' '}
            {t('rainAdvice')}
          </p>
          <label className="toggle compact">
            <input type="checkbox" checked={ignoreWeather} onChange={(e) => setIgnoreWeather(e.target.checked)} />
            <span>{t('rainSkipped')}</span>
          </label>
        </div>
      )}
    </section>
  );
}
