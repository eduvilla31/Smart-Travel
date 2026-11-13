import { load, save } from './storage';

/**
 * The Smart Travel server (Cloudflare Worker in /worker) holds the Claude API key.
 * Its URL comes from the build (VITE_API_URL) and can be changed in the app settings.
 */
export const MODELS = ['claude-haiku-5-5', 'claude-opus-5-5'] as const;
export type ModelId = (typeof MODELS)[number];

export interface ApiConfig {
  url: string;
  code: string;
  /** The user's own Anthropic key, stored only on this device. */
  key: string;
  /** Model used with the user's own key. A server decides its own model. */
  model: ModelId;
}

const BUILD_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function getApi(): ApiConfig {
  const saved = load<Partial<ApiConfig>>('api', {});
  return {
    url: (saved.url ?? BUILD_URL).trim().replace(/\/+$/, ''),
    code: saved.code ?? '',
    key: (saved.key ?? '').trim(),
    model: MODELS.includes(saved.model as ModelId) ? (saved.model as ModelId) : 'claude-haiku-5-5',
  };
}

export function setApi(cfg: Partial<ApiConfig>) {
  save('api', { ...load<Partial<ApiConfig>>('api', {}), ...cfg });
}

export const hasApi = () => !!getApi().url || !!getApi().key;

/** Without a server, run the same code as the server, here on the phone, with the user's key. */
async function direct<T>(path: string, body: unknown): Promise<T> {
  const core = await import('../../worker/src/index'); // loaded only when needed
  const env = { ANTHROPIC_API_KEY: getApi().key, MODEL: getApi().model, browser: true };
  try {
    switch (path) {
      case '/narrate':
        return (await core.narrate(env, body as Parameters<typeof core.narrate>[1])) as T;
      case '/identify':
        return (await core.identify(env, body as Parameters<typeof core.identify>[1])) as T;
      case '/context':
        return (await core.cityContext(env, body as Parameters<typeof core.cityContext>[1])) as T;
      default:
        throw new ApiError(404, 'Not found');
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const status = (e as { status?: number }).status ?? 500;
    throw new ApiError(status, e instanceof Error ? e.message : 'Error');
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiPost<T>(path: string, body: unknown, timeoutMs = 30000): Promise<T> {
  const { url, code, key } = getApi();
  if (!url && key) return direct<T>(path, body);
  if (!url) throw new ApiError(0, 'No server configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Access-Code': code } : {}) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Server error ${res.status}`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiHealth(): Promise<{ ok: boolean; accessCode?: boolean }> {
  const { url, key } = getApi();
  if (!url && key) return { ok: key.startsWith('sk-ant-') };
  if (!url) return { ok: false };
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : { ok: false };
  } catch {
    return { ok: false };
  }
}
