"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { HANG_HAU, haversine, type LatLng } from "@/lib/geo";
import { mtrMarkerHtml, taxiMarkerHtml, tramMarkerHtml } from "@/lib/logos";
import {
  cachedCongestionHk,
  loadCongestionArea,
  loadCongestionHk,
  refreshCongestionSpeeds,
  type CongestionSegment,
} from "@/lib/roadSpeed";
import type { NearbyPlace } from "@/lib/types";
import { IconLocate, IconLock, IconPinpoint, IconSignal, IconTraffic } from "./Icons";
import type { DevPinMode } from "@/lib/devMode";
import { glideMap, setViewVisibleCenter, visibleCenterLatLng } from "@/lib/mapCamera";
import { RouteLayer, type RouteOverlay } from "./RouteMap";
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

/** How often live speeds are refetched after the first paint (ms). */
const CONGESTION_TTL_MS = 60 * 1000;

function ratioBucket(ratio: number): { color: string; band: "free" | "moderate" | "heavy" | "congested" } {
  if (ratio > 0.75) return { color: "#22c55e", band: "free" };
  if (ratio > 0.5) return { color: "#eab308", band: "moderate" };
  if (ratio > 0.3) return { color: "#f97316", band: "heavy" };
  return { color: "#ef4444", band: "congested" };
}

type CongestionCanvas = L.Layer & { setSegments: (segments: CongestionSegment[]) => void };

function createCongestionCanvas(): CongestionCanvas {
  const layer = new (L.Layer.extend({
    initialize(this: { _segments: CongestionSegment[] }) {
      this._segments = [];
    },
    onAdd(this: {
      _map: L.Map;
      _canvas: HTMLCanvasElement;
      _segments: CongestionSegment[];
      _onView: () => void;
      _redraw: () => void;
    }, map: L.Map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "congestion-layer");
      this._canvas.style.pointerEvents = "none";
      map.getPanes().overlayPane.appendChild(this._canvas);
      this._onView = () => this._redraw();
      map.on("move zoom resize", this._onView);
      this._redraw();
    },
    onRemove(this: { _map: L.Map; _canvas?: HTMLCanvasElement; _onView?: () => void }, map: L.Map) {
      if (this._onView) map.off("move zoom resize", this._onView);
      this._canvas?.remove();
      this._canvas = undefined;
    },
    setSegments(this: { _segments: CongestionSegment[]; _redraw?: () => void }, segments: CongestionSegment[]) {
      this._segments = segments;
      const counts = { free: 0, moderate: 0, heavy: 0, congested: 0, estimated: 0, interpolated: 0 };
      for (const seg of segments) {
        const interp = seg.interpolated === true;
        const bucket = interp || !seg.estimated ? ratioBucket(seg.limit > 0 ? seg.kmh / seg.limit : 0) : null;
        if (bucket) counts[bucket.band] += 1;
        else counts.estimated += 1;
        if (interp) counts.interpolated += 1;
      }
      console.log(
        `[dev] Congestion overlay: ${segments.length} segments | Free-flow: ${counts.free} | Moderate: ${counts.moderate} | Heavy: ${counts.heavy} | Congested: ${counts.congested} | Estimated: ${counts.estimated} | Interpolated: ${counts.interpolated}`,
      );
      this._redraw?.();
    },
    _redraw(this: { _map?: L.Map; _canvas?: HTMLCanvasElement; _segments: CongestionSegment[] }) {
      const map = this._map;
      const canvas = this._canvas;
      if (!map || !canvas) return;
      const size = map.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size.x * dpr);
      canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const topLeft = map.containerPointToLayerPoint(L.point(0, 0));
      L.DomUtil.setPosition(canvas, topLeft);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const bounds = map.getBounds().pad(0.2);
      for (const seg of this._segments) {
        let visible = false;
        for (const p of seg.pts) {
          if (bounds.contains([p.lat, p.lng])) {
            visible = true;
            break;
          }
        }
        if (!visible) continue;
        const interp = seg.interpolated === true;
        const bucket = interp || !seg.estimated ? ratioBucket(seg.limit > 0 ? seg.kmh / seg.limit : 0) : null;
        ctx.beginPath();
        ctx.strokeStyle = bucket ? bucket.color : "#9ca3af";
        ctx.globalAlpha = interp ? 0.7 : bucket ? 0.85 : 0.5;
        ctx.lineWidth = 4;
        for (let i = 0; i < seg.pts.length; i++) {
          const p = seg.pts[i];
          if (!p) continue;
          const pt = map.latLngToContainerPoint([p.lat, p.lng]);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
    },
  }))() as CongestionCanvas;
  return layer;
}

function CongestionFx({ on, onBusy }: { on: boolean; onBusy: (busy: boolean) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!on) {
      onBusy(false);
      return;
    }
    const overlay = createCongestionCanvas();
    overlay.addTo(map);
    let cancelled = false;
    const apply = (segments: CongestionSegment[]) => {
      if (cancelled || !segments.length) return;
      overlay.setSegments(segments);
    };
    const ready = cachedCongestionHk();
    if (ready?.length) apply(ready);
    const boundsBox = () => {
      const b = map.getBounds().pad(0.15);
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    };
    onBusy(true);
    void (async () => {
      try {
        const view = await loadCongestionArea(boundsBox(), true);
        apply(view);
        const full = await loadCongestionHk(false);
        apply(full.length ? full : view);
      } finally {
        if (!cancelled) onBusy(false);
      }
    })();
    const timer = window.setInterval(() => {
      void refreshCongestionSpeeds().then(apply);
    }, CONGESTION_TTL_MS);
    return () => {
      cancelled = true;
      onBusy(false);
      window.clearInterval(timer);
      overlay.remove();
    };
  }, [map, on, onBusy]);
  return null;
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

function MapFx({
  origin,
  token,
  onZoom,
  frameTaxi,
  frameFerry,
  framePlaces,
  focus,
  holdCenter,
  routeLock,
  skipSpot,
  sheetFrac,
}: {
  origin: LatLng;
  token: number;
  onZoom: (zoom: number) => void;
  frameTaxi: boolean;
  frameFerry: boolean;
  framePlaces: NearbyPlace[];
  focus: { lat: number; lng: number; token: number } | null;
  holdCenter: boolean;
  routeLock: boolean;
  skipSpot?: { current: number };
  sheetFrac: number;
}) {
  const map = useMap();
  const sized = useRef(false);
  const located = useRef(false);
  const ferryFramed = useRef(false);
  const lastFocus = useRef(0);
  const originRef = useRef(origin);
  originRef.current = origin;
  const sheetFracRef = useRef(sheetFrac);
  sheetFracRef.current = sheetFrac;

  useEffect(() => {
    const sync = () => onZoom(map.getZoom());
    sync();
    map.on("zoomend", sync);
    return () => {
      map.off("zoomend", sync);
    };
  }, [map, onZoom]);

  // Leaflet caches its viewport in pixels. .home-map stays 100dvh while the
  // sheet moves; coalesce invalidateSize for orientation / sidebar layout.
  useEffect(() => {
    const mapContainer = map.getContainer();
    const parent = mapContainer.parentElement;
    const SETTLE_MS = 120;
    let idle = 0;
    let raf = 0;
    const flush = () => {
      if (idle) {
        window.clearTimeout(idle);
        idle = 0;
      }
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        map.invalidateSize({ pan: false, animate: false });
      });
    };
    const schedule = () => {
      if (idle) window.clearTimeout(idle);
      idle = window.setTimeout(flush, SETTLE_MS);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(mapContainer);
    if (parent && parent !== mapContainer) observer.observe(parent);
    return () => {
      observer.disconnect();
      window.clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map]);

  // First GPS fix only. Later watchPosition ticks must not yank the camera.
  useEffect(() => {
    if (located.current || holdCenter || frameTaxi || routeLock) return;
    if (haversine(origin, HANG_HAU) < 80) return;
    located.current = true;
    holdSpot(skipSpot);
    setViewVisibleCenter(map, origin.lat, origin.lng, START_ZOOM, sheetFracRef.current);
  }, [origin, map, frameTaxi, holdCenter, routeLock, skipSpot]);

  useEffect(() => {
    if (routeLock || token === 0) return;
    const here = originRef.current;
    holdSpot(skipSpot);
    setViewVisibleCenter(map, here.lat, here.lng, START_ZOOM, sheetFracRef.current);
  }, [token, map, routeLock, skipSpot]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const here = originRef.current;
      if (routeLock) {
        sized.current = true;
        return;
      }
      if (focus && focus.token !== lastFocus.current) {
        lastFocus.current = focus.token;
        holdSpot(skipSpot);
        glideMap(map, focus.lat, focus.lng, TAXI_FOCUS_ZOOM, sheetFracRef.current);
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
        sized.current = true;
        return;
      }
      lastFocus.current = 0;
      if (!sized.current) {
        holdSpot(skipSpot);
        setViewVisibleCenter(map, here.lat, here.lng, START_ZOOM, sheetFracRef.current, { animate: false });
        sized.current = true;
      }
    }, sized.current ? 0 : 80);
    return () => window.clearTimeout(id);
  }, [map, frameTaxi, frameFerry, framePlaces, focus, holdCenter, routeLock, skipSpot]);

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

function SpotWatch({
  onSpot,
  skipMoves,
  sheetFrac = 0,
  visibleCenter = false,
}: {
  onSpot: (spot: LatLng) => void;
  skipMoves?: { current: number };
  sheetFrac?: number;
  visibleCenter?: boolean;
}) {
  const map = useMap();
  const onSpotRef = useRef(onSpot);
  onSpotRef.current = onSpot;
  const skipRef = useRef(skipMoves);
  skipRef.current = skipMoves;
  const sheetFracRef = useRef(sheetFrac);
  sheetFracRef.current = sheetFrac;
  useEffect(() => {
    const send = (force = false) => {
      const skip = skipRef.current;
      if (!force && skip && skip.current > 0) {
        skip.current -= 1;
        return;
      }
      if (visibleCenter) {
        onSpotRef.current(visibleCenterLatLng(map, sheetFracRef.current));
        return;
      }
      const c = map.getCenter();
      onSpotRef.current({ lat: c.lat, lng: c.lng });
    };
    send(true);
    const onEnd = () => send();
    map.on("moveend", onEnd);
    map.on("zoomend", onEnd);
    map.on("dragend", onEnd);
    return () => {
      map.off("moveend", onEnd);
      map.off("zoomend", onEnd);
      map.off("dragend", onEnd);
    };
  }, [map, visibleCenter]);
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
  onRecenter,
  recenterToken,
  frameTaxi = false,
  frameFerry = false,
  framePlaces = [],
  taxiFocus = null,
  dev = false,
  pinMode = "off",
  showAll = false,
  onPinCycle,
  onShowAll,
  onSpot,
  route = null,
  onRouteStop,
  sheetFrac = 0,
}: {
  origin: LatLng;
  user: LatLng | null;
  places: NearbyPlace[];
  selectedId: string | null;
  onSelect: (place: NearbyPlace) => void;
  onSelectGroup?: (places: NearbyPlace[]) => void;
  onRecenter: () => void;
  recenterToken: number;
  frameTaxi?: boolean;
  frameFerry?: boolean;
  framePlaces?: NearbyPlace[];
  taxiFocus?: { lat: number; lng: number; token: number } | null;
  dev?: boolean;
  pinMode?: DevPinMode;
  showAll?: boolean;
  onPinCycle?: (mode: DevPinMode, spot: LatLng | null) => void;
  onShowAll?: (on: boolean) => void;
  onSpot?: (spot: LatLng) => void;
  route?: RouteOverlay | null;
  onRouteStop?: (seq: number) => void;
  sheetFrac?: number;
}) {
  const [zoom, setZoom] = useState(START_ZOOM);
  const [viewTick, setViewTick] = useState(0);
  const mapRef = useRef<L.Map | null>(null);
  const skipSpot = useRef(0);
  const [congestionOn, setCongestionOn] = useState(false);
  const [congestionBusy, setCongestionBusy] = useState(false);
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

  return (
    <div className="home-map">
      <MapContainer
        center={[origin.lat, origin.lng]}
        zoom={START_ZOOM}
        minZoom={9}
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
        attributionControl={true}
        zoomControl={false}
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={22}
          maxNativeZoom={19}
          keepBuffer={6}
          updateWhenIdle={true}
          crossOrigin="anonymous"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <MapHandle onMap={takeMap} />
        {dev && congestionOn ? <CongestionFx on onBusy={setCongestionBusy} /> : null}
        {showAll ? <SpotWatch onSpot={bumpView} /> : null}
        {pinMode === "follow" && onSpot ? (
          <SpotWatch onSpot={onSpot} sheetFrac={sheetFrac} visibleCenter />
        ) : null}
        <MapFx
          origin={origin}
          token={recenterToken}
          onZoom={setZoom}
          frameTaxi={frameTaxi}
          frameFerry={frameFerry}
          framePlaces={framePlaces}
          focus={taxiFocus}
          skipSpot={skipSpot}
          holdCenter={pinMode !== "off"}
          routeLock={Boolean(route)}
          sheetFrac={sheetFrac}
        />
        {user ? <Marker position={[user.lat, user.lng]} icon={USER_ICON} interactive={false} zIndexOffset={800} /> : null}
        {route ? (
          <RouteLayer {...route} sheetFrac={sheetFrac} onStop={route.onStop ?? onRouteStop} />
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
      {pinMode === "follow" ? <div className="dev-crosshair" aria-hidden>📍</div> : null}
      <div className="map-tools">
        <button
          type="button"
          className={`recenter${pinMode !== "off" ? " is-on" : ""}${pinMode === "locked" ? " is-locked" : ""}`}
          aria-label={pinMode === "locked" ? "Unlock" : "Pin"}
          aria-pressed={pinMode !== "off"}
          onClick={() => {
            const map = mapRef.current;
            const sample = map ? visibleCenterLatLng(map, sheetFrac) : null;
            if (pinMode === "off") {
              onPinCycle?.("follow", sample);
              return;
            }
            if (pinMode === "follow") {
              onPinCycle?.("locked", sample);
              return;
            }
            onPinCycle?.("off", null);
          }}
        >
          {pinMode === "locked" ? <IconLock className="icon-md" /> : <IconPinpoint className="icon-md" />}
        </button>
        {dev ? (
          <button
            type="button"
            className={`recenter${showAll ? " is-on" : ""}`}
            aria-label="All"
            aria-pressed={showAll}
            onClick={() => onShowAll?.(!showAll)}
          >
            <IconSignal className="icon-md" />
          </button>
        ) : null}
        {dev ? (
          <button
            type="button"
            className={`recenter${congestionOn ? " is-on" : ""}${congestionBusy ? " is-busy" : ""}`}
            aria-label="Traffic"
            aria-pressed={congestionOn}
            aria-busy={congestionBusy}
            onClick={() => setCongestionOn((v) => !v)}
          >
            <IconTraffic className="icon-md" />
          </button>
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
