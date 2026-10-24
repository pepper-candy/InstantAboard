import type { Map as MaplibreMap, LayerSpecification } from "maplibre-gl";
import { promoteIaUserPinLayers } from "@/lib/glUserPin";

/**
 * Draw order for route overlays on the shared MapLibre basemap.
 * Line is under everything; later entries sit above earlier ones.
 * Used so glRouteLine can insert beneath overlays after style swap.
 */
export const IA_ROUTE_OVERLAY_LAYERS = [
  "ia-route-stops-layer",
  "ia-route-focus-ripple-0",
  "ia-route-focus-ripple-1",
  "ia-route-focus-ripple-2",
  "ia-route-focus-ripple-3",
  "ia-route-focus-layer",
  // Sim band stack (bottom → top): chevrons under the estimate dot under the
  // head/tail bus glyphs. Chevrons must never cover the yellow dot or bus ends.
  "ia-route-chevrons-layer",
  "ia-route-estimates-layer",
  "ia-route-sim-vehicles-layer",
  "ia-route-vehicles-layer",
  "ia-route-flags-layer",
] as const;

/** First existing overlay layer id, or undefined — pass as beforeId when adding the route line. */
export function firstIaRouteOverlayLayerId(
  hasLayer: (id: string) => boolean,
): string | undefined {
  for (const id of IA_ROUTE_OVERLAY_LAYERS) {
    if (hasLayer(id)) return id;
  }
  return undefined;
}

/**
 * Add a layer in IA_ROUTE_OVERLAY_LAYERS order: insert before the next
 * already-present overlay so late ensures still land in the right stack.
 */
/** Re-stack every IA route overlay to match IA_ROUTE_OVERLAY_LAYERS (bottom → top). */
export function promoteIaRouteOverlayLayers(gl: MaplibreMap) {
  try {
    for (const id of IA_ROUTE_OVERLAY_LAYERS) {
      if (gl.getLayer(id)) gl.moveLayer(id);
    }
    promoteIaUserPinLayers(gl);
  } catch {
    /* ignore */
  }
}

export function addIaRouteOverlayLayer(gl: MaplibreMap, layer: LayerSpecification) {
  if (!gl.getLayer(layer.id)) {
    const idx = (IA_ROUTE_OVERLAY_LAYERS as readonly string[]).indexOf(layer.id);
    let beforeId: string | undefined;
    if (idx >= 0) {
      for (let i = idx + 1; i < IA_ROUTE_OVERLAY_LAYERS.length; i++) {
        const next = IA_ROUTE_OVERLAY_LAYERS[i]!;
        if (gl.getLayer(next)) {
          beforeId = next;
          break;
        }
      }
    }
    gl.addLayer(layer, beforeId);
  }
  promoteIaRouteOverlayLayers(gl);
}
