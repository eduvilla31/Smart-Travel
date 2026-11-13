import type { Lang } from '../types';

/** Narration via the Web Speech API. One queue: a new speak() replaces the old one. */
const synth: SpeechSynthesis | undefined = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let token = 0;
let muted = false;
let speakingFlag = false;
const listeners = new Set<(speaking: boolean) => void>();

const VOICE_LANG: Record<Lang, string> = { en: 'en-GB', es: 'es-ES' };

function setSpeaking(v: boolean) {
  speakingFlag = v;
  listeners.forEach((l) => l(v));
}

function pickVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const voices = synth?.getVoices() ?? [];
  const want = VOICE_LANG[lang];
  return (
    voices.find((v) => v.lang === want && v.localService) ??
    voices.find((v) => v.lang.replace('_', '-') === want) ??
    voices.find((v) => v.lang.startsWith(lang) && v.localService) ??
    voices.find((v) => v.lang.startsWith(lang))
  );
}

// Voices load asynchronously in some browsers.
if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = () => undefined;

/** Some engines stop long utterances after ~15 s, so speak sentence-sized chunks. */
export function chunkText(text: string, max = 220): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["'»)\]]*\s*|[^.!?…]+$/g) ?? [text];
  const out: string[] = [];
  let buf = '';
  for (const p of parts) {
    if (buf && (buf + p).length > max) {
      out.push(buf.trim());
      buf = '';
    }
    buf += p;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function speak(text: string, lang: Lang): Promise<boolean> {
  stop();
  if (!synth || muted || !text.trim()) return Promise.resolve(false);
  const my = ++token;
  const chunks = chunkText(text);
  const voice = pickVoice(lang);
  setSpeaking(true);
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (my !== token) return resolve(false);
      if (i >= chunks.length) {
        setSpeaking(false);
        return resolve(true);
      }
      const text = chunks[i++];
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice?.lang ?? VOICE_LANG[lang];
      if (voice) u.voice = voice;
      u.rate = 0.98;
      // Some engines never fire onend: move on after a generous estimate.
      let moved = false;
      const go = () => {
        if (moved) return;
        moved = true;
        clearTimeout(watchdog);
        next();
      };
      const watchdog = setTimeout(go, 3000 + text.length * 120);
      u.onend = go;
      u.onerror = go;
      synth.speak(u);
    };
    next();
  });
}

export function stop() {
  token++;
  synth?.cancel();
  if (speakingFlag) setSpeaking(false);
}

export function pause() {
  synth?.pause();
}

export function resume() {
  synth?.resume();
}

/** iOS only allows speech after a user tap: call this from the first tap. */
export function unlock() {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
}

export const isSpeaking = () => speakingFlag || !!synth?.speaking;
export const supported = () => !!synth;
export function setMuted(m: boolean) {
  muted = m;
  if (m) stop();
}
export const isMuted = () => muted;
export function onSpeakingChange(fn: (s: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
