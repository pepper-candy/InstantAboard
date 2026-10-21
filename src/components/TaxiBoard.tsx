"use client";

import { useEffect } from "react";
import { formatDistance, haversine, type LatLng } from "@/lib/geo";
import { nameOf, t } from "@/lib/i18n";
import { scrollSheetCardTop } from "@/lib/sheetScroll";
import { taxiStandLabel } from "@/lib/taxi";
import type { NearbyPlace } from "@/lib/types";
import { IconTaxi } from "./Icons";
import { useApp } from "./Providers";

export function TaxiBoard({
  places,
  origin,
  focusedId,
  focusToken = 0,
  squeeze = false,
  onFocus,
}: {
  places: NearbyPlace[];
  origin: LatLng;
  focusedId: string | null;
  focusToken?: number;
  squeeze?: boolean;
  onFocus: (place: NearbyPlace) => void;
}) {
  const { settings } = useApp();
  const stands = places.filter((place) => place.kind === "taxi");
  const standKey = stands.map((stand) => stand.id).join("|");

  useEffect(() => {
    if (!focusedId) return;
    const card = document.querySelector(`[data-taxi="${CSS.escape(focusedId)}"]`);
    if (card instanceof HTMLElement) scrollSheetCardTop(card);
  }, [focusedId, focusToken, standKey]);

  return (
    <div className="stack">
      {stands.length === 0 ? (
        <p className="muted">{t(settings.lang, "Taxi stands", "的士站")}</p>
      ) : (
        stands.map((stand) => (
          <button
            key={stand.id}
            type="button"
            data-taxi={stand.id}
            className={`card taxi-card${focusedId === stand.id ? " is-on" : ""}`}
            onClick={() => onFocus(stand)}
          >
            <IconTaxi className="icon-md logo-icon" />
            <div className="card-meta">
              <div className="dest">{nameOf(settings.lang, stand.name)}</div>
              <div className="stop">{taxiStandLabel(settings.lang, stand.taxiColors)}</div>
            </div>
            <div className="taxi-d">{formatDistance(haversine(origin, stand), settings.lang)}</div>
          </button>
        ))
      )}
    </div>
  );
}
