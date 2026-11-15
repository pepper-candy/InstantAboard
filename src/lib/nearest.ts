import { destAtStop } from "./circular";
import { mtrLineCode } from "./colors";
import { haversine, type LatLng } from "./geo";
import type { Company, EtaDb, Pin, RouteListEntry, Terminal } from "./types";

function destMatches(a: Terminal | undefined, b: Terminal | undefined): boolean {
  if (!a || !b) return false;
  return a.zh === b.zh && a.en === b.en;
}

export function nearestStop(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
  origin: LatLng,
  opts?: { preferDest?: Terminal },
): { stopId: string; stopSeq: number } | null {
  const ids = route.stops[company] ?? [];
  const search = (prefer: boolean) => {
    let best: { stopId: string; stopSeq: number; d: number } | null = null;
    for (let i = 0; i < ids.length; i++) {
      const stopId = ids[i];
      if (!stopId) continue;
      if (prefer && opts?.preferDest && !destMatches(destAtStop(db, route, company, stopId, i), opts.preferDest)) {
        continue;
      }
      const stop = db.stopList[stopId];
      if (!stop) continue;
      const d = haversine(origin, stop.location);
      if (!best || d < best.d) best = { stopId, stopSeq: i, d };
    }
    return best;
  };
  if (opts?.preferDest) return search(true) ?? search(false);
  return search(false);
}

/** Closest stop on one route direction. Used by locate, detail open, and direction swap. */
export function closestStopOnRoute(
  db: EtaDb,
  route: RouteListEntry,
  company: Company,
  origin: LatLng,
  opts?: { preferDest?: Terminal },
): { stopId: string; stopSeq: number } | null {
  return nearestStop(db, route, company, origin, opts);
}

export function closestStopForPin(
  db: EtaDb,
  pin: Pin,
  origin: LatLng,
  routeId = pin.routeId,
  opts?: { preferDest?: Terminal },
): { stopId: string; stopSeq: number } | null {
  const route = db.routeList[routeId];
  if (!route) return null;
  return closestStopOnRoute(db, route, pin.company, origin, opts);
}

/** Keep the saved stop — never retarget a star onto a closer stop of the same route. */
export function resolvePin(_db: EtaDb | null, pin: Pin, _origin: LatLng | null): Pin {
  return pin;
}

/** True when the starred stop is the nearest stop on that route and direction. */
export function isStarredStopClosest(db: EtaDb | null, pin: Pin, origin: LatLng | null | undefined): boolean {
  if (!db || !origin) return false;
  const route = db.routeList[pin.routeId];
  const preferDest = route ? destAtStop(db, route, pin.company, pin.stopId, pin.stopSeq) : undefined;
  const closest = closestStopForPin(db, pin, origin, pin.routeId, preferDest ? { preferDest } : undefined);
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
