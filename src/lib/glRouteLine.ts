import type { Map as LeafletMap } from "leaflet";
import type {
  GeoJSONSource,
  LineLayerSpecification,
  Map as MaplibreMap,
} from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";
import { promoteIaHomeUserLayer } from "@/lib/glHomePlaces";
import { firstIaRouteOverlayLayerId } from "@/lib/glRouteOrder";
import type { LatLng } from "@/lib/geo";

export const IA_ROUTE_SOURCE = "ia-route-line";
export const IA_ROUTE_LAYER = "ia-route-line-layer";

export type IaRouteLineSpec = {
  points: LatLng[];
  color: string;
  /** Ferry: thinner + dashed (matches former Leaflet Polyline). */
  water: boolean;
};

/** Last desired route line per Leaflet map — survives Bright↔PMTiles setStyle. */
const desiredByMap = new WeakMap<LeafletMap, IaRouteLineSpec | null>();

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function lineFeatureCollection(points: LatLng[]): GeoJSON.FeatureCollection {
  if (points.length < 2) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
      },
    ],
  };
}

function paintFor(spec: IaRouteLineSpec): LineLayerSpecification["paint"] {
  return {
    "line-color": spec.color,
    "line-width": spec.water ? 4 : 5,
    "line-opacity": 0.9,
    ...(spec.water ? { "line-dasharray": [2, 1.6] as [number, number] } : {}),
  };
}

/** Add or refresh the route line source/layer on a MapLibre map. */
export function ensureIaRouteLine(gl: MaplibreMap, spec: IaRouteLineSpec | null) {
  try {
    if (!spec || spec.points.length < 2) {
      removeIaRouteLine(gl);
      return;
    }

    const data = lineFeatureCollection(spec.points);
    const existing = gl.getSource(IA_ROUTE_SOURCE) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
    } else {
      gl.addSource(IA_ROUTE_SOURCE, { type: "geojson", data });
    }

    if (!gl.getLayer(IA_ROUTE_LAYER)) {
      // Sit under any route overlays already present after a style swap.
      const beforeId = firstIaRouteOverlayLayerId((id) => Boolean(gl.getLayer(id)));
      gl.addLayer(
        {
          id: IA_ROUTE_LAYER,
          type: "line",
          source: IA_ROUTE_SOURCE,
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "visible",
          },
          paint: paintFor(spec),
        },
        beforeId,
      );
      promoteIaHomeUserLayer(gl);
      return;
    }

    const paint = paintFor(spec)!;
    gl.setPaintProperty(IA_ROUTE_LAYER, "line-color", paint["line-color"]);
    gl.setPaintProperty(IA_ROUTE_LAYER, "line-width", paint["line-width"]);
    gl.setPaintProperty(IA_ROUTE_LAYER, "line-opacity", paint["line-opacity"]);
    // undefined clears dash → solid bus line (MapLibre default).
    gl.setPaintProperty(
      IA_ROUTE_LAYER,
      "line-dasharray",
      spec.water ? [2, 1.6] : undefined,
    );
  } catch {
    /* style not ready / mid-swap — next style.load ensure will retry */
  }
}

export function removeIaRouteLine(gl: MaplibreMap) {
  try {
    if (gl.getLayer(IA_ROUTE_LAYER)) gl.removeLayer(IA_ROUTE_LAYER);
  } catch {
    /* ignore */
  }
  try {
    if (gl.getSource(IA_ROUTE_SOURCE)) gl.removeSource(IA_ROUTE_SOURCE);
  } catch {
    /* ignore */
  }
}

/** Remember desired line for this Leaflet map and apply immediately if GL is ready. */
export function setIaRouteLine(map: LeafletMap, spec: IaRouteLineSpec | null) {
  desiredByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteLine(gl, spec);
}

/** Re-apply remembered route line after style.load (Bright↔PMTiles). */
export function ensureIaRouteLineForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteLine(gl, desiredByMap.get(map) ?? null);
}

export function clearIaRouteLine(map: LeafletMap) {
  desiredByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeIaRouteLine(gl);
}
