# InstantAboard — Agent 3: no Leaflet fade / disable on zoom

Branch: `fix/leaflet-no-zoom-fade`  
Base: latest `main` (after PR #31). Do **not** mix quantize or service-bounds into this branch.

## Standing rules (every agent)

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep / write `CURSOR_PROMPT_leaflet_no_zoom_fade.md` in repo root — do not delete or gitignore.
5. Dense literal diffs. Locked stack: MapLibre-Leaflet + OpenFreeMap Bright — **no full MapLibre rewrite**, never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys. **Never** Leaflet `flyTo` / `flyToBounds`. Keep `flyVisible` / `fitVisibleBounds` rAF path. Do not hide markers as a “fix”. Do not touch SW / BlobSource / pack policy / MapLibre dots WIP.

## Bug (Adrian + recording)

On zoom in/out, Leaflet overlays (route line, stops, user/bus markers) **fade out / blank / look disabled**, then fade or pop back. He wants them to **stay fully visible** the whole time — no fade-in/out, no temporary hide/disable of the Leaflet overlay stack during zoom (pinch, wheel, or buttons).

## Likely cause (verify; discard if wrong)

`HomeMap` + `RouteMap` currently set `zoomAnimation={true}` (with `markerZoomAnimation={false}`). Leaflet’s CSS zoom-anim / fade-anim path hides or fades overlay panes mid-zoom. Automated fly already uses `setView({animate:false})` and comments “markers stay visible (no fade)” — but **manual / MapContainer zoomAnimation still fades**.

## Fix

1. Set **`zoomAnimation={false}`** on `MapContainer` in **both** `HomeMap.tsx` and `RouteMap.tsx` (keep `markerZoomAnimation={false}`).
2. Grep for any zoomstart/zoomanim/opacity/display hacks that hide overlay/marker panes — remove them if present.
3. Optional CSS only if still fading after (1): neutralize `.leaflet-fade-anim` / zoom-anim opacity on **overlay + marker panes** in `globals.css` — do **not** CSS-scale the MapLibre GL canvas (that causes gray void). Prefer option (1) first.
4. Do **not** change rAF fly durations, sheetFrac, busy/spin, prep≤2s, maxBounds, or offline pack.
5. Do **not** re-enable Leaflet `flyTo`.

## Applied (Agent 3)

### MapContainer prop changes (literal)

`src/components/HomeMap.tsx` and `src/components/RouteMap.tsx`:

```diff
-        zoomAnimation={true}
+        zoomAnimation={false}
         markerZoomAnimation={false}
```

### Grep / CSS

- No zoomstart / zoomanim / opacity / display hacks on overlay or marker panes in map components.
- No `globals.css` change — prop-only fix; do not CSS-scale MapLibre GL canvas.

### Untouched (per ownership)

- `src/lib/mapCamera.ts`, rAF flyVisible, sheetFrac, busy/spin, maxBounds, SW / BlobSource / pack, MapLibre dots.

## Done when

- Pinch / wheel / ± zoom: route line + markers stay opaque and visible throughout (no fade blink).
- MapLibre basemap still paints (no mid-zoom gray void / CSS-scale tile).
- Automated locate/route fly still uses existing rAF path.
- Prompt file in repo.

## Verify (Adrian)

Open a route (e.g. 91M), pinch zoom in/out repeatedly — line and stops never wash out. Locate fly still smooth enough; no MapLibre gray flash.


## UPDATE (Adrian 22 Oct 2026)

Do **NOT** set zoomAnimation={false} — basemap pinch/wheel became BAD (steppy). Keep zoomAnimation={true} for smooth MapLibre zoom. Prefer CSS so overlay/marker panes stay opacity 1 during leaflet-zoom-anim / leaflet-fade-anim. Quantize handles line shimmer; markerZoomAnimation stays false.

