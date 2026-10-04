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
        remain = Math.max(0, easeFrom + (easeTo - easeFrom) * e);
        put(placeOnPath(path, remain), { lat, lng });
      }
      if (t >= 1) {
        mode = after;
        if (easeGps) remain = projectRemain(path, { lat, lng });
      }
      return;
    }
    if (mode === "creep" && speed > 0 && path.length > 1) {
      remain = Math.max(0, remain - speed * dt);
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
        remain = Math.max(0, to);
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
    if (initial) {
      if (sample.gps || path.length < 2) {
        lat = sample.lat;
        lng = sample.lng;
        remain = projectRemain(path, sample);
        mode = "hold";
        easeGps = false;
        return;
      }
      remain = sample.remainM ?? projectRemain(path, sample);
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
    const target = sample.remainM ?? (path.length > 1 ? projectRemain(path, sample) : here);
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
