import type { Lang } from '../types';
import { isPrepared, loadNeural, neuralPref, neuralState, synthesize } from './neuralVoice';

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

// ---------- natural AI voice (plays generated audio) ----------
// Longer pieces read more naturally (intonation across sentences, fewer pauses);
// the model handles up to about 500 sound units, so ~300 characters is safe.
const NEURAL_CHUNK = 300;
/** The pieces a text is spoken in by the natural voice (used to prepare audio in advance). */
export const chunkForVoice = (text: string) => chunkText(text, NEURAL_CHUNK);
const player: HTMLAudioElement | undefined = typeof Audio !== 'undefined' ? new Audio() : undefined;
let endCurrent: (() => void) | null = null;
let neuralActive = false;

/** Is the natural voice switched on and usable for this language? */
function neuralOn(lang: Lang): boolean {
  if (lang !== 'en' || !player || !neuralPref().on) return false;
  if (neuralState().status === 'ready') return true;
  if (neuralState().status === 'off') loadNeural().catch(() => undefined); // get it ready for next time
  return false;
}

function playUrl(url: string, my: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!player || my !== token) return resolve(false);
    const done = (ok: boolean) => {
      player.onended = player.onerror = null;
      endCurrent = null;
      resolve(ok);
    };
    endCurrent = () => done(false);
    player.onended = () => done(true);
    player.onerror = () => done(false);
    player.src = url;
    player.play().catch(() => done(false));
  });
}

async function speakNeural(text: string, my: number): Promise<'done' | 'stopped' | 'failed'> {
  const voice = neuralPref().voice;
  const chunks = chunkText(text, NEURAL_CHUNK);
  const jobs = chunks.map((c) => synthesize(c, voice)); // generated in order, played as each is ready
  neuralActive = true;
  try {
    for (const job of jobs) {
      let url: string;
      try {
        url = await job;
      } catch {
        return 'failed';
      }
      if (my !== token) return 'stopped';
      if (!(await playUrl(url, my))) return my === token ? 'failed' : 'stopped';
    }
    return 'done';
  } finally {
    neuralActive = false;
  }
}

/** Prepare narration in advance (e.g. the next stops) so it plays without waiting. */
export function prefetch(texts: string[], lang: Lang) {
  if (lang !== 'en' || !player || !neuralPref().on) return;
  const go = () => {
    const voice = neuralPref().voice;
    for (const t of texts) for (const c of chunkText(t, NEURAL_CHUNK)) synthesize(c, voice).catch(() => undefined);
  };
  // Not loaded yet (first walk of the day): load, then prepare.
  if (neuralState().status === 'ready') go();
  else loadNeural().then(go).catch(() => undefined);
}

/**
 * Speak text. The natural voice is used when its audio is already prepared
 * (or when waitForNatural is set, e.g. the Test button). Otherwise the phone's
 * voice speaks right away, and the natural audio is prepared for next time:
 * nobody should stand in silence while the phone generates speech.
 */
export function speak(text: string, lang: Lang, opts: { waitForNatural?: boolean } = {}): Promise<boolean> {
  stop();
  if (muted || !text.trim()) return Promise.resolve(false);
  const my = ++token;
  const natural = neuralOn(lang);
  const ready = natural && isPrepared(chunkText(text, NEURAL_CHUNK), neuralPref().voice);
  if (natural && !ready && !opts.waitForNatural) prefetch([text], lang);
  if (natural && (ready || opts.waitForNatural)) {
    setSpeaking(true);
    return speakNeural(text, my).then((r) => {
      if (r === 'done') {
        setSpeaking(false);
        return true;
      }
      if (r === 'stopped') return false;
      return speakSystem(text, lang, my); // the AI voice failed: carry on with the phone's voice
    });
  }
  return speakSystem(text, lang, my);
}

function speakSystem(text: string, lang: Lang, my: number): Promise<boolean> {
  if (!synth) {
    setSpeaking(false);
    return Promise.resolve(false);
  }
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
  if (player && !player.paused) player.pause();
  endCurrent?.();
  if (speakingFlag) setSpeaking(false);
}

export function pause() {
  if (neuralActive) player?.pause();
  else synth?.pause();
}

export function resume() {
  if (neuralActive) player?.play().catch(() => undefined);
  else synth?.resume();
}

/** A tenth of a second of silence, to unlock audio playback on iPhone. */
function silentWav(): Blob {
  const n = 2400;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 24000, true); b.setUint32(28, 48000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  str(36, 'data'); b.setUint32(40, n * 2, true);
  return new Blob([b.buffer], { type: 'audio/wav' });
}

/** iOS only allows speech and audio after a user tap: call this from the first tap. */
export function unlock() {
  if (synth) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  }
  if (player) {
    player.src = URL.createObjectURL(silentWav());
    player.play().catch(() => undefined);
  }
}

export const isSpeaking = () => speakingFlag || !!synth?.speaking;
export const supported = () => !!synth || (!!player && neuralPref().on);
export function setMuted(m: boolean) {
  muted = m;
  if (m) stop();
}
export const isMuted = () => muted;
export function onSpeakingChange(fn: (s: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
