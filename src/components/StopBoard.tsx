"use client";

import { onRouteColor, routeColor } from "@/lib/colors";
import { formatDistance, haversine, type LatLng } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import type { NearbyPlace } from "@/lib/types";
import { useApp } from "./Providers";

export function StopBoard({
  places,
  origin,
  onOpen,
}: {
  places: NearbyPlace[];
  origin: LatLng;
  onOpen: (place: NearbyPlace) => void;
}) {
  const { settings } = useApp();
  const stops = places.filter((place) => place.kind === "stop");

  return (
    <div className="stack">
      {stops.length === 0 ? (
        <p className="muted">{t(settings.lang, "Nearby stops", "附近車站")}</p>
      ) : (
        stops.map((stop) => (
          <button key={stop.id} type="button" data-stop={stop.id} className="card taxi-card stop-card" onClick={() => onOpen(stop)}>
            <div className="card-meta">
              <div className="stop-card-head">
                <div className="dest">{nameOf(settings.lang, stop.name)}</div>
                <div className="taxi-d">{formatDistance(haversine(origin, stop), settings.lang)}</div>
              </div>
              <div className="stop-card-break" aria-hidden="true" />
              <div className="stop stop-routes">
                {uniqueRoutes(stop.routes).map((leg) => (
                  <span
                    key={`${leg.company}:${leg.routeId}`}
                    className="route-badge sm"
                    style={{ background: routeColor(leg.company, leg.route), color: onRouteColor(leg.company, leg.route) }}
                  >
                    {leg.route}
                  </span>
                ))}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}

function uniqueRoutes(routes: NearbyPlace["routes"]): NearbyPlace["routes"] {
  const seen = new Set<string>();
  const out: NearbyPlace["routes"] = [];
  for (const leg of routes) {
    const key = `${leg.company}:${leg.route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(leg);
  }
  return out.sort((a, b) => a.route.localeCompare(b.route, undefined, { numeric: true }));
}
