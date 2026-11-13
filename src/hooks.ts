import { useEffect, useRef, useState } from 'react';

export interface GeoFix { lat: number; lng: number; accuracy: number; heading: number | null; time: number }

/** Live position via watchPosition. Pass enabled=false to stop watching. */
export function useGeolocation(enabled: boolean) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setError('unsupported');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading, time: p.timestamp });
      },
      (e) => setError(e.message || 'error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, error };
}

/** navigator.onLine, kept up to date. */
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Keep the screen on while `active` (re-acquired when the page becomes visible again). */
export function useWakeLock(active: boolean) {
  const [held, setHeld] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock.current = await navigator.wakeLock.request('screen');
        if (cancelled) return lock.current.release();
        setHeld(true);
        lock.current.addEventListener('release', () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    const onVis = () => document.visibilityState === 'visible' && acquire();
    acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock.current?.release().catch(() => undefined);
      lock.current = null;
      setHeld(false);
    };
  }, [active]);
  return held;
}
