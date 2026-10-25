"use client";

import { useEffect } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";

type ZoomAnimMap = LeafletMap & {
  _animatingZoom?: boolean;
  _onZoomTransitionEnd?: () => void;
};

/** Re-enable Leaflet drag/pinch after zoom so the next gesture pans immediately. */
export function ensureMapNavReady(map: LeafletMap) {
  try {
    map.dragging?.enable();
  } catch {
    /* ignore */
  }
  try {
    map.touchZoom?.enable();
  } catch {
    /* ignore */
  }
}

/**
 * If a CSS zoom-anim is still running when the user starts a pan, finish it so
 * Drag can take the pointer. Avoids the sticky gap after pinch/wheel zoom.
 */
function interruptZoomAnimIfNeeded(map: LeafletMap) {
  const m = map as ZoomAnimMap;
  if (!m._animatingZoom) return;
  try {
    if (typeof m._onZoomTransitionEnd === "function") {
      m._onZoomTransitionEnd();
    } else {
      m._animatingZoom = false;
      map.getContainer().classList.remove("leaflet-zoom-anim");
    }
  } catch {
    /* ignore */
  }
  ensureMapNavReady(map);
}

function paintGlNoPointer(map: LeafletMap) {
  const el = map.getContainer();
  for (const sel of [".maplibregl-map", ".maplibregl-canvas", ".maplibregl-canvas-container"]) {
    el.querySelectorAll(sel).forEach((node) => {
      if (node instanceof HTMLElement) node.style.pointerEvents = "none";
    });
  }
}

/**
 * Mount inside MapContainer (HomeMap + RouteMap).
 * Outcome: zoom → pan with no intentional dead gap.
 */
export function MapNavHandoff() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const onZoomEnd = () => {
      ensureMapNavReady(map);
      paintGlNoPointer(map);
    };
    const onPointer = () => interruptZoomAnimIfNeeded(map);

    paintGlNoPointer(map);
    map.on("zoomend", onZoomEnd);
    // Capture: run before Leaflet decides the gesture is still "zoom".
    el.addEventListener("pointerdown", onPointer, true);
    el.addEventListener("touchstart", onPointer, { capture: true, passive: true });

    return () => {
      map.off("zoomend", onZoomEnd);
      el.removeEventListener("pointerdown", onPointer, true);
      el.removeEventListener("touchstart", onPointer, true);
    };
  }, [map]);
  return null;
}
