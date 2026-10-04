"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { HANG_HAU, haversine, type LatLng } from "@/lib/geo";
import { mtrMarkerHtml, taxiMarkerHtml } from "@/lib/logos";
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

const TRAM_GLYPH = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6h10M8 6v3M16 6v3"/><rect x="4" y="9" width="16" height="9" rx="2"/><path d="M7 18v2M17 18v2M4 13h16"/></svg>`;

function logoIcon(html: string, selected: boolean) {
  const n = selected ? 46 : 40;
  return L.divIcon({
    className: "stop-icon",
    html: `<span class="logo-hit${selected ? " is-on" : ""}">${html}</span>`,
    iconSize: [n, n],
    iconAnchor: [n / 2, n / 2],
  });
}

function stationIcon(colors: string[], selected: boolean) {
  return logoIcon(mtrMarkerHtml(colors, selected), selected);
}

function tramIcon(color: string, selected: boolean) {
  const n = selected ? 30 : 26;
  const safe = hex(color);
  return L.divIcon({
    className: "stop-icon",
    html: `<span class="tram-pin${selected ? " is-on" : ""}" style="background:${safe};color:${safe}">${TRAM_GLYPH}</span>`,
    iconSize: [n, n],
    iconAnchor: [n / 2, n / 2],
  });
}

function taxiIcon(selected: boolean) {
  const w = selected ? 36 : 34;
  const h = selected ? 21 : 20;
  return L.divIcon({
    className: "stop-icon taxi-pin",
    html: `<span class="logo-hit${selected ? " is-on" : ""}">${taxiMarkerHtml(selected)}</span>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

function placeIcon(place: NearbyPlace, selected: boolean) {
  if (place.kind === "station") return stationIcon(place.lineColors?.length ? place.lineColors : [place.color], selected);
  if (place.kind === "tram") return tramIcon(place.color, selected);
  if (place.kind === "taxi") return taxiIcon(selected);
  return dotIcon(place.color, selected);
}

const USER_ICON_PX = 64;
const USER_ICON = L.divIcon({
  className: "stop-icon user-icon",
  html: `<span class="user-pin"><span class="user-ripple"></span><span class="user-ripple"></span><span class="user-dot"></span></span>`,
  iconSize: [USER_ICON_PX, USER_ICON_PX],
  iconAnchor: [USER_ICON_PX / 2, USER_ICON_PX / 2],
});

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

function isFixedPlace(place: NearbyPlace) {
  return place.kind === "station" || place.kind === "tram" || place.kind === "taxi" || place.kind === "pier";
}

function groupPlaces(places: NearbyPlace[], zoom: number): { pins: NearbyPlace[]; clusters: Cluster[] } {
  const fixed = places.filter(isFixedPlace);
  if (zoom >= DETAIL_ZOOM) return { pins: places, clusters: [] };
  const cell = zoom >= 14 ? 0.003 : zoom >= 13 ? 0.006 : 0.012;
  const buckets = new Map<string, NearbyPlace[]>();
  for (const place of places) {
    if (isFixedPlace(place)) continue;
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

const TAXI_FOCUS_ZOOM = 17;

function frameTaxiStands(map: L.Map, taxis: NearbyPlace[], origin: LatLng) {
  if (taxis.length === 0) return;
  const bounds = L.latLngBounds(taxis.map((stand) => [stand.lat, stand.lng] as [number, number]));
  bounds.extend([origin.lat, origin.lng]);
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: START_ZOOM, animate: false });
}

function MapFx({
  origin,
  token,
  sheet,
  onZoom,
  frameTaxi,
  taxis,
  focus,
}: {
  origin: LatLng;
  token: number;
  sheet: number;
  onZoom: (zoom: number) => void;
  frameTaxi: boolean;
  taxis: NearbyPlace[];
  focus: { lat: number; lng: number; token: number } | null;
}) {
  const map = useMap();
  const sized = useRef(false);
  const gpsLocked = useRef(false);
  const fittedKey = useRef("");
  const lastFocus = useRef(0);

  useEffect(() => {
    const sync = () => onZoom(map.getZoom());
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
    };
  }, [map, onZoom]);

  useEffect(() => {
    if (frameTaxi || gpsLocked.current) return;
    if (haversine(origin, HANG_HAU) < 80) return;
    map.setView([origin.lat, origin.lng], START_ZOOM);
    gpsLocked.current = true;
  }, [origin, map, frameTaxi]);

  useEffect(() => {
    if (token > 0) map.setView([origin.lat, origin.lng], START_ZOOM);
  }, [token, origin, map]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      // Keep the existing view pinned to the top-left. The container grows
      // downward as the sheet shrinks, and Leaflet then requests those tiles.
      map.invalidateSize({ pan: false, animate: false });
      if (frameTaxi) {
        if (focus && focus.token !== lastFocus.current) {
          lastFocus.current = focus.token;
          map.flyTo([focus.lat, focus.lng], TAXI_FOCUS_ZOOM, { duration: 0.45 });
          sized.current = true;
          return;
        }
        const key = taxis.map((stand) => stand.id).join(",");
        if (key && key !== fittedKey.current && lastFocus.current === 0) {
          fittedKey.current = key;
          frameTaxiStands(map, taxis, origin);
        }
        sized.current = true;
        return;
      }
      const leavingTaxi = fittedKey.current !== "" || lastFocus.current !== 0;
      fittedKey.current = "";
      lastFocus.current = 0;
      if (!sized.current || leavingTaxi) {
        map.setView([origin.lat, origin.lng], START_ZOOM, { animate: false });
        sized.current = true;
      }
    }, sized.current ? 0 : 80);
    return () => window.clearTimeout(id);
  }, [sheet, map, origin, frameTaxi, taxis, focus]);

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
  frameTaxi = false,
  taxiFocus = null,
}: {
  origin: LatLng;
  user: LatLng | null;
  places: NearbyPlace[];
  selectedId: string | null;
  onSelect: (place: NearbyPlace) => void;
  sheet: number;
  onRecenter: () => void;
  recenterToken: number;
  frameTaxi?: boolean;
  taxiFocus?: { lat: number; lng: number; token: number } | null;
}) {
  const [zoom, setZoom] = useState(START_ZOOM);
  const grouped = useMemo(() => groupPlaces(places, zoom), [places, zoom]);
  const taxis = useMemo(() => places.filter((place) => place.kind === "taxi"), [places]);

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
        <MapFx
          origin={origin}
          token={recenterToken}
          sheet={sheet}
          onZoom={setZoom}
          frameTaxi={frameTaxi}
          taxis={taxis}
          focus={taxiFocus}
        />
        {user ? <Marker position={[user.lat, user.lng]} icon={USER_ICON} interactive={false} zIndexOffset={800} /> : null}
        {grouped.pins.map((place) => (
          <Marker
            key={place.id}
            position={[place.lat, place.lng]}
            icon={placeIcon(place, selectedId === place.id)}
            zIndexOffset={place.kind === "station" ? 500 : place.kind === "tram" ? 450 : place.kind === "taxi" ? 400 : place.kind === "pier" ? 350 : 0}
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
