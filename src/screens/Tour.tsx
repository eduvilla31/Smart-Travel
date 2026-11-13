import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type MapMe, type MapStop } from '../components/MapView';
import PhotoIdentify from '../components/PhotoIdentify';
import { fmtDist, fmtDuration, loc, useI18n, type StringKey } from '../i18n';
import type { ActiveTour, LatLng, PlannedRoute, Poi, RouteStep } from '../types';
import { useGeolocation, useOnline, useWakeLock } from '../hooks';
import { haversineM, pointAlong } from '../lib/geo';
import { getNarration, type Narration } from '../lib/narration';
import { CITY } from '../lib/places';
import { fetchForecast, minutesUntilRain } from '../lib/weather';
import * as speech from '../lib/speech';

export interface TourResult { route: PlannedRoute; visited: string[]; startedAt: number; minutes: number }

interface Props {
  route: PlannedRoute;
  radiusM: number;
  /** All loaded places, for photo identification off-route. */
  places: Poi[];
  /** Saved progress to pick up from (reload, signal loss). */
  resume: ActiveTour | null;
  onProgress: (a: ActiveTour) => void;
  onExit: () => void;
  onEnd: (r: TourResult) => void;
}

type StopState = 'visited' | 'skipped';
const WALK_MS = 1.4; // simulated walking speed, m/s
const SIM_TICK_MS = 500;
const TURN_RADIUS_M = 18;

function turnKey(s: RouteStep): StringKey | null {
  if (s.type === 'depart' || s.type === 'arrive') return null;
  switch (s.modifier) {
    case 'left': return 'turn_left';
    case 'right': return 'turn_right';
    case 'slight left': return 'turn_slight_left';
    case 'slight right': return 'turn_slight_right';
    case 'sharp left': return 'turn_sharp_left';
    case 'sharp right': return 'turn_sharp_right';
    case 'uturn': return 'turn_uturn';
    default: return null; // "straight": no need to talk
  }
}

export default function Tour({ route, radiusM, places, resume, onProgress, onExit, onEnd }: Props) {
  const { t, lang } = useI18n();
  // A resumed tour still waits for a tap: iOS only allows speech after one.
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Record<string, StopState>>(resume?.status ?? {});
  const [activeId, setActiveId] = useState<string | null>(
    route.stops.find((s) => !resume?.status[s.id])?.id ?? route.stops[0]?.id ?? null,
  );
  const [photo, setPhoto] = useState(false);
  const online = useOnline();
  const [narr, setNarr] = useState<Record<string, Narration>>({});
  const [sim, setSim] = useState(false);
  const [simSpeed, setSimSpeed] = useState(5);
  const [simPaused, setSimPaused] = useState(false);
  const [simPos, setSimPos] = useState<LatLng | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [audioPaused, setAudioPaused] = useState(false);
  const [muted, setMuted] = useState(speech.isMuted());
  const [dim, setDim] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<(LatLng & { key: number }) | undefined>();
  const [follow, setFollow] = useState(true);

  const startedAt = useRef(resume?.startedAt ?? Date.now());
  const lastStep = useRef(-1);
  const simDist = useRef(0);
  const nudged = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const narrRef = useRef(narr);
  narrRef.current = narr;
  const simPausedRef = useRef(simPaused);
  simPausedRef.current = simPaused;
  const simSpeedRef = useRef(simSpeed);
  simSpeedRef.current = simSpeed;

  const gps = useGeolocation(started && !sim);
  const wakeHeld = useWakeLock(started);

  const me: MapMe | null = sim
    ? simPos && { ...simPos, sim: true }
    : gps.fix && { lat: gps.fix.lat, lng: gps.fix.lng, accuracy: gps.fix.accuracy };
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    const off = speech.onSpeakingChange(setSpeaking);
    return () => {
      off();
      speech.stop();
    };
  }, []);

  // Save progress so a reload or a dropped connection can resume the tour.
  useEffect(() => {
    if (started) onProgress({ route, status, startedAt: startedAt.current, savedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, status, route]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((m) => (m === msg ? null : m)), 6000);
  }, []);

  // Fetch narration for every stop up front (cached per language).
  useEffect(() => {
    let cancelled = false;
    setNarr({});
    const queue = [...route.stops];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const n = await getNarration(s, lang, t('seedSource'));
        if (cancelled) return;
        setNarr((old) => ({ ...old, [s!.id]: n }));
      }
    };
    Promise.all([worker(), worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [route, lang, t]);

  const getN = useCallback(
    async (p: Poi) => narrRef.current[p.id] ?? (await getNarration(p, lang, t('seedSource'))),
    [lang, t],
  );

  const nextStop = useMemo(() => route.stops.find((s) => !status[s.id]), [route, status]);

  const say = useCallback(
    (text: string, textLang = lang) => {
      setAudioPaused(false);
      return speech.speak(text, textLang);
    },
    [lang],
  );

  const playStop = useCallback(
    async (p: Poi, kind: 'short' | 'long') => {
      const n = await getN(p);
      return say(kind === 'short' ? n.short : n.long ?? n.short, n.lang);
    },
    [getN, say],
  );

  const announceNext = useCallback(() => {
    const nxt = route.stops.find((s) => !statusRef.current[s.id]);
    const pos = meRef.current;
    if (!nxt) return say(t('allDone'));
    const dist = pos ? `, ${fmtDist(haversineM(pos, nxt))}` : '';
    return say(`${t('next')}: ${loc(nxt.name, lang)}${dist}.`);
  }, [route, say, t, lang]);

  const triggerStop = useCallback(
    async (p: Poi) => {
      setStatus((s) => ({ ...s, [p.id]: 'visited' }));
      statusRef.current = { ...statusRef.current, [p.id]: 'visited' };
      setActiveId(p.id);
      navigator.vibrate?.(200);
      const finished = await playStop(p, 'short');
      if (finished) await announceNext();
    },
    [playStop, announceNext],
  );

  // Geofence + turn-by-turn on every position update.
  useEffect(() => {
    if (!started || !me) return;
    const slack = me.sim ? 0 : Math.min((me.accuracy ?? 0) / 2, 15);
    const hit = route.stops.find((s) => !statusRef.current[s.id] && haversineM(me, s) <= radiusM + slack);
    if (hit) {
      triggerStop(hit);
      return;
    }
    if (speech.isSpeaking()) return;
    for (let i = lastStep.current + 1; i < route.steps.length; i++) {
      const st = route.steps[i];
      if (haversineM(me, st.location) > TURN_RADIUS_M) continue;
      lastStep.current = i;
      const key = turnKey(st);
      if (key) say(t(key, { road: st.name || t('theRoad') }));
      break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.lat, me?.lng, started]);

  // Simulated walk along the route line; it waits while narration plays.
  useEffect(() => {
    if (!sim || !started) return;
    setSimPos((p) => p ?? route.path[0]);
    const id = window.setInterval(() => {
      if (simPausedRef.current || speech.isSpeaking()) return;
      simDist.current += WALK_MS * simSpeedRef.current * (SIM_TICK_MS / 1000);
      const { point, done } = pointAlong(route.path, simDist.current);
      setSimPos(point);
      if (done) setSimPaused(true);
    }, SIM_TICK_MS);
    return () => window.clearInterval(id);
  }, [sim, started, route]);

  // Rain nudge: check the forecast every 10 minutes during the walk.
  useEffect(() => {
    if (!started) return;
    const check = async () => {
      const pos = meRef.current;
      if (nudged.current || !pos) return;
      try {
        const [lat, lng] = CITY.city.center;
        const mins = minutesUntilRain(await fetchForecast(lat, lng, CITY.city.timezone), 45);
        if (mins == null) return;
        const shelter = route.stops
          .filter((s) => s.indoor && !statusRef.current[s.id])
          .map((s) => ({ s, d: haversineM(pos, s) }))
          .filter((x) => x.d <= 600)
          .sort((a, b) => a.d - b.d)[0];
        if (!shelter) return;
        nudged.current = true;
        const msg = t('rainNudge', { min: Math.max(mins, 5), name: loc(shelter.s.name, lang), dist: fmtDist(shelter.d) });
        showToast(`🌧️ ${msg}`);
        if (!speech.isSpeaking()) say(msg);
      } catch {
        /* weather is best-effort */
      }
    };
    const first = window.setTimeout(check, 60_000);
    const id = window.setInterval(check, 10 * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [started, route, t, lang, say, showToast]);

  const start = () => {
    speech.unlock();
    setStarted(true);
    if (resume) {
      announceNext();
      return;
    }
    startedAt.current = Date.now();
    const first = route.stops[0];
    say(
      t('tourIntro', {
        title: route.title,
        n: route.stops.length,
        time: fmtDuration(route.totalMin, t),
        first: first ? loc(first.name, lang) : '',
      }),
    );
  };

  const skip = () => {
    const target = nextStop;
    if (!target) return;
    speech.stop();
    const nextStatus = { ...statusRef.current, [target.id]: 'skipped' as const };
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    // jump the simulation past the skipped stop
    if (sim) {
      let best = simDist.current;
      for (let d = simDist.current; d < simDist.current + 3000; d += 5) {
        const { point, done } = pointAlong(route.path, d);
        if (haversineM(point, target) <= radiusM) best = d + radiusM * 2;
        else if (best > simDist.current) break;
        if (done) break;
      }
      simDist.current = best;
    }
    announceNext();
  };

  const toggleAudioPause = () => {
    if (audioPaused) speech.resume();
    else speech.pause();
    setAudioPaused(!audioPaused);
  };

  const finish = () => {
    speech.stop();
    onEnd({
      route,
      visited: route.stops.filter((s) => status[s.id] === 'visited').map((s) => s.id),
      startedAt: startedAt.current,
      minutes: Math.max(1, Math.round((Date.now() - startedAt.current) / 60000)),
    });
  };

  const active = route.stops.find((s) => s.id === activeId) ?? null;
  const activeN = active ? narr[active.id] : undefined;
  const activeIdx = active ? route.stops.indexOf(active) : -1;
  const doneCount = Object.keys(status).length;

  const mapStops: MapStop[] = useMemo(
    () =>
      route.stops.map((s, i) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        label: status[s.id] === 'visited' ? '✓' : String(i + 1),
        title: loc(s.name, lang),
        status: status[s.id] ? 'done' : s === nextStop ? 'next' : 'todo',
      })),
    [route, status, nextStop, lang],
  );

  let statusLine = '';
  if (!started) statusLine = '';
  else if (!me) statusLine = sim ? '' : gps.error ? t('noGps') : t('gpsWaiting');
  else if (nextStop) statusLine = t('nextStopIn', { name: loc(nextStop.name, lang), dist: fmtDist(haversineM(me, nextStop)) });
  else statusLine = t('allDone');

  return (
    <main className="split tour">
      <div className="topbar">
        <button className="icon-btn" type="button" onClick={() => { speech.stop(); onExit(); }} aria-label={t('back')}>←</button>
        <div className="topbar-title">
          <div className="route-title">{route.title}</div>
          <div className="muted small">
            {doneCount}/{route.stops.length} {t('stops')} · {route.distanceKm} km · {fmtDuration(route.totalMin, t)}
          </div>
        </div>
        <button
          className="icon-btn"
          type="button"
          aria-pressed={muted}
          aria-label="Mute"
          onClick={() => {
            speech.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button className="icon-btn" type="button" aria-label={t('identifyTitle')} onClick={() => setPhoto(true)}>📷</button>
        {started && (
          <button className="icon-btn" type="button" aria-label={t('walkScreen')} onClick={() => setDim(true)}>🌙</button>
        )}
      </div>

      <div className="map-wrap">
        <MapView
          center={route.start}
          path={route.path}
          stops={mapStops}
          start={route.start}
          me={me}
          follow={follow && started}
          fitKey={route.id}
          radiusM={radiusM}
          focus={focus}
          onStopClick={(id) => {
            setActiveId(id);
            setFollow(false);
          }}
        />
        <button
          className="fab"
          type="button"
          aria-label="Center"
          onClick={() => {
            const p = me ?? route.start;
            setFollow(true);
            setFocus({ lat: p.lat, lng: p.lng, key: Date.now() });
          }}
        >
          ◎
        </button>
      </div>

      <section className="panel">
        {!online && <div className="offline-banner">📴 {t('offline')}</div>}
        {!started && (
          <div className="start-row">
            <button className="btn btn-primary btn-block" type="button" onClick={start}>▶ {resume ? t('resumeTour') : t('start')}</button>
            {!speech.supported() && <p className="muted small center">{t('speechUnsupported')}</p>}
          </div>
        )}

        <div className="sim-bar">
          <label className="toggle compact">
            <input
              type="checkbox"
              checked={sim}
              onChange={(e) => {
                setSim(e.target.checked);
                setSimPaused(false);
              }}
            />
            <span>{t('simulate')}</span>
          </label>
          <select value={simSpeed} onChange={(e) => setSimSpeed(Number(e.target.value))} aria-label={t('simSpeed')}>
            <option value={1}>1×</option>
            <option value={5}>5×</option>
            <option value={15}>15×</option>
            <option value={40}>40×</option>
          </select>
          <button className="btn btn-small btn-ghost" type="button" disabled={!sim || !started} onClick={() => setSimPaused(!simPaused)}>
            {simPaused ? t('resume') : t('pause')}
          </button>
        </div>

        {statusLine && <div className="status-line" aria-live="polite">{statusLine}</div>}
        {started && !wakeHeld && !sim && <div className="muted small">⚠️ {t('wakeLockOff')}</div>}

        <div className="audio-bar" role="group" aria-label="Audio">
          <button className="btn btn-small" type="button" disabled={!speaking} onClick={toggleAudioPause}>
            {audioPaused ? `▶ ${t('resume')}` : `⏸ ${t('pause')}`}
          </button>
          <button className="btn btn-small" type="button" disabled={!active} onClick={() => active && playStop(active, 'short')}>
            ↺ {t('replay')}
          </button>
          <button className="btn btn-small" type="button" disabled={!started || !nextStop} onClick={skip}>⏭ {t('skip')}</button>
          <button className="btn btn-small btn-ghost" type="button" disabled={!speaking} onClick={() => speech.stop()}>■ {t('stopAudio')}</button>
        </div>

        {active && (
          <article className="stop-card">
            <div className="stop-head">
              <span className="stop-num">{activeIdx + 1}</span>
              <div>
                <h3>{loc(active.name, lang)}</h3>
                <div className="muted small">
                  {active.indoor ? `🏠 ${t('indoor')} · ` : ''}
                  {me ? fmtDist(haversineM(me, active)) : ''}
                  {active.openingHours ? ` · 🕒 ${active.openingHours}` : ''}
                </div>
              </div>
            </div>
            <p className="stop-text">{activeN ? activeN.short : '…'}</p>
            <div className="btn-row">
              <button className="btn btn-small btn-primary" type="button" onClick={() => playStop(active, 'short')}>▶ {t('listen')}</button>
              {activeN?.long && (
                <button className="btn btn-small" type="button" onClick={() => playStop(active, 'long')}>{t('tellMore')}</button>
              )}
            </div>
            {activeN && (
              <p className="source small muted">
                {t('source')}:{' '}
                {activeN.sourceUrl ? (
                  <a href={activeN.sourceUrl} target="_blank" rel="noopener noreferrer">{activeN.sourceLabel}</a>
                ) : (
                  activeN.sourceLabel
                )}
              </p>
            )}
          </article>
        )}

        <ol className="stop-list">
          {route.stops.map((s, i) => (
            <li
              key={s.id}
              className={`${status[s.id] ?? ''} ${s === nextStop ? 'next' : ''} ${s.id === activeId ? 'active' : ''}`}
              onClick={() => {
                setActiveId(s.id);
                setFollow(false);
                setFocus({ lat: s.lat, lng: s.lng, key: Date.now() });
              }}
            >
              <span className="stop-num">{status[s.id] === 'visited' ? '✓' : i + 1}</span>
              <span className="li-main">
                <span className="li-name">{loc(s.name, lang)}</span>
                <span className="muted small">
                  {status[s.id] ? t(status[s.id] as 'visited' | 'skipped') : me ? fmtDist(haversineM(me, s)) : ''}
                  {s.indoor ? ' · 🏠' : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {started && (
          <button className="btn btn-block" type="button" onClick={finish}>{t('endTour')}</button>
        )}
      </section>

      {dim && (
        <div className="dim" onClick={() => setDim(false)} role="button" tabIndex={0}>
          <div className="dim-next">{nextStop ? loc(nextStop.name, lang) : t('allDone')}</div>
          {nextStop && me && <div className="dim-dist">{fmtDist(haversineM(me, nextStop))}</div>}
          <div className="dim-hint">{t('walkScreenHint')}</div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {photo && (
        <PhotoIdentify
          pois={[...route.stops, ...places.filter((p) => !route.stops.includes(p))]}
          position={me && !me.sim ? me : null}
          onClose={() => setPhoto(false)}
        />
      )}
    </main>
  );
}
