# InstantAboard — sheet mid + chips + sim + TKL/LRT/basemap (2026-10-24)

Repo: InstantAboard (main). Work on Adrian's PC checkout. One PR, focused.
Review locked 2026-10-24 (Adrian).

## A) Bottom sheet — taxi / MTR / tram default middle = full first card

**Today** (`Board.tsx`): three handle stops — `lo` (peek min), `mid` = fixed `SHEET_DEFAULT` **0.55**, `hi` (content hug / map-tools max). Tap cycles hi→mid→lo→hi; drag free in `[lo,hi]`; flick → lo/hi; hold stays.

**Wanted**
- Keep three conceptual stops: adjustable bottom (`lo`), **default middle**, adjustable top (`hi`).
- For **taxi**, **MTR**, and **tram** home board: **middle = measured height that fully shows the first/nearest card in the list** (chips + that one card; no fixed 55% empty black under a short card).
- If measured middle **≤** top max (`hi` / `measureSheetMax`): use it as mid snap + default settle.
- If measured middle **>** top max: **no middle** — only `lo`↔`hi` (existing skip when `mid≈hi` already in toggle).
- Taxi/MTR/tram: already has taxi lock; extend `measureTaxiPeekLock`; extend the same idea so **mid** (not only lo/hi lock) hugs the card. MTR: mid = full `.mtr-station` / focused card bottom (not only first `.mtr-line` for interchange peek-min — peek-min can stay shorter; **mid** must cover the full card when under top max).

Touch: `sheetRange`, toggle mid (`SHEET_DEFAULT`), `goSheet(SHEET_DEFAULT)` entry paths, peek settle. Do not break hold-in-place / flick behaviour.

## B) Chips row sticky — force smooth scroll-back

**Bug**: sheet dragged to **bottom** (`lo` / squeezed), then **inner `.sheet-body` scrolled to bottom** → top **mode chips** row leaves its sticky seat / not visible under handle.

**Wanted**: chips stay under the handle. If displaced, **smooth scroll** sheet-body (or restore sticky) so chips are back in position. Edge case only — don't fight normal list scroll when sheet is mid/high.

`.chips` is already `position: sticky` in `globals.css`. Fix likely: when sheet height ≈ `lo` / `mtrSqueeze`, clamp or animate `sheet-body.scrollTop` so chips remain stuck (similar spirit to existing `scrollTop = 0` on entering squeeze — cover the “scrolled away while already squeezed” path too).

## C) Sim band visuals (route map)

### C1) Sim draw order (top → bottom)
Wanted: **sim head/tail bus glyphs** → **yellow estimate dot** → **>>>> chevrons** (chevrons lowest).

`glRouteOrder.ts` today has estimates *under* chevrons (`estimates-layer` then `chevrons-layer`). Fix stack so:
`chevrons` < `estimates` < `sim-vehicles` (head/tail) [flags as appropriate above or with vehicles].
Chevrons must never cover the yellow dot or the bus ends.

### C2) Chevron density vs zoom
`simRegion.ts`: `CHEVRON_SPACING_M = 22` (fixed metres along path) → at default zoom already tight; zoomed out looks packed.

**Wanted**
- Looser at **default** zoom (increase base spacing).
- Spacing in **screen space**: as zoom out, increase along-track metre spacing (or skip marks) so on-screen gap stays roughly constant / never crowded.
- Hook from `RouteMap` / `chevronsAlong` with current map zoom (MapLibre `getZoom()`).

## D) Offline map — no toast, silent auto-update

**Today:** `UpdateMapToast` (≥30d nudge with 更新地圖 button); Wi‑Fi silent ≥7d already in policy (`hkBasemapPolicy.ts`).

**Wanted:** Remove / stop showing the update-map toast (annoys users). Same thresholds, fully automatic:
- Pack **≥7 days** old **and Wi‑Fi** → download silently (keep as now).
- Pack **≥30 days** old → **auto-update on any connection** (no button, no banner).
- Do not render `UpdateMapToast` (or gate it off permanently).

Touch: `UpdateMapToast.tsx`, `Providers.tsx`, `hkBasemapPolicy.ts` / basemap sync hooks.

## E) Light Rail pin — thin white ring under colour rim

**Wanted** (map pin, Siu Hong-style): between the olive LRT disc and the multi-colour line rim, add a **thin white ring** so the icon stays readable.

Touch: `src/lib/logos.ts` (`lrtMarkerHtml` / ring arcs; `MTR_RING_*` helpers). Keep Wikipedia LRT glyph + line-colour outer segments; white separator sits **inside** the colour ring, outside the gold oval.

Also check `LrtLogo` in Icons if board chips share the same rim recipe.

## F) TKL Po Lam → LOHAS map select needs 2 taps

**Cause:** `FlyTo` in `RouteMap.tsx` adopts focus token as baseline on `routeKey` change (sibling arm swap = new routeId) while `FitRoute` frames the full Y-line → overview first; second tap flies close.

**Fix:** On same-family branch terminus tap (POA↔LHP, LOW↔LMC), still `flyVisible` to the stop; do not swallow the focus token / skip FitRoute for arm-only swaps. Treat sibling-arm stop taps like a normal stop focus.

## G) TKL DOWN sim — assign “comes from” arm (ETA fingerprint)

**Framing:** this is **simulation assignment of where each train comes from** (Po Lam arm vs LOHAS arm), not inventing extra trains.

**API limit:** DOWN rows at shared stations (TKO and city-side) only say NOP/ADM — no Po Lam vs LOHAS origin. UP rows carry dest so arm is known.

**Do not:** fan one combined TKO/NOP/ADM ETA into **two** full-arm trains (`fetchMtrBranchClocks` / `dedupeMergedArmClocks` keeping both when “real”).

**Wanted — timeline fingerprint → one “comes from” per train**

Use ETA lists at **TKO, Hang Hau, Po Lam, LOHAS** (and other spine/stub stops as available) to assign each DOWN logical train a single origin arm before placing sims.

Fake-data analogy (minutes to arrive; letters = logical trains):

```
TKO:      1(A), 3(B), 5(C), 7(D), 9(E)
Hang Hau: 1(B), 3(C),        7(E)
Po Lam:        2(C), 4(E), 8(/)
LOHAS:         3(D), 9(/), 15(/)
```

Assignment sketch:
1. **Spine: one sim per real ETA** — never two spine carts from one TKO time.
2. **Stub-only / terminus hits** → that train **comes from** that arm (Po Lam-only → from Po Lam; LOHAS-only → from LOHAS).
3. **Gap fill (branch cadence):** Po Lam is a head terminus and should follow a steadier MTR pattern. If Hang Hau ↔ Po Lam gaps look **longer than normal headway**, and a **LOHAS hit fills that gap**, assign that train (**D**) as **comes from LOHAS** — and the reverse when Po Lam fills a LOHAS-side gap.
4. Match trains across stations by relative ETA offsets (travel time between stops), not by inventing API ids.

Touch: `routeClocks` / `fetchMtrBranchClocks` / merge+dedupe path used for TKL (and EAL sibling arms if the same DOWN-no-dest pattern applies). Prefer a small pure helper with unit-testable fake timelines like the table above.

## Out of scope
Tram/ferry alpha polish (beyond sheet mid hug for tram), fuzzy search, overlays migration, delete UI, ETA confidence / LightGBM, walking leave-in-X, tutorial/push/icons.

## Done when
1. Taxi / short MTR / tram card: middle hugs card; no empty black slab.
2. Very tall MTR card taller than top max: no mid stop; toggle only lo/hi.
3. Sheet at bottom + scroll content down: chips smooth-return under handle.
4. Draw order: head/tail buses → yellow estimate → `>>>>`; chevrons less dense at default + thinned when zoomed out.
5. No 更新地圖 toast; silent 7d Wi‑Fi / 30d any-net auto update still runs.
6. LRT pin has thin white ring between olive disc and colour rim.
7. Po Lam selected → tap LOHAS (or reverse): camera flies to that stop on first tap (no full-Y overview first).
8. TKO→North Point: one spine sim per ETA; branch attribution via fingerprint (gap-fill / stub hits) — no double Po Lam+LOHAS carts for one combined time. Smoke with fake timeline like the table above + a live TKO DOWN sample.
9. Smoke 91M / TKO MTR / taxi / tram / LRT pin on phone.

Commit message suggestion: `fix(sheet,sim,tkl): hug mid; sticky chips; sim z-order; TKL arm fly + DOWN fingerprint; LRT ring; silent basemap`
