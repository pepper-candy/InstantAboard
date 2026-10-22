# InstantAboard — glRouteLine is the master “stick to map” method (all route overlays → MapLibre)

Branch: `fix/gl-route-overlays`  
Base: current tree with working `glRouteLine.ts` / `GlRouteLine` (pinch/zoom, **no fade**). Adrian handles npm/git.

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests. No npm/git. Edit files only.
3. Keep / write `CURSOR_PROMPT_gl_route_overlays.md` in repo root.
4. Locked stack. Never `flyTo` / `flyToBounds`. Keep rAF `flyVisible` / `fitVisibleBounds`. **Keep `zoomAnimation={true}`**. No SW / BlobSource / pack policy changes.
5. **Do not** reintroduce MapLibre radar/breathing ripple UI (rejected).
6. **Do not** implement obsolete hacks: quantizeZoom, `zoomAnimation={false}`, Leaflet CSS fade for overlays, stops-only GL, `wip/maplibre-stop-dots` radar.

## Mandate (Adrian)

> Route line looks soooo nice. **All things on Leaflet should follow the route line** — route line is the **master** stick-to-map method.

## Master pattern (`src/lib/glRouteLine.ts`)

- Stable source + layer id constants
- `desiredByMap` WeakMap on the Leaflet map
- `ensure*` / `set*` / `clear*` / `ensure*ForMap`
- Re-apply on style swap via `registerIaGlStyleEnsure`
- `getIaMaplibreMap(map)` — never a second MapLibre instance
- Layers **above** `IA_ROUTE_LAYER` (ordered via `glRouteOrder.ts`)

## What landed (this PR)

### New modules

| File | Role |
|------|------|
| `src/lib/glRouteOrder.ts` | Overlay layer id order + `addIaRouteOverlayLayer` / `firstIaRouteOverlayLayerId` |
| `src/lib/glRouteStops.ts` | Stop dots + focus circle layers |
| `src/lib/glRouteMarkers.ts` | Live vehicles, sim vehicles, chevrons, flags, estimates (`addImage` + symbol/circle) |
| `src/lib/glRouteLine.ts` | Unchanged behavior; inserts **under** overlays after style swap |

### RouteLayer (`RouteMap.tsx`)

- **GL visuals:** line, stop dots, focus, live buses, sim buses, chevrons, 🚩 flags, estimate dots
- **Removed:** `ExactMarker` / `pinExact` / visible `CircleMarker` / DivIcon overlays
- **Kept Leaflet:** invisible hit `CircleMarker` r=16 for stop taps; FitRoute / FlyTo camera (`flyVisible` / `fitVisibleBounds`); `zoomAnimation={true}`

### Layer id order (bottom → top)

1. `ia-route-line-layer` (`IA_ROUTE_LAYER`)
2. `ia-route-stops-layer`
3. `ia-route-chevrons-layer`
4. `ia-route-vehicles-layer` (live GPS/ETA)
5. `ia-route-sim-vehicles-layer`
6. `ia-route-flags-layer`
7. `ia-route-focus-layer`
8. `ia-route-estimates-layer`

### What stayed Leaflet

- Invisible stop hit targets (`CircleMarker`, `fillOpacity: 0`)
- Map camera only (FitRoute / FlyTo → rAF helpers — **no** `flyTo`)

## HomeMap catalog (landed — fade fix)

Cause of catalog zoom fade: Leaflet `markerZoomAnimation={false}` **hides** DivIcon markers for the whole CSS zoom, then pops them back (looks like fade in/out). Pane `opacity: 1 !important` cannot fix that.

Fix: same stick-to-map method as `glRouteLine`:

- [x] `src/lib/glHomePlaces.ts` — stop circles, logo symbols (`addImage` from SVG), cluster badges
- [x] `GlHomePlaces` in `HomeMap.tsx`; catalog Leaflet Markers removed
- [x] Invisible Leaflet `CircleMarker` hits for place/cluster taps
- [x] GPS blue dot + pulse via `glUserPin.ts` (MapLibre circles + rAF, matches CSS 2.4s / dual rings) — catalog/route stick-to-map; **not** stop radar UI
- [x] `registerIaGlStyleEnsure`; catalog clears while a route overlay is open; user pin stays everywhere

Keep `zoomAnimation={true}` / `markerZoomAnimation={false}` (hits invisible; GPS is GL).

## Done when (RouteLayer)

1. Manual pinch/zoom + automated fly: **line + stops + buses + chevrons + flags** locked with basemap — **no fade**, **no shake vs line**.
2. Stop tap / list focus / sim still work.
3. No visible Leaflet CircleMarker / DivIcon on RouteLayer for those roles (hits OK).
4. No `flyTo`. No radar. No `zoomAnimation={false}`.

## Verify (Adrian)

290A: pan and zoom — line, stop dots, and bus icons move as one piece with the map. Tap stop: focus updates. Sim buses (if on) don’t jitter off the line.
