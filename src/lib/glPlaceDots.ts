import L, { type LeafletMouseEvent, type Map as LeafletMap } from "leaflet";
import type {
  GeoJSONSource,
  Map as MaplibreMap,
} from "maplibre-gl";

export const IA_USER_SOURCE = "ia-user";
export const IA_STOPS_SOURCE = "ia-stops";

export const IA_USER_HALO = "ia-user-halo";
/** Second ripple phase (CSS `.user-ripple:nth-child(2)` delay −1.2s). */
export const IA_USER_HALO_B = "ia-user-halo-b";
export const IA_USER_DOT = "ia-user-dot";
export const IA_STOPS_CIRCLE = "ia-stops-circle";
export const IA_STOPS_LABEL = "ia-stops-label";

const HIT_LAYERS = [IA_STOPS_CIRCLE, IA_STOPS_LABEL] as const;

/** Match globals.css `.user-ripple` (12px @ scale 1 → 3.2). */
const RIPPLE_MS = 2400;
const RIPPLE_PHASE_MS = 1200;
const RIPPLE_R0 = 6;
const RIPPLE_R1 = 20;
const RIPPLE_OP0 = 0.7;

export type IaStopRole = "stop" | "cluster";

export type IaStopProps = {
  id: string;
  role: IaStopRole;
  color: string;
  selected: 0 | 1;
  count: number;
  label: string;
};

/** Minimal GeoJSON FC — avoids @types/geojson dep. */
export type IaFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Record<string, unknown> | IaStopProps | null;
  }>;
};

export const EMPTY_FC: IaFeatureCollection = { type: "FeatureCollection", features: [] };

export type IaPlaceHitHandlers = {
  onStop: (id: string) => void;
  onCluster: (id: string) => void;
};

type Cached = {
  user: IaFeatureCollection;
  stops: IaFeatureCollection;
  hits: IaPlaceHitHandlers | null;
  rippleRaf: number;
  rippleStart: number;
};

const cache = new WeakMap<MaplibreMap, Cached>();

function state(gl: MaplibreMap): Cached {
  let s = cache.get(gl);
  if (!s) {
    s = {
      user: EMPTY_FC,
      stops: EMPTY_FC,
      hits: null,
      rippleRaf: 0,
      rippleStart: 0,
    };
    cache.set(gl, s);
  }
  return s;
}

function asGeoJsonSource(gl: MaplibreMap, id: string): GeoJSONSource | null {
  const src = gl.getSource(id);
  return src && "setData" in src ? (src as GeoJSONSource) : null;
}

function setSourceData(gl: MaplibreMap, id: string, data: IaFeatureCollection) {
  const src = asGeoJsonSource(gl, id);
  if (src) src.setData(data as never);
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function addUserHaloLayer(gl: MaplibreMap, id: string) {
  if (gl.getLayer(id)) return;
  gl.addLayer({
    id,
    type: "circle",
    source: IA_USER_SOURCE,
    paint: {
      "circle-radius": RIPPLE_R0,
      "circle-color": "rgba(78, 162, 255, 0.28)",
      "circle-opacity": RIPPLE_OP0,
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(78, 162, 255, 0.55)",
      "circle-stroke-opacity": RIPPLE_OP0,
    },
  });
}

/** Idempotent: recreate ia-user / ia-stops after setStyle; restore last setData. */
export function ensureIaPlaceLayers(gl: MaplibreMap): void {
  const s = state(gl);

  if (!gl.getSource(IA_USER_SOURCE)) {
    gl.addSource(IA_USER_SOURCE, { type: "geojson", data: s.user as never });
  } else {
    setSourceData(gl, IA_USER_SOURCE, s.user);
  }

  if (!gl.getSource(IA_STOPS_SOURCE)) {
    gl.addSource(IA_STOPS_SOURCE, { type: "geojson", data: s.stops as never });
  } else {
    setSourceData(gl, IA_STOPS_SOURCE, s.stops);
  }

  addUserHaloLayer(gl, IA_USER_HALO);
  addUserHaloLayer(gl, IA_USER_HALO_B);

  if (!gl.getLayer(IA_USER_DOT)) {
    gl.addLayer({
      id: IA_USER_DOT,
      type: "circle",
      source: IA_USER_SOURCE,
      paint: {
        "circle-radius": 6,
        "circle-color": "#4ea2ff",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#0b57d0",
      },
    });
  }

  if (!gl.getLayer(IA_STOPS_CIRCLE)) {
    gl.addLayer({
      id: IA_STOPS_CIRCLE,
      type: "circle",
      source: IA_STOPS_SOURCE,
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "role"], "cluster"],
          11,
          ["case", ["==", ["get", "selected"], 1], 6, 5],
        ],
        "circle-color": ["get", "color"],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "selected"], 1],
          2.5,
          1.5,
        ],
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  if (!gl.getLayer(IA_STOPS_LABEL)) {
    gl.addLayer({
      id: IA_STOPS_LABEL,
      type: "symbol",
      source: IA_STOPS_SOURCE,
      filter: ["==", ["get", "role"], "cluster"],
      layout: {
        "text-field": ["get", "label"],
        "text-size": 10,
        "text-font": ["Noto Sans Regular"],
        "text-anchor": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });
  }

  syncUserRipple(gl);
}

/**
 * One ripple phase over RIPPLE_MS: expand to outer ring, then contract back to the
 * inner point while fading (not freeze at max radius with opacity 0).
 */
function ripplePhase(elapsedInCycle: number): { radius: number; opacity: number } {
  const u = (((elapsedInCycle % RIPPLE_MS) + RIPPLE_MS) % RIPPLE_MS) / RIPPLE_MS;
  if (u < 0.45) {
    // Expand (ease-out), opacity softens slightly.
    const p = u / 0.45;
    const ease = 1 - (1 - p) * (1 - p);
    return {
      radius: RIPPLE_R0 + (RIPPLE_R1 - RIPPLE_R0) * ease,
      opacity: RIPPLE_OP0 * (1 - 0.45 * ease),
    };
  }
  // Contract back to inner point (ease-in) while fading out.
  const p = (u - 0.45) / 0.55;
  const ease = p * p;
  return {
    radius: RIPPLE_R1 + (RIPPLE_R0 - RIPPLE_R1) * ease,
    opacity: RIPPLE_OP0 * 0.55 * (1 - ease),
  };
}

function paintHalo(gl: MaplibreMap, layerId: string, radius: number, opacity: number) {
  if (!gl.getLayer(layerId)) return;
  gl.setPaintProperty(layerId, "circle-radius", radius);
  gl.setPaintProperty(layerId, "circle-opacity", opacity);
  gl.setPaintProperty(layerId, "circle-stroke-opacity", opacity);
}

function stopUserRipple(gl: MaplibreMap) {
  const s = state(gl);
  if (s.rippleRaf) {
    cancelAnimationFrame(s.rippleRaf);
    s.rippleRaf = 0;
  }
}

function paintStaticHalo(gl: MaplibreMap) {
  paintHalo(gl, IA_USER_HALO, 14, 0.28);
  paintHalo(gl, IA_USER_HALO_B, 14, 0);
}

function startUserRipple(gl: MaplibreMap) {
  const s = state(gl);
  if (s.rippleRaf) return;
  s.rippleStart = performance.now();
  const tick = (now: number) => {
    const cur = state(gl);
    if (cur.user.features.length === 0) {
      cur.rippleRaf = 0;
      paintStaticHalo(gl);
      return;
    }
    if (!gl.getLayer(IA_USER_HALO)) {
      cur.rippleRaf = 0;
      return;
    }
    const t = now - cur.rippleStart;
    const a = ripplePhase(t);
    const b = ripplePhase(t - RIPPLE_PHASE_MS);
    paintHalo(gl, IA_USER_HALO, a.radius, a.opacity);
    paintHalo(gl, IA_USER_HALO_B, b.radius, b.opacity);
    cur.rippleRaf = requestAnimationFrame(tick);
  };
  s.rippleRaf = requestAnimationFrame(tick);
}

function syncUserRipple(gl: MaplibreMap) {
  const hasUser = state(gl).user.features.length > 0;
  if (!hasUser) {
    stopUserRipple(gl);
    paintHalo(gl, IA_USER_HALO, RIPPLE_R0, 0);
    paintHalo(gl, IA_USER_HALO_B, RIPPLE_R0, 0);
    return;
  }
  if (prefersReducedMotion()) {
    stopUserRipple(gl);
    paintStaticHalo(gl);
    return;
  }
  // Restart after ensure/setStyle so paint targets live layers.
  stopUserRipple(gl);
  startUserRipple(gl);
}

export function setIaUserGeoJSON(gl: MaplibreMap, data: IaFeatureCollection): void {
  const s = state(gl);
  s.user = data;
  if (!gl.getSource(IA_USER_SOURCE)) {
    ensureIaPlaceLayers(gl);
    return;
  }
  setSourceData(gl, IA_USER_SOURCE, data);
  syncUserRipple(gl);
}

export function setIaStopsGeoJSON(gl: MaplibreMap, data: IaFeatureCollection): void {
  const s = state(gl);
  s.stops = data;
  if (!gl.getSource(IA_STOPS_SOURCE)) {
    ensureIaPlaceLayers(gl);
    return;
  }
  setSourceData(gl, IA_STOPS_SOURCE, data);
}

export function setIaPlaceHitHandlers(gl: MaplibreMap, hits: IaPlaceHitHandlers | null): void {
  state(gl).hits = hits;
  if (hits) ensureIaPlaceLayers(gl);
}

export function clearIaPlaceDots(gl: MaplibreMap): void {
  setIaUserGeoJSON(gl, EMPTY_FC);
  setIaStopsGeoJSON(gl, EMPTY_FC);
}

export function userPointFeature(lng: number, lat: number): IaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {},
      },
    ],
  };
}

export function stopPointFeature(lng: number, lat: number, props: IaStopProps) {
  return {
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
    properties: props,
  };
}

type ScreenPt = { x: number; y: number };

function queryStopHit(
  gl: MaplibreMap,
  point: ScreenPt,
): { id: string; role: IaStopRole } | null {
  const layers = HIT_LAYERS.filter((id) => gl.getLayer(id));
  if (!layers.length) return null;
  const feats = gl.queryRenderedFeatures([point.x, point.y], { layers: [...layers] });
  const f = feats[0];
  if (!f?.properties) return null;
  const id = String(f.properties.id ?? "");
  const role = f.properties.role as IaStopRole | undefined;
  if (!id || !role) return null;
  return { id, role };
}

/** Dispatch stored hit handlers for a container-pixel point. Returns true if a stop/cluster was hit. */
export function dispatchIaPlaceHitAt(gl: MaplibreMap, point: ScreenPt): boolean {
  const hits = state(gl).hits;
  if (!hits) return false;
  const hit = queryStopHit(gl, point);
  if (!hit) return false;
  if (hit.role === "cluster") hits.onCluster(hit.id);
  else hits.onStop(hit.id);
  return true;
}

export function iaPlaceHoverAt(gl: MaplibreMap, point: ScreenPt): boolean {
  return queryStopHit(gl, point) != null;
}

/**
 * Leaflet-forwarded hits (maplibre-gl-leaflet sets GL canvas pointer-events:none,
 * so gl.on('click') never fires). Returns cleanup.
 */
export function bindIaPlaceLeafletHits(map: LeafletMap, gl: MaplibreMap): () => void {
  const container = map.getContainer();

  const onClick = (e: LeafletMouseEvent) => {
    const oe = e.originalEvent;
    if (!(oe instanceof MouseEvent)) return;
    const pt = map.mouseEventToContainerPoint(oe);
    if (dispatchIaPlaceHitAt(gl, { x: pt.x, y: pt.y })) {
      L.DomEvent.stop(oe);
    }
  };

  const onMove = (e: LeafletMouseEvent) => {
    const oe = e.originalEvent;
    if (!(oe instanceof MouseEvent)) return;
    const pt = map.mouseEventToContainerPoint(oe);
    const hit = iaPlaceHoverAt(gl, { x: pt.x, y: pt.y });
    container.style.cursor = hit ? "pointer" : "";
    // GL canvas may still show default — keep in sync when visible.
    try {
      gl.getCanvas().style.cursor = hit ? "pointer" : "";
    } catch {
      /* canvas may be gone mid-teardown */
    }
  };

  map.on("click", onClick);
  map.on("mousemove", onMove);

  return () => {
    map.off("click", onClick);
    map.off("mousemove", onMove);
    container.style.cursor = "";
    stopUserRipple(gl);
  };
}

/** Tear down ripple when HomeMap unmounts / handlers cleared. */
export function disposeIaPlaceDots(gl: MaplibreMap): void {
  stopUserRipple(gl);
  state(gl).hits = null;
}
