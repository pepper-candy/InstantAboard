/**
 * Bottom-sheet height math (viewport fractions). Board.tsx owns gesture/state;
 * this module only measures DOM and converts seams → lo / mid / hi.
 *
 * Snaps:
 *   lo  — chips-only (home) or first visible stop/ETA (route)
 *   mid — one selected card (taxi/MTR/tram) or selected stop (route)
 *   hi  — content hug, capped by map-tools ceiling
 *
 * Debug: sheet height wrong → start here. List scroll/hug → sheetScroll.ts.
 */
import { navClipTop, settledOpenCardHeight, sheetHugSeam } from "./sheetScroll";
import type { BoardFilter } from "./types";

export const SHEET_DEFAULT = 0.55;
const SHEET_MIN = 0.34;
const SHEET_MAX = 0.86;
const SHEET_MIN_FLOOR = 0.12;
/** How long the last pose must stay put before release counts as a hold. */
const SHEET_STILL_MS = 140;
/** Finger jitter inside this band is leftover motion, not a swipe. */
const SHEET_STILL_PX = 20;
/** px/s. Slow place-and-lift is not a flick even if the pointer was not fully still. */
const SHEET_FLICK_PX_S = 900;
/** Extra px below chips in lo — keep 0 so the next card’s top edge never peeks above the nav. */
const BOARD_CHIP_PAD = 0;
/** Matches `.stack` gap — used to hug the watchboard split without live viewport inflation. */
const STACK_GAP = 12;
/** Matches `.mtr-station-lines` grid-template-rows transition in globals.css. */
export const MTR_LINES_EXPAND_MS = 280;
/** Controlled UI before the mobile keyboard is focused (see Board + search). */
export const SEARCH_OPEN_UI_MS = 1000;
export const SEARCH_FADE_MS = 280;
export const SEARCH_EXPAND_MS = SEARCH_OPEN_UI_MS - SEARCH_FADE_MS;
/** Search ↔ route-detail sheet travel (same expand language, no keyboard wait). */
export const SEARCH_HANDOFF_MS = SEARCH_EXPAND_MS;

export type SheetSample = { y: number; t: number };

export function clampSheet(h: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, h));
}

export function sheetTravelMs(from: number, to: number, lo: number, hi: number): number {
  const span = Math.max(0.22, hi - lo);
  return Math.min(420, Math.max(220, Math.round(400 * (Math.abs(to - from) / span))));
}

export function pushSheetSample(samples: SheetSample[], y: number, t: number) {
  samples.push({ y, t });
  const dropBefore = t - SHEET_STILL_MS * 2;
  while (samples.length > 2 && samples[0] && samples[0].t < dropBefore) samples.shift();
}

/**
 * Last gesture only: still at release → 0 (freeze). Moving swipe → px/ms, up expands.
 * Does not average in the drag that happened before the user paused.
 */
export function sheetReleaseVel(samples: SheetSample[], now: number): number {
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

/** Pin the existing sheet to the visual viewport (keyboard / URL-bar safe). */
export function applyMobileSearchSheet(home: HTMLElement): void {
  const homeH = home.offsetHeight || window.innerHeight;
  const vv = window.visualViewport;
  const visTop = vv ? vv.offsetTop : 0;
  const visBottom = visTop + (vv ? vv.height : window.innerHeight);
  // Flush to the visual viewport top so the sheet covers the map (safe-area
  // padding lives inside the sheet chrome, not as a gap above it).
  const bottomEdge = Math.max(visTop, Math.min(visBottom, homeH));
  const height = Math.max(0, bottomEdge - visTop);
  home.style.setProperty("--sheet-h", `${height}px`);
  home.style.setProperty("--sheet-bottom", `${Math.max(0, homeH - bottomEdge)}px`);
}

export function clearMobileSearchSheet(home: HTMLElement): void {
  home.style.removeProperty("--sheet-bottom");
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

export function measurePeekMin(seamTop: number | undefined): number {
  if (typeof window === "undefined") return SHEET_MIN;
  if (window.matchMedia("(min-width: 840px)").matches) return SHEET_MIN;
  const sheetEl = document.querySelector(".sheet");
  if (!sheetEl || seamTop == null) return SHEET_MIN;
  const navTop = navClipTop();
  const bottomClear = navTop != null ? window.innerHeight - navTop : 0;
  const px = seamTop - sheetEl.getBoundingClientRect().top + bottomClear;
  return Math.min(measureSheetMax(), Math.max(SHEET_MIN_FLOOR, px / window.innerHeight));
}

function measureRoutePeekMin(): number {
  const stops = document.querySelector(".detail-stops");
  const eta = document.querySelector(".route-eta-card");
  if (stops instanceof Element) return measurePeekMin(layoutEdge(stops, "top"));
  if (eta instanceof Element) return measurePeekMin(layoutEdge(eta, "bottom"));
  return measurePeekMin(undefined);
}

function measureTaxiPeekLock(): number | null {
  const taxi = document.querySelector(".sheet-body:not(.is-route) .stack.peek .peek-taxi");
  if (taxi instanceof HTMLElement) return measurePeekMin(taxi.getBoundingClientRect().bottom + 12);
  const stops = document.querySelectorAll(".sheet-body:not(.is-route) .stack.peek .peek-stop");
  // Combined map hit: hug the last station so later stops are not clipped by the first.
  const stop = stops[stops.length - 1];
  if (stop instanceof HTMLElement) return measurePeekMin(stop.getBoundingClientRect().bottom + 12);
  return null;
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

export function measureBoardPeekMin(filter: BoardFilter): number {
  // Bus/minibus stop peek: lo is chips-only so the handle can collapse from the hugged default.
  const peekStop = document.querySelector(".sheet-body:not(.is-route) .stack.peek .peek-stop");
  if (peekStop instanceof HTMLElement) {
    const chipsMin = measureChipsPeekMin();
    if (chipsMin != null) return chipsMin;
  }
  const peek = document.querySelector(".sheet-body:not(.is-route) .stack.peek");
  if (peek instanceof HTMLElement) return measurePeekStationMin();
  // All home filters (all/bus/minibus/mtr/taxi/…): lo must fully fit the mode chips row.
  void filter;
  const chipsMin = measureChipsPeekMin();
  if (chipsMin != null) return chipsMin;
  return measurePeekStationMin();
}

/** Selected (or first) list card for sheet-mid measurement (taxi / MTR / tram). */
function firstBoardCard(filter: BoardFilter): HTMLElement | null {
  const body = document.querySelector(".sheet-body:not(.is-route)");
  if (!(body instanceof HTMLElement)) return null;
  if (filter === "taxi") {
    // Prefer selected stand — never grab the first .taxi-card when another is is-on.
    return body.querySelector(".taxi-card.is-on") ?? body.querySelector(".taxi-card");
  }
  if (filter === "mtr" || filter === "tram") {
    return body.querySelector(".mtr-station.is-on") ?? body.querySelector(".mtr-station");
  }
  return null;
}

/**
 * Mid height = handle + chips + ONE selected card only.
 * Do not use sheetCardSeam (that stacks every card above the selected one and
 * makes mid≈hi when a non-first taxi/MTR card is selected — break collapse).
 */
export function measureOneCardMid(card: HTMLElement): number | null {
  const sheetEl = document.querySelector(".sheet");
  const handle = document.querySelector(".sheet-handle");
  const chips = document.querySelector(".sheet-body:not(.is-route) .chips");
  if (!(sheetEl instanceof HTMLElement) || !(chips instanceof HTMLElement)) {
    return measurePeekMin(layoutEdge(card, "bottom") + 12);
  }
  const handleH = handle instanceof HTMLElement ? handle.offsetHeight : 28;
  // MTR lines animate 0.28s — use settled open height so mid isn't mid-transition.
  const cardH = card.classList.contains("mtr-station")
    ? settledOpenCardHeight(card)
    : Math.max(card.offsetHeight, card.getBoundingClientRect().height);
  const seamFromSheetTop = handleH + chips.offsetHeight + BOARD_CHIP_PAD + cardH + 12;
  return measurePeekMin(sheetEl.getBoundingClientRect().top + seamFromSheetTop);
}

/**
 * Default middle for taxi / MTR / tram home board: chips + the selected/open card.
 * Null for other modes / desktop. Scroll brings that card under the chips.
 */
function measureSheetMid(filter: BoardFilter): number | null {
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return null;
  if (filter === "taxi" || filter === "mtr" || filter === "tram") {
    const card = firstBoardCard(filter);
    if (!(card instanceof HTMLElement)) return null;
    return measureOneCardMid(card);
  }
  if (filter === "all") return measureWatchboardMid();
  return null;
}

function watchboardSwipe(node: Element | null): HTMLElement | null {
  return node instanceof HTMLElement && node.classList.contains("swipe") ? node : null;
}

/** Handle + chips + stack offset down to `seamEl` (optional extra pad below). */
function measureWatchboardSeam(stack: HTMLElement, seamEl: HTMLElement, pad: number): number | null {
  const sheetEl = document.querySelector(".sheet");
  const handle = document.querySelector(".sheet-handle");
  const chips = document.querySelector(".sheet-body:not(.is-route) .chips");
  if (!(sheetEl instanceof HTMLElement) || !(chips instanceof HTMLElement)) {
    return measurePeekMin(layoutEdge(seamEl, "bottom") + pad);
  }
  const handleH = handle instanceof HTMLElement ? handle.offsetHeight : 28;
  let y = 0;
  for (const node of stack.children) {
    if (!(node instanceof HTMLElement) || node.classList.contains("sources")) continue;
    if (y > 0) y += STACK_GAP;
    y += node.offsetHeight;
    if (node === seamEl) break;
  }
  const seamFromSheetTop = handleH + chips.offsetHeight + BOARD_CHIP_PAD + y + pad;
  return measurePeekMin(sheetEl.getBoundingClientRect().top + seamFromSheetTop);
}

/**
 * Home pin list default mid.
 * In-service cards exist: hug the last in-service card (divider stays below the fold).
 * None in service: keep the break line plus a first-card peek.
 */
function measureWatchboardMid(): number | null {
  const body = document.querySelector(".sheet-body:not(.is-route)");
  const stack = body?.querySelector(".stack.pin-watch");
  if (!(stack instanceof HTMLElement)) return null;
  const split = stack.querySelector(":scope > .pin-zone-break");
  if (split instanceof HTMLElement) {
    let inService = 0;
    let lastInService: HTMLElement | null = null;
    let firstHidden: HTMLElement | null = null;
    let seenSplit = false;
    for (const node of stack.children) {
      if (node === split) {
        seenSplit = true;
        continue;
      }
      const swipe = watchboardSwipe(node);
      if (!swipe) continue;
      if (!seenSplit) {
        inService += 1;
        lastInService = swipe;
      } else if (!firstHidden) firstHidden = swipe;
    }
    if (inService === 0 && firstHidden) {
      return measureWatchboardSeam(stack, firstHidden, STACK_GAP);
    }
    if (lastInService) {
      return measureWatchboardSeam(stack, lastInService, STACK_GAP);
    }
    return measureWatchboardSeam(stack, split, 0);
  }
  const swipes = [...stack.children].map(watchboardSwipe).filter((el): el is HTMLElement => Boolean(el));
  const last = swipes[swipes.length - 1];
  if (!last) return null;
  return measureWatchboardSeam(stack, last, STACK_GAP);
}

/** Full gap between two stop cards (or ETA to list). Mid uses this as the bottom pad to the next-card seam. */
function routeCardGapPx(stops?: HTMLElement | null): number {
  const list =
    stops ??
    (document.querySelector(".detail-stops") instanceof HTMLElement
      ? (document.querySelector(".detail-stops") as HTMLElement)
      : null);
  if (list) {
    const gap = parseFloat(getComputedStyle(list).rowGap || getComputedStyle(list).gap);
    if (Number.isFinite(gap) && gap > 0) return gap;
  }
  const eta = document.querySelector(".route-eta-card");
  if (eta instanceof HTMLElement && list) {
    const g = list.getBoundingClientRect().top - eta.getBoundingClientRect().bottom;
    if (Number.isFinite(g) && g > 0 && g < 48) return g;
  }
  if (eta instanceof HTMLElement) {
    const mb = parseFloat(getComputedStyle(eta).marginBottom);
    if (Number.isFinite(mb) && mb > 0) return mb;
  }
  return 12;
}

/** Route detail default mid: top pad + selected stop + full card gap (next-card seam as bottom). */
function measureRouteSheetMid(): number | null {
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return null;
  const stops = document.querySelector(".detail-stops");
  if (!(stops instanceof HTMLElement)) return null;
  const row =
    document.querySelector(".detail-stops > .is-on-stop") ??
    document.querySelector(".detail-stops > .tap-row.is-on-stop") ??
    document.querySelector(".detail-stops > .card.is-on-stop") ??
    document.querySelector(".detail-stops > .tap-row, .detail-stops > .card");
  if (!(row instanceof HTMLElement)) return null;
  // Match list: pad above card + card + normal gap to next stop card. Not mid-gap; not list-end nav pad.
  const cs = getComputedStyle(stops);
  const padTop = parseFloat(cs.paddingTop);
  const topPad = Number.isFinite(padTop) ? padTop : 10;
  const gap = routeCardGapPx(stops);
  return measurePeekMin(
    layoutEdge(stops, "top") + topPad + row.getBoundingClientRect().height + gap,
  );
}

function scrollRouteSelectedStop(behavior: ScrollBehavior = "smooth") {
  const list = document.querySelector(".detail-stops");
  const row =
    document.querySelector(".detail-stops > .is-on-stop") ??
    document.querySelector(".detail-stops > .tap-row.is-on-stop") ??
    document.querySelector(".detail-stops > .card.is-on-stop") ??
    document.querySelector(".detail-stops .is-on-stop");
  if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) return;
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const topPad = parseFloat(getComputedStyle(list).paddingTop);
  const offset = Number.isFinite(topPad) && topPad > 0 ? topPad : 8;
  const listBox = list.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  const top = rowBox.top - listBox.top + list.scrollTop;
  list.scrollTo({
    top: Math.max(0, top - offset),
    behavior: reduce ? "auto" : behavior,
  });
}

/** After sheet lands on route default mid, smoothly scroll selected stop into view. */
export function scheduleScrollSelectedOnMid(
  route: boolean,
  from: number,
  to: number,
  lo: number,
  hi: number,
  mid: number,
  delayMs?: number,
) {
  if (!route || Math.abs(to - mid) > 0.03) return;
  const delay = delayMs ?? sheetTravelMs(from, to, lo, hi);
  window.setTimeout(() => {
    requestAnimationFrame(() => scrollRouteSelectedStop("smooth"));
  }, delay);
}

/** Height travel first, then scroll selected stop (any pose: mid or adjustable lo). */
export function scheduleScrollAfterHeight(from: number, to: number, lo: number, hi: number) {
  const delay = sheetTravelMs(from, to, lo, hi);
  window.setTimeout(() => {
    requestAnimationFrame(() => scrollRouteSelectedStop("smooth"));
  }, delay);
}

/**
 * Bus/minibus stop peek default mid — same hug as the All-tab watchboard.
 * In-service cards exist: last in-service card (divider stays below the fold).
 * None in service: divider plus the first out-of-service card.
 */
function measureStopPeekMid(): number | null {
  if (typeof window === "undefined" || window.matchMedia("(min-width: 840px)").matches) return null;
  const stack = document.querySelector(".sheet-body:not(.is-route) .stack.peek .peek-stop");
  if (!(stack instanceof HTMLElement)) return null;
  const split = stack.querySelector(":scope > .pin-zone-break");
  if (split instanceof HTMLElement) {
    let inService = 0;
    let lastInService: HTMLElement | null = null;
    let firstHidden: HTMLElement | null = null;
    let seenSplit = false;
    for (const node of stack.children) {
      if (node === split) {
        seenSplit = true;
        continue;
      }
      if (!(node instanceof HTMLElement) || !node.classList.contains("peek-card")) continue;
      if (!seenSplit) {
        inService += 1;
        lastInService = node;
      } else if (!firstHidden) firstHidden = node;
    }
    if (inService === 0 && firstHidden) {
      return measureWatchboardSeam(stack, firstHidden, STACK_GAP);
    }
    if (lastInService) {
      return measureWatchboardSeam(stack, lastInService, STACK_GAP);
    }
    return measureWatchboardSeam(stack, split, 0);
  }
  const cards = [...stack.children].filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains("peek-card"),
  );
  const last = cards[cards.length - 1];
  if (!last) return null;
  return measureWatchboardSeam(stack, last, STACK_GAP);
}

/** Mid snap / default settle: route hugs selected stop; taxi/MTR/tram hug first card; bus/minibus open the full nearby list; watchboard / stop peek hug the in-service split. Combined map hits (>1 stop) use full height as default. */
export function boardMid(route: boolean, filter: BoardFilter, lo: number, hi: number): number {
  if (route) return clampSheet(measureRouteSheetMid() ?? SHEET_DEFAULT, lo, hi);
  const stopPeeks = document.querySelectorAll(".sheet-body:not(.is-route) .stack.peek .peek-stop");
  if (stopPeeks.length > 1) return hi;
  const stopPeekMid = measureStopPeekMid();
  if (stopPeekMid != null) return clampSheet(stopPeekMid, lo, hi);
  if (filter === "bus" || filter === "minibus") return hi;
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

export function sheetRange(route: boolean, filter: BoardFilter): { lo: number; hi: number } {
  const hi = measureSheetContentMax();
  const lo = Math.min(hi, route ? measureRoutePeekMin() : measureBoardPeekMin(filter));
  return { lo, hi };
}
