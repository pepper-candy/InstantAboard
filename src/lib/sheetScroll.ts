const CARD_BOTTOM_PAD = 8;
const CHIP_CARD_GAP = 6;
const STACK_GAP = 12;

function listClip(scroller: HTMLElement) {
  const chips = scroller.querySelector(".chips");
  const nav = document.querySelector("nav.nav");
  const top = chips instanceof HTMLElement ? chips.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top;
  const bottom = Math.min(
    scroller.getBoundingClientRect().bottom,
    nav instanceof HTMLElement ? nav.getBoundingClientRect().top : scroller.getBoundingClientRect().bottom,
  );
  return { top, bottom, chips };
}

function linesInner(card: HTMLElement) {
  const inner = card.querySelector(".mtr-station-lines-inner");
  return inner instanceof HTMLElement ? inner : null;
}

/** Header height if lines were fully closed (works mid CSS expand/collapse). */
function collapsedHeight(card: HTMLElement): number {
  const box = card.getBoundingClientRect().height;
  const inner = linesInner(card);
  if (!inner) return box;
  return Math.max(0, box - inner.getBoundingClientRect().height);
}

function expandedHeight(card: HTMLElement): number {
  const inner = linesInner(card);
  if (!inner) return card.getBoundingClientRect().height;
  return collapsedHeight(card) + inner.scrollHeight;
}

function predictedCardTop(el: HTMLElement, scroller: HTMLElement): number {
  const stack = el.closest(".stack");
  if (!(stack instanceof HTMLElement)) return el.getBoundingClientRect().top;
  const cards = [...stack.querySelectorAll(":scope > .card")];
  const index = cards.indexOf(el);
  if (index < 0) return el.getBoundingClientRect().top;
  let y = 0;
  for (let i = 0; i < index; i++) {
    const card = cards[i];
    if (!(card instanceof HTMLElement)) continue;
    y += collapsedHeight(card) + STACK_GAP;
  }
  return stack.getBoundingClientRect().top + y;
}

function cardRevealHeight(card: HTMLElement): number {
  return expandedHeight(card);
}

/** Pixels to grow the sheet so one card fits under chips. Does not change the drag min. */
function hugHeight(el: HTMLElement): number {
  if (el.classList.contains("mtr-station") && !el.classList.contains("is-on") && !el.classList.contains("is-map")) {
    return expandedHeight(el);
  }
  return el.getBoundingClientRect().height;
}

function hugBottom(el: HTMLElement): number {
  return el.getBoundingClientRect().top + hugHeight(el);
}

/** Viewport Y of the last sheet block we should hug (no empty pad below). */
export function sheetHugSeam(): number | undefined {
  const body = document.querySelector(".sheet-body");
  if (!(body instanceof HTMLElement)) return undefined;
  const peek = body.querySelector(".stack.peek");
  if (peek instanceof HTMLElement) {
    const taxi = peek.querySelector(".peek-taxi");
    if (taxi instanceof HTMLElement) return hugBottom(taxi);
    const station = peek.querySelector("article.mtr-station, article.card, .peek-card");
    if (station instanceof HTMLElement) return hugBottom(station);
    return peek.getBoundingClientRect().bottom;
  }
  if (body.classList.contains("is-route")) return undefined;
  const open =
    body.querySelector("article.mtr-station.is-on") ??
    body.querySelector(".taxi-card.is-on") ??
    body.querySelector(".ferry-card.is-on");
  if (open instanceof HTMLElement) return hugBottom(open);
  const firstMtr = body.querySelector("article.mtr-station");
  if (firstMtr instanceof HTMLElement) return hugBottom(firstMtr);
  const blocks = body.querySelectorAll(".ptr .stack > .card, .ptr .stack > .taxi-card, .ptr .stack > .sources");
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block instanceof HTMLElement && block.getBoundingClientRect().height > 2) return hugBottom(block);
  }
  return undefined;
}

export function extraSheetPxToShowCard(card: HTMLElement): number {
  const scroller = card.closest(".sheet-body");
  if (!(scroller instanceof HTMLElement)) return 0;
  const { top, bottom } = listClip(scroller);
  const slot = bottom - top;
  const need = cardRevealHeight(card) + CHIP_CARD_GAP + CARD_BOTTOM_PAD;
  return Math.max(0, Math.ceil(need - slot));
}

export function focusedBoardCard(id: string): HTMLElement | null {
  const taxi = document.querySelector(`[data-taxi="${CSS.escape(id)}"]`);
  if (taxi instanceof HTMLElement) return taxi;
  const mtr = document.querySelector(`[data-place-id="${CSS.escape(id)}"]`);
  if (mtr instanceof HTMLElement) return mtr;
  return null;
}

function jumpSheetCardTop(el: HTMLElement, scroller: HTMLElement, smooth: boolean) {
  if (!el.isConnected) return;
  const { top } = listClip(scroller);
  const predicted = predictedCardTop(el, scroller);
  const next = Math.max(0, scroller.scrollTop + predicted - top - CHIP_CARD_GAP);
  if (Math.abs(next - scroller.scrollTop) < 2) return;
  scroller.scrollTo({ top: next, behavior: smooth ? "smooth" : "auto" });
}

export function scrollSheetCardTop(el: HTMLElement) {
  const scroller = el.closest(".sheet-body");
  if (!(scroller instanceof HTMLElement)) return;
  if (!el.classList.contains("is-on")) el.classList.add("is-on");
  void el.offsetWidth;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    jumpSheetCardTop(el, scroller, false);
    return;
  }
  requestAnimationFrame(() => jumpSheetCardTop(el, scroller, true));
}
