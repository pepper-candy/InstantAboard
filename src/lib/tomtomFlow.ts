/**
 * Close-range TomTom pace for an approaching road-bus on route detail.
 * Primary: Vector Flow Tiles (absolute, zoom 16) covering bus→flag.
 * Fallback: Flow Segment only on 429 / quota / tile request failure.
 * Event gates at ≤3 min or ≤1 min (not both in one tick) at the user's flag.
 * A later 1-minute gate waits 30s after this bus's last actual TomTom fire.
 */
import { loadDev } from "./devMode";
import { cumulativeDistances, haversine, pointAtDistance, type LatLng } from "./geo";
import { congestionSpeedAt } from "./roadSpeed";
import type { RoutePaceSample } from "./simRegion";

export const TOMTOM_BUDGET = 5;
const MAX_POINTS = 5;
const CONFIDENCE_MIN = 0.5;
const GATE_3_S = 180;
const GATE_1_S = 60;
/** Min wall time between an actual TomTom fire and a later 1-minute gate. */
const GATE_SPACING_MS = 30_000;
const MATCH_M = 40;
const COVER_SLACK_M = 40;
/** Past the covered end (and lookup slack) onto the uncovered stretch toward the flag. */
const EXTEND_GAP_M = 45;
const MAX_EXTEND_3 = 2;
const MAX_EXTEND_1 = 1;
/**
 * Web Mercator zoom 16 ≈ 520 m tiles in HK. Each tile holds many short
 * Traffic-flow linestrings (not one 700-point Flow Segment). Two tiles
 * cover a typical last ~1 km; zoom 17 would need more than the 2+1 cap.
 */
export const TILE_Z = 16;
const MAX_TILES_3 = 2;
const MAX_TILES_1 = 1;
/** Do not refetch a tile loaded in the last 30 seconds (last-good otherwise). */
const TILE_REUSE_MS = 30_000;
const TILE_SAMPLE_M = 80;

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
  kind: "tile" | "segment";
  coordinates: LatLng[];
  fromM: number;
  toM: number;
  speedMs: number | null;
  currentSpeed: number | null;
  freeFlowSpeed: number | null;
  confidence: number | null;
};

/** Last-good TomTom polylines for the open-route overlay (no extra fetch). */
export type TomTomFlowPaint = {
  id: string;
  pts: LatLng[];
  currentSpeed: number | null;
  freeFlowSpeed: number | null;
  confidence: number | null;
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

type TilePiece = {
  id: string;
  coordinates: LatLng[];
  trafficLevel: number | null;
  roadClosure: boolean;
};

type CachedTile = {
  key: string;
  z: number;
  x: number;
  y: number;
  at: number;
  pieces: TilePiece[];
};

type TileId = { z: number; x: number; y: number };

type BusFlowState = {
  spent: number;
  tileSpent: number;
  did3: boolean;
  did1: boolean;
  /** Wall time of the last actual TomTom request (tile or Flow Segment). Null if none. */
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
  return { spent: 0, tileSpent: 0, did3: false, did1: false, lastFiredAt: null, fragments: [] };
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

const EMPTY_PAINT: TomTomFlowPaint[] = [];
const overlayById = new Map<string, TomTomFlowPaint>();
let overlayCache: TomTomFlowPaint[] = EMPTY_PAINT;
let overlayTileCount = 0;
const overlayListeners = new Set<() => void>();

function notifyOverlay() {
  for (const fn of overlayListeners) fn();
}

function paintOf(frag: CachedFragment): TomTomFlowPaint {
  return {
    id: frag.id,
    pts: frag.coordinates,
    currentSpeed: frag.currentSpeed,
    freeFlowSpeed: frag.freeFlowSpeed,
    confidence: frag.confidence,
  };
}

function upsertOverlay(frag: CachedFragment) {
  if (frag.coordinates.length < 2) return;
  if (frag.kind !== "tile" && overlayTileCount > 0) return;
  const existed = overlayById.has(frag.id);
  overlayById.set(frag.id, paintOf(frag));
  if (frag.kind === "tile" && !existed) overlayTileCount += 1;
  overlayCache = [...overlayById.values()];
  notifyOverlay();
}

function rebuildOverlay(byBus: Map<string, BusFlowState>) {
  overlayById.clear();
  overlayTileCount = 0;
  const tiles: CachedFragment[] = [];
  const segments: CachedFragment[] = [];
  for (const row of byBus.values()) {
    for (const frag of row.fragments) {
      if (frag.coordinates.length < 2) continue;
      if (frag.kind === "tile") tiles.push(frag);
      else segments.push(frag);
    }
  }
  const list = tiles.length ? tiles : segments;
  for (const frag of list) {
    overlayById.set(frag.id, paintOf(frag));
    if (frag.kind === "tile") overlayTileCount += 1;
  }
  overlayCache = overlayById.size ? [...overlayById.values()] : EMPTY_PAINT;
  notifyOverlay();
}

function clearOverlay() {
  overlayById.clear();
  overlayTileCount = 0;
  overlayCache = EMPTY_PAINT;
  notifyOverlay();
}

export function cachedTomTomFlow(): TomTomFlowPaint[] {
  return overlayCache;
}

export function subscribeTomTomFlow(listener: () => void): () => void {
  overlayListeners.add(listener);
  return () => overlayListeners.delete(listener);
}

function logFlowSuccess(seg: TomTomFlowSegment) {
  if (typeof window === "undefined") return;
  try {
    if (!loadDev().on) return;
  } catch {
    return;
  }
  const n = seg.coordinates.length;
  const a = seg.coordinates[0];
  const b = seg.coordinates[n - 1];
  const span =
    a && b ? `${a.lat.toFixed(5)},${a.lng.toFixed(5)} → ${b.lat.toFixed(5)},${b.lng.toFixed(5)}` : "no coords";
  const cur = seg.currentSpeed;
  const free = seg.freeFlowSpeed;
  const conf = seg.confidence;
  console.log(
    `[dev] TomTom flow: currentSpeed ${cur == null ? "—" : cur} km/h | freeFlowSpeed ${free == null ? "—" : free} km/h | confidence ${conf == null ? "—" : conf} | ${n} pts ${span}`,
  );
}

function logTileSuccess(tile: TileId, pieces: TilePiece[]) {
  if (typeof window === "undefined") return;
  try {
    if (!loadDev().on) return;
  } catch {
    return;
  }
  const speeds = [
    ...new Set(
      pieces
        .map((p) => p.trafficLevel)
        .filter((n): n is number => n != null && Number.isFinite(n) && n >= 0)
        .map((n) => Math.round(n)),
    ),
  ].sort((a, b) => a - b);
  const shown = speeds.slice(0, 12).join(",");
  const extra = speeds.length > 12 ? "…" : "";
  const speedText = speeds.length ? `${shown}${extra} km/h` : "—";
  console.log(
    `[dev] TomTom flow: tile ${tile.z}/${tile.x}/${tile.y} | ${pieces.length} segments | speeds ${speedText}`,
  );
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

function tilePieceSpeedMs(piece: TilePiece, point: LatLng): number | null {
  return paceMsForSample(
    {
      currentSpeed: piece.trafficLevel,
      freeFlowSpeed: null,
      currentTravelTime: null,
      freeFlowTravelTime: null,
      confidence: null,
      frc: null,
      roadClosure: piece.roadClosure,
      coordinates: piece.coordinates,
    },
    point,
  );
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

/** Project a tile piece onto the route. Null when it is not on the open path. */
function projectTilePiece(
  track: LatLng[],
  cum: number[],
  coordinates: LatLng[],
): { fromM: number; toM: number; onRoute: LatLng[] } | null {
  const onRoute: LatLng[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let hits = 0;
  for (const point of coordinates) {
    const hit = closestAlong(track, cum, point);
    if (!hit || hit.off > MATCH_M) continue;
    hits += 1;
    onRoute.push(point);
    lo = Math.min(lo, hit.dist);
    hi = Math.max(hi, hit.dist);
  }
  if (hits < 1 || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null;
  if (hits < 2 && hits / coordinates.length < 0.4) return null;
  return { fromM: lo, toM: hi, onRoute: onRoute.length >= 2 ? onRoute : coordinates };
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
  return [...fragments]
    .sort((a, b) => Math.abs(a.toM - a.fromM) - Math.abs(b.toM - b.fromM))
    .map((frag) => ({
      fromM: Math.min(frag.fromM, frag.toM),
      toM: Math.max(frag.fromM, frag.toM),
      speedMs: frag.speedMs,
    }));
}

function lngLatToTile(lat: number, lng: number, z: number): TileId {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.min(
    n - 1,
    Math.max(
      0,
      Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
    ),
  );
  return { z, x, y };
}

/** Unique zoom-16 tiles along bus→flag, in along-track order. */
function tilesAlong(track: LatLng[], cum: number[], fromM: number, toM: number, z: number): TileId[] {
  const start = Math.min(fromM, toM);
  const end = Math.max(fromM, toM);
  const out: TileId[] = [];
  const seen = new Set<string>();
  const add = (dist: number) => {
    const point = pointAtDistance(track, cum, dist);
    if (!point) return;
    const tile = lngLatToTile(point.lat, point.lng, z);
    const key = tileKey(tile);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tile);
  };
  for (let d = start; d <= end; d += TILE_SAMPLE_M) add(d);
  add(end);
  return out;
}

function parseTilePiece(raw: unknown): TilePiece | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    id?: unknown;
    coordinates?: unknown;
    trafficLevel?: unknown;
    roadClosure?: unknown;
  };
  if (typeof row.id !== "string" || !row.id) return null;
  if (!Array.isArray(row.coordinates) || row.coordinates.length < 2) return null;
  const coordinates: LatLng[] = [];
  for (const item of row.coordinates) {
    if (!item || typeof item !== "object") continue;
    const pt = item as { lat?: unknown; lng?: unknown };
    const lat = typeof pt.lat === "number" && Number.isFinite(pt.lat) ? pt.lat : null;
    const lng = typeof pt.lng === "number" && Number.isFinite(pt.lng) ? pt.lng : null;
    if (lat == null || lng == null) continue;
    coordinates.push({ lat, lng });
  }
  if (coordinates.length < 2) return null;
  const trafficLevel =
    typeof row.trafficLevel === "number" && Number.isFinite(row.trafficLevel) ? row.trafficLevel : null;
  return {
    id: row.id,
    coordinates,
    trafficLevel,
    roadClosure: row.roadClosure === true,
  };
}

/** GET /api/tomtom-flow-tile. fail=quota on 429/403; fail=error on network / parse. */
export async function fetchTomTomFlowTile(
  tile: TileId,
  signal?: AbortSignal,
): Promise<{ pieces: TilePiece[] } | { fail: "quota" | "error" }> {
  try {
    const res = await fetch(`/api/tomtom-flow-tile?z=${tile.z}&x=${tile.x}&y=${tile.y}`, {
      cache: "no-store",
      signal,
    });
    if (res.status === 429 || res.status === 403) return { fail: "quota" };
    if (!res.ok) return { fail: "error" };
    const json = (await res.json()) as { segments?: unknown };
    if (!Array.isArray(json.segments)) return { fail: "error" };
    const pieces: TilePiece[] = [];
    for (const item of json.segments) {
      const piece = parseTilePiece(item);
      if (piece) pieces.push(piece);
    }
    return { pieces };
  } catch {
    return { fail: "error" };
  }
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

function mergeTilePieces(
  state: BusFlowState,
  pieces: TilePiece[],
  track: LatLng[],
  cum: number[],
): boolean {
  let changed = false;
  for (const piece of pieces) {
    if (state.fragments.some((frag) => frag.id === piece.id)) continue;
    const span = projectTilePiece(track, cum, piece.coordinates);
    if (!span) continue;
    const point = piece.coordinates[0];
    if (!point) continue;
    const frag: CachedFragment = {
      id: piece.id,
      kind: "tile",
      coordinates: span.onRoute,
      fromM: span.fromM,
      toM: span.toM,
      speedMs: tilePieceSpeedMs(piece, point),
      currentSpeed: piece.trafficLevel,
      freeFlowSpeed: null,
      confidence: null,
    };
    state.fragments.push(frag);
    upsertOverlay(frag);
    changed = true;
  }
  return changed;
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
  logFlowSuccess(seg);
  const id = segmentId(seg);
  if (state.fragments.some((frag) => frag.id === id)) return false;
  state.spent += 1;
  const span = projectFragment(track, cum, seg.coordinates, distM);
  const frag: CachedFragment = {
    id,
    kind: "segment",
    coordinates: seg.coordinates,
    fromM: span.fromM,
    toM: span.toM,
    speedMs: paceMsForSample(seg, point),
    currentSpeed: seg.currentSpeed,
    freeFlowSpeed: seg.freeFlowSpeed,
    confidence: seg.confidence,
  };
  state.fragments.push(frag);
  upsertOverlay(frag);
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

async function runTileGate(
  state: BusFlowState,
  tiles: Map<string, CachedTile>,
  track: LatLng[],
  cum: number[],
  bus: FlowBusInput,
  maxTiles: number,
  signal?: AbortSignal,
): Promise<"ok" | "fail" | "noop"> {
  const busM = bus.busM;
  const flagM = bus.flagM;
  if (!(flagM > busM + 2)) return "noop";
  if (remainingCovered(state.fragments, busM, flagM)) return "noop";

  const needed = tilesAlong(track, cum, busM, flagM, TILE_Z);
  if (!needed.length) return "noop";

  let changed = false;
  let added = 0;
  const now = Date.now();

  for (const tile of needed) {
    if (aborted(signal)) return "noop";
    if (remainingCovered(state.fragments, busM, flagM)) break;

    const key = tileKey(tile);
    const cached = tiles.get(key);
    if (cached) {
      changed = mergeTilePieces(state, cached.pieces, track, cum) || changed;
      if (now - cached.at < TILE_REUSE_MS) continue;
      // Last-good stays; do not spend the gate's extra tile on a refresh
      // of a piece we already have — 1-minute budget is for a new tile.
      continue;
    }

    if (added >= maxTiles) break;

    const result = await fetchTomTomFlowTile(tile, signal);
    if (aborted(signal)) return "noop";
    if ("fail" in result) return "fail";

    state.lastFiredAt = Date.now();
    state.tileSpent += 1;
    added += 1;
    tiles.set(key, { key, z: tile.z, x: tile.x, y: tile.y, at: Date.now(), pieces: result.pieces });
    logTileSuccess(tile, result.pieces);
    changed = mergeTilePieces(state, result.pieces, track, cum) || changed;
  }

  return changed ? "ok" : "noop";
}

export function createRouteFlowSession(): RouteFlowSession {
  const byBus = new Map<string, BusFlowState>();
  const tileCache = new Map<string, CachedTile>();
  let useSegments = false;

  const get = (id: string): BusFlowState => {
    let row = byBus.get(id);
    if (!row) {
      row = emptyBus();
      byBus.set(id, row);
    }
    return row;
  };

  async function runPrimary(
    state: BusFlowState,
    track: LatLng[],
    cum: number[],
    bus: FlowBusInput,
    maxTiles: number,
    maxExtend: number,
    skipOriginIfCached: boolean,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (useSegments) {
      return runGate(state, track, cum, bus, maxExtend, skipOriginIfCached, signal);
    }
    const result = await runTileGate(state, tileCache, track, cum, bus, maxTiles, signal);
    if (result === "fail") {
      useSegments = true;
      return runGate(state, track, cum, bus, maxExtend, skipOriginIfCached, signal);
    }
    return result === "ok";
  }

  return {
    reset() {
      byBus.clear();
      tileCache.clear();
      useSegments = false;
      clearOverlay();
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
      rebuildOverlay(byBus);
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
            changed =
              (await runPrimary(state, track, cum, bus, MAX_TILES_3, MAX_EXTEND_3, false, signal)) || changed;
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
        changed = (await runPrimary(state, track, cum, bus, MAX_TILES_1, MAX_EXTEND_1, true, signal)) || changed;
        if (!aborted(signal)) state.did1 = true;
      }
      return changed;
    },
  };
}
