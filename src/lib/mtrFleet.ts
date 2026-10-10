import { bearing, cumulativeDistances, distancesOnPath, pointAtDistance, type LatLng } from "./geo";
import {
  MTR_ACCEL_MS2,
  MTR_DEPART_LAG_S,
  MTR_SIM_KMH,
  mtrDepartedSeconds,
  mtrDwelling,
  mtrSimSeconds,
} from "./mtrTime";
import { liveSeconds, type StopClock } from "./routeClocks";
import type { VehicleDot } from "./types";

const HOLD_SPEED_MS = 0.05;
const COAST_MS = (MTR_SIM_KMH * 1000) / 3600;

function headingAlong(path: LatLng[], distFromStart: number): number {
  const cum = cumulativeDistances(path);
  const here = pointAtDistance(path, cum, distFromStart);
  const ahead = pointAtDistance(path, cum, distFromStart + 28);
  if (!here || !ahead) return 0;
  return bearing(here, ahead);
}

function apiLive(clock: StopClock, index: number, now: number): number | null {
  return liveSeconds(clock, index, now);
}

type LegProfile = {
  tAcc: number;
  tCoast: number;
  tTot: number;
  vPeak: number;
  dAcc: number;
};

/** Accel to peak (or a triangle if the hop is short), coast, then matching brake into the next stop. */
function legProfile(spanM: number): LegProfile {
  const span = Math.max(0, spanM);
  const a = MTR_ACCEL_MS2;
  if (span <= 1 || a <= 0) {
    return { tAcc: 0, tCoast: 0, tTot: 0, vPeak: 0, dAcc: 0 };
  }
  const dAccFull = (COAST_MS * COAST_MS) / (2 * a);
  if (2 * dAccFull >= span) {
    const vPeak = Math.sqrt(a * span);
    const tAcc = vPeak / a;
    return { tAcc, tCoast: 0, tTot: 2 * tAcc, vPeak, dAcc: span / 2 };
  }
  const tAcc = COAST_MS / a;
  const dCoast = span - 2 * dAccFull;
  return { tAcc, tCoast: dCoast / COAST_MS, tTot: 2 * tAcc + dCoast / COAST_MS, vPeak: COAST_MS, dAcc: dAccFull };
}

function motionOnLeg(spanM: number, tMove: number): { dist: number; speed: number } {
  const span = Math.max(0, spanM);
  if (tMove <= 0 || span <= 0) return { dist: 0, speed: 0 };
  const p = legProfile(span);
  if (p.tTot <= 0 || tMove >= p.tTot) return { dist: span, speed: 0 };
  const a = MTR_ACCEL_MS2;
  if (tMove <= p.tAcc) {
    return { dist: 0.5 * a * tMove * tMove, speed: a * tMove };
  }
  if (tMove <= p.tAcc + p.tCoast) {
    const coastT = tMove - p.tAcc;
    return { dist: p.dAcc + p.vPeak * coastT, speed: p.vPeak };
  }
  const brakeT = tMove - p.tAcc - p.tCoast;
  const dist = p.dAcc + p.vPeak * p.tCoast + p.vPeak * brakeT - 0.5 * a * brakeT * brakeT;
  return { dist: Math.max(0, Math.min(span, dist)), speed: Math.max(0, p.vPeak - a * brakeT) };
}

function placeTrain(track: LatLng[], stops: LatLng[], clock: StopClock, now: number): VehicleDot | null {
  if (track.length < 2 || stops.length < 2) return null;
  const cum = cumulativeDistances(track);
  const total = cum[cum.length - 1] ?? 0;
  if (total < 30) return null;
  const atStop = distancesOnPath(track, stops);
  const stopRemains = atStop.map((dist) => Math.max(0, total - dist));
  const limit = Math.min(clock.seconds.length, atStop.length);

  // Raw live seconds, not dwell-adjusted: 開出 still has api in (0, 30), so this
  // stop stays the target until it is actually due. That is what #15 flipped.
  let upcoming = -1;
  for (let i = 0; i < limit; i++) {
    const value = apiLive(clock, i, now);
    if (value != null && value > 0) {
      upcoming = i;
      break;
    }
  }
  let due = clock.reached ?? -1;
  if (clock.justPassed != null) due = Math.max(due, clock.justPassed);
  for (let i = 0; i < limit; i++) {
    if (upcoming >= 0 && i >= upcoming) break;
    const value = apiLive(clock, i, now);
    if (value != null && value <= 0) due = Math.max(due, i);
  }
  if (upcoming >= 0 && due >= upcoming) due = upcoming - 1;

  const dotAt = (dist: number, flagDist: number, backDist: number, speedMs: number): VehicleDot | null => {
    const point = pointAtDistance(track, cum, dist);
    if (!point) return null;
    const remainFloor = Math.max(0, total - flagDist);
    return {
      id: clock.id,
      lat: point.lat,
      lng: point.lng,
      gps: false,
      speedMs,
      remainM: Math.max(0, total - dist),
      remainFloor,
      remainCeil: Math.max(remainFloor, total - backDist),
      stopRemains,
      headingDeg: headingAlong(track, dist),
      track,
    };
  };

  const sitAt = (stop: number, nextStop: number): VehicleDot | null => {
    const at = atStop[stop] ?? 0;
    const next = atStop[nextStop] ?? at;
    return dotAt(at, at, Math.min(at, next), HOLD_SPEED_MS);
  };

  const runLeg = (fromStop: number, toStop: number, tMove: number): VehicleDot | null => {
    const from = atStop[fromStop] ?? 0;
    const to = atStop[toStop] ?? from;
    const span = to - from;
    if (span <= 0) return sitAt(fromStop, toStop);
    const { dist: along, speed } = motionOnLeg(span, tMove);
    if (along <= 0) return sitAt(fromStop, toStop);
    if (along >= span) return sitAt(toStop, toStop);
    return dotAt(from + along, to, from, Math.max(HOLD_SPEED_MS, speed));
  };

  const departedFromArrival = (fromStop: number, toStop: number, untilS: number): number => {
    const span = (atStop[toStop] ?? 0) - (atStop[fromStop] ?? 0);
    return Math.max(0, legProfile(span).tTot - Math.max(0, untilS));
  };

  // Still counting down to this stop (到 / minutes / early 開出 with api>0):
  // sit once sim-arrived, otherwise roll in from the previous station.
  if (upcoming >= 0 && due < 0) {
    const eta = apiLive(clock, upcoming, now);
    if (eta != null && mtrDwelling(eta)) {
      return sitAt(upcoming, Math.min(upcoming + 1, atStop.length - 1));
    }
    if (upcoming === 0) return sitAt(0, Math.min(1, atStop.length - 1));
    const until = eta != null ? Math.max(0, mtrSimSeconds(eta)) : 0;
    const tMove = departedFromArrival(upcoming - 1, upcoming, until);
    if (tMove <= 0) return sitAt(upcoming - 1, upcoming);
    return runLeg(upcoming - 1, upcoming, tMove);
  }

  const origin = due >= 0 ? due : upcoming > 0 ? upcoming - 1 : -1;
  if (origin < 0) return null;

  if (origin >= atStop.length - 1 && upcoming < 0) {
    if (origin === 0) return sitAt(0, 0);
    const prevApi = apiLive(clock, origin - 1, now);
    let tMove: number;
    if (prevApi != null) tMove = mtrDepartedSeconds(prevApi);
    else if (clock.justPassed === origin - 1 && clock.passedAt != null) {
      tMove = Math.max(0, (now - clock.passedAt) / 1000 - MTR_DEPART_LAG_S);
    } else tMove = departedFromArrival(origin - 1, origin, 0);
    if (tMove <= 0) return sitAt(origin - 1, origin);
    return runLeg(origin - 1, origin, tMove);
  }

  const dest = upcoming > origin ? upcoming : Math.min(origin + 1, atStop.length - 1);
  if (dest <= origin) return sitAt(origin, origin);

  const originApi = apiLive(clock, origin, now);
  if (originApi != null && mtrDwelling(originApi)) return sitAt(origin, dest);

  const destApi = apiLive(clock, dest, now);
  const untilDest = destApi != null ? Math.max(0, mtrSimSeconds(destApi)) : 0;
  let departed: number;
  if (originApi != null) {
    departed = mtrDepartedSeconds(originApi);
  } else if (clock.justPassed === origin && clock.passedAt != null) {
    departed = Math.max(0, (now - clock.passedAt) / 1000 - MTR_DEPART_LAG_S);
  } else {
    departed = departedFromArrival(origin, dest, untilDest);
  }
  if (departed <= 0) return sitAt(origin, dest);
  return runLeg(origin, dest, departed);
}

/**
 * Every inferred train on an MTR line, both bounds.
 * Labels stay on the API minute / 到 / 開出 mapping. Markers accel / coast at
 * MTR_SIM_KMH / brake along the polyline, hold MTR_DWELL_S on the platform, then
 * wait MTR_DEPART_LAG_S after 開出 before the motion-only depart.
 */
export function placeMtrFleet(track: LatLng[], stops: LatLng[], clocks: StopClock[], now = Date.now()): VehicleDot[] {
  if (track.length < 2 || stops.length < 2 || !clocks.length) return [];
  const downTrack = [...track].reverse();
  const downStops = [...stops].reverse();
  const dots: VehicleDot[] = [];
  const used = new Set<string>();
  for (const clock of clocks) {
    const reverse = Boolean(clock.reverse);
    const dot = placeTrain(reverse ? downTrack : track, reverse ? downStops : stops, clock, now);
    if (!dot) continue;
    let id = dot.id ?? clock.id;
    let n = 2;
    while (used.has(id)) id = `${clock.id}-${n++}`;
    used.add(id);
    dots.push({ ...dot, id });
  }
  return dots;
}
