import { mtrLineCode } from "./colors";
import type { LatLng } from "./geo";
import {
  isMainMtrBound,
  isRacecourseRoute,
  mtrBoundDir,
  mtrBranchFamily,
  mtrDestKey,
} from "./mtrBranches";
import { closestStopOnRoute } from "./nearest";
import { tramServiceKey } from "./stopIndex";
import type { Company, EtaDb, Pin, RouteListEntry } from "./types";

function inbound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b.startsWith("I") || b.includes("DT") || b === "2";
}

function sameService(route: RouteListEntry, other: RouteListEntry, company: Company): boolean {
  if (company === "mtr") return mtrLineCode(other.route) === mtrLineCode(route.route);
  if (company === "tram") return tramServiceKey(other) === tramServiceKey(route);
  return other.route === route.route;
}

function destKey(route: RouteListEntry): string {
  return mtrDestKey(route.dest);
}

function oppositeDirection(route: RouteListEntry, other: RouteListEntry, company: Company): boolean {
  if (company === "mtr") {
    const here = mtrBoundDir(route.bound.mtr);
    const there = mtrBoundDir(other.bound.mtr);
    return Boolean(here && there && here !== there);
  }
  if (inbound(other.bound[company]) !== inbound(route.bound[company])) return true;
  const a = destKey(route);
  const b = destKey(other);
  return Boolean(a && b && a !== "|" && a !== b);
}

type OppositeCand = {
  routeId: string;
  route: RouteListEntry;
  stops: number;
  main: boolean;
  service: boolean;
  family: string;
  dest: string;
  racecourse: boolean;
};

function betterOpposite(cur: OppositeCand | null, next: OppositeCand, preferFamily: string, preferDest: string): boolean {
  if (!cur) return true;
  const nextFamily = next.family === preferFamily;
  const curFamily = cur.family === preferFamily;
  if (nextFamily !== curFamily) return nextFamily;
  const nextDest = Boolean(preferDest && next.dest === preferDest);
  const curDest = Boolean(preferDest && cur.dest === preferDest);
  if (nextDest !== curDest) return nextDest;
  if (next.racecourse !== cur.racecourse) return !next.racecourse;
  if (next.service !== cur.service) return next.service;
  if (next.main !== cur.main) return next.main;
  return next.stops > cur.stops;
}

/** Opposite bound of the same route/line, or null when the service is one-way / circular. */
export function oppositeBound(db: EtaDb, pin: Pin): { routeId: string; route: RouteListEntry } | null {
  const route = db.routeList[pin.routeId];
  if (!route) return null;
  const company = pin.company;
  const preferFamily = company === "mtr" ? mtrBranchFamily(route) : "";
  const preferDest = company === "mtr" ? destKey(route) : "";
  let best: OppositeCand | null = null;
  for (const [id, other] of Object.entries(db.routeList)) {
    if (id === pin.routeId || !other.co.includes(company)) continue;
    if (!sameService(route, other, company)) continue;
    if (!oppositeDirection(route, other, company)) continue;
    const stops = (other.stops[company] ?? []).length;
    if (stops < 2) continue;
    const cand: OppositeCand = {
      routeId: id,
      route: other,
      stops,
      main: company === "mtr" ? isMainMtrBound(other.bound.mtr) : true,
      service: company === "mtr" || other.serviceType === route.serviceType,
      family: company === "mtr" ? mtrBranchFamily(other) : "",
      dest: company === "mtr" ? destKey(other) : "",
      racecourse: company === "mtr" ? isRacecourseRoute(other) : false,
    };
    if (betterOpposite(best, cand, preferFamily, preferDest)) best = cand;
  }
  return best ? { routeId: best.routeId, route: best.route } : null;
}

/**
 * Switch to the opposite bound, then pick the stop on that bound nearest `near`.
 * Callers should pass the current station (or user fix) after the bound is chosen.
 */
export function oppositePin(
  db: EtaDb,
  pin: Pin,
  near: LatLng,
): Pick<Pin, "routeId" | "stopId" | "stopSeq"> | null {
  const other = oppositeBound(db, pin);
  if (!other) return null;
  const stop = closestStopOnRoute(db, other.route, pin.company, near);
  if (!stop) return null;
  return { routeId: other.routeId, ...stop };
}

export function stopLocation(db: EtaDb, stopId: string | undefined): LatLng | null {
  if (!stopId) return null;
  const loc = db.stopList[stopId]?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}
