"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { isRacecourseDest, isRacecourseRoute } from "@/lib/mtrBranches";
import { absorbPoll, fetchMtrBranchClocks, fetchRouteClocks, type BusMemory, type StopClock } from "@/lib/routeClocks";
import { fleetPollMs, freezeSimRegions, type SimCore } from "@/lib/simRegion";
import type { BusSimRegion, Company, RouteListEntry, VehicleDot } from "@/lib/types";
import { placeMtrFleet, placeMtrFleetOnGraph } from "@/lib/mtrFleet";
import type { MtrLineGraph } from "@/lib/mtrLineGraph";
import { LRT_DEPART_LAG_S, LRT_DWELL_S, LRT_SIM_KMH } from "@/lib/mtrTime";
import { placeTramFleet } from "@/lib/tramFleet";
import { isRoadFleet } from "@/lib/vehicle";
import { useNow } from "./useNow";

export type RouteFleet = {
  vehicles: VehicleDot[] | null;
  simRegions: BusSimRegion[] | null;
  simCores: SimCore[] | null;
  simStale: boolean;
};

export type RouteFleetOpts = {
  /**
   * When the open MTR variant is the Racecourse spur, carts are allowed only if
   * live clocks include a Racecourse-bound train. Non-race days → zero carts on that path.
   */
  allowRacecourse?: boolean;
  /**
   * Branched MTR lines (EAL / TKL) place trains on this Y-graph: one spine
   * plus per-terminus stubs, routed by each clock's `dest`. Absent for
   * non-branched lines / while shapes load (single-polyline fallback).
   */
  graph?: MtrLineGraph | null;
};

/**
 * Road buses: a simulated error band from one coherent ETA poll.
 * MTR / Light Rail: inferred trains on the open bound only (LR slower coast).
 * Tram: published first/last + headway, no live ETA.
 * Positions use the full track, so picking another stop does not move them.
 */
export function useRouteFleet(
  company: Company | undefined,
  route: RouteListEntry | undefined,
  stopIds: string[],
  stops: LatLng[],
  track: LatLng[],
  holidays: string[] = [],
  opts: RouteFleetOpts = {},
): RouteFleet {
  const road = isRoadFleet(company) && Boolean(route) && stopIds.length > 1 && track.length > 1;
  const mtr = company === "mtr" && Boolean(route) && stopIds.length > 1 && track.length > 1;
  const lightRail = company === "lightRail" && Boolean(route) && stopIds.length > 1 && track.length > 1;
  const rail = mtr || lightRail;
  const tram = company === "tram" && Boolean(route) && stopIds.length > 1;
  const active = road || rail || tram;
  const stopKey = stopIds.join("|");
  const graphKey = opts.graph
    ? `${opts.graph.lineCode}:${opts.graph.dir}:${opts.graph.arms.map((arm) => arm.key).join(",")}`
    : "";
  const ends = track.length > 1 ? `${track[0]?.lat.toFixed(4)},${track[0]?.lng.toFixed(4)}:${track[track.length - 1]?.lat.toFixed(4)}` : "";
  const trackKey = `${track.length}:${ends}`;
  const [clocks, setClocks] = useState<StopClock[]>([]);
  const [cores, setCores] = useState<SimCore[]>([]);
  const [stale, setStale] = useState(false);
  const board = useRef<StopClock[]>([]);
  const memory = useRef<BusMemory[]>([]);
  const coresRef = useRef<SimCore[]>([]);
  const trackRef = useRef(track);
  const stopsRef = useRef(stops);
  const clocksRef = useRef(clocks);
  const graphRef = useRef(opts.graph);
  trackRef.current = track;
  stopsRef.current = stops;
  clocksRef.current = clocks;
  graphRef.current = opts.graph;
  const now = useNow(1000);
  const tick = rail || tram ? now : 0;

  useEffect(() => {
    if (tram || !active || !company || !route) return;
    let cancel = false;
    let ticket = 0;
    board.current = [];
    memory.current = [];
    coresRef.current = [];
    setClocks([]);
    setCores([]);
    setStale(false);
    const load = () => {
      const mine = ++ticket;
      const graph = graphRef.current;
      const request = mtr && graph ? fetchMtrBranchClocks(route, graph) : fetchRouteClocks(company, route, stopIds);
      void request
        .then((next) => {
          if (cancel || mine !== ticket) return;
          const settled = absorbPoll(board.current, next, memory.current);
          if (!settled.changed) {
            setStale(false);
            return;
          }
          const fetchedAt = Date.now();
          board.current = settled.clocks;
          memory.current = settled.memory;
          const frozen = freezeSimRegions(
            trackRef.current,
            stopsRef.current,
            settled.clocks,
            company,
            coresRef.current,
            fetchedAt,
          );
          coresRef.current = frozen;
          setCores(frozen);
          setClocks(settled.clocks);
          setStale(false);
        })
        .catch(() => {
          if (cancel || mine !== ticket) return;
          setStale(true);
        });
    };
    load();
    const wait = rail || tram ? 30_000 : fleetPollMs(company);
    const id = window.setInterval(load, wait);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
    // stopIds is read through stopKey so a new array identity does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, company, route, stopKey, graphKey, rail, tram]);

  useEffect(() => {
    if (!road || !company) return;
    const current = clocksRef.current;
    if (!current.length) return;
    const at = coresRef.current[0]?.fetchedAt ?? Date.now();
    const frozen = freezeSimRegions(trackRef.current, stopsRef.current, current, company, [], at);
    coresRef.current = frozen;
    setCores(frozen);
    // Re-project onto new geometry only; poll freeze happens in the fetch effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [road, company, trackKey]);

  return useMemo(() => {
    if (!active || !company) return { vehicles: null, simRegions: null, simCores: null, simStale: false };
    const shape = track.length > 1 ? track : stops;
    const anchors = stops.length > 1 ? stops : shape;
    if (mtr) {
      const raceVariant = Boolean(route && isRacecourseRoute(route));
      const raceLive = clocks.some((clock) => isRacecourseDest(clock.dest));
      // Racecourse spur: no carts unless this variant is open and live clocks serve 馬場.
      // Non-race variants never place carts from Racecourse-bound clocks; the Y-graph
      // keeps Racecourse-dest trains off the spur entirely when no live clock says RAC.
      if (raceVariant && (opts.allowRacecourse === false || !raceLive)) {
        return { vehicles: [], simRegions: null, simCores: null, simStale: false };
      }
      const fleetClocks = clocks.filter((clock) => {
        const race = isRacecourseDest(clock.dest);
        if (raceVariant) return race || !clock.dest;
        return !race;
      });
      const vehicles = opts.graph
        ? placeMtrFleetOnGraph(opts.graph, fleetClocks, tick)
        : placeMtrFleet(shape, anchors, fleetClocks, tick);
      return {
        vehicles,
        simRegions: null,
        simCores: null,
        simStale: false,
      };
    }
    if (lightRail) {
      return {
        vehicles: placeMtrFleet(shape, anchors, clocks, tick, {
          coastKmh: LRT_SIM_KMH,
          dwellS: LRT_DWELL_S,
          departLagS: LRT_DEPART_LAG_S,
        }),
        simRegions: null,
        simCores: null,
        simStale: false,
      };
    }
    if (tram && route) {
      return {
        vehicles: placeTramFleet(shape, anchors, route, holidays, tick || Date.now()),
        simRegions: null,
        simCores: null,
        simStale: false,
      };
    }
    return {
      vehicles: null,
      simRegions: null,
      simCores: cores,
      simStale: stale,
    };
  }, [active, mtr, lightRail, tram, company, route, holidays, track, stops, clocks, cores, stale, tick, opts.allowRacecourse, graphKey]);
}
