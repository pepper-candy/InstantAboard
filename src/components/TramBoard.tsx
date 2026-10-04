"use client";

import { useEffect, useMemo, useState } from "react";
import { MODE_COLOR } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { formatDistance } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { nearestTramStops, type TramLine, type TramStation } from "@/lib/stopIndex";
import type { Arrival, Terminal } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { useApp } from "./Providers";

export function TramBoard({ tick = 0 }: { tick?: number }) {
  const { db, settings, origin, addPin } = useApp();
  const stations = useMemo(() => nearestTramStops(db, origin, 5), [db, origin]);
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
                  company: "tram",
                  stopId: station.stopId,
                  stopSeq: line.stopSeq,
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
  if (stations.length === 0) return <p className="muted">{t(settings.lang, "Tram", "電車")}</p>;

  return (
    <div className="stack">
      {stations.map((station) => (
        <article key={station.stopId} className="card peek-card">
          <div className="card-top tight">
            <span className="dest">{nameOf(settings.lang, station.name)}</span>
            <span className="stop">{formatDistance(station.d, settings.lang)}</span>
          </div>
          {station.lines.map((line) => (
            <div key={line.routeId} className="mtr-line">
              <div className="card-meta">
                <div className="mtr-line-name">
                  <span className="mtr-dot" style={{ background: MODE_COLOR.tram }} aria-hidden="true" />
                  <span className="mtr-line-label">{tramDestLabel(settings.lang, line.dest)}</span>
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
                    company: "tram",
                    stopId: station.stopId,
                    stopSeq: line.stopSeq,
                  })
                }
              >
                +
              </button>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

function etaKey(station: TramStation, line: TramLine): string {
  return `${station.stopId}:${line.routeId}`;
}

function tramDestLabel(lang: "en" | "zh", dest: Terminal): string {
  return nameOf(lang, dest);
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
