# Smart Travel

A self-guided audio walking-tour web app. You pick how long you want to walk and what you care about, and it suggests routes. It narrates each stop in your headphones when you get close. Test city: **Basel**. English and Spanish.

It's a mobile web app (PWA): no accounts, no app store. You open a link and add it to your home screen.

## What works (milestones 1–5)

| # | Milestone | Status |
|---|-----------|--------|
| 1 | PWA + map on your live position | ✅ Installable, Leaflet + OpenStreetMap, live GPS dot |
| 2 | Places | ✅ Live from OpenStreetMap (Overpass), ranked by interest match + Wikidata notability. Merged with a built-in list of 33 curated Basel places, which also serves as an offline fallback |
| 3 | Route builder | ✅ Duration *or* distance, 7 interests, start point (GPS or preset), end (loop / one-way / SBB station), pace, avoid stairs. Gives your route plus up to 3 themed alternatives: Classic Old Town, Urban Art & Kleinbasel, Artists & Museums. Each shows distance, time, stops, map and reasons |
| 4 | Tour mode | ✅ Narration triggers once per stop within 25 m. Pause, resume, replay, skip, "Tell me more". Spoken turn-by-turn directions. Screen stays awake (Wake Lock), plus a dimmed walking screen |
| 5 | Weather | ✅ Open-Meteo forecast for your walking window. If rain is likely, the top suggestion is a shorter, indoor-heavy **Rainy-day route** that ends at a covered stop and says why. Rain nudges during the walk ("Rain in 20 minutes, the Kunstmuseum is 200 m ahead") |
| + | Simulate walk | ✅ Moves a virtual you along the route (1×–40×), so you can test narration from anywhere |
| + | English / Spanish | ✅ EN/ES switch for the whole interface and narration (Spanish Wikipedia + Spanish voice) |
| 6–8 | Photo ID, city context, polish | ⏳ Later. These need a small backend for the Claude API key |

The narration comes from **Wikipedia**, in your chosen language. The app takes the short (~80 words) and long (~300 words) versions straight from the article, so it doesn't invent facts. Every stop links to its source. If Wikipedia can't be reached, it falls back to hand-written notes in `src/data/basel-seed.json`.

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

## Known limits

- **Screen lock:** web apps lose GPS and audio when the phone locks. The app keeps the screen on during a tour, and the 🌙 button gives a dark walking screen. A native app would fix this later.
- **GPS drift:** 10–30 m in narrow old-town streets. Each stop triggers only once. The radius grows a little when GPS accuracy is poor.
- **Voices:** browser voices vary by phone. iPhone has good English and Spanish voices built in. You can download better ones under Settings → Accessibility → Spoken Content → Voices.
- **Free services:** Overpass, Wikipedia and the FOSSGIS walking router are free and rate-limited. The app caches places for a day and narration for a week. If the walking router is down, the route is drawn as straight lines with estimated distances, and the route card says so.
- **Walking router:** the spec suggests OpenRouteService, but that needs an API key, and keys must stay on a server. Until there's a backend, the app uses the keyless FOSSGIS OSRM foot router.

## Develop locally

```bash
npm install
npm run dev        # http://localhost:5173 (also printed with your LAN address)
npm test           # planner, weather and narration tests
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
  screens/                Home, RoutesScreen, Tour, Summary
public/                   manifest, icons, service worker
```
