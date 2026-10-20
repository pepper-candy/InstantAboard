"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistance } from "@/lib/geo";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { nearbyTramStops, type TramDirRef, type TramLine, type TramStation } from "@/lib/stopIndex";
import type { Lang, Pin } from "@/lib/types";
import { IconChevron, IconSwapDir, IconTram } from "./Icons";
import { MtrHoursButton } from "./MtrHours";
import { useApp } from "./Providers";
import { TramHoursPanel, useTramHoursData } from "./TramHours";

export function TramBoard({
  focusedId = null,
  squeeze = false,
  onFocus,
  onOpen,
}: {
  tick?: number;
  focusedId?: string | null;
  squeeze?: boolean;
  onFocus?: (place: { id: string; lat: number; lng: number }) => void;
  onOpen?: (pin: Pin) => void;
}) {
  const { db, settings, origin } = useApp();
  const stations = useMemo(() => nearbyTramStops(db, origin), [db, origin]);
  const [openId, setOpenId] = useState<string | null>(null);
  const lastFocus = useRef(focusedId);

  useEffect(() => {
    if (stations.length === 0) {
      setOpenId(null);
      return;
    }
    const ids = new Set(stations.map((station) => `tram:${station.stopId}`));
    const first = `tram:${stations[0].stopId}`;
    setOpenId((cur) => (cur && ids.has(cur) ? cur : first));
  }, [stations]);

  useEffect(() => {
    if (focusedId && focusedId !== lastFocus.current) setOpenId(focusedId);
    lastFocus.current = focusedId;
  }, [focusedId]);

  if (!db) return <Skeleton />;
  if (stations.length === 0) return <p className="muted">{t(settings.lang, "Tram", "電車")}</p>;

  const firstId = stations[0] ? `tram:${stations[0].stopId}` : null;
  const shownId = squeeze ? null : openId ?? firstId;

  return (
    <div className="stack">
      {stations.map((station) => (
        <TramStationCard
          key={station.stopId}
          station={station}
          open={shownId === `tram:${station.stopId}`}
          lang={settings.lang}
          onToggle={() => {
            if (squeeze) return;
            const id = `tram:${station.stopId}`;
            const next = openId !== id;
            setOpenId(next ? id : null);
            if (next) onFocus?.({ id, lat: station.lat, lng: station.lng });
          }}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function TramStationCard({
  station,
  open,
  lang,
  onToggle,
  onOpen,
}: {
  station: TramStation;
  open: boolean;
  lang: Lang;
  onToggle: () => void;
  onOpen?: (pin: Pin) => void;
}) {
  const { db } = useApp();
  const [hoursOpen, setHoursOpen] = useState(false);
  const hours = useTramHoursData(db, station);

  return (
    <article
      className={`card peek-card mtr-station${open ? " is-on" : ""}`}
      data-place-id={`tram:${station.stopId}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <div className="card-top tight mtr-station-head">
        <span className="mtr-drop" aria-hidden="true">
          <IconChevron className="icon-md" />
        </span>
        <span className="mtr-station-title">
          <span className="dest">{nameOf(lang, station.name)}</span>
          <MtrHoursButton
            lang={lang}
            open={hoursOpen}
            onToggle={() => {
              const next = !hoursOpen;
              setHoursOpen(next);
              if (next && !open) onToggle();
            }}
          />
        </span>
        <span className="stop">{formatDistance(station.d, lang)}</span>
      </div>
      <div className="mtr-station-lines">
        <div className="mtr-station-lines-inner">
          <div className={`mtr-hours-fold${hoursOpen ? " is-open" : ""}`}>
            <div className="mtr-hours-fold-inner">
              <TramHoursPanel lang={lang} data={hours} />
            </div>
          </div>
          {station.lines.map((line) => (
            <TramLineRow key={line.routeId} station={station} line={line} lang={lang} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </article>
  );
}

function tramHomeSide(line: TramLine, stopId: string): "OUT" | "IN" {
  if (line.dirs.OUT?.stopId === stopId) return "OUT";
  if (line.dirs.IN?.stopId === stopId) return "IN";
  return line.dirs.OUT ? "OUT" : "IN";
}

function TramLineRow({
  station,
  line,
  lang,
  onOpen,
}: {
  station: TramStation;
  line: TramLine;
  lang: Lang;
  onOpen?: (pin: Pin) => void;
}) {
  const canFlip = Boolean(line.dirs.OUT && line.dirs.IN);
  const [dir, setDir] = useState<"OUT" | "IN">(() => tramHomeSide(line, station.stopId));
  const otherDir: "OUT" | "IN" = dir === "OUT" ? "IN" : "OUT";
  const active: TramDirRef | undefined = line.dirs[dir] ?? line.dirs.OUT ?? line.dirs.IN;
  const other = canFlip ? line.dirs[otherDir] : undefined;
  const otherToward = towardLabel(lang, other?.dest);
  const swapHint = other
    ? t(lang, `Tap ⇄ to switch to ${otherToward}`, `輕觸 ⇄ 切換至${otherToward}`)
    : null;

  return (
    <div
      className="mtr-line"
      onClick={(event) => {
        event.stopPropagation();
        if (!active) return;
        onOpen?.({
          id: crypto.randomUUID(),
          routeId: active.routeId,
          company: "tram",
          stopId: active.stopId,
          stopSeq: active.stopSeq,
          auto: false,
        });
      }}
    >
      <div className="card-top">
        <IconTram className="kind-tram" />
        <div className="card-meta">
          <div className="dest">{towardLabel(lang, active?.dest ?? line.dest)}</div>
          {swapHint ? <div className="stop">{swapHint}</div> : null}
        </div>
        {canFlip ? (
          <button
            type="button"
            className="dir-swap"
            aria-label={swapHint ?? (lang === "zh" ? "轉換方向" : "Switch direction")}
            onClick={(event) => {
              event.stopPropagation();
              setDir((cur) => (cur === "OUT" ? "IN" : "OUT"));
            }}
          >
            <IconSwapDir className="icon-md" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card card-skel" />
      ))}
    </>
  );
}
