import L, { type LeafletMouseEvent, type Map as LeafletMap } from "leaflet";
import type {
  GeoJSONSource,
  Map as MaplibreMap,
} from "maplibre-gl";

export const IA_USER_SOURCE = "ia-user";
export const IA_STOPS_SOURCE = "ia-stops";

export const IA_USER_HALO = "ia-user-halo";
/** Second radar phase (CSS `.user-ripple:nth-child(2)` delay −1.2s). */
export const IA_USER_HALO_B = "ia-user-halo-b";
export const IA_USER_DOT = "ia-user-dot";
/** @deprecated circle layer — removed in favor of rounded-square symbols. */
export const IA_STOPS_CIRCLE = "ia-stops-circle";
export const IA_STOPS_ICON = "ia-stops-icon";
export const IA_STOPS_CLUSTER = "ia-stops-cluster";
export const IA_STOPS_LABEL = "ia-stops-label";

const HIT_LAYERS = [IA_STOPS_ICON, IA_STOPS_CLUSTER] as const;

/** Match globals.css `.user-ripple`: 12px dia @ scale 1 → 3.2 over 2.4s. */
const RIPPLE_MS = 2400;
const RIPPLE_PHASE_MS = 1200;
const RIPPLE_R0 = 6;
/** 12px × 3.2 / 2 = 19.2 */
const RIPPLE_R1 = 19.2;
const RIPPLE_OP0 = 0.7;

export type IaStopRole = "stop" | "cluster";

export type IaStopProps = {
  id: string;
  role: IaStopRole;
  color: string;
  selected: 0 | 1;
  count: number;
  label: string;
  /** MapLibre image id (set when uploading GeoJSON). */
  icon?: string;
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
/** imageId → true once added on this GL map (style wipe clears images). */
const iconReady = new WeakMap<MaplibreMap, Set<string>>();

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
      // Soft fill + stroke = ring ping (not a solid disc).
      "circle-color": "rgba(78, 162, 255, 0.28)",
      "circle-opacity": RIPPLE_OP0,
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(78, 162, 255, 0.75)",
      "circle-stroke-opacity": RIPPLE_OP0,
    },
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** CSS CSS pixels → 2× canvas ImageData for MapLibre addImage. */
function roundedSquareImageData(opts: {
  cssSize: number;
  radius: number;
  fill: string;
  selected?: boolean;
}): ImageData {
  const dpr = 2;
  const { cssSize, radius, fill, selected } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(cssSize * dpr, cssSize * dpr);
  ctx.scale(dpr, dpr);

  const inset = selected ? 2 : 1.5;
  const pad = selected ? 1 : 0;
  const x = pad;
  const y = pad;
  const w = cssSize - pad * 2;
  const h = cssSize - pad * 2;

  if (selected) {
    // Outer ring in brand color (.stop-dot.is-on).
    roundRect(ctx, 0.5, 0.5, cssSize - 1, cssSize - 1, radius + 1);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // White rim + fill (box-shadow: 0 0 0 1.5px #fff).
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = inset;
  ctx.stroke();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function iconIdFor(color: string, role: IaStopRole, selected: 0 | 1): string {
  const c = color.replace("#", "").toLowerCase();
  if (role === "cluster") return `ia-sq-cluster-${c}`;
  return selected ? `ia-sq-stop-on-${c}` : `ia-sq-stop-${c}`;
}

function ensureRoundedIcon(
  gl: MaplibreMap,
  color: string,
  role: IaStopRole,
  selected: 0 | 1,
): string {
  const id = iconIdFor(color, role, selected);
  let ready = iconReady.get(gl);
  if (!ready) {
    ready = new Set();
    iconReady.set(gl, ready);
  }
  if (ready.has(id) && gl.hasImage(id)) return id;
  // Style swap drops images — rebuild.
  if (gl.hasImage(id)) {
    try {
      gl.removeImage(id);
    } catch {
      /* ignore */
    }
  }
  const fill = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
  const img =
    role === "cluster"
      ? roundedSquareImageData({ cssSize: 22, radius: 7, fill })
      : selected
        ? roundedSquareImageData({ cssSize: 12, radius: 3, fill, selected: true })
        : roundedSquareImageData({ cssSize: 10, radius: 3, fill });
  gl.addImage(id, img, { pixelRatio: 2 });
  ready.add(id);
  return id;
}

function withStopIcons(gl: MaplibreMap, data: IaFeatureCollection): IaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.features.map((f) => {
      const p = f.properties as IaStopProps | null;
      if (!p || typeof p.color !== "string") return f;
      const icon = ensureRoundedIcon(gl, p.color, p.role, p.selected);
      return {
        ...f,
        properties: { ...p, icon },
      };
    }),
  };
}

/** Idempotent: recreate ia-user / ia-stops after setStyle; restore last setData. */
export function ensureIaPlaceLayers(gl: MaplibreMap): void {
  const s = state(gl);
  // Style wipe clears addImage cache bookkeeping.
  iconReady.set(gl, new Set());

  if (!gl.getSource(IA_USER_SOURCE)) {
    gl.addSource(IA_USER_SOURCE, { type: "geojson", data: s.user as never });
  } else {
    setSourceData(gl, IA_USER_SOURCE, s.user);
  }

  if (!gl.getSource(IA_STOPS_SOURCE)) {
    gl.addSource(IA_STOPS_SOURCE, { type: "geojson", data: s.stops as never });
  } else {
    setSourceData(gl, IA_STOPS_SOURCE, withStopIcons(gl, s.stops));
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

  // Drop legacy circle layer if a hot reload left it around.
  if (gl.getLayer(IA_STOPS_CIRCLE)) {
    try {
      gl.removeLayer(IA_STOPS_CIRCLE);
    } catch {
      /* ignore */
    }
  }
  if (gl.getLayer(IA_STOPS_LABEL)) {
    try {
      gl.removeLayer(IA_STOPS_LABEL);
    } catch {
      /* ignore */
    }
  }

  if (!gl.getLayer(IA_STOPS_ICON)) {
    gl.addLayer({
      id: IA_STOPS_ICON,
      type: "symbol",
      source: IA_STOPS_SOURCE,
      filter: ["==", ["get", "role"], "stop"],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
    });
  }

  if (!gl.getLayer(IA_STOPS_CLUSTER)) {
    gl.addLayer({
      id: IA_STOPS_CLUSTER,
      type: "symbol",
      source: IA_STOPS_SOURCE,
      filter: ["==", ["get", "role"], "cluster"],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
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
 * GPS radar ping (globals.css `.user-ripple`): radius ONLY grows; opacity → 0 by ~85%.
 * On wrap, SNAP to r=6 / op=0.7 — never contract mid-cycle.
 */
function ripplePhase(elapsedInCycle: number): { radius: number; opacity: number } {
  const u = ((elapsedInCycle % RIPPLE_MS) + RIPPLE_MS) % RIPPLE_MS;
  const p = Math.min(1, u / (RIPPLE_MS * 0.85));
  const ease = 1 - (1 - p) * (1 - p);
  return {
    radius: RIPPLE_R0 + (RIPPLE_R1 - RIPPLE_R0) * ease,
    opacity: RIPPLE_OP0 * (1 - ease),
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
  setSourceData(gl, IA_STOPS_SOURCE, withStopIcons(gl, data));
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
