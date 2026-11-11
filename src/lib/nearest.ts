import { mtrLineCode } from "./colors";
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

/** Keep the saved stop — never retarget a star onto a closer stop of the same route. */
export function resolvePin(_db: EtaDb | null, pin: Pin, _origin: LatLng | null): Pin {
  return pin;
}

/** True when the starred stop is the nearest stop on that route and direction. */
export function isStarredStopClosest(db: EtaDb | null, pin: Pin, origin: LatLng | null | undefined): boolean {
  if (!db || !origin) return false;
  const closest = closestStopForPin(db, pin, origin);
  if (!closest) return false;
  if (pin.company === "mtr") return mtrStopKey(pin.stopId) === mtrStopKey(closest.stopId);
  return pin.stopId === closest.stopId;
}

function mtrStopKey(stopId: string): string {
  return stopId.replace(/^mtr:/i, "").toUpperCase();
}

function mtrPinLine(db: EtaDb | null, pin: Pin): string {
  if (pin.company !== "mtr") return "";
  const route = db?.routeList[pin.routeId]?.route;
  return route ? mtrLineCode(route) : "";
}

/** Bus/minibus: this route at this stop. MTR: one station + line covers UP and DOWN. */
export function isSameWatchPin(db: EtaDb | null, a: Pin, b: Pin): boolean {
  if (a.company === "mtr" && b.company === "mtr") {
    const line = mtrPinLine(db, a);
    return Boolean(line && line === mtrPinLine(db, b) && mtrStopKey(a.stopId) === mtrStopKey(b.stopId));
  }
  return a.routeId === b.routeId && a.stopId === b.stopId;
}
