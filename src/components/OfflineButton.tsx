import { useState } from 'react';
import { useI18n } from '../i18n';
import type { PlannedRoute } from '../types';
import { saveForOffline, type OfflineProgress } from '../lib/offline';

/** "Save for offline": stories, natural-voice audio and the route itself. */
export default function OfflineButton({ route, onSaved }: { route: PlannedRoute; onSaved: (r: PlannedRoute) => void }) {
  const { t, lang } = useI18n();
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [failed, setFailed] = useState(false);
  const working = progress !== null && progress.phase !== 'done';

  const run = async () => {
    setFailed(false);
    setProgress({ done: 0, total: route.stops.length, phase: 'stories' });
    try {
      await saveForOffline(route, lang, t, setProgress);
      onSaved(route);
    } catch {
      setFailed(true);
      setProgress(null);
    }
  };

  return (
    <div className="offline">
      <button className="btn btn-block" type="button" onClick={run} disabled={working || progress?.phase === 'done'}>
        {progress?.phase === 'done' ? `✅ ${t('offlineDone')}` : working ? `⏳ ${t('offlineWorking')}` : `⬇️ ${t('offlineSave')}`}
      </button>
      {working && (
        <>
          <progress max={progress.total} value={progress.done} className="voice-progress" />
          <p className="muted small">{progress.phase === 'voice' ? t('offlineVoice', { done: progress.done, total: progress.total }) : t('offlineStories')}</p>
        </>
      )}
      {failed && <p className="muted small">⚠️ {t('offlineFailed')}</p>}
      {(working || progress?.phase === 'done') && <p className="muted small">🗺️ {t('offlineMapTip')}</p>}
    </div>
  );
}
