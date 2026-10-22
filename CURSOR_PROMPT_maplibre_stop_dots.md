# InstantAboard — MapLibre home + stop dots (production camera sync)

Branch: `feat/maplibre-stop-dots`  
Base: latest `main` (do **not** build on `fix/pmtiles-blob-slice` — keep offline work separate).

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep / write `CURSOR_PROMPT_maplibre_stop_dots.md` in the repo root (this file) — do not delete or gitignore it.
5. Dense literal diffs. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright — **no full MapLibre rewrite**, never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys. **Never** Leaflet `flyTo` / `flyToBounds`. Do not hide markers to “fix” shake. Do not change HK offline pack / SW / `hkBasemapPolicy` / pmtiles BlobSource.

## Why (production)

Locate / stop / route flies use rAF `setView({ animate: false })`. Leaflet **DivIcons** re-compose on integer CSS pixels while MapLibre draws subpixel → L/R shimmer. Finger pinch looks fine; automated fly does not. Pins that live **inside** the GL map share the basemap camera and stay locked.

## Scope (this PR — solid, not half)

### Move into MapLibre GL (must)

1. **User location** pin (today’s blue `USER_ICON` DivIcon on HomeMap).
2. **Bus / minibus stop dots** and **clusters** (colored circles + cluster count badge look — circle + text via symbol or two layers).
3. **Clicks** wired like today’s Markers: stop → `onSelect(place)`; cluster → `onSelectGroup` / open group.
4. **Selected** state: larger radius / stronger stroke when `selectedId` matches (feature prop).
5. Survive **Bright ↔ local PMTiles style swap** (re-ensure sources/layers after `setStyle`; idempotent).

### Keep as react-leaflet DivIcons / overlays (must not migrate this PR)

- MTR / tram / taxi / pier **logo** markers (HTML logos).
- Entire **RouteLayer** sim (bus SVG, estimate, chevrons, flags, polylines).
- Sheet / Board / ETA / offline download UI.

## Implementation requirements

1. **One GL map only** — reuse MapLibre-Leaflet from `BrightBasemap` (`layer.getMaplibreMap()`). Export a small helper e.g. `getIaMaplibreMap(map: L.Map): maplibregl.Map | null` (register ref when layer adds; clear on remove). Never `new maplibregl.Map(...)`.
2. New module(s), e.g. `src/lib/glPlaceDots.ts` + a React child used inside `HomeMap`’s `MapContainer` (needs `useMap` + props: places pins/clusters, user, selectedId, callbacks).
3. Sources (stable ids): `ia-user`, `ia-stops` (GeoJSON). Layers: circle (+ halo) for user; circle for stops; optional symbol for cluster count. Use `setData` on updates — do not recreate the map.
4. After every style load / mode swap in `BrightBasemap`, call an exported `ensureIaPlaceLayers(gl)` so layers return.
5. Hit-testing: `gl.on('click', …)` + `queryRenderedFeatures` on stop/cluster layer ids; set canvas cursor pointer on `mouseenter`/`mouseleave` of those layers. Stop propagation so map drag still works.
6. Remove Leaflet `<Marker>` **only** for user + bus-dot pins + clusters. Leave logo Markers.
7. Match current visual size ballpark (selected ~12px, normal ~10px dots; user readable at street zoom). Exact CSS ripple optional — solid blue + soft halo is production-OK.
8. When `route` overlay is shown on HomeMap, existing code already swaps pin set — GL dots must clear or hide for that mode the same way Leaflet pins do today.

## Explicit bans

- No `map.flyTo` / `flyToBounds`.
- No second basemap / MapTiler / OSM raster.
- No rewriting RouteLayer into GL.
- No “quantize zoom” or maxBounds viscosity hacks in this PR (separate if ever).
- No npm install / git commit / push from the agent.

## Done when

1. Home map: bus dots + user render from MapLibre; locate fly — those pins do **not** L/R shimmer.
2. Logo pins still DivIcon (may still shimmer — OK).
3. Tap stop / cluster behaves as before.
4. Online ↔ offline style swap does not permanently lose dots.
5. `CURSOR_PROMPT_maplibre_stop_dots.md` present in repo.

## Verify (Adrian)

Dense bus area → locate fly → dots glued to roads. Tap a dot and a cluster. Toggle offline pack if present — dots still there after style swap.
