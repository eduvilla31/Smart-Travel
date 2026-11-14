import { useEffect, useState } from 'react';
import { loc, useI18n } from '../i18n';
import { useCity } from '../city';
import type { PlaceRef, StartPoint } from '../types';
import { searchInCity, type PlaceResult } from '../lib/geocode';

export interface ExtraOption { value: string; label: string; disabled?: boolean }

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown first, e.g. "My current location", "Back to start". */
  extra: ExtraOption[];
  /** Suggested places in the chosen city. */
  points: StartPoint[];
  typed?: PlaceRef;
  onTyped: (p: PlaceRef) => void;
}

/** A dropdown of places in the chosen city, ending with "Type a place…". */
export default function PlaceSelect({ label, value, onChange, extra, points, typed, onTyped }: Props) {
  const { t, lang } = useI18n();
  const city = useCity();
  const cityName = loc(city.city.name, lang);
  const [typing, setTyping] = useState(value === 'typed' && !typed);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A new city starts with a clean search.
  useEffect(() => {
    setTyping(false);
    setResults(null);
    setQuery('');
  }, [city.city.id]);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await searchInCity(query, city, lang);
      setResults(r);
      if (!r.length) setError(t('typePlaceNone', { city: cityName }));
    } catch {
      setError(t('searchFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field place-select">
      <span className="field-label">{label}</span>
      <select
        value={value === 'typed' && !typed ? '' : value}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === 'typed') {
            setTyping(true);
            if (typed) onChange('typed');
          } else {
            setTyping(false);
            onChange(e.target.value);
          }
        }}
      >
        {value === 'typed' && !typed && <option value="" disabled>…</option>}
        {extra.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
        <optgroup label={t('suggestionsIn', { city: cityName })}>
          {points.map((p) => (
            <option key={p.id} value={p.id}>{loc(p.name, lang)}</option>
          ))}
        </optgroup>
        <option value="typed">{typed ? `✏️ ${typed.name}` : t('typePlace')}</option>
      </select>

      {typing && (
        <div className="place-search">
          <div className="city-search">
            <input
              className="text-input"
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              placeholder={t('typePlaceIn', { city: cityName })}
              aria-label={t('typePlaceIn', { city: cityName })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (query.trim().length >= 2) search();
                }
              }}
            />
            <button className="btn btn-small" type="button" disabled={busy || query.trim().length < 2} onClick={search}>
              {busy ? '…' : t('search')}
            </button>
          </div>
          {error && <p className="muted small">{error}</p>}
          {results && results.length > 0 && (
            <ul className="search-results">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onTyped({ lat: r.lat, lng: r.lng, name: r.name });
                      onChange('typed');
                      setTyping(false);
                      setResults(null);
                      setQuery('');
                    }}
                  >
                    <strong>{r.name}</strong>
                    <span className="muted small">{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
