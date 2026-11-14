import { useState } from 'react';
import { useI18n } from '../i18n';
import type { CityData } from '../types';
import { makeCity, searchPlaces, type PlaceResult } from '../lib/geocode';
import type { DetectState } from '../App';

interface Props {
  onChoose: (id: string) => void;
  onChooseSearched: (c: CityData) => void;
  onUseHere: () => void;
  detect: DetectState;
  gpsReady: boolean;
}

/** One open search field for any city, plus "use my location". Nothing is remembered. */
export default function CityPicker({ onChooseSearched, onUseHere, detect, gpsReady }: Props) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const r = await searchPlaces(query, lang);
      setResults(r);
      if (!r.length) setError(t('searchNone'));
    } catch {
      setError(t('searchFailed'));
    } finally {
      setBusy(false);
    }
  };

  const pick = (r: PlaceResult) => {
    onChooseSearched(makeCity(r));
    setResults(null);
    setQuery('');
  };

  return (
    <section className="city-picker" aria-label={t('city')}>
      {detect === 'failed' && <p className="muted small">{t('detectFailed')}</p>}

      <form className="city-search" onSubmit={search} role="search">
        <input
          className="text-input"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('searchPlaceholder')}
        />
        <button className="btn btn-small" type="submit" disabled={busy || query.trim().length < 2}>
          {busy ? '…' : t('search')}
        </button>
      </form>
      <button type="button" className="btn btn-small btn-ghost here-btn" onClick={onUseHere} disabled={!gpsReady || detect === 'detecting'}>
        {detect === 'detecting' ? `⏳ ${t('detecting')}` : `📍 ${t('useHere')}`}
      </button>

      {error && <p className="muted small">{error}</p>}
      {results && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              {r.tooBig ? (
                <div className="muted small">
                  <strong>{r.name}</strong> · {t('tooBig', { name: r.name })}
                </div>
              ) : (
                <button type="button" onClick={() => pick(r)}>
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.label}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
