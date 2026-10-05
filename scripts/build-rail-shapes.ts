/**
 * Write one track shape per MTR direction and light-rail route into public/shapes.
 *
 * HDX "Railways of Hong Kong" (hotosm_hkg_railways) is an OSM export filtered to
 * railway=rail, so it has the East Rail and Tuen Ma lines and not the underground
 * lines (OSM tags those railway=subway) or the light rail. This uses the same
 * OpenStreetMap ways, including subway and light_rail, and never a road router.
 *
 * Bus shape files already in the output folder are left in place. build-shapes.ts
 * calls this after it clears public/shapes, so a full prebuild still regenerates them.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { haversine, type LatLng } from "../src/lib/geo";
import { shapeFileName } from "../src/lib/shapeFile";
import type { Company, EtaDb, RouteListEntry } from "../src/lib/types";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "scripts", ".cache");
const OUT = path.join(ROOT, "public", "shapes");
const HKBUS = "https://data.hkbus.app/routeFareList.min.json";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const WAYS_CACHE = path.join(CACHE, "hk-rail-ways.json");
const SNAP_M = 220;
const BRIDGE_M = 45;
const UNNAMED_M = 40;
const SIMPLIFY_M = 8;

const LINE_NAME: Record<string, (name: string) => boolean> = {
  SIL: (name) => name.includes("south island"),
  ISL: (name) => name.includes("island line") && !name.includes("south island"),
  TKL: (name) => name.includes("tseung kwan o"),
  KTL: (name) => name.includes("kwun tong"),
  TWL: (name) => name.includes("tsuen wan"),
  TCL: (name) => name.includes("tung chung"),
  AEL: (name) => name.includes("airport express"),
  DRL: (name) => name.includes("disneyland"),
  EAL: (name) => name.includes("east rail"),
  TML: (name) => name.includes("tuen ma"),
};

type Way = { name: string; railway: string; pts: LatLng[] };

type Graph = {
  nodes: LatLng[];
  adj: Array<Array<{ to: number; len: number }>>;
};

export async function buildRailShapes(outDir: string): Promise<void> {
  await mkdir(CACHE, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const db = await loadDb();
  const ways = await loadWays();
  const unnamed = ways.filter((way) => !way.name && (way.railway === "subway" || way.railway === "light_rail"));
  const graphs = new Map<string, Graph>();
  let files = 0;
  let gaps = 0;

  for (const route of Object.values(db.routeList)) {
    for (const company of route.co) {
      if (company !== "mtr" && company !== "lightRail") continue;
      const stops = stopCoords(db, route, company);
      if (stops.length < 2) continue;
      const key = company === "lightRail" ? "lightRail" : route.route;
      let graph = graphs.get(key);
      if (!graph) {
        const track = key === "lightRail" ? lightRailWays(ways, unnamed) : lineWays(ways, route.route, unnamed);
        graph = graphFrom(track);
        graphs.set(key, graph);
      }
      const { line, straight } = trace(graph, stops);
      gaps += straight;
      const name = shapeFileName({
        company,
        route: route.route,
        bound: route.bound[company],
        serviceType: route.serviceType,
        gtfsId: route.gtfsId,
        nlbId: route.nlbId,
      });
      const body = JSON.stringify(line.map((point) => [round(point.lat), round(point.lng)]));
      await writeFile(path.join(outDir, name), body);
      files++;
    }
  }

  console.log(`rail shapes: ${files} files, straight gaps ${gaps}, osm ways ${ways.length}`);
  if (files < 40) throw new Error(`too few rail shapes (${files})`);
  report(path.join(outDir, "mtr-TKL-DT-1-0.json"), "TKL Po Lam");
}

function lineWays(ways: Way[], code: string, unnamed: Way[]): Way[] {
  const match = LINE_NAME[code];
  const named = match ? ways.filter((way) => match(way.name)) : [];
  if (!named.length) return [];
  return [...named, ...attachUnnamed(named, unnamed)];
}

function lightRailWays(ways: Way[], unnamed: Way[]): Way[] {
  const named = ways.filter((way) => way.name.includes("light rail") || way.name.includes("輕鐵"));
  return [...named, ...attachUnnamed(named, unnamed.filter((way) => way.railway === "light_rail"))];
}

function attachUnnamed(named: Way[], unnamed: Way[]): Way[] {
  const points = named.flatMap((way) => way.pts);
  const grid = gridOf(points);
  const extra: Way[] = [];
  for (const way of unnamed) {
    const ends = [way.pts[0], way.pts[way.pts.length - 1]];
    if (ends.some((point) => point && within(points, grid, point, UNNAMED_M))) extra.push(way);
  }
  return extra;
}

function graphFrom(ways: Way[]): Graph {
  const index = new Map<string, number>();
  const nodes: LatLng[] = [];
  const adj: Graph["adj"] = [];
  const idOf = (point: LatLng) => {
    const key = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    const existing = index.get(key);
    if (existing != null) return existing;
    const id = nodes.length;
    index.set(key, id);
    nodes.push(point);
    adj.push([]);
    return id;
  };
  const link = (a: number, b: number) => {
    if (a === b) return;
    const len = haversine(nodes[a], nodes[b]);
    if (len <= 0) return;
    adj[a].push({ to: b, len });
    adj[b].push({ to: a, len });
  };
  const ends: number[] = [];
  for (const way of ways) {
    let prev = -1;
    for (const point of way.pts) {
      const id = idOf(point);
      if (prev >= 0) link(prev, id);
      else ends.push(id);
      prev = id;
    }
    if (prev >= 0) ends.push(prev);
  }
  const endGrid: Cell = new Map();
  for (const id of ends) {
    const key = cellKey(nodes[id]);
    const list = endGrid.get(key);
    if (list) list.push(id);
    else endGrid.set(key, [id]);
  }
  const seen = new Set<string>();
  for (const id of ends) {
    for (const other of nearbyIds(endGrid, nodes[id], BRIDGE_M)) {
      if (other === id || haversine(nodes[id], nodes[other]) > BRIDGE_M) continue;
      const pair = id < other ? `${id}:${other}` : `${other}:${id}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      link(id, other);
    }
  }
  return { nodes, adj };
}

function trace(graph: Graph, stops: LatLng[]): { line: LatLng[]; straight: number } {
  if (graph.nodes.length < 2) return { line: stops, straight: stops.length - 1 };
  const grid = gridOf(graph.nodes);
  const line: LatLng[] = [];
  let straight = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const from = nearest(graph, grid, stops[i]);
    const to = nearest(graph, grid, stops[i + 1]);
    const through = from == null || to == null ? null : shortest(graph, from, to);
    const leg = through ?? [stops[i], stops[i + 1]];
    if (!through) straight++;
    if (line.length && leg.length) leg.shift();
    line.push(...leg);
  }
  return { line: simplify(dedupe(line), SIMPLIFY_M), straight };
}

function nearest(graph: Graph, grid: Cell, point: LatLng): number | null {
  let best = -1;
  let bestD = SNAP_M;
  for (const id of nearbyIds(grid, point, SNAP_M)) {
    const dist = haversine(graph.nodes[id], point);
    if (dist < bestD) {
      bestD = dist;
      best = id;
    }
  }
  return best >= 0 ? best : null;
}

function shortest(graph: Graph, start: number, goal: number): LatLng[] | null {
  if (start === goal) return [graph.nodes[start]];
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, number>();
  const heap: Array<{ d: number; n: number }> = [{ d: 0, n: start }];
  const push = (item: { d: number; n: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].d <= heap[i].d) break;
      const swap = heap[parent];
      heap[parent] = heap[i];
      heap[i] = swap;
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (!last || heap.length === 0) return top;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && heap[left].d < heap[smallest].d) smallest = left;
      if (right < heap.length && heap[right].d < heap[smallest].d) smallest = right;
      if (smallest === i) break;
      const swap = heap[smallest];
      heap[smallest] = heap[i];
      heap[i] = swap;
      i = smallest;
    }
    return top;
  };
  while (heap.length) {
    const item = pop();
    if (!item || item.d !== dist.get(item.n)) continue;
    if (item.n === goal) break;
    for (const edge of graph.adj[item.n]) {
      const next = item.d + edge.len;
      const known = dist.get(edge.to);
      if (known != null && next >= known) continue;
      dist.set(edge.to, next);
      prev.set(edge.to, item.n);
      push({ d: next, n: edge.to });
    }
  }
  if (!prev.has(goal)) return null;
  const ids = [goal];
  let cursor = goal;
  while (cursor !== start) {
    const before = prev.get(cursor);
    if (before == null) return null;
    ids.push(before);
    cursor = before;
  }
  ids.reverse();
  return ids.map((id) => graph.nodes[id]);
}

function stopCoords(db: EtaDb, route: RouteListEntry, company: Company): LatLng[] {
  const ids = route.stops[company] ?? [];
  const points: LatLng[] = [];
  for (const id of ids) {
    const stop = db.stopList[id];
    if (!stop) continue;
    const point = stop.location;
    const prev = points[points.length - 1];
    if (prev && haversine(prev, point) < 30) continue;
    points.push(point);
  }
  return points;
}

type Cell = Map<string, number[]>;

function gridOf(points: LatLng[]): Cell {
  const grid: Cell = new Map();
  points.forEach((point, id) => {
    const key = cellKey(point);
    const list = grid.get(key);
    if (list) list.push(id);
    else grid.set(key, [id]);
  });
  return grid;
}

function within(points: LatLng[], grid: Cell, point: LatLng, spanM: number): boolean {
  return nearbyIds(grid, point, spanM).some((id) => haversine(points[id], point) <= spanM);
}

function nearbyIds(grid: Cell, point: LatLng, spanM: number): number[] {
  const reach = Math.max(1, Math.ceil(spanM / 80));
  const lat = Math.round(point.lat / 0.0008);
  const lng = Math.round(point.lng / 0.0008);
  const ids: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const list = grid.get(`${lat + dy}:${lng + dx}`);
      if (list) ids.push(...list);
    }
  }
  return ids;
}

function cellKey(point: LatLng): string {
  return `${Math.round(point.lat / 0.0008)}:${Math.round(point.lng / 0.0008)}`;
}

function simplify(points: LatLng[], tolM: number): LatLng[] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const pair = stack.pop();
    if (!pair) break;
    const [from, to] = pair;
    let best = -1;
    let bestD = tolM;
    for (let i = from + 1; i < to; i++) {
      const dist = offSegment(points[from], points[to], points[i]);
      if (dist > bestD) {
        bestD = dist;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([from, best], [best, to]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function offSegment(a: LatLng, b: LatLng, point: LatLng): number {
  const lat0 = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const x = (lng: number) => lng * Math.cos(lat0) * 111_320;
  const y = (lat: number) => lat * 110_540;
  const ax = x(a.lng);
  const ay = y(a.lat);
  const bx = x(b.lng);
  const by = y(b.lat);
  const px = x(point.lng);
  const py = y(point.lat);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function dedupe(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && prev.lat === point.lat && prev.lng === point.lng) continue;
    out.push(point);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

async function report(file: string, label: string): Promise<void> {
  try {
    const line = JSON.parse(await readFile(file, "utf8")) as number[][];
    console.log(`${label}: ${line.length} points`);
  } catch {
    console.warn(`${label}: missing ${path.basename(file)}`);
  }
}

async function loadDb(): Promise<EtaDb> {
  const file = path.join(CACHE, "routeFareList.min.json");
  const text = await cachedText(file, HKBUS);
  return JSON.parse(text) as EtaDb;
}

async function loadWays(): Promise<Way[]> {
  try {
    if ((await stat(WAYS_CACHE)).size > 1000) {
      return JSON.parse(await readFile(WAYS_CACHE, "utf8")) as Way[];
    }
  } catch {
    /* download */
  }
  const query = `[out:json][timeout:180];(way["railway"="subway"](22.14,113.82,22.56,114.45);way["railway"="light_rail"](22.14,113.82,22.56,114.45);way["railway"="rail"](22.14,113.82,22.56,114.45););out geom;`;
  const res = await fetch(OVERPASS, { method: "POST", body: query, signal: AbortSignal.timeout(200_000) });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const body = (await res.json()) as {
    elements?: Array<{ tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }>;
  };
  const ways: Way[] = [];
  for (const element of body.elements ?? []) {
    const tags = element.tags ?? {};
    const railway = tags.railway ?? "";
    const raw = `${tags["name:en"] ?? ""} ${tags.name ?? ""}`.trim();
    const name = raw.toLowerCase();
    if (/shenzhen|深圳|people mover|high\s*speed|highspeed|guangzhou/.test(name)) continue;
    const pts = (element.geometry ?? [])
      .map((point) => ({ lat: point.lat, lng: point.lon }))
      .filter((point) => point.lat < 22.555);
    if (pts.length < 2) continue;
    ways.push({ name, railway, pts });
  }
  await writeFile(WAYS_CACHE, JSON.stringify(ways));
  return ways;
}

async function cachedText(file: string, url: string): Promise<string> {
  try {
    if ((await stat(file)).size > 50) return await readFile(file, "utf8");
  } catch {
    /* download */
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const text = await res.text();
  await writeFile(file, text);
  return text;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").includes("build-rail-shapes");
if (isMain) {
  void buildRailShapes(OUT).catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
