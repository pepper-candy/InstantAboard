"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useNow } from "@/hooks/useNow";
import { mtrLineName, routeColor } from "@/lib/colors";
import { haversine, type LatLng } from "@/lib/geo";
import { companyMode } from "@/lib/mode";
import { nameOf, t } from "@/lib/i18n";
import { loadTaxiStands } from "@/lib/taxi";
import { loadFerryPiers, loadTramPack, tramStopsOf, type FerryPier } from "@/lib/extras";
import { nearbyPlaces } from "@/lib/stopIndex";
import { latestStamp } from "@/lib/updated";
import type { EtaDb, NearbyPlace, Pin, TaxiStand } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { FerryBoard } from "./FerryBoard";
import { FilterChips } from "./FilterChips";
import { IconUndo, MtrLogo } from "./Icons";
import { PinCard } from "./PinCard";
import { PullToRefresh } from "./PullToRefresh";
import { useApp } from "./Providers";
import { MtrBoard } from "./MtrBoard";
import { TramBoard } from "./TramBoard";
import { fetchArrivals } from "@/lib/eta";
import type { Arrival } from "@/lib/types";

const Map = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="home-map" />,
});

type Undo = { pin: Pin; index: number };

const SHEET_DEFAULT = 0.55;
const SHEET_MIN = 0.34;
const SHEET_MAX = 0.86;

export function Board() {
  const {
    db,
    dbError,
    pins,
    pinsReady,
    etas,
    updatedAt,
    busy,
    settings,
    removePin,
    restorePin,
    movePin,
    refreshAll,
    refreshPin,
    addPin,
    pos,
    origin,
  } = useApp();
  const [undo, setUndo] = useState<Undo | null>(null);
  const [sheet, setSheet] = useState(SHEET_DEFAULT);
  const [taxis, setTaxis] = useState<TaxiStand[]>([]);
  const [tramStops, setTramStops] = useState<ReturnType<typeof tramStopsOf>>([]);
  const [piers, setPiers] = useState<FerryPier[]>([]);
  const [selected, setSelected] = useState<NearbyPlace | null>(null);
  const [peekEtas, setPeekEtas] = useState<Record<string, Arrival[]>>({});
  const [recenterToken, setRecenterToken] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const now = useNow();
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    void loadTaxiStands().then(setTaxis);
    void loadTramPack().then((pack) => setTramStops(tramStopsOf(pack)));
    void loadFerryPiers().then(setPiers);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(id);
  }, [undo]);

  const filter = settings.filter === "taxi" ? "all" : settings.filter;

  const visible = useMemo(() => {
    if (filter !== "all") {
      return pins.filter((pin) => companyMode(pin.company) === filter);
    }
    if (!db) return pins;
    return [...pins].sort((a, b) => {
      const da = pinStopDistance(db, a, origin);
      const dbDist = pinStopDistance(db, b, origin);
      if (da === dbDist) return 0;
      return da < dbDist ? -1 : 1;
    });
  }, [pins, filter, db, origin]);

  const places = useMemo(
    () => nearbyPlaces(db, origin, filter, taxis, tramStops, piers),
    [db, origin, filter, taxis, tramStops, piers],
  );

  const stamp = latestStamp(visible.map((p) => updatedAt[p.id]));

  useEffect(() => {
    if (!selected || !db) {
      setPeekEtas({});
      return;
    }
    let alive = true;
    const run = async () => {
      const entries = await Promise.all(
        selected.routes.slice(0, 8).map(async (leg) => {
          const route = db.routeList[leg.routeId];
          const located = stopOnRoute(route?.stops[leg.company] ?? [], selected.id);
          try {
            const rows = await fetchArrivals(
              db,
              {
                id: leg.routeId,
                routeId: leg.routeId,
                company: leg.company,
                stopId: located.stopId,
                stopSeq: located.stopSeq,
                bothWays: leg.company === "mtr",
              },
              settings.lang,
            );
            return [leg.routeId, rows] as const;
          } catch {
            return [leg.routeId, [] as Arrival[]] as const;
          }
        }),
      );
      if (!alive) return;
      setPeekEtas(Object.fromEntries(entries));
    };
    void run();
    return () => {
      alive = false;
    };
  }, [selected, db, settings.lang]);

  const onDelete = (pin: Pin) => {
    const index = pins.findIndex((p) => p.id === pin.id);
    removePin(pin.id);
    setUndo({ pin, index });
  };

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    drag.current = { y: e.clientY, h: sheet };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    const next = Math.min(SHEET_MAX, Math.max(SHEET_MIN, drag.current.h + dy / window.innerHeight));
    setSheet(next);
  };
  const onHandleUp = () => {
    drag.current = null;
  };

  return (
    <div className="home" style={{ "--sheet-h": `${sheet * 100}dvh` } as CSSProperties}>
      <Map
        origin={origin}
        user={pos}
        places={places}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
        sheet={sheet}
        recenterToken={recenterToken}
        onRecenter={() => setRecenterToken((n) => n + 1)}
      />
      <section className="sheet">
        <button
          type="button"
          className="sheet-handle"
          aria-label="Sheet"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span />
        </button>
        <div className="sheet-body" ref={sheetRef}>
          <PullToRefresh
            lang={settings.lang}
            updatedAt={stamp}
            now={now}
            scrollRef={sheetRef}
            onRefresh={() => {
              setRefreshTick((n) => n + 1);
              return refreshAll(visible.map((p) => p.id));
            }}
          >
            <FilterChips onClosePeek={selected ? () => setSelected(null) : undefined} />
            {selected ? (
              <div className="stack peek">
                <div className="card-top tight">
                  <span className="dest">{nameOf(settings.lang, selected.name)}</span>
                </div>
                {selected.kind === "taxi" ? (
                  <p className="muted">{t(settings.lang, "Taxi stand", "的士站")}</p>
                ) : selected.kind === "pier" && selected.routes.length === 0 ? (
                  <div className="stack">
                    <p className="muted">{t(settings.lang, "Ferry", "渡輪")}</p>
                    {(selected.dests ?? []).map((dest) => (
                      <div key={dest.en} className="dest">
                        {nameOf(settings.lang, dest)}
                      </div>
                    ))}
                  </div>
                ) : (
                  selected.routes.slice(0, 8).map((leg) => {
                    const route = db?.routeList[leg.routeId];
                    const located = stopOnRoute(route?.stops[leg.company] ?? [], selected.id);
                    return (
                      <article key={leg.routeId} className="card peek-card">
                        <div className="card-meta">
                          {leg.company === "mtr" ? (
                            <div className="mtr-line-name">
                              <MtrLogo className="mode-logo" line={routeColor("mtr", leg.route)} />
                              <span className="mtr-line-label">{mtrLineName(settings.lang, leg.route)}</span>
                            </div>
                          ) : (
                            <>
                              <div className="dest">{leg.route}</div>
                              <div className="stop">{nameOf(settings.lang, leg.dest)}</div>
                            </>
                          )}
                        </div>
                        <EtaStrip arrivals={peekEtas[leg.routeId]} lang={settings.lang} />
                        <button
                          type="button"
                          className="pin-mini"
                          aria-label="Pin"
                          onClick={() =>
                            addPin({
                              id: crypto.randomUUID(),
                              routeId: leg.routeId,
                              company: leg.company,
                              stopId: located.stopId,
                              stopSeq: located.stopSeq,
                              auto: leg.company !== "mtr" && leg.company !== "tram",
                              bothWays: leg.company === "mtr",
                            })
                          }
                        >
                          +
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            ) : filter === "ferry" ? (
              <FerryBoard />
            ) : filter === "mtr" ? (
              <MtrBoard tick={refreshTick} />
            ) : filter === "tram" ? (
              <TramBoard tick={refreshTick} />
            ) : (
              <div className="stack">
                {!pinsReady || !db ? (
                  <SkeletonBoard />
                ) : dbError ? (
                  <p className="muted">{t(settings.lang, "Routes unavailable", "未能載入路線")}</p>
                ) : visible.length === 0 ? (
                  <p className="muted">{t(settings.lang, "Pin a route", "加入路線")}</p>
                ) : (
                  visible.map((pin) => {
                    const route = db.routeList[pin.routeId];
                    if (!route) return null;
                    const stop = db.stopList[pin.stopId];
                    return (
                      <PinCard
                        key={pin.id}
                        pin={pin}
                        route={route}
                        stop={stop}
                        arrivals={etas[pin.id]}
                        lang={settings.lang}
                        index={pins.findIndex((p) => p.id === pin.id)}
                        count={pins.length}
                        busy={busy[pin.id]}
                        onDelete={() => onDelete(pin)}
                        onReorder={movePin}
                        onRefresh={() => {
                          void refreshPin(pin.id);
                        }}
                      />
                    );
                  })
                )}
                <div className="undo-slot">
                  {undo ? (
                    <div className="undo">
                      <span>
                        {db?.routeList[undo.pin.routeId]?.route ?? "·"}{" "}
                        {nameOf(settings.lang, db?.routeList[undo.pin.routeId]?.dest, "")}
                      </span>
                      <button
                        type="button"
                        className="undo-btn"
                        onClick={() => {
                          restorePin(undo.pin, undo.index);
                          setUndo(null);
                        }}
                        aria-label={t(settings.lang, "Undo", "復原")}
                      >
                        <IconUndo className="icon-md" />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </PullToRefresh>
        </div>
      </section>
    </div>
  );
}

function stopOnRoute(ids: string[], placeId: string): { stopId: string; stopSeq: number } {
  const code = placeId.includes(":") ? placeId.slice(placeId.indexOf(":") + 1) : placeId;
  const seq = ids.indexOf(code);
  if (seq >= 0) return { stopId: code, stopSeq: seq };
  return { stopId: code, stopSeq: 0 };
}

function pinStopDistance(db: EtaDb, pin: Pin, origin: LatLng): number {
  const loc = db.stopList[pin.stopId]?.location;
  if (!loc) return Number.POSITIVE_INFINITY;
  return haversine(origin, loc);
}

function SkeletonBoard() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card card-skel" />
      ))}
    </>
  );
}
