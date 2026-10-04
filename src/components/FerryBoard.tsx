"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistance, haversine } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { fetchArrivals, scheduledArrivals } from "@/lib/eta";
import { loadFerryPiers, type FerryPier } from "@/lib/extras";
import type { Arrival, NearbyPlace, Pin } from "@/lib/types";
import { companyMode } from "@/lib/mode";
import { IconFerry } from "./Icons";
import { useApp } from "./Providers";

type Leg = {
  key: string;
  dest: { en: string; zh: string };
  minutes: Array<number | null>;
  live: boolean;
};

export function FerryBoard({
  places,
  focusedId,
  onFocus,
}: {
  places: NearbyPlace[];
  focusedId: string | null;
  onFocus: (place: { id: string; lat: number; lng: number }) => void;
}) {
  const { db, settings, origin, addPin } = useApp();
  const [piers, setPiers] = useState<FerryPier[]>([]);
  const [legs, setLegs] = useState<Record<string, Leg[]>>({});

  useEffect(() => {
    void loadFerryPiers().then(setPiers);
  }, []);

  const nearby = useMemo(() => {
    const fromDb = db
      ? Object.entries(db.routeList)
          .filter(([, r]) => r.co.some((c) => companyMode(c) === "ferry"))
          .flatMap(([routeId, route]) => {
            const company = route.co.find((c) => companyMode(c) === "ferry") ?? route.co[0];
            const stopId = (route.stops[company] ?? [])[0];
            const stop = stopId ? db.stopList[stopId] : undefined;
            if (!stop) return [];
            return [
              {
                id: `db:${stopId}:${routeId}`,
                lat: stop.location.lat,
                lng: stop.location.lng,
                name: stop.name,
                dests: [route.dest],
                routeId,
                company,
                stopId,
              },
            ];
          })
      : [];
    const extra = piers.map((p) => ({
      id: `td:${p.id}`,
      lat: p.lat,
      lng: p.lng,
      name: p.name,
      dests: p.dests,
      routeId: "",
      company: "sunferry" as const,
      stopId: p.id,
    }));
    const merged = [...fromDb, ...extra]
      .map((p) => ({ ...p, d: haversine(origin, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 16);
    return merged;
  }, [db, piers, origin]);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    const run = async () => {
      const next: Record<string, Leg[]> = {};
      for (const pier of nearby) {
        const matches = Object.entries(db.routeList).filter(([id, route]) => {
          if (!route.co.some((c) => companyMode(c) === "ferry")) return false;
          const company = route.co.find((c) => companyMode(c) === "ferry") ?? route.co[0];
          const ids = route.stops[company] ?? [];
          const first = ids[0] ? db.stopList[ids[0]] : undefined;
          if (pier.routeId && pier.routeId === id) return true;
          return first && haversine(first.location, pier) < 180;
        });
        const rows: Leg[] = [];
        for (const [routeId, route] of matches.slice(0, 4)) {
          const company = route.co.find((c) => companyMode(c) === "ferry") ?? route.co[0];
          const stopId = (route.stops[company] ?? [])[0] ?? "";
          const pin: Pin = { id: routeId, routeId, company, stopId, stopSeq: 0 };
          let arrivals: Arrival[] = [];
          try {
            arrivals = await fetchArrivals(db, pin, settings.lang);
          } catch {
            arrivals = scheduledArrivals(db, route);
          }
          rows.push({
            key: routeId,
            dest: route.dest,
            minutes: [0, 1, 2].map((i) => arrivals[i]?.minutes ?? null),
            live: arrivals.some((a) => !a.estimated),
          });
        }
        if (!rows.length) {
          const seen = new Set<string>();
          for (const dest of pier.dests) {
            const label = `${nameOf("en", dest)}|${nameOf("zh", dest)}`;
            if (seen.has(label)) continue;
            seen.add(label);
            rows.push({ key: dest.en, dest, minutes: [null, null, null], live: false });
            if (rows.length >= 3) break;
          }
        }
        next[pier.id] = rows;
      }
      if (alive) setLegs(next);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [db, nearby, settings.lang]);

  return (
    <div className="stack">
      {nearby.length === 0 ? (
        <p className="muted">{t(settings.lang, "Piers", "碼頭")}</p>
      ) : (
        nearby.map((pier) => {
          const mapPlace = matchPier(places, pier);
          const on = focusedId === mapPlace.id;
          return (
            <article
              key={pier.id}
              className={`card ferry-card${on ? " is-on" : ""}`}
              onClick={() => onFocus(mapPlace)}
            >
              <div className="card-top tight">
                <IconFerry className="icon-md" />
                <div className="card-meta">
                  <div className="dest">{nameOf(settings.lang, pier.name)}</div>
                  <div className="stop">{formatDistance(pier.d, settings.lang)}</div>
                </div>
              </div>
              <div className="pier-legs">
                {(legs[pier.id] ?? []).map((leg) => (
                  <div key={leg.key} className="pier-leg">
                    <span className="dest">{nameOf(settings.lang, leg.dest)}</span>
                    <span className="dir-mins">
                      {leg.minutes.map((m, i) => (
                        <span key={i} className="eta-num sm">
                          {m == null ? "—" : m <= 0 ? (settings.lang === "zh" ? "到" : "Due") : m}
                        </span>
                      ))}
                    </span>
                    {pier.routeId ? (
                      <button
                        type="button"
                        className="pin-mini"
                        aria-label="Pin"
                        onClick={(e) => {
                          e.stopPropagation();
                          addPin({
                            id: crypto.randomUUID(),
                            routeId: pier.routeId,
                            company: pier.company,
                            stopId: pier.stopId,
                            stopSeq: 0,
                            auto: true,
                          });
                        }}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

function matchPier(places: NearbyPlace[], pier: { lat: number; lng: number }) {
  const hit = places.find((place) => place.mode === "ferry" && haversine(place, pier) < 90);
  return {
    id: hit?.id ?? `ferry:${pier.lat},${pier.lng}`,
    lat: hit?.lat ?? pier.lat,
    lng: hit?.lng ?? pier.lng,
  };
}
