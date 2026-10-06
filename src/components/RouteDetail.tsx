"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouteLine } from "@/hooks/useRouteLine";
import { mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
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
import { MtrHours } from "./MtrHours";
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
  const { db, pins, etas, updatedAt, busy, settings, addPin, removePin, refreshPin } = useApp();
  const [guestRows, setGuestRows] = useState<Arrival[] | undefined>(seedArrivals);
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestTick, setGuestTick] = useState(0);
  const [view, setView] = useState<{ stopId: string; stopSeq: number } | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const engagedPin = useRef<string | null>(null);
  const didScroll = useRef(false);
  const stored = pins.find((p) => p.id === pinId) ?? pins.find((p) => p.routeId === draft?.routeId);
  const pin = draft ?? stored;
  const live = pin && view ? { ...pin, ...view, auto: false } : pin;
  const route = pin ? db?.routeList[pin.routeId] : undefined;
  const viewing = live ?? pin;
  const guest = Boolean(draft) || !stored;
  const arrivals = guest ? guestRows : pin && stored ? etas[stored.id] : guestRows;

  const company = pin?.company;
  const routeId = pin?.routeId;
  const stopSeq = viewing?.stopSeq ?? 0;
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

  const selected = viewing && db ? (db.stopList[viewing.stopId]?.location ?? null) : null;
  const line = useRouteLine(company, route, path);
  const fullTrack = useMemo(() => (line && line.length > 1 ? line : path), [line, path]);
  const stopIds = useMemo(() => (route && company ? (route.stops[company] ?? []) : []), [route, company]);
  const fleet = useRouteFleet(company, route, stopIds, path, fullTrack);
  const road = fleet != null || isRoadFleet(company);
  const track = useMemo(
    () => (road ? fullTrack : pathUpTo(path, stopSeq, line)),
    [road, fullTrack, path, stopSeq, line],
  );
  const sampledAt = stored ? (updatedAt[stored.id] ?? 0) : 0;
  const vehicle = useMemo(() => {
    if (!company || road) return null;
    return estimateVehicle(track, arrivals ?? [], company);
  }, [road, track, arrivals, company, sampledAt]);
  const pinStopId = viewing?.stopId;
  const stationColors = useMemo(
    () => (db && company === "mtr" && pinStopId ? mtrLineColorsAtStop(db, pinStopId) : []),
    [db, company, pinStopId],
  );
  const color = route && pin ? routeColor(pin.company, route.route) : "#888888";
  const ink = route && pin ? onRouteColor(pin.company, route.route) : "#ffffff";
  const follow = !view;

  useEffect(() => {
    engagedPin.current = null;
    setView(null);
  }, [pin?.routeId]);

  useEffect(() => {
    if (!viewing || !db || (!guest && !view)) return;
    let alive = true;
    setGuestBusy(true);
    void fetchArrivals(db, viewing, settings.lang)
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
    // viewing is rebuilt each render; pin fields are the actual inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, settings.lang, guestTick, refreshToken, guest, view, viewing?.routeId, viewing?.stopId, viewing?.stopSeq, viewing?.company]);
  const overlayKey = viewing ? `${pin?.id}:${viewing.stopId}:${viewing.stopSeq}:${follow ? 1 : 0}:${focusToken}` : "";

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
    if (engagedPin.current === pin.routeId) return;
    engagedPin.current = pin.routeId;
    didScroll.current = false;
  }, [pin, db]);

  useLayoutEffect(() => {
    const row = activeRef.current;
    const list = listRef.current;
    if (!viewing || !row || !list) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const seen = rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1;
    if (view && seen && didScroll.current) return;
    const top = rowBox.top - listBox.top + list.scrollTop;
    const instant = !didScroll.current;
    didScroll.current = true;
    list.scrollTo({ top: Math.max(0, top - 8), behavior: reduce || instant ? "auto" : "smooth" });
  }, [view, viewing?.stopId, viewing?.stopSeq, pin?.routeId, listRef]);

  if (!pin || !route) {
    return (
      <div className="route-sheet">
        <FilterChips onClosePeek={onClose} />
      </div>
    );
  }

  const pinned = Boolean(stored);
  const togglePin = () => {
    if (stored) {
      removePin(stored.id);
      onDraft?.({ ...pin, id: crypto.randomUUID(), auto: true });
      return;
    }
    addPin({ ...pin, id: crypto.randomUUID(), auto: true });
  };

  return (
    <div className="route-sheet">
      <FilterChips
        onClosePeek={onClose}
        pinOn={pinned}
        onPin={togglePin}
        routeChip={
          <div className="chip chip-kind route-chip">
            {companyMode(pin.company) === "mtr" ? (
              <MtrLogo className="mode-logo" lines={stationColors.length ? stationColors : [color]} />
            ) : null}
            {companyMode(pin.company) === "mtr" ? (
              <span className="mtr-line-label">{mtrLineName(settings.lang, route.route)}</span>
            ) : (
              <span className="route-badge" style={{ background: color, color: ink }}>
                {route.route}
              </span>
            )}
            <div className="dest">{nameOf(settings.lang, route.dest)}</div>
          </div>
        }
      />
      <div className="card route-eta-card">
        <div className="route-eta-head">
          {arrivals?.some((row) => row.dir === "depart" || row.dir === "arrive") ? null : (
            <p className="route-eta-kicker">{t(settings.lang, "Est. Time of Arrival", "預計到站時間")}</p>
          )}
          {pin.company === "mtr" ? <MtrHours line={route.route} stopId={viewing?.stopId ?? pin.stopId} lang={settings.lang} /> : null}
          <p className="route-eta-note">{t(settings.lang, "Map Simulations are for Reference only", "地圖上行車模擬僅供參考")}</p>
        </div>
        <button
          type="button"
          className="etas-btn"
          aria-label="Refresh"
          onClick={() => {
            if (guest || view) setGuestTick((n) => n + 1);
            else if (stored) void refreshPin(stored.id);
          }}
        >
          <EtaStrip arrivals={arrivals} lang={settings.lang} busy={guest || view ? guestBusy : busy[stored?.id ?? ""]} />
        </button>
      </div>
      <div className="stack detail-stops" ref={listRef}>
        {stopIds.map((id, seq) => {
          const stop = db?.stopList[id];
          const on = id === (viewing?.stopId ?? pin.stopId) && seq === (viewing?.stopSeq ?? pin.stopSeq);
          return (
            <button
              key={`${id}-${seq}`}
              type="button"
              ref={on ? activeRef : undefined}
              className={`card tap-row ${on ? "is-on-stop" : ""}`}
              onClick={() => {
                setView({ stopId: id, stopSeq: seq });
                if (draft) onDraft?.({ ...draft, stopId: id, stopSeq: seq, auto: false });
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
