import { mtrLineCode } from "./colors";
import type { LatLng } from "./geo";
import { shapeFileName } from "./shapeFile";
import type { EtaDb, RouteListEntry, Terminal } from "./types";

/** Stable dest key for deduping branch termini. */
export function mtrDestKey(dest: Terminal | undefined): string {
  if (!dest) return "";
  return `${(dest.en || "").trim().toUpperCase()}|${(dest.zh || "").trim()}`;
}

/** Race-day-only East Rail spur (馬場) — not a permanent board terminus. */
export function isRacecourseDest(dest: Terminal | string | undefined): boolean {
  if (!dest) return false;
  if (typeof dest === "string") {
    const raw = dest.replace(/^mtr:/i, "").trim().toUpperCase();
    if (raw === "RAC" || raw === "RACECOURSE") return true;
    return /racecourse|馬場/.test(dest);
  }
  const en = (dest.en || "").trim().toLowerCase();
  const zh = (dest.zh || "").trim();
  if (en === "racecourse" || zh === "馬場") return true;
  return /racecourse/.test(en) || zh.includes("馬場");
}

export function isRacecourseStopId(stopId: string | undefined): boolean {
  if (!stopId) return false;
  const id = stopId.replace(/^mtr:/i, "").toUpperCase();
  return id === "RAC" || id.endsWith(":RAC");
}

export function isRacecourseRoute(route: RouteListEntry): boolean {
  if (isRacecourseDest(route.dest) || isRacecourseDest(route.orig)) return true;
  return (route.stops.mtr ?? []).some(isRacecourseStopId);
}

export function mtrBoundDir(bound: string | undefined): "UP" | "DOWN" | null {
  const b = (bound ?? "").toUpperCase();
  if (b === "DT") return "DOWN";
  if (b === "UT") return "UP";
  if (b.includes("DT")) return "DOWN";
  if (b.includes("UT")) return "UP";
  return null;
}

/** Exact UT/DT only — branch suffixes (e.g. LMC-UT) are not “main”. */
export function isMainMtrBound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b === "UT" || b === "DT";
}

/** Variant family for flip preference: main spine vs LMC vs TKS vs Racecourse. */
export function mtrBranchFamily(route: RouteListEntry): string {
  if (isRacecourseRoute(route)) return "RAC";
  return route.route.toUpperCase();
}

export type MtrArmRoute = {
  routeId: string;
  route: RouteListEntry;
  dir: "UP" | "DOWN" | null;
  main: boolean;
  racecourse: boolean;
  stops: LatLng[];
  stopIds: string[];
  shapeName: string;
};

/** Every MTR route entry that belongs to a line code (EAL includes EAL_LMC + Racecourse). */
export function listMtrArmRoutes(db: EtaDb, lineCode: string): MtrArmRoute[] {
  const want = mtrLineCode(lineCode);
  const out: MtrArmRoute[] = [];
  for (const [routeId, route] of Object.entries(db.routeList)) {
    if (!route.co.includes("mtr")) continue;
    if (mtrLineCode(route.route) !== want) continue;
    const stopIds = route.stops.mtr ?? [];
    if (stopIds.length < 2) continue;
    const stops: LatLng[] = [];
    for (const id of stopIds) {
      const loc = db.stopList[id]?.location;
      if (loc) stops.push({ lat: loc.lat, lng: loc.lng });
    }
    if (stops.length < 2) continue;
    out.push({
      routeId,
      route,
      dir: mtrBoundDir(route.bound.mtr),
      main: isMainMtrBound(route.bound.mtr),
      racecourse: isRacecourseRoute(route),
      stops,
      stopIds,
      shapeName: shapeFileName({
        company: "mtr",
        route: route.route,
        bound: route.bound.mtr,
        serviceType: route.serviceType,
        gtfsId: route.gtfsId,
        nlbId: route.nlbId,
      }),
    });
  }
  return out;
}

/**
 * Unique shape jobs for a line: one per shape file name.
 * Prefer a non-racecourse, main-bound arm when several share geometry intent.
 */
export function mtrLineShapeArms(
  db: EtaDb,
  lineCode: string,
  activeRouteId?: string,
): { active?: MtrArmRoute; arms: MtrArmRoute[] } {
  const all = listMtrArmRoutes(db, lineCode);
  const byShape = new Map<string, MtrArmRoute>();
  for (const arm of all) {
    const cur = byShape.get(arm.shapeName);
    if (!cur) {
      byShape.set(arm.shapeName, arm);
      continue;
    }
    if (arm.routeId === activeRouteId) {
      byShape.set(arm.shapeName, arm);
      continue;
    }
    if (cur.routeId === activeRouteId) continue;
    if (cur.racecourse !== arm.racecourse) {
      if (!arm.racecourse) byShape.set(arm.shapeName, arm);
      continue;
    }
    if (cur.main !== arm.main) {
      if (arm.main) byShape.set(arm.shapeName, arm);
      continue;
    }
    if (arm.stops.length > cur.stops.length) byShape.set(arm.shapeName, arm);
  }
  const arms = [...byShape.values()];
  const active = activeRouteId ? all.find((arm) => arm.routeId === activeRouteId) ?? arms[0] : arms[0];
  return { active, arms };
}

/** Union of station dots across every arm of the line (includes 馬場 when present). */
export function mtrLineStationDots(
  db: EtaDb,
  lineCode: string,
): Array<{ lat: number; lng: number; seq: number; stopId: string }> {
  const seen = new Map<string, { lat: number; lng: number; seq: number; stopId: string }>();
  let seq = 0;
  for (const arm of listMtrArmRoutes(db, lineCode)) {
    for (const stopId of arm.stopIds) {
      const key = stopId.replace(/^mtr:/i, "").toUpperCase();
      if (seen.has(key)) continue;
      const loc = db.stopList[stopId]?.location;
      if (!loc) continue;
      seen.set(key, { lat: loc.lat, lng: loc.lng, seq: seq++, stopId });
    }
  }
  return [...seen.values()];
}

export function arrivalIsRacecourse(row: { dest?: Terminal; destCode?: string }): boolean {
  if (row.destCode && isRacecourseDest(row.destCode)) return true;
  return isRacecourseDest(row.dest);
}
