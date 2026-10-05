/**
 * Build per-route road lines into public/shapes.
 *
 * TD routes-fares GeoJSON (JSON_BUS / JSON_GMB / JSON_FERRY / JSON_TRAM) is one
 * Point per stop, not a road line. The headway GTFS zip is checked for
 * shapes.txt (it is not published there). Franchised bus centerlines come from
 * the same dataset's CSDI "Bus Route" layer (FB_ROUTE_LINE), matched on GTFS
 * route id plus origin/destination. GMB, ferry, tram, MTR, and light rail have
 * no line geometry here. MTR and light rail are written afterwards from OSM tracks.
 * GMB, ferry, and tram still fall back to OSRM, then straight segments. Rail never does.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { simplify } from "@turf/simplify";
import { shapeFileName } from "../src/lib/shapeFile";
import type { Company, EtaDb, RouteListEntry } from "../src/lib/types";

const ROOT = process.cwd();
const CACHE = path.join(ROOT, "scripts", ".cache");
const OUT = path.join(ROOT, "public", "shapes");
const HKBUS = "https://data.hkbus.app/routeFareList.min.json";
const GTFS = "https://static.data.gov.hk/td/pt-headway-en/gtfs.zip";
const LINES =
  "https://portal.csdi.gov.hk/server/rest/services/common/td_rcd_1638844988873_41214/MapServer/0/query";
const PAGE = 200;
const TOLERANCE_DEG = 5 / 111_320;

const COMPANY_CODES: Partial<Record<Company, string[]>> = {
  kmb: ["KMB", "LWB", "KMB+CTB", "LWB+CTB"],
  ctb: ["CTB", "KMB+CTB", "LWB+CTB"],
  nlb: ["NLB"],
  lrtfeeder: ["LRTFEEDER", "LRT", "MTR"],
};

type LineRec = {
  routeId: string;
  seq: number;
  company: string;
  routeName: string;
  startEn: string;
  endEn: string;
  startZh: string;
  endZh: string;
  points: [number, number][];
};

type Feature = {
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown>;
};

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true });
  await noteGtfs();
  const db = await loadDb();
  const lines = await loadLines();
  const { byId, byName } = indexLines(lines);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const files = new Map<string, string>();
  let matched = 0;
  let unmatched = 0;
  let clashes = 0;

  for (const route of Object.values(db.routeList)) {
    for (const company of route.co) {
      const bound = route.bound[company] || "O";
      const picked = pick(candidates(route, company, byId, byName), route, bound);
      if (!picked) {
        unmatched++;
        continue;
      }
      matched++;
      const name = shapeFileName({
        company,
        route: route.route,
        bound,
        serviceType: route.serviceType,
        gtfsId: route.gtfsId,
        nlbId: route.nlbId,
      });
      const body = JSON.stringify(picked.points);
      const prev = files.get(name);
      if (prev && prev !== body) clashes++;
      files.set(name, body);
    }
  }

  const entries = [...files.entries()];
  for (let i = 0; i < entries.length; i += 80) {
    await Promise.all(entries.slice(i, i + 80).map(([name, body]) => writeFile(path.join(OUT, name), body)));
  }
  const sample = files.get("kmb-91M-I-1-1398.json");
  console.log(
    `shapes: ${files.size} files, matched ${matched}, unmatched ${unmatched}, clashes ${clashes}, lines ${lines.length}` +
      (sample ? `, 91M inbound points ${JSON.parse(sample).length}` : ", 91M inbound missing"),
  );
  if (lines.length < 1000) throw new Error(`too few route lines (${lines.length})`);
  if (files.size < 800) throw new Error(`too few shape files (${files.size})`);
  const { buildRailShapes } = await import("./build-rail-shapes");
  await buildRailShapes(OUT);
}

function candidates(
  route: RouteListEntry,
  company: Company,
  byId: Map<string, LineRec[]>,
  byName: Map<string, LineRec[]>,
): LineRec[] {
  const gtfsId = String(route.gtfsId || "");
  const byGtfs = gtfsId ? byId.get(gtfsId) : undefined;
  if (byGtfs?.length) return byGtfs;
  const codes = COMPANY_CODES[company] ?? [company.toUpperCase()];
  const found: LineRec[] = [];
  const seen = new Set<LineRec>();
  const routeName = route.route.trim().toUpperCase();
  for (const code of codes) {
    for (const item of byName.get(`${code}|${routeName}`) ?? []) {
      if (seen.has(item)) continue;
      seen.add(item);
      found.push(item);
    }
  }
  return found;
}

function pick(cands: LineRec[], route: RouteListEntry, bound: string): LineRec | null {
  if (!cands.length) return null;
  let best = cands[0];
  let bestScore = -1;
  for (const cand of cands) {
    let score =
      nameScore(route.dest.en, cand.endEn) * 3 +
      nameScore(route.orig.en, cand.startEn) * 2 +
      nameScore(route.dest.zh, cand.endZh) +
      nameScore(route.orig.zh, cand.startZh);
    if ((bound === "I" && cand.seq === 2) || (bound !== "I" && cand.seq === 1)) score += 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

function nameScore(a: string, b: string): number {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return 0;
  if (left === right) return 5;
  if (left.includes(right) || right.includes(left)) return 4;
  const words = new Set(left.split(" ").filter((word) => word.length > 2));
  let overlap = 0;
  for (const word of right.split(" ")) {
    if (word.length > 2 && words.has(word)) overlap++;
  }
  return overlap;
}

function norm(value: string): string {
  return value
    .toUpperCase()
    .replace(/BUS TERMINUS|TERMINUS|BUS TERM|STATION/g, " ")
    .replace(/[^A-Z0-9\u4E00-\u9FFF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function indexLines(lines: LineRec[]): { byId: Map<string, LineRec[]>; byName: Map<string, LineRec[]> } {
  const byId = new Map<string, LineRec[]>();
  const byName = new Map<string, LineRec[]>();
  for (const line of lines) {
    push(byId, line.routeId, line);
    const routeName = line.routeName.trim().toUpperCase();
    for (const code of companyKeys(line.company)) push(byName, `${code}|${routeName}`, line);
  }
  return { byId, byName };
}

function companyKeys(code: string): string[] {
  const upper = code.toUpperCase();
  return [...new Set([upper, ...upper.split("+").map((part) => part.trim())])];
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

async function loadDb(): Promise<EtaDb> {
  const file = path.join(CACHE, "routeFareList.min.json");
  const text = await cachedText(file, HKBUS);
  return JSON.parse(text) as EtaDb;
}

async function noteGtfs(): Promise<void> {
  const file = path.join(CACHE, "gtfs.zip");
  let bytes: Buffer;
  try {
    if ((await stat(file)).size > 1000) bytes = await readFile(file);
    else throw new Error("short");
  } catch {
    const res = await fetch(GTFS, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`gtfs ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
    await writeFile(file, bytes);
  }
  const hasShapes = bytes.includes(Buffer.from("shapes.txt"));
  console.log(hasShapes ? "gtfs zip includes shapes.txt" : "gtfs zip has no shapes.txt; using CSDI route lines");
}

async function loadLines(): Promise<LineRec[]> {
  const lines: LineRec[] = [];
  const seen = new Set<number>();
  for (let offset = 0; ; offset += PAGE) {
    const features = await loadPage(offset);
    if (!features.length) break;
    let fresh = 0;
    for (const feature of features) {
      const objectId = Number(feature.properties?.OBJECTID);
      if (seen.has(objectId)) continue;
      seen.add(objectId);
      fresh++;
      const line = toLine(feature);
      if (line) lines.push(line);
    }
    console.log(`route lines ${lines.length} (offset ${offset}, fresh ${fresh})`);
    if (fresh === 0 || features.length < PAGE) break;
  }
  return lines;
}

async function loadPage(offset: number): Promise<Feature[]> {
  const file = path.join(CACHE, `bus-${offset}.json`);
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "OBJECTID,ROUTE_ID,ROUTE_SEQ,COMPANY_CODE,ROUTE_NAMEE,ST_STOP_NAMEE,ED_STOP_NAMEE,ST_STOP_NAMEC,ED_STOP_NAMEC",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "5",
    f: "geojson",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
  });
  const text = await cachedText(file, `${LINES}?${params.toString()}`);
  const body = JSON.parse(text) as { features?: Feature[]; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "CSDI query failed");
  return body.features ?? [];
}

function toLine(feature: Feature): LineRec | null {
  const props = feature.properties ?? {};
  const coords = flatten(feature.geometry);
  if (coords.length < 2) return null;
  const simplified = simplifyCoords(coords);
  const points = dedupe(simplified.map(([lng, lat]) => [round(lat), round(lng)] as [number, number]));
  if (points.length < 2) return null;
  return {
    routeId: String(props.ROUTE_ID ?? ""),
    seq: Number(props.ROUTE_SEQ ?? 0),
    company: String(props.COMPANY_CODE ?? ""),
    routeName: String(props.ROUTE_NAMEE ?? ""),
    startEn: String(props.ST_STOP_NAMEE ?? ""),
    endEn: String(props.ED_STOP_NAMEE ?? ""),
    startZh: String(props.ST_STOP_NAMEC ?? ""),
    endZh: String(props.ED_STOP_NAMEC ?? ""),
    points,
  };
}

function flatten(geometry: Feature["geometry"]): number[][] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "LineString") return pairs(geometry.coordinates);
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    const out: number[][] = [];
    for (const part of geometry.coordinates) {
      for (const pair of pairs(part)) {
        const prev = out[out.length - 1];
        if (prev && prev[0] === pair[0] && prev[1] === pair[1]) continue;
        out.push(pair);
      }
    }
    return out;
  }
  return [];
}

function pairs(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  const out: number[][] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const lng = Number(item[0]);
    const lat = Number(item[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) out.push([lng, lat]);
  }
  return out;
}

function simplifyCoords(coords: number[][]): number[][] {
  if (coords.length < 4) return coords;
  const feature = {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
  const out = simplify(feature, { tolerance: TOLERANCE_DEG, highQuality: true });
  if (out.type !== "Feature" || out.geometry.type !== "LineString") return coords;
  return pairs(out.geometry.coordinates);
}

function dedupe(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    out.push(point);
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

async function cachedText(file: string, url: string): Promise<string> {
  try {
    if ((await stat(file)).size > 50) return await readFile(file, "utf8");
  } catch {
    /* download */
  }
  let last = "download failed";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      await writeFile(file, text);
      return text;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
      console.warn(`retry ${attempt} ${path.basename(file)}: ${last}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`${url} ${last}`);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
