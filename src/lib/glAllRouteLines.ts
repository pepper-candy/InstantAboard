/**
 * Develop map-tools: one MapLibre source+layer per unique station route shape.
 * Stack = furthest under → closest on top; hover promotes that place’s keys.
 * Survives Bright↔PMTiles setStyle via desiredByMap + registerIaGlStyleEnsure.
 */

import type { Map as LeafletMap } from "leaflet";
import type {
  GeoJSONSource,
  LineLayerSpecification,
  Map as MaplibreMap,
} from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";
import {
  IA_HOME_CLUSTERS_LAYER,
  IA_HOME_FOCUS_LAYER,
  IA_HOME_LOGOS_LAYER,
  IA_HOME_STOPS_LAYER,
} from "@/lib/glHomePlaces";
import { IA_ROUTE_LAYER } from "@/lib/glRouteLine";
import { firstIaRouteOverlayLayerId } from "@/lib/glRouteOrder";
import { IA_USER_DOT_LAYER, promoteIaUserPinLayers } from "@/lib/glUserPin";
import type { LatLng } from "@/lib/geo";

const SOURCE_PREFIX = "ia-dev-route-src-";
const LAYER_PREFIX = "ia-dev-route-lyr-";

/** Full opacity vs dim (~20%) for the develop-mode station-route overlay. */
export type IaAllRoutesOpacity = 1 | 0.2;

export type IaDevRouteLine = {
  key: string;
  points: LatLng[];
  color: string;
  water: boolean;
};

export type IaAllRoutesSpec = {
  routes: IaDevRouteLine[];
  /** Furthest → closest (first = bottom, last = top under pins). */
  stackOrder: string[];
  opacity: IaAllRoutesOpacity;
  /** Shape keys temporarily above stackOrder (hovered station). */
  hoverKeys: string[];
};

const desiredByMap = new WeakMap<LeafletMap, IaAllRoutesSpec | null>();

const FULL_OPACITY = 0.9;
const DIM_OPACITY = 0.2;
const HOVER_OPACITY = 0.95;

function layerIdFor(key: string): string {
  const safe = key.replace(/\.json$/i, "").replace(/[^A-Za-z0-9_+.-]+/g, "_");
  return `${LAYER_PREFIX}${safe}`;
}

function sourceIdFor(key: string): string {
  const safe = key.replace(/\.json$/i, "").replace(/[^A-Za-z0-9_+.-]+/g, "_");
  return `${SOURCE_PREFIX}${safe}`;
}

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

function paintFor(
  route: IaDevRouteLine,
  opacity: number,
): LineLayerSpecification["paint"] {
  return {
    "line-color": route.color,
    "line-width": route.water ? 4 : 5,
    "line-opacity": opacity,
    ...(route.water ? { "line-dasharray": [2, 1.6] as [number, number] } : {}),
  };
}

/** Layers that must stay above develop route lines (catalog pins / detail overlays / GPS). */
function firstAboveDevRoutesLayerId(gl: MaplibreMap): string | undefined {
  const candidates = [
    IA_HOME_STOPS_LAYER,
    IA_HOME_FOCUS_LAYER,
    IA_HOME_LOGOS_LAYER,
    IA_HOME_CLUSTERS_LAYER,
    IA_USER_DOT_LAYER,
    IA_ROUTE_LAYER,
  ];
  for (const id of candidates) {
    if (gl.getLayer(id)) return id;
  }
  return firstIaRouteOverlayLayerId((id) => Boolean(gl.getLayer(id)));
}

function removeAllDevRoutes(gl: MaplibreMap) {
  try {
    const style = gl.getStyle();
    for (const layer of style?.layers ?? []) {
      if (!layer.id.startsWith(LAYER_PREFIX)) continue;
      try {
        gl.removeLayer(layer.id);
      } catch {
        /* ignore */
      }
    }
    for (const id of Object.keys(style?.sources ?? {})) {
      if (!id.startsWith(SOURCE_PREFIX)) continue;
      try {
        gl.removeSource(id);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* style mid-swap */
  }
}

function opacityForKey(spec: IaAllRoutesSpec, key: string): number {
  if (spec.hoverKeys.includes(key)) return HOVER_OPACITY;
  return spec.opacity === 0.2 ? DIM_OPACITY : FULL_OPACITY;
}

function restackDevRoutes(gl: MaplibreMap, spec: IaAllRoutesSpec) {
  const beforeId = firstAboveDevRoutesLayerId(gl);
  const move = (key: string) => {
    const id = layerIdFor(key);
    if (!gl.getLayer(id)) return;
    try {
      if (beforeId && gl.getLayer(beforeId)) gl.moveLayer(id, beforeId);
      else gl.moveLayer(id);
    } catch {
      /* ignore */
    }
  };
  for (const key of spec.stackOrder) move(key);
  for (const key of spec.hoverKeys) move(key);
  // Keep GPS pin above develop routes; leave home catalog stack alone.
  promoteIaUserPinLayers(gl);
}

function purgeUnwanted(gl: MaplibreMap, wantedKeys: Set<string>) {
  const wantedLayers = new Set([...wantedKeys].map(layerIdFor));
  const wantedSources = new Set([...wantedKeys].map(sourceIdFor));
  const style = gl.getStyle();
  for (const layer of style?.layers ?? []) {
    if (!layer.id.startsWith(LAYER_PREFIX)) continue;
    if (wantedLayers.has(layer.id)) continue;
    try {
      gl.removeLayer(layer.id);
    } catch {
      /* ignore */
    }
  }
  for (const id of Object.keys(gl.getStyle()?.sources ?? {})) {
    if (!id.startsWith(SOURCE_PREFIX)) continue;
    if (wantedSources.has(id)) continue;
    try {
      gl.removeSource(id);
    } catch {
      /* ignore */
    }
  }
}

/** Add or refresh develop station-route sources/layers on a MapLibre map. */
export function ensureIaAllRouteLines(gl: MaplibreMap, spec: IaAllRoutesSpec | null) {
  try {
    if (!spec || spec.routes.length === 0) {
      removeAllDevRoutes(gl);
      return;
    }

    const wanted = new Set(spec.routes.map((r) => r.key));
    purgeUnwanted(gl, wanted);

    const beforeId = firstAboveDevRoutesLayerId(gl);
    const byKey = new Map(spec.routes.map((r) => [r.key, r]));

    for (const key of spec.stackOrder) {
      const route = byKey.get(key);
      if (!route || route.points.length < 2) continue;

      const sid = sourceIdFor(key);
      const lid = layerIdFor(key);
      const data = lineFeatureCollection(route.points);
      const existing = gl.getSource(sid) as GeoJSONSource | undefined;
      if (existing) existing.setData(data);
      else gl.addSource(sid, { type: "geojson", data });

      const opacity = opacityForKey(spec, key);
      const paint = paintFor(route, opacity)!;

      if (!gl.getLayer(lid)) {
        gl.addLayer(
          {
            id: lid,
            type: "line",
            source: sid,
            layout: {
              "line-cap": "round",
              "line-join": "round",
              visibility: "visible",
            },
            paint,
          },
          beforeId && gl.getLayer(beforeId) ? beforeId : undefined,
        );
      } else {
        gl.setPaintProperty(lid, "line-color", paint["line-color"]);
        gl.setPaintProperty(lid, "line-width", paint["line-width"]);
        gl.setPaintProperty(lid, "line-opacity", paint["line-opacity"]);
        gl.setPaintProperty(
          lid,
          "line-dasharray",
          route.water ? [2, 1.6] : undefined,
        );
      }
    }

    restackDevRoutes(gl, spec);
  } catch {
    /* style not ready / mid-swap — next style.load ensure will retry */
  }
}

export function setIaAllRouteLines(map: LeafletMap, spec: IaAllRoutesSpec | null) {
  desiredByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaAllRouteLines(gl, spec);
}

export function ensureIaAllRouteLinesForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaAllRouteLines(gl, desiredByMap.get(map) ?? null);
}

export function clearIaAllRouteLines(map: LeafletMap) {
  desiredByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeAllDevRoutes(gl);
}

/** Update opacity / hover / stack without replacing geometries. */
export function patchIaAllRouteLines(
  map: LeafletMap,
  patch: Partial<Pick<IaAllRoutesSpec, "opacity" | "hoverKeys" | "stackOrder">>,
) {
  const prev = desiredByMap.get(map);
  if (!prev) return;
  setIaAllRouteLines(map, {
    ...prev,
    opacity: patch.opacity ?? prev.opacity,
    hoverKeys: patch.hoverKeys ?? prev.hoverKeys,
    stackOrder: patch.stackOrder ?? prev.stackOrder,
  });
}
