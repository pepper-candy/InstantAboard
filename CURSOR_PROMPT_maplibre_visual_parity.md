# InstantAboard — MapLibre visual parity (radar ping + rounded-square stops)

Branch: `feat/maplibre-stop-dots` (current WIP). Do **not** mix into `fix/pmtiles-blob-slice`.

## Standing rules

1. Plan-first then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep `CURSOR_PROMPT_maplibre_stop_dots.md` + this file (`CURSOR_PROMPT_maplibre_visual_parity.md`).
5. One GL map via `getIaMaplibreMap`; no Leaflet `flyTo`; logos/RouteLayer stay Leaflet; keep Leaflet click → `queryRenderedFeatures`.

## Problem (Adrian)

1. User “ripple” was a breathing blob (expand THEN shrink). Must be GPS **radar ping**.
2. Bus/minibus were circles. Must be **rounded squares** like old `.stop-dot` (`border-radius: 3px`).

## Fix A — radar ping (match `globals.css` `.user-ripple`)

- Static center `ia-user-dot` (~6px radius / 12px dia, `#4ea2ff` + `#0b57d0` stroke).
- Two halo layers, phase offset **1.2s**, period **2.4s**.
- Each cycle: radius **ONLY grows** `6 → ~19.2` (12px×3.2/2); opacity `0.7 → 0` by ~85%. On wrap, **SNAP** back to `r=6` / `op=0.7` — **NEVER** contract mid-cycle.
- Ring look: soft fill `rgba(78,162,255,0.28)` + stroke 2px `rgba(78,162,255,0.75)`. Not a solid filled disc.
- `prefers-reduced-motion` → static halo, no rAF.
- Delete expand-then-contract branch in `ripplePhase`.

## Fix B — rounded-square stops (MapLibre circle cannot do this)

- Replace `ia-stops-circle` with symbol layer(s).
- `addImage` rounded-rect icons (retina 2×): stop 10×10 r=3; selected 12×12 + stronger white/outer ring (`.stop-dot.is-on`); cluster 22×22 r=7 + `text-field` count.
- Prefer SDF + `icon-color`, or cache per-hex canvases.
- Update `HIT_LAYERS` to new symbol ids.
- Do **not** bring back Leaflet DivIcons for user/bus (shake returns).

## Done when

- Radar rings (not breath).
- Bus/minibus = little colored rounded squares with white rim.
- Clusters = rounded badges.
- Taps work (Leaflet-forwarded).
- Fly still syncs (no DivIcon shimmer on user/bus).
