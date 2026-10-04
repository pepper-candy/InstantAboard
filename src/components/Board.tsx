"use client";

import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/hooks/useNow";
import { companyMode } from "@/lib/mode";
import { nameOf, t } from "@/lib/i18n";
import { latestStamp } from "@/lib/updated";
import type { Pin } from "@/lib/types";
import { FilterChips } from "./FilterChips";
import { IconUndo } from "./Icons";
import { PinCard } from "./PinCard";
import { PullToRefresh } from "./PullToRefresh";
import { useApp } from "./Providers";
import { TaxiBoard } from "./TaxiBoard";

type Undo = { pin: Pin; index: number };

export function Board() {
  const {
    db,
    dbError,
    pins,
    pinsReady,
    etas,
    updatedAt,
    busy,
    settings,
    removePin,
    restorePin,
    movePin,
    refreshAll,
    refreshPin,
  } = useApp();
  const [undo, setUndo] = useState<Undo | null>(null);
  const now = useNow();

  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(id);
  }, [undo]);

  const visible = useMemo(() => {
    if (settings.filter === "all" || settings.filter === "taxi") return pins;
    return pins.filter((pin) => {
      const route = db?.routeList[pin.routeId];
      if (!route) return false;
      return companyMode(pin.company) === settings.filter;
    });
  }, [pins, settings.filter, db]);

  const stamp = latestStamp(visible.map((p) => updatedAt[p.id]));

  const onDelete = (pin: Pin) => {
    const index = pins.findIndex((p) => p.id === pin.id);
    removePin(pin.id);
    setUndo({ pin, index });
  };

  return (
    <section className="page">
      <PullToRefresh
        lang={settings.lang}
        updatedAt={stamp}
        now={now}
        onRefresh={() => refreshAll(visible.map((p) => p.id))}
      >
        <FilterChips />
        {settings.filter === "taxi" ? (
          <TaxiBoard />
        ) : (
          <div className="stack">
            {!pinsReady || !db ? (
              <SkeletonBoard />
            ) : dbError ? (
              <p className="muted">{t(settings.lang, "Routes unavailable", "未能載入路線")}</p>
            ) : visible.length === 0 ? (
              <p className="muted">{t(settings.lang, "Pin a route", "加入路線")}</p>
            ) : (
              visible.map((pin) => {
                const route = db.routeList[pin.routeId];
                if (!route) return null;
                const stop = db.stopList[pin.stopId];
                return (
                  <PinCard
                    key={pin.id}
                    pin={pin}
                    route={route}
                    stop={stop}
                    arrivals={etas[pin.id]}
                    lang={settings.lang}
                    index={pins.findIndex((p) => p.id === pin.id)}
                    count={pins.length}
                    busy={busy[pin.id]}
                    onDelete={() => onDelete(pin)}
                    onReorder={movePin}
                    onRefresh={() => {
                      void refreshPin(pin.id);
                    }}
                  />
                );
              })
            )}
            <div className="undo-slot">
              {undo ? (
                <div className="undo">
                  <span>
                    {db?.routeList[undo.pin.routeId]?.route ?? "·"}{" "}
                    {nameOf(settings.lang, db?.routeList[undo.pin.routeId]?.dest, "")}
                  </span>
                  <button
                    type="button"
                    className="undo-btn"
                    onClick={() => {
                      restorePin(undo.pin, undo.index);
                      setUndo(null);
                    }}
                    aria-label={t(settings.lang, "Undo", "復原")}
                  >
                    <IconUndo className="icon-md" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </PullToRefresh>
    </section>
  );
}

function SkeletonBoard() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="card card-skel" />
      ))}
    </>
  );
}
