"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import type { LatLng } from "@/lib/geo";
import type { NearbyPlace } from "@/lib/types";
import { IconLocate } from "./Icons";
import "leaflet/dist/leaflet.css";

function Fly({ pos, token }: { pos: LatLng; token: number }) {
  const map = useMap();
  const primed = useRef(false);
  useEffect(() => {
    if (!primed.current) {
      map.setView([pos.lat, pos.lng], 16);
      primed.current = true;
    }
  }, [pos, map]);
  useEffect(() => {
    if (token > 0) map.setView([pos.lat, pos.lng], 16);
  }, [token, pos, map]);
  return null;
}

function SizeSync({ sheet }: { sheet: number }) {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(id);
  }, [sheet, map]);
  return null;
}

export function HomeMap({
  origin,
  user,
  places,
  selectedId,
  onSelect,
  sheet,
  onRecenter,
  recenterToken,
}: {
  origin: LatLng;
  user: LatLng | null;
  places: NearbyPlace[];
  selectedId: string | null;
  onSelect: (place: NearbyPlace) => void;
  sheet: number;
  onRecenter: () => void;
  recenterToken: number;
}) {
  return (
    <div className="home-map">
      <MapContainer
        center={[origin.lat, origin.lng]}
        zoom={16}
        className="map home-leaflet"
        scrollWheelZoom
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fly pos={origin} token={recenterToken} />
        <SizeSync sheet={sheet} />
        {user ? (
          <CircleMarker center={[user.lat, user.lng]} radius={9} pathOptions={{ color: "#0B57D0", fillColor: "#4EA2FF", fillOpacity: 1, weight: 3 }} />
        ) : null}
        {places.map((place) => (
          <CircleMarker
            key={place.id}
            center={[place.lat, place.lng]}
            radius={selectedId === place.id ? 9 : 7}
            pathOptions={{
              color: place.color,
              fillColor: place.color,
              fillOpacity: selectedId === place.id ? 1 : 0.88,
              weight: 2,
            }}
            eventHandlers={{ click: () => onSelect(place) }}
          />
        ))}
      </MapContainer>
      <button type="button" className="recenter" onClick={onRecenter} aria-label="Recenter">
        <IconLocate className="icon-md" />
      </button>
    </div>
  );
}

export default HomeMap;
