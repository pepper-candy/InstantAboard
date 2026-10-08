"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { MODE_COLOR } from "@/lib/colors";
import { placeOnPath, type LatLng } from "@/lib/geo";
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
      {placed.map((p) => (
        <CircleMarker
          key={`${p.lat}-${p.lng}-${p.seq}`}
          center={[p.lat, p.lng]}
          radius={4}
          interactive={false}
          pathOptions={{ color: lineColor, fillColor: "#fff", fillOpacity: 1, weight: 2 }}
        />
      ))}
      {focusAt ? (
        <CircleMarker
          center={[focusAt.lat, focusAt.lng]}
          radius={9}
          interactive={false}
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

export function RouteMap({ path, line, selected, vehicle, vehicles, track, mode = "bus", color, ink = "#ffffff", follow = false, focusToken = 0 }: RouteOverlay) {
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
