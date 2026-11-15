import { useState } from 'react';
import { INTEREST_LABELS, fmtDuration, loc, useI18n } from '../i18n';
import { INTERESTS, LANGS, type ActiveTour, type Interest, type PlannedRoute, type Poi, type Preferences, type SavedTour } from '../types';
import ContextCard from '../components/ContextCard';
import PhotoIdentify from '../components/PhotoIdentify';
import { startCompass } from '../lib/compass';
import { distanceToCityKm, inCity } from '../lib/places';
import CityPicker from '../components/CityPicker';
import PlaceSelect from '../components/PlaceSelect';
import type { CityData, StartPoint } from '../types';
import { useCity } from '../city';
import { type DayPlan, type WeatherAnalysis } from '../lib/weather';
import WeatherCard from '../components/WeatherCard';
import type { ContextState, DetectState, GpsState, PlanStatus } from '../App';

interface Props {
  prefs: Preferences;
  setPrefs: (p: Partial<Preferences>) => void;
  gps: GpsState;
  weather: WeatherAnalysis | null;
  weatherError: boolean;
  ignoreWeather: boolean;
  setIgnoreWeather: (v: boolean) => void;
  planStatus: PlanStatus;
  onPlan: () => void;
  savedTours: SavedTour[];
  places: Poi[];
  context: ContextState;
  onApiChanged: () => void;
  activeTour: ActiveTour | null;
  onResume: () => void;
  onDiscard: () => void;
  onWalkAgain: (r: PlannedRoute, cityId?: string, city?: CityData) => void;
  onChooseCity: (id: string) => void;
  week: DayPlan[];
  planDay: number;
  setPlanDay: (i: number) => void;
  onOpenSettings: () => void;
  points: StartPoint[];
  gpsInCity: boolean;
  onChooseSearched: (c: CityData) => void;
  onUseHere: () => void;
  detect: DetectState;
  planError: string | null;
}

export default function Home(props: Props) {
  const { prefs, setPrefs, gps, planStatus } = props;
  const { t, lang } = useI18n();
  const city = useCity();
  const cityName = loc(city.city.name, lang);
  const [photo, setPhoto] = useState(false);

  let greeting = t('locating');
  if (gps.status === 'error') greeting = t('noGps');
  if (gps.status === 'ok')
    greeting = inCity(city, gps.pos)
      ? t('inCity', { city: cityName })
      : t('farFromCity', { km: Math.round(distanceToCityKm(city, gps.pos)), city: cityName });

  const toggleInterest = (i: Interest) => {
    const has = prefs.interests.includes(i);
    const next = has ? prefs.interests.filter((x) => x !== i) : [...prefs.interests, i];
    if (next.length) setPrefs({ interests: next });
  };


  return (
    <main className="page">
      <header className="hero">
        <div className="brand">
          <img src="icons/icon-192.png" alt="" className="brand-icon" />
          <div>
            <h1>{t('appName')}</h1>
            <p className="subtitle">{t('tagline')}</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="lang-switch" role="group" aria-label={t('language')}>
            {LANGS.map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => setPrefs({ lang: l })}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="icon-btn" type="button" onClick={props.onOpenSettings} aria-label={t('settings')}>⚙️</button>
        </div>
      </header>

      <CityPicker
        onChoose={props.onChooseCity}
        onChooseSearched={props.onChooseSearched}
        onUseHere={props.onUseHere}
        detect={props.detect}
        gpsReady={gps.status === 'ok'}
      />

      <p className="greeting" aria-live="polite">📍 {greeting}</p>

      {props.activeTour && (
        <section className="card resume-card">
          <strong>{props.activeTour.route.title}</strong>
          <p className="muted small">
            {Object.keys(props.activeTour.status).length}/{props.activeTour.route.stops.length} {t('stops')}
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" type="button" onClick={props.onResume}>▶ {t('resumeTour')}</button>
            <button className="btn btn-ghost" type="button" onClick={props.onDiscard}>{t('discard')}</button>
          </div>
        </section>
      )}

      <WeatherCard {...props} />
      <ContextCard context={props.context} />

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          props.onPlan();
        }}
      >
        <h2>{t('planTitle')}</h2>

        <div className="segmented" role="radiogroup" aria-label={t('limitBy')}>
          {(['duration', 'distance'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={prefs.limitBy === m} onClick={() => setPrefs({ limitBy: m })}>
              {t(m)}
            </button>
          ))}
        </div>

        {prefs.limitBy === 'duration' ? (
          <label className="field">
            <span className="field-label">
              {t('duration')} <output>{fmtDuration(prefs.durationMin, t)}</output>
            </span>
            <input type="range" min={30} max={300} step={15} value={prefs.durationMin}
              onChange={(e) => setPrefs({ durationMin: Number(e.target.value) })} />
            <span className="range-ends"><span>30 {t('min')}</span><span>5 {t('hShort')}</span></span>
          </label>
        ) : (
          <label className="field">
            <span className="field-label">
              {t('distance')} <output>{prefs.distanceKm} km</output>
            </span>
            <input type="range" min={1} max={20} step={0.5} value={prefs.distanceKm}
              onChange={(e) => setPrefs({ distanceKm: Number(e.target.value) })} />
            <span className="range-ends"><span>1 km</span><span>20 km</span></span>
          </label>
        )}

        <fieldset className="field">
          <legend className="field-label">{t('interests')}</legend>
          <div className="chips">
            {INTERESTS.map((i) => (
              <button key={i} type="button" className="chip" aria-pressed={prefs.interests.includes(i)} onClick={() => toggleInterest(i)}>
                {INTEREST_LABELS[i][lang]}
              </button>
            ))}
          </div>
        </fieldset>

        <PlaceSelect
          label={t('startFrom')}
          // Not in this city: show the place that will really be used instead of "my location".
          value={prefs.startId === 'gps' && !props.gpsInCity ? props.points[0]?.id ?? 'gps' : prefs.startId}
          onChange={(v) => setPrefs({ startId: v })}
          extra={[
            {
              value: 'gps',
              label: props.gpsInCity ? t('myLocationHere') : t('myLocationAway', { city: cityName }),
              disabled: !props.gpsInCity,
            },
          ]}
          points={props.points}
          typed={prefs.startTyped}
          onTyped={(p) => setPrefs({ startTyped: p })}
        />

        <PlaceSelect
          label={t('endAt')}
          value={prefs.end === 'station' ? prefs.endId ?? city.city.stationId : prefs.end}
          onChange={(v) => (v === 'loop' || v === 'oneway' ? setPrefs({ end: v }) : setPrefs({ end: 'station', endId: v }))}
          extra={[
            { value: 'loop', label: t('endLoop') },
            { value: 'oneway', label: t('endOneway') },
          ]}
          points={props.points}
          typed={prefs.endTyped}
          onTyped={(p) => setPrefs({ endTyped: p })}
        />

        <button className="btn btn-primary btn-block" type="submit" disabled={!!planStatus}>
          {planStatus === 'places' ? t('loadingPlaces') : planStatus === 'routes' ? t('loadingRoutes') : t('suggest')}
        </button>
        {props.planError && <p className="status-line" role="alert">⚠️ {props.planError}</p>}
      </form>

      <button
        className="btn btn-block identify-btn"
        type="button"
        onClick={() => {
          startCompass(); // its own tap, so the camera tap stays free
          setPhoto(true);
        }}
      >
        📷 {t('identifyTitle')}
      </button>
      {photo && (
        <PhotoIdentify pois={props.places} position={gps.status === 'ok' ? gps.pos : null} onClose={() => setPhoto(false)} />
      )}

      {props.savedTours.length > 0 && (
        <section className="card">
          <h2>{t('savedTours')}</h2>
          <ul className="saved-list">
            {props.savedTours.map((s) => (
              <li key={s.id}>
                <strong>{s.title}{s.offline ? ' · ⬇️' : ''}</strong>
                <span className="muted small">
                  {new Date(s.date).toLocaleDateString(lang)} · {s.stops.length} {t('stops')} · {s.distanceKm} km · {s.minutes} {t('min')}
                </span>
                {s.route && (
                  <div className="btn-row">
                    <button className="btn btn-small" type="button" onClick={() => props.onWalkAgain(s.route!, s.cityId, s.city)}>{s.offline ? `▶ ${t('start')}` : `↺ ${t('walkAgain')}`}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="footnote muted small">{t('footer')}</p>
    </main>
  );
}




