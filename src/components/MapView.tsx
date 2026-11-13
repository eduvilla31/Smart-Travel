import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '../types';

export interface MapStop { id: string; lat: number; lng: number; label: string; title: string; status: 'todo' | 'next' | 'done' }
export interface MapMe extends LatLng { accuracy?: number; sim?: boolean }

interface Props {
  center: LatLng;
  path?: LatLng[];
  stops?: MapStop[];
  start?: LatLng;
  me?: MapMe | null;
  /** Change this value to re-fit the map to the route. */
  fitKey?: string;
  follow?: boolean;
  radiusM?: number;
  onStopClick?: (id: string) => void;
  /** Pan to this point whenever `key` changes. */
  focus?: LatLng & { key: number };
  className?: string;
}

const stopIcon = (s: MapStop) =>
  L.divIcon({ className: '', html: `<div class="poi-marker ${s.status}">${s.label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
const startIcon = L.divIcon({ className: '', html: '<div class="start-marker">⚑</div>', iconSize: [24, 24], iconAnchor: [12, 12] });
const meIcon = (sim?: boolean) =>
  L.divIcon({ className: '', html: `<div class="me-marker${sim ? ' sim' : ''}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });

export default function MapView({ center, path, stops, start, me, fitKey, follow, radiusM = 25, onStopClick, focus, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const meLayer = useRef<{ marker: L.Marker; circle: L.Circle } | null>(null);
  const clickRef = useRef(onStopClick);
  clickRef.current = onStopClick;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // CORS-readable tiles: the service worker can then cache them at their real size
      // (opaque responses are counted as several MB each against the storage quota).
      crossOrigin: true,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    L.control.zoom({ position: 'bottomleft' }).addTo(m);
    routeLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      // Removing a map mid-animation throws inside Leaflet: stop animations first.
      m.stop();
      m.off();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route line, stops and geofences
  useEffect(() => {
    const g = routeLayer.current;
    if (!g) return;
    g.clearLayers();
    if (path && path.length > 1) {
      L.polyline(path.map((p) => [p.lat, p.lng]), { color: '#ffffff', weight: 8, opacity: 0.9 }).addTo(g);
      L.polyline(path.map((p) => [p.lat, p.lng]), { color: '#0f766e', weight: 5, opacity: 0.95 }).addTo(g);
    }
    if (start) L.marker([start.lat, start.lng], { icon: startIcon, interactive: false }).addTo(g);
    for (const s of stops ?? []) {
      L.circle([s.lat, s.lng], { radius: radiusM, color: '#0f766e', weight: 1, opacity: 0.35, fillOpacity: 0.06, interactive: false }).addTo(g);
      L.marker([s.lat, s.lng], { icon: stopIcon(s), title: s.title, zIndexOffset: s.status === 'next' ? 500 : 0 })
        .on('click', () => clickRef.current?.(s.id))
        .addTo(g);
    }
  }, [path, stops, start, radiusM]);

  // Fit to route
  useEffect(() => {
    const m = map.current;
    if (!m || !fitKey) return;
    const pts = [...(path ?? []), ...(stops ?? []), ...(start ? [start] : [])];
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [30, 30], animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Live position
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!me) {
      meLayer.current?.marker.remove();
      meLayer.current?.circle.remove();
      meLayer.current = null;
      return;
    }
    const ll: L.LatLngExpression = [me.lat, me.lng];
    if (!meLayer.current) {
      meLayer.current = {
        circle: L.circle(ll, { radius: me.accuracy ?? 0, color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(m),
        marker: L.marker(ll, { icon: meIcon(me.sim), zIndexOffset: 1000, interactive: false }).addTo(m),
      };
    } else {
      meLayer.current.marker.setLatLng(ll).setIcon(meIcon(me.sim));
      meLayer.current.circle.setLatLng(ll).setRadius(me.sim ? 0 : me.accuracy ?? 0);
    }
    if (follow) m.panTo(ll, { animate: true });
  }, [me, follow]);

  useEffect(() => {
    const m = map.current;
    if (m && focus) m.setView([focus.lat, focus.lng], Math.max(m.getZoom(), 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  return <div ref={el} className={className ?? 'map'} role="region" aria-label="Map" />;
}
