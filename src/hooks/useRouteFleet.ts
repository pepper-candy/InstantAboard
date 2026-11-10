"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { isRacecourseDest, isRacecourseRoute } from "@/lib/mtrBranches";
import { absorbPoll, fetchMtrBranchClocks, fetchRouteClocks, liveSeconds, type BusMemory, type StopClock } from "@/lib/routeClocks";
import { fleetPollMs, freezeSimRegions, type RoutePaceMap, type RoutePaceSample, type SimCore } from "@/lib/simRegion";
import { createRouteFlowSession, type FlowBusInput } from "@/lib/tomtomFlow";
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
  /** User's chosen / closest stop on this sheet — TomTom gates use ETA here. */
  flagSeq?: number;
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
  const flagSeq = opts.flagSeq ?? 0;
  const [pace, setPace] = useState<{ key: string; byBus: Record<string, RoutePaceSample[]> } | null>(null);
  const board = useRef<StopClock[]>([]);
  const memory = useRef<BusMemory[]>([]);
  const coresRef = useRef<SimCore[]>([]);
  const trackRef = useRef(track);
  const stopsRef = useRef(stops);
  const clocksRef = useRef(clocks);
  const paceRef = useRef<{ key: string; byBus: Record<string, RoutePaceSample[]> } | null>(null);
  const trackKeyRef = useRef(trackKey);
  const flagSeqRef = useRef(flagSeq);
  const graphRef = useRef(opts.graph);
  const flowRef = useRef(createRouteFlowSession());
  const prevFlagRef = useRef(flagSeq);
  const runFlowRef = useRef<() => void>(() => {});
  trackRef.current = track;
  stopsRef.current = stops;
  clocksRef.current = clocks;
  paceRef.current = pace;
  trackKeyRef.current = trackKey;
  flagSeqRef.current = flagSeq;
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
            paceRef.current?.key === trackKeyRef.current
              ? new Map(Object.entries(paceRef.current.byBus))
              : null,
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
    const hold = paceRef.current;
    const frozen = freezeSimRegions(
      trackRef.current,
      stopsRef.current,
      current,
      company,
      [],
      at,
      hold?.key === trackKey ? new Map(Object.entries(hold.byBus)) : null,
    );
    coresRef.current = frozen;
    setCores(frozen);
    // Re-project onto new geometry only; poll freeze happens in the fetch effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [road, company, trackKey]);

  useEffect(() => {
    flowRef.current.reset();
    paceRef.current = null;
    setPace(null);
    return () => {
      flowRef.current.reset();
    };
  }, [company]);

  useEffect(() => {
    flowRef.current.resetKeepBudget();
    paceRef.current = null;
    setPace(null);
  }, [trackKey]);

  useEffect(() => {
    if (prevFlagRef.current === flagSeq) return;
    prevFlagRef.current = flagSeq;
    flowRef.current.resetGates();
  }, [flagSeq]);

  // Close-range TomTom: ≤3 min / ≤1 min gates at the user's flag. Not an always-on poll.
  useEffect(() => {
    if (!road || !company) return;
    let cancel = false;
    let inFlight: AbortController | null = null;
    const sampledKey = trackKey;
    const flow = flowRef.current;

    const publish = () => {
      const byBus: Record<string, RoutePaceSample[]> = {};
      for (const [id, samples] of flow.paceByBus()) byBus[id] = samples;
      const next = { key: sampledKey, byBus };
      paceRef.current = next;
      setPace(next);
    };

    const run = () => {
      if (document.hidden || inFlight) return;
      const line = trackRef.current;
      const boardClocks = clocksRef.current;
      const frozen = coresRef.current;
      if (!boardClocks.length || !frozen.length) return;
      const seq = flagSeqRef.current;
      const coreById = new Map(frozen.map((core) => [core.id, core]));
      const buses: FlowBusInput[] = [];
      for (const clock of boardClocks) {
        const core = coreById.get(clock.id);
        if (!core) continue;
        const flagM = core.atStop[seq];
        if (flagM == null) continue;
        buses.push({
          id: clock.id,
          tFlagS: liveSeconds(clock, seq),
          busM: core.estimate0,
          flagM,
        });
      }
      if (!buses.length) return;
      const local = new AbortController();
      inFlight = local;
      void flow
        .tick({ hidden: false, track: line, buses, signal: local.signal })
        .then((changed) => {
          if (cancel || local.signal.aborted || trackKeyRef.current !== sampledKey) return;
          if (changed) publish();
        })
        .finally(() => {
          if (inFlight === local) inFlight = null;
        });
    };

    runFlowRef.current = run;
    const onVis = () => {
      if (document.hidden) {
        inFlight?.abort();
        inFlight = null;
        return;
      }
      run();
    };

    if (!document.hidden) run();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancel = true;
      inFlight?.abort();
      runFlowRef.current = () => {};
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [road, company, trackKey, flagSeq]);

  useEffect(() => {
    runFlowRef.current();
  }, [clocks]);

  useEffect(() => {
    if (!road || !company || !pace || pace.key !== trackKey) return;
    const current = clocksRef.current;
    if (!current.length) return;
    const frozen = freezeSimRegions(
      trackRef.current,
      stopsRef.current,
      current,
      company,
      coresRef.current,
      Date.now(),
      new Map(Object.entries(pace.byBus)) as RoutePaceMap,
    );
    coresRef.current = frozen;
    setCores(frozen);
  }, [road, company, pace, trackKey]);

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
