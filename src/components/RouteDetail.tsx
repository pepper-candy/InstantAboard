"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useNow } from "@/hooks/useNow";
import { onRouteColor, routeColor } from "@/lib/colors";
import { nameOf, t } from "@/lib/i18n";
import { estimateVehicle, pathUpTo } from "@/lib/vehicle";
import type { LatLng } from "@/lib/geo";
import { EtaStrip } from "./EtaStrip";
import { IconBack, IconLocate } from "./Icons";
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
  const pin = pins.find((p) => p.id === pinId);
  const route = pin ? db?.routeList[pin.routeId] : undefined;
  const arrivals = pin ? etas[pin.id] : undefined;

  const stopIds = route && pin ? (route.stops[pin.company] ?? []) : [];
  const path = useMemo<LatLng[]>(() => {
    if (!db) return [];
    return stopIds
      .map((id) => db.stopList[id]?.location)
      .filter((p): p is LatLng => Boolean(p));
  }, [db, stopIds]);

  const selected = pin && db ? db.stopList[pin.stopId]?.location : null;
  const vehicle = useMemo(() => {
    if (!pin) return null;
    return estimateVehicle(pathUpTo(path, pin.stopSeq), arrivals ?? [], pin.company);
  }, [path, pin, arrivals]);

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

  return (
    <section className="page">
      <PullToRefresh
        lang={settings.lang}
        updatedAt={updatedAt[pin.id]}
        now={now}
        onRefresh={() => refreshPin(pin.id)}
      >
        <div className="detail-head">
          <Link href="/" className="icon-btn" aria-label={t(settings.lang, "Back", "返回")}>
            <IconBack className="icon-lg" />
          </Link>
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
        <Map path={path} selected={selected} vehicle={vehicle} color={color} />
        <div className="stack">
          <button
            type="button"
            className={`card tap-row ${pin.auto ? "is-on-stop" : ""}`}
            onClick={() => updatePinStop(pin.id, pin.stopId, pin.stopSeq, true)}
          >
            <span className="dest">
              <IconLocate className="icon-loc" /> {t(settings.lang, "Auto", "自動")}
            </span>
          </button>
          {stopIds.map((id, seq) => {
            const stop = db?.stopList[id];
            const on = !pin.auto && id === pin.stopId && seq === pin.stopSeq;
            return (
              <button
                key={`${id}-${seq}`}
                type="button"
                className={`card tap-row ${on ? "is-on-stop" : ""}`}
                onClick={() => updatePinStop(pin.id, id, seq, false)}
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
