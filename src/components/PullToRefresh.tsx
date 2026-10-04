"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { updatedLabel } from "@/lib/updated";
import type { Lang } from "@/lib/types";
import { IconSpinner } from "./Icons";

const ARM = 8;
const FIRE = 56;

type Props = {
  onRefresh: () => Promise<void> | void;
  lang: Lang;
  updatedAt?: number;
  now: number;
  children: ReactNode;
};

export function PullToRefresh({ onRefresh, lang, updatedAt, now, children }: Props) {
  const [pull, setPull] = useState(0);
  const [spin, setSpin] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; x: number } | null>(null);
  const locked = useRef(false);
  const pullRef = useRef(0);
  const spinRef = useRef(false);
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

  const atTop = () => (window.scrollY || document.documentElement.scrollTop || 0) <= 0;

  const ignore = (target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    return Boolean(el?.closest(".leaflet-container, [data-handle], input, textarea"));
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (spinRef.current) return;
    if (!atTop() || ignore(e.target)) {
      start.current = null;
      return;
    }
    start.current = { y: e.clientY, x: e.clientX };
    locked.current = false;
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current || spinRef.current) return;
    const dy = e.clientY - start.current.y;
    const dx = e.clientX - start.current.x;
    if (!locked.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        start.current = null;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      if (dy > ARM && atTop()) locked.current = true;
    }
    if (!locked.current) return;
    const next = dy > 0 ? Math.min(72, dy * 0.42) : 0;
    pullRef.current = next;
    setPull(next);
  };

  const finish = async () => {
    const should = pullRef.current >= FIRE * 0.42 && !spinRef.current;
    start.current = null;
    locked.current = false;
    pullRef.current = 0;
    setPull(0);
    if (!should) return;
    spinRef.current = true;
    setSpin(true);
    try {
      await onRefresh();
    } finally {
      spinRef.current = false;
      setSpin(false);
    }
  };

  const showSpin = spin || pull > 6;

  return (
    <div ref={root} className="ptr" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={finish} onPointerCancel={finish}>
      <div className="refresh-slot" aria-live="polite">
        <span
          className={`refresh-spin ${showSpin ? "is-on" : ""} ${spin ? "is-run" : ""}`}
          style={spin ? undefined : { transform: `rotate(${pull * 6}deg)` }}
        >
          <IconSpinner className="icon-spin" />
        </span>
        <span className="updated">{updatedLabel(lang, updatedAt, now)}</span>
      </div>
      {children}
    </div>
  );
}
