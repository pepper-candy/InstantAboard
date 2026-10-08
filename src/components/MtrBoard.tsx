"use client";

import { useEffect, useMemo, useState } from "react";
import { mtrLineColors, mtrLineName, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { formatDistance } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { nearbyMtrStations, type MtrLine, type MtrStation } from "@/lib/stopIndex";
import type { Arrival, Pin } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { MtrHours } from "./MtrHours";
import { MtrLogo } from "./Icons";
import { useApp } from "./Providers";

export function MtrBoard({
  tick = 0,
  focusedId = null,
  onFocus,
  onOpen,
}: {
  tick?: number;
  focusedId?: string | null;
  onFocus?: (place: { id: string; lat: number; lng: number }) => void;
  onOpen?: (pin: Pin) => void;
}) {
  const { db, settings, origin } = useApp();
  const stations = useMemo(() => nearbyMtrStations(db, origin), [db, origin]);
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
        <article
          key={station.stopId}
          className={`card peek-card${focusedId === `mtr:${station.stopId}` ? " is-on" : ""}`}
          onClick={() => onFocus?.({ id: `mtr:${station.stopId}`, lat: station.lat, lng: station.lng })}
        >
          <div className="card-top tight">
            <MtrLogo className="mode-logo" lines={mtrLineColors(station.lines.map((line) => line.route))} />
            <span className="dest">{nameOf(settings.lang, station.name)}</span>
            <span className="stop">{formatDistance(station.d, settings.lang)}</span>
            <MtrHours lines={station.lines.map((line) => line.route)} stopId={station.stopId} lang={settings.lang} />
          </div>
          {station.lines.map((line) => {
            const color = routeColor("mtr", line.route);
            return (
              <div
                key={line.routeId}
                className="mtr-line"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen?.({
                    id: crypto.randomUUID(),
                    routeId: line.routeId,
                    company: "mtr",
                    stopId: station.stopId,
                    stopSeq: line.stopSeq,
                    auto: true,
                  });
                }}
              >
                <div className="card-meta">
                  <div className="mtr-line-name">
                    <span className="mtr-dot" style={{ background: color }} aria-hidden="true" />
                    <span className="mtr-line-label">{mtrLineName(settings.lang, line.route)}</span>
                  </div>
                  <EtaStrip arrivals={etas[etaKey(station, line)]} lang={settings.lang} company="mtr" />
                </div>
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
