"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";
import {
  addProtocol,
  setWorkerUrl,
  type AddProtocolAction,
  type ErrorEvent as MaplibreErrorEvent,
  type FilterSpecification,
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

/** Leaflet map → live MapLibre instance from the BrightBasemap maplibre-gl-leaflet layer. */
const iaGlByLeaflet = new WeakMap<LeafletMap, MaplibreMap>();

/** Overlay ensurers (route line, place dots, …) re-run after every style.load / setStyle. */
type IaGlStyleEnsure = (gl: MaplibreMap) => void;
const iaGlStyleEnsures = new Set<IaGlStyleEnsure>();

function rememberIaMaplibreMap(map: LeafletMap, gl: MaplibreMap | null) {
  if (gl) iaGlByLeaflet.set(map, gl);
  else iaGlByLeaflet.delete(map);
}

/** Hide OpenFreeMap Bright rail/transit POIs — app draws its own MTR / mode logos. */
function hideBasemapTransitPois(gl: MaplibreMap) {
  for (const id of ["poi_transit", "poi_r1", "poi_r7", "poi_r20"] as const) {
    try {
      if (!gl.getLayer(id)) continue;
      if (id === "poi_transit") {
        gl.setLayoutProperty(id, "visibility", "none");
        continue;
      }
      // Keep shops/amenities; drop rail station sprites that fight our MTR logos.
      const prev = gl.getFilter(id);
      const noRail: FilterSpecification = ["!=", ["get", "class"], "rail"];
      gl.setFilter(
        id,
        prev ? (["all", prev, noRail] as FilterSpecification) : noRail,
      );
    } catch {
      /* style torn down */
    }
  }
}


function notifyIaGlStyleReady(gl: MaplibreMap) {
  hideBasemapTransitPois(gl);
  for (const fn of iaGlStyleEnsures) {
    try {
      fn(gl);
    } catch {
      /* overlay ensure must not break basemap */
    }
  }
}

/**
 * Live MapLibre `Map` for this Leaflet map (same instance as BrightBasemap).
 * Do not create a second MapLibre map — overlays must use this.
 */
export function getIaMaplibreMap(map: LeafletMap): MaplibreMap | null {
  const cached = iaGlByLeaflet.get(map);
  if (cached) return cached;
  let found: MaplibreMap | null = null;
  map.eachLayer((layer) => {
    if (found) return;
    const gl = (layer as { getMaplibreMap?: () => MaplibreMap }).getMaplibreMap?.();
    if (gl) found = gl;
  });
  if (found) iaGlByLeaflet.set(map, found);
  return found;
}

/** Register a callback to re-add overlay sources/layers after Bright↔PMTiles setStyle. */
export function registerIaGlStyleEnsure(fn: IaGlStyleEnsure): () => void {
  iaGlStyleEnsures.add(fn);
  return () => {
    iaGlStyleEnsures.delete(fn);
  };
}

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
      // Custom sources/layers are wiped by setStyle({ diff: false }) — re-ensure overlays.
      notifyIaGlStyleReady(gl);
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

/** True when Leaflet container (and MapLibre canvas, if any) have a real size. */
function glPaintSurfaceReady(map: LeafletMap, layer: ReturnType<typeof maplibreGL>): boolean {
  const el = map.getContainer();
  if (!el || el.clientWidth < 2 || el.clientHeight < 2) return false;
  const gl = layer.getMaplibreMap?.();
  const canvas = gl?.getCanvas?.();
  if (!canvas) return true;
  return canvas.clientWidth >= 2 && canvas.clientHeight >= 2;
}

/**
 * Keep kicking resize/repaint until the GL surface is non-zero.
 * Opening DevTools used to "fix" a blank basemap only because it fired resize —
 * this does the same without needing the console.
 */
function scheduleKickGlPaint(
  map: LeafletMap,
  layer: ReturnType<typeof maplibreGL>,
): () => void {
  let done = false;
  let raf1 = 0;
  let raf2 = 0;
  const timers: number[] = [];
  let ro: ResizeObserver | null = null;

  const finish = () => {
    if (done) return;
    done = true;
    if (raf1) cancelAnimationFrame(raf1);
    if (raf2) cancelAnimationFrame(raf2);
    for (const id of timers) window.clearTimeout(id);
    ro?.disconnect();
    ro = null;
  };

  const attempt = () => {
    if (done) return;
    kickGlPaint(map, layer);
    if (glPaintSurfaceReady(map, layer)) finish();
  };

  attempt();
  raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(attempt);
  });
  // Layout / sheet / HMR often settles a beat after first paint.
  for (const ms of [50, 150, 400, 1000]) {
    timers.push(window.setTimeout(attempt, ms));
  }
  try {
    ro = new ResizeObserver(attempt);
    ro.observe(map.getContainer());
  } catch {
    /* older engines */
  }
  // Hard stop so we never observe forever if size stays 0 (hidden tab).
  timers.push(window.setTimeout(finish, 8000));

  return finish;
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

      // Kick until GL canvas has real size (DevTools resize used to be the only unstick).
      let stopKick = scheduleKickGlPaint(map, layer);
      const glKick = layer.getMaplibreMap?.();
      if (glKick) {
        rememberIaMaplibreMap(map, glKick);
        glKick.once("load", () => {
          stopKick();
          stopKick = scheduleKickGlPaint(map, layer);
          notifyIaGlStyleReady(glKick);
        });
      }
      (layer as { __iaStopKick?: () => void }).__iaStopKick = () => stopKick();
      modeRef.current = initialMode;
      localUrlRef.current = initialLocalUrl;

      sync = () => {
        // Pack installed ⇒ always local PMTiles; view bounds never switch mode.
        void applyMode(hasPack(), layer);
      };

      const onReady = (g: MaplibreMap) => {
        rememberIaMaplibreMap(map, g);
        notifyIaGlStyleReady(g);
        sync?.();
      };

      const gl = layer.getMaplibreMap?.();
      if (gl) {
        rememberIaMaplibreMap(map, gl);
        if (gl.loaded()) onReady(gl);
        else gl.once("load", () => onReady(gl));
      } else {
        pollId = window.setInterval(() => {
          const g = layer.getMaplibreMap?.();
          if (!g) return;
          if (pollId !== undefined) window.clearInterval(pollId);
          pollId = undefined;
          rememberIaMaplibreMap(map, g);
          if (g.loaded()) onReady(g);
          else g.once("load", () => onReady(g));
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
        try {
          (layer as { __iaStopKick?: () => void }).__iaStopKick?.();
        } catch {
          /* ignore */
        }
        map.removeLayer(layer);
        layerRef.current = null;
      }
      rememberIaMaplibreMap(map, null);
    };
  }, [map]);

  return null;
}
