"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { loadRoadPace } from "@/lib/roadSpeed";
import { absorbPoll, fetchRouteClocks, type BusMemory, type StopClock } from "@/lib/routeClocks";
import type { Company, RouteListEntry, VehicleDot } from "@/lib/types";
import { isRoadFleet, placeFleet, type RoadPace } from "@/lib/vehicle";
import { useNow } from "./useNow";

/**
 * Buses and minibuses for one route. Positions come from the route-wide ETAs
 * and the full track, so picking another stop does not move them.
 * Null for modes that are not placed this way.
 */
export function useRouteFleet(
  company: Company | undefined,
  route: RouteListEntry | undefined,
  stopIds: string[],
  stops: LatLng[],
  track: LatLng[],
): VehicleDot[] | null {
  const active = isRoadFleet(company) && Boolean(route) && stopIds.length > 1 && track.length > 1;
  const stopKey = stopIds.join("|");
  const ends = track.length > 1 ? `${track[0]?.lat.toFixed(4)},${track[0]?.lng.toFixed(4)}:${track[track.length - 1]?.lat.toFixed(4)}` : "";
  const trackKey = `${track.length}:${ends}`;
  const [clocks, setClocks] = useState<StopClock[]>([]);
  const [pace, setPace] = useState<RoadPace | null>(null);
  const board = useRef<StopClock[]>([]);
  const memory = useRef<BusMemory[]>([]);
  const now = useNow(1000);

  useEffect(() => {
    if (!active || !company || !route) return;
    let cancel = false;
    let ticket = 0;
    board.current = [];
    memory.current = [];
    setClocks([]);
    const load = () => {
      const mine = ++ticket;
      void fetchRouteClocks(company, route, stopIds)
        .then((next) => {
          if (cancel || mine !== ticket) return;
          const settled = absorbPoll(board.current, next, memory.current);
          if (!settled.changed) return;
          board.current = settled.clocks;
          memory.current = settled.memory;
          setClocks(settled.clocks);
        })
        .catch(() => {
          /* keep the last consistent board */
        });
    };
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
    // stopIds is read through stopKey so a new array identity does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, company, route, stopKey]);

  useEffect(() => {
    if (!active || !company || !route || track.length < 2) return;
    let cancel = false;
    const key = `${company}:${route.route}:${route.bound[company] ?? ""}:${route.serviceType}:${trackKey}`;
    const load = () => {
      void loadRoadPace(key, track).then((next) => {
        if (!cancel && next) setPace(next);
      });
    };
    load();
    const id = window.setInterval(load, 90_000);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, company, route, trackKey]);

  return useMemo(() => {
    if (!active || !company) return null;
    const shape = track.length > 1 ? track : stops;
    const anchors = stops.length > 1 ? stops : shape;
    return placeFleet(shape, anchors, clocks, company, pace, now);
  }, [active, company, track, stops, clocks, pace, now]);
}
