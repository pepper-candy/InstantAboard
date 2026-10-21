"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import "maplibre-gl/dist/maplibre-gl.css";

export const OPENFREEMAP_BRIGHT = "https://tiles.openfreemap.org/styles/bright";

export const OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let workerReady = false;

/** Point MapLibre at same-origin worker files (copied into public/maplibre). */
export function ensureMapLibreWorker() {
  if (workerReady || typeof window === "undefined") return;
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  workerReady = true;
}

/** OpenFreeMap Bright via MapLibre GL Leaflet — one basemap for home + detail. */
export function BrightBasemap() {
  const map = useMap();
  useEffect(() => {
    ensureMapLibreWorker();
    const layer = maplibreGL({
      style: OPENFREEMAP_BRIGHT,
      attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
    });
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);
  return null;
}
