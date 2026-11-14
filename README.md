# Smart Travel

A self-guided audio walking-tour web app. You pick how long you want to walk and what you care about, and it suggests routes. It narrates each stop in your headphones when you get close. Works in **any city**: Basel and Venice have hand-picked places, and everywhere else uses OpenStreetMap and Wikipedia. English and Spanish.

It's a mobile web app (PWA): no accounts, no app store. You open a link and add it to your home screen.

## What works (milestones 1–8)

| # | Milestone | Status |
|---|-----------|--------|
| 1 | PWA + map on your live position | ✅ Installable, Leaflet + OpenStreetMap, live GPS dot |
| 2 | Places | ✅ Live from OpenStreetMap (Overpass), ranked by interest match + Wikidata notability. Merged with curated places (33 in Basel, 39 in Venice), which are also the offline fallback |
| 3 | Route builder | ✅ Duration *or* distance, 7 interests, start (GPS or preset), end (loop / one-way / SBB), pace, avoid stairs. Your route + up to 3 themed alternatives, each with distance, time, stops, map and reasons |
| 4 | Tour mode | ✅ Narration once per stop within 25 m. Pause, resume, replay, skip, "Tell me more". Spoken turn-by-turn directions, screen kept awake, dimmed walking screen |
| 5 | Weather | ✅ Open-Meteo forecast for your walking window. Rain → a shorter, indoor-heavy **Rainy-day route** that ends under cover and says why. Rain nudges during the walk |
| 6 | Photo identify | ✅ 📷 on the home screen and during a tour. Photo + GPS + compass + the 10 nearest places go to Claude, which names the place only when the image and location agree. Otherwise it offers the two most likely candidates. Short answer read aloud, then "Want more information?" |
| 7 | City context | ✅ "Today in Basel": strikes, demonstrations, closures, transport, markets and events, found by Claude with web search. Every note links its source. Notes without a source, or with a link the search didn't return, are dropped. Blocked stops are routed around, with the reason shown |
| 8 | Polish | ✅ Saved tours with "Walk again", EN/ES language switch, resume a tour after a reload or signal loss, offline banner, cached narration + map tiles |
| + | Simulate walk | ✅ Walks a virtual you along the route (1×–40×) to test from anywhere |
| + | Any city | ✅ The app detects the city you are in ("📍 Where I am"), or you search for any city, area or place ("I'm in Kyoto" works). Basel and Venice have curated places; other cities use OpenStreetMap, with Wikipedia's nearby articles as a backup |
| + | Natural voice | ✅ Picks the most natural voice on the phone (Premium/Enhanced on iPhone, Google voices on Android), with a voice chooser and Test button under **More options** |

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

### Test without being there

1. Pick the city at the top (Basel or Venice), then a start point (e.g. *Marktplatz* or *St Mark's Square*), and tap **Suggest routes**.
2. Pick a route and tap **Start tour**. This tap also unlocks audio on iPhone, so keep the phone's silent switch off and the volume up.
3. Turn on **Simulate walk** and choose a speed (try 15×). The purple dot walks the route, pauses while each stop is narrated, then continues.

## Claude features: three ways to run them

The Claude features are Claude-written narration, real photo recognition, and "Today in Basel" news. They need an Anthropic API key (console.anthropic.com → API keys, pay as you go). Pick one:

| Option | Setup | Who gets Claude features | Key safety |
|---|---|---|---|
| **1. None** | Nothing | Nobody. The app uses Wikipedia narration, a location-only photo guess and no news | – |
| **2. Your own key on your phone** (recommended to start) | Paste the key in **More options → Smart Travel server → Your Anthropic API key** | Only phones where a key is pasted | The key is stored only on that phone and sent only to Anthropic. It is never in the code or on GitHub. Don't paste it on phones you don't trust |
| **3. Cloudflare server** | One-time setup below | Everyone with the link (plus the access code) | The key stays on the server and friends never see it |

Options 2 and 3 run the same code (`worker/src`), so the results are identical.

**Model and cost.** The default model is **Claude Haiku** (`claude-haiku-5-5`), the cheapest. Rough cost, estimated from published prices and not measured: well under a cent per stop narration (cached afterwards) and per photo, and a few cents per daily news check (web searches are billed separately). A full walk should cost a few cents. You can switch to **Claude Opus** (`claude-opus-5-5`) for better writing at about 40 times the price: in the app's settings in own-key mode, or with `MODEL = "claude-opus-5-5"` in `worker/wrangler.toml` for the server. Set a monthly spend limit in the Anthropic console to be safe.

### Option 3: Smart Travel server (Cloudflare)

The Claude API key must never be in the app, because anyone could read it there. It lives in a small free **Cloudflare Worker** (`worker/`), which the app calls. You need an Anthropic API key (console.anthropic.com) and a free Cloudflare account.

**Option A: from GitHub (no terminal).**

1. In Cloudflare, go to *My Profile → API Tokens → Create Token* and use the **Edit Cloudflare Workers** template. Copy the token. Your *Account ID* is on the Workers & Pages overview page.
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions → Secrets** and add:
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   - `ANTHROPIC_API_KEY`
   - `ACCESS_CODE`: any word you share with friends. **Required**: without it the server refuses every request, so strangers who find the URL can't spend your credits.
3. Go to **Actions → Deploy Smart Travel server → Run workflow**. The log ends with the worker URL, e.g. `https://smart-travel-api.<you>.workers.dev`.
4. Under **Settings → Secrets and variables → Actions → Variables**, add `API_URL` = that URL. Then re-run *Deploy to GitHub Pages*, so the app is built with it.
5. On the phone, open **More options → Smart Travel server**, type the access code, and check it says ✅ Connected.

**Option B: from a terminal.**

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ACCESS_CODE      # required: the code friends type into the app
npx wrangler deploy
```

Then paste the printed URL into the app (**More options → Smart Travel server**) or set it as the `API_URL` variable as in step 4.

If your Pages address isn't `https://eduvilla31.github.io`, change `ALLOWED_ORIGINS` in `worker/wrangler.toml`.

## Safety, privacy and what was checked

For developers: the full security write-up, with the exact policy, the threat model and the known limitations, is in [SECURITY.md](SECURITY.md).

**What leaves your phone**

| Goes to | What | When |
|---|---|---|
| OpenStreetMap (map tiles, Overpass) | The map area you look at; your start point (to find nearby places) | Viewing the map, planning |
| FOSSGIS walking router | The start, stops and end of each route | Planning |
| Open-Meteo | The city centre (not your position) | On start, and every 10 min during a tour |
| Wikipedia / Wikidata | The names of the stops | Planning and narration |
| Anthropic (Claude), only with a key or server | Stop names; for photo ID, the photo, your position and compass direction; for city news, the city and date | Narration, photo, news |

There are no accounts, no analytics and no ads. Preferences, saved tours and caches stay in the browser's storage on your phone.

**Your Anthropic key (own-key mode)** is stored only in that browser's storage and sent only to Anthropic. It is never in the code or on GitHub. Two things to know: anyone holding the unlocked phone could read it in the settings, and every project site under the same `username.github.io` address shares that storage, so only paste a key if you trust the other sites you publish there.

**Locked-down page.** The published app carries a Content-Security-Policy: the browser runs only the app's own scripts and lets it talk only to the services in the table above (plus `api.anthropic.com` and `*.workers.dev` for the optional Claude features). Tested: an injected script, a request to an outside server and a tracking image are all blocked. Links from news or answers open only if they are plain `https` addresses. The Claude server setting accepts only `https://…workers.dev` addresses, and the key field only accepts keys that look like Anthropic keys; a **Remove key** button wipes it from the phone.

**The server** refuses to run without an access code (compared in constant time), limits how often each visitor can call it (60 narrations, 20 photos and 10 news checks per 10 minutes), checks and limits what it accepts, and only answers browsers from the origins in `ALLOWED_ORIGINS`.

**Keeping it safe over time.** Dependabot checks the app, the server and the GitHub Actions weekly for security fixes and opens a pull request when one is needed. The deploy workflows run with the minimum permissions.

**Your part (once, 5 minutes):**
- Turn on two-factor authentication for GitHub: **github.com/settings/security**.
- Keep **Keep my email addresses private** on: **github.com/settings/emails**.
- If you add a Claude key, set a monthly spend limit in the Anthropic console, and don't paste it on phones you don't trust.
- Note: every project you publish at `eduvilla31.github.io` shares that address with this app, so only publish projects you trust there.

**City news** is found by web search and summarised by Claude. Every note links its source, and notes whose link the search did not return are dropped. Treat it as a hint, not as official information: check the source before changing plans.

**While walking:** keep your eyes on the street, not the screen. The 🌙 walking screen is there for that. Narration is information, not navigation advice; in Venice, paths can be flooded (acqua alta) or closed without the app knowing.

**What was verified (November 2026)**

- 15 app tests and 10 server tests pass; `npm audit` reports 0 known vulnerabilities for the app, the server and their build tools.
- Against the live services: walking routes with turn-by-turn steps for Basel and Venice, map tiles, Open-Meteo, and English and Spanish Wikipedia narration.
- Coordinates and Wikipedia titles of the curated places were checked against Wikidata. Entries marked `"approx": true` in the seed files could not be checked that way (11 of 33 in Basel, 7 of 39 in Venice) and are placed from memory, so their 25–35 m trigger may be off.
- **Not verified:** the Overpass places query (both servers were unreachable from the test machine, so only the built-in list was exercised), real Claude calls (no API key was available; the Claude API was simulated), and real phones (iPhone speech, GPS and compass were tested only in a desktop browser emulating a phone).

## Getting a more natural voice

The app speaks with the voices built into the phone, and picks the best one automatically. The biggest improvement is free:

- **iPhone:** Settings → Accessibility → **Read & Speak** (called **Spoken Content** on older iOS) → **Voices** → English (and Spanish) → download a voice marked **Premium** or **Enhanced**. Then in the app: **More options → Narration voice → Test**, and pick it. Siri's own voices can't be used by websites.
- **Android:** Chrome uses Google's voices, which already sound fairly natural.

An even more human voice would need a paid text-to-speech service (and its own key), which could be added to the server later.

## Known limits

- **Screen lock:** web apps lose GPS and audio when the phone locks. The app keeps the screen on during a tour, and the 🌙 button gives a dark walking screen. A native app would fix this later.
- **GPS drift:** 10–30 m in narrow old-town streets, worse in Venice's alleys. Each stop triggers only once, within 25 m in Basel and 35 m in Venice. The radius grows a little when GPS accuracy is poor.
- **Searched cities:** places, stories and walking paths come from free public services, so quality depends on what OpenStreetMap and Wikipedia have for that area. Stories are in English when no Spanish article exists.
- **Venice and steps:** almost every bridge has steps. "Avoid stairs" leaves out the big stepped bridges as stops, but the walking path will still cross small bridges.
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
  data/venice-seed.json   39 curated Venice places (EN/ES), generated by scripts/build-venice-seed.py
  city.ts                 the current city (React context)
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

## Adding a city

1. Copy `scripts/build-venice-seed.py`, fill in the city block (centre, radius, timezone, country, detour factor, trigger radius, station) and 30–40 places with English and Spanish names and short texts. Take coordinates from Wikidata.
2. Run it to write `src/data/<city>-seed.json`, then add the file to the `CITIES` list in `src/lib/places.ts`.
3. `npm test` checks that every place is inside the city and has both languages.
