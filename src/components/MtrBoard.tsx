"use client";

import { useEffect, useMemo, useState } from "react";
import { mtrLineName, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { formatDistance } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { nearestMtrStations, type MtrLine, type MtrStation } from "@/lib/stopIndex";
import type { Arrival } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { MtrLogo } from "./Icons";
import { useApp } from "./Providers";

export function MtrBoard({ tick = 0 }: { tick?: number }) {
  const { db, settings, origin, addPin } = useApp();
  const stations = useMemo(() => nearestMtrStations(db, origin, 5), [db, origin]);
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});

  useEffect(() => {
    if (!db || stations.length === 0) {
      setEtas({});
      return;
    }
    let alive = true;
    const run = async () => {
      const entries = await Promise.all(
        stations.flatMap((station) =>
          station.lines.map(async (line) => {
            const key = etaKey(station, line);
            try {
              const rows = await fetchArrivals(
                db,
                {
                  id: key,
                  routeId: line.routeId,
                  company: "mtr",
                  stopId: station.stopId,
                  stopSeq: line.stopSeq,
                  bothWays: true,
                },
                settings.lang,
              );
              return [key, rows] as const;
            } catch {
              return [key, [] as Arrival[]] as const;
            }
          }),
        ),
      );
      if (!alive) return;
      setEtas(Object.fromEntries(entries));
    };
    void run();
    return () => {
      alive = false;
    };
  }, [db, stations, settings.lang, tick]);

  if (!db) return <Skeleton />;
  if (stations.length === 0) return <p className="muted">{t(settings.lang, "MTR", "港鐵")}</p>;

  return (
    <div className="stack">
      {stations.map((station) => (
        <article key={station.stopId} className="card peek-card">
          <div className="card-top tight">
            <span className="dest">{nameOf(settings.lang, station.name)}</span>
            <span className="stop">{formatDistance(station.d, settings.lang)}</span>
          </div>
          {station.lines.map((line) => {
            const color = routeColor("mtr", line.route);
            return (
              <div key={line.routeId} className="mtr-line">
                <div className="card-meta">
                  <div className="mtr-line-name">
                    <MtrLogo className="mode-logo" line={color} />
                    <span className="mtr-line-label">{mtrLineName(settings.lang, line.route)}</span>
                  </div>
                  <EtaStrip arrivals={etas[etaKey(station, line)]} lang={settings.lang} />
                </div>
                <button
                  type="button"
                  className="pin-mini"
                  aria-label="Pin"
                  onClick={() =>
                    addPin({
                      id: crypto.randomUUID(),
                      routeId: line.routeId,
                      company: "mtr",
                      stopId: station.stopId,
                      stopSeq: line.stopSeq,
                      bothWays: true,
                    })
                  }
                >
                  +
                </button>
              </div>
            );
          })}
        </article>
      ))}
    </div>
  );
}

function etaKey(station: MtrStation, line: MtrLine): string {
  return `${station.stopId}:${line.routeId}`;
}

function Skeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card card-skel" />
      ))}
    </>
  );
}
