# InstantAboard — map service bounds (no white void + HK+buffer fly/pin)

Branch: `fix/map-service-bounds`  
Base: latest `main` (ok to rebase after `feat/maplibre-stop-dots` if that lands first — do not edit GL dots code unless conflict).

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep / write `CURSOR_PROMPT_map_service_bounds.md` in repo root — do not delete or gitignore.
5. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright — no full MapLibre rewrite; never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys; never Leaflet `flyTo` / `flyToBounds`. Do **not** rebake / change Planetiler CI unless a constant must match (prefer app-only). Do not touch SW / pmtiles BlobSource / hkBasemapPolicy download rules.

## Problem (confirmed)

Bake + `HK_BOUNDS` = `[113.48, 22.05, 114.55, 22.78]` — pack is fine. White “island” appears because **`minZoom={9}` lets the viewport be wider than the pack**, so tiles float in empty space. Users can also aim locate / set-location near the **outer PRD edge** (feels “outside HK”). Standalone `RouteMap` lacks `maxBounds` / `minZoom`.

## Design (two rectangles)

| Name | Role | Value |
|------|------|--------|
| **Pack / pan lock** (`HK_BOUNDS`) | Offline tiles + `MapContainer.maxBounds` | Keep current `[113.48, 22.05, 114.55, 22.78]` |
| **Service / fly-pin** (`HK_SERVICE_BOUNDS`) | Clamp locate, pin, fly targets, “set my location” | HK SAR bbox **+ ~12 km buffer** (sea + islands). Use approx: west/south/east/north **`[113.75, 22.12, 114.50, 22.60]`** (tune ±0.02 if needed; must stay **strictly inside** `HK_BOUNDS`) |

Do **not** shrink the bake for this PR. Outer pack stays so inner HK+buffer never shows white at street/city zoom.

## Required fixes

### A. Fill zoom (kill white void)

1. HomeMap (+ RouteMap): replace hard `minZoom={9}` with a floor that **fills** the pack in the current map size — e.g. on `load` / `resize` / `invalidateSize`, set `minZoom = Math.max(10, Math.min(12, map.getBoundsZoom(L.latLngBounds(...HK_BOUNDS...), false) - 0.2))` or simpler production default: **`minZoom={11}`** on both maps if dynamic is messy — prefer dynamic if ≤30 lines.
2. Keep `maxBounds={HK_BOUNDS}` + `maxBoundsViscosity={1}` on **HomeMap and RouteMap**.

### B. Service clamp (fly / locate / pin)

1. Add `HK_SERVICE_BOUNDS` + `clampToServiceBounds(lat,lng) → LatLng` in `hkBasemapManifest.ts` (or small `mapBounds.ts`).
2. Apply clamp to: `flyVisible` / `fitVisibleBounds` **target** latlng; locate / taxiFocus / route stop focus; set-location / pin sample when writing origin.
3. GPS outside service but inside pack → clamp fly to nearest point on service rect (silent this PR).
4. Keep fly smooth: clamp **end pose** before rAF; optional viscosity 0 only while automated busy.

### C. RouteMap parity

Same `maxBounds`, viscosity, minZoom policy as HomeMap.

## Bans

- No rebake / no changing Release pack bounds in this PR.
- No `flyTo`. No MapLibre dots work (other branch). No widening pan lock past bake.

## Done when

1. Zoomed out to min: pack **fills** the pane — no white frame.
2. Pan hard-stops at pack edges.
3. Locate / set-location / fly end inside `HK_SERVICE_BOUNDS`.
4. RouteMap same lock as HomeMap.
5. Prompt file in repo.

## Verify (Adrian)

Desktop wide → zoom out fully → no white border. Pan to edge → stop. Locate from a far pin → settles in HK+buffer. Open route map → same.
