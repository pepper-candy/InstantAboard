import type { LatLng } from "./geo";
import { HK_BOUNDS } from "./hkBasemapManifest";

/**
 * Service / fly-pin box (west, south, east, north) — HK SAR + ~12 km buffer.
 * Strictly inside pack `HK_BOUNDS` so street/city zoom never shows white void.
 */
export const HK_SERVICE_BOUNDS: [number, number, number, number] = [
  113.75, 22.12, 114.5, 22.6,
];

/** Leaflet maxBounds from pack HK_BOUNDS [west, south, east, north] → SW/NE. SSR-safe (no Leaflet import). */
export const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [
  [HK_BOUNDS[1], HK_BOUNDS[0]],
  [HK_BOUNDS[3], HK_BOUNDS[2]],
];

/** Silent clamp to service rect (nearest edge). Safe for SSR — no Leaflet runtime. */
export function clampToServiceBounds(lat: number, lng: number): LatLng {
  const [w, s, e, n] = HK_SERVICE_BOUNDS;
  return {
    lat: Math.max(s, Math.min(n, lat)),
    lng: Math.max(w, Math.min(e, lng)),
  };
}