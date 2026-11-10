# CURSOR_PROMPT — InstantAboard sheet tap hit targets (batch)

Do **not** git add / commit / push unless Adrian asks. Edit the local InstantAboard tree.

## A — Home MTR sheet: only ⇄ swaps direction
On **home board** MTR/LRT station cards (bottom sheet), only the circular horizontal ⇄ control swaps direction.
- Station header / name must **not** swap.
- Do **not** regress RouteDetail whole-title-chip swap (already shipped).

## B — Bus/minibus home cards: whole card → detail
Tapping anywhere on the home nearby route card — including the three ETA boxes — opens RouteDetail.
- Today `EtaStrip` often wraps times in a button that `stopPropagation` + `onRefresh`.
- Board already polls at `ETA_POLL_MS = 5000` — keep that; ETA tap should open detail, not only refresh.
- Apply on home list peeks/cards (bus, minibus, and same pattern elsewhere on the home sheet).

## C — MTR/LRT home station card
1. **Purple body** (line rows / ETA): open RouteDetail for that line (ensure ETA taps do too).
2. **Whole orange header** (chevron + station name + distance): collapse/expand accordion.
3. **ⓘ** (`MtrHoursButton`): must **not** collapse — only first/last hours (`stopPropagation`).
4. **Selection:** On MTR tab with nearby stations, **exactly one** station selected — never zero, never two. Default = nearest (first). Collapsing must **not** clear selection or jump-open first via `shownId = railFocus ?? railOpen ?? firstId` when `openId` is set `null`. Split “chosen station” vs “body expanded” if needed.

## Likely files
`src/components/MtrBoard.tsx`, `EtaStrip.tsx`, `Board.tsx`, related CSS if needed.

## Done when
- Home MTR: header ≠ swap; ⇄ swaps; ⓘ = hours only; orange header collapses; purple → detail; one always selected.
- Home bus/minibus: ETA boxes → detail.
- Leave a short note of what changed; no commit unless asked.
