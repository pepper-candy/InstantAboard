# InstantAboard — HK offline basemap (ONE PR) — FULL PLAN FOR CURSOR MULTITASK / AUTO

You are implementing InstantAboard offline Hong Kong map caching for Adrian (pepper-candy).
Repo: **https://github.com/pepper-candy/InstantAboard**
Base: latest **`main`** (includes `b186fc22` “temp work on local”).

**Output shape:** exactly **one** branch + **one** pull request. Multitask/subagents OK internally; do not open multiple PRs.

---

## 0. What already landed on main — DO NOT REVERT

Keep these as-is (Adrian just pushed):

1. **OpenFreeMap Bright** online basemap via `src/lib/basemap.ts` (`BrightBasemap`, `@maplibre/maplibre-gl-leaflet`, style `https://tiles.openfreemap.org/styles/bright`, worker under `/maplibre/…`).
2. **Fly zoom snap fix:** `zoomAnimation={true}` on HomeMap + RouteMap MapContainers; `glideMap` / `flyVisible` animate when zoom changes (only snap for `prefers-reduced-motion`).
3. **Board sheet:** route enter/exit settles via `useLayoutEffect` + `SHEET_DEFAULT`; atMax hug snap skipped while route open; grab toggle cycles **hi → mid → lo → hi**.
4. **ETA:** `useEtas` always `loadPin(..., true)`; `liveFetch` 10s `AbortSignal.timeout`.

Do **not** rewrite sheet hug / soft-lift / Board drag. Do **not** go back to `tile.openstreetmap.org`. Do **not** call Leaflet `map.flyTo` (scale drifts route line with MapLibre bridge — existing comment in RouteMap).

---

## 1. Product goal (why)

- Inside **Hong Kong**: no grey basemap tiles (offline / flaky mobile data). Whole HK region pre-cached on the phone as **one versioned vector pack**.
- **Outside HK**: do **not** cache; keep loading **online OpenFreeMap Bright** instantly if the user pans the world.
- Updates: CI publishes daily; phone does **not** download every day. Quiet Wi‑Fi refresh when pack is old enough; nudge only if very stale; new users get pack ASAP without a broken first paint.

---

## 2. Architecture (who does what)

| Actor | Job |
|---|---|
| **GitHub Actions (CI)** | Daily: download Geofabrik HK OSM → bake `hk.pmtiles` → upload Release/pages asset → publish stable `manifest.json`. Phone never bakes tiles. |
| **User mobile / PWA** | Read manifest; download pack when policy says so; store locally; **atomic swap**; prefer local tiles for HK bounds; Bright online otherwise / until pack ready. |

**Not:** per-tile “replace one PNG when a road changes.” Updates = **whole pack** version swap.

---

## 3. Data & legal

- Source: Geofabrik HK extract  
  `https://download.geofabrik.de/asia/china/hong-kong-latest.osm.pbf` (~36MB raw OSM, updates ~daily on their side).
- License: **ODbL** — free to download/use/commercialize with **© OpenStreetMap** attribution (and keep OpenFreeMap / OpenMapTiles credits on online Bright).
- Coverage: Geofabrik HK polygon (optionally tighten bbox ≈ `113.8–114.45°E`, `22.15–22.57°N`). Region = **Hong Kong only**.
- OpenFreeMap has **no** HK-only download (only Monaco + full planet ~170GB). Do **not** put OFM planet on phones. Online Bright for non-HK + first paint is fine.

---

## 4. Locked update policy (implement exactly)

Constants (name them clearly in code, e.g. `HK_UPDATE_MIN_AGE_DAYS = 7`, `HK_NUDGE_AGE_DAYS = 30`):

### 4.1 CI
- Rebuild + republish **daily** (`schedule` cron UTC OK) + `workflow_dispatch`.

### 4.2 Returning user — silent auto update
- Only if local pack age (today − local `version`/`builtAt` date) **≥ 7 days**.
- And only on **Wi‑Fi**.
- Then: download → verify → **atomic swap**.
- **No toast / no ping.**

### 4.3 Returning user — forced nudge
- If pack age **≥ 30 days** (user always on cellular, update interrupted, or didn’t open app forever):
- Show toast **styled like** existing `src/components/OfflineToast.tsx` (已離線 look).
- Copy:
  - ZH title/button: **更新地圖**
  - EN: **Update map**
  - Optional short subtitle: 地圖資料已過期 / Map data outdated
- Control is a **button**. On press: download on **any** network (ignore Wi‑Fi check), then atomic swap; dismiss/busy state while downloading.

### 4.4 New user (no local pack yet)
- Start download on **any** network immediately (don’t wait for Wi‑Fi).
- Map must already show **online Bright** (no grey / blank first open — critical so they don’t abandon the app).
- When download finishes: **atomic swap** to local HK pack (seamless).

### 4.5 Wi‑Fi detection heuristic (document in code comment)
- Prefer `navigator.connection?.type === 'wifi'` when Network Information API exists.
- If missing: treat as allowed-for-silent-update only when online AND `saveData !== true` AND type is not obviously `cellular` / `slow-2g` / `2g` / `3g`. If still unknown, **skip silent update** (wait for 30-day button or next chance) — never burn cellular silently.
- Manual **更新地圖** and **new-user** paths ignore this and always download when online.

---

## 5. Stack constraints (locked)

- Keep **react-leaflet** for markers / `RouteLayer` / sim.
- Online: keep current Bright MapLibre-GL-Leaflet layer.
- Offline pack: **PMTiles** vector, OpenMapTiles / Planetiler schema compatible with Bright-style rendering.
- Cap **maxZoom ~14–15** (target ideally **&lt; ~150MB**; write real size in PR description).
- **Never commit** multi‑hundred‑MB `.pmtiles` into the git tree. Host via **GitHub Release** assets (preferred) or gh-pages; manifest holds absolute HTTPS URL.
- Libraries: add `pmtiles` (and whatever minimal glue MapLibre needs for `pmtiles://` / Protocol). Prefer OPFS for the blob store on modern mobile Chrome/Safari where available; fall back to Cache Storage if needed.
- No `tile.openstreetmap.org`. No prefetch tile grids. No whole-app port off Leaflet.

---

## 6. CI workflow (must land in PR)

Add `.github/workflows/hk-basemap.yml` + `scripts/build-hk-pmtiles.sh` (or equivalent):

1. Checkout.
2. Download `hong-kong-latest.osm.pbf` from Geofabrik.
3. Run **Planetiler** (or documented OpenMapTiles pipeline) → `hk.pmtiles` with maxzoom 14 or 15, HK bounds.
4. `sha256sum` + byte size.
5. Upload assets to a mutable Release e.g. tag/name **`hk-basemap`** (`hk.pmtiles`, `manifest.json`) using `gh release upload --clobber` or soft-latest pattern.
6. Publish `manifest.json`:

```json
{
  "version": "YYYY-MM-DD",
  "builtAt": "<ISO-8601>",
  "url": "<absolute https URL to hk.pmtiles>",
  "bytes": 0,
  "sha256": "<hex>",
  "minZoom": 0,
  "maxZoom": 15,
  "bounds": [west, south, east, north],
  "attribution": "© OpenStreetMap contributors"
}
```

7. App config: single constant for manifest URL (env or `src/lib/hkBasemapManifest.ts`), stable across releases.

If Actions can’t finish a full Planetiler bake inside the PR author’s machine/time limits: still ship workflow + scripts + client; PR must say “run **workflow_dispatch** once to publish first pack.” Never ship a “ready” client that points at a 404 with no documented first bake. Optional tiny fixture only for unit tests — not production empty pack.

Permissions: `contents: write` for releases if needed; document required repo settings.

---

## 7. Client modules (suggested layout — rename only if clearer)

| Path | Responsibility |
|---|---|
| `src/lib/hkBasemapManifest.ts` | Manifest type, fetch, compare version/age days |
| `src/lib/hkBasemapCache.ts` | OPFS/Cache read/write; download with progress; sha256/bytes verify; **atomic swap** (temp → verify → flip active pointer → delete old); expose `getLocalPack()`, `hasPack()`, `localBuiltAt()` |
| `src/lib/hkBasemapPolicy.ts` | Pure helpers: `shouldSilentUpdate`, `shouldNudge`, `isNewUser`, Wi‑Fi check |
| `src/hooks/useHkBasemap.ts` | Orchestrates: Bright-first, kick downloads, age checks on visibility/focus, nudge state |
| `src/components/UpdateMapToast.tsx` | Mirror OfflineToast visuals; button 更新地圖 / Update map |
| Wire `src/lib/basemap.ts` / HomeMap / RouteMap | Hybrid layer: online Bright always available; when local pack active and map view intersects HK bounds, serve from PMTiles (or style that uses local tiles for HK). Outside bounds → online only. |

### Atomic swap (required behavior)
1. Download to `hk.<version>.pmtiles.partial` (or OPFS temp).
2. Verify `bytes` + `sha256`.
3. Rename/move to final; write local meta `{ version, builtAt, sha256 }`.
4. Point active reader at new file; then delete previous pack.
5. Never delete old pack before new one verifies (avoid grey gap mid-update).

### First paint (required)
- Mount Bright online **immediately**.
- Start HK download in background for new users.
- Swap only when verified — no blocking splash that leaves map grey.

---

## 8. UX / i18n

- Reuse OfflineToast layout/CSS patterns (red/wide chunky affordance if that’s the shared toast language — match existing, don’t invent a third toast system).
- Bilingual via existing `i18n` / lang setting if the app has one; else ZH+EN strings beside OfflineToast style.
- Silent path: zero UI.
- Nudge path: one toast with button; tapping starts download (show busy/progress on button if easy).
- Do not stack with offline toast awkwardly — if offline, offline wins; map update when back online.

---

## 9. Attribution

- Keep OpenFreeMap + OpenMapTiles + OSM on online Bright (already in `OPENFREEMAP_ATTRIBUTION`).
- Offline pack: OSM attribution still required (ODbL produced work). Sources panel / map attribution must remain honest.

---

## 10. Explicit bans

- Daily cellular downloads for returning users.
- Per-tile patch protocol / “replace one pic.”
- Committing large `hk.pmtiles` into git main tree / LFS spam without Release hosting.
- Rewriting app to pure MapLibre (lose Leaflet overlays).
- Breaking sheet hug, soft-lift, flyVisible fades, zoomAnimation=true.
- Hammering OFM beyond reasonable use; no planet download.
- Fake “pack ready” with empty/missing URL.

---

## 11. Implementation order (for Multitask)

1. Inspect: `basemap.ts`, `HomeMap.tsx`, `RouteMap.tsx`, `OfflineToast.tsx`, `i18n`, PWA/service worker if any, existing `.github/workflows`.
2. Add CI script + workflow + manifest contract + client constant for manifest URL.
3. Implement cache + policy + hook.
4. Wire Bright-first hybrid basemap + UpdateMapToast.
5. `npm run build` / lint / typecheck green.
6. Open **one** PR with description covering: manifest URL, how to `workflow_dispatch` first bake, 7/30/new-user rules, expected pack size, Wi‑Fi heuristic, self-review checklist of every locked rule.

---

## 12. Done checklist (PR body must tick)

- [ ] One PR only  
- [ ] CI daily + workflow_dispatch  
- [ ] Manifest schema as above; assets not in git  
- [ ] Bright online first paint  
- [ ] New user: any-network download + atomic swap  
- [ ] ≥7d + Wi‑Fi: silent update  
- [ ] ≥30d: 更新地圖 button, any-network  
- [ ] Outside HK: online Bright, not from HK pack  
- [ ] No revert of b186fc22 Board/ETA/fly fixes  
- [ ] Build passes  
- [ ] Attribution OK  

---

## 13. Hypotheses (non-binding — verify)

- MapLibre GL Leaflet may need a custom protocol registration to read OPFS-backed PMTiles; if bridge is awkward, a thin MapLibre style swap on the same leaflet layer is OK as long as Leaflet overlays stay.
- GitHub Release “latest” asset URLs can be brittle; prefer release tag `hk-basemap` updated in place + manifest JSON that always points at the current asset URL.

Investigate and pick the cleanest approach that matches outcomes.

**Start now. Ship one PR.**
