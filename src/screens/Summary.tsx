import { useState } from 'react';
import { loc, useI18n } from '../i18n';
import type { TourResult } from './Tour';

interface Props { result: TourResult; onSave: () => void; isSaved: boolean; onHome: () => void }

export default function Summary({ result, onSave, isSaved, onHome }: Props) {
  const { t, lang } = useI18n();
  const [note, setNote] = useState<string | null>(null);
  const seen = result.route.stops.filter((s) => result.visited.includes(s.id));

  const text =
    `${t('appName')} · ${result.route.title}\n` +
    `${t('summarySeen', { n: seen.length, min: result.minutes })}\n` +
    seen.map((s, i) => `${i + 1}. ${loc(s.name, lang)}`).join('\n');

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: t('appName'), text });
      else {
        await navigator.clipboard.writeText(text);
        setNote(t('copied'));
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <main className="page">
      <header className="hero">
        <h1>🎉 {t('summaryTitle')}</h1>
        <p className="subtitle">{result.route.title}</p>
      </header>
      <section className="card">
        <p><strong>{t('summarySeen', { n: seen.length, min: result.minutes })}</strong></p>
        <ol className="mini-stops">
          {seen.map((s) => <li key={s.id}>{loc(s.name, lang)}</li>)}
        </ol>
        <div className="btn-row">
          <button className="btn btn-primary" type="button" onClick={onSave} disabled={isSaved}>
            {isSaved ? `✓ ${t('saved')}` : t('saveTour')}
          </button>
          <button className="btn" type="button" onClick={share}>{t('share')}</button>
          <button className="btn btn-ghost" type="button" onClick={onHome}>{t('home')}</button>
        </div>
        {note && <p className="muted small">{note}</p>}
      </section>
    </main>
  );
}
