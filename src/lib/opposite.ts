import { mtrLineCode } from "./colors";
import type { LatLng } from "./geo";
import { nearestStop } from "./nearest";
import type { Company, EtaDb, Pin, RouteListEntry } from "./types";

function mtrDir(bound: string | undefined): "UP" | "DOWN" | null {
  const b = (bound ?? "").toUpperCase();
  if (b.includes("DT")) return "DOWN";
  if (b.includes("UT")) return "UP";
  return null;
}

function isMainMtrBound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b === "UT" || b === "DT";
}

function inbound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b.startsWith("I") || b.includes("DT") || b === "2";
}

function sameService(route: RouteListEntry, other: RouteListEntry, company: Company): boolean {
  if (company === "mtr") return mtrLineCode(other.route) === mtrLineCode(route.route);
  return other.route === route.route;
}

function destKey(route: RouteListEntry): string {
  return `${(route.dest.en || "").toUpperCase()}|${(route.dest.zh || "").toUpperCase()}`;
}

function oppositeDirection(route: RouteListEntry, other: RouteListEntry, company: Company): boolean {
  if (company === "mtr") {
    const here = mtrDir(route.bound.mtr);
    const there = mtrDir(other.bound.mtr);
    return Boolean(here && there && here !== there);
  }
  if (inbound(other.bound[company]) !== inbound(route.bound[company])) return true;
  const a = destKey(route);
  const b = destKey(other);
  return Boolean(a && b && a !== "|" && a !== b);
}

function betterOpposite(
  cur: { route: RouteListEntry; stops: number; main: boolean; service: boolean } | null,
  next: { route: RouteListEntry; stops: number; main: boolean; service: boolean },
): boolean {
  if (!cur) return true;
  if (next.service !== cur.service) return next.service;
  if (next.main !== cur.main) return next.main;
  return next.stops > cur.stops;
}

/** Opposite bound of the same route/line, or null when the service is one-way / circular. */
export function oppositeBound(db: EtaDb, pin: Pin): { routeId: string; route: RouteListEntry } | null {
  const route = db.routeList[pin.routeId];
  if (!route) return null;
  const company = pin.company;
  let best: { routeId: string; route: RouteListEntry; stops: number; main: boolean; service: boolean } | null = null;
  for (const [id, other] of Object.entries(db.routeList)) {
    if (id === pin.routeId || !other.co.includes(company)) continue;
    if (!sameService(route, other, company)) continue;
    if (!oppositeDirection(route, other, company)) continue;
    const stops = (other.stops[company] ?? []).length;
    if (stops < 2) continue;
    const cand = {
      routeId: id,
      route: other,
      stops,
      main: company === "mtr" ? isMainMtrBound(other.bound.mtr) : true,
      service: company === "mtr" || other.serviceType === route.serviceType,
    };
    if (betterOpposite(best, cand)) best = cand;
  }
  return best ? { routeId: best.routeId, route: best.route } : null;
}

/**
 * Switch to the opposite bound and the stop on that bound nearest `near`
 * (user location, or the currently shown stop).
 */
export function oppositePin(
  db: EtaDb,
  pin: Pin,
  near: LatLng,
): Pick<Pin, "routeId" | "stopId" | "stopSeq"> | null {
  const other = oppositeBound(db, pin);
  if (!other) return null;
  const stop = nearestStop(db, other.route, pin.company, near);
  if (!stop) return null;
  return { routeId: other.routeId, stopId: stop.stopId, stopSeq: stop.stopSeq };
}

export function stopLocation(db: EtaDb, stopId: string | undefined): LatLng | null {
  if (!stopId) return null;
  const loc = db.stopList[stopId]?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}
