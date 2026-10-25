const CARD_BOTTOM_PAD = 8;
const CHIP_CARD_GAP = 6;
const STACK_GAP = 12;
const MTR_LINE_GAP = 8;
const MTR_HOURS_GAP = 8;

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

/** Header + padding if lines were fully closed (ignores mid CSS transition). */
function collapsedHeight(card: HTMLElement): number {
  if (card.classList.contains("mtr-station")) return settledMtrHeight(card, false);
  const box = card.getBoundingClientRect().height;
  const inner = linesInner(card);
  if (!inner) return box;
  return Math.max(0, box - inner.getBoundingClientRect().height);
}

function expandedHeight(card: HTMLElement): number {
  if (card.classList.contains("mtr-station")) return settledMtrHeight(card, true);
  const inner = linesInner(card);
  if (!inner) return card.getBoundingClientRect().height;
  return collapsedHeight(card) + inner.scrollHeight;
}

/** Settled fully-open height (ignores live CSS expand/collapse). */
export function settledOpenCardHeight(card: HTMLElement): number {
  return expandedHeight(card);
}

/** Settled MTR card height from open/hours flags — not live transition geometry. */
function settledMtrHeight(card: HTMLElement, forceOpen?: boolean): number {
  const open = forceOpen ?? card.classList.contains("is-on");
  const style = getComputedStyle(card);
  const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  const head = card.querySelector(".mtr-station-head");
  const headH = head instanceof HTMLElement ? head.offsetHeight : 0;
  if (!open) return headH + padY;

  const inner = linesInner(card);
  if (!inner) return headH + padY;

  let lines = 0;
  const fold = inner.querySelector(":scope > .mtr-hours-fold");
  const foldInner = fold?.querySelector(".mtr-hours-fold-inner");
  if (fold instanceof HTMLElement && fold.classList.contains("is-open") && foldInner instanceof HTMLElement) {
    lines += foldInner.scrollHeight + MTR_HOURS_GAP;
  }
  const mtrLines = [...inner.querySelectorAll(":scope > .mtr-line")];
  mtrLines.forEach((line, i) => {
    if (!(line instanceof HTMLElement)) return;
    lines += line.offsetHeight;
    if (i > 0) lines += MTR_LINE_GAP;
  });
  return headH + padY + lines;
}

/** Settled height for any board card (expand/collapse precalculated). */
function settledCardHeight(card: HTMLElement): number {
  if (card.classList.contains("mtr-station")) return settledMtrHeight(card);
  return Math.max(card.offsetHeight, card.getBoundingClientRect().height);
}

function stackCards(stack: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of stack.children) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.classList.contains("sources")) continue;
    if (node.classList.contains("swipe")) {
      const card = node.querySelector("article.card");
      if (card instanceof HTMLElement) out.push(card);
      else out.push(node);
      continue;
    }
    if (
      node.classList.contains("card") ||
      node.classList.contains("taxi-card") ||
      node.matches("button.card")
    ) {
      out.push(node);
    }
  }
  return out;
}

function predictedCardTop(el: HTMLElement, scroller: HTMLElement): number {
  const stack = el.closest(".stack");
  if (!(stack instanceof HTMLElement)) return el.getBoundingClientRect().top;
  const cards = stackCards(stack);
  const index = cards.indexOf(el);
  if (index < 0) return el.getBoundingClientRect().top;
  let y = 0;
  for (let i = 0; i < index; i++) {
    y += settledCardHeight(cards[i]) + STACK_GAP;
  }
  return stack.getBoundingClientRect().top + y;
}

function cardRevealHeight(card: HTMLElement): number {
  return expandedHeight(card);
}

/** Scrollport scrollTop for layout Y that stays stable while the sheet body scrolls. */
function nearestScrollTop(el: Element): number {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return node.scrollTop;
  }
  return 0;
}

/** Content-space bottom (viewport bottom + scroll). Ignores sheet-body scroll. */
function blockBottom(el: HTMLElement): number {
  const box = el.getBoundingClientRect();
  if (box.height < 2) return 0;
  return box.bottom + nearestScrollTop(el);
}

/** Predicted stack bottom from settled expand/collapse heights. */
function predictedStackBottom(stack: HTMLElement): number {
  const cards = stackCards(stack);
  if (cards.length === 0) return 0;
  let y = stack.getBoundingClientRect().top + nearestScrollTop(stack);
  cards.forEach((card, i) => {
    if (i > 0) y += STACK_GAP;
    y += settledCardHeight(card);
  });
  return y;
}

/** Layout Y of one card’s expanded bottom (soft lift target; does not lock drag max). */
export function sheetCardSeam(card: HTMLElement): number {
  const stack = card.closest(".stack");
  if (stack instanceof HTMLElement) {
    const cards = stackCards(stack);
    const index = cards.indexOf(card);
    if (index >= 0) {
      let y = stack.getBoundingClientRect().top + nearestScrollTop(stack);
      for (let i = 0; i <= index; i++) {
        if (i > 0) y += STACK_GAP;
        // Soft lift assumes this card is open; others keep settled state.
        y += i === index ? expandedHeight(cards[i]) : settledCardHeight(cards[i]);
      }
      return y;
    }
  }
  return card.getBoundingClientRect().top + nearestScrollTop(card) + expandedHeight(card);
}

/** Layout Y of the last sheet block we should hug (no empty pad below). */
export function sheetHugSeam(): number | undefined {
  const body = document.querySelector(".sheet-body");
  if (!(body instanceof HTMLElement)) return undefined;

  let bottom = 0;

  // Prefer predicted stack bottoms so expand/collapse CSS does not skew max height.
  for (const stack of body.querySelectorAll(".ptr > .stack, .sheet-body > .ptr > .stack, .stack.peek")) {
    if (!(stack instanceof HTMLElement)) continue;
    if (stack.closest(".sources")) continue;
    bottom = Math.max(bottom, predictedStackBottom(stack));
  }

  // Non-stack blocks (route detail, search, empty muted, etc.).
  const nodes = body.querySelectorAll(
    [
      ".peek-taxi",
      ".route-eta-card",
      ".detail-stops > .card",
      "section.page .search-bar",
      "section.page .card",
      "section.page .dir-group",
      "section.page .back-inline",
      ".muted",
    ].join(","),
  );
  for (const node of nodes) {
    if (node instanceof HTMLElement) bottom = Math.max(bottom, blockBottom(node));
  }
  return bottom > 0 ? bottom : undefined;
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
  // Never force is-on — MTR open state is React-owned; forcing it desyncs header collapse.
  void el.offsetWidth;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    jumpSheetCardTop(el, scroller, false);
    return;
  }
  requestAnimationFrame(() => jumpSheetCardTop(el, scroller, true));
}
