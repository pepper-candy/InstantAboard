import { bearing, cumulativeDistances, distancesOnPath, pointAtDistance, type LatLng } from "./geo";
import { mtrSimSeconds } from "./mtrTime";
import { liveSeconds, type StopClock } from "./routeClocks";
import type { VehicleDot } from "./types";
import { companySpeedMs } from "./vehicle";

function headingAlong(path: LatLng[], distFromStart: number): number {
  const cum = cumulativeDistances(path);
  const here = pointAtDistance(path, cum, distFromStart);
  const ahead = pointAtDistance(path, cum, distFromStart + 28);
  if (!here || !ahead) return 0;
  return bearing(here, ahead);
}

function simLive(clock: StopClock, index: number, now: number): number | null {
  const value = liveSeconds(clock, index, now);
  if (value == null) return null;
  return mtrSimSeconds(value);
}

function cruiseMs(clock: StopClock, atStop: number[], fromStop: number, now: number): number {
  const fallback = companySpeedMs("mtr");
  const after = fromStop + 1;
  if (after >= clock.seconds.length || after >= atStop.length) return fallback;
  const a = liveSeconds(clock, fromStop, now);
  const b = liveSeconds(clock, after, now);
  const dist = (atStop[after] ?? 0) - (atStop[fromStop] ?? 0);
  if (a == null || b == null || dist < 30) return fallback;
  const dt = b - a;
  if (dt < 8) return fallback;
  const speed = dist / dt;
  if (speed < 2 || speed > 40) return fallback;
  return speed;
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
    const value = simLive(clock, i, now);
    if (value != null && value > 0) {
      flag = i;
      break;
    }
  }
  let hold = clock.reached ?? -1;
  if (clock.justPassed != null) hold = Math.max(hold, clock.justPassed);
  for (let i = 0; i < limit; i++) {
    if (flag >= 0 && i >= flag) break;
    const value = simLive(clock, i, now);
    if (value != null && value <= 0) hold = Math.max(hold, i);
  }
  if (flag >= 0 && hold >= flag) hold = flag - 1;

  const legStart = flag > 0 ? flag - 1 : hold >= 0 ? hold : 0;
  const speedMs = cruiseMs(clock, atStop, Math.max(0, legStart), now);

  const dotAt = (dist: number, flagDist: number, backDist: number): VehicleDot | null => {
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

  if (flag < 0) {
    if (hold < 0 || hold >= atStop.length - 1) return null;
    const from = atStop[hold] ?? 0;
    const to = atStop[hold + 1] ?? from;
    const departed = Math.max(0, -(simLive(clock, hold, now) ?? 0));
    const dist = Math.min(to - 8, from + speedMs * departed);
    if (dist <= from) return dotAt(Math.min(to, from + Math.min(40, (to - from) * 0.08)), to, from);
    return dotAt(Math.max(from, dist), to, from);
  }

  const flagDist = atStop[flag] ?? 0;
  const tFlag = Math.max(0, simLive(clock, flag, now) ?? 0);
  let floorDist = 0;
  if (hold >= 0 && hold < flag) floorDist = atStop[hold] ?? 0;
  floorDist = Math.min(floorDist, flagDist);

  let dist: number;
  if (hold >= 0 && flag === hold + 1) {
    const departed = Math.max(0, -(simLive(clock, hold, now) ?? 0));
    const span = flagDist - floorDist;
    const leg = departed + tFlag;
    if (leg > 1 && span > 0) dist = floorDist + span * (departed / leg);
    else dist = floorDist + Math.min(span, speedMs * Math.max(departed, 1));
  } else {
    dist = flagDist - speedMs * tFlag;
  }
  dist = Math.max(floorDist, Math.min(flagDist, dist));
  if (hold >= 0 && flag === hold + 1 && dist <= floorDist + 1) {
    dist = Math.min(flagDist, floorDist + Math.min(48, (flagDist - floorDist) * 0.1));
  }
  return dotAt(dist, flagDist, floorDist);
}

/**
 * Every inferred train on an MTR line, both bounds. API times are treated as
 * arrival + dwell; markers leave a station as soon as that stop shows 開出.
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
