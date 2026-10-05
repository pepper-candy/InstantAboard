"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onRouteColor, routeColor } from "@/lib/colors";
import { haversine } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { nearestStop } from "@/lib/nearest";
import { mtrServiceKey } from "@/lib/stopIndex";
import { primaryCompany } from "@/lib/mode";
import type { Company, RouteListEntry } from "@/lib/types";
import { IconLocate, IconSearch, MtrLogo } from "./Icons";
import { useApp } from "./Providers";

type Hit = { id: string; route: RouteListEntry; company: Company };

export function AddFlow({ onDone }: { onDone?: () => void }) {
  const { db, settings, addPin, pins, origin } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Hit | null>(null);
  const [siblings, setSiblings] = useState<Hit[]>([]);

  const results = useMemo(() => {
    if (!db || q.trim().length < 1) return [];
    const needle = q.trim().toUpperCase();
    const hits: Hit[] = [];
    for (const [id, route] of Object.entries(db.routeList)) {
      const routeHit = route.route.toUpperCase().includes(needle);
      const nameHit =
        route.orig.en.toUpperCase().includes(needle) ||
        route.dest.en.toUpperCase().includes(needle) ||
        route.orig.zh.includes(q.trim()) ||
        route.dest.zh.includes(q.trim());
      if (!routeHit && !nameHit) continue;
      const company = primaryCompany(route);
      hits.push({ id, route, company });
      if (hits.length >= 50) break;
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
      const key = hit.company === "mtr" ? mtrServiceKey(hit.route) : `${hit.route.route}|${hit.company}|${hit.id}`;
      const list = map.get(key) ?? [];
      list.push(hit);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [results]);

  const mtrStations = useMemo(() => {
    if (!db || !picked || picked.company !== "mtr") return [];
    const seen = new Map<string, { id: string; seq: number; d: number }>();
    const pool = siblings.length ? siblings : [picked];
    for (const hit of pool) {
      const ids = hit.route.stops.mtr ?? [];
      ids.forEach((id, seq) => {
        const stop = db.stopList[id];
        if (!stop || seen.has(id)) return;
        seen.set(id, { id, seq, d: haversine(origin, stop.location) });
      });
    }
    return [...seen.values()].sort((a, b) => a.d - b.d);
  }, [db, picked, siblings, origin]);

  const stops = useMemo(() => {
    if (!db || !picked || picked.company === "mtr") return [];
    const ids = picked.route.stops[picked.company] ?? [];
    return ids
      .map((id, seq) => {
        const stop = db.stopList[id];
        const d = stop ? haversine(origin, stop.location) : Number.POSITIVE_INFINITY;
        return { id, seq, stop, d };
      })
      .sort((a, b) => a.d - b.d);
  }, [db, picked, origin]);

  const nearest = useMemo(() => {
    if (!db || !picked) return null;
    if (picked.company === "mtr") {
      const first = mtrStations[0];
      return first ? { stopId: first.id, stopSeq: first.seq } : null;
    }
    return nearestStop(db, picked.route, picked.company, origin);
  }, [db, picked, origin, mtrStations]);

  const pinIt = (stopId: string, stopSeq: number, auto: boolean, bothWays = false, routeId = picked?.id) => {
    if (!picked || !routeId) return;
    addPin({
      id: crypto.randomUUID(),
      routeId,
      company: picked.company,
      stopId,
      stopSeq,
      auto,
      bothWays: bothWays || picked.company === "mtr",
    });
    if (onDone) onDone();
    else router.push("/");
  };

  const routeForStop = (stopId: string) => {
    const pool = siblings.length ? siblings : picked ? [picked] : [];
    return pool.find((h) => (h.route.stops[h.company] ?? []).includes(stopId))?.id ?? picked?.id;
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
            setSiblings([]);
          }}
          placeholder={t(settings.lang, "Search any route", "搜尋任何路線")}
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
            if (first.company === "mtr") {
              return (
                <button
                  key={key}
                  type="button"
                  className="card tap-row"
                  onClick={() => {
                    setPicked(first);
                    setSiblings(list);
                  }}
                >
                  <span className="card-top tight add-mtr">
                    <MtrLogo className="mode-logo" line={color} />
                    <span className="route-badge sm" style={{ background: color, color: ink }}>
                      {first.route.route}
                    </span>
                  </span>
                  <span className="dest">
                    {nameOf(settings.lang, first.route.orig)} · {nameOf(settings.lang, first.route.dest)}
                  </span>
                </button>
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
                  <button
                    key={hit.id}
                    type="button"
                    className="card tap-row"
                    onClick={() => {
                      setPicked(hit);
                      setSiblings([]);
                    }}
                  >
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
            {picked.company === "mtr" ? (
              <MtrLogo className="mode-logo" line={routeColor(picked.company, picked.route.route)} />
            ) : null}
            <span
              className="route-badge"
              style={{
                background: routeColor(picked.company, picked.route.route),
                color: onRouteColor(picked.company, picked.route.route),
              }}
            >
              {picked.route.route}
            </span>
            <div className="dest">
              {picked.company === "mtr"
                ? `${nameOf(settings.lang, picked.route.orig)} · ${nameOf(settings.lang, picked.route.dest)}`
                : nameOf(settings.lang, picked.route.dest)}
            </div>
          </div>
          <button
            type="button"
            className="card tap-row is-on-stop"
            onClick={() => {
              if (!nearest) return;
              pinIt(nearest.stopId, nearest.stopSeq, true, picked.company === "mtr", routeForStop(nearest.stopId));
            }}
          >
            <span className="dest">
              <IconLocate className="icon-loc" /> {t(settings.lang, "Auto", "自動")}
            </span>
            <span className="stop">
              {nearest
                ? nameOf(settings.lang, db?.stopList[nearest.stopId]?.name)
                : ""}
            </span>
          </button>
          {(picked.company === "mtr" ? mtrStations : stops).map((row) => {
            const id = row.id;
            const seq = row.seq;
            const already = pins.some((p) => p.routeId === (routeForStop(id) ?? "") && p.stopId === id && !p.auto);
            const stop = db?.stopList[id];
            const d = row.d;
            return (
              <button
                key={`${id}-${seq}`}
                type="button"
                className={`card tap-row ${already ? "is-pinned" : ""}`}
                onClick={() => pinIt(id, seq, false, picked.company === "mtr", routeForStop(id))}
              >
                <span className="dest">{nameOf(settings.lang, stop?.name)}</span>
                <span className="stop">{Number.isFinite(d) ? `${Math.round(d)}m` : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
