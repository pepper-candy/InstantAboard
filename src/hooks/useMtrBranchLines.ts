"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mtrLineCode } from "@/lib/colors";
import type { LatLng } from "@/lib/geo";
import { ensureRacecourseStop, mtrBoundDir, mtrLineShapeArms } from "@/lib/mtrBranches";
import { buildMtrLineGraph, type MtrLineGraph } from "@/lib/mtrLineGraph";
import { loadRouteLine } from "@/lib/routeLine";
import type { Company, EtaDb, RouteListEntry } from "@/lib/types";

export type MtrBranchGeometry = {
  /**
   * Y-graph for the open direction: the main arm's shape is the spine
   * (drawn once) and each terminus arm rides spine + stub. Null while shapes
   * load or when the line has no usable arms in this direction.
   */
  graph: MtrLineGraph | null;
  /** Station dots from every same-direction arm of the line (includes 馬場). */
  stationDots: Array<{ lat: number; lng: number; seq: number }>;
};

/**
 * Load every same-direction track shape for an MTR line (EAL main + LMC,
 * TKL main + TKS) and fold them into one Y-graph: one spine, per-terminus
 * arms, branch stubs for the map, and the synthetic Racecourse spur (EAL).
 */
export function useMtrBranchLines(
  db: EtaDb | null | undefined,
  company: Company | undefined,
  route: RouteListEntry | undefined,
  routeId: string | undefined,
  primaryStops: LatLng[],
): MtrBranchGeometry {
  const [graph, setGraph] = useState<MtrLineGraph | null>(null);
  const lineCode = company === "mtr" && route ? mtrLineCode(route.route) : "";
  const dir = company === "mtr" && route ? mtrBoundDir(route.bound.mtr) : null;
  const stopKey = primaryStops.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(";");
  const primaryRef = useRef(primaryStops);
  primaryRef.current = primaryStops;

  const arms = useMemo(() => {
    if (!db || !lineCode || !dir) return [];
    return mtrLineShapeArms(db, lineCode, routeId).arms.filter(
      (arm) => arm.dir === dir && !arm.racecourse,
    );
  }, [db, lineCode, dir, routeId]);

  const shapeKey = useMemo(() => arms.map((arm) => arm.shapeName).sort().join("|"), [arms]);

  const stationDots = useMemo(() => {
    if (!db || !lineCode) return [];
    const seen = new Map<string, { lat: number; lng: number; seq: number }>();
    let seq = 0;
    const push = (stopId: string) => {
      const key = stopId.replace(/^mtr:/i, "").toUpperCase();
      if (seen.has(key)) return;
      const loc = db.stopList[stopId]?.location;
      if (!loc) return;
      seen.set(key, { lat: loc.lat, lng: loc.lng, seq: seq++ });
    };
    for (const arm of arms) {
      for (const stopId of arm.stopIds) push(stopId);
    }
    // Synthetic 馬場 dot so the Racecourse spur always has its station.
    if (lineCode === "EAL") push(ensureRacecourseStop(db));
    return [...seen.values()];
  }, [db, lineCode, arms]);

  useEffect(() => {
    if (!db || !lineCode || !dir || !shapeKey) {
      setGraph(null);
      return;
    }
    let cancel = false;
    const primary = primaryRef.current;
    const jobs = arms.map(async (arm) => {
      const stops = arm.routeId === routeId && primary.length > 1 ? primary : arm.stops;
      const line = await loadRouteLine(arm.shapeName, stops, { road: false });
      return { arm, line: line && line.length > 1 ? line : stops.length > 1 ? stops : null };
    });
    void Promise.all(jobs).then((rows) => {
      if (cancel) return;
      const loaded = rows.flatMap((row) => (row.line ? [{ arm: row.arm, line: row.line }] : []));
      setGraph(buildMtrLineGraph(db, lineCode, dir, loaded, routeId));
    });
    return () => {
      cancel = true;
    };
    // arm identity changes with routeId; shapeKey covers content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, lineCode, dir, shapeKey, routeId, stopKey]);

  if (company !== "mtr") {
    return { graph: null, stationDots: [] };
  }
  return { graph, stationDots };
}
