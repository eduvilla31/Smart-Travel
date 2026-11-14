/**
 * Only open links that are plain https web addresses. Anything else (javascript:,
 * data:, http:) coming from a news source or an API answer is dropped.
 */
export function safeUrl(u: string | undefined | null): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Servers the app may send data to. Must match the Content-Security-Policy in vite.config.ts. */
export function isAllowedServer(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    if (url.protocol !== 'https:') return false;
    const built = (import.meta.env?.VITE_API_URL as string | undefined) ?? '';
    return url.hostname.endsWith('.workers.dev') || (!!built && new URL(built).origin === url.origin);
  } catch {
    return false;
  }
}
