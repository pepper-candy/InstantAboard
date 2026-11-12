import L from "leaflet";
import { HK_BOUNDS } from "./hkBasemapManifest";
import { getAutomatedCameraBusy } from "./mapCameraBusy";

/** Real LatLngBounds for getBoundsZoom. Client-only (imports Leaflet). */
export function packLatLngBounds(): L.LatLngBounds {
  return L.latLngBounds(
    L.latLng(HK_BOUNDS[1], HK_BOUNDS[0]),
    L.latLng(HK_BOUNDS[3], HK_BOUNDS[2]),
  );
}

type SavedLimits = {
  depth: number;
  maxBounds: L.LatLngBounds | null | undefined;
  viscosity: number;
  minZoom: number;
};

const lifted = new WeakMap<L.Map, SavedLimits>();

/** Valid LatLngBounds so Leaflet _limitCenter never sees null maxBounds. */
function worldLatLngBounds(): L.LatLngBounds {
  return L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));
}

/** `map.options.maxBounds` is a LatLngBoundsExpression; restore needs LatLngBounds. */
function savedMaxBounds(map: L.Map): L.LatLngBounds | null | undefined {
  const bounds = map.options.maxBounds;
  if (bounds == null) return bounds;
  if (bounds instanceof L.LatLngBounds) return bounds;
  try {
    const converted = L.latLngBounds(bounds);
    return converted.isValid() ? converted : null;
  } catch {
    return null;
  }
}

function packFillZoom(map: L.Map): number {
  const size = map.getSize();
  if (!size.x || !size.y || size.x < 8 || size.y < 8) return map.options.minZoom ?? 11;
  let z = 11;
  try {
    const filled = map.getBoundsZoom(packLatLngBounds(), false) - 0.2;
    if (Number.isFinite(filled)) z = Math.max(10, Math.min(12, filled));
  } catch {
    /* keep fallback */
  }
  return z;
}

export function isAutomatedCameraLimitsLifted(map: L.Map): boolean {
  return (lifted.get(map)?.depth ?? 0) > 0;
}

/** Drop Leaflet maxBounds / fill minZoom for a code-driven camera move. */
export function liftAutomatedCameraLimits(map: L.Map): void {
  const prev = lifted.get(map);
  if (prev) {
    prev.depth += 1;
    return;
  }
  lifted.set(map, {
    depth: 1,
    maxBounds: savedMaxBounds(map),
    viscosity: map.options.maxBoundsViscosity ?? 1,
    minZoom: map.options.minZoom ?? 11,
  });
  map.options.maxBounds = worldLatLngBounds();
  map.options.maxBoundsViscosity = 0;
  // Below pack-fill floor so whole-path fits can zoom out; not 0 (breaks pane pos).
  map.options.minZoom = 8;
}

/**
 * Restore user pan/zoom limits without panInsideBounds / setMinZoom snap,
 * so a just-framed automated view is kept.
 */
export function restoreAutomatedCameraLimits(map: L.Map): void {
  const prev = lifted.get(map);
  if (!prev) return;
  prev.depth -= 1;
  if (prev.depth > 0) return;
  lifted.delete(map);
  const saved = prev.maxBounds;
  map.options.maxBounds =
    saved instanceof L.LatLngBounds && saved.isValid() ? saved : packLatLngBounds();
  map.options.maxBoundsViscosity = prev.viscosity;
  map.options.minZoom = packFillZoom(map);
}

/**
 * Fill-zoom floor so the pack covers the pane (kills white island at min zoom).
 * Call on load / resize / invalidateSize. Fallback 11. Client-only.
 * Never setZoom / setMinZoom-snap — that fights automated whole-path frames.
 */
export function applyPackFillMinZoom(map: L.Map): number {
  if (getAutomatedCameraBusy() || isAutomatedCameraLimitsLifted(map)) {
    return map.options.minZoom ?? 11;
  }
  const size = map.getSize();
  // Pane not laid out yet — skip (avoid bad minZoom / blank GL); ResizeObserver will retry.
  if (!size.x || !size.y || size.x < 8 || size.y < 8) return map.getMinZoom();
  const z = packFillZoom(map);
  map.options.minZoom = z;
  return z;
}
