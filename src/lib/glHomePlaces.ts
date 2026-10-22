import type { Map as LeafletMap } from "leaflet";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";
import { mtrMarkerHtml, taxiMarkerHtml, tramMarkerHtml } from "@/lib/logos";
import type { NearbyPlace } from "@/lib/types";

export const IA_HOME_STOPS_SOURCE = "ia-home-stops";
export const IA_HOME_STOPS_LAYER = "ia-home-stops-layer";
export const IA_HOME_LOGOS_SOURCE = "ia-home-logos";
export const IA_HOME_LOGOS_LAYER = "ia-home-logos-layer";
export const IA_HOME_CLUSTERS_SOURCE = "ia-home-clusters";
export const IA_HOME_CLUSTERS_LAYER = "ia-home-clusters-layer";
export const IA_HOME_USER_SOURCE = "ia-home-user";
export const IA_HOME_USER_LAYER = "ia-home-user-layer";

const IMG_PREFIX = "ia-home-";
const IMG_CLUSTER_PREFIX = `${IMG_PREFIX}cluster-`;

export type IaHomeCluster = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
};

export type IaHomePlacesSpec = {
  pins: NearbyPlace[];
  clusters: IaHomeCluster[];
  selectedId: string | null;
  user: { lat: number; lng: number } | null;
};

const desiredByMap = new WeakMap<LeafletMap, IaHomePlacesSpec | null>();
const pendingImages = new Set<string>();
const htmlImageCache = new Map<string, HTMLImageElement | Promise<HTMLImageElement>>();

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function paintColor(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

function setSourceData(gl: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const existing = gl.getSource(sourceId) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else gl.addSource(sourceId, { type: "geojson", data });
}

function removeLayerSource(gl: MaplibreMap, layerId: string, sourceId?: string) {
  try {
    if (gl.getLayer(layerId)) gl.removeLayer(layerId);
  } catch {
    /* ignore */
  }
  if (!sourceId) return;
  try {
    if (gl.getSource(sourceId)) gl.removeSource(sourceId);
  } catch {
    /* ignore */
  }
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  const hit = htmlImageCache.get(url);
  if (hit instanceof HTMLImageElement) return Promise.resolve(hit);
  if (hit) return hit;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      htmlImageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      htmlImageCache.delete(url);
      reject(new Error(`image load failed: ${url}`));
    };
    img.src = url;
  });
  htmlImageCache.set(url, pending);
  return pending;
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function rasterizeSvg(svg: string, cssW: number, cssH: number): Promise<ImageData> {
  const pr = 2;
  const w = Math.max(1, Math.round(cssW * pr));
  const h = Math.max(1, Math.round(cssH * pr));
  const img = await loadHtmlImage(svgDataUrl(svg));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function pierSvg(selected: boolean): string {
  // Matches .ferry-mark / pier logo-hit: white disc + blue boat.
  const ring = selected
    ? `<circle cx="50" cy="50" r="46" fill="none" stroke="#111111" stroke-width="6"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <circle cx="50" cy="50" r="48" fill="#ffffff"/>
    ${ring}
    <path fill="#1E6BB8" d="M28 55 L72 55 L66 68 L34 68 Z"/>
    <rect x="38" y="36" width="24" height="20" rx="2" fill="#1E6BB8"/>
  </svg>`;
}

function logoImageId(place: NearbyPlace, selected: boolean): string {
  const sel = selected ? "on" : "off";
  if (place.kind === "station") {
    const colors = (place.lineColors?.length ? place.lineColors : [place.color])
      .map(paintColor)
      .join("_");
    return `${IMG_PREFIX}mtr-${colors}-${sel}`;
  }
  if (place.kind === "tram") return `${IMG_PREFIX}tram-${sel}`;
  if (place.kind === "taxi") return `${IMG_PREFIX}taxi-${sel}`;
  if (place.kind === "pier") return `${IMG_PREFIX}pier-${sel}`;
  return `${IMG_PREFIX}stop`;
}

function logoCssSize(place: NearbyPlace, selected: boolean): { w: number; h: number } {
  if (place.kind === "station") return selected ? { w: 46, h: 40 } : { w: 40, h: 35 };
  if (place.kind === "tram") {
    const n = selected ? 32 : 29;
    return { w: n, h: n };
  }
  if (place.kind === "taxi") return selected ? { w: 36, h: 21 } : { w: 34, h: 20 };
  if (place.kind === "pier") {
    const n = selected ? 36 : 30;
    return { w: n, h: n };
  }
  return { w: 12, h: 12 };
}

function logoSvg(place: NearbyPlace, selected: boolean): string {
  if (place.kind === "station") {
    const colors = place.lineColors?.length ? place.lineColors : [place.color];
    return mtrMarkerHtml(colors, selected);
  }
  if (place.kind === "tram") return tramMarkerHtml(selected);
  if (place.kind === "taxi") return taxiMarkerHtml(selected);
  if (place.kind === "pier") return pierSvg(selected);
  return "";
}

function scheduleImage(
  gl: MaplibreMap,
  id: string,
  factory: () => Promise<ImageData>,
  onReady: () => void,
) {
  if (gl.hasImage(id) || pendingImages.has(id)) return;
  pendingImages.add(id);
  factory()
    .then((img) => {
      pendingImages.delete(id);
      try {
        if (!gl.hasImage(id)) gl.addImage(id, img, { pixelRatio: 2 });
      } catch {
        /* style torn down */
      }
      onReady();
    })
    .catch(() => {
      pendingImages.delete(id);
    });
}

function ensureLogoImage(
  gl: MaplibreMap,
  place: NearbyPlace,
  selected: boolean,
  onReady: () => void,
): boolean {
  if (place.kind === "stop") return true;
  const id = logoImageId(place, selected);
  if (gl.hasImage(id)) return true;
  const { w, h } = logoCssSize(place, selected);
  const svg = logoSvg(place, selected);
  if (!svg) return true;
  scheduleImage(gl, id, () => rasterizeSvg(svg, w, h), onReady);
  return false;
}

function addLayerTop(
  gl: MaplibreMap,
  layer: Parameters<MaplibreMap["addLayer"]>[0],
) {
  if (gl.getLayer(layer.id)) return;
  gl.addLayer(layer);
}

function stopFeatures(pins: NearbyPlace[], selectedId: string | null): GeoJSON.FeatureCollection {
  const stops = pins.filter((p) => p.kind === "stop");
  return {
    type: "FeatureCollection",
    features: stops.map((p) => ({
      type: "Feature" as const,
      properties: {
        id: p.id,
        color: paintColor(p.color),
        selected: selectedId === p.id ? 1 : 0,
      },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    })),
  };
}

function logoFeatures(pins: NearbyPlace[], selectedId: string | null): GeoJSON.FeatureCollection {
  const logos = pins.filter((p) => p.kind !== "stop");
  return {
    type: "FeatureCollection",
    features: logos.map((p) => {
      const selected = selectedId === p.id;
      return {
        type: "Feature" as const,
        properties: {
          id: p.id,
          icon: logoImageId(p, selected),
        },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      };
    }),
  };
}

function clusterImageId(count: number, color: string) {
  return `${IMG_CLUSTER_PREFIX}${paintColor(color)}-${count}`;
}

function makeClusterBitmap(count: number, color: string): ImageData {
  const size = 44; // 22 CSS px @ 2×
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = 14;
  const x = 4;
  const y = 4;
  const w = 36;
  const h = 36;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = paintColor(color);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), size / 2, size / 2 + 1);
  return ctx.getImageData(0, 0, size, size);
}

function ensureClusterImage(
  gl: MaplibreMap,
  cluster: IaHomeCluster,
  onReady: () => void,
): boolean {
  const id = clusterImageId(cluster.count, cluster.color);
  if (gl.hasImage(id)) return true;
  scheduleImage(gl, id, async () => makeClusterBitmap(cluster.count, cluster.color), onReady);
  return false;
}

function clusterFeatures(clusters: IaHomeCluster[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: clusters.map((c) => ({
      type: "Feature" as const,
      properties: {
        id: c.key,
        icon: clusterImageId(c.count, c.color),
      },
      geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
    })),
  };
}

function userFeatures(user: { lat: number; lng: number } | null): GeoJSON.FeatureCollection {
  if (!user) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [user.lng, user.lat] },
      },
    ],
  };
}

function removeIaHomePlaces(gl: MaplibreMap) {
  removeLayerSource(gl, IA_HOME_CLUSTERS_LAYER, IA_HOME_CLUSTERS_SOURCE);
  removeLayerSource(gl, IA_HOME_LOGOS_LAYER, IA_HOME_LOGOS_SOURCE);
  removeLayerSource(gl, IA_HOME_STOPS_LAYER, IA_HOME_STOPS_SOURCE);
  removeLayerSource(gl, IA_HOME_USER_LAYER, IA_HOME_USER_SOURCE);
}

function retryEnsure(map: LeafletMap | null) {
  if (!map) return;
  ensureIaHomePlacesForMap(map);
}

/** Catalog logos / stop dots / clusters / user pin on the existing MapLibre basemap. */
export function ensureIaHomePlaces(gl: MaplibreMap, spec: IaHomePlacesSpec | null, map?: LeafletMap) {
  try {
    if (!spec) {
      removeIaHomePlaces(gl);
      return;
    }

    const onReady = () => retryEnsure(map ?? null);
    for (const p of spec.pins) {
      if (p.kind === "stop") continue;
      ensureLogoImage(gl, p, spec.selectedId === p.id, onReady);
    }
    for (const c of spec.clusters) ensureClusterImage(gl, c, onReady);

    setSourceData(gl, IA_HOME_STOPS_SOURCE, stopFeatures(spec.pins, spec.selectedId));
    setSourceData(gl, IA_HOME_LOGOS_SOURCE, logoFeatures(spec.pins, spec.selectedId));
    setSourceData(gl, IA_HOME_CLUSTERS_SOURCE, clusterFeatures(spec.clusters));
    setSourceData(gl, IA_HOME_USER_SOURCE, userFeatures(spec.user));

    addLayerTop(gl, {
      id: IA_HOME_STOPS_LAYER,
      type: "circle",
      source: IA_HOME_STOPS_SOURCE,
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 6, 5],
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 1,
      },
    });

    addLayerTop(gl, {
      id: IA_HOME_LOGOS_LAYER,
      type: "symbol",
      source: IA_HOME_LOGOS_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
      paint: { "icon-opacity": 1 },
    });

    addLayerTop(gl, {
      id: IA_HOME_CLUSTERS_LAYER,
      type: "symbol",
      source: IA_HOME_CLUSTERS_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
      paint: { "icon-opacity": 1 },
    });

    addLayerTop(gl, {
      id: IA_HOME_USER_LAYER,
      type: "circle",
      source: IA_HOME_USER_SOURCE,
      paint: {
        "circle-radius": 6,
        "circle-color": "#4ea2ff",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0b57d0",
        "circle-opacity": 1,
      },
    });
    promoteIaHomeUserLayer(gl);
  } catch {
    /* style not ready / mid-swap */
  }
}

export function setIaHomePlaces(map: LeafletMap, spec: IaHomePlacesSpec | null) {
  desiredByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaHomePlaces(gl, spec, map);
}

export function ensureIaHomePlacesForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaHomePlaces(gl, desiredByMap.get(map) ?? null, map);
}

export function clearIaHomePlaces(map: LeafletMap) {
  desiredByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeIaHomePlaces(gl);
}

/** Keep GPS pin above route overlays after they are (re)added. */
export function promoteIaHomeUserLayer(gl: MaplibreMap) {
  try {
    if (gl.getLayer(IA_HOME_USER_LAYER)) gl.moveLayer(IA_HOME_USER_LAYER);
  } catch {
    /* ignore */
  }
}
