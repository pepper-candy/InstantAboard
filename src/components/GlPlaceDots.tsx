"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";
import { getIaMaplibreMap } from "@/lib/basemap";
import type { LatLng } from "@/lib/geo";
import type { NearbyPlace } from "@/lib/types";
import {
  EMPTY_FC,
  bindIaPlaceLeafletHits,
  disposeIaPlaceDots,
  ensureIaPlaceLayers,
  setIaPlaceHitHandlers,
  setIaStopsGeoJSON,
  setIaUserGeoJSON,
  stopPointFeature,
  userPointFeature,
  type IaFeatureCollection,
} from "@/lib/glPlaceDots";

function hex(color: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : "#888888";
}

export type GlCluster = {
  key: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
  places: NearbyPlace[];
};

function buildStopsFc(
  pins: NearbyPlace[],
  clusters: GlCluster[],
  selectedId: string | null,
): IaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      ...pins.map((p) =>
        stopPointFeature(p.lng, p.lat, {
          id: p.id,
          role: "stop",
          color: hex(p.color),
          selected: selectedId === p.id ? 1 : 0,
          count: 1,
          label: "",
        }),
      ),
      ...clusters.map((c) =>
        stopPointFeature(c.lng, c.lat, {
          id: c.key,
          role: "cluster",
          color: hex(c.color),
          selected: 0,
          count: c.count,
          label: String(c.count),
        }),
      ),
    ],
  };
}

/** Bus/minibus dots + clusters + user pin on the MapLibre basemap (not Leaflet Markers). */
export function GlPlaceDots({
  user,
  pins,
  clusters,
  selectedId,
  onSelect,
  onSelectGroup,
  /** When true (route overlay), clear stop/cluster dots; user pin stays. */
  hideStops = false,
}: {
  user: LatLng | null;
  pins: NearbyPlace[];
  clusters: GlCluster[];
  selectedId: string | null;
  onSelect: (place: NearbyPlace) => void;
  onSelectGroup?: (places: NearbyPlace[]) => void;
  hideStops?: boolean;
}) {
  const map = useMap();
  const placesById = useRef(new Map<string, NearbyPlace>());
  const clustersByKey = useRef(new Map<string, NearbyPlace[]>());
  const onSelectRef = useRef(onSelect);
  const onSelectGroupRef = useRef(onSelectGroup);
  const userFcRef = useRef(EMPTY_FC);
  const stopsFcRef = useRef(EMPTY_FC);
  onSelectRef.current = onSelect;
  onSelectGroupRef.current = onSelectGroup;

  placesById.current = new Map(pins.map((p) => [p.id, p]));
  clustersByKey.current = new Map(clusters.map((c) => [c.key, c.places]));

  const userFc = useMemo(
    () => (user ? userPointFeature(user.lng, user.lat) : EMPTY_FC),
    [user?.lat, user?.lng],
  );
  const stopsFc = useMemo(
    () => (hideStops ? EMPTY_FC : buildStopsFc(pins, clusters, selectedId)),
    [hideStops, pins, clusters, selectedId],
  );
  userFcRef.current = userFc;
  stopsFcRef.current = stopsFc;

  // Attach hit handlers + Leaflet-forwarded clicks once GL map exists.
  useEffect(() => {
    let cancelled = false;
    let poll: number | undefined;
    let glMap: ReturnType<typeof getIaMaplibreMap> = null;
    let unbindHits: (() => void) | undefined;

    const attach = (leaflet: LeafletMap) => {
      const gl = getIaMaplibreMap(leaflet);
      if (!gl) return false;
      glMap = gl;
      ensureIaPlaceLayers(gl);
      setIaPlaceHitHandlers(gl, {
        onStop: (id) => {
          const place = placesById.current.get(id);
          if (place) onSelectRef.current(place);
        },
        onCluster: (id) => {
          const group = clustersByKey.current.get(id);
          if (!group?.length) return;
          const open = onSelectGroupRef.current;
          if (open) open(group);
          else onSelectRef.current(group[0]);
        },
      });
      unbindHits?.();
      unbindHits = bindIaPlaceLeafletHits(leaflet, gl);
      setIaUserGeoJSON(gl, userFcRef.current);
      setIaStopsGeoJSON(gl, stopsFcRef.current);
      return true;
    };

    if (!attach(map)) {
      poll = window.setInterval(() => {
        if (cancelled) return;
        if (attach(map) && poll !== undefined) {
          window.clearInterval(poll);
          poll = undefined;
        }
      }, 50);
    }

    return () => {
      cancelled = true;
      if (poll !== undefined) window.clearInterval(poll);
      unbindHits?.();
      if (glMap) {
        disposeIaPlaceDots(glMap);
        setIaPlaceHitHandlers(glMap, null);
        setIaUserGeoJSON(glMap, EMPTY_FC);
        setIaStopsGeoJSON(glMap, EMPTY_FC);
      }
    };
  }, [map]);

  useEffect(() => {
    const gl = getIaMaplibreMap(map);
    if (!gl) return;
    ensureIaPlaceLayers(gl);
    setIaUserGeoJSON(gl, userFc);
  }, [map, userFc]);

  useEffect(() => {
    const gl = getIaMaplibreMap(map);
    if (!gl) return;
    ensureIaPlaceLayers(gl);
    setIaStopsGeoJSON(gl, stopsFc);
  }, [map, stopsFc]);

  return null;
}
