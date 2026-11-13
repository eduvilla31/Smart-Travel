# Smart Travel

A self-guided audio walking-tour web app. You pick how long you want to walk and what you care about, and it suggests routes. It narrates each stop in your headphones when you get close. Test city: **Basel**. English and Spanish.

It's a mobile web app (PWA): no accounts, no app store. You open a link and add it to your home screen.

## What works (milestones 1–8)

| # | Milestone | Status |
|---|-----------|--------|
| 1 | PWA + map on your live position | ✅ Installable, Leaflet + OpenStreetMap, live GPS dot |
| 2 | Places | ✅ Live from OpenStreetMap (Overpass), ranked by interest match + Wikidata notability. Merged with 33 curated Basel places, which are also the offline fallback |
| 3 | Route builder | ✅ Duration *or* distance, 7 interests, start (GPS or preset), end (loop / one-way / SBB), pace, avoid stairs. Your route + up to 3 themed alternatives, each with distance, time, stops, map and reasons |
| 4 | Tour mode | ✅ Narration once per stop within 25 m. Pause, resume, replay, skip, "Tell me more". Spoken turn-by-turn directions, screen kept awake, dimmed walking screen |
| 5 | Weather | ✅ Open-Meteo forecast for your walking window. Rain → a shorter, indoor-heavy **Rainy-day route** that ends under cover and says why. Rain nudges during the walk |
| 6 | Photo identify | ✅ 📷 on the home screen and during a tour. Photo + GPS + compass + the 10 nearest places go to Claude, which names the place only when the image and location agree. Otherwise it offers the two most likely candidates. Short answer read aloud, then "Want more information?" |
| 7 | City context | ✅ "Today in Basel": strikes, demonstrations, closures, transport, markets and events, found by Claude with web search. Every note links its source. Notes without a source, or with a link the search didn't return, are dropped. Blocked stops are routed around, with the reason shown |
| 8 | Polish | ✅ Saved tours with "Walk again", EN/ES language switch, resume a tour after a reload or signal loss, offline banner, cached narration + map tiles |
| + | Simulate walk | ✅ Walks a virtual you along the route (1×–40×) to test from anywhere |

**Narration** comes from Claude when the server is set up, written only from the stop's Wikipedia article. Without the server, it is the article's own text trimmed for speech, and if Wikipedia is unreachable, the hand-written notes in `src/data/basel-seed.json`. Every stop links its source.

**Without the server**, the app still works: routes, map, weather, Wikipedia narration, and a location-only photo guess. Claude narration, real photo recognition and city news need the server below.

## Try it on your phone (GitHub Pages)

You only need to do this once:

1. **Merge this branch into `main`.** On GitHub, open a pull request from `claude/sleepy-dijkstra-6cdr6r` into `main` and merge it.
2. In the repo, go to **Settings → Pages**. Under *Build and deployment → Source*, choose **GitHub Actions**.
3. Go to the **Actions** tab. Wait for the *Deploy to GitHub Pages* run to finish (about 1 minute). If nothing is running, open the workflow and click **Run workflow**.
4. Your app is live at **https://eduvilla31.github.io/Smart-Travel/**
   (the exact link is shown in the finished run and under Settings → Pages).

> **Free GitHub plans:** Pages only works on **public** repositories. If the repo is private, either make it public or use a paid plan.
>
> **Deploying straight from the `claude/...` branch:** the workflow also runs on that branch, but GitHub's `github-pages` environment only accepts `main` by default. To allow it, go to Settings → Environments → github-pages → *Deployment branches* and add `claude/*`. Otherwise just merge into `main`.

After that, every push to `main` redeploys automatically.

### Add it to the iPhone home screen

1. Open the link in **Safari** (it must be Safari on iPhone).
2. Tap **Share** (the square with the arrow), then **Add to Home Screen**, then **Add**.
3. Open it from the new *Smart Travel* icon. It runs full-screen like an app.
4. Allow **location** when asked. If you tapped "Don't allow": Settings → Privacy & Security → Location Services → Safari Websites → *While Using*.

On Android, Chrome offers **Install app** from the ⋮ menu.

### Test without being in Basel

1. Pick a start point (e.g. *Marktplatz*) and tap **Suggest routes**.
2. Pick a route and tap **Start tour**. This tap also unlocks audio on iPhone, so keep the phone's silent switch off and the volume up.
3. Turn on **Simulate walk** and choose a speed (try 15×). The purple dot walks the route, pauses while each stop is narrated, then continues.

## Claude features: three ways to run them

The Claude features are Claude-written narration, real photo recognition, and "Today in Basel" news. They need an Anthropic API key (console.anthropic.com → API keys, pay as you go). Pick one:

| Option | Setup | Who gets Claude features | Key safety |
|---|---|---|---|
| **1. None** | Nothing | Nobody. The app uses Wikipedia narration, a location-only photo guess and no news | – |
| **2. Your own key on your phone** (recommended to start) | Paste the key in **More options → Smart Travel server → Your Anthropic API key** | Only phones where a key is pasted | The key is stored only on that phone and sent only to Anthropic. It is never in the code or on GitHub. Don't paste it on phones you don't trust |
| **3. Cloudflare server** | One-time setup below | Everyone with the link (plus the access code) | The key stays on the server and friends never see it |

Options 2 and 3 run the same code (`worker/src`), so the results are identical. Rough cost on Claude Opus 5.5: a few cents per stop narration (cached afterwards), about a cent or two per photo, and a few cents for each daily news check. A full walk is usually well under US$1. Set a monthly spend limit in the Anthropic console to be safe.

### Option 3: Smart Travel server (Cloudflare)

The Claude API key must never be in the app, because anyone could read it there. It lives in a small free **Cloudflare Worker** (`worker/`), which the app calls. You need an Anthropic API key (console.anthropic.com) and a free Cloudflare account.

**Option A: from GitHub (no terminal).**

1. In Cloudflare, go to *My Profile → API Tokens → Create Token* and use the **Edit Cloudflare Workers** template. Copy the token. Your *Account ID* is on the Workers & Pages overview page.
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions → Secrets** and add:
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   - `ANTHROPIC_API_KEY`
   - `ACCESS_CODE`: any word you share with friends. Recommended, so strangers who find the URL can't spend your credits.
3. Go to **Actions → Deploy Smart Travel server → Run workflow**. The log ends with the worker URL, e.g. `https://smart-travel-api.<you>.workers.dev`.
4. Under **Settings → Secrets and variables → Actions → Variables**, add `API_URL` = that URL. Then re-run *Deploy to GitHub Pages*, so the app is built with it.
5. On the phone, open **More options → Smart Travel server**, type the access code, and check it says ✅ Connected.

**Option B: from a terminal.**

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_CODE      # optional but recommended
npx wrangler deploy
```

Then paste the printed URL into the app (**More options → Smart Travel server**) or set it as the `API_URL` variable as in step 4.

If your Pages address isn't `https://eduvilla31.github.io`, change `ALLOWED_ORIGINS` in `worker/wrangler.toml`.

**Model and cost.** The worker uses `claude-opus-5-5`. If a request is declined, Anthropic's automatic fallback retries it on another model. Narration is cached for 30 days per stop and language, and city news for 3 hours, so a typical walk makes a handful of calls: about 12 narrations the first time, 1 news check, and 1 per photo.

## Known limits

- **Screen lock:** web apps lose GPS and audio when the phone locks. The app keeps the screen on during a tour, and the 🌙 button gives a dark walking screen. A native app would fix this later.
- **GPS drift:** 10–30 m in narrow old-town streets. Each stop triggers only once. The radius grows a little when GPS accuracy is poor.
- **Voices:** browser voices vary by phone. iPhone has good English and Spanish voices built in. You can download better ones under Settings → Accessibility → Spoken Content → Voices.
- **Free services:** Overpass, Wikipedia and the FOSSGIS walking router are free and rate-limited. The app caches places for a day and narration for a week. If the walking router is down, the route is drawn as straight lines with estimated distances, and the route card says so.
- **Walking router:** the app uses the keyless FOSSGIS OSRM foot router. OpenRouteService (in the spec) could move behind the worker later if FOSSGIS isn't good enough.
- **Compass:** iPhone asks for motion & orientation permission the first time you tap 📷 *Take a photo*. Without it, photo answers lean on GPS only.

## Develop locally

```bash
npm install
npm run dev        # http://localhost:5173 (also printed with your LAN address)
npm test           # planner, weather, narration, context and photo-guess tests
cd worker && npm test   # server tests (Claude API stubbed)
npm run build      # production build in dist/
```

To test on your phone over Wi-Fi with `npm run dev`, open the LAN address it prints. Note that phones only allow GPS on **https** pages (or localhost), so GitHub Pages is the easiest way to test location.

## Project layout

```
src/
  App.tsx                 screens + app state
  i18n.ts                 English / Spanish strings
  data/basel-seed.json    33 curated Basel places (EN/ES), generated by scripts/build-seed.py
  lib/places.ts           OpenStreetMap (Overpass) + Wikidata, merged with the seed
  lib/planner.ts          stop selection, loop ordering (2-opt), variants, weather rules
  lib/routing.ts          walking paths (FOSSGIS OSRM foot router)
  lib/narration.ts        Wikipedia extracts → short/long spoken text
  lib/weather.ts          Open-Meteo forecast analysis
  lib/speech.ts           Web Speech API narration queue
  lib/api.ts              talks to the Smart Travel server
  lib/context.ts          "Today in Basel" notes
  components/PhotoIdentify.tsx  camera + compass + candidates → identify
  screens/                Home, RoutesScreen, Tour, Summary
public/                   manifest, icons, service worker
worker/                   Cloudflare Worker: /narrate, /identify, /context (holds the Claude key)
```
