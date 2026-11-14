# Security

This page explains how Smart Travel is built, what it protects against, and what it
deliberately does not. Everything here can be checked against the code in this repository.

## Architecture in one paragraph

Smart Travel is a **static single-page app** (React + TypeScript, built with Vite) hosted on
**GitHub Pages** at `https://eduvilla31.github.io/Smart-Travel/`. GitHub serves it over HTTPS;
`github.io` is on browsers' HSTS preload list, so it can't be loaded over plain HTTP. There is
**no backend, no database, no accounts, no cookies, no analytics and no ads**. The browser
talks directly to a fixed set of free public services. An optional Cloudflare Worker
(`worker/`) exists for the Claude features, but it is **not deployed** unless the owner sets it up.

## Data flow

| Service | Receives | Purpose |
|---|---|---|
| `tile.openstreetmap.org` | Map tiles for the area on screen | Map |
| `nominatim.openstreetmap.org` | A city search typed by the user, or a position rounded to ~1 km for "which city am I in" | City search |
| `overpass-api.de`, `overpass.kumi.systems` | The walk's start point and a radius | Nearby places |
| `routing.openstreetmap.de` | The start, the stops and the end of a route | Walking paths |
| `api.open-meteo.com` | The city centre (not the user's position) | Weather |
| `*.wikipedia.org`, `www.wikidata.org` | Names of places | Facts and narration |
| `api.anthropic.com` | Place names; for photo ID: the photo, position and compass heading | **Only** if the user pastes their own API key (optional) |
| `*.workers.dev` (the owner's Worker) | Same as above | **Only** if the owner deploys the Worker (optional) |

No request carries an identity. Each of these services sees the visitor's IP address, as any website does.
Preferences, saved tours and caches live in the browser's `localStorage`, and nothing is synced anywhere.

## Browser-side protections

**Content-Security-Policy.** The production build injects a CSP `<meta>` tag
(see `securityHeaders()` in `vite.config.ts`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://tile.openstreetmap.org;
connect-src 'self' https://*.wikipedia.org https://www.wikidata.org https://nominatim.openstreetmap.org
  https://overpass-api.de https://overpass.kumi.systems https://routing.openstreetmap.de
  https://api.open-meteo.com https://api.anthropic.com https://*.workers.dev;
font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self';
object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
```

`'wasm-unsafe-eval'` lets the optional on-phone voice (below) run as WebAssembly; it does not
allow `eval` of JavaScript, and the WebAssembly comes from the app's own origin. `blob:` media is
the generated audio.

The built `index.html` contains no inline scripts, and only bundled code runs: there are no
CDN scripts (Leaflet is bundled) and no `eval`. This was tested in Chromium against the
production build: an injected inline script, a `<script src>` to an outside host, a `fetch()` to
an outside host and a tracking pixel were all blocked. All app flows still work under the policy.

**XSS surface.**
- **Rendering:** React escapes all text. There is no `dangerouslySetInnerHTML` and no `innerHTML`
  with external data. The only raw HTML is Leaflet `divIcon` markers, built from internal values:
  stop numbers, a check mark and CSS class names.
- **Links:** links that come from outside (news sources, photo answers, narration sources) pass
  through `safeUrl()` (`src/lib/safe.ts`), which only allows `https:` URLs. `javascript:`,
  `data:` and `http:` are dropped. All external links use `rel="noopener noreferrer"`.

**Settings input.**
- **Server address:** only accepts `https://*.workers.dev`, or the address built into the app
  (`isAllowedServer()`), matching the CSP.
- **API key:** only accepts strings shaped like an Anthropic key (`sk-ant-…`). **Remove key**
  deletes it.

**Service worker** (`public/sw.js`): it caches same-origin GET requests and OpenStreetMap tiles
(CORS responses only, capped at 400 tiles). API responses are never cached by the service worker.

**Referrer policy:** `strict-origin-when-cross-origin`, so third parties see at most the origin.

## Natural AI voice (optional, on the phone)

When switched on, an open-source text-to-speech model (Kokoro 82M, Apache-2.0) runs in the
browser as WebAssembly. The model (pinned revision), its voices and the ONNX runtime are fetched
**at build time** and served from the app's own origin (`/models/`, `/ort/`). At runtime nothing is
requested from Hugging Face or any CDN, and the narration text never leaves the phone. The download
is about 90 MB once, then it comes from the browser's cache.

## Secrets

- **The repository and the built bundle contain no secrets.** CI secrets, such as Cloudflare
  credentials for the optional Worker, live in GitHub Actions Secrets and are only used by the
  deploy workflow.
- **Optional own-key mode:** if a user pastes an Anthropic API key, it is stored in that
  browser's `localStorage` and sent only to `api.anthropic.com`, which the CSP enforces. See
  *Known limitations* for what that implies.
- **For sharing with others, the intended setup is the Worker:** the key stays server-side, and
  friends only get an access code.

## Optional server (`worker/`)

- **Locked by default:** it refuses every request unless an `ACCESS_CODE` secret is set (or the
  owner explicitly sets `OPEN_ACCESS="true"`). The code is compared in constant time.
- **Rate limits:** per IP, per Worker instance: 60 narrations, 20 photos and 10 news checks per 10 minutes.
- **Input checks:** types, coordinates, image size (about 2 MB) and media type are validated,
  request bodies over 4 MB are rejected, and place names are stripped of `<`, `>` and `"` before
  they reach a prompt.
- **CORS:** only the configured origins (`ALLOWED_ORIGINS`) can call it from a browser.
- **Model output is treated as data.** It is shown as escaped text, the model has no tools that
  act on anything (only web search and a reporting function), and returned place IDs are checked
  against the IDs the client sent.
- **City news can't invent sources:** a note is kept only if its URL is one the web search
  actually returned.

## Supply chain and CI

- **Dependencies:** `npm audit` reports 0 known vulnerabilities for the app and the Worker,
  including dev and build tools. CI installs with `npm ci` from the committed lockfiles.
- **Updates:** Dependabot (`.github/dependabot.yml`) checks npm (app and Worker) and GitHub
  Actions weekly.
- **Workflow permissions:** least privilege. The Pages deploy has `contents: read`, `pages: write`
  and `id-token: write` (it deploys through OIDC, with no long-lived token). The Worker workflow
  has `contents: read`.
- **Tests:** CI runs the test suite before every deploy. Only commits on `main` are published,
  and only collaborators with write access, currently just the owner, can push to it.

## Known limitations (honest list)

- **Shared origin for own-key mode.** Every project published at `eduvilla31.github.io` shares
  one origin, and therefore one `localStorage`. A key pasted in own-key mode could be read by
  another project page on that origin, so only publish projects you trust there, or use the
  Worker. A custom domain would remove this.
- **CSP is delivered by `<meta>`.** GitHub Pages doesn't allow custom response headers, so
  `frame-ancestors`, which can't be set by `<meta>`, is not enforced. The page could be framed by
  another site. The app has no destructive actions or sessions, so the clickjacking impact is low.
- **`style-src 'unsafe-inline'`** is required by Leaflet's tile positioning. Style injection is
  far less powerful than script injection, which is blocked.
- **`connect-src https://*.workers.dev`** allows any Workers subdomain, so the owner can set a
  server without rebuilding. Abusing it would first require running script in the page, which
  the CSP blocks.
- **The Worker's rate limit is per instance, not global.** It slows abuse; it is not a hard
  quota. The real cap is the spend limit set in the Anthropic console.
- **GitHub Actions are pinned to major versions** (`@v4`), not commit SHAs. Dependabot keeps
  them current.
- **Third-party content.** Facts come from Wikipedia and city news from web search: as accurate
  as their sources, not more.
- **Physical safety.** It's a walking app: look at the street, not the screen.

## Verify it yourself

```bash
git clone https://github.com/eduvilla31/Smart-Travel && cd Smart-Travel
npm ci && npm test && npm audit && npm run build
grep -o 'Content-Security-Policy[^>]*' dist/index.html
cd worker && npm ci && npm test && npm audit
```

In the browser, open the live app, then DevTools → Network: every request goes to one of the
hosts in the table above.

## Reporting a problem

Please use GitHub's **private vulnerability reporting** (repository → *Security* tab →
*Report a vulnerability*) rather than a public issue.
