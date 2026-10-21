#!/usr/bin/env bash
# Build Hong Kong OpenMapTiles PMTiles from Geofabrik extract (Planetiler).
# Intended for GitHub Actions; phone never bakes tiles.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/tmp/hk-basemap}"
MAXZOOM="${MAXZOOM:-14}"
# west,south,east,north — Geofabrik HK coverage tightened
BOUNDS="${BOUNDS:-113.8,22.15,114.45,22.57}"
PLANETILER_VERSION="${PLANETILER_VERSION:-0.9.0}"
OSM_URL="${OSM_URL:-https://download.geofabrik.de/asia/china/hong-kong-latest.osm.pbf}"
REPO="${GITHUB_REPOSITORY:-pepper-candy/InstantAboard}"
RELEASE_TAG="${RELEASE_TAG:-hk-basemap}"

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

echo "==> Download Geofabrik HK OSM extract"
curl -L --fail --retry 3 -o hong-kong-latest.osm.pbf "$OSM_URL"

echo "==> Fetch Planetiler ${PLANETILER_VERSION}"
curl -L --fail -o planetiler.jar \
  "https://github.com/onthegomap/planetiler/releases/download/v${PLANETILER_VERSION}/planetiler.jar"

echo "==> Bake hk.pmtiles (maxzoom=${MAXZOOM}, bounds=${BOUNDS})"
java -Xmx6g -jar planetiler.jar \
  --osm-path=hong-kong-latest.osm.pbf \
  --output=hk.pmtiles \
  --bounds="$BOUNDS" \
  --maxzoom="$MAXZOOM" \
  --download=false \
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
  "bounds": [113.8, 22.15, 114.45, 22.57],
  "attribution": "© OpenStreetMap contributors"
}
EOF

echo "==> Built hk.pmtiles bytes=${BYTES} sha256=${SHA256}"
cat manifest.json
