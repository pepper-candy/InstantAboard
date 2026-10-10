import { haversine, interpolateAlong, pathLength, sliceShapeToStops, type LatLng } from "./geo";
import type { Arrival, Company, VehicleDot } from "./types";

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

const ROAD_COMPANIES = new Set<Company>(["kmb", "ctb", "gmb", "nlb", "lrtfeeder"]);

export function isRoadFleet(company: Company | undefined): company is Company {
  return Boolean(company && ROAD_COMPANIES.has(company));
}
