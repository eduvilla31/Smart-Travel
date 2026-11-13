import { loc, useI18n } from '../i18n';
import { useCity } from '../city';
import type { ContextState } from '../App';
import { NOTE_ICON } from '../lib/context';

/** "Today in Basel": strikes, closures, events, each with its source link. */
export default function ContextCard({ context }: { context: ContextState }) {
  const { t, lang } = useI18n();
  const city = useCity();
  if (context.status === 'off') return null;
  return (
    <section className="card context-card" aria-live="polite">
      <h3>📰 {t('todayIn', { city: loc(city.city.name, lang) })}</h3>
      {context.status === 'loading' && <p className="muted small">{t('contextLoading')}</p>}
      {context.status === 'error' && <p className="muted small">{t('contextFailed')}</p>}
      {context.status === 'ok' && context.notes.length === 0 && <p className="muted small">{t('contextNone')}</p>}
      {context.status === 'ok' && context.notes.length > 0 && (
        <ul className="context-list">
          {context.notes.map((n) => (
            <li key={n.sourceUrl + n.title} className={n.effect}>
              <strong>{NOTE_ICON[n.type]} {n.title}</strong>
              <span>{n.summary}</span>
              <span className="muted small">
                {[n.area, n.timeWindow].filter(Boolean).join(' · ')} ·{' '}
                <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer">{n.sourceTitle || t('source')}</a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
