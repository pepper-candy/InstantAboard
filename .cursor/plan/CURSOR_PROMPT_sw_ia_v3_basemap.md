# CURSOR_PROMPT — SW ia-v3 + hk-basemap bypass

## Goal

Bump InstantAboard service worker to **`ia-v3`** so browsers drop the stale `ia-v2` shell without users clearing all site data. Stop the SW from pinning old HTML/JS and from interfering with `/hk-basemap` Range requests (esp. `hk.pmtiles`).

## Standing constraints

- Stack locked: MapLibre-Leaflet + OpenFreeMap Bright — no full MapLibre rewrite; never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys in app basemap path.
- Do not hide stop markers; leave L/R DivIcon shake alone.
- Prefer edits only to `public/sw.js`, `src/components/RegisterSw.tsx`, and this prompt. Sibling agents own basemap/pmtiles / `hkBasemapPolicy` / `useHkBasemap`.
- No npm / git from agent; Adrian handles install & commits.
- Keep / write `CURSOR_PROMPT_*.md` in repo (do not delete or gitignore).

## Bug (ia-v2)

`public/sw.js` used `CACHE = "ia-v2"` and cached **every same-origin GET**. That could:

1. Pin stale HTML/JS after deploys (“holding before cache” on mobile).
2. Interfere with `/hk-basemap/*` fetches, including **Range** on `hk.pmtiles`.

## Required changes

### 1. `public/sw.js`

| Rule | Behavior |
|------|----------|
| Cache name | `CACHE = "ia-v3"` (activate still deletes other keys except `TILE_CACHE`) |
| Lifecycle | `skipWaiting()` on install; `clients.claim()` on activate — unchanged |
| Precache | Still `cache.addAll(["/", "/add", "/icons/icon-192.png"])` into `ia-v3` |
| `/hk-basemap/*` | **Bypass SW entirely** — no `respondWith` (network + Range intact) |
| Navigate | **Network-first**; on failure fall back to cached `"/"` |
| Other same-origin GET | **Do not** `cache.put` every response — pass through so HTML/JS are not pinned |

### 2. `src/components/RegisterSw.tsx`

- Register with `{ updateViaCache: "none" }`.
- Call `registration.update()` on successful register (load) and again when `document.visibilityState === "visible"`.
- Listen once for `controllerchange` → if `sessionStorage` key `ia.sw.reloaded.v3` is unset, set it and `location.reload()` (prevents reload loops).

## Done when

1. Open app once online → new SW installs, skips waiting, claims; clients reload once via RegisterSw guard.
2. Fresh app shell/code (no clear-all-cache).
3. Basemap / pmtiles fetches under `/hk-basemap` are not SW-stale-cached.
4. This prompt file exists in the repo.

## Out of scope (siblings)

- Basemap policy, OpenFreeMap Bright wiring, pmtiles serving, marker/shake UI.
- Full MapLibre rewrite or third-party tile CDN keys.
