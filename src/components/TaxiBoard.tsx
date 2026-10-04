"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { HANG_HAU, formatDistance, haversine } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { loadTaxiStands } from "@/lib/taxi";
import type { TaxiStand } from "@/lib/types";
import { useGeo } from "@/hooks/useGeo";
import { useApp } from "./Providers";

const TaxiMap = dynamic(() => import("./RouteMap").then((m) => m.TaxiMap), {
  ssr: false,
  loading: () => <div className="map-frame" />,
});

export function TaxiBoard() {
  const { settings } = useApp();
  const { pos } = useGeo(true);
  const [stands, setStands] = useState<TaxiStand[]>([]);
  const origin = pos ?? HANG_HAU;

  useEffect(() => {
    void loadTaxiStands().then(setStands);
  }, []);

  const nearby = useMemo(() => {
    return stands
      .map((s) => ({ ...s, d: haversine(origin, s) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 24);
  }, [stands, origin]);

  return (
    <div className="stack">
      <TaxiMap stands={nearby} user={pos} />
      {nearby.length === 0 ? (
        <p className="muted">{t(settings.lang, "Taxi stands", "的士站")}</p>
      ) : (
        nearby.map((stand) => (
          <article key={stand.id} className="card taxi-card">
            <div className="taxi-dot" />
            <div className="card-meta">
              <div className="dest">{nameOf(settings.lang, stand.name)}</div>
              <div className="stop">{nameOf(settings.lang, stand.kind)}</div>
            </div>
            <div className="taxi-d">{formatDistance(stand.d, settings.lang)}</div>
          </article>
        ))
      )}
    </div>
  );
}
