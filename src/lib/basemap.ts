"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";
import {
  addProtocol,
  setWorkerUrl,
  type AddProtocolAction,
  type ErrorEvent as MaplibreErrorEvent,
  type Map as MaplibreMap,
  type StyleSpecification,
} from "maplibre-gl";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { Protocol } from "@/lib/pmtilesProtocol";
import {
  getLocalPack,
  hasPack,
  subscribeHkBasemapChange,
} from "@/lib/hkBasemapCache";
import { boundsIntersectHk } from "@/lib/hkBasemapManifest";
import "maplibre-gl/dist/maplibre-gl.css";

export const OPENFREEMAP_BRIGHT = "https://tiles.openfreemap.org/styles/bright";

export const OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const HK_OFFLINE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let workerReady = false;
let pmtilesProtocolReady = false;
let brightStyleCache: StyleSpecification | null = null;

/** Point MapLibre at same-origin worker files (copied into public/maplibre). */
export function ensureMapLibreWorker() {
  if (workerReady || typeof window === "undefined") return;
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
  workerReady = true;
}

function ensurePmtilesProtocol() {
  if (pmtilesProtocolReady || typeof window === "undefined") return;
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile as AddProtocolAction);
  pmtilesProtocolReady = true;
}

async function loadBrightStyle(): Promise<StyleSpecification> {
  if (brightStyleCache) return structuredClone(brightStyleCache);
  const res = await fetch(OPENFREEMAP_BRIGHT);
  if (!res.ok) throw new Error(`Bright style HTTP ${res.status}`);
  const style = (await res.json()) as StyleSpecification;
  brightStyleCache = style;
  return structuredClone(style);
}

/** Rewrite OpenMapTiles vector sources to a local PMTiles blob (OpenMapTiles schema). */
function styleWithPmtiles(style: StyleSpecification, blobUrl: string): StyleSpecification {
  const next = structuredClone(style);
  const sources = next.sources ?? {};
  for (const [id, src] of Object.entries(sources)) {
    if (!src || typeof src !== "object") continue;
    const s = src as { type?: string; url?: string; tiles?: string[] };
    if (s.type === "vector") {
      sources[id] = {
        type: "vector",
        url: `pmtiles://${blobUrl}`,
        attribution: "© OpenStreetMap contributors",
      };
    }
    // Drop remote raster basemap layers for offline HK pack (not in the extract).
    if (s.type === "raster") {
      delete sources[id];
    }
  }
  next.sources = sources;
  if (Array.isArray(next.layers)) {
    next.layers = next.layers.filter((layer) => {
      const src = (layer as { source?: string }).source;
      return !src || src in sources;
    });
  }
  return next;
}

function viewIntersectsHk(map: LeafletMap): boolean {
  const b = map.getBounds();
  return boundsIntersectHk(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
}

/** Prefer MapLibre GL Leaflet attribution API; fall back to Leaflet control DOM. */
function setBasemapAttribution(map: LeafletMap, html: string) {
  const container = map.getContainer();
  const el = container.querySelector(
    ".leaflet-control-attribution",
  ) as HTMLElement | null;
  if (!el) return;

  // Preserve Leaflet's default chip when present; replace custom HTML otherwise.
  const leafletLink = el.querySelector('a[href="https://leafletjs.com"]');
  if (leafletLink && leafletLink.parentElement === el) {
    // Keep "Leaflet |" prefix, replace the rest
    const prefix = leafletLink.outerHTML;
    el.innerHTML = `${prefix} | ${html}`;
  } else {
    el.innerHTML = html;
  }
}

function setGlStyle(
  gl: MaplibreMap,
  style: string | StyleSpecification,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: MaplibreErrorEvent) => {
      gl.off("style.load", onLoad);
      reject(new Error(e.error?.message ?? "style error"));
    };
    const onLoad = () => {
      gl.off("error", onError);
      resolve();
    };
    gl.once("style.load", onLoad);
    gl.once("error", onError);
    gl.setStyle(style, { diff: false });
  });
}

type Mode = "online" | "local";

/**
 * OpenFreeMap Bright via MapLibre GL Leaflet — Bright online first paint.
 * When a verified HK PMTiles pack is active and the view intersects HK bounds,
 * swap the GL style to local tiles; outside HK (or until pack ready) stay online.
 */
export function BrightBasemap() {
  const map = useMap();
  const layerRef = useRef<ReturnType<typeof maplibreGL> | null>(null);
  const modeRef = useRef<Mode>("online");
  const localUrlRef = useRef<string | null>(null);
  const applyingRef = useRef(false);
  const pendingSyncRef = useRef(false);

  useEffect(() => {
    ensureMapLibreWorker();
    ensurePmtilesProtocol();

    const layer = maplibreGL({
      style: OPENFREEMAP_BRIGHT,
      attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
    });
    layer.addTo(map);
    layerRef.current = layer;
    modeRef.current = "online";

    let sync: () => void;

    const applyMode = async (wantLocal: boolean) => {
      if (applyingRef.current) {
        pendingSyncRef.current = true;
        return;
      }
      const gl = layer.getMaplibreMap?.();
      if (!gl) return;

      const next: Mode = wantLocal ? "local" : "online";
      if (next === modeRef.current) {
        if (next === "online") return;
        // local: re-apply only if pack blob URL changed (atomic swap)
        const pack = await getLocalPack();
        if (pack && pack.blobUrl === localUrlRef.current) return;
      }

      applyingRef.current = true;
      try {
        if (next === "online") {
          await setGlStyle(gl, OPENFREEMAP_BRIGHT);
          modeRef.current = "online";
          localUrlRef.current = null;
          setBasemapAttribution(map, OPENFREEMAP_ATTRIBUTION);
          return;
        }

        const pack = await getLocalPack();
        if (!pack) {
          await setGlStyle(gl, OPENFREEMAP_BRIGHT);
          modeRef.current = "online";
          localUrlRef.current = null;
          setBasemapAttribution(map, OPENFREEMAP_ATTRIBUTION);
          return;
        }

        const bright = await loadBrightStyle();
        const localStyle = styleWithPmtiles(bright, pack.blobUrl);
        await setGlStyle(gl, localStyle);
        modeRef.current = "local";
        localUrlRef.current = pack.blobUrl;
        setBasemapAttribution(map, HK_OFFLINE_ATTRIBUTION);
      } catch {
        try {
          await setGlStyle(gl, OPENFREEMAP_BRIGHT);
        } catch {
          /* keep previous */
        }
        modeRef.current = "online";
        localUrlRef.current = null;
        setBasemapAttribution(map, OPENFREEMAP_ATTRIBUTION);
      } finally {
        applyingRef.current = false;
        if (pendingSyncRef.current) {
          pendingSyncRef.current = false;
          sync();
        }
      }
    };

    sync = () => {
      const wantLocal = hasPack() && viewIntersectsHk(map);
      void applyMode(wantLocal);
    };

    const onReady = () => {
      sync();
    };

    // Wait for GL map; fall back to short poll if load already fired.
    const gl = layer.getMaplibreMap?.();
    if (gl) {
      if (gl.loaded()) onReady();
      else gl.once("load", onReady);
    } else {
      const id = window.setInterval(() => {
        const g = layer.getMaplibreMap?.();
        if (!g) return;
        window.clearInterval(id);
        if (g.loaded()) onReady();
        else g.once("load", onReady);
      }, 50);
      window.setTimeout(() => window.clearInterval(id), 5000);
    }

    map.on("moveend", sync);
    map.on("zoomend", sync);
    const unsub = subscribeHkBasemapChange(sync);

    return () => {
      map.off("moveend", sync);
      map.off("zoomend", sync);
      unsub();
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map]);

  return null;
}
