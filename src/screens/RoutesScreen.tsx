import { useMemo } from 'react';
import MapView, { type MapStop } from '../components/MapView';
import { fmtDuration, loc, useI18n } from '../i18n';
import type { PlannedRoute } from '../types';
import type { WeatherAnalysis } from '../lib/weather';

interface Props {
  routes: PlannedRoute[];
  selected: number;
  setSelected: (i: number) => void;
  placesNote: string | null;
  weather: WeatherAnalysis | null;
  onBack: () => void;
  onStart: () => void;
}

export default function RoutesScreen({ routes, selected, setSelected, placesNote, onBack, onStart }: Props) {
  const { t, lang } = useI18n();
  const route = routes[selected];
  const stops: MapStop[] = useMemo(
    () => (route?.stops ?? []).map((s, i) => ({ id: s.id, lat: s.lat, lng: s.lng, label: String(i + 1), title: loc(s.name, lang), status: 'todo' })),
    [route, lang],
  );

  return (
    <main className="split">
      <div className="topbar">
        <button className="icon-btn" type="button" onClick={onBack} aria-label={t('back')}>←</button>
        <div className="topbar-title">
          <div className="route-title">{t('routesTitle')}</div>
          {placesNote && <div className="muted small">{placesNote}</div>}
        </div>
      </div>

      {route && (
        <MapView
          center={route.start}
          path={route.path}
          stops={stops}
          start={route.start}
          fitKey={route.id}
          className="map map-preview"
        />
      )}

      <section className="panel">
        {routes.length === 0 && <p>{t('reasonShort', { n: 0 })}</p>}
        <div className="route-cards" role="radiogroup">
          {routes.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={i === selected}
              className={`route-card${i === selected ? ' selected' : ''}`}
              onClick={() => setSelected(i)}
            >
              <div className="route-card-head">
                <strong>{r.title}</strong>
                {i === 0 && <span className="badge">{t('recommended')}</span>}
              </div>
              <div className="route-stats">
                <span>🚶 {r.distanceKm} {t('km')}</span>
                <span>⏱ {fmtDuration(r.totalMin, t)}</span>
                <span>📍 {r.stops.length} {t('stops')}</span>
              </div>
              {i === selected && (
                <>
                  <ul className="reasons">
                    {r.reasons.map((x) => <li key={x}>{x}</li>)}
                    {!r.routed && <li className="muted">{t('routedFallback')}</li>}
                  </ul>
                  <ol className="mini-stops">
                    {r.stops.map((s) => (
                      <li key={s.id}>{loc(s.name, lang)}{s.indoor ? ' 🏠' : ''}</li>
                    ))}
                  </ol>
                </>
              )}
            </button>
          ))}
        </div>
        {route && route.stops.length > 0 && (
          <button className="btn btn-primary btn-block sticky-cta" type="button" onClick={onStart}>
            ▶ {t('start')} · {route.title}
          </button>
        )}
      </section>
    </main>
  );
}
