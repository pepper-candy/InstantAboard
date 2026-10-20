# InstantAboard

Personal, mobile-first departure board for Hong Kong public transport. Pin any route and stop, then glance the next three ETAs — like USTransit, for the rest of the city.

Client-side Next.js app. Pins live in `localStorage`. Deploy on Vercel’s free tier. Default language is **繁中**, default theme is **dark**.

## Layout

Home is a live OSM map (top ~45%) with a bottom sheet for the board. On wide screens (≥840px) the sheet becomes a side column.

- **Map** — user location, nearby stops as mode-coloured icons, recenter
- **Sheet** — handle, sticky filter chips, then the active list (pins, MTR, taxi, ferry, tram, or a map peek)
- **Nav** — Board, Add, light/dark, EN / 繁中. Android back / gesture close peeks and details in order

## Map

- Blue user dot; nearby bus, minibus, MTR, tram, taxi, and ferry places as icons (clustered when zoomed out)
- Recenter flies to you and refreshes GPS
- Tap a stop for a **peek** (routes + live ETAs). MTR stations open the station checkup card
- Taxi (and ferry-on-ferry-filter) taps switch the list to that mode and highlight the stand instead of opening a peek
- From **All**, a taxi stand is one tap: jump to the taxi list and highlight that stand
- Route detail draws the line on the same map; tap a stop on the line to change the viewed stop

Radii (with a nearest fallback so the list is never empty):

| Mode | Nearby | Cap |
| --- | --- | --- |
| Bus / minibus | 1.2 km | — |
| MTR | 2 km | 5 (else 3 nearest) |
| Taxi | 1 km | 5 (else 1 nearest) |
| Tram | 1 km | 5 |
| Ferry | 1.2 km | — |

## Sheet

Drag the handle, or tap it to toggle **bottom ↔ top**. Height eases with a cubic deceleration (~0.4s for a full travel, shorter for small moves).

**Bottom (min)**

- Pin / bus lists: first card just above the nav
- MTR and taxi lists: cards **squeeze** to headers so the first row stays on screen
- MTR station peek, **one line**: min = max = the whole card (not adjustable; first card must stay visible)
- MTR station peek, **interchange**: min is the first line only

**Top (max)**

- Pin / MTR / taxi **lists**: map-tools ceiling (one click from the bottom goes all the way up, even if the list was squeezed)
- Station / place **peek** with nothing under the card: cap to the article plus the nav border (no empty sheet)
- Interchange checkup **enters at this max** so every line is visible; drag down for the first-line min
- Switching stations retargets height immediately (taller interchange → shorter single-line shrinks; the reverse grows)

Leaving a peek or route restores the default arrival height (~55%), regardless of chip.

Chips stick under the handle. An outline sits under that sticky row so list cards do not slide through.

## Pins (All)

- Operator-coloured route, destination, stop, next 3 ETAs; distance when on All
- Auto-stop (location icon): nearest stop on that route to you; also the default when adding
- Auto-refresh ~30s, pull-to-refresh, tap the ETA strip to refresh that card
- Drag the grip to reorder
- Swipe left → white bin overlay; hold **DELETE** to confirm (cancel fades the overlay). Delete only happens from that button
- Tap a card for route detail

First launch seeds a Tseung Kwan O / HKUST commute (editable):

- KMB **91M** Hang Hau → Diamond Hill (toward HKUST)
- KMB **91M** HKUST North → Po Lam (home)
- GMB **11M** Hang Hau PTI → HKUST
- Citybus **792M** HKUST → Tseung Kwan O Station

## Filters

Icon chips, labels in 繁中 / EN: All, 巴士, 小巴, 港鐵, 的士, and **叮叮 / 渡輪 only when those places exist nearby**. Filters apply to both map and list. Hold a chip for its name.

On an MTR station peek the mode chip is hidden; a **×** closes the checkup.

## MTR

- Nearby stations as expandable cards; interchange stations show every line
- Map peek is a locked expanded card (no chevron). Station name is centred
- Terminus: only the remaining passenger direction is listed (not “to this station”)
- Direction swap when both bounds still run
- First / last train (**ⓘ**) is opt-in — it does not open by itself
- Hours and ETAs load per station; switching stations updates the sheet to that card’s size

## Taxi, ferry, tram

- Taxi stands labelled urban / NT / Lantau (red / green / blue). Map tap ↔ list highlight in one click
- Ferry piers: scheduled or live Sun Ferry ETAs where available
- Tram: scheduled headways (no official next-tram ETA on data.gov.hk)

## Add

Search a route number, MTR line, or station. Pick a direction; Auto / nearest stop is preselected. Search also opens an MTR station checkup.

## Route detail

Stop list, live ETAs, OSM polyline, estimated vehicle from ETAs (`est.`). Real GPS for MTR Bus. Swap bound, jump to the closest stop, pin or unpin. MTR hours are available on the detail card too.

## System

- Dark / light and EN / 繁中 (stop names and chrome)
- PWA manifest + service worker
- Offline toast; ETAs retry when the connection returns
- Hardware back closes search → peek → detail before leaving home

## Dev (hidden)

Hold **EN** on the nav for ~5s to arm, then tap **Add** to enter. Map tools: pin a fake origin, show all places, optional traffic overlay. Hold EN again to leave.

## Data

All live feeds are keyless and fetched in the browser.

| Operator | Source |
| --- | --- |
| GMB | https://data.etagmb.gov.hk |
| KMB / LWB | https://data.etabus.gov.hk/v1/transport/kmb/ |
| Citybus | https://rt.data.gov.hk/v2/transport/citybus/ |
| MTR | https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php |
| Light Rail | https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule |
| NLB | https://rt.data.gov.hk/v2/transport/nlb/ |
| MTR Bus | `POST` https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule (`busLocation`) |
| Sun Ferry | https://www.sunferry.com.hk/eta/?route=NPHH |
| Other ferries | Scheduled times from the hkbus index (`freq`); pier list preprocessed from TD ferry GeoJSON (`public/data/ferry-piers.json`) |
| Tram | **No public next-tram ETA on data.gov.hk** (stops dataset only). Stops/routes preprocessed from TD `JSON_TRAM.json`. Headways use a scheduled frequency. An unofficial `hktramways.com/nextTram/geteat.php` exists but is not a government feed and returned empty XML when checked. |

Route and stop index: [routeFareList.min.json](https://data.hkbus.app/routeFareList.min.json) from [hkbus/hk-bus-crawling](https://github.com/hkbus/hk-bus-crawling), **GPL-2.0**. Used at runtime only; this app does not relicense that dataset.

TD [routes-and-fares GeoJSON](https://static.data.gov.hk/td/routes-fares-geojson/) has no browser CORS and is **Point-per-stop**, not route LineStrings. The map draws polylines through hkbus stop coordinates.

Taxi stands: Transport Department CSDI dataset, preprocessed at build into `public/data/taxi-stands.json`.

TD licensed-ferry timetable CSVs on data.gov.hk are per-route files without a single CORS-open bulk URL. Build-time preprocess therefore uses TD ferry GeoJSON for pier/destination lists, and live/scheduled departures come from Sun Ferry ETA plus hkbus `freq` (itself derived from TD timetables).

## Develop

```bash
npm install
npm run preprocess
npm run dev
```

```bash
npm run build
```

`preprocess` builds taxi stands, ferry piers, and tram packs. `prebuild` also simplifies route shapes.

## License

Application code is MIT. The hkbus route/stop index remains GPL-2.0.
