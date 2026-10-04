"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { HANG_HAU, haversine, type LatLng } from "@/lib/geo";
import type { NearbyPlace } from "@/lib/types";
import { IconLocate } from "./Icons";
import "leaflet/dist/leaflet.css";

const START_ZOOM = 16;
const DETAIL_ZOOM = 15;

function hex(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

function dotIcon(color: string, selected: boolean) {
  const n = selected ? 12 : 10;
  const safe = hex(color);
  return L.divIcon({
    className: "stop-icon",
    html: `<span class="stop-dot${selected ? " is-on" : ""}" style="background:${safe};color:${safe};width:${n}px;height:${n}px"></span>`,
    iconSize: [n, n],
    iconAnchor: [n / 2, n / 2],
  });
}

const STATION_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="14" rx="4"/><path d="M8 17l-2 4M16 17l2 4M8 10h8"/></svg>`;
const TAXI_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="#1A1204" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l2-5h12l2 5v5H4z"/><path d="M9 8V6h6v2M6 16v2M18 16v2"/></svg>`;

function stationIcon(color: string, selected: boolean) {
  const n = selected ? 30 : 26;
  const safe = hex(color);
  return L.divIcon({
    className: "stop-icon",
    html: `<span class="station-pin${selected ? " is-on" : ""}" style="background:${safe};color:${safe}">${STATION_GLYPH}</span>`,
    iconSize: [n, n],
    iconAnchor: [n / 2, n / 2],
  });
}

function taxiIcon(selected: boolean) {
  const n = selected ? 28 : 24;
  return L.divIcon({
    className: "stop-icon",
    html: `<span class="taxi-pin${selected ? " is-on" : ""}">${TAXI_GLYPH}</span>`,
    iconSize: [n, n],
    iconAnchor: [n / 2, n / 2],
  });
}

function placeIcon(place: NearbyPlace, selected: boolean) {
  if (place.kind === "station") return stationIcon(place.color, selected);
  if (place.kind === "taxi") return taxiIcon(selected);
  return dotIcon(place.color, selected);
}

function userIcon() {
  return L.divIcon({
    className: "stop-icon user-icon",
    html: `<span class="user-pin"><span class="user-ripple"></span><span class="user-ripple"></span><span class="user-dot"></span></span>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function clusterIcon(count: number, color: string) {
  return L.divIcon({
    className: "stop-icon",
    html: `<span class="cluster-dot" style="background:${hex(color)}">${count}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

type Cluster = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
};

function groupPlaces(places: NearbyPlace[], zoom: number): { pins: NearbyPlace[]; clusters: Cluster[] } {
  const fixed = places.filter((place) => place.kind === "station" || place.kind === "taxi");
  if (zoom >= DETAIL_ZOOM) return { pins: places, clusters: [] };
  const cell = zoom >= 14 ? 0.003 : zoom >= 13 ? 0.006 : 0.012;
  const buckets = new Map<string, NearbyPlace[]>();
  for (const place of places) {
    if (place.kind === "station" || place.kind === "taxi") continue;
    const key = `${Math.round(place.lat / cell)}:${Math.round(place.lng / cell)}`;
    const list = buckets.get(key);
    if (list) list.push(place);
    else buckets.set(key, [place]);
  }
  const pins: NearbyPlace[] = [...fixed];
  const clusters: Cluster[] = [];
  for (const [key, members] of buckets) {
    if (members.length === 1) {
      pins.push(members[0]);
      continue;
    }
    clusters.push({
      key,
      lat: members.reduce((sum, item) => sum + item.lat, 0) / members.length,
      lng: members.reduce((sum, item) => sum + item.lng, 0) / members.length,
      count: members.length,
      color: members[0].color,
    });
  }
  return { pins, clusters };
}

function MapFx({
  origin,
  token,
  sheet,
  onZoom,
}: {
  origin: LatLng;
  token: number;
  sheet: number;
  onZoom: (zoom: number) => void;
}) {
  const map = useMap();
  const sized = useRef(false);
  const gpsLocked = useRef(false);

  useEffect(() => {
    const sync = () => onZoom(map.getZoom());
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
    };
  }, [map, onZoom]);

  useEffect(() => {
    if (gpsLocked.current) return;
    if (haversine(origin, HANG_HAU) < 80) return;
    map.setView([origin.lat, origin.lng], START_ZOOM);
    gpsLocked.current = true;
  }, [origin, map]);

  useEffect(() => {
    if (token > 0) map.setView([origin.lat, origin.lng], START_ZOOM);
  }, [token, origin, map]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      map.invalidateSize();
      if (!sized.current) {
        map.setView([origin.lat, origin.lng], START_ZOOM, { animate: false });
        sized.current = true;
      }
    }, 80);
    return () => window.clearTimeout(id);
  }, [sheet, map, origin]);

  return null;
}

function ClusterMarker({ cluster }: { cluster: Cluster }) {
  const map = useMap();
  return (
    <Marker
      position={[cluster.lat, cluster.lng]}
      icon={clusterIcon(cluster.count, cluster.color)}
      eventHandlers={{
        click: () => map.setView([cluster.lat, cluster.lng], START_ZOOM),
      }}
    />
  );
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
  const [zoom, setZoom] = useState(START_ZOOM);
  const grouped = useMemo(() => groupPlaces(places, zoom), [places, zoom]);

  return (
    <div className="home-map">
      <MapContainer
        center={[origin.lat, origin.lng]}
        zoom={START_ZOOM}
        minZoom={12}
        maxZoom={19}
        className="map home-leaflet"
        scrollWheelZoom
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapFx origin={origin} token={recenterToken} sheet={sheet} onZoom={setZoom} />
        {user ? <Marker position={[user.lat, user.lng]} icon={userIcon()} interactive={false} zIndexOffset={800} /> : null}
        {grouped.pins.map((place) => (
          <Marker
            key={place.id}
            position={[place.lat, place.lng]}
            icon={placeIcon(place, selectedId === place.id)}
            zIndexOffset={place.kind === "station" ? 500 : place.kind === "taxi" ? 400 : 0}
            eventHandlers={{ click: () => onSelect(place) }}
          />
        ))}
        {grouped.clusters.map((cluster) => (
          <ClusterMarker key={cluster.key} cluster={cluster} />
        ))}
      </MapContainer>
      <button type="button" className="recenter" onClick={onRecenter} aria-label="Recenter">
        <IconLocate className="icon-md" />
      </button>
    </div>
  );
}

export default HomeMap;
