"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouteLine } from "@/hooks/useRouteLine";
import { onRouteColor, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { nameOf, t } from "@/lib/i18n";
import { companyMode } from "@/lib/mode";
import { mtrLineColorsAtStop } from "@/lib/stopIndex";
import { useRouteFleet } from "@/hooks/useRouteFleet";
import { estimateVehicle, isRoadFleet, pathUpTo } from "@/lib/vehicle";
import type { LatLng } from "@/lib/geo";
import type { Arrival, Pin } from "@/lib/types";
import { EtaStrip } from "./EtaStrip";
import { FilterChips } from "./FilterChips";
import { MtrLogo } from "./Icons";
import type { RouteOverlay } from "./RouteMap";
import { useApp } from "./Providers";

export function RouteSheet({
  pinId,
  draft,
  seedArrivals,
  refreshToken = 0,
  onDraft,
  listRef,
  onClose,
  onMap,
  onFocus,
  focusToken,
}: {
  pinId: string;
  draft?: Pin | null;
  seedArrivals?: Arrival[];
  refreshToken?: number;
  onDraft?: (pin: Pin) => void;
  listRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMap: (overlay: RouteOverlay | null) => void;
  onFocus: () => void;
  focusToken: number;
}) {
  const { db, pins, etas, updatedAt, busy, settings, updatePinStop, refreshPin } = useApp();
  const [guestRows, setGuestRows] = useState<Arrival[] | undefined>(seedArrivals);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestTick, setGuestTick] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);
  const engagedPin = useRef<string | null>(null);
  const didScroll = useRef(false);
  const pin = draft ?? pins.find((p) => p.id === pinId);
  const route = pin ? db?.routeList[pin.routeId] : undefined;
  const arrivals = draft ? guestRows : pin ? etas[pin.id] : undefined;

  const company = pin?.company;
  const routeId = pin?.routeId;
  const stopSeq = pin?.stopSeq ?? 0;
  const stopKey = route && company ? (route.stops[company] ?? []).join("|") : "";
  const routeStops = useMemo(() => {
    if (!db || !company || !routeId) return [];
    const ids = db.routeList[routeId]?.stops[company] ?? [];
    const rows: { lat: number; lng: number; seq: number }[] = [];
    ids.forEach((id, seq) => {
      const loc = db.stopList[id]?.location;
      if (loc) rows.push({ lat: loc.lat, lng: loc.lng, seq });
    });
    return rows;
  }, [db, company, routeId, stopKey]);
  const path = useMemo<LatLng[]>(() => routeStops.map(({ lat, lng }) => ({ lat, lng })), [routeStops]);

  const selected = pin && db ? (db.stopList[pin.stopId]?.location ?? null) : null;
  const line = useRouteLine(company, route, path);
  const fullTrack = useMemo(() => (line && line.length > 1 ? line : path), [line, path]);
  const stopIds = useMemo(() => (route && company ? (route.stops[company] ?? []) : []), [route, company]);
  const fleet = useRouteFleet(company, route, stopIds, path, fullTrack);
  const road = fleet != null || isRoadFleet(company);
  const track = useMemo(
    () => (road ? fullTrack : pathUpTo(path, stopSeq, line)),
    [road, fullTrack, path, stopSeq, line],
  );
  const sampledAt = pin ? (updatedAt[pin.id] ?? 0) : 0;
  const vehicle = useMemo(() => {
    if (!company || road) return null;
    return estimateVehicle(track, arrivals ?? [], company);
  }, [road, track, arrivals, company, sampledAt]);
  const pinStopId = pin?.stopId;
  const stationColors = useMemo(
    () => (db && company === "mtr" && pinStopId ? mtrLineColorsAtStop(db, pinStopId) : []),
    [db, company, pinStopId],
  );
  const color = route && pin ? routeColor(pin.company, route.route) : "#888888";
  const ink = route && pin ? onRouteColor(pin.company, route.route) : "#ffffff";
  const follow = Boolean(pin?.auto);

  useEffect(() => {
    if (!draft || !db) return;
    let alive = true;
    setGuestBusy(true);
    void fetchArrivals(db, draft, settings.lang)
      .then((rows) => {
        if (alive) setGuestRows(rows);
      })
      .catch(() => {
        if (alive) setGuestRows([]);
      })
      .finally(() => {
        if (alive) setGuestBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [draft, db, settings.lang, guestTick, refreshToken]);
  const overlayKey = pin ? `${pin.id}:${pin.stopId}:${pin.stopSeq}:${follow ? 1 : 0}:${focusToken}` : "";

  useEffect(() => {
    if (!pin || !route) {
      onMap(null);
      return;
    }
    onMap({
      path,
      stops: routeStops,
      line,
      selected,
      vehicle,
      vehicles: road ? (fleet ?? []) : undefined,
      track,
      mode: companyMode(pin.company),
      color,
      ink,
      follow,
      focusToken,
    });
    // overlayKey stands in for the pin fields this view actually draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMap, overlayKey, route, path, routeStops, line, selected, vehicle, road, fleet, track, color, ink]);

  useEffect(() => () => onMap(null), [onMap]);

  useLayoutEffect(() => {
    if (!pin || !db) return;
    if (engagedPin.current === pin.id) return;
    engagedPin.current = pin.id;
    didScroll.current = false;
    if (!draft && !pin.auto) updatePinStop(pin.id, pin.stopId, pin.stopSeq, true);
  }, [pin, db, updatePinStop]);

  useLayoutEffect(() => {
    const row = activeRef.current;
    const list = listRef.current;
    if (!pin || !row || !list) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const seen = rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1;
    if (!pin.auto && seen && didScroll.current) return;
    const top = rowBox.top - listBox.top + list.scrollTop;
    const instant = !didScroll.current;
    didScroll.current = true;
    list.scrollTo({ top: Math.max(0, top - 8), behavior: reduce || instant ? "auto" : "smooth" });
  }, [pin?.auto, pin?.stopId, pin?.stopSeq, pin?.id, listRef]);

  if (!pin || !route) {
    return (
      <div className="route-sheet">
        <FilterChips onClosePeek={onClose} />
      </div>
    );
  }

  return (
    <div className="route-sheet">
      <FilterChips
        onClosePeek={onClose}
        routeChip={
          <div className="chip chip-kind route-chip">
            {companyMode(pin.company) === "mtr" ? (
              <MtrLogo className="mode-logo" lines={stationColors.length ? stationColors : [color]} />
            ) : null}
            <span className="route-badge" style={{ background: color, color: ink }}>
              {route.route}
            </span>
            <div className="dest">{nameOf(settings.lang, route.dest)}</div>
          </div>
        }
      />
      <div className="card route-eta-card">
        <div className="route-eta-head">
          {arrivals?.some((row) => row.dir === "depart" || row.dir === "arrive") ? null : (
            <p className="route-eta-kicker">{t(settings.lang, "Est. Time of Arrival", "預計到站時間")}</p>
          )}
          <p className="route-eta-note">{t(settings.lang, "Map Simulations are for Reference only", "地圖上行車模擬僅供參考")}</p>
        </div>
        <button
          type="button"
          className="etas-btn"
          aria-label="Refresh"
          onClick={() => {
            if (draft) setGuestTick((n) => n + 1);
            else void refreshPin(pin.id);
          }}
        >
          <EtaStrip arrivals={arrivals} lang={settings.lang} busy={draft ? guestBusy : busy[pin.id]} />
        </button>
      </div>
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
                if (draft && onDraft) onDraft({ ...draft, stopId: id, stopSeq: seq, auto: false });
                else updatePinStop(pin.id, id, seq, false);
                onFocus();
              }}
            >
              <span className="dest">{nameOf(settings.lang, stop?.name)}</span>
              {on ? <span className="stop-mark" /> : <span className="stop-seq">{seq + 1}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
