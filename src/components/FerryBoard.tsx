"use client";

import { useEffect, useMemo, useState } from "react";
import { onRouteColor, routeColor } from "@/lib/colors";
import { formatDistance, haversine } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { fetchArrivals, scheduledArrivals } from "@/lib/eta";
import { companyMode } from "@/lib/mode";
import type { Arrival, Company, EtaDb, NearbyPlace, Pin, Terminal } from "@/lib/types";
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

  const cards = useMemo(() => piers.flatMap((pier) => routesAt(db, pier)), [db, piers]);
  const pierKey = cards.map((card) => card.key).join("|");

  useEffect(() => {
    if (!focusedId) return;
    document.querySelector(`[data-pier="${CSS.escape(focusedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focusedId, pierKey]);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    const run = async () => {
      const next: Record<string, Arrival[]> = {};
      for (const card of cards) {
        if (!card.routeId) continue;
        const pin: Pin = {
          id: card.key,
          routeId: card.routeId,
          company: card.company,
          stopId: card.stopId,
          stopSeq: card.stopSeq,
        };
        try {
          next[card.key] = await fetchArrivals(db, pin, settings.lang);
        } catch {
          const route = db.routeList[card.routeId];
          next[card.key] = route ? scheduledArrivals(db, route) : [];
        }
      }
      if (alive) setEtas(next);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [db, pierKey, settings.lang, cards]);

  return (
    <div className="stack">
      {piers.length === 0 ? (
        <p className="muted">{t(settings.lang, "Piers", "碼頭")}</p>
      ) : (
        cards.map((card) => {
            const badge = badgeOf(settings.lang, card);
            const color = routeColor(card.company, card.route || "ferry");
            const ink = onRouteColor(card.company, card.route || "ferry");
            const on = focusedId === card.pierId;
            return (
              <article key={card.key} className={`card ferry-card${on ? " is-on" : ""}`} data-pier={card.pierId}>
                <div className="card-link">
                  <button
                    type="button"
                    className="card-top"
                    onClick={() => {
                      onFocus({ id: card.pierId, lat: card.lat, lng: card.lng });
                      if (!card.routeId) return;
                      onOpen({
                        id: card.key,
                        routeId: card.routeId,
                        company: card.company,
                        stopId: card.stopId,
                        stopSeq: card.stopSeq,
                        auto: false,
                      });
                    }}
                  >
                    <span className={`route-badge${badge.long ? " is-long" : ""}`} style={{ background: color, color: ink }}>
                      {badge.text}
                    </span>
                    <div className="card-meta">
                      <div className="dest">{nameOf(settings.lang, card.dest)}</div>
                      <div className="stop">{nameOf(settings.lang, card.pierName)}</div>
                    </div>
                    <span className="taxi-d">{formatDistance(card.d, settings.lang)}</span>
                  </button>
                  <div className="card-eta">
                    <EtaStrip arrivals={etas[card.key]} lang={settings.lang} />
                    {card.routeId ? (
                      <button
                        type="button"
                        className="pin-mini"
                        aria-label="Pin"
                        onClick={(e) => {
                          e.stopPropagation();
                          addPin({
                            id: crypto.randomUUID(),
                            routeId: card.routeId,
                            company: card.company,
                            stopId: card.stopId,
                            stopSeq: card.stopSeq,
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
          })
      )}
    </div>
  );
}

type FerryCard = {
  key: string;
  pierId: string;
  lat: number;
  lng: number;
  d: number;
  route: string;
  routeId: string;
  company: Company;
  dest: Terminal;
  pierName: Terminal;
  stopId: string;
  stopSeq: number;
};

function routesAt(db: EtaDb | null, pier: NearbyPlace & { d: number }): FerryCard[] {
  const matched: FerryCard[] = [];
  if (db) {
    for (const [routeId, route] of Object.entries(db.routeList)) {
      const company = route.co.find((item) => companyMode(item) === "ferry");
      if (!company) continue;
      const ids = route.stops[company] ?? [];
      const seq = ids.findIndex((id) => {
        const stop = db.stopList[id];
        if (!stop) return false;
        return haversine(stop.location, pier) < 180 || samePlace(stop.name, pier.name);
      });
      if (seq < 0) continue;
      matched.push({
        key: `${pier.id}:${routeId}`,
        pierId: pier.id,
        lat: pier.lat,
        lng: pier.lng,
        d: pier.d,
        route: route.route,
        routeId,
        company,
        dest: route.dest,
        pierName: pier.name,
        stopId: ids[seq] ?? "",
        stopSeq: seq,
      });
    }
  }
  if (matched.length) return matched.slice(0, 6);
  if (pier.routes.length) {
    const stopId = pier.id.startsWith("ferry:") ? pier.id.slice("ferry:".length) : pier.id;
    return pier.routes.map((leg) => ({
      key: `${pier.id}:${leg.routeId}`,
      pierId: pier.id,
      lat: pier.lat,
      lng: pier.lng,
      d: pier.d,
      route: leg.route,
      routeId: leg.routeId,
      company: leg.company,
      dest: leg.dest,
      pierName: pier.name,
      stopId,
      stopSeq: stopSeqOf(db, leg.routeId, leg.company, stopId),
    }));
  }
  return (pier.dests ?? []).slice(0, 3).map((dest) => ({
    key: `${pier.id}:${dest.en}`,
    pierId: pier.id,
    lat: pier.lat,
    lng: pier.lng,
    d: pier.d,
    route: "",
    routeId: "",
    company: "sunferry",
    dest,
    pierName: pier.name,
    stopId: "",
    stopSeq: 0,
  }));
}

function badgeOf(lang: "en" | "zh", card: FerryCard): { text: string; long: boolean } {
  const text = card.route || shortDest(lang, card.dest);
  return { text, long: text.length > 5 };
}

function shortDest(lang: "en" | "zh", dest: Terminal): string {
  const name = nameOf(lang, dest);
  const head = name.split(/[/／(（,，]/)[0]?.trim() || name;
  return head || "—";
}

function samePlace(a: Terminal, b: Terminal): boolean {
  const en = a.en.trim().toLowerCase();
  const zh = a.zh.trim();
  return (!!en && en === b.en.trim().toLowerCase()) || (!!zh && zh === b.zh.trim());
}

function stopSeqOf(db: EtaDb | null, routeId: string, company: Company, stopId: string): number {
  const ids = db?.routeList[routeId]?.stops[company] ?? [];
  const seq = ids.indexOf(stopId);
  return seq >= 0 ? seq : 0;
}
