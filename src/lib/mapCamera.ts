import L from "leaflet";
import type { LatLng } from "./geo";
import { prefetchRegionTiles } from "./prefetchTiles";

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

/** True while Leaflet is mid CSS zoom (ExactMarkers must not fight the transform). */
export function mapZoomAnimating(map: L.Map): boolean {
  return Boolean((map as L.Map & { _animatingZoom?: boolean })._animatingZoom);
}

type GlideMap = L.Map & { _iaGlide?: number };

const TILE_WAIT_MS = 900;

/** Abort in-flight glide (prefetch→zoom→frame pan). Call when leaving route detail. */
export function cancelGlideMap(map: L.Map) {
  const host = map as GlideMap;
  host._iaGlide = (host._iaGlide ?? 0) + 1;
  map.stop();
  map.getContainer().classList.remove("is-glide-marks", "is-glide-fade");
}

function whenTilesReady(map: L.Map): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off("load", finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, TILE_WAIT_MS);
    map.once("load", finish);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const loading = (map as L.Map & { _loading?: number })._loading;
        if (!loading) window.setTimeout(finish, 48);
      });
    });
  });
}

/**
 * Shared by recenter, station/taxi focus, route stop focus.
 * Pan → warm region tiles → digital zoom around target.
 * Location / station / route markers stay visible (no fade).
 */
export function glideMap(map: L.Map, lat: number, lng: number, zoom: number, sheetFrac = 0) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const host = map as GlideMap;
  const at = { lat, lng };
  // Clear any leftover fade class from older builds.
  map.getContainer().classList.remove("is-glide-marks", "is-glide-fade");

  if (reduce) {
    void prefetchRegionTiles(at, zoom);
    map.setView(cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac), zoom, { animate: false });
    return;
  }

  map.stop();
  const gen = (host._iaGlide ?? 0) + 1;
  host._iaGlide = gen;

  const curZoom = map.getZoom();
  const warm = prefetchRegionTiles(at, [zoom, curZoom]);

  const panCenter = cameraForVisibleCenter(map, lat, lng, curZoom, sheetFrac);
  const here = map.getCenter();
  const panClose =
    Math.abs(here.lat - panCenter.lat) < 0.00015 && Math.abs(here.lng - panCenter.lng) < 0.00015;
  const zoomClose = Math.abs(curZoom - zoom) < 0.05;

  const frameAfterZoom = () => {
    if (host._iaGlide !== gen) return;
    const want = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
    const mid = map.getCenter();
    if (Math.abs(mid.lat - want.lat) < 0.00012 && Math.abs(mid.lng - want.lng) < 0.00012) return;
    map.panTo(want, { animate: true, duration: 0.25 });
  };

  const zoomStep = () => {
    if (host._iaGlide !== gen) return;
    if (Math.abs(map.getZoom() - zoom) < 0.05) {
      frameAfterZoom();
      return;
    }
    // Warm destination tiles first, then digital zoom around the target pin.
    void warm.then(() => prefetchRegionTiles(at, zoom)).then(() => {
      if (host._iaGlide !== gen) return;
      map.once("zoomend", () => {
        void whenTilesReady(map).then(() => {
          if (host._iaGlide !== gen) return;
          frameAfterZoom();
        });
      });
      map.setZoomAround(L.latLng(lat, lng), zoom, { animate: true, duration: 0.5 });
    });
  };

  if (zoomClose) {
    if (!panClose) map.panTo(panCenter, { animate: true, duration: 0.55 });
    else frameAfterZoom();
    return;
  }

  if (panClose) {
    zoomStep();
    return;
  }

  map.once("moveend", zoomStep);
  map.panTo(panCenter, { animate: true, duration: 0.55 });
}
