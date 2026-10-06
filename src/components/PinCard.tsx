"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
import { formatDistance } from "@/lib/geo";
import { nameOf } from "@/lib/i18n";
import type { Arrival, Lang, Pin, RouteListEntry, StopListEntry } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { IconBin, IconGrip, IconLocate, MtrLogo } from "./Icons";

const SETTLE_MS = 180;
const EDGE = 56;
const HOLD_MS = 1500;
const HOLD_MOVE = 10;

type Props = {
  pin: Pin;
  route: RouteListEntry;
  stop: StopListEntry | undefined;
  arrivals: Arrival[] | undefined;
  lang: Lang;
  index: number;
  onDelete: () => void;
  onReorder: (from: number, to: number) => void;
  count: number;
  busy?: boolean;
  onRefresh: () => void;
  onOpen: () => void;
  lineColors?: string[];
  distance?: number;
};

type Gesture = {
  pointerId: number;
  grabY: number;
  lastY: number;
  from: number;
  to: number;
  auto: number;
  raf: number;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function swipeItems(root: HTMLElement) {
  const parent = root.parentElement;
  if (!parent) return [] as HTMLElement[];
  return [...parent.querySelectorAll<HTMLElement>(":scope > .swipe")];
}

function flipSiblings(root: HTMLElement, mutate: () => void) {
  const others = swipeItems(root).filter((el) => el !== root);
  if (prefersReducedMotion() || others.length === 0) {
    mutate();
    return;
  }
  const first = others.map((el) => el.getBoundingClientRect().top);
  mutate();
  others.forEach((el, i) => {
    const dy = first[i] - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) return;
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetWidth;
    el.style.transition = `transform ${SETTLE_MS}ms ease`;
    el.style.transform = "";
    const done = (ev: TransitionEvent) => {
      if (ev.target !== el || ev.propertyName !== "transform") return;
      el.removeEventListener("transitionend", done);
      el.style.transition = "";
    };
    el.addEventListener("transitionend", done);
  });
}

function insertLine(parent: HTMLElement) {
  let line = parent.querySelector<HTMLElement>(":scope > .swipe-insert");
  if (!line) {
    line = document.createElement("div");
    line.className = "swipe-insert";
    line.setAttribute("aria-hidden", "true");
    parent.appendChild(line);
  }
  return line;
}

function pinToAfterMove(from: number, insertAt: number, remaining: HTMLElement[]) {
  if (remaining.length === 0) return from;
  if (insertAt >= remaining.length) {
    const last = Number(remaining[remaining.length - 1].dataset.pinIndex);
    return from < last ? last : last + 1;
  }
  const target = Number(remaining[insertAt].dataset.pinIndex);
  return from < target ? target - 1 : target;
}

export function PinCard({ pin, route, stop, arrivals, lang, index, onDelete, onReorder, count, busy, onRefresh, onOpen, lineColors, distance }: Props) {
  const color = routeColor(pin.company, route.route);
  const ink = onRouteColor(pin.company, route.route);
  const rootRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pendingDrop = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lifted, setLifted] = useState(false);
  const [hole, setHole] = useState(false);
  const [hold, setHold] = useState<{ x: number; y: number; p: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [gone, setGone] = useState(false);
  const holdRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    t0: number;
    raf: number;
    ox: number;
    oy: number;
  } | null>(null);
  const armedRef = useRef(false);
  armedRef.current = armed;

  const placeFront = (top: number) => {
    const el = frontRef.current;
    if (!el) return;
    el.style.top = `${top}px`;
  };

  const hideLine = () => {
    const line = rootRef.current?.parentElement?.querySelector(":scope > .swipe-insert");
    line?.remove();
  };

  const paintInsert = (clientY: number) => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    const g = gesture.current;
    if (!root || !parent || !g) return;
    const remaining = swipeItems(root).filter((el) => el !== root);
    let insertAt = remaining.length;
    for (let i = 0; i < remaining.length; i++) {
      const box = remaining[i].getBoundingClientRect();
      if (clientY < box.top + box.height / 2) {
        insertAt = i;
        break;
      }
    }
    g.to = pinToAfterMove(g.from, insertAt, remaining);
    const line = insertLine(parent);
    const origin = parent.getBoundingClientRect().top;
    if (remaining.length === 0) {
      line.style.top = `${Math.max(0, clientY - origin)}px`;
      return;
    }
    if (insertAt <= 0) {
      line.style.top = `${remaining[0].getBoundingClientRect().top - origin - 6}px`;
      return;
    }
    if (insertAt >= remaining.length) {
      const last = remaining[remaining.length - 1].getBoundingClientRect();
      line.style.top = `${last.bottom - origin + 6}px`;
      return;
    }
    line.style.top = `${remaining[insertAt].getBoundingClientRect().top - origin - 6}px`;
  };

  const tickAuto = () => {
    const g = gesture.current;
    const root = rootRef.current;
    if (!g || !root) return;
    const scroller = root.closest(".sheet-body");
    if (scroller instanceof HTMLElement && g.auto) scroller.scrollTop += g.auto;
    const front = frontRef.current;
    if (front) {
      const next = g.lastY - g.grabY;
      const max = window.innerHeight - front.offsetHeight - 8;
      placeFront(Math.max(8, Math.min(max, next)));
    }
    paintInsert(g.lastY);
    g.raf = g.auto ? requestAnimationFrame(tickAuto) : 0;
  };

  const edgeScroll = (clientY: number) => {
    const g = gesture.current;
    const root = rootRef.current;
    if (!g || !root) return;
    const scroller = root.closest(".sheet-body");
    if (!(scroller instanceof HTMLElement)) {
      g.auto = 0;
      return;
    }
    const sc = scroller.getBoundingClientRect();
    const chips = scroller.querySelector(".chips");
    const nav = document.querySelector("nav.nav");
    const top = Math.max(sc.top, chips instanceof HTMLElement ? chips.getBoundingClientRect().bottom : sc.top);
    const bottom = Math.min(sc.bottom, nav instanceof HTMLElement ? nav.getBoundingClientRect().top : sc.bottom);
    let auto = 0;
    if (clientY < top + EDGE) auto = -Math.max(4, (top + EDGE - clientY) / 6);
    else if (clientY > bottom - EDGE) auto = Math.max(4, (clientY - (bottom - EDGE)) / 6);
    g.auto = auto;
    if (auto && !g.raf) g.raf = requestAnimationFrame(tickAuto);
  };

  const beginLift = (clientY: number) => {
    setLifted(true);
    const root = rootRef.current;
    const front = frontRef.current;
    if (!root || !front) return;
    const rect = front.getBoundingClientRect();
    front.style.position = "fixed";
    front.style.left = `${rect.left}px`;
    front.style.width = `${rect.width}px`;
    front.style.top = `${rect.top}px`;
    front.style.zIndex = "20";
    front.style.borderRadius = "var(--radius)";
    front.style.overflow = "hidden";
    front.style.boxShadow = "var(--shadow)";
    front.style.transition = "none";
    front.style.transform = "none";
    setHole(true);
    flipSiblings(root, () => {
      root.classList.add("is-slot-collapsed");
    });
    paintInsert(clientY);
  };

  const clearLift = () => {
    const root = rootRef.current;
    const front = frontRef.current;
    hideLine();
    if (root) {
      root.classList.remove("is-slot-collapsed");
      root.style.zIndex = "";
    }
    setHole(false);
    if (front) {
      front.style.position = "";
      front.style.left = "";
      front.style.width = "";
      front.style.top = "";
      front.style.zIndex = "";
      front.style.borderRadius = "";
      front.style.overflow = "";
      front.style.boxShadow = "";
      front.style.transition = "";
      front.style.transform = "";
    }
    setLifted(false);
  };

  useLayoutEffect(() => {
    if (pendingDrop.current == null || index !== pendingDrop.current) return;
    pendingDrop.current = null;
    const root = rootRef.current;
    if (root) flipSiblings(root, clearLift);
    else clearLift();
  }, [index]);

  const clearHold = () => {
    const h = holdRef.current;
    if (h?.raf) cancelAnimationFrame(h.raf);
    holdRef.current = null;
    setHold(null);
  };

  const armDelete = () => {
    clearHold();
    setArmed(true);
    try {
      navigator.vibrate?.(20);
    } catch {
      /* no haptic */
    }
  };

  const cancelArmed = () => {
    setArmed(false);
    clearHold();
  };

  const removeSelf = () => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) {
      onDelete();
      return;
    }
    setGone(true);
    const h = root.offsetHeight;
    root.style.height = `${h}px`;
    root.style.marginBottom = getComputedStyle(root).marginBottom;
    root.style.overflow = "hidden";
    void root.offsetWidth;
    root.style.transition = `height ${SETTLE_MS}ms ease, margin ${SETTLE_MS}ms ease, opacity ${SETTLE_MS}ms ease`;
    root.style.height = "0px";
    root.style.marginBottom = "0px";
    root.style.opacity = "0";
    window.setTimeout(() => onDelete(), SETTLE_MS);
  };

  useLayoutEffect(() => {
    if (!armed) return;
    const onDown = (ev: PointerEvent | MouseEvent) => {
      const node = ev.target instanceof Element ? ev.target : null;
      if (node?.closest(".pin-del-x")) return;
      if (node && rootRef.current?.contains(node)) return;
      cancelArmed();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [armed]);

  const onCardDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element | null)?.closest("[data-handle]")) return;
    if (armedRef.current) return;
    const box = frontRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const t0 = performance.now();
    const tick = (now: number) => {
      const h = holdRef.current;
      if (!h) return;
      const p = Math.min(1, (now - h.t0) / HOLD_MS);
      setHold({ x: h.x, y: h.y, p });
      if (p >= 1) {
        armDelete();
        return;
      }
      h.raf = requestAnimationFrame(tick);
    };
    holdRef.current = { pointerId: e.pointerId, x, y, t0, raf: requestAnimationFrame(tick), ox: e.clientX, oy: e.clientY };
    setHold({ x, y, p: 0 });
  };

  const onCardMove = (e: PointerEvent<HTMLDivElement>) => {
    const h = holdRef.current;
    if (!h || h.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - h.ox, e.clientY - h.oy) > HOLD_MOVE) clearHold();
  };

  const onCardUp = (e: PointerEvent<HTMLDivElement>) => {
    const h = holdRef.current;
    if (h && h.pointerId === e.pointerId) clearHold();
  };

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    clearHold();
    const front = frontRef.current;
    const grabY = front ? e.clientY - front.getBoundingClientRect().top : 0;
    gesture.current = { pointerId: e.pointerId, grabY, lastY: e.clientY, from: index, to: index, auto: 0, raf: 0 };
    setDragging(true);
    beginLift(e.clientY);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events cannot capture the pointer. */
    }
  };

  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    g.lastY = e.clientY;
    const front = frontRef.current;
    if (front) {
      const next = e.clientY - g.grabY;
      const max = window.innerHeight - front.offsetHeight - 8;
      placeFront(Math.max(8, Math.min(max, next)));
    }
    paintInsert(e.clientY);
    edgeScroll(e.clientY);
  };

  const finishDrag = () => {
    const g = gesture.current;
    if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    gesture.current = null;
    setDragging(false);
    const to = Math.max(0, Math.min(count - 1, g.to));
    if (to === g.from) {
      const root = rootRef.current;
      if (root) flipSiblings(root, clearLift);
      else clearLift();
      return;
    }
    pendingDrop.current = to;
    onReorder(g.from, to);
  };

  const onHandleUp = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    finishDrag();
  };

  return (
    <div
      ref={rootRef}
      data-pin-index={index}
      className={`swipe${dragging ? " is-drag" : ""}${lifted ? " is-lift" : ""}${hole ? " is-slot-collapsed" : ""}${gone ? " is-gone" : ""}`}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={frontRef}
        className="swipe-front"
        onPointerDown={onCardDown}
        onPointerMove={onCardMove}
        onPointerUp={onCardUp}
        onPointerCancel={onCardUp}
      >
        <article className={`card${armed ? " is-del" : ""}`}>
          {hold && !armed ? (
            <span
              className="pin-ripple"
              aria-hidden
              style={{
                left: hold.x,
                top: hold.y,
                transform: `translate(-50%, -50%) scale(${Math.max(0.08, hold.p)})`,
              }}
            />
          ) : null}
          {armed ? (
            <div
              className="pin-del"
              onClick={(e) => {
                e.stopPropagation();
                removeSelf();
              }}
            >
              <IconBin className="icon-bin pin-del-bin" />
              <button
                type="button"
                className="pin-del-x"
                aria-label="Cancel"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelArmed();
                }}
              >
                ×
              </button>
            </div>
          ) : null}
          <div className="card-link">
            <button
              type="button"
              className="card-top"
              onClick={() => {
                if (armedRef.current || holdRef.current) return;
                onOpen();
              }}
            >
              {pin.company === "mtr" ? (
                <div className="card-meta">
                  <div className="mtr-line-name">
                    <MtrLogo className="mode-logo" lines={lineColors?.length ? lineColors : [color]} />
                    <span className="mtr-line-label">{mtrLineName(lang, route.route)}</span>
                  </div>
                  <div className="stop">
                    {pin.auto ? <IconLocate className="icon-loc" /> : null}
                    {nameOf(lang, stop?.name)}
                  </div>
                </div>
              ) : (
                <>
                  <span className="route-badge" style={{ background: color, color: ink }}>
                    {route.route}
                  </span>
                  <div className="card-meta">
                    <div className="dest">{nameOf(lang, route.dest)}</div>
                    <div className="stop">
                      {pin.auto ? <IconLocate className="icon-loc" /> : null}
                      {nameOf(lang, stop?.name)}
                    </div>
                  </div>
                </>
              )}
              {distance != null && Number.isFinite(distance) ? (
                <span className="taxi-d">{formatDistance(distance, lang)}</span>
              ) : null}
            </button>
            <div className="card-eta">
              {distance == null ? (
                <button type="button" className="grip" data-handle aria-label="Reorder" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
                  <IconGrip className="icon-md" />
                </button>
              ) : null}
              <button
                type="button"
                className="etas-btn"
                aria-label="Refresh"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRefresh();
                }}
              >
                <EtaStrip arrivals={arrivals} lang={lang} busy={busy} />
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
