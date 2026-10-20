import { bearing, cumulativeDistances, distancesOnPath, pointAtDistance, type LatLng } from "./geo";
import { tramDepartures, tramInService, tramTripDurationMin } from "./tramHours";
import type { RouteListEntry, VehicleDot } from "./types";

const HOLD_MS = 0.05;

function headingAlong(path: LatLng[], distFromStart: number): number {
  const cum = cumulativeDistances(path);
  const here = pointAtDistance(path, cum, distFromStart);
  const ahead = pointAtDistance(path, cum, distFromStart + 24);
  if (!here || !ahead) return 0;
  return bearing(here, ahead);
}

function nowMinHkt(at: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const bag: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return Number(bag.hour) * 60 + Number(bag.minute) + Number(bag.second) / 60;
}

/**
 * Deterministic simulated trams on one bound: published first/last + headway,
 * progress = elapsed / scheduled terminus duration along stop geometry.
 */
export function placeTramFleet(
  track: LatLng[],
  stops: LatLng[],
  route: RouteListEntry,
  holidays: string[],
  now = Date.now(),
): VehicleDot[] {
  const shape = track.length > 1 ? track : stops;
  if (shape.length < 2) return [];
  if (!tramInService(route, holidays, new Date(now))) return [];
  const durationMin = tramTripDurationMin(route);
  if (durationMin == null || durationMin <= 0) return [];
  const durationS = durationMin * 60;
  const cum = cumulativeDistances(shape);
  const total = cum[cum.length - 1] ?? 0;
  if (total < 20) return [];
  const atStop = stops.length > 1 ? distancesOnPath(shape, stops) : cum;
  const stopRemains = atStop.map((dist) => Math.max(0, total - dist));
  const speedMs = total / durationS;
  let clock = nowMinHkt(now);
  const deps = tramDepartures(route, holidays, new Date(now));
  if (!deps.length) return [];
  const first = deps[0] ?? 0;
  if (clock < first - 120) clock += 1440;
  const dots: VehicleDot[] = [];
  for (const dep of deps) {
    let start = dep;
    if (start < first - 1) start += 1440;
    const elapsedS = (clock - start) * 60;
    if (elapsedS < 0 || elapsedS > durationS) continue;
    const dist = Math.min(total * 0.995, (elapsedS / durationS) * total);
    const point = pointAtDistance(shape, cum, dist);
    if (!point) continue;
    dots.push({
      id: `tram:${route.orig.en}:${start}`,
      lat: point.lat,
      lng: point.lng,
      gps: false,
      speedMs: Math.max(HOLD_MS, speedMs),
      remainM: Math.max(0, total - dist),
      remainFloor: 0,
      remainCeil: total,
      stopRemains,
      headingDeg: headingAlong(shape, dist),
      track: shape,
    });
  }
  return dots;
}
