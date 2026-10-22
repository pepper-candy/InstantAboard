import L from "leaflet";
import { HK_BOUNDS } from "./hkBasemapManifest";

/** Real LatLngBounds for getBoundsZoom. Client-only (imports Leaflet). */
export function packLatLngBounds(): L.LatLngBounds {
  return L.latLngBounds(
    L.latLng(HK_BOUNDS[1], HK_BOUNDS[0]),
    L.latLng(HK_BOUNDS[3], HK_BOUNDS[2]),
  );
}

/**
 * Fill-zoom floor so the pack covers the pane (kills white island at min zoom).
 * Call on load / resize / invalidateSize. Fallback 11. Client-only.
 */
export function applyPackFillMinZoom(map: L.Map): number {
  const size = map.getSize();
  // Pane not laid out yet — skip (avoid bad minZoom / blank GL); ResizeObserver will retry.
  if (!size.x || !size.y || size.x < 8 || size.y < 8) return map.getMinZoom();
  let z = 11;
  try {
    const filled = map.getBoundsZoom(packLatLngBounds(), false) - 0.2;
    if (Number.isFinite(filled)) z = Math.max(10, Math.min(12, filled));
  } catch {
    /* keep fallback */
  }
  map.setMinZoom(z);
  if (map.getZoom() < z) map.setZoom(z, { animate: false });
  return z;
}