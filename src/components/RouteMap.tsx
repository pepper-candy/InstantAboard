"use client";

import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import type { LatLng } from "@/lib/geo";
import type { TaxiStand, VehicleDot } from "@/lib/types";
import "leaflet/dist/leaflet.css";

type RouteProps = {
  path: LatLng[];
  selected?: LatLng | null;
  vehicle?: VehicleDot | null;
  color: string;
};

export function RouteMap({ path, selected, vehicle, color }: RouteProps) {
  const center = selected ?? path[Math.floor(path.length / 2)] ?? { lat: 22.32, lng: 114.26 };
  return (
    <div className="map-frame">
      <MapContainer center={[center.lat, center.lng]} zoom={14} className="map" scrollWheelZoom={false} attributionControl={false} zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {path.length > 1 ? <Polyline positions={path.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color, weight: 5, opacity: 0.85 }} /> : null}
        {path.map((p, i) => (
          <CircleMarker key={`${p.lat}-${p.lng}-${i}`} center={[p.lat, p.lng]} radius={4} pathOptions={{ color, fillColor: "#fff", fillOpacity: 1, weight: 2 }} />
        ))}
        {selected ? (
          <CircleMarker center={[selected.lat, selected.lng]} radius={9} pathOptions={{ color, fillColor: color, fillOpacity: 1, weight: 2 }} />
        ) : null}
        {vehicle ? (
          <CircleMarker
            center={[vehicle.lat, vehicle.lng]}
            radius={vehicle.gps ? 8 : 7}
            pathOptions={{
              color: vehicle.gps ? "#111" : color,
              fillColor: vehicle.gps ? "#3DDC84" : color,
              fillOpacity: vehicle.gps ? 1 : 0.55,
              weight: 2,
              dashArray: vehicle.gps ? undefined : "3 3",
            }}
          >
            {vehicle.gps ? null : (
              <Tooltip permanent direction="right" offset={[8, 0]} className="est-tip">
                est.
              </Tooltip>
            )}
          </CircleMarker>
        ) : null}
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
