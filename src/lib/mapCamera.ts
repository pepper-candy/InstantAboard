import L from "leaflet";
import type { LatLng } from "./geo";
import {
  AUTOMATED_HARD_MS,
  beginAutomated,
  currentFlyVisibleGen,
  finishAutomated,
  nextFlyVisibleGen,
} from "./mapCameraBusy";

const DESKTOP_MQ = "(min-width: 840px)";
/** Live sheet cover clamp — never treat the map as fully covered. */
const SHEET_FRAC_MAX = 0.9;
/** After fly: snap if target still sits near geometric mid while sheet covers this much. */
const SNAP_SHEET_MIN = 0.3;
const SNAP_FULL_MID_PX = 16;

/** Close-range: skip lerp / use shorter duration floor. */
const NEARBY_DZOOM = 0.45;
const NEARBY_METERS = 320;
const NEARBY_INSTANT_DZOOM = 0.2;
const NEARBY_INSTANT_METERS = 120;
const NEARBY_DURATION_FLOOR = 0.4;
const FAR_DURATION_FLOOR = 0.8;

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

// Busy subscribe / prime / gen live in mapCameraBusy (SSR-safe; Board imports that).

/** invalidateSize when container and Leaflet size diverge (sheet / layout). */
function prepInvalidateSize(map: L.Map) {
  const el = map.getContainer();
  const size = map.getSize();
  if (
    Math.abs(el.clientWidth - size.x) > 0.5 ||
    Math.abs(el.clientHeight - size.y) > 0.5
  ) {
    map.invalidateSize({ pan: false, animate: false });
  }
}

/**
 * Offline pre-sim: compute end camera without writing intermediate frames.
 * Same gen cancel semantics via caller; errors → null (fall through).
 */
function preSimFlyEnd(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
): L.LatLng | null {
  try {
    return cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
  } catch {
    return null;
  }
}

function preSimFitZoom(
  map: L.Map,
  bounds: L.LatLngBounds,
  pad: { paddingTopLeft: L.Point; paddingBottomRight: L.Point },
  maxZoom: number,
): number | null {
  try {
    // Sum without mutating Leaflet Points (Point.add mutates).
    const warmPad = L.point(
      pad.paddingTopLeft.x + pad.paddingBottomRight.x,
      pad.paddingTopLeft.y + pad.paddingBottomRight.y,
    );
    const z = map.getBoundsZoom(bounds, false, warmPad);
    if (!Number.isFinite(z)) return null;
    return Math.min(z, maxZoom);
  } catch {
    return null;
  }
}

function isNearbyMove(map: L.Map, center: L.LatLng, zoom: number): boolean {
  const dZoom = Math.abs(zoom - map.getZoom());
  const distM = map.getCenter().distanceTo(center);
  return dZoom <= NEARBY_DZOOM && distM <= NEARBY_METERS;
}

function isInstantNearby(map: L.Map, center: L.LatLng, zoom: number): boolean {
  const dZoom = Math.abs(zoom - map.getZoom());
  const distM = map.getCenter().distanceTo(center);
  return dZoom <= NEARBY_INSTANT_DZOOM && distM <= NEARBY_INSTANT_METERS;
}

/**
 * Google-like fly duration from zoom delta + ground distance.
 * Far flights clamp ~0.8–2.5s; close-range floor ~0.4s.
 */
function flyDurationSec(map: L.Map, center: L.LatLng, zoom: number): number {
  const dZoom = Math.abs(zoom - map.getZoom());
  const distM = map.getCenter().distanceTo(center);
  const nearby = isNearbyMove(map, center, zoom);
  const floor = nearby ? NEARBY_DURATION_FLOOR : FAR_DURATION_FLOOR;
  const duration = floor + dZoom * 0.22 + Math.min(distM / 8000, 0.9);
  return Math.max(floor, Math.min(2.5, duration));
}

/** Front-loaded pan: Leaflet-like easeOut (easeLinearity 0.3). */
function easeOut(t: number, linearity = 0.3): number {
  return 1 - Math.pow(1 - t, 1 / linearity);
}

/** Back-loaded zoom-in: cubic easeIn so zoom rises in the second half of the pan. */
function easeInCubic(t: number): number {
  return t * t * t;
}

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
  if (gen !== currentFlyVisibleGen()) return;
  const frac = effectiveSheetFrac(map, sheetFrac);
  if (frac < SNAP_SHEET_MIN) return;
  const size = map.getSize();
  const pt = map.latLngToContainerPoint(L.latLng(lat, lng));
  if (Math.abs(pt.y - size.y / 2) > SNAP_FULL_MID_PX) return;
  setViewVisibleCenter(map, lat, lng, zoom, sheetFrac, { animate: false });
}

function revealFlyBest(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  center: L.LatLng,
) {
  map.setView(center, zoom, { animate: false });
  snapIfParkedAtFullMid(map, lat, lng, zoom, sheetFrac, currentFlyVisibleGen());
}

/**
 * Animate to visible-band center without Leaflet flyTo (CSS scale breaks GL canvas).
 * Busy wraps prep + move. Prep: invalidateSize if needed, live sheet, offline end pose.
 * Same zoom → panTo; zoom change → one continuous rAF lerp via setView({ animate: false }).
 * Pan uses easeOut; zoom-in uses easeIn (later); zoom-out tracks pan easeOut.
 * Close-range: instant setView or shorter duration floor (~0.4s). No phase pause.
 * Markers stay visible (no fade). prefers-reduced-motion → instant setView.
 * Hard 2s prep: must finish by then → reveal best-known. Busy clears on settle/cancel/busy-hard.
 */
export function flyVisible(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  sheetFrac: number,
  _kind?: "locate" | "routeStop",
): void {
  const gen = nextFlyVisibleGen();
  const t0 = performance.now();
  beginAutomated(gen);
  map.stop();

  // —— Prep (live size + sheet). Must finish before hard timeout. ——
  try {
    prepInvalidateSize(map);
  } catch {
    /* fall through */
  }

  let end =
    preSimFlyEnd(map, lat, lng, zoom, sheetFrac) ??
    cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);

  // Prep overran hard limit → reveal best-known, clear busy.
  if (performance.now() - t0 >= AUTOMATED_HARD_MS) {
    if (gen === currentFlyVisibleGen()) {
      revealFlyBest(map, lat, lng, zoom, sheetFrac, end);
      finishAutomated(gen);
    }
    return;
  }

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || isInstantNearby(map, end, zoom)) {
    if (gen !== currentFlyVisibleGen()) return;
    setViewVisibleCenter(map, lat, lng, zoom, sheetFrac, { animate: false });
    finishAutomated(gen);
    return;
  }

  // Recompute end with live sheet after prep (sheet may have settled).
  end = cameraForVisibleCenter(map, lat, lng, zoom, sheetFrac);
  const duration = flyDurationSec(map, end, zoom);
  const z0 = map.getZoom();

  if (Math.abs(zoom - z0) < 0.05) {
    if (gen !== currentFlyVisibleGen()) return;
    map.panTo(end, { animate: true, duration });
    map.once("moveend", () => {
      if (gen !== currentFlyVisibleGen()) return;
      snapIfParkedAtFullMid(map, lat, lng, zoom, sheetFrac, gen);
      finishAutomated(gen);
    });
    return;
  }

  const c0 = map.getCenter();
  const start = performance.now();
  const durMs = duration * 1000;
  const zoomIn = zoom > z0;

  const frame = (now: number) => {
    if (gen !== currentFlyVisibleGen()) return;
    const t = Math.min(1, (now - start) / durMs);
    const panE = easeOut(t);
    const zoomE = zoomIn ? easeInCubic(t) : panE;
    // Offset must use zNow — destination zoom mid-flight parks the pin at full-screen mid.
    const zNow = z0 + (zoom - z0) * zoomE;
    const liveEnd = cameraForVisibleCenter(map, lat, lng, zNow, sheetFrac);
    const latNow = c0.lat + (liveEnd.lat - c0.lat) * panE;
    const lngNow = c0.lng + (liveEnd.lng - c0.lng) * panE;
    map.setView(L.latLng(latNow, lngNow), zNow, { animate: false });
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      snapIfParkedAtFullMid(map, lat, lng, zoom, sheetFrac, gen);
      finishAutomated(gen);
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
 * Padded-fit center at a given zoom (Leaflet _getBoundsCenterZoom offset, no Point mutate).
 * Call with the frame's zNow so sheet pad stays correct through the zoom lerp.
 */
function fitCenterAtZoom(
  map: L.Map,
  bounds: L.LatLngBounds,
  pad: { paddingTopLeft: L.Point; paddingBottomRight: L.Point },
  zoom: number,
): L.LatLng {
  const ox = (pad.paddingBottomRight.x - pad.paddingTopLeft.x) / 2;
  const oy = (pad.paddingBottomRight.y - pad.paddingTopLeft.y) / 2;
  const sw = map.project(bounds.getSouthWest(), zoom);
  const ne = map.project(bounds.getNorthEast(), zoom);
  return map.unproject(L.point((sw.x + ne.x) / 2 + ox, (sw.y + ne.y) / 2 + oy), zoom);
}

/**
 * Target center+zoom for padded fitBounds (Leaflet _getBoundsCenterZoom, without mutating Points).
 * Padding already encodes sheet cover — do not also apply cameraForVisibleCenter.
 */
function fitCenterZoom(
  map: L.Map,
  bounds: L.LatLngBounds,
  pad: { paddingTopLeft: L.Point; paddingBottomRight: L.Point },
  maxZoom: number,
): { center: L.LatLng; zoom: number } {
  const warmPad = L.point(
    pad.paddingTopLeft.x + pad.paddingBottomRight.x,
    pad.paddingTopLeft.y + pad.paddingBottomRight.y,
  );
  let zoom = map.getBoundsZoom(bounds, false, warmPad);
  if (!Number.isFinite(zoom)) zoom = map.getZoom();
  zoom = Math.min(zoom, maxZoom);
  if (zoom === Infinity) {
    return { center: bounds.getCenter(), zoom: maxZoom };
  }
  return { center: fitCenterAtZoom(map, bounds, pad, zoom), zoom };
}

/**
 * Frame the full polyline in the visible band. Never Leaflet flyTo / CSS-scale fitBounds.
 * Busy wraps prep + move. Default: rAF zoom-out/in lerp (same feel as flyVisible).
 * opts.animate === false → instant setView. Hard 2s prep → reveal best-known.
 */
export function fitVisibleBounds(
  map: L.Map,
  points: LatLng[],
  sheetFrac: number,
  opts?: { animate?: boolean; maxZoom?: number },
): void {
  if (points.length < 2) return;
  const gen = nextFlyVisibleGen();
  const t0 = performance.now();
  beginAutomated(gen);
  map.stop();

  try {
    prepInvalidateSize(map);
  } catch {
    /* fall through */
  }

  const bounds = L.latLngBounds(points.map((p) => L.latLng(p.lat, p.lng)));
  const maxZoom = opts?.maxZoom ?? 16;
  let pad = visibleFitPadding(map, sheetFrac);
  preSimFitZoom(map, bounds, pad, maxZoom);

  const applyInstant = (p: typeof pad) => {
    const { center, zoom } = fitCenterZoom(map, bounds, p, maxZoom);
    map.setView(center, zoom, { animate: false });
  };

  if (performance.now() - t0 >= AUTOMATED_HARD_MS) {
    if (gen !== currentFlyVisibleGen()) return;
    pad = visibleFitPadding(map, sheetFrac);
    applyInstant(pad);
    finishAutomated(gen);
    return;
  }

  pad = visibleFitPadding(map, sheetFrac);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Default animated (route open zoom-out). Pass animate:false for hard snaps only.
  const animate = !reduce && opts?.animate !== false;

  if (gen !== currentFlyVisibleGen()) return;

  const { center: end, zoom } = fitCenterZoom(map, bounds, pad, maxZoom);

  if (!animate || isInstantNearby(map, end, zoom)) {
    map.setView(end, zoom, { animate: false });
    finishAutomated(gen);
    return;
  }

  const duration = flyDurationSec(map, end, zoom);
  const z0 = map.getZoom();

  if (Math.abs(zoom - z0) < 0.05) {
    map.panTo(end, { animate: true, duration });
    map.once("moveend", () => {
      if (gen !== currentFlyVisibleGen()) return;
      finishAutomated(gen);
    });
    return;
  }

  const c0 = map.getCenter();
  const start = performance.now();
  const durMs = duration * 1000;
  // Route open is usually zoom-out → track pan easeOut (same as flyVisible zoom-out).
  const zoomIn = zoom > z0;

  const frame = (now: number) => {
    if (gen !== currentFlyVisibleGen()) return;
    const t = Math.min(1, (now - start) / durMs);
    const panE = easeOut(t);
    const zoomE = zoomIn ? easeInCubic(t) : panE;
    // Live sheet pad + center at zNow (not destination zoom) through the zoom-out.
    const zNow = z0 + (zoom - z0) * zoomE;
    const livePad = visibleFitPadding(map, sheetFrac);
    const liveEnd = fitCenterAtZoom(map, bounds, livePad, zNow);
    const latNow = c0.lat + (liveEnd.lat - c0.lat) * panE;
    const lngNow = c0.lng + (liveEnd.lng - c0.lng) * panE;
    map.setView(L.latLng(latNow, lngNow), zNow, { animate: false });
    if (t < 1) requestAnimationFrame(frame);
    else finishAutomated(gen);
  };
  requestAnimationFrame(frame);
}
