import L from "leaflet";
import type { LatLng } from "./geo";

const DESKTOP_MQ = "(min-width: 840px)";
/** Live sheet cover clamp — never treat the map as fully covered. */
const SHEET_FRAC_MAX = 0.9;
/** After fly: snap if target still sits near geometric mid while sheet covers this much. */
const SNAP_SHEET_MIN = 0.3;
const SNAP_FULL_MID_PX = 16;

/** At ≥840px the board is a side column; map is full-height — ignore sheet bias. */
function isDesktopSideColumn(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

/**
 * Sheet cover from live DOM (`.sheet` height / map height).
 * Returns null when unmeasurable so callers can fall back to the passed frac.
 */
function liveSheetFrac(map: L.Map): number | null {
  if (typeof document === "undefined") return null;
  const sheet = document.querySelector(".sheet");
  if (!(sheet instanceof HTMLElement)) return null;
  const mapH = map.getSize().y;
  if (!(mapH > 0)) return null;
  const h = sheet.getBoundingClientRect().height;
  if (!Number.isFinite(h) || h <= 0) return null;
  return Math.max(0, Math.min(SHEET_FRAC_MAX, h / mapH));
}

/**
 * Narrow: prefer live `.sheet` rect over a possibly stale prop (e.g. 0).
 * Desktop side column: always 0.
 */
function effectiveSheetFrac(map: L.Map, sheetFrac: number): number {
  if (isDesktopSideColumn()) return 0;
  const live = liveSheetFrac(map);
  if (live != null) return live;
  return Math.max(0, Math.min(SHEET_FRAC_MAX, sheetFrac));
}

/** Latlng under the vertical middle of the uncovered band above the sheet. */
export function visibleCenterLatLng(map: L.Map, sheetFrac: number): LatLng {
  const frac = effectiveSheetFrac(map, sheetFrac);
  const size = map.getSize();
  const y = (size.y * (1 - frac)) / 2;
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
  const frac = effectiveSheetFrac(map, sheetFrac);
  const sheetPx = frac * map.getSize().y;
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

/** Front-loaded pan: Leaflet-like easeOut (easeLinearity 0.3). */
function easeOut(t: number, linearity = 0.3): number {
  return 1 - Math.pow(1 - t, 1 / linearity);
}

/** Back-loaded zoom-in: cubic easeIn so zoom rises in the second half of the pan. */
function easeInCubic(t: number): number {
  return t * t * t;
}

/** Bumps on each flyVisible / fitVisibleBounds so an in-flight rAF lerp aborts. */
let flyVisibleGen = 0;

/**
 * If the target still parks near the full-screen mid while the sheet covers
 * a meaningful band, snap once to the live visible-band center.
 */
function snapIfParkedAtFullMid(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  gen: number,
) {
  if (gen !== flyVisibleGen) return;
  const frac = effectiveSheetFrac(map, sheetFrac);
  if (frac < SNAP_SHEET_MIN) return;
  const size = map.getSize();
  const pt = map.latLngToContainerPoint(L.latLng(lat, lng));
  if (Math.abs(pt.y - size.y / 2) > SNAP_FULL_MID_PX) return;
  setViewVisibleCenter(map, lat, lng, zoom, sheetFrac, { animate: false });
}

/**
 * Animate to visible-band center without Leaflet flyTo (CSS scale breaks GL canvas).
 * Same zoom → panTo; zoom change → one continuous rAF lerp via setView({ animate: false }).
 * Pan uses easeOut; zoom-in uses easeIn (later); zoom-out tracks pan easeOut.
 * Markers stay visible (no fade). prefers-reduced-motion → instant setView.
 * While zoom lerps, end camera is recomputed each frame from live sheet px + fixed target.
 */
export function flyVisible(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  _kind?: "locate" | "routeStop",
): void {
  const gen = ++flyVisibleGen;
  map.stop();

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    map.setView(cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac), zoom, { animate: false });
    return;
  }

  const center0 = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
  const duration = flyDurationSec(map, center0, zoom);
  const z0 = map.getZoom();
  if (Math.abs(zoom - z0) < 0.05) {
    map.panTo(center0, { animate: true, duration });
    map.once("moveend", () => {
      snapIfParkedAtFullMid(map, lat, lng, zoom, sheetFrac, gen);
    });
    return;
  }

  const c0 = map.getCenter();
  const start = performance.now();
  const durMs = duration * 1000;
  const zoomIn = zoom > z0;

  const frame = (now: number) => {
    if (gen !== flyVisibleGen) return;
    const t = Math.min(1, (now - start) / durMs);
    const panE = easeOut(t);
    const zoomE = zoomIn ? easeInCubic(t) : panE;
    // Live sheet px + fixed target lat/lng at destination zoom → correct end pose.
    const end = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
    const latNow = c0.lat + (end.lat - c0.lat) * panE;
    const lngNow = c0.lng + (end.lng - c0.lng) * panE;
    const zNow = z0 + (zoom - z0) * zoomE;
    map.setView(L.latLng(latNow, lngNow), zNow, { animate: false });
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      snapIfParkedAtFullMid(map, lat, lng, zoom, sheetFrac, gen);
    }
  };
  requestAnimationFrame(frame);
}

/** Padding so fitBounds keeps the route in the uncovered band (sheet / desktop column). */
export function visibleFitPadding(map: L.Map, sheetFrac: number): {
  paddingTopLeft: L.Point;
  paddingBottomRight: L.Point;
} {
  const frac = effectiveSheetFrac(map, sheetFrac);
  const size = map.getSize();
  const sheetPx = frac * size.y;
  const pad = 24;
  return {
    paddingTopLeft: L.point(pad, pad),
    paddingBottomRight: L.point(pad, pad + sheetPx),
  };
}

/**
 * Frame the full polyline in the visible band. Never Leaflet flyTo.
 * Aborts in-flight flyVisible. Default: instant; short glide when animate is true.
 */
export function fitVisibleBounds(
  map: L.Map,
  points: LatLng[],
  sheetFrac: number,
  opts?: { animate?: boolean; maxZoom?: number },
): void {
  if (points.length < 2) return;
  flyVisibleGen += 1;
  map.stop();
  const bounds = L.latLngBounds(points.map((p) => L.latLng(p.lat, p.lng)));
  const pad = visibleFitPadding(map, sheetFrac);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = !reduce && Boolean(opts?.animate);
  map.fitBounds(bounds, {
    ...pad,
    animate,
    duration: animate ? 0.45 : undefined,
    maxZoom: opts?.maxZoom ?? 16,
  });
}
