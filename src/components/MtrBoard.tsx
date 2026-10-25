"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ETA_POLL_MS } from "@/hooks/useEtas";
import { useReconnectTick } from "@/hooks/useOffline";
import { mtrLineName, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { formatDistance } from "@/lib/geo";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import {
  arrivalIsRacecourse,
  isRacecourseDest,
  mtrDestKey,
} from "@/lib/mtrBranches";
import { filterMtrTitleVariants, mtrTitleDests } from "@/lib/mtrTitle";
import {
  lrtStationById,
  mtrStationById,
  nearbyLrtStops,
  nearbyMtrStations,
  type LrtStation,
  type MtrStation,
} from "@/lib/stopIndex";
import type { Arrival, EtaDb, Lang, Pin, Terminal } from "@/lib/types";
import { EtaStrip, TowardDests } from "./EtaStrip";
import { MtrHoursButton, MtrHoursPanel, useMtrHoursData } from "./MtrHours";
import { IconChevron, IconSwapDir, LrtLogo, MtrLogo } from "./Icons";
import { useApp } from "./Providers";
import { scrollSheetCardTop } from "@/lib/sheetScroll";

type RailDirRef = { routeId: string; stopSeq: number; dest: Terminal };

type RailLine = {
  routeId: string;
  route: string;
  company: "mtr" | "lightRail";
  orig: Terminal;
  dest: Terminal;
  stopSeq: number;
  dirs: { UP?: RailDirRef; DOWN?: RailDirRef };
  variants: { UP: RailDirRef[]; DOWN: RailDirRef[] };
};

type RailStation = {
  placeId: string;
  stopId: string;
  name: Terminal;
  lat: number;
  lng: number;
  d: number;
  color: string;
  kind: "station" | "lrt";
  lines: RailLine[];
};

function fromMtr(station: MtrStation): RailStation {
  return {
    placeId: `mtr:${station.stopId}`,
    stopId: station.stopId,
    name: station.name,
    lat: station.lat,
    lng: station.lng,
    d: station.d,
    color: station.color,
    kind: "station",
    lines: station.lines.map((line) => ({
      routeId: line.routeId,
      route: line.route,
      company: "mtr" as const,
      orig: line.orig,
      dest: line.dest,
      stopSeq: line.stopSeq,
      dirs: line.dirs,
      variants: line.variants,
    })),
  };
}

function fromLrt(station: LrtStation): RailStation {
  return {
    placeId: `lrt:${station.stopId}`,
    stopId: station.stopId,
    name: station.name,
    lat: station.lat,
    lng: station.lng,
    d: station.d,
    color: station.color,
    kind: "lrt",
    lines: station.lines.map((line) => ({
      routeId: line.routeId,
      route: line.route,
      company: "lightRail" as const,
      orig: line.orig,
      dest: line.dest,
      stopSeq: line.stopSeq,
      dirs: line.dirs,
      variants: {
        UP: line.dirs.UP ? [line.dirs.UP] : [],
        DOWN: line.dirs.DOWN ? [line.dirs.DOWN] : [],
      },
    })),
  };
}

function isRailFocusId(id: string | null | undefined): id is string {
  return Boolean(id && (id.startsWith("mtr:") || id.startsWith("lrt:")));
}

export function MtrBoard({
  tick = 0,
  expandTick = 0,
  focusedId = null,
  squeeze = false,
  /** Off MTR tab: keep nearest station selected+expanded so sheet mid can measure real height. */
  warmFirst = false,
  onFocus,
  onOpen,
}: {
  tick?: number;
  expandTick?: number;
  focusedId?: string | null;
  squeeze?: boolean;
  warmFirst?: boolean;
  onFocus?: (place: { id: string; lat: number; lng: number } | null) => void;
  onOpen?: (pin: Pin) => void;
}) {
  const { db, settings, origin } = useApp();
  const reconnectTick = useReconnectTick();
  const stations = useMemo(() => {
    const heavy = nearbyMtrStations(db, origin).map(fromMtr);
    const light = nearbyLrtStops(db, origin).map(fromLrt);
    return [...heavy, ...light].sort((a, b) => a.d - b.d);
  }, [db, origin]);
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});
  // chosenId = selected station (always one when list non-empty); expanded = purple body open.
  // Split so collapsing never clears selection / jumps via firstId fallback.
  const [chosenId, setChosenId] = useState<string | null>(focusedId);
  const [expanded, setExpanded] = useState(true);
  const focusedRef = useRef(focusedId);
  focusedRef.current = focusedId;

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
      setChosenId(null);
      return;
    }
    const ids = new Set(stations.map((station) => station.placeId));
    const first = stations[0].placeId;
    const focus = focusedRef.current;
    setChosenId((cur) => (cur && ids.has(cur) ? cur : focus && ids.has(focus) ? focus : first));
  }, [stations]);

  useEffect(() => {
    if (!isRailFocusId(focusedId)) return;
    setChosenId(focusedId);
    setExpanded(true);
  }, [focusedId]);

  useEffect(() => {
    if (!expandTick) return;
    const first = stations[0];
    if (!first) return;
    setChosenId(first.placeId);
    setExpanded(true);
  }, [expandTick, stations]);

  // Any non-MTR tab (or peek overlay): pin first card open so mid measure is ready before snap.
  useEffect(() => {
    if (!warmFirst) return;
    const first = stations[0];
    if (!first) return;
    setChosenId(first.placeId);
    setExpanded(true);
  }, [warmFirst, stations]);

  useEffect(() => {
    if (!isRailFocusId(focusedId) || squeeze) return;
    const card = document.querySelector(`[data-place-id="${CSS.escape(focusedId)}"]`);
    if (!(card instanceof HTMLElement)) return;
    // Expand/height first (CSS ~280ms), then scroll so mid measure is correct.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reduce ? 0 : 300;
    const timer = window.setTimeout(() => scrollSheetCardTop(card), delay);
    return () => window.clearTimeout(timer);
  }, [focusedId, squeeze]);

  if (!db) return <Skeleton />;
  if (stations.length === 0) return <p className="muted">{t(settings.lang, "MTR", "港鐵")}</p>;

  const firstId = stations[0]?.placeId ?? null;
  const railFocus = !warmFirst && isRailFocusId(focusedId) ? focusedId : null;
  // Always exactly one selected station; never fall back in a way that re-opens first on collapse.
  const selectedId = railFocus ?? (isRailFocusId(chosenId) ? chosenId : null) ?? firstId;

  return (
    <div className="stack">
      {stations.map((station) => (
        <MtrStationCard
          key={station.placeId}
          db={db}
          station={station}
          open={selectedId === station.placeId && expanded}
          etas={etas}
          lang={settings.lang}
          onHeaderToggle={() => {
            if (squeeze) return;
            const id = station.placeId;
            if (selectedId === id) {
              // Collapse: keep selection, do NOT onFocus — Board softLift/scroll used to
              // force is-on on the DOM and undo the close (looks open, state says closed).
              if (expanded) {
                setExpanded(false);
                return;
              }
              setExpanded(true);
              onFocus?.({ id, lat: station.lat, lng: station.lng });
              return;
            }
            setChosenId(id);
            setExpanded(true);
            onFocus?.({ id, lat: station.lat, lng: station.lng });
          }}
          onEnsureExpanded={() => {
            if (squeeze) return;
            const id = station.placeId;
            setChosenId(id);
            setExpanded(true);
            onFocus?.({ id, lat: station.lat, lng: station.lng });
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
  const station = useMemo((): RailStation | null => {
    if (placeId.startsWith("lrt:")) {
      const row = lrtStationById(db, origin, placeId);
      return row ? fromLrt(row) : null;
    }
    const row = mtrStationById(db, origin, placeId);
    return row ? fromMtr(row) : null;
  }, [db, origin, placeId]);
  const [etas, setEtas] = useState<Record<string, Arrival[]>>({});

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
      db={db}
      station={station}
      placeId={placeId}
      open
      locked
      showDrop={false}
      etas={etas}
      lang={settings.lang}
      onHeaderToggle={() => {}}
      onEnsureExpanded={() => {}}
      onOpen={onOpen}
    />
  );
}

function MtrStationCard({
  db,
  station,
  placeId,
  open,
  etas,
  lang,
  onHeaderToggle,
  onEnsureExpanded,
  onOpen,
  locked = false,
  showDrop = true,
  hoursStartOpen = false,
}: {
  db: EtaDb;
  station: RailStation;
  placeId?: string;
  open: boolean;
  etas: Record<string, Arrival[]>;
  lang: Lang;
  onHeaderToggle: () => void;
  onEnsureExpanded: () => void;
  onOpen?: (pin: Pin) => void;
  locked?: boolean;
  showDrop?: boolean;
  hoursStartOpen?: boolean;
}) {
  const [hoursOpen, setHoursOpen] = useState(hoursStartOpen);
  const showHours = station.kind === "station" || station.kind === "lrt";
  const lineRoutes = useMemo(
    () => (showHours ? station.lines.map((row) => row.route) : []),
    [station.lines, showHours],
  );
  const hours = useMtrHoursData(undefined, lineRoutes, station.stopId);

  return (
    <article
      className={`card peek-card mtr-station${open ? " is-on" : ""}${showDrop ? "" : " is-map"}`}
      data-place-id={placeId ?? station.placeId}
      aria-expanded={open}
    >
      <div
        className="card-top tight mtr-station-head"
        role={locked ? undefined : "button"}
        tabIndex={locked ? undefined : 0}
        onClick={locked ? undefined : onHeaderToggle}
        onKeyDown={
          locked
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onHeaderToggle();
                }
              }
        }
      >
        {showDrop ? (
          <span className="mtr-drop" aria-hidden="true">
            <IconChevron className="icon-md" />
          </span>
        ) : (
          <span className="mtr-drop is-spacer" aria-hidden="true" />
        )}
        <span className="mtr-station-title">
          <span className="dest">{nameOf(lang, station.name)}</span>
          {showHours ? (
            <MtrHoursButton
              lang={lang}
              open={hoursOpen}
              onToggle={() => {
                const next = !hoursOpen;
                setHoursOpen(next);
                // ⓘ never collapses; only expands body when opening hours on a collapsed card.
                if (next && !open) onEnsureExpanded();
              }}
            />
          ) : null}
        </span>
        <span className="stop">{formatDistance(station.d, lang)}</span>
      </div>
      <div className="mtr-station-lines">
        <div className="mtr-station-lines-inner">
          {showHours ? (
            <div className={`mtr-hours-fold${hoursOpen ? " is-open" : ""}`}>
              <div className="mtr-hours-fold-inner">
                <MtrHoursPanel lang={lang} data={hours} />
              </div>
            </div>
          ) : null}
          {station.lines.map((line) => (
            <MtrLineRow
              key={line.route}
              db={db}
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

function sameStationName(a: Terminal, b: Terminal): boolean {
  const en = a.en.trim().toLowerCase();
  const zh = a.zh.trim();
  return (!!zh && zh === b.zh.trim()) || (!!en && en === b.en.trim().toLowerCase());
}

function awayDirRefs(refs: RailDirRef[], station: RailStation): RailDirRef[] {
  const away = refs.filter((ref) => !sameStationName(ref.dest, station.name));
  return away.length ? away : refs;
}

/** Bounds that still carry passengers onward — not “to this station” at a terminus. */
function awayDirs(line: RailLine, station: RailStation): RailLine["dirs"] {
  const dirs: RailLine["dirs"] = {};
  if (line.dirs.UP && !sameStationName(line.dirs.UP.dest, station.name)) dirs.UP = line.dirs.UP;
  if (line.dirs.DOWN && !sameStationName(line.dirs.DOWN.dest, station.name)) dirs.DOWN = line.dirs.DOWN;
  return dirs.UP || dirs.DOWN ? dirs : line.dirs;
}

function lineHomeDir(line: RailLine, dirs: RailLine["dirs"]): "UP" | "DOWN" {
  if (dirs.UP?.routeId === line.routeId) return "UP";
  if (dirs.DOWN?.routeId === line.routeId) return "DOWN";
  return dirs.UP ? "UP" : "DOWN";
}

function etaEndsHere(row: Arrival, station: RailStation): boolean {
  const code = (row.destCode ?? "").replace(/^mtr:/i, "").toUpperCase();
  const here = station.stopId.replace(/^mtr:/i, "").toUpperCase();
  if (code && code === here) return true;
  return Boolean(row.dest && sameStationName(row.dest, station.name));
}

function liveHasRacecourse(arrivals: Arrival[] | undefined): boolean {
  return (arrivals ?? []).some(arrivalIsRacecourse);
}

function boardVariantsForDir(
  line: RailLine,
  dir: "UP" | "DOWN",
  station: RailStation,
  arrivals: Arrival[] | undefined,
): RailDirRef[] {
  const refs = awayDirRefs(line.variants[dir] ?? [], station);
  const raceLive = liveHasRacecourse(arrivals);
  const filtered = refs.filter((ref) => {
    if (isRacecourseDest(ref.dest)) return raceLive;
    return true;
  });
  return line.company === "mtr" ? filterMtrTitleVariants(line.route, filtered) : filtered;
}

function MtrLineRow({
  db,
  station,
  line,
  arrivals,
  lang,
  onOpen,
}: {
  db: EtaDb;
  station: RailStation;
  line: RailLine;
  arrivals: Arrival[] | undefined;
  lang: "en" | "zh";
  onOpen?: (pin: Pin) => void;
}) {
  const color = routeColor(line.company, line.route);
  const dirs = awayDirs(line, station);
  const canFlip = Boolean(dirs.UP && dirs.DOWN);
  const [dir, setDir] = useState<"UP" | "DOWN">(() => lineHomeDir(line, dirs));
  const branchOpts = useMemo(
    () => (line.company === "mtr" ? boardVariantsForDir(line, dir, station, arrivals) : []),
    [line, dir, station, arrivals],
  );
  const [branchRouteId, setBranchRouteId] = useState<string | null>(null);

  useEffect(() => {
    setBranchRouteId((cur) => {
      if (cur && branchOpts.some((ref) => ref.routeId === cur)) return cur;
      const home = dirs[dir];
      if (home && branchOpts.some((ref) => ref.routeId === home.routeId)) return home.routeId;
      return branchOpts[0]?.routeId ?? home?.routeId ?? line.routeId;
    });
  }, [branchOpts, dir, dirs, line.routeId]);

  const active =
    branchOpts.find((ref) => ref.routeId === branchRouteId) ??
    dirs[dir] ??
    dirs.UP ??
    dirs.DOWN;
  const dest = active?.dest ?? line.dest;
  const titleDests = useMemo(
    () => mtrTitleDests(db, { route: line.route, dest }, dir),
    [db, line.route, dest, dir],
  );
  // Racecourse rows only appear when the live API returned them — never invent empty ones.
  const shown =
    line.company === "mtr" ? (arrivals ?? []).filter((row) => !etaEndsHere(row, station)) : (arrivals ?? []);
  const lineLabel =
    line.company === "mtr"
      ? `${nameOf(lang, station.name)} (${mtrLineName(lang, line.route)})`
      : `${nameOf(lang, station.name)} (${line.route})`;
  const multiBranch = branchOpts.length > 1;

  return (
    <div
      className="mtr-line"
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.({
          id: crypto.randomUUID(),
          routeId: active?.routeId ?? line.routeId,
          company: line.company,
          stopId: station.stopId,
          stopSeq: active?.stopSeq ?? line.stopSeq,
          auto: true,
        });
      }}
    >
      <div className="card-top">
        {line.company === "lightRail" ? (
          <LrtLogo className="mode-logo" lines={[color]} />
        ) : (
          <MtrLogo className="mode-logo" lines={[color]} />
        )}
        <div className="card-meta">
          {line.company === "mtr" && titleDests.length > 0 ? (
            <div className="dest">
              <TowardDests lang={lang} dests={titleDests} />
            </div>
          ) : multiBranch ? (
            <div className="mtr-branch-chips" role="group" aria-label={lang === "zh" ? "終點" : "Destination"}>
              {branchOpts.map((ref) => {
                const on = ref.routeId === (active?.routeId ?? branchRouteId);
                return (
                  <button
                    key={`${ref.routeId}:${mtrDestKey(ref.dest)}`}
                    type="button"
                    className={`mtr-branch-chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={(event) => {
                      event.stopPropagation();
                      setBranchRouteId(ref.routeId);
                    }}
                  >
                    {towardLabel(lang, ref.dest)}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="dest">{towardLabel(lang, titleDests[0] ?? dest)}</div>
          )}
          <div className="stop">{lineLabel}</div>
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
      {/* No onRefresh wrap: home poll keeps ETA fresh; tap bubbles to line → RouteDetail. */}
      <EtaStrip arrivals={shown} lang={lang} company={line.company} />
    </div>
  );
}

function etaKey(station: RailStation, line: RailLine): string {
  // One ETA poll per line code / station — MTR API is line+sta, not branch routeId.
  return `${station.stopId}:${line.route}`;
}

async function loadLineEta(db: EtaDb, station: RailStation, line: RailLine, lang: Lang): Promise<Arrival[]> {
  const key = etaKey(station, line);
  try {
    return await fetchArrivals(
      db,
      {
        id: key,
        routeId: line.routeId,
        company: line.company,
        stopId: station.stopId,
        stopSeq: line.stopSeq,
        bothWays: line.company === "mtr",
      },
      lang,
    );
  } catch {
    return [];
  }
}

async function loadStationEtas(db: EtaDb, stations: RailStation[], lang: Lang): Promise<Record<string, Arrival[]>> {
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
