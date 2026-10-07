import { haversine, type LatLng } from "./geo";
import type { RoadPace } from "./vehicle";

const CELL = 0.002;
const MATCH_M = 35;
/** Max endpoint separation (m) for borrowing a neighbour detector's speed. */
const INTERP_M = 30;

type Seg = { id?: number; limit?: number; road?: string; pts: LatLng[] };

/** A detector road segment whose speed was inferred from a same-window neighbour. */
type InterpSeg = { id?: number; pts: LatLng[]; kmh: number };

type Corridor = { strategic: Seg[]; limits: Seg[]; interpolated: InterpSeg[] };

let liveCache: { at: number; map: Map<number, number> } | null = null;
let liveInflight: Promise<Map<number, number>> | null = null;
const corridorCache = new Map<string, { at: number; corridor: Corridor }>();
const corridorInflight = new Map<string, Promise<Corridor>>();

function closestPointDistance(a: LatLng, b: LatLng, p: LatLng): number {
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
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x(p.lng) - ax) * dx + (y(p.lat) - ay) * dy) / len2)) : 0;
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return haversine(point, p);
}

function distToSeg(seg: Seg, point: LatLng): number {
  let best = Infinity;
  for (let i = 1; i < seg.pts.length; i++) {
    const a = seg.pts[i - 1];
    const b = seg.pts[i];
    if (!a || !b) continue;
    best = Math.min(best, closestPointDistance(a, b, point));
  }
  return best;
}

function buildGrid(segs: Seg[]): Map<string, Seg[]> {
  const grid = new Map<string, Seg[]>();
  for (const seg of segs) {
    if (seg.pts.length < 2) continue;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const p of seg.pts) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    }
    for (let y = Math.floor(minLat / CELL); y <= Math.floor(maxLat / CELL); y++) {
      for (let x = Math.floor(minLng / CELL); x <= Math.floor(maxLng / CELL); x++) {
        const key = `${y}:${x}`;
        const list = grid.get(key);
        if (list) list.push(seg);
        else grid.set(key, [seg]);
      }
    }
  }
  return grid;
}

function nearest(grid: Map<string, Seg[]>, point: LatLng, pick: (seg: Seg) => boolean): Seg | null {
  const y = Math.floor(point.lat / CELL);
  const x = Math.floor(point.lng / CELL);
  let best: Seg | null = null;
  let bestD = MATCH_M;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = grid.get(`${y + dy}:${x + dx}`);
      if (!list) continue;
      for (const seg of list) {
        if (!pick(seg)) continue;
        const dist = distToSeg(seg, point);
        if (dist < bestD) {
          bestD = dist;
          best = seg;
        }
      }
    }
  }
  return best;
}

/** Neighbour gate: require the same road name when both sides expose one; else proximity only. */
function sameRoad(a: Seg, b: Seg): boolean {
  if (a.road && b.road) return a.road === b.road;
  return true;
}

/** Nearest same-window detector speed within INTERP_M of one endpoint, excluding `self`. */
function endpointSpeed(grid: Map<string, Seg[]>, live: Map<number, number>, self: Seg, point: LatLng): number | null {
  const y = Math.floor(point.lat / CELL);
  const x = Math.floor(point.lng / CELL);
  let bestKmh: number | null = null;
  let bestD = INTERP_M;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = grid.get(`${y + dy}:${x + dx}`);
      if (!list) continue;
      for (const seg of list) {
        if (seg === self || seg.id == null) continue;
        const kmh = live.get(seg.id);
        if (kmh == null || kmh <= 0) continue;
        if (!sameRoad(self, seg)) continue;
        const dist = distToSeg(seg, point);
        if (dist < bestD) {
          bestD = dist;
          bestKmh = kmh;
        }
      }
    }
  }
  return bestKmh;
}

/**
 * Speed for a detector road with no reading of its own: the average of a known
 * neighbour near each endpoint, or that single neighbour when only one endpoint
 * has one. Returns null (segment dropped) when neither endpoint has a neighbour.
 */
function interpolateSpeed(grid: Map<string, Seg[]>, live: Map<number, number>, seg: Seg): number | null {
  const first = seg.pts[0];
  const last = seg.pts[seg.pts.length - 1];
  if (!first || !last) return null;
  const start = endpointSpeed(grid, live, seg, first);
  const end = endpointSpeed(grid, live, seg, last);
  if (start != null && end != null) return (start + end) / 2;
  return start ?? end;
}

async function loadLiveSpeeds(force = false): Promise<Map<number, number>> {
  if (!force && liveCache && Date.now() - liveCache.at < 90_000) return liveCache.map;
  if (liveInflight) return liveInflight;
  liveInflight = (async () => {
    try {
      const res = await fetch("/api/td-speed", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const xml = await res.text();
      const map = new Map<number, number>();
      const re = /<segment_id>\s*(\d+)\s*<\/segment_id>\s*<speed>\s*(-?\d+(?:\.\d+)?)\s*<\/speed>\s*<valid>\s*([YN])\s*<\/valid>/g;
      for (const match of xml.matchAll(re)) {
        if (match[3] !== "Y") continue;
        const speed = Number(match[2]);
        if (!Number.isFinite(speed) || speed <= 0 || speed > 140) continue;
        map.set(Number(match[1]), speed);
      }
      liveCache = { at: Date.now(), map };
      return map;
    } catch {
      return liveCache?.map ?? new Map();
    } finally {
      liveInflight = null;
    }
  })();
  return liveInflight;
}

type BBox = { west: number; south: number; east: number; north: number };

function windows(path: LatLng[]): BBox[] {
  if (path.length < 2) return [];
  const boxes: BBox[] = [];
  let start = 0;
  let walked = 0;
  const push = (end: number) => {
    const slice = path.slice(start, end + 1);
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const p of slice) {
      west = Math.min(west, p.lng);
      east = Math.max(east, p.lng);
      south = Math.min(south, p.lat);
      north = Math.max(north, p.lat);
    }
    const padLat = 0.0016;
    const padLng = 0.0018;
    boxes.push({ west: west - padLng, east: east + padLng, south: south - padLat, north: north + padLat });
  };
  for (let i = 1; i < path.length; i++) {
    walked += haversine(path[i - 1], path[i]);
    if (walked >= 1600 || i === path.length - 1) {
      push(i);
      start = Math.max(0, i - 1);
      walked = 0;
    }
  }
  return boxes;
}

/** Max query boxes per axis for the congestion overlay's area tiling. */
const MAX_TILES_AXIS = 6;
/** Target tile size (m) before the tile count is clamped to MAX_TILES_AXIS. */
const TILE_TARGET_M = 6_000;

/**
 * Split the visible area into a bounded grid of query boxes. Walking a single
 * serpentine lattice line leaves wide gaps between rows, so a zoomed-out scan
 * only catches roads near the line; tiling the whole view covers every road in
 * view with a bounded number of requests.
 */
function tileBoxes(area: { west: number; south: number; east: number; north: number }): BBox[] {
  const lngSpan = area.east - area.west;
  const latSpan = area.north - area.south;
  if (!(lngSpan > 0) || !(latSpan > 0)) return [];
  const lat0 = (((area.south + area.north) / 2) * Math.PI) / 180;
  const widthM = lngSpan * 111_320 * Math.cos(lat0);
  const heightM = latSpan * 110_540;
  const clamp = (n: number) => Math.max(1, Math.min(MAX_TILES_AXIS, Math.ceil(n)));
  const cols = clamp(widthM / TILE_TARGET_M);
  const rows = clamp(heightM / TILE_TARGET_M);
  const padLat = 0.0016;
  const padLng = 0.0018;
  const boxes: BBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      boxes.push({
        west: area.west + (lngSpan * c) / cols - padLng,
        east: area.west + (lngSpan * (c + 1)) / cols + padLng,
        south: area.south + (latSpan * r) / rows - padLat,
        north: area.south + (latSpan * (r + 1)) / rows + padLat,
      });
    }
  }
  return boxes;
}

function parseLimit(raw: unknown): number | null {
  const match = String(raw ?? "").match(/\d+/);
  const n = match ? Number(match[0]) : NaN;
  if (!Number.isFinite(n) || n < 8 || n > 120) return null;
  return n;
}

function readPaths(geometry: { paths?: number[][][] } | undefined): LatLng[] {
  const path = geometry?.paths?.[0];
  if (!path) return [];
  return path
    .map((pair) => ({ lng: pair[0] ?? NaN, lat: pair[1] ?? NaN }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

const PAGE = 2000;
const HK: BBox = { west: 113.82, south: 22.14, east: 114.45, north: 22.56 };
const NETWORK_TTL_MS = 6 * 60 * 60 * 1000;

async function queryPage(
  layer: number,
  box: BBox,
  offset: number,
): Promise<{
  features: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>;
  more: boolean;
}> {
  const params = new URLSearchParams({
    layer: String(layer),
    f: "json",
    where: "1=1",
    outFields: layer === 10 ? "ROUTE_ID" : "ROAD_ROUTE_ID,SPEED_LIMIT",
    returnGeometry: "true",
    outSR: "4326",
    geometry: `${box.west},${box.south},${box.east},${box.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: String(PAGE),
    resultOffset: String(offset),
  });
  const res = await fetch(`/api/csdi?${params}`, { cache: "no-store" });
  if (!res.ok) return { features: [], more: false };
  const json = (await res.json()) as {
    error?: { message?: string };
    features?: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>;
    exceededTransferLimit?: boolean;
  };
  if (json.error) return { features: [], more: false };
  const features = json.features ?? [];
  return { features, more: Boolean(json.exceededTransferLimit) || features.length >= PAGE };
}

async function queryBox(layer: number, box: BBox): Promise<Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>> {
  const all: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }> = [];
  for (let offset = 0; offset < PAGE * 20; offset += PAGE) {
    const page = await queryPage(layer, box, offset);
    all.push(...page.features);
    if (!page.more) break;
  }
  return all;
}

type HkNetwork = { roads: Seg[]; limits: Seg[] };

let hkNetworkCache: { at: number; network: HkNetwork } | null = null;
let hkNetworkInflight: Promise<HkNetwork> | null = null;
let hkPaintCache: CongestionSegment[] | null = null;

async function loadHkNetwork(): Promise<HkNetwork> {
  if (hkNetworkCache && Date.now() - hkNetworkCache.at < NETWORK_TTL_MS) return hkNetworkCache.network;
  if (hkNetworkInflight) return hkNetworkInflight;
  hkNetworkInflight = (async () => {
    const [roadsRaw, signedRaw] = await Promise.all([queryBox(10, HK), queryBox(2, HK)]);
    const network = networkFromFeatures(roadsRaw, signedRaw);
    if (network.roads.length || network.limits.length) hkNetworkCache = { at: Date.now(), network };
    return network;
  })().finally(() => {
    hkNetworkInflight = null;
  });
  return hkNetworkInflight;
}

function paintCongestion(live: Map<number, number>, network: HkNetwork): CongestionSegment[] {
  const known: Seg[] = [];
  const unknown: Seg[] = [];
  for (const seg of network.roads) {
    if (seg.id != null && (live.get(seg.id) ?? 0) > 0) known.push(seg);
    else unknown.push(seg);
  }
  const grid = buildGrid(known);
  const interpolated: InterpSeg[] = [];
  for (const seg of unknown) {
    const kmh = interpolateSpeed(grid, live, seg);
    if (kmh == null) continue;
    interpolated.push({ id: seg.id, pts: seg.pts, kmh });
  }
  const limitGrid = buildGrid(network.limits);
  const segments: CongestionSegment[] = [];
  for (const seg of known) {
    if (seg.id == null) continue;
    const kmh = live.get(seg.id);
    if (kmh == null || kmh <= 0) continue;
    const limit = segLimit(limitGrid, seg) ?? 50;
    segments.push({ id: seg.id, pts: seg.pts, kmh, limit, estimated: false });
  }
  for (const seg of interpolated) {
    const limit = segLimit(limitGrid, { pts: seg.pts }) ?? 50;
    segments.push({ id: seg.id, pts: seg.pts, kmh: seg.kmh, limit, estimated: true, interpolated: true });
  }
  return segments;
}

function networkFromFeatures(
  roadsRaw: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>,
  signedRaw: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>,
): HkNetwork {
  const roads: Seg[] = [];
  const seenRoad = new Set<number>();
  for (const feature of roadsRaw) {
    const id = Number(feature.attributes?.ROUTE_ID);
    if (!Number.isFinite(id) || seenRoad.has(id)) continue;
    const pts = readPaths(feature.geometry);
    if (pts.length < 2) continue;
    seenRoad.add(id);
    const road = typeof feature.attributes?.ROAD_NAME === "string" ? feature.attributes.ROAD_NAME : undefined;
    roads.push({ id, pts, road });
  }
  const limits: Seg[] = [];
  const seenLimit = new Set<number>();
  for (const feature of signedRaw) {
    const id = Number(feature.attributes?.ROAD_ROUTE_ID);
    const limit = parseLimit(feature.attributes?.SPEED_LIMIT);
    if (!Number.isFinite(id) || limit == null || seenLimit.has(id)) continue;
    const pts = readPaths(feature.geometry);
    if (pts.length < 2) continue;
    seenLimit.add(id);
    limits.push({ id, limit, pts });
  }
  return { roads, limits };
}

/** Last successful whole-HK overlay. Safe to draw immediately on a later Traffic toggle. */
export function cachedCongestionHk(): CongestionSegment[] | null {
  return hkPaintCache;
}

function rememberPaint(painted: CongestionSegment[]): CongestionSegment[] {
  if (painted.length) hkPaintCache = painted;
  return painted;
}

/** Detector overlay for one bbox — used so Traffic can paint the current view before the HK dump finishes. */
export async function loadCongestionArea(
  box: BBox,
  refreshLive = false,
): Promise<CongestionSegment[]> {
  try {
    const [live, roadsRaw, signedRaw] = await Promise.all([
      loadLiveSpeeds(refreshLive),
      queryBox(10, box),
      queryBox(2, box),
    ]);
    if (!live.size) return hkPaintCache ?? [];
    return rememberPaint(paintCongestion(live, networkFromFeatures(roadsRaw, signedRaw)));
  } catch {
    return hkPaintCache ?? [];
  }
}

/** Recolor already-drawn geometry from a fresh speed file. */
export async function refreshCongestionSpeeds(): Promise<CongestionSegment[]> {
  const prev = hkPaintCache;
  if (!prev?.length) return [];
  try {
    const live = await loadLiveSpeeds(true);
    if (!live.size) return prev;
    const next = prev.map((seg) => {
      if (seg.id == null) return seg;
      const kmh = live.get(seg.id);
      if (kmh == null || kmh <= 0) return seg;
      return { ...seg, kmh, estimated: false, interpolated: false };
    });
    return rememberPaint(next);
  } catch {
    return prev;
  }
}

/** Whole-territory detector overlay. Geometry is cached; live speeds can be forced fresh. */
export async function loadCongestionHk(refreshLive = false): Promise<CongestionSegment[]> {
  try {
    const [live, network] = await Promise.all([loadLiveSpeeds(refreshLive), loadHkNetwork()]);
    if (!live.size && !network.roads.length) return hkPaintCache ?? [];
    return rememberPaint(paintCongestion(live, network));
  } catch {
    return hkPaintCache ?? [];
  }
}

async function loadCorridor(key: string, path: LatLng[], boxes?: BBox[]): Promise<Corridor> {
  const cached = corridorCache.get(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.corridor;
  const inflight = corridorInflight.get(key);
  if (inflight) return inflight;
  const job = (async () => {
    const live = await loadLiveSpeeds();
    const wins = boxes ?? windows(path).slice(0, 14);
    const strategic: Seg[] = [];
    const limits: Seg[] = [];
    const interpolated: InterpSeg[] = [];
    const seenSpeed = new Set<number>();
    const seenLimit = new Set<number>();
    const seenInterp = new Set<number>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < wins.length) {
        const box = wins[cursor++];
        if (!box) return;
        try {
          const [roads, signed] = await Promise.all([queryBox(10, box), queryBox(2, box)]);
          // Kept per-window so a borrowed speed never bridges a window (or tunnel/bridge) boundary.
          const winKnown: Seg[] = [];
          const winUnknown: Seg[] = [];
          for (const feature of roads) {
            const id = Number(feature.attributes?.ROUTE_ID);
            if (!Number.isFinite(id)) continue;
            const pts = readPaths(feature.geometry);
            if (pts.length < 2) continue;
            const road = typeof feature.attributes?.ROAD_NAME === "string" ? feature.attributes.ROAD_NAME : undefined;
            if (live.has(id)) {
              winKnown.push({ id, pts, road });
              if (!seenSpeed.has(id)) {
                seenSpeed.add(id);
                strategic.push({ id, pts });
              }
            } else {
              winUnknown.push({ id, pts, road });
            }
          }
          // No reading of its own: borrow a same-window neighbour detector's speed.
          if (winUnknown.length && winKnown.length) {
            const winGrid = buildGrid(winKnown);
            for (const seg of winUnknown) {
              if (seg.id != null && seenInterp.has(seg.id)) continue;
              const kmh = interpolateSpeed(winGrid, live, seg);
              if (kmh == null) continue;
              if (seg.id != null) seenInterp.add(seg.id);
              interpolated.push({ id: seg.id, pts: seg.pts, kmh });
            }
          }
          for (const feature of signed) {
            const id = Number(feature.attributes?.ROAD_ROUTE_ID);
            const limit = parseLimit(feature.attributes?.SPEED_LIMIT);
            if (!Number.isFinite(id) || limit == null || seenLimit.has(id)) continue;
            const pts = readPaths(feature.geometry);
            if (pts.length < 2) continue;
            seenLimit.add(id);
            limits.push({ id, limit, pts });
          }
        } catch {
          /* this window stays unmatched */
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, wins.length) }, () => worker()));
    const corridor = { strategic, limits, interpolated };
    if (live.size > 0 || limits.length > 0) corridorCache.set(key, { at: Date.now(), corridor });
    return corridor;
  })().finally(() => {
    corridorInflight.delete(key);
  });
  corridorInflight.set(key, job);
  return job;
}

function paceFrom(live: Map<number, number>, corridor: Corridor): RoadPace {
  const speedGrid = buildGrid(corridor.strategic);
  const limitGrid = buildGrid(corridor.limits);
  return {
    kmhAt(point) {
      const seg = nearest(speedGrid, point, (item) => item.id != null && live.has(item.id));
      if (!seg?.id) return null;
      return live.get(seg.id) ?? null;
    },
    limitAt(point) {
      const seg = nearest(limitGrid, point, (item) => item.limit != null);
      return seg?.limit ?? null;
    },
  };
}

export async function loadRoadPace(key: string, path: LatLng[]): Promise<RoadPace | null> {
  if (path.length < 2) return null;
  try {
    const [live, corridor] = await Promise.all([loadLiveSpeeds(), loadCorridor(key, path)]);
    if (!live.size && !corridor.limits.length) return null;
    return paceFrom(live, corridor);
  } catch {
    return null;
  }
}

export type CongestionSegment = {
  /** Detector route id (stable identity for the accumulating overlay); absent for limit-only roads. */
  id?: number;
  /** Full polyline geometry of the road segment. */
  pts: LatLng[];
  /** Traffic speed, km/h. Estimated free-flow when no detector matches. */
  kmh: number;
  /** Posted speed limit, km/h. */
  limit: number;
  /** True when `kmh` is an estimated free-flow value rather than live detector data. */
  estimated: boolean;
  /** True when `kmh` was borrowed from a neighbouring detector (drawn in colour, reduced opacity). */
  interpolated?: boolean;
};

/** Posted limit for a strategic segment: nearest signed-speed segment to any of its vertices. */
function segLimit(limitGrid: Map<string, Seg[]>, seg: Seg): number | null {
  const step = Math.max(1, Math.floor(seg.pts.length / 6));
  for (let i = 0; i < seg.pts.length; i += step) {
    const point = seg.pts[i];
    if (!point) continue;
    const found = nearest(limitGrid, point, (item) => item.limit != null);
    if (found?.limit != null) return found.limit;
  }
  return null;
}

/** Live speed near a signed segment: nearest strategic detector segment to any of its vertices. */
function segLiveKmh(strategicGrid: Map<string, Seg[]>, live: Map<number, number>, seg: Seg): number | null {
  const step = Math.max(1, Math.floor(seg.pts.length / 6));
  for (let i = 0; i < seg.pts.length; i += step) {
    const point = seg.pts[i];
    if (!point) continue;
    const found = nearest(strategicGrid, point, (item) => item.id != null && live.has(item.id));
    const kmh = found?.id != null ? live.get(found.id) : null;
    if (kmh != null && kmh > 0) return kmh;
  }
  return null;
}

/**
 * @deprecated Viewport tiling; the Traffic overlay uses `loadCongestionHk`.
 */
export async function loadCongestionSegments(
  _key: string,
  _area: { west: number; south: number; east: number; north: number },
): Promise<CongestionSegment[]> {
  return loadCongestionHk(false);
}
