import {
  cumulativeDistances,
  haversine,
  interpolateAlong,
  pathLength,
  pointAtDistance,
  projectForward,
  sliceShapeToStops,
  type LatLng,
} from "./geo";
import type { Arrival, Company, VehicleDot } from "./types";
import type { StopClock } from "./routeClocks";

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

const EASE_MS = 1000;

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

type MotionMode = "ease" | "creep" | "hold";

function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
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
    trackSignature(track),
  ].join("|");
}

function placeOnPath(path: LatLng[], remain: number): LatLng | null {
  if (path.length < 2) return null;
  return interpolateAlong(path, Math.max(0, remain));
}

export function createVehicleMotion() {
  let started = false;
  let lat = 0;
  let lng = 0;
  let remain = 0;
  let speed = 0;
  let mode: MotionMode = "hold";
  let easeGps = false;
  let easeFrom = 0;
  let easeTo = 0;
  let easeStart = 0;
  let fromLL: LatLng = { lat: 0, lng: 0 };
  let toLL: LatLng = { lat: 0, lng: 0 };
  let after: "creep" | "hold" = "creep";
  let lastNow = 0;
  let seen = "";
  let trackSig = "";
  let path: LatLng[] = [];
  let floorRemain = 0;
  const easeMs =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : EASE_MS;

  function put(next: LatLng | null, fallback: LatLng) {
    lat = next?.lat ?? fallback.lat;
    lng = next?.lng ?? fallback.lng;
  }

  function advance(now: number) {
    const dt = Math.min(0.5, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    if (mode === "ease") {
      const t = easeMs <= 0 ? 1 : Math.min(1, (now - easeStart) / easeMs);
      const e = easeOut(t);
      if (easeGps) {
        lat = fromLL.lat + (toLL.lat - fromLL.lat) * e;
        lng = fromLL.lng + (toLL.lng - fromLL.lng) * e;
      } else {
        remain = Math.max(floorRemain, easeFrom + (easeTo - easeFrom) * e);
        put(placeOnPath(path, remain), { lat, lng });
      }
      if (t >= 1) {
        mode = after;
        if (easeGps) remain = projectRemain(path, { lat, lng });
      }
      return;
    }
    if (mode === "creep" && speed > 0 && path.length > 1) {
      remain = Math.max(floorRemain, remain - speed * dt);
      put(placeOnPath(path, remain), { lat, lng });
    }
  }

  function beginEase(now: number, gpsMove: boolean, from: number, to: number, next: LatLng, then: "creep" | "hold") {
    easeGps = gpsMove;
    easeFrom = from;
    easeTo = to;
    fromLL = { lat, lng };
    toLL = next;
    easeStart = now;
    after = then;
    speed = then === "creep" ? speed : 0;
    if (easeMs <= 0) {
      if (gpsMove) {
        lat = next.lat;
        lng = next.lng;
        remain = projectRemain(path, next);
      } else {
        remain = Math.max(floorRemain, to);
        put(placeOnPath(path, remain), next);
      }
      mode = then;
      return;
    }
    mode = "ease";
  }

  function adopt(sample: VehicleDot, track: LatLng[], now: number, initial: boolean) {
    const nextSig = trackSignature(track);
    const switched = !initial && nextSig !== trackSig && track.length > 1;
    if (track.length > 1) {
      path = track;
      trackSig = nextSig;
    }
    speed = sample.speedMs;
    floorRemain = Math.max(0, sample.remainFloor ?? 0);
    if (initial) {
      if (sample.gps || path.length < 2) {
        lat = sample.lat;
        lng = sample.lng;
        remain = projectRemain(path, sample);
        mode = "hold";
        easeGps = false;
        return;
      }
      remain = Math.max(floorRemain, sample.remainM ?? projectRemain(path, sample));
      put(placeOnPath(path, remain), sample);
      mode = "creep";
      easeGps = false;
      return;
    }

    if (sample.gps) {
      beginEase(now, true, remain, remain, { lat: sample.lat, lng: sample.lng }, "hold");
      return;
    }

    const wasOffPath = easeGps || mode === "hold" || switched || path.length < 2;
    const here = wasOffPath ? projectRemain(path, { lat, lng }) : remain;
    remain = here;
    const rawTarget = sample.remainM ?? (path.length > 1 ? projectRemain(path, sample) : here);
    const target = Math.max(floorRemain, rawTarget);
    const behind = target - here;
    const limit = Math.max(120, sample.speedMs * 15);
    if (!switched && behind <= limit && behind >= -8) {
      easeGps = false;
      speed = behind > 8 ? sample.speedMs * Math.max(0, 1 - behind / limit) : sample.speedMs;
      mode = path.length > 1 ? "creep" : "hold";
      return;
    }
    if (path.length < 2) {
      beginEase(now, true, here, target, { lat: sample.lat, lng: sample.lng }, "hold");
      return;
    }
    beginEase(now, false, here, target, sample, "creep");
  }

  return {
    frame(now: number, sample: VehicleDot, track: LatLng[]): LatLng {
      const key = sampleKey(sample, track);
      if (!started) {
        adopt(sample, track, now, true);
        started = true;
        seen = key;
        lastNow = now;
        return { lat, lng };
      }
      if (key !== seen) {
        advance(now);
        adopt(sample, track, now, false);
        seen = key;
        return { lat, lng };
      }
      advance(now);
      return { lat, lng };
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

function stopDistances(track: LatLng[], cum: number[], stops: LatLng[]): number[] {
  let minDist = 0;
  return stops.map((stop) => {
    const dist = projectForward(track, cum, stop, minDist);
    minDist = dist;
    return dist;
  });
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

/**
 * Every vehicle sits on the full route, between its last Due stop and the next
 * stop. Changing which stop is selected does not move them.
 */
export function placeFleet(
  track: LatLng[],
  stops: LatLng[],
  clocks: StopClock[],
  company: Company,
  pace: RoadPace | null,
): VehicleDot[] {
  if (track.length < 2 || stops.length < 2 || !clocks.length) return [];
  const cum = cumulativeDistances(track);
  const total = cum[cum.length - 1] ?? 0;
  if (total < 30) return [];
  const atStop = stopDistances(track, cum, stops);
  const used = new Set<string>();
  const dots: VehicleDot[] = [];

  const uniqueId = (id: string) => {
    let next = id;
    let n = 2;
    while (used.has(next)) next = `${id}-${n++}`;
    used.add(next);
    return next;
  };

  const dotAt = (id: string, dist: number, flagDist: number, secondsToFlag: number): VehicleDot | null => {
    const point = pointAtDistance(track, cum, dist);
    if (!point) return null;
    const gap = Math.max(0, flagDist - dist);
    return {
      id: uniqueId(id),
      lat: point.lat,
      lng: point.lng,
      gps: false,
      speedMs: Math.min(20, Math.max(0.3, gap / Math.max(8, secondsToFlag))),
      remainM: Math.max(0, total - dist),
      remainFloor: Math.max(0, total - flagDist),
    };
  };

  for (const clock of clocks) {
    const seconds = clock.seconds;
    let flag = -1;
    const limit = Math.min(seconds.length, atStop.length);
    for (let i = 0; i < limit; i++) {
      const value = seconds[i];
      if (value != null && value > 0) {
        flag = i;
        break;
      }
    }
    if (flag < 0) continue;
    let due = flag - 1;
    while (due >= 0 && seconds[due] == null) due--;
    const flagDist = atStop[flag] ?? 0;
    const tFlag = seconds[flag] ?? 0;
    let dist: number | null = null;
    if (due >= 0 && (seconds[due] ?? 1) <= 0) {
      const tDue = seconds[due] ?? 0;
      const span = Math.max(15, tFlag - tDue);
      const elapsed = Math.max(0, Math.min(span, -tDue));
      const from = atStop[due] ?? 0;
      dist = timeWeighted(track, cum, company, pace, Math.min(from, flagDist), Math.max(from, flagDist), elapsed / span);
    } else {
      dist = approachDistance(track, cum, company, pace, flagDist, tFlag);
    }
    if (dist == null) continue;
    const dot = dotAt(clock.id, dist, flagDist, tFlag);
    if (dot) dots.push(dot);
    if (dots.length >= 8) break;
  }

  return dots;
}
