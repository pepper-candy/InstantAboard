# InstantAboard PR #29 — gate fix (plan then build)

Repo: pepper-candy/InstantAboard  
Branch: **feat/hk-offline-pmtiles** only.  
Do **not** open a new PR. Do **not** rebase onto main again. One fix commit on this branch.

## How to work
1. **PLAN first** — list the exact files you will edit and the 4 fixes below (CSS, attribution, pending sync, remove prompt). Wait for no further input; then execute.
2. **BUILD** — implement every fix, run `npm run build`, fix until green.
3. **COMMIT + PUSH** — one commit to `feat/hk-offline-pmtiles`.

## Goal
Clear Grok gate BLOCK on head ~`41ca4e9`:
- UpdateMapToast tappable (CSS)
- Offline OSM attribution when local pack active
- applyMode does not drop pack-ready sync
- Prompt markdown removed from git
- `npm run build` green

## Do NOT touch
- Board sheet / soft-lift / hug / grab cycle
- ETA / useEtas / liveFetch timeout
- flyVisible / glideMap / zoomAnimation
- HomeMap / RouteMap structure (keep BrightBasemap)
- CI Planetiler bake logic
- 7d / 30d / new-user policy semantics

---

## Fix 1 — UpdateMapToast untappable (MERGE BLOCKER)

**Problem:** `UpdateMapToast` uses `className="offline-toast update-map-toast"`. `.offline-toast` has `pointer-events: none`. **No** `.update-map-toast*` rules exist in `src/app/globals.css`.

**Do:** In `src/app/globals.css`, immediately after `.offline-toast.is-out { … }`, append:

```css
.update-map-toast {
  pointer-events: auto;
  gap: 12px;
  border-radius: 20px;
  padding: 10px 12px 10px 16px;
  max-width: min(420px, calc(100vw - 24px));
}

.update-map-toast-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.update-map-toast-title {
  font-size: 14px;
  font-weight: 800;
  line-height: 1.15;
}

.update-map-toast-sub {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.92;
  line-height: 1.2;
}

.update-map-toast-btn {
  flex: none;
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  background: #fff;
  color: var(--danger);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.01em;
  line-height: 1.1;
  cursor: pointer;
  pointer-events: auto;
}

.update-map-toast-btn:disabled {
  opacity: 0.7;
  cursor: progress;
}
```

Do **not** change `.offline-toast` itself.

---

## Fix 2 — Wire HK_OFFLINE_ATTRIBUTION (MERGE BLOCKER)

**File:** `src/lib/basemap.ts`

**Problem:** `HK_OFFLINE_ATTRIBUTION` exported but never applied; layer always uses `OPENFREEMAP_ATTRIBUTION`.

**Do:**
1. Keep Bright-first create with `OPENFREEMAP_ATTRIBUTION`.
2. Add `setBasemapAttribution(html: string)` for this Leaflet map (prefer attributionControl / maplibre-gl-leaflet API; else safely update `.leaflet-control-attribution` on `map.getContainer()`).
3. After successful **local** style: `setBasemapAttribution(HK_OFFLINE_ATTRIBUTION)`.
4. After successful **online** Bright (including catch fallbacks): `setBasemapAttribution(OPENFREEMAP_ATTRIBUTION)`.
5. Leave `DataSources.tsx` unchanged.

---

## Fix 3 — applyMode pending resync

**File:** `src/lib/basemap.ts` in `BrightBasemap` effect.

**Problem:** `if (applyingRef.current) return;` drops sync while style swap runs.

**Do:**
- Add `pendingSyncRef` (ref or effect-local flag).
- If entered while applying: set pending = true and return.
- In `finally`: clear applying; if pending, clear pending and call `sync()` again.

---

## Fix 4 — Remove prompt from PR

```bash
git rm --cached CURSOR_PROMPT_hk_offline_pmtiles.md || git rm CURSOR_PROMPT_hk_offline_pmtiles.md
```

Add to `.gitignore`:

```
CURSOR_PROMPT_*.md
```

Do not re-commit any `CURSOR_PROMPT_*.md`.

---

## Already done — do not regress
- Named `addProtocol` / `setWorkerUrl` / `AddProtocolAction` / `MaplibreErrorEvent` (no default `maplibre-gl` import)
- `addProtocol("pmtiles", protocol.tile as AddProtocolAction)`
- Vendored protocol + cache/policy/hook/toast + CI workflow

---

## Verify then ship
1. `npm run build` passes
2. Grep: `update-map-toast` in `globals.css`
3. Grep: `HK_OFFLINE_ATTRIBUTION` **used** in `basemap.ts` (not only exported)
4. `git ls-files` has no `CURSOR_PROMPT_hk_offline_pmtiles.md`
5. Commit: `fix: update-map toast CSS, offline attribution, pending sync`
6. `git push origin feat/hk-offline-pmtiles`

## Out of scope (human later)
GitHub Actions → **HK basemap** → `workflow_dispatch` first bake. Do not commit `.pmtiles` or fake a pack.

**Plan first, then build, then one commit + push.**
