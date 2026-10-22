#!/usr/bin/env bash
# Build OpenMapTiles PMTiles for the InstantAboard lock rectangle
# (HK + Macau + nearby Guangdong / Shenzhen) via Planetiler.
# Intended for GitHub Actions; phone never bakes tiles.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/tmp/hk-basemap}"
MAXZOOM="${MAXZOOM:-14}"
# west,south,east,north — must match client lock rectangle (task A)
BOUNDS="${BOUNDS:-113.48,22.05,114.55,22.78}"
PLANETILER_VERSION="${PLANETILER_VERSION:-0.9.0}"
GEOFABRIK_BASE="${GEOFABRIK_BASE:-https://download.geofabrik.de/asia/china}"
HK_OSM_URL="${HK_OSM_URL:-${GEOFABRIK_BASE}/hong-kong-latest.osm.pbf}"
MACAU_OSM_URL="${MACAU_OSM_URL:-${GEOFABRIK_BASE}/macau-latest.osm.pbf}"
GUANGDONG_OSM_URL="${GUANGDONG_OSM_URL:-${GEOFABRIK_BASE}/guangdong-latest.osm.pbf}"
REPO="${GITHUB_REPOSITORY:-pepper-candy/InstantAboard}"
RELEASE_TAG="${RELEASE_TAG:-hk-basemap}"
CLIPPED_PBF="hk-macau-sz-clipped.osm.pbf"

if ! command -v osmium >/dev/null 2>&1; then
  echo "ERROR: osmium (osmium-tool) is required to merge/clip extracts" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "==> Download Geofabrik extracts (HK + Macau + Guangdong)"
curl -L --fail --retry 3 -o hong-kong-latest.osm.pbf "$HK_OSM_URL"
curl -L --fail --retry 3 -o macau-latest.osm.pbf "$MACAU_OSM_URL"
curl -L --fail --retry 3 -o guangdong-latest.osm.pbf "$GUANGDONG_OSM_URL"

echo "==> Merge extracts + clip to bounds=${BOUNDS}"
osmium merge \
  hong-kong-latest.osm.pbf \
  macau-latest.osm.pbf \
  guangdong-latest.osm.pbf \
  -o merged-hk-macau-gd.osm.pbf \
  --overwrite
osmium extract \
  --bbox="$BOUNDS" \
  --strategy=complete_ways \
  merged-hk-macau-gd.osm.pbf \
  -o "$CLIPPED_PBF" \
  --overwrite
rm -f merged-hk-macau-gd.osm.pbf

echo "==> Fetch Planetiler ${PLANETILER_VERSION}"
curl -L --fail -o planetiler.jar \
  "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"

echo "==> Pre-download water polygons (FAU mirror; osmdata often unreachable from GHA)"
mkdir -p data/sources
WATER_ZIP="data/sources/water-polygons-split-3857.zip"
WATER_URLS=(
  "https://ftp.fau.de/mirrors/openstreetmapdata.com-archive/2026-08-25/water-polygons-split-3857.zip"
  "https://osmdata.openstreetmap.de/download/water-polygons-split-3857.zip"
)
ok=0
for url in "${WATER_URLS[@]}"; do
  echo "==> Trying $url"
  if curl -L --fail --retry 4 --retry-all-errors --retry-delay 5 \
      --connect-timeout 20 --max-time 1800 \
      -o "$WATER_ZIP" "$url"; then
    ok=1
    break
  fi
  echo "==> Failed: $url"
done
if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: could not download water polygons from any mirror" >&2
  exit 1
fi

echo "==> Bake hk.pmtiles (maxzoom=${MAXZOOM}, bounds=${BOUNDS}, osm=${CLIPPED_PBF})"
java -Xmx6g -jar planetiler.jar \
  --osm-path="$CLIPPED_PBF" \
  --output=hk.pmtiles \
  --bounds="$BOUNDS" \
  --maxzoom="$MAXZOOM" \
  --download \
  --water-polygons-path=data/sources/water-polygons-split-3857.zip \
  --http-timeout=300s \
  --http-retries=5 \
  --http-retry-wait=10s \
  --force

BYTES="$(wc -c < hk.pmtiles | tr -d ' ')"
SHA256="$(sha256sum hk.pmtiles | awk '{print $1}')"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
VERSION="$(date -u +%Y-%m-%d)"
ASSET_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}/hk.pmtiles"

cat > manifest.json <<EOF
{
  "version": "${VERSION}",
  "builtAt": "${BUILT_AT}",
  "url": "${ASSET_URL}",
  "bytes": ${BYTES},
  "sha256": "${SHA256}",
  "minZoom": 0,
  "maxZoom": ${MAXZOOM},
  "bounds": [113.48, 22.05, 114.55, 22.78],
  "attribution": "© OpenStreetMap contributors"
}
EOF

echo "==> Built hk.pmtiles bytes=${BYTES} sha256=${SHA256}"
cat manifest.json
