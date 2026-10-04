# InstantAboard

Personal, mobile-first departure board for Hong Kong public transport. Pin any route and stop, then glance the next three ETAs — like USTransit, for the rest of the city.

Client-side Next.js app. Pins live in `localStorage`. Deploy on Vercel’s free tier.

## Board

- Home: live OSM map (top ~45%) with a blue user dot and nearby stops as mode-coloured icons; My board is a draggable sheet underneath
- Tap a map icon for routes + ETAs and a one-tap pin; recenter button on the map
- Home cards: operator-coloured route number, destination, next 3 ETAs
- Auto stop (location icon): nearest stop on that route to the user; also the default when adding
- Auto-refresh about every 30 seconds, pull-to-refresh, tap an ETA strip to refresh that card
- Drag the grip to reorder; swipe left for a chunky bin; inline undo
- Icon-only filters: All (default), bus, minibus, MTR, ferry, tram, taxi — filters apply to map and list
- Add: search a route, pick direction, Auto / nearest stop preselected
- Route detail: stop list, ETAs, OSM map via Leaflet, estimated vehicle from ETAs (`est.`). Real GPS dot for MTR Bus
- Dark / light theme and EN / 繁中 stop names
- PWA manifest + service worker

First launch seeds a Tseung Kwan O / HKUST commute (editable):

- KMB **91M** Hang Hau → Diamond Hill (toward HKUST)
- KMB **91M** HKUST North → Po Lam (home)
- GMB **11M** Hang Hau PTI → HKUST
- Citybus **792M** HKUST → Tseung Kwan O Station

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

## License

Application code is MIT. The hkbus route/stop index remains GPL-2.0.
