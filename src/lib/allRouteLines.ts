/**
 * Develop map-tools: per-visible-station route polylines (detail-page quality).
 *
 * NOT the CSDI FB_ROUTE_LINE all-roads dump — HomeMap must not call /api/csdi-bus-routes.
 * Lazy only: resolve shapes after the map-tools button is pressed.
 * Dedup by shapeFileName; in-memory cache avoids refetch when the same key reappears.
 */

import { routeColor } from "@/lib/colors";
import { haversine, type LatLng } from "@/lib/geo";
import { companyMode } from "@/lib/mode";
import { loadRouteLine } from "@/lib/routeLine";
import { shapeFileName } from "@/lib/shapeFile";
import type { Company, EtaDb, NearbyPlace } from "@/lib/types";

export type StationRouteJob = {
  /** Stable shape key (`shapeFileName` + `.json`). */
  key: string;
  company: Company;
  route: string;
  stops: LatLng[];
  water: boolean;
  track: boolean;
  /** Visible places that share this shape. */
  placeIds: string[];
  /** Distance from origin/user to the closest owning place (metres). */
  anchorDist: number;
};

const lineCache = new Map<string, LatLng[]>();
const inflight = new Map<string, Promise<LatLng[]>>();

/** Furthest → closest (for load / default paint stack). */
export function collectStationRouteJobs(
  places: NearbyPlace[],
  db: EtaDb,
  origin: LatLng,
): StationRouteJob[] {
  const byKey = new Map<string, StationRouteJob>();

  for (const place of places) {
    const dist = haversine(origin, { lat: place.lat, lng: place.lng });
    for (const leg of place.routes) {
      const entry = db.routeList[leg.routeId];
      if (!entry) continue;
      const company = leg.company;
      const stopIds = entry.stops[company] ?? [];
      const stops: LatLng[] = [];
      for (const id of stopIds) {
        const loc = db.stopList[id]?.location;
        if (loc) stops.push({ lat: loc.lat, lng: loc.lng });
      }
      if (stops.length < 2) continue;

      const key = shapeFileName({
        company,
        route: entry.route,
        bound: entry.bound[company],
        serviceType: entry.serviceType,
        gtfsId: entry.gtfsId,
        nlbId: entry.nlbId,
      });
      const water = companyMode(company) === "ferry";
      const track = company === "mtr" || company === "lightRail" || company === "tram";
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.placeIds.includes(place.id)) existing.placeIds.push(place.id);
        existing.anchorDist = Math.min(existing.anchorDist, dist);
        continue;
      }
      byKey.set(key, {
        key,
        company,
        route: entry.route,
        stops,
        water,
        track,
        placeIds: [place.id],
        anchorDist: dist,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.anchorDist - a.anchorDist);
}

/**
 * Resolve polyline for a job (shape file → optional OSRM, same rules as useRouteLine).
 * Ferry / missing track → straight stop sequence. Cached by shape key.
 */
export async function resolveStationRouteLine(job: StationRouteJob): Promise<LatLng[]> {
  const hit = lineCache.get(job.key);
  if (hit) return hit;
  const pending = inflight.get(job.key);
  if (pending) return pending;

  const promise = (async () => {
    let points: LatLng[] | null = null;
    if (!job.water) {
      points = await loadRouteLine(job.key, job.stops, { road: !job.track });
    }
    const resolved = points && points.length >= 2 ? points : job.stops;
    lineCache.set(job.key, resolved);
    return resolved;
  })().finally(() => {
    inflight.delete(job.key);
  });

  inflight.set(job.key, promise);
  return promise;
}

export function stationRouteColor(job: StationRouteJob): string {
  return routeColor(job.company, job.route);
}

/** True if this shape key is already resolved in memory (no network). */
export function hasCachedStationRouteLine(key: string): boolean {
  return lineCache.has(key);
}
