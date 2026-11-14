import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CityContext } from './city';
import { LangContext, translate, loc, type StringKey } from './i18n';
import type { ActiveTour, CityData, LatLng, PlannedRoute, Poi, Preferences, SavedTour } from './types';
import { load, save } from './lib/storage';
import { cityAt, cityById, inCity, isCurated, loadPlaces } from './lib/places';
import { findRecent, isCustomCity, makeCity, rememberCity, reverseCity } from './lib/geocode';
import { setDetourFactor } from './lib/geo';
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
  cityId: 'basel',
  limitBy: 'duration',
  durationMin: 120,
  distanceKm: 5,
  interests: ['historic', 'artists'],
  startId: 'gps',
  end: 'loop',
  pace: 'normal',
  avoidStairs: false,
};

type Screen = 'home' | 'routes' | 'tour' | 'summary';
export type GpsState = { status: 'pending' } | { status: 'ok'; pos: LatLng & { accuracy: number } } | { status: 'error' };
export type PlanStatus = null | 'places' | 'routes';
export type DetectState = 'idle' | 'detecting' | 'failed';
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
  const [planError, setPlanError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [selected, setSelected] = useState(0);
  const [result, setResult] = useState<TourResult | null>(null);
  const [savedTours, setSavedTours] = useState<SavedTour[]>(() => load('savedTours', []));
  // Curated cities (Basel, Venice) or any city the user searched for or is standing in.
  const city = useMemo(
    () => (isCustomCity(prefs.cityId) ? findRecent(prefs.cityId) ?? cityById('basel') : cityById(prefs.cityId)),
    [prefs.cityId],
  );
  const [detect, setDetect] = useState<DetectState>('idle');
  const [places, setPlaces] = useState<Poi[]>(city.pois);
  const pickedCity = useRef(false); // true once the user chose a city by hand
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

  // Use the city you are standing in, unless you picked one by hand:
  // a curated city if you are in one, otherwise whatever city OpenStreetMap says this is.
  const detectHere = useCallback(
    async (manual: boolean) => {
      if (gps.status !== 'ok') return;
      const curated = cityAt(gps.pos);
      if (curated) {
        if (curated.city.id !== prefs.cityId) setPrefs({ cityId: curated.city.id, startId: 'gps' });
        return;
      }
      if (!manual && inCity(city, gps.pos)) return; // already set to the city we're in
      setDetect('detecting');
      try {
        const found = await reverseCity(gps.pos, lang);
        if (!found) throw new Error('not found');
        const c = makeCity(found);
        rememberCity(c);
        setPrefs({ cityId: c.city.id, startId: 'gps' });
        setDetect('idle');
      } catch {
        setDetect('failed');
      }
    },
    [gps, prefs.cityId, city, lang, setPrefs],
  );
  useEffect(() => {
    if (!pickedCity.current) detectHere(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps]);

  const chooseCity = (id: string) => {
    pickedCity.current = true;
    if (id !== prefs.cityId) setPrefs({ cityId: id, startId: isCurated(id) ? 'gps' : 'centre' });
  };
  const chooseSearched = (c: CityData) => {
    rememberCity(c);
    chooseCity(c.city.id);
  };
  const useHere = () => {
    pickedCity.current = true;
    detectHere(true);
  };

  useEffect(() => {
    setPlaces(city.pois);
    setDetourFactor(city.city.detourFactor);
  }, [city]);

  // Weather for the city, on start and when the city changes.
  useEffect(() => {
    let cancelled = false;
    setForecast(null);
    setForecastError(false);
    const [lat, lng] = city.city.center;
    fetchForecast(lat, lng, city.city.timezone) // "auto" for searched cities
      .then((f) => !cancelled && setForecast(f))
      .catch(() => !cancelled && setForecastError(true));
    return () => {
      cancelled = true;
    };
  }, [city]);

  // Today in the city: strikes, closures, events (server-side web search).
  useEffect(() => {
    if (!hasApi()) return setContext({ status: 'off' });
    let cancelled = false;
    setContext({ status: 'loading' });
    fetchCityContext(city, lang, cityTz)
      .then((notes) => !cancelled && setContext({ status: 'ok', notes }))
      .catch(() => !cancelled && setContext({ status: 'error' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, contextKey, city]);

  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cityTz = city.city.timezone === 'auto' ? forecast?.timezone ?? deviceTz : city.city.timezone;

  const plannedMinutes = prefs.limitBy === 'duration' ? prefs.durationMin : Math.round((prefs.distanceKm / 4.5) * 60 + 30);
  const weather = useMemo(() => (forecast ? analyseForecast(forecast, plannedMinutes) : null), [forecast, plannedMinutes]);

  const startPlace = useMemo(() => {
    const sp = city.startPoints.find((s) => s.id === prefs.startId);
    if (sp) return { lat: sp.lat, lng: sp.lng, name: loc(sp.name, lang) };
    if (gps.status === 'ok' && inCity(city, gps.pos)) return { ...gps.pos, name: t('myLocation') };
    const m = city.startPoints[0];
    return { lat: m.lat, lng: m.lng, name: loc(m.name, lang) };
  }, [city, prefs.startId, gps, lang, t]);

  const plan = async () => {
    setPlanStatus('places');
    setPlacesNote(null);
    setPlanError(null);
    try {
      setDetourFactor(city.city.detourFactor);
      // The weather didn't load earlier? Try once more, so rain can still shape the routes.
      let w = weather;
      if (!forecast) {
        try {
          const [lat, lng] = city.city.center;
          const f = await fetchForecast(lat, lng, city.city.timezone);
          setForecast(f);
          setForecastError(false);
          w = analyseForecast(f, plannedMinutes);
        } catch {
          /* plan without weather */
        }
      }
      const b = budgets(prefs);
      const places = await loadPlaces(city, startPlace, b.radiusKm * 1000 + 300);
      setPlacesNote(places.live ? t('placesCount', { n: places.pois.length }) : t('placesFallback'));
      setPlaces(places.pois);
      const blocked =
        context.status === 'ok'
          ? context.notes.filter((n) => n.effect === 'blocks').flatMap((n) => n.affectsStopIds.map((id) => ({ id, title: n.title })))
          : [];
      setPlanStatus('routes');
      const sbb = city.startPoints.find((s) => s.id === city.city.stationId) ?? city.startPoints[0];
      const rs = await planRoutes({
        pois: places.pois,
        // No known station in a searched city: "end at the station" becomes a loop.
        prefs: city.city.noStation && prefs.end === 'station' ? { ...prefs, end: 'loop' } : prefs,
        start: startPlace,
        station: { lat: sbb.lat, lng: sbb.lng, name: loc(sbb.name, lang) },
        weather: w,
        ignoreWeather,
        blocked,
        t,
        lang,
      });
      setRoutes(rs);
      setSelected(0);
      setScreen('routes');
    } catch {
      setPlanError(t('planFailed'));
    } finally {
      setPlanStatus(null);
    }
  };

  const saveTour = (r: TourResult) => {
    const entry: SavedTour = {
      id: r.route.id,
      cityId: city.city.id,
      date: new Date(r.startedAt).toISOString(),
      title: r.route.title,
      stops: r.route.stops.filter((s) => r.visited.includes(s.id)).map((s) => loc(s.name, lang)),
      distanceKm: r.route.distanceKm,
      minutes: r.minutes,
      route: r.route,
    };
    const next = [entry, ...savedTours.filter((s) => s.id !== entry.id)].slice(0, 12); // routes include their path, so keep the list short
    setSavedTours(next);
    save('savedTours', next);
  };

  const startTour = (route: PlannedRoute, from: ActiveTour | null, cityId?: string) => {
    if (cityId && cityId !== prefs.cityId) chooseCity(cityId);
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
    <CityContext.Provider value={city}>
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
          onResume={() => activeTour && startTour(activeTour.route, activeTour, activeTour.cityId)}
          onChooseCity={chooseCity}
          onChooseSearched={chooseSearched}
          onUseHere={useHere}
          detect={detect}
          planError={planError}
          onDiscard={clearActive}
          onWalkAgain={(r, cityId) => startTour(r, null, cityId)}
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
          radiusM={city.city.triggerRadiusM}
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
    </CityContext.Provider>
  );
}
