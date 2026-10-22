import type { Map as LeafletMap } from "leaflet";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";
import { addIaRouteOverlayLayer } from "@/lib/glRouteOrder";
import type { LatLng } from "@/lib/geo";

export const IA_ROUTE_STOPS_SOURCE = "ia-route-stops";
export const IA_ROUTE_STOPS_LAYER = "ia-route-stops-layer";
export const IA_ROUTE_FOCUS_SOURCE = "ia-route-focus";
export const IA_ROUTE_FOCUS_LAYER = "ia-route-focus-layer";

export type IaRouteStopDot = LatLng & { seq?: number };

export type IaRouteStopsSpec = {
  stops: IaRouteStopDot[];
  focus: LatLng | null;
  color: string;
};

const desiredByMap = new WeakMap<LeafletMap, IaRouteStopsSpec | null>();

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function pointsCollection(points: LatLng[]): GeoJSON.FeatureCollection {
  if (!points.length) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      properties: { seq: "seq" in p && typeof (p as IaRouteStopDot).seq === "number" ? (p as IaRouteStopDot).seq : i },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

function setSourceData(gl: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const existing = gl.getSource(sourceId) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else gl.addSource(sourceId, { type: "geojson", data });
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

/** Add or refresh stop dots + focus ring above the route line. */
export function ensureIaRouteStops(gl: MaplibreMap, spec: IaRouteStopsSpec | null) {
  try {
    if (!spec) {
      removeIaRouteStops(gl);
      return;
    }

    const color = spec.color;
    setSourceData(gl, IA_ROUTE_STOPS_SOURCE, pointsCollection(spec.stops));
    setSourceData(
      gl,
      IA_ROUTE_FOCUS_SOURCE,
      spec.focus ? pointsCollection([spec.focus]) : emptyFeatureCollection(),
    );

    addIaRouteOverlayLayer(gl, {
      id: IA_ROUTE_STOPS_LAYER,
      type: "circle",
      source: IA_ROUTE_STOPS_SOURCE,
      paint: {
        "circle-radius": 4,
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": color,
        "circle-opacity": 1,
      },
    });
    if (gl.getLayer(IA_ROUTE_STOPS_LAYER)) {
      gl.setPaintProperty(IA_ROUTE_STOPS_LAYER, "circle-stroke-color", color);
    }

    addIaRouteOverlayLayer(gl, {
      id: IA_ROUTE_FOCUS_LAYER,
      type: "circle",
      source: IA_ROUTE_FOCUS_SOURCE,
      paint: {
        "circle-radius": 9,
        "circle-color": color,
        "circle-stroke-width": 2,
        "circle-stroke-color": color,
        "circle-opacity": 1,
      },
    });
    if (gl.getLayer(IA_ROUTE_FOCUS_LAYER)) {
      gl.setPaintProperty(IA_ROUTE_FOCUS_LAYER, "circle-color", color);
      gl.setPaintProperty(IA_ROUTE_FOCUS_LAYER, "circle-stroke-color", color);
    }
  } catch {
    /* style not ready / mid-swap */
  }
}

export function removeIaRouteStops(gl: MaplibreMap) {
  removeLayerSource(gl, IA_ROUTE_FOCUS_LAYER, IA_ROUTE_FOCUS_SOURCE);
  removeLayerSource(gl, IA_ROUTE_STOPS_LAYER, IA_ROUTE_STOPS_SOURCE);
}

export function setIaRouteStops(map: LeafletMap, spec: IaRouteStopsSpec | null) {
  desiredByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteStops(gl, spec);
}

export function ensureIaRouteStopsForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteStops(gl, desiredByMap.get(map) ?? null);
}

export function clearIaRouteStops(map: LeafletMap) {
  desiredByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeIaRouteStops(gl);
}
