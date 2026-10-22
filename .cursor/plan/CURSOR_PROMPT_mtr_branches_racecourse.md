# InstantAboard — MTR branched lines + Racecourse spur

Branch: from Adrian’s current tree. **Adrian handles npm/git. You only edit files.**

Keep / create this file in repo root as `CURSOR_PROMPT_mtr_branches_racecourse.md`.

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests. No npm/git. Edit files only.
3. Locked stack: no `flyTo` / `flyToBounds`; keep rAF camera helpers; no pack/SW/worker policy changes.
4. Map overlays follow `glRouteLine` as master stick-to-map method where you touch route overlays.
5. Do **not** invent a second “line” row for a branch (EAL stays one East Rail; TKL stays one Tseung Kwan O Line).

## Product mandate (Adrian)

Friend bug + Racecourse special case:

1. **Board / line switch** — Branched lines must expose **both termini**, not one “main” arm:
   - **EAL:** Lo Wu **and** Lok Ma Chau (落馬洲)
   - **TKL:** Po Lam (寶琳) **and** LOHAS Park (康城)
2. **One line identity** — Still one accordion / line row per `mtrLineCode` (EAL / TKL). Branches are **destinations / arms**, not separate colours or separate line cards.
3. **Map geometry** — Always draw **both arms** of the fork (and the Racecourse spur). Nothing “missing” from the visual network just because today’s trains aren’t using an arm.
4. **Sim carts** — At the junction, carts follow the **train’s live dest**: peel onto Lo Wu / LMC / Po Lam / LOHAS as appropriate. Default spine when dest is the non-branch terminus.
5. **Racecourse (馬場)** — Always draw the spur off Fo Tan like a branch. On non-race days (no Racecourse-bound trains in the API): **no cart takes that path** (all Fo Tan spine). **ETA / cards** for Racecourse only when live API returns trains to that dest; otherwise **nothing** for that path. Racecourse must **not** drive the main EAL variant pick or make the station list inconsistent.

## Root cause today (fix)

`src/lib/stopIndex.ts` + `src/lib/opposite.ts`:

- `isMainMtrBound` treats only exact `UT` / `DT` as “main”.
- `betterMtrVariant` prefers `main === true`, then longer stop lists.
- Per line per station, `dirs.UP` / `dirs.DOWN` keep **one** variant each → branch dests (LMC, LOHAS, etc.) collapse away.
- `mtrLineCode` already folds `EAL_LMC` → `EAL` and strips `TKL-…` prefixes — good; keep that.
- Shapes already exist separately: `mtr-EAL-UT/DT`, `mtr-EAL-LMC-UT/DT`, `mtr-TKL-UT/DT`, `mtr-TKL-TKS-UT/DT`. Racecourse may share EAL spine data or need an explicit spur — discover from `routeList` / stop ids / first-last; do not drop the station from the map if it exists in stop data.

`MtrBoard` `awayDirs` only filters “ends here”; it cannot show a second dest if `dirs` never stored it.

## Required work

### A. Branch-aware line model (board)

Replace the single-dest-per-dir collapse with a structure that keeps **all branch destinations** for UP/DOWN (or a dest picker) while remaining one `MtrLine` / one colour.

Suggested shape (adapt names to codebase):

- Keep `MtrLine` keyed by `mtrLineCode`.
- For each direction, store **multiple** `MtrDirRef`-like entries (one per distinct terminus / variant), **or** keep primary `dirs` for flip UX and add `branchDests: MtrDirRef[]` / `variants[]` that the board can list / cycle.
- Prefer **main UT/DT** only as the default flip home when both arms exist — **never** as the only stored arm.
- **Do not** let Racecourse (race-day-only spur) be preferred as the “main” EAL variant when choosing default `routeId` / stop lists.

Board UX (pick one clear pattern and stick to it):

- Direction flip still UP ↔ DOWN.
- Within the active direction, expose **both termini** (chips, segmented control, or dual destination labels) so the user can open Lo Wu **or** LMC (and Po Lam **or** LOHAS) without hunting a second line card.
- Arrival rows: filter / group by `dest` / `destCode` so both arms’ ETAs show when the API returns them.
- Opening a pin: use the `routeId` + `stopSeq` of the **selected** branch variant.

Touch: `stopIndex.ts` (`nearestMtrStations` / `MtrLine`), `MtrBoard.tsx`, any place that assumes one dest per dir (`opposite.ts` may need “prefer same branch terminus when flipping” — flip to opposite bound **closest stop**, and if possible keep the same branch family).

### B. Map: always draw both arms (+ Racecourse spur)

When showing EAL or TKL on the detail / route map (and home place geometry if you already draw line shapes):

- Composite or overlay **all** relevant track shapes for that line code (main + LMC / TKS / Racecourse spur), not only the active `shapeFileName` of the selected variant.
- Station dots: every station on **any** arm of that line stays visible (including 馬場).
- Selected variant can still highlight / focus fit on the active arm, but the other arm must remain drawn (same line colour; optional slight opacity difference is OK if needed for clarity — default: same solid colour).

Reuse existing `loadRouteLine` / `shapeFileName` / `glRouteLine` patterns. Prefer merging polylines that share the spine over duplicating the whole trunk twice if that’s easy; correctness > perfect dedupe.

### C. Sim: dest-aware peel; Racecourse gated

`mtrFleet.ts` / `useRouteFleet` / route clocks today run sim along **one** track (the selected route’s shape) and reverse for the other bound.

Extend so that when clocks / arrivals carry a **dest** (Lo Wu vs LMC, Po Lam vs LOHAS, Fo Tan spine vs Racecourse):

- Place that train on the polyline that matches its dest arm (or a merged graph with correct branch edges).
- Trains **not** bound for Racecourse never enter the Racecourse spur.
- If no Racecourse-bound clock / ETA exists → **zero** carts on that spur (map spur still drawn).

If a full junction graph is too large for this PR: minimum acceptable is (1) board shows both termini, (2) map draws all arms always, (3) sim stays on the **selected** variant’s shape **and** does not place carts on Racecourse unless that variant / dest is active with live ETAs. Document any sim shortcut in the PR summary.

### D. ETA / cards for Racecourse

- Only surface Racecourse destination rows / cards when `fetchMtr` (or clocks) returns arrivals with that dest.
- Non-race day → no empty Racecourse row, no fake times.
- Do not hide Lo Wu / LMC / Po Lam / LOHAS the same way — those are permanent termini even if one arm has a gap; only Racecourse is “present when served”.

### E. Out of scope

- Light Rail MTR-tab prompt (`CURSOR_PROMPT_light_rail_mtr_tab.md`) — separate.
- Dev all-station route lines overlay — separate.
- Changing Wikipedia `MTR_LINE` hexes.
- Bus / minibus sim.

## Done when

1. At a mid-line EAL station, board can reach **both** Lo Wu and Lok Ma Chau (not only one).
2. At a mid-line TKL station, board can reach **both** Po Lam and LOHAS Park.
3. EAL/TKL still appear as **one** line each (one colour, one line identity).
4. Map for EAL/TKL shows **both** fork arms; Racecourse spur always drawn when station exists in data.
5. No Racecourse ETA/cards without live trains; no sim carts on Racecourse spur without Racecourse-bound service.
6. Racecourse does not steal default EAL `routeId` / variant pick on ordinary days.

## Verify (Adrian)

- Fanling / Tai Po Market / University: EAL shows Lo Wu **and** LMC.
- Tseung Kwan O / Hang Hau: TKL shows Po Lam **and** LOHAS.
- Map: both arms visible; 馬場 spur visible near Fo Tan.
- Non-race day: no 馬場 cards; carts stay Fo Tan spine.
- Race day (or when API has 馬場): cards appear; a cart may use the spur.
