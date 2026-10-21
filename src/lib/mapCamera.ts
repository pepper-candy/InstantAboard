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

export type FlyKeep = "locate" | "routeStop";

const FLY_CLASS = "is-fly";
const FLY_KIND: Record<FlyKeep, string> = {
  locate: "is-fly-locate",
  routeStop: "is-fly-route",
};

let flyGen = 0;

function clearFlyClasses(el: HTMLElement) {
  el.classList.remove(FLY_CLASS, FLY_KIND.locate, FLY_KIND.routeStop);
}

/**
 * Short pan/setView to visible-band center with marker fade classes.
 * No prefetch / tile-wait chain. Generation token cancels stale moveend clears.
 */
export function flyVisible(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  kind: FlyKeep,
): void {
  const el = map.getContainer();
  const gen = ++flyGen;
  const kindClass = FLY_KIND[kind];
  clearFlyClasses(el);
  el.classList.add(FLY_CLASS, kindClass);

  const finish = () => {
    if (gen !== flyGen) return;
    map.off("moveend", onEnd);
    window.clearTimeout(fallback);
    clearFlyClasses(el);
  };
  const onEnd = () => finish();
  const fallback = window.setTimeout(finish, 600);
  map.once("moveend", onEnd);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    setViewVisibleCenter(map, lat, lng, zoom, sheetFrac, { animate: false });
    finish();
    return;
  }

  const center = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
  if (map.getZoom() !== zoom) {
    map.setView(center, zoom, { animate: true, duration: 0.45 });
    return;
  }
  map.panTo(center, { animate: true, duration: 0.45 });
}
