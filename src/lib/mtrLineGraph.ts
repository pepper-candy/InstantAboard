import {
  cumulativeDistances,
  distancesOnPath,
  pathLength,
  pointAtDistance,
  type LatLng,
} from "./geo";
import { ensureRacecourseStop, type MtrArmRoute } from "./mtrBranches";
import type { EtaDb } from "./types";

/** One destination arm of a branched MTR line, in travel order for `dir`. */
export type MtrLineArm = {
  /** Destination terminus code (LOW | LMC | POA | LHP | RAC). */
  key: string;
  main: boolean;
  racecourse: boolean;
  /** routeList id for real arms; null for the synthetic Racecourse arm. */
  routeId: string | null;
  /** Stops in travel order, shared spine stops included. Parallel to `stops`. */
  stopIds: string[];
  stops: LatLng[];
  /** Composed polyline: shared spine + this arm's stub, in travel order. */
  path: LatLng[];
};

/**
 * One Y-graph for a branched MTR line in a single direction. The main arm's
 * shape is the spine (drawn once); sibling arms ride the same spine geometry
 * up to the junction stop and carry only their own stub beyond it.
 */
export type MtrLineGraph = {
  lineCode: string;
  dir: "UP" | "DOWN";
  /** Main arm polyline in travel order — the single drawn spine. */
  spine: LatLng[];
  /** Branch-only stub polylines (junction→terminus) + Racecourse V-spur. */
  stubs: LatLng[][];
  arms: MtrLineArm[];
  /** Open route id, used to prefer the open variant for unknown-dest trains. */
  activeRouteId?: string;
};

export type MtrLoadedArm = { arm: MtrArmRoute; line: LatLng[] };

function normStopId(stopId: string): string {
  return stopId.replace(/^mtr:/i, "").toUpperCase();
}

function stopLoc(db: EtaDb, stopId: string): LatLng | null {
  const loc = db.stopList[stopId]?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

/** Split a polyline at `dist` metres from its start. Head and tail share the cut point. */
function slicePathAt(path: LatLng[], dist: number): { head: LatLng[]; tail: LatLng[] } {
  if (path.length < 2) return { head: [...path], tail: [...path] };
  const cum = cumulativeDistances(path);
  const total = cum[cum.length - 1] ?? 0;
  const d = Math.max(0, Math.min(total, dist));
  const point = pointAtDistance(path, cum, d);
  if (d <= 0) return { head: [path[0] ?? { lat: 0, lng: 0 }], tail: [...path] };
  if (d >= total) return { head: [...path], tail: [path[path.length - 1] ?? { lat: 0, lng: 0 }] };
  let lo = 0;
  while (lo + 1 < cum.length - 1 && (cum[lo + 1] ?? 0) < d) lo++;
  const head = [...path.slice(0, lo + 1)];
  const tail = [...path.slice(lo + 1)];
  if (point) {
    head.push(point);
    tail.unshift(point);
  }
  return { head, tail };
}

/**
 * Junction stop between the main and branch arm: the shared stop closest to
 * the branch's own terminus (SHS for EAL, TKO for TKL), in travel order.
 */
function junctionStop(mainIds: string[], branchIds: string[], dir: "UP" | "DOWN"): string | null {
  const mainSet = new Set(mainIds);
  let best: string | null = null;
  let bestIdx = -1;
  for (let i = 0; i < branchIds.length; i++) {
    const id = branchIds[i];
    if (!id || !mainSet.has(id)) continue;
    if (best == null || (dir === "UP" ? i > bestIdx : i < bestIdx)) {
      best = id;
      bestIdx = i;
    }
  }
  return best;
}

/**
 * Compose one branch arm: the branch's own stop list extended with the main
 * arm's stops on the shared span, and a polyline built from the main line's
 * spine portion plus the branch line's own stub. UP peels after the junction;
 * DOWN merges before it — the concat always follows travel order.
 */
function composeArm(
  db: EtaDb,
  dir: "UP" | "DOWN",
  mainArm: MtrArmRoute,
  mainLine: LatLng[],
  branchArm: MtrArmRoute,
  branchLine: LatLng[],
): { stopIds: string[]; stops: LatLng[]; path: LatLng[]; stub: LatLng[] } {
  const own = (): { stopIds: string[]; stops: LatLng[]; path: LatLng[]; stub: LatLng[] } => ({
    stopIds: [...branchArm.stopIds],
    stops: [...branchArm.stops],
    path: [...branchLine],
    stub: [...branchLine],
  });
  const mainIds = mainArm.stopIds.map(normStopId);
  const branchIds = branchArm.stopIds.map(normStopId);
  const junction = junctionStop(mainIds, branchIds, dir);
  const jMain = junction ? mainIds.indexOf(junction) : -1;
  const jBranch = junction ? branchIds.indexOf(junction) : -1;
  if (!junction || jMain < 0 || jBranch < 0) return own();
  const junctionLoc = stopLoc(db, mainArm.stopIds[jMain] ?? "");
  if (!junctionLoc) return own();
  const jm = distancesOnPath(mainLine, [junctionLoc])[0] ?? 0;
  const jb = distancesOnPath(branchLine, [junctionLoc])[0] ?? 0;
  const mainSplit = slicePathAt(mainLine, jm);
  const branchSplit = slicePathAt(branchLine, jb);
  const stub = dir === "UP" ? branchSplit.tail : branchSplit.head;
  const path =
    dir === "UP"
      ? [...mainSplit.head, ...branchSplit.tail]
      : [...branchSplit.head, ...mainSplit.tail];
  const stopIds =
    dir === "UP"
      ? [...mainArm.stopIds.slice(0, jMain + 1), ...branchArm.stopIds.slice(jBranch + 1)]
      : [...branchArm.stopIds.slice(0, jBranch + 1), ...mainArm.stopIds.slice(jMain + 1)];
  const pairs = stopIds.map((id) => ({ id, loc: stopLoc(db, id) }));
  // Travel-order sanity: the branch terminus must sit at the composed path's
  // end (UP) or start (DOWN). Anything else means the concat double-backs —
  // fall back to the branch's own line rather than draw a wrong path.
  if (pairs.every((pair) => pair.loc)) {
    const stops = pairs.map((pair) => pair.loc as LatLng);
    const snapped = distancesOnPath(path, stops);
    const total = pathLength(path);
    const termDist = dir === "UP" ? (snapped[snapped.length - 1] ?? 0) : (snapped[0] ?? 0);
    const terminal =
      dir === "UP"
        ? total - termDist <= Math.max(120, total * 0.25)
        : termDist <= Math.max(120, total * 0.25);
    if (!terminal) return own();
    return {
      stopIds: pairs.map((pair) => pair.id),
      stops,
      path,
      stub,
    };
  }
  const kept = pairs.filter((pair) => pair.loc);
  return {
    stopIds: kept.map((pair) => pair.id),
    stops: kept.map((pair) => pair.loc as LatLng),
    path,
    stub,
  };
}

/** Terminus code of an arm in travel order: last stop (UP) or first (DOWN). */
function terminusKey(arm: MtrArmRoute, dir: "UP" | "DOWN"): string {
  const ids = arm.stopIds.map(normStopId);
  const id = dir === "UP" ? ids[ids.length - 1] : ids[0];
  return id ?? "";
}

/**
 * Build the Y-graph for one direction of a branched MTR line from loaded
 * arm polylines. `loaded` holds same-direction, non-racecourse arms; the
 * Racecourse arm (EAL) is synthesized from the spine + the RAC station point.
 * Returns null when the direction has no usable arms.
 */
export function buildMtrLineGraph(
  db: EtaDb,
  lineCode: string,
  dir: "UP" | "DOWN",
  loaded: MtrLoadedArm[],
  activeRouteId?: string,
): MtrLineGraph | null {
  const rows = loaded.filter((row) => row.arm.dir === dir && !row.arm.racecourse && row.line.length >= 2);
  if (!rows.length) return null;
  const main = rows.find((row) => row.arm.main) ?? rows[0];
  if (!main) return null;
  const rest = rows.filter((row) => row !== main);
  const spine = [...main.line];
  const arms: MtrLineArm[] = [
    {
      key: terminusKey(main.arm, dir),
      main: true,
      racecourse: false,
      routeId: main.arm.routeId,
      stopIds: [...main.arm.stopIds],
      stops: [...main.arm.stops],
      path: spine,
    },
  ];
  const stubs: LatLng[][] = [];
  for (const row of rest) {
    const composed = composeArm(db, dir, main.arm, main.line, row.arm, row.line);
    stubs.push(composed.stub);
    arms.push({
      key: terminusKey(row.arm, dir),
      main: false,
      racecourse: false,
      routeId: row.arm.routeId,
      stopIds: composed.stopIds,
      stops: composed.stops,
      path: composed.path,
    });
  }

  // Racecourse spur (EAL): synthetic arm peeling at Fo Tan (UP) / University
  // (DOWN), plus the always-drawn UNI–RAC–FOT bypass V-spur.
  if (lineCode === "EAL") {
    const racId = ensureRacecourseStop(db);
    const racLoc = stopLoc(db, racId);
    const ids = main.arm.stopIds.map(normStopId);
    const peelIdx = ids.indexOf(dir === "UP" ? "FOT" : "UNI");
    if (racLoc && peelIdx >= 0) {
      const peelStopId = main.arm.stopIds[peelIdx] ?? "";
      const peelLoc = stopLoc(db, peelStopId);
      if (peelLoc) {
        const pd = distancesOnPath(spine, [peelLoc])[0] ?? 0;
        const head = slicePathAt(spine, pd).head;
        const pairs = main.arm.stopIds.slice(0, peelIdx + 1).map((id) => ({ id, loc: stopLoc(db, id) }));
        const kept = pairs.filter((pair) => pair.loc);
        arms.push({
          key: "RAC",
          main: false,
          racecourse: true,
          routeId: null,
          stopIds: [...kept.map((pair) => pair.id), racId],
          stops: [...kept.map((pair) => pair.loc as LatLng), racLoc],
          path: [...head, racLoc],
        });
        const uniIdx = ids.indexOf("UNI");
        const fotIdx = ids.indexOf("FOT");
        const uniLoc = uniIdx >= 0 ? stopLoc(db, main.arm.stopIds[uniIdx] ?? "") : null;
        const fotLoc = fotIdx >= 0 ? stopLoc(db, main.arm.stopIds[fotIdx] ?? "") : null;
        if (uniLoc && fotLoc) stubs.push([uniLoc, racLoc, fotLoc]);
      }
    }
  }

  return { lineCode, dir, spine, stubs, arms, activeRouteId };
}
