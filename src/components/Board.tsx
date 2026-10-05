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
import { everyPlace, mtrLineColorsAtStop, nearbyPlaces } from "@/lib/stopIndex";
import { latestStamp } from "@/lib/updated";
import type { EtaDb, NearbyPlace, Pin, TaxiStand } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { FerryBoard } from "./FerryBoard";
import { FilterChips } from "./FilterChips";
import { IconUndo, MtrLogo } from "./Icons";
import { PinCard } from "./PinCard";
import { PullToRefresh } from "./PullToRefresh";
import { RouteSheet } from "./RouteDetail";
import type { RouteOverlay } from "./RouteMap";
import { useApp } from "./Providers";
import { MtrBoard } from "./MtrBoard";
import { TaxiBoard } from "./TaxiBoard";
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
    updatePinStop,
    pos,
    origin,
    devOn,
    devPin,
    devShowAll,
    setDevPin,
    setDevShowAll,
    setDevSpot,
  } = useApp();
  const [undo, setUndo] = useState<Undo | null>(null);
  const [sheet, setSheet] = useState(SHEET_DEFAULT);
  const [taxis, setTaxis] = useState<TaxiStand[]>([]);
  const [tramStops, setTramStops] = useState<ReturnType<typeof tramStopsOf>>([]);
  const [piers, setPiers] = useState<FerryPier[]>([]);
  const [selected, setSelected] = useState<NearbyPlace[]>([]);
  const [peekEtas, setPeekEtas] = useState<Record<string, Arrival[]>>({});
  const [recenterToken, setRecenterToken] = useState(0);
  const [taxiFocus, setTaxiFocus] = useState<{ lat: number; lng: number; token: number } | null>(null);
  const [taxiFocusId, setTaxiFocusId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [routeMap, setRouteMap] = useState<RouteOverlay | null>(null);
  const [routeFocus, setRouteFocus] = useState(0);
  const now = useNow();
  const sheetRef = useRef<HTMLDivElement>(null);
  const routeListRef = useRef<HTMLDivElement>(null);
  const endDrag = useRef<(() => void) | null>(null);

  useEffect(() => () => endDrag.current?.(), []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pin");
    if (!id) return;
    setOpenId(id);
    window.history.replaceState(null, "", "/");
  }, []);

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

  const filter = settings.filter;

  useEffect(() => {
    setTaxiFocus(null);
    setTaxiFocusId(null);
  }, [filter]);

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
  const allPlaces = useMemo(
    () => (devOn && devShowAll ? everyPlace(db, origin, taxis, tramStops, piers) : null),
    // Origin only sorts this set; panning must not rebuild every marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devOn, devShowAll, db, taxis, tramStops, piers],
  );
  const mapPlaces = allPlaces ?? places;

  const stamp = latestStamp(visible.map((p) => updatedAt[p.id]));

  useEffect(() => {
    if (selected.length === 0 || !db) {
      setPeekEtas({});
      return;
    }
    let alive = true;
    const run = async () => {
      const jobs = selected.flatMap((place) =>
        place.routes.slice(0, 8).map(async (leg) => {
          const key = `${place.id}:${leg.routeId}`;
          const route = db.routeList[leg.routeId];
          const located = stopOnRoute(route?.stops[leg.company] ?? [], place.id);
          try {
            const rows = await fetchArrivals(
              db,
              {
                id: key,
                routeId: leg.routeId,
                company: leg.company,
                stopId: located.stopId,
                stopSeq: located.stopSeq,
                bothWays: leg.company === "mtr",
              },
              settings.lang,
            );
            return [key, rows] as const;
          } catch {
            return [key, [] as Arrival[]] as const;
          }
        }),
      );
      const entries = await Promise.all(jobs);
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
    if (e.button !== 0) return;
    // Cancel the button's click and the browser's pan so the gesture stays a drag.
    e.preventDefault();
    e.stopPropagation();
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startH = sheet;
    const handle = e.currentTarget;
    let moved = false;
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Emulated touch and synthetic events often have no capturable pointer.
    }
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      ev.stopPropagation();
      const dy = startY - ev.clientY;
      if (Math.abs(dy) > 3) moved = true;
      const next = Math.min(SHEET_MAX, Math.max(SHEET_MIN, startH + dy / window.innerHeight));
      setSheet(next);
    };
    const finish = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      if (moved) {
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
      }
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      endDrag.current = null;
    };
    endDrag.current?.();
    // Window capture, not the button: the handle is only 28px, so the pointer
    // leaves it immediately, and touch/emulation does not retarget moves back.
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    endDrag.current = stop;
  };

  return (
    <div className="home" style={{ "--sheet-h": `${sheet * 100}dvh` } as CSSProperties}>
      <Map
        origin={origin}
        user={devPin ? null : pos}
        places={mapPlaces}
        selectedId={selected[0]?.id ?? taxiFocusId}
        onSelect={(place) => setSelected([place])}
        onSelectGroup={setSelected}
        sheet={sheet}
        recenterToken={recenterToken}
        onRecenter={() => {
          if (openId) {
            const pin = pins.find((item) => item.id === openId);
            if (pin) updatePinStop(pin.id, pin.stopId, pin.stopSeq, true);
            setRouteFocus((n) => n + 1);
            return;
          }
          setRecenterToken((n) => n + 1);
        }}
        frameTaxi={filter === "taxi" && !devPin && !devShowAll && !openId}
        taxiFocus={openId ? null : taxiFocus}
        dev={devOn}
        pinOn={devPin}
        showAll={devShowAll}
        onPinChange={setDevPin}
        onShowAll={setDevShowAll}
        onSpot={setDevSpot}
        route={openId ? routeMap : null}
        onRouteStop={(seq) => {
          if (!openId || !db) return;
          const pin = pins.find((item) => item.id === openId);
          const id = pin ? db.routeList[pin.routeId]?.stops[pin.company]?.[seq] : undefined;
          if (!pin || !id) return;
          updatePinStop(pin.id, id, seq, false);
          setRouteFocus((n) => n + 1);
        }}
      />
      <section className="sheet">
        <button
          type="button"
          className="sheet-handle"
          aria-label="Sheet"
          onPointerDown={onHandleDown}
        >
          <span />
        </button>
        <div className={`sheet-body${openId ? " is-route" : ""}`} ref={sheetRef}>
          <PullToRefresh
            lang={settings.lang}
            updatedAt={openId ? updatedAt[openId] : stamp}
            now={now}
            scrollRef={openId ? routeListRef : sheetRef}
            onRefresh={() => {
              if (openId) return refreshPin(openId);
              setRefreshTick((n) => n + 1);
              return refreshAll(visible.map((p) => p.id));
            }}
          >
            {openId ? (
              <RouteSheet
                pinId={openId}
                listRef={routeListRef}
                focusToken={routeFocus}
                onClose={() => setOpenId(null)}
                onMap={setRouteMap}
                onFocus={() => setRouteFocus((n) => n + 1)}
              />
            ) : (
              <>
            <FilterChips
              onClosePeek={selected.length > 0 ? () => setSelected([]) : undefined}
              peekMode={selected[0]?.mode}
            />
            {selected.length > 0 ? (
              <div className="stack peek">
                {selected.map((place) => (
                  <div key={place.id} className="stack">
                    <div className="card-top tight">
                      {place.kind === "station" && place.lineColors?.length ? (
                        <MtrLogo className="mode-logo" lines={place.lineColors} />
                      ) : null}
                      <span className="dest">{nameOf(settings.lang, place.name)}</span>
                    </div>
                    {place.kind === "taxi" ? (
                      <p className="muted">{t(settings.lang, "Taxi stand", "的士站")}</p>
                    ) : place.kind === "pier" && place.routes.length === 0 ? (
                      <div className="stack">
                        <p className="muted">{t(settings.lang, "Ferry", "渡輪")}</p>
                        {(place.dests ?? [])
                          .filter((dest, index, all) => {
                            const label = nameOf(settings.lang, dest);
                            return all.findIndex((other) => nameOf(settings.lang, other) === label) === index;
                          })
                          .map((dest) => (
                            <div key={dest.en} className="dest">
                              {nameOf(settings.lang, dest)}
                            </div>
                          ))}
                      </div>
                    ) : (
                      place.routes.slice(0, 8).map((leg) => {
                        const route = db?.routeList[leg.routeId];
                        const located = stopOnRoute(route?.stops[leg.company] ?? [], place.id);
                        const etaKey = `${place.id}:${leg.routeId}`;
                        return (
                          <article key={etaKey} className="card peek-card">
                            <div className="card-meta">
                              {leg.company === "mtr" ? (
                                <div className="mtr-line-name">
                                  <span className="mtr-dot" style={{ background: routeColor("mtr", leg.route) }} aria-hidden="true" />
                                  <span className="mtr-line-label">{mtrLineName(settings.lang, leg.route)}</span>
                                </div>
                              ) : leg.company === "tram" ? (
                                <div className="dest">{nameOf(settings.lang, leg.dest)}</div>
                              ) : (
                                <>
                                  <div className="dest">{leg.route}</div>
                                  <div className="stop">{nameOf(settings.lang, leg.dest)}</div>
                                </>
                              )}
                            </div>
                            <EtaStrip arrivals={peekEtas[etaKey]} lang={settings.lang} />
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
                ))}
              </div>
            ) : filter === "ferry" ? (
              <FerryBoard
                places={places}
                focusedId={taxiFocusId}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
              />
            ) : filter === "mtr" ? (
              <MtrBoard
                tick={refreshTick}
                focusedId={taxiFocusId}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
              />
            ) : filter === "tram" ? (
              <TramBoard
                tick={refreshTick}
                focusedId={taxiFocusId}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
              />
            ) : filter === "taxi" ? (
              <TaxiBoard
                places={places}
                origin={origin}
                focusedId={taxiFocusId}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
              />
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
                        onOpen={() => {
                          setSelected([]);
                          setTaxiFocus(null);
                          setTaxiFocusId(null);
                          setOpenId(pin.id);
                        }}
                        lineColors={pin.company === "mtr" ? mtrLineColorsAtStop(db, pin.stopId) : undefined}
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
              </>
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
