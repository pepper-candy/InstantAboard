"use client";

import { useEffect, useState } from "react";
import type { LatLng } from "@/lib/geo";

export function useGeo(active: boolean) {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setDenied(false);
      },
      () => setDenied(true),
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [active]);

  return { pos, denied };
}
