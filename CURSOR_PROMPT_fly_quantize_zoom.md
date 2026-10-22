# InstantAboard — Agent 1: quantize fly zoom (end-of-fly route/marker shimmer)

Branch: `fix/fly-quantize-zoom`  
Base: latest `main` (includes merged PR #31 blob-slice / Bright / pack epoch — do **not** touch offline/SW).

## Standing rules (every agent)

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only — cloud agent may commit/push/PR only if that is how this run works; still no local npm.
4. Keep / write `CURSOR_PROMPT_fly_quantize_zoom.md` in repo root — do not delete or gitignore.
5. Dense literal diffs. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright — **no full MapLibre rewrite**, never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys. **Never** Leaflet `flyTo` / `flyToBounds`. Keep `flyVisible` / `fitVisibleBounds` rAF path. Do not hide markers as a “fix”. Do not mix map-service-bounds / MapLibre dots into this branch.
6. **No Leaflet zoom fade:** never leave / introduce MapContainer `zoomAnimation={true}` or fade/hide overlay panes on zoom — overlays (route, stops, markers) must stay visible (Agent 3 owns the dedicated fix; other agents must not re-enable fade).

## Bug (what Adrian sees)

Big flies: route-line jitter is OK. **Near the end** (tiny zoom creep / minor motion) the route line + DivIcons shimmer bit-by-bit vs the MapLibre basemap — very obvious. Cause: rAF feeds continuous fractional `zNow` into `setView(..., {animate:false})` ~60×/s; Leaflet overlays re-project every distinct zoom while MapLibre’s canvas does not lockstep.

## Fix (only `src/lib/mapCamera.ts` unless helper must export)

1. Add `quantizeZoom(z: number): number` → `Math.round(z * 8) / 8` (1/8 zoom buckets).
2. In **both** rAF loops (`flyVisible` and `fitVisibleBounds`):
   - After computing `zNow`, `const zQ = quantizeZoom(zNow)`.
   - Pass **`zQ`** into `cameraForVisibleCenter` / `fitCenterAtZoom` and `map.setView(..., zQ, { animate: false })`.
3. Final settle / `snapIfParkedAtFullMid` / instant paths: **true target zoom** (not quantized) so landing stays exact.
4. Same-zoom `panTo` path: unchanged (quantize does not help pure pan micro-moves — out of scope).
5. Do **not** change durations, easing, sheetFrac, busy/spin, or prep ≤2s.

## Done when

- Grep shows one shared `quantizeZoom` used in both rAF frames.
- Mid-flight zoom only steps on 1/8; end zoom exact.
- No `flyTo`. No marker hiding. No basemap / SW / offline / bounds edits.

## Verify (Adrian)

Locate / stop focus / open 91M — watch **end** of fly: route line + stops should stop bit-by-bit shimmering.

## Implemented (Agent 1)

- `quantizeZoom` in `src/lib/mapCamera.ts` (shared, not exported).
- `flyVisible` rAF: mid-flight `zQ` → `cameraForVisibleCenter` + `setView`; `t >= 1` settles via `setViewVisibleCenter(..., zoom)` then `snapIfParkedAtFullMid`.
- `fitVisibleBounds` rAF: mid-flight `zQ` → `fitCenterAtZoom` + `setView`; `t >= 1` settles via `fitCenterAtZoom(..., zoom)` + `setView(..., zoom)`.
- Instant / reduce / panTo / prep paths unchanged (true target zoom).
