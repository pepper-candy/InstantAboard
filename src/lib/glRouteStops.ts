import type { Map as LeafletMap } from "leaflet";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";
import { addIaRouteOverlayLayer } from "@/lib/glRouteOrder";
import { USER_PIN_RIPPLE } from "@/lib/glUserPin";
import type { LatLng } from "@/lib/geo";

export const IA_ROUTE_STOPS_SOURCE = "ia-route-stops";
export const IA_ROUTE_STOPS_LAYER = "ia-route-stops-layer";
export const IA_ROUTE_FOCUS_SOURCE = "ia-route-focus";
/** White core + route-colour rim (same recipe as GPS pin, colour from the line). */
export const IA_ROUTE_FOCUS_LAYER = "ia-route-focus-layer";
const IA_ROUTE_FOCUS_RIPPLE_PREFIX = "ia-route-focus-ripple-";

export type IaRouteStopDot = LatLng & { seq?: number };

export type IaRouteStopsSpec = {
  stops: IaRouteStopDot[];
  focus: LatLng | null;
  color: string;
};

const desiredByMap = new WeakMap<LeafletMap, IaRouteStopsSpec | null>();
const animByGl = new WeakMap<
  MaplibreMap,
  { raf: number; start: number; leaflet: LeafletMap }
>();

function paintColor(color: string) {
  return /^#[0-9A-Fa-f]{6}$/i.test(color) ? color : "#888888";
}

function focusRippleLayerId(i: number) {
  return `${IA_ROUTE_FOCUS_RIPPLE_PREFIX}${i}`;
}

function allFocusRippleLayerIds() {
  return USER_PIN_RIPPLE.rings.map((_, i) => focusRippleLayerId(i));
}

/** Exported for glRouteOrder stacking (ripples under the focus dot). */
export function iaRouteFocusRippleLayerIds(): string[] {
  return allFocusRippleLayerIds();
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function pointsCollection(points: LatLng[]): GeoJSON.FeatureCollection {
  if (!points.length) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      properties: {
        seq:
          "seq" in p && typeof (p as IaRouteStopDot).seq === "number"
            ? (p as IaRouteStopDot).seq
            : i,
      },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

function setSourceData(gl: MaplibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const existing = gl.getSource(sourceId) as GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else gl.addSource(sourceId, { type: "geojson", data });
}

function removeLayer(gl: MaplibreMap, layerId: string) {
  try {
    if (gl.getLayer(layerId)) gl.removeLayer(layerId);
  } catch {
    /* ignore */
  }
}

function removeLayerSource(gl: MaplibreMap, layerId: string, sourceId: string) {
  removeLayer(gl, layerId);
  try {
    if (gl.getSource(sourceId)) gl.removeSource(sourceId);
  } catch {
    /* ignore */
  }
}

function easeOut(t: number) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

function ringPaint(t: number): { radius: number; opacity: number; fillOpacity: number } {
  const cfg = USER_PIN_RIPPLE;
  const growing = t < cfg.expandFrac;
  const phase = growing ? t / cfg.expandFrac : 1;
  const e = easeOut(phase);
  const radius = cfg.baseRadius * (1 + (cfg.scaleEnd - 1) * e);
  if (!growing) return { radius, opacity: 0, fillOpacity: 0 };
  if (cfg.motion === "grow-then-hide") {
    return {
      radius,
      opacity: cfg.strokeOpacityStart,
      fillOpacity: cfg.fillOpacityStart,
    };
  }
  return {
    radius,
    opacity: cfg.strokeOpacityStart * (1 - e),
    fillOpacity: cfg.fillOpacityStart * (1 - e),
  };
}

function phaseForRing(elapsedMs: number, offsetMs: number): number {
  const { periodMs, loop } = USER_PIN_RIPPLE;
  const local = elapsedMs - offsetMs;
  if (local < 0) return 1;
  if (!loop) return Math.min(1, local / periodMs);
  return (local % periodMs) / periodMs;
}

function applyRipple(gl: MaplibreMap, layerId: string, t: number) {
  if (!gl.getLayer(layerId)) return;
  const { radius, opacity, fillOpacity } = ringPaint(t);
  try {
    gl.setPaintProperty(layerId, "circle-radius-transition", { duration: 0, delay: 0 });
    gl.setPaintProperty(layerId, "circle-opacity-transition", { duration: 0, delay: 0 });
    gl.setPaintProperty(layerId, "circle-stroke-opacity-transition", { duration: 0, delay: 0 });
    gl.setPaintProperty(layerId, "circle-radius", radius);
    gl.setPaintProperty(layerId, "circle-opacity", fillOpacity);
    gl.setPaintProperty(layerId, "circle-stroke-opacity", opacity);
  } catch {
    /* style torn down */
  }
}

function stopAnim(gl: MaplibreMap) {
  const anim = animByGl.get(gl);
  if (!anim) return;
  cancelAnimationFrame(anim.raf);
  animByGl.delete(gl);
}

function startAnim(gl: MaplibreMap, leaflet: LeafletMap) {
  const existing = animByGl.get(gl);
  if (existing) {
    existing.leaflet = leaflet;
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const state = animByGl.get(gl);
    if (!state) return;
    const spec = desiredByMap.get(state.leaflet);
    if (!spec?.focus) {
      stopAnim(gl);
      return;
    }
    const firstId = focusRippleLayerId(0);
    if (USER_PIN_RIPPLE.rings.length > 0 && !gl.getLayer(firstId)) {
      stopAnim(gl);
      return;
    }
    const elapsed = now - state.start;
    let allDone = !USER_PIN_RIPPLE.loop && USER_PIN_RIPPLE.rings.length > 0;
    USER_PIN_RIPPLE.rings.forEach((ring, i) => {
      const t = phaseForRing(elapsed, ring.offsetMs);
      if (USER_PIN_RIPPLE.loop || t < 1) allDone = false;
      applyRipple(gl, focusRippleLayerId(i), Math.min(1, t));
    });
    if (allDone) {
      stopAnim(gl);
      return;
    }
    state.raf = requestAnimationFrame(tick);
  };
  const raf = requestAnimationFrame(tick);
  animByGl.set(gl, { raf, start, leaflet });
}

function clearFocusVisuals(gl: MaplibreMap) {
  stopAnim(gl);
  removeLayer(gl, IA_ROUTE_FOCUS_LAYER);
  for (let i = 0; i < Math.max(allFocusRippleLayerIds().length, 8); i++) {
    removeLayer(gl, focusRippleLayerId(i));
  }
  try {
    if (gl.getSource(IA_ROUTE_FOCUS_SOURCE)) gl.removeSource(IA_ROUTE_FOCUS_SOURCE);
  } catch {
    /* ignore */
  }
}

/** Add or refresh stop dots + selected focus (white core, line-colour rim, GPS-style pulse). */
export function ensureIaRouteStops(gl: MaplibreMap, spec: IaRouteStopsSpec | null, map?: LeafletMap) {
  try {
    if (!spec) {
      removeIaRouteStops(gl);
      return;
    }

    const color = paintColor(spec.color);
    const cfg = USER_PIN_RIPPLE;

    setSourceData(gl, IA_ROUTE_STOPS_SOURCE, pointsCollection(spec.stops));
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

    if (!spec.focus) {
      clearFocusVisuals(gl);
      return;
    }

    setSourceData(gl, IA_ROUTE_FOCUS_SOURCE, pointsCollection([spec.focus]));

    for (let i = cfg.rings.length; i < 8; i++) removeLayer(gl, focusRippleLayerId(i));

    cfg.rings.forEach((_, i) => {
      addIaRouteOverlayLayer(gl, {
        id: focusRippleLayerId(i),
        type: "circle",
        source: IA_ROUTE_FOCUS_SOURCE,
        paint: {
          "circle-radius": cfg.baseRadius,
          "circle-color": color,
          "circle-opacity": cfg.fillOpacityStart,
          "circle-stroke-width": cfg.ringStrokeWidth,
          "circle-stroke-color": color,
          "circle-stroke-opacity": cfg.strokeOpacityStart,
          "circle-radius-transition": { duration: 0, delay: 0 },
          "circle-opacity-transition": { duration: 0, delay: 0 },
          "circle-stroke-opacity-transition": { duration: 0, delay: 0 },
        },
      });
      if (gl.getLayer(focusRippleLayerId(i))) {
        gl.setPaintProperty(focusRippleLayerId(i), "circle-color", color);
        gl.setPaintProperty(focusRippleLayerId(i), "circle-stroke-color", color);
      }
    });

    addIaRouteOverlayLayer(gl, {
      id: IA_ROUTE_FOCUS_LAYER,
      type: "circle",
      source: IA_ROUTE_FOCUS_SOURCE,
      paint: {
        "circle-radius": cfg.baseRadius,
        "circle-color": "#ffffff",
        "circle-stroke-width": cfg.dotStrokeWidth,
        "circle-stroke-color": color,
        "circle-opacity": 1,
      },
    });
    if (gl.getLayer(IA_ROUTE_FOCUS_LAYER)) {
      gl.setPaintProperty(IA_ROUTE_FOCUS_LAYER, "circle-color", "#ffffff");
      gl.setPaintProperty(IA_ROUTE_FOCUS_LAYER, "circle-stroke-color", color);
      gl.setPaintProperty(IA_ROUTE_FOCUS_LAYER, "circle-radius", cfg.baseRadius);
    }

    if (map) startAnim(gl, map);
  } catch {
    /* style not ready / mid-swap */
  }
}

export function removeIaRouteStops(gl: MaplibreMap) {
  clearFocusVisuals(gl);
  removeLayerSource(gl, IA_ROUTE_STOPS_LAYER, IA_ROUTE_STOPS_SOURCE);
}

export function setIaRouteStops(map: LeafletMap, spec: IaRouteStopsSpec | null) {
  desiredByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteStops(gl, spec, map);
}

export function ensureIaRouteStopsForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaRouteStops(gl, desiredByMap.get(map) ?? null, map);
}

export function clearIaRouteStops(map: LeafletMap) {
  desiredByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeIaRouteStops(gl);
}