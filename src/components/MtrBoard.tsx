"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReconnectTick } from "@/hooks/useOffline";
import { mtrLineName, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { formatDistance } from "@/lib/geo";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { nearbyMtrStations, type MtrLine, type MtrStation } from "@/lib/stopIndex";
import type { Arrival, Pin } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { MtrHoursButton, MtrHoursPanel, useMtrHoursData } from "./MtrHours";
import { IconChevron, IconSwapDir, MtrLogo } from "./Icons";
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
  const reconnectTick = useReconnectTick();
  const stations = useMemo(() => nearbyMtrStations(db, origin), [db, origin]);
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const lastFocus = useRef(focusedId);

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
  }, [db, stations, settings.lang, tick, reconnectTick]);

  useEffect(() => {
    if (stations.length === 0) {
      setOpenId(null);
      return;
    }
    const ids = new Set(stations.map((station) => `mtr:${station.stopId}`));
    const first = `mtr:${stations[0].stopId}`;
    setOpenId((cur) => (cur && ids.has(cur) ? cur : first));
  }, [stations]);

  useEffect(() => {
    if (focusedId && focusedId !== lastFocus.current) setOpenId(focusedId);
    lastFocus.current = focusedId;
  }, [focusedId]);

  if (!db) return <Skeleton />;
  if (stations.length === 0) return <p className="muted">{t(settings.lang, "MTR", "港鐵")}</p>;

  return (
    <div className="stack">
      {stations.map((station) => (
        <MtrStationCard
          key={station.stopId}
          station={station}
          open={openId === `mtr:${station.stopId}`}
          etas={etas}
          lang={settings.lang}
          onToggle={() => {
            const id = `mtr:${station.stopId}`;
            const next = openId !== id;
            setOpenId(next ? id : null);
            if (next) onFocus?.({ id, lat: station.lat, lng: station.lng });
          }}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function MtrStationCard({
  station,
  open,
  etas,
  lang,
  onToggle,
  onOpen,
}: {
  station: MtrStation;
  open: boolean;
  etas: Record<string, Arrival[]>;
  lang: "en" | "zh";
  onToggle: () => void;
  onOpen?: (pin: Pin) => void;
}) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const lineRoutes = useMemo(() => station.lines.map((row) => row.route), [station.lines]);
  const hours = useMtrHoursData(undefined, lineRoutes, station.stopId);

  return (
    <article
      className={`card peek-card mtr-station${open ? " is-on" : ""}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <div className="card-top tight mtr-station-head">
        <span className="mtr-drop" aria-hidden="true">
          <IconChevron className="icon-md" />
        </span>
        <span className="mtr-station-title">
          <span className="dest">{nameOf(lang, station.name)}</span>
          <MtrHoursButton
            lang={lang}
            open={hoursOpen}
            onToggle={() => {
              const next = !hoursOpen;
              setHoursOpen(next);
              if (next && !open) onToggle();
            }}
          />
        </span>
        <span className="stop">{formatDistance(station.d, lang)}</span>
      </div>
      <div className="mtr-station-lines">
        <div className="mtr-station-lines-inner">
          <div className={`mtr-hours-fold${hoursOpen ? " is-open" : ""}`}>
            <div className="mtr-hours-fold-inner">
              <MtrHoursPanel lang={lang} data={hours} />
            </div>
          </div>
          {station.lines.map((line) => (
            <MtrLineRow
              key={line.routeId}
              station={station}
              line={line}
              arrivals={etas[etaKey(station, line)]}
              lang={lang}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function lineHomeDir(line: MtrLine): "UP" | "DOWN" {
  if (line.dirs.UP?.routeId === line.routeId) return "UP";
  if (line.dirs.DOWN?.routeId === line.routeId) return "DOWN";
  return line.dirs.UP ? "UP" : "DOWN";
}

function MtrLineRow({
  station,
  line,
  arrivals,
  lang,
  onOpen,
}: {
  station: MtrStation;
  line: MtrLine;
  arrivals: Arrival[] | undefined;
  lang: "en" | "zh";
  onOpen?: (pin: Pin) => void;
}) {
  const color = routeColor("mtr", line.route);
  const canFlip = Boolean(line.dirs.UP && line.dirs.DOWN);
  const [dir, setDir] = useState<"UP" | "DOWN">(lineHomeDir(line));
  const active = line.dirs[dir] ?? line.dirs.UP ?? line.dirs.DOWN;
  const dest = active?.dest ?? line.dest;

  return (
    <div
      className="mtr-line"
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.({
          id: crypto.randomUUID(),
          routeId: active?.routeId ?? line.routeId,
          company: "mtr",
          stopId: station.stopId,
          stopSeq: active?.stopSeq ?? line.stopSeq,
          auto: true,
        });
      }}
    >
      <div className="card-top">
        <MtrLogo className="mode-logo" lines={[color]} />
        <div className="card-meta">
          <div className="dest">{towardLabel(lang, dest)}</div>
          <div className="stop">{`${nameOf(lang, station.name)} (${mtrLineName(lang, line.route)})`}</div>
        </div>
        {canFlip ? (
          <button
            type="button"
            className="dir-swap"
            aria-label={lang === "zh" ? "轉換方向" : "Switch direction"}
            onClick={(event) => {
              event.stopPropagation();
              setDir((cur) => (cur === "UP" ? "DOWN" : "UP"));
            }}
          >
            <IconSwapDir className="icon-md" />
          </button>
        ) : null}
      </div>
      <EtaStrip arrivals={arrivals} lang={lang} company="mtr" />
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
