"use client";

import { useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
import { formatDistance } from "@/lib/geo";
import { nameOf } from "@/lib/i18n";
import type { Arrival, Lang, Pin, RouteListEntry, StopListEntry } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { IconGrip, IconLocate, MtrLogo } from "./Icons";

const SETTLE_MS = 180;

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
  x: number;
  y: number;
  mode: "drag";
  pointerId: number;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function slotSize(root: HTMLElement) {
  const parent = root.parentElement;
  const rect = root.getBoundingClientRect();
  if (!parent) return rect.height;
  const items = [...parent.querySelectorAll<HTMLElement>(":scope > .swipe")];
  const index = items.indexOf(root);
  const neighbor = items[index + 1] ?? items[index - 1];
  if (!neighbor || neighbor === root) {
    const gap = Number.parseFloat(getComputedStyle(parent).rowGap) || 0;
    return rect.height + gap;
  }
  return Math.abs(neighbor.getBoundingClientRect().top - rect.top);
}

export function PinCard({ pin, route, stop, arrivals, lang, index, onReorder, count, busy, onRefresh, onOpen, lineColors, distance }: Props) {
  const color = routeColor(pin.company, route.route);
  const ink = onRouteColor(pin.company, route.route);
  const rootRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  const liftGen = useRef(0);
  const pendingFlip = useRef<{ layoutTop: number; dy: number; to: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lifted, setLifted] = useState(false);

  const paint = (x: number, y: number) => {
    offset.current = { x, y };
    const el = frontRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = x === 0 && y === 0 ? "" : `translate3d(${x}px, ${y}px, 0)`;
  };

  const settle = (x: number, y: number) => {
    const el = frontRef.current;
    if (!el) return;
    offset.current = { x, y };
    if (prefersReducedMotion()) {
      el.style.transition = "none";
      el.style.transform = x === 0 && y === 0 ? "" : `translate3d(${x}px, ${y}px, 0)`;
      return;
    }
    el.style.transition = `transform ${SETTLE_MS}ms ease`;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    const done = (ev: TransitionEvent) => {
      if (ev.target !== el || ev.propertyName !== "transform") return;
      el.removeEventListener("transitionend", done);
      if (offset.current.x !== x || offset.current.y !== y) return;
      el.style.transition = "";
      if (x === 0 && y === 0) el.style.transform = "";
    };
    el.addEventListener("transitionend", done);
  };

  const beginLift = () => {
    liftGen.current += 1;
    setLifted(true);
    const root = rootRef.current;
    const front = frontRef.current;
    if (root) {
      root.style.overflow = "visible";
      root.style.transform = "none";
      root.style.zIndex = "3";
    }
    if (front) {
      front.style.borderRadius = "var(--radius)";
      front.style.overflow = "hidden";
      front.style.boxShadow = "var(--shadow)";
    }
  };

  const clearLift = () => {
    const root = rootRef.current;
    const front = frontRef.current;
    if (root) {
      root.style.overflow = "";
      root.style.transform = "";
      root.style.zIndex = "";
    }
    if (front) {
      front.style.borderRadius = "";
      front.style.overflow = "";
      front.style.boxShadow = "";
    }
    setLifted(false);
  };

  const armLiftClear = () => {
    const gen = ++liftGen.current;
    const el = frontRef.current;
    if (!el || prefersReducedMotion()) {
      clearLift();
      return;
    }
    const clear = (ev?: TransitionEvent) => {
      if (liftGen.current !== gen) return;
      if (ev && (ev.target !== el || ev.propertyName !== "transform")) return;
      el.removeEventListener("transitionend", clear);
      clearLift();
    };
    el.addEventListener("transitionend", clear);
    window.setTimeout(() => {
      if (liftGen.current !== gen) return;
      el.removeEventListener("transitionend", clear);
      clearLift();
    }, SETTLE_MS + 80);
  };

  useLayoutEffect(() => {
    const el = frontRef.current;
    if (!el || pendingFlip.current) return;
    const transition = el.style.transition;
    if (transition && transition !== "none") return;
    const { x, y } = offset.current;
    const next = x === 0 && y === 0 ? "" : `translate3d(${x}px, ${y}px, 0)`;
    if ((el.style.transform || "") !== next) el.style.transform = next;
  });

  useLayoutEffect(() => {
    const pending = pendingFlip.current;
    if (!pending || index !== pending.to || !rootRef.current || !frontRef.current) return;
    pendingFlip.current = null;
    const el = frontRef.current;
    const layoutNew = rootRef.current.getBoundingClientRect().top;
    const compensate = pending.layoutTop + pending.dy - layoutNew;
    if (prefersReducedMotion() || Math.abs(compensate) < 0.5) {
      el.style.transition = "none";
      el.style.transform = "";
      offset.current = { x: 0, y: 0 };
      return;
    }
    el.style.transition = "none";
    el.style.transform = `translate3d(0px, ${compensate}px, 0)`;
    offset.current = { x: 0, y: compensate };
    void el.offsetWidth;
    el.style.transition = `transform ${SETTLE_MS}ms ease`;
    el.style.transform = "translate3d(0px, 0px, 0)";
    offset.current = { x: 0, y: 0 };
    const done = (ev: TransitionEvent) => {
      if (ev.target !== el || ev.propertyName !== "transform") return;
      el.removeEventListener("transitionend", done);
      if (offset.current.x !== 0 || offset.current.y !== 0) return;
      el.style.transition = "";
      el.style.transform = "";
    };
    el.addEventListener("transitionend", done);
  }, [index]);

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    gesture.current = { x: e.clientX, y: e.clientY, mode: "drag", pointerId: e.pointerId };
    setDragging(true);
    beginLift();
    paint(0, 0);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events cannot capture the pointer. */
    }
  };

  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g || g.mode !== "drag" || g.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    paint(0, e.clientY - g.y);
  };

  const finishDrag = () => {
    const g = gesture.current;
    if (!g || g.mode !== "drag") return;
    gesture.current = null;
    setDragging(false);
    const root = rootRef.current;
    const dy = offset.current.y;
    if (!root || dy === 0) {
      paint(0, 0);
      clearLift();
      return;
    }
    const slot = slotSize(root);
    const steps = slot > 0 ? Math.round(dy / slot) : 0;
    const to = Math.max(0, Math.min(count - 1, index + steps));
    if (to === index) {
      settle(0, 0);
      armLiftClear();
      return;
    }
    pendingFlip.current = { layoutTop: root.getBoundingClientRect().top, dy, to };
    onReorder(index, to);
    armLiftClear();
  };

  const onHandleUp = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    finishDrag();
  };

  return (
    <div ref={rootRef} className={`swipe${dragging ? " is-drag" : ""}${lifted ? " is-lift" : ""}`}>
      <div ref={frontRef} className="swipe-front">
        <article className="card">
          <div className="card-link">
            <button type="button" className="card-top" onClick={onOpen}>
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
                    <div className="dest">{pin.bothWays ? nameOf(lang, stop?.name) : nameOf(lang, route.dest)}</div>
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
