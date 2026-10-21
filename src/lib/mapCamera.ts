import L from "leaflet";
import type { LatLng } from "./geo";

/** Latlng under the vertical middle of the uncovered band above the sheet. */
export function visibleCenterLatLng(map: L.Map, sheetFrac: number): LatLng {
  const size = map.getSize();
  const y = (size.y * (1 - Math.max(0, Math.min(1, sheetFrac)))) / 2;
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
  const sheetPx = Math.max(0, Math.min(1, sheetFrac)) * map.getSize().y;
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
  if (reduce || map.getZoom() !== zoom) {
    map.setView(center, zoom, { animate: false });
    return;
  }
  map.panTo(center, { animate: true, duration: 0.45 });
}
