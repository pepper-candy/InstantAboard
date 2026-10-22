"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mtrLineCode } from "@/lib/colors";
import type { LatLng } from "@/lib/geo";
import { mtrLineShapeArms, type MtrArmRoute } from "@/lib/mtrBranches";
import { loadRouteLine } from "@/lib/routeLine";
import type { Company, EtaDb, RouteListEntry } from "@/lib/types";

export type MtrBranchGeometry = {
  /** Selected variant track (sim + fit focus). */
  active: LatLng[] | null;
  /** Other arms to draw (same colour); excludes active shape when identical. */
  arms: LatLng[][];
  /** Station dots from every arm of the line (includes Racecourse when in data). */
  stationDots: Array<{ lat: number; lng: number; seq: number }>;
};

/**
 * Load every track shape for an MTR line code (main + LMC / TKS / Racecourse spur).
 * Active variant stays the sim spine; siblings are map-only overlays.
 */
export function useMtrBranchLines(
  db: EtaDb | null | undefined,
  company: Company | undefined,
  route: RouteListEntry | undefined,
  routeId: string | undefined,
  primaryStops: LatLng[],
): MtrBranchGeometry {
  const [active, setActive] = useState<LatLng[] | null>(null);
  const [armLines, setArmLines] = useState<LatLng[][]>([]);
  const lineCode = company === "mtr" && route ? mtrLineCode(route.route) : "";
  const stopKey = primaryStops.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(";");
  const primaryRef = useRef(primaryStops);
  primaryRef.current = primaryStops;

  const armMeta = useMemo(() => {
    if (!db || !lineCode) return { active: undefined as MtrArmRoute | undefined, arms: [] as MtrArmRoute[] };
    return mtrLineShapeArms(db, lineCode, routeId);
  }, [db, lineCode, routeId]);

  const shapeKey = useMemo(
    () => armMeta.arms.map((arm) => arm.shapeName).sort().join("|"),
    [armMeta.arms],
  );

  const stationDots = useMemo(() => {
    if (!db || !lineCode) return [];
    const seen = new Map<string, { lat: number; lng: number; seq: number }>();
    let seq = 0;
    for (const arm of armMeta.arms) {
      for (const stopId of arm.stopIds) {
        const key = stopId.replace(/^mtr:/i, "").toUpperCase();
        if (seen.has(key)) continue;
        const loc = db.stopList[stopId]?.location;
        if (!loc) continue;
        seen.set(key, { lat: loc.lat, lng: loc.lng, seq: seq++ });
      }
    }
    return [...seen.values()];
  }, [db, lineCode, armMeta.arms]);

  useEffect(() => {
    if (!lineCode || !shapeKey) {
      setActive(null);
      setArmLines([]);
      return;
    }
    let cancel = false;
    const primary = primaryRef.current;
    const activeArm = armMeta.active;
    const jobs = armMeta.arms.map(async (arm) => {
      const stops = arm.routeId === routeId && primary.length > 1 ? primary : arm.stops;
      const line = await loadRouteLine(arm.shapeName, stops, { road: false });
      return { arm, line: line && line.length > 1 ? line : stops.length > 1 ? stops : null };
    });
    void Promise.all(jobs).then((rows) => {
      if (cancel) return;
      const activeShape = activeArm?.shapeName;
      let nextActive: LatLng[] | null = null;
      const extras: LatLng[][] = [];
      for (const row of rows) {
        if (!row.line) continue;
        if (row.arm.shapeName === activeShape || row.arm.routeId === routeId) {
          nextActive = row.line;
        } else {
          extras.push(row.line);
        }
      }
      if (!nextActive && primary.length > 1) nextActive = primary;
      setActive(nextActive);
      setArmLines(extras);
    });
    return () => {
      cancel = true;
    };
    // armMeta.arms identity changes with routeId; shapeKey covers content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCode, shapeKey, routeId, stopKey]);

  if (company !== "mtr") {
    return { active: null, arms: [], stationDots: [] };
  }
  return { active, arms: armLines, stationDots };
}
