"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ETA_POLL_MS } from "@/hooks/useEtas";
import { useReconnectTick } from "@/hooks/useOffline";
import { mtrLineName, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { formatDistance } from "@/lib/geo";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { mtrStationById, nearbyMtrStations, type MtrLine, type MtrStation } from "@/lib/stopIndex";
import type { Arrival, EtaDb, Lang, Pin, Terminal } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { MtrHoursButton, MtrHoursPanel, useMtrHoursData } from "./MtrHours";
import { IconChevron, IconSwapDir, MtrLogo } from "./Icons";
import { useApp } from "./Providers";
import { scrollSheetCardTop } from "@/lib/sheetScroll";

export function MtrBoard({
  tick = 0,
  expandTick = 0,
  focusedId = null,
  squeeze = false,
  onFocus,
  onOpen,
}: {
  tick?: number;
  expandTick?: number;
  focusedId?: string | null;
  squeeze?: boolean;
  onFocus?: (place: { id: string; lat: number; lng: number } | null) => void;
  onOpen?: (pin: Pin) => void;
}) {
  const { db, settings, origin } = useApp();
  const reconnectTick = useReconnectTick();
  const stations = useMemo(() => nearbyMtrStations(db, origin), [db, origin]);
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});
  const [openId, setOpenId] = useState<string | null>(focusedId);
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;

  const refreshLine = useCallback(
    async (station: MtrStation, line: MtrLine) => {
      if (!db) return;
      const key = etaKey(station, line);
      const rows = await loadLineEta(db, station, line, settings.lang);
      setEtas((prev) => ({ ...prev, [key]: rows }));
    },
    [db, settings.lang],
  );

  useEffect(() => {
    if (!db || stations.length === 0) {
      setEtas({});
      return;
    }
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      void loadStationEtas(db, stations, settings.lang).then((next) => {
        if (alive) setEtas(next);
      });
    };
    poll();
    const timer = window.setInterval(poll, ETA_POLL_MS);
    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [db, stations, settings.lang, tick, reconnectTick]);

  useEffect(() => {
    if (stations.length === 0) {
      setOpenId(null);
      return;
    }
    const ids = new Set(stations.map((station) => `mtr:${station.stopId}`));
    const first = `mtr:${stations[0].stopId}`;
    const focus = focusedRef.current;
    setOpenId((cur) => (cur && ids.has(cur) ? cur : focus && ids.has(focus) ? focus : first));
  }, [stations]);

  useEffect(() => {
    if (focusedId?.startsWith("mtr:")) setOpenId(focusedId);
  }, [focusedId]);

  useEffect(() => {
    if (!expandTick) return;
    const first = stations[0];
    if (!first) return;
    setOpenId(`mtr:${first.stopId}`);
  }, [expandTick, stations]);

  useEffect(() => {
    if (!focusedId?.startsWith("mtr:") || squeeze) return;
    const card = document.querySelector(`[data-place-id="${CSS.escape(focusedId)}"]`);
    if (card instanceof HTMLElement) scrollSheetCardTop(card);
  }, [focusedId, squeeze]);

  if (!db) return <Skeleton />;
  if (stations.length === 0) return <p className="muted">{t(settings.lang, "MTR", "港鐵")}</p>;

  const firstId = stations[0] ? `mtr:${stations[0].stopId}` : null;
  const mtrFocus = focusedId?.startsWith("mtr:") ? focusedId : null;
  const mtrOpen = openId?.startsWith("mtr:") ? openId : null;
  // Map pin can focus a station; otherwise keep/open the nearest list card (no map select).
  const shownId = mtrFocus ?? mtrOpen ?? firstId;

  return (
    <div className="stack">
      {stations.map((station) => (
        <MtrStationCard
          key={station.stopId}
          station={station}
          open={shownId === `mtr:${station.stopId}`}
          etas={etas}
          lang={settings.lang}
          onRefreshLine={refreshLine}
          onToggle={() => {
            if (squeeze) return;
            const id = `mtr:${station.stopId}`;
            const next = shownId !== id;
            setOpenId(next ? id : null);
            onFocus?.(next ? { id, lat: station.lat, lng: station.lng } : null);
          }}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

export function MtrPeekStation({ placeId, tick = 0, onOpen }: { placeId: string; tick?: number; onOpen?: (pin: Pin) => void }) {
  const { db, settings, origin } = useApp();
  const reconnectTick = useReconnectTick();
  const station = useMemo(() => mtrStationById(db, origin, placeId), [db, origin, placeId]);
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});

  const refreshLine = useCallback(
    async (target: MtrStation, line: MtrLine) => {
      if (!db) return;
      const key = etaKey(target, line);
      const rows = await loadLineEta(db, target, line, settings.lang);
      setEtas((prev) => ({ ...prev, [key]: rows }));
    },
    [db, settings.lang],
  );

  useEffect(() => {
    if (!db || !station) {
      setEtas({});
      return;
    }
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      void loadStationEtas(db, [station], settings.lang).then((next) => {
        if (alive) setEtas(next);
      });
    };
    poll();
    const timer = window.setInterval(poll, ETA_POLL_MS);
    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [db, station, settings.lang, tick, reconnectTick]);

  if (!db) return <Skeleton />;
  if (!station) return null;
  return (
    <MtrStationCard
      station={station}
      placeId={placeId}
      open
      locked
      showDrop={false}
      etas={etas}
      lang={settings.lang}
      onRefreshLine={refreshLine}
      onToggle={() => {}}
      onOpen={onOpen}
    />
  );
}

function MtrStationCard({
  station,
  placeId,
  open,
  etas,
  lang,
  onToggle,
  onOpen,
  onRefreshLine,
  locked = false,
  showDrop = true,
  hoursStartOpen = false,
}: {
  station: MtrStation;
  placeId?: string;
  open: boolean;
  etas: Record<string, Arrival[]>;
  lang: Lang;
  onToggle: () => void;
  onOpen?: (pin: Pin) => void;
  onRefreshLine?: (station: MtrStation, line: MtrLine) => void;
  locked?: boolean;
  showDrop?: boolean;
  hoursStartOpen?: boolean;
}) {
  const [hoursOpen, setHoursOpen] = useState(hoursStartOpen);
  const lineRoutes = useMemo(() => station.lines.map((row) => row.route), [station.lines]);
  const hours = useMtrHoursData(undefined, lineRoutes, station.stopId);

  return (
    <article
      className={`card peek-card mtr-station${open ? " is-on" : ""}${showDrop ? "" : " is-map"}`}
      data-place-id={placeId ?? `mtr:${station.stopId.replace(/^mtr:/i, "")}`}
      aria-expanded={open}
      onClick={locked ? undefined : onToggle}
    >
      <div className="card-top tight mtr-station-head">
        {showDrop ? (
          <span className="mtr-drop" aria-hidden="true">
            <IconChevron className="icon-md" />
          </span>
        ) : (
          <span className="mtr-drop is-spacer" aria-hidden="true" />
        )}
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
              onRefresh={onRefreshLine ? () => onRefreshLine(station, line) : undefined}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

function sameStationName(a: Terminal, b: Terminal): boolean {
  const en = a.en.trim().toLowerCase();
  const zh = a.zh.trim();
  return (!!zh && zh === b.zh.trim()) || (!!en && en === b.en.trim().toLowerCase());
}

/** Bounds that still carry passengers onward — not “to this station” at a terminus. */
function awayDirs(line: MtrLine, station: MtrStation): MtrLine["dirs"] {
  const dirs: MtrLine["dirs"] = {};
  if (line.dirs.UP && !sameStationName(line.dirs.UP.dest, station.name)) dirs.UP = line.dirs.UP;
  if (line.dirs.DOWN && !sameStationName(line.dirs.DOWN.dest, station.name)) dirs.DOWN = line.dirs.DOWN;
  return dirs.UP || dirs.DOWN ? dirs : line.dirs;
}

function lineHomeDir(line: MtrLine, dirs: MtrLine["dirs"]): "UP" | "DOWN" {
  if (dirs.UP?.routeId === line.routeId) return "UP";
  if (dirs.DOWN?.routeId === line.routeId) return "DOWN";
  return dirs.UP ? "UP" : "DOWN";
}

function etaEndsHere(row: Arrival, station: MtrStation): boolean {
  const code = (row.destCode ?? "").replace(/^mtr:/i, "").toUpperCase();
  const here = station.stopId.replace(/^mtr:/i, "").toUpperCase();
  if (code && code === here) return true;
  return Boolean(row.dest && sameStationName(row.dest, station.name));
}

function MtrLineRow({
  station,
  line,
  arrivals,
  lang,
  onOpen,
  onRefresh,
}: {
  station: MtrStation;
  line: MtrLine;
  arrivals: Arrival[] | undefined;
  lang: "en" | "zh";
  onOpen?: (pin: Pin) => void;
  onRefresh?: () => void;
}) {
  const color = routeColor("mtr", line.route);
  const dirs = awayDirs(line, station);
  const canFlip = Boolean(dirs.UP && dirs.DOWN);
  const [dir, setDir] = useState<"UP" | "DOWN">(() => lineHomeDir(line, dirs));
  const active = dirs[dir] ?? dirs.UP ?? dirs.DOWN;
  const dest = active?.dest ?? line.dest;
  const shown = (arrivals ?? []).filter((row) => !etaEndsHere(row, station));

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
      <EtaStrip arrivals={shown} lang={lang} company="mtr" onRefresh={onRefresh} />
    </div>
  );
}

function etaKey(station: MtrStation, line: MtrLine): string {
  return `${station.stopId}:${line.routeId}`;
}

async function loadLineEta(db: EtaDb, station: MtrStation, line: MtrLine, lang: Lang): Promise<Arrival[]> {
  const key = etaKey(station, line);
  try {
    return await fetchArrivals(
      db,
      {
        id: key,
        routeId: line.routeId,
        company: "mtr",
        stopId: station.stopId,
        stopSeq: line.stopSeq,
        bothWays: true,
      },
      lang,
    );
  } catch {
    return [];
  }
}

async function loadStationEtas(db: EtaDb, stations: MtrStation[], lang: Lang): Promise<Record<string, Arrival[]>> {
  const entries = await Promise.all(
    stations.flatMap((station) =>
      station.lines.map(async (line) => [etaKey(station, line), await loadLineEta(db, station, line, lang)] as const),
    ),
  );
  return Object.fromEntries(entries);
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
