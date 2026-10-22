"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { CircleMarker, MapContainer, useMap } from "react-leaflet";
import { BrightBasemap, getIaMaplibreMap, registerIaGlStyleEnsure } from "@/lib/basemap";
import { MODE_COLOR } from "@/lib/colors";
import {
  clearIaRouteLine,
  ensureIaRouteLineForMap,
  setIaRouteLine,
} from "@/lib/glRouteLine";
import {
  clearIaRouteLiveVehicles,
  clearIaRouteSimMarkers,
  ensureIaRouteLiveVehiclesForMap,
  ensureIaRouteSimMarkersForMap,
  setIaRouteSimMarkers,
  upsertIaLiveVehicle,
  type IaRouteChevronMark,
  type IaRouteEstimateMark,
  type IaRouteFlagMark,
  type IaRouteVehicleMark,
} from "@/lib/glRouteMarkers";
import {
  clearIaRouteStops,
  ensureIaRouteStopsForMap,
  setIaRouteStops,
} from "@/lib/glRouteStops";
import { MAP_MAX_BOUNDS } from "@/lib/mapBounds";
import { applyPackFillMinZoom } from "@/lib/mapBoundsLeaflet";
import { cameraForVisibleCenter, fitVisibleBounds, flyVisible, glideMap } from "@/lib/mapCamera";
import { cumulativeDistances, placeOnPath, type LatLng } from "@/lib/geo";
import {
  chevronsAlong,
  easeToward,
  placeSimSpan,
  projectSimRegions,
  type SimCore,
} from "@/lib/simRegion";
import { createVehicleMotion } from "@/lib/vehicle";
import type { BusSimRegion, Mode, VehicleDot } from "@/lib/types";
import "leaflet/dist/leaflet.css";

/** Cap while waiting for useRouteLine shape before first fit (B#3). */
const SHAPE_WAIT_MS = 800;

function paint(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

export type RouteStop = { lat: number; lng: number; seq: number };

export type RouteOverlay = {
  path: LatLng[];
  stops?: RouteStop[];
  line?: LatLng[] | null;
  selected?: LatLng | null;
  vehicle?: VehicleDot | null;
  vehicles?: VehicleDot[] | null;
  simRegions?: BusSimRegion[] | null;
  simCores?: SimCore[] | null;
  simStale?: boolean;
  track?: LatLng[] | null;
  mode?: Mode;
  color: string;
  ink?: string;
  follow?: boolean;
  focusToken?: number;
  /** Identity for full-route framing (e.g. routeId); change refits the drawn line. */
  routeKey?: string;
  /** Bump to re-fit the full route without changing selection. */
  fitToken?: number;
  onStop?: (seq: number) => void;
};

/** Poll until MapLibre attaches, re-apply after Bright↔PMTiles setStyle. */
function useIaGlBridge(
  map: LeafletMap,
  ensure: (m: LeafletMap) => void,
  clear: (m: LeafletMap) => void,
) {
  useEffect(() => {
    const apply = () => ensure(map);
    const unsub = registerIaGlStyleEnsure(apply);
    let pollId: number | undefined;
    let pollTimeoutId: number | undefined;
    if (!getIaMaplibreMap(map)) {
      pollId = window.setInterval(() => {
        if (!getIaMaplibreMap(map)) return;
        if (pollId !== undefined) window.clearInterval(pollId);
        pollId = undefined;
        apply();
      }, 50);
      pollTimeoutId = window.setTimeout(() => {
        if (pollId !== undefined) window.clearInterval(pollId);
        pollId = undefined;
      }, 5000);
    } else {
      apply();
    }
    return () => {
      unsub();
      if (pollId !== undefined) window.clearInterval(pollId);
      if (pollTimeoutId !== undefined) window.clearTimeout(pollTimeoutId);
      clear(map);
    };
    // ensure/clear are stable module fns
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
}

/** One style-ensure for live vehicle symbols (VehicleMarker only upserts). */
function GlLiveVehiclesBridge() {
  useIaGlBridge(useMap(), ensureIaRouteLiveVehiclesForMap, clearIaRouteLiveVehicles);
  return null;
}

/** Clear sim overlays when neither cores nor static regions are active. */
function GlSimIdle() {
  const map = useMap();
  useIaGlBridge(map, ensureIaRouteSimMarkersForMap, clearIaRouteSimMarkers);
  useEffect(() => {
    setIaRouteSimMarkers(map, null);
  }, [map]);
  return null;
}

type SimEase = { beforeM: number; aheadM: number; estimateM: number };

/** Animated sim band on MapLibre (buses, chevrons, flags, estimate). */
function SimMotionLayer({
  cores,
  stale,
  track,
  stops,
  mode,
  color,
  ink,
}: {
  cores: SimCore[];
  stale: boolean;
  track: LatLng[];
  stops: RouteStop[];
  mode: Mode;
  color: string;
  ink: string;
}) {
  const map = useMap();
  const coresRef = useRef(cores);
  const staleRef = useRef(stale);
  const trackRef = useRef(track);
  const stopsRef = useRef(stops);
  const colorRef = useRef(color);
  const modeRef = useRef(mode);
  const inkRef = useRef(ink);
  coresRef.current = cores;
  staleRef.current = stale;
  trackRef.current = track;
  stopsRef.current = stops;
  colorRef.current = color;
  modeRef.current = mode;
  inkRef.current = ink;

  useIaGlBridge(map, ensureIaRouteSimMarkersForMap, clearIaRouteSimMarkers);

  useEffect(() => {
    const eases = new Map<string, SimEase>();
    const snap = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cumTrack: LatLng[] | null = null;
    let cum: number[] = [];
    let lastT = 0;
    let raf = 0;

    const ensureCum = () => {
      const line = trackRef.current;
      if (line === cumTrack) return;
      cumTrack = line;
      cum = cumulativeDistances(line);
    };

    const loop = (t: number) => {
      const dt = lastT ? Math.min(0.05, Math.max(0, (t - lastT) / 1000)) : 0;
      lastT = t;
      const line = trackRef.current;
      const anchors = stopsRef.current;
      const frozen = coresRef.current;
      if (line.length < 2 || !frozen.length) {
        eases.clear();
        setIaRouteSimMarkers(map, null);
        raf = requestAnimationFrame(loop);
        return;
      }
      ensureCum();
      const targets = projectSimRegions(line, anchors, frozen, Date.now(), staleRef.current);
      const live = new Set<string>();
      const tint = paint(colorRef.current);
      const modeNow = modeRef.current;
      const inkNow = inkRef.current;
      const stopPts = anchors.map((s) => ({ lat: s.lat, lng: s.lng }));

      const vehicles: IaRouteVehicleMark[] = [];
      const chevrons: IaRouteChevronMark[] = [];
      const flags: IaRouteFlagMark[] = [];
      const estimates: IaRouteEstimateMark[] = [];

      for (const target of targets) {
        live.add(target.id);
        let row = eases.get(target.id);
        const beforeM = row && !snap ? easeToward(row.beforeM, target.beforeM, dt) : target.beforeM;
        const aheadM = row && !snap ? easeToward(row.aheadM, target.aheadM, dt) : target.aheadM;
        const estimateM = row && !snap ? easeToward(row.estimateM, target.estimateM, dt) : target.estimateM;
        const drawn = placeSimSpan(line, cum, stopPts, target.id, beforeM, aheadM, estimateM);
        if (!drawn) continue;
        eases.set(target.id, { beforeM, aheadM, estimateM });

        vehicles.push(
          { id: `${target.id}-before`, lat: drawn.before.lat, lng: drawn.before.lng, mode: modeNow, color: tint, ink: inkNow },
          { id: `${target.id}-ahead`, lat: drawn.ahead.lat, lng: drawn.ahead.lng, mode: modeNow, color: tint, ink: inkNow },
        );
        estimates.push({ id: `${target.id}-est`, lat: drawn.estimate.lat, lng: drawn.estimate.lng });

        chevronsAlong(drawn.path).forEach((mark, i) => {
          chevrons.push({
            id: `${target.id}-ch-${i}`,
            lat: mark.point.lat,
            lng: mark.point.lng,
            color: tint,
            deg: mark.deg,
          });
        });

        for (const seq of drawn.flaggedStopSeqs) {
          const stop = anchors[seq] ?? anchors.find((s) => s.seq === seq);
          if (!stop) continue;
          flags.push({ id: `flag-${target.id}-${seq}`, lat: stop.lat, lng: stop.lng });
        }
      }

      for (const id of [...eases.keys()]) {
        if (!live.has(id)) eases.delete(id);
      }

      setIaRouteSimMarkers(map, { vehicles, chevrons, flags, estimates });
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      setIaRouteSimMarkers(map, null);
    };
  }, [map]);

  return null;
}

/** Static sim regions (no cores) — buses, chevrons, estimates, flags on MapLibre. */
function GlSimRegions({
  regions,
  stops,
  mode,
  color,
  ink,
}: {
  regions: BusSimRegion[];
  stops: RouteStop[];
  mode: Mode;
  color: string;
  ink: string;
}) {
  const map = useMap();
  const tint = paint(color);

  useIaGlBridge(map, ensureIaRouteSimMarkersForMap, clearIaRouteSimMarkers);

  useEffect(() => {
    if (!regions.length) {
      setIaRouteSimMarkers(map, null);
      return;
    }
    const vehicles: IaRouteVehicleMark[] = [];
    const chevrons: IaRouteChevronMark[] = [];
    const estimates: IaRouteEstimateMark[] = [];
    const flags: IaRouteFlagMark[] = [];
    const flagged = new Set<number>();

    for (const region of regions) {
      vehicles.push(
        { id: `${region.id}-before`, lat: region.before.lat, lng: region.before.lng, mode, color: tint, ink },
        { id: `${region.id}-ahead`, lat: region.ahead.lat, lng: region.ahead.lng, mode, color: tint, ink },
      );
      estimates.push({ id: `${region.id}-est`, lat: region.estimate.lat, lng: region.estimate.lng });
      chevronsAlong(region.path).forEach((mark, i) => {
        chevrons.push({
          id: `${region.id}-ch-${i}`,
          lat: mark.point.lat,
          lng: mark.point.lng,
          color: tint,
          deg: mark.deg,
        });
      });
      for (const seq of region.flaggedStopSeqs) flagged.add(seq);
    }
    for (const seq of flagged) {
      const stop = stops.find((s) => s.seq === seq) ?? stops[seq];
      if (!stop) continue;
      flags.push({ id: `flag-${seq}`, lat: stop.lat, lng: stop.lng });
    }
    setIaRouteSimMarkers(map, { vehicles, chevrons, flags, estimates });
  }, [map, regions, stops, mode, tint, ink]);

  return null;
}

function VehicleMarker({
  id,
  vehicle,
  track,
  mode,
  color,
  ink,
}: {
  id: string;
  vehicle: VehicleDot | null;
  track: LatLng[];
  mode: Mode;
  color: string;
  ink: string;
}) {
  const map = useMap();
  const vehicleRef = useRef<VehicleDot | null>(vehicle);
  const trackRef = useRef(track);
  const modeRef = useRef(mode);
  const colorRef = useRef(color);
  const inkRef = useRef(ink);
  if (vehicle) vehicleRef.current = vehicle;
  trackRef.current = track;
  modeRef.current = mode;
  colorRef.current = color;
  inkRef.current = ink;

  useEffect(() => {
    const motion = createVehicleMotion();
    let raf = 0;
    const loop = (now: number) => {
      const sample = vehicleRef.current;
      if (sample) {
        const path = sample.track && sample.track.length > 1 ? sample.track : trackRef.current;
        const pos = motion.frame(now, sample, path);
        const dim = motion.waiting();
        upsertIaLiveVehicle(map, id, {
          id,
          lat: pos.lat,
          lng: pos.lng,
          mode: modeRef.current,
          color: paint(colorRef.current),
          ink: paint(inkRef.current),
          dim,
        });
      } else {
        upsertIaLiveVehicle(map, id, null);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      upsertIaLiveVehicle(map, id, null);
    };
  }, [map, id]);

  return null;
}

/** Stop dots + focus ring on MapLibre (above route line). */
function GlRouteStops({
  stops,
  focus,
  color,
}: {
  stops: RouteStop[];
  focus: LatLng | null;
  color: string;
}) {
  const map = useMap();
  useIaGlBridge(map, ensureIaRouteStopsForMap, clearIaRouteStops);

  useEffect(() => {
    setIaRouteStops(map, {
      stops,
      focus,
      color: paint(color),
    });
  }, [map, stops, focus, color]);

  return null;
}

export { glideMap, flyVisible, fitVisibleBounds };

/** Frame the full drawn polyline in the visible band (sheet / side column). */
function FitRoute({
  points,
  routeKey,
  fitToken = 0,
  sheetFrac = 0,
  shapePending = false,
}: {
  points: LatLng[];
  routeKey?: string;
  fitToken?: number;
  sheetFrac?: number;
  /** True while a shape file / OSRM line is expected but not yet on `points`. */
  shapePending?: boolean;
}) {
  const map = useMap();
  const sheetFracRef = useRef(sheetFrac);
  sheetFracRef.current = sheetFrac;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const fitTokenRef = useRef(fitToken);
  const geoReady = points.length > 1;
  const first = points[0];
  const last = points[points.length - 1];
  const geoSig = geoReady && first && last
    ? `${points.length}:${first.lat},${first.lng}:${last.lat},${last.lng}`
    : "";
  useEffect(() => {
    if (!geoReady || !routeKey) return;
    const tokenBumped = fitToken !== fitTokenRef.current;
    fitTokenRef.current = fitToken;
    let alive = true;
    const fit = () => {
      if (!alive) return;
      // Animated zoom-out to full line (rAF lerp — never Leaflet CSS-scale fitBounds).
      fitVisibleBounds(map, pointsRef.current, sheetFracRef.current);
    };
    // Wait briefly for shape arrival on first paint; header fitToken / geoSig still re-enter.
    if (shapePending && !tokenBumped) {
      const timer = window.setTimeout(fit, SHAPE_WAIT_MS);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }
    fit();
    return () => {
      alive = false;
    };
  }, [map, routeKey, fitToken, geoSig, geoReady, shapePending]);
  return null;
}

function FlyTo({
  point,
  token,
  sheetFrac = 0,
  routeKey,
}: {
  point: LatLng | null;
  token: number;
  sheetFrac?: number;
  routeKey?: string;
}) {
  const map = useMap();
  const sheetFracRef = useRef(sheetFrac);
  sheetFracRef.current = sheetFrac;
  const pointRef = useRef(point);
  pointRef.current = point;
  const lastToken = useRef(0);
  const armedKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    // On route open / routeId change: adopt current token as baseline — first paint is FitRoute only.
    if (routeKey !== armedKey.current) {
      armedKey.current = routeKey;
      lastToken.current = token;
      return;
    }
    // Token increment only (stop tap / locate). Stale / same token must not steal FitRoute.
    if (!token || token === lastToken.current) return;
    lastToken.current = token;
    const target = pointRef.current;
    if (!target) return;
    const frac = sheetFracRef.current;
    const want = cameraForVisibleCenter(map, target.lat, target.lng, 16, frac);
    const here = map.getCenter();
    const close =
      Math.abs(here.lat - want.lat) < 0.0002 && Math.abs(here.lng - want.lng) < 0.0002 && map.getZoom() >= 16;
    if (close) return;
    // Visible-band via flyVisible (panTo / rAF lerp — never Leaflet flyTo; GL canvas stays full-bleed).
    flyVisible(map, target.lat, target.lng, 16, frac, "routeStop");
  }, [token, map, routeKey]);
  return null;
}

/** Route shape on the existing MapLibre basemap (not Leaflet SVG — avoids pan-edge clip). */
function GlRouteLine({
  points,
  color,
  water,
}: {
  points: LatLng[];
  color: string | undefined;
  water: boolean;
}) {
  const map = useMap();
  const lineColor = color ?? MODE_COLOR.bus;

  useEffect(() => {
    const apply = () => ensureIaRouteLineForMap(map);
    const unsub = registerIaGlStyleEnsure(apply);
    // Basemap may attach after RouteLayer — poll briefly until getIaMaplibreMap is live.
    let pollId: number | undefined;
    let pollTimeoutId: number | undefined;
    if (!getIaMaplibreMap(map)) {
      pollId = window.setInterval(() => {
        if (!getIaMaplibreMap(map)) return;
        if (pollId !== undefined) window.clearInterval(pollId);
        pollId = undefined;
        apply();
      }, 50);
      pollTimeoutId = window.setTimeout(() => {
        if (pollId !== undefined) window.clearInterval(pollId);
        pollId = undefined;
      }, 5000);
    } else {
      apply();
    }
    return () => {
      unsub();
      if (pollId !== undefined) window.clearInterval(pollId);
      if (pollTimeoutId !== undefined) window.clearTimeout(pollTimeoutId);
      clearIaRouteLine(map);
    };
  }, [map]);

  useEffect(() => {
    if (points.length > 1) {
      setIaRouteLine(map, { points, color: lineColor, water });
    } else {
      clearIaRouteLine(map);
    }
  }, [map, points, lineColor, water]);

  return null;
}

export function RouteLayer({
  path,
  stops,
  line,
  selected,
  vehicle,
  vehicles,
  simRegions,
  simCores,
  simStale = false,
  track,
  mode = "bus",
  color,
  ink = "#ffffff",
  follow = false,
  focusToken = 0,
  routeKey,
  fitToken = 0,
  onStop,
  sheetFrac = 0,
}: RouteOverlay & { onStop?: (seq: number) => void; sheetFrac?: number }) {
  const water = mode === "ferry";
  const lineColor = water ? MODE_COLOR.ferry : color;
  // Full shape when present — never pathUpTo on the drawn line.
  const drawn = water ? path : line && line.length > 1 ? line : path;
  const shapePending = Boolean(routeKey) && !water && !(line && line.length > 1);
  const trail = track && track.length > 1 ? track : drawn;
  const markers = vehicles ?? (vehicle ? [vehicle] : []);
  const cores = simCores ?? [];
  const regions = cores.length ? [] : (simRegions ?? []);
  const placed = useMemo(() => {
    const raw = stops ?? path.map((p, seq) => ({ lat: p.lat, lng: p.lng, seq }));
    const onLine = placeOnPath(drawn, raw);
    return raw.map((dot, i) => ({ ...dot, lat: onLine[i]?.lat ?? dot.lat, lng: onLine[i]?.lng ?? dot.lng, raw: dot }));
  }, [drawn, stops, path]);
  const focusAt = useMemo(() => {
    if (!selected) return null;
    const hit = placed.find(
      (dot) => dot.raw && Math.abs(dot.raw.lat - selected.lat) < 1e-6 && Math.abs(dot.raw.lng - selected.lng) < 1e-6,
    );
    return hit ? { lat: hit.lat, lng: hit.lng } : selected;
  }, [placed, selected]);

  // Stable stop list identity for GlRouteStops / GlSimRegions (avoid thrashing on placeOnPath).
  const stopDots = useMemo(
    () => placed.map((p) => ({ lat: p.lat, lng: p.lng, seq: p.seq })),
    [placed],
  );

  return (
    <>
      <FitRoute
        points={drawn}
        routeKey={routeKey}
        fitToken={fitToken}
        sheetFrac={sheetFrac}
        shapePending={shapePending}
      />
      <FlyTo point={focusAt} token={focusToken} sheetFrac={sheetFrac} routeKey={routeKey} />
      <GlRouteLine points={drawn} color={lineColor} water={water} />
      <GlRouteStops stops={stopDots} focus={focusAt} color={lineColor} />
      <GlLiveVehiclesBridge />
      {cores.length ? (
        <SimMotionLayer
          cores={cores}
          stale={simStale}
          track={trail}
          stops={placed}
          mode={mode}
          color={lineColor}
          ink={ink}
        />
      ) : regions.length ? (
        <GlSimRegions regions={regions} stops={stopDots} mode={mode} color={lineColor} ink={ink} />
      ) : (
        <GlSimIdle />
      )}
      {onStop
        ? placed.map((p) => (
            <CircleMarker
              key={`hit-${p.seq}`}
              center={[p.lat, p.lng]}
              radius={16}
              eventHandlers={{ click: () => onStop(p.seq) }}
              pathOptions={{ stroke: false, color: lineColor, fillColor: lineColor, fillOpacity: 0 }}
            />
          ))
        : null}
      {markers.map((item, index) => (
        <VehicleMarker
          key={item.id ?? `veh-${index}`}
          id={item.id ?? `veh-${index}`}
          vehicle={item}
          track={trail}
          mode={mode}
          color={lineColor}
          ink={ink}
        />
      ))}
    </>
  );
}

/** Dynamic pack fill minZoom — same policy as HomeMap. */
function PackFillMinZoom() {
  const map = useMap();
  useEffect(() => {
    const apply = () => applyPackFillMinZoom(map);
    apply();
    map.on("load", apply);
    map.on("resize", apply);
    const el = map.getContainer();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      map.off("load", apply);
      map.off("resize", apply);
      ro.disconnect();
    };
  }, [map]);
  return null;
}

export function RouteMap({ path, line, selected, vehicle, vehicles, simRegions, simCores, simStale, track, mode = "bus", color, ink = "#ffffff", follow = false, focusToken = 0 }: RouteOverlay) {
  const center = selected ?? path[Math.floor(path.length / 2)] ?? { lat: 22.32, lng: 114.26 };
  return (
    <div className="map-frame">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={follow ? 16 : 14}
        minZoom={11}
        maxZoom={19}
        maxBounds={MAP_MAX_BOUNDS}
        maxBoundsViscosity={1}
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={80}
        preferCanvas={false}
        zoomAnimation={true}
        markerZoomAnimation={false}
        className="map"
        scrollWheelZoom
        doubleClickZoom
        dragging
        touchZoom
        attributionControl={true}
        zoomControl
      >
        <BrightBasemap />
        <PackFillMinZoom />
        <RouteLayer
          path={path}
          line={line}
          selected={selected}
          vehicle={vehicle}
          vehicles={vehicles}
          simRegions={simRegions}
          simCores={simCores}
          simStale={simStale}
          track={track}
          mode={mode}
          color={color}
          ink={ink}
          follow={follow}
          focusToken={focusToken}
        />
      </MapContainer>
    </div>
  );
}

export default RouteMap;
