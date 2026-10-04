"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent } from "react";
import { onRouteColor, routeColor } from "@/lib/colors";
import { nameOf } from "@/lib/i18n";
import type { Arrival, Lang, Pin, RouteListEntry, StopListEntry } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { IconBin, IconGrip, IconLocate } from "./Icons";

const DELETE_REVEAL = 76;
const DELETE_COMMIT = 140;

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
};

export function PinCard({ pin, route, stop, arrivals, lang, index, onDelete, onReorder, count, busy, onRefresh }: Props) {
  const color = routeColor(pin.company, route.route);
  const ink = onRouteColor(pin.company, route.route);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; mode: "none" | "swipe" | "drag" } | null>(null);
  const ignoreClick = useRef(false);

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    start.current = { x: e.clientX, y: e.clientY, mode: "drag" };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!start.current || start.current.mode !== "drag") return;
    const dy = e.clientY - start.current.y;
    const step = Math.round(dy / 88);
    const to = Math.max(0, Math.min(count - 1, index + step));
    if (to !== index) {
      onReorder(index, to);
      start.current = { ...start.current, y: e.clientY };
    }
  };

  const onHandleUp = () => {
    start.current = null;
    setDragging(false);
  };

  const onCardDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-handle]")) return;
    start.current = { x: e.clientX, y: e.clientY, mode: "none" };
  };

  const onCardMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current || start.current.mode === "drag") return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;
    if (start.current.mode === "none") {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(mx) > Math.abs(my)) start.current.mode = "swipe";
      else {
        start.current = null;
        return;
      }
    }
    if (start.current.mode === "swipe") {
      setDx(Math.min(0, mx));
    }
  };

  const onCardUp = () => {
    if (!start.current) {
      setDx(0);
      return;
    }
    if (start.current.mode === "swipe") {
      ignoreClick.current = true;
      if (dx <= -DELETE_COMMIT) onDelete();
      else if (dx <= -40) setDx(-DELETE_REVEAL);
      else setDx(0);
    }
    start.current = null;
  };

  return (
    <div className={`swipe ${dragging ? "is-drag" : ""}`}>
      <button type="button" className="swipe-bin" aria-label="Delete" onClick={onDelete}>
        <IconBin className="icon-bin" />
      </button>
      <div
        className="swipe-front"
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onCardDown}
        onPointerMove={onCardMove}
        onPointerUp={onCardUp}
        onPointerCancel={onCardUp}
      >
        <article className="card">
          <button type="button" className="grip" data-handle aria-label="Reorder" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
            <IconGrip className="icon-md" />
          </button>
          <div className="card-link">
            <Link
              href={`/r/${pin.id}`}
              className="card-top"
              onClick={(e) => {
                if (ignoreClick.current || dx < -8) {
                  e.preventDefault();
                  ignoreClick.current = false;
                }
              }}
            >
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
            </Link>
            <button
              type="button"
              className="etas-btn"
              aria-label="Refresh"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (ignoreClick.current || dx < -8) {
                  ignoreClick.current = false;
                  return;
                }
                onRefresh();
              }}
            >
              <EtaStrip arrivals={arrivals} lang={lang} busy={busy} />
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
