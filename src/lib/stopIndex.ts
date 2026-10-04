import { MODE_COLOR, routeColor } from "./colors";
import { HANG_HAU, haversine, type LatLng } from "./geo";
import { companyMode, filterMatches } from "./mode";
import type { BoardFilter, Company, EtaDb, NearbyPlace, RouteListEntry, TaxiStand, Terminal } from "./types";

const STOP_RADIUS = 1200;
const MTR_RADIUS = 3000;
const TRAM_RADIUS = 3000;
const TAXI_RADIUS = 1800;
const TAXI_CAP = 10;

export type MtrLine = {
  routeId: string;
  route: string;
  company: "mtr";
  orig: Terminal;
  dest: Terminal;
  stopSeq: number;
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

/** Opposite bounds of one service (TKL main vs the LOHAS branch) share a key. */
export function mtrServiceKey(route: RouteListEntry): string {
  const a = route.orig.en;
  const b = route.dest.en;
  return a < b ? `${route.route}|${a}|${b}` : `${route.route}|${b}|${a}`;
}

export function nearestMtrStations(db: EtaDb | null, origin: LatLng, limit = 5): MtrStation[] {
  if (!db) return [];
  const byStop = new Map<string, MtrStation>();
  const seen = new Map<string, Set<string>>();
  for (const [routeId, route] of Object.entries(db.routeList)) {
    if (!route.co.includes("mtr")) continue;
    const ids = route.stops.mtr ?? [];
    const service = mtrServiceKey(route);
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
          color: routeColor("mtr", route.route),
          lines: [],
        };
        byStop.set(stopId, row);
      }
      const services = seen.get(stopId) ?? new Set<string>();
      if (services.has(service)) return;
      services.add(service);
      seen.set(stopId, services);
      row.lines.push({
        routeId,
        route: route.route,
        company: "mtr",
        orig: route.orig,
        dest: route.dest,
        stopSeq: seq,
      });
    });
  }
  return [...byStop.values()].sort((a, b) => a.d - b.d).slice(0, limit);
}

function mapStations(db: EtaDb, origin: LatLng, filter: BoardFilter): MtrStation[] {
  if (filter !== "all" && filter !== "mtr") return [];
  const limit = filter === "mtr" ? 5 : 3;
  const nearest = nearestMtrStations(db, origin, Math.max(limit, 8));
  if (filter === "mtr") return nearest.slice(0, 5);
  const within = nearest.filter((s) => s.d <= MTR_RADIUS);
  if (within.length >= 2) return within.slice(0, 3);
  return nearest.slice(0, 3);
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
    routes: station.lines.map((line) => ({
      routeId: line.routeId,
      company: "mtr" as Company,
      route: line.route,
      dest: {
        en: `${line.orig.en} · ${line.dest.en}`,
        zh: `${line.orig.zh} · ${line.dest.zh}`,
      },
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

export type TramLine = {
  routeId: string;
  route: string;
  company: "tram";
  orig: Terminal;
  dest: Terminal;
  stopSeq: number;
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

/** Opposite bounds of one tram service share a key. */
export function tramServiceKey(route: RouteListEntry): string {
  const a = route.orig.en;
  const b = route.dest.en;
  return a < b ? `${route.route}|${a}|${b}` : `${route.route}|${b}|${a}`;
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
      row.lines.push({
        routeId,
        route: route.route,
        company: "tram",
        orig: route.orig,
        dest: route.dest,
        stopSeq: seq,
      });
    });
  }
  return [...byStop.values()].sort((a, b) => a.d - b.d).slice(0, limit);
}

function mapTramStops(db: EtaDb, origin: LatLng, filter: BoardFilter): TramStation[] {
  if (filter !== "all" && filter !== "tram") return [];
  const limit = filter === "tram" ? 5 : 3;
  const nearest = nearestTramStops(db, origin, Math.max(limit, 8));
  if (filter === "tram") return nearest.slice(0, 5);
  const within = nearest.filter((s) => s.d <= TRAM_RADIUS);
  if (within.length >= 2) return within.slice(0, 3);
  return nearest.slice(0, 3);
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

export function nearbyPlaces(
  db: EtaDb | null,
  origin: LatLng,
  filter: BoardFilter,
  taxis: TaxiStand[],
  tramStops: TramStop[],
  limit = 48,
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
    const nearest = [...byStop.values()].sort((a, b) => a.d - b.d);
    const picked =
      filter === "tram"
        ? nearest.slice(0, 5)
        : nearest.filter((s) => s.d <= TRAM_RADIUS).slice(0, 3).length >= 2
          ? nearest.filter((s) => s.d <= TRAM_RADIUS).slice(0, 3)
          : nearest.slice(0, 3);
    out.push(...picked);
  }

  out.sort((a, b) => a.d - b.d);
  const places = out.slice(0, limit);
  const stations = db ? mapStations(db, origin, filter).map(stationPlace) : [];
  const trams = db ? mapTramStops(db, origin, filter).map(tramPlace) : [];
  const stands: NearbyPlace[] = [];
  if (filter === "all") {
    const near = taxis
      .map((stand) => ({ stand, d: haversine(origin, stand) }))
      .filter((row) => row.d <= TAXI_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, TAXI_CAP);
    for (const { stand } of near) {
      stands.push({
        id: `taxi:${stand.id}`,
        lat: stand.lat,
        lng: stand.lng,
        name: stand.name,
        mode: "taxi",
        color: MODE_COLOR.taxi,
        kind: "taxi",
        routes: [],
      });
    }
  }
  return [...places, ...stations, ...trams, ...stands];
}

export function defaultOrigin(pos: LatLng | null): LatLng {
  return pos ?? HANG_HAU;
}
