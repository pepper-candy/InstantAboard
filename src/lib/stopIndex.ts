import { MODE_COLOR, mtrLineCode, mtrLineColors, routeColor } from "./colors";
import type { FerryPier } from "./extras";
import { HANG_HAU, haversine, type LatLng } from "./geo";
import { nameOf } from "./i18n";
import { companyMode, filterMatches } from "./mode";
import { taxiColors } from "./taxi";
import type { BoardFilter, Company, EtaDb, NearbyPlace, RouteListEntry, TaxiStand, Terminal } from "./types";

const STOP_RADIUS = 1200;
const MTR_RADIUS = 2000;
const MTR_CAP = 5;
const MTR_FALLBACK = 3;
const TRAM_RADIUS = 1000;
const TRAM_CAP = 5;
const TAXI_RADIUS = 1000;
const TAXI_CAP = 5;
const FERRY_RADIUS = 1200;

export type MtrDirRef = { routeId: string; stopSeq: number; dest: Terminal };

export type MtrLine = {
  routeId: string;
  route: string;
  company: "mtr";
  orig: Terminal;
  dest: Terminal;
  stopSeq: number;
  dirs: { UP?: MtrDirRef; DOWN?: MtrDirRef };
};

export type MtrStation = {
  stopId: string;
  name: Terminal;
  lat: number;
  lng: number;
  d: number;
  color: string;
  lines: MtrLine[];
};

function mtrBoundDir(bound: string | undefined): "UP" | "DOWN" | null {
  const b = (bound ?? "").toUpperCase();
  if (b === "DT") return "DOWN";
  if (b === "UT") return "UP";
  if (b.includes("DT")) return "DOWN";
  if (b.includes("UT")) return "UP";
  return null;
}

function isMainMtrBound(bound: string | undefined): boolean {
  const b = (bound ?? "").toUpperCase();
  return b === "UT" || b === "DT";
}

type MtrVariant = {
  routeId: string;
  route: RouteListEntry;
  stopSeq: number;
  dir: "UP" | "DOWN" | null;
  main: boolean;
  stops: number;
};

function betterMtrVariant(cur: MtrVariant | undefined, next: MtrVariant): boolean {
  if (!cur) return true;
  if (next.main !== cur.main) return next.main;
  return next.stops > cur.stops;
}

/** One row per line per station, using the main-line UT/DT variant (longest stop list). */
export function nearestMtrStations(db: EtaDb | null, origin: LatLng, limit = 5): MtrStation[] {
  if (!db) return [];
  const byStop = new Map<string, MtrStation>();
  const variants = new Map<string, Map<string, MtrVariant[]>>();
  for (const [routeId, route] of Object.entries(db.routeList)) {
    if (!route.co.includes("mtr")) continue;
    const ids = route.stops.mtr ?? [];
    const line = mtrLineCode(route.route);
    const dir = mtrBoundDir(route.bound.mtr);
    const main = isMainMtrBound(route.bound.mtr);
    ids.forEach((stopId, seq) => {
      const stop = db.stopList[stopId];
      if (!stop) return;
      if (!byStop.has(stopId)) {
        byStop.set(stopId, {
          stopId,
          name: stop.name,
          lat: stop.location.lat,
          lng: stop.location.lng,
          d: haversine(origin, stop.location),
          color: routeColor("mtr", route.route),
          lines: [],
        });
      }
      const perLine = variants.get(stopId) ?? new Map<string, MtrVariant[]>();
      const list = perLine.get(line) ?? [];
      list.push({ routeId, route, stopSeq: seq, dir, main, stops: ids.length });
      perLine.set(line, list);
      variants.set(stopId, perLine);
    });
  }
  for (const [stopId, row] of byStop) {
    const perLine = variants.get(stopId);
    if (!perLine) continue;
    for (const [line, list] of perLine) {
      const byDir: { UP?: MtrVariant; DOWN?: MtrVariant } = {};
      let fallback: MtrVariant | undefined;
      for (const item of list) {
        if (betterMtrVariant(fallback, item)) fallback = item;
        if (item.dir === "UP" && betterMtrVariant(byDir.UP, item)) byDir.UP = item;
        if (item.dir === "DOWN" && betterMtrVariant(byDir.DOWN, item)) byDir.DOWN = item;
      }
      const preferred =
        [byDir.UP, byDir.DOWN].filter((item): item is MtrVariant => Boolean(item)).sort((a, b) => {
          if (a.main !== b.main) return a.main ? -1 : 1;
          return b.stops - a.stops;
        })[0] ?? fallback;
      if (!preferred) continue;
      const dirs: MtrLine["dirs"] = {};
      if (byDir.UP) dirs.UP = { routeId: byDir.UP.routeId, stopSeq: byDir.UP.stopSeq, dest: byDir.UP.route.dest };
      if (byDir.DOWN) dirs.DOWN = { routeId: byDir.DOWN.routeId, stopSeq: byDir.DOWN.stopSeq, dest: byDir.DOWN.route.dest };
      if (!dirs.UP && !dirs.DOWN && fallback?.dir) {
        dirs[fallback.dir] = { routeId: fallback.routeId, stopSeq: fallback.stopSeq, dest: fallback.route.dest };
      }
      row.lines.push({
        routeId: preferred.routeId,
        route: line,
        company: "mtr",
        orig: preferred.route.orig,
        dest: preferred.route.dest,
        stopSeq: preferred.stopSeq,
        dirs,
      });
    }
    row.lines.sort((a, b) => a.route.localeCompare(b.route));
  }
  return [...byStop.values()].sort((a, b) => a.d - b.d).slice(0, limit);
}

function sameStopId(a: string, b: string): boolean {
  return a.replace(/^mtr:/i, "") === b.replace(/^mtr:/i, "");
}

/** Every MTR line colour at a stop, de-duplicated by line code. */
export function mtrLineColorsAtStop(db: EtaDb | null | undefined, stopId: string): string[] {
  if (!db || !stopId) return [];
  const routes: string[] = [];
  for (const route of Object.values(db.routeList)) {
    if (!route.co?.includes("mtr")) continue;
    if ((route.stops.mtr ?? []).some((id) => sameStopId(id, stopId))) routes.push(route.route);
  }
  return mtrLineColors(routes);
}

export function nearbyMtrStations(db: EtaDb | null, origin: LatLng): MtrStation[] {
  const nearest = nearestMtrStations(db, origin, 64);
  const within = nearest.filter((s) => s.d <= MTR_RADIUS);
  if (within.length) return within.slice(0, MTR_CAP);
  return nearest.slice(0, MTR_FALLBACK);
}

export function mtrStationById(db: EtaDb | null, origin: LatLng, placeId: string): MtrStation | null {
  const stopId = placeId.replace(/^mtr:/i, "");
  if (!stopId) return null;
  return nearestMtrStations(db, origin, 256).find((station) => sameStopId(station.stopId, stopId)) ?? null;
}

function mapStations(db: EtaDb, origin: LatLng, filter: BoardFilter): MtrStation[] {
  if (filter !== "all" && filter !== "mtr") return [];
  return nearbyMtrStations(db, origin);
}

function stationPlace(station: MtrStation): NearbyPlace {
  return {
    id: `mtr:${station.stopId}`,
    lat: station.lat,
    lng: station.lng,
    name: station.name,
    mode: "mtr",
    color: station.color,
    kind: "station",
    lineColors: mtrLineColors(station.lines.map((line) => line.route)),
    routes: station.lines.map((line) => ({
      routeId: line.routeId,
      company: "mtr" as Company,
      route: line.route,
      dest: line.dest,
    })),
  };
}

export type TramStop = {
  id: string;
  lat: number;
  lng: number;
  name: { en: string; zh: string };
  routeId: string;
  dest: { en: string; zh: string };
};

export type TramDirRef = {
  routeId: string;
  stopId: string;
  stopSeq: number;
  dest: Terminal;
};

export type TramLine = {
  routeId: string;
  route: string;
  company: "tram";
  orig: Terminal;
  dest: Terminal;
  stopSeq: number;
  dirs: { OUT?: TramDirRef; IN?: TramDirRef };
};

export type TramStation = {
  stopId: string;
  name: Terminal;
  lat: number;
  lng: number;
  d: number;
  color: string;
  lines: TramLine[];
};

/** Opposite bounds of one tram corridor share a key (orig/dest order ignored). */
export function tramServiceKey(route: RouteListEntry): string {
  const a = nameOf("en", route.orig, "");
  const b = nameOf("en", route.dest, "");
  return a < b ? `${route.route}|${a}|${b}` : `${route.route}|${b}|${a}`;
}

export function tramStopStem(name: Terminal | undefined): string {
  const en = (name?.en ?? "")
    .replace(/\s*\((?:west|east)\s*bound\)/gi, "")
    .trim()
    .toLowerCase();
  const zh = (name?.zh ?? "").replace(/\s*[（(]?(?:西行方向|東行方向|西行|東行)[）)]?/g, "").trim();
  return `${en}|${zh}`;
}

export function pairTramStopOnRoute(
  db: EtaDb,
  fromId: string | undefined,
  ids: string[],
): { stopId: string; stopSeq: number } | null {
  const from = fromId ? db.stopList[fromId] : undefined;
  if (!from || ids.length === 0) return null;
  const stem = tramStopStem(from.name);
  let best: { stopId: string; stopSeq: number; d: number } | null = null;
  for (let i = 0; i < ids.length; i++) {
    const stop = db.stopList[ids[i]];
    if (!stop) continue;
    if (tramStopStem(stop.name) !== stem) continue;
    const d = haversine(from.location, stop.location);
    if (!best || d < best.d) best = { stopId: ids[i] ?? "", stopSeq: i, d };
  }
  return best;
}

function tramBoundSide(route: RouteListEntry): "OUT" | "IN" {
  return (route.bound.tram ?? "O").toUpperCase().startsWith("I") ? "IN" : "OUT";
}

function reverseTramRoute(db: EtaDb, routeId: string, route: RouteListEntry): { id: string; route: RouteListEntry } | null {
  const key = tramServiceKey(route);
  const side = tramBoundSide(route);
  for (const [id, other] of Object.entries(db.routeList)) {
    if (id === routeId || !other.co.includes("tram")) continue;
    if (tramServiceKey(other) !== key) continue;
    if (tramBoundSide(other) === side) continue;
    return { id, other };
  }
  return null;
}

export function nearestTramStops(db: EtaDb | null, origin: LatLng, limit = 5): TramStation[] {
  if (!db) return [];
  const byStop = new Map<string, TramStation>();
  const seen = new Map<string, Set<string>>();
  for (const [routeId, route] of Object.entries(db.routeList)) {
    if (!route.co.includes("tram")) continue;
    const ids = route.stops.tram ?? [];
    const service = tramServiceKey(route);
    ids.forEach((stopId, seq) => {
      const stop = db.stopList[stopId];
      if (!stop) return;
      let row = byStop.get(stopId);
      if (!row) {
        row = {
          stopId,
          name: stop.name,
          lat: stop.location.lat,
          lng: stop.location.lng,
          d: haversine(origin, stop.location),
          color: MODE_COLOR.tram,
          lines: [],
        };
        byStop.set(stopId, row);
      }
      const services = seen.get(stopId) ?? new Set<string>();
      if (services.has(service)) return;
      services.add(service);
      seen.set(stopId, services);
      const side = tramBoundSide(route);
      const ref: TramDirRef = { routeId, stopId, stopSeq: seq, dest: route.dest };
      row.lines.push({
        routeId,
        route: route.route,
        company: "tram",
        orig: route.orig,
        dest: route.dest,
        stopSeq: seq,
        dirs: { [side]: ref },
      });
    });
  }
  for (const station of byStop.values()) {
    for (const line of station.lines) {
      const home = db.routeList[line.routeId];
      if (!home) continue;
      const reverse = reverseTramRoute(db, line.routeId, home);
      if (!reverse) continue;
      const paired = pairTramStopOnRoute(db, station.stopId, reverse.other.stops.tram ?? []);
      if (!paired) continue;
      const otherSide = tramBoundSide(reverse.other);
      line.dirs[otherSide] = {
        routeId: reverse.id,
        stopId: paired.stopId,
        stopSeq: paired.stopSeq,
        dest: reverse.other.dest,
      };
    }
  }
  return [...byStop.values()].sort((a, b) => a.d - b.d).slice(0, limit);
}

export function nearbyTramStops(db: EtaDb | null, origin: LatLng): TramStation[] {
  return nearestTramStops(db, origin, 64)
    .filter((s) => s.d <= TRAM_RADIUS)
    .slice(0, TRAM_CAP);
}

function mapTramStops(db: EtaDb, origin: LatLng, filter: BoardFilter): TramStation[] {
  if (filter !== "all" && filter !== "tram") return [];
  return nearbyTramStops(db, origin);
}

function tramPlace(stop: TramStation): NearbyPlace {
  return {
    id: `tram:${stop.stopId}`,
    lat: stop.lat,
    lng: stop.lng,
    name: stop.name,
    mode: "tram",
    color: stop.color,
    kind: "tram",
    routes: stop.lines.map((line) => ({
      routeId: line.routeId,
      company: "tram" as Company,
      route: line.route,
      dest: line.dest,
    })),
  };
}

function pierId(pier: { lat: number; lng: number }): string {
  return `ferry:${pier.lat},${pier.lng}`;
}

/** One pin per coordinate. The pier file lists some docks twice under different names. */
function uniquePiers(piers: FerryPier[]): NearbyPlace[] {
  const byId = new Map<string, NearbyPlace>();
  for (const pier of piers) {
    const id = pierId(pier);
    const existing = byId.get(id);
    if (existing) {
      const dests = existing.dests ?? [];
      for (const dest of pier.dests ?? []) {
        if (!dests.some((item) => item.en === dest.en)) dests.push(dest);
      }
      existing.dests = dests;
      continue;
    }
    byId.set(id, {
      id,
      lat: pier.lat,
      lng: pier.lng,
      name: pier.name,
      mode: "ferry",
      color: MODE_COLOR.ferry,
      kind: "pier",
      routes: [],
      dests: [...(pier.dests ?? [])],
    });
  }
  return [...byId.values()];
}

function ferryPlaces(piers: FerryPier[], origin: LatLng, filter: BoardFilter): NearbyPlace[] {
  if (filter !== "all" && filter !== "ferry") return [];
  return uniquePiers(piers)
    .map((place) => ({ place, d: haversine(origin, place) }))
    .filter((row) => row.d <= FERRY_RADIUS)
    .sort((a, b) => a.d - b.d)
    .map(({ place }) => place);
}

function nearestTaxiStands(taxis: TaxiStand[], origin: LatLng): TaxiStand[] {
  const ranked = taxis
    .map((stand) => ({ stand, d: haversine(origin, stand) }))
    .sort((a, b) => a.d - b.d);
  const nearby = ranked.filter((row) => row.d <= TAXI_RADIUS).slice(0, TAXI_CAP);
  if (nearby.length > 0) return nearby.map((row) => row.stand);
  return ranked[0] ? [ranked[0].stand] : [];
}

export function nearbyPlaces(
  db: EtaDb | null,
  origin: LatLng,
  filter: BoardFilter,
  taxis: TaxiStand[],
  tramStops: TramStop[],
  ferryPiers: FerryPier[] = [],
  _limit = 48,
): NearbyPlace[] {
  const out: Array<NearbyPlace & { d: number }> = [];
  if (db) {
    const seen = new Map<string, NearbyPlace & { d: number }>();
    for (const [routeId, route] of Object.entries(db.routeList)) {
      const company = route.co.find((c) => (route.stops[c] ?? []).length) ?? route.co[0];
      if (!company || company === "mtr" || company === "tram") continue;
      const mode = companyMode(company);
      if (!filterMatches(filter, mode)) continue;
      const ids = route.stops[company] ?? [];
      for (const stopId of ids) {
        const stop = db.stopList[stopId];
        if (!stop) continue;
        const d = haversine(origin, stop.location);
        if (d > STOP_RADIUS) continue;
        const key = `${mode}:${stopId}`;
        const existing = seen.get(key);
        const leg = { routeId, company, route: route.route, dest: route.dest };
        if (existing) {
          if (!existing.routes.some((r) => r.routeId === routeId)) existing.routes.push(leg);
          continue;
        }
        const place: NearbyPlace & { d: number } = {
          id: key,
          lat: stop.location.lat,
          lng: stop.location.lng,
          name: stop.name,
          mode,
          color: MODE_COLOR[mode],
          kind: mode === "ferry" ? "pier" : "stop",
          routes: [leg],
          d,
        };
        seen.set(key, place);
      }
    }
    out.push(...seen.values());
  }

  // Fallback when tram is not yet merged into the ETA db.
  if (filterMatches(filter, "tram") && (!db || !Object.values(db.routeList).some((r) => r.co.includes("tram")))) {
    const byStop = new Map<string, NearbyPlace & { d: number }>();
    for (const stop of tramStops) {
      const d = haversine(origin, stop);
      const existing = byStop.get(stop.id);
      const leg = {
        routeId: stop.routeId,
        company: "tram" as Company,
        route: "Tram",
        dest: stop.dest,
      };
      if (existing) {
        if (!existing.routes.some((r) => r.routeId === stop.routeId)) existing.routes.push(leg);
        continue;
      }
      byStop.set(stop.id, {
        id: `tram:${stop.id}`,
        lat: stop.lat,
        lng: stop.lng,
        name: stop.name,
        mode: "tram",
        color: MODE_COLOR.tram,
        kind: "tram",
        routes: [leg],
        d,
      });
    }
    const picked = [...byStop.values()]
      .filter((s) => s.d <= TRAM_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, TRAM_CAP);
    out.push(...picked);
  }

  out.sort((a, b) => a.d - b.d);
  const places = out;
  const stations = db ? mapStations(db, origin, filter).map(stationPlace) : [];
  const trams = db ? mapTramStops(db, origin, filter).map(tramPlace) : [];
  const stands: NearbyPlace[] = [];
  if (filter === "all" || filter === "taxi") {
    for (const stand of nearestTaxiStands(taxis, origin)) {
      stands.push({
        id: `taxi:${stand.id}`,
        lat: stand.lat,
        lng: stand.lng,
        name: stand.name,
        mode: "taxi",
        color: MODE_COLOR.taxi,
        kind: "taxi",
        taxiColors: taxiColors(stand.kind),
        routes: [],
      });
    }
  }
  const piers = ferryPlaces(ferryPiers, origin, filter).filter(
    (pier) => !places.some((place) => place.mode === "ferry" && haversine(place, pier) < 90),
  );
  return [...places, ...stations, ...trams, ...stands, ...piers];
}

export function defaultOrigin(pos: LatLng | null): LatLng {
  return pos ?? HANG_HAU;
}

/** Every stop, station, stand, and pier, ignoring the nearby caps. */
export function everyPlace(
  db: EtaDb | null,
  origin: LatLng,
  taxis: TaxiStand[],
  tramStops: TramStop[],
  ferryPiers: FerryPier[] = [],
): NearbyPlace[] {
  const seen = new Map<string, NearbyPlace>();
  if (db) {
    for (const [routeId, route] of Object.entries(db.routeList)) {
      const company = route.co.find((c) => (route.stops[c] ?? []).length) ?? route.co[0];
      if (!company || company === "mtr" || company === "tram") continue;
      const mode = companyMode(company);
      const ids = route.stops[company] ?? [];
      for (const stopId of ids) {
        const stop = db.stopList[stopId];
        if (!stop) continue;
        const key = `${mode}:${stopId}`;
        const existing = seen.get(key);
        const leg = { routeId, company, route: route.route, dest: route.dest };
        if (existing) {
          if (!existing.routes.some((r) => r.routeId === routeId)) existing.routes.push(leg);
          continue;
        }
        seen.set(key, {
          id: key,
          lat: stop.location.lat,
          lng: stop.location.lng,
          name: stop.name,
          mode,
          color: MODE_COLOR[mode],
          kind: mode === "ferry" ? "pier" : "stop",
          routes: [leg],
        });
      }
    }
  }

  const places = [...seen.values()];
  const stations = db ? nearestMtrStations(db, origin, 10000).map(stationPlace) : [];
  let trams = db ? nearestTramStops(db, origin, 10000).map(tramPlace) : [];
  if (trams.length === 0) {
    const byStop = new Map<string, NearbyPlace>();
    for (const stop of tramStops) {
      const existing = byStop.get(stop.id);
      const leg = { routeId: stop.routeId, company: "tram" as Company, route: "Tram", dest: stop.dest };
      if (existing) {
        if (!existing.routes.some((r) => r.routeId === stop.routeId)) existing.routes.push(leg);
        continue;
      }
      byStop.set(stop.id, {
        id: `tram:${stop.id}`,
        lat: stop.lat,
        lng: stop.lng,
        name: stop.name,
        mode: "tram",
        color: MODE_COLOR.tram,
        kind: "tram",
        routes: [leg],
      });
    }
    trams = [...byStop.values()];
  }
  const stands: NearbyPlace[] = taxis.map((stand) => ({
    id: `taxi:${stand.id}`,
    lat: stand.lat,
    lng: stand.lng,
    name: stand.name,
    mode: "taxi",
    color: MODE_COLOR.taxi,
    kind: "taxi",
    taxiColors: taxiColors(stand.kind),
    routes: [],
  }));
  const piers = uniquePiers(
    ferryPiers.filter((pier) => !places.some((place) => place.mode === "ferry" && haversine(place, pier) < 90)),
  );
  const byId = new Map<string, NearbyPlace>();
  for (const place of [...places, ...stations, ...trams, ...stands, ...piers]) {
    if (!byId.has(place.id)) byId.set(place.id, place);
  }
  return [...byId.values()];
}
