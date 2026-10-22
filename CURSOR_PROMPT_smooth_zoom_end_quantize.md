# InstantAboard — smooth basemap zoom + end-only quantize

Branch: `fix/smooth-zoom-end-quantize`  
Base: current working tree (or latest `main` + prior agent edits). Adrian handles npm/git.

## Standing rules (every agent)

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep / write `CURSOR_PROMPT_smooth_zoom_end_quantize.md` in repo root — do not delete or gitignore.
5. Dense literal diffs. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright — **no full MapLibre rewrite**, never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys. **Never** Leaflet `flyTo` / `flyToBounds`. Keep `flyVisible` / `fitVisibleBounds` rAF path. Do not hide markers as a "fix". Do not touch SW / BlobSource / pack policy / MapLibre dots WIP.

## Problem

- Full-flight `quantizeZoom` (1/8) on every rAF frame → **route line** feels fine, but **basemap zoom** feels steppy/BAD vs old.
- `zoomAnimation={false}` made pinch/wheel worse — must stay **`zoomAnimation={true}`**.
- Goal: old smooth **map** zoom + keep end-of-fly **line** shimmer damping.

## Fix

### A. MapContainer

`HomeMap` + `RouteMap`: `zoomAnimation={true}`, `markerZoomAnimation={false}`. Never set `zoomAnimation={false}` again.

### B. End-only quantize (`src/lib/mapCamera.ts`)

1. Keep `quantizeZoom(z) => Math.round(z * 8) / 8`.
2. In **both** rAF loops (`flyVisible` + `fitVisibleBounds`):
   - Compute continuous `zNow` as today.
   - Use quantized zoom **only near settle**, e.g. when `t >= 0.7` **or** `Math.abs(zNow - zoom) < 0.25`; otherwise pass **`zNow`**.
   - Pass that chosen zoom into `cameraForVisibleCenter` / `fitCenterAtZoom` and `setView(..., { animate: false })`.
3. Final settle / snap / instant: **true target zoom** (not quantized).
4. Same-zoom `panTo`: unchanged. Durations, easing, sheetFrac, busy/spin, prep ≤2s: unchanged.

### C. Optional CSS (OK if present)

Overlay/marker panes stay `opacity: 1` during `leaflet-zoom-anim` / `leaflet-fade-anim`. Not a reason to disable `zoomAnimation`.

### D. Don't thrash zoom during gestures

`applyPackFillMinZoom`: skip if pane &lt; 8px; prefer load + real layout resize — avoid fighting pinch with repeated `setZoom`.

`kickGlPaint` (if in `basemap.ts`): one-shot after attach/load only — not in a loop during pinch.

## Done when

1. Pinch/wheel basemap feels like **old** continuous smooth zoom.
2. Mid-fly automated camera stays continuous; only end creep uses 1/8 buckets for line stability.
3. No `flyTo`. No `zoomAnimation={false}`.

## Verify (Adrian)

Pinch home map — smooth. Locate / open 91M — fly smooth in the middle; line OK near the end.