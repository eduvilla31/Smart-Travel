import { useI18n } from '../i18n';
import type { ContextState } from '../App';
import { NOTE_ICON } from '../lib/context';
import { CITY } from '../lib/places';

/** "Today in Basel": strikes, closures, events, each with its source link. */
export default function ContextCard({ context }: { context: ContextState }) {
  const { t } = useI18n();
  if (context.status === 'off') return null;
  return (
    <section className="card context-card" aria-live="polite">
      <h3>📰 {t('todayIn', { city: CITY.city.name })}</h3>
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
