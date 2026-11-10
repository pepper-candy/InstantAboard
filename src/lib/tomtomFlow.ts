/**
 * Close-range TomTom Flow Segment pace for an approaching road-bus on route detail.
 * Event gates at ≤3 min or ≤1 min (not both in one tick) at the user's flag.
 * A later 1-minute gate waits 30s after this bus's last actual Flow Segment fire.
 */
import { cumulativeDistances, haversine, pointAtDistance, type LatLng } from "./geo";
import { congestionSpeedAt } from "./roadSpeed";
import type { RoutePaceSample } from "./simRegion";

export const TOMTOM_BUDGET = 5;
const MAX_POINTS = 5;
const CONFIDENCE_MIN = 0.5;
const GATE_3_S = 180;
const GATE_1_S = 60;
/** Min wall time between an actual Flow Segment fire and a later 1-minute gate. */
const GATE_SPACING_MS = 30_000;
const MATCH_M = 40;
const COVER_SLACK_M = 40;
/** Past the covered end (and lookup slack) onto the uncovered stretch toward the flag. */
const EXTEND_GAP_M = 45;
const MAX_EXTEND_3 = 2;
const MAX_EXTEND_1 = 1;

export type TomTomFlowPoint = { lat: number; lng: number };

export type TomTomFlowSegment = {
  currentSpeed: number | null;
  freeFlowSpeed: number | null;
  currentTravelTime: number | null;
  freeFlowTravelTime: number | null;
  confidence: number | null;
  frc: string | null;
  roadClosure: boolean | null;
  coordinates: TomTomFlowPoint[];
};

export type CachedFragment = {
  id: string;
  coordinates: LatLng[];
  fromM: number;
  toM: number;
  speedMs: number | null;
};

export type FlowBusInput = {
  id: string;
  /** Live seconds to the user's chosen flag stop. Null = this bus has no ETA there. */
  tFlagS: number | null;
  /** ETA-backed simulated along-track metres (existing core.estimate0). */
  busM: number;
  /** Along-track metres of the user's flag stop. */
  flagM: number;
};

type BusFlowState = {
  spent: number;
  did3: boolean;
  did1: boolean;
  /** Wall time of the last actual Flow Segment request (origin or extend). Null if none. */
  lastFiredAt: number | null;
  fragments: CachedFragment[];
};

export type RouteFlowSession = {
  reset: () => void;
  resetGates: () => void;
  /** Drop fragment geometry after a path rebuild; keep the sheet's unique-request budget. */
  resetKeepBudget: () => void;
  paceByBus: () => Map<string, RoutePaceSample[]>;
  tick: (args: {
    hidden: boolean;
    track: LatLng[];
    buses: FlowBusInput[];
    signal?: AbortSignal;
  }) => Promise<boolean>;
};

function kmhToMs(kmh: number): number {
  return (kmh * 1000) / 3600;
}

function emptyBus(): BusFlowState {
  return { spent: 0, did3: false, did1: false, lastFiredAt: null, fragments: [] };
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

/** currentSpeed, capped by freeFlow. Null when the stretch is unusable. */
export function tomtomSpeedKmh(seg: TomTomFlowSegment | null | undefined): number | null {
  if (!seg) return null;
  if (seg.roadClosure === true) return null;
  if (seg.confidence != null && seg.confidence < CONFIDENCE_MIN) return null;
  const current = seg.currentSpeed;
  if (current == null || !(current > 0)) return null;
  const cap = seg.freeFlowSpeed != null && seg.freeFlowSpeed > 0 ? seg.freeFlowSpeed : current;
  return Math.min(current, cap);
}

export function paceMsForSample(seg: TomTomFlowSegment | null | undefined, point: LatLng): number | null {
  const live = tomtomSpeedKmh(seg);
  if (live != null) return kmhToMs(live);
  const irn = congestionSpeedAt(point);
  if (irn != null && irn > 0) return kmhToMs(irn);
  return null;
}

function segmentId(seg: TomTomFlowSegment): string {
  const coords = seg.coordinates;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!first || !last) {
    return `frc:${seg.frc ?? ""}:n${coords.length}`;
  }
  return [
    seg.frc ?? "",
    first.lat.toFixed(5),
    first.lng.toFixed(5),
    last.lat.toFixed(5),
    last.lng.toFixed(5),
    String(coords.length),
  ].join(":");
}

function closestAlong(track: LatLng[], cum: number[], point: LatLng): { dist: number; off: number } | null {
  if (track.length < 2) return null;
  let bestDist = 0;
  let bestOff = Infinity;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (!a || !b) continue;
    const lat0 = (((a.lat + b.lat + point.lat) / 3) * Math.PI) / 180;
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
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x(point.lng) - ax) * dx + (y(point.lat) - ay) * dy) / len2)) : 0;
    const proj = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    const off = haversine(proj, point);
    if (off < bestOff) {
      bestOff = off;
      const seg = (cum[i] ?? 0) - (cum[i - 1] ?? 0);
      bestDist = (cum[i - 1] ?? 0) + t * seg;
    }
  }
  return Number.isFinite(bestOff) ? { dist: bestDist, off: bestOff } : null;
}

function projectFragment(
  track: LatLng[],
  cum: number[],
  coordinates: LatLng[],
  fallbackM: number,
): { fromM: number; toM: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const point of coordinates) {
    const hit = closestAlong(track, cum, point);
    if (!hit || hit.off > MATCH_M) continue;
    lo = Math.min(lo, hit.dist);
    hi = Math.max(hi, hit.dist);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    return { fromM: fallbackM, toM: fallbackM };
  }
  return { fromM: lo, toM: hi };
}

function fragmentAt(fragments: CachedFragment[], distM: number, slack = COVER_SLACK_M): CachedFragment | null {
  for (const frag of fragments) {
    const lo = Math.min(frag.fromM, frag.toM) - slack;
    const hi = Math.max(frag.fromM, frag.toM) + slack;
    if (distM >= lo && distM <= hi) return frag;
  }
  return null;
}

/** True when cached fragments already cover the remaining bus→flag path. */
function remainingCovered(fragments: CachedFragment[], busM: number, flagM: number): boolean {
  const start = Math.min(busM, flagM);
  const end = Math.max(busM, flagM);
  if (end - start <= COVER_SLACK_M) return true;
  const ranges = fragments
    .map((frag) => ({ lo: Math.min(frag.fromM, frag.toM), hi: Math.max(frag.fromM, frag.toM) }))
    .filter((range) => range.hi >= start - COVER_SLACK_M && range.lo <= end + COVER_SLACK_M)
    .sort((a, b) => a.lo - b.lo);
  let cur = start;
  for (const range of ranges) {
    if (range.lo > cur + COVER_SLACK_M) return false;
    cur = Math.max(cur, range.hi);
    if (cur >= end - COVER_SLACK_M) return true;
  }
  return cur >= end - COVER_SLACK_M;
}

/**
 * Immediate uncovered stretch ahead of the bus (toward the flag), not a stop midpoint.
 * Null when the remaining path is already covered or there is no room before the flag.
 */
function extendDistM(fragments: CachedFragment[], busM: number, flagM: number): number | null {
  const start = Math.min(busM, flagM);
  const end = Math.max(busM, flagM);
  if (end - start <= COVER_SLACK_M) return null;
  const ranges = fragments
    .map((frag) => ({ lo: Math.min(frag.fromM, frag.toM), hi: Math.max(frag.fromM, frag.toM) }))
    .filter((range) => range.hi >= start - COVER_SLACK_M && range.lo <= end + COVER_SLACK_M)
    .sort((a, b) => a.lo - b.lo);
  let cur = start;
  for (const range of ranges) {
    if (range.lo > cur + COVER_SLACK_M) break;
    cur = Math.max(cur, range.hi);
  }
  if (cur >= end - COVER_SLACK_M) return null;
  const dist = Math.min(end - 4, cur + EXTEND_GAP_M);
  if (dist <= cur + 1 || dist >= end) return null;
  return dist;
}

function toPace(fragments: CachedFragment[]): RoutePaceSample[] {
  return fragments.map((frag) => ({
    fromM: Math.min(frag.fromM, frag.toM),
    toM: Math.max(frag.fromM, frag.toM),
    speedMs: frag.speedMs,
  }));
}

/** POST /api/tomtom-flow. Null on network / missing-key / invalid response (keep last good). */
export async function fetchTomTomFlow(
  points: LatLng[],
  signal?: AbortSignal,
): Promise<Array<TomTomFlowSegment | null> | null> {
  const body = points.slice(0, MAX_POINTS).map((p) => ({ lat: p.lat, lng: p.lng }));
  if (!body.length) return null;
  try {
    const res = await fetch("/api/tomtom-flow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal,
      body: JSON.stringify({ points: body }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { segments?: Array<TomTomFlowSegment | null> };
    return Array.isArray(json.segments) ? json.segments : null;
  } catch {
    return null;
  }
}

async function requestUnique(
  state: BusFlowState,
  track: LatLng[],
  cum: number[],
  distM: number,
  point: LatLng,
  signal?: AbortSignal,
): Promise<boolean> {
  if (aborted(signal) || state.spent >= TOMTOM_BUDGET) return false;
  const cached = fragmentAt(state.fragments, distM);
  if (cached) return false;
  state.lastFiredAt = Date.now();
  const segs = await fetchTomTomFlow([point], signal);
  if (aborted(signal) || !segs) return false;
  const seg = segs[0] ?? null;
  if (!seg) {
    state.spent += 1;
    return true;
  }
  const id = segmentId(seg);
  if (state.fragments.some((frag) => frag.id === id)) return false;
  state.spent += 1;
  const span = projectFragment(track, cum, seg.coordinates, distM);
  state.fragments.push({
    id,
    coordinates: seg.coordinates,
    fromM: span.fromM,
    toM: span.toM,
    speedMs: paceMsForSample(seg, point),
  });
  return true;
}

async function runGate(
  state: BusFlowState,
  track: LatLng[],
  cum: number[],
  bus: FlowBusInput,
  maxExtend: number,
  skipOriginIfCached: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  const busM = bus.busM;
  const flagM = bus.flagM;
  if (!(flagM > busM + 2)) return false;
  let changed = false;
  if (remainingCovered(state.fragments, busM, flagM)) return false;

  const originCached = fragmentAt(state.fragments, busM);
  if (skipOriginIfCached && originCached) {
    // 1-minute refresh: still on this fragment — reuse last-good speed, no request.
  } else if (!originCached && state.spent < TOMTOM_BUDGET) {
    const point = pointAtDistance(track, cum, busM);
    if (point) changed = (await requestUnique(state, track, cum, busM, point, signal)) || changed;
  }

  for (let n = 0; n < maxExtend; n++) {
    if (aborted(signal) || state.spent >= TOMTOM_BUDGET) break;
    if (remainingCovered(state.fragments, busM, flagM)) break;
    const dist = extendDistM(state.fragments, busM, flagM);
    if (dist == null) break;
    if (fragmentAt(state.fragments, dist, 0)) break;
    const point = pointAtDistance(track, cum, dist);
    if (!point) break;
    changed = (await requestUnique(state, track, cum, dist, point, signal)) || changed;
  }
  return changed;
}

export function createRouteFlowSession(): RouteFlowSession {
  const byBus = new Map<string, BusFlowState>();

  const get = (id: string): BusFlowState => {
    let row = byBus.get(id);
    if (!row) {
      row = emptyBus();
      byBus.set(id, row);
    }
    return row;
  };

  return {
    reset() {
      byBus.clear();
    },
    resetGates() {
      for (const row of byBus.values()) {
        row.did3 = false;
        row.did1 = false;
      }
    },
    resetKeepBudget() {
      for (const row of byBus.values()) {
        row.did3 = false;
        row.did1 = false;
        row.fragments = [];
      }
    },
    paceByBus() {
      const out = new Map<string, RoutePaceSample[]>();
      for (const [id, row] of byBus) {
        if (row.fragments.length) out.set(id, toPace(row.fragments));
      }
      return out;
    },
    async tick({ hidden, track, buses, signal }) {
      if (hidden || aborted(signal) || track.length < 2) return false;
      const cum = cumulativeDistances(track);
      const total = cum[cum.length - 1] ?? 0;
      if (total < 30) return false;
      let changed = false;
      for (const bus of buses) {
        if (aborted(signal)) break;
        const t = bus.tFlagS;
        if (t == null || t > GATE_3_S) continue;
        const state = get(bus.id);

        // 3-minute window only: never also run the 1-minute gate in this tick.
        if (t > GATE_1_S) {
          if (!state.did3) {
            changed = (await runGate(state, track, cum, bus, MAX_EXTEND_3, false, signal)) || changed;
            if (!aborted(signal)) state.did3 = true;
          }
          continue;
        }

        // Already ≤1 minute: 1-minute gate only (no 3-minute first).
        // If this bus already fired (3-minute gate), wait 30s since that actual request.
        if (state.did1) continue;
        if (state.lastFiredAt != null && Date.now() - state.lastFiredAt < GATE_SPACING_MS) {
          continue;
        }
        changed = (await runGate(state, track, cum, bus, MAX_EXTEND_1, true, signal)) || changed;
        if (!aborted(signal)) state.did1 = true;
      }
      return changed;
    },
  };
}
