"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { MODE_COLOR } from "@/lib/colors";
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

const SIM_FILL = "#f7f7f4";
const SIM_BORDER_W = 15;
const SIM_FILL_W = 10;

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
  simRegions?: BusSimRegion[] | null;
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

function ExactMarker({
  position,
  icon,
  zIndexOffset,
}: {
  position: LatLng;
  icon: L.DivIcon;
  zIndexOffset: number;
}) {
  const map = useMap();
  const markerRef = useRef<PlacedMarker | null>(null);
  const iconRef = useRef(icon);
  iconRef.current = icon;

  useEffect(() => {
    const marker = L.marker([position.lat, position.lng], {
      icon: iconRef.current,
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
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
    // position is applied below so the icon is not remounted every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zIndexOffset]);

  useEffect(() => {
    markerRef.current?.setIcon(icon);
  }, [icon]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    marker.setLatLng([position.lat, position.lng]);
    pinExact(map, marker);
  }, [map, position.lat, position.lng]);

  return null;
}

function chevronIcon(color: string, deg: number) {
  return L.divIcon({
    className: "stop-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<span class="sim-chevron" style="color:${paint(color)};transform:rotate(${deg - 90}deg)"></span>`,
  });
}

function corridorOptions(color: string, fill: boolean): L.PathOptions {
  return {
    color: fill ? SIM_FILL : paint(color),
    weight: fill ? SIM_FILL_W : SIM_BORDER_W,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
    pane: "sim-band",
    className: fill ? "sim-corridor-fill" : "sim-corridor-edge",
  };
}

function ensureSimPanes(map: L.Map) {
  if (!map.getPane("sim-band")) {
    const pane = map.createPane("sim-band");
    pane.style.zIndex = "425";
  }
  if (!map.getPane("sim-dots")) {
    const pane = map.createPane("sim-dots");
    pane.style.zIndex = "435";
  }
}

function SimPanes() {
  ensureSimPanes(useMap());
  return null;
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

function SimBandLayer({ regions, color }: { regions: BusSimRegion[]; color: string }) {
  const marks = useMemo(
    () =>
      regions.flatMap((region) =>
        chevronsAlong(region.path).map((mark, i) => ({
          key: `${region.id}-ch-${i}`,
          ...mark,
        })),
      ),
    [regions],
  );
  return (
    <>
      {regions.map((region) => (
        <Polyline
          key={`${region.id}-edge`}
          positions={region.path.map((p) => [p.lat, p.lng] as [number, number])}
          smoothFactor={0}
          pathOptions={corridorOptions(color, false)}
        />
      ))}
      {regions.map((region) => (
        <Polyline
          key={`${region.id}-fill`}
          positions={region.path.map((p) => [p.lat, p.lng] as [number, number])}
          smoothFactor={0}
          pathOptions={corridorOptions(color, true)}
        />
      ))}
      {marks.map((mark) => (
        <ExactMarker key={mark.key} position={mark.point} icon={chevronIcon(color, mark.deg)} zIndexOffset={420} />
      ))}
    </>
  );
}

function placeMarker(map: L.Map, point: LatLng, icon: L.DivIcon, z: number): PlacedMarker {
  const marker = L.marker([point.lat, point.lng], {
    icon,
    interactive: false,
    keyboard: false,
    zIndexOffset: z,
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

function moveMarker(map: L.Map, marker: PlacedMarker, point: LatLng) {
  marker.setLatLng([point.lat, point.lng]);
  pinExact(map, marker);
}

type SimPaint = {
  border: L.Polyline;
  fill: L.Polyline;
  before: PlacedMarker;
  ahead: PlacedMarker;
  estimate: PlacedMarker;
  chevrons: PlacedMarker[];
  chevronDeg: number[];
  flags: Map<number, PlacedMarker>;
  beforeM: number;
  aheadM: number;
  estimateM: number;
  tint: string;
};

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
  const busRef = useRef(vehicleIcon(mode, color, ink));
  coresRef.current = cores;
  staleRef.current = stale;
  trackRef.current = track;
  stopsRef.current = stops;
  colorRef.current = color;
  busRef.current = vehicleIcon(mode, color, ink);

  useEffect(() => {
    busRef.current = vehicleIcon(mode, color, ink);
  }, [mode, color, ink]);

  useEffect(() => {
    ensureSimPanes(map);
    const paints = new Map<string, SimPaint>();
    const snap = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cumTrack: LatLng[] | null = null;
    let cum: number[] = [];
    let lastT = 0;
    let raf = 0;

    const latlngs = (path: LatLng[]) => path.map((p) => [p.lat, p.lng] as [number, number]);

    const ensureCum = () => {
      const line = trackRef.current;
      if (line === cumTrack) return;
      cumTrack = line;
      cum = cumulativeDistances(line);
    };

    const drop = (row: SimPaint) => {
      row.border.remove();
      row.fill.remove();
      row.before.remove();
      row.ahead.remove();
      row.estimate.remove();
      for (const mark of row.chevrons) mark.remove();
      for (const flag of row.flags.values()) flag.remove();
    };

    const loop = (t: number) => {
      const dt = lastT ? Math.min(0.05, Math.max(0, (t - lastT) / 1000)) : 0;
      lastT = t;
      const line = trackRef.current;
      const anchors = stopsRef.current;
      const frozen = coresRef.current;
      if (line.length < 2 || !frozen.length) {
        for (const row of paints.values()) drop(row);
        paints.clear();
        raf = requestAnimationFrame(loop);
        return;
      }
      ensureCum();
      const targets = projectSimRegions(line, anchors, frozen, Date.now(), staleRef.current);
      const live = new Set<string>();
      const tint = paint(colorRef.current);
      const bus = busRef.current;
      const stopPts = anchors.map((s) => ({ lat: s.lat, lng: s.lng }));

      for (const target of targets) {
        live.add(target.id);
        let row = paints.get(target.id);
        const beforeM = row && !snap ? easeToward(row.beforeM, target.beforeM, dt) : target.beforeM;
        const aheadM = row && !snap ? easeToward(row.aheadM, target.aheadM, dt) : target.aheadM;
        const estimateM = row && !snap ? easeToward(row.estimateM, target.estimateM, dt) : target.estimateM;
        const drawn = placeSimSpan(line, cum, stopPts, target.id, beforeM, aheadM, estimateM);
        if (!drawn) continue;
        const pts = latlngs(drawn.path);
        let recolor = false;
        if (!row) {
          row = {
            border: L.polyline(pts, { ...corridorOptions(tint, false), interactive: false, smoothFactor: 0 }).addTo(map),
            fill: L.polyline(pts, { ...corridorOptions(tint, true), interactive: false, smoothFactor: 0 }).addTo(map),
            before: placeMarker(map, drawn.before, bus, 520),
            ahead: placeMarker(map, drawn.ahead, bus, 520),
            estimate: placeMarker(map, drawn.estimate, ESTIMATE_ICON, 640),
            chevrons: [],
            chevronDeg: [],
            flags: new Map(),
            beforeM,
            aheadM,
            estimateM,
            tint,
          };
          paints.set(target.id, row);
        } else {
          row.border.setLatLngs(pts);
          row.fill.setLatLngs(pts);
          recolor = row.tint !== tint;
          if (recolor) {
            row.border.setStyle(corridorOptions(tint, false));
            row.fill.setStyle(corridorOptions(tint, true));
            row.tint = tint;
          }
          if (row.before.options.icon !== bus) {
            row.before.setIcon(bus);
            row.ahead.setIcon(bus);
          }
          moveMarker(map, row.before, drawn.before);
          moveMarker(map, row.ahead, drawn.ahead);
          moveMarker(map, row.estimate, drawn.estimate);
          row.beforeM = beforeM;
          row.aheadM = aheadM;
          row.estimateM = estimateM;
        }

        const marks = chevronsAlong(drawn.path);
        while (row.chevrons.length > marks.length) {
          row.chevrons.pop()?.remove();
          row.chevronDeg.pop();
        }
        marks.forEach((mark, i) => {
          const deg = Math.round(mark.deg);
          const existing = row.chevrons[i];
          if (!existing) {
            row.chevrons[i] = placeMarker(map, mark.point, chevronIcon(tint, mark.deg), 420);
            row.chevronDeg[i] = deg;
            return;
          }
          if (row.chevronDeg[i] !== deg || recolor) {
            existing.setIcon(chevronIcon(tint, mark.deg));
            row.chevronDeg[i] = deg;
          }
          moveMarker(map, existing, mark.point);
        });

        const flagged = new Set(drawn.flaggedStopSeqs);
        for (const [seq, flag] of row.flags) {
          if (flagged.has(seq)) continue;
          flag.remove();
          row.flags.delete(seq);
        }
        for (const seq of flagged) {
          const stop = anchors[seq] ?? anchors.find((s) => s.seq === seq);
          if (!stop) continue;
          const at = { lat: stop.lat, lng: stop.lng };
          const existing = row.flags.get(seq);
          if (!existing) {
            row.flags.set(seq, placeMarker(map, at, FLAG_ICON, 560));
            continue;
          }
          moveMarker(map, existing, at);
        }
      }

      for (const [id, row] of paints) {
        if (live.has(id)) continue;
        drop(row);
        paints.delete(id);
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      for (const row of paints.values()) drop(row);
      paints.clear();
    };
  }, [map]);

  return null;
}

function SimGlyphLayer({ regions, mode, color, ink }: { regions: BusSimRegion[]; mode: Mode; color: string; ink: string }) {
  const bus = useMemo(() => vehicleIcon(mode, color, ink), [mode, color, ink]);
  return (
    <>
      {regions.map((region) => (
        <ExactMarker key={`${region.id}-before`} position={region.before} icon={bus} zIndexOffset={520} />
      ))}
      {regions.map((region) => (
        <ExactMarker key={`${region.id}-ahead`} position={region.ahead} icon={bus} zIndexOffset={520} />
      ))}
      {regions.map((region) => (
        <ExactMarker key={`${region.id}-est`} position={region.estimate} icon={ESTIMATE_ICON} zIndexOffset={640} />
      ))}
    </>
  );
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
  simRegions,
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
  const regions = cores.length ? [] : (simRegions ?? []);
  const flagged = useMemo(() => {
    const set = new Set<number>();
    for (const region of regions) for (const seq of region.flaggedStopSeqs) set.add(seq);
    return set;
  }, [regions]);
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
  const simOn = cores.length > 0 || regions.length > 0;
  const dotPane = simOn ? "sim-dots" : undefined;
  return (
    <>
      <SimPanes />
      <FlyTo point={focusAt} token={focusToken} follow={follow} />
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
      ) : null}
      {regions.length ? <SimBandLayer regions={regions} color={lineColor} /> : null}
      {placed.map((p) => (
        <CircleMarker
          key={`${p.lat}-${p.lng}-${p.seq}`}
          center={[p.lat, p.lng]}
          radius={4}
          interactive={false}
          pane={dotPane}
          pathOptions={{ color: lineColor, fillColor: "#fff", fillOpacity: 1, weight: 2 }}
        />
      ))}
      {placed.map((p) =>
        flagged.has(p.seq) ? (
          <ExactMarker key={`flag-${p.seq}`} position={{ lat: p.lat, lng: p.lng }} icon={FLAG_ICON} zIndexOffset={560} />
        ) : null,
      )}
      {regions.length ? <SimGlyphLayer regions={regions} mode={mode} color={lineColor} ink={ink} /> : null}
      {focusAt ? (
        <CircleMarker
          center={[focusAt.lat, focusAt.lng]}
          radius={9}
          interactive={false}
          pane={dotPane}
          pathOptions={{ color: lineColor, fillColor: lineColor, fillOpacity: 1, weight: 2 }}
        />
      ) : null}
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
        <VehicleMarker key={item.id ?? `veh-${index}`} vehicle={item} track={trail} mode={mode} color={lineColor} ink={ink} />
      ))}
    </>
  );
}

export function RouteMap({ path, line, selected, vehicle, vehicles, simRegions, simCores, simStale, track, mode = "bus", color, ink = "#ffffff", follow = false, focusToken = 0 }: RouteOverlay) {
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
