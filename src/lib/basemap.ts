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
  clearLocalPack,
  getLocalPack,
  hasPack,
  migratePackReaderEpoch,
  subscribeHkBasemapChange,
} from "@/lib/hkBasemapCache";
import "maplibre-gl/dist/maplibre-gl.css";

export const OPENFREEMAP_BRIGHT = "https://tiles.openfreemap.org/styles/bright";

export const OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const HK_OFFLINE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let workerReady = false;
let pmtilesProtocolReady = false;
let brightStyleCache: StyleSpecification | null = null;
/** Session guard: clear broken pack at most once before Bright fallback. */
let clearedBrokenPackOnce = false;

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
        attribution: "\u00a9 OpenStreetMap contributors",
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

/** Leaflet markers can paint while MapLibre canvas stays 0×0 until a window resize (e.g. DevTools). */
function kickGlPaint(map: LeafletMap, layer: ReturnType<typeof maplibreGL>) {
  try {
    map.invalidateSize({ pan: false, animate: false });
  } catch {
    /* ignore */
  }
  try {
    // maplibre-gl-leaflet listens for Leaflet "resize"
    map.fire("resize");
  } catch {
    /* ignore */
  }
  const gl = layer.getMaplibreMap?.();
  if (!gl) return;
  try {
    gl.resize();
  } catch {
    /* ignore */
  }
  try {
    gl.triggerRepaint();
  } catch {
    /* ignore */
  }
}


/**
 * OpenFreeMap Bright via MapLibre GL Leaflet.
 * No pack: Bright online first paint; after pack install, swap once to local PMTiles and stay.
 * With pack: always local PMTiles (style JSON may still come from OpenFreeMap as a template).
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

    let cancelled = false;
    let sync: (() => void) | undefined;
    let unsub: (() => void) | null = null;
    let pollId: number | undefined;
    let pollTimeoutId: number | undefined;

    const applyMode = async (
      wantLocal: boolean,
      layer: ReturnType<typeof maplibreGL>,
    ) => {
      if (applyingRef.current) {
        pendingSyncRef.current = true;
        return;
      }
      const gl = layer.getMaplibreMap?.();
      if (!gl) return;

      const next: Mode = wantLocal ? "local" : "online";

      // Already online — nothing to do.
      if (next === "online" && modeRef.current === "online") return;

      // Already local with the same pack blob — skip setStyle thrash.
      if (next === "local" && modeRef.current === "local" && localUrlRef.current) {
        const pack = await getLocalPack();
        if (pack && pack.blobUrl === localUrlRef.current) return;
      }

      applyingRef.current = true;
      try {
        if (next === "online") {
          // Prefer local when a pack is present, but allow Bright after a broken-pack clear.
          if (hasPack() && !clearedBrokenPackOnce) return;
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

        if (
          modeRef.current === "local" &&
          localUrlRef.current === pack.blobUrl
        ) {
          return;
        }

        const bright = await loadBrightStyle();
        const localStyle = styleWithPmtiles(bright, pack.blobUrl);
        await setGlStyle(gl, localStyle);
        modeRef.current = "local";
        localUrlRef.current = pack.blobUrl;
        setBasemapAttribution(map, HK_OFFLINE_ATTRIBUTION);
      } catch {
        // Local style/tile failure → drop pack once, then Bright + OpenFreeMap attribution.
        if (!clearedBrokenPackOnce && hasPack()) {
          clearedBrokenPackOnce = true;
          try {
            await clearLocalPack();
          } catch {
            /* ignore clear errors */
          }
        }
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
          sync?.();
        }
      }
    };

    const attachLayer = (
      layer: ReturnType<typeof maplibreGL>,
      initialMode: Mode,
      initialLocalUrl: string | null,
    ) => {
      layer.addTo(map);
      layerRef.current = layer;

      // One-shot paint kick after attach / style load only — never loop during pinch.
      kickGlPaint(map, layer);
      const glKick = layer.getMaplibreMap?.();
      if (glKick) {
        glKick.once("load", () => kickGlPaint(map, layer));
      }
      modeRef.current = initialMode;
      localUrlRef.current = initialLocalUrl;

      sync = () => {
        // Pack installed ⇒ always local PMTiles; view bounds never switch mode.
        void applyMode(hasPack(), layer);
      };

      const onReady = () => {
        sync?.();
      };

      const gl = layer.getMaplibreMap?.();
      if (gl) {
        if (gl.loaded()) onReady();
        else gl.once("load", onReady);
      } else {
        pollId = window.setInterval(() => {
          const g = layer.getMaplibreMap?.();
          if (!g) return;
          if (pollId !== undefined) window.clearInterval(pollId);
          pollId = undefined;
          if (g.loaded()) onReady();
          else g.once("load", onReady);
        }, 50);
        pollTimeoutId = window.setTimeout(() => {
          if (pollId !== undefined) window.clearInterval(pollId);
          pollId = undefined;
        }, 5000);
      }

      map.on("moveend", sync);
      map.on("zoomend", sync);
      unsub = subscribeHkBasemapChange(sync);
    };

    const boot = async () => {
      // Epoch < 2 packs used FetchSource+Range on blob: URLs → clear so clients re-download.
      try {
        await migratePackReaderEpoch();
      } catch {
        /* continue with whatever pack state remains */
      }
      if (cancelled) return;

      // Pack already present: build local style before first paint when practical.
      if (hasPack()) {
        try {
          const pack = await getLocalPack();
          if (cancelled) return;
          if (pack) {
            const bright = await loadBrightStyle();
            if (cancelled) return;
            const localStyle = styleWithPmtiles(bright, pack.blobUrl);
            const layer = maplibreGL({
              style: localStyle,
              attributionControl: { customAttribution: HK_OFFLINE_ATTRIBUTION },
            });
            if (cancelled) return;
            attachLayer(layer, "local", pack.blobUrl);
            setBasemapAttribution(map, HK_OFFLINE_ATTRIBUTION);
            return;
          }
        } catch {
          // Broken pack on first paint → clear once and fall through to Bright.
          if (!clearedBrokenPackOnce && hasPack()) {
            clearedBrokenPackOnce = true;
            try {
              await clearLocalPack();
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (cancelled) return;

      // No pack (or local boot failed): online first paint until pack arrives.
      const layer = maplibreGL({
        style: OPENFREEMAP_BRIGHT,
        attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
      });
      attachLayer(layer, "online", null);
    };

    void boot();

    return () => {
      cancelled = true;
      if (pollId !== undefined) window.clearInterval(pollId);
      if (pollTimeoutId !== undefined) window.clearTimeout(pollTimeoutId);
      if (sync) {
        map.off("moveend", sync);
        map.off("zoomend", sync);
      }
      unsub?.();
      const layer = layerRef.current;
      if (layer) {
        map.removeLayer(layer);
        layerRef.current = null;
      }
    };
  }, [map]);

  return null;
}
