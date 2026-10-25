$ErrorActionPreference = "Stop"
$root = "C:\Users\mongk\Desktop\tnf_working\InstantAboard"
$log = Join-Path $root "_pan_fix_log.txt"
function Log($m) { Add-Content -Path $log -Value $m -Encoding utf8 }

Set-Content -Path $log -Value "start $(Get-Date -Format o)" -Encoding utf8

# --- HomeMap.tsx ---
$home = Join-Path $root "src\components\HomeMap.tsx"
$h = Get-Content -Raw -Path $home
if ($h -notmatch "MapNavHandoff") {
  $h = $h -replace 'import \{ RouteLayer, type RouteOverlay \} from "./RouteMap";', "import { RouteLayer, type RouteOverlay } from `"./RouteMap`";`r`nimport { MapNavHandoff } from `"./MapNavHandoff`";"
  if ($h -notmatch "MapNavHandoff") { throw "HomeMap import replace failed" }
  $h = $h -replace '(<BrightBasemap />\r?\n)', "`$1        <MapNavHandoff />`r`n"
  if (($h -split "MapNavHandoff").Count -lt 3) { throw "HomeMap mount replace failed" }
  Set-Content -Path $home -Value $h -Encoding utf8 -NoNewline
  Log "HomeMap patched"
} else { Log "HomeMap already has MapNavHandoff" }

# --- RouteMap.tsx ---
$route = Join-Path $root "src\components\RouteMap.tsx"
$r = Get-Content -Raw -Path $route
if ($r -notmatch "MapNavHandoff") {
  if ($r -match 'from "@/lib/basemap"') {
    $r = $r -replace '(from "@/lib/basemap";)', "`$1`r`nimport { MapNavHandoff } from `"./MapNavHandoff`";"
  } else {
    $r = $r -replace '(from "react-leaflet";)', "`$1`r`nimport { MapNavHandoff } from `"./MapNavHandoff`";"
  }
  $r = $r -replace '(<BrightBasemap />\r?\n)', "`$1        <MapNavHandoff />`r`n"
  Set-Content -Path $route -Value $r -Encoding utf8 -NoNewline
  Log "RouteMap patched"
} else { Log "RouteMap already has MapNavHandoff" }

# --- basemap.ts: drop zoomend/moveend sync (pack subscribe only) ---
$bm = Join-Path $root "src\lib\basemap.ts"
$b = Get-Content -Raw -Path $bm
if ($b -match 'map\.on\("moveend", sync\);') {
  $b = $b -replace '\r?\n\s*map\.on\("moveend", sync\);', ""
  $b = $b -replace '\r?\n\s*map\.on\("zoomend", sync\);', ""
  $b = $b -replace '\r?\n\s*map\.off\("moveend", sync\);', ""
  $b = $b -replace '\r?\n\s*map\.off\("zoomend", sync\);', ""
  # keep one sync() after attach for initial mode
  if ($b -notmatch "sync\?\.\(\);\r?\n\s*unsub = subscribeHkBasemapChange") {
    $b = $b -replace '(unsub = subscribeHkBasemapChange\(sync\);)', "sync?.();`r`n      `$1"
  }
  Set-Content -Path $bm -Value $b -Encoding utf8 -NoNewline
  Log "basemap zoomend/moveend sync removed"
} else { Log "basemap already without moveend sync" }

# --- globals.css: MapLibre never steals gestures ---
$css = Join-Path $root "src\app\globals.css"
$c = Get-Content -Raw -Path $css
if ($c -notmatch "maplibregl-canvas") {
  $snip = @"

/* Gestures belong to Leaflet — MapLibre canvas must not eat pan/zoom. */
.home-map .maplibregl-map,
.home-map .maplibregl-canvas,
.home-map .maplibregl-canvas-container,
.map .maplibregl-map,
.map .maplibregl-canvas,
.map .maplibregl-canvas-container {
  pointer-events: none !important;
}
"@
  $c = $c + $snip
  Set-Content -Path $css -Value $c -Encoding utf8 -NoNewline
  Log "globals maplibre pointer-events added"
} else { Log "globals already has maplibregl rule" }

Log "done $(Get-Date -Format o)"
