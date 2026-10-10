"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { absorbPoll, fetchRouteClocks, type BusMemory, type StopClock } from "@/lib/routeClocks";
import { fleetPollMs, freezeSimRegions, type SimCore } from "@/lib/simRegion";
import type { Company, RouteListEntry, VehicleDot } from "@/lib/types";
import { placeMtrFleet } from "@/lib/mtrFleet";
import { isRoadFleet } from "@/lib/vehicle";
import { useNow } from "./useNow";

export type RouteFleet = {
  vehicles: VehicleDot[] | null;
  simCores: SimCore[] | null;
  simStale: boolean;
};

/**
 * Road buses: a simulated error band from one coherent ETA poll.
 * MTR: every inferred train on the line (both directions).
 * Positions use the full track, so picking another stop does not move them.
 */
export function useRouteFleet(
  company: Company | undefined,
  route: RouteListEntry | undefined,
  stopIds: string[],
  stops: LatLng[],
  track: LatLng[],
): RouteFleet {
  const road = isRoadFleet(company) && Boolean(route) && stopIds.length > 1 && track.length > 1;
  const mtr = company === "mtr" && Boolean(route) && stopIds.length > 1 && track.length > 1;
  const active = road || mtr;
  const stopKey = stopIds.join("|");
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
  trackRef.current = track;
  stopsRef.current = stops;
  clocksRef.current = clocks;
  const now = useNow(1000);

  useEffect(() => {
    if (!active || !company || !route) return;
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
      void fetchRouteClocks(company, route, stopIds)
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
    const wait = mtr ? 30_000 : fleetPollMs(company);
    const id = window.setInterval(load, wait);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
    // stopIds is read through stopKey so a new array identity does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, company, route, stopKey, mtr]);

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

  const mtrVehicles = useMemo(() => {
    if (!mtr || !company) return null;
    const shape = track.length > 1 ? track : stops;
    const anchors = stops.length > 1 ? stops : shape;
    return placeMtrFleet(shape, anchors, clocks, now);
  }, [mtr, company, track, stops, clocks, now]);

  return useMemo(() => {
    if (!active || !company) return { vehicles: null, simCores: null, simStale: false };
    if (mtr) return { vehicles: mtrVehicles, simCores: null, simStale: false };
    return { vehicles: null, simCores: cores, simStale: stale };
  }, [active, mtr, company, mtrVehicles, cores, stale]);
}
