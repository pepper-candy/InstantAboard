"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { MODE_COLOR } from "@/lib/colors";
import type { LatLng } from "@/lib/geo";
import { MINIBUS_PATH, MINIBUS_VIEWBOX } from "./Icons";
import { createVehicleMotion } from "@/lib/vehicle";
import type { Mode, VehicleDot } from "@/lib/types";
import "leaflet/dist/leaflet.css";

const VEHICLE_GLYPH: Partial<Record<Mode, string>> = {
  bus: `<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M6 16v2M18 16v2M4 12h16M8 8h3M14 8h3"/>`,
  mtr: `<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M8 17l-2 4M16 17l2 4M8 10h8"/>`,
  ferry: `<path d="M3 14l9 4 9-4-2-4H5z"/><path d="M8 10V7h5l2 3"/>`,
  tram: `<path d="M7 6h10M8 6v3M16 6v3"/><rect x="4" y="9" width="16" height="9" rx="2"/><path d="M7 18v2M17 18v2M4 13h16"/>`,
  taxi: `<path d="M4 13l2-5h12l2 5v5H4z"/><path d="M9 8V6h6v2M6 16v2M18 16v2"/>`,
};

function paint(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

function vehicleSvg(mode: Mode) {
  if (mode === "minibus") {
    return `<svg class="is-mini" viewBox="${MINIBUS_VIEWBOX}" fill="currentColor"><path fill-rule="evenodd" d="${MINIBUS_PATH}"/></svg>`;
  }
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

type RouteProps = {
  path: LatLng[];
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
    let marker: L.Marker | null = null;
    let raf = 0;
    const loop = (now: number) => {
      const sample = vehicleRef.current;
      if (sample) {
        const pos = motion.frame(now, sample, trackRef.current);
        if (!marker) {
          marker = L.marker([pos.lat, pos.lng], {
            icon: iconRef.current,
            interactive: false,
            keyboard: false,
            zIndexOffset: 500,
          }).addTo(map);
          markerRef.current = marker;
        } else {
          marker.setLatLng([pos.lat, pos.lng]);
        }
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

function FlyTo({ point, token, follow }: { point: LatLng | null; token: number; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!point || (!follow && !token)) return;
    const here = map.getCenter();
    const close =
      Math.abs(here.lat - point.lat) < 0.0002 && Math.abs(here.lng - point.lng) < 0.0002 && map.getZoom() >= 16;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || (token === 0 && close)) {
      if (!close) map.setView([point.lat, point.lng], 16, { animate: false });
      return;
    }
    map.flyTo([point.lat, point.lng], 16, { duration: 0.55 });
  }, [token, point, follow, map]);
  return null;
}

export function RouteMap({ path, line, selected, vehicle, vehicles, track, mode = "bus", color, ink = "#ffffff", follow = false, focusToken = 0 }: RouteProps) {
  const center = selected ?? path[Math.floor(path.length / 2)] ?? { lat: 22.32, lng: 114.26 };
  const water = mode === "ferry";
  const lineColor = water ? MODE_COLOR.ferry : color;
  const drawn = water ? path : line && line.length > 1 ? line : path;
  const trail = track && track.length > 1 ? track : drawn;
  const markers = vehicles ?? (vehicle ? [vehicle] : []);
  return (
    <div className="map-frame">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={follow ? 16 : 14}
        className="map"
        scrollWheelZoom
        doubleClickZoom
        dragging
        touchZoom
        attributionControl={false}
        zoomControl
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FlyTo point={selected ?? null} token={focusToken} follow={follow} />
        {drawn.length > 1 ? (
          <Polyline
            positions={drawn.map((p) => [p.lat, p.lng] as [number, number])}
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
        {path.map((p, i) => (
          <CircleMarker key={`${p.lat}-${p.lng}-${i}`} center={[p.lat, p.lng]} radius={4} pathOptions={{ color: lineColor, fillColor: "#fff", fillOpacity: 1, weight: 2 }} />
        ))}
        {selected ? (
          <CircleMarker center={[selected.lat, selected.lng]} radius={9} pathOptions={{ color: lineColor, fillColor: lineColor, fillOpacity: 1, weight: 2 }} />
        ) : null}
        {markers.map((item, index) => (
          <VehicleMarker key={item.id ?? `veh-${index}`} vehicle={item} track={trail} mode={mode} color={lineColor} ink={ink} />
        ))}
      </MapContainer>
    </div>
  );
}

export default RouteMap;
