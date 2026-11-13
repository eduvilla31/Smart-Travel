import { load, save } from './storage';

/**
 * The Smart Travel server (Cloudflare Worker in /worker) holds the Claude API key.
 * Its URL comes from the build (VITE_API_URL) and can be changed in the app settings.
 */
export interface ApiConfig { url: string; code: string }

const BUILD_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function getApi(): ApiConfig {
  const saved = load<Partial<ApiConfig>>('api', {});
  return { url: (saved.url ?? BUILD_URL).trim().replace(/\/+$/, ''), code: saved.code ?? '' };
}

export function setApi(cfg: Partial<ApiConfig>) {
  save('api', { ...load<Partial<ApiConfig>>('api', {}), ...cfg });
}

export const hasApi = () => !!getApi().url;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiPost<T>(path: string, body: unknown, timeoutMs = 30000): Promise<T> {
  const { url, code } = getApi();
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
  const { url } = getApi();
  if (!url) return { ok: false };
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : { ok: false };
  } catch {
    return { ok: false };
  }
}
