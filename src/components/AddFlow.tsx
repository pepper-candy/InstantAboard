"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onRouteColor, routeColor } from "@/lib/colors";
import { HANG_HAU, haversine } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { primaryCompany } from "@/lib/mode";
import type { Company, RouteListEntry } from "@/lib/types";
import { useGeo } from "@/hooks/useGeo";
import { IconSearch } from "./Icons";
import { useApp } from "./Providers";

type Hit = { id: string; route: RouteListEntry; company: Company };

export function AddFlow() {
  const { db, settings, addPin, pins } = useApp();
  const router = useRouter();
  const { pos } = useGeo(true);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Hit | null>(null);
  const origin = pos ?? HANG_HAU;

  const results = useMemo(() => {
    if (!db || q.trim().length < 1) return [];
    const needle = q.trim().toUpperCase();
    const hits: Hit[] = [];
    for (const [id, route] of Object.entries(db.routeList)) {
      if (!route.route.toUpperCase().startsWith(needle) && !route.route.toUpperCase().includes(needle)) {
        continue;
      }
      const company = primaryCompany(route);
      hits.push({ id, route, company });
      if (hits.length >= 40) break;
    }
    hits.sort((a, b) => {
      const as = a.route.route.toUpperCase().startsWith(needle) ? 0 : 1;
      const bs = b.route.route.toUpperCase().startsWith(needle) ? 0 : 1;
      if (as !== bs) return as - bs;
      return a.route.route.localeCompare(b.route.route);
    });
    return hits;
  }, [db, q]);

  const groups = useMemo(() => {
    const map = new Map<string, Hit[]>();
    for (const hit of results) {
      const key = `${hit.route.route}|${hit.company}`;
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [results]);

  const stops = useMemo(() => {
    if (!db || !picked) return [];
    const ids = picked.route.stops[picked.company] ?? [];
    return ids.map((id, seq) => {
      const stop = db.stopList[id];
      const d = stop ? haversine(origin, stop.location) : Number.POSITIVE_INFINITY;
      return { id, seq, stop, d };
    }).sort((a, b) => a.d - b.d);
  }, [db, picked, origin]);

  const pinStop = (stopId: string, stopSeq: number) => {
    if (!picked) return;
    addPin({
      id: crypto.randomUUID(),
      routeId: picked.id,
      company: picked.company,
      stopId,
      stopSeq,
    });
    router.push("/");
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
            setPicked(null);
          }}
          placeholder={t(settings.lang, "91M / TKL / 11M", "91M / 將軍澳綫 / 11M")}
          aria-label={t(settings.lang, "Route", "路線")}
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
        />
      </div>

      {!picked ? (
        <div className="stack">
          {groups.map(([key, list]) => {
            const first = list[0];
            const color = routeColor(first.company, first.route.route);
            const ink = onRouteColor(first.company, first.route.route);
            return (
              <div key={key} className="dir-group">
                <div className="dir-head">
                  <span className="route-badge sm" style={{ background: color, color: ink }}>
                    {first.route.route}
                  </span>
                </div>
                {list.map((hit) => (
                  <button key={hit.id} type="button" className="card tap-row" onClick={() => setPicked(hit)}>
                    <span className="dest">{nameOf(settings.lang, hit.route.dest)}</span>
                    <span className="stop">{nameOf(settings.lang, hit.route.orig)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="stack">
          <button type="button" className="back-inline" onClick={() => setPicked(null)} aria-label="Back">
            ←
          </button>
          <div className="card-top tight">
            <span
              className="route-badge"
              style={{
                background: routeColor(picked.company, picked.route.route),
                color: onRouteColor(picked.company, picked.route.route),
              }}
            >
              {picked.route.route}
            </span>
            <div className="dest">{nameOf(settings.lang, picked.route.dest)}</div>
          </div>
          {stops.map((row) => {
            const already = pins.some((p) => p.routeId === picked.id && p.stopId === row.id);
            return (
              <button
                key={`${row.id}-${row.seq}`}
                type="button"
                className={`card tap-row ${already ? "is-pinned" : ""}`}
                onClick={() => pinStop(row.id, row.seq)}
              >
                <span className="dest">{nameOf(settings.lang, row.stop?.name)}</span>
                <span className="stop">{Number.isFinite(row.d) ? `${Math.round(row.d)}m` : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
