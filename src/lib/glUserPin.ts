import type { Map as LeafletMap } from "leaflet";
import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { getIaMaplibreMap } from "@/lib/basemap";

export const IA_USER_SOURCE = "ia-user-pin";
export const IA_USER_DOT_LAYER = "ia-user-dot-layer";
const IA_USER_RIPPLE_PREFIX = "ia-user-ripple-";

/**
 * ── Edit this block to control the GPS pulse ─────────────────────────────
 *
 * Default motion = grow bigger while visible, then turn invisible.
 * The ring never shrinks on screen (no “ripple back in”).
 *
 *   grow-then-hide  → big while growing, then opacity 0 (what you asked for)
 *   grow-and-fade   → fade out while growing (old CSS-like soft dissolve)
 */
export const USER_PIN_RIPPLE = {
  /** Full cycle length (ms). */
  periodMs: 3000,

  /** Solid center-dot radius (px). Rings start near this size. */
  baseRadius: 6,

  /** How far a ring grows: finalRadius = baseRadius * scaleEnd. */
  scaleEnd: 3.2,

  /** Stroke / fill opacity while the ring is growing. */
  strokeOpacityStart: 0.7,
  fillOpacityStart: 0.28,

  /**
   * Fraction of period spent growing (0–1).
   * After that → ring is forced invisible until the next loop.
   */
  expandFrac: 0.8,

  /**
   * "grow-then-hide" — only get bigger; when grow is done, snap invisible
   *                    (no shrink drawn). ← use this for your case
   * "grow-and-fade"  — fade while expanding
   */
  motion: "grow-and-fade" as "grow-then-hide" | "grow-and-fade",

  /** true = keep pulsing; false = one expand then stay hidden. */
  loop: true,

  color: "rgba(78, 162, 255, 1)",
  dotColor: "#4ea2ff",
  dotStroke: "#0b57d0",
  dotStrokeWidth: 2,
  ringStrokeWidth: 2,

  /** Staggered rings — add/remove `{ offsetMs }` freely. */
  rings: [
    { offsetMs: 0 },
    { offsetMs: 1500 },
  ] as ReadonlyArray<{ offsetMs: number }>,
};

type UserSpec = { lat: number; lng: number };

const desiredByMap = new WeakMap<LeafletMap, UserSpec | null>();
const animByGl = new WeakMap<
  MaplibreMap,
  { raf: number; start: number; leaflet: LeafletMap }
>();

function rippleLayerId(i: number) {
  return `${IA_USER_RIPPLE_PREFIX}${i}`;
}

function allRippleLayerIds() {
  return USER_PIN_RIPPLE.rings.map((_, i) => rippleLayerId(i));
}

function pointCollection(spec: UserSpec): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [spec.lng, spec.lat] },
      },
    ],
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

function addLayerTop(gl: MaplibreMap, layer: Parameters<MaplibreMap["addLayer"]>[0]) {
  if (gl.getLayer(layer.id)) return;
  gl.addLayer(layer);
}

function easeOut(t: number) {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/**
 * `t` in [0,1] = progress through one cycle for a single ring.
 * Radius never decreases on screen — after expand, opacity goes to 0.
 */
function ringPaint(t: number): { radius: number; opacity: number; fillOpacity: number } {
  const cfg = USER_PIN_RIPPLE;
  const growing = t < cfg.expandFrac;
  const phase = growing ? t / cfg.expandFrac : 1;
  const e = easeOut(phase);
  const radius = cfg.baseRadius * (1 + (cfg.scaleEnd - 1) * e);

  // Done growing (or “would shrink”) → invisible. Never draw a smaller ring.
  if (!growing) {
    return { radius, opacity: 0, fillOpacity: 0 };
  }

  if (cfg.motion === "grow-then-hide") {
    // Stay visible at full strength the whole time it gets bigger.
    return {
      radius,
      opacity: cfg.strokeOpacityStart,
      fillOpacity: cfg.fillOpacityStart,
    };
  }

  // grow-and-fade: dissolve while expanding
  return {
    radius,
    opacity: cfg.strokeOpacityStart * (1 - e),
    fillOpacity: cfg.fillOpacityStart * (1 - e),
  };
}

function applyRipple(gl: MaplibreMap, layerId: string, t: number) {
  if (!gl.getLayer(layerId)) return;
  const { radius, opacity, fillOpacity } = ringPaint(t);
  try {
    // MapLibre defaults ~300ms paint transitions — lerping radius large→small on
    // loop restart looks like a breathe/shrink. Snap every frame.
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

/** Map wall-clock elapsed → ring phase t in [0,1] (or >1 when finished & !loop). */
function phaseForRing(elapsedMs: number, offsetMs: number): number {
  const { periodMs, loop } = USER_PIN_RIPPLE;
  const local = elapsedMs - offsetMs;
  if (local < 0) return 1; // not started yet → fully faded / invisible
  if (!loop) return Math.min(1, local / periodMs);
  return (local % periodMs) / periodMs;
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
    if (desiredByMap.get(state.leaflet) == null) {
      stopAnim(gl);
      return;
    }
    const firstId = rippleLayerId(0);
    if (USER_PIN_RIPPLE.rings.length > 0 && !gl.getLayer(firstId)) {
      stopAnim(gl);
      return;
    }
    const elapsed = now - state.start;
    let allDone = !USER_PIN_RIPPLE.loop && USER_PIN_RIPPLE.rings.length > 0;
    USER_PIN_RIPPLE.rings.forEach((ring, i) => {
      const t = phaseForRing(elapsed, ring.offsetMs);
      if (USER_PIN_RIPPLE.loop || t < 1) allDone = false;
      applyRipple(gl, rippleLayerId(i), Math.min(1, t));
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

function removeIaUserPin(gl: MaplibreMap) {
  stopAnim(gl);
  removeLayer(gl, IA_USER_DOT_LAYER);
  // Remove a few extra ids in case config shrank (stale layers after hot reload).
  for (let i = 0; i < Math.max(allRippleLayerIds().length, 8); i++) {
    removeLayer(gl, rippleLayerId(i));
  }
  try {
    if (gl.getSource(IA_USER_SOURCE)) gl.removeSource(IA_USER_SOURCE);
  } catch {
    /* ignore */
  }
}

/** Keep GPS pin above route overlays. */
export function promoteIaUserPinLayers(gl: MaplibreMap) {
  try {
    for (const id of allRippleLayerIds()) {
      if (gl.getLayer(id)) gl.moveLayer(id);
    }
    if (gl.getLayer(IA_USER_DOT_LAYER)) gl.moveLayer(IA_USER_DOT_LAYER);
  } catch {
    /* ignore */
  }
}

export function ensureIaUserPin(gl: MaplibreMap, spec: UserSpec | null, map?: LeafletMap) {
  try {
    if (!spec) {
      removeIaUserPin(gl);
      return;
    }

    const cfg = USER_PIN_RIPPLE;
    setSourceData(gl, IA_USER_SOURCE, pointCollection(spec));

    // Drop rings that are no longer in the config (hot-reload / shrink).
    for (let i = cfg.rings.length; i < 8; i++) removeLayer(gl, rippleLayerId(i));

    cfg.rings.forEach((_, i) => {
      addLayerTop(gl, {
        id: rippleLayerId(i),
        type: "circle",
        source: IA_USER_SOURCE,
        paint: {
          "circle-radius": cfg.baseRadius,
          "circle-color": cfg.color,
          "circle-opacity": cfg.fillOpacityStart,
          "circle-stroke-width": cfg.ringStrokeWidth,
          "circle-stroke-color": cfg.color,
          "circle-stroke-opacity": cfg.strokeOpacityStart,
        },
      });
    });

    addLayerTop(gl, {
      id: IA_USER_DOT_LAYER,
      type: "circle",
      source: IA_USER_SOURCE,
      paint: {
        "circle-radius": cfg.baseRadius,
        "circle-color": cfg.dotColor,
        "circle-stroke-width": cfg.dotStrokeWidth,
        "circle-stroke-color": cfg.dotStroke,
        "circle-opacity": 1,
      },
    });

    promoteIaUserPinLayers(gl);
    if (map) startAnim(gl, map);
  } catch {
    /* style not ready */
  }
}

export function setIaUserPin(map: LeafletMap, spec: UserSpec | null) {
  desiredByMap.set(map, spec);
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaUserPin(gl, spec, map);
}

export function ensureIaUserPinForMap(map: LeafletMap) {
  const gl = getIaMaplibreMap(map);
  if (!gl) return;
  ensureIaUserPin(gl, desiredByMap.get(map) ?? null, map);
}

export function clearIaUserPin(map: LeafletMap) {
  desiredByMap.set(map, null);
  const gl = getIaMaplibreMap(map);
  if (gl) removeIaUserPin(gl);
}
