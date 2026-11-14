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

// Apple's joke and retro voices: never pick these automatically.
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|princess|deranged|hysterical|pipe organ)\b/i;
// Apple's newer character voices: usable, but flatter than Premium/Enhanced ones.
const CHARACTER = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/** Higher is more natural-sounding. Exported for tests. */
export function voiceScore(v: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService' | 'voiceURI'>, lang: Lang): number {
  const id = `${v.name} ${v.voiceURI}`;
  const vlang = v.lang.replace('_', '-');
  if (!vlang.toLowerCase().startsWith(lang)) return -1000;
  let s = 0;
  if (/premium/i.test(id)) s += 100; // iOS / macOS downloadable neural voices
  else if (/enhanced|mejorad/i.test(id)) s += 80;
  if (/natural|neural|online/i.test(id)) s += 70; // Edge / Windows "Online (Natural)" voices
  if (/^google\b/i.test(v.name)) s += 50; // Chrome / Android network voices
  if (/siri/i.test(id)) s += 60;
  if (NOVELTY.test(v.name)) s -= 200;
  if (CHARACTER.test(v.name)) s -= 30;
  if (/compact/i.test(id)) s -= 20;
  // Prefer the user's own variant (en-GB vs en-US, es-ES vs es-MX), then the default one.
  const own = (typeof navigator !== 'undefined' ? navigator.language : '').replace('_', '-');
  if (own && vlang.toLowerCase() === own.toLowerCase()) s += 15;
  else if (vlang === VOICE_LANG[lang]) s += 10;
  if (v.localService) s += 5; // keeps working without signal
  return s;
}

/** Voices for a language, most natural first. */
export function listVoices(lang: Lang): SpeechSynthesisVoice[] {
  const voices = synth?.getVoices() ?? [];
  return voices
    .filter((v) => voiceScore(v, lang) > -1000)
    .sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang));
}

const PREF_KEY = 'voice';
function preferred(): Partial<Record<Lang, string>> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
  } catch {
    return {};
  }
}
/** Remember the user's voice for a language ('' = automatic). */
export function setPreferredVoice(lang: Lang, voiceURI: string) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...preferred(), [lang]: voiceURI }));
  } catch {
    /* ignore */
  }
}
export const preferredVoice = (lang: Lang) => preferred()[lang] ?? '';

function pickVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const list = listVoices(lang);
  const want = preferredVoice(lang);
  return (want && list.find((v) => v.voiceURI === want)) || list[0];
}

// Voices load asynchronously in some browsers.
const voiceListeners = new Set<() => void>();
if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = () => voiceListeners.forEach((l) => l());
/** Some browsers load voices late: get told when the list changes. */
export function onVoicesChanged(fn: () => void) {
  voiceListeners.add(fn);
  return () => voiceListeners.delete(fn);
}

/** Some engines stop long utterances after ~15 s, so speak sentence-sized chunks. */
export function chunkText(text: string, max = 280): string[] {
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
      // Premium/neural voices sound best at their natural speed; basic ones a touch slower.
      u.rate = voice && voiceScore(voice, lang) >= 50 ? 1 : 0.95;
      u.pitch = 1;
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
