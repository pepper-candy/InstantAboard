# One-shot: branch + commit + push + gh pr create for HK offline PMTiles.
# Run from repo root in a working PowerShell (agent Shell was write-blocked).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

git fetch origin main
git checkout main
git pull --ff-only origin main
git checkout -b feat/hk-offline-pmtiles

git add `
  .github/workflows/hk-basemap.yml `
  scripts/build-hk-pmtiles.sh `
  scripts/ship-hk-offline-pr.ps1 `
  .gitignore `
  package.json `
  src/lib/basemap.ts `
  src/lib/hkBasemapManifest.ts `
  src/lib/hkBasemapCache.ts `
  src/lib/hkBasemapPolicy.ts `
  src/lib/pmtilesProtocol.ts `
  src/hooks/useHkBasemap.ts `
  src/components/UpdateMapToast.tsx `
  src/components/Providers.tsx `
  src/components/DataSources.tsx `
  src/app/globals.css

git status -sb
npm run build

git commit -m @"
Add HK offline PMTiles basemap pack with CI and update policy.

Ship daily Planetiler bake to Release tag hk-basemap, Bright-first hybrid client, and 7/30/new-user download rules without reverting Board/ETA/fly fixes.
"@

git push -u origin HEAD

gh pr create --title "HK offline PMTiles basemap (Bright-first)" --body @"
## Summary
- CI: daily + ``workflow_dispatch`` bakes Geofabrik HK → Planetiler ``hk.pmtiles`` (maxZoom 14, target <~150MB) to mutable Release tag ``hk-basemap`` with ``manifest.json``.
- Client: Bright online first paint; OPFS/Cache atomic pack swap; HK-bounds local PMTiles; outside HK stays OpenFreeMap Bright.
- Policy: new user any-network silent download; ≥7d + Wi‑Fi silent; ≥30d ``更新地圖`` / Update map toast (OfflineToast look) any-network on button.
- Attribution: OpenFreeMap/OpenMapTiles online + OSM ODbL for offline pack (Sources panel).

## First bake
Run **Actions → HK basemap (PMTiles) → Run workflow** once so ``manifest.json`` / ``hk.pmtiles`` exist. Client constant:
``https://github.com/pepper-candy/InstantAboard/releases/download/hk-basemap/manifest.json``
(override with ``NEXT_PUBLIC_HK_BASEMAP_MANIFEST_URL``).

## Done checklist
- [x] One PR only
- [x] CI daily + workflow_dispatch
- [x] Manifest schema; assets not in git
- [x] Bright online first paint
- [x] New user: any-network download + atomic swap
- [x] ≥7d + Wi‑Fi: silent update
- [x] ≥30d: 更新地圖 button, any-network
- [x] Outside HK: online Bright, not from HK pack
- [x] No revert of Board/ETA/fly fixes
- [ ] Build passes (run ``npm run build`` before merge)
- [x] Attribution OK

## Test plan
- [ ] ``workflow_dispatch`` publishes release assets
- [ ] Fresh install: Bright tiles immediately; pack downloads in background
- [ ] After pack: pan inside HK uses local; pan outside stays Bright online
- [ ] Simulate ≥30d meta → toast; offline toast wins when offline
"@
