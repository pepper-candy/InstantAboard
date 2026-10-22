# InstantAboard — Agent 2: map service bounds (re-apply; never landed on main)

Branch: `fix/map-service-bounds`  
Base: latest `main` (after PR #31). **Re-apply from scratch** — `HK_SERVICE_BOUNDS` / fill-minZoom / RouteMap parity were never merged; MapLibre WIP revert left tip with pack `HK_BOUNDS` + `minZoom={9}` only. Do **not** pull from `wip/maplibre-stop-dots`.

## Standing rules (every agent)

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only — cloud agent may commit/push/PR only if that is how this run works; still no local npm.
4. Keep / write `CURSOR_PROMPT_map_service_bounds.md` in repo root — do not delete or gitignore.
5. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright — no full MapLibre rewrite; never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys; never Leaflet `flyTo` / `flyToBounds`. Do **not** rebake / change Planetiler CI. Do not touch SW / pmtiles BlobSource / hkBasemapPolicy / quantizeZoom (Agent 1). Prefer not editing GL dots.
6. **No Leaflet zoom fade:** never leave / introduce MapContainer `zoomAnimation={true}` or fade/hide overlay panes on zoom — overlays (route, stops, markers) must stay visible (Agent 3 owns the dedicated fix; other agents must not re-enable fade).

## Problem (confirmed on current main)

Bake + `HK_BOUNDS` = `[113.48, 22.05, 114.55, 22.78]` — pack fine. White “island” because **`minZoom={9}`** lets the viewport be wider than the pack. Locate / set-location can aim near the outer pack edge (feels outside HK). Standalone `RouteMap` may lack full `maxBounds` / minZoom parity.

## Design (two rectangles)

| Name | Role | Value |
|------|------|--------|
| **Pack / pan lock** (`HK_BOUNDS`) | Offline tiles + `MapContainer.maxBounds` | Keep `[113.48, 22.05, 114.55, 22.78]` |
| **Service / fly-pin** (`HK_SERVICE_BOUNDS`) | Clamp locate, pin, fly targets, set-my-location | HK SAR + ~12 km buffer: west/south/east/north **`[113.75, 22.12, 114.50, 22.60]`** (tune ±0.02; must stay **strictly inside** `HK_BOUNDS`) |

Do **not** shrink the bake. Outer pack stays so inner HK+buffer never shows white at street/city zoom.

## Required fixes

### A. Fill zoom (kill white void)

1. HomeMap (+ RouteMap): replace hard `minZoom={9}` with a floor that **fills** the pack — e.g. on `load` / `resize` / `invalidateSize`, set  
   `minZoom = Math.max(10, Math.min(12, map.getBoundsZoom(L.latLngBounds(...HK_BOUNDS...), false) - 0.2))`  
   or production default **`minZoom={11}`** if dynamic is messy — prefer dynamic if ≤30 lines.
2. Keep `maxBounds={HK_BOUNDS}` + `maxBoundsViscosity={1}` on **HomeMap and RouteMap**.

### B. Service clamp (fly / locate / pin)

1. Add `HK_SERVICE_BOUNDS` + `clampToServiceBounds(lat,lng) → LatLng` in `hkBasemapManifest.ts` (or small `mapBounds.ts`).
2. Apply clamp to:
   - `flyVisible` / `fitVisibleBounds` **target** latlng (and locate / taxiFocus / route stop focus if they bypass).
   - Dev / user set-location / pin when writing origin.
   - Recenter locate target.
3. GPS outside service but inside pack: clamp fly to nearest point on service rect (silent).
4. Clamp **end pose** before rAF; do not rubber-band mid-flight against maxBounds (optional: viscosity 0 while automated busy — only if needed for smooth edge flies).

### C. RouteMap parity

Same `maxBounds`, viscosity, minZoom policy as HomeMap.

## Bans

- No rebake / no changing Release pack bounds.
- No `flyTo`.
- No MapLibre dots / no quantizeZoom (other branch).
- No widening pan lock past bake.

## Done when

1. Zoomed out to min: pack **fills** the pane — no white frame.
2. Pan hard-stops at pack edges.
3. Locate / set-location / fly end inside `HK_SERVICE_BOUNDS`.
4. RouteMap same lock as HomeMap.
5. Prompt file in repo.

## Verify (Adrian)

Desktop wide → zoom out fully → no white border. Pan to edge → stop. Locate from far pin → settles in HK+buffer. Route map → same.
