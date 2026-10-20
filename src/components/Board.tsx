"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import { closeTopLayer, dismissAllLayers, getTopLayer, openLayer, subscribeLayers } from "@/lib/backLayer";
import { useNow } from "@/hooks/useNow";
import { useReconnectTick } from "@/hooks/useOffline";
import { mtrLineName, routeColor } from "@/lib/colors";
import { haversine, type LatLng } from "@/lib/geo";
import { companyMode } from "@/lib/mode";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { loadTaxiStands, taxiStandLabel } from "@/lib/taxi";
import { loadFerryPiers, loadTramPack, tramStopsOf, type FerryPier } from "@/lib/extras";
import { everyPlace, mtrLineColorsAtStop, nearbyPlaces } from "@/lib/stopIndex";
import { latestStamp } from "@/lib/updated";
import type { Arrival, BoardFilter, EtaDb, NearbyPlace, Pin, TaxiStand } from "@/lib/types";
import { AddFlow } from "./AddFlow";
import { EtaStrip } from "./EtaStrip";
import { FerryBoard } from "./FerryBoard";
import { FilterChips } from "./FilterChips";
import { MtrLogo } from "./Icons";
import { PinCard } from "./PinCard";
import { PullToRefresh } from "./PullToRefresh";
import { RouteSheet } from "./RouteDetail";
import type { RouteOverlay } from "./RouteMap";
import { useApp } from "./Providers";
import { MtrBoard, MtrPeekStation } from "./MtrBoard";
import { TaxiBoard } from "./TaxiBoard";
import { TramBoard } from "./TramBoard";
import { fetchArrivals } from "@/lib/eta";

const Map = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="home-map" />,
});

const SHEET_DEFAULT = 0.55;
const SHEET_MIN = 0.34;
const SHEET_MAX = 0.86;
const SHEET_MIN_FLOOR = 0.12;
/** How long the last pose must stay put before release counts as a hold. */
const SHEET_STILL_MS = 140;
/** Finger jitter inside this band is leftover motion, not a swipe. */
const SHEET_STILL_PX = 20;
/** px/s. Slow place-and-lift is not a flick even if the pointer was not fully still. */
const SHEET_FLICK_PX_S = 900;

type SheetSample = { y: number; t: number };

function clampSheet(h: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, h));
}

function pushSheetSample(samples: SheetSample[], y: number, t: number) {
  samples.push({ y, t });
  const dropBefore = t - SHEET_STILL_MS * 2;
  while (samples.length > 2 && samples[0] && samples[0].t < dropBefore) samples.shift();
}

/**
 * Last gesture only: still at release → 0 (freeze). Moving swipe → px/ms, up expands.
 * Does not average in the drag that happened before the user paused.
 */
function sheetReleaseVel(samples: SheetSample[], now: number): number {
  const newest = samples[samples.length - 1];
  if (!newest) return 0;
  const heldAfterLastMove = now - newest.t;
  if (heldAfterLastMove >= SHEET_STILL_MS) return 0;

  let leftBandAt = newest.t;
  for (let i = samples.length - 2; i >= 0; i--) {
    const sample = samples[i];
    if (!sample) break;
    if (Math.abs(sample.y - newest.y) > SHEET_STILL_PX) {
      const stillFor = newest.t - leftBandAt + heldAfterLastMove;
      if (stillFor >= SHEET_STILL_MS) return 0;
      const dt = newest.t - sample.t;
      if (dt < 16) return 0;
      const vel = (sample.y - newest.y) / dt;
      return Math.abs(vel * 1000) >= SHEET_FLICK_PX_S ? vel : 0;
    }
    leftBandAt = sample.t;
  }
  return 0;
}

function measureSheetMax(): number {
  if (typeof window === "undefined") return SHEET_MAX;
  if (window.matchMedia("(min-width: 840px)").matches) return SHEET_MAX;
  const tools = document.querySelector(".map-tools");
  if (!tools) return SHEET_MAX;
  const box = tools.getBoundingClientRect();
  const handleTop = box.bottom + box.top;
  return Math.min(0.96, Math.max(SHEET_MIN, 1 - handleTop / window.innerHeight));
}

function measurePeekMin(seamTop: number | undefined): number {
  if (typeof window === "undefined") return SHEET_MIN;
  if (window.matchMedia("(min-width: 840px)").matches) return SHEET_MIN;
  const sheetEl = document.querySelector(".sheet");
  const nav = document.querySelector("nav.nav");
  if (!sheetEl || !nav || seamTop == null) return SHEET_MIN;
  const px = seamTop - sheetEl.getBoundingClientRect().top + (window.innerHeight - nav.getBoundingClientRect().top);
  return Math.min(measureSheetMax(), Math.max(SHEET_MIN_FLOOR, px / window.innerHeight));
}

function measureRoutePeekMin(): number {
  const stops = document.querySelector(".detail-stops");
  const eta = document.querySelector(".route-eta-card");
  const seam = stops?.getBoundingClientRect().top ?? eta?.getBoundingClientRect().bottom;
  return measurePeekMin(seam);
}

function measureBoardPeekMin(): number {
  const mapStation = document.querySelector(".sheet-body:not(.is-route) .mtr-station.is-map");
  if (mapStation instanceof HTMLElement) {
    const lines = mapStation.querySelectorAll(".mtr-line");
    const pad = 12;
    // Interchange: bottom edge is the first line (must stay visible).
    // Single line: min = max = the whole card, so height is locked.
    if (lines.length > 1 && lines[0] instanceof HTMLElement) {
      return measurePeekMin(lines[0].getBoundingClientRect().bottom + pad);
    }
    return measurePeekMin(mapStation.getBoundingClientRect().bottom + pad);
  }
  const card =
    document.querySelector(".sheet-body:not(.is-route) .swipe-front > article.card") ??
    document.querySelector(".sheet-body:not(.is-route) .ptr > .stack > .card");
  return measurePeekMin(card?.getBoundingClientRect().top);
}

/** Last block the sheet actually has to show — not empty padding under it. */
function lastSheetContent(): HTMLElement | null {
  const mapStation = document.querySelector(".sheet-body:not(.is-route) .mtr-station.is-map");
  if (mapStation instanceof HTMLElement) return mapStation;
  const peek = document.querySelector(".sheet-body:not(.is-route) .stack.peek");
  if (peek instanceof HTMLElement) {
    const cards = peek.querySelectorAll(".peek-card, article.card");
    const last = cards[cards.length - 1];
    if (last instanceof HTMLElement) return last;
    return peek;
  }
  const route = document.querySelector(".sheet-body.is-route");
  if (route instanceof HTMLElement) {
    const items = route.querySelectorAll(".detail-stops > *");
    const lastStop = items[items.length - 1];
    if (lastStop instanceof HTMLElement) return lastStop;
    const eta = route.querySelector(".route-eta-card");
    if (eta instanceof HTMLElement) return eta;
  }
  const root =
    document.querySelector(".sheet-body:not(.is-route) .ptr") ?? document.querySelector(".sheet-body:not(.is-route)");
  if (!(root instanceof HTMLElement)) return null;
  const nodes = root.querySelectorAll(".mtr-station, .swipe, .ferry-card, .stack > .card, .stack > article");
  const last = nodes[nodes.length - 1];
  return last instanceof HTMLElement ? last : null;
}

function measureSheetContentMax(): number {
  const ceiling = measureSheetMax();
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return ceiling;
  const end = lastSheetContent();
  if (!end) return ceiling;
  const needed = measurePeekMin(end.getBoundingClientRect().bottom + 12);
  return Math.min(ceiling, Math.max(needed, SHEET_MIN_FLOOR));
}

function sheetRange(route: boolean): { lo: number; hi: number } {
  const hi = measureSheetContentMax();
  const lo = Math.min(hi, route ? measureRoutePeekMin() : measureBoardPeekMin());
  return { lo, hi };
}

function sheetTravelMs(from: number, to: number, lo: number, hi: number): number {
  const span = Math.max(0.22, hi - lo);
  return Math.min(420, Math.max(220, Math.round(400 * (Math.abs(to - from) / span))));
}

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
    setFilter,
    removePin,
    movePin,
    refreshAll,
    refreshPin,
    pos,
    requestPos,
    origin,
    adding,
    setAdding,
    homeSeq,
    devOn,
    devPin,
    devShowAll,
    setDevPin,
    setDevShowAll,
    setDevSpot,
  } = useApp();
  const reconnectTick = useReconnectTick();
  const [sheet, setSheet] = useState(SHEET_DEFAULT);
  const [sheetDur, setSheetDur] = useState(400);
  const [sheetHeld, setSheetHeld] = useState(false);
  const [taxis, setTaxis] = useState<TaxiStand[]>([]);
  const [tramStops, setTramStops] = useState<ReturnType<typeof tramStopsOf>>([]);
  const [piers, setPiers] = useState<FerryPier[]>([]);
  const [placesReady, setPlacesReady] = useState(false);
  const [selected, setSelected] = useState<NearbyPlace[]>([]);
  const [peekEtas, setPeekEtas] = useState<Record<string, Arrival[]>>({});
  const [recenterToken, setRecenterToken] = useState(0);
  const [taxiFocus, setTaxiFocus] = useState<{ lat: number; lng: number; token: number } | null>(null);
  const [taxiFocusId, setTaxiFocusId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pin | null>(null);
  const [draftRefresh, setDraftRefresh] = useState(0);
  const [routeMap, setRouteMap] = useState<RouteOverlay | null>(null);
  const [routeFocus, setRouteFocus] = useState(0);
  const [locateToken, setLocateToken] = useState(0);
  const now = useNow();
  const sheetRef = useRef<HTMLDivElement>(null);
  const routeListRef = useRef<HTMLDivElement>(null);
  const endDrag = useRef<(() => void) | null>(null);
  const wasRoute = useRef(false);
  const sheetVal = useRef(sheet);
  const sheetDrag = useRef(false);
  const peekSnapId = useRef<string | null>(null);
  const peekLo = useRef<number | null>(null);
  const peekHi = useRef<number | null>(null);
  const layerTop = useSyncExternalStore(subscribeLayers, getTopLayer, () => null);
  sheetVal.current = sheet;

  const requestClose = () => {
    if (closeTopLayer()) return;
    if (openId || draft) {
      setOpenId(null);
      setDraft(null);
      return;
    }
    if (selected.length > 0) {
      setSelected([]);
      return;
    }
    if (adding) setAdding(false);
  };

  const openPeekLayer = () => {
    if (getTopLayer() === "peek") return;
    openLayer(() => setSelected([]), "peek");
  };

  const openDetailLayer = () => {
    if (openId || draft) return;
    openLayer(() => {
      setOpenId(null);
      setDraft(null);
    }, "detail");
  };

  useEffect(() => {
    if (!homeSeq) return;
    dismissAllLayers();
    setOpenId(null);
    setDraft(null);
    setSelected([]);
    setAdding(false);
  }, [homeSeq, setAdding]);

  const peekStationId = selected[0]?.kind === "station" ? selected[0].id : null;
  const [mtrSqueeze, setMtrSqueeze] = useState(false);

  const syncMtrSqueeze = (h: number) => {
    if (openId || draft || adding || peekStationId) {
      setMtrSqueeze(false);
      return;
    }
    if (settings.filter !== "mtr" && settings.filter !== "taxi") {
      setMtrSqueeze(false);
      return;
    }
    const lo = measureBoardPeekMin();
    setMtrSqueeze(h <= lo + 0.02);
  };

  const goSheet = (to: number) => {
    const { lo, hi } = sheetRange(Boolean(openId || draft));
    const next = clampSheet(to, lo, hi);
    const from = sheetVal.current;
    setSheetDur(sheetTravelMs(from, next, lo, hi));
    sheetVal.current = next;
    setSheet(next);
    syncMtrSqueeze(next);
  };

  useEffect(() => {
    if (sheetDrag.current) return;
    syncMtrSqueeze(sheet);
  }, [sheet, openId, draft, adding, settings.filter, peekStationId]);

  useEffect(() => {
    const on = Boolean(openId || draft);
    if (on === wasRoute.current) return;
    wasRoute.current = on;
    goSheet(SHEET_DEFAULT);
  }, [openId, draft]);

  useEffect(() => {
    if (openId || draft || adding) return;
    if (!peekStationId) {
      if (peekSnapId.current) {
        peekSnapId.current = null;
        peekLo.current = null;
        peekHi.current = null;
        goSheet(SHEET_DEFAULT);
      }
      return;
    }
    let apply = () => {};
    const ro = new ResizeObserver(() => apply());
    let observed: Element | null = null;
    apply = () => {
      if (sheetDrag.current) return;
      const sel = `.sheet-body:not(.is-route) .mtr-station.is-map[data-place-id="${CSS.escape(peekStationId)}"]`;
      const mapStation = document.querySelector(sel);
      if (!(mapStation instanceof HTMLElement)) return;
      const inner = mapStation.querySelector(".mtr-station-lines-inner") ?? mapStation;
      if (observed !== inner) {
        if (observed) ro.unobserve(observed);
        ro.observe(inner);
        observed = inner;
      }
      const { lo, hi } = sheetRange(false);
      const lines = mapStation.querySelectorAll(".mtr-line").length;
      const home = lines > 1 ? hi : lo;
      const switched = peekSnapId.current !== peekStationId;
      const atMin = peekLo.current == null || Math.abs(sheetVal.current - peekLo.current) < 0.025;
      const atMax = peekHi.current != null && Math.abs(sheetVal.current - peekHi.current) < 0.025;
      const over = sheetVal.current > hi + 0.008;
      peekSnapId.current = peekStationId;
      peekLo.current = lo;
      peekHi.current = hi;
      if (switched) {
        if (Math.abs(sheetVal.current - home) >= 0.008) goSheet(home);
        return;
      }
      if (atMin) {
        if (Math.abs(sheetVal.current - lo) >= 0.008) goSheet(lo);
        return;
      }
      if (over || atMax) {
        if (Math.abs(sheetVal.current - hi) >= 0.008) goSheet(hi);
      }
    };
    apply();
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      apply();
      innerFrame = requestAnimationFrame(apply);
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
      ro.disconnect();
    };
  }, [openId, draft, adding, peekStationId]);

  useEffect(() => {
    if (sheetDrag.current || peekStationId) return;
    const { lo, hi } = sheetRange(Boolean(openId || draft));
    if (sheetVal.current > hi + 0.008) goSheet(hi);
    else if (sheetVal.current < lo - 0.008) goSheet(lo);
  }, [openId, draft, adding, peekStationId, settings.filter]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pin");
    const stashed = sessionStorage.getItem("ia.open");
    if (id) {
      setOpenId(id);
    }
    if (stashed) {
      sessionStorage.removeItem("ia.open");
      try {
        const parsed = JSON.parse(stashed) as { kind?: string; pin?: Pin; place?: NearbyPlace };
        if (parsed.kind === "route" && parsed.pin) {
          setDraft(parsed.pin);
        }
        if (parsed.kind === "station" && parsed.place) {
          setSelected([parsed.place]);
        }
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadTaxiStands(), loadTramPack(), loadFerryPiers()]).then(([nextTaxis, pack, nextPiers]) => {
      if (!alive) return;
      setTaxis(nextTaxis);
      setTramStops(tramStopsOf(pack));
      setPiers(nextPiers);
      setPlacesReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const filter = settings.filter;

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

  const nearbyAll = useMemo(
    () => nearbyPlaces(db, origin, "all", taxis, tramStops, piers),
    [db, origin, taxis, tramStops, piers],
  );
  const places = useMemo(
    () => (filter === "all" ? nearbyAll : nearbyAll.filter((place) => place.mode === filter)),
    [nearbyAll, filter],
  );
  const chipFilters = useMemo(() => {
    const modes = new Set(nearbyAll.map((place) => place.mode));
    const pinModes = new Set(pins.map((pin) => companyMode(pin.company)));
    const ids: BoardFilter[] = ["all"];
    for (const id of ["bus", "minibus", "mtr", "ferry", "tram", "taxi"] as const) {
      if (id === "taxi" || id === "ferry" || id === "tram") {
        if (modes.has(id)) ids.push(id);
        continue;
      }
      if (modes.has(id) || pinModes.has(id)) ids.push(id);
    }
    return ids;
  }, [nearbyAll, pins]);

  useEffect(() => {
    if (!db || !placesReady) return;
    if (filter !== "all" && !chipFilters.includes(filter)) setFilter("all");
  }, [db, placesReady, filter, chipFilters, setFilter]);
  useEffect(() => {
    if (filter === "taxi" || filter === "ferry" || filter === "tram" || filter === "mtr") return;
    setTaxiFocus(null);
    setTaxiFocusId(null);
  }, [filter]);
  const allPlaces = useMemo(
    () => (devOn && devShowAll ? everyPlace(db, origin, taxis, tramStops, piers) : null),
    // Origin only sorts this set; panning must not rebuild every marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devOn, devShowAll, db, taxis, tramStops, piers],
  );
  const ferryPlaces = useMemo(() => places.filter((place) => place.mode === "ferry"), [places]);
  const mapPlaces = useMemo(() => {
    if (!allPlaces) return filter === "ferry" ? ferryPlaces : places;
    if (filter === "all") return allPlaces;
    // The MTR sheet is heavy-rail stations. Light-rail stops share that mode.
    if (filter === "mtr") return allPlaces.filter((place) => place.kind === "station");
    return allPlaces.filter((place) => place.mode === filter);
  }, [allPlaces, filter, ferryPlaces, places]);

  const stamp = latestStamp(visible.map((p) => updatedAt[p.id]));

  useEffect(() => {
    if (selected.length === 0 || !db) {
      setPeekEtas({});
      return;
    }
    let alive = true;
    const run = async () => {
      const jobs = selected.flatMap((place) =>
        place.routes.map(async (leg) => {
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
  }, [selected, db, settings.lang, reconnectTick]);

  const openDraft = (pin: Pin) => {
    openDetailLayer();
    setTaxiFocus(null);
    setTaxiFocusId(null);
    setOpenId(null);
    setDraft(pin);
  };

  const openSaved = (id: string) => {
    openDetailLayer();
    setSelected([]);
    setTaxiFocus(null);
    setTaxiFocusId(null);
    setDraft(null);
    setOpenId(id);
  };

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Cancel the button's click and the browser's pan so the gesture stays a drag.
    e.preventDefault();
    e.stopPropagation();
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startH = sheetVal.current;
    const handle = e.currentTarget;
    let moved = false;
    const samples: SheetSample[] = [{ y: startY, t: performance.now() }];
    sheetDrag.current = true;
    setSheetHeld(true);
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Emulated touch and synthetic events often have no capturable pointer.
    }
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault();
      ev.stopPropagation();
      const now = performance.now();
      const dy = startY - ev.clientY;
      pushSheetSample(samples, ev.clientY, now);
      if (Math.abs(dy) > 3) moved = true;
      const { lo, hi } = sheetRange(Boolean(openId || draft));
      const next = clampSheet(startH + dy / window.innerHeight, lo, hi);
      sheetVal.current = next;
      setSheet(next);
    };
    const finish = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      sheetDrag.current = false;
      setSheetHeld(false);
      if (moved) {
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
        const now = performance.now();
        pushSheetSample(samples, ev.clientY, now);
        const { lo, hi } = sheetRange(Boolean(openId || draft));
        const h = clampSheet(sheetVal.current, lo, hi);
        const vel = sheetReleaseVel(samples, now);
        const to = vel !== 0 ? (vel > 0 ? hi : lo) : h;
        goSheet(to);
      } else {
        const { lo, hi } = sheetRange(Boolean(openId || draft));
        const h = clampSheet(sheetVal.current, lo, hi);
        goSheet(h >= hi - 0.03 ? lo : hi);
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

  const showDetail = Boolean(openId || draft);
  const showSearch = adding && layerTop !== "peek" && layerTop !== "detail";
  const showPeek = !showDetail && selected.length > 0 && layerTop !== "search";

  return (
    <div
      className="home"
      style={{ "--sheet-h": `${sheet * 100}dvh`, "--sheet-dur": `${sheetDur}ms` } as CSSProperties}
    >
      <Map
        origin={origin}
        user={devPin ? null : pos}
        places={mapPlaces}
        selectedId={selected[0]?.id ?? taxiFocusId}
        onSelect={(place) => {
          if (openId || draft) return;
          if (place.kind === "taxi" || place.mode === "taxi") {
            if (getTopLayer() === "peek") closeTopLayer();
            setSelected([]);
            if (filter !== "taxi") setFilter("taxi");
            setTaxiFocusId(place.id);
            setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
            return;
          }
          if (filter === "ferry" && place.mode === "ferry") {
            setSelected([]);
            setTaxiFocusId(place.id);
            setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
            return;
          }
          openPeekLayer();
          setSelected([place]);
        }}
        onSelectGroup={(group) => {
          if (openId || draft) return;
          const stand = group.find((place) => place.kind === "taxi" || place.mode === "taxi");
          if (stand) {
            if (getTopLayer() === "peek") closeTopLayer();
            setSelected([]);
            if (filter !== "taxi") setFilter("taxi");
            setTaxiFocusId(stand.id);
            setTaxiFocus({ lat: stand.lat, lng: stand.lng, token: Date.now() });
            return;
          }
          const pier = filter === "ferry" ? group.find((place) => place.mode === "ferry") : undefined;
          if (pier) {
            setSelected([]);
            setTaxiFocusId(pier.id);
            setTaxiFocus({ lat: pier.lat, lng: pier.lng, token: Date.now() });
            return;
          }
          openPeekLayer();
          setSelected(group);
        }}
        sheet={sheet}
        recenterToken={recenterToken}
        onRecenter={() => {
          if (openId || draft) {
            setLocateToken((n) => n + 1);
            return;
          }
          setRecenterToken((n) => n + 1);
          if (devPin) return;
          void requestPos().then((here) => {
            if (here) setRecenterToken((n) => n + 1);
          });
        }}
        frameTaxi={filter === "taxi" && !devPin && !devShowAll && !openId && !draft}
        frameFerry={filter === "ferry" && !devShowAll && !openId && !draft}
        framePlaces={ferryPlaces}
        taxiFocus={openId || draft ? null : taxiFocus}
        dev={devOn}
        pinOn={devPin}
        showAll={devShowAll}
        onPinChange={setDevPin}
        onShowAll={setDevShowAll}
        onSpot={setDevSpot}
        route={openId || draft ? routeMap : null}
        onRouteStop={(seq) => {
          if (!db) return;
          const pin = draft ?? pins.find((item) => item.id === openId);
          const id = pin ? db.routeList[pin.routeId]?.stops[pin.company]?.[seq] : undefined;
          if (!pin || !id) return;
          if (draft) {
            setDraft({ ...draft, stopId: id, stopSeq: seq, auto: false });
            setRouteFocus((n) => n + 1);
            return;
          }
          setDraft({ ...pin, stopId: id, stopSeq: seq, auto: false });
          setRouteFocus((n) => n + 1);
        }}
      />
      <section className={`sheet${sheetHeld ? " is-drag" : ""}`}>
        <button
          type="button"
          className="sheet-handle"
          aria-label="Sheet"
          onPointerDown={onHandleDown}
        >
          <span />
        </button>
        <div className={`sheet-body${showDetail && !showSearch ? " is-route" : ""}`} ref={sheetRef}>
          {adding ? (
            <div style={{ display: showSearch ? undefined : "none" }}>
            <AddFlow
              onOpenRoute={(pin) => {
                openDraft(pin);
              }}
              onOpenStation={(place) => {
                openPeekLayer();
                setSelected([place]);
              }}
            />
            </div>
          ) : null}
          {showSearch ? null : (
            <PullToRefresh
            lang={settings.lang}
            updatedAt={openId ? updatedAt[openId] : stamp}
            now={now}
            scrollRef={openId || draft ? routeListRef : sheetRef}
            onRefresh={() => {
              if (draft) {
                setDraftRefresh((n) => n + 1);
                return;
              }
              if (openId) {
                setDraftRefresh((n) => n + 1);
                return refreshPin(openId);
              }
              setRefreshTick((n) => n + 1);
              return refreshAll(visible.map((p) => p.id));
            }}
          >
            {openId || draft ? (
              <RouteSheet
                pinId={openId ?? ""}
                draft={draft}
                seedArrivals={draft ? peekEtas[draft.id] : undefined}
                refreshToken={draftRefresh}
                onDraft={setDraft}
                listRef={routeListRef}
                focusToken={routeFocus}
                locateToken={locateToken}
                onClose={requestClose}
                onMap={setRouteMap}
                onFocus={() => setRouteFocus((n) => n + 1)}
              />
            ) : (
              <>
            <FilterChips
              onClosePeek={showPeek ? requestClose : undefined}
              peekMode={selected[0]?.mode}
              visible={chipFilters}
            />
            {showPeek ? (
              <div className={`stack peek${selected[0]?.kind === "station" ? " is-bare" : ""}`}>
                {selected.map((place) => (
                  <div key={place.id} className="stack">
                    {place.kind === "station" ? (
                      <MtrPeekStation placeId={place.id} tick={refreshTick} onOpen={openDraft} />
                    ) : (
                      <>
                    <div className="card-top tight">
                      <span className="dest">{nameOf(settings.lang, place.name)}</span>
                    </div>
                    {place.kind === "taxi" ? (
                      <p className="muted">{taxiStandLabel(settings.lang, place.taxiColors)}</p>
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
                      place.routes.map((leg) => {
                        const route = db?.routeList[leg.routeId];
                        const located = stopOnRoute(route?.stops[leg.company] ?? [], place.id);
                        const etaKey = `${place.id}:${leg.routeId}`;
                        return (
                          <article
                            key={etaKey}
                            className="card peek-card"
                            onClick={() =>
                              openDraft({
                                id: etaKey,
                                routeId: leg.routeId,
                                company: leg.company,
                                stopId: located.stopId,
                                stopSeq: located.stopSeq,
                                auto: true,
                              })
                            }
                          >
                            {leg.company === "mtr" ? (
                              <div className="card-top">
                                <MtrLogo className="mode-logo" lines={[routeColor("mtr", leg.route)]} />
                                <div className="card-meta">
                                  <div className="dest">{towardLabel(settings.lang, leg.dest)}</div>
                                  <div className="stop">{`${nameOf(settings.lang, place.name)} (${mtrLineName(settings.lang, leg.route)})`}</div>
                                </div>
                              </div>
                            ) : (
                              <div className="card-meta">
                                {leg.company === "tram" ? (
                                  <div className="dest">{towardLabel(settings.lang, leg.dest)}</div>
                                ) : (
                                  <>
                                    <div className="dest">{leg.route}</div>
                                    <div className="stop">{towardLabel(settings.lang, leg.dest)}</div>
                                  </>
                                )}
                              </div>
                            )}
                            <EtaStrip arrivals={peekEtas[etaKey]} lang={settings.lang} company={leg.company} />
                          </article>
                        );
                      })
                    )}
                      </>
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
                onOpen={openDraft}
              />
            ) : filter === "mtr" ? (
              <MtrBoard
                tick={refreshTick}
                focusedId={taxiFocusId}
                squeeze={mtrSqueeze}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
                onOpen={openDraft}
              />
            ) : filter === "tram" ? (
              <TramBoard
                tick={refreshTick}
                focusedId={taxiFocusId}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
                onOpen={openDraft}
              />
            ) : filter === "taxi" ? (
              <TaxiBoard
                places={places}
                origin={origin}
                focusedId={taxiFocusId}
                squeeze={mtrSqueeze}
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
                        onDelete={() => removePin(pin.id)}
                        onReorder={movePin}
                        onRefresh={() => {
                          void refreshPin(pin.id);
                        }}
                        onOpen={() => openSaved(pin.id)}
                        lineColors={pin.company === "mtr" ? mtrLineColorsAtStop(db, pin.stopId) : undefined}
                        distance={filter === "all" ? pinStopDistance(db, pin, origin) : undefined}
                      />
                    );
                  })
                )}
              </div>
            )}
            {selected.length === 0 ? (
              <p className="sources">
                {t(
                  settings.lang,
                  "Times: KMB, Citybus, GMB, MTR, Tram, ferry operators via DATA.GOV.HK. Bus positions on the map are estimated.",
                  "時間資料：九巴、城巴、專線小巴、港鐵、電車及渡輪營辦商（DATA.GOV.HK）。地圖上的巴士位置為估算。",
                )}
              </p>
            ) : null}
              </>
            )}
          </PullToRefresh>
          )}
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
