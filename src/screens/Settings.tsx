import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { LANGS, type Preferences } from '../types';
import { apiHealth, getApi, setApi, type ModelId } from '../lib/api';
import { isAllowedServer } from '../lib/safe';
import * as speech from '../lib/speech';
import { NEURAL_VOICES, loadNeural, neuralPref, neuralState, neuralSupported, onNeuralState, setNeuralPref, type NeuralVoiceId } from '../lib/neuralVoice';

interface Props {
  prefs: Preferences;
  setPrefs: (p: Partial<Preferences>) => void;
  onApiChanged: () => void;
  onBack: () => void;
}

/** Everything that isn't needed to plan a walk: language, voices, walking, Claude features. */
export default function Settings({ prefs, setPrefs, onApiChanged, onBack }: Props) {
  const { t, lang } = useI18n();
  return (
    <main className="page">
      <div className="settings-head">
        <button className="icon-btn" type="button" onClick={onBack} aria-label={t('back')}>←</button>
        <h1>⚙️ {t('settings')}</h1>
      </div>

      <section className="card">
        <h2>{t('language')}</h2>
        <div className="segmented" role="radiogroup" aria-label={t('language')}>
          {LANGS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setPrefs({ lang: l })}>
              {l === 'en' ? 'English' : 'Español'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>🔊 {t('voiceSection')}</h2>
        <NaturalVoiceSettings />
        <VoiceSettings />
      </section>

      <section className="card">
        <h2>🚶 {t('walkingSection')}</h2>
        <label className="field">
          <span className="field-label">{t('pace')}</span>
          <select value={prefs.pace} onChange={(e) => setPrefs({ pace: e.target.value as Preferences['pace'] })}>
            <option value="slow">{t('paceSlow')} · 3.5 km/h</option>
            <option value="normal">{t('paceNormal')} · 4.5 km/h</option>
            <option value="fast">{t('paceFast')} · 5.5 km/h</option>
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.avoidStairs} onChange={(e) => setPrefs({ avoidStairs: e.target.checked })} />
          <span>{t('avoidStairs')}</span>
        </label>
      </section>

      <section className="card">
        <h2>✨ {t('claudeSection')}</h2>
        <ServerSettings onChanged={onApiChanged} />
      </section>
    </main>
  );
}

/** The free on-phone AI voice: switch, voice choice, download progress, test. */
function NaturalVoiceSettings() {
  const { t, lang } = useI18n();
  const [pref, setPref] = useState(neuralPref);
  const [state, setState] = useState(neuralState);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    const off = onNeuralState(setState);
    return () => {
      off();
    };
  }, []);
  if (!neuralSupported()) return null;

  const update = (p: Partial<typeof pref>) => {
    setNeuralPref(p);
    setPref(neuralPref());
  };
  const status =
    state.status === 'loading'
      ? t('naturalLoading', { pct: state.progress })
      : state.status === 'ready'
        ? `✅ ${t('naturalReady')}`
        : state.status === 'error'
          ? `⚠️ ${t('naturalFailed')}`
          : '';

  return (
    <fieldset className="field natural-voice">
      <legend className="field-label">✨ {t('naturalVoice')}</legend>
      <label className="toggle">
        <input
          type="checkbox"
          checked={pref.on}
          onChange={(e) => {
            update({ on: e.target.checked });
            if (e.target.checked) loadNeural().catch(() => undefined);
          }}
        />
        <span>{t('naturalOn')}</span>
      </label>
      {pref.on && (
        <>
          <div className="city-search">
            <select value={pref.voice} aria-label={t('naturalVoice')} onChange={(e) => update({ voice: e.target.value as NeuralVoiceId })}>
              {NEURAL_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v[lang]}</option>
              ))}
            </select>
            <button
              className="btn btn-small"
              type="button"
              disabled={state.status === 'loading' || testing}
              onClick={async () => {
                speech.unlock();
                setTesting(true);
                try {
                  await loadNeural();
                  await speech.speak(t('naturalSample'), 'en', { waitForNatural: true });
                } catch {
                  /* status line shows the problem */
                } finally {
                  setTesting(false);
                }
              }}
            >
              {testing ? '…' : `▶ ${t('voiceTest')}`}
            </button>
          </div>
          {state.status === 'loading' && <progress max={100} value={state.progress} className="voice-progress" />}
          {testing && <p className="muted small" aria-live="polite">{t('naturalPreparing')}</p>}
          {status && <p className="muted small" aria-live="polite">{status}</p>}
        </>
      )}
      <p className="muted small">{t('naturalHint')}</p>
    </fieldset>
  );
}

/** Pick the narration voice; the most natural one is chosen automatically. */
function VoiceSettings() {
  const { t, lang } = useI18n();
  const [voices, setVoices] = useState(() => speech.listVoices(lang));
  const [chosen, setChosen] = useState(() => speech.preferredVoice(lang));

  useEffect(() => {
    const refresh = () => setVoices(speech.listVoices(lang));
    refresh();
    setChosen(speech.preferredVoice(lang));
    const off = speech.onVoicesChanged(refresh);
    return () => {
      off();
    };
  }, [lang]);

  if (!speech.supported()) return null;
  const quality = (v: SpeechSynthesisVoice) => {
    const s = speech.voiceScore(v, lang);
    return s >= 100 ? ' ★★★' : s >= 50 ? ' ★★' : s >= 0 ? '' : ' ✕';
  };

  return (
    <fieldset className="field">
      <legend className="field-label">{t('voice')}</legend>
      <div className="city-search">
        <select
          value={chosen}
          aria-label={t('voice')}
          onChange={(e) => {
            setChosen(e.target.value);
            speech.setPreferredVoice(lang, e.target.value);
          }}
        >
          <option value="">{t('voiceAuto')}{voices[0] ? ` · ${voices[0].name}` : ''}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang}){quality(v)}
            </option>
          ))}
        </select>
        <button className="btn btn-small" type="button" onClick={() => speech.speak(t('voiceSample'), lang)}>
          ▶ {t('voiceTest')}
        </button>
      </div>
      <p className="muted small">{t('voiceTip')}</p>
    </fieldset>
  );
}

/** Where the Smart Travel server lives, plus the optional access code. */
function ServerSettings({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(getApi().url);
  const [code, setCode] = useState(getApi().code);
  const [key, setKey] = useState(getApi().key);
  const [model, setModel] = useState<ModelId>(getApi().model);
  const [state, setState] = useState<'off' | 'ok' | 'err' | 'checking'>(getApi().url || getApi().key ? 'checking' : 'off');

  const check = async () => {
    if (!getApi().url && !getApi().key) return setState('off');
    setState('checking');
    setState((await apiHealth()).ok ? 'ok' : 'err');
  };
  useEffect(() => {
    check();
  }, []);

  const [problem, setProblem] = useState<string | null>(null);
  const commit = () => {
    const u = url.trim();
    const k = key.trim();
    if (u && !isAllowedServer(u)) return setProblem(t('serverNotAllowed'));
    if (k && !/^sk-ant-[\w-]+$/.test(k)) return setProblem(t('keyLooksWrong'));
    setProblem(null);
    setApi({ url: u, code: code.trim(), key: k });
    check();
    onChanged();
  };
  const removeKey = () => {
    setKey('');
    setApi({ key: '' });
    check();
    onChanged();
  };

  return (
    <fieldset className="field">
      <legend className="field-label">{t('server')}</legend>
      <input className="text-input" type="url" inputMode="url" placeholder="https://smart-travel-api.…workers.dev"
        value={url} onChange={(e) => setUrl(e.target.value)} onBlur={commit} aria-label={t('serverUrl')} />
      <input className="text-input" type="password" placeholder={t('accessCode')} value={code}
        onChange={(e) => setCode(e.target.value)} onBlur={commit} aria-label={t('accessCode')} style={{ marginTop: 8 }} />
      <p className="muted small" style={{ margin: '12px 0 6px' }}>{t('ownKeyHint')}</p>
      <input className="text-input" type="password" autoComplete="off" placeholder="sk-ant-…" value={key}
        onChange={(e) => setKey(e.target.value)} onBlur={commit} aria-label={t('ownKey')} />
      {key && (
        <button className="btn btn-small btn-ghost" type="button" style={{ marginTop: 8 }} onClick={removeKey}>
          🗑 {t('removeKey')}
        </button>
      )}
      {problem && <p className="status-line" role="alert">⚠️ {problem}</p>}
      {key && !url && (
        <select
          value={model}
          aria-label={t('model')}
          style={{ marginTop: 8 }}
          onChange={(e) => {
            const m = e.target.value as ModelId;
            setModel(m);
            setApi({ model: m });
            onChanged();
          }}
        >
          <option value="claude-haiku-5-5">Claude Haiku · {t('modelCheap')}</option>
          <option value="claude-opus-5-5">Claude Opus · {t('modelBest')}</option>
        </select>
      )}
      <p className="muted small">
        {state === 'ok' ? `✅ ${url ? t('serverOk') : t('ownKeyOk')}` : state === 'err' ? `⚠️ ${t('serverErr')}` : state === 'checking' ? '…' : t('serverOff')}
      </p>
    </fieldset>
  );
}
