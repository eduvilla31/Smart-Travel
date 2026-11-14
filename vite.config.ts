import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the published app: the browser refuses to run any
 * script that isn't ours, and refuses to send data to any service not listed here.
 * Keep in sync with isAllowedServer() in src/lib/safe.ts.
 */
function securityHeaders(apiUrl: string): Plugin {
  const api = (() => {
    try {
      return apiUrl ? new URL(apiUrl).origin : '';
    } catch {
      return '';
    }
  })();
  const connect = [
    "'self'",
    'https://*.wikipedia.org',
    'https://www.wikidata.org',
    'https://nominatim.openstreetmap.org',
    'https://overpass-api.de',
    'https://overpass.kumi.systems',
    'https://routing.openstreetmap.de',
    'https://api.open-meteo.com',
    'https://api.anthropic.com',
    'https://*.workers.dev',
    api,
  ].filter(Boolean);
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // Leaflet positions map tiles with inline styles
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    `connect-src ${connect.join(' ')}`,
    "font-src 'self'",
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  return {
    name: 'security-headers',
    apply: 'build', // the dev server needs its own live-reload connections
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="utf-8" />',
        `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="strict-origin-when-cross-origin" />`,
      );
    },
  };
}

// base './' keeps every asset path relative, so the same build works at
// https://<user>.github.io/<repo>/ and on a local preview server.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [react(), securityHeaders(env.VITE_API_URL ?? '')],
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  } as any;
});
