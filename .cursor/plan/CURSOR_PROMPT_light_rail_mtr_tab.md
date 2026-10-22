# Light Rail inside MTR tab — Cursor prompt

## User mandate (summary)
Light Rail is NOT a separate mode tab. It lives INSIDE the MTR tab with:
1. Map/list pins — Wikipedia MTR Lightrail icon (not maroon heavy-rail M)
2. Boundary/rim — line colour(s) for that stop (multi-colour ring like heavy-rail MTR)
3. Board + arrival cards — same UI as heavy-rail MTR (MtrBoard / accordion / ETA chrome)

## Constraints
- Edit files ONLY. No npm, no git, no UI/browser tests.
- No flyTo / flyToBounds; keep rAF camera helpers.
- No pack/SW/worker policy changes.
- Map overlays follow existing MapLibre / glHomePlaces logo patterns.

## Short plan
1. **Data → NearbyPlace**: Build `lightRail` stops from EtaDb into allPlaces/nearby with `kind: "lrt"`, `mode: "mtr"`, Wikipedia LR route colours for rim; skip lightRail in generic bus-stop loop; include when filter is `mtr` or `all`.
2. **Icon**: Add `public/icons/mtr-lightrail.svg` (gold oval + white LR tram glyph, rim by app); wire `lrtMarkerHtml` / `LrtLogo` — never reuse heavy-rail `mtr.svg`.
3. **Board**: Extend MtrBoard to merge nearby LRT + heavy rail (sorted by distance); same accordion / ETA cards; hide MtrHours for LRT; peek/poll with `company: "lightRail"`.
4. **Map**: Fixed LRT pins (no bus clustering); selected pulse same as MTR logos; route line via existing `useRouteLine` / shapes.
5. **Out of scope**: station-route-lines overlay, heavy-rail logo changes, live LR vehicle dots.

## DONE WHEN
1. MTR tab lists/maps nearby LR stops with wiki LR icon + coloured rim.
2. Open one → MTR-style board + live LRT arrival cards.
3. Heavy-rail stations unchanged (maroon M).
4. No new mode tab.
