# InstantAboard — develop map-tools: per-visible-station route lines (not all roads)

Branch: work on current tree (`main` or whatever Adrian has open).  
Adrian handles npm/git. **You only edit files.**

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests. No npm/git. Edit files only.
3. Keep / create this file in repo root as `CURSOR_PROMPT_dev_station_route_lines.md`.
4. Locked stack. Never `flyTo` / `flyToBounds`. Keep rAF camera helpers. No `zoomAnimation={false}`. No SW / BlobSource / pack policy changes.
5. MapLibre overlays follow `glRouteLine` / `desiredByMap` / `registerIaGlStyleEnsure` / `getIaMaplibreMap` pattern.

## What failed (do not keep)

The current develop toggle (`AllRoutesFx` + `loadAllRouteLines` + `/api/csdi-bus-routes` + `glAllRouteLines`) draws the **entire CSDI FB_ROUTE_LINE road network** (blue spaghetti everywhere). That is **wrong**.

Adrian wants: **only the full route polylines for stations/stops that are already on the HomeMap**, same quality as the **detail page** route line — not every road in HK.

## Mandate

Rewrite the develop-mode map-tools cycle so it shows **per-visible-place route geometries**, not the CSDI all-roads dump.

### Button (keep UX)

- Still **develop-mode only** on `.map-tools`.
- Cycle: **off → full opacity → 20% opacity → off**.
- Keep existing icon / `is-on` / `is-dim` / busy affordances unless a tiny tweak is needed.
- **Do not fetch or draw anything until first press** (lazy). Off tears down overlays and cancels in-flight loads.

### What to draw

1. Take the **places currently shown on HomeMap** (same set as catalog pins / `GlHomePlaces` / in-view places — the stations/stops Adrian can see, e.g. 3 MTR logos). Not every place in the whole dataset off-screen if HomeMap already culls; follow whatever HomeMap uses for visible pins.
2. For each place, for each entry in `place.routes[]`, resolve the **full route polyline the same way the detail page does**:
   - Reuse `shapeFileName` + `loadRouteLine` (see `src/hooks/useRouteLine.ts` + `src/lib/routeLine.ts` + `src/lib/shapeFile.ts`).
   - Same rules: ferry = straight segments / no OSRM; MTR / lightRail / tram = track shape only (`road: false`); bus may use shape file then OSRM.
   - Color via existing `routeColor(company, route)` (MTR_LINE etc.), not one flat blue.
3. You will need stop lat/lng sequences for `loadRouteLine`. **Reuse existing route/stop catalog APIs** the detail board already uses — do not invent a new geometry source and do **not** call `/api/csdi-bus-routes` for this feature.

### Dedup (required)

If multiple visible stations share the **same route shape**, **draw it once**:

- Stable key = `shapeFileName(...)` (or equivalent company+route+bound+serviceType+gtfs/nlb id).
- Second station that needs the same key **reuses** the existing layer/source — no second stack, no second fetch if cached.
- Hover (below) promotes that **shared** layer for any station that owns the key.

### Load / stack order

- **Load animation**: slowly add routes in a loop, **furthest from user location → closest** (so the network fills toward the user). Small delay between adds is fine; cancel cleanly on Off or unmount.
- **Default paint order**: add each new unique route **on top** of previous ones as it loads (furthest first underneath → closest ends on top).
- Anchor distance for a route = distance from **user / map origin spot** to the **visible place** that requested it (if several places share a key, use the **closest** of those places as the anchor for sort).

### Hover

- Hovering a **visible station/stop marker** (the catalog pin / hit target already on HomeMap) temporarily **promotes that place’s route line(s) above all other dev route layers** for the hover duration.
- On hover end, restore the proximity stack order.
- Do not navigate / open board on hover; click behavior unchanged.

### Opacity modes

- **Full**: line-opacity ~0.9–1 (match detail feel).
- **Dim**: ~0.2 for all visible for all-routes (shared).
- Hovered route(s) stay readable in dim mode (full or near-full while hovered).

### Architecture

- Prefer **one MapLibre source + one layer per unique shape key** (or one source with feature `id`/properties + `moveLayer` / feature-state for hover), under the same overlay stack rules as `glRouteOrder` / below user pin.
- Replace or gut `allRouteLines.ts` + `glAllRouteLines.ts` CSDI path so nothing still pulls the whole network for this button. If the API route becomes unused, leave a short TODO comment rather than a large delete fight — but HomeMap must not call it anymore.
- Keep `registerIaGlStyleEnsure` so Bright↔PMTiles `setStyle` re-applies desired overlays.
- No preload on map init; no background fetch while mode is `off`.

## Out of scope

- Changing production (non-dev) map behavior.
- Quantize / zoomAnimation / pack / worker blank-map work.
- Drawing every bus corridor in HK.

## Done when

1. Button off → no route overlays, no network load.
2. First press → only routes for **currently visible HomeMap places** appear, detail-page quality/colors, stacked furthest→closest.
3. Shared shape across stations → **one** draw.
4. Dim cycle works; Off clears.
5. Hover station → its route(s) temporarily on top; leave hover → back to proximity order.
6. Pan/zoom that changes visible places: either refresh membership reasonably on moveend while mode is on/dim, or document a “press again to refresh” — prefer **refresh on moveend/zoomend while on/dim** without re-fetching cached shape keys.

## Verify (Adrian)

Develop mode, ~3 stations on map: press toggle → only those stations’ line routes, not city-wide blue mesh. Two stations on same MTR line → one pink/orange/etc. line. Hover one station → its line jumps on top.
