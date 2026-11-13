import { useCallback, useEffect, useMemo, useState } from 'react';
import { LangContext, translate, loc, type StringKey } from './i18n';
import type { ActiveTour, LatLng, PlannedRoute, Poi, Preferences, SavedTour } from './types';
import { load, save } from './lib/storage';
import { CITY, SEED_POIS, inCity, loadPlaces } from './lib/places';
import { hasApi } from './lib/api';
import { fetchCityContext, type ContextNote } from './lib/context';
import { budgets, planRoutes } from './lib/planner';
import { analyseForecast, fetchForecast, type ForecastData } from './lib/weather';
import Home from './screens/Home';
import RoutesScreen from './screens/RoutesScreen';
import Tour, { type TourResult } from './screens/Tour';
import Summary from './screens/Summary';

const DEFAULT_PREFS: Preferences = {
  lang: navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en',
  limitBy: 'duration',
  durationMin: 120,
  distanceKm: 5,
  interests: ['historic', 'artists'],
  startId: 'gps',
  end: 'loop',
  pace: 'normal',
  avoidStairs: false,
  triggerRadiusM: 25,
};

type Screen = 'home' | 'routes' | 'tour' | 'summary';
export type GpsState = { status: 'pending' } | { status: 'ok'; pos: LatLng & { accuracy: number } } | { status: 'error' };
export type PlanStatus = null | 'places' | 'routes';
export type ContextState = { status: 'off' | 'loading' | 'error' } | { status: 'ok'; notes: ContextNote[] };

const ACTIVE_TTL = 12 * 3600 * 1000;
function loadActiveTour(): ActiveTour | null {
  const a = load<ActiveTour | null>('activeTour', null);
  return a && Date.now() - a.savedAt < ACTIVE_TTL ? a : null;
}

export default function App() {
  const [prefs, setPrefsState] = useState<Preferences>(() => ({ ...DEFAULT_PREFS, ...load('prefs', {}) }));
  const [screen, setScreen] = useState<Screen>('home');
  const [gps, setGps] = useState<GpsState>({ status: 'pending' });
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [forecastError, setForecastError] = useState(false);
  const [ignoreWeather, setIgnoreWeather] = useState(false);
  const [planStatus, setPlanStatus] = useState<PlanStatus>(null);
  const [placesNote, setPlacesNote] = useState<string | null>(null);
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<TourResult | null>(null);
  const [savedTours, setSavedTours] = useState<SavedTour[]>(() => load('savedTours', []));
  const [places, setPlaces] = useState<Poi[]>(SEED_POIS);
  const [context, setContext] = useState<ContextState>({ status: hasApi() ? 'loading' : 'off' });
  const [contextKey, setContextKey] = useState(0);
  const [activeTour, setActiveTour] = useState<ActiveTour | null>(loadActiveTour);
  const [resume, setResume] = useState<ActiveTour | null>(null);

  const lang = prefs.lang;
  const i18n = useMemo(
    () => ({ lang, t: (k: StringKey, v?: Record<string, string | number>) => translate(lang, k, v) }),
    [lang],
  );
  const { t } = i18n;

  const setPrefs = useCallback((p: Partial<Preferences>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      save('prefs', next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Where am I? (one-shot; the tour uses its own live watch)
  useEffect(() => {
    if (!('geolocation' in navigator)) return setGps({ status: 'error' });
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ status: 'ok', pos: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      () => setGps({ status: 'error' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }, []);

  // Weather for the city, on start.
  const refreshForecast = useCallback(async () => {
    try {
      const [lat, lng] = CITY.city.center;
      setForecast(await fetchForecast(lat, lng, CITY.city.timezone));
      setForecastError(false);
    } catch {
      setForecastError(true);
    }
  }, []);
  useEffect(() => {
    refreshForecast();
  }, [refreshForecast]);

  // Today in the city: strikes, closures, events (server-side web search).
  useEffect(() => {
    if (!hasApi()) return setContext({ status: 'off' });
    let cancelled = false;
    setContext({ status: 'loading' });
    fetchCityContext(CITY.city.name, CITY.city.timezone, lang, SEED_POIS)
      .then((notes) => !cancelled && setContext({ status: 'ok', notes }))
      .catch(() => !cancelled && setContext({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [lang, contextKey]);

  const plannedMinutes = prefs.limitBy === 'duration' ? prefs.durationMin : Math.round((prefs.distanceKm / 4.5) * 60 + 30);
  const weather = useMemo(() => (forecast ? analyseForecast(forecast, plannedMinutes) : null), [forecast, plannedMinutes]);

  const startPlace = useMemo(() => {
    const sp = CITY.startPoints.find((s) => s.id === prefs.startId);
    if (sp) return { lat: sp.lat, lng: sp.lng, name: loc(sp.name, lang) };
    if (gps.status === 'ok' && inCity(gps.pos)) return { ...gps.pos, name: t('myLocation') };
    const m = CITY.startPoints[0];
    return { lat: m.lat, lng: m.lng, name: loc(m.name, lang) };
  }, [prefs.startId, gps, lang, t]);

  const plan = async () => {
    setPlanStatus('places');
    setPlacesNote(null);
    try {
      const b = budgets(prefs);
      const places = await loadPlaces(startPlace, b.radiusKm * 1000 + 300);
      setPlacesNote(places.live ? t('placesCount', { n: places.pois.length }) : t('placesFallback'));
      setPlaces(places.pois);
      const blocked =
        context.status === 'ok'
          ? context.notes.filter((n) => n.effect === 'blocks').flatMap((n) => n.affectsStopIds.map((id) => ({ id, title: n.title })))
          : [];
      setPlanStatus('routes');
      const sbb = CITY.startPoints.find((s) => s.id === 'sbb')!;
      const rs = await planRoutes({
        pois: places.pois,
        prefs,
        start: startPlace,
        station: { lat: sbb.lat, lng: sbb.lng, name: loc(sbb.name, lang) },
        weather,
        ignoreWeather,
        blocked,
        t,
        lang,
      });
      setRoutes(rs);
      setSelected(0);
      setScreen('routes');
    } finally {
      setPlanStatus(null);
    }
  };

  const saveTour = (r: TourResult) => {
    const entry: SavedTour = {
      id: r.route.id,
      date: new Date(r.startedAt).toISOString(),
      title: r.route.title,
      stops: r.route.stops.filter((s) => r.visited.includes(s.id)).map((s) => loc(s.name, lang)),
      distanceKm: r.route.distanceKm,
      minutes: r.minutes,
      route: r.route,
    };
    const next = [entry, ...savedTours.filter((s) => s.id !== entry.id)].slice(0, 30);
    setSavedTours(next);
    save('savedTours', next);
  };

  const startTour = (route: PlannedRoute, from: ActiveTour | null) => {
    setRoutes([route]);
    setSelected(0);
    setResume(from);
    setScreen('tour');
  };
  const clearActive = () => {
    save('activeTour', null);
    setActiveTour(null);
  };

  return (
    <LangContext.Provider value={i18n}>
      {screen === 'home' && (
        <Home
          prefs={prefs}
          setPrefs={setPrefs}
          gps={gps}
          weather={weather}
          weatherError={forecastError}
          ignoreWeather={ignoreWeather}
          setIgnoreWeather={setIgnoreWeather}
          planStatus={planStatus}
          onPlan={plan}
          savedTours={savedTours}
          places={places}
          context={context}
          onApiChanged={() => setContextKey((k) => k + 1)}
          activeTour={activeTour}
          onResume={() => activeTour && startTour(activeTour.route, activeTour)}
          onDiscard={clearActive}
          onWalkAgain={(r) => startTour(r, null)}
        />
      )}
      {screen === 'routes' && (
        <RoutesScreen
          routes={routes}
          selected={selected}
          setSelected={setSelected}
          placesNote={placesNote}
          context={context}
          weather={ignoreWeather ? null : weather}
          onBack={() => setScreen('home')}
          onStart={() => {
            setResume(null);
            setScreen('tour');
          }}
        />
      )}
      {screen === 'tour' && routes[selected] && (
        <Tour
          route={routes[selected]}
          radiusM={prefs.triggerRadiusM}
          places={places}
          resume={resume}
          onProgress={(a) => {
            save('activeTour', a);
            setActiveTour(a);
          }}
          onExit={() => setScreen(routes.length > 1 ? 'routes' : 'home')}
          onEnd={(r) => {
            clearActive();
            setResult(r);
            setScreen('summary');
          }}
        />
      )}
      {screen === 'summary' && result && (
        <Summary
          result={result}
          onSave={() => saveTour(result)}
          isSaved={savedTours.some((s) => s.id === result.route.id)}
          onHome={() => setScreen('home')}
        />
      )}
    </LangContext.Provider>
  );
}
