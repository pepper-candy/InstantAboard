import { interpolateAlong, pathLength, type LatLng } from "./geo";
import type { Arrival, Company, VehicleDot } from "./types";

const SPEED_KMH: Record<string, number> = {
  kmb: 18,
  ctb: 18,
  gmb: 16,
  nlb: 22,
  lrtfeeder: 20,
  lightRail: 28,
  mtr: 40,
  sunferry: 22,
  hkkf: 22,
  fortuneferry: 22,
  tram: 12,
};

export function estimateVehicle(
  pathToStop: LatLng[],
  arrivals: Arrival[],
  company: Company,
): VehicleDot | null {
  const gps = arrivals.find((a) => a.gps && a.lat != null && a.lng != null);
  if (gps && gps.lat != null && gps.lng != null) {
    return { lat: gps.lat, lng: gps.lng, gps: true };
  }
  const next = arrivals.find((a) => a.minutes != null);
  if (!next || next.minutes == null || pathToStop.length < 2) return null;
  const speedMs = ((SPEED_KMH[company] ?? 18) * 1000) / 3600;
  const remain = speedMs * next.minutes * 60;
  const max = pathLength(pathToStop);
  const along = interpolateAlong(pathToStop, Math.min(remain, max * 0.98));
  if (!along) return null;
  return { ...along, gps: false };
}

export function pathUpTo(stops: LatLng[], seq: number): LatLng[] {
  if (!stops.length) return [];
  return stops.slice(0, Math.max(1, Math.min(stops.length, seq + 1)));
}
