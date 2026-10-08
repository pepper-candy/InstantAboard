"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { mtrLineCode, mtrLineColors, mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
import { haversine } from "@/lib/geo";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { nearestStop } from "@/lib/nearest";
import { primaryCompany } from "@/lib/mode";
import { bestScore, scoreMtrLine, scoreName, scoreRouteNumber, scoreTerminal } from "@/lib/search";
import { nearestMtrStations, type MtrStation } from "@/lib/stopIndex";
import type { Company, NearbyPlace, Pin, RouteListEntry } from "@/lib/types";
import { IconSearch, MtrLogo } from "./Icons";
import { useApp } from "./Providers";

type RouteHit = { kind: "route"; id: string; route: RouteListEntry; company: Company; score: number };
type StationHit = { kind: "station"; station: MtrStation; score: number };
type Hit = RouteHit | StationHit;

export function AddFlow({
  onOpenRoute,
  onOpenStation,
}: {
  onOpenRoute?: (pin: Pin) => void;
  onOpenStation?: (place: NearbyPlace) => void;
}) {
  const { db, settings, origin } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [station, setStation] = useState<MtrStation | null>(null);

  const results = useMemo(() => {
    if (!db || q.trim().length < 1) return [];
    const needle = q.trim();
    const hits: Hit[] = [];
    for (const [id, route] of Object.entries(db.routeList)) {
      const company = primaryCompany(route);
      const score = bestScore([
        scoreRouteNumber(route.route, needle),
        company === "mtr" ? scoreMtrLine(route.route, needle) : null,
        scoreTerminal(route.orig, needle),
        scoreTerminal(route.dest, needle),
      ]);
      if (score == null) continue;
      hits.push({ kind: "route", id, route, company, score });
    }
    for (const row of nearestMtrStations(db, origin, 10000)) {
      const score = bestScore([
        scoreTerminal(row.name, needle),
        scoreName(row.stopId, needle),
        ...row.lines.map((line) => scoreMtrLine(line.route, needle)),
      ]);
      if (score == null) continue;
      hits.push({ kind: "station", station: row, score });
    }
    hits.sort((a, b) => a.score - b.score || labelOf(a).localeCompare(labelOf(b)));
    return hits.slice(0, 50);
  }, [db, q, origin]);

  const groups = useMemo(() => {
    const map = new Map<string, RouteHit[]>();
    const stations: StationHit[] = [];
    for (const hit of results) {
      if (hit.kind === "station") {
        stations.push(hit);
        continue;
      }
      const key =
        hit.company === "mtr"
          ? `mtr:${mtrLineCode(hit.route.route)}`
          : `${hit.route.route}|${hit.company}`;
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
    }
    return { stations, routes: [...map.entries()] };
  }, [results]);

  const openRoute = (hit: RouteHit) => {
    if (!db) return;
    const near = nearestStop(db, hit.route, hit.company, origin);
    const pin: Pin = {
      id: crypto.randomUUID(),
      routeId: hit.id,
      company: hit.company,
      stopId: near?.stopId ?? "",
      stopSeq: near?.stopSeq ?? 0,
      auto: true,
    };
    if (onOpenRoute) onOpenRoute(pin);
    else {
      sessionStorage.setItem("ia.open", JSON.stringify({ kind: "route", pin }));
      router.push("/");
    }
  };

  const openStation = (row: MtrStation) => {
    const place: NearbyPlace = {
      id: `mtr:${row.stopId}`,
      lat: row.lat,
      lng: row.lng,
      name: row.name,
      mode: "mtr",
      color: row.color,
      kind: "station",
      lineColors: mtrLineColors(row.lines.map((line) => line.route)),
      routes: row.lines.map((line) => ({
        routeId: line.routeId,
        company: "mtr",
        route: line.route,
        dest: line.dest,
      })),
    };
    if (onOpenStation) onOpenStation(place);
    else setStation(row);
  };

  return (
    <section className="page">
      <div className="search-bar">
        <IconSearch className="icon-md muted-icon" />
        <input
          className="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setStation(null);
          }}
          placeholder={t(settings.lang, "Search any route", "搜尋任何路線")}
          aria-label={t(settings.lang, "Route", "路線")}
          autoFocus
          autoCorrect="off"
        />
      </div>

      {station ? (
        <div className="stack">
          <button type="button" className="back-inline" onClick={() => setStation(null)} aria-label="Back">
            ←
          </button>
          <div className="card-top tight">
            <MtrLogo className="mode-logo" lines={mtrLineColors(station.lines.map((line) => line.route))} />
            <span className="dest">{nameOf(settings.lang, station.name)}</span>
          </div>
          {station.lines.map((line) => {
            const hit: RouteHit = {
              kind: "route",
              id: line.routeId,
              route: db?.routeList[line.routeId] ?? {
                route: line.route,
                co: ["mtr"],
                orig: line.orig,
                dest: line.dest,
                fares: null,
                faresHoliday: null,
                freq: null,
                jt: null,
                seq: 0,
                serviceType: "1",
                stops: { mtr: [] },
                bound: {},
                gtfsId: "",
                nlbId: "",
              },
              company: "mtr",
              score: 0,
            };
            const color = routeColor("mtr", line.route);
            return (
              <button key={line.routeId} type="button" className="card tap-row" onClick={() => openRoute(hit)}>
                <span className="mtr-line-name">
                  <span className="mtr-dot" style={{ background: color }} aria-hidden="true" />
                  <span className="mtr-line-label">{mtrLineName(settings.lang, line.route)}</span>
                </span>
                <span className="stop">{towardLabel(settings.lang, line.dest)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="stack">
          {groups.stations.map((hit) => (
            <button key={hit.station.stopId} type="button" className="card tap-row" onClick={() => openStation(hit.station)}>
              <span className="card-top tight add-mtr">
                <MtrLogo className="mode-logo" lines={mtrLineColors(hit.station.lines.map((line) => line.route))} />
                <span className="dest">{nameOf(settings.lang, hit.station.name)}</span>
              </span>
              <span className="stop">{t(settings.lang, "MTR station", "港鐵站")}</span>
            </button>
          ))}
          {groups.routes.map(([key, list]) => {
            const first = list[0];
            const color = routeColor(first.company, first.route.route);
            const ink = onRouteColor(first.company, first.route.route);
            if (first.company === "mtr") {
              return (
                <div key={key} className="dir-group">
                  <div className="dir-head">
                    <span className="mtr-line-name">
                      <span className="mtr-dot" style={{ background: color }} aria-hidden="true" />
                      <span className="mtr-line-label">{mtrLineName(settings.lang, first.route.route)}</span>
                    </span>
                  </div>
                  {list.map((hit) => (
                    <button key={hit.id} type="button" className="card tap-row" onClick={() => openRoute(hit)}>
                      <span className="dest">{towardLabel(settings.lang, hit.route.dest)}</span>
                      <span className="stop">{nameOf(settings.lang, hit.route.orig)}</span>
                    </button>
                  ))}
                </div>
              );
            }
            return (
              <div key={key} className="dir-group">
                <div className="dir-head">
                  <span className="route-badge sm" style={{ background: color, color: ink }}>
                    {first.route.route}
                  </span>
                </div>
                {list.map((hit) => (
                  <button key={hit.id} type="button" className="card tap-row" onClick={() => openRoute(hit)}>
                    <span className="dest">{towardLabel(settings.lang, hit.route.dest)}</span>
                    <span className="stop">{nameOf(settings.lang, hit.route.orig)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function labelOf(hit: Hit): string {
  if (hit.kind === "station") return hit.station.name.en;
  return hit.route.route;
}
