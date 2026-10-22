# Cursor init — Light Rail simulation

You are editing InstantAboard on Adrian’s tree. **Adrian handles npm/git. You only edit files.**

## Do this first

1. Read the full product requirements in repo-root **`CURSOR_PROMPT_lrt_sim.md`** (same folder as `CURSOR_PROMPT_mtr_branches_racecourse.md`). That file is the mandate — implement everything under **Product mandate**, **Required work**, and **Done when**.
2. Plan-first bullets, then implement (no approval wait). No UI/browser tests. No npm/git.
3. Keep / refresh `CURSOR_PROMPT_lrt_sim.md` in the repo root if you change scope notes.

## One-line goal

Light Rail map sim like heavy-rail MTR (live MTR Corp LRT schedule → clocks → place along track), but **slower** (~40–50 km/h vs `MTR_SIM_KMH = 80`). Wire `lightRail` through `fetchRouteClocks` + `useRouteFleet` + `RouteDetail` vehicles — not a bus error-band.

## Standing locks

No `flyTo` / `flyToBounds`; rAF camera helpers stay; no pack/SW/worker policy changes; `glRouteLine` master for overlays you touch; no LRT first/last hours.

Start by reading `CURSOR_PROMPT_lrt_sim.md`, then implement.
