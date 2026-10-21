"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouteLine } from "@/hooks/useRouteLine";
import { mtrLineName, onRouteColor, routeColor } from "@/lib/colors";
import { fetchArrivals } from "@/lib/eta";
import { RECONNECT_EVENT } from "@/lib/online";
import { nameOf, t, towardLabel } from "@/lib/i18n";
import { companyMode } from "@/lib/mode";
import { closestStopForPin } from "@/lib/nearest";
import { oppositeBound, stopLocation } from "@/lib/opposite";
import { mtrLineColorsAtStop } from "@/lib/stopIndex";
import { kaitoServiceOf } from "@/lib/extras";
import { tramHoursAtStop } from "@/lib/tramHours";
import { ETA_POLL_MS, sameArrivals } from "@/hooks/useEtas";
import { useRouteFleet } from "@/hooks/useRouteFleet";
import { estimateVehicle, isRoadFleet, pathUpTo } from "@/lib/vehicle";
import type { LatLng } from "@/lib/geo";
import type { Arrival, Lang, Pin } from "@/lib/types";
import { EtaStrip, rankDests, TowardDests } from "./EtaStrip";
import { FilterChips } from "./FilterChips";
import { MtrHours } from "./MtrHours";
import { IconInfo, IconSwapDir, IconTram, MtrLogo } from "./Icons";
import { RouteTramHours } from "./TramHours";
import type { RouteOverlay } from "./RouteMap";
import { useApp } from "./Providers";

function pinKeyOf(pin: Pick<Pin, "routeId" | "company" | "stopId" | "stopSeq">): string {
  return `${pin.routeId}:${pin.company}:${pin.stopId}:${pin.stopSeq}`;
}

export function RouteSheet({
  pinId,
  draft,
  seedArrivals,
  refreshToken = 0,
  onDraft,
  onSaved,
  listRef,
  onClose,
  onMap,
  onFocus,
  focusToken,
  locateToken = 0,
}: {
  pinId: string;
  draft?: Pin | null;
  seedArrivals?: Arrival[];
  refreshToken?: number;
  onDraft?: (pin: Pin) => void;
  onSaved?: (id: string | null) => void;
  listRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMap: (overlay: RouteOverlay | null) => void;
  onFocus: () => void;
  focusToken: number;
  locateToken?: number;
}) {
  const { db, pins, etas, updatedAt, busy, settings, addPin, removePin, refreshPin, updatePin, pos, origin, devPin, requestPos } =
    useApp();
  const [guestBusy, setGuestBusy] = useState(false);
  const [view, setView] = useState<{ routeId: string; stopId: string; stopSeq: number } | null>(null);
  const [liveEta, setLiveEta] = useState<{ key: string; rows: Arrival[] } | undefined>(() =>
    seedArrivals && draft ? { key: pinKeyOf(draft), rows: seedArrivals } : undefined,
  );
  const activeRef = useRef<HTMLButtonElement>(null);
  const engagedPin = useRef<string | null>(null);
  const didScroll = useRef(false);
  const storedById = pinId ? pins.find((p) => p.id === pinId) : undefined;
  const pin = draft ?? storedById;
  const live = pin && view ? { ...pin, ...view, auto: false } : pin;
  const viewing = live ?? pin;
  const stored =
    storedById ??
    (viewing
      ? pins.find((p) => p.routeId === viewing.routeId && p.company === viewing.company)
      : undefined);
  const route = viewing ? db?.routeList[viewing.routeId] : undefined;
  const guest = Boolean(draft) || !stored;
  const viewKey = viewing ? pinKeyOf(viewing) : "";
  const storedKey = stored ? pinKeyOf(stored) : "";
  const arrivals =
    liveEta?.key === viewKey
      ? liveEta.rows
      : stored && storedKey === viewKey
        ? etas[stored.id]
        : undefined;

  const company = viewing?.company ?? pin?.company;
  const routeId = viewing?.routeId;
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
  const fleet = useRouteFleet(company, route, stopIds, path, fullTrack, db?.holidays ?? []);
  const road = isRoadFleet(company) || company === "mtr" || company === "tram";
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
  const posRef = useRef(pos);
  const originRef = useRef(origin);
  const devPinRef = useRef(devPin);
  const pinRef = useRef(pin);
  const onFocusRef = useRef(onFocus);
  const storedRef = useRef(stored);
  const onDraftRef = useRef(onDraft);
  posRef.current = pos;
  originRef.current = origin;
  devPinRef.current = devPin;
  pinRef.current = pin;
  onFocusRef.current = onFocus;
  storedRef.current = stored;
  onDraftRef.current = onDraft;
  const viewingRef = useRef(viewing);
  const dbRef = useRef(db);
  const langRef = useRef(settings.lang);
  viewingRef.current = viewing;
  dbRef.current = db;
  langRef.current = settings.lang;
  const etaTicket = useRef(0);

  const regrabEta = useCallback((silent: boolean) => {
    const currentDb = dbRef.current;
    const current = viewingRef.current;
    if (!currentDb || !current?.stopId) return;
    if (current.company === "tram") return;
    if (silent && document.hidden) return;
    const key = pinKeyOf(current);
    const mine = ++etaTicket.current;
    if (!silent) setGuestBusy(true);
    void fetchArrivals(currentDb, current, langRef.current)
      .then((rows) => {
        if (etaTicket.current !== mine) return;
        setLiveEta((prev) => (prev?.key === key && sameArrivals(prev.rows, rows) ? prev : { key, rows }));
      })
      .catch(() => {
        if (etaTicket.current !== mine) return;
        setLiveEta((prev) => (prev?.key === key ? prev : { key, rows: [] }));
      })
      .finally(() => {
        if (etaTicket.current === mine && !silent) setGuestBusy(false);
      });
  }, []);
  const regrabEtaRef = useRef(regrabEta);
  regrabEtaRef.current = regrabEta;

  const userHere = () => (devPinRef.current ? originRef.current : posRef.current);

  const applyClosest = (at: LatLng, nextRouteId?: string) => {
    const current = pinRef.current;
    if (!db || !current) return null;
    const rid = nextRouteId ?? viewingRef.current?.routeId ?? current.routeId;
    const stop = closestStopForPin(db, { ...current, routeId: rid }, at, rid);
    if (!stop) return null;
    const next = { routeId: rid, ...stop };
    setView(next);
    onFocusRef.current();
    return next;
  };

  const pickStop = (seq: number) => {
    const current = pinRef.current;
    if (!db || !current) return;
    const rid = viewingRef.current?.routeId ?? current.routeId;
    const ids = db.routeList[rid]?.stops[current.company] ?? [];
    const id = ids[seq];
    if (!id) return;
    setView({ routeId: rid, stopId: id, stopSeq: seq });
    if (onDraftRef.current && (draft || !storedRef.current)) {
      onDraftRef.current({ ...current, routeId: rid, stopId: id, stopSeq: seq, auto: false });
    }
    onFocusRef.current();
  };
  const pickStopRef = useRef(pickStop);
  pickStopRef.current = pickStop;

  // First enter only: snap to closest if a fix already exists. Later GPS polls must not move the map/list.
  useEffect(() => {
    engagedPin.current = null;
    didScroll.current = false;
    const here = userHere();
    const current = pinRef.current;
    if (here && current?.auto !== false) applyClosest(here);
    else if (current?.stopId) {
      setView({ routeId: current.routeId, stopId: current.stopId, stopSeq: current.stopSeq });
      onFocusRef.current();
    } else setView(null);
    // pin.id is the open session; direction swap keeps the same pin id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.id, db]);

  // Locate is a click: pan/select with the last fix now. GPS refresh may refine later.
  // Do not wait on ETA polls or an in-flight arrival fetch.
  useEffect(() => {
    if (!locateToken) return;
    const at = userHere();
    if (at) applyClosest(at);
    if (devPinRef.current) return;
    let alive = true;
    void requestPos().then((here) => {
      if (!alive || !here) return;
      applyClosest(here);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateToken]);

  useEffect(() => {
    regrabEta(false);
    // viewing is rebuilt each render; pin fields are the actual inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, settings.lang, refreshToken, viewing?.routeId, viewing?.stopId, viewing?.stopSeq, viewing?.company, regrabEta]);

  useEffect(() => {
    const poll = () => regrabEtaRef.current(true);
    const timer = window.setInterval(poll, ETA_POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onReconnect = () => poll();
    window.addEventListener(RECONNECT_EVENT, onReconnect);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(RECONNECT_EVENT, onReconnect);
    };
  }, []);
  const overlayKey = viewing
    ? `${pin?.id}:${viewing.routeId}:${viewing.stopId}:${viewing.stopSeq}:${follow ? 1 : 0}:${focusToken}`
    : "";

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
      vehicles: company === "mtr" || company === "tram" ? (fleet.vehicles ?? []) : undefined,
      simCores: isRoadFleet(company) ? (fleet.simCores ?? []) : undefined,
      simStale: isRoadFleet(company) ? fleet.simStale : undefined,
      track,
      mode: companyMode(pin.company),
      color,
      ink,
      follow,
      focusToken,
      onStop: (seq) => pickStopRef.current(seq),
    });
    // overlayKey stands in for the pin fields this view actually draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMap, overlayKey, route, path, routeStops, line, selected, vehicle, road, fleet, track, color, ink]);

  useEffect(() => () => onMap(null), [onMap]);

  useLayoutEffect(() => {
    if (!pin || !db) return;
    if (engagedPin.current === viewing?.routeId) return;
    engagedPin.current = viewing?.routeId ?? pin.routeId;
    didScroll.current = false;
  }, [pin, db, viewing?.routeId]);

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
  }, [view, viewing?.stopId, viewing?.stopSeq, viewing?.routeId, listRef]);

  if (!pin || !route) {
    return (
      <div className="route-sheet">
        <FilterChips onClosePeek={onClose} />
      </div>
    );
  }

  const waitingForStop =
    pin?.company !== "tram" &&
    Boolean(viewKey) &&
    liveEta?.key !== viewKey &&
    !(stored && storedKey === viewKey && etas[stored.id]);
  const etaLoading = guestBusy || waitingForStop;
  const pinned = Boolean(stored);
  const flip = db && viewing ? oppositeBound(db, viewing) : null;
  const alongDir = (route.bound[pin.company] ?? "").toUpperCase().includes("DT") ? "DOWN" : "UP";
  const headerDests =
    pin.company === "mtr"
      ? rankDests(
          (arrivals ?? []).filter((row) => !row.dir || row.dir === alongDir),
          route.dest,
        )
      : [route.dest];
  const togglePin = () => {
    const current = viewing ?? pin;
    if (!current) return;
    if (stored) {
      removePin(stored.id);
      onDraft?.({ ...current, id: crypto.randomUUID(), auto: true });
      onSaved?.(null);
      return;
    }
    const id = crypto.randomUUID();
    addPin({ ...current, id, auto: true });
    onSaved?.(id);
  };
  const swapDir = () => {
    if (!db || !flip || !viewing) return;
    const stationAt = stopLocation(db, viewing.stopId);
    const near = stationAt ?? userHere();
    if (!near) return;
    const next = applyClosest(near, flip.routeId);
    if (!next) return;
    const patch = { ...next, auto: false as const };
    if (draft) onDraft?.({ ...pin, ...patch });
    else if (stored) updatePin(stored.id, patch);
    else onDraft?.({ ...pin, ...patch });
  };
  const headerInner = (
    <>
      {companyMode(pin.company) === "mtr" ? (
        <MtrLogo className="mode-logo" lines={stationColors.length ? stationColors : [color]} />
      ) : null}
      {companyMode(pin.company) === "mtr" ? (
        <span className="mtr-line-label">{mtrLineName(settings.lang, route.route)}</span>
      ) : companyMode(pin.company) === "tram" ? (
        <IconTram className="kind-tram" />
      ) : (
        <span className="route-badge" style={{ background: color, color: ink }}>
          {route.route}
        </span>
      )}
      <div className="dest">
        {headerDests.length > 1 ? (
          <TowardDests lang={settings.lang} dests={headerDests} />
        ) : (
          towardLabel(settings.lang, headerDests[0] ?? route.dest)
        )}
      </div>
      {flip ? (
        <span className="dir-swap" aria-hidden="true">
          <IconSwapDir className="icon-md" />
        </span>
      ) : null}
    </>
  );

  return (
    <div className="route-sheet">
      <FilterChips
        onClosePeek={onClose}
        pinOn={pinned}
        onPin={togglePin}
        routeChip={
          flip ? (
            <button
              type="button"
              className="chip chip-kind route-chip"
              aria-label={t(settings.lang, "Switch direction", "轉換方向")}
              onClick={swapDir}
            >
              {headerInner}
            </button>
          ) : (
            <div className="chip chip-kind route-chip">{headerInner}</div>
          )
        }
      />
      <div
        className="card route-eta-card"
        onClick={() => {
          regrabEta(false);
          if (stored && !guest) void refreshPin(stored.id);
        }}
      >
        <div className="route-eta-head">
          {pin.company === "tram" ? (
            <p className="route-eta-kicker">{t(settings.lang, "Simulated", "模擬")}</p>
          ) : arrivals?.some((row) => row.dir === "depart" || row.dir === "arrive") ? null : (
            <p className="route-eta-kicker">{t(settings.lang, "Est. Time of Arrival", "預計到站時間")}</p>
          )}
          <p className="route-eta-note">{t(settings.lang, "Map Simulations are for Reference only", "地圖上行車模擬僅供參考")}</p>
          {pin.company === "mtr" ? <MtrHours line={route.route} stopId={viewing?.stopId ?? pin.stopId} lang={settings.lang} /> : null}
          {pin.company === "tram" ? (
            <RouteTramHours hours={tramHoursAtStop(route, viewing?.stopSeq ?? pin.stopSeq)} lang={settings.lang} />
          ) : null}
          {pin.company === "kaito" ? <KaitoHours routeId={pin.routeId} lang={settings.lang} /> : null}
        </div>
        {pin.company === "tram" ? null : (
          <EtaStrip
            arrivals={arrivals}
            lang={settings.lang}
            busy={guest || view ? guestBusy : busy[stored?.id ?? ""]}
            company={pin.company}
            onRefresh={() => {
              regrabEta(false);
              if (stored && !guest) void refreshPin(stored.id);
            }}
          />
        )}
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
              onClick={() => pickStop(seq)}
            >
              <span className="dest">{nameOf(settings.lang, stop?.name)}</span>
              {on ? (
                <span className={`stop-mark${etaLoading ? " is-loading" : ""}`} aria-hidden />
              ) : (
                <span className="stop-seq">{seq + 1}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KaitoHours({ routeId, lang }: { routeId: string; lang: Lang }) {
  const svc = kaitoServiceOf(routeId);
  const [open, setOpen] = useState(false);
  if (!svc) return null;
  const url = lang === "zh" ? svc.timetableUrl.zh : svc.timetableUrl.en;
  const lines = svc.schedule
    .map((row) => {
      if (row.type === "note") return row.text;
      return Array.isArray(row.raw) ? row.raw.filter(Boolean).join(" ") : row.raw;
    })
    .filter(Boolean);
  return (
    <div className="mtr-hours">
      <button
        type="button"
        className="mtr-hours-btn"
        aria-expanded={open}
        aria-label={t(lang, "Timetable", "時間表")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <IconInfo className="icon-sm" />
      </button>
      {open ? (
        <div className="kaito-hours" onClick={(e) => e.stopPropagation()}>
          {lines.map((line, i) => (
            <p key={i} className="route-eta-note">
              {line}
            </p>
          ))}
          {url ? (
            <a className="kaito-tt" href={url} target="_blank" rel="noreferrer">
              {t(lang, "Timetable", "時間表")}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
