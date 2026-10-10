"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { MODE_COLOR } from "@/lib/colors";
import { cumulativeDistances, placeOnPath, pointAtDistance, type LatLng } from "@/lib/geo";
import { chevronsAlong, projectSimRegions, slicePath, type SimCore } from "@/lib/simRegion";
import { createVehicleMotion } from "@/lib/vehicle";
import type { Mode, VehicleDot } from "@/lib/types";
import "leaflet/dist/leaflet.css";

const VEHICLE_GLYPH: Partial<Record<Mode, string>> = {
  mtr: `<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M8 17l-2 4M16 17l2 4M8 10h8"/>`,
  tram: `<path d="M7 6h10M8 6v3M16 6v3"/><rect x="4" y="9" width="16" height="9" rx="2"/><path d="M7 18v2M17 18v2M4 13h16"/>`,
  taxi: `<path d="M4 13l2-5h12l2 5v5H4z"/><path d="M9 8V6h6v2M6 16v2M18 16v2"/>`,
};

function paint(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

function vehicleSvg(mode: Mode) {
  if (mode === "bus") return `<span class="bus-mark"></span>`;
  if (mode === "minibus") return `<span class="minibus-mark"></span>`;
  if (mode === "ferry") return `<span class="ferry-mark"></span>`;
  const glyph = VEHICLE_GLYPH[mode] ?? VEHICLE_GLYPH.bus;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
}

function vehicleIcon(mode: Mode, color: string, ink: string) {
  return L.divIcon({
    className: "stop-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<span class="veh-pin" style="background:${paint(color)};color:${paint(ink)}">${vehicleSvg(mode)}</span>`,
  });
}

export type RouteStop = { lat: number; lng: number; seq: number };

export type RouteOverlay = {
  path: LatLng[];
  stops?: RouteStop[];
  line?: LatLng[] | null;
  selected?: LatLng | null;
  vehicle?: VehicleDot | null;
  vehicles?: VehicleDot[] | null;
  simCores?: SimCore[] | null;
  simStale?: boolean;
  track?: LatLng[] | null;
  mode?: Mode;
  color: string;
  ink?: string;
  follow?: boolean;
  focusToken?: number;
};

/** Leaflet repositions the icon inside `update`. The published marker types omit that method. */
type PlacedMarker = L.Marker & { update: () => L.Marker };

function pinExact(map: L.Map, marker: L.Marker) {
  const icon = marker.getElement();
  if (!icon) return;
  const projected = map.project(marker.getLatLng());
  const origin = map.getPixelOrigin();
  L.DomUtil.setPosition(icon, L.point(projected.x - origin.x, projected.y - origin.y));
}

function chevronIcon(color: string, deg: number) {
  return L.divIcon({
    className: "stop-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<span class="sim-chevron" style="color:${paint(color)};transform:rotate(${deg - 90}deg)"></span>`,
  });
}

function estimateIcon() {
  return L.divIcon({
    className: "stop-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<span class="sim-estimate"></span>`,
  });
}

function flagIcon() {
  return L.divIcon({
    className: "stop-icon",
    iconSize: [18, 18],
    iconAnchor: [4, 16],
    html: `<span class="sim-stop-flag" aria-hidden="true">🚩</span>`,
  });
}

const ESTIMATE_ICON = estimateIcon();
const FLAG_ICON = flagIcon();
const SIM_FILL = "#ffffff";
const EASE_S = 0.18;

function ensurePane(map: L.Map, name: string, zIndex: string) {
  const existing = map.getPane(name);
  if (existing) return existing;
  const pane = map.createPane(name);
  pane.style.zIndex = zIndex;
  return pane;
}

function lineOptions(color: string, weight: number, pane: string) {
  return {
    color,
    weight,
    opacity: 1,
    lineCap: "round" as const,
    lineJoin: "round" as const,
    interactive: false,
    smoothFactor: 0,
    pane,
  };
}

function pinMarker(map: L.Map, point: LatLng, icon: L.DivIcon, zIndexOffset: number) {
  const marker = L.marker([point.lat, point.lng], {
    icon,
    interactive: false,
    keyboard: false,
    zIndexOffset,
  }).addTo(map) as PlacedMarker;
  const stock = marker.update.bind(marker);
  marker.update = () => {
    const drawn = stock();
    pinExact(map, marker);
    return drawn;
  };
  pinExact(map, marker);
  return marker;
}

function movePin(map: L.Map, marker: L.Marker, point: LatLng) {
  marker.setLatLng([point.lat, point.lng]);
  pinExact(map, marker);
}

function easeToward(from: number, to: number, dt: number, reduce: boolean) {
  if (reduce) return to;
  const k = 1 - Math.exp(-dt / EASE_S);
  return from + (to - from) * k;
}

type ChevronPin = { marker: PlacedMarker; deg: number };

type SimDraw = {
  border: L.Polyline;
  fill: L.Polyline;
  chevrons: ChevronPin[];
  before: PlacedMarker;
  ahead: PlacedMarker;
  estimate: PlacedMarker;
  shown: { before: number; ahead: number; estimate: number } | null;
};

function SimMotionLayer({
  cores,
  stale,
  track,
  stops,
  placed,
  mode,
  color,
  ink,
}: {
  cores: SimCore[];
  stale: boolean;
  track: LatLng[];
  stops: LatLng[];
  placed: Array<{ lat: number; lng: number; seq: number }>;
  mode: Mode;
  color: string;
  ink: string;
}) {
  const map = useMap();
  const coresRef = useRef(cores);
  const staleRef = useRef(stale);
  const trackRef = useRef(track);
  const stopsRef = useRef(stops);
  const placedRef = useRef(placed);
  coresRef.current = cores;
  staleRef.current = stale;
  trackRef.current = track;
  stopsRef.current = stops;
  placedRef.current = placed;

  useEffect(() => {
    ensurePane(map, "simCorridor", "405");
    const lane = paint(color);
    const bus = vehicleIcon(mode, color, ink);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draws = new Map<string, SimDraw>();
    const flags = new Map<number, PlacedMarker>();

    const drop = (draw: SimDraw) => {
      draw.border.remove();
      draw.fill.remove();
      draw.before.remove();
      draw.ahead.remove();
      draw.estimate.remove();
      for (const chevron of draw.chevrons) chevron.marker.remove();
    };

    let raf = 0;
    let last = 0;
    const loop = (stamp: number) => {
      const dt = last ? Math.min(0.05, (stamp - last) / 1000) : 0.016;
      last = stamp;
      const shape = trackRef.current;
      const anchors = stopsRef.current;
      const live = coresRef.current;
      if (shape.length < 2 || !live.length) {
        for (const draw of draws.values()) drop(draw);
        draws.clear();
        for (const flag of flags.values()) flag.setOpacity(0);
        raf = requestAnimationFrame(loop);
        return;
      }
      const cum = cumulativeDistances(shape);
      const targets = projectSimRegions(shape, anchors, live, Date.now(), staleRef.current);
      const seen = new Set<string>();
      const flagged = new Set<number>();
      for (const region of targets) {
        seen.add(region.id);
        let draw = draws.get(region.id);
        if (!draw) {
          const origin: [number, number] = [region.before.lat, region.before.lng];
          draw = {
            border: L.polyline([origin], lineOptions(lane, 20, "simCorridor")).addTo(map),
            fill: L.polyline([origin], lineOptions(SIM_FILL, 14, "simCorridor")).addTo(map),
            chevrons: [],
            before: pinMarker(map, region.before, bus, 520),
            ahead: pinMarker(map, region.ahead, bus, 520),
            estimate: pinMarker(map, region.estimate, ESTIMATE_ICON, 640),
            shown: null,
          };
          draws.set(region.id, draw);
        }
        const shown = draw.shown ?? {
          before: region.beforeDist,
          ahead: region.aheadDist,
          estimate: region.estimateDist,
        };
        const next = {
          before: easeToward(shown.before, region.beforeDist, dt, reduce),
          ahead: easeToward(shown.ahead, region.aheadDist, dt, reduce),
          estimate: easeToward(shown.estimate, region.estimateDist, dt, reduce),
        };
        next.estimate = Math.max(next.before, Math.min(next.ahead, next.estimate));
        draw.shown = next;
        const path = slicePath(shape, cum, next.before, next.ahead);
        const before = pointAtDistance(shape, cum, next.before);
        const ahead = pointAtDistance(shape, cum, next.ahead);
        const estimate = pointAtDistance(shape, cum, next.estimate);
        if (!before || !ahead || !estimate || path.length < 2) continue;
        const latlngs = path.map((p) => [p.lat, p.lng] as [number, number]);
        draw.border.setLatLngs(latlngs);
        draw.fill.setLatLngs(latlngs);
        movePin(map, draw.before, before);
        movePin(map, draw.ahead, ahead);
        movePin(map, draw.estimate, estimate);
        const marks = chevronsAlong(path);
        while (draw.chevrons.length < marks.length) {
          const mark = marks[draw.chevrons.length];
          if (!mark) break;
          draw.chevrons.push({
            marker: pinMarker(map, mark.point, chevronIcon(lane, mark.deg), 480),
            deg: mark.deg,
          });
        }
        for (let i = 0; i < draw.chevrons.length; i++) {
          const pin = draw.chevrons[i];
          const mark = marks[i];
          if (!pin) continue;
          if (!mark) {
            pin.marker.setOpacity(0);
            continue;
          }
          pin.marker.setOpacity(1);
          movePin(map, pin.marker, mark.point);
          if (Math.abs(mark.deg - pin.deg) > 6) {
            pin.marker.setIcon(chevronIcon(lane, mark.deg));
            pin.deg = mark.deg;
          }
        }
        for (const seq of region.flaggedStopSeqs) flagged.add(seq);
      }
      for (const [id, draw] of draws) {
        if (seen.has(id)) continue;
        drop(draw);
        draws.delete(id);
      }
      const placedSeq = new Set<number>();
      for (const stop of placedRef.current) {
        placedSeq.add(stop.seq);
        let flag = flags.get(stop.seq);
        if (!flag) {
          flag = pinMarker(map, { lat: stop.lat, lng: stop.lng }, FLAG_ICON, 560);
          flags.set(stop.seq, flag);
        }
        flag.setOpacity(flagged.has(stop.seq) ? 1 : 0);
      }
      for (const [seq, flag] of flags) {
        if (placedSeq.has(seq)) continue;
        flag.remove();
        flags.delete(seq);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const draw of draws.values()) drop(draw);
      draws.clear();
      for (const flag of flags.values()) flag.remove();
      flags.clear();
    };
  }, [map, color, mode, ink]);

  return null;
}

function VehicleMarker({
  vehicle,
  track,
  mode,
  color,
  ink,
}: {
  vehicle: VehicleDot | null;
  track: LatLng[];
  mode: Mode;
  color: string;
  ink: string;
}) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const vehicleRef = useRef<VehicleDot | null>(vehicle);
  const trackRef = useRef(track);
  const iconRef = useRef(vehicleIcon(mode, color, ink));
  if (vehicle) vehicleRef.current = vehicle;
  trackRef.current = track;

  useEffect(() => {
    const icon = vehicleIcon(mode, color, ink);
    iconRef.current = icon;
    markerRef.current?.setIcon(icon);
  }, [mode, color, ink]);

  useEffect(() => {
    const motion = createVehicleMotion();
    let marker: PlacedMarker | null = null;
    let raf = 0;
    const loop = (now: number) => {
      const sample = vehicleRef.current;
      if (sample) {
        const path = sample.track && sample.track.length > 1 ? sample.track : trackRef.current;
        const pos = motion.frame(now, sample, path);
        if (!marker) {
          marker = L.marker([pos.lat, pos.lng], {
            icon: iconRef.current,
            interactive: false,
            keyboard: false,
            zIndexOffset: 500,
          }).addTo(map) as PlacedMarker;
          const stock = marker.update.bind(marker);
          marker.update = () => {
            const drawn = stock();
            pinExact(map, marker!);
            return drawn;
          };
          markerRef.current = marker;
          pinExact(map, marker);
        } else {
          marker.setLatLng([pos.lat, pos.lng]);
          pinExact(map, marker);
        }
        const dim = motion.waiting();
        marker.getElement()?.querySelector(".veh-pin")?.classList.toggle("is-dim", dim);
        marker.setOpacity(dim ? 0.9 : 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      marker?.remove();
      markerRef.current = null;
    };
  }, [map]);

  return null;
}

export function glideMap(map: L.Map, lat: number, lng: number, zoom: number) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // flyTo zooms out and back in. That scale animation drifts the route line off the roads.
  if (reduce || map.getZoom() !== zoom) {
    map.setView([lat, lng], zoom, { animate: false });
    return;
  }
  map.panTo([lat, lng], { animate: true, duration: 0.45 });
}

function SimPanes() {
  const map = useMap();
  ensurePane(map, "simCorridor", "405");
  ensurePane(map, "routeStops", "430");
  return null;
}

function FlyTo({ point, token, follow }: { point: LatLng | null; token: number; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!point || (!follow && !token)) return;
    const here = map.getCenter();
    const close =
      Math.abs(here.lat - point.lat) < 0.0002 && Math.abs(here.lng - point.lng) < 0.0002 && map.getZoom() >= 16;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Pan if already at the stop zoom. Changing zoom uses setView, not flyTo —
    // flyTo's scale animation drifts the route line off the roads.
    if (token > 0 && !reduce && !close) {
      glideMap(map, point.lat, point.lng, 16);
      return;
    }
    if (reduce || (token === 0 && close)) {
      if (!close) map.setView([point.lat, point.lng], 16, { animate: false });
      return;
    }
    glideMap(map, point.lat, point.lng, 16);
  }, [token, point, follow, map]);
  return null;
}

export function RouteLayer({
  path,
  stops,
  line,
  selected,
  vehicle,
  vehicles,
  simCores,
  simStale = false,
  track,
  mode = "bus",
  color,
  ink = "#ffffff",
  follow = false,
  focusToken = 0,
  onStop,
}: RouteOverlay & { onStop?: (seq: number) => void }) {
  const water = mode === "ferry";
  const lineColor = water ? MODE_COLOR.ferry : color;
  const drawn = water ? path : line && line.length > 1 ? line : path;
  const trail = track && track.length > 1 ? track : drawn;
  const markers = vehicles ?? (vehicle ? [vehicle] : []);
  const cores = simCores ?? [];
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
  return (
    <>
      <FlyTo point={focusAt} token={focusToken} follow={follow} />
      <SimPanes />
      {drawn.length > 1 ? (
        <Polyline
          positions={drawn.map((p) => [p.lat, p.lng] as [number, number])}
          smoothFactor={0}
          pathOptions={{
            color: lineColor,
            weight: water ? 4 : 5,
            opacity: 0.9,
            dashArray: water ? "10 8" : undefined,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      ) : null}
      {simCores != null ? (
        <SimMotionLayer
          cores={cores}
          stale={simStale}
          track={trail}
          stops={(stops ?? path).map((p) => ({ lat: p.lat, lng: p.lng }))}
          placed={placed}
          mode={mode}
          color={lineColor}
          ink={ink}
        />
      ) : null}
      {placed.map((p) => (
        <CircleMarker
          key={`${p.lat}-${p.lng}-${p.seq}`}
          center={[p.lat, p.lng]}
          radius={4}
          interactive={false}
          pathOptions={{ color: lineColor, fillColor: "#fff", fillOpacity: 1, weight: 2, pane: "routeStops" }}
        />
      ))}
      {focusAt ? (
        <CircleMarker
          center={[focusAt.lat, focusAt.lng]}
          radius={9}
          interactive={false}
          pathOptions={{ color: lineColor, fillColor: lineColor, fillOpacity: 1, weight: 2, pane: "routeStops" }}
        />
      ) : null}
      {onStop
        ? placed.map((p) => (
            <CircleMarker
              key={`hit-${p.seq}`}
              center={[p.lat, p.lng]}
              radius={16}
              eventHandlers={{ click: () => onStop(p.seq) }}
              pathOptions={{ stroke: false, color: lineColor, fillColor: lineColor, fillOpacity: 0, pane: "routeStops" }}
            />
          ))
        : null}
      {markers.map((item, index) => (
        <VehicleMarker key={item.id ?? `veh-${index}`} vehicle={item} track={trail} mode={mode} color={lineColor} ink={ink} />
      ))}
    </>
  );
}

export function RouteMap({ path, line, selected, vehicle, vehicles, simCores, simStale, track, mode = "bus", color, ink = "#ffffff", follow = false, focusToken = 0 }: RouteOverlay) {
  const center = selected ?? path[Math.floor(path.length / 2)] ?? { lat: 22.32, lng: 114.26 };
  return (
    <div className="map-frame">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={follow ? 16 : 14}
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={80}
        preferCanvas={false}
        zoomAnimation={false}
        markerZoomAnimation={false}
        className="map"
        scrollWheelZoom
        doubleClickZoom
        dragging
        touchZoom
        attributionControl={false}
        zoomControl
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <RouteLayer
          path={path}
          line={line}
          selected={selected}
          vehicle={vehicle}
          vehicles={vehicles}
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
