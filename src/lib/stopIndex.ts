import { MODE_COLOR, routeColor } from "./colors";
import { HANG_HAU, haversine, type LatLng } from "./geo";
import { companyMode, filterMatches } from "./mode";
import type { BoardFilter, EtaDb, NearbyPlace, TaxiStand } from "./types";

export type TramStop = {
  id: string;
  lat: number;
  lng: number;
  name: { en: string; zh: string };
  routeId: string;
  dest: { en: string; zh: string };
};

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
      if (!company) continue;
      const mode = companyMode(company);
      if (!filterMatches(filter, mode)) continue;
      const ids = route.stops[company] ?? [];
      for (const stopId of ids) {
        const stop = db.stopList[stopId];
        if (!stop) continue;
        const d = haversine(origin, stop.location);
        if (d > 1200) continue;
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
          color: mode === "mtr" ? routeColor(company, route.route) : MODE_COLOR[mode],
          kind: mode === "mtr" ? "station" : mode === "ferry" ? "pier" : mode === "tram" ? "tram" : "stop",
          routes: [leg],
          d,
        };
        seen.set(key, place);
      }
    }
    out.push(...seen.values());
  }

  if (filterMatches(filter, "taxi")) {
    for (const stand of taxis) {
      const d = haversine(origin, stand);
      if (d > 1500) continue;
      out.push({
        id: `taxi:${stand.id}`,
        lat: stand.lat,
        lng: stand.lng,
        name: stand.name,
        mode: "taxi",
        color: MODE_COLOR.taxi,
        kind: "taxi",
        routes: [],
        d,
      });
    }
  }

  const hasTram = db && Object.values(db.routeList).some((r) => r.co.includes("tram"));
  if (filterMatches(filter, "tram") && !hasTram) {
    for (const stop of tramStops) {
      const d = haversine(origin, stop);
      if (d > 1500) continue;
      out.push({
        id: `tram:${stop.id}`,
        lat: stop.lat,
        lng: stop.lng,
        name: stop.name,
        mode: "tram",
        color: MODE_COLOR.tram,
        kind: "tram",
        routes: [
          {
            routeId: stop.routeId,
            company: "tram",
            route: "Tram",
            dest: stop.dest,
          },
        ],
        d,
      });
    }
  }

  out.sort((a, b) => a.d - b.d);
  return out.slice(0, limit);
}

export function defaultOrigin(pos: LatLng | null): LatLng {
  return pos ?? HANG_HAU;
}
