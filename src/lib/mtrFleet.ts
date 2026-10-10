import { bearing, cumulativeDistances, distancesOnPath, pointAtDistance, type LatLng } from "./geo";
import { mtrAlongLeg, mtrDepartedSeconds, mtrDwelling, mtrRemainToStop, mtrSimSeconds } from "./mtrTime";
import { liveSeconds, type StopClock } from "./routeClocks";
import type { VehicleDot } from "./types";

const HOLD_SPEED_MS = 0.05;

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

function untilArrive(apiSeconds: number): number {
  return Math.max(0, mtrSimSeconds(apiSeconds));
}

function motionSpeed(speedMs: number): number {
  return speedMs > HOLD_SPEED_MS ? speedMs : HOLD_SPEED_MS;
}

function placeTrain(track: LatLng[], stops: LatLng[], clock: StopClock, now: number): VehicleDot | null {
  if (track.length < 2 || stops.length < 2) return null;
  const cum = cumulativeDistances(track);
  const total = cum[cum.length - 1] ?? 0;
  if (total < 30) return null;
  const atStop = distancesOnPath(track, stops);
  const stopRemains = atStop.map((dist) => Math.max(0, total - dist));
  const limit = Math.min(clock.seconds.length, atStop.length);
  let flag = -1;
  for (let i = 0; i < limit; i++) {
    const value = apiLive(clock, i, now);
    if (value != null && untilArrive(value) > 0) {
      flag = i;
      break;
    }
  }
  let hold = clock.reached ?? -1;
  if (clock.justPassed != null) hold = Math.max(hold, clock.justPassed);
  for (let i = 0; i < limit; i++) {
    if (flag >= 0 && i >= flag) break;
    const value = apiLive(clock, i, now);
    if (value != null && untilArrive(value) <= 0) hold = Math.max(hold, i);
  }
  if (flag >= 0 && hold >= flag) hold = flag - 1;

  const dotAt = (dist: number, flagDist: number, backDist: number, speedMs: number): VehicleDot | null => {
    const point = pointAtDistance(track, cum, dist);
    if (!point) return null;
    const remainFloor = Math.max(0, total - flagDist);
    return {
      id: clock.id,
      lat: point.lat,
      lng: point.lng,
      gps: false,
      speedMs: motionSpeed(speedMs),
      remainM: Math.max(0, total - dist),
      remainFloor,
      remainCeil: Math.max(remainFloor, total - backDist),
      stopRemains,
      headingDeg: headingAlong(track, dist),
      track,
      lockSpeed: true,
    };
  };

  const sitAt = (stop: number, nextStop: number): VehicleDot | null => {
    const at = atStop[stop] ?? 0;
    const next = atStop[nextStop] ?? at;
    return dotAt(at, at, Math.min(at, next), HOLD_SPEED_MS);
  };

  const coastFrom = (fromStop: number, toStop: number, departed: number): VehicleDot | null => {
    const from = atStop[fromStop] ?? 0;
    const to = atStop[toStop] ?? from;
    const span = to - from;
    if (span <= 0) return sitAt(fromStop, toStop);
    const along = mtrAlongLeg(span, departed);
    if (along.dist >= span - 0.5) return sitAt(toStop, toStop);
    return dotAt(from + along.dist, to, from, along.speedMs);
  };

  const holdApi = hold >= 0 ? apiLive(clock, hold, now) : null;
  if (hold >= 0 && holdApi != null && mtrDwelling(holdApi)) {
    return sitAt(hold, flag > hold ? flag : Math.min(hold + 1, atStop.length - 1));
  }

  if (flag < 0) {
    if (hold < 0 || hold >= atStop.length - 1) return null;
    const departed = holdApi != null ? mtrDepartedSeconds(holdApi) : 0;
    if (departed <= 0) return sitAt(hold, hold + 1);
    return coastFrom(hold, hold + 1, departed);
  }

  const flagDist = atStop[flag] ?? 0;
  const flagApi = apiLive(clock, flag, now);
  const tFlag = flagApi != null ? untilArrive(flagApi) : 0;
  let floorDist = 0;
  if (hold >= 0 && hold < flag) floorDist = atStop[hold] ?? 0;
  floorDist = Math.min(floorDist, flagDist);

  if (hold >= 0 && flag === hold + 1) {
    const departed = holdApi != null ? mtrDepartedSeconds(holdApi) : 0;
    if (departed <= 0) return sitAt(hold, flag);
    return coastFrom(hold, flag, departed);
  }

  const approach = mtrRemainToStop(tFlag);
  const dist = Math.max(floorDist, Math.min(flagDist, flagDist - approach.remainM));
  if (dist >= flagDist - 0.5) return sitAt(flag, flag);
  return dotAt(dist, flagDist, floorDist, approach.speedMs);
}

/**
 * Every inferred train on an MTR line, both bounds.
 * Labels stay on the API minute / 到 / 開出 mapping. Markers use accel/coast/brake
 * up to MTR_SIM_KMH, hold through dwell plus MTR_DEPART_LAG_S, then leave.
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
