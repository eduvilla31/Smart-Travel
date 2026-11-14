import { useEffect, useState } from 'react';
import { INTEREST_LABELS, fmtDuration, loc, useI18n } from '../i18n';
import { INTERESTS, LANGS, type ActiveTour, type Interest, type PlannedRoute, type Poi, type Preferences, type SavedTour } from '../types';
import ContextCard from '../components/ContextCard';
import PhotoIdentify from '../components/PhotoIdentify';
import { apiHealth, getApi, setApi, type ModelId } from '../lib/api';
import * as speech from '../lib/speech';
import { startCompass } from '../lib/compass';
import { NEURAL_VOICES, loadNeural, neuralPref, neuralState, neuralSupported, onNeuralState, setNeuralPref, type NeuralVoiceId } from '../lib/neuralVoice';
import { isAllowedServer } from '../lib/safe';
import { distanceToCityKm, inCity } from '../lib/places';
import CityPicker from '../components/CityPicker';
import PlaceSelect from '../components/PlaceSelect';
import type { CityData, StartPoint } from '../types';
import { useCity } from '../city';
import { describeCode, type WeatherAnalysis } from '../lib/weather';
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
        <div className="lang-switch" role="group" aria-label={t('language')}>
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setPrefs({ lang: l })}>
              {l.toUpperCase()}
            </button>
          ))}
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

        <details className="more">
          <summary>{t('options')}</summary>
          <label className="field">
            <span className="field-label">{t('pace')}</span>
            <select value={prefs.pace} onChange={(e) => setPrefs({ pace: e.target.value as Preferences['pace'] })}>
              <option value="slow">{t('paceSlow')} · 3.5 km/h</option>
              <option value="normal">{t('paceNormal')} · 4.5 km/h</option>
              <option value="fast">{t('paceFast')} · 5.5 km/h</option>
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={prefs.avoidStairs} onChange={(e) => setPrefs({ avoidStairs: e.target.checked })} />
            <span>{t('avoidStairs')}</span>
          </label>
          <NaturalVoiceSettings />
          <VoiceSettings />
          <ServerSettings onChanged={props.onApiChanged} />
        </details>

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
                <strong>{s.title}</strong>
                <span className="muted small">
                  {new Date(s.date).toLocaleDateString(lang)} · {s.stops.length} {t('stops')} · {s.distanceKm} km · {s.minutes} {t('min')}
                </span>
                {s.route && (
                  <div className="btn-row">
                    <button className="btn btn-small" type="button" onClick={() => props.onWalkAgain(s.route!, s.cityId, s.city)}>↺ {t('walkAgain')}</button>
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

function WeatherCard({ weather, weatherError, ignoreWeather, setIgnoreWeather }: Props) {
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

/** Where the Smart Travel server lives, plus the optional access code. */
function ServerSettings({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(getApi().url);
  const [code, setCode] = useState(getApi().code);
  const [key, setKey] = useState(getApi().key);
  const [model, setModel] = useState<ModelId>(getApi().model);
  const [state, setState] = useState<'off' | 'ok' | 'err' | 'checking'>(getApi().url || getApi().key ? 'checking' : 'off');

  const check = async () => {
    if (!getApi().url && !getApi().key) return setState('off');
    setState('checking');
    setState((await apiHealth()).ok ? 'ok' : 'err');
  };
  useEffect(() => {
    check();
  }, []);

  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    const u = url.trim();
    const k = key.trim();
    if (u && !isAllowedServer(u)) return setProblem(t('serverNotAllowed'));
    if (k && !/^sk-ant-[\w-]+$/.test(k)) return setProblem(t('keyLooksWrong'));
    setProblem(null);
    setApi({ url: u, code: code.trim(), key: k });
    check();
    onChanged();
  };
  const removeKey = () => {
    setKey('');
    setApi({ key: '' });
    check();
    onChanged();
  };

  return (
    <fieldset className="field">
      <legend className="field-label">{t('server')}</legend>
      <input className="text-input" type="url" inputMode="url" placeholder="https://smart-travel-api.…workers.dev"
        value={url} onChange={(e) => setUrl(e.target.value)} onBlur={commit} aria-label={t('serverUrl')} />
      <input className="text-input" type="password" placeholder={t('accessCode')} value={code}
        onChange={(e) => setCode(e.target.value)} onBlur={commit} aria-label={t('accessCode')} style={{ marginTop: 8 }} />
      <p className="muted small" style={{ margin: '12px 0 6px' }}>{t('ownKeyHint')}</p>
      <input className="text-input" type="password" autoComplete="off" placeholder="sk-ant-…" value={key}
        onChange={(e) => setKey(e.target.value)} onBlur={commit} aria-label={t('ownKey')} />
      {key && (
        <button className="btn btn-small btn-ghost" type="button" style={{ marginTop: 8 }} onClick={removeKey}>
          🗑 {t('removeKey')}
        </button>
      )}
      {problem && <p className="status-line" role="alert">⚠️ {problem}</p>}
      {key && !url && (
        <select
          value={model}
          aria-label={t('model')}
          style={{ marginTop: 8 }}
          onChange={(e) => {
            const m = e.target.value as ModelId;
            setModel(m);
            setApi({ model: m });
            onChanged();
          }}
        >
          <option value="claude-haiku-5-5">Claude Haiku · {t('modelCheap')}</option>
          <option value="claude-opus-5-5">Claude Opus · {t('modelBest')}</option>
        </select>
      )}
      <p className="muted small">
        {state === 'ok' ? `✅ ${url ? t('serverOk') : t('ownKeyOk')}` : state === 'err' ? `⚠️ ${t('serverErr')}` : state === 'checking' ? '…' : t('serverOff')}
      </p>
    </fieldset>
  );
}

/** Pick the narration voice; the most natural one is chosen automatically. */
function VoiceSettings() {
  const { t, lang } = useI18n();
  const [voices, setVoices] = useState(() => speech.listVoices(lang));
  const [chosen, setChosen] = useState(() => speech.preferredVoice(lang));

  useEffect(() => {
    const refresh = () => setVoices(speech.listVoices(lang));
    refresh();
    setChosen(speech.preferredVoice(lang));
    const off = speech.onVoicesChanged(refresh);
    return () => {
      off();
    };
  }, [lang]);

  if (!speech.supported()) return null;
  const quality = (v: SpeechSynthesisVoice) => {
    const s = speech.voiceScore(v, lang);
    return s >= 100 ? ' ★★★' : s >= 50 ? ' ★★' : s >= 0 ? '' : ' ✕';
  };

  return (
    <fieldset className="field">
      <legend className="field-label">{t('voice')}</legend>
      <div className="city-search">
        <select
          value={chosen}
          aria-label={t('voice')}
          onChange={(e) => {
            setChosen(e.target.value);
            speech.setPreferredVoice(lang, e.target.value);
          }}
        >
          <option value="">{t('voiceAuto')}{voices[0] ? ` · ${voices[0].name}` : ''}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang}){quality(v)}
            </option>
          ))}
        </select>
        <button className="btn btn-small" type="button" onClick={() => speech.speak(t('voiceSample'), lang)}>
          ▶ {t('voiceTest')}
        </button>
      </div>
      <p className="muted small">{t('voiceTip')}</p>
    </fieldset>
  );
}

/** The free on-phone AI voice: switch, voice choice, download progress, test. */
function NaturalVoiceSettings() {
  const { t, lang } = useI18n();
  const [pref, setPref] = useState(neuralPref);
  const [state, setState] = useState(neuralState);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    const off = onNeuralState(setState);
    return () => {
      off();
    };
  }, []);
  if (!neuralSupported()) return null;

  const update = (p: Partial<typeof pref>) => {
    setNeuralPref(p);
    setPref(neuralPref());
  };
  const status =
    state.status === 'loading'
      ? t('naturalLoading', { pct: state.progress })
      : state.status === 'ready'
        ? `✅ ${t('naturalReady')}`
        : state.status === 'error'
          ? `⚠️ ${t('naturalFailed')}`
          : '';

  return (
    <fieldset className="field natural-voice">
      <legend className="field-label">✨ {t('naturalVoice')}</legend>
      <label className="toggle">
        <input
          type="checkbox"
          checked={pref.on}
          onChange={(e) => {
            update({ on: e.target.checked });
            if (e.target.checked) loadNeural().catch(() => undefined);
          }}
        />
        <span>{t('naturalOn')}</span>
      </label>
      {pref.on && (
        <>
          <div className="city-search">
            <select value={pref.voice} aria-label={t('naturalVoice')} onChange={(e) => update({ voice: e.target.value as NeuralVoiceId })}>
              {NEURAL_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v[lang]}</option>
              ))}
            </select>
            <button
              className="btn btn-small"
              type="button"
              disabled={state.status === 'loading' || testing}
              onClick={async () => {
                speech.unlock();
                setTesting(true);
                try {
                  await loadNeural();
                  await speech.speak(t('naturalSample'), 'en', { waitForNatural: true });
                } catch {
                  /* status line shows the problem */
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? '…' : `▶ ${t('voiceTest')}`}
            </button>
          </div>
          {state.status === 'loading' && <progress max={100} value={state.progress} className="voice-progress" />}
          {testing && <p className="muted small" aria-live="polite">{t('naturalPreparing')}</p>}
          {status && <p className="muted small" aria-live="polite">{status}</p>}
        </>
      )}
      <p className="muted small">{t('naturalHint')}</p>
    </fieldset>
  );
}
