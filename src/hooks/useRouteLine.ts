"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";
import { companyMode } from "@/lib/mode";
import { loadRouteLine } from "@/lib/routeLine";
import { shapeFileName } from "@/lib/shapeFile";
import type { Company, RouteListEntry } from "@/lib/types";

export function useRouteLine(
  company: Company | undefined,
  route: RouteListEntry | undefined,
  stops: LatLng[],
): LatLng[] | null {
  const [line, setLine] = useState<LatLng[] | null>(null);
  const name =
    company && route
      ? shapeFileName({
          company,
          route: route.route,
          bound: route.bound[company],
          serviceType: route.serviceType,
          gtfsId: route.gtfsId,
          nlbId: route.nlbId,
        })
      : "";
  const stopKey = stops.map((stop) => `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`).join(";");
  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  const water = Boolean(company && companyMode(company) === "ferry");
  const rail = company === "mtr" || company === "lightRail";

  useEffect(() => {
    const current = stopsRef.current;
    // Ferries stay on straight pier-to-pier segments — never OSRM / road shapes.
    // Rail uses the track shape only. A missing file stays straight, never a driving route.
    if (water || !name || current.length < 2) {
      setLine(null);
      return;
    }
    let cancel = false;
    void loadRouteLine(name, current, { road: !rail }).then((next) => {
      if (!cancel) setLine(next);
    });
    return () => {
      cancel = true;
    };
  }, [name, stopKey, water, rail]);

  return line;
}
