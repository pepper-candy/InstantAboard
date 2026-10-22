import type { LatLng } from "./geo";

/**
 * Camera/service lock box — strictly inside pack/pan `HK_BOUNDS`
 * `[113.48, 22.05, 114.55, 22.78]` (west, south, east, north).
 * Automated fly/fit end targets clamp here; user pan still uses full HK_BOUNDS.
 */
export const HK_SERVICE_BOUNDS: [number, number, number, number] = [
  113.75, 22.12, 114.5, 22.6,
];

/** Nearest point on the service rect (inclusive edges). */
export function clampToServiceBounds(lat: number, lng: number): LatLng {
  const [west, south, east, north] = HK_SERVICE_BOUNDS;
  return {
    lat: Math.max(south, Math.min(north, lat)),
    lng: Math.max(west, Math.min(east, lng)),
  };
}
