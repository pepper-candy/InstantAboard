"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mtrLineCode, mtrLineColors, mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { nearestStop } from "@/lib/nearest";
import { companyMode, primaryCompany } from "@/lib/mode";
import { bestScore, scoreMtrLine, scoreName, scoreRouteNumber, scoreTerminal } from "@/lib/search";
import { nearestMtrStations, type MtrStation } from "@/lib/stopIndex";
import type { Company, Pin, RouteListEntry } from "@/lib/types";
import { IconSearch, IconTram, MtrLogo } from "./Icons";
import { useApp } from "./Providers";

type RouteHit = { kind: "route"; id: string; route: RouteListEntry; company: Company; score: number };
type StationHit = { kind: "station"; station: MtrStation; score: number };
type Hit = RouteHit | StationHit;

export function AddFlow({
  onOpenRoute,
  requestFocus = false,
}: {
  onOpenRoute?: (pin: Pin) => void;
  requestFocus?: boolean;
}) {
  const { db, settings, origin, devOn } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (requestFocus) inputRef.current?.focus({ preventScroll: true });
    else inputRef.current?.blur();
  }, [requestFocus]);

  const results = useMemo(() => {
    if (!db || q.trim().length < 1) return [];
    const needle = q.trim();
    const hits: Hit[] = [];
    for (const [id, route] of Object.entries(db.routeList)) {
      const company = primaryCompany(route);
      const mode = companyMode(company);
      if (!devOn && (mode === "tram" || mode === "ferry")) continue;
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
    hits.sort(
      (a, b) => mtrRank(a) - mtrRank(b) || a.score - b.score || labelOf(a).localeCompare(labelOf(b)),
    );
    return hits.slice(0, 50);
  }, [db, q, origin, devOn]);

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
    const line = row.lines[0];
    if (!line) return;
    const pin: Pin = {
      id: crypto.randomUUID(),
      routeId: line.routeId,
      company: "mtr",
      stopId: row.stopId,
      stopSeq: line.stopSeq,
      auto: true,
    };
    if (onOpenRoute) onOpenRoute(pin);
    else {
      sessionStorage.setItem("ia.open", JSON.stringify({ kind: "route", pin }));
      router.push("/");
    }
  };

  return (
    <section className="page">
      <form
        className="search-form"
        role="search"
        autoComplete="off"
        action="#"
        method="get"
        data-form-type="search"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="search-bar">
          <IconSearch className="icon-md muted-icon" />
          <input
            ref={inputRef}
            id="ia-route-search"
            name="ia-route-search"
            className="search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t(settings.lang, "Search any route", "搜尋任何路線")}
            aria-label={t(settings.lang, "Route", "路線")}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            inputMode="search"
            data-lpignore="true"
            data-1p-ignore="true"
            data-form-type="other"
          />
        </div>
      </form>

      <div className="stack">
        {groups.stations.map((hit) => (
          <button key={hit.station.stopId} type="button" className="card tap-row" onClick={() => openStation(hit.station)}>
            <span className="card-top tight add-mtr">
              <MtrLogo className="mode-logo" lines={mtrLineColors(hit.station.lines.map((line) => line.route))} />
              <span className="dest">{nameOf(settings.lang, hit.station.name)}</span>
            </span>
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
                  {first.company === "tram" ? (
                    <IconTram className="kind-tram" />
                  ) : (
                    <span className="route-badge sm" style={{ background: color, color: ink }}>
                      {first.route.route}
                    </span>
                  )}
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
    </section>
  );
}

function mtrRank(hit: Hit): number {
  return hit.kind === "station" || hit.company === "mtr" ? 0 : 1;
}

function labelOf(hit: Hit): string {
  if (hit.kind === "station") return hit.station.name.en;
  return hit.route.route;
}
