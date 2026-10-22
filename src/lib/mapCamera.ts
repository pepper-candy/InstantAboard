import L from "leaflet";
import type { LatLng } from "./geo";

/** At ≥840px the board is a side column; map is full-height — ignore sheet bias. */
function effectiveSheetFrac(sheetFrac: number): number {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 840px)").matches) {
    return 0;
  }
  return sheetFrac;
}

/** Latlng under the vertical middle of the uncovered band above the sheet. */
export function visibleCenterLatLng(map: L.Map, sheetFrac: number): LatLng {
  const frac = effectiveSheetFrac(sheetFrac);
  const size = map.getSize();
  const y = (size.y * (1 - Math.max(0, Math.min(1, frac)))) / 2;
  const point = map.containerPointToLatLng(L.point(size.x / 2, y));
  return { lat: point.lat, lng: point.lng };
}

/** Camera center that places `lat,lng` at the visible-band mid (not full-screen mid). */
export function cameraForVisibleCenter(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
): L.LatLng {
  const frac = effectiveSheetFrac(sheetFrac);
  const sheetPx = Math.max(0, Math.min(1, frac)) * map.getSize().y;
  const p = map.project(L.latLng(lat, lng), zoom);
  p.y += sheetPx / 2;
  return map.unproject(p, zoom);
}

export function setViewVisibleCenter(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  opts?: { animate?: boolean },
) {
  map.setView(cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac), zoom, {
    animate: opts?.animate ?? false,
  });
}

/** Pan/setView so latlng sits in the uncovered band. `sheetFrac` 0 is a plain center. */
export function glideMap(map: L.Map, lat: number, lng: number, zoom: number, sheetFrac = 0) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const center = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
  if (reduce) {
    map.setView(center, zoom, { animate: false });
    return;
  }
  if (map.getZoom() !== zoom) {
    map.setView(center, zoom, { animate: true, duration: 0.45 });
    return;
  }
  map.panTo(center, { animate: true, duration: 0.45 });
}

/** Google-like fly duration from zoom delta + ground distance, clamped ~0.8–2.5s. */
function flyDurationSec(map: L.Map, center: L.LatLng, zoom: number): number {
  const dZoom = Math.abs(zoom - map.getZoom());
  const distM = map.getCenter().distanceTo(center);
  // Zoom dominates large far→street jumps; distance adds a bit for long pans at similar zoom.
  const duration = 0.8 + dZoom * 0.22 + Math.min(distM / 8000, 0.9);
  return Math.max(0.8, Math.min(2.5, duration));
}

/** Leaflet-like easeOut (easeLinearity 0.3). */
function easeOut(t: number, linearity = 0.3): number {
  return 1 - Math.pow(1 - t, 1 / linearity);
}

/** Bumps on each flyVisible so an in-flight rAF lerp aborts. */
let flyVisibleGen = 0;

/**
 * Animate to visible-band center without Leaflet flyTo (CSS scale breaks GL canvas).
 * Same zoom → panTo; zoom change → rAF lerp of center+zoom via setView({ animate: false }).
 * Markers stay visible (no fade). prefers-reduced-motion → instant setView.
 */
export function flyVisible(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  _kind?: "locate" | "routeStop",
): void {
  const center = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
  const gen = ++flyVisibleGen;
  map.stop();

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    map.setView(center, zoom, { animate: false });
    return;
  }

  const duration = flyDurationSec(map, center, zoom);
  const z0 = map.getZoom();
  if (Math.abs(zoom - z0) < 0.05) {
    map.panTo(center, { animate: true, duration });
    return;
  }

  const c0 = map.getCenter();
  const start = performance.now();
  const durMs = duration * 1000;

  const frame = (now: number) => {
    if (gen !== flyVisibleGen) return;
    const t = Math.min(1, (now - start) / durMs);
    const e = easeOut(t);
    const latNow = c0.lat + (center.lat - c0.lat) * e;
    const lngNow = c0.lng + (center.lng - c0.lng) * e;
    const zNow = z0 + (zoom - z0) * e;
    map.setView(L.latLng(latNow, lngNow), zNow, { animate: false });
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
