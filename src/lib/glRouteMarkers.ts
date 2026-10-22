import type { Map as LeafletMap } from "leaflet";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";
import { addIaRouteOverlayLayer } from "@/lib/glRouteOrder";
import type { LatLng } from "@/lib/geo";
import type { Mode } from "@/lib/types";

export const IA_ROUTE_VEHICLES_SOURCE = "ia-route-vehicles";
export const IA_ROUTE_VEHICLES_LAYER = "ia-route-vehicles-layer";
export const IA_ROUTE_SIM_VEHICLES_SOURCE = "ia-route-sim-vehicles";
export const IA_ROUTE_SIM_VEHICLES_LAYER = "ia-route-sim-vehicles-layer";
export const IA_ROUTE_CHEVRONS_SOURCE = "ia-route-chevrons";
export const IA_ROUTE_CHEVRONS_LAYER = "ia-route-chevrons-layer";
export const IA_ROUTE_FLAGS_SOURCE = "ia-route-flags";
export const IA_ROUTE_FLAGS_LAYER = "ia-route-flags-layer";
export const IA_ROUTE_ESTIMATES_SOURCE = "ia-route-estimates";
export const IA_ROUTE_ESTIMATES_LAYER = "ia-route-estimates-layer";

const IMG_CHEVRON_PREFIX = "ia-chevron-v2-";
const IMG_FLAG = "ia-flag";
const IMG_VEH_PREFIX = "ia-veh-";

export type IaRouteVehicleMark = LatLng & {
  id: string;
  mode: Mode;
  color: string;
  ink: string;
  dim?: boolean;
};

export type IaRouteChevronMark = LatLng & {
  id: string;
  color: string;
  /** Travel heading degrees (0 = north); GL rotates chevron like Leaflet deg - 90. */
  deg: number;
};

export type IaRouteFlagMark = LatLng & { id: string };
export type IaRouteEstimateMark = LatLng & { id: string };

export type IaRouteLiveVehiclesSpec = {
  vehicles: IaRouteVehicleMark[];
};

export type IaRouteSimMarkersSpec = {
  vehicles: IaRouteVehicleMark[];
  chevrons: IaRouteChevronMark[];
  flags: IaRouteFlagMark[];
  estimates: IaRouteEstimateMark[];
};

const desiredLiveByMap = new WeakMap<LeafletMap, IaRouteLiveVehiclesSpec | null>();
const desiredSimByMap = new WeakMap<LeafletMap, IaRouteSimMarkersSpec | null>();
/** Live vehicle contributions keyed by marker id (VehicleMarker instances). */
const liveBagByMap = new WeakMap<LeafletMap, Map<string, IaRouteVehicleMark>>();

const pendingImages = new Set<string>();
const htmlImageCache = new Map<string, HTMLImageElement | Promise<HTMLImageElement>>();

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function paintColor(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

function removeLayerSource(gl: MaplibreMap, layerId: string, sourceId: string) {
  try {
    if (gl.getLayer(layerId)) gl.removeLayer(layerId);
  } catch {
    /* ignore */
  }
  try {
    if (gl.getSource(sourceId)) gl.removeSource(sourceId);
  } catch {
    /* ignore */
  }
}

function setSourceData(gl: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const existing = gl.getSource(sourceId) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else gl.addSource(sourceId, { type: "geojson", data });
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

function vehicleImageId(mode: Mode, color: string, ink: string, dim: boolean) {
  return `${IMG_VEH_PREFIX}${mode}-${paintColor(color)}-${paintColor(ink)}-${dim ? "dim" : "ok"}`;
}

function chevronImageId(color: string) {
  return `${IMG_CHEVRON_PREFIX}${paintColor(color)}`;
}

function strokeGlyph(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  size: number,
  ink: string,
) {
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 30, size / 30);
  ctx.translate(-12, -12);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(path);
  ctx.restore();
}

function drawModeGlyph(
  ctx: CanvasRenderingContext2D,
  mode: Mode,
  size: number,
  ink: string,
  busImg: HTMLImageElement | null,
  minibusImg: HTMLImageElement | null,
) {
  const pad = size * 0.18;
  const glyph = size - pad * 2;
  if (mode === "bus" && busImg) {
    ctx.drawImage(busImg, pad, pad, glyph, glyph);
    return;
  }
  if (mode === "minibus" && minibusImg) {
    ctx.drawImage(minibusImg, pad, pad, glyph, glyph);
    return;
  }
  if (mode === "ferry") {
    // White disc + blue boat (matches .ferry-mark CSS intent).
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, glyph * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#1E6BB8";
    ctx.beginPath();
    ctx.moveTo(size * 0.28, size * 0.55);
    ctx.lineTo(size * 0.72, size * 0.55);
    ctx.lineTo(size * 0.66, size * 0.68);
    ctx.lineTo(size * 0.34, size * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(size * 0.38, size * 0.36, size * 0.24, size * 0.2);
    return;
  }
  const path = new Path2D();
  if (mode === "mtr") {
    path.rect(5, 3, 14, 14);
    path.moveTo(8, 17);
    path.lineTo(6, 21);
    path.moveTo(16, 17);
    path.lineTo(18, 21);
    path.moveTo(8, 10);
    path.lineTo(16, 10);
  } else if (mode === "tram") {
    path.moveTo(7, 6);
    path.lineTo(17, 6);
    path.moveTo(8, 6);
    path.lineTo(8, 9);
    path.moveTo(16, 6);
    path.lineTo(16, 9);
    path.rect(4, 9, 16, 9);
    path.moveTo(7, 18);
    path.lineTo(7, 20);
    path.moveTo(17, 18);
    path.lineTo(17, 20);
    path.moveTo(4, 13);
    path.lineTo(20, 13);
  } else if (mode === "taxi") {
    path.moveTo(4, 13);
    path.lineTo(6, 8);
    path.lineTo(18, 8);
    path.lineTo(20, 13);
    path.lineTo(20, 18);
    path.lineTo(4, 18);
    path.closePath();
    path.moveTo(9, 8);
    path.lineTo(9, 6);
    path.lineTo(15, 6);
    path.lineTo(15, 8);
    path.moveTo(6, 16);
    path.lineTo(6, 18);
    path.moveTo(18, 16);
    path.lineTo(18, 18);
  } else {
    // Fallback bus body outline when SVG not ready.
    path.rect(6, 5, 12, 14);
  }
  strokeGlyph(ctx, path, size, ink);
}

function makeVehicleBitmap(
  mode: Mode,
  color: string,
  ink: string,
  dim: boolean,
  busImg: HTMLImageElement | null,
  minibusImg: HTMLImageElement | null,
): ImageData {
  const size = 60;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const bg = paintColor(color);
  const fg = paintColor(ink);
  // Rounded pin + white ring (matches .veh-pin).
  const r = 18;
  const x = 6;
  const y = 6;
  const w = 48;
  const h = 48;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  drawModeGlyph(ctx, mode, size, fg, busImg, minibusImg);
  if (dim) {
    const raw = ctx.getImageData(0, 0, size, size);
    const d = raw.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(raw, 0, 0);
    ctx.globalAlpha = 0.9;
    // already baked grayscale; opacity handled by icon-opacity below
  }
  return ctx.getImageData(0, 0, size, size);
}

function makeChevronBitmap(color: string): ImageData {
  // Match old Leaflet SVG: viewBox 0 0 12 12, points 1.5,1 11,6 1.5,11 @ 14px CSS
  // with stroke #fff 2.4 and paint-order stroke fill. Author at 2x for pixelRatio:2.
  const size = 28;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const s = size / 12; // scale 12-unit viewBox → canvas
  ctx.beginPath();
  ctx.moveTo(1.5 * s, 1 * s);
  ctx.lineTo(11 * s, 6 * s);
  ctx.lineTo(1.5 * s, 11 * s);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.4 * s;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = paintColor(color);
  // stroke under fill like SVG paint-order: stroke fill (outer white rim stays visible)
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function makeFlagBitmap(): ImageData {
  const size = 36;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "28px serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 2;
  // Anchor roughly matches Leaflet iconAnchor [4, 16] on 18×18 → bottom-leftish.
  ctx.fillText("🚩", 2, size - 2);
  return ctx.getImageData(0, 0, size, size);
}

function scheduleImage(
  gl: MaplibreMap,
  id: string,
  factory: () => Promise<ImageData | ImageBitmap>,
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

function ensureFlagImage(gl: MaplibreMap, onReady: () => void) {
  if (gl.hasImage(IMG_FLAG)) return true;
  scheduleImage(gl, IMG_FLAG, async () => makeFlagBitmap(), onReady);
  return false;
}

function ensureChevronImage(gl: MaplibreMap, color: string, onReady: () => void) {
  const id = chevronImageId(color);
  if (gl.hasImage(id)) return true;
  scheduleImage(gl, id, async () => makeChevronBitmap(color), onReady);
  return false;
}

function ensureVehicleImage(
  gl: MaplibreMap,
  mark: Pick<IaRouteVehicleMark, "mode" | "color" | "ink" | "dim">,
  onReady: () => void,
) {
  const id = vehicleImageId(mark.mode, mark.color, mark.ink, Boolean(mark.dim));
  if (gl.hasImage(id)) return true;
  scheduleImage(
    gl,
    id,
    async () => {
      const [busImg, minibusImg] = await Promise.all([
        loadHtmlImage("/icons/bus_white.svg").catch(() => null),
        loadHtmlImage("/icons/minibus_white.svg").catch(() => null),
      ]);
      return makeVehicleBitmap(
        mark.mode,
        mark.color,
        mark.ink,
        Boolean(mark.dim),
        busImg,
        minibusImg,
      );
    },
    onReady,
  );
  return false;
}

function vehicleFeatures(marks: IaRouteVehicleMark[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: marks.map((m) => ({
      type: "Feature" as const,
      properties: {
        id: m.id,
        icon: vehicleImageId(m.mode, m.color, m.ink, Boolean(m.dim)),
        opacity: m.dim ? 0.9 : 1,
      },
      geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
    })),
  };
}

function chevronFeatures(marks: IaRouteChevronMark[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: marks.map((m) => ({
      type: "Feature" as const,
      properties: {
        id: m.id,
        icon: chevronImageId(m.color),
        // Match Leaflet: transform rotate(deg - 90) on an east-pointing triangle.
        rotate: m.deg - 90,
      },
      geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
    })),
  };
}

function pointFeatures(marks: Array<LatLng & { id: string }>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: marks.map((m) => ({
      type: "Feature" as const,
      properties: { id: m.id },
      geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
    })),
  };
}

function estimatePaint(): { fill: string; stroke: string } {
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "dark";
  return dark
    ? { fill: "#ffe14d", stroke: "#111111" }
    : { fill: "#ff8a00", stroke: "#1a1208" };
}

function ensureSymbolLayer(
  gl: MaplibreMap,
  layerId: string,
  sourceId: string,
  opts: {
    size: number;
    anchor?: "center" | "bottom-left";
    rotate?: boolean;
    opacityProp?: boolean;
  },
) {
  addIaRouteOverlayLayer(gl, {
    id: layerId,
    type: "symbol",
    source: sourceId,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": opts.size,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": opts.anchor ?? "center",
      ...(opts.rotate
        ? {
            "icon-rotate": ["get", "rotate"],
            "icon-rotation-alignment": "map" as const,
          }
        : {}),
    },
    paint: {
      ...(opts.opacityProp ? { "icon-opacity": ["get", "opacity"] } : {}),
    },
  });
}

function retryEnsure(map: LeafletMap | null, kind: "live" | "sim") {
  if (!map) return;
  if (kind === "live") ensureIaRouteLiveVehiclesForMap(map);
  else ensureIaRouteSimMarkersForMap(map);
}

/** Live GPS / ETA vehicle glyphs (VehicleMarker). */
export function ensureIaRouteLiveVehicles(gl: MaplibreMap, spec: IaRouteLiveVehiclesSpec | null, map?: LeafletMap) {
  try {
    if (!spec || !spec.vehicles.length) {
      removeLayerSource(gl, IA_ROUTE_VEHICLES_LAYER, IA_ROUTE_VEHICLES_SOURCE);
      return;
    }
    const onReady = () => retryEnsure(map ?? null, "live");
    for (const v of spec.vehicles) ensureVehicleImage(gl, v, onReady);
    setSourceData(gl, IA_ROUTE_VEHICLES_SOURCE, vehicleFeatures(spec.vehicles));
    // Images authored at 2×; icon-size 1 → ~30px pin (matches .veh-pin).
    ensureSymbolLayer(gl, IA_ROUTE_VEHICLES_LAYER, IA_ROUTE_VEHICLES_SOURCE, {
      size: 1,
      opacityProp: true,
    });
  } catch {
    /* style not ready */
  }
}

/** Sim band buses + chevrons + flags + estimate dots. */
export function ensureIaRouteSimMarkers(gl: MaplibreMap, spec: IaRouteSimMarkersSpec | null, map?: LeafletMap) {
  try {
    if (!spec) {
      removeIaRouteSimMarkers(gl);
      return;
    }
    const onReady = () => retryEnsure(map ?? null, "sim");
    for (const v of spec.vehicles) ensureVehicleImage(gl, v, onReady);
    const colors = new Set(spec.chevrons.map((c) => c.color));
    for (const c of colors) ensureChevronImage(gl, c, onReady);
    if (spec.flags.length) ensureFlagImage(gl, onReady);

    setSourceData(gl, IA_ROUTE_CHEVRONS_SOURCE, chevronFeatures(spec.chevrons));
    setSourceData(gl, IA_ROUTE_SIM_VEHICLES_SOURCE, vehicleFeatures(spec.vehicles));
    setSourceData(
      gl,
      IA_ROUTE_FLAGS_SOURCE,
      {
        type: "FeatureCollection",
        features: spec.flags.map((m) => ({
          type: "Feature" as const,
          properties: { id: m.id, icon: IMG_FLAG },
          geometry: { type: "Point" as const, coordinates: [m.lng, m.lat] },
        })),
      },
    );
    setSourceData(gl, IA_ROUTE_ESTIMATES_SOURCE, pointFeatures(spec.estimates));

    ensureSymbolLayer(gl, IA_ROUTE_CHEVRONS_LAYER, IA_ROUTE_CHEVRONS_SOURCE, {
      size: 1,
      rotate: true,
    });
    ensureSymbolLayer(gl, IA_ROUTE_SIM_VEHICLES_LAYER, IA_ROUTE_SIM_VEHICLES_SOURCE, {
      size: 1,
      opacityProp: true,
    });
    ensureSymbolLayer(gl, IA_ROUTE_FLAGS_LAYER, IA_ROUTE_FLAGS_SOURCE, {
      size: 1,
      anchor: "bottom-left",
    });

    const est = estimatePaint();
    addIaRouteOverlayLayer(gl, {
      id: IA_ROUTE_ESTIMATES_LAYER,
      type: "circle",
      source: IA_ROUTE_ESTIMATES_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": est.fill,
        "circle-stroke-width": 2,
        "circle-stroke-color": est.stroke,
        "circle-opacity": 1,
      },
    });
    if (gl.getLayer(IA_ROUTE_ESTIMATES_LAYER)) {
      gl.setPaintProperty(IA_ROUTE_ESTIMATES_LAYER, "circle-color", est.fill);
      gl.setPaintProperty(IA_ROUTE_ESTIMATES_LAYER, "circle-stroke-color", est.stroke);
    }
  } catch {
    /* style not ready */
  }
}

export function removeIaRouteSimMarkers(gl: MaplibreMap) {
  removeLayerSource(gl, IA_ROUTE_ESTIMATES_LAYER, IA_ROUTE_ESTIMATES_SOURCE);
  removeLayerSource(gl, IA_ROUTE_FLAGS_LAYER, IA_ROUTE_FLAGS_SOURCE);
  removeLayerSource(gl, IA_ROUTE_SIM_VEHICLES_LAYER, IA_ROUTE_SIM_VEHICLES_SOURCE);
  removeLayerSource(gl, IA_ROUTE_CHEVRONS_LAYER, IA_ROUTE_CHEVRONS_SOURCE);
}

export function setIaRouteLiveVehicles(map: LeafletMap, spec: IaRouteLiveVehiclesSpec | null) {
  desiredLiveByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteLiveVehicles(gl, spec, map);
}

/** Upsert one live vehicle (rAF VehicleMarker); null removes. */
export function upsertIaLiveVehicle(map: LeafletMap, id: string, mark: IaRouteVehicleMark | null) {
  let bag = liveBagByMap.get(map);
  if (!bag) {
    bag = new Map();
    liveBagByMap.set(map, bag);
  }
  if (mark) bag.set(id, mark);
  else bag.delete(id);
  const vehicles = [...bag.values()];
  setIaRouteLiveVehicles(map, vehicles.length ? { vehicles } : null);
}

export function clearIaRouteLiveVehicles(map: LeafletMap) {
  liveBagByMap.delete(map);
  desiredLiveByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeLayerSource(gl, IA_ROUTE_VEHICLES_LAYER, IA_ROUTE_VEHICLES_SOURCE);
}

export function setIaRouteSimMarkers(map: LeafletMap, spec: IaRouteSimMarkersSpec | null) {
  desiredSimByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteSimMarkers(gl, spec, map);
}

export function ensureIaRouteLiveVehiclesForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteLiveVehicles(gl, desiredLiveByMap.get(map) ?? null, map);
}

export function ensureIaRouteSimMarkersForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteSimMarkers(gl, desiredSimByMap.get(map) ?? null, map);
}

export function clearIaRouteSimMarkers(map: LeafletMap) {
  desiredSimByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeIaRouteSimMarkers(gl);
}
