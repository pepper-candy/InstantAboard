import { haversine, type LatLng } from "./geo";
import type { RoadPace } from "./vehicle";

const SPEED_URL = "https://resource.data.one.gov.hk/td/traffic-detectors/irnAvgSpeed-all.xml";
const FS = "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638949160594_2844/FeatureServer";
const CELL = 0.002;
const MATCH_M = 35;

type Seg = { id?: number; limit?: number; pts: LatLng[] };

type Corridor = { strategic: Seg[]; limits: Seg[] };

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

async function loadLiveSpeeds(): Promise<Map<number, number>> {
  if (liveCache && Date.now() - liveCache.at < 90_000) return liveCache.map;
  if (liveInflight) return liveInflight;
  liveInflight = (async () => {
    try {
      const res = await fetch(SPEED_URL, { cache: "no-store" });
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

async function queryBox(layer: number, box: BBox): Promise<Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>> {
  const geometry = {
    xmin: box.west,
    ymin: box.south,
    xmax: box.east,
    ymax: box.north,
    spatialReference: { wkid: 4326 },
  };
  const params = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: layer === 10 ? "ROUTE_ID" : "ROAD_ROUTE_ID,SPEED_LIMIT",
    returnGeometry: "true",
    outSR: "4326",
    geometry: JSON.stringify(geometry),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    resultRecordCount: "2000",
    resultOffset: "0",
  });
  const res = await fetch(`${FS}/${layer}/query?${params}`, { cache: "force-cache" });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    features?: Array<{ attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }>;
  };
  return json.features ?? [];
}

async function loadCorridor(key: string, path: LatLng[]): Promise<Corridor> {
  const cached = corridorCache.get(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.corridor;
  const inflight = corridorInflight.get(key);
  if (inflight) return inflight;
  const job = (async () => {
    const live = await loadLiveSpeeds();
    const boxes = windows(path).slice(0, 14);
    const strategic: Seg[] = [];
    const limits: Seg[] = [];
    const seenSpeed = new Set<number>();
    const seenLimit = new Set<number>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < boxes.length) {
        const box = boxes[cursor++];
        if (!box) return;
        try {
          const [roads, signed] = await Promise.all([queryBox(10, box), queryBox(2, box)]);
          for (const feature of roads) {
            const id = Number(feature.attributes?.ROUTE_ID);
            if (!Number.isFinite(id) || !live.has(id) || seenSpeed.has(id)) continue;
            const pts = readPaths(feature.geometry);
            if (pts.length < 2) continue;
            seenSpeed.add(id);
            strategic.push({ id, pts });
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
    await Promise.all(Array.from({ length: Math.min(3, boxes.length) }, () => worker()));
    const corridor = { strategic, limits };
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
