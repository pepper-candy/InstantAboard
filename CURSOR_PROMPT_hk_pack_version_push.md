# InstantAboard — HK offline pack version push (no clear-cache / reinstall)

Repo workspace: `InstantAboard`. Task: ship newer GitHub Release packs to clients that already have a “young” local pack, without forcing cache clear or PWA reinstall.

**Output:** edit files only (Adrian handles npm/git). No UI/browser tests. Prefer `hkBasemapPolicy.ts` + `useHkBasemap` — avoid conflicting edits to `basemap.ts` / `pmtilesProtocol.ts` unless strictly required.

---

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep / write `CURSOR_PROMPT_hk_pack_version_push.md` in repo — do **not** delete or gitignore `CURSOR_PROMPT_*.md`.
5. Dense literal diffs; locked stack **MapLibre-Leaflet + OpenFreeMap Bright** — no full MapLibre rewrite, never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys; do not hide stop markers; leave L/R DivIcon shake alone.

---

## Bug

`useHkBasemap` only silent-updates at local pack age **≥ 7d** and nudges at **≥ 30d**. A newer Release with different `sha256` / `version` is ignored while the pack is still “young”. Mobile can stay on an old (or missing) pack forever until age gates fire or the user clears cache / reinstalls.

Age gates were a proxy for “maybe CI published something.” Once the client fetches `manifest.json`, **identity mismatch must drive the update path**, not calendar age alone.

---

## Required policy (`src/lib/hkBasemapPolicy.ts`)

| Helper | Behavior |
|---|---|
| `packOutOfDate(local, manifest)` | `true` when local missing, or `sha256` (case-insensitive) and/or `version` differs from remote. |
| `shouldSilentUpdateForManifest(local, manifest, now?)` | `true` on mismatch **or** age ≥ `HK_UPDATE_MIN_AGE_DAYS` (7). Caller still gates with `canSilentDownloadNow()` — **never silent-burn cellular**. |
| `shouldNudgeForManifest(local, manifest, now?)` | `true` on mismatch **or** age ≥ `HK_NUDGE_AGE_DAYS` (30). Mismatch nudges **immediately** (no 30d wait) when silent Wi‑Fi is not available. |

Keep existing age-only `shouldSilentUpdate` / `shouldNudge` for compatibility. Keep `canSilentDownloadNow` / Wi‑Fi heuristic and cellular silent-burn ban unchanged.

---

## Required hook (`src/hooks/useHkBasemap.ts`)

On every **focus / visibility(visible) / online** (and initial mount):

1. If offline or download busy → refresh local presence only; **do not wipe** pack.
2. New user (no local meta) → download on any network (existing).
3. Else **fetch manifest** (`cache: "no-store"` via existing `fetchHkBasemapManifest`).
4. **Same identity** (`!packOutOfDate`) → skip download, clear nudge.
5. **Out of date** →  
   - Wi‑Fi (`canSilentDownloadNow`) → **silent** download/swap (no toast).  
   - Else → **nudge** button immediately (any network on press).  
6. Manifest fetch failure → keep local pack; no wipe.

`refreshLocal` must **not** overwrite mismatch nudge with age-only `shouldNudge`.

---

## Done when

- New Release reaches clients without 7/30d wait and without manual cache clear / reinstall.
- Mismatch on Wi‑Fi → silent; mismatch on cellular/unknown → nudge now.
- Same sha/version → no download.
- Offline → keep local.
- This prompt file remains in the repo.

---

## Coordination

A sibling agent may edit basemap / pmtiles blob fallback. Prefer touching:

- `src/lib/hkBasemapPolicy.ts`
- `src/hooks/useHkBasemap.ts`
- related policy/hook-only files

Avoid `basemap.ts` / `pmtilesProtocol.ts` unless required.
