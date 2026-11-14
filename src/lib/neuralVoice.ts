/**
 * Natural AI voice (Kokoro, English), running entirely on the phone.
 *
 * The model (about 90 MB) and the speech engine are served from the app's own
 * address (see scripts/fetch-voice-model.mjs), downloaded once, and then kept
 * in the browser's cache. Nothing is sent anywhere: text goes in, audio comes out.
 */
import type { KokoroTTS } from 'kokoro-js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const HF_PREFIX = `https://huggingface.co/${MODEL}/resolve/main/`;

export const NEURAL_VOICES = [
  { id: 'af_heart', en: 'Heart · American, warm', es: 'Heart · americana, cálida' },
  { id: 'af_bella', en: 'Bella · American', es: 'Bella · americana' },
  { id: 'bf_emma', en: 'Emma · British', es: 'Emma · británica' },
  { id: 'am_michael', en: 'Michael · American', es: 'Michael · americano' },
  { id: 'bm_george', en: 'George · British', es: 'George · británico' },
  { id: 'bm_fable', en: 'Fable · British', es: 'Fable · británico' },
] as const;
export type NeuralVoiceId = (typeof NEURAL_VOICES)[number]['id'];

export type NeuralState = { status: 'off' } | { status: 'loading'; progress: number } | { status: 'ready' } | { status: 'error'; message: string };

const PREF = 'neuralVoice';
interface Pref { on: boolean; voice: NeuralVoiceId }
export function neuralPref(): Pref {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? '{}');
    return { on: !!p.on, voice: NEURAL_VOICES.some((v) => v.id === p.voice) ? p.voice : 'af_heart' };
  } catch {
    return { on: false, voice: 'af_heart' };
  }
}
export function setNeuralPref(p: Partial<Pref>) {
  try {
    localStorage.setItem(PREF, JSON.stringify({ ...neuralPref(), ...p }));
  } catch {
    /* ignore */
  }
}

let state: NeuralState = { status: 'off' };
const listeners = new Set<(s: NeuralState) => void>();
function setState(s: NeuralState) {
  state = s;
  listeners.forEach((l) => l(s));
}
export const neuralState = () => state;
export function onNeuralState(fn: (s: NeuralState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The library asks Hugging Face for files; serve them from the app instead. */
let fetchPatched = false;
function serveModelLocally() {
  if (fetchPatched) return;
  fetchPatched = true;
  const base = new URL(`models/${MODEL}/`, document.baseURI).href;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(HF_PREFIX) ? original(base + url.slice(HF_PREFIX.length), init) : original(input, init);
  };
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/** Load the model (downloads once, then from the browser's cache). */
export function loadNeural(): Promise<KokoroTTS> {
  if (ttsPromise) return ttsPromise;
  setState({ status: 'loading', progress: 0 });
  ttsPromise = (async () => {
    serveModelLocally();
    const { KokoroTTS, env } = await import('kokoro-js');
    env.wasmPaths = new URL('ort/', document.baseURI).href;
    const files = new Map<string, { loaded: number; total: number }>();
    const tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        const all = [...files.values()];
        const total = all.reduce((s, f) => s + f.total, 0);
        if (total) setState({ status: 'loading', progress: Math.min(99, Math.round((100 * all.reduce((s, f) => s + f.loaded, 0)) / total)) });
      },
    });
    setState({ status: 'ready' });
    return tts;
  })().catch((e) => {
    ttsPromise = null;
    setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    throw e;
  });
  return ttsPromise;
}

/** Audio for a piece of text, cached so a stop prepared in advance plays instantly. */
const cache = new Map<string, Promise<string>>();
const prepared = new Set<string>(); // keys whose audio is finished
let queue: Promise<unknown> = Promise.resolve(); // one generation at a time keeps the phone responsive

export function synthesize(text: string, voice: NeuralVoiceId): Promise<string> {
  const key = `${voice}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const job = queue.then(async () => {
    const tts = await loadNeural();
    const audio = await tts.generate(text, { voice });
    const url = URL.createObjectURL(audio.toBlob());
    prepared.add(key);
    return url;
  });
  queue = job.catch(() => undefined);
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > 80) {
    const [oldKey, oldUrl] = cache.entries().next().value!;
    cache.delete(oldKey);
    prepared.delete(oldKey);
    oldUrl.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  }
  return job;
}

/** Is the audio for all these pieces already made? (Generation is slower than speech.) */
export const isPrepared = (pieces: string[], voice: NeuralVoiceId) => pieces.every((p) => prepared.has(`${voice}|${p}`));

export const neuralSupported = () => typeof WebAssembly === 'object' && typeof Blob !== 'undefined';
