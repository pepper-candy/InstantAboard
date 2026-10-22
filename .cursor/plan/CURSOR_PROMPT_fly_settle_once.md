# InstantAboard — one clean settle (no in→out→in zoom jit) + full route while panning

Branch: `fix/fly-settle-once`  
Base: current working tree / latest main + prior map edits. Adrian handles npm/git.

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests. No npm/git. Edit files only.
3. Keep / write `CURSOR_PROMPT_fly_settle_once.md` in repo root.
4. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright. Never Leaflet `flyTo` / `flyToBounds`. Keep `flyVisible` / `fitVisibleBounds` rAF. Do not hide markers. Do not touch SW / BlobSource / pack policy. Do not set `zoomAnimation={false}`.

## Problem (Adrian video + feel)

Almost every automated zoom: **near the end** it feels like **zoom-in already → slight zoom-out → zoom-in again** (back-and-forth jit at settle). Also route line cuts at viewport edge while panning (Leaflet SVG vs MapLibre camera).

## Root cause (code)

In `src/lib/mapCamera.ts` near settle (before this fix):

1. `zoomForFrame` **quantized to 1/8** when `t >= 0.7` or `|zNow−target| < 0.25` → stair-step zoom + `cameraForVisibleCenter(..., zFrame, ...)` **re-aimed** the pan target each frame → L/R + zoom wobble.
2. At `t === 1`: **exact** `setViewVisibleCenter` / settle (not quantized) → another zoom jump.
3. Then **`snapIfParkedAtFullMid`** may `setView` **again** → third correction (in→out→in).

## Plan (executed)

### Fix A — settle once (required)

`flyVisible` + `fitVisibleBounds` rAF loops:

1. **Delete** `quantizeZoom` / `zoomForFrame`. Pass continuous `zNow` every frame. No 1/8 buckets.
2. At `t === 1`: **one** final `setView` to the true target (exact zoom + correct visible-band / fit center). Do **not** call `snapIfParkedAtFullMid` after that same settle.
3. Keep `snapIfParkedAtFullMid` only for the **panTo / moveend** path (same-zoom flights).
4. Mid-flight: continuous `zNow` still drives `cameraForVisibleCenter` / `fitCenterAtZoom` so the pin doesn’t park at full-screen mid — just no quantize.
5. Durations, easing, sheetFrac, busy/spin, prep ≤2s, gen cancel: unchanged. `zoomAnimation` stays `true`.

### Fix B — route always with the map

Prefer MapLibre GeoJSON line on `getIaMaplibreMap` / `ensureIaRouteLine`; no Leaflet `<Polyline>` for main shape.

## What changed (this pass)

### Fix A — landed in `src/lib/mapCamera.ts`

- Removed `quantizeZoom` and `zoomForFrame`.
- `flyVisible` / `fitVisibleBounds` rAF frames use continuous `zNow` for setView and visible-band / fit math.
- At `t === 1`: single settle (`setViewVisibleCenter` or fit `setView`) — **no** `snapIfParkedAtFullMid` stack.
- `revealFlyBest` (hard-timeout): one `setViewVisibleCenter` (no snap after).
- `snapIfParkedAtFullMid` retained only on the same-zoom `panTo` → `moveend` path.

### Fix B — already present (not touched)

Verified, left as-is (no regression):

- `src/lib/glRouteLine.ts` — GeoJSON source/layer, paint re-ensure, style.load via `ensureIaRouteLineForMap`.
- `src/components/RouteMap.tsx` — `GlRouteLine` in `RouteLayer`; no main-shape Leaflet `<Polyline>`.
- `zoomAnimation={true}` on HomeMap / RouteMap.

## Done when

1. Locate / stop tap / route open: zoom approaches target **once** — no in→out→in at the end.
2. No end-of-fly L/R wobble from quantize + double setView.
3. Pan: route continues past screen edge (Fix B already shipped).
4. No `flyTo`. No `zoomAnimation={false}`.

## Verify (Adrian)

Stop-tap and locate several times: when zoom is almost done, it should **ease to rest**, not bounce out then in. Pan 290A: line doesn’t clip at the frame.
