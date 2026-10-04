"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import type { LatLng } from "@/lib/geo";
import { createVehicleMotion } from "@/lib/vehicle";
import type { Mode, TaxiStand, VehicleDot } from "@/lib/types";
import "leaflet/dist/leaflet.css";

const VEHICLE_GLYPH: Record<Mode, string> = {
  bus: `<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M6 16v2M18 16v2M4 12h16M8 8h3M14 8h3"/>`,
  minibus: `<path d="M5 16V8a3 3 0 0 1 3-3h10l3 5v6"/><path d="M5 12h16M7 16v2M17 16v2"/>`,
  mtr: `<rect x="5" y="3" width="14" height="14" rx="4"/><path d="M8 17l-2 4M16 17l2 4M8 10h8"/>`,
  ferry: `<path d="M3 14l9 4 9-4-2-4H5z"/><path d="M8 10V7h5l2 3"/>`,
  tram: `<path d="M7 6h10M8 6v3M16 6v3"/><rect x="4" y="9" width="16" height="9" rx="2"/><path d="M7 18v2M17 18v2M4 13h16"/>`,
  taxi: `<path d="M4 13l2-5h12l2 5v5H4z"/><path d="M9 8V6h6v2M6 16v2M18 16v2"/>`,
};

function paint(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

function vehicleIcon(mode: Mode, color: string, ink: string) {
  const glyph = VEHICLE_GLYPH[mode] ?? VEHICLE_GLYPH.bus;
  return L.divIcon({
    className: "stop-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<span class="veh-pin" style="background:${paint(color)};color:${paint(ink)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg></span>`,
  });
}

type RouteProps = {
  path: LatLng[];
  line?: LatLng[] | null;
  selected?: LatLng | null;
  vehicle?: VehicleDot | null;
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

export function RouteMap({ path, line, selected, vehicle, track, mode = "bus", color, ink = "#ffffff", follow = false, focusToken = 0 }: RouteProps) {
  const center = selected ?? path[Math.floor(path.length / 2)] ?? { lat: 22.32, lng: 114.26 };
  const drawn = line && line.length > 1 ? line : path;
  const trail = track && track.length > 1 ? track : drawn;
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
        {drawn.length > 1 ? <Polyline positions={drawn.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color, weight: 5, opacity: 0.85 }} /> : null}
        {path.map((p, i) => (
          <CircleMarker key={`${p.lat}-${p.lng}-${i}`} center={[p.lat, p.lng]} radius={4} pathOptions={{ color, fillColor: "#fff", fillOpacity: 1, weight: 2 }} />
        ))}
        {selected ? (
          <CircleMarker center={[selected.lat, selected.lng]} radius={9} pathOptions={{ color, fillColor: color, fillOpacity: 1, weight: 2 }} />
        ) : null}
        <VehicleMarker vehicle={vehicle ?? null} track={trail} mode={mode} color={color} ink={ink} />
      </MapContainer>
    </div>
  );
}

export function TaxiMap({
  stands,
  user,
}: {
  stands: Array<TaxiStand & { d: number }>;
  user: LatLng | null;
}) {
  const center = user ?? stands[0] ?? { lat: 22.3155, lng: 114.2647 };
  return (
    <div className="map-frame">
      <MapContainer center={[center.lat, center.lng]} zoom={15} className="map" scrollWheelZoom={false} attributionControl={false} zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {stands.slice(0, 16).map((s) => (
          <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={7} pathOptions={{ color: "#C9A227", fillColor: "#F4C400", fillOpacity: 1, weight: 2 }} />
        ))}
        {user ? (
          <CircleMarker center={[user.lat, user.lng]} radius={8} pathOptions={{ color: "#1E6BB8", fillColor: "#4EA2FF", fillOpacity: 1 }} />
        ) : null}
      </MapContainer>
    </div>
  );
}

export default RouteMap;
