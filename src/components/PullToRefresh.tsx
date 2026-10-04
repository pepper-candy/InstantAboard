"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { Lang } from "@/lib/types";
import { IconSpinner } from "./Icons";

const ARM = 8;
const MAX = 112;
const THRESHOLD = 56;

type Props = {
  onRefresh: () => Promise<void> | void;
  lang: Lang;
  updatedAt?: number;
  now: number;
  children: ReactNode;
  scrollRef?: RefObject<HTMLElement | null>;
};

export function PullToRefresh({ onRefresh, children, scrollRef }: Props) {
  const [pull, setPull] = useState(0);
  const [spin, setSpin] = useState(false);
  const [spring, setSpring] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; x: number } | null>(null);
  const locked = useRef(false);
  const pullRef = useRef(0);
  const spinRef = useRef(false);
  const wave = useRef(0);
  pullRef.current = pull;
  spinRef.current = spin;

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const block = (e: TouchEvent) => {
      if (locked.current && e.cancelable) e.preventDefault();
    };
    node.addEventListener("touchmove", block, { passive: false });
    return () => node.removeEventListener("touchmove", block);
  }, []);

  const atTop = () => {
    if (scrollRef?.current) return scrollRef.current.scrollTop <= 0;
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  };

  const ignore = (target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    return Boolean(el?.closest(".leaflet-container, [data-handle], input, textarea"));
  };

  const applyPull = (n: number) => {
    pullRef.current = n;
    setPull(n);
  };

  const springTo = (to: number) => {
    const id = ++wave.current;
    setSpring(true);
    requestAnimationFrame(() => {
      if (wave.current !== id) return;
      applyPull(to);
    });
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (spinRef.current) return;
    if (!atTop() || ignore(e.target)) {
      start.current = null;
      return;
    }
    wave.current += 1;
    setSpring(false);
    start.current = { y: e.clientY, x: e.clientX };
    locked.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already released */
    }
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current || spinRef.current) return;
    const dy = e.clientY - start.current.y;
    const dx = e.clientX - start.current.x;
    if (!locked.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        start.current = null;
        applyPull(0);
        return;
      }
      if (dy > ARM && atTop()) locked.current = true;
    }
    if (!locked.current) return;
    applyPull(dy > 0 ? Math.min(MAX, dy * 0.85) : 0);
  };

  const finish = async () => {
    if (!start.current && !locked.current) return;
    const dist = pullRef.current;
    const should = dist >= THRESHOLD && !spinRef.current;
    start.current = null;
    locked.current = false;
    if (!should) {
      if (dist > 0) springTo(0);
      return;
    }
    spinRef.current = true;
    setSpin(true);
    try {
      await onRefresh();
    } finally {
      spinRef.current = false;
      setSpin(false);
      springTo(0);
    }
  };

  const showSpin = spin || pull > 10;

  return (
    <div ref={root} className="ptr" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={finish} onPointerCancel={finish}>
      <div className={`refresh-slot${spring ? " is-spring" : ""}`} style={{ height: pull }} aria-hidden="true">
        {showSpin ? (
          <span
            className={`refresh-spin is-on${spin ? " is-run" : ""}`}
            style={spin ? undefined : { transform: `rotate(${pull * 4}deg)` }}
          >
            <IconSpinner className="icon-spin" />
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
