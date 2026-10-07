"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { HANG_HAU, haversine, type LatLng } from "@/lib/geo";
import { mtrMarkerHtml, taxiMarkerHtml, tramMarkerHtml } from "@/lib/logos";
import { loadCongestionSegments, type CongestionSegment } from "@/lib/roadSpeed";
import type { NearbyPlace } from "@/lib/types";
import { IconLocate, IconPinpoint, IconSignal, IconTraffic } from "./Icons";
import { RouteLayer, glideMap, type RouteOverlay } from "./RouteMap";
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

function tramIcon(selected: boolean) {
  const n = selected ? 32 : 29;
  return L.divIcon({
    className: "stop-icon tram-pin",
    html: `<span class="logo-hit${selected ? " is-on" : ""}">${tramMarkerHtml(selected)}</span>`,
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

function pierIcon(selected: boolean) {
  const n = selected ? 36 : 30;
  return L.divIcon({
    className: "stop-icon pier-pin",
    html: `<span class="logo-hit pier-hit${selected ? " is-on" : ""}"><span class="ferry-mark"></span></span>`,
    iconSize: [n, n],
    iconAnchor: [n / 2, n / 2],
  });
}

function placeIcon(place: NearbyPlace, selected: boolean) {
  if (place.kind === "station") return stationIcon(place.lineColors?.length ? place.lineColors : [place.color], selected);
  if (place.kind === "tram") return tramIcon(selected);
  if (place.kind === "taxi") return taxiIcon(selected);
  if (place.kind === "pier") return pierIcon(selected);
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

/** Dev-mode congestion overlay: colour live road segments by speed / limit. */
const CONGESTION_MAX_SEGMENTS = 500;
/** How long loaded segments stay on the map before the overlay refreshes (ms). */
const CONGESTION_TTL_MS = 30_000;

function ratioBucket(ratio: number): { color: string; band: "free" | "moderate" | "heavy" | "congested" } {
  if (ratio > 0.75) return { color: "#22c55e", band: "free" };
  if (ratio > 0.5) return { color: "#eab308", band: "moderate" };
  if (ratio > 0.3) return { color: "#f97316", band: "heavy" };
  return { color: "#ef4444", band: "congested" };
}

async function scanCongestion(
  map: L.Map,
  layerRef: { current: L.LayerGroup | null },
  cancel: { current: boolean },
): Promise<void> {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const area = { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
  const key = `congestion:${sw.lat.toFixed(3)},${sw.lng.toFixed(3)}:${ne.lat.toFixed(3)},${ne.lng.toFixed(3)}`;
  let segments: CongestionSegment[] = [];
  try {
    segments = await loadCongestionSegments(key, area);
  } catch {
    segments = [];
  }
  if (cancel.current) return;
  const capped = segments.length > CONGESTION_MAX_SEGMENTS ? segments.slice(0, CONGESTION_MAX_SEGMENTS) : segments;
  if (!capped.length) {
    // A refresh that finds nothing (e.g. after a pan/zoom into an area with no
    // detector readings yet) must not blank the overlay that is already loaded.
    // Keep whatever is on the map until a later refresh returns segments.
    console.log("[dev] Congestion overlay: 0 segments (keeping previous overlay)");
    return;
  }
  if (segments.length > CONGESTION_MAX_SEGMENTS) {
    console.warn(`[dev] Congestion overlay capped at ${CONGESTION_MAX_SEGMENTS} of ${segments.length} segments`);
  }
  // Build the fresh overlay off-map, then swap it in so the current lines stay
  // visible until the new scan is ready (no flicker on the refresh).
  const next = L.layerGroup();
  const counts = { free: 0, moderate: 0, heavy: 0, congested: 0, estimated: 0, interpolated: 0 };
  for (const seg of capped) {
    const interp = seg.interpolated === true;
    // Interpolated segments keep the colour scale; only the no-neighbour
    // free-flow fallback stays grey.
    const bucket = interp || !seg.estimated ? ratioBucket(seg.limit > 0 ? seg.kmh / seg.limit : 0) : null;
    if (bucket) counts[bucket.band] += 1;
    else counts.estimated += 1;
    if (interp) counts.interpolated += 1;
    L.polyline(
      seg.pts.map((p) => [p.lat, p.lng] as [number, number]),
      {
        color: bucket ? bucket.color : "#9ca3af",
        weight: 4,
        opacity: interp ? 0.7 : bucket ? 0.8 : 0.5,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      },
    ).addTo(next);
  }
  next.addTo(map);
  layerRef.current?.remove();
  layerRef.current = next;
  console.log(
    `[dev] Congestion overlay: ${capped.length} segments | Free-flow: ${counts.free} | Moderate: ${counts.moderate} | Heavy: ${counts.heavy} | Congested: ${counts.congested} | Estimated: ${counts.estimated} | Interpolated: ${counts.interpolated}`,
  );
}

type Cluster = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
  places: NearbyPlace[];
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
      places: members,
    });
  }
  return { pins, clusters };
}

const TAXI_FOCUS_ZOOM = 17;

function holdSpot(skip: { current: number } | undefined) {
  if (skip) skip.current += 1;
}

function frameAroundOrigin(map: L.Map, origin: LatLng, points: NearbyPlace[], skip?: { current: number }) {
  holdSpot(skip);
  if (points.length === 0) {
    map.setView([origin.lat, origin.lng], START_ZOOM, { animate: false });
    return;
  }
  let north = 0;
  let east = 0;
  for (const point of points) {
    north = Math.max(north, Math.abs(point.lat - origin.lat));
    east = Math.max(east, Math.abs(point.lng - origin.lng));
  }
  const bounds = L.latLngBounds(
    [origin.lat - north, origin.lng - east],
    [origin.lat + north, origin.lng + east],
  );
  const zoom = Math.max(map.getMinZoom(), Math.min(START_ZOOM, map.getBoundsZoom(bounds, false, L.point(64, 64))));
  map.setView([origin.lat, origin.lng], zoom, { animate: false });
}

function frameTaxiStands(map: L.Map, taxis: NearbyPlace[], origin: LatLng, skip?: { current: number }) {
  if (taxis.length === 0) return;
  holdSpot(skip);
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
  frameFerry,
  framePlaces,
  focus,
  holdCenter,
  routeLock,
  skipSpot,
}: {
  origin: LatLng;
  token: number;
  sheet: number;
  onZoom: (zoom: number) => void;
  frameTaxi: boolean;
  taxis: NearbyPlace[];
  frameFerry: boolean;
  framePlaces: NearbyPlace[];
  focus: { lat: number; lng: number; token: number } | null;
  holdCenter: boolean;
  routeLock: boolean;
  skipSpot?: { current: number };
}) {
  const map = useMap();
  const sized = useRef(false);
  const located = useRef(false);
  const fittedKey = useRef("");
  const ferryFramed = useRef(false);
  const lastFocus = useRef(0);
  const originRef = useRef(origin);
  originRef.current = origin;

  useEffect(() => {
    const sync = () => onZoom(map.getZoom());
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
    };
  }, [map, onZoom]);

  // First GPS fix only. Later watchPosition ticks must not yank the camera.
  useEffect(() => {
    if (located.current || holdCenter || frameTaxi || routeLock) return;
    if (haversine(origin, HANG_HAU) < 80) return;
    located.current = true;
    holdSpot(skipSpot);
    map.setView([origin.lat, origin.lng], START_ZOOM);
  }, [origin, map, frameTaxi, holdCenter, routeLock, skipSpot]);

  useEffect(() => {
    if (routeLock || token === 0) return;
    const here = originRef.current;
    holdSpot(skipSpot);
    map.setView([here.lat, here.lng], START_ZOOM);
  }, [token, map, routeLock, skipSpot]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      // Keep the existing view pinned to the top-left. The container grows
      // downward as the sheet shrinks, and Leaflet then requests those tiles.
      map.invalidateSize({ pan: false, animate: false });
      const here = originRef.current;
      if (routeLock) {
        sized.current = true;
        return;
      }
      if (focus && focus.token !== lastFocus.current) {
        lastFocus.current = focus.token;
        holdSpot(skipSpot);
        glideMap(map, focus.lat, focus.lng, TAXI_FOCUS_ZOOM);
        sized.current = true;
        return;
      }
      if (frameFerry) {
        if (!ferryFramed.current && framePlaces.length > 0 && lastFocus.current === 0) {
          ferryFramed.current = true;
          frameAroundOrigin(map, here, framePlaces, skipSpot);
        }
        sized.current = true;
        return;
      }
      ferryFramed.current = false;
      if (holdCenter) {
        sized.current = true;
        return;
      }
      if (focus) {
        sized.current = true;
        return;
      }
      if (frameTaxi) {
        const key = taxis.map((stand) => stand.id).join(",");
        if (key && key !== fittedKey.current && lastFocus.current === 0) {
          fittedKey.current = key;
          frameTaxiStands(map, taxis, here, skipSpot);
        }
        sized.current = true;
        return;
      }
      const leavingTaxi = fittedKey.current !== "" || lastFocus.current !== 0;
      fittedKey.current = "";
      lastFocus.current = 0;
      if (!sized.current || leavingTaxi) {
        holdSpot(skipSpot);
        map.setView([here.lat, here.lng], START_ZOOM, { animate: false });
        sized.current = true;
      }
    }, sized.current ? 0 : 80);
    return () => window.clearTimeout(id);
  }, [sheet, map, frameTaxi, taxis, frameFerry, framePlaces, focus, holdCenter, routeLock, skipSpot]);

  return null;
}

function ClusterMarker({ cluster, onOpen }: { cluster: Cluster; onOpen: (places: NearbyPlace[]) => void }) {
  return (
    <Marker
      position={[cluster.lat, cluster.lng]}
      icon={clusterIcon(cluster.count, cluster.color)}
      eventHandlers={{
        click: () => onOpen(cluster.places),
      }}
    />
  );
}

function MapHandle({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
  }, [map, onMap]);
  return null;
}

function SpotWatch({ onSpot, skipMoves }: { onSpot: (spot: LatLng) => void; skipMoves?: { current: number } }) {
  const map = useMap();
  const onSpotRef = useRef(onSpot);
  onSpotRef.current = onSpot;
  const skipRef = useRef(skipMoves);
  skipRef.current = skipMoves;
  useEffect(() => {
    const send = () => {
      const skip = skipRef.current;
      if (skip && skip.current > 0) {
        skip.current -= 1;
        return;
      }
      const c = map.getCenter();
      onSpotRef.current({ lat: c.lat, lng: c.lng });
    };
    map.on("moveend", send);
    return () => {
      map.off("moveend", send);
    };
  }, [map]);
  return null;
}

function placesInView(map: L.Map, places: NearbyPlace[]): NearbyPlace[] {
  if (places.length < 250) return places;
  const bounds = map.getBounds().pad(0.35);
  return places.filter((place) => bounds.contains([place.lat, place.lng]));
}

export function HomeMap({
  origin,
  user,
  places,
  selectedId,
  onSelect,
  onSelectGroup,
  sheet,
  onRecenter,
  recenterToken,
  frameTaxi = false,
  frameFerry = false,
  framePlaces = [],
  taxiFocus = null,
  dev = false,
  pinOn = false,
  showAll = false,
  onPinChange,
  onShowAll,
  onSpot,
  route = null,
  onRouteStop,
}: {
  origin: LatLng;
  user: LatLng | null;
  places: NearbyPlace[];
  selectedId: string | null;
  onSelect: (place: NearbyPlace) => void;
  onSelectGroup?: (places: NearbyPlace[]) => void;
  sheet: number;
  onRecenter: () => void;
  recenterToken: number;
  frameTaxi?: boolean;
  frameFerry?: boolean;
  framePlaces?: NearbyPlace[];
  taxiFocus?: { lat: number; lng: number; token: number } | null;
  dev?: boolean;
  pinOn?: boolean;
  showAll?: boolean;
  onPinChange?: (on: boolean, spot: LatLng | null) => void;
  onShowAll?: (on: boolean) => void;
  onSpot?: (spot: LatLng) => void;
  route?: RouteOverlay | null;
  onRouteStop?: (seq: number) => void;
}) {
  const [zoom, setZoom] = useState(START_ZOOM);
  const [viewTick, setViewTick] = useState(0);
  const mapRef = useRef<L.Map | null>(null);
  const skipSpot = useRef(0);
  const [congestionOn, setCongestionOn] = useState(false);
  const scanCancel = useRef(false);
  const congestionLayer = useRef<L.LayerGroup | null>(null);
  const takeMap = useCallback((map: L.Map) => {
    mapRef.current = map;
    setViewTick((n) => n + 1);
  }, []);
  const bumpView = useCallback(() => setViewTick((n) => n + 1), []);
  const shown = useMemo(() => {
    if (!showAll) return places;
    const map = mapRef.current;
    if (!map) return [];
    return placesInView(map, places);
  }, [places, showAll, viewTick]);
  const grouped = useMemo(() => {
    const next = groupPlaces(shown, zoom);
    const seen = new Set<string>();
    return {
      clusters: next.clusters,
      pins: next.pins.filter((place) => {
        if (seen.has(place.id)) return false;
        seen.add(place.id);
        return true;
      }),
    };
  }, [shown, zoom]);
  const taxis = useMemo(() => places.filter((place) => place.kind === "taxi"), [places]);

  useEffect(() => {
    if (!dev || !congestionOn) return;
    const map = mapRef.current;
    if (!map) return;
    scanCancel.current = false;
    // Effect-local guard so a StrictMode remount (or a dev/congestionOn toggle)
    // can't leave an orphaned timer rescheduling scans after cleanup.
    let cancelled = false;
    // Keep the loaded overlay on screen and only refresh it CONGESTION_TTL_MS
    // after each load. Panning/zooming no longer triggers a rescan, so the lines
    // no longer blink out mid-gesture; the next scan still reads the map's
    // current bounds, so the overlay follows the view on the next tick.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await scanCongestion(map, congestionLayer, scanCancel);
      if (cancelled || scanCancel.current) return;
      timer = setTimeout(() => void refresh(), CONGESTION_TTL_MS);
    };
    void refresh();
    return () => {
      cancelled = true;
      scanCancel.current = true;
      if (timer) clearTimeout(timer);
      congestionLayer.current?.remove();
      congestionLayer.current = null;
    };
  }, [dev, congestionOn]);

  return (
    <div className="home-map">
      <MapContainer
        center={[origin.lat, origin.lng]}
        zoom={START_ZOOM}
        minZoom={12}
        maxZoom={19}
        zoomSnap={0}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={80}
        preferCanvas={false}
        zoomAnimation={false}
        markerZoomAnimation={false}
        className="map home-leaflet"
        scrollWheelZoom
        touchZoom
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapHandle onMap={takeMap} />
        {showAll ? <SpotWatch onSpot={bumpView} /> : null}
        {pinOn && onSpot ? <SpotWatch onSpot={onSpot} skipMoves={skipSpot} /> : null}
        <MapFx
          origin={origin}
          token={recenterToken}
          sheet={sheet}
          onZoom={setZoom}
          frameTaxi={frameTaxi}
          taxis={taxis}
          frameFerry={frameFerry}
          framePlaces={framePlaces}
          focus={taxiFocus}
          skipSpot={skipSpot}
          holdCenter={pinOn}
          routeLock={Boolean(route)}
        />
        {user ? <Marker position={[user.lat, user.lng]} icon={USER_ICON} interactive={false} zIndexOffset={800} /> : null}
        {route ? (
          <RouteLayer {...route} onStop={onRouteStop} />
        ) : (
          <>
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
              <ClusterMarker key={cluster.key} cluster={cluster} onOpen={onSelectGroup ?? ((places) => onSelect(places[0]))} />
            ))}
          </>
        )}
      </MapContainer>
      {pinOn ? <div className="dev-crosshair" aria-hidden>📍</div> : null}
      <div className="map-tools">
        {dev ? (
          <>
            <button
              type="button"
              className={`recenter${pinOn ? " is-on" : ""}`}
              aria-label="Pin"
              aria-pressed={pinOn}
              onClick={() => {
                const next = !pinOn;
                if (!next) {
                  onPinChange?.(false, null);
                  return;
                }
                const c = mapRef.current?.getCenter();
                onPinChange?.(true, c ? { lat: c.lat, lng: c.lng } : null);
              }}
            >
              <IconPinpoint className="icon-md" />
            </button>
            <button
              type="button"
              className={`recenter${showAll ? " is-on" : ""}`}
              aria-label="All"
              aria-pressed={showAll}
              onClick={() => onShowAll?.(!showAll)}
            >
              <IconSignal className="icon-md" />
            </button>
            <button
              type="button"
              className={`recenter${congestionOn ? " is-on" : ""}`}
              aria-label="Traffic"
              aria-pressed={congestionOn}
              onClick={() => setCongestionOn((v) => !v)}
            >
              <IconTraffic className="icon-md" />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={`recenter${route?.follow ? " is-on" : ""}`}
          onClick={onRecenter}
          aria-label="Recenter"
          aria-pressed={route ? Boolean(route.follow) : undefined}
        >
          <IconLocate className="icon-md" />
        </button>
      </div>
    </div>
  );
}

export default HomeMap;
