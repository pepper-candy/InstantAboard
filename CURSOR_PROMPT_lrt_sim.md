# InstantAboard — Light Rail map simulation (MTR-style, slower)

Branch: from Adrian’s current tree. **Adrian handles npm/git. You only edit files.**

Keep / create this file in repo root as `CURSOR_PROMPT_lrt_sim.md`.

**Init:** paste `CURSOR_INIT_lrt_sim.md` first; it points here. Full product requirements live in **this** file.

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests. No npm/git. Edit files only.
3. Locked stack: no `flyTo` / `flyToBounds`; keep rAF camera helpers; no pack/SW/worker policy changes.
4. Map overlays follow `glRouteLine` as master stick-to-map method where you touch route overlays / sim markers.
5. Do **not** invent first/last hours for LRT (`mtr-first-last.json` is heavy-rail only; `MtrBoard` already hides hours for `kind: "lrt"`).

## Product mandate (Adrian)

Light Rail is MTR Corp live data (same family as heavy rail). Simulation should reuse the **same motion logic** as MTR train carts, but **slower**.

1. **Same model as heavy rail** — ETA / schedule poll → per-stop clocks → link into vehicles → `placeMtrFleet`-style accel / coast / brake / dwell along the route track shape (both bounds if you already do that for MTR on detail).
2. **Slower than MTR** — heavy rail uses `MTR_SIM_KMH = 80`. LR should coast around **~40–50 km/h** (pick one constant, e.g. `LRT_SIM_KMH = 45`, and wire it through the motion helpers). Dwell / depart lag may be slightly longer than heavy rail if that looks better; don’t change ETA **labels**.
3. **Live source** — `https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule?station_id=…` (already used by `fetchLrt` in `eta.ts`). Station-scoped `platform_list` / `route_list` with `route_no`, dest, `time_en` / `time_ch` (parse via existing `parseLooseMinutes`).
4. **Detail map** — opening an LR route/stop shows sim carts on the track like MTR trains (SVG / MapLibre sim markers already used for MTR), not a bus error-band.
5. **No GPS** — LRT schedule API has no vehicle GPS; inferred motion only (same as heavy-rail Next Train sim).

## Root cause today (fix)

- `useRouteFleet`: `mtr` → `placeMtrFleet`; `tram` → `placeTramFleet`; **`lightRail` is not active** for rail sim.
- `fetchRouteClocks`: has `mtr` / `lrtfeeder` (MTR Bus) — **no `lightRail` case** (falls through to `[]`).
- `RouteDetail`: treats `lightRail` as “road-ish” for some layout, but passes `vehicles` only for `mtr` || `tram` — LR never gets train dots.
- ETA board already works via `fetchLrt`; only the **map fleet** path is missing.

## Required work

### A. Clocks for Light Rail

In `routeClocks.ts` (or a small `lrtFleet` / shared helper):

- Add `case "lightRail"` to `fetchRouteClocks`.
- For each stop on the selected route’s stop list, call the LRT schedule API (pool like `fetchMtr`), filter rows to this `route.route` (+ dest match like `fetchLrt`), convert times to seconds / `Hit`s.
- Link into `StopClock[]` (reuse `linkMtrTrains` if dest+timing fit, or a thin LRT linker). Preserve dest on clocks when useful for multi-dest routes.
- Poll interval: same ballpark as MTR (~30s) in `useRouteFleet`.

### B. Motion constants

- Add `LRT_SIM_KMH` (~40–50) and optional `LRT_DWELL_S` / `LRT_DEPART_LAG_S` next to `mtrTime.ts` (or parameterized exports).
- Prefer **parameterizing** `placeMtrFleet` / `placeTrain` (pass coast km/h + dwell) over copy-pasting the whole file. If a shared `placeRailFleet(…, opts)` is cleaner, do that and keep MTR defaults unchanged.

### C. Wire fleet + detail map

- `useRouteFleet`: treat `lightRail` like `mtr` (active when route + stops + track), fetch clocks, `tick` every 1s, return `vehicles` from the rail placer with LRT speed opts. **Not** bus `simCores` / error band.
- `RouteDetail`: pass `vehicles` for `lightRail` the same way as `mtr` (and keep LR off road `simCores`). Ensure `useRouteLine` track (already treats `lightRail` as track) feeds the fleet.
- Sim markers: reuse existing MTR / rail sim marker path on `RouteMap` (`glRouteSimMarkers` / train SVG). If the glyph is heavy-rail only, use a sensible LR/tram-like cart or the same train SVG tinted — don’t leave blank dots.

### D. Out of scope

- First/last train UI for LRT.
- Heavy-rail EAL/TKL branch / Racecourse work (`CURSOR_PROMPT_mtr_branches_racecourse.md`) — separate.
- Changing LRT map pin icon (wiki glyph already landed in `logos.ts` / `mtr-lightrail.svg`).
- Inventing GPS when the API has none.

## Done when

1. Open an LR route on the detail map → carts move along the shape using live schedule ETAs.
2. Motion is visibly slower than heavy-rail MTR on the same zoom.
3. Board ETAs unchanged; no fake first/last hours.
4. Bus routes still use error-band sim; heavy rail unchanged at 80 km/h.

## Verify (Adrian)

Near Tuen Mun / Yuen Long LR (e.g. 藍地 / 610): open route → see carts; compare feel vs a heavy-rail MTR line; hard-refresh after pull.
