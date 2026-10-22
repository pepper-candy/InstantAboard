# InstantAboard — PMTiles blob slice + Bright fallback

Workspace: InstantAboard (MapLibre-Leaflet + OpenFreeMap Bright locked stack).

## Standing rules

1. Plan-first bullets then implement (no approval wait).
2. No UI/browser tests.
3. No npm/git (Adrian handles). Edit files only.
4. Keep / write `CURSOR_PROMPT_*.md` in repo — do not delete or gitignore them.
5. Dense literal diffs; locked stack MapLibre-Leaflet + OpenFreeMap Bright — no full MapLibre rewrite, never `tile.openstreetmap.org` / Esri / Carto / MapTiler keys; do not hide stop markers; leave L/R DivIcon shake alone.

## Bug

Offline pack uses a `blob:` object URL. Vendored `pmtilesProtocol` used `FetchSource` which calls `fetch(url, { headers: Range })`. Browsers reject Range on `blob:` → `TypeError: Failed to fetch` → blank map.

`BrightBasemap` also short-circuited recovery: `if (hasPack()) return` in the online / catch paths blocked OpenFreeMap Bright fallback when the local pack was broken.

## Fix

### 1. `src/lib/pmtilesProtocol.ts` — BlobSource

- **`blob:` URLs** → `BlobSource`: resolve Blob once per URL (cached `Map`), then `getBytes` via `blob.slice(offset, offset + length).arrayBuffer()`.
- **HTTP(S) URLs** → keep `FetchSource` + `Range` header.
- `PMTiles` picks source via `createSource(url)` (`url.startsWith("blob:")`).

### 2. `src/lib/basemap.ts` — Bright fallback

- On local style/tile failure: `clearLocalPack()` **once** (session flag `clearedBrokenPackOnce`), then `setStyle(OPENFREEMAP_BRIGHT)` + `OPENFREEMAP_ATTRIBUTION`.
- Soften `hasPack()` early-returns so a cleared / broken pack can fall through to online Bright.
- Boot path: same clear-once + fall-through if local first paint fails.

### 3. `src/lib/hkBasemapCache.ts` — pack reader epoch

- `PACK_READER_EPOCH = 2` stored at `ia.v1.hkBasemap.packReaderEpoch`.
- `migratePackReaderEpoch()`: if stored epoch `< 2` and `hasPack()` → `clearLocalPack()`, then set epoch to `2` (always advance epoch). Clients re-download without a manual site-data clear.
- Called at start of `BrightBasemap` boot.

## Done when

- Blob packs render (no Range-on-blob TypeError).
- Broken pack falls back to Bright + OpenFreeMap attribution.
- Epoch migrates once per client.
- This prompt file stays in the repo.
