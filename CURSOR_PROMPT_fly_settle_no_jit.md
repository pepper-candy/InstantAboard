# InstantAboard — kill end-of-zoom L/R jit + keep route full while panning

Branch: `fix/fly-settle-no-jit`  
Base: current working tree / latest main + prior map edits. Adrian handles npm/git.

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests. No npm/git. Edit files only.
3. Keep / write `CURSOR_PROMPT_fly_settle_no_jit.md` in repo root (this file).
4. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright. Never Leaflet `flyTo` / `flyToBounds`. Keep `flyVisible` / `fitVisibleBounds` rAF. Do not hide markers. Do not touch SW / BlobSource / pack policy. Never `zoomAnimation={false}`.

## Problem (Adrian videos, 290A)

1. **Every automated zoom: almost finished → back-and-forth L/R jit** (confirmed frame analysis).
2. While panning, route line **cuts off at view edge** (Leaflet SVG vs MapLibre camera). Shape files are full — not a short geometry.

## Root cause in `src/lib/mapCamera.ts` (settle path)

Near end of rAF (`flyVisible` + `fitVisibleBounds`):

1. `zoomForFrame` **quantizes to 1/8 when `t >= 0.7`** (or |zNow−target|<0.25) → last ~30% of flight stair-steps zoom.
2. Each stepped `zFrame` recomputes `liveEnd` / `fitCenterAtZoom` → pan target **jumps** left/right with the buckets.
3. At `t === 1`: final exact-zoom `setView` / `setViewVisibleCenter`, then **`snapIfParkedAtFullMid` may setView again** → second correction = visible settle jit.

Mid-flight continuous zoom was fine; **end-only quantize + double settle** is the jitter Adrian sees.

## Fix A — settle (required, do first)

In `mapCamera.ts` for **both** `flyVisible` and `fitVisibleBounds` rAF loops:

1. **Delete / stop using** `quantizeZoom` / `zoomForFrame` for in-flight frames. Pass continuous **`zNow`** into `setView` every frame (including near settle).
2. Final landing: **one** `setView` / `setViewVisibleCenter` at true target zoom+center.
3. Fold `snapIfParkedAtFullMid` into that **same** final setView (compute visible-band center once). Do **not** call a second setView after landing. Same for `revealFlyBest`.
4. Keep durations, easing, sheetFrac, busy/spin, prep ≤2s, gen cancel, no `flyTo`.
5. `zoomAnimation={true}`, `markerZoomAnimation={false}` stay.

## Fix B — route always full during pan (same PR if small; else follow-up)

Prefer: draw main route as **MapLibre GeoJSON line** on `getMaplibreMap()` (match Polyline color/weight/opacity; ferry dashed). Remove Leaflet `<Polyline>` for the main shape once GL line is up. Stops/vehicles/sim may stay Leaflet.

Fallback only if blocked: map-wide `L.SVG` renderer with large `padding` (1.0–2.0) — note why in the md file.

## Done when

1. Locate / stop focus / full-route fit: zoom finishes **without** L/R bounce at the end.
2. Manual pinch stays smooth (continuous zoom).
3. Pan along 290A: red line continues past the edge (no hard clip mid-pan).
4. No `flyTo`. No `zoomAnimation={false}`. No in-flight 1/8 zoom buckets.

## Verify (Adrian)

Open 290A, tap several stops / locate: watch the last half-second of each zoom — should ease in and stop once. Pan the line across TKO→Kowloon — line never “ends” at the frame.