"use client";

import { useEffect, useState } from "react";
import { haversine, type LatLng } from "@/lib/geo";

export function useGeo(active: boolean) {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos((prev) => {
          if (prev && haversine(prev, next) < 25) return prev;
          return next;
        });
        setDenied(false);
      },
      () => setDenied(true),
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [active]);

  return { pos, denied };
}
