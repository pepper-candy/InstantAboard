"use client";

/**
 * Home screen: map + bottom sheet + mode lists.
 *
 * Debug map:
 *   Sheet height (lo/mid/hi)  → src/lib/sheetLayout.ts
 *   List scroll / card hug    → src/lib/sheetScroll.ts
 *   Mode lists                → MtrBoard, TaxiBoard, FerryBoard, TramBoard, PinCard
 *   Route overlay             → RouteSheet (RouteDetail.tsx) + HomeMap RouteLayer
 *   Android back stack        → src/lib/backLayer.ts
 */
import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import { closeTopLayer, dismissAllLayers, getTopLayer, hasLayer, openLayer, silentDismiss, subscribeLayers } from "@/lib/backLayer";
import { useReconnectTick } from "@/hooks/useOffline";
import { mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
import { haversine, type LatLng } from "@/lib/geo";
import { companyMode } from "@/lib/mode";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { loadTaxiStands, taxiStandLabel } from "@/lib/taxi";
import { kaitoPiersOf, loadFerryPiers, loadKaitoPack, loadTramPack, tramStopsOf, type FerryPier } from "@/lib/extras";
import { isStarredStopClosest } from "@/lib/nearest";
import {
  everyPlace,
  lrtLineColorsAtStop,
  mtrLineColorsAtStop,
  nearbyLrtStops,
  nearbyMtrStations,
  nearbyPlaces,
  STOP_RADIUS,
} from "@/lib/stopIndex";
import type { Arrival, BoardFilter, EtaDb, NearbyPlace, Pin, TaxiStand } from "@/lib/types";
import { AddFlow } from "./AddFlow";
import { EtaStrip } from "./EtaStrip";
import { FerryBoard } from "./FerryBoard";
import { FilterChips } from "./FilterChips";
import { LrtLogo, MtrLogo } from "./Icons";
import { DataSources } from "./DataSources";
import { PinCard } from "./PinCard";
import { RouteSheet } from "./RouteDetail";
import type { RouteOverlay } from "./RouteMap";
import { useApp } from "./Providers";
import { MtrBoard, MtrPeekStation } from "./MtrBoard";
import { StopBoard } from "./StopBoard";
import { TaxiBoard } from "./TaxiBoard";
import { TramBoard } from "./TramBoard";
import { fetchArrivals } from "@/lib/eta";
import { ETA_POLL_MS } from "@/hooks/useEtas";
import { extraSheetPxToShowCard, focusedBoardCard, scrollSheetCardTop, sheetCardSeam } from "@/lib/sheetScroll";
import {
  MTR_LINES_EXPAND_MS,
  SHEET_DEFAULT,
  type SheetSample,
  boardMid,
  clampSheet,
  measureBoardPeekMin,
  measureOneCardMid,
  measurePeekMin,
  pushSheetSample,
  scheduleScrollAfterHeight,
  scheduleScrollSelectedOnMid,
  sheetRange,
  sheetReleaseVel,
  sheetTravelMs,
} from "@/lib/sheetLayout";
import { primeAutomatedCameraBusy } from "@/lib/mapCameraBusy";

const Map = dynamic(() => import("./HomeMap"), {
  ssr: false,
  loading: () => <div className="home-map" />,
});

function peekLegHasEta(etas: Record<string, Arrival[]>, placeId: string, routeId: string) {
  const rows = etas[`${placeId}:${routeId}`];
  if (rows === undefined) return true;
  return rows.some((row) => row.minutes != null);
}

function splitPeekLegs<T extends { routeId: string }>(
  legs: T[],
  placeId: string,
  etas: Record<string, Arrival[]>,
) {
  const inService: T[] = [];
  const outService: T[] = [];
  for (const leg of legs) {
    if (peekLegHasEta(etas, placeId, leg.routeId)) inService.push(leg);
    else outService.push(leg);
  }
  return { inService, outService };
}

export function Board() {
  // --- app + sheet state ---
  const {
    db,
    dbError,
    pins,
    pinsReady,
    etas,
    busy,
    settings,
    setFilter,
    removePin,
    movePin,
    pos,
    gpsDenied,
    origin,
    adding,
    setAdding,
    homeSeq,
    devOn,
    devPin,
    devPinMode,
    devShowAll,
    setDevPinMode,
    setDevShowAll,
    setDevSpot,
  } = useApp();
  const reconnectTick = useReconnectTick();
  const [sheet, setSheet] = useState(SHEET_DEFAULT);
  const [sheetDur, setSheetDur] = useState(400);
  const [taxis, setTaxis] = useState<TaxiStand[]>([]);
  const [tramStops, setTramStops] = useState<ReturnType<typeof tramStopsOf>>([]);
  const [piers, setPiers] = useState<FerryPier[]>([]);
  const [placesReady, setPlacesReady] = useState(false);
  const [selected, setSelected] = useState<NearbyPlace[]>([]);
  const [peekEtas, setPeekEtas] = useState<Record<string, Arrival[]>>({});
  const [recenterToken, setRecenterToken] = useState(0);
  const [taxiFocus, setTaxiFocus] = useState<{ lat: number; lng: number; token: number } | null>(null);
  const [taxiFocusId, setTaxiFocusId] = useState<string | null>(null);
  const refreshTick = 0;
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pin | null>(null);
  const [draftRefresh, setDraftRefresh] = useState(0);
  const [routeMap, setRouteMap] = useState<RouteOverlay | null>(null);
  const [routeFocus, setRouteFocus] = useState(0);
  const [locateToken, setLocateToken] = useState(0);
  const homeRef = useRef<HTMLDivElement>(null);
  const sheetBoxRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const routeListRef = useRef<HTMLDivElement>(null);
  const endDrag = useRef<(() => void) | null>(null);
  const wasRoute = useRef(false);
  const sheetVal = useRef(sheet);
  const sheetDrag = useRef(false);
  const peekSnapId = useRef<string | null>(null);
  const peekLo = useRef<number | null>(null);
  const peekHi = useRef<number | null>(null);
  /** Last settled stop-peek default mid — retarget when the in-service split moves. */
  const peekMidRef = useRef<number | null>(null);
  const hugHi = useRef<number | null>(null);
  /** Last settled route default mid — retarget when ETA lanes / stop change while still here. */
  const routeMidRef = useRef<number | null>(null);
  /** Last settled route adjustable-lowest (lo) — retarget when ETA lanes change while here. */
  const routeLoRef = useRef<number | null>(null);
  /** Last settled watchboard default mid — retarget when the in-service split moves. */
  const pinMidRef = useRef<number | null>(SHEET_DEFAULT);
  /** Hold sheet height while an MTR station card finishes expanding (0.28s), then ease mid. */
  const mtrHeightHoldUntil = useRef(0);
  const mtrHeightHoldTimer = useRef(0);
  const keepTaxiFocus = useRef(false);
  const layerTop = useSyncExternalStore(subscribeLayers, getTopLayer, () => null);
  if (!sheetDrag.current) sheetVal.current = sheet;

  const writeSheetH = (h: number) => {
    homeRef.current?.style.setProperty("--sheet-h", `${h * 100}dvh`);
  };

  const setSheetDragClass = (on: boolean) => {
    sheetBoxRef.current?.classList.toggle("is-drag", on);
  };

  // --- back-stack layers (peek / detail / search) ---
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

  /** Instant; no animation. Clears leftover peek scroll before swapping stop detail. */
  const snapStopPeekToTop = () => {
    if (!selected.some((place) => place.kind === "stop")) return;
    const body = sheetRef.current;
    if (body) body.scrollTop = 0;
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

  const peekStationId =
    selected[0]?.kind === "station" || selected[0]?.kind === "lrt" ? selected[0].id : null;
  const peekTaxiId = selected[0]?.kind === "taxi" ? selected[0].id : null;
  const peekStopId = selected[0]?.kind === "stop" ? selected[0].id : null;
  const peekSnapKey = peekStationId ?? peekTaxiId ?? peekStopId;
  const [mtrSqueeze, setMtrSqueeze] = useState(false);

  const syncMtrSqueeze = (h: number) => {
    if (openId || draft || adding || peekSnapKey) {
      setMtrSqueeze(false);
      return;
    }
    // Any home filter at lo: keep chips scrolled back under the handle (all/bus too).
    const lo = measureBoardPeekMin(settings.filter);
    setMtrSqueeze(h <= lo + 0.02);
  };

  // --- sheet pose (height in viewport fraction) ---
  const goSheet = (to: number, range?: { lo: number; hi: number }) => {
    const { lo, hi } = range ?? sheetRange(Boolean(openId || draft), settings.filter);
    const next = clampSheet(to, lo, hi);
    const from = sheetVal.current;
    const dur = sheetTravelMs(from, next, lo, hi);
    setSheetDur(dur);
    sheetVal.current = next;
    writeSheetH(next);
    setSheet(next);
    syncMtrSqueeze(next);
    // Drag max tracks content hug — soft lifts may sit below this.
    hugHi.current = hi;
  };

  /**
   * Temporary soft lift for a map-focused taxi/MTR card: grow just enough to show it.
   * Drag max stays the full-list hug (`hi`). Returns true when height changed.
   */
  const softLiftFocused = (): boolean => {
    if (sheetDrag.current || peekSnapKey || !taxiFocusId || openId || draft || adding) return false;
    if (Date.now() < mtrHeightHoldUntil.current) return false;
    if (!isOneCardFilter(settings.filter)) return false;
    const card = focusedBoardCard(taxiFocusId);
    if (!card) return false;
    // MTR expand is React-owned. Do not force is-on — that undoes header collapse.
    if (card.classList.contains("mtr-station") && !card.classList.contains("is-on")) {
      return false;
    }
    const { lo, hi } = sheetRange(false, settings.filter);
    // Chip-entry keeps nearest selected; do not fight an intentional chips-only collapse.
    if (sheetVal.current <= lo + 0.03) return false;
    const extraPx = extraSheetPxToShowCard(card);
    // One-card mid (not full stack seam) so non-first taxi/MTR selection can still collapse.
    const oneMid = measureOneCardMid(card);
    const soft = Math.min(
      hi,
      Math.max(
        sheetVal.current,
        oneMid ?? measurePeekMin(sheetCardSeam(card) + 12),
        sheetVal.current + extraPx / Math.max(1, window.innerHeight),
      ),
    );
    if (soft <= sheetVal.current + 0.008) return false;
    goSheet(soft, { lo, hi });
    return true;
  };

  /** Shrink when taller than content needs (incl. leftover soft-lift). Long list: leave. */
  const hugDownIfSpare = (filter: BoardFilter) => {
    if (sheetDrag.current || peekSnapKey) return;
    const { lo, hi } = sheetRange(Boolean(openId || draft), filter);
    hugHi.current = hi;
    if (sheetVal.current < lo - 0.008) {
      goSheet(lo, { lo, hi });
      return;
    }
    // Do not gate on atTop/atMax — soft lifts sit below hugHi and must still hug down on tab switch.
    if (sheetVal.current > hi + 0.008) goSheet(hi, { lo, hi });
  };

  useLayoutEffect(() => {
    writeSheetH(sheetVal.current);
  });

  useEffect(() => {
    if (sheetDrag.current) return;
    syncMtrSqueeze(sheet);
  }, [sheet, openId, draft, adding, settings.filter, peekSnapKey]);

  // Enter/exit route: settle default mid first, then scroll selected stop into view.
  useLayoutEffect(() => {
    const on = Boolean(openId || draft);
    if (on === wasRoute.current) return;
    wasRoute.current = on;
    hugHi.current = null;
    if (!on) {
      routeMidRef.current = null;
      routeLoRef.current = null;
    }
    const apply = () => {
      if (sheetDrag.current) return;
      const { lo, hi } = sheetRange(on, settings.filter);
      const mid = boardMid(on, settings.filter, lo, hi);
      goSheet(mid, { lo, hi });
      if (on) routeMidRef.current = mid;
      else if (isWatchboard(settings.filter)) pinMidRef.current = mid;
    };
    apply();
    if (!on) return;
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(() => {
        const { lo, hi } = sheetRange(true, settings.filter);
        const mid = boardMid(true, settings.filter, lo, hi);
        const from = sheetVal.current;
        apply();
        // Height first, then smoothly scroll selected stop into the mid viewport.
        scheduleScrollSelectedOnMid(true, from, mid, lo, hi, mid);
      });
    });
  }, [openId, draft]);

  useLayoutEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 840px)").matches) return;
    const body = sheetRef.current;
    if (!body) return;
    let raf = 0;
    const apply = () => {
      if (sheetDrag.current) return;
      // MTR card still expanding — keep adjustable height frozen until hold ends.
      if (Date.now() < mtrHeightHoldUntil.current) return;
      // Soft-focused card grew (hours / lines): re-lift even when below full-list max.
      if (softLiftFocused()) return;
      const route = Boolean(openId || draft);
      const { lo, hi } = sheetRange(route, settings.filter);
      const prevHi = hugHi.current;
      const atMax = prevHi != null && Math.abs(sheetVal.current - prevHi) < 0.05;
      hugHi.current = hi;
      // Route / stop peek own height via measured mid — do not atMax-snap from the previous list hug.
      if (!route && !peekSnapKey && atMax && Math.abs(hi - sheetVal.current) >= 0.008) {
        goSheet(hi, { lo, hi });
        return;
      }
      // Route default mid or adjustable lowest: ETA 1/2 lanes — height first, then scroll.
      if (route) {
        const mid = boardMid(true, settings.filter, lo, hi);
        const atMid =
          routeMidRef.current != null && Math.abs(sheetVal.current - routeMidRef.current) < 0.04;
        const atLo =
          (routeLoRef.current != null && Math.abs(sheetVal.current - routeLoRef.current) < 0.04) ||
          Math.abs(sheetVal.current - lo) < 0.04;
        if (atMid) {
          const from = sheetVal.current;
          if (Math.abs(from - mid) >= 0.008) {
            goSheet(mid, { lo, hi });
            routeMidRef.current = mid;
            routeLoRef.current = null;
            scheduleScrollSelectedOnMid(true, from, mid, lo, hi, mid);
            return;
          }
        } else if (atLo) {
          const from = sheetVal.current;
          if (Math.abs(from - lo) >= 0.008) {
            goSheet(lo, { lo, hi });
            routeLoRef.current = lo;
            routeMidRef.current = null;
            // Height first, then scroll (same order as mid).
            scheduleScrollAfterHeight(from, lo, lo, hi);
            return;
          }
          routeLoRef.current = lo;
        }
      } else if (!peekSnapKey && isWatchboard(settings.filter) && sheetVal.current > lo + 0.03) {
        const mid = boardMid(false, settings.filter, lo, hi);
        const atMid = pinMidRef.current != null && Math.abs(sheetVal.current - pinMidRef.current) < 0.04;
        if (atMid && Math.abs(sheetVal.current - mid) >= 0.008) {
          goSheet(mid, { lo, hi });
          pinMidRef.current = mid;
          return;
        }
      } else if (peekStopId) {
        const mid = boardMid(false, settings.filter, lo, hi);
        // First layout after opening a stop peek: land on default hug, not the previous list's hi.
        if (peekSnapId.current !== peekSnapKey) {
          if (Math.abs(sheetVal.current - mid) >= 0.008) goSheet(mid, { lo, hi });
          peekMidRef.current = mid;
          return;
        }
        const atMid = peekMidRef.current != null && Math.abs(sheetVal.current - peekMidRef.current) < 0.04;
        if (atMid && sheetVal.current > lo + 0.03 && Math.abs(sheetVal.current - mid) >= 0.008) {
          goSheet(mid, { lo, hi });
          peekMidRef.current = mid;
          return;
        }
      }
      // Spare under last card (tab leftovers / content shortened while soft-lifted).
      if (sheetVal.current > hi + 0.008) goSheet(hi, { lo, hi });
      else if (sheetVal.current < lo - 0.008) {
        goSheet(lo, { lo, hi });
        if (route) routeLoRef.current = lo;
      }
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    const hugRoots = () =>
      [
        ...body.querySelectorAll(
          ".stack, .route-sheet, section.page, .mtr-hours-fold, .route-eta-card, .etas-dir, .detail-stops",
        ),
      ].filter((node) => !(node instanceof Element && node.closest(".sources")));
    const ro = new ResizeObserver(() => schedule());
    ro.observe(body);
    for (const node of hugRoots()) ro.observe(node);
    const mo = new MutationObserver(() => {
      for (const node of hugRoots()) {
        try {
          ro.observe(node);
        } catch {
          /* already */
        }
      }
      schedule();
    });
    mo.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    apply();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [openId, draft, adding, settings.filter, peekSnapKey, taxiFocusId, mtrSqueeze]);

  const wasSqueeze = useRef(mtrSqueeze);
  useEffect(() => {
    const entered = mtrSqueeze && !wasSqueeze.current;
    wasSqueeze.current = mtrSqueeze;
    if (entered && sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [mtrSqueeze]);

  // While squeezed, keep the mode chips row under the handle: if the sheet-body
  // scrolls away (chips leave their sticky seat), smooth-return it. Covers the
  // "scrolled away while already squeezed" path, not just entering squeeze.
  useEffect(() => {
    if (!mtrSqueeze) return;
    const body = sheetRef.current;
    if (!body) return;
    let raf = 0;
    const clamp = () => {
      raf = 0;
      if (body.scrollTop > 2) body.scrollTo({ top: 0, behavior: "smooth" });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(clamp);
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      body.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mtrSqueeze]);

  useLayoutEffect(() => {
    if (mtrHeightHoldTimer.current) {
      window.clearTimeout(mtrHeightHoldTimer.current);
      mtrHeightHoldTimer.current = 0;
    }
    if (sheetDrag.current || peekSnapKey || !taxiFocusId || openId || draft || adding) {
      softLiftFocused();
      return;
    }
    if (!isOneCardFilter(settings.filter)) {
      softLiftFocused();
      return;
    }
    const { lo, hi } = sheetRange(false, settings.filter);
    // At chips-only lo: never lift. Otherwise retarget one-card mid for the selection.
    if (sheetVal.current <= lo + 0.03) return;

    const applyMid = () => {
      if (sheetDrag.current || peekSnapKey || openId || draft || adding) return;
      if (sheetVal.current <= lo + 0.03) return;
      const mid = boardMid(false, settings.filter, lo, hi);
      const from = sheetVal.current;
      if (Math.abs(from - mid) >= 0.008) goSheet(mid, { lo, hi });
      else softLiftFocused();
    };

    // MTR: freeze adjustable height while the station card expands (0.28s), then ease mid.
    if (settings.filter === "mtr") {
      const reduce =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wait = reduce ? 0 : MTR_LINES_EXPAND_MS;
      mtrHeightHoldUntil.current = Date.now() + wait;
      mtrHeightHoldTimer.current = window.setTimeout(() => {
        mtrHeightHoldTimer.current = 0;
        mtrHeightHoldUntil.current = 0;
        applyMid();
      }, wait);
      return;
    }

    applyMid();
  }, [taxiFocusId, taxiFocus?.token, settings.filter, openId, draft, adding, peekSnapKey]);

  useEffect(() => {
    if (sheetDrag.current || peekSnapKey || !taxiFocusId || openId || draft || adding) return;
    if (!isOneCardFilter(settings.filter)) return;
    if (mtrSqueeze) return;
    const card = focusedBoardCard(taxiFocusId);
    if (!card) return;
    // Height first, then scroll selected card under chips.
    // MTR: wait out card expand + sheet travel so height isn't fighting the open animation.
    const { lo, hi } = sheetRange(false, settings.filter);
    const mid = boardMid(false, settings.filter, lo, hi);
    const travel = sheetTravelMs(sheetVal.current, mid, lo, hi);
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const expandWait = settings.filter === "mtr" && !reduce ? MTR_LINES_EXPAND_MS : 0;
    const delay = expandWait + Math.min(travel, 320);
    const timer = window.setTimeout(() => {
      if (mtrSqueeze) return;
      scrollSheetCardTop(card);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [taxiFocusId, taxiFocus?.token, settings.filter, openId, draft, adding, peekSnapKey, mtrSqueeze]);

  useEffect(() => {
    if (openId || draft || adding) return;
    if (!peekSnapKey) {
      if (peekSnapId.current) {
        peekSnapId.current = null;
        peekLo.current = null;
        peekHi.current = null;
        peekMidRef.current = null;
        const { lo, hi } = sheetRange(false, settings.filter);
        const mid = boardMid(false, settings.filter, lo, hi);
        goSheet(mid, { lo, hi });
        if (isWatchboard(settings.filter)) pinMidRef.current = mid;
      }
      return;
    }
    let apply = () => {};
    const ro = new ResizeObserver(() => apply());
    let observed: Element | null = null;
    apply = () => {
      if (sheetDrag.current) return;
      const taxiPeek = document.querySelector(".sheet-body:not(.is-route) .stack.peek .peek-taxi");
      const stopPeeks = document.querySelectorAll(".sheet-body:not(.is-route) .stack.peek .peek-stop");
      const stopPeek = stopPeeks[0];
      const peekStack = document.querySelector(".sheet-body:not(.is-route) .stack.peek");
      const sel = peekStationId
        ? `.sheet-body:not(.is-route) .mtr-station.is-map[data-place-id="${CSS.escape(peekStationId)}"]`
        : "";
      const mapStation = sel ? document.querySelector(sel) : null;
      const inner =
        taxiPeek instanceof HTMLElement
          ? taxiPeek
          : stopPeeks.length > 1 && peekStack instanceof HTMLElement
            ? peekStack
            : stopPeek instanceof HTMLElement
              ? stopPeek
              : mapStation instanceof HTMLElement
                ? (mapStation.querySelector(".mtr-station-lines-inner") ?? mapStation)
                : null;
      if (!(inner instanceof HTMLElement)) return;
      if (observed !== inner) {
        if (observed) ro.unobserve(observed);
        ro.observe(inner);
        observed = inner;
      }
      const { lo, hi } = sheetRange(false, settings.filter);
      const mid = boardMid(false, settings.filter, lo, hi);
      const lines = mapStation instanceof HTMLElement ? mapStation.querySelectorAll(".mtr-line").length : 0;
      // Stop peek default hugs last in-service card (mid). Taxi/single-line lock lo=hi.
      const home =
        stopPeek instanceof HTMLElement
          ? mid
          : taxiPeek instanceof HTMLElement || lines <= 1
            ? lo
            : hi;
      const switched = peekSnapId.current !== peekSnapKey;
      const atMin = peekLo.current == null || Math.abs(sheetVal.current - peekLo.current) < 0.025;
      const atMax = peekHi.current != null && Math.abs(sheetVal.current - peekHi.current) < 0.025;
      const atMid = peekMidRef.current != null && Math.abs(sheetVal.current - peekMidRef.current) < 0.04;
      const over = sheetVal.current > hi + 0.008;
      peekSnapId.current = peekSnapKey;
      peekLo.current = lo;
      peekHi.current = hi;
      if (switched) {
        if (Math.abs(sheetVal.current - home) >= 0.008) goSheet(home);
        peekMidRef.current = stopPeek instanceof HTMLElement && Math.abs(home - mid) <= 0.04 ? mid : null;
        return;
      }
      if (atMin) {
        peekMidRef.current = null;
        if (Math.abs(sheetVal.current - lo) >= 0.008) goSheet(lo);
        return;
      }
      if (stopPeek instanceof HTMLElement && atMid) {
        if (Math.abs(sheetVal.current - mid) >= 0.008) goSheet(mid);
        peekMidRef.current = mid;
        return;
      }
      if (over || atMax) {
        peekMidRef.current = null;
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
  }, [openId, draft, adding, peekSnapKey, peekStationId]);

  useEffect(() => {
    if (sheetDrag.current || peekSnapKey) return;
    const filter = settings.filter;
    // After tab / map-driven filter change, settle then hug spare space under the last card.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => hugDownIfSpare(filter));
    });
    return () => cancelAnimationFrame(frame);
  }, [openId, draft, adding, peekSnapKey, settings.filter]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("pin");
    const stashed = sessionStorage.getItem("ia.open");
    if (id) {
      setRouteFocus(0);
      setOpenId(id);
    }
    if (stashed) {
      sessionStorage.removeItem("ia.open");
      try {
        const parsed = JSON.parse(stashed) as { kind?: string; pin?: Pin; place?: NearbyPlace };
        if (parsed.kind === "route" && parsed.pin) {
          setRouteFocus(0);
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
    void Promise.all([loadTaxiStands(), loadTramPack(), loadFerryPiers(), loadKaitoPack()]).then(
      ([nextTaxis, pack, nextPiers, kaito]) => {
        if (!alive) return;
        setTaxis(nextTaxis);
        setTramStops(tramStopsOf(pack));
        setPiers([...nextPiers, ...kaitoPiersOf(kaito)]);
        setPlacesReady(true);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const filter = settings.filter;

  // Android back / gesture: leave a mode tab for All before exiting the app.
  useEffect(() => {
    if (filter === "all") {
      if (hasLayer("filter")) silentDismiss("filter");
      return;
    }
    if (hasLayer("filter")) return;
    openLayer(() => setFilter("all"), "filter");
  }, [filter, setFilter]);

  const visible = useMemo(() => {
    const allowed = pins.filter((pin) => {
      const mode = companyMode(pin.company);
      if (!devOn && (mode === "tram" || mode === "ferry")) return false;
      return filter === "all" || mode === filter;
    });
    if (filter !== "all") return allowed;
    if (!db) return allowed;
    return [...allowed].sort((a, b) => {
      const da = pinStopDistance(db, a, origin);
      const dbDist = pinStopDistance(db, b, origin);
      if (da === dbDist) return 0;
      return da < dbDist ? -1 : 1;
    });
  }, [pins, filter, db, origin, devOn]);

  const { inServicePins, outServicePins } = useMemo(() => {
    const inServicePins: Pin[] = [];
    const outServicePins: Pin[] = [];
    for (const pin of visible) {
      if (pinInService(db, pin, origin, etas[pin.id])) inServicePins.push(pin);
      else outServicePins.push(pin);
    }
    return { inServicePins, outServicePins };
  }, [visible, db, origin, etas]);

  const nearbyAll = useMemo(() => {
    const raw = nearbyPlaces(db, origin, "all", taxis, tramStops, piers);
    if (devOn) return raw;
    return raw.filter((place) => place.mode !== "tram" && place.mode !== "ferry");
  }, [db, origin, taxis, tramStops, piers, devOn]);
  const places = useMemo(
    () => (filter === "all" ? nearbyAll : nearbyAll.filter((place) => place.mode === filter)),
    [nearbyAll, filter],
  );
  const mtrBoardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const station of nearbyMtrStations(db, origin)) ids.add(`mtr:${station.stopId}`);
    for (const station of nearbyLrtStops(db, origin)) ids.add(`lrt:${station.stopId}`);
    return ids;
  }, [db, origin]);
  const taxiBoardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const place of nearbyAll) {
      if (place.kind === "taxi" || place.mode === "taxi") ids.add(place.id);
    }
    return ids;
  }, [nearbyAll]);
  const chipFilters = useMemo(() => {
    if (devOn && devShowAll) {
      return ["all", "bus", "minibus", "mtr", "ferry", "tram", "taxi"] as BoardFilter[];
    }
    const modes = new Set(nearbyAll.map((place) => place.mode));
    const pinModes = new Set(pins.map((pin) => companyMode(pin.company)));
    const ids: BoardFilter[] = ["all"];
    for (const id of ["bus", "minibus", "mtr", "ferry", "tram", "taxi"] as const) {
      if (id === "ferry" || id === "tram") {
        if (devOn && modes.has(id)) ids.push(id);
        continue;
      }
      if (id === "taxi") {
        if (modes.has(id)) ids.push(id);
        continue;
      }
      if (modes.has(id) || pinModes.has(id)) ids.push(id);
    }
    return ids;
  }, [nearbyAll, pins, devShowAll, devOn]);

  useEffect(() => {
    if (!db || !placesReady) return;
    if (keepTaxiFocus.current) return;
    if (filter !== "all" && !chipFilters.includes(filter)) setFilter("all");
  }, [db, placesReady, filter, chipFilters, setFilter]);
  const [mtrExpandTick, setMtrExpandTick] = useState(0);

  /** Snap home board to measured mid for this filter (after paint so the card exists). */
  const snapBoardMid = (nextFilter: BoardFilter) => {
    const apply = () => {
      if (sheetDrag.current || openId || draft || adding) return;
      const { lo, hi } = sheetRange(false, nextFilter);
      const mid = boardMid(false, nextFilter, lo, hi);
      goSheet(mid, { lo, hi });
      if (isWatchboard(nextFilter)) pinMidRef.current = mid;
    };
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  };

  /** Expand the nearest station/LRT card and always reset sheet to default mid. */
  const expandFirstMtrCard = () => {
    setSelected([]);
    setTaxiFocus(null);
    setTaxiFocusId(null);
    setMtrExpandTick((n) => n + 1);
    if (!nearbyMtrStations(db, origin)[0] && !nearbyLrtStops(db, origin)[0]) {
      snapBoardMid("mtr");
      return;
    }
    snapBoardMid("mtr");
  };

  /** Select closest taxi stand and reset sheet to taxi default mid (one card hug). */
  const selectClosestTaxi = () => {
    setSelected([]);
    const closest = nearbyAll.find((place) => place.kind === "taxi" || place.mode === "taxi");
    if (closest) {
      setTaxiFocusId(closest.id);
      setTaxiFocus({ lat: closest.lat, lng: closest.lng, token: Date.now() });
    } else {
      setTaxiFocus(null);
      setTaxiFocusId(null);
    }
    snapBoardMid("taxi");
  };

  useEffect(() => {
    const keep = keepTaxiFocus.current;
    if (keep) keepTaxiFocus.current = false;
    if (filter === "mtr") {
      // Map pin kept an mtr/lrt id — leave it. Chip entry opens first card + default mid.
      if (keep && (taxiFocusId?.startsWith("mtr:") || taxiFocusId?.startsWith("lrt:"))) return;
      if (!keep) {
        setTaxiFocus(null);
        setTaxiFocusId(null);
        setMtrExpandTick((n) => n + 1);
        snapBoardMid("mtr");
      } else {
        setMtrExpandTick((n) => n + 1);
      }
      return;
    }
    if (filter === "taxi") {
      if (keep) return;
      selectClosestTaxi();
      return;
    }
    if (filter === "bus" || filter === "minibus") {
      if (keep) return;
      setSelected([]);
      setTaxiFocus(null);
      setTaxiFocusId(null);
      snapBoardMid(filter);
      return;
    }
    if (filter === "ferry" || filter === "tram") {
      if (keep) return;
      return;
    }
    if (keep) return;
    setTaxiFocus(null);
    setTaxiFocusId(null);
    if (isWatchboard(filter)) snapBoardMid(filter);
  }, [filter]);
  const allPlaces = useMemo(
    () => (devOn && devShowAll ? everyPlace(db, origin, taxis, tramStops, piers) : null),
    // Origin only sorts this set; panning must not rebuild every marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devOn, devShowAll, db, taxis, tramStops, piers],
  );
  const ferryPlaces = useMemo(() => places.filter((place) => place.mode === "ferry"), [places]);
  const mapPlaces = useMemo(() => {
    const keep = (place: (typeof places)[number]) =>
      devOn || (place.mode !== "tram" && place.mode !== "ferry");
    if (!allPlaces) return (filter === "ferry" ? ferryPlaces : places).filter(keep);
    if (filter === "all") return allPlaces.filter(keep);
    // MTR tab: heavy-rail stations + Light Rail stops (same mode bucket).
    if (filter === "mtr") {
      return allPlaces.filter((place) => place.kind === "station" || place.kind === "lrt");
    }
    return allPlaces.filter((place) => place.mode === filter).filter(keep);
  }, [allPlaces, filter, ferryPlaces, places, devOn]);

  useEffect(() => {
    if (selected.length === 0 || !db) {
      setPeekEtas({});
      return;
    }
    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
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
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, ETA_POLL_MS);
    const onVis = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [selected, db, settings.lang, reconnectTick]);

  // Stale focusToken from a prior session must not steal FitRoute on first paint.
  useEffect(() => {
    setRouteFocus(0);
  }, [openId, draft?.id]);

  const openDraft = (pin: Pin) => {
    openDetailLayer();
    setTaxiFocus(null);
    setTaxiFocusId(null);
    setRouteFocus(0);
    setOpenId(null);
    setDraft(pin);
  };

  const openSaved = (id: string) => {
    openDetailLayer();
    setSelected([]);
    setTaxiFocus(null);
    setTaxiFocusId(null);
    setRouteFocus(0);
    setDraft(null);
    setOpenId(id);
  };

  const handleRef = useRef<HTMLButtonElement>(null);

  const onHandleDown = (e: PointerEvent<HTMLElement>, opts: { toggle: boolean; grab: boolean }) => {
    if (e.button !== 0) return;
    if (opts.grab) {
      // Cancel the control's click and the browser's pan so the gesture stays a drag.
      e.preventDefault();
      e.stopPropagation();
    }
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startH = sheetVal.current;
    const grabEl = e.currentTarget;
    let moved = false;
    let held = opts.grab;
    let dragRange: { lo: number; hi: number } | null = null;
    const lockRange = (): { lo: number; hi: number } => {
      const next = dragRange ?? sheetRange(Boolean(openId || draft), settings.filter);
      dragRange = next;
      return next;
    };
    const samples: SheetSample[] = [{ y: startY, t: performance.now() }];
    if (opts.grab) {
      sheetDrag.current = true;
      lockRange();
      setSheetDragClass(true);
      try {
        grabEl.setPointerCapture(pointerId);
      } catch {
        // Emulated touch and synthetic events often have no capturable pointer.
      }
    }
    const takeGrab = (ev: globalThis.PointerEvent) => {
      if (held) return;
      held = true;
      sheetDrag.current = true;
      lockRange();
      setSheetDragClass(true);
      ev.preventDefault();
      ev.stopPropagation();
      try {
        grabEl.setPointerCapture(pointerId);
      } catch {
        /* emulated */
      }
    };
    const onMove = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const now = performance.now();
      const dy = startY - ev.clientY;
      if (Math.abs(dy) > 3) {
        moved = true;
        takeGrab(ev);
      }
      if (!held) return;
      ev.preventDefault();
      ev.stopPropagation();
      pushSheetSample(samples, ev.clientY, now);
      const { lo, hi } = lockRange();
      const next = clampSheet(startH + dy / window.innerHeight, lo, hi);
      sheetVal.current = next;
      writeSheetH(next);
      syncMtrSqueeze(next);
    };
    const finish = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      sheetDrag.current = false;
      setSheetDragClass(false);
      if (moved) {
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
        const now = performance.now();
        pushSheetSample(samples, ev.clientY, now);
        const { lo, hi } = lockRange();
        const h = clampSheet(sheetVal.current, lo, hi);
        const vel = sheetReleaseVel(samples, now);
        const to = vel !== 0 ? (vel > 0 ? hi : lo) : h;
        const route = Boolean(openId || draft);
        const mid = boardMid(route, settings.filter, lo, hi);
        const from = h;
        goSheet(to, { lo, hi });
        if (route) {
          if (Math.abs(to - mid) <= 0.04) {
            routeMidRef.current = mid;
            routeLoRef.current = null;
          } else if (Math.abs(to - lo) <= 0.04) {
            routeLoRef.current = lo;
            routeMidRef.current = null;
          } else {
            routeMidRef.current = null;
            routeLoRef.current = null;
          }
        } else if (isWatchboard(settings.filter)) {
          pinMidRef.current = Math.abs(to - mid) <= 0.04 ? mid : null;
        } else if (selected[0]?.kind === "stop") {
          peekMidRef.current = Math.abs(to - mid) <= 0.04 ? mid : null;
        }
        scheduleScrollSelectedOnMid(route, from, to, lo, hi, mid);
      } else if (opts.toggle) {
        const { lo, hi } = sheetRange(Boolean(openId || draft), settings.filter);
        const mid = boardMid(Boolean(openId || draft), settings.filter, lo, hi);
        const h = clampSheet(sheetVal.current, lo, hi);
        const near = 0.03;
        let nearest: "lo" | "mid" | "hi";
        if (h <= lo + near) nearest = "lo";
        else if (h >= hi - near) nearest = "hi";
        else {
          const dLo = Math.abs(h - lo);
          const dMid = Math.abs(h - mid);
          const dHi = Math.abs(h - hi);
          nearest = dMid <= dLo && dMid <= dHi ? "mid" : dHi <= dLo ? "hi" : "lo";
        }
        // Same cycle everywhere: hi→mid→lo→hi. If mid sits on hi, skip mid so tap still progresses.
        const target =
          nearest === "hi" ? (Math.abs(mid - hi) > near ? mid : lo) : nearest === "mid" ? lo : hi;
        const route = Boolean(openId || draft);
        const from = h;
        goSheet(target, { lo, hi });
        if (route) {
          if (Math.abs(target - mid) <= 0.04) {
            routeMidRef.current = mid;
            routeLoRef.current = null;
          } else if (Math.abs(target - lo) <= 0.04) {
            routeLoRef.current = lo;
            routeMidRef.current = null;
          } else {
            routeMidRef.current = null;
            routeLoRef.current = null;
          }
        } else if (isWatchboard(settings.filter)) {
          pinMidRef.current = Math.abs(target - mid) <= 0.04 ? mid : null;
        } else if (selected[0]?.kind === "stop") {
          peekMidRef.current = Math.abs(target - mid) <= 0.04 ? mid : null;
        }
        // Default mid via handle: wait for height, then scroll selected stop into view.
        scheduleScrollSelectedOnMid(route, from, target, lo, hi, mid);
        if (route && Math.abs(target - lo) <= 0.04) scheduleScrollAfterHeight(from, target, lo, hi);
      }
      try {
        if (grabEl.hasPointerCapture(pointerId)) grabEl.releasePointerCapture(pointerId);
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
    // Window capture, not the handle: the hit target is short, so the pointer
    // leaves it immediately, and touch/emulation does not retarget moves back.
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
    endDrag.current = stop;
  };

  const onSheetSlopDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const handle = handleRef.current;
    if (!handle) return;
    const node = e.target instanceof Element ? e.target : null;
    if (node?.closest(".sheet-handle, .sheet-drag-hit")) return;
    const box = handle.getBoundingClientRect();
    const band = box.height;
    if (band < 8) return;
    if (e.clientX < box.left || e.clientX > box.right) return;
    if (e.clientY < box.bottom || e.clientY > box.bottom + band) return;
    onHandleDown(e, { toggle: false, grab: false });
  };

  const renderPeekRouteCard = (place: NearbyPlace, leg: NearbyPlace["routes"][number]) => {
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
        {leg.company === "mtr" || leg.company === "lightRail" ? (
          <div className="card-top">
            {leg.company === "lightRail" ? (
              <LrtLogo className="mode-logo" lines={[routeColor("lightRail", leg.route)]} />
            ) : (
              <MtrLogo className="mode-logo" lines={[routeColor("mtr", leg.route)]} />
            )}
            <div className="card-meta">
              <div className="dest">{towardLabel(settings.lang, leg.dest)}</div>
              <div className="stop">
                {leg.company === "lightRail"
                  ? `${nameOf(settings.lang, place.name)} (${leg.route})`
                  : `${nameOf(settings.lang, place.name)} (${mtrLineName(settings.lang, leg.route)})`}
              </div>
            </div>
          </div>
        ) : (
          <div className="card-top">
            {leg.company === "tram" ? null : (
              <span
                className="route-badge"
                style={{
                  background: routeColor(leg.company, route?.route ?? leg.route),
                  color: onRouteColor(leg.company, route?.route ?? leg.route),
                }}
              >
                {leg.route}
              </span>
            )}
            <div className="card-meta">
              <div className="dest">{towardLabel(settings.lang, leg.dest)}</div>
            </div>
          </div>
        )}
        {leg.company === "tram" ? null : peekEtas[etaKey]?.some((row) => row.minutes != null) ? (
          <div className="card-eta">
            <EtaStrip
              arrivals={peekEtas[etaKey]}
              lang={settings.lang}
              company={leg.company}
              openOnClick={() =>
                openDraft({
                  id: etaKey,
                  routeId: leg.routeId,
                  company: leg.company,
                  stopId: located.stopId,
                  stopSeq: located.stopSeq,
                  auto: true,
                })
              }
            />
          </div>
        ) : null}
      </article>
    );
  };

  const renderWatchPin = (pin: Pin, zone: "in" | "out") => {
    if (!db) return null;
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
        onOpen={() => openSaved(pin.id)}
        lineColors={
          pin.company === "mtr"
            ? mtrLineColorsAtStop(db, pin.stopId)
            : pin.company === "lightRail"
              ? lrtLineColorsAtStop(db, pin.stopId)
              : undefined
        }
        distance={filter === "all" ? pinStopDistance(db, pin, origin) : undefined}
        zone={zone}
        atClosest={isStarredStopClosest(db, pin, origin)}
      />
    );
  };

  // --- render ---
  const showDetail = Boolean(openId || draft);
  const showSearch = adding && layerTop !== "peek" && layerTop !== "detail";
  const showPeek = !showDetail && selected.length > 0 && layerTop !== "search";

  return (
    <div
      ref={homeRef}
      className="home"
      style={{ "--sheet-h": `${sheet * 100}dvh`, "--sheet-dur": `${sheetDur}ms` } as CSSProperties}
    >
      <Map
        origin={origin}
        user={devPinMode === "follow" ? null : pos}
        places={mapPlaces}
        selectedId={selected[0]?.id ?? taxiFocusId}
        onSelect={(place) => {
          if (openId || draft) return;
          if (place.kind === "taxi" || place.mode === "taxi") {
            if (taxiBoardIds.has(place.id)) {
              if (getTopLayer() === "peek") closeTopLayer();
              setSelected([]);
              keepTaxiFocus.current = true;
              if (filter !== "taxi") setFilter("taxi");
              setTaxiFocusId(place.id);
              setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
              return;
            }
            openPeekLayer();
            setSelected([place]);
            setTaxiFocusId(place.id);
            setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
            return;
          }
          if (place.kind === "station" || place.mode === "mtr") {
            if (mtrBoardIds.has(place.id)) {
              if (getTopLayer() === "peek") closeTopLayer();
              setSelected([]);
              keepTaxiFocus.current = true;
              if (filter !== "mtr") setFilter("mtr");
              setTaxiFocusId(place.id);
              setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
              return;
            }
            openPeekLayer();
            setSelected([place]);
            setTaxiFocusId(place.id);
            setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
            return;
          }
          if ((filter === "ferry" && place.mode === "ferry") || (filter === "tram" && place.mode === "tram")) {
            setSelected([]);
            setTaxiFocusId(place.id);
            setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
            return;
          }
          if (place.kind === "stop") snapStopPeekToTop();
          openPeekLayer();
          setSelected([place]);
          setTaxiFocusId(place.id);
          setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
        }}
        onSelectGroup={(group) => {
          if (openId || draft) return;
          const stand = group.find((place) => place.kind === "taxi" || place.mode === "taxi");
          if (stand) {
            if (taxiBoardIds.has(stand.id)) {
              if (getTopLayer() === "peek") closeTopLayer();
              setSelected([]);
              keepTaxiFocus.current = true;
              if (filter !== "taxi") setFilter("taxi");
              setTaxiFocusId(stand.id);
              setTaxiFocus({ lat: stand.lat, lng: stand.lng, token: Date.now() });
              return;
            }
            openPeekLayer();
            setSelected(group.filter((place) => place.kind === "taxi" || place.mode === "taxi"));
            setTaxiFocusId(stand.id);
            setTaxiFocus({ lat: stand.lat, lng: stand.lng, token: Date.now() });
            return;
          }
          const station = group.find((place) => place.kind === "station" || place.mode === "mtr");
          if (station) {
            if (mtrBoardIds.has(station.id)) {
              if (getTopLayer() === "peek") closeTopLayer();
              setSelected([]);
              keepTaxiFocus.current = true;
              if (filter !== "mtr") setFilter("mtr");
              setTaxiFocusId(station.id);
              setTaxiFocus({ lat: station.lat, lng: station.lng, token: Date.now() });
              return;
            }
            openPeekLayer();
            setSelected(group.filter((place) => place.kind === "station" || place.mode === "mtr"));
            setTaxiFocusId(station.id);
            setTaxiFocus({ lat: station.lat, lng: station.lng, token: Date.now() });
            return;
          }
          const pier =
            filter === "ferry"
              ? group.find((place) => place.mode === "ferry")
              : filter === "tram"
                ? group.find((place) => place.mode === "tram")
                : undefined;
          if (pier) {
            setSelected([]);
            setTaxiFocusId(pier.id);
            setTaxiFocus({ lat: pier.lat, lng: pier.lng, token: Date.now() });
            return;
          }
          if (group.some((place) => place.kind === "stop")) snapStopPeekToTop();
          openPeekLayer();
          setSelected(group);
        }}
        recenterToken={recenterToken}
        awaitingGps={!pos && !gpsDenied}
        sheetFrac={sheet}
        onRecenter={() => {
          // Spin is primed on pointerdown in HomeMap; re-prime here for keyboard activation.
          primeAutomatedCameraBusy();
          if (openId || draft) {
            setLocateToken((n) => n + 1);
            return;
          }
          // Fly to cached watch origin only — background GPS already keeps pos fresh.
          setRecenterToken((n) => n + 1);
        }}
        frameTaxi={filter === "taxi" && !devPin && !(devOn && devShowAll) && !openId && !draft}
        frameFerry={filter === "ferry" && !(devOn && devShowAll) && !openId && !draft}
        framePlaces={ferryPlaces}
        taxiFocus={openId || draft ? null : taxiFocus}
        dev={devOn}
        pinMode={devPinMode}
        showAll={devOn && devShowAll}
        onPinCycle={setDevPinMode}
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
      <section ref={sheetBoxRef} className="sheet" onPointerDown={onSheetSlopDown}>
        <div
          className="sheet-drag-hit"
          aria-hidden
          onPointerDown={(e) => onHandleDown(e, { toggle: false, grab: true })}
        />
        <button
          ref={handleRef}
          type="button"
          className="sheet-handle"
          aria-label="Sheet"
          onPointerDown={(e) => onHandleDown(e, { toggle: true, grab: true })}
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
            <div className="ptr">
            {openId || draft ? (
              <RouteSheet
                pinId={openId ?? ""}
                draft={draft}
                seedArrivals={draft ? peekEtas[draft.id] : undefined}
                refreshToken={draftRefresh}
                onDraft={setDraft}
                onSaved={(id) => {
                  if (id) {
                    setDraft(null);
                    setOpenId(id);
                  } else {
                    setOpenId(null);
                  }
                }}
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
              onReselect={(id) => {
                if (id === "mtr") expandFirstMtrCard();
                if (id === "taxi") selectClosestTaxi();
              }}
            />
            <div
              className={filter === "mtr" && !showPeek ? undefined : "mtr-board-warm"}
              aria-hidden={filter !== "mtr" || showPeek}
            >
              <MtrBoard
                tick={refreshTick}
                expandTick={mtrExpandTick}
                warmFirst={filter !== "mtr" || showPeek}
                focusedId={
                  filter === "mtr" && !showPeek && (taxiFocusId?.startsWith("mtr:") || taxiFocusId?.startsWith("lrt:"))
                    ? taxiFocusId
                    : null
                }
                squeeze={mtrSqueeze}
                onFocus={(place) => {
                  if (filter !== "mtr" || showPeek) return;
                  if (!place) {
                    setTaxiFocusId(null);
                    setTaxiFocus(null);
                    return;
                  }
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
                onOpen={openDraft}
              />
            </div>
            {showPeek ? (
              <div
                className={`stack peek${
                  selected[0]?.kind === "station" || selected[0]?.kind === "lrt" ? " is-bare" : ""
                }`}
              >
                {selected.map((place) => (
                  <div key={place.id} className={`stack${place.kind === "taxi" ? " peek-taxi" : place.kind === "stop" ? " peek-stop" : ""}`}>
                    {place.kind === "station" || place.kind === "lrt" ? (
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
                    ) : place.kind === "stop" ? (
                      (() => {
                        const { inService, outService } = splitPeekLegs(place.routes, place.id, peekEtas);
                        return (
                          <>
                            {inService.map((leg) => renderPeekRouteCard(place, leg))}
                            {inService.length > 0 && outService.length > 0 ? (
                              <div className="pin-zone-break" role="separator">
                                {t(settings.lang, "Not in service", "暫無班次")}
                              </div>
                            ) : null}
                            {outService.map((leg) => renderPeekRouteCard(place, leg))}
                          </>
                        );
                      })()
                    ) : (
                      place.routes.map((leg) => renderPeekRouteCard(place, leg))
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
                squeeze={mtrSqueeze}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
                onOpen={openDraft}
              />
            ) : filter === "mtr" ? null : filter === "tram" ? (
              <TramBoard
                tick={refreshTick}
                focusedId={taxiFocusId?.startsWith("tram:") ? taxiFocusId : null}
                squeeze={mtrSqueeze}
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
                focusToken={taxiFocus?.token}
                squeeze={mtrSqueeze}
                onFocus={(place) => {
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
              />
            ) : filter === "bus" || filter === "minibus" ? (
              <StopBoard
                places={places}
                origin={origin}
                onOpen={(place) => {
                  openPeekLayer();
                  setSelected([place]);
                  setTaxiFocusId(place.id);
                  setTaxiFocus({ lat: place.lat, lng: place.lng, token: Date.now() });
                }}
              />
            ) : (
              <div className="stack pin-watch">
                {!pinsReady || !db ? (
                  <SkeletonBoard />
                ) : dbError ? (
                  <p className="muted">{t(settings.lang, "Routes unavailable", "未能載入路線")}</p>
                ) : visible.length === 0 ? (
                  <p className="muted">{t(settings.lang, "Pin a route", "加入路線")}</p>
                ) : (
                  <>
                    {inServicePins.map((pin) => renderWatchPin(pin, "in"))}
                    {outServicePins.length > 0 ? (
                      <div className="pin-zone-break" role="separator">
                        {t(settings.lang, "Out of service zone", "服務範圍外")}
                      </div>
                    ) : null}
                    {outServicePins.map((pin) => renderWatchPin(pin, "out"))}
                  </>
                )}
                {pinsReady && filter === "all" ? <DataSources lang={settings.lang} /> : null}
              </div>
            )}
              </>
            )}
            </div>
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

function isWatchboard(filter: BoardFilter): boolean {
  return filter === "all";
}

function isOneCardFilter(filter: BoardFilter): boolean {
  return filter === "taxi" || filter === "mtr";
}

function pinStopDistance(db: EtaDb, pin: Pin, origin: LatLng | null | undefined): number {
  if (!origin) return Number.POSITIVE_INFINITY;
  const loc = db.stopList[pin.stopId]?.location;
  if (!loc) return Number.POSITIVE_INFINITY;
  return haversine(origin, loc);
}

function pinHasLiveEta(arrivals: Arrival[] | undefined): boolean {
  if (arrivals === undefined) return true;
  return arrivals.some((row) => row.minutes != null);
}

function pinInService(db: EtaDb | null, pin: Pin, origin: LatLng | null | undefined, arrivals: Arrival[] | undefined): boolean {
  if (!pinHasLiveEta(arrivals)) return false;
  if (!origin || !db) return true;
  const distance = pinStopDistance(db, pin, origin);
  if (!Number.isFinite(distance)) return true;
  return distance <= STOP_RADIUS;
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
