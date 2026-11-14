import { useEffect, useRef, useState } from 'react';
import { loc, useI18n } from '../i18n';
import { useCity } from '../city';
import type { Lang, LatLng, Poi } from '../types';
import { apiPost, hasApi } from '../lib/api';
import { angleDiff, bearingDeg, haversineM } from '../lib/geo';
import { getNarration } from '../lib/narration';
import { safeUrl } from '../lib/safe';
import * as speech from '../lib/speech';
import { currentHeading } from '../lib/compass';

interface Props {
  pois: Poi[];
  position: (LatLng & { accuracy?: number }) | null;
  onClose: () => void;
}

interface Candidate { poi: Poi; distanceM: number; bearing: number }

interface Result {
  status: 'identified' | 'uncertain' | 'not_found';
  poi?: Poi;
  name: string;
  short: string;
  lang: Lang;
  sourceUrl?: string;
  alternatives: Poi[];
  /** true when the answer is a location-only guess (no server). */
  guess?: boolean;
}

/** Shrink the photo to at most 1024 px on its long side, JPEG. Returns base64 without the data: prefix. */
/** Decode a photo two ways: the fast one, and the classic <img> one older Safari needs. */
async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  try {
    const bmp = await createImageBitmap(file);
    return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('unreadable'));
      img.src = url;
    }).catch((e) => {
      URL.revokeObjectURL(url);
      throw e;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }
}

export class PhotoUnreadable extends Error {}

async function shrink(file: File): Promise<{ data: string; preview: string }> {
  let pic;
  try {
    pic = await decode(file);
  } catch {
    throw new PhotoUnreadable(file.type || 'unknown type');
  }
  try {
    const scale = Math.min(1, 1024 / Math.max(pic.w, pic.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(pic.w * scale));
    canvas.height = Math.max(1, Math.round(pic.h * scale));
    canvas.getContext('2d')!.drawImage(pic.img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.8);
    return { data: url.split(',')[1], preview: url };
  } finally {
    pic.done();
  }
}

function currentPosition(): Promise<(LatLng & { accuracy: number }) | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );
  });
}

export function nearestCandidates(pois: Poi[], pos: LatLng, n = 10, maxM = 600): Candidate[] {
  return pois
    .map((poi) => ({ poi, distanceM: haversineM(pos, poi), bearing: bearingDeg(pos, poi) }))
    .filter((c) => c.distanceM <= maxM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, n);
}

/** Without the server: the closest places roughly in front of the camera. */
export function guessFromPosition(cands: Candidate[], heading: number | null): Poi[] {
  const ahead = heading == null ? cands : cands.filter((c) => angleDiff(c.bearing, heading) <= 40);
  return (ahead.length ? ahead : cands).slice(0, 2).map((c) => c.poi);
}

export default function PhotoIdentify({ pois, position, onClose }: Props) {
  const { t, lang } = useI18n();
  const city = useCity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'idle' | 'working' | 'result' | 'error'>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => speech.stop(), []);

  const showPoi = async (poi: Poi) => {
    setPhase('working');
    setMore(null);
    const n = await getNarration(poi, lang, t('seedSource'));
    const r: Result = { status: 'identified', poi, name: loc(poi.name, lang), short: n.short, lang: n.lang, sourceUrl: n.sourceUrl, alternatives: [] };
    setResult(r);
    setPhase('result');
    speech.speak(`${r.name}. ${r.short}`, r.lang);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPhase('working');
    setResult(null);
    setMore(null);
    setError(null);
    try {
      const [{ data, preview: url }, pos] = await Promise.all([shrink(file), position ? Promise.resolve(position) : currentPosition()]);
      setPreview(url);
      if (!pos) {
        setError(t('identifyNoGps'));
        setPhase('error');
        return;
      }
      const cands = nearestCandidates(pois, pos);
      const heading = currentHeading();
      let r: Result | null = null;
      if (hasApi()) {
        try {
          const res = await apiPost<{ status: Result['status']; candidateId: string | null; name: string; short: string; alternatives: { candidateId: string }[]; sourceUrl?: string; lang: Lang }>(
            '/identify',
            {
              image: data,
              mediaType: 'image/jpeg',
              lat: pos.lat,
              lng: pos.lng,
              accuracy: pos.accuracy,
              heading,
              lang,
              city: city.city.name.en,
              candidates: cands.map((c) => ({
                id: c.poi.id,
                name: c.poi.name.en,
                wiki: c.poi.wiki,
                distanceM: Math.round(c.distanceM),
                bearingDeg: Math.round(c.bearing),
                facts: c.poi.text?.en?.short,
              })),
            },
            30000,
          );
          const byId = (id: string | null) => cands.find((c) => c.poi.id === id)?.poi;
          r = {
            status: res.status,
            poi: byId(res.candidateId),
            name: res.name,
            short: res.short,
            lang: res.lang,
            sourceUrl: safeUrl(res.sourceUrl),
            alternatives: res.alternatives.map((a) => byId(a.candidateId)).filter((p): p is Poi => !!p),
          };
        } catch {
          r = null; // fall through to the location-only guess
        }
      }
      if (!r) {
        const alts = guessFromPosition(cands, heading);
        r = { status: alts.length ? 'uncertain' : 'not_found', name: '', short: t('noServerGuess'), lang, alternatives: alts, guess: true };
      }
      setResult(r);
      setPhase('result');
      if (r.status === 'identified') speech.speak(`${r.name}. ${r.short}`, r.lang);
      else if (!r.guess) speech.speak(r.short, r.lang);
    } catch (e) {
      // Say what actually went wrong (no more misleading "server" message).
      setError(e instanceof PhotoUnreadable ? `${t('photoUnreadable')} (${e.message})` : `${t('photoFailed')} (${e instanceof Error ? e.message : 'error'})`);
      setPhase('error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const tellMore = async () => {
    if (!result?.poi) return;
    setLoadingMore(true);
    const n = await getNarration(result.poi, lang, t('seedSource'));
    setLoadingMore(false);
    const text = n.long ?? n.short;
    setMore(text);
    speech.speak(text, n.lang);
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('identifyTitle')}>
      <div className="sheet">
        <div className="sheet-head">
          <h2>📷 {t('identifyTitle')}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>


        {preview && <img className="photo-preview" src={preview} alt="" />}
        {phase === 'idle' && <p className="muted">{t('identifyHint')}</p>}
        {phase === 'working' && <p className="status-line" aria-live="polite">⏳ {t('identifying')}</p>}
        {phase === 'error' && <p className="status-line">{error}</p>}

        {phase === 'result' && result && (
          <div className="id-result" aria-live="polite">
            {result.status === 'identified' && (
              <>
                <h3>{result.name}</h3>
                <p>{result.short}</p>
                {result.poi && !more && (
                  <button className="btn btn-primary" type="button" onClick={tellMore} disabled={loadingMore}>
                    {loadingMore ? '…' : t('wantMore')}
                  </button>
                )}
                {more && <p className="more-text">{more}</p>}
                {result.sourceUrl && (
                  <p className="small muted">
                    {t('source')}: <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">{result.sourceUrl.replace(/^https:\/\//, '')}</a>
                  </p>
                )}
              </>
            )}
            {result.status === 'uncertain' && (
              <>
                <p>{result.guess ? result.short : `${t('notSure')} ${result.short}`}</p>
                <div className="btn-row">
                  {result.alternatives.map((p) => (
                    <button key={p.id} className="btn" type="button" onClick={() => showPoi(p)}>{loc(p.name, lang)}</button>
                  ))}
                </div>
              </>
            )}
            {result.status === 'not_found' && <p>{result.guess ? t('notFound') : result.short || t('notFound')}</p>}
          </div>
        )}

        {/* A real file input inside a label: the phone opens the camera itself, which iPhone
            allows far more reliably than a script-triggered click. */}
        <label className={`btn btn-primary btn-block photo-btn${phase === 'working' ? ' disabled' : ''}`}>
          📷 {t('takePhoto')}
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={phase === 'working'}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {/* Fallback when the camera can't be opened (some in-app browsers block it). */}
        <label className={`btn btn-block photo-btn${phase === 'working' ? ' disabled' : ''}`}>
          🖼️ {t('choosePhoto')}
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            disabled={phase === 'working'}
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <p className="muted small center">{t('photoHint')}</p>
      </div>
    </div>
  );
}
