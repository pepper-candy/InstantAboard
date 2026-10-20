import { haversine, type LatLng } from "./geo";
import type { Company, EtaDb, Pin, RouteListEntry } from "./types";

export function nearestStop(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
  origin: LatLng,
): { stopId: string; stopSeq: number } | null {
  const ids = route.stops[company] ?? [];
  let best: { stopId: string; stopSeq: number; d: number } | null = null;
  for (let i = 0; i < ids.length; i++) {
    const stop = db.stopList[ids[i]];
    if (!stop) continue;
    const d = haversine(origin, stop.location);
    if (!best || d < best.d) best = { stopId: ids[i], stopSeq: i, d };
  }
  return best;
}

/** Closest stop on one route direction. Used by locate, detail open, and direction swap. */
export function closestStopOnRoute(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
  origin: LatLng,
): { stopId: string; stopSeq: number } | null {
  return nearestStop(db, route, company, origin);
}

export function closestStopForPin(
  db: EtaDb,
  pin: Pin,
  origin: LatLng,
  routeId = pin.routeId,
): { stopId: string; stopSeq: number } | null {
  const route = db.routeList[routeId];
  if (!route) return null;
  return closestStopOnRoute(db, route, pin.company, origin);
}

export function resolvePin(db: EtaDb | null, pin: Pin, origin: LatLng | null): Pin {
  if (!db || !origin) return pin;
  if (pin.auto === false && pin.stopId) return pin;
  const route = db.routeList[pin.routeId];
  if (!route) return pin;
  const near = nearestStop(db, route, pin.company, origin);
  if (!near) return pin;
  return { ...pin, stopId: near.stopId, stopSeq: near.stopSeq, auto: true };
}

export function isAutoPin(pin: Pin): boolean {
  return Boolean(pin.auto) || !pin.stopId;
}
