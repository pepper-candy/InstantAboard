"use client";

import { useEffect, useMemo, useState } from "react";
import { onRouteColor, routeColor } from "@/lib/colors";
import { formatDistance, haversine } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { fetchArrivals, scheduledArrivals } from "@/lib/eta";
import type { Arrival, NearbyPlace, Pin } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { useApp } from "./Providers";

export function FerryBoard({
  places,
  focusedId,
  onFocus,
  onOpen,
}: {
  places: NearbyPlace[];
  focusedId: string | null;
  onFocus: (place: { id: string; lat: number; lng: number }) => void;
  onOpen: (pin: Pin) => void;
}) {
  const { db, settings, origin, addPin } = useApp();
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});

  const piers = useMemo(
    () =>
      places
        .filter((place) => place.mode === "ferry")
        .map((place) => ({ ...place, d: haversine(origin, place) }))
        .sort((a, b) => a.d - b.d),
    [places, origin],
  );

  const pierKey = piers.map((pier) => `${pier.id}:${pier.routes.map((leg) => leg.routeId).join(",")}`).join("|");

  useEffect(() => {
    if (!focusedId) return;
    document.querySelector(`[data-pier="${CSS.escape(focusedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusedId, pierKey]);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    const run = async () => {
      const next: Record<string, Arrival[]> = {};
      for (const pier of piers) {
        const stopId = stopIdOf(pier);
        for (const leg of pier.routes) {
          const key = `${pier.id}:${leg.routeId}`;
          const pin: Pin = { id: key, routeId: leg.routeId, company: leg.company, stopId, stopSeq: stopSeqOf(db, leg.routeId, leg.company, stopId) };
          try {
            next[key] = await fetchArrivals(db, pin, settings.lang);
          } catch {
            const route = db.routeList[leg.routeId];
            next[key] = route ? scheduledArrivals(db, route) : [];
          }
        }
      }
      if (alive) setEtas(next);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [db, pierKey, settings.lang, piers]);

  return (
    <div className="stack">
      {piers.length === 0 ? (
        <p className="muted">{t(settings.lang, "Piers", "碼頭")}</p>
      ) : (
        piers.map((pier) => {
          const legs = pier.routes.length
            ? pier.routes
            : (pier.dests ?? []).map((dest) => ({
                routeId: "",
                company: "sunferry" as const,
                route: "",
                dest,
              }));
          return legs.map((leg) => {
            const key = leg.routeId ? `${pier.id}:${leg.routeId}` : `${pier.id}:${leg.dest.en}`;
            const stopId = stopIdOf(pier);
            const color = routeColor(leg.company, leg.route || "ferry");
            const ink = onRouteColor(leg.company, leg.route || "ferry");
            const on = focusedId === pier.id;
            return (
              <article key={key} className={`card ferry-card${on ? " is-on" : ""}`} data-pier={pier.id}>
                <div className="card-link">
                  <button
                    type="button"
                    className="card-top"
                    onClick={() => {
                      onFocus(pier);
                      if (!leg.routeId || !db) return;
                      onOpen({
                        id: key,
                        routeId: leg.routeId,
                        company: leg.company,
                        stopId,
                        stopSeq: stopSeqOf(db, leg.routeId, leg.company, stopId),
                        auto: false,
                      });
                    }}
                  >
                    <span className="route-badge" style={{ background: color, color: ink }}>
                      {leg.route || nameOf(settings.lang, pier.name)}
                    </span>
                    <div className="card-meta">
                      <div className="dest">{nameOf(settings.lang, leg.dest)}</div>
                      <div className="stop">{nameOf(settings.lang, pier.name)}</div>
                    </div>
                    <span className="taxi-d">{formatDistance(pier.d, settings.lang)}</span>
                  </button>
                  <div className="card-eta">
                    <EtaStrip arrivals={etas[key]} lang={settings.lang} />
                    {leg.routeId ? (
                      <button
                        type="button"
                        className="pin-mini"
                        aria-label="Pin"
                        onClick={(e) => {
                          e.stopPropagation();
                          addPin({
                            id: crypto.randomUUID(),
                            routeId: leg.routeId,
                            company: leg.company,
                            stopId,
                            stopSeq: stopSeqOf(db, leg.routeId, leg.company, stopId),
                            auto: true,
                          });
                        }}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          });
        })
      )}
    </div>
  );
}

function stopIdOf(place: NearbyPlace): string {
  return place.id.startsWith("ferry:") ? place.id.slice("ferry:".length) : place.id;
}

function stopSeqOf(
  db: { routeList: Record<string, { stops: Partial<Record<string, string[]>> }> } | null,
  routeId: string,
  company: string,
  stopId: string,
): number {
  const ids = db?.routeList[routeId]?.stops[company] ?? [];
  const seq = ids.indexOf(stopId);
  return seq >= 0 ? seq : 0;
}
