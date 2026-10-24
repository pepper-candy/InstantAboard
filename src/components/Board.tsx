"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent } from "react";
import { closeTopLayer, dismissAllLayers, getTopLayer, hasLayer, openLayer, silentDismiss, subscribeLayers } from "@/lib/backLayer";
import { useReconnectTick } from "@/hooks/useOffline";
import { mtrLineName, routeColor } from "@/lib/colors";
import { haversine, type LatLng } from "@/lib/geo";
import { companyMode } from "@/lib/mode";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { loadTaxiStands, taxiStandLabel } from "@/lib/taxi";
import { kaitoPiersOf, loadFerryPiers, loadKaitoPack, loadTramPack, tramStopsOf, type FerryPier } from "@/lib/extras";
import {
  everyPlace,
  lrtLineColorsAtStop,
  mtrLineColorsAtStop,
  nearbyLrtStops,
  nearbyMtrStations,
  nearbyPlaces,
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
import { TaxiBoard } from "./TaxiBoard";
import { TramBoard } from "./TramBoard";
import { fetchArrivals } from "@/lib/eta";
import { ETA_POLL_MS } from "@/hooks/useEtas";
import { extraSheetPxToShowCard, focusedBoardCard, scrollSheetCardTop, sheetCardSeam, sheetHugSeam } from "@/lib/sheetScroll";
import { primeAutomatedCameraBusy } from "@/lib/mapCameraBusy";

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

/** Viewport edge plus the nearest scrollport's scrollTop. Sticky chips stay outside this. */
function layoutEdge(el: Element, edge: "top" | "bottom"): number {
  let scrollTop = 0;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") {
      scrollTop = node.scrollTop;
      break;
    }
  }
  return el.getBoundingClientRect()[edge] + scrollTop;
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
  if (stops instanceof Element) return measurePeekMin(layoutEdge(stops, "top"));
  if (eta instanceof Element) return measurePeekMin(layoutEdge(eta, "bottom"));
  return measurePeekMin(undefined);
}

/** Extra px below chips in lo — keep 0 so the next card’s top edge never peeks above the nav. */
const BOARD_CHIP_PAD = 0;

function measureTaxiPeekLock(): number | null {
  const taxi = document.querySelector(".sheet-body:not(.is-route) .stack.peek .peek-taxi");
  if (!(taxi instanceof HTMLElement)) return null;
  return measurePeekMin(taxi.getBoundingClientRect().bottom + 12);
}

function measurePeekStationMin(): number {
  const taxiLock = measureTaxiPeekLock();
  if (taxiLock != null) return taxiLock;
  const mapStation = document.querySelector(".sheet-body:not(.is-route) .mtr-station.is-map");
  if (mapStation instanceof HTMLElement) {
    const lines = mapStation.querySelectorAll(".mtr-line");
    const pad = 12;
    // Interchange: bottom edge is the first line (must stay visible).
    // Single line: min = max = the whole card, so height is locked.
    if (lines.length > 1 && lines[0] instanceof HTMLElement) {
      return measurePeekMin(layoutEdge(lines[0], "bottom") + pad);
    }
    return measurePeekMin(layoutEdge(mapStation, "bottom") + pad);
  }
  const card =
    document.querySelector(".sheet-body:not(.is-route) .swipe-front > article.card") ??
    document.querySelector(".sheet-body:not(.is-route) .ptr > .stack > .card");
  return measurePeekMin(card instanceof Element ? layoutEdge(card, "top") : undefined);
}

/** Chips-only lo: size from handle+chips layout, ignore scroll so lo can't shrink while clipped. */
function measureChipsPeekMin(): number | null {
  const sheetEl = document.querySelector(".sheet");
  const handle = document.querySelector(".sheet-handle");
  const chips = document.querySelector(".sheet-body:not(.is-route) .chips");
  if (!(sheetEl instanceof HTMLElement) || !(chips instanceof HTMLElement)) return null;
  const handleH = handle instanceof HTMLElement ? handle.offsetHeight : 28;
  // Seam at chips border-box bottom (not margin). The old +6 pad lined up with the
  // first card top, so taxi/MTR card chrome (bg + is-on outline) showed a hairline
  // above the nav when fully collapsed.
  const seamFromSheetTop = handleH + chips.offsetHeight + BOARD_CHIP_PAD;
  return measurePeekMin(sheetEl.getBoundingClientRect().top + seamFromSheetTop);
}

function measureBoardPeekMin(filter: BoardFilter): number {
  const peek = document.querySelector(".sheet-body:not(.is-route) .stack.peek");
  if (peek instanceof HTMLElement) return measurePeekStationMin();
  // All home filters (all/bus/minibus/mtr/taxi/…): lo must fully fit the mode chips row.
  void filter;
  const chipsMin = measureChipsPeekMin();
  if (chipsMin != null) return chipsMin;
  return measurePeekStationMin();
}

/** First/nearest list card for the sheet-mid measurement (taxi / MTR / tram). */
function firstBoardCard(filter: BoardFilter): HTMLElement | null {
  const body = document.querySelector(".sheet-body:not(.is-route)");
  if (!(body instanceof HTMLElement)) return null;
  if (filter === "taxi") {
    return body.querySelector(".taxi-card.is-on, .taxi-card");
  }
  if (filter === "mtr" || filter === "tram") {
    return body.querySelector(".mtr-station.is-on") ?? body.querySelector(".mtr-station");
  }
  return null;
}

/**
 * Default middle for taxi / MTR / tram home board: the height that fully shows
 * the first/nearest card (chips + that one card). Null for other modes / desktop.
 */
function measureSheetMid(filter: BoardFilter): number | null {
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return null;
  if (filter !== "taxi" && filter !== "mtr" && filter !== "tram") return null;
  const card = firstBoardCard(filter);
  if (!(card instanceof HTMLElement)) return null;
  return measurePeekMin(sheetCardSeam(card) + 12);
}

/** Route detail default mid: current route lo (ETA/min) plus the selected/nearest stop row. */
function measureRouteSheetMid(): number | null {
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return null;
  const on =
    document.querySelector(".detail-stops > .is-on-stop") ??
    document.querySelector(".detail-stops > .tap-row.is-on-stop") ??
    document.querySelector(".detail-stops > .card.is-on-stop");
  if (on instanceof HTMLElement) return measurePeekMin(layoutEdge(on, "bottom") + 12);
  const first = document.querySelector(".detail-stops > .tap-row, .detail-stops > .card");
  if (first instanceof HTMLElement) return measurePeekMin(layoutEdge(first, "bottom") + 12);
  return null;
}

/** Mid snap / default settle: route hugs selected stop; taxi/MTR/tram hug first card; else SHEET_DEFAULT. */
function boardMid(route: boolean, filter: BoardFilter, lo: number, hi: number): number {
  if (route) return clampSheet(measureRouteSheetMid() ?? SHEET_DEFAULT, lo, hi);
  return clampSheet(measureSheetMid(filter) ?? SHEET_DEFAULT, lo, hi);
}

function measureSheetContentMax(): number {
  const ceiling = measureSheetMax();
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return ceiling;
  const taxiLock = measureTaxiPeekLock();
  if (taxiLock != null) return Math.min(ceiling, Math.max(taxiLock, SHEET_MIN_FLOOR));
  const seam = sheetHugSeam();
  if (seam == null) return ceiling;
  const needed = measurePeekMin(seam + 12);
  return Math.min(ceiling, Math.max(needed, SHEET_MIN_FLOOR));
}

function sheetRange(route: boolean, filter: BoardFilter): { lo: number; hi: number } {
  const hi = measureSheetContentMax();
  const lo = Math.min(hi, route ? measureRoutePeekMin() : measureBoardPeekMin(filter));
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
    busy,
    settings,
    setFilter,
    removePin,
    movePin,
    refreshPin,
    pos,
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
  const hugHi = useRef<number | null>(null);
  const keepTaxiFocus = useRef(false);
  const layerTop = useSyncExternalStore(subscribeLayers, getTopLayer, () => null);
  if (!sheetDrag.current) sheetVal.current = sheet;

  const writeSheetH = (h: number) => {
    homeRef.current?.style.setProperty("--sheet-h", `${h * 100}dvh`);
  };

  const setSheetDragClass = (on: boolean) => {
    sheetBoxRef.current?.classList.toggle("is-drag", on);
  };

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

  const peekStationId =
    selected[0]?.kind === "station" || selected[0]?.kind === "lrt" ? selected[0].id : null;
  const peekTaxiId = selected[0]?.kind === "taxi" ? selected[0].id : null;
  const peekSnapKey = peekStationId ?? peekTaxiId;
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
    if (settings.filter !== "taxi" && settings.filter !== "mtr") return false;
    const card = focusedBoardCard(taxiFocusId);
    if (!card) return false;
    if (card.classList.contains("mtr-station") && !card.classList.contains("is-on")) {
      card.classList.add("is-on");
    }
    const { lo, hi } = sheetRange(false, settings.filter);
    // Chip-entry keeps nearest selected; do not fight an intentional chips-only collapse.
    if (sheetVal.current <= lo + 0.03) return false;
    const extraPx = extraSheetPxToShowCard(card);
    const soft = Math.min(
      hi,
      Math.max(
        sheetVal.current,
        measurePeekMin(sheetCardSeam(card) + 12),
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

  // Enter/exit route: settle height (route mid needs a frame for .is-on-stop to exist).
  useLayoutEffect(() => {
    const on = Boolean(openId || draft);
    if (on === wasRoute.current) return;
    wasRoute.current = on;
    hugHi.current = null;
    const apply = () => {
      if (sheetDrag.current) return;
      const { lo, hi } = sheetRange(on, settings.filter);
      goSheet(boardMid(on, settings.filter, lo, hi), { lo, hi });
    };
    apply();
    if (!on) return;
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }, [openId, draft]);

  useLayoutEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 840px)").matches) return;
    const body = sheetRef.current;
    if (!body) return;
    let raf = 0;
    const apply = () => {
      if (sheetDrag.current) return;
      // Soft-focused card grew (hours / lines): re-lift even when below full-list max.
      if (softLiftFocused()) return;
      const route = Boolean(openId || draft);
      const { lo, hi } = sheetRange(route, settings.filter);
      const prevHi = hugHi.current;
      const atMax = prevHi != null && Math.abs(sheetVal.current - prevHi) < 0.05;
      hugHi.current = hi;
      // Route open/close owns height via measured mid — do not atMax-snap from pin-list hugHi.
      if (!route && atMax && Math.abs(hi - sheetVal.current) >= 0.008) {
        goSheet(hi, { lo, hi });
        return;
      }
      // Spare under last card (tab leftovers / content shortened while soft-lifted).
      if (sheetVal.current > hi + 0.008) goSheet(hi, { lo, hi });
      else if (sheetVal.current < lo - 0.008) goSheet(lo, { lo, hi });
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        apply();
      });
    };
    const hugRoots = () =>
      [...body.querySelectorAll(".stack, .route-sheet, section.page, .mtr-hours-fold")].filter(
        (node) => !(node instanceof Element && node.closest(".sources")),
      );
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
    softLiftFocused();
  }, [taxiFocusId, taxiFocus?.token, settings.filter, openId, draft, adding, peekSnapKey]);

  useEffect(() => {
    if (sheetDrag.current || peekSnapKey || !taxiFocusId || openId || draft || adding) return;
    if (settings.filter !== "taxi" && settings.filter !== "mtr") return;
    if (mtrSqueeze) return;
    const card = focusedBoardCard(taxiFocusId);
    if (card) scrollSheetCardTop(card);
  }, [taxiFocusId, taxiFocus?.token, settings.filter, openId, draft, adding, peekSnapKey, mtrSqueeze]);

  useEffect(() => {
    if (openId || draft || adding) return;
    if (!peekSnapKey) {
      if (peekSnapId.current) {
        peekSnapId.current = null;
        peekLo.current = null;
        peekHi.current = null;
        const { lo, hi } = sheetRange(false, settings.filter);
        goSheet(boardMid(false, settings.filter, lo, hi), { lo, hi });
      }
      return;
    }
    let apply = () => {};
    const ro = new ResizeObserver(() => apply());
    let observed: Element | null = null;
    apply = () => {
      if (sheetDrag.current) return;
      const taxiPeek = document.querySelector(".sheet-body:not(.is-route) .stack.peek .peek-taxi");
      const sel = peekStationId
        ? `.sheet-body:not(.is-route) .mtr-station.is-map[data-place-id="${CSS.escape(peekStationId)}"]`
        : "";
      const mapStation = sel ? document.querySelector(sel) : null;
      const inner =
        taxiPeek instanceof HTMLElement
          ? taxiPeek
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
      const lines = mapStation instanceof HTMLElement ? mapStation.querySelectorAll(".mtr-line").length : 0;
      const home = taxiPeek instanceof HTMLElement || lines <= 1 ? lo : hi;
      const switched = peekSnapId.current !== peekSnapKey;
      const atMin = peekLo.current == null || Math.abs(sheetVal.current - peekLo.current) < 0.025;
      const atMax = peekHi.current != null && Math.abs(sheetVal.current - peekHi.current) < 0.025;
      const over = sheetVal.current > hi + 0.008;
      peekSnapId.current = peekSnapKey;
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
      goSheet(boardMid(false, nextFilter, lo, hi), { lo, hi });
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
    if (filter === "ferry" || filter === "tram") {
      if (keep) return;
      return;
    }
    if (keep) return;
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
        goSheet(to, { lo, hi });
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
        // hi→mid→lo→hi; if mid collapses onto hi, skip mid so tap still progresses
        const target =
          nearest === "hi" ? (Math.abs(mid - hi) > near ? mid : lo) : nearest === "mid" ? lo : hi;
        goSheet(target, { lo, hi });
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
          openPeekLayer();
          setSelected(group);
        }}
        recenterToken={recenterToken}
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
                  <div key={place.id} className={`stack${place.kind === "taxi" ? " peek-taxi" : ""}`}>
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
                            {leg.company === "tram" ? null : (
                            <EtaStrip
                              arrivals={peekEtas[etaKey]}
                              lang={settings.lang}
                              company={leg.company}
                            />
                            )}
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
                        lineColors={
                          pin.company === "mtr"
                            ? mtrLineColorsAtStop(db, pin.stopId)
                            : pin.company === "lightRail"
                              ? lrtLineColorsAtStop(db, pin.stopId)
                              : undefined
                        }
                        distance={filter === "all" ? pinStopDistance(db, pin, origin) : undefined}
                      />
                    );
                  })
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
