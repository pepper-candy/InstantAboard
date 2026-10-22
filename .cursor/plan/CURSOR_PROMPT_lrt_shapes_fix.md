# Cursor prompt — fix Light Rail shape tracing (705/706 purple V)

## Goal
`scripts/build-rail-shapes.ts` already has an LR-only path (`traceLightRail` + `corridorPath`: tight snap, multi-snap retries, corridor-weighted Dijkstra, detour/lateral reject). After regenerate, **LR 705/706 got worse**, not better. Fix the LR tracer until those routes follow the OSM light-rail mesh with **no long chord shortcuts** (the purple V on the map).

**Do not change** MTR or tram tracing (`trace`, `SNAP_M`, tram stitch/bridge) unless a shared helper is strictly required and behaviour stays identical for them.

## Current failure (measured on this tree after `npx tsx scripts/build-rail-shapes.ts`)
| Route | Before (old bake) | After “fix” bake | Bar |
|-------|-------------------|-------------------|-----|
| LR 705 (`public/shapes/lightRail-705-O-1-0.json`) | ~45 pts | **34 pts** | well **above** ~45–49 |
| LR 706 (`public/shapes/lightRail-706-O-1-0.json`) | ~49 pts | **32 pts** | well **above** ~45–49 |
| 706 max step | — | **~775 m** | no step that long (chord / purple V) |

Fewer points + ~775 m max step = still falling back to stop–stop straights or over-rejecting good mesh paths.

## Likely causes to investigate (fix root cause, don’t guess forever)
1. **`corridorPath` over-rejects** — `LR_DETOUR = 2.8` and/or `corridorLimit` / lateral cost (`LR_LATERAL_W`) discard the real loop path on Tin Shui Wai circulars, then `through ?? [a,b]` inserts a chord.
2. **Snap too tight / wrong candidates** — `SNAP_LR_M = 90`, `LR_SNAP_CANDIDATES = 4`, `BRIDGE_LR_M = 18` may miss the correct way endpoints so Dijkstra never connects.
3. **`simplify(..., SIMPLIFY_M = 8)`** collapsing legitimate vertices (less likely to create 775 m alone, but check).
4. **Graph coverage** — `lightRailWays` / `BRIDGE_LR_M` leaving the TSW loop disconnected so many legs go straight. Confirm OSM `railway=light_rail` ways exist in `scripts/.cache/hk-rail-ways.json` around Tin Shui Wai.

Add temporary per-route logging for 705/706 only: stop-leg count, how many legs used `corridorPath` vs straight fallback, max leg length metres. Remove or gate behind a flag before finish if noisy.

## Required behaviour
- LR only: prefer dense mesh-following polylines; **never** leave a stop–stop straight when a light_rail path exists within reason.
- If corridor-weighted search fails, **fallback to plain `shortest` on the LR graph** before the stop–stop chord (chord = last resort only).
- Keep MTR/tram outputs bit-stable if possible (same file point counts ± noise); at minimum don’t regress them.

## Done when
1. Run: `npx tsx scripts/build-rail-shapes.ts`
2. Console `LR 705` / `LR 706` report lines show point counts **comfortably above ~45–49** (target: denser than the old 45/49, not thinner).
3. For `lightRail-706-O-1-0.json` (and 705): max consecutive point spacing **≪ 775 m** (aim max step under ~150–200 m on the loop; no purple V).
4. Spot-check on map (dev Route lines / route shape): 705 & 706 follow the Tin Shui Wai LR loop, no diagonal cuts across the estate.
5. MTR sample (e.g. TKL) and tram Happy Valley still look normal.

## Out of scope
- App UI, MapLibre, board ETA, first/last hours.
- Re-fetching Overpass unless cache is clearly missing `light_rail` in TSW (prefer fix tracer/graph stitch first).

## Files
- Primary: `scripts/build-rail-shapes.ts`
- Outputs: `public/shapes/lightRail-705-O-1-0.json`, `public/shapes/lightRail-706-O-1-0.json` (and other LR files as regenerated)

## Standing constraints (always)
- **No npm** — do not run `npm` / `pnpm` / `yarn` install, add deps, or change `package.json` / lockfiles.
- **No UI tests** — no browser, Playwright, Cypress, or manual UI click-through. Verify with CLI only (`npx tsx scripts/build-rail-shapes.ts`, point counts, max step).
