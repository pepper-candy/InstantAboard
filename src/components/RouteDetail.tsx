"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useNow } from "@/hooks/useNow";
import { useRouteLine } from "@/hooks/useRouteLine";
import { onRouteColor, routeColor } from "@/lib/colors";
import { nameOf, t } from "@/lib/i18n";
import { companyMode } from "@/lib/mode";
import { estimateVehicle, pathUpTo } from "@/lib/vehicle";
import type { LatLng } from "@/lib/geo";
import { EtaStrip } from "./EtaStrip";
import { IconBack, IconLocate, MtrLogo } from "./Icons";
import { PullToRefresh } from "./PullToRefresh";
import { useApp } from "./Providers";

const Map = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="map-frame" />,
});

export function RouteDetail() {
  const { pinId } = useParams<{ pinId: string }>();
  const { db, pins, etas, updatedAt, busy, settings, updatePinStop, refreshPin } = useApp();
  const now = useNow();
  const [focusToken, setFocusToken] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const stopFocusArmed = useRef(false);
  const engagedPin = useRef<string | null>(null);
  const didScroll = useRef(false);
  const pin = pins.find((p) => p.id === pinId);
  const route = pin ? db?.routeList[pin.routeId] : undefined;
  const arrivals = pin ? etas[pin.id] : undefined;

  const company = pin?.company;
  const routeId = pin?.routeId;
  const stopSeq = pin?.stopSeq ?? 0;
  const stopKey = route && company ? (route.stops[company] ?? []).join("|") : "";
  const path = useMemo<LatLng[]>(() => {
    if (!db || !company || !routeId) return [];
    const ids = db.routeList[routeId]?.stops[company] ?? [];
    return ids
      .map((id) => db.stopList[id]?.location)
      .filter((p): p is LatLng => Boolean(p));
  }, [db, company, routeId, stopKey]);

  const selected = pin && db ? db.stopList[pin.stopId]?.location : null;
  const line = useRouteLine(company, route, path);
  const track = useMemo(() => pathUpTo(path, stopSeq, line), [path, stopSeq, line]);
  const sampledAt = pin ? (updatedAt[pin.id] ?? 0) : 0;
  const vehicle = useMemo(() => {
    if (!company) return null;
    return estimateVehicle(track, arrivals ?? [], company);
  }, [track, arrivals, company, sampledAt]);

  useLayoutEffect(() => {
    if (!pin || !db) return;
    if (engagedPin.current === pin.id) return;
    engagedPin.current = pin.id;
    stopFocusArmed.current = true;
    didScroll.current = false;
    if (!pin.auto) updatePinStop(pin.id, pin.stopId, pin.stopSeq, true);
  }, [pin, db, updatePinStop]);

  useLayoutEffect(() => {
    if (!pin?.auto) return;
    const row = activeRef.current;
    const list = listRef.current;
    if (!row || !list) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const instant = !didScroll.current;
    didScroll.current = true;
    list.scrollTo({ top: Math.max(0, top - 8), behavior: reduce || instant ? "auto" : "smooth" });
  }, [pin?.auto, pin?.stopId, pin?.stopSeq, pin?.id]);

  if (!pin || !route) {
    return (
      <section className="page">
        <Link href="/" className="back-inline" aria-label="Back">
          <IconBack className="icon-md" />
        </Link>
      </section>
    );
  }

  const color = routeColor(pin.company, route.route);
  const ink = onRouteColor(pin.company, route.route);
  const stopIds = route.stops[pin.company] ?? [];

  return (
    <section className="page detail-page">
      <PullToRefresh
        lang={settings.lang}
        updatedAt={updatedAt[pin.id]}
        now={now}
        scrollRef={listRef}
        onRefresh={() => refreshPin(pin.id)}
      >
        <div className="detail-head">
          <Link href="/" className="icon-btn" aria-label={t(settings.lang, "Back", "返回")}>
            <IconBack className="icon-lg" />
          </Link>
          {companyMode(pin.company) === "mtr" ? <MtrLogo className="mode-logo" line={color} /> : null}
          <span className="route-badge" style={{ background: color, color: ink }}>
            {route.route}
          </span>
          <div className="dest">{nameOf(settings.lang, route.dest)}</div>
        </div>
        <button
          type="button"
          className="etas-btn"
          aria-label="Refresh"
          onClick={() => {
            void refreshPin(pin.id);
          }}
        >
          <EtaStrip arrivals={arrivals} lang={settings.lang} busy={busy[pin.id]} />
        </button>
        <Map
          path={path}
          line={line}
          selected={selected}
          vehicle={vehicle}
          track={track}
          mode={companyMode(pin.company)}
          color={color}
          ink={ink}
          follow={Boolean(pin.auto)}
          focusToken={focusToken}
        />
        <button
          type="button"
          className={`card tap-row detail-auto ${pin.auto ? "is-on-stop" : ""}`}
          onClick={() => {
            stopFocusArmed.current = true;
            updatePinStop(pin.id, pin.stopId, pin.stopSeq, true);
            setFocusToken((n) => n + 1);
          }}
        >
          <span className="dest">
            <IconLocate className="icon-loc" /> {t(settings.lang, "Auto", "自動")}
          </span>
        </button>
        <div className="stack detail-stops" ref={listRef}>
          {stopIds.map((id, seq) => {
            const stop = db?.stopList[id];
            const on = id === pin.stopId && seq === pin.stopSeq;
            return (
              <button
                key={`${id}-${seq}`}
                type="button"
                ref={on ? activeRef : undefined}
                className={`card tap-row ${on ? "is-on-stop" : ""}`}
                onClick={() => {
                  updatePinStop(pin.id, id, seq, false);
                  if (stopFocusArmed.current) setFocusToken((n) => n + 1);
                }}
              >
                <span className="dest">{nameOf(settings.lang, stop?.name)}</span>
                {on ? <span className="stop-mark" /> : <span className="stop-seq">{seq + 1}</span>}
              </button>
            );
          })}
        </div>
      </PullToRefresh>
    </section>
  );
}
