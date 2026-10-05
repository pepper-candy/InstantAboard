import {
  cumulativeDistances,
  haversine,
  interpolateAlong,
  pathLength,
  pointAtDistance,
  distancesOnPath,
  sliceShapeToStops,
  type LatLng,
} from "./geo";
import type { Arrival, Company, VehicleDot } from "./types";
import { isDueLive, liveSeconds, type StopClock } from "./routeClocks";

const SPEED_KMH: Record<string, number> = {
  kmb: 18,
  ctb: 18,
  gmb: 16,
  nlb: 22,
  lrtfeeder: 20,
  lightRail: 28,
  mtr: 40,
  sunferry: 22,
  hkkf: 22,
  fortuneferry: 22,
  tram: 12,
};

const HOLD_SPEED = 0.05;
const STOP_SLACK_M = 15;
const BACK_M = 300;
const SPEED_SETTLE_S = 4;
const CATCH_UP_S = 10;
const SPEED_BOOST = 1.5;
const SPEED_WEIGHTS = [1, 0.7, 0.5, 0.35, 0.25];
/** Soften forward prediction near stops / stalled progress. Not a live signal timer. */
const LIGHT_DWELL_S = 15;

export function companySpeedMs(company: Company): number {
  return ((SPEED_KMH[company] ?? 18) * 1000) / 3600;
}

function secondsRemaining(arrival: Arrival): number | null {
  if (arrival.at) {
    const at = Date.parse(arrival.at);
    if (Number.isFinite(at)) return Math.max(0, (at - Date.now()) / 1000);
  }
  if (arrival.minutes == null) return null;
  return Math.max(0, arrival.minutes) * 60;
}

export function estimateVehicle(
  pathToStop: LatLng[],
  arrivals: Arrival[],
  company: Company,
): VehicleDot | null {
  const speedMs = companySpeedMs(company);
  const gps = arrivals.find((a) => a.gps && a.lat != null && a.lng != null);
  if (gps && gps.lat != null && gps.lng != null) {
    return { lat: gps.lat, lng: gps.lng, gps: true, speedMs };
  }
  const next = arrivals.find((a) => a.minutes != null);
  if (!next || next.minutes == null || pathToStop.length < 2) return null;
  const seconds = secondsRemaining(next);
  if (seconds == null) return null;
  const max = pathLength(pathToStop);
  const remainM = Math.min(speedMs * seconds, max * 0.98);
  const along = interpolateAlong(pathToStop, remainM);
  if (!along) return null;
  return { ...along, gps: false, speedMs, remainM };
}

export function pathUpTo(stops: LatLng[], seq: number, shape?: LatLng[] | null): LatLng[] {
  if (!stops.length) return [];
  const prefix = stops.slice(0, Math.max(1, Math.min(stops.length, seq + 1)));
  if (!shape || shape.length < 2) return prefix;
  return sliceShapeToStops(shape, prefix);
}

function segmentT(a: LatLng, b: LatLng, p: LatLng): number {
  const lat0 = (((a.lat + b.lat + p.lat) / 3) * Math.PI) / 180;
  const cos = Math.cos(lat0);
  const x = (lng: number) => lng * cos * 111_320;
  const y = (lat: number) => lat * 110_540;
  const ax = x(a.lng);
  const ay = y(a.lat);
  const bx = x(b.lng);
  const by = y(b.lat);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return 0;
  const px = x(p.lng);
  const py = y(p.lat);
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
}

function projectRemain(path: LatLng[], point: LatLng): number {
  if (path.length < 2) return 0;
  let bestDist = Infinity;
  let bestRemain = 0;
  let after = 0;
  for (let i = path.length - 1; i > 0; i--) {
    const endSide = path[i];
    const startSide = path[i - 1];
    const seg = haversine(endSide, startSide);
    const t = seg <= 1 ? 0 : segmentT(endSide, startSide, point);
    const proj = {
      lat: endSide.lat + (startSide.lat - endSide.lat) * t,
      lng: endSide.lng + (startSide.lng - endSide.lng) * t,
    };
    const dist = haversine(proj, point);
    if (dist < bestDist) {
      bestDist = dist;
      bestRemain = after + t * seg;
    }
    after += seg;
  }
  return bestRemain;
}

function trackSignature(track: LatLng[]): string {
  if (track.length < 2) return "";
  const a = track[0];
  const mid = track[Math.floor(track.length / 2)];
  const b = track[track.length - 1];
  return `${track.length}:${a.lat.toFixed(5)}:${a.lng.toFixed(5)}:${mid.lat.toFixed(5)}:${mid.lng.toFixed(5)}:${b.lat.toFixed(5)}:${b.lng.toFixed(5)}`;
}

function sampleKey(sample: VehicleDot, track: LatLng[]): string {
  return [
    sample.gps ? "g" : "e",
    sample.lat.toFixed(5),
    sample.lng.toFixed(5),
    sample.remainM != null ? sample.remainM.toFixed(0) : "",
    sample.remainFloor != null ? sample.remainFloor.toFixed(0) : "",
    sample.speedMs.toFixed(2),
    trackSignature(track),
  ].join("|");
}

const FLOAT_M = 36;

function placeOnPath(path: LatLng[], remain: number): LatLng | null {
  if (path.length < 2) return null;
  const max = pathLength(path);
  const ahead = Math.min(FLOAT_M, remain);
  const behind = Math.min(FLOAT_M, Math.max(0, max - remain));
  const samples: [number, number][] = [
    [0, 4],
    [-ahead * 0.5, 2],
    [behind * 0.5, 2],
    [-ahead, 1],
    [behind, 1],
  ];
  let lat = 0;
  let lng = 0;
  let weight = 0;
  for (const [offset, w] of samples) {
    const point = interpolateAlong(path, Math.max(0, Math.min(max, remain + offset)));
    if (!point || w <= 0) continue;
    lat += point.lat * w;
    lng += point.lng * w;
    weight += w;
  }
  if (weight <= 0) return null;
  return { lat: lat / weight, lng: lng / weight };
}

export function createVehicleMotion() {
  let started = false;
  let lat = 0;
  let lng = 0;
  let remain = 0;
  let speed = 0;
  let baseSpeed = 0;
  let targetSpeed = 0;
  let dataRemain = 0;
  let lastNow = 0;
  let seen = "";
  let trackSig = "";
  let busId = "";
  let path: LatLng[] = [];
  let floorRemain = 0;
  let ceilRemain = Number.POSITIVE_INFINITY;
  let waiting = false;
  let stops: number[] = [];

  function put(next: LatLng | null, fallback: LatLng) {
    lat = next?.lat ?? fallback.lat;
    lng = next?.lng ?? fallback.lng;
  }

  function clampRemain(value: number) {
    const lo = floorRemain;
    const hi = Math.max(lo, ceilRemain);
    return Math.min(hi, Math.max(lo, value));
  }

  /** Snap forward onto a new Due/passed floor; never jump backward here. */
  function pullForward() {
    if (remain > ceilRemain) {
      remain = ceilRemain;
      put(placeOnPath(path, remain), { lat, lng });
      waiting = false;
    }
  }

  function applyLimits(sample: VehicleDot) {
    floorRemain = Math.max(0, sample.remainFloor ?? 0);
    ceilRemain = Math.max(floorRemain, sample.remainCeil ?? Number.POSITIVE_INFINITY);
    stops = sample.stopRemains ?? [];
    baseSpeed = Math.max(0, sample.speedMs);
  }

  /** Marker is past a stop the latest sample has not reached. Larger remain is further back. */
  function aheadOfData(): boolean {
    if (dataRemain <= remain + STOP_SLACK_M) return false;
    for (const stop of stops) {
      if (stop > remain + STOP_SLACK_M && stop < dataRemain + STOP_SLACK_M) return true;
    }
    return false;
  }

  function snap(sample: VehicleDot) {
    applyLimits(sample);
    waiting = false;
    targetSpeed = baseSpeed;
    speed = baseSpeed;
    if (sample.gps || path.length < 2) {
      lat = sample.lat;
      lng = sample.lng;
      remain = projectRemain(path, sample);
      dataRemain = remain;
      return;
    }
    const raw = sample.remainM ?? projectRemain(path, sample);
    remain = clampRemain(raw);
    dataRemain = remain;
    put(placeOnPath(path, remain), sample);
  }

  function advance(now: number) {
    const dt = Math.min(0.5, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    const gap = remain - dataRemain;
    if (!waiting && gap > 8 && baseSpeed > HOLD_SPEED) {
      targetSpeed = Math.min(baseSpeed * SPEED_BOOST, baseSpeed + gap / CATCH_UP_S);
    } else {
      targetSpeed = baseSpeed;
    }
    speed += (targetSpeed - speed) * Math.min(1, dt / SPEED_SETTLE_S);
    if (path.length > 1 && baseSpeed > HOLD_SPEED) {
      dataRemain = clampRemain(dataRemain - baseSpeed * dt);
    }
    pullForward();
    if (waiting) {
      if (!aheadOfData() && dataRemain <= remain + 8) waiting = false;
      else return;
    }
    if (speed <= HOLD_SPEED || path.length < 2) return;
    const next = remain - speed * dt;
    remain = clampRemain(next);
    put(placeOnPath(path, remain), { lat, lng });
  }

  function adopt(sample: VehicleDot, track: LatLng[], initial: boolean) {
    const nextSig = trackSignature(track);
    const switched = !initial && nextSig !== trackSig && track.length > 1;
    const relink = !initial && Boolean(sample.id) && sample.id !== busId;
    if (track.length > 1) {
      path = track;
      trackSig = nextSig;
    }
    if (sample.id) busId = sample.id;
    if (initial || switched || relink || sample.gps) {
      snap(sample);
      return;
    }
    applyLimits(sample);
    const raw = sample.remainM ?? (path.length > 1 ? projectRemain(path, sample) : remain);
    dataRemain = clampRemain(raw);
    pullForward();
    if (aheadOfData() || dataRemain - remain > BACK_M) {
      waiting = true;
      return;
    }
    const lag = remain - dataRemain;
    if (lag > STOP_SLACK_M) {
      remain = dataRemain;
      put(placeOnPath(path, remain), sample);
      waiting = false;
      return;
    }
    if (waiting && dataRemain <= remain + 8) waiting = false;
  }

  return {
    frame(now: number, sample: VehicleDot, track: LatLng[]): LatLng {
      const key = sampleKey(sample, track);
      if (!started) {
        adopt(sample, track, true);
        started = true;
        seen = key;
        lastNow = now;
        return { lat, lng };
      }
      if (key !== seen) {
        advance(now);
        adopt(sample, track, false);
        seen = key;
        return { lat, lng };
      }
      advance(now);
      return { lat, lng };
    },
    waiting() {
      return waiting;
    },
  };
}

export type RoadPace = {
  /** Live traffic speed at a point, km/h. Null when no detector covers it. */
  kmhAt(point: LatLng): number | null;
  /** Posted speed limit at a point, km/h. Null when the road network has no match. */
  limitAt(point: LatLng): number | null;
};

const ROAD_COMPANIES = new Set<Company>(["kmb", "ctb", "gmb", "nlb"]);

export function isRoadFleet(company: Company | undefined): company is Company {
  return Boolean(company && ROAD_COMPANIES.has(company));
}

function companyKmh(company: Company): number {
  return SPEED_KMH[company] ?? 18;
}

/** Modelled speed: live traffic where a detector matches, never above the posted limit. */
function modelKmh(company: Company, pace: RoadPace | null, point: LatLng): number {
  const fallback = companyKmh(company);
  const live = pace?.kmhAt(point);
  const limit = pace?.limitAt(point);
  let kmh = live != null && live > 0 ? live : fallback;
  if (limit != null && limit > 0) kmh = Math.min(kmh, limit);
  return Math.max(8, Math.min(70, kmh));
}

function stopDistances(track: LatLng[], stops: LatLng[]): number[] {
  return distancesOnPath(track, stops);
}

function timeWeighted(
  track: LatLng[],
  cum: number[],
  company: Company,
  pace: RoadPace | null,
  from: number,
  to: number,
  fraction: number,
): number {
  if (to <= from + 5) return from;
  const held = Math.max(0, Math.min(0.98, fraction));
  const parts: { len: number; sec: number }[] = [];
  for (let d = from; d < to - 0.5; ) {
    const len = Math.min(40, to - d);
    const mid = pointAtDistance(track, cum, d + len / 2);
    const ms = ((mid ? modelKmh(company, pace, mid) : companyKmh(company)) * 1000) / 3600;
    parts.push({ len, sec: len / Math.max(1, ms) });
    d += len;
  }
  const total = parts.reduce((sum, part) => sum + part.sec, 0);
  let need = held * total;
  let dist = from;
  for (const part of parts) {
    if (need <= part.sec) return dist + part.len * (part.sec <= 0 ? 0 : need / part.sec);
    need -= part.sec;
    dist += part.len;
  }
  return Math.min(to, dist);
}

/** Walk back from the next stop. Null when the vehicle is still before the start of the route. */
function approachDistance(
  track: LatLng[],
  cum: number[],
  company: Company,
  pace: RoadPace | null,
  flagDist: number,
  seconds: number,
): number | null {
  let left = Math.max(0, seconds);
  let dist = Math.max(0, flagDist);
  while (left > 0.5 && dist > 1) {
    const len = Math.min(40, dist);
    const mid = pointAtDistance(track, cum, dist - len / 2);
    const ms = ((mid ? modelKmh(company, pace, mid) : companyKmh(company)) * 1000) / 3600;
    const dt = len / Math.max(1, ms);
    if (dt >= left) return Math.max(0, Math.min(flagDist, dist - len * (left / dt)));
    dist -= len;
    left -= dt;
  }
  if (left > 1) return null;
  return Math.max(0, Math.min(flagDist, dist));
}

function etaGap(clock: StopClock, from: number, to: number): number | null {
  const secFrom = clock.seconds[from];
  const secTo = clock.seconds[to];
  const stampFrom = clock.stamps[from];
  const stampTo = clock.stamps[to];
  if (secFrom == null || secTo == null || stampFrom == null || stampTo == null) return null;
  return secTo - secFrom + (stampTo - stampFrom) / 1000;
}

/** Weighted m/s across the next few stop-to-stop gaps. Null when none qualify. */
function cruiseMs(clock: StopClock, atStop: number[], fromStop: number): number | null {
  let acc = 0;
  let weight = 0;
  let used = 0;
  const last = Math.min(atStop.length - 1, fromStop + SPEED_WEIGHTS.length);
  for (let i = fromStop; i < last; i++) {
    const dt = etaGap(clock, i, i + 1);
    const dist = (atStop[i + 1] ?? 0) - (atStop[i] ?? 0);
    if (dt == null || dt < 8 || dist < 30) continue;
    const leg = dist / dt;
    if (leg < 0.5 || leg > 30) continue;
    const w = SPEED_WEIGHTS[used] ?? 0;
    acc += leg * w;
    weight += w;
    used++;
  }
  if (weight <= 0) return null;
  return acc / weight;
}

/** Metres per second from this bus's ETA at the next stop to the stop after. */
function segmentSpeedMs(clock: StopClock, atStop: number[], next: number): number | null {
  const after = next + 1;
  if (after >= clock.seconds.length || after >= atStop.length) return null;
  const secNext = clock.seconds[next];
  const secAfter = clock.seconds[after];
  const stampNext = clock.stamps[next];
  const stampAfter = clock.stamps[after];
  if (secNext == null || secAfter == null || stampNext == null || stampAfter == null) return null;
  const dt = secAfter - secNext + (stampAfter - stampNext) / 1000;
  const dist = (atStop[after] ?? 0) - (atStop[next] ?? 0);
  if (dt < 8 || dist < 30) return null;
  const speed = dist / dt;
  if (speed < 0.5 || speed > 30) return null;
  return speed;
}

/**
 * Every vehicle sits on the full route, between the last stop it has passed
 * and the next one. Changing which stop is selected does not move them.
 */
export function placeFleet(
  track: LatLng[],
  stops: LatLng[],
  clocks: StopClock[],
  company: Company,
  pace: RoadPace | null,
  now = Date.now(),
): VehicleDot[] {
  if (track.length < 2 || stops.length < 2 || !clocks.length) return [];
  const cum = cumulativeDistances(track);
  const total = cum[cum.length - 1] ?? 0;
  if (total < 30) return [];
  const atStop = stopDistances(track, stops);
  const stopRemains = atStop.map((dist) => Math.max(0, total - dist));
  const used = new Set<string>();
  const dots: VehicleDot[] = [];

  const uniqueId = (id: string) => {
    let next = id;
    let n = 2;
    while (used.has(next)) next = `${id}-${n++}`;
    used.add(next);
    return next;
  };

  const dotAt = (id: string, dist: number, flagDist: number, backDist: number, speedMs: number): VehicleDot | null => {
    const point = pointAtDistance(track, cum, dist);
    if (!point) return null;
    const remainFloor = Math.max(0, total - flagDist);
    return {
      id: uniqueId(id),
      lat: point.lat,
      lng: point.lng,
      gps: false,
      speedMs,
      remainM: Math.max(0, total - dist),
      remainFloor,
      remainCeil: Math.max(remainFloor, total - backDist),
      stopRemains,
    };
  };

  for (const clock of clocks) {
    const live = (i: number) => liveSeconds(clock, i, now);
    let flag = -1;
    const limit = Math.min(clock.seconds.length, atStop.length);
    const reachedMem = clock.reached ?? -1;
    for (let i = 0; i < limit; i++) {
      if (i <= reachedMem) continue;
      const value = live(i);
      if (value != null && value > 0) {
        flag = i;
        break;
      }
    }
    const passed = clock.justPassed;
    let hold = reachedMem;
    if (passed != null) hold = Math.max(hold, passed);
    for (let i = 0; i < limit; i++) {
      if (flag >= 0 && i >= flag) break;
      if (isDueLive(live(i))) hold = Math.max(hold, i);
    }
    if (flag >= 0 && hold >= flag) hold = flag - 1;

    if (flag < 0) {
      if (hold < 0 || hold >= atStop.length) continue;
      const at = atStop[hold];
      if (at == null) continue;
      const dot = dotAt(clock.id, at, at, at, 0);
      if (dot) dots.push(dot);
      if (dots.length >= 8) break;
      continue;
    }
    const flagDist = atStop[flag] ?? 0;
    const tFlag = Math.max(0, live(flag) ?? 0);
    let floorDist = 0;
    if (hold >= 0 && hold < flag) floorDist = atStop[hold] ?? 0;
    floorDist = Math.min(floorDist, flagDist);
    const dueHold = hold >= 0 && isDueLive(live(hold));

    const slip = clock.progress ?? 1;
    const stalled = slip < 0.05;
    const legStart = flag > 0 && clock.seconds[flag - 1] != null ? flag - 1 : flag;
    const cruise = cruiseMs(clock, atStop, legStart) ?? companySpeedMs(company);
    const corrected = dueHold ? 0 : Math.min(30, Math.max(0, cruise * Math.max(0, slip)));
    let dist: number | null = null;

    if (dueHold) {
      dist = floorDist;
    } else if (passed != null && passed >= 0 && passed < flag && clock.passedAt != null) {
      const from = Math.max(floorDist, atStop[passed] ?? floorDist);
      const ago = Math.max(0, (now - clock.passedAt) / 1000 - LIGHT_DWELL_S);
      const cap = Math.max(from, flagDist);
      dist = Math.min(cap, from + Math.max(0, cruise * Math.max(0, slip)) * ago);
      dist = Math.max(floorDist, Math.min(flagDist, dist));
    } else if (tFlag <= LIGHT_DWELL_S) {
      dist = flagDist;
    } else {
      const hop = segmentSpeedMs(clock, atStop, flag);
      const guess = Math.max(0, tFlag - 8);
      if (hop != null) {
        const raw = flagDist - hop * guess;
        dist = floorDist <= 0 && raw < -30 ? null : Math.max(floorDist, Math.min(flagDist, raw));
      } else {
        dist = approachDistance(track, cum, company, pace, flagDist, guess);
      }
      if (stalled && dist != null && floorDist > 0) dist = Math.max(dist, floorDist);
      if (dist != null) dist = Math.max(floorDist, Math.min(flagDist, dist));
      else if (floorDist > 0) dist = floorDist;
    }
    if (dist == null) continue;
    const dot = dotAt(clock.id, dist, flagDist, floorDist, corrected);
    if (dot) dots.push(dot);
    if (dots.length >= 8) break;
  }

  return dots;
}
